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


def _safe_resource_url(base_url: str, value: str) -> str | None:
    """Resolve a preview resource URL while excluding active schemes."""
    resolved = urljoin(base_url, value)
    scheme = urlparse(resolved).scheme.casefold()
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


def build_html_preview(
    html: str,
    source_url: str,
) -> tuple[str, dict[str, PreviewElement]]:
    """Build sanitised markup plus click-to-extraction metadata.

    Active page content is removed and the result is intended for a sandboxed
    srcdoc iframe controlled by the Web Data Assistant frontend.
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
        if str(meta.get("http-equiv", "")).casefold() in {"refresh", "content-security-policy"}:
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
            resolved = _safe_resource_url(source_url, value)
            if resolved is None:
                del tag.attrs[attribute]
            else:
                tag[attribute] = resolved

    head = _ensure_head(soup)

    base = soup.new_tag("base", href=source_url)
    head.insert(0, base)

    csp = soup.new_tag("meta")
    csp["http-equiv"] = "Content-Security-Policy"
    csp["content"] = _PREVIEW_CSP
    head.insert(1, csp)

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
