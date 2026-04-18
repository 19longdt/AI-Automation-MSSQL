"""
threshold_checker.py — Generic threshold checks dùng chung cho nhiều detectors.

Các checks không cần baseline (point-in-time threshold):
  TempDB usage, PLE, AG sync lag, CDC job status, backup gap, DBCC age...
"""
from __future__ import annotations

import logging

from .base_detector import BaseDetector
from ..models.findings import Finding
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class ThresholdChecker(BaseDetector):
    """
    Xử lý tất cả metrics có threshold tĩnh (không cần baseline so sánh).
    1 class cho nhiều metric types để tránh proliferation của detector classes
    khi logic đều là "value > threshold → finding".
    """

    # Map metric_type → handler method
    _HANDLERS: dict[str, str] = {
        "tempdb_usage": "_check_tempdb",
        "memory_pressure": "_check_memory",
        "ag_sync_state": "_check_ag_sync",
        "cdc_job_status": "_check_cdc",
        "backup_status": "_check_backup",
        "dbcc_status": "_check_dbcc",
        "resource_pool_usage": "_check_resource_pool",
        "sql_agent_job_status": "_check_agent_jobs",
        "index_fragmentation": "_check_index_frag",
        "missing_index": "_check_missing_index",
    }

    def detect(self, metrics: list[RawMetric]) -> list[Finding]:
        """Dispatch mỗi metric tới handler tương ứng dựa trên metric_type."""
        ...

    def _check_tempdb(self, metric: RawMetric) -> Finding | None: ...
    def _check_memory(self, metric: RawMetric) -> Finding | None: ...
    def _check_ag_sync(self, metric: RawMetric) -> Finding | None: ...
    def _check_cdc(self, metric: RawMetric) -> Finding | None: ...
    def _check_backup(self, metric: RawMetric) -> Finding | None: ...
    def _check_dbcc(self, metric: RawMetric) -> Finding | None: ...
    def _check_resource_pool(self, metric: RawMetric) -> Finding | None: ...
    def _check_agent_jobs(self, metric: RawMetric) -> Finding | None: ...
    def _check_index_frag(self, metric: RawMetric) -> Finding | None: ...
    def _check_missing_index(self, metric: RawMetric) -> Finding | None: ...
