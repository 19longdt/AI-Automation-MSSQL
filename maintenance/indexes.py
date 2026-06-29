"""
MongoDB indexes for the standalone maintenance database.
"""
from __future__ import annotations

import logging

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.operations import IndexModel

logger = logging.getLogger(__name__)

TTL_MAINT_QUEUE_TERMINAL_SEC = 14 * 24 * 3600
TTL_MAINT_BATCHES_SEC = 14 * 24 * 3600
TTL_MAINT_HISTORY_SEC = 90 * 24 * 3600
TTL_MAINT_COMMANDS_SEC = 24 * 3600


def _ensure_ttl_index(col, keys, name: str, ttl_seconds: int) -> None:
    existing = next((idx for idx in col.list_indexes() if idx.get("name") == name), None)
    if existing:
        existing_keys = list(existing.get("key", {}).items())
        existing_ttl = existing.get("expireAfterSeconds")
        if existing_keys == keys and existing_ttl == ttl_seconds:
            return
        col.drop_index(name)
    col.create_index(keys, name=name, expireAfterSeconds=ttl_seconds)


def _drop_index_if_exists(col, name: str) -> None:
    existing = next((idx for idx in col.list_indexes() if idx.get("name") == name), None)
    if existing:
        col.drop_index(name)


def create_maint_indexes(db: Database) -> None:
    _create_maintenance_campaign_indexes(db)
    _create_maintenance_policies_indexes(db)
    _create_maintenance_window_indexes(db)
    _create_maintenance_queue_indexes(db)
    _create_maintenance_batches_indexes(db)
    _create_maintenance_history_indexes(db)
    _create_maintenance_scan_queries_indexes(db)
    _create_maintenance_catalog_indexes(db)
    _create_maintenance_commands_indexes(db)
    logger.info("Maintenance MongoDB indexes created/verified (db=%s).", db.name)


def _create_maintenance_campaign_indexes(db: Database) -> None:
    col = db["maintenance_campaigns"]
    col.create_indexes([
        IndexModel([("campaign_id", ASCENDING)], unique=True, name="unique_campaign_id"),
        IndexModel([("cluster_id", ASCENDING), ("status", ASCENDING)], name="cluster_status"),
        IndexModel([("cluster_id", ASCENDING), ("start_date", ASCENDING)], name="cluster_start_date"),
    ])


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
        IndexModel([("cluster_id", ASCENDING)], unique=True, name="unique_cluster"),
        IndexModel([("window_id", ASCENDING)], unique=True, name="unique_window_id"),
    ])


def _create_maintenance_queue_indexes(db: Database) -> None:
    col = db["maintenance_queue"]
    col.create_indexes([
        IndexModel(
            [("cluster_id", ASCENDING), ("campaign_id", ASCENDING), ("status", ASCENDING), ("priority", DESCENDING), ("created_at", ASCENDING)],
            name="claim_order",
        ),
        IndexModel([("cluster_id", ASCENDING), ("batch_id", ASCENDING)], name="batch_id"),
        IndexModel([("cluster_id", ASCENDING), ("short_id", ASCENDING)], name="short_id"),
        IndexModel([("cluster_id", ASCENDING), ("campaign_id", ASCENDING)], name="campaign_id"),
        IndexModel(
            [
                ("cluster_id", ASCENDING),
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
        IndexModel([("cluster_id", ASCENDING), ("batch_id", ASCENDING)], unique=True, name="unique_batch_id"),
        IndexModel([("cluster_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)], name="status_time"),
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_BATCHES_SEC)


def _create_maintenance_history_indexes(db: Database) -> None:
    col = db["maintenance_history"]
    col.create_indexes([
        IndexModel([("cluster_id", ASCENDING), ("table_name", ASCENDING), ("created_at", DESCENDING)], name="table_time"),
        IndexModel([("cluster_id", ASCENDING), ("action_type", ASCENDING), ("created_at", DESCENDING)], name="action_time"),
        IndexModel([("cluster_id", ASCENDING), ("item_id", ASCENDING)], name="item_id"),
        IndexModel([("cluster_id", ASCENDING), ("campaign_id", ASCENDING), ("created_at", DESCENDING)], name="campaign_time"),
        IndexModel([("cluster_id", ASCENDING), ("campaign_id", ASCENDING), ("finished_at", DESCENDING), ("started_at", DESCENDING)], name="campaign_finished_time"),
    ])
    _ensure_ttl_index(col, [("created_at", ASCENDING)], "ttl_created_at", TTL_MAINT_HISTORY_SEC)


def _create_maintenance_scan_queries_indexes(db: Database) -> None:
    col = db["maintenance_scan_queries"]
    col.create_indexes([
        IndexModel([("query_id", ASCENDING)], unique=True, name="unique_query_id"),
        IndexModel([("enabled", ASCENDING)], name="enabled"),
    ])


def _create_maintenance_catalog_indexes(db: Database) -> None:
    config_col = db["maintenance_catalog_config"]
    config_col.create_indexes([
        IndexModel([("cluster_id", ASCENDING)], unique=True, name="unique_cluster_id"),
    ])

    col = db["maintenance_catalog"]
    _drop_index_if_exists(col, "unique_cluster_db_schema_table")
    col.create_indexes([
        IndexModel(
            [("cluster_id", ASCENDING), ("database_name", ASCENDING), ("run_id", ASCENDING), ("schema_name", ASCENDING), ("table_name", ASCENDING)],
            name="cluster_db_run_schema_table",
        ),
        IndexModel([("cluster_id", ASCENDING), ("captured_at", DESCENDING)], name="cluster_captured_at"),
        IndexModel([("cluster_id", ASCENDING), ("database_name", ASCENDING), ("captured_at", DESCENDING)], name="cluster_db_captured_at"),
    ])
    _ensure_ttl_index(col, [("captured_at", ASCENDING)], "ttl_captured_at", 7 * 24 * 3600)


def _create_maintenance_commands_indexes(db: Database) -> None:
    col = db["maintenance_commands"]
    col.create_indexes([
        IndexModel([("command_id", ASCENDING)], unique=True, name="unique_command_id"),
        IndexModel([("status", ASCENDING), ("requested_at", ASCENDING)], name="status_requested_at"),
        IndexModel([("cluster_id", ASCENDING), ("type", ASCENDING), ("requested_at", DESCENDING)], name="cluster_type_requested_at"),
    ])
    _ensure_ttl_index(col, [("finished_at", ASCENDING)], "ttl_finished_at", TTL_MAINT_COMMANDS_SEC)
