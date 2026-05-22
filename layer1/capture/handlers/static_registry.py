"""Registry for static diagnostic handlers."""
from __future__ import annotations

from . import static_get_plan_analysis, static_get_query_structure
from .types import StaticToolHandler


def get_handlers() -> dict[str, StaticToolHandler]:
    """Return mapping from static tool_id to its dedicated handler function."""
    return {
        "get_plan_analysis": static_get_plan_analysis.run,
        "get_query_structure": static_get_query_structure.run,
    }
