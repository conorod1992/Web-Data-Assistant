"""Discovery and extraction helpers for Web Data Assistant."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from bs4 import BeautifulSoup, Tag

from .const import MAX_HTML_MATCHES, MAX_JSON_DISCOVERY_VALUES, MAX_PREVIEW_LENGTH
from .models import HtmlMatch, JsonCandidate


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


def iter_json_candidates(data: Any) -> Iterator[JsonCandidate]:
    """Yield scalar values in a JSON response with stable JSON Pointer paths."""
    yielded = 0

    def walk(value: Any, pointer: str, display: str) -> Iterator[JsonCandidate]:
        nonlocal yielded
        if yielded >= MAX_JSON_DISCOVERY_VALUES:
            return

        if isinstance(value, dict):
            for key, child in value.items():
                if yielded >= MAX_JSON_DISCOVERY_VALUES:
                    return
                part = _escape_pointer_part(str(key))
                child_pointer = f"{pointer}/{part}"
                child_display = f"{display}.{key}" if display else str(key)
                yield from walk(child, child_pointer, child_display)
            return

        if isinstance(value, list):
            for index, child in enumerate(value):
                if yielded >= MAX_JSON_DISCOVERY_VALUES:
                    return
                child_pointer = f"{pointer}/{index}"
                child_display = f"{display}[{index}]" if display else f"[{index}]"
                yield from walk(child, child_pointer, child_display)
            return

        yielded += 1
        yield JsonCandidate(
            path=pointer or "",
            value=value,
            display_path=display or "(root)",
            preview=_preview(value),
        )

    yield from walk(data, "", "")


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


def _tag_matches_text(tag: Tag, search_text: str) -> bool:
    """Return whether a tag contains the requested text."""
    text = _normalise_text(tag.get_text(" ", strip=True))
    return search_text.casefold() in text.casefold()


def _smallest_text_matches(soup: BeautifulSoup, search_text: str) -> list[Tag]:
    """Find the smallest elements whose text contains the requested value."""
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


def _safe_classes(tag: Tag) -> list[str]:
    """Return class names that are reasonable to use in a generated selector."""
    classes = tag.get("class", [])
    return [
        value
        for value in classes
        if isinstance(value, str)
        and value
        and len(value) <= 64
        and not value[0].isdigit()
        and all(char.isalnum() or char in "_-" for char in value)
    ]


def _selector_for_tag(soup: BeautifulSoup, tag: Tag) -> tuple[str, int]:
    """Generate a compact selector plus the selected match index."""
    element_id = tag.get("id")
    if isinstance(element_id, str) and element_id:
        selector = f"#{element_id}"
        try:
            found = soup.select(selector)
        except Exception:  # BeautifulSoup delegates selector parsing to soupsieve.
            found = []
        if len(found) == 1:
            return selector, 0

    classes = _safe_classes(tag)
    if classes:
        selector = tag.name + "".join(f".{value}" for value in classes[:3])
        found = soup.select(selector)
        if tag in found:
            return selector, found.index(tag)

    selector = tag.name
    found = soup.select(selector)
    if tag in found:
        return selector, found.index(tag)

    raise ValueError("Unable to generate a selector for the selected element")


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
    """Find selectable HTML elements containing text entered by the user."""
    if not search_text.strip():
        return []

    soup = BeautifulSoup(html, "html.parser")
    matches: list[HtmlMatch] = []
    for tag in _smallest_text_matches(soup, search_text.strip()):
        selector, index = _selector_for_tag(soup, tag)
        matches.append(
            HtmlMatch(
                selector=selector,
                index=index,
                text=_preview(_normalise_text(tag.get_text(" ", strip=True))),
                context=_context_for_tag(tag),
                tag=tag.name,
            )
        )
    return matches


def extract_html_value(
    html: str,
    selector: str,
    index: int = 0,
    attribute: str | None = None,
) -> str:
    """Extract one value from HTML using a generated or advanced selector."""
    soup = BeautifulSoup(html, "html.parser")
    matches = soup.select(selector)
    if index < 0 or index >= len(matches):
        raise KeyError(
            f"Selector {selector!r} returned {len(matches)} elements; index {index} is unavailable"
        )

    selected = matches[index]
    if attribute:
        value = selected.get(attribute)
        if value is None:
            raise KeyError(f"Attribute {attribute!r} was not found on the selected element")
        if isinstance(value, list):
            return " ".join(str(item) for item in value)
        return str(value)

    return _normalise_text(selected.get_text(" ", strip=True))
