"""
blocking_detector.py — Phân tích blocking chain depth và deadlock events.

Nhận raw query results (blocking sessions, deadlock XML) từ topic queries.
Tính chain depth, identify head blocker, parse deadlock graph.
"""
from __future__ import annotations

import logging

from ..models.topic import MonitorTopic
from ..models.metrics import QueryResult
from ..models.findings import Finding

logger = logging.getLogger(__name__)


class BlockingChainDetector:

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
                # Parent trực tiếp trong chain — Layer 3 vẽ tree đúng tầng (head → victims)
                "blocking_session_id": chain.get(sid),
                "wait_sec": wait_sec,
                "wait_type": row.get("wait_type"),
                "login_name": row.get("login_name"),
                "database_name": row.get("database_name"),
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
            metrics.update({
                "head_blocker_login": head_row.get("login_name"),
                "head_blocker_host": head_row.get("host_name"),
                "head_blocker_program": head_row.get("program_name"),
                "head_blocker_status": head_row.get("session_status"),
                "head_blocker_idle_sec": self._as_float(head_row.get("idle_sec")),
                "head_blocker_open_txn_count": head_row.get("open_transaction_count"),
                "head_blocker_query": self._truncate(head_row.get("last_query_text")),
                "head_blocker_is_idle": (
                    str(head_row.get("session_status") or "").lower() == "sleeping"
                ),
            })
        else:
            # Head không có trong head_blocker_sessions (seed cũ chưa có query này,
            # hoặc head là victim trung gian) — lấy context từ victim row nếu head cũng bị block
            head_as_victim = victims_by_sid.get(head)
            if head_as_victim is not None:
                metrics["head_blocker_login"] = head_as_victim.get("login_name")
                metrics["head_blocker_query"] = self._truncate(head_as_victim.get("query_text"))

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
        Hash cho dedup (finding_hash = topic + issue + node + query_hash).
        Ưu tiên query text của head blocker — session_id recycle nên không dùng;
        cùng câu query gây block lặp lại trong suppress window → không spam alert.
        """
        if head_row is not None and head_row.get("last_query_text"):
            return self._md5(str(head_row["last_query_text"]))
        # Fallback: hash từ query đầu tiên của victim (đã có query_hash từ SQL nếu seed mới)
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

            victim_query = self._truncate(row.get("victim_query"))
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
        Phân tích blocking data từ query results:
          1. Build blocking chain graph từ session rows
          2. Tính chain depth, identify head blocker
          3. Parse deadlock XML nếu có
          4. So sánh với thresholds trong topic config
        """
        ...

    def _build_chain(self, rows: list[dict]) -> dict:
        """Build blocking chain graph: {blocked_session: blocking_session}."""
        ...

    def _calculate_chain_depth(self, chain: dict) -> int:
        """Tính max chain depth từ graph."""
        ...

    def _parse_deadlock_graph(self, deadlock_xml: str) -> dict:
        """Parse deadlock XML từ System Health XEvent."""
        ...
