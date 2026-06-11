"""
gate_service.py — Safety gates trước mỗi maintenance action.

Nguyên tắc AN TOÀN TRƯỚC: gate query fail (timeout/unreachable) = gate FAIL —
không chạy action khi không nhìn thấy trạng thái hệ thống.

3 gates:
  1. CPU:        sql_cpu_pct >= cpu_max_pct → fail
  2. Active load: active_requests >= max_active_requests → fail
  3. AG health:   secondary nào log_send/redo queue vượt ngưỡng
                  hoặc không SYNCHRONIZED → fail (REBUILD sinh log lớn →
                  đẩy secondary lag thêm là không chấp nhận được)
"""
from __future__ import annotations

import logging

from pydantic import BaseModel

from ..infra.mssql_connection import mssql_connection
from . import gate_queries

logger = logging.getLogger(__name__)


class GateResult(BaseModel):
    passed: bool
    reasons: list[str] = []


class GateService:

    def check(self, host: str, gates: dict[str, int]) -> GateResult:
        """
        host: primary node. gates: thresholds đã merge từ window doc + defaults
        (MaintenanceWindow.effective_gates()).
        """
        reasons: list[str] = []
        try:
            with mssql_connection(host, timeout_sec=gate_queries.GATE_TIMEOUT_SEC) as conn:
                reasons.extend(self._check_cpu(conn, gates))
                reasons.extend(self._check_active_load(conn, gates))
                reasons.extend(self._check_ag_queues(conn, gates))
        except Exception as exc:
            # Không nhìn thấy hệ thống = không chạy
            logger.warning("Gate check connection failed on %s: %s", host, exc)
            reasons.append(f"gate_unreachable: {exc}")

        if reasons:
            logger.info("Safety gate FAILED on %s: %s", host, "; ".join(reasons))
            return GateResult(passed=False, reasons=reasons)
        return GateResult(passed=True)

    @staticmethod
    def _check_cpu(conn, gates: dict[str, int]) -> list[str]:
        try:
            row = conn.execute(gate_queries.CPU_SQL).fetchone()
        except Exception as exc:
            return [f"cpu_gate_error: {exc}"]
        if row is None:
            # Ring buffer rỗng (hiếm) — không chặn vì 2 gate còn lại vẫn bảo vệ
            return []
        cpu = int(row.sql_cpu_pct or 0)
        limit = gates["cpu_max_pct"]
        if cpu >= limit:
            return [f"cpu {cpu}% >= {limit}%"]
        return []

    @staticmethod
    def _check_active_load(conn, gates: dict[str, int]) -> list[str]:
        try:
            row = conn.execute(gate_queries.ACTIVE_LOAD_SQL).fetchone()
        except Exception as exc:
            return [f"active_load_gate_error: {exc}"]
        active = int(row.active_requests or 0) if row else 0
        limit = gates["max_active_requests"]
        if active >= limit:
            return [f"active_requests {active} >= {limit}"]
        return []

    @staticmethod
    def _check_ag_queues(conn, gates: dict[str, int]) -> list[str]:
        try:
            rows = conn.execute(gate_queries.AG_QUEUE_SQL).fetchall()
        except Exception as exc:
            return [f"ag_gate_error: {exc}"]
        reasons: list[str] = []
        send_limit = gates["max_log_send_queue_kb"]
        redo_limit = gates["max_redo_queue_kb"]
        for row in rows:
            replica = str(row.replica_server_name)
            state = str(row.synchronization_state_desc or "")
            send_q = int(row.log_send_queue_size or 0)
            redo_q = int(row.redo_queue_size or 0)
            if state.upper() not in ("SYNCHRONIZED", "SYNCHRONIZING"):
                reasons.append(f"AG {replica} state={state}")
            if send_q > send_limit:
                reasons.append(f"AG {replica} log_send_queue {send_q}KB > {send_limit}KB")
            if redo_q > redo_limit:
                reasons.append(f"AG {replica} redo_queue {redo_q}KB > {redo_limit}KB")
        return reasons
