"""
Phát hiện implicit type conversion warning trong execution plan.
Implicit conversion khiến index không dùng được vì SQL Server phải
convert column values để compare — dẫn đến Index Scan thay vì Seek.
"""
from __future__ import annotations

from typing import Any


def detect_implicit_conversions(warnings: list[dict[str, str]]) -> list[str]:
    """
    Scan <Warnings> elements, tìm PlanAffectingConvert hoặc NoJoinPredicate.
    Trả về list mô tả conversion (column name + from/to type) để AI suggest fix.
    """
    ...
