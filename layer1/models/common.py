"""
common.py — Enums và value objects dùng chung toàn service.
"""
from __future__ import annotations

from enum import Enum


class Severity(str, Enum):
    """Mức độ nghiêm trọng của finding.

    INFO: ghi log, không gửi alert.
    WARNING: gửi alert nếu alert_min_severity <= WARNING.
    CRITICAL: luôn gửi alert, pager nếu configured.
    """

    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"

    def is_at_least(self, other: "Severity") -> bool:
        """Kiểm tra severity này có >= other không (dùng để filter alert)."""
        return self.order >= other.order

    @property
    def order(self) -> int:
        """Numeric order để so sánh severity levels."""
        return {"INFO": 0, "WARNING": 1, "CRITICAL": 2}[self.value]


class AlertStatus(str, Enum):
    """Delivery status stored on findings for alert/audit visibility."""

    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SUPPRESSED = "suppressed"
    SKIPPED_NOTIFY = "skipped_notify"
    SKIPPED_SEVERITY = "skipped_severity"
    SKIPPED_NO_DISPATCHER = "skipped_no_dispatcher"


class NodeRole(str, Enum):
    """Role của 1 MSSQL node trong AG cluster."""

    PRIMARY = "primary"
    SECONDARY = "secondary"


class IssueType(str, Enum):
    """Phân loại issue từ các detectors.

    Dùng làm key để lookup prompt template cho Layer 2 AI agent.
    """

    slow_sessions = "slow_sessions"
    PLAN_REGRESSION = "plan_regression"
    PLAN_INSTABILITY = "plan_instability"
    NON_OPTIMAL_INDEX = "non_optimal_index"
    PARTITION_ELIMINATION_FAILURE = "partition_elimination_failure"
    HIGH_VARIATION_QUERY = "high_variation_query"
    BLOCKING_CHAIN = "blocking_chain"
    DEADLOCK = "deadlock"
    BLOCKED_QUERY_SNAPSHOT = "blocked_query_snapshot"
    BLOCKED_QUERY_TREND = "blocked_query_trend"
    TEMPDB_PRESSURE = "tempdb_pressure"
    MEMORY_PRESSURE = "memory_pressure"
    WAIT_ANOMALY = "wait_anomaly"
    AG_LAG = "ag_lag"
    CDC_FAILURE = "cdc_failure"
    INDEX_FRAGMENTATION = "index_fragmentation"
    MISSING_INDEX = "missing_index"
    RESOURCE_POOL_SPIKE = "resource_pool_spike"
    JOB_FAILURE = "job_failure"
    BACKUP_GAP = "backup_gap"
    DBCC_OVERDUE = "dbcc_overdue"
