"""capture_tool_loader.py - Load and cache CaptureToolDef documents from MongoDB."""
from __future__ import annotations

import logging

from ..models.capture_tool import CaptureToolDef
from ..storage.mongo_client import MongoConnection

logger = logging.getLogger(__name__)


class CaptureToolLoader:
    """Process-wide in-memory cache for enabled capture tool definitions."""

    _tools: dict[str, CaptureToolDef] = {}

    @classmethod
    def load_all(cls) -> None:
        """Load all enabled tools once at startup; fail fast if seed data is missing."""
        docs = list(MongoConnection.get_db()["capture_tool_defs"].find({"enabled": True}))
        if not docs:
            raise RuntimeError(
                "capture_tool_defs collection is empty. "
                "Run: python -m layer1.seed.seed_capture_tools before starting the service."
            )

        # Drop Mongo _id and validate each document via Pydantic model.
        cls._tools = {
            doc["tool_id"]: CaptureToolDef(**{k: v for k, v in doc.items() if k != "_id"})
            for doc in docs
        }
        logger.info("CaptureToolLoader loaded %d enabled tools.", len(cls._tools))

    @classmethod
    def get(cls, tool_id: str) -> CaptureToolDef | None:
        """Get one tool definition by tool_id from in-memory cache."""
        return cls._tools.get(tool_id)

    @classmethod
    def get_all(cls) -> dict[str, CaptureToolDef]:
        """Return a shallow copy of the full tool-definition cache."""
        return dict(cls._tools)
