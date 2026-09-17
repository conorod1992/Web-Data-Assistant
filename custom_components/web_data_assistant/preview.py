"""Safe HTML preview helpers for the guided scrape UI."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Tag

_PREVIEW_ID = "data-wda-preview-id"
_BLOCKED_TAGS = {"script", "iframe", "object", "embed", "form", "base"}
_RESOURCE_ATTRIBUTES = {"src", "poster"}
_PREVIEW_CSP = (
    "default-src 'none'; "
    "style-src 'unsafe-inline' http: https:; "
    "img-src data: http: https:; "
    "font-src data: http: https:; "
    "media-src data: blob: http: https:; "
    "form-action 'none'; frame-src 'none'; object-src 'none'; script-src 'none'"
)


@dataclass(slots=True)
class PreviewElement:
    """Extraction metadata for one element in a rendered preview."""

    selector: str
    index: int
    tag: str
    text: str

    def as_dict(self) -> dict[str, Any]:
        """Return JSON-serialisable preview metadata."""
        return {
            "selector": self.selector,
            "index": self.index,
            "tag": self.tag,
            "text": self.text,
        }


def _clean_text(tag: Tag) -> str:
    """Return compact text for a preview element."""
    return " ".join(tag.get_text(" ", strip=True).split())[:240]


def _safe_identifier(value: Any) -> str | None:
    """Return a conservative CSS identifier or None."""
    if not isinstance(value, str) or not value or len(value) > 64:
        return None
    if value[0].isdigit():
        return None
    if not all(char.isalnum() or char in "_-" for char in value):
        return None
    return value


def _safe_classes(tag: Tag) -> list[str]:
    """Return class names safe to use in generated preview selectors."""
    classes = tag.get("class", [])
    return [
        safe
        for value in classes
        if (safe := _safe_identifier(value)) is not None
    ]


def _is_preview_candidate(tag: Tag) -> bool:
    """Return whether a tag will remain visible/selectable in the preview."""
    if tag.name in _BLOCKED_TAGS or tag.name in {"html", "head", "body", "style"}:
        return False
    return not any(
        isinstance(parent, Tag)
        and (parent.name in _BLOCKED_TAGS or parent.name == "head")
        for parent in tag.parents
    )


def _safe_base_url(source_url: str) -> str:
    """Return a resource-resolution base without credentials, query, or fragment."""
    parts = urlsplit(source_url)
    hostname = parts.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname
    if parts.port is not None:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path or "/", "", ""))


def _safe_resource_url(base_url: str, value: str) -> str | None:
    """Resolve a preview resource URL while excluding active schemes."""
    resolved = urljoin(base_url, value)
    scheme = urlsplit(resolved).scheme.casefold()
    if scheme not in {"http", "https", "data"}:
        return None
    return resolved


def _ensure_head(soup: BeautifulSoup) -> Tag:
    """Return a head element, creating one when the source omitted it."""
    if soup.head is not None:
        return soup.head
    head = soup.new_tag("head")
    if soup.html is not None:
        soup.html.insert(0, head)
    else:
        soup.insert(0, head)
    return head


def _annotate_preview_elements(
    soup: BeautifulSoup,
) -> dict[str, PreviewElement]:
    """Annotate selectable elements without repeated whole-document CSS queries.

    Preview generation used to call ``soup.select`` for every element in the
    document. On a large page that becomes effectively quadratic. Two small
    counting passes let us generate stable selector/index pairs in linear time.
    """
    candidates = [tag for tag in soup.find_all(True) if _is_preview_candidate(tag)]

    id_counts: Counter[str] = Counter()
    class_counts: Counter[tuple[str, str]] = Counter()
    tag_counts: Counter[str] = Counter()

    for tag in candidates:
        if safe_id := _safe_identifier(tag.get("id")):
            id_counts[safe_id] += 1
        for class_name in _safe_classes(tag):
            class_counts[(tag.name, class_name)] += 1
        tag_counts[tag.name] += 1

    class_seen: Counter[tuple[str, str]] = Counter()
    tag_seen: Counter[str] = Counter()
    elements: dict[str, PreviewElement] = {}

    for counter, tag in enumerate(candidates):
        tag_position = tag_seen[tag.name]
        tag_seen[tag.name] += 1

        safe_classes = _safe_classes(tag)
        class_positions: dict[str, int] = {}
        for class_name in safe_classes:
            key = (tag.name, class_name)
            class_positions[class_name] = class_seen[key]
            class_seen[key] += 1

        safe_id = _safe_identifier(tag.get("id"))
        if safe_id and id_counts[safe_id] == 1:
            selector = f"#{safe_id}"
            index = 0
        elif safe_classes:
            # Prefer the rarest single stable class. Its running position gives
            # the exact index for ``tag.class`` without evaluating the selector.
            class_name = min(
                safe_classes,
                key=lambda value: class_counts[(tag.name, value)],
            )
            selector = f"{tag.name}.{class_name}"
            index = class_positions[class_name]
        else:
            selector = tag.name
            index = tag_position

        preview_id = str(counter)
        tag[_PREVIEW_ID] = preview_id
        elements[preview_id] = PreviewElement(
            selector=selector,
            index=index,
            tag=tag.name,
            text=_clean_text(tag),
        )

    return elements


def build_html_preview(
    html: str,
    source_url: str,
) -> tuple[str, dict[str, PreviewElement]]:
    """Build sanitised markup plus click-to-extraction metadata.

    Active page content is removed and the result is intended for a sandboxed
    srcdoc iframe controlled by the Web Data Assistant frontend.
    """
    soup = BeautifulSoup(html, "html.parser")
    safe_base_url = _safe_base_url(source_url)
    elements = _annotate_preview_elements(soup)

    for tag in list(soup.find_all(_BLOCKED_TAGS)):
        tag.decompose()

    for meta in list(soup.find_all("meta")):
        if str(meta.get("http-equiv", "")).casefold() in {
            "refresh",
            "content-security-policy",
        }:
            meta.decompose()
        elif str(meta.get("name", "")).casefold() == "referrer":
            meta.decompose()

    for link in list(soup.find_all("link")):
        rel = {str(value).casefold() for value in link.get("rel", [])}
        if "stylesheet" not in rel:
            link.decompose()

    for tag in soup.find_all(True):
        for attribute in list(tag.attrs):
            lowered = attribute.casefold()
            if lowered.startswith("on") or lowered in {
                "srcdoc",
                "action",
                "formaction",
                "srcset",
                "imagesrcset",
            }:
                del tag.attrs[attribute]

        if tag.name == "a":
            tag.attrs.pop("href", None)
            tag.attrs.pop("target", None)

        for attribute in _RESOURCE_ATTRIBUTES:
            value = tag.get(attribute)
            if not isinstance(value, str):
                continue
            resolved = _safe_resource_url(safe_base_url, value)
            if resolved is None:
                del tag.attrs[attribute]
            else:
                tag[attribute] = resolved
                tag["referrerpolicy"] = "no-referrer"

        if tag.name == "link":
            href = tag.get("href")
            if isinstance(href, str):
                resolved = _safe_resource_url(safe_base_url, href)
                if resolved is None:
                    tag.decompose()
                    continue
                tag["href"] = resolved
                tag["referrerpolicy"] = "no-referrer"

    head = _ensure_head(soup)

    base = soup.new_tag("base", href=safe_base_url)
    head.insert(0, base)

    referrer = soup.new_tag("meta")
    referrer["name"] = "referrer"
    referrer["content"] = "no-referrer"
    head.insert(1, referrer)

    csp = soup.new_tag("meta")
    csp["http-equiv"] = "Content-Security-Policy"
    csp["content"] = _PREVIEW_CSP
    head.insert(2, csp)

    overlay_style = soup.new_tag("style")
    overlay_style.string = """
[data-wda-preview-id] { cursor: crosshair !important; }
[data-wda-preview-id]:hover {
  outline: 2px solid #03a9f4 !important;
  outline-offset: 1px !important;
}
"""
    head.append(overlay_style)

    return str(soup), elements
