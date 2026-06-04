"""Unit tests cho BlockingChainDetector — fake QueryResult, không cần MSSQL."""
from __future__ import annotations

from datetime import timedelta

from layer1.detectors.blocking_detector import BlockingChainDetector
from layer1.models.common import IssueType, Severity
from layer1.models.metrics import QueryResult
from layer1.models.topic import MonitorTopic, QueryConfig, ThresholdConfig
from layer1.utils.time_utils import utc_now


# ── Fixtures helpers ─────────────────────────────────────────────────────────

def _topic(topic_id: str = "blocking", schedule_sec: int = 60, **thresholds) -> MonitorTopic:
    return MonitorTopic(
        topic_id=topic_id,
        schedule_sec=schedule_sec,
        nodes=["all"],
        queries=[QueryConfig(query_id="q", sql="SELECT TOP 1 1")],
        detector_type="blocking_chain",
        thresholds={k: ThresholdConfig(**v) for k, v in thresholds.items()},
    )


def _blocking_topic() -> MonitorTopic:
    return _topic(
        wait_sec={"warning": 30, "critical": 120},
        chain_depth={"warning": 3, "critical": 5},
        blocked_session_count={"warning": 5, "critical": 20},
    )


def _result(query_id: str, rows: list[dict], node: str = "node1", success: bool = True) -> QueryResult:
    return QueryResult(
        topic_id="blocking", query_id=query_id, node=node, role="primary",
        rows=rows, row_count=len(rows), success=success,
    )


def _victim(sid: int, blocker: int, wait_sec: float = 60, **extra) -> dict:
    return {
        "session_id": sid, "blocking_session_id": blocker,
        "wait_sec": wait_sec, "wait_type": "LCK_M_X",
        "login_name": "app_user", "database_name": "AppDB",
        "query_text": f"UPDATE Orders SET x=1 WHERE id={sid}",
        **extra,
    }


# ── Blocking chain ───────────────────────────────────────────────────────────

class TestBlockingChain:
    def test_one_finding_per_head_blocker(self):
        # 2 chains độc lập: head 100 (2 victims), head 400 (1 victim)
        rows = [_victim(200, 100), _victim(300, 100), _victim(500, 400)]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        # Cả 2 chains có wait 60s >= warning 30 → 2 findings (1 per head)
        assert len(findings) == 2
        heads = {f.metrics["head_blocker_session_id"] for f in findings}
        assert heads == {100, 400}
        assert all(f.issue_type == IssueType.BLOCKING_CHAIN for f in findings)

    def test_severity_warning_from_wait_sec(self):
        rows = [_victim(200, 100, wait_sec=45)]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        assert len(findings) == 1
        assert findings[0].severity == Severity.WARNING

    def test_severity_critical_from_wait_sec(self):
        rows = [_victim(200, 100, wait_sec=150)]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        assert findings[0].severity == Severity.CRITICAL

    def test_severity_critical_from_chain_depth(self):
        # Chain depth 5: 100←200←300←400←500←600, wait thấp dưới ngưỡng wait
        rows = [
            _victim(200, 100, wait_sec=12), _victim(300, 200, wait_sec=12),
            _victim(400, 300, wait_sec=12), _victim(500, 400, wait_sec=12),
            _victim(600, 500, wait_sec=12),
        ]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        assert len(findings) == 1
        assert findings[0].metrics["chain_depth"] == 5
        assert findings[0].severity == Severity.CRITICAL

    def test_below_all_thresholds_no_finding(self):
        # wait 12s < warning 30, depth 1 < 3, count 1 < 5 → noise, không finding
        rows = [_victim(200, 100, wait_sec=12)]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        assert findings == []

    def test_metrics_contract(self):
        rows = [_victim(200, 100, wait_sec=90), _victim(300, 200, wait_sec=40)]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        m = findings[0].metrics
        assert m["chain_depth"] == 2
        assert m["blocked_session_count"] == 2
        assert m["head_blocker_session_id"] == 100
        assert m["max_wait_sec"] == 90
        assert m["wait_type"] == "LCK_M_X"
        # Victims sort theo wait_sec desc
        assert [v["session_id"] for v in m["blocked_sessions"]] == [200, 300]

    def test_head_blocker_enrichment_idle_transaction(self):
        rows = [_victim(200, 100, wait_sec=60)]
        head_rows = [{
            "session_id": 100, "login_name": "batch_user", "host_name": "APP01",
            "program_name": ".Net SqlClient", "open_transaction_count": 1,
            "session_status": "sleeping", "idle_sec": 300,
            "last_query_text": "UPDATE Orders SET status='X' WHERE id=1",
        }]
        findings = BlockingChainDetector().detect(
            [
                _result("blocking_sessions", rows),
                _result("head_blocker_sessions", head_rows),
            ],
            _blocking_topic(),
        )
        m = findings[0].metrics
        assert m["head_blocker_login"] == "batch_user"
        assert m["head_blocker_is_idle"] is True
        assert m["head_blocker_open_txn_count"] == 1
        assert m["head_blocker_idle_sec"] == 300
        # query_hash từ head blocker query text → dedup theo câu query gây block
        assert findings[0].query_hash is not None

    def test_held_locks_aggregated(self):
        rows = [_victim(200, 100, wait_sec=60)]
        lock_rows = [
            {"session_id": 100, "resource_type": "KEY", "request_mode": "X", "object_name": None},
            {"session_id": 100, "resource_type": "KEY", "request_mode": "X", "object_name": None},
            {"session_id": 100, "resource_type": "OBJECT", "request_mode": "IX", "object_name": "Orders"},
        ]
        findings = BlockingChainDetector().detect(
            [
                _result("blocking_sessions", rows),
                _result("head_blocker_locks", lock_rows),
            ],
            _blocking_topic(),
        )
        locks = findings[0].metrics["held_locks"]
        key_lock = next(l for l in locks if l["resource_type"] == "KEY")
        assert key_lock["lock_count"] == 2
        obj_lock = next(l for l in locks if l["resource_type"] == "OBJECT")
        assert obj_lock["object_name"] == "Orders"

    def test_nodes_not_cross_correlated(self):
        # Victim node1 trỏ blocker 100; node2 cũng có session 100 — không được trộn
        findings = BlockingChainDetector().detect(
            [
                _result("blocking_sessions", [_victim(200, 100, wait_sec=60)], node="node1"),
                _result("blocking_sessions", [_victim(300, 100, wait_sec=60)], node="node2"),
            ],
            _blocking_topic(),
        )
        assert len(findings) == 2
        assert {f.node for f in findings} == {"node1", "node2"}
        assert all(f.metrics["blocked_session_count"] == 1 for f in findings)

    def test_failed_result_ignored(self):
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", [_victim(200, 100)], success=False)],
            _blocking_topic(),
        )
        assert findings == []

    def test_empty_rows_no_finding(self):
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", [])], _blocking_topic()
        )
        assert findings == []

    def test_garbage_rows_do_not_raise(self):
        rows = [{"session_id": "bad", "blocking_session_id": object()}, {"x": 1}]
        findings = BlockingChainDetector().detect(
            [_result("blocking_sessions", rows)], _blocking_topic()
        )
        assert findings == []


