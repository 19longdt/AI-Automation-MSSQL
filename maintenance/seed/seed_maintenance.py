"""Seed maintenance policy, windows và scan queries."""
from __future__ import annotations

import argparse
import logging

from ..config import maint_settings as settings
from ..infra.cluster_reader import ClusterReader
from ..infra.mongo_client import MongoConnection
from ..models.policy import MaintenancePolicy, PolicyScope
from ..models.scan_query import ScanQueryConfig
from ..models.window import MaintenanceWindow, WindowSlot
from ..repositories.policy_repo import PolicyRepo
from ..repositories.scan_query_repo import ScanQueryRepo
from ..repositories.window_repo import WindowRepo
from ..scan import scan_queries as _sq

logger = logging.getLogger(__name__)


def _default_policy() -> MaintenancePolicy:
    return MaintenancePolicy(
        policy_id=MaintenancePolicy.default_policy_id(),
        scope=PolicyScope.DEFAULT,
        enabled=True,
        reorganize_threshold_pct=10.0,
        rebuild_threshold_pct=30.0,
        min_page_count=1000,
        max_page_count=None,
        maxdop=4,
        online=True,
        resumable=True,
        offline_fallback=False,
        stats_modification_threshold=20_000,
        stats_fullscan=False,
        stats_sample_pct=None,
        heap_forwarded_records_threshold=1000,
        priority_boost=0,
    )


def _default_window(cluster_id: str) -> MaintenanceWindow:
    return MaintenanceWindow(
        window_id=cluster_id,
        cluster_id=cluster_id,
        enabled=True,
        default=WindowSlot(start="01:00", end="04:00", time_budget_minutes=170),
        day_overrides={
            "5": WindowSlot(start="00:00", end="05:00", time_budget_minutes=280),
            "6": WindowSlot(start="00:00", end="05:00", time_budget_minutes=280),
        },
        kill_switch=False,
        gates={},
    )


def _default_scan_queries() -> list[ScanQueryConfig]:
    return [
        ScanQueryConfig(
            query_id="scan_fragmentation",
            description="Index fragmentation scan via dm_db_index_physical_stats (SAMPLED)",
            sql=_sq.FRAGMENTATION_SQL,
            timeout_sec=_sq.SCAN_TIMEOUT_SEC,
        ),
        ScanQueryConfig(
            query_id="scan_stats_staleness",
            description="Statistics staleness scan via dm_db_stats_properties",
            sql=_sq.STATS_STALENESS_SQL,
            timeout_sec=_sq.SCAN_TIMEOUT_SEC,
        ),
        ScanQueryConfig(
            query_id="scan_heap_forwarded",
            description="Heap forwarded records scan via dm_db_index_physical_stats (index_id=0)",
            sql=_sq.HEAP_FORWARDED_SQL,
            timeout_sec=_sq.SCAN_TIMEOUT_SEC,
        ),
    ]


def seed(*, cluster_id: str | None, all_clusters: bool, policy_only: bool, dry_run: bool) -> None:
    policy = _default_policy()
    scan_queries = _default_scan_queries()

    MongoConnection.initialize(settings)
    try:
        monitor_db = MongoConnection.get_client()[settings.monitor_mongodb_db]
        cluster_reader = ClusterReader(monitor_db)
        window_repo = WindowRepo()
        if dry_run:
            print(policy.model_dump_json(indent=2))
            if not policy_only:
                if all_clusters:
                    for cluster in cluster_reader.find_all_enabled():
                        print(_default_window(cluster.cluster_id).model_dump_json(indent=2))
                elif cluster_id:
                    print(_default_window(cluster_id).model_dump_json(indent=2))
            return

        PolicyRepo().upsert(policy)
        repo = ScanQueryRepo()
        for query in scan_queries:
            repo.upsert(query)

        if not policy_only:
            if all_clusters:
                cluster_ids = [cluster.cluster_id for cluster in cluster_reader.find_all_enabled()]
            elif cluster_id:
                cluster_ids = [cluster_id]
            else:
                cluster_ids = []
            for cid in cluster_ids:
                if window_repo.find_by_cluster(cid) is None:
                    window_repo.upsert(_default_window(cid))
                    logger.info("Seeded maintenance window for cluster=%s", cid)
                else:
                    logger.info("Window already exists for cluster=%s — keep existing doc", cid)
    finally:
        MongoConnection.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
    parser = argparse.ArgumentParser(description="Seed maintenance policies + windows")
    parser.add_argument("--cluster-id", help="Seed window for one cluster")
    parser.add_argument("--all-clusters", action="store_true", help="Seed windows for all enabled clusters")
    parser.add_argument("--policy-only", action="store_true", help="Seed only shared policy + scan queries")
    parser.add_argument("--dry-run", action="store_true", help="Print seed payloads without writing")
    args = parser.parse_args()
    seed(
        cluster_id=args.cluster_id,
        all_clusters=args.all_clusters,
        policy_only=args.policy_only,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
