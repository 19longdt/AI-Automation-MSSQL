"""
plan_parser.py — Parse XML execution plan để extract operators và warnings.

MSSQL trả về plan XML từ sys.dm_exec_query_plan và Query Store.
lxml được dùng thay vì stdlib xml.etree vì:
  - XPath support đầy đủ (cần để query nested elements)
  - Performance tốt hơn với plan XML lớn (> 1MB)

Namespace của MSSQL execution plan XML:
  http://schemas.microsoft.com/sqlserver/2004/07/showplan
"""
from __future__ import annotations

import logging
from typing import Any

from lxml import etree

logger = logging.getLogger(__name__)

# MSSQL showplan XML namespace — cần dùng trong mọi XPath query
SHOWPLAN_NS = {"sp": "http://schemas.microsoft.com/sqlserver/2004/07/showplan"}


class PlanParser:
    """Parse 1 execution plan XML thành structured data."""

    def __init__(self, plan_xml: str) -> None:
        self._xml = plan_xml
        self._root: etree._Element | None = None

    def parse(self) -> dict[str, Any]:
        """
        Parse toàn bộ plan, trả về dict với:
          operators: list physical operators
          warnings: list warnings từ <Warnings> element
          estimated_rows: top-level EstimateRows
          partitions_accessed: list partition numbers accessed
        """
        ...

    def get_physical_operators(self) -> list[dict[str, Any]]:
        """Extract tất cả RelOp elements với PhysicalOp, EstimateRows, EstimatedCost."""
        ...

    def get_warnings(self) -> list[dict[str, str]]:
        """Extract <Warnings> element — implicit conversion, missing index hint, spill."""
        ...

    def get_partitions_accessed(self) -> list[int]:
        """
        Extract danh sách partition numbers từ <RuntimePartitionSummary>.
        Dùng để detect partition elimination failure — nếu = tổng partitions → full scan.
        """
        ...

    def _load(self) -> None:
        """Parse XML string thành lxml tree. Log WARNING nếu malformed."""
        ...
