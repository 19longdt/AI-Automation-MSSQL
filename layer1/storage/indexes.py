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
TTL_RAW_METRICS_SEC = 1 * 24 * 3600
TTL_FINDINGS_SEC = 7 * 24 * 3600
TTL_FINDING_DIAGNOSTICS_SEC = 7 * 24 * 3600
TTL_AI_ANALYSIS_SEC = 7 * 24 * 3600
TTL_DEDUP_CACHE_SEC = 1 * 24 * 3600
TTL_JOB_EXECUTIONS_SEC = 1 * 24 * 3600

# Maintenance module — queue/batch TTL ngắn (chỉ dọn item terminal),
# history TTL DÀI vì là AI context cho Layer 2 ("lần rebuild trước có giúp không?")
TTL_MAINT_QUEUE_TERMINAL_SEC = 14 * 24 * 3600
TTL_MAINT_BATCHES_SEC = 14 * 24 * 3600
TTL_MAINT_HISTORY_SEC = 90 * 24 * 3600

# Giữ alias ngày để backward compat với các module khác import constants này
TTL_RAW_METRICS_DAYS = 1
TTL_FINDINGS_DAYS = 7
TTL_AI_ANALYSIS_DAYS = 7
TTL_DEDUP_CACHE_DAYS = 1
TTL_JOB_EXECUTIONS_DAYS = 1


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
    _create_finding_diagnostics_indexes(db)
    _create_capture_tool_defs_indexes(db)
    _create_maintenance_policies_indexes(db)
    _create_maintenance_window_indexes(db)
    _create_maintenance_queue_indexes(db)
    _create_maintenance_batches_indexes(db)
    _create_maintenance_history_indexes(db)
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
    ])
    _ensure_ttl_index(col, [("collected_at", ASCENDING)], "ttl_collected_at", TTL_RAW_METRICS_SEC)


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
    ])
    _ensure_ttl_index(col, [("detected_at", ASCENDING)], "ttl_detected_at", TTL_FINDINGS_SEC)


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
    ])
    _ensure_ttl_index(col, [("last_alerted_at", ASCENDING)], "ttl_last_alerted_at", TTL_DEDUP_CACHE_SEC)


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
    ])
    _ensure_ttl_index(col, [("started_at", ASCENDING)], "ttl_started_at", TTL_JOB_EXECUTIONS_SEC)


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


def _create_finding_diagnostics_indexes(db: Database) -> None:
    """unique (finding_id), (topic_id, captured_at DESC), TTL on captured_at."""
    col = db["finding_diagnostics"]
    col.create_indexes([
        # 1 finding chi co 1 snapshot diagnostic duy nhat.
        IndexModel(
            [("finding_id", ASCENDING)],
            unique=True,
            name="unique_finding_id",
        ),
        # Truy van lich su snapshot theo topic va thoi gian moi nhat.
        IndexModel(
            [("topic_id", ASCENDING), ("captured_at", DESCENDING)],
            name="topic_captured_time",
        ),
        # Tu dong xoa snapshot qua han de giam dung luong.
    ])
    _ensure_ttl_index(col, [("captured_at", ASCENDING)], "ttl_captured_at", TTL_FINDING_DIAGNOSTICS_SEC)


def _create_capture_tool_defs_indexes(db: Database) -> None:
    """unique (tool_id), (enabled), (phase)."""
    col = db["capture_tool_defs"]
    col.create_indexes([
        # Dinh danh duy nhat cho moi tool definition.
        IndexModel(
            [("tool_id", ASCENDING)],
            unique=True,
            name="unique_tool_id",
        ),
        # Ho tro load nhanh danh sach tool dang bat.
        IndexModel(
            [("enabled", ASCENDING)],
            name="enabled",
        ),
        # Ho tro filter/sort theo phase khi debug/quan sat.
        IndexModel(
            [("phase", ASCENDING)],
            name="phase",
        ),
    ])


