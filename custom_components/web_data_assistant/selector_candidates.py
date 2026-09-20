"""Bounded, deterministic CSS locator suggestions for a selected HTML node.

Ratings describe structural heuristics in one response, not a guarantee that a
website will keep an identifier. Measured text and URL-bearing attributes are
never used as anchors. Existing stored selectors are not rewritten.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import combinations
import re
from typing import Any

from bs4 import BeautifulSoup, Tag
import soupsieve

MAX_CANDIDATES = 5
MAX_EVALUATIONS = 64
MAX_ANCESTORS = 5
MAX_SELECTOR_LENGTH = 2000
_IDENTIFYING_ATTRIBUTES = (
    "data-testid", "data-test", "data-cy", "data-qa", "data-id", "itemprop", "name", "aria-label",
)
_VOLATILE = re.compile(
    r"^(?:(?:is|has)-)?(?:active|selected|open|closed|loading|hidden|disabled|enabled|"
    r"expanded|collapsed|online|offline|available|unavailable|error|success|checked|hover|focus)$",
    re.I,
)
_GENERATED = re.compile(
    r"(?:[0-9a-f]{8,}|\d{6,}|(?:^|[-_:])(?:css|sc|ember|react|radix|headlessui)[-_:][a-z0-9]+)",
    re.I,
)
_UTILITY = re.compile(r"^(?:flex|grid|block|inline|relative|absolute|(?:m[trblxy]?|p[trblxy]?|w|h)-\d+)$")


@dataclass(frozen=True, slots=True)
class SelectorCandidate:
    """A locator verified against the *identity* of the chosen node."""

    selector: str
    index: int
    match_count: int
    stability: str
    reason: str
    strategy: str
    score: int

    def as_dict(self) -> dict[str, Any]:
        """Expose explanations, not a spurious confidence percentage."""
        data = asdict(self)
        del data["score"]
        return data


@dataclass(frozen=True, slots=True)
class _Segment:
    selector: str
    score: int
    strategy: str
    reason: str


def _identity_index(nodes: list[Tag], target: Tag) -> int | None:
    # BeautifulSoup Tag equality compares markup. Identical siblings are NOT
    # interchangeable: list.index(target) can silently select the first one.
    return next((index for index, node in enumerate(nodes) if node is target), None)


def _usable_anchor(value: Any, tag: Tag) -> bool:
    if not isinstance(value, str) or not value or len(value) > 100:
        return False
    if any(ord(char) < 32 for char in value) or _GENERATED.search(value) or _VOLATILE.fullmatch(value):
        return False
    # A number or a copy of the current reading is not a stable identifier.
    if re.fullmatch(r"[\d\W]+", value) or value.casefold() == " ".join(tag.stripped_strings).casefold():
        return False
    return True


def _quoted(value: str) -> str:
    """Escape a CSS string literal (identifiers use soupsieve.escape)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _segments(tag: Tag) -> list[_Segment]:
    name = soupsieve.escape(tag.name)
    candidates: list[_Segment] = []
    element_id = tag.get("id")
    if _usable_anchor(element_id, tag):
        candidates.append(_Segment(f"#{soupsieve.escape(element_id)}", 100, "id", "Uses an element ID."))
    for attribute in _IDENTIFYING_ATTRIBUTES:
        value = tag.get(attribute)
        if _usable_anchor(value, tag):
            # Do not capture URLs, bearer tokens or observed values through an
            # arbitrary data-* attribute. Even allowlisted attributes are vetted.
            if "://" in value or "?" in value or re.search(r"\d", value) and attribute == "aria-label":
                continue
            score = 90 if attribute.startswith("data-") else 82
            candidates.append(_Segment(
                f"{name}[{attribute}={_quoted(value)}]", score, "attribute",
                f"Uses the identifying {attribute} attribute.",
            ))
    classes = tag.get("class", [])
    if isinstance(classes, str):
        classes = classes.split()
    safe = sorted({value for value in classes if _usable_anchor(value, tag)}, key=lambda value: (_UTILITY.fullmatch(value) is not None, len(value), value))[:5]
    for size in (1, 2, 3):
        for group in combinations(safe, size):
            score = 76 - size - (15 if all(_UTILITY.fullmatch(value) for value in group) else 0)
            candidates.append(_Segment(
                name + "".join(f".{soupsieve.escape(value)}" for value in group),
                score, "class", "Uses descriptive CSS classes; styling changes can affect it.",
            ))
    # Test combinations, but keep work independent of pathological class lists.
    candidates.sort(key=lambda item: (-item.score, len(item.selector), item.selector))
    return candidates[:12] + [_Segment(name, 15, "tag", "Uses only the element type; page-order changes can select another value.")]


