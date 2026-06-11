"""
indexes.py — MongoDB indexes cho maintenance DB (db_maintenance).

Gọi 1 lần sau khi MongoConnection.initialize() thành công,
trước khi khởi tạo các service.
"""
from __future__ import annotations

import logging

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.operations import IndexModel

from ..storage.indexes import (
    TTL_MAINT_BATCHES_SEC,
    TTL_MAINT_HISTORY_SEC,
    TTL_MAINT_QUEUE_TERMINAL_SEC,
    _ensure_ttl_index,
)

logger = logging.getLogger(__name__)


def create_maint_indexes(db: Database) -> None:
    """Tạo tất cả indexes cho maintenance DB. Idempotent — safe gọi mỗi restart."""
    _create_maintenance_policies_indexes(db)
    _create_maintenance_window_indexes(db)
    _create_maintenance_queue_indexes(db)
    _create_maintenance_batches_indexes(db)
    _create_maintenance_history_indexes(db)
    _create_maintenance_scan_queries_indexes(db)
    logger.info("Maintenance MongoDB indexes created/verified (db=%s).", db.name)


def _create_maintenance_policies_indexes(db: Database) -> None:
    col = db["maintenance_policies"]
    col.create_indexes([
        IndexModel([("policy_id", ASCENDING)], unique=True, name="unique_policy_id"),
        IndexModel([("scope", ASCENDING)], name="scope"),
        IndexModel(
            [("schema_name", ASCENDING), ("table_name", ASCENDING), ("index_name", ASCENDING)],
            name="object_lookup",
            sparse=True,
        ),
    ])


def _create_maintenance_window_indexes(db: Database) -> None:
    col = db["maintenance_window"]
    col.create_indexes([
        IndexModel([("window_id", ASCENDING)], unique=True, name="unique_window_id"),
    ])


def _create_maintenance_queue_indexes(db: Database) -> None:
    col = db["maintenance_queue"]
    col.create_indexes([
        IndexModel(
            [("status", ASCENDING), ("priority", DESCENDING), ("created_at", ASCENDING)],
            name="claim_order",
        ),
        IndexModel([("batch_id", ASCENDING)], name="batch_id"),
        IndexModel([("short_id", ASCENDING)], name="short_id"),
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
    col = db["maintenance_batches"]
    col.create_indexes([
        IndexModel([("batch_id", ASCENDING)], unique=True, name="unique_batch_id"),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_time"),
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_BATCHES_SEC)


def _create_maintenance_history_indexes(db: Database) -> None:
    col = db["maintenance_history"]
    col.create_indexes([
        IndexModel([("table_name", ASCENDING), ("created_at", DESCENDING)], name="table_time"),
        IndexModel([("action_type", ASCENDING), ("created_at", DESCENDING)], name="action_time"),
        IndexModel([("item_id", ASCENDING)], name="item_id"),
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_HISTORY_SEC)


def _create_maintenance_scan_queries_indexes(db: Database) -> None:
    col = db["maintenance_scan_queries"]
    col.create_indexes([
        IndexModel([("query_id", ASCENDING)], unique=True, name="unique_query_id"),
        IndexModel([("enabled", ASCENDING)], name="enabled"),
    ])
