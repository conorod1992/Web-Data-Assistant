"""Safe HTML preview helpers for the guided scrape UI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from .extraction import _selector_for_tag

_PREVIEW_ID = "data-wda-preview-id"
_BLOCKED_TAGS = {"script", "iframe", "object", "embed", "form", "base"}
_RESOURCE_ATTRIBUTES = {"src", "poster"}


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


def _safe_resource_url(base_url: str, value: str) -> str | None:
    """Resolve a preview resource URL while excluding active schemes."""
    resolved = urljoin(base_url, value)
    scheme = urlparse(resolved).scheme.casefold()
    if scheme not in {"http", "https", "data"}:
        return None
    return resolved


def build_html_preview(
    html: str,
    source_url: str,
) -> tuple[str, dict[str, PreviewElement]]:
    """Build sanitised markup plus click-to-extraction metadata.

    Scripts and interactive/embed elements are removed. The resulting document is
    intended for an iframe controlled by the Web Data Assistant frontend, not for
    direct serving as a standalone web page.
    """
    soup = BeautifulSoup(html, "html.parser")
    elements: dict[str, PreviewElement] = {}

    counter = 0
    for tag in list(soup.find_all(True)):
        if tag.name in _BLOCKED_TAGS or tag.name in {"html", "head", "body", "style"}:
            continue
        try:
            selector, index = _selector_for_tag(soup, tag)
        except (ValueError, TypeError):
            continue
        preview_id = str(counter)
        counter += 1
        tag[_PREVIEW_ID] = preview_id
        elements[preview_id] = PreviewElement(
            selector=selector,
            index=index,
            tag=tag.name,
            text=_clean_text(tag),
        )

    for tag in list(soup.find_all(_BLOCKED_TAGS)):
        tag.decompose()

    for meta in list(soup.find_all("meta")):
        if str(meta.get("http-equiv", "")).casefold() == "refresh":
            meta.decompose()

    for tag in soup.find_all(True):
        for attribute in list(tag.attrs):
            lowered = attribute.casefold()
            if lowered.startswith("on") or lowered in {"srcdoc", "action", "formaction"}:
                del tag.attrs[attribute]

        if tag.name == "a":
            tag.attrs.pop("href", None)
            tag.attrs.pop("target", None)

        for attribute in _RESOURCE_ATTRIBUTES:
            value = tag.get(attribute)
            if not isinstance(value, str):
                continue
            resolved = _safe_resource_url(source_url, value)
            if resolved is None:
                del tag.attrs[attribute]
            else:
                tag[attribute] = resolved

    overlay_style = soup.new_tag("style")
    overlay_style.string = """
[data-wda-preview-id] { cursor: crosshair !important; }
[data-wda-preview-id]:hover {
  outline: 2px solid #03a9f4 !important;
  outline-offset: 1px !important;
}
"""
    if soup.head is not None:
        soup.head.append(overlay_style)
    else:
        soup.insert(0, overlay_style)

    return str(soup), elements