def _create_maintenance_policies_indexes(db: Database) -> None:
    """unique (policy_id), (scope), object lookup."""
    col = db["maintenance_policies"]
    col.create_indexes([
        IndexModel(
            [("policy_id", ASCENDING)],
            unique=True,
            name="unique_policy_id",
        ),
        IndexModel(
            [("scope", ASCENDING)],
            name="scope",
        ),
        # Lookup override theo object khi resolve policy
        IndexModel(
            [("schema_name", ASCENDING), ("table_name", ASCENDING), ("index_name", ASCENDING)],
            name="object_lookup",
            sparse=True,
        ),
    ])


def _create_maintenance_window_indexes(db: Database) -> None:
    """unique (window_id) — collection 1 document."""
    col = db["maintenance_window"]
    col.create_indexes([
        IndexModel(
            [("window_id", ASCENDING)],
            unique=True,
            name="unique_window_id",
        ),
    ])


def _create_maintenance_queue_indexes(db: Database) -> None:
    """Claim ordering, batch lookup, dedupe lookup, TTL CHỈ trên terminal_at.

    Item active không có terminal_at → không bị TTL xoá (multi-day backlog).
    """
    col = db["maintenance_queue"]
    col.create_indexes([
        IndexModel(
            [("status", ASCENDING), ("priority", DESCENDING), ("created_at", ASCENDING)],
            name="claim_order",
        ),
        IndexModel(
            [("batch_id", ASCENDING)],
            name="batch_id",
        ),
        IndexModel(
            [("short_id", ASCENDING)],
            name="short_id",
        ),
        # Dedupe: tìm item open trùng object khi scan
        IndexModel(
            [
                ("schema_name", ASCENDING),
                ("table_name", ASCENDING),
                ("index_name", ASCENDING),
                ("partition_number", ASCENDING),
                ("status", ASCENDING),
            ],
            name="dedupe_lookup",
        ),
    ])
    _ensure_ttl_index(col, [("terminal_at", ASCENDING)], "ttl_terminal_at", TTL_MAINT_QUEUE_TERMINAL_SEC)


def _create_maintenance_batches_indexes(db: Database) -> None:
    """unique (batch_id), (status, created_at), TTL on created_at."""
    col = db["maintenance_batches"]
    col.create_indexes([
        IndexModel(
            [("batch_id", ASCENDING)],
            unique=True,
            name="unique_batch_id",
        ),
        IndexModel(
            [("status", ASCENDING), ("created_at", DESCENDING)],
            name="status_time",
        ),
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_BATCHES_SEC)


def _create_maintenance_history_indexes(db: Database) -> None:
    """Lookup theo table/action/item, TTL DÀI 90d (AI context Layer 2)."""
    col = db["maintenance_history"]
    col.create_indexes([
        IndexModel(
            [("table_name", ASCENDING), ("created_at", DESCENDING)],
            name="table_time",
        ),
        IndexModel(
            [("action_type", ASCENDING), ("created_at", DESCENDING)],
            name="action_time",
        ),
        IndexModel(
            [("item_id", ASCENDING)],
            name="item_id",
        ),
        # Sort theo created_at dùng luôn TTL index bên dưới — không tạo index trùng key.
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_HISTORY_SEC)


def _ensure_ttl_index(col, keys, name: str, ttl_seconds: int) -> None:
    """
    Ensure TTL index exists with exact options.
    If same name exists with different key/options, drop and recreate.
    """
    existing = None
    for idx in col.list_indexes():
        if idx.get("name") == name:
            existing = idx
            break

    expected_key = dict(keys)
    recreate = False
    if existing is None:
        recreate = True
    else:
        existing_ttl = int(existing.get("expireAfterSeconds", -1))
        existing_key = dict(existing.get("key", {}))
        if existing_ttl != ttl_seconds or existing_key != expected_key:
            logger.info(
                "TTL index '%s' on collection '%s' changed (old_ttl=%s, new_ttl=%s). Recreating.",
                name,
                col.name,
                existing.get("expireAfterSeconds"),
                ttl_seconds,
            )
            col.drop_index(name)
            recreate = True

    if recreate:
        col.create_index(keys, name=name, expireAfterSeconds=ttl_seconds)
