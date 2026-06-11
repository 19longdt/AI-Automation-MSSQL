"""
blocking_detector.py — Detector cho blocking chain và deadlock events.

Route theo query_id (1 detector dùng chung cho topic `blocking` và `deadlock`):
  - blocking_sessions       → chain analysis (victims — bắt buộc cho route blocking)
  - head_blocker_sessions   → enrich head blocker context (optional)
  - head_blocker_locks      → enrich lock details (optional)
  - deadlock_events         → 1 CRITICAL finding per deadlock mới

Nguyên tắc:
  - 1 Finding per HEAD BLOCKER (session gây ra) — victims là detail trong metrics.
    Tránh 50 findings cho 1 incident → dedup + alert sạch.
  - Deadlock đã xảy ra rồi → luôn CRITICAL, không có ngưỡng warning.
  - Detector không raise — lỗi xử lý 1 node/1 row → log + skip (R4).

Không parse XML deadlock ở đây: query `deadlock_events` đã extract fields
(deadlock_time, victim_id, victim_query) bằng XQuery phía SQL Server.
"""
from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from ..models.common import IssueType, Severity
from ..models.findings import Finding
from ..models.metrics import QueryResult
from ..models.topic import MonitorTopic, ThresholdConfig
from ..utils.time_utils import utc_now
from .chain_analysis import (
    build_chain,
    chain_depth_for_head,
    group_victims_by_head,
)

logger = logging.getLogger(__name__)

# Query IDs mà detector này hiểu — query_id lạ sẽ bị bỏ qua (log debug)
_QUERY_BLOCKING = "blocking_sessions"
_QUERY_HEAD_SESSIONS = "head_blocker_sessions"
_QUERY_HEAD_LOCKS = "head_blocker_locks"
_QUERY_DEADLOCK = "deadlock_events"

# Threshold key trong topic config → metric key trong finding.metrics.
# "wait_sec" config được so với max wait của chain (metric tên max_wait_sec).
_THRESHOLD_METRIC_ALIASES: dict[str, str] = {
    "wait_sec": "max_wait_sec",
    "wait_duration_sec": "max_wait_sec",
}

# Giới hạn kích thước metrics — finding đi qua Telegram alert + Layer 2 prompt
_MAX_VICTIM_DETAILS = 10
_MAX_LOCK_DETAILS = 10
_QUERY_TEXT_TRUNCATE = 300

# Deadlock lookback floor: schedule_sec * 2 có thể quá ngắn nếu topic chạy dày;
# floor 10 phút đảm bảo không miss event giữa 2 lần check bị lệch nhịp.
_DEADLOCK_LOOKBACK_FLOOR_SEC = 600


