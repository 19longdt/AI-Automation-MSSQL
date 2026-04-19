"""
indexes.py — Khởi tạo MongoDB indexes và TTL settings khi service startup.

Gọi 1 lần sau khi MongoConnection.initialize() thành công.
create_index() với existing index là idempotent — safe để gọi mỗi lần restart.

Collections:
  raw_metrics:      30 ngày TTL — số liệu thô từ query execution
  findings:         90 ngày TTL — issues phát hiện bởi detectors
  ai_analysis:      90 ngày TTL — response từ Layer 2 Claude API
  baselines:        không TTL   — day-of-week baseline data
  dedup_cache:       7 ngày TTL — chống spam alert
  job_executions:   30 ngày TTL — job run history
  monitor_topics:   không TTL   — topic config (source of truth)
  node_roles:       không TTL   — cached AG node roles
"""
from __future__ import annotations

import logging

from pymongo.database import Database

logger = logging.getLogger(__name__)

# TTL values (giây)
TTL_RAW_METRICS_DAYS = 30
TTL_FINDINGS_DAYS = 90
TTL_AI_ANALYSIS_DAYS = 90
TTL_DEDUP_CACHE_DAYS = 7
TTL_JOB_EXECUTIONS_DAYS = 30


def create_all_indexes(db: Database) -> None:
    """
    Tạo tất cả indexes và TTL cho mọi collection.
    Idempotent — safe để gọi mỗi lần restart.
    """
    ...


def _create_raw_metrics_indexes(db: Database) -> None:
    """(topic_id, query_id, collected_at), (node, collected_at), TTL on collected_at."""
    ...

def _create_findings_indexes(db: Database) -> None:
    """(issue_type, detected_at), (topic_id, detected_at), (status, severity), TTL on detected_at."""
    ...

def _create_baselines_indexes(db: Database) -> None:
    """(metric_type, day_of_week, hour, node) — unique compound."""
    ...

def _create_dedup_cache_indexes(db: Database) -> None:
    """unique (finding_hash), TTL on last_alerted_at."""
    ...

def _create_job_executions_indexes(db: Database) -> None:
    """(job_name, started_at DESC), (status, started_at), TTL on started_at."""
    ...

def _create_monitor_topics_indexes(db: Database) -> None:
    """unique (topic_id), (enabled)."""
    ...

def _create_node_roles_indexes(db: Database) -> None:
    """unique (host)."""
    ...