class SelectorGenerator:
    """Reuse bounded selector lookups while finding several text matches."""

    def __init__(self, soup: BeautifulSoup) -> None:
        self.soup = soup
        self._cache: dict[str, list[Tag]] = {}

    def _select(self, selector: str) -> list[Tag]:
        if selector in self._cache:
            return self._cache[selector]
        found = self.soup.select(selector)
        # Bound retained references independently of document size/match count.
        if len(self._cache) < 128 and len(found) <= 250:
            self._cache[selector] = found
        return found

    def candidates(self, target: Tag) -> list[SelectorCandidate]:
        """Rank a short list; every candidate selects the exact target node."""
        options: dict[tuple[str, int], SelectorCandidate] = {}
        evaluated: set[str] = set()

        def add(segment: _Segment, *, positional: bool = False) -> None:
            selector = segment.selector
            if selector in evaluated or len(evaluated) >= MAX_EVALUATIONS or len(selector) > MAX_SELECTOR_LENGTH:
                return
            evaluated.add(selector)
            try:
                found = self._select(selector)
            except (soupsieve.SelectorSyntaxError, ValueError):
                return
            index = _identity_index(found, target)
            if index is None:
                return
            count = len(found)
            score = segment.score
            reason = segment.reason
            if count != 1:
                score -= 65 + min(count - 2, 10)
                stability = "fragile"
                reason += f" Uses match {index + 1} of {count} in document order."
            elif segment.strategy == "tag":
                stability = "fragile"
            elif positional:
                stability = "moderate"
            else:
                stability = "strong" if score >= 82 else "moderate"
            options[(selector, index)] = SelectorCandidate(selector, index, count, stability, reason, segment.strategy, score)

        local = _segments(target)
        add(local[-1])  # Always keep a truthful fallback, including duplicate markup.
        for segment in local[:-1]:
            add(segment)

        # Descendant anchoring tolerates unrelated links elsewhere and inserted
        # wrappers. Restrict nth-of-type paths to a short, uniquely anchored scope.
        current = target.parent
        descendants = [target]
        for depth in range(MAX_ANCESTORS):
            if not isinstance(current, Tag) or isinstance(current, BeautifulSoup) or current.name in {"html", "body"}:
                break
            anchors = _segments(current)[:-1][:3]
            for anchor in anchors:
                try:
                    anchor_nodes = self._select(anchor.selector)
                except (soupsieve.SelectorSyntaxError, ValueError):
                    continue
                unique_anchor = len(anchor_nodes) == 1 and anchor_nodes[0] is current
                # Include both the bare target tag and its best semantic segments.
                for leaf in [local[-1], *local[:-1][:3]]:
                    score = (86 if unique_anchor and anchor.score >= 82 else 72) - depth
                    if leaf.strategy not in {"tag", "class"}:
                        score += 2
                    add(_Segment(
                        f"{anchor.selector} {leaf.selector}", score, "ancestor",
                        "Anchored inside an identified page section, rather than indexed across the whole page.",
                    ))
                if unique_anchor:
                    path: list[str] = []
                    for node in reversed(descendants):
                        siblings = [sibling for sibling in node.parent.find_all(node.name, recursive=False)]
                        index = _identity_index(siblings, node)
                        if index is None:
                            break
                        part = soupsieve.escape(node.name)
                        if len(siblings) > 1:
                            part += f":nth-of-type({index + 1})"
                        path.append(part)
                    else:
                        add(_Segment(
                            f"{anchor.selector} > " + " > ".join(path), 50 - depth, "position",
                            "Uses relative structure inside an identified section; inserting siblings or wrappers can break it.",
                        ), positional=True)
            descendants.append(current)
            current = current.parent

        ranked = sorted(options.values(), key=lambda item: (-item.score, len(item.selector), item.selector, item.index))
        # Keep a useful mix instead of five almost identical class combinations.
        shortlist: list[SelectorCandidate] = []
        family_counts: dict[str, int] = {}
        for candidate in ranked:
            if family_counts.get(candidate.strategy, 0) >= 2:
                continue
            shortlist.append(candidate)
            family_counts[candidate.strategy] = family_counts.get(candidate.strategy, 0) + 1
            if len(shortlist) == MAX_CANDIDATES:
                break
        if not shortlist:
            raise ValueError("Unable to generate a selector for the selected element")
        return shortlist


def selector_candidates(soup: BeautifulSoup, target: Tag) -> list[SelectorCandidate]:
    """Convenience API for a single selection (e.g. the compatibility preview)."""
    return SelectorGenerator(soup).candidates(target)
