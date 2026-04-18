"""
ag_health.py — Monitor AG sync state và CDC jobs (check 1.2).

Chạy trên Primary vì sys.dm_hadr_database_replica_states chứa info
của tất cả replicas khi query từ Primary.
CDC jobs cũng chạy trên Primary.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class AgHealthCollector(BaseCollector):

    METRIC_AG_SYNC = "ag_sync_state"
    METRIC_CDC_JOBS = "cdc_job_status"

    def collect_node(self, node_host: str) -> list[RawMetric]: ...

    def _collect_ag_sync(self, node_host: str) -> list[RawMetric]:
        """
        dm_hadr_database_replica_states: log_send_queue_size, redo_queue_size,
        synchronization_state_desc per replica.
        """
        ...

    def _collect_cdc_jobs(self, node_host: str) -> list[RawMetric]:
        """
        msdb.dbo.sysjobs WHERE name LIKE 'cdc.%': last_run_outcome, last_run_date.
        CDC capture job failure là CRITICAL — data loss risk.
        """
        ...
