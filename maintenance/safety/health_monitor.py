from __future__ import annotations

import logging
import threading

from ..models.window import HealthMonitorConfig
from ..notify.event_publisher import MaintenanceEventPublisher
from ..safety.gate_service import GateService
from ..safety.health_state import HealthState

logger = logging.getLogger(__name__)


def _build_health_gates(cfg: HealthMonitorConfig) -> dict:
    gates = {}
    if cfg.cpu_max_pct is not None:
        gates["cpu_max_pct"] = cfg.cpu_max_pct
    if cfg.active_requests_max is not None:
        gates["active_requests_max"] = cfg.active_requests_max
    if cfg.log_send_queue_max_kb is not None:
        gates["log_send_queue_max_kb"] = cfg.log_send_queue_max_kb
    if cfg.redo_queue_max_kb is not None:
        gates["redo_queue_max_kb"] = cfg.redo_queue_max_kb
    return gates


class HealthMonitorThread:
    def __init__(
        self,
        cluster_id: str,
        window_repo,
        gate_service: GateService,
        execute_service,
        publisher: MaintenanceEventPublisher | None,
    ) -> None:
        self._cluster_id = cluster_id
        self._window_repo = window_repo
        self._gate_service = gate_service
        self._execute_service = execute_service
        self._publisher = publisher
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"health-{cluster_id}")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._check_once()
            except Exception as exc:
                logger.warning("HealthMonitor check failed for cluster=%s: %s", self._cluster_id, exc)
            window = self._window_repo.find_by_cluster(self._cluster_id)
            interval = window.health_monitor.interval_sec if window and window.health_monitor else 30
            self._stop_event.wait(timeout=interval)

    def _check_once(self) -> None:
        window = self._window_repo.find_by_cluster(self._cluster_id)
        if not window or not window.health_monitor.enabled:
            return

        cfg: HealthMonitorConfig = window.health_monitor
        host = self._execute_service.get_primary_host()
        if host is None:
            return

        conn_str = self._execute_service.get_primary_conn_str(host)
        gate_result = self._gate_service.check(host, _build_health_gates(cfg), conn_str)
        state = self._execute_service.get_health_state()

        if not gate_result.passed:
            notify = state == HealthState.HEALTHY
            current_item = self._execute_service.get_current_item() if hasattr(self._execute_service, "get_current_item") else None
            self._execute_service.request_health_stop(gate_result.reason, gate_result.metrics)
            if notify and current_item is not None and self._publisher is not None:
                self._publisher.on_health_stop(gate_result.reason, gate_result.metrics, current_item)
            logger.warning(
                "HealthMonitor: stop requested cluster=%s state=%s reason=%s metrics=%s",
                self._cluster_id,
                state.value,
                gate_result.reason,
                gate_result.metrics,
            )
            return

        if not cfg.auto_resume:
            return
        if state == HealthState.STOPPED:
            self._execute_service.notify_gates_recovered()
            logger.info("HealthMonitor: gates recovered, entering RECOVERING for cluster=%s", self._cluster_id)
        elif state == HealthState.RECOVERING:
            self._execute_service.confirm_recovery()
            logger.info("HealthMonitor: health confirmed, resuming cluster=%s", self._cluster_id)
