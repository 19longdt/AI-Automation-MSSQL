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

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.operations import IndexModel

logger = logging.getLogger(__name__)

# TTL values (giây)
TTL_RAW_METRICS_SEC = 30 * 24 * 3600
TTL_FINDINGS_SEC = 90 * 24 * 3600
TTL_AI_ANALYSIS_SEC = 90 * 24 * 3600
TTL_DEDUP_CACHE_SEC = 7 * 24 * 3600
TTL_JOB_EXECUTIONS_SEC = 30 * 24 * 3600

# Giữ alias ngày để backward compat với các module khác import constants này
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
    _create_raw_metrics_indexes(db)
    _create_findings_indexes(db)
    _create_baselines_indexes(db)
    _create_dedup_cache_indexes(db)
    _create_job_executions_indexes(db)
    _create_monitor_topics_indexes(db)
    _create_node_roles_indexes(db)
    logger.info("MongoDB indexes created/verified for all collections.")


def _create_raw_metrics_indexes(db: Database) -> None:
    """(topic_id, query_id, collected_at), (node, collected_at), TTL on collected_at."""
    col = db["raw_metrics"]
    col.create_indexes([
        IndexModel(
            [("topic_id", ASCENDING), ("query_id", ASCENDING), ("collected_at", DESCENDING)],
            name="topic_query_time",
        ),
        IndexModel(
            [("node", ASCENDING), ("collected_at", DESCENDING)],
            name="node_time",
        ),
        IndexModel(
            [("collected_at", ASCENDING)],
            expireAfterSeconds=TTL_RAW_METRICS_SEC,
            name="ttl_collected_at",
        ),
    ])


def _create_findings_indexes(db: Database) -> None:
    """(issue_type, detected_at), (topic_id, detected_at), (status, severity), TTL on detected_at."""
    col = db["findings"]
    col.create_indexes([
        IndexModel(
            [("issue_type", ASCENDING), ("detected_at", DESCENDING)],
            name="issue_type_time",
        ),
        IndexModel(
            [("topic_id", ASCENDING), ("detected_at", DESCENDING)],
            name="topic_time",
        ),
        IndexModel(
            [("status", ASCENDING), ("severity", ASCENDING)],
            name="status_severity",
        ),
        IndexModel(
            [("query_hash", ASCENDING), ("detected_at", DESCENDING)],
            name="query_hash_time",
            sparse=True,
        ),
        IndexModel(
            [("finding_hash", ASCENDING), ("detected_at", DESCENDING)],
            name="finding_hash_time",
            sparse=True,
        ),
        IndexModel(
            [("alert_status", ASCENDING), ("detected_at", DESCENDING)],
            name="alert_status_time",
        ),
        IndexModel(
            [("detected_at", ASCENDING)],
            expireAfterSeconds=TTL_FINDINGS_SEC,
            name="ttl_detected_at",
        ),
    ])


def _create_baselines_indexes(db: Database) -> None:
    """(metric_type, day_of_week, hour, node) — unique compound."""
    col = db["baselines"]
    col.create_indexes([
        IndexModel(
            [
                ("metric_type", ASCENDING),
                ("day_of_week", ASCENDING),
                ("hour", ASCENDING),
                ("node", ASCENDING),
                ("query_hash", ASCENDING),
            ],
            unique=True,
            # query_hash là optional — dùng sparse để cho phép null
            sparse=True,
            name="baseline_key",
        ),
    ])


def _create_dedup_cache_indexes(db: Database) -> None:
    """unique (finding_hash), TTL on last_alerted_at."""
    col = db["dedup_cache"]
    col.create_indexes([
        IndexModel(
            [("finding_hash", ASCENDING)],
            unique=True,
            name="unique_finding_hash",
        ),
        IndexModel(
            [("last_alerted_at", ASCENDING)],
            expireAfterSeconds=TTL_DEDUP_CACHE_SEC,
            name="ttl_last_alerted_at",
        ),
    ])


def _create_job_executions_indexes(db: Database) -> None:
    """(job_name, started_at DESC), (status, started_at), TTL on started_at."""
    col = db["job_executions"]
    col.create_indexes([
        IndexModel(
            [("job_name", ASCENDING), ("started_at", DESCENDING)],
            name="job_name_time",
        ),
        IndexModel(
            [("status", ASCENDING), ("started_at", ASCENDING)],
            name="status_time",
        ),
        IndexModel(
            [("started_at", ASCENDING)],
            expireAfterSeconds=TTL_JOB_EXECUTIONS_SEC,
            name="ttl_started_at",
        ),
    ])


def _create_monitor_topics_indexes(db: Database) -> None:
    """unique (topic_id), (enabled)."""
    col = db["monitor_topics"]
    col.create_indexes([
        IndexModel(
            [("topic_id", ASCENDING)],
            unique=True,
            name="unique_topic_id",
        ),
        IndexModel(
            [("enabled", ASCENDING)],
            name="enabled",
        ),
    ])


def _create_node_roles_indexes(db: Database) -> None:
    """unique (host)."""
    col = db["node_roles"]
    col.create_indexes([
        IndexModel(
            [("host", ASCENDING)],
            unique=True,
            name="unique_host",
        ),
    ])
