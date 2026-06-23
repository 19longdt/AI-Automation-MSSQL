"""execute_service.py — Execute maintenance items cho một cluster."""
from __future__ import annotations

import logging
import threading
from datetime import datetime

from layer1.models.cluster import ClusterConfig

from ..config import MaintEnvSettings
from ..connection import maint_connection
from ..infra.mssql_connection import mssql_connection
from ..infra.time_utils import now_vn
from ..models.campaign import CampaignStatus, MaintenanceCampaign
from ..models.history import MaintenanceHistory, MaintenanceOutcome
from ..models.policy import MaintenancePolicy
from ..models.work_item import ActionType, ItemKind, TERMINAL_STATUSES, WorkItem, WorkItemStatus
from ..policy.policy_resolver import PolicyResolver
from ..repositories.campaign_repo import CampaignRepo
from ..repositories.history_repo import HistoryRepo
from ..repositories.queue_repo import QueueRepo
from ..repositories.window_repo import WindowRepo
from ..safety.gate_service import GateService
from ..window.window_service import WindowService
from . import statement_builder

logger = logging.getLogger(__name__)

_MEASURE_FRAG_SQL = """
SELECT TOP 1 CAST(avg_fragmentation_in_percent AS DECIMAL(5,2)) AS frag_pct
FROM sys.dm_db_index_physical_stats(DB_ID(), ?, ?, ?, 'SAMPLED')
WHERE alloc_unit_type_desc = 'IN_ROW_DATA' OR alloc_unit_type_desc IS NULL
ORDER BY page_count DESC
"""
_MEASURE_TIMEOUT_SEC = 120
_REBUILD_ACTIONS = (ActionType.REBUILD, ActionType.REBUILD_PARTITION)


def _is_pause_error(message: str) -> bool:
    lowered = message.lower()
    return "pause" in lowered or "3643" in lowered


def _is_online_restriction(message: str) -> bool:
    upper = message.upper()
    return "ONLINE" in upper or "RESUMABLE" in upper


