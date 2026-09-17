"""Behavioral tests for pure Web Data Assistant extraction and preview helpers."""

from __future__ import annotations

import importlib
from pathlib import Path
import sys
from types import ModuleType
import unittest

from bs4 import BeautifulSoup


REPO_ROOT = Path(__file__).resolve().parents[1]
COMPONENT_ROOT = REPO_ROOT / "custom_components" / "web_data_assistant"


def _install_package_stub() -> None:
    """Load helper modules without importing the Home Assistant integration package."""
    custom_components = sys.modules.setdefault(
        "custom_components", ModuleType("custom_components")
    )
    custom_components.__path__ = [str(REPO_ROOT / "custom_components")]

    package = ModuleType("custom_components.web_data_assistant")
    package.__path__ = [str(COMPONENT_ROOT)]
    sys.modules["custom_components.web_data_assistant"] = package


_install_package_stub()
const = importlib.import_module("custom_components.web_data_assistant.const")
models = importlib.import_module("custom_components.web_data_assistant.models")
extraction = importlib.import_module("custom_components.web_data_assistant.extraction")
preview = importlib.import_module("custom_components.web_data_assistant.preview")


class JsonExtractionTests(unittest.TestCase):
    """Cover discovery and RFC 6901 pointer behavior."""

    def test_pointer_round_trip_handles_reserved_characters(self) -> None:
        data = {"a/b": {"x~y": [1, True]}}

        candidates, truncated = extraction.discover_json_candidates(data)

        self.assertFalse(truncated)
        self.assertEqual(
            [candidate.path for candidate in candidates],
            ["/a~1b/x~0y/0", "/a~1b/x~0y/1"],
        )
        self.assertEqual(
            extraction.resolve_json_pointer(data, "/a~1b/x~0y/0"), 1
        )
        self.assertIs(
            extraction.resolve_json_pointer(data, "/a~1b/x~0y/1"), True
        )

    def test_discovery_reports_truncation(self) -> None:
        data = list(range(const.MAX_JSON_DISCOVERY_VALUES + 1))

        candidates, truncated = extraction.discover_json_candidates(data)

        self.assertTrue(truncated)
        self.assertEqual(len(candidates), const.MAX_JSON_DISCOVERY_VALUES)
        self.assertEqual(candidates[-1].path, f"/{const.MAX_JSON_DISCOVERY_VALUES - 1}")


class HtmlExtractionTests(unittest.TestCase):
    """Cover visible-text matching and shared-document extraction."""

    def test_search_ignores_non_visible_document_content(self) -> None:
        html = """
        <html>
          <head><style>.x { content: 'Needle'; }</style></head>
          <body>
            <script>const hidden = 'Needle';</script>
            <template><span>Needle</span></template>
            <noscript>Needle</noscript>
            <p id="wanted">Needle</p>
          </body>
        </html>
        """

        matches = extraction.find_html_text_matches(html, "Needle")

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].selector, "#wanted")
        self.assertEqual(matches[0].text, "Needle")

    def test_extract_html_entities_keeps_valid_siblings(self) -> None:
        html = '<div class="reading">12</div><div class="reading">34</div>'
        entities = [
            models.WebDataEntityConfig(
                key="first", name="First", selector="div.reading", index=0
            ),
            models.WebDataEntityConfig(
                key="second", name="Second", selector="div.reading", index=1
            ),
            models.WebDataEntityConfig(
                key="missing", name="Missing", selector=".does-not-exist"
            ),
        ]

        result = extraction.extract_html_entities(html, entities)

        self.assertEqual(result.values, {"first": "12", "second": "34"})
        self.assertIn("missing", result.extraction_errors)


class PreviewTests(unittest.TestCase):
    """Cover preview sanitization and generated selector fidelity."""

    def test_preview_strips_active_content_and_url_secrets(self) -> None:
        html = """
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=https://evil.example/">
            <link rel="stylesheet" href="/site.css">
          </head>
          <body>
            <script>alert('bad')</script>
            <iframe src="https://evil.example/"></iframe>
            <form action="https://evil.example/"><input value="secret"></form>
            <a href="https://evil.example/" target="_blank">Go</a>
            <img id="photo" src="/image.png" onerror="alert(1)">
            <p class="reading">42</p>
          </body>
        </html>
        """

        rendered, elements = preview.build_html_preview(
            html,
            "https://user:pass@example.com/path/page?token=secret#fragment",
        )
        soup = BeautifulSoup(rendered, "html.parser")

        self.assertNotIn("user:pass", rendered)
        self.assertNotIn("token=secret", rendered)
        self.assertIsNone(soup.find("script"))
        self.assertIsNone(soup.find("iframe"))
        self.assertIsNone(soup.find("form"))
        self.assertIsNone(soup.find("meta", attrs={"http-equiv": "refresh"}))

        link = soup.find("a")
        self.assertIsNotNone(link)
        self.assertNotIn("href", link.attrs)
        self.assertNotIn("target", link.attrs)

        image = soup.find("img", id="photo")
        self.assertIsNotNone(image)
        self.assertEqual(image["src"], "https://example.com/image.png")
        self.assertEqual(image["referrerpolicy"], "no-referrer")
        self.assertNotIn("onerror", image.attrs)

        stylesheet = soup.find("link", rel=lambda value: value and "stylesheet" in value)
        self.assertIsNotNone(stylesheet)
        self.assertEqual(
            stylesheet["href"], "https://example.com/site.css"
        )
        self.assertEqual(stylesheet["referrerpolicy"], "no-referrer")

        base = soup.find("base")
        self.assertIsNotNone(base)
        self.assertEqual(base["href"], "https://example.com/path/page")

        self.assertTrue(elements)
        for preview_id, metadata in elements.items():
            selected = soup.select(metadata.selector)
            self.assertLess(metadata.index, len(selected))
            self.assertEqual(
                selected[metadata.index].get("data-wda-preview-id"), preview_id
            )


if __name__ == "__main__":
    unittest.main()
