"""Discovery and extraction helpers for Web Data Assistant."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from bs4 import BeautifulSoup, Tag
import soupsieve

from .const import MAX_HTML_MATCHES, MAX_JSON_DISCOVERY_VALUES, MAX_PREVIEW_LENGTH
from .models import (
    ExtractionResult,
    HtmlMatch,
    JsonCandidate,
    WebDataEntityConfig,
)
from .selector_candidates import SelectorGenerator

_NON_VISIBLE_TEXT_TAGS = {"head", "script", "style", "template", "noscript"}


def _preview(value: Any, limit: int = MAX_PREVIEW_LENGTH) -> str:
    """Return a compact human-readable value preview."""
    text = str(value).replace("\n", " ").strip()
    text = " ".join(text.split())
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _escape_pointer_part(part: str) -> str:
    """Escape one RFC 6901 JSON Pointer path component."""
    return part.replace("~", "~0").replace("/", "~1")


def _unescape_pointer_part(part: str) -> str:
    """Unescape one RFC 6901 JSON Pointer path component."""
    return part.replace("~1", "/").replace("~0", "~")


def _iter_json_scalars(data: Any) -> Iterator[JsonCandidate]:
    """Yield every scalar value in a JSON document without applying a UI cap."""
    def walk(value: Any, pointer: str, display: str) -> Iterator[JsonCandidate]:
        if isinstance(value, dict):
            for key, child in value.items():
                part = _escape_pointer_part(str(key))
                child_pointer = f"{pointer}/{part}"
                child_display = f"{display}.{key}" if display else str(key)
                yield from walk(child, child_pointer, child_display)
            return

        if isinstance(value, list):
            for index, child in enumerate(value):
                child_pointer = f"{pointer}/{index}"
                child_display = f"{display}[{index}]" if display else f"[{index}]"
                yield from walk(child, child_pointer, child_display)
            return

        yield JsonCandidate(
            path=pointer or "",
            value=value,
            display_path=display or "(root)",
            preview=_preview(value),
        )

    yield from walk(data, "", "")


def discover_json_candidates(data: Any) -> tuple[list[JsonCandidate], bool]:
    """Return capped JSON candidates plus whether additional values were omitted."""
    candidates: list[JsonCandidate] = []
    iterator = _iter_json_scalars(data)
    for _ in range(MAX_JSON_DISCOVERY_VALUES + 1):
        try:
            candidate = next(iterator)
        except StopIteration:
            break
        candidates.append(candidate)

    truncated = len(candidates) > MAX_JSON_DISCOVERY_VALUES
    if truncated:
        candidates.pop()
    return candidates, truncated


def iter_json_candidates(data: Any) -> Iterator[JsonCandidate]:
    """Yield capped scalar values in a JSON response with stable JSON Pointer paths."""
    candidates, _ = discover_json_candidates(data)
    yield from candidates


def resolve_json_pointer(data: Any, pointer: str) -> Any:
    """Resolve a stored RFC 6901 JSON Pointer against a response."""
    if pointer == "":
        return data
    if not pointer.startswith("/"):
        raise ValueError("JSON pointer must be empty or start with '/'")

    current = data
    for raw_part in pointer[1:].split("/"):
        part = _unescape_pointer_part(raw_part)
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError) as err:
                raise KeyError(f"Array item {part!r} was not found") from err
        elif isinstance(current, dict):
            if part not in current:
                raise KeyError(f"Object key {part!r} was not found")
            current = current[part]
        else:
            raise KeyError(f"Cannot descend through scalar value at {part!r}")
    return current


def _normalise_text(value: str) -> str:
    """Normalise rendered-ish HTML text for matching."""
    return " ".join(value.split()).strip()


def _tag_is_visible_text_candidate(tag: Tag) -> bool:
    """Return whether an element can reasonably represent visible page text."""
    if tag.name in _NON_VISIBLE_TEXT_TAGS:
        return False
    return not any(
        isinstance(parent, Tag) and parent.name in _NON_VISIBLE_TEXT_TAGS
        for parent in tag.parents
    )


def _tag_matches_text(tag: Tag, search_text: str) -> bool:
    """Return whether a visible candidate tag contains the requested text."""
    if not _tag_is_visible_text_candidate(tag):
        return False
    text = _normalise_text(tag.get_text(" ", strip=True))
    return search_text.casefold() in text.casefold()


def _smallest_text_matches(soup: BeautifulSoup, search_text: str) -> list[Tag]:
    """Find the smallest visible elements whose text contains the requested value."""
    matches: list[Tag] = []
    for tag in soup.find_all(True):
        if not _tag_matches_text(tag, search_text):
            continue
        if any(_tag_matches_text(child, search_text) for child in tag.find_all(True, recursive=False)):
            continue
        matches.append(tag)
        if len(matches) >= MAX_HTML_MATCHES:
            break
    return matches


def _context_for_tag(tag: Tag) -> str:
    """Build concise surrounding text to help disambiguate matches."""
    current: Tag | None = tag
    for _ in range(3):
        parent = current.parent if current else None
        if not isinstance(parent, Tag):
            break
        text = _normalise_text(parent.get_text(" ", strip=True))
        if text and text != _normalise_text(tag.get_text(" ", strip=True)):
            return _preview(text)
        current = parent
    return _preview(tag.get_text(" ", strip=True))


def find_html_text_matches(html: str, search_text: str) -> list[HtmlMatch]:
    """Find selected nodes and rank locators without using the measured text."""
    if not search_text.strip():
        return []

    soup = BeautifulSoup(html, "html.parser")
    generator = SelectorGenerator(soup)
    matches: list[HtmlMatch] = []
    for tag in _smallest_text_matches(soup, search_text.strip()):
        candidates = generator.candidates(tag)
        recommended = candidates[0]
        matches.append(
            HtmlMatch(
                selector=recommended.selector,
                index=recommended.index,
                text=_preview(_normalise_text(tag.get_text(" ", strip=True))),
                context=_context_for_tag(tag),
                tag=tag.name,
                candidates=[candidate.as_dict() for candidate in candidates],
            )
        )
    return matches


def validate_html_selector(selector: str) -> None:
    """Check custom syntax in an executor before doing a network request."""
    try:
        soupsieve.compile(selector)
    except soupsieve.SelectorSyntaxError as err:
        raise ValueError("Invalid CSS selector. Check its syntax.") from err


def _selected_html_tag(
    soup: BeautifulSoup,
    selector: str,
    index: int,
    expected_match_count: int | None = None,
) -> tuple[Tag, int]:
    try:
        matches = soup.select(selector)
    except soupsieve.SelectorSyntaxError as err:
        raise ValueError("Invalid CSS selector. Check its syntax.") from err
    if expected_match_count is not None and len(matches) != expected_match_count:
        raise ValueError(
            f"Selector match count changed: expected {expected_match_count}, found {len(matches)}. "
            "Repair the selection to avoid reading a different element."
        )
    if index < 0 or index >= len(matches):
        raise KeyError(
            f"Selector {selector!r} returned {len(matches)} elements; index {index} is unavailable"
        )
    return matches[index], len(matches)


def _html_tag_value(selected: Tag, attribute: str | None = None) -> str:
    if attribute:
        value = selected.get(attribute)
        if value is None:
            raise KeyError(f"Attribute {attribute!r} was not found on the selected element")
        if isinstance(value, list):
            return " ".join(str(item) for item in value)
        return str(value)
    return _normalise_text(selected.get_text(" ", strip=True))


def preview_html_selector(
    html: str, selector: str, index: int = 0, attribute: str | None = None,
) -> dict[str, Any]:
    """Test a custom locator with the same parser/extraction as runtime polling."""
    soup = BeautifulSoup(html, "html.parser")
    selected, count = _selected_html_tag(soup, selector, index)
    return {
        "selector": selector,
        "index": index,
        "match_count": count,
        "text": _preview(_html_tag_value(selected, attribute)),
        "context": _context_for_tag(selected),
        "tag": selected.name,
    }


def extract_html_value_from_soup(
    soup: BeautifulSoup,
    selector: str,
    index: int = 0,
    attribute: str | None = None,
    expected_match_count: int | None = None,
) -> str:
    """Extract one value, optionally refusing changed selector cardinality."""
    selected, _ = _selected_html_tag(soup, selector, index, expected_match_count)
    return _html_tag_value(selected, attribute)


def extract_html_value(
    html: str,
    selector: str,
    index: int = 0,
    attribute: str | None = None,
) -> str:
    """Extract one value from HTML using a generated or advanced selector."""
    soup = BeautifulSoup(html, "html.parser")
    return extract_html_value_from_soup(soup, selector, index, attribute)


def extract_html_entities(
    html: str,
    entities: list[WebDataEntityConfig],
) -> ExtractionResult:
    """Parse HTML once and extract all configured values from the document."""
    soup = BeautifulSoup(html, "html.parser")
    result = ExtractionResult()
    for entity in entities:
        try:
            if entity.selector is None:
                raise ValueError("No HTML selector is configured")
            result.values[entity.key] = extract_html_value_from_soup(
                soup,
                entity.selector,
                entity.index,
                entity.attribute,
                entity.expected_match_count,
            )
        except (KeyError, TypeError, ValueError) as err:
            result.extraction_errors[entity.key] = str(err)
    return result
