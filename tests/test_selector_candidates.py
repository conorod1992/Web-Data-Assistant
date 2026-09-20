"""Mutation regressions for generated scrape selectors (no Home Assistant needed)."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "custom_components/web_data_assistant/selector_candidates.py"
spec = importlib.util.spec_from_file_location("wda_selector_candidates", MODULE)
selectors = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = selectors
spec.loader.exec_module(selectors)


class SelectorTests(unittest.TestCase):
    def recommend(self, markup, target_selector):
        soup = BeautifulSoup(markup, "html.parser")
        target = soup.select_one(target_selector)
        choices = selectors.selector_candidates(soup, target)
        self.assertLessEqual(len(choices), 5)
        self.assertEqual(len({(c.selector, c.index) for c in choices}), len(choices))
        for candidate in choices:
            found = soup.select(candidate.selector)
            self.assertIs(found[candidate.index], target)
            self.assertEqual(candidate.match_count, len(found))
        return choices

    def test_stable_ancestor_survives_unrelated_link_insertion_and_new_value(self):
        before = '<nav><a>Nav</a></nav><section id="weather"><div><a>14°C</a></div></section>'
        choice = self.recommend(before, "#weather a")[0]
        self.assertEqual(choice.index, 0)
        self.assertNotEqual(choice.selector, "a")
        after = '<nav><a>New</a><a>Nav</a></nav><section id="weather"><div><div><a>19°C</a></div></div></section>'
        self.assertEqual(BeautifulSoup(after, "html.parser").select(choice.selector)[choice.index].text, "19°C")

    def test_attribute_identity_survives_card_reordering(self):
        before = '<section data-testid="carlow"><span itemprop="temperature">14</span></section><section data-testid="cork"><span itemprop="temperature">14</span></section>'
        choice = self.recommend(before, '[data-testid="carlow"] span')[0]
        after = '<section data-testid="cork"><span itemprop="temperature">18</span></section><section data-testid="carlow"><span itemprop="temperature">12</span></section>'
        self.assertEqual(BeautifulSoup(after, "html.parser").select(choice.selector)[choice.index].text, "12")

    def test_identical_tags_use_identity_not_markup_equality(self):
        soup = BeautifulSoup("<a>Same</a><a>Same</a><a>Same</a>", "html.parser")
        for index, target in enumerate(soup.find_all("a")):
            choices = selectors.selector_candidates(soup, target)
            self.assertEqual(choices[0].index, index)
            self.assertEqual(choices[0].stability, "fragile")
            self.assertIs(soup.select(choices[0].selector)[choices[0].index], target)

    def test_ids_and_classes_are_css_escaped(self):
        self.assertEqual(self.recommend('<span id="reading:temp">42</span>', '[id="reading:temp"]')[0].selector, r"#reading\:temp")
        self.recommend('<span class="reading:temp °unit">42</span>', "span")

    def test_duplicate_ids_are_not_treated_as_unique(self):
        soup = BeautifulSoup('<section id="dup"><a>Same</a></section><section id="dup"><a>Same</a></section>', "html.parser")
        choice = selectors.selector_candidates(soup, soup.find_all("a")[1])[0]
        self.assertIs(soup.select(choice.selector)[choice.index], soup.find_all("a")[1])
        self.assertNotEqual(choice.stability, "strong")

    def test_generated_ids_state_classes_and_value_attributes_are_not_anchors(self):
        markup = '<section id="weather"><a id="react-ab1234ff" class="css-a82ddffe active" aria-label="14°C" href="/secret?token=ABC">14°C</a></section>'
        choices = self.recommend(markup, "a")
        for choice in choices:
            self.assertNotIn("react-", choice.selector)
            self.assertNotIn("css-", choice.selector)
            self.assertNotIn("active", choice.selector)
            self.assertNotIn("14", choice.selector)
            self.assertNotIn("href", choice.selector)
            self.assertNotIn("ABC", choice.selector)

    def test_class_combinations_can_disambiguate(self):
        choices = self.recommend('<span class="reading temperature">14</span><span class="reading humidity">80</span><div class="temperature">15</div>', "span.temperature")
        self.assertEqual(choices[0].match_count, 1)
        self.assertNotEqual(choices[0].stability, "fragile")

    def test_local_position_is_honestly_rated(self):
        soup = BeautifulSoup('<section id="weather"><a>One</a><a>Two</a></section>', "html.parser")
        choice = selectors.selector_candidates(soup, soup.find_all("a")[1])[0]
        self.assertIn("#weather", choice.selector)
        self.assertIn(":nth-of-type(2)", choice.selector)
        self.assertEqual(choice.stability, "moderate")

    def test_reordered_identical_markup_all_candidates_reselect_exact_node(self):
        soup = BeautifulSoup('<section id="current"><a class="link">Same</a><a class="link">Same</a></section>', "html.parser")
        target = soup.find_all("a")[1]
        for candidate in selectors.selector_candidates(soup, target):
            self.assertIs(soup.select(candidate.selector)[candidate.index], target)

    def test_output_is_deterministic_and_does_not_modify_document(self):
        soup = BeautifulSoup('<section id="current"><a class="reading temperature">14</a></section>', "html.parser")
        before = str(soup)
        choices = selectors.selector_candidates(soup, soup.a)
        self.assertEqual(choices, selectors.selector_candidates(soup, soup.a))
        self.assertEqual(str(soup), before)
        self.assertNotIn("score", choices[0].as_dict())

    def test_attribute_quotes_and_backslashes_round_trip(self):
        self.recommend('<span data-testid=\'a"b\\c\'>42</span>', "span")

    def test_limits_pathological_class_lists(self):
        markup = '<section id="current"><a class="' + " ".join(f"class-{i}" for i in range(100)) + '">14</a></section>'
        self.recommend(markup, "a")


if __name__ == "__main__":
    unittest.main()
