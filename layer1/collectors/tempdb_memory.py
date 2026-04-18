"""
tempdb_memory.py — Monitor TempDB usage và memory pressure (check 1.1.8).

Chạy trên Primary vì TempDB là shared resource của server, không per-node.
CDC + snapshot isolation tạo version store trong TempDB — đây là nguồn
TempDB spike phổ biến nhất trong hệ thống CDC-enabled.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class TempDbMemoryCollector(BaseCollector):

    METRIC_TEMPDB_USAGE = "tempdb_usage"
    METRIC_MEMORY_PRESSURE = "memory_pressure"

    def collect_node(self, node_host: str) -> list[RawMetric]: ...

    def _collect_tempdb(self, node_host: str) -> list[RawMetric]:
        """
        dm_db_file_space_usage: data file usage, version store pages, internal objects.
        Query Store: avg_tempdb_space_used để phát hiện queries gây spill to disk.
        """
        ...

    def _collect_memory(self, node_host: str) -> list[RawMetric]:
        """
        dm_os_performance_counters: PLE, memory grants pending, stolen pages.
        PLE < ple_warning_sec là dấu hiệu buffer pool pressure.
        """
        ...
