"""discovery_service.py - Create maintenance items from catalog snapshot."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from layer1.models.cluster import ClusterConfig

from ..config import MaintEnvSettings
from ..execute.duration_estimator import DurationEstimator
from ..infra.time_utils import now_vn
from ..models.approval import BatchSummary, MaintenanceBatch
from ..models.campaign import CampaignStatus, ExecutionType, MaintenanceCampaign
from ..models.policy import MaintenancePolicy
from ..models.thresholds import EffectiveThresholds
from ..models.work_item import ActionType, ItemKind, WorkItem, WorkItemMetrics
from ..notify.event_publisher import MaintenanceEventPublisher
from ..policy.policy_resolver import PolicyResolver
from ..repositories.batch_repo import BatchRepo
from ..repositories.campaign_repo import CampaignRepo
from ..repositories.catalog_repo import CatalogRepo
from ..repositories.queue_repo import QueueRepo

logger = logging.getLogger(__name__)


class DiscoveryError(RuntimeError):
    pass


class ClusterDiscoveryService:
    def __init__(
        self,
        cluster: ClusterConfig,
        policy_resolver: PolicyResolver,
        queue_repo: QueueRepo,
        batch_repo: BatchRepo,
        campaign_repo: CampaignRepo,
        catalog_repo: CatalogRepo,
        estimator: DurationEstimator,
        maint_settings: MaintEnvSettings,
        publisher: MaintenanceEventPublisher | None = None,
    ) -> None:
        self._cluster = cluster
        self._resolver = policy_resolver
        self._queue_repo = queue_repo
        self._batch_repo = batch_repo
        self._campaign_repo = campaign_repo
        self._catalog_repo = catalog_repo
        self._estimator = estimator
        self._settings = maint_settings
        self._publisher = publisher

    def run(self, forced: bool = False) -> int:
        now = now_vn()
        self._campaign_repo.expire_if_past_end_date(self._cluster.cluster_id, now)

        existing = self._campaign_repo.find_active_or_discovering(self._cluster.cluster_id)
        if existing is not None:
            if existing.status == CampaignStatus.DISCOVERING:
                logger.info("Discovery skip: discovery in progress for cluster=%s", self._cluster.cluster_id)
                return 0
            # ACTIVE campaign — re-discover nếu có capture mới hơn lần discover trước
            return self._maybe_rediscover(existing, now, forced=forced)

        campaign = self._campaign_repo.find_pending_or_failed(self._cluster.cluster_id)
        if campaign is None:
            logger.debug("Discovery skip: no pending campaign for cluster=%s", self._cluster.cluster_id)
            return 0

        if not forced:
            skip_reason = self._skip_reason(campaign, now)
            if skip_reason:
                logger.info(
                    "Discovery skip: %s for cluster=%s campaign=%s scan_times=%s now=%s",
                    skip_reason,
                    self._cluster.cluster_id,
                    campaign.campaign_id,
                    campaign.scan_times,
                    now.strftime("%H:%M"),
                )
                return 0
        else:
            logger.info(
                "Discovery force-run: bypassing scan_times check for cluster=%s campaign=%s",
                self._cluster.cluster_id,
                campaign.campaign_id,
            )

        return self._first_discovery(campaign, now)

    def _first_discovery(self, campaign: MaintenanceCampaign, now: datetime) -> int:
        self._campaign_repo.update_last_scan_triggered(campaign.campaign_id, now)
        self._campaign_repo.update_status(
            campaign.campaign_id,
            CampaignStatus.DISCOVERING,
            discovery_started_at=now,
            discovery_error=None,
        )
        try:
            count = self._run_discovery(campaign, supersede=False)
            final_status = CampaignStatus.ACTIVE if count > 0 else CampaignStatus.COMPLETED
            relevant = self._relevant_run_ids(campaign, self._catalog_repo.latest_run_ids(self._cluster.cluster_id))
            self._campaign_repo.update_status(
                campaign.campaign_id,
                final_status,
                discovery_finished_at=now_vn(),
                total_items=count,
                discovered_run_ids=relevant,
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

    def _maybe_rediscover(self, campaign: MaintenanceCampaign, now: datetime, forced: bool = False) -> int:
        if not forced:
            skip_reason = self._skip_reason(campaign, now)
            if skip_reason:
                logger.debug(
                    "Re-discovery skip: %s for cluster=%s campaign=%s",
                    skip_reason,
                    self._cluster.cluster_id,
                    campaign.campaign_id,
                )
                return 0

        latest = self._catalog_repo.latest_run_ids(self._cluster.cluster_id)
        relevant = self._relevant_run_ids(campaign, latest)
        self._campaign_repo.update_last_scan_triggered(campaign.campaign_id, now)
        if not relevant or relevant == (campaign.discovered_run_ids or {}):
            logger.debug(
                "Re-discovery skip: no newer capture for cluster=%s campaign=%s",
                self._cluster.cluster_id,
                campaign.campaign_id,
            )
            return 0

        logger.info(
            "Re-discovery: newer capture detected for cluster=%s campaign=%s — superseding un-executed items",
            self._cluster.cluster_id,
            campaign.campaign_id,
        )
        self._campaign_repo.update_status(
            campaign.campaign_id,
            CampaignStatus.DISCOVERING,
            discovery_started_at=now,
            discovery_error=None,
        )
        try:
            fresh = self._run_discovery(campaign, supersede=True)
            open_count = self._queue_repo.count_open_for_campaign(self._cluster.cluster_id, campaign.campaign_id)
            final_status = CampaignStatus.ACTIVE if open_count > 0 else CampaignStatus.COMPLETED
            terminal = campaign.done_count + campaign.failed_count + campaign.skipped_count
            self._campaign_repo.update_status(
                campaign.campaign_id,
                final_status,
                discovery_finished_at=now_vn(),
                discovered_run_ids=relevant,
                total_items=terminal + open_count,
                discovery_error=None,
            )
            return fresh
        except Exception as exc:
            # Re-discovery lỗi KHÔNG được giết campaign đang chạy — giữ ACTIVE.
            logger.error("Re-discovery failed for campaign=%s: %s", campaign.campaign_id, exc)
            self._campaign_repo.update_status(
                campaign.campaign_id,
                CampaignStatus.ACTIVE,
                discovery_error=str(exc),
            )
            return 0

    @staticmethod
    def _relevant_run_ids(campaign: MaintenanceCampaign, latest: dict[str, str]) -> dict[str, str]:
        if not campaign.scope:
            return dict(latest)
        dbs = {db.database_name for db in campaign.scope}
        return {db: run_id for db, run_id in latest.items() if db in dbs}

    @staticmethod
    def _skip_reason(campaign: MaintenanceCampaign, now: datetime) -> str | None:
        """Trả về lý do bỏ qua, hoặc None nếu nên chạy discovery."""
        current_hm = now.strftime("%H:%M")
        if current_hm not in campaign.scan_times:
            return f"time_mismatch (now={current_hm}, scan_times={campaign.scan_times})"
        if campaign.last_scan_triggered_at is not None:
            elapsed_sec = (now - campaign.last_scan_triggered_at).total_seconds()
            if elapsed_sec < 55 * 60:
                return f"cooldown ({int(elapsed_sec / 60)}m elapsed < 55m)"
        return None

    def _run_discovery(self, campaign: MaintenanceCampaign, *, supersede: bool) -> int:
        self._resolver.reload()

        status = self._catalog_repo.get_status(self._cluster.cluster_id)
        last_run_at = status.get("last_run_at")
        if isinstance(last_run_at, datetime):
            catalog_age = now_vn() - last_run_at
            if catalog_age.total_seconds() > 48 * 3600:
                logger.warning(
                    "Catalog data is %d hours old for cluster=%s - work items may not reflect current state",
                    catalog_age.total_seconds() / 3600,
                    self._cluster.cluster_id,
                )

        cutoff = now_vn() - timedelta(hours=self._settings.maint_approval_expire_hours)
        self._queue_repo.expire_stale_awaiting(self._cluster.cluster_id, cutoff)
        self._batch_repo.expire_stale(self._cluster.cluster_id, cutoff)

        catalog_tables = self._catalog_repo.find_for_campaign(
            cluster_id=self._cluster.cluster_id,
            scope=campaign.scope,
            execution_types=[item.value for item in campaign.execution_types],
        )
        if not catalog_tables:
            logger.info("Discovery: no catalog data for cluster=%s scope=%s", self._cluster.cluster_id, campaign.scope)
            return 0

        logger.info(
            "Discovery: found %d catalog table(s) for cluster=%s campaign=%s execution_types=%s",
            len(catalog_tables),
            self._cluster.cluster_id,
            campaign.campaign_id,
            [t.value for t in campaign.execution_types],
        )

        # Ngưỡng quyết định cấp campaign (override ← default policy) — tính 1 lần.
        eff = self._campaign_thresholds(campaign)
        logger.info(
            "Discovery thresholds: reorg_pct=%.1f rebuild_pct=%.1f min_pages=%d max_pages=%s "
            "stats_mod=%d stats_min_sample_pct=%s heap_fwd=%d  [cluster=%s campaign=%s]",
            eff.reorganize_pct,
            eff.rebuild_pct,
            eff.min_page_count,
            eff.max_page_count if eff.max_page_count is not None else "unlimited",
            eff.stats_modification_threshold,
            eff.stats_min_sample_pct if eff.stats_min_sample_pct is not None else "disabled",
            eff.heap_forwarded_threshold,
            self._cluster.cluster_id,
            campaign.campaign_id,
        )

        batch = MaintenanceBatch(cluster_id=self._cluster.cluster_id)
        items: list[WorkItem] = []
        for table_doc in catalog_tables:
            schema = table_doc["schema_name"]
            table = table_doc["table_name"]
            policy = self._resolver.resolve(schema, table)
            if not policy.enabled:
                continue

            db_name = table_doc["database_name"]

            if ExecutionType.INDEX in campaign.execution_types:
                for idx in table_doc.get("indexes", []):
                    idx_policy = self._resolver.resolve(schema, table, idx.get("index_name"))
                    if not idx_policy.enabled:
                        continue
                    items.extend(
                        self._build_index_items(idx, table_doc, db_name, batch.batch_id, campaign.campaign_id, eff, idx_policy)
                    )

            if ExecutionType.STATISTIC in campaign.execution_types:
                for stat in table_doc.get("statistics", []):
                    item = self._map_stat_from_catalog(stat, table_doc, db_name, batch.batch_id, campaign.campaign_id, policy, eff)
                    if item:
                        items.append(item)

            if ExecutionType.HEAP in campaign.execution_types:
                fwd = table_doc.get("heap_forwarded_count")
                if fwd is not None:
                    item = self._map_heap_from_catalog(fwd, table_doc, db_name, batch.batch_id, campaign.campaign_id, policy, eff)
                    if item:
                        items.append(item)

        if not items:
            logger.info(
                "Discovery: 0 items above threshold for cluster=%s campaign=%s "
                "(checked %d table(s)) — no work items created",
                self._cluster.cluster_id,
                campaign.campaign_id,
                len(catalog_tables),
            )
            return 0

        # Supersede chỉ sau khi có items mới để thay thế — tránh mất items cũ nếu discovery throw trước đây.
        if supersede:
            n = self._queue_repo.supersede_open_items(self._cluster.cluster_id, campaign.campaign_id)
            if n:
                logger.info("Re-discovery: superseded %d un-executed item(s) for campaign=%s", n, campaign.campaign_id)

        open_keys = self._queue_repo.find_open_keys(self._cluster.cluster_id)
        fresh = [item for item in items if item.dedupe_key() not in open_keys]
        if not fresh:
            logger.info(
                "Discovery: %d item(s) above threshold but all already in queue (dedup) "
                "for cluster=%s campaign=%s",
                len(items),
                self._cluster.cluster_id,
                campaign.campaign_id,
            )
            return 0

        batch.item_count = len(fresh)
        batch.summary = self._build_summary(fresh)
        self._queue_repo.insert_many(fresh)
        self._batch_repo.insert(batch)

        if self._publisher is not None:
            message_id = self._publisher.send_batch_approval(  # type: ignore[attr-defined]
                batch, fresh, top_n=self._settings.maint_batch_top_n_items
            )
            if message_id is not None:
                self._batch_repo.set_message_id(self._cluster.cluster_id, batch.batch_id, message_id)

        return len(fresh)

    def _campaign_thresholds(self, campaign: MaintenanceCampaign) -> EffectiveThresholds:
        """Ngưỡng quyết định: campaign override ← default policy (cho field để trống)."""
        default_policy = self._resolver.resolve("__default__", "__default__")
        base = EffectiveThresholds(
            reorganize_pct=default_policy.reorganize_threshold_pct,
            rebuild_pct=default_policy.rebuild_threshold_pct,
            min_page_count=default_policy.min_page_count,
            max_page_count=default_policy.max_page_count,
            stats_modification_threshold=default_policy.stats_modification_threshold,
            stats_min_sample_pct=default_policy.stats_min_sample_pct,
            heap_forwarded_threshold=default_policy.heap_forwarded_records_threshold,
        )
        return EffectiveThresholds.resolve(campaign.thresholds, base)

    def _build_index_items(
        self, idx, table_doc, db_name, batch_id, campaign_id, eff: EffectiveThresholds, policy: MaintenancePolicy
    ) -> list[WorkItem]:
        """1 work item / partition vượt ngưỡng. Index không partition → 1 item toàn index."""
        partitions = idx.get("partitions") or []
        is_partitioned = bool(idx.get("is_partitioned", False)) and len(partitions) > 0
        out: list[WorkItem] = []
        if is_partitioned:
            for part in partitions:
                item = self._index_item_for(
                    idx, table_doc, db_name, batch_id, campaign_id, eff, policy,
                    frag=part.get("fragmentation_pct"),
                    pages=part.get("page_count"),
                    partition_number=part.get("partition_number"),
                )
                if item:
                    out.append(item)
        else:
            item = self._index_item_for(
                idx, table_doc, db_name, batch_id, campaign_id, eff, policy,
                frag=idx.get("fragmentation_pct"),
                pages=idx.get("page_count"),
                partition_number=None,
            )
            if item:
                out.append(item)
        return out

    def _index_item_for(
        self, idx, table_doc, db_name, batch_id, campaign_id, eff: EffectiveThresholds, policy: MaintenancePolicy,
        *, frag, pages, partition_number,
    ) -> WorkItem | None:
        frag = float(frag or 0.0)
        pages = int(pages or 0)
        if pages < eff.min_page_count:
            logger.debug(
                "Skip index %s.%s.%s (pages=%d < min_page_count=%d)",
                table_doc["schema_name"],
                table_doc["table_name"],
                idx.get("index_name"),
                pages,
                eff.min_page_count,
            )
            return None
        if eff.max_page_count is not None and pages > eff.max_page_count:
            return None
        if frag < eff.reorganize_pct:
            return None

        if frag >= eff.rebuild_pct:
            action = ActionType.REBUILD_PARTITION if partition_number is not None else ActionType.REBUILD
        else:
            action = ActionType.REORGANIZE

        item = WorkItem(
            cluster_id=self._cluster.cluster_id,
            campaign_id=campaign_id,
            batch_id=batch_id,
            kind=ItemKind.INDEX_FRAG,
            action_type=action,
            database_name=db_name,
            schema_name=table_doc["schema_name"],
            table_name=table_doc["table_name"],
            index_name=idx["index_name"],
            partition_number=int(partition_number) if partition_number is not None else None,
            object_id=int(table_doc["object_id"]),
            index_id=int(idx["index_id"]),
            metrics=WorkItemMetrics(
                fragmentation_pct=frag,
                page_count=pages,
                record_count=int(table_doc.get("row_count", 0)),
            ),
        )
        self._finalize_item(item, policy)
        return item

    def _map_stat_from_catalog(self, stat, table_doc, db_name, batch_id, campaign_id, policy, eff: EffectiveThresholds) -> WorkItem | None:
        modification = int(stat.get("modification_counter") or 0)
        rows = int(stat.get("rows") or 0)
        rows_sampled = int(stat.get("rows_sampled") or 0)
        sample_pct = (rows_sampled / rows) * 100.0 if rows > 0 and rows_sampled > 0 else None
        qualifies_by_modification = modification >= eff.stats_modification_threshold
        qualifies_by_sample_rate = bool(
            eff.stats_min_sample_pct is not None
            and modification > 0
            and sample_pct is not None
            and sample_pct < eff.stats_min_sample_pct
        )
        if not qualifies_by_modification and not qualifies_by_sample_rate:
            return None
        if qualifies_by_sample_rate and not qualifies_by_modification:
            logger.debug(
                "Qualify statistics %s.%s.%s by low sample rate (sample_pct=%.2f < min_sample_pct=%.2f, modification=%d)",
                table_doc["schema_name"],
                table_doc["table_name"],
                stat.get("stats_name"),
                sample_pct,
                eff.stats_min_sample_pct,
                modification,
            )
        item = WorkItem(
            cluster_id=self._cluster.cluster_id,
            campaign_id=campaign_id,
            batch_id=batch_id,
            kind=ItemKind.STATS_STALE,
            action_type=ActionType.UPDATE_STATISTICS,
            database_name=db_name,
            schema_name=table_doc["schema_name"],
            table_name=table_doc["table_name"],
            stats_name=stat["stats_name"],
            object_id=int(table_doc["object_id"]),
            metrics=WorkItemMetrics(
                modification_counter=modification,
                rows=rows,
                rows_sampled=rows_sampled,
                last_updated=stat.get("last_updated"),
            ),
        )
        self._finalize_item(item, policy)
        return item

    def _map_heap_from_catalog(self, forwarded, table_doc, db_name, batch_id, campaign_id, policy, eff: EffectiveThresholds) -> WorkItem | None:
        forwarded_count = int(forwarded or 0)
        if forwarded_count < eff.heap_forwarded_threshold:
            return None
        item = WorkItem(
            cluster_id=self._cluster.cluster_id,
            campaign_id=campaign_id,
            batch_id=batch_id,
            kind=ItemKind.HEAP_FORWARDED,
            action_type=ActionType.HEAP_REBUILD,
            database_name=db_name,
            schema_name=table_doc["schema_name"],
            table_name=table_doc["table_name"],
            object_id=int(table_doc["object_id"]),
            index_id=0,
            metrics=WorkItemMetrics(
                forwarded_record_count=forwarded_count,
                page_count=int(table_doc.get("index_kb", 0) / 8) if table_doc.get("index_kb") is not None else 0,
                record_count=int(table_doc.get("row_count", 0)),
            ),
        )
        self._finalize_item(item, policy)
        return item

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


DiscoveryService = ClusterDiscoveryService
