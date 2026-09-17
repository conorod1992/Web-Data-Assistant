"""Data models used by Web Data Assistant."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .const import (
    CONF_ATTRIBUTE,
    CONF_DEVICE_CLASS,
    CONF_INDEX,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_STATE_CLASS,
    CONF_UNIT,
    CONF_VALUE_TYPE,
    VALUE_TEXT,
)


@dataclass(slots=True)
class WebDataEntityConfig:
    """Configuration for one entity extracted from a source."""

    key: str
    name: str
    path: str | None = None
    selector: str | None = None
    index: int = 0
    attribute: str | None = None
    unit: str | None = None
    device_class: str | None = None
    state_class: str | None = None
    value_type: str = VALUE_TEXT

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WebDataEntityConfig":
        """Create an entity config from stored config-entry data."""
        return cls(
            key=str(data["key"]),
            name=str(data["name"]),
            path=data.get(CONF_PATH),
            selector=data.get(CONF_SELECTOR),
            index=int(data.get(CONF_INDEX, 0)),
            attribute=data.get(CONF_ATTRIBUTE),
            unit=data.get(CONF_UNIT),
            device_class=data.get(CONF_DEVICE_CLASS),
            state_class=data.get(CONF_STATE_CLASS),
            value_type=data.get(CONF_VALUE_TYPE, VALUE_TEXT),
        )

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable representation for config-entry storage."""
        data: dict[str, Any] = {
            "key": self.key,
            "name": self.name,
            CONF_VALUE_TYPE: self.value_type,
        }
        if self.path is not None:
            data[CONF_PATH] = self.path
        if self.selector is not None:
            data[CONF_SELECTOR] = self.selector
            data[CONF_INDEX] = self.index
        if self.attribute:
            data[CONF_ATTRIBUTE] = self.attribute
        if self.unit:
            data[CONF_UNIT] = self.unit
        if self.device_class:
            data[CONF_DEVICE_CLASS] = self.device_class
        if self.state_class:
            data[CONF_STATE_CLASS] = self.state_class
        return data


@dataclass(slots=True)
class FetchResponse:
    """HTTP response captured from a configured source."""

    status: int
    content_type: str
    text: str
    json_data: Any | None = None


@dataclass(slots=True)
class ExtractionResult:
    """Result of extracting all configured entities from one source refresh."""

    values: dict[str, Any] = field(default_factory=dict)
    extraction_errors: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class JsonCandidate:
    """One selectable scalar value discovered in a JSON document."""

    path: str
    value: Any
    display_path: str
    preview: str


@dataclass(slots=True)
class HtmlMatch:
    """One HTML element matching text entered by the user."""

    selector: str
    index: int
    text: str
    context: str
    tag: str
