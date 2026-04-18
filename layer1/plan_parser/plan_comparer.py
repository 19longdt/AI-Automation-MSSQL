"""
plan_comparer.py — So sánh 2 execution plan XML để detect regression.

Dùng cho check 1.1.2 Plan Regression: plan mới vs plan cũ của cùng query.
So sánh theo:
  1. Top-level operator type (Hash Match vs Nested Loops vs Merge Join)
  2. Index access method (Seek vs Scan vs Key Lookup)
  3. Estimated rows vs actual rows gap (cardinality estimation error)
  4. Partition count accessed
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .plan_parser import PlanParser

logger = logging.getLogger(__name__)


@dataclass
class PlanDiff:
    """Kết quả so sánh 2 plans."""

    has_regression: bool
    old_dominant_operator: str
    new_dominant_operator: str
    operator_changed: bool
    seek_to_scan_regression: bool     # Seek → Scan là regression nghiêm trọng
    partition_access_increased: bool
    diff_summary: str                 # Human-readable để gửi cho AI


class PlanComparer:

    def compare(self, old_plan_xml: str, new_plan_xml: str) -> PlanDiff:
        """So sánh old vs new plan, trả về PlanDiff với regression analysis."""
        ...

    def _extract_access_patterns(self, parser: PlanParser) -> dict[str, int]:
        """Đếm số lần xuất hiện của mỗi PhysicalOp trong plan."""
        ...
