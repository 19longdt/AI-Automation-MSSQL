"""
plan_detector.py — XML execution plan analysis.

Dùng cho: non-optimal index, plan regression, partition elimination failure.
Parse plan XML từ query results, detect patterns:
  - Index Scan / Clustered Index Scan trên bảng lớn
  - Key Lookup (cần covering index)
  - Hash Match thay vì Nested Loops
  - Implicit conversion (type mismatch → index bị bỏ qua)
  - Partition elimination failure (scan toàn bộ partitions)

lxml được dùng thay vì stdlib xml.etree vì XPath support và performance tốt hơn.
"""
from __future__ import annotations

import logging
from typing import Any

from lxml import etree

from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult
from ..models.findings import Finding

logger = logging.getLogger(__name__)

# MSSQL showplan XML namespace
SHOWPLAN_NS = {"sp": "http://schemas.microsoft.com/sqlserver/2004/07/showplan"}


class PlanDetector:

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        Parse plan XML từ query result rows.
        Mong đợi rows có field chứa XML plan (tên field configurable qua topic.extra).
        """
        ...

    def _analyze_plan(self, plan_xml: str, topic: MonitorTopic, node: str) -> list[str]:
        """Parse XML, trả về list pattern names phát hiện được."""
        ...

    def _detect_scans(self, root: etree._Element) -> list[str]: ...
    def _detect_key_lookups(self, root: etree._Element) -> list[str]: ...
    def _detect_implicit_conversions(self, root: etree._Element) -> list[str]: ...
    def _detect_partition_failure(self, root: etree._Element) -> list[str]: ...
