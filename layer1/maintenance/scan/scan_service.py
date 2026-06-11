"""
scan_service.py — Job scan: đánh giá fragmentation/stats/heap → enqueue work items
→ tạo batch → gửi Telegram approval.

Read-only với MSSQL (qua QueryExecutor, timeout riêng). Chạy trên PRIMARY —
dm_db_index_physical_stats và dm_db_stats_properties phản ánh trạng thái
bản ghi write; REBUILD/REORGANIZE cũng sẽ chạy trên primary.

SQL scan queries được load từ MongoDB (maintenance_scan_queries) thay vì hardcode.
Placeholders {min_page_count}, {min_frag_pct}, {mod_threshold}, {fwd_threshold}
được format với giá trị từ default policy lúc runtime.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from ...executor.node_role_cache import NodeRoleCache
from ...executor.query_executor import QueryExecutor
from ...models.topic import QueryConfig
from ...utils.time_utils import now_vn
from ..config import MaintEnvSettings
from ..execute.duration_estimator import DurationEstimator
from ..models.approval import BatchSummary, MaintenanceBatch
from ..models.policy import MaintenancePolicy
from ..models.work_item import (
    ActionType,
    ItemKind,
    WorkItem,
    WorkItemMetrics,
)
from ..policy.policy_resolver import PolicyResolver
from ..repositories.batch_repo import BatchRepo
from ..repositories.queue_repo import QueueRepo
from ..repositories.scan_query_repo import ScanQueryRepo

logger = logging.getLogger(__name__)

_TOPIC_ID = "maintenance_scan"


class ScanService:

    def __init__(
        self,
        query_executor: QueryExecutor,
        role_cache: NodeRoleCache,
        policy_resolver: PolicyResolver,
        queue_repo: QueueRepo,
        batch_repo: BatchRepo,
        scan_query_repo: ScanQueryRepo,
        estimator: DurationEstimator,
        maint_settings: MaintEnvSettings,
        notifier=None,  # MaintenanceNotifier | None — optional, không có Telegram vẫn scan được
    ) -> None:
        self._query_executor = query_executor
        self._role_cache = role_cache
        self._resolver = policy_resolver
        self._queue_repo = queue_repo
        self._batch_repo = batch_repo
        self._scan_query_repo = scan_query_repo
        self._estimator = estimator
        self._settings = maint_settings
        self._notifier = notifier

    # Ánh xạ query_id → mapper function. Query không có mapper sẽ bị bỏ qua.
    _MAPPER_KEYS = ("scan_fragmentation", "scan_stats_staleness", "scan_heap_forwarded")

    def run(self) -> int:
        """Scan toàn DB → enqueue items mới → gửi batch approval. Trả về số items."""
        self._resolver.reload()
        default_policy = self._resolver.resolve("__default__", "__default__")

        primary = self._resolve_primary()
        if primary is None:
            logger.error("Scan aborted — không resolve được primary node.")
            return 0

        scan_queries = {q.query_id: q for q in self._scan_query_repo.find_all_enabled()}
        if not scan_queries:
            logger.error("Scan aborted — không có scan query nào enabled trong MongoDB.")
            return 0

        # Placeholders có thể có trong bất kỳ SQL scan nào — format hết, SQL dùng cái nào thì cái đó được thay.
        format_kwargs = {
            "min_page_count": int(default_policy.min_page_count),
            "min_frag_pct": float(default_policy.reorganize_threshold_pct),
            "mod_threshold": int(default_policy.stats_modification_threshold),
            "fwd_threshold": int(default_policy.heap_forwarded_records_threshold),
        }

        # Batch cũ chưa duyệt quá hạn → expire trước khi tạo batch mới
        cutoff = now_vn() - timedelta(hours=self._settings.maint_approval_expire_hours)
        expired_items = self._queue_repo.expire_stale_awaiting(cutoff)
        expired_batches = self._batch_repo.expire_stale(cutoff)
        if expired_items or expired_batches:
            logger.info(
                "Expired %d stale awaiting items / %d batches (older than %dh).",
                expired_items, expired_batches, self._settings.maint_approval_expire_hours,
            )

        mappers = {
            "scan_fragmentation": self._map_fragmentation,
            "scan_stats_staleness": self._map_stats,
            "scan_heap_forwarded": self._map_heap,
        }

        batch = MaintenanceBatch()
        items: list[WorkItem] = []
        for query_id, mapper in mappers.items():
            q = scan_queries.get(query_id)
            if q is None:
                logger.warning("Scan query '%s' không tìm thấy trong MongoDB — bỏ qua.", query_id)
                continue
            rows = self._run_query(primary, query_id, q.sql.format(**format_kwargs), q.timeout_sec)
            items.extend(mapper(rows, batch.batch_id))

        # Dedupe với items đang open trong queue (multi-day backlog)
        open_keys = self._queue_repo.find_open_keys()
        fresh = [item for item in items if item.dedupe_key() not in open_keys]
        skipped_dupes = len(items) - len(fresh)
        if skipped_dupes:
            logger.info("Scan dedupe: bỏ %d item trùng object đang open trong queue.", skipped_dupes)

        if not fresh:
            logger.info("Scan hoàn tất — không có item mới (queue sạch hoặc toàn duplicates).")
            return 0

        batch.item_count = len(fresh)
        batch.summary = self._build_summary(fresh)
        self._queue_repo.insert_many(fresh)
        self._batch_repo.insert(batch)

        logger.info(
            "Scan enqueued %d items (batch=%s): rebuild=%d reorg=%d stats=%d heap=%d est=%.0fp",
            len(fresh), batch.batch_id[:8],
            batch.summary.rebuild + batch.summary.rebuild_partition,
            batch.summary.reorganize, batch.summary.update_statistics,
            batch.summary.heap_rebuild, batch.summary.est_total_minutes,
        )

        if self._notifier is not None:
            message_id = self._notifier.send_batch_approval(
                batch, fresh, top_n=self._settings.maint_batch_top_n_items
            )
            if message_id is not None:
                self._batch_repo.set_message_id(batch.batch_id, message_id)

        return len(fresh)

    # ── Internals ────────────────────────────────────────────────────────────

    def _resolve_primary(self) -> str | None:
        if self._role_cache.is_stale():
            self._role_cache.refresh()
        resolved = self._role_cache.resolve(["primary"])
        return resolved[0][0] if resolved else None

    def _run_query(self, host: str, query_id: str, sql: str, timeout_sec: int = 300) -> list[dict]:
        config = QueryConfig(
            query_id=query_id,
            description=f"Maintenance {query_id}",
            sql=sql,
            timeout_sec=timeout_sec,
        )
        result = self._query_executor.execute(config, host, _TOPIC_ID, "primary")
        if not result.success:
            logger.error("Scan query %s failed: %s", query_id, result.error_message)
            return []
        return result.rows

    def _map_fragmentation(self, rows: list[dict], batch_id: str) -> list[WorkItem]:
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
                # Bảng quá lớn theo policy — DBA xử lý tay, không auto-queue
                logger.info(
                    "Skip %s.%s.%s: page_count=%d vượt max_page_count=%d (policy).",
                    schema, table, index, pages, policy.max_page_count,
                )
                continue
            if frag < policy.reorganize_threshold_pct:
                continue

            is_partitioned = bool(row.get("is_partitioned"))
            partition_number = int(row.get("partition_number") or 1) if is_partitioned else None

            if frag >= policy.rebuild_threshold_pct:
                action = ActionType.REBUILD_PARTITION if is_partitioned else ActionType.REBUILD
            else:
                action = ActionType.REORGANIZE

            item = WorkItem(
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

    def _map_stats(self, rows: list[dict], batch_id: str) -> list[WorkItem]:
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

    def _map_heap(self, rows: list[dict], batch_id: str) -> list[WorkItem]:
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
