"""
config_repo.py — Repository cho collection `service_config`.

Lưu runtime-tunable thresholds trong MongoDB thay vì env vars.
Admin có thể update thresholds qua MongoDB shell hoặc UI mà không restart service.
"""
from __future__ import annotations

import logging
from typing import Any

from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "service_config"

# singleton_key dùng để enforce chỉ 1 config document
CONFIG_DOC_KEY = "layer1_config"


class ConfigRepo:

    @property
    def collection(self): ...

    def load(self) -> dict[str, Any] | None:
        """Đọc config document. Trả về None nếu chưa có (dùng defaults)."""
        ...

    def save(self, config_dict: dict[str, Any]) -> None:
        """Upsert config document — ghi đè toàn bộ."""
        ...

    def update_field(self, field_path: str, value: Any) -> None:
        """Update 1 field cụ thể, ví dụ: 'slow_query_threshold_pct' = 60."""
        ...
