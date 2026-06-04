"""
execute_service.py — Tick loop thực thi work items trong maintenance window.

Mỗi tick (60s) xử lý TỐI ĐA 1 item — để tái kiểm tra window/kill-switch/gates
thường xuyên và job_executions không bị health checker flag stuck.

Thứ tự mỗi tick:
  1. Window open? (budget còn? kill-switch?)  → không thì return
  2. Safety gates (CPU, active load, AG queues) → fail thì return (không claim)
  3. Claim item: paused-resumable trước (RESUME), rồi approved theo priority
  4. Admission control: est > budget còn lại → defer đến window sau
  5. Execute trên PRIMARY qua maint_connection (không statement timeout)
  6. Ghi maintenance_history (frag before/after, duration, outcome)

Budget enforcement khi statement ĐANG chạy: không interrupt được pyodbc call —
dựa vào MAX_DURATION (server tự PAUSE resumable rebuild) + admission control.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime

from ...executor.mssql_connection import mssql_connection
from ...executor.node_role_cache import NodeRoleCache
from ...utils.time_utils import now_vn
from ..config import MaintEnvSettings
from ..connection import maint_connection
from ..models.history import MaintenanceHistory, MaintenanceOutcome
from ..models.policy import MaintenancePolicy
from ..models.work_item import ActionType, ItemKind, WorkItem, WorkItemStatus
from ..policy.policy_resolver import PolicyResolver
from ..repositories.history_repo import HistoryRepo
from ..repositories.queue_repo import QueueRepo
from ..repositories.window_repo import WindowRepo
from ..safety.gate_service import GateService
from ..window.window_service import WindowService
from . import statement_builder

logger = logging.getLogger(__name__)

# Đo lại fragmentation 1 object cụ thể — trước/sau action (read-only, SAMPLED)
_MEASURE_FRAG_SQL = """
SELECT TOP 1 CAST(avg_fragmentation_in_percent AS DECIMAL(5,2)) AS frag_pct
FROM sys.dm_db_index_physical_stats(DB_ID(), ?, ?, ?, 'SAMPLED')
WHERE alloc_unit_type_desc = 'IN_ROW_DATA' OR alloc_unit_type_desc IS NULL
ORDER BY page_count DESC
"""
_MEASURE_TIMEOUT_SEC = 120

_REBUILD_ACTIONS = (ActionType.REBUILD, ActionType.REBUILD_PARTITION)


def _is_pause_error(message: str) -> bool:
    """MAX_DURATION hết / PAUSE từ connection khác → statement fail với thông báo pause."""
    lowered = message.lower()
    return "pause" in lowered or "3643" in lowered


def _is_online_restriction(message: str) -> bool:
    """ONLINE/RESUMABLE không hỗ trợ cho index này (LOB columns...)."""
    upper = message.upper()
    return "ONLINE" in upper or "RESUMABLE" in upper


class ExecuteService:

    def __init__(
        self,
        queue_repo: QueueRepo,
        history_repo: HistoryRepo,
        window_repo: WindowRepo,
        window_service: WindowService,
        gate_service: GateService,
        policy_resolver: PolicyResolver,
        role_cache: NodeRoleCache,
        maint_settings: MaintEnvSettings,
    ) -> None:
        self._queue_repo = queue_repo
        self._history_repo = history_repo
        self._window_repo = window_repo
        self._window_service = window_service
        self._gate_service = gate_service
        self._resolver = policy_resolver
        self._role_cache = role_cache
        self._settings = maint_settings

        self._stop_requested = False
        # Item ước lượng vượt budget đêm nay — không re-claim đến khi window đóng/mở lại
        self._deferred_item_ids: set[str] = set()
        self._window_was_open = False
        # Item đang execute — cho SIGTERM PAUSE (đọc từ signal handler thread)
        self._lock = threading.Lock()
        self._current_item: WorkItem | None = None
        self._current_host: str | None = None

    # ── Public API ───────────────────────────────────────────────────────────

    def tick(self) -> int:
        """Xử lý tối đa 1 item. Trả về 1 nếu có item done, 0 nếu không."""
        if self._stop_requested:
            return 0

        now = now_vn()
        state = self._window_service.state(now)
        self._track_window_transition(state.open)
        if not state.open:
            logger.debug("Tick: window closed (%s).", state.reason)
            return 0

        window = self._window_repo.get()
        if window is None:  # race hiếm: doc bị xoá giữa state() và get()
            return 0
        gates = window.effective_gates()

        primary = self._resolve_primary()
        if primary is None:
            logger.error("Tick: không resolve được primary — bỏ qua tick này.")
            return 0

        # Gate check TRƯỚC khi claim — gate fail là trạng thái hệ thống,
        # không đốt attempts của item nào.
        gate = self._gate_service.check(primary, gates)
        if not gate.passed:
            return 0

        item = self._claim_next()
        if item is None:
            return 0

        return self._process_item(item, primary, state.remaining_minutes)

    def request_stop(self) -> None:
        """
        SIGTERM handler gọi từ main thread. Nếu đang chạy REBUILD resumable →
        mở connection MỚI gửi PAUSE: statement đang chạy ở worker thread sẽ
        nhận lỗi pause → được xử lý thành status=paused + resume_token.
        """
        self._stop_requested = True
        with self._lock:
            item = self._current_item
            host = self._current_host
        if item is None or host is None:
            return
        if item.action_type in _REBUILD_ACTIONS:
            try:
                pause_stmt = statement_builder.build_pause(item)
                with maint_connection(host) as conn:
                    conn.execute(pause_stmt)
                logger.warning("SIGTERM: đã PAUSE resumable rebuild %s.", item.object_label())
            except Exception as exc:
                logger.error("SIGTERM PAUSE failed cho %s: %s", item.object_label(), exc)
        else:
            # REORGANIZE/UPDATE STATS: an toàn khi bị kill theo process —
            # item sẽ được recover_running() trả về approved khi startup sau.
            logger.warning(
                "SIGTERM: item %s (%s) đang chạy sẽ bị ngắt theo process.",
                item.short_id, item.action_type.value,
            )

    # ── Tick internals ───────────────────────────────────────────────────────

    def _track_window_transition(self, is_open: bool) -> None:
        """Window đóng→mở = đêm mới → reset danh sách deferred."""
        if is_open and not self._window_was_open:
            self._deferred_item_ids.clear()
        self._window_was_open = is_open

    def _resolve_primary(self) -> str | None:
        if self._role_cache.is_stale():
            self._role_cache.refresh()
        resolved = self._role_cache.resolve(["primary"])
        return resolved[0][0] if resolved else None

    def _claim_next(self) -> WorkItem | None:
        item = self._queue_repo.claim_paused_resumable()
        if item is not None:
            return item
        # Bỏ qua items đã deferred đêm nay (est vượt budget còn lại)
        for _ in range(10):  # tránh loop vô hạn nếu toàn deferred
            item = self._queue_repo.claim_next_approved()
            if item is None:
                return None
            if item.item_id not in self._deferred_item_ids:
                return item
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED)
        return None

    def _process_item(self, item: WorkItem, primary: str, remaining_minutes: float) -> int:
        self._resolver.reload()
        policy = self._resolver.resolve(item.schema_name, item.table_name, item.index_name)

        if not policy.enabled:
            self._queue_repo.finalize(item.item_id, WorkItemStatus.SKIPPED)
            self._write_history(item, primary, "", MaintenanceOutcome.SKIPPED,
                                skip_reason="policy_disabled")
            return 0

        # Admission control: không start item không thể xong trong budget còn lại.
        # Resumable rebuild được phép start (MAX_DURATION sẽ pause đúng giờ).
        is_resumable_rebuild = (
            item.action_type in _REBUILD_ACTIONS and policy.online and policy.resumable
        )
        if not is_resumable_rebuild and item.estimated_minutes > remaining_minutes:
            self._deferred_item_ids.add(item.item_id)
            self._queue_repo.release(item.item_id, WorkItemStatus.APPROVED)
            self._write_history(item, primary, "", MaintenanceOutcome.SKIPPED,
                                skip_reason=f"insufficient_budget: est {item.estimated_minutes:.0f}p "
                                            f"> remaining {remaining_minutes:.0f}p")
            logger.info(
                "Defer %s: est %.0fp > budget còn %.0fp — chạy đêm sau.",
                item.object_label(), item.estimated_minutes, remaining_minutes,
            )
            return 0

        return self._execute_item(item, policy, primary, remaining_minutes)

    def _execute_item(
        self,
        item: WorkItem,
        policy: MaintenancePolicy,
        primary: str,
        remaining_minutes: float,
    ) -> int:
        # PAUSED item → RESUME; ngược lại build statement mới
        if item.resume_token:
            statement = statement_builder.build_resume(item, policy, remaining_minutes)
        else:
            statement = statement_builder.build_statement(item, policy, remaining_minutes)

        if self._settings.maint_dry_run:
            logger.info("[DRY_RUN] %s → %s", item.object_label(), statement)
            self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
            self._write_history(item, primary, statement, MaintenanceOutcome.DRY_RUN)
            return 1

        frag_before = self._measure_frag(primary, item)
        started_at = now_vn()

        with self._lock:
            self._current_item = item
            self._current_host = primary
        try:
            logger.info("Executing %s: %s", item.short_id, statement)
            with maint_connection(primary) as conn:
                conn.execute(statement)
            finished_at = now_vn()
            frag_after = self._measure_frag(primary, item)
            self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
            self._write_history(
                item, primary, statement, MaintenanceOutcome.DONE,
                frag_before=frag_before, frag_after=frag_after,
                started_at=started_at, finished_at=finished_at,
            )
            logger.info(
                "Done %s trong %.0fs (frag %.1f%% → %.1f%%).",
                item.object_label(),
                (finished_at - started_at).total_seconds(),
                frag_before if frag_before is not None else -1,
                frag_after if frag_after is not None else -1,
            )
            return 1
        except Exception as exc:
            return self._handle_execute_error(
                item, policy, primary, statement, str(exc), frag_before, started_at,
                remaining_minutes,
            )
        finally:
            with self._lock:
                self._current_item = None
                self._current_host = None

    def _handle_execute_error(
        self,
        item: WorkItem,
        policy: MaintenancePolicy,
        primary: str,
        statement: str,
        error: str,
        frag_before: float | None,
        started_at: datetime,
        remaining_minutes: float,
    ) -> int:
        finished_at = now_vn()

        # 1. Resumable rebuild bị PAUSE (MAX_DURATION hết / SIGTERM PAUSE) —
        #    không phải lỗi: giữ item để RESUME ở window sau.
        if item.action_type in _REBUILD_ACTIONS and _is_pause_error(error):
            self._queue_repo.release(
                item.item_id, WorkItemStatus.PAUSED, resume_token=True,
            )
            self._write_history(
                item, primary, statement, MaintenanceOutcome.PAUSED,
                frag_before=frag_before, started_at=started_at, finished_at=finished_at,
            )
            logger.info("Paused (resumable) %s — sẽ RESUME window sau.", item.object_label())
            return 0

        # 2. ONLINE/RESUMABLE restriction (LOB columns...) — retry offline nếu policy cho phép
        if (
            _is_online_restriction(error)
            and policy.online
            and policy.offline_fallback
            and not item.resume_token
        ):
            logger.warning(
                "ONLINE restriction trên %s — retry ONLINE=OFF (policy.offline_fallback): %s",
                item.object_label(), error,
            )
            try:
                offline_stmt = statement_builder.build_statement(
                    item, policy, remaining_minutes, force_offline=True,
                )
                with maint_connection(primary) as conn:
                    conn.execute(offline_stmt)
                finished_at = now_vn()
                frag_after = self._measure_frag(primary, item)
                self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
                self._write_history(
                    item, primary, offline_stmt, MaintenanceOutcome.DONE,
                    frag_before=frag_before, frag_after=frag_after,
                    started_at=started_at, finished_at=finished_at,
                    skip_reason="online_fallback_to_offline",
                )
                return 1
            except Exception as retry_exc:
                error = f"offline retry failed: {retry_exc} (original: {error})"
                finished_at = now_vn()

        # 3. Lỗi thật — attempts++; quá max → failed terminal
        attempts = item.attempts + 1
        if attempts >= self._settings.maint_max_attempts:
            self._queue_repo.finalize(
                item.item_id, WorkItemStatus.FAILED,
                attempts=attempts, last_error=error,
            )
            outcome_status = "FAILED (terminal)"
        else:
            self._queue_repo.release(
                item.item_id, WorkItemStatus.APPROVED,
                attempts=attempts, last_error=error,
            )
            outcome_status = f"retry {attempts}/{self._settings.maint_max_attempts}"

        self._write_history(
            item, primary, statement, MaintenanceOutcome.FAILED,
            frag_before=frag_before, started_at=started_at, finished_at=finished_at,
            error=error,
        )
        logger.error("Execute failed %s [%s]: %s", item.object_label(), outcome_status, error)
        return 0

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _measure_frag(self, host: str, item: WorkItem) -> float | None:
        """Đo fragmentation 1 object — chỉ cho index/heap actions."""
        if item.kind not in (ItemKind.INDEX_FRAG, ItemKind.HEAP_FORWARDED):
            return None
        if not item.object_id:
            return None
        try:
            with mssql_connection(host, timeout_sec=_MEASURE_TIMEOUT_SEC) as conn:
                row = conn.execute(
                    _MEASURE_FRAG_SQL,
                    item.object_id,
                    item.index_id if item.index_id is not None else 0,
                    item.partition_number,  # None = mọi partition
                ).fetchone()
            return float(row.frag_pct) if row and row.frag_pct is not None else None
        except Exception as exc:
            # Đo frag là best-effort — không fail action vì không đo được
            logger.warning("Measure frag failed cho %s: %s", item.object_label(), exc)
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

        try:
            self._history_repo.insert(MaintenanceHistory(
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
            ))
        except Exception as exc:
            # History là audit — fail không được chặn flow chính
            logger.error("Write maintenance_history failed: %s", exc)
