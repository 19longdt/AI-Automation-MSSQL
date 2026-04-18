"""
agent_jobs.py — Monitor SQL Agent jobs, backup status, DBCC (check 1.1.10).

Chạy trên Primary vì msdb là database của Primary. Secondary có msdb riêng
nhưng backup và SQL Agent jobs được điều phối từ Primary.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class AgentJobsCollector(BaseCollector):

    METRIC_JOB_STATUS = "sql_agent_job_status"
    METRIC_BACKUP_STATUS = "backup_status"
    METRIC_DBCC_STATUS = "dbcc_status"

    def collect_node(self, node_host: str) -> list[RawMetric]: ...

    def _collect_job_history(self, node_host: str) -> list[RawMetric]:
        """msdb.dbo.sysjobhistory: outcome, run_duration, consecutive_failures."""
        ...

    def _collect_backup_status(self, node_host: str) -> list[RawMetric]:
        """
        msdb.dbo.backupset: last backup date per database per type (FULL/LOG/DIFF).
        Bỏ qua databases có is_read_only=1 vì không cần backup.
        """
        ...

    def _collect_dbcc_status(self, node_host: str) -> list[RawMetric]:
        """
        Đọc last DBCC CHECKDB date từ DBCC DBINFO() hoặc sys.databases.
        DBCC DBINFO() cần quyền VIEW DATABASE STATE.
        """
        ...
