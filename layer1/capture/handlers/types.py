"""Shared handler types for diagnostic capture modules."""
from __future__ import annotations

from typing import Any, Callable

from ...models.findings import Finding

StaticToolResult = tuple[dict[str, Any], list[str]]
StaticToolHandler = Callable[[Finding], StaticToolResult]
MongoToolHandler = Callable[[Finding, list[str]], dict[str, Any]]