class BlockingChainDetector:
    """Build chain graph → 1 Finding per head blocker; deadlock event → CRITICAL."""

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        findings: list[Finding] = []

        # Group theo node: 3 queries blocking là cùng 1 snapshot per node —
        # KHÔNG được correlate session_id giữa các node khác nhau.
        by_node: dict[tuple[str, str], dict[str, QueryResult]] = {}
        for result in results:
            if not result.success:
                continue
            by_node.setdefault((result.node, result.role), {})[result.query_id] = result

        for (node, role), queries in by_node.items():
            if _QUERY_BLOCKING in queries:
                try:
                    findings.extend(self._detect_blocking(node, role, queries, topic))
                except Exception:
                    logger.error(
                        "blocking_detector: chain analysis failed node=%s topic=%s",
                        node, topic.topic_id, exc_info=True,
                    )
            if _QUERY_DEADLOCK in queries:
                try:
                    findings.extend(
                        self._detect_deadlocks(node, role, queries[_QUERY_DEADLOCK], topic)
                    )
                except Exception:
                    logger.error(
                        "blocking_detector: deadlock detection failed node=%s topic=%s",
                        node, topic.topic_id, exc_info=True,
                    )

        return findings

    # ── Blocking chain ───────────────────────────────────────────────────────

    def _detect_blocking(
        self,
        node: str,
        role: str,
        queries: dict[str, QueryResult],
        topic: MonitorTopic,
    ) -> list[Finding]:
        victim_rows = queries[_QUERY_BLOCKING].rows
        if not victim_rows:
            return []

        chain = build_chain(victim_rows)
        if not chain:
            return []

        victims_by_sid = {r["session_id"]: r for r in victim_rows if "session_id" in r}
        head_rows = self._rows_by_session(queries.get(_QUERY_HEAD_SESSIONS))
        lock_rows = self._lock_rows_by_session(queries.get(_QUERY_HEAD_LOCKS))

        findings: list[Finding] = []
        for head, victim_ids in group_victims_by_head(chain).items():
            metrics = self._build_chain_metrics(
                chain=chain,
                head=head,
                victim_ids=victim_ids,
                victims_by_sid=victims_by_sid,
                head_row=head_rows.get(head),
                locks=lock_rows.get(head, []),
            )
            severity = self._evaluate_severity(metrics, topic.thresholds)
            if severity is None:
                # Dưới mọi ngưỡng warning → noise, không tạo finding
                # (rows đã filter wait > 10s phía SQL nhưng chain ngắn/wait thấp tự resolve)
                continue

            findings.append(
                Finding(
                    topic_id=topic.topic_id,
                    issue_type=IssueType.BLOCKING_CHAIN,
                    severity=severity,
                    node=node,
                    role=role,
                    query_hash=self._head_query_hash(head_rows.get(head), victim_ids, victims_by_sid),
                    query_text=metrics.get("head_blocker_query") or None,
                    metrics=metrics,
                )
            )

        logger.info(
            "blocking_detector: node=%s heads=%d findings=%d",
            node, len(group_victims_by_head(chain)), len(findings),
        )
        return findings

    def _build_chain_metrics(
        self,
        chain: dict[int, int],
        head: int,
        victim_ids: list[int],
        victims_by_sid: dict[int, dict],
        head_row: dict | None,
        locks: list[dict],
    ) -> dict[str, Any]:
        """Metrics contract cho Layer 2 skill + Telegram alert (xem plan B5)."""
        victim_details: list[dict[str, Any]] = []
        wait_secs: list[float] = []
        wait_types: list[str] = []

        for sid in victim_ids:
            row = victims_by_sid.get(sid)
            if row is None:
                continue
            wait_sec = self._as_float(row.get("wait_sec"))
            if wait_sec is not None:
                wait_secs.append(wait_sec)
            if row.get("wait_type"):
                wait_types.append(str(row["wait_type"]))
            victim_details.append({
                "session_id": sid,
                # Parent trực tiếp trong chain — Layer 3 vẽ tree đúng tầng (head → victims);
                # thiếu field này UI rơi về fallback flat list
                "blocking_session_id": chain.get(sid),
                "wait_sec": wait_sec,
                "wait_type": row.get("wait_type"),
                "login_name": row.get("login_name"),
                "database_name": row.get("database_name"),
                "query_hash": row.get("query_hash"),  # native — Layer 2 get_query_stats dùng được
                "query_text": self._truncate(row.get("query_text")),
            })

        # Victims chờ lâu nhất lên đầu — quan trọng nhất khi list bị cắt
        victim_details.sort(key=lambda v: v["wait_sec"] or 0, reverse=True)

        metrics: dict[str, Any] = {
            "chain_depth": chain_depth_for_head(chain, head),
            "blocked_session_count": len(victim_ids),
            "head_blocker_session_id": head,
            "max_wait_sec": max(wait_secs) if wait_secs else 0.0,
            # Wait type phổ biến nhất trong victims — suy ra loại lock contention
            "wait_type": Counter(wait_types).most_common(1)[0][0] if wait_types else None,
            "blocked_sessions": victim_details[:_MAX_VICTIM_DETAILS],
        }

        if head_row is not None:
            # head_blocker_sessions query — context của session GÂY RA blocking.
            # idle + open transaction = forgotten transaction (action khác active lock)
            # query/plan giữ FULL (không truncate) — cùng convention với slow_sessions,
            # Layer 2 cần nguyên văn để phân tích
            metrics.update({
                "head_blocker_login": head_row.get("login_name"),
                "head_blocker_host": head_row.get("host_name"),
                "head_blocker_program": head_row.get("program_name"),
                "head_blocker_status": head_row.get("session_status"),
                "head_blocker_idle_sec": self._as_float(head_row.get("idle_sec")),
                "head_blocker_open_txn_count": head_row.get("open_transaction_count"),
                "head_blocker_query": self._text(head_row.get("last_query_text")),
                "head_blocker_is_idle": (
                    str(head_row.get("session_status") or "").lower() == "sleeping"
                ),
            })
            if head_row.get("blocker_plan_xml"):
                metrics["blocker_plan_xml"] = str(head_row["blocker_plan_xml"])
        else:
            # Head không có trong head_blocker_sessions (seed cũ chưa có query này,
            # hoặc head là victim trung gian) — lấy context từ victim row nếu head cũng bị block
            head_as_victim = victims_by_sid.get(head)
            if head_as_victim is not None:
                metrics["head_blocker_login"] = head_as_victim.get("login_name")
                metrics["head_blocker_query"] = self._text(head_as_victim.get("query_text"))

        if locks:
            metrics["held_locks"] = locks[:_MAX_LOCK_DETAILS]

        return metrics

    def _rows_by_session(self, result: QueryResult | None) -> dict[int, dict]:
        if result is None:
            return {}
        return {
            r["session_id"]: r
            for r in result.rows
            if isinstance(r.get("session_id"), int)
        }

    def _lock_rows_by_session(self, result: QueryResult | None) -> dict[int, list[dict]]:
        """Gom locks theo session, aggregate (resource_type, mode, object) → count."""
        if result is None:
            return {}
        counter: dict[int, Counter] = {}
        for r in result.rows:
            sid = r.get("session_id")
            if not isinstance(sid, int):
                continue
            key = (
                str(r.get("resource_type") or "?"),
                str(r.get("request_mode") or "?"),
                str(r.get("object_name") or ""),
            )
            counter.setdefault(sid, Counter())[key] += 1
        return {
            sid: [
                {
                    "resource_type": rt,
                    "request_mode": mode,
                    "object_name": obj or None,
                    "lock_count": count,
                }
                for (rt, mode, obj), count in c.most_common(_MAX_LOCK_DETAILS)
            ]
            for sid, c in counter.items()
        }

    def _head_query_hash(
        self,
        head_row: dict | None,
        victim_ids: list[int],
        victims_by_sid: dict[int, dict],
    ) -> str | None:
        """
        Hash cho dedup (finding_hash = topic + issue + node + query_hash) và
        cho Layer 2 tools (get_query_stats join theo query_hash).

        Ưu tiên NATIVE query_hash (optimizer fingerprint, format 0x... như slow_sessions)
        — join được với dm_exec_query_stats / Query Store. MD5 từ text chỉ là
        fallback cuối cho data từ seed cũ (không join DMV được, chỉ đủ cho dedup).
        Không dùng session_id vì recycle.
        """
        if head_row is not None:
            if head_row.get("query_hash"):
                return str(head_row["query_hash"])
            if head_row.get("last_query_text"):
                return self._md5(str(head_row["last_query_text"]))
        # Fallback: native query_hash từ victim đầu tiên có (cùng resource contention)
        for sid in victim_ids:
            row = victims_by_sid.get(sid)
            if row is None:
                continue
            if row.get("query_hash"):
                return str(row["query_hash"])
            if row.get("query_text"):
                return self._md5(str(row["query_text"]))
        return None

    # ── Deadlock ─────────────────────────────────────────────────────────────

    def _detect_deadlocks(
        self,
        node: str,
        role: str,
        result: QueryResult,
        topic: MonitorTopic,
    ) -> list[Finding]:
        """
        Query lấy 24h window từ XEvent → mỗi lần chạy thấy lại events cũ.
        Chỉ tạo finding cho event MỚI: deadlock_time trong lookback window
        (2 × schedule_sec, floor 10 phút). Event cũ hơn = đã xử lý ở run trước.
        Trade-off chấp nhận: service down lâu hơn lookback → miss alert event cũ.

        victim_query được lưu full (KHÔNG truncate) để AI phân tích chính xác.
        """
        lookback_sec = max(topic.schedule_sec * 2, _DEADLOCK_LOOKBACK_FLOOR_SEC)
        cutoff = utc_now() - timedelta(seconds=lookback_sec)

        findings: list[Finding] = []
        for row in result.rows:
            deadlock_time = self._parse_time(row.get("deadlock_time"))
            if deadlock_time is None:
                logger.warning(
                    "blocking_detector: unparseable deadlock_time=%r node=%s — skip row",
                    row.get("deadlock_time"), node,
                )
                continue
            if deadlock_time < cutoff:
                continue

            # Full victim_query (KHÔNG truncate) — AI cần query đầy đủ để phân tích deadlock
            victim_query = self._text(row.get("victim_query"))
            findings.append(
                Finding(
                    topic_id=topic.topic_id,
                    issue_type=IssueType.DEADLOCK,
                    # Deadlock đã xảy ra (transaction bị rollback) — không có mức warning
                    severity=Severity.CRITICAL,
                    node=node,
                    role=role,
                    # deadlock_time trong hash → dedup per-event, không suppress event mới
                    query_hash=self._md5(f"{deadlock_time.isoformat()}|{victim_query or ''}"),
                    query_text=victim_query or None,
                    metrics={
                        "deadlock_time": deadlock_time.isoformat(),
                        "victim_id": row.get("victim_id"),
                        "victim_query": victim_query,
                    },
                )
            )

        if findings:
            logger.info("blocking_detector: node=%s new deadlocks=%d", node, len(findings))
        return findings

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _evaluate_severity(
        self,
        metrics: dict[str, Any],
        thresholds: dict[str, ThresholdConfig],
    ) -> Severity | None:
        """
        Severity = max qua tất cả thresholds config (higher-is-worse).
        Trả None nếu không metric nào chạm warning → không tạo finding.
        """
        worst: Severity | None = None
        for key, threshold in thresholds.items():
            metric_key = _THRESHOLD_METRIC_ALIASES.get(key, key)
            value = self._as_float(metrics.get(metric_key))
            if value is None:
                continue
            if value >= threshold.critical:
                return Severity.CRITICAL
            if value >= threshold.warning:
                worst = Severity.WARNING
        return worst

    @staticmethod
    def _parse_time(value: Any) -> datetime | None:
        """deadlock_time từ pyodbc là datetime; fallback parse ISO string."""
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value).replace(tzinfo=None)
            except ValueError:
                return None
        return None

    @staticmethod
    def _as_float(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _text(value: Any) -> str | None:
        """Full text (strip, None nếu rỗng) — cho head blocker query, cùng convention slow_sessions."""
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _truncate(value: Any) -> str | None:
        """Truncate — chỉ dùng cho list victims (×10 entries) và deadlock victim_query
        để metrics không phình; query chính của head blocker giữ full qua _text()."""
        if value is None:
            return None
        text = str(value).strip()
        return text[:_QUERY_TEXT_TRUNCATE] if text else None

    @staticmethod
    def _md5(text: str) -> str:
        return hashlib.md5(text.encode("utf-8", errors="replace")).hexdigest()
