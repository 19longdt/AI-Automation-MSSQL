"""
gate_service.py - Safety gates before each maintenance action.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ..infra.mssql_connection import mssql_connection
from . import gate_queries

logger = logging.getLogger(__name__)


@dataclass
class GateResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)
    reason: str = ""
    metrics: dict = field(default_factory=dict)


class GateService:
    def check(self, host: str, gates: dict[str, int | float], conn_str: str) -> GateResult:
        reasons: list[str] = []
        metrics: dict = {}
        try:
            with mssql_connection(host, conn_str, timeout_sec=gate_queries.GATE_TIMEOUT_SEC) as conn:
                reasons.extend(self._check_cpu(conn, gates, metrics))
                reasons.extend(self._check_active_load(conn, gates, metrics))
                reasons.extend(self._check_ag_queues(conn, gates, metrics))
        except Exception as exc:
            logger.warning("Gate check connection failed on %s: %s", host, exc)
            reasons.append(f"gate_unreachable: {exc}")
            metrics["error"] = str(exc)

        if reasons:
            logger.info("Safety gate FAILED on %s: %s", host, "; ".join(reasons))
            return GateResult(passed=False, reasons=reasons, reason=reasons[0], metrics=metrics)
        return GateResult(passed=True, metrics=metrics)

    @staticmethod
    def _check_cpu(conn, gates: dict[str, int | float], metrics: dict) -> list[str]:
        try:
            row = conn.execute(gate_queries.CPU_SQL).fetchone()
        except Exception as exc:
            return [f"cpu_gate_error: {exc}"]
        if row is None:
            return []
        cpu = int(row.sql_cpu_pct or 0)
        limit = float(gates["cpu_max_pct"])
        metrics["cpu_pct"] = cpu
        metrics["cpu_threshold"] = limit
        if cpu >= limit:
            return [f"cpu {cpu}% >= {limit:.0f}%"]
        return []

    @staticmethod
    def _check_active_load(conn, gates: dict[str, int | float], metrics: dict) -> list[str]:
        try:
            row = conn.execute(gate_queries.ACTIVE_LOAD_SQL).fetchone()
        except Exception as exc:
            return [f"active_load_gate_error: {exc}"]
        active = int(row.active_requests or 0) if row else 0
        limit = int(gates["active_requests_max"])
        metrics["active_requests"] = active
        metrics["active_threshold"] = limit
        if active >= limit:
            return [f"active_requests {active} >= {limit}"]
        return []

    @staticmethod
    def _check_ag_queues(conn, gates: dict[str, int | float], metrics: dict) -> list[str]:
        try:
            rows = conn.execute(gate_queries.AG_QUEUE_SQL).fetchall()
        except Exception as exc:
            return [f"ag_gate_error: {exc}"]
        reasons: list[str] = []
        send_limit = gates.get("log_send_queue_max_kb")
        redo_limit = gates.get("redo_queue_max_kb")
        for row in rows:
            replica = str(row.replica_server_name)
            state = str(row.synchronization_state_desc or "")
            send_q = int(row.log_send_queue_size or 0)
            redo_q = int(row.redo_queue_size or 0)
            metrics.setdefault("ag_replicas", []).append(
                {
                    "replica_server_name": replica,
                    "state": state,
                    "log_send_queue_kb": send_q,
                    "redo_queue_kb": redo_q,
                }
            )
            if state.upper() not in ("SYNCHRONIZED", "SYNCHRONIZING"):
                reasons.append(f"AG {replica} state={state}")
            if send_limit is not None and send_q > int(send_limit):
                reasons.append(f"AG {replica} log_send_queue {send_q}KB > {int(send_limit)}KB")
            if redo_limit is not None and redo_q > int(redo_limit):
                reasons.append(f"AG {replica} redo_queue {redo_q}KB > {int(redo_limit)}KB")
        return reasons