class ClusterExecuteService:
    def __init__(
        self,
        cluster: ClusterConfig,
        queue_repo: QueueRepo,
        history_repo: HistoryRepo,
        campaign_repo: CampaignRepo,
        window_repo: WindowRepo,
        window_service: WindowService,
        gate_service: GateService,
        policy_resolver: PolicyResolver,
        maint_settings: MaintEnvSettings,
    ) -> None:
        self._cluster = cluster
        self._queue_repo = queue_repo
        self._history_repo = history_repo
        self._campaign_repo = campaign_repo
        self._window_repo = window_repo
        self._window_service = window_service
        self._gate_service = gate_service
        self._resolver = policy_resolver
        self._settings = maint_settings

        self._stop_requested = False
        self._deferred_item_ids: set[str] = set()
        self._window_was_open = False
        self._lock = threading.Lock()
        self._current_item: WorkItem | None = None
        self._current_host: str | None = None
        self._current_conn_str: str | None = None

    def tick(self) -> int:
        if self._stop_requested:
            return 0

        now = now_vn()
        self._campaign_repo.expire_if_past_end_date(self._cluster.cluster_id, now)
        campaign = self._campaign_repo.find_active_or_discovering(self._cluster.cluster_id)
        if not campaign or campaign.status != CampaignStatus.ACTIVE:
            return 0

        state = self._window_service.state(now)
        self._track_window_transition(state.open)
        if not state.open:
            return 0

        host = self._get_primary_host()
        if host is None:
            logger.warning("Tick skip: no primary found for cluster=%s", self._cluster.cluster_id)
            return 0

        window = self._window_repo.find_by_cluster(self._cluster.cluster_id)
        if window is None:
            return 0
        conn_str = self._cluster.get_connection_string(host)
        gate = self._gate_service.check(host, window.effective_gates(), conn_str)
        if not gate.passed:
            return 0

        item = self._claim_next(campaign.campaign_id)
        if item is None:
            return 0
        return self._process_item(item, host, conn_str, state.remaining_minutes, campaign)

    def request_stop(self) -> None:
        self._stop_requested = True
        with self._lock:
            item = self._current_item
            host = self._current_host
            conn_str = self._current_conn_str
        if item is None or host is None or conn_str is None:
            return
        if item.action_type in _REBUILD_ACTIONS:
            try:
                pause_stmt = statement_builder.build_pause(item)
                with maint_connection(host, conn_str) as conn:
                    conn.execute(pause_stmt)
            except Exception as exc:
                logger.error("SIGTERM PAUSE failed for %s: %s", item.object_label(), exc)

    def _get_primary_host(self) -> str | None:
        for node_role in self._cluster.node_roles:
            if str(node_role.role).lower() == "primary":
                return node_role.host
        return None

    def _track_window_transition(self, is_open: bool) -> None:
        if is_open and not self._window_was_open:
            self._deferred_item_ids.clear()
        self._window_was_open = is_open

    def _claim_next(self, campaign_id: str) -> WorkItem | None:
        item = self._queue_repo.claim_paused_resumable(self._cluster.cluster_id, campaign_id)
        if item is not None:
            return item
        for _ in range(10):
            item = self._queue_repo.claim_next_approved(self._cluster.cluster_id, campaign_id)
            if item is None:
                return None
            if item.item_id not in self._deferred_item_ids:
                return item
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED)
        return None

    def _process_item(
        self,
        item: WorkItem,
        host: str,
        conn_str: str,
        remaining_minutes: float,
        campaign: MaintenanceCampaign,
    ) -> int:
        self._resolver.reload()
        policy = self._resolver.resolve(item.schema_name, item.table_name, item.index_name)

        if not policy.enabled:
            self._queue_repo.finalize(item.item_id, WorkItemStatus.SKIPPED)
            self._write_history(item, host, "", MaintenanceOutcome.SKIPPED, skip_reason="policy_disabled")
            self._increment_campaign_terminal(campaign, WorkItemStatus.SKIPPED)
            return 0

        is_resumable_rebuild = (
            item.action_type in _REBUILD_ACTIONS and policy.online and policy.resumable
        )
        if not is_resumable_rebuild and item.estimated_minutes > remaining_minutes:
            self._deferred_item_ids.add(item.item_id)
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED)
            self._write_history(
                item,
                host,
                "",
                MaintenanceOutcome.SKIPPED,
                skip_reason=f"insufficient_budget: est {item.estimated_minutes:.0f}p > remaining {remaining_minutes:.0f}p",
            )
            return 0

        return self._execute_item(item, policy, host, conn_str, remaining_minutes, campaign)

    def _execute_item(
        self,
        item: WorkItem,
        policy: MaintenancePolicy,
        host: str,
        conn_str: str,
        remaining_minutes: float,
        campaign: MaintenanceCampaign,
    ) -> int:
        statement = (
            statement_builder.build_resume(item, policy, remaining_minutes)
            if item.resume_token
            else statement_builder.build_statement(item, policy, remaining_minutes)
        )

        if self._settings.maint_dry_run:
            self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
            self._write_history(item, host, statement, MaintenanceOutcome.DRY_RUN)
            self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
            return 1

        frag_before = self._measure_frag(host, conn_str, item)
        started_at = now_vn()

        with self._lock:
            self._current_item = item
            self._current_host = host
            self._current_conn_str = conn_str
        try:
            with maint_connection(host, conn_str) as conn:
                conn.execute(statement)
            finished_at = now_vn()
            frag_after = self._measure_frag(host, conn_str, item)
            self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
            self._write_history(
                item,
                host,
                statement,
                MaintenanceOutcome.DONE,
                frag_before=frag_before,
                frag_after=frag_after,
                started_at=started_at,
                finished_at=finished_at,
            )
            self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
            return 1
        except Exception as exc:
            return self._handle_execute_error(
                item,
                policy,
                host,
                conn_str,
                statement,
                str(exc),
                frag_before,
                started_at,
                remaining_minutes,
                campaign,
            )
        finally:
            with self._lock:
                self._current_item = None
                self._current_host = None
                self._current_conn_str = None

    def _handle_execute_error(
        self,
        item: WorkItem,
        policy: MaintenancePolicy,
        host: str,
        conn_str: str,
        statement: str,
        error: str,
        frag_before: float | None,
        started_at: datetime,
        remaining_minutes: float,
        campaign: MaintenanceCampaign,
    ) -> int:
        finished_at = now_vn()

        if item.action_type in _REBUILD_ACTIONS and _is_pause_error(error):
            self._queue_repo.release(item.item_id, WorkItemStatus.PAUSED, resume_token=True)
            self._write_history(
                item,
                host,
                statement,
                MaintenanceOutcome.PAUSED,
                frag_before=frag_before,
                started_at=started_at,
                finished_at=finished_at,
            )
            return 0

        if _is_online_restriction(error) and policy.online and policy.offline_fallback and not item.resume_token:
            try:
                offline_stmt = statement_builder.build_statement(
                    item, policy, remaining_minutes, force_offline=True
                )
                with maint_connection(host, conn_str) as conn:
                    conn.execute(offline_stmt)
                finished_at = now_vn()
                frag_after = self._measure_frag(host, conn_str, item)
                self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
                self._write_history(
                    item,
                    host,
                    offline_stmt,
                    MaintenanceOutcome.DONE,
                    frag_before=frag_before,
                    frag_after=frag_after,
                    started_at=started_at,
                    finished_at=finished_at,
                    skip_reason="online_fallback_to_offline",
                )
                self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
                return 1
            except Exception as retry_exc:
                error = f"offline retry failed: {retry_exc} (original: {error})"

        attempts = item.attempts + 1
        if attempts >= self._settings.maint_max_attempts:
            self._queue_repo.finalize(item.item_id, WorkItemStatus.FAILED, attempts=attempts, last_error=error)
            terminal_status = WorkItemStatus.FAILED
        else:
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED, attempts=attempts, last_error=error)
            terminal_status = None

        self._write_history(
            item,
            host,
            statement,
            MaintenanceOutcome.FAILED,
            frag_before=frag_before,
            started_at=started_at,
            finished_at=finished_at,
            error=error,
        )
        if terminal_status is not None:
            self._increment_campaign_terminal(campaign, terminal_status)
        return 0

    def _increment_campaign_terminal(self, campaign: MaintenanceCampaign, status: WorkItemStatus) -> None:
        if status not in TERMINAL_STATUSES:
            return
        self._campaign_repo.increment_stats(
            campaign.campaign_id,
            done=1 if status == WorkItemStatus.DONE else 0,
            failed=1 if status == WorkItemStatus.FAILED else 0,
            skipped=1 if status == WorkItemStatus.SKIPPED else 0,
        )

    def _measure_frag(self, host: str, conn_str: str, item: WorkItem) -> float | None:
        if item.kind not in (ItemKind.INDEX_FRAG, ItemKind.HEAP_FORWARDED):
            return None
        if not item.object_id:
            return None
        try:
            with mssql_connection(host, conn_str, timeout_sec=_MEASURE_TIMEOUT_SEC) as conn:
                row = conn.execute(
                    _MEASURE_FRAG_SQL,
                    item.object_id,
                    item.index_id if item.index_id is not None else 0,
                    item.partition_number,
                ).fetchone()
            return float(row.frag_pct) if row and row.frag_pct is not None else None
        except Exception as exc:
            logger.warning("Measure frag failed for %s: %s", item.object_label(), exc)
            return None

    def _write_history(
        self,
        item: WorkItem,
        node: str,
        statement: str,
        outcome: MaintenanceOutcome,
        *,
        frag_before: float | None = None,
        frag_after: float | None = None,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
        skip_reason: str | None = None,
        error: str | None = None,
    ) -> None:
        duration_ms: float | None = None
        if started_at is not None and finished_at is not None:
            duration_ms = (finished_at - started_at).total_seconds() * 1000

        self._history_repo.insert(
            MaintenanceHistory(
                cluster_id=self._cluster.cluster_id,
                campaign_id=item.campaign_id,
                item_id=item.item_id,
                batch_id=item.batch_id,
                node=node,
                database_name=item.database_name,
                schema_name=item.schema_name,
                table_name=item.table_name,
                index_name=item.index_name,
                stats_name=item.stats_name,
                partition_number=item.partition_number,
                action_type=item.action_type,
                statement=statement,
                outcome=outcome,
                frag_before_pct=frag_before,
                frag_after_pct=frag_after,
                duration_ms=duration_ms,
                skip_reason=skip_reason,
                error=error,
                started_at=started_at,
                finished_at=finished_at,
            )
        )


ExecuteService = ClusterExecuteService
