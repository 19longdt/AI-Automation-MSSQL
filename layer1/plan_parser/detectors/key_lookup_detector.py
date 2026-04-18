"""Phát hiện Key Lookup — tốn thêm 1 IO per row, dấu hiệu cần covering index."""
from __future__ import annotations

from typing import Any


def detect_key_lookups(operators: list[dict[str, Any]]) -> list[str]:
    """Trả về ['key_lookup'] nếu có PhysicalOp='Key Lookup'."""
    ...