# ── Deadlock ─────────────────────────────────────────────────────────────────

class TestDeadlock:
    def _deadlock_topic(self) -> MonitorTopic:
        return _topic(topic_id="deadlock", schedule_sec=300)

    def test_recent_deadlock_is_critical_finding(self):
        rows = [{
            "deadlock_time": utc_now() - timedelta(minutes=2),
            "victim_id": "process123", "victim_query": "UPDATE Orders SET x=1",
        }]
        findings = BlockingChainDetector().detect(
            [_result("deadlock_events", rows)], self._deadlock_topic()
        )
        assert len(findings) == 1
        f = findings[0]
        assert f.issue_type == IssueType.DEADLOCK
        assert f.severity == Severity.CRITICAL
        assert f.query_hash is not None  # dedup per-event (deadlock_time trong hash)
        assert f.metrics["victim_id"] == "process123"

    def test_old_deadlock_filtered_out(self):
        # Query lấy 24h window — event cũ hơn lookback (2×300s, floor 600s) đã xử lý run trước
        rows = [{
            "deadlock_time": utc_now() - timedelta(hours=2),
            "victim_id": "p1", "victim_query": "Q",
        }]
        findings = BlockingChainDetector().detect(
            [_result("deadlock_events", rows)], self._deadlock_topic()
        )
        assert findings == []

    def test_two_events_two_findings_different_hashes(self):
        now = utc_now()
        rows = [
            {"deadlock_time": now - timedelta(minutes=1), "victim_id": "p1", "victim_query": "Q1"},
            {"deadlock_time": now - timedelta(minutes=3), "victim_id": "p2", "victim_query": "Q2"},
        ]
        findings = BlockingChainDetector().detect(
            [_result("deadlock_events", rows)], self._deadlock_topic()
        )
        assert len(findings) == 2
        assert findings[0].query_hash != findings[1].query_hash

    def test_unparseable_time_skipped(self):
        rows = [{"deadlock_time": "not-a-date", "victim_id": "p1", "victim_query": "Q"}]
        findings = BlockingChainDetector().detect(
            [_result("deadlock_events", rows)], self._deadlock_topic()
        )
        assert findings == []

    def test_iso_string_time_parsed(self):
        rows = [{
            "deadlock_time": (utc_now() - timedelta(minutes=1)).isoformat(),
            "victim_id": "p1", "victim_query": "Q",
        }]
        findings = BlockingChainDetector().detect(
            [_result("deadlock_events", rows)], self._deadlock_topic()
        )
        assert len(findings) == 1


# ── Mixed / routing ──────────────────────────────────────────────────────────

class TestRouting:
    def test_unknown_query_id_ignored(self):
        findings = BlockingChainDetector().detect(
            [_result("some_other_query", [{"a": 1}])], _blocking_topic()
        )
        assert findings == []

    def test_legacy_combined_topic_routes_both(self):
        # Seed cũ: blocking topic chứa cả deadlock_events — detector vẫn xử lý đúng
        findings = BlockingChainDetector().detect(
            [
                _result("blocking_sessions", [_victim(200, 100, wait_sec=60)]),
                _result("deadlock_events", [{
                    "deadlock_time": utc_now() - timedelta(seconds=30),
                    "victim_id": "p1", "victim_query": "Q",
                }]),
            ],
            _blocking_topic(),
        )
        types = {f.issue_type for f in findings}
        assert types == {IssueType.BLOCKING_CHAIN, IssueType.DEADLOCK}
