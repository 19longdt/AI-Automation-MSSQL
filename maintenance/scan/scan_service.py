"""scan_service.py — Scan maintenance items cho một cluster."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from layer1.models.cluster import ClusterConfig

from ..config import MaintEnvSettings
from ..execute.duration_estimator import DurationEstimator
from ..infra.query_config import QueryConfig
from ..infra.query_executor import QueryExecutor
from ..infra.time_utils import now_vn
from ..models.approval import BatchSummary, MaintenanceBatch
from ..models.campaign import CampaignStatus, MaintenanceCampaign
from ..models.policy import MaintenancePolicy
from ..models.work_item import ActionType, ItemKind, WorkItem, WorkItemMetrics
from ..notify.maintenance_notifier import MaintenanceNotifier
from ..policy.policy_resolver import PolicyResolver
from ..repositories.batch_repo import BatchRepo
from ..repositories.campaign_repo import CampaignRepo
from ..repositories.queue_repo import QueueRepo
from ..repositories.scan_query_repo import ScanQueryRepo

logger = logging.getLogger(__name__)

_TOPIC_ID = "maintenance_scan"


class DiscoveryError(RuntimeError):
    pass


class ClusterScanService:
    def __init__(
        self,
        cluster: ClusterConfig,
        query_executor: QueryExecutor,
        policy_resolver: PolicyResolver,
        queue_repo: QueueRepo,
        batch_repo: BatchRepo,
        campaign_repo: CampaignRepo,
        scan_query_repo: ScanQueryRepo,
        estimator: DurationEstimator,
        maint_settings: MaintEnvSettings,
        notifier: MaintenanceNotifier | None = None,
    ) -> None:
        self._cluster = cluster
        self._query_executor = query_executor
        self._resolver = policy_resolver
        self._queue_repo = queue_repo
        self._batch_repo = batch_repo
        self._campaign_repo = campaign_repo
        self._scan_query_repo = scan_query_repo
        self._estimator = estimator
        self._settings = maint_settings
        self._notifier = notifier

    def run(self) -> int:
        now = now_vn()
        self._campaign_repo.expire_if_past_end_date(self._cluster.cluster_id, now)
        if self._campaign_repo.find_active_or_discovering(self._cluster.cluster_id):
            logger.info("Scan skip: campaign already active/discovering for cluster=%s", self._cluster.cluster_id)
            return 0

        campaign = self._campaign_repo.find_pending_or_failed(self._cluster.cluster_id)
        if campaign is None:
            logger.info("Scan skip: no pending campaign for cluster=%s", self._cluster.cluster_id)
            return 0

        if not self._should_trigger(campaign, now):
            logger.debug(
                "Scan skip: not in scheduled time for cluster=%s campaign=%s scan_times=%s",
                self._cluster.cluster_id,
                campaign.campaign_id,
                campaign.scan_times,
            )
            return 0

        self._campaign_repo.update_last_scan_triggered(campaign.campaign_id, now)
        self._campaign_repo.update_status(
            campaign.campaign_id,
            CampaignStatus.DISCOVERING,
            discovery_started_at=now,
            discovery_error=None,
        )
        try:
            count = self._run_discovery(campaign.campaign_id)
            final_status = CampaignStatus.ACTIVE if count > 0 else CampaignStatus.COMPLETED
            self._campaign_repo.update_status(
                campaign.campaign_id,
                final_status,
                discovery_finished_at=now_vn(),
                total_items=count,
                discovery_error=None,
            )
            return count
        except Exception as exc:
            logger.error("Discovery failed for campaign=%s: %s", campaign.campaign_id, exc)
            self._campaign_repo.update_status(
                campaign.campaign_id,
                CampaignStatus.DISCOVERY_FAILED,
                discovery_error=str(exc),
            )
            return 0

    @staticmethod
    def _should_trigger(campaign: MaintenanceCampaign, now: datetime) -> bool:
        current_hm = now.strftime("%H:%M")
        if current_hm not in campaign.scan_times:
            return False
        if campaign.last_scan_triggered_at is not None:
            elapsed_sec = (now - campaign.last_scan_triggered_at).total_seconds()
            if elapsed_sec < 55 * 60:
                return False
        return True

    def _run_discovery(self, campaign_id: str) -> int:
        self._resolver.reload()
        default_policy = self._resolver.resolve("__default__", "__default__")

        host = self._get_primary_host()
        if host is None:
            raise DiscoveryError(f"No primary found for cluster={self._cluster.cluster_id}")

        conn_str = self._cluster.get_connection_string(host)
        scan_queries = {q.query_id: q for q in self._scan_query_repo.find_all_enabled()}
        if not scan_queries:
            raise DiscoveryError("No enabled scan queries")
        if not scan_queries:
            logger.error("Scan aborted — no enabled scan queries.")
            return 0

        format_kwargs = {
            "min_page_count": int(default_policy.min_page_count),
            "min_frag_pct": float(default_policy.reorganize_threshold_pct),
            "mod_threshold": int(default_policy.stats_modification_threshold),
            "fwd_threshold": int(default_policy.heap_forwarded_records_threshold),
        }

        cutoff = now_vn() - timedelta(hours=self._settings.maint_approval_expire_hours)
        self._queue_repo.expire_stale_awaiting(self._cluster.cluster_id, cutoff)
        self._batch_repo.expire_stale(self._cluster.cluster_id, cutoff)

        batch = MaintenanceBatch(cluster_id=self._cluster.cluster_id)
        items: list[WorkItem] = []
        query_failures = 0
        mappers = {
            "scan_fragmentation": self._map_fragmentation,
            "scan_stats_staleness": self._map_stats,
            "scan_heap_forwarded": self._map_heap,
        }
        for query_id, mapper in mappers.items():
            query = scan_queries.get(query_id)
            if query is None:
                logger.warning("Missing scan query '%s' — skipped.", query_id)
                continue
            rows, success = self._run_query(
                host,
                conn_str,
                query_id,
                query.sql.format(**format_kwargs),
                query.timeout_sec,
            )
            if not success:
                query_failures += 1
            items.extend(mapper(rows, batch.batch_id, campaign_id))

        if query_failures == len(mappers) and not items:
            raise DiscoveryError(f"All scan queries failed for cluster={self._cluster.cluster_id}")
        if query_failures:
            logger.warning(
                "Discovery partial failure: cluster=%s failed_queries=%d total_queries=%d",
                self._cluster.cluster_id,
                query_failures,
                len(mappers),
            )

        open_keys = self._queue_repo.find_open_keys(self._cluster.cluster_id)
        fresh = [item for item in items if item.dedupe_key() not in open_keys]
        if not fresh:
            logger.info("Scan complete: no new items for cluster=%s", self._cluster.cluster_id)
            return 0

        batch.item_count = len(fresh)
        batch.summary = self._build_summary(fresh)
        self._queue_repo.insert_many(fresh)
        self._batch_repo.insert(batch)

        logger.info(
            "Scan cluster=%s enqueued %d items (batch=%s)",
            self._cluster.cluster_id,
            len(fresh),
            batch.batch_id[:8],
        )

        if self._notifier is not None:
            message_id = self._notifier.send_batch_approval(
                batch, fresh, top_n=self._settings.maint_batch_top_n_items
            )
            if message_id is not None:
                self._batch_repo.set_message_id(self._cluster.cluster_id, batch.batch_id, message_id)

        return len(fresh)

    def _get_primary_host(self) -> str | None:
        for node_role in self._cluster.node_roles:
            if str(node_role.role).lower() == "primary":
                return node_role.host
        return None

    def _run_query(
        self,
        host: str,
        conn_str: str,
        query_id: str,
        sql: str,
        timeout_sec: int = 300,
    ) -> tuple[list[dict], bool]:
        config = QueryConfig(
            query_id=query_id,
            description=f"Maintenance {query_id}",
            sql=sql,
            timeout_sec=timeout_sec,
        )
        result = self._query_executor.execute(config, host, _TOPIC_ID, "primary", conn_str)
        if not result.success:
            logger.error("Scan query %s failed for cluster=%s: %s", query_id, self._cluster.cluster_id, result.error_message)
            return [], False
        return result.rows, True

    def _map_fragmentation(self, rows: list[dict], batch_id: str, campaign_id: str) -> list[WorkItem]:
        items: list[WorkItem] = []
        for row in rows:
            schema = row.get("schema_name") or "dbo"
            table = row.get("table_name") or ""
            index = row.get("index_name")
            if not table or not index:
                continue

            policy = self._resolver.resolve(schema, table, index)
            if not policy.enabled:
                continue

            frag = float(row.get("fragmentation_pct") or 0.0)
            pages = int(row.get("page_count") or 0)
            if pages < policy.min_page_count:
                continue
            if policy.max_page_count is not None and pages > policy.max_page_count:
                continue
            if frag < policy.reorganize_threshold_pct:
                continue

            is_partitioned = bool(row.get("is_partitioned"))
            partition_number = int(row.get("partition_number") or 1) if is_partitioned else None
            action = (
                ActionType.REBUILD_PARTITION if is_partitioned else ActionType.REBUILD
            ) if frag >= policy.rebuild_threshold_pct else ActionType.REORGANIZE

            item = WorkItem(
                cluster_id=self._cluster.cluster_id,
                campaign_id=campaign_id,
                batch_id=batch_id,
                kind=ItemKind.INDEX_FRAG,
                action_type=action,
                database_name=row.get("database_name") or "",
                schema_name=schema,
                table_name=table,
                index_name=index,
                partition_number=partition_number,
                object_id=int(row.get("object_id") or 0),
                index_id=int(row.get("index_id") or 0),
                metrics=WorkItemMetrics(
                    fragmentation_pct=frag,
                    page_count=pages,
                    record_count=int(row.get("record_count") or 0),
                ),
            )
            self._finalize_item(item, policy)
            items.append(item)
        return items

    def _map_stats(self, rows: list[dict], batch_id: str, campaign_id: str) -> list[WorkItem]:
        items: list[WorkItem] = []
        for row in rows:
            schema = row.get("schema_name") or "dbo"
            table = row.get("table_name") or ""
            stats_name = row.get("stats_name")
            if not table or not stats_name:
                continue

            policy = self._resolver.resolve(schema, table)
            if not policy.enabled:
                continue

            modification = int(row.get("modification_counter") or 0)
            if modification < policy.stats_modification_threshold:
                continue

            item = WorkItem(
                cluster_id=self._cluster.cluster_id,
                campaign_id=campaign_id,
                batch_id=batch_id,
                kind=ItemKind.STATS_STALE,
                action_type=ActionType.UPDATE_STATISTICS,
                database_name=row.get("database_name") or "",
                schema_name=schema,
                table_name=table,
                stats_name=stats_name,
                object_id=int(row.get("object_id") or 0),
                metrics=WorkItemMetrics(
                    modification_counter=modification,
                    rows=int(row.get("rows") or 0),
                    rows_sampled=int(row.get("rows_sampled") or 0),
                    last_updated=row.get("last_updated"),
                ),
            )
            self._finalize_item(item, policy)
            items.append(item)
        return items

    def _map_heap(self, rows: list[dict], batch_id: str, campaign_id: str) -> list[WorkItem]:
        items: list[WorkItem] = []
        for row in rows:
            schema = row.get("schema_name") or "dbo"
            table = row.get("table_name") or ""
            if not table:
                continue

            policy = self._resolver.resolve(schema, table)
            if not policy.enabled:
                continue

            forwarded = int(row.get("forwarded_record_count") or 0)
            if forwarded < policy.heap_forwarded_records_threshold:
                continue

            is_partitioned = bool(row.get("is_partitioned"))
            partition_number = int(row.get("partition_number") or 1) if is_partitioned else None
            item = WorkItem(
                cluster_id=self._cluster.cluster_id,
                campaign_id=campaign_id,
                batch_id=batch_id,
                kind=ItemKind.HEAP_FORWARDED,
                action_type=ActionType.HEAP_REBUILD,
                database_name=row.get("database_name") or "",
                schema_name=schema,
                table_name=table,
                partition_number=partition_number,
                object_id=int(row.get("object_id") or 0),
                index_id=0,
                metrics=WorkItemMetrics(
                    forwarded_record_count=forwarded,
                    page_count=int(row.get("page_count") or 0),
                    record_count=int(row.get("record_count") or 0),
                ),
            )
            self._finalize_item(item, policy)
            items.append(item)
        return items

    def _finalize_item(self, item: WorkItem, policy: MaintenancePolicy) -> None:
        item.estimated_minutes = round(self._estimator.estimate_minutes(item), 1)
        item.priority = DurationEstimator.priority(item, policy.priority_boost)

    @staticmethod
    def _build_summary(items: list[WorkItem]) -> BatchSummary:
        summary = BatchSummary()
        for item in items:
            if item.action_type == ActionType.REORGANIZE:
                summary.reorganize += 1
            elif item.action_type == ActionType.REBUILD:
                summary.rebuild += 1
            elif item.action_type == ActionType.REBUILD_PARTITION:
                summary.rebuild_partition += 1
            elif item.action_type == ActionType.UPDATE_STATISTICS:
                summary.update_statistics += 1
            elif item.action_type == ActionType.HEAP_REBUILD:
                summary.heap_rebuild += 1
            summary.est_total_minutes += item.estimated_minutes
        summary.est_total_minutes = round(summary.est_total_minutes, 1)
        return summary


ScanService = ClusterScanService
