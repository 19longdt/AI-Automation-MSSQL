"""Phát hiện Index Scan / Clustered Index Scan trên bảng lớn."""
from __future__ import annotations

from typing import Any


def detect_large_scans(operators: list[dict[str, Any]], min_estimated_rows: int = 10_000) -> list[str]:
    """
    Trả về list pattern names nếu phát hiện scan trên bảng lớn.
    min_estimated_rows: EstimateRows threshold — scan trên bảng nhỏ không đáng lo.
    """
    ...
