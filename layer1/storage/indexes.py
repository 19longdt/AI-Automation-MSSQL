"""
indexes.py — Khởi tạo MongoDB indexes và TTL settings khi service startup.

Gọi 1 lần sau khi MongoConnection.initialize() thành công.
create_index() với existing index là idempotent — safe để gọi mỗi lần restart.

TTL index phải khớp với plan:
  raw_metrics:     30 ngày
  findings:        90 ngày
  ai_analysis:     90 ngày
  dedup_cache:      7 ngày
  job_executions:  30 ngày
  cluster_leader:  30 giây (failover window)
"""
from __future__ import annotations

import logging

from pymongo.database import Database

logger = logging.getLogger(__name__)

# TTL values (giây) — phải khớp với plan document
TTL_RAW_METRICS_DAYS = 30
TTL_FINDINGS_DAYS = 90
TTL_AI_ANALYSIS_DAYS = 90
TTL_DEDUP_CACHE_DAYS = 7
TTL_JOB_EXECUTIONS_DAYS = 30
TTL_CLUSTER_LEADER_SEC = 30


def create_all_indexes(db: Database) -> None:
    """
    Tạo tất cả indexes và TTL cho mọi collection.
    Idempotent — safe để gọi mỗi lần restart.
    """
    ...


def _create_raw_metrics_indexes(db: Database) -> None: ...
def _create_findings_indexes(db: Database) -> None: ...
def _create_baselines_indexes(db: Database) -> None: ...
def _create_dedup_cache_indexes(db: Database) -> None: ...
def _create_approval_queue_indexes(db: Database) -> None: ...
def _create_cluster_leader_indexes(db: Database) -> None: ...
def _create_job_executions_indexes(db: Database) -> None: ...
