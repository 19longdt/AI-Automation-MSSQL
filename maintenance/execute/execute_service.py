"""execute_service.py - Execute maintenance items cho một cluster."""
from __future__ import annotations

import logging
import threading
from datetime import datetime

from layer1.models.cluster import ClusterConfig

from ..config import MaintEnvSettings
from ..connection import maint_connection
from ..infra.cluster_reader import ClusterReader
from ..infra.mssql_connection import mssql_connection
from ..infra.time_utils import now_vn
from ..models.campaign import CampaignStatus, MaintenanceCampaign
from ..models.history import MaintenanceHistory, MaintenanceOutcome
from ..models.policy import MaintenancePolicy
from ..models.work_item import ActionType, ItemKind, TERMINAL_STATUSES, WorkItem, WorkItemStatus
from ..notify.event_publisher import MaintenanceEventPublisher
from ..policy.policy_resolver import PolicyResolver
from ..repositories.campaign_repo import CampaignRepo
from ..repositories.history_repo import HistoryRepo
from ..repositories.queue_repo import QueueRepo
from ..repositories.window_repo import WindowRepo
from ..safety.gate_service import GateService
from ..safety.health_state import HealthState
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
        cluster_reader: ClusterReader,
        publisher: MaintenanceEventPublisher | None = None,
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
        self._cluster_reader = cluster_reader
        self._publisher = publisher

        self._stop_requested = False
        self._deferred_item_ids: set[str] = set()
        self._window_was_open = False
        self._lock = threading.Lock()
        self._current_item: WorkItem | None = None
        self._current_host: str | None = None
        self._current_conn_str: str | None = None
        self._last_role_refresh: datetime | None = None

        self._health_lock = threading.Lock()
        self._health_state: HealthState = HealthState.HEALTHY
        self._health_reason = ""
        self._health_metrics: dict = {}

    def tick(self) -> int:
        if self._stop_requested:
            return 0

        health = self.get_health_state()
        if health != HealthState.HEALTHY:
            logger.debug("Tick skip: health_state=%s for cluster=%s", health.value, self._cluster.cluster_id)
            return 0

        now = now_vn()
        self._campaign_repo.expire_if_past_end_date(self._cluster.cluster_id, now)
        campaign = self._campaign_repo.find_active_or_discovering(self._cluster.cluster_id)
        if not campaign:
            logger.debug("Tick skip: no active campaign for cluster=%s", self._cluster.cluster_id)
            return 0
        if campaign.status != CampaignStatus.ACTIVE:
            logger.debug(
                "Tick skip: campaign status=%s (not ACTIVE) for cluster=%s campaign=%s",
                campaign.status.value,
                self._cluster.cluster_id,
                campaign.campaign_id,
            )
            return 0

        self._notify_web_actions()

        win_state = self._resolve_window_state(campaign, now)
        self._track_window_transition(win_state.open)
        if not win_state.open:
            logger.debug(
                "Tick skip: window closed reason=%s remaining=%.1fm for cluster=%s campaign=%s",
                win_state.reason,
                win_state.remaining_minutes or 0.0,
                self._cluster.cluster_id,
                campaign.campaign_id,
            )
            return 0

        host = self._get_primary_host()
        if host is None:
            logger.warning("Tick skip: no primary found for cluster=%s", self._cluster.cluster_id)
            return 0

        window = self._window_repo.find_by_cluster(self._cluster.cluster_id)
        if window is None:
            logger.warning("Tick skip: no window config for cluster=%s", self._cluster.cluster_id)
            return 0
        conn_str = self._cluster.get_connection_string(host)
        gate = self._gate_service.check(host, window.effective_gates(), conn_str)
        if not gate.passed:
            # GateService logs INFO on failure — chỉ thêm debug context ở đây
            logger.debug(
                "Tick skip: gate failed reasons=%s for cluster=%s",
                gate.reasons,
                self._cluster.cluster_id,
            )
            return 0

        item = self._claim_next(campaign.campaign_id)
        if item is None:
            logger.debug(
                "Tick skip: no approved item to claim for cluster=%s campaign=%s",
                self._cluster.cluster_id,
                campaign.campaign_id,
            )
            return 0
        return self._process_item(item, host, conn_str, win_state.remaining_minutes, campaign)

    def run_tick_check(self) -> dict:
        """Diagnostic dry-run: mirrors tick() logic but never claims/executes.
        Returns a dict with {cluster_id, checked_at, ok, status, message, details}."""
        cluster_id = self._cluster.cluster_id
        now = now_vn()

        def _result(status: str, ok: bool, message: str, details: dict | None = None) -> dict:
            return {
                "cluster_id": cluster_id,
                "checked_at": now.isoformat(),
                "ok": ok,
                "status": status,
                "message": message,
                "details": details or {},
            }

        health = self.get_health_state()
        if health != HealthState.HEALTHY:
            return _result("health_stopped", False,
                           f"Runner đang dừng do tải cao: {self._health_reason}",
                           {"health_state": health.value, "reason": self._health_reason})

        self._campaign_repo.expire_if_past_end_date(cluster_id, now)
        campaign = self._campaign_repo.find_active_or_discovering(cluster_id)
        if not campaign:
            return _result("no_campaign", False, "Không có campaign đang active cho cluster này.")
        if campaign.status != CampaignStatus.ACTIVE:
            return _result("campaign_not_active", False,
                           f"Campaign '{campaign.name}' đang ở trạng thái '{campaign.status.value}', cần ACTIVE để execute.",
                           {"status": campaign.status.value, "campaign_id": campaign.campaign_id, "name": campaign.name})

        win_state = self._resolve_window_state(campaign, now)
        if not win_state.open:
            if campaign.window_override:
                window_label = f"{campaign.window_override.start}–{campaign.window_override.end} (campaign override, budget {campaign.window_override.time_budget_minutes} phút)"
            else:
                window_label = "cluster default window"
            return _result("outside_window", False,
                           f"Ngoài window maintenance ({window_label}): {win_state.reason}",
                           {
                               "reason": win_state.reason,
                               "window_label": window_label,
                               "remaining_minutes": win_state.remaining_minutes,
                               "has_override": campaign.window_override is not None,
                               "override_start": campaign.window_override.start if campaign.window_override else None,
                               "override_end": campaign.window_override.end if campaign.window_override else None,
                               "override_budget_minutes": campaign.window_override.time_budget_minutes if campaign.window_override else None,
                               "budget_used_minutes": campaign.window_budget_used_minutes,
                           })

        host = self._get_primary_host()
        if host is None:
            return _result("no_primary", False, "Không tìm được primary node trong cluster.")

        window = self._window_repo.find_by_cluster(cluster_id)
        if window is None:
            return _result("no_window_config", False, "Chưa cấu hình maintenance window cho cluster này.")

        conn_str = self._cluster.get_connection_string(host)
        gate = self._gate_service.check(host, window.effective_gates(), conn_str)
        if not gate.passed:
            return _result("gate_failed", False,
                           f"Safety gate không qua: {'; '.join(gate.reasons)}",
                           {"reasons": gate.reasons, "metrics": gate.metrics})

        counts = self._queue_repo.count_by_status(cluster_id)
        approved_count = counts.get(WorkItemStatus.APPROVED.value, 0)
        paused_count = counts.get(WorkItemStatus.PAUSED.value, 0)
        claimable = approved_count + paused_count

        if claimable == 0:
            return _result("no_approved_items", True,
                           "Window mở, tất cả gate OK — không có item approved/paused trong queue.",
                           {"remaining_minutes": win_state.remaining_minutes, "primary_host": host,
                            "gate_metrics": gate.metrics})

        remaining_str = f"~{win_state.remaining_minutes:.0f}" if win_state.remaining_minutes is not None else "?"
        return _result("ready", True,
                       f"Sẵn sàng execute: {claimable} item(s) trong queue (approved: {approved_count}, paused: {paused_count}), còn {remaining_str} phút trong window.",
                       {"approved_count": approved_count, "paused_count": paused_count,
                        "remaining_minutes": win_state.remaining_minutes,
                        "primary_host": host, "gate_metrics": gate.metrics})

    def request_stop(self) -> None:
        self._stop_requested = True
        self._pause_current_rebuild("SIGTERM")

    def get_current_item(self) -> WorkItem | None:
        with self._lock:
            return self._current_item

    def get_primary_host(self) -> str | None:
        return self._get_primary_host()

    def get_primary_conn_str(self, host: str) -> str:
        return self._cluster.get_connection_string(host)

    def get_health_state(self) -> HealthState:
        with self._health_lock:
            return self._health_state

    def request_health_stop(self, reason: str, metrics: dict) -> None:
        with self._health_lock:
            if self._health_state == HealthState.HEALTHY:
                self._health_state = HealthState.STOPPING
            elif self._health_state == HealthState.RECOVERING:
                self._health_state = HealthState.STOPPED
            self._health_reason = reason
            self._health_metrics = metrics
        self._pause_current_rebuild("HealthMonitor")

    def mark_health_stopped(self) -> None:
        with self._health_lock:
            if self._health_state == HealthState.STOPPING:
                self._health_state = HealthState.STOPPED

    def notify_gates_recovered(self) -> None:
        with self._health_lock:
            if self._health_state == HealthState.STOPPED:
                self._health_state = HealthState.RECOVERING

    def confirm_recovery(self) -> None:
        with self._health_lock:
            if self._health_state == HealthState.RECOVERING:
                self._health_state = HealthState.HEALTHY
                self._health_reason = ""
                self._health_metrics = {}

    def clear_health_stop(self) -> None:
        with self._health_lock:
            self._health_state = HealthState.HEALTHY
            self._health_reason = ""
            self._health_metrics = {}

    def is_health_stopped(self) -> bool:
        with self._health_lock:
            return self._health_state in (HealthState.STOPPING, HealthState.STOPPED, HealthState.RECOVERING)

    def _resolve_window_state(self, campaign: MaintenanceCampaign, now: datetime):
        if campaign.window_override:
            return self._window_service.state_from_override(
                now,
                start=campaign.window_override.start,
                end=campaign.window_override.end,
                budget_minutes=campaign.window_override.time_budget_minutes,
                budget_used_minutes=campaign.window_budget_used_minutes,
            )
        return self._window_service.state(now)

    def _pause_current_rebuild(self, source: str) -> None:
        with self._lock:
            item = self._current_item
            host = self._current_host
            conn_str = self._current_conn_str
        if item is None or host is None or conn_str is None:
            return
        if item.action_type not in _REBUILD_ACTIONS:
            return
        try:
            pause_stmt = statement_builder.build_pause(item)
            with maint_connection(host, conn_str) as conn:
                conn.execute(pause_stmt)
            logger.info("%s: paused resumable REBUILD for %s", source, item.object_label())
            with self._health_lock:
                if source == "HealthMonitor":
                    self._health_state = HealthState.STOPPED
        except Exception as exc:
            logger.error("%s PAUSE failed for %s: %s", source, item.object_label(), exc)

    def _get_primary_host(self) -> str | None:
        now = now_vn()
        if self._last_role_refresh is None or (now - self._last_role_refresh).total_seconds() > self._settings.maint_node_role_refresh_sec:
            try:
                fresh = self._cluster_reader.find_by_id(self._cluster.cluster_id)
                if fresh:
                    self._cluster = fresh
                    self._last_role_refresh = now
                    logger.debug("Node roles refreshed for cluster=%s", self._cluster.cluster_id)
            except Exception as exc:
                logger.warning("Node role refresh failed for cluster=%s: %s", self._cluster.cluster_id, exc)

        for node_role in self._cluster.node_roles:
            if str(node_role.role).lower() == "primary":
                return node_role.host
        return None

    def _track_window_transition(self, is_open: bool) -> None:
        if is_open and not self._window_was_open:
            self._deferred_item_ids.clear()
        self._window_was_open = is_open

    def _notify_web_actions(self) -> None:
        if self._publisher is None:
            return
        try:
            unnotified = self._queue_repo.find_unnotified_web_actions(self._cluster.cluster_id)
            if not unnotified:
                return
            item_ids = [d["item_id"] for d in unnotified]
            self._publisher.on_web_queue_action(unnotified)
            self._queue_repo.mark_tg_notified(item_ids)
        except Exception:
            logger.exception("_notify_web_actions failed for cluster=%s", self._cluster.cluster_id)

    def _claim_next(self, campaign_id: str) -> WorkItem | None:
        item = self._queue_repo.claim_paused_resumable(self._cluster.cluster_id, campaign_id)
        if item is not None:
            return item
        loop_limit = min(len(self._deferred_item_ids) + 1, 100)
        for _ in range(loop_limit):
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
            self._write_history(
                item,
                host,
                "",
                MaintenanceOutcome.SKIPPED,
                previous_status=WorkItemStatus.RUNNING,
                final_status=WorkItemStatus.SKIPPED,
                attempt_no=item.attempts + 1,
                skip_reason="policy_disabled",
            )
            self._increment_campaign_terminal(campaign, WorkItemStatus.SKIPPED)
            return 0

        is_resumable_rebuild = item.action_type in _REBUILD_ACTIONS and policy.online and policy.resumable
        if not is_resumable_rebuild and item.estimated_minutes > remaining_minutes:
            logger.info(
                "Defer item %s: est %.0fp > remaining %.0fp (insufficient_budget) cluster=%s",
                item.object_label(), item.estimated_minutes, remaining_minutes, self._cluster.cluster_id,
            )
            self._deferred_item_ids.add(item.item_id)
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED)
            self._write_history(
                item,
                host,
                "",
                MaintenanceOutcome.SKIPPED,
                previous_status=WorkItemStatus.RUNNING,
                final_status=WorkItemStatus.APPROVED,
                attempt_no=item.attempts + 1,
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
        # Kết nối đến đúng database của item — ALTER INDEX dùng current DB context
        conn_str = self._cluster.get_connection_string(host, database=item.database_name)

        statement = (
            statement_builder.build_resume(item, policy, remaining_minutes)
            if item.resume_token
            else statement_builder.build_statement(item, policy, remaining_minutes)
        )

        if self._settings.maint_dry_run:
            self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
            self._write_history(
                item,
                host,
                statement,
                MaintenanceOutcome.DRY_RUN,
                previous_status=WorkItemStatus.RUNNING,
                final_status=WorkItemStatus.DONE,
                attempt_no=item.attempts + 1,
            )
            self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
            return 1

        if self._publisher is not None and item.estimated_minutes >= 15:
            self._publisher.on_item_started(item)

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
                previous_status=WorkItemStatus.RUNNING,
                final_status=WorkItemStatus.DONE,
                attempt_no=item.attempts + 1,
                frag_before=frag_before,
                frag_after=frag_after,
                started_at=started_at,
                finished_at=finished_at,
            )
            self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
            self._increment_window_budget(campaign, (finished_at - started_at).total_seconds() * 1000)
            if self._publisher is not None:
                self._publisher.on_item_done(
                    item,
                    frag_before=frag_before,
                    frag_after=frag_after,
                    duration_ms=(finished_at - started_at).total_seconds() * 1000,
                )
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
            self.mark_health_stopped()
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
        duration_ms = (finished_at - started_at).total_seconds() * 1000

        if item.action_type in _REBUILD_ACTIONS and _is_pause_error(error):
            self._queue_repo.release(item.item_id, WorkItemStatus.PAUSED, resume_token=True)
            self._write_history(
                item,
                host,
                statement,
                MaintenanceOutcome.PAUSED,
                previous_status=WorkItemStatus.RUNNING,
                final_status=WorkItemStatus.PAUSED,
                attempt_no=item.attempts + 1,
                frag_before=frag_before,
                started_at=started_at,
                finished_at=finished_at,
            )
            self._increment_window_budget(campaign, duration_ms)
            if self._publisher is not None:
                self._publisher.on_item_paused(item, duration_ms)
            return 0

        if _is_online_restriction(error) and policy.online and policy.offline_fallback and not item.resume_token:
            try:
                offline_stmt = statement_builder.build_statement(item, policy, remaining_minutes, force_offline=True)
                with maint_connection(host, conn_str) as conn:
                    conn.execute(offline_stmt)
                finished_at = now_vn()
                duration_ms = (finished_at - started_at).total_seconds() * 1000
                frag_after = self._measure_frag(host, conn_str, item)
                self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
                self._write_history(
                    item,
                    host,
                    offline_stmt,
                    MaintenanceOutcome.DONE,
                    previous_status=WorkItemStatus.RUNNING,
                    final_status=WorkItemStatus.DONE,
                    attempt_no=item.attempts + 1,
                    frag_before=frag_before,
                    frag_after=frag_after,
                    started_at=started_at,
                    finished_at=finished_at,
                    skip_reason="online_fallback_to_offline",
                )
                self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
                self._increment_window_budget(campaign, duration_ms)
                if self._publisher is not None:
                    self._publisher.on_item_done(item, frag_before, frag_after, duration_ms)
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
            previous_status=WorkItemStatus.RUNNING,
            final_status=terminal_status if terminal_status is not None else WorkItemStatus.APPROVED,
            attempt_no=attempts,
            frag_before=frag_before,
            started_at=started_at,
            finished_at=finished_at,
            error=error,
        )
        self._increment_window_budget(campaign, duration_ms)
        if terminal_status is not None:
            self._increment_campaign_terminal(campaign, terminal_status)
        if self._publisher is not None:
            self._publisher.on_item_failed(
                item,
                error=error,
                attempt=attempts,
                max_attempts=self._settings.maint_max_attempts,
                duration_ms=duration_ms,
            )
        return 0

    def _increment_campaign_terminal(self, campaign: MaintenanceCampaign, status: WorkItemStatus) -> None:
        if status not in TERMINAL_STATUSES:
            return
        just_completed = self._campaign_repo.increment_stats(
            campaign.campaign_id,
            done=1 if status == WorkItemStatus.DONE else 0,
            failed=1 if status == WorkItemStatus.FAILED else 0,
            skipped=1 if status == WorkItemStatus.SKIPPED else 0,
        )
        if just_completed and self._publisher is not None:
            current = self._campaign_repo.find_by_id(campaign.campaign_id)
            if current is not None:
                done_items = self._history_repo.find_done_by_campaign(current.campaign_id)
                self._publisher.on_campaign_completed(current, done_items)

    def _increment_window_budget(self, campaign: MaintenanceCampaign, duration_ms: float) -> None:
        if campaign.window_override is None:
            return
        self._campaign_repo.increment_window_budget(campaign.campaign_id, duration_ms / 60000)

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
        previous_status: WorkItemStatus | None = None,
        final_status: WorkItemStatus | None = None,
        attempt_no: int | None = None,
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
                previous_status=previous_status,
                final_status=final_status,
                attempt_no=attempt_no if attempt_no is not None else item.attempts,
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
