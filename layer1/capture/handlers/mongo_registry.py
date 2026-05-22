"""Registry for mongo diagnostic handlers."""
from __future__ import annotations

from . import mongo_get_analysis_history, mongo_get_recent_findings, mongo_get_table_context
from .types import MongoToolHandler


def get_handlers() -> dict[str, MongoToolHandler]:
    """Return mapping from mongo tool_id to handler function."""
    return {
        "get_table_context": mongo_get_table_context.run,
        "get_recent_findings": mongo_get_recent_findings.run,
        "get_analysis_history": mongo_get_analysis_history.run,
    }
