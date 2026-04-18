"""
config.py — Hybrid configuration loader cho Layer 1.

Chiến lược 2 tầng:
  Tầng 1 — env vars / .env (bắt buộc khi startup, không thể thay đổi runtime):
    - Connection strings (MSSQL nodes, MongoDB URI)
    - Credentials (passwords, API keys, webhook URLs)
    - Infrastructure params (ports, timeouts)

  Tầng 2 — MongoDB collection `service_config` (runtime-tunable):
    - Thresholds (slow_query_threshold_pct, ple_warning_sec, ...)
    - Schedule intervals
    - Notification settings

  Lý do tách 2 tầng: connection strings cần có trước khi kết nối MongoDB,
  nhưng thresholds cần thay đổi được runtime mà không restart service.
  Khi MongoDB unavailable → fallback về default values trong EnvSettings.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


# ── Tầng 1: Environment Variables ──────────────────────────────────────────


class EnvSettings(BaseSettings):
    """Config đọc từ env vars — load 1 lần khi startup, immutable sau đó."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # MSSQL connection (bắt buộc)
    mssql_node_primary: str = Field(..., description="Hostname Primary node")
    mssql_node_secondary_1: str = Field(..., description="Hostname Secondary 1")
    mssql_node_secondary_2: str = Field(..., description="Hostname Secondary 2")
    mssql_database: str = Field(...)
    mssql_username: str = Field(...)
    mssql_password: str = Field(...)
    mssql_port: int = Field(default=1433)
    mssql_query_timeout_sec: int = Field(
        default=30,
        description="Timeout per DMV query. Không nên > 60s vì sẽ block scheduler thread.",
    )

    # MongoDB (bắt buộc)
    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    mongodb_db: str = Field(default="db_monitor")

    # Notification credentials (không lưu vào MongoDB vì là secrets)
    teams_webhook_url: str = Field(default="")
    slack_bot_token: str = Field(default="")
    telegram_bot_token: str = Field(default="")

    # AI credentials (Layer 2)
    claude_api_key: str = Field(default="")
    claude_model: str = Field(default="claude-sonnet-4-6")

    def get_connection_string(self, host: str) -> str:
        """Tạo pyodbc connection string cho 1 node."""
        ...

    def get_all_node_hosts(self) -> list[str]:
        """Trả về [primary, secondary_1, secondary_2]."""
        ...


# ── Tầng 2: Runtime-tunable thresholds (từ MongoDB) ────────────────────────


@dataclass
class RuntimeConfig:
    """
    Thresholds và intervals đọc từ MongoDB `service_config`.
    Có thể reload runtime mà không restart service.

    Tất cả fields có default value — nếu MongoDB unavailable hoặc field
    chưa được set, service vẫn chạy với defaults.
    """

    # ── Schedule Intervals (giây) ───────────────────────────────────────────
    interval_slow_query_sec: int = 300        # 5 phút
    interval_blocking_sec: int = 60           # 1 phút — blocking cần detect nhanh
    interval_ag_health_sec: int = 120         # 2 phút
    interval_wait_stats_sec: int = 300
    interval_tempdb_memory_sec: int = 300
    interval_resource_gov_sec: int = 300
    interval_agent_jobs_sec: int = 600        # 10 phút
    interval_missing_index_sec: int = 3600    # 1 giờ
    interval_baseline_update_sec: int = 3600

    # ── Query Checks ────────────────────────────────────────────────────────
    slow_query_threshold_pct: float = 50.0
    slow_query_min_executions: int = 10
    plan_regression_ratio: float = 1.5
    plan_regression_min_executions: int = 100
    plan_instability_min_plans: int = 3
    plan_instability_ratio: float = 5.0
    high_io_threshold_reads: int = 50_000
    high_variation_min_executions: int = 50
    high_variation_cv_threshold: float = 0.5

    # ── Blocking & Lock ─────────────────────────────────────────────────────
    blocking_warning_sec: int = 30
    blocking_critical_sec: int = 120
    blocking_chain_depth_critical: int = 3
    blocked_query_snapshot_min_sec: int = 10
    blocked_query_trend_min_count: int = 5

    # ── AG Health ───────────────────────────────────────────────────────────
    ag_log_send_queue_warning_mb: int = 500
    ag_unsync_critical_min: int = 3

    # ── TempDB & Memory ─────────────────────────────────────────────────────
    tempdb_warning_pct: float = 70.0
    tempdb_critical_pct: float = 85.0
    version_store_warning_mb: int = 500
    ple_warning_sec: int = 300
    ple_critical_sec: int = 100
    memory_grants_pending_sustained_min: int = 5

    # ── Resource Governor ───────────────────────────────────────────────────
    resource_pool_warning_pct: float = 85.0
    resource_pool_sustained_min: int = 10

    # ── Maintenance ─────────────────────────────────────────────────────────
    backup_full_max_hours: int = 24
    backup_log_max_minutes: int = 60
    dbcc_max_days: int = 7
    index_frag_reorganize_pct: float = 10.0
    index_frag_rebuild_pct: float = 30.0
    index_frag_min_page_count: int = 1000
    missing_index_min_measure: float = 10_000.0

    # ── Wait Statistics ─────────────────────────────────────────────────────
    wait_anomaly_threshold_pct: float = 200.0
    wait_baseline_weeks: int = 4
    # Wait types thuần background — loại khỏi anomaly detection
    # vì chúng luôn hiện diện và không phản ánh workload issue
    wait_types_ignore: list[str] = field(default_factory=lambda: [
        "SLEEP", "WAITFOR", "BROKER_TO_FLUSH", "BROKER_TASK_STOP",
        "CLR_AUTO_EVENT", "DISPATCHER_QUEUE_SEMAPHORE",
        "HADR_FILESTREAM_IOMGR_IOCOMPLETION", "HADR_WORK_QUEUE",
        "LAZYWRITER_SLEEP", "LOGMGR_QUEUE", "ONDEMAND_TASK_QUEUE",
        "REQUEST_FOR_DEADLOCK_SEARCH", "RESOURCE_QUEUE", "SERVER_IDLE_CHECK",
        "SLEEP_DBSTARTUP", "SLEEP_DBRECOVER", "SLEEP_MASTERDBREADY",
        "SLEEP_MASTERMDREADY", "SLEEP_MASTERUPGRADED", "SLEEP_MSDBSTARTUP",
        "SLEEP_SYSTEMTASK", "SLEEP_TEMPDBSTARTUP", "SNI_HTTP_ACCEPT",
        "SP_SERVER_DIAGNOSTICS_SLEEP", "SQLTRACE_BUFFER_FLUSH",
        "SQLTRACE_INCREMENTAL_FLUSH_SLEEP", "XE_DISPATCHER_WAIT", "XE_TIMER_EVENT",
    ])

    # ── Notification ────────────────────────────────────────────────────────
    notify_channels: list[str] = field(default_factory=lambda: ["teams"])
    alert_min_severity: str = "WARNING"
    dedup_suppress_minutes: int = 30

    # ── Leader Election ─────────────────────────────────────────────────────
    leader_heartbeat_interval_sec: int = 10
    leader_ttl_sec: int = 30
    standby_poll_interval_sec: int = 15

    # ── AI Rate Limiting ────────────────────────────────────────────────────
    ai_max_calls_per_hour: int = 20

    @classmethod
    def from_mongo_doc(cls, doc: dict[str, Any]) -> RuntimeConfig:
        """Tạo RuntimeConfig từ document MongoDB, bỏ qua fields không biết."""
        ...

    def to_mongo_doc(self) -> dict[str, Any]:
        """Serialize để lưu vào MongoDB."""
        ...


# ── Config Manager — Singleton ──────────────────────────────────────────────


class ConfigManager:
    """
    Quản lý vòng đời config của service.

    Sử dụng:
        cfg = ConfigManager.get()
        threshold = cfg.runtime.slow_query_threshold_pct
        host = cfg.env.mssql_node_primary
    """

    _instance: ConfigManager | None = None

    def __init__(self) -> None:
        self.env: EnvSettings = EnvSettings()
        self.runtime: RuntimeConfig = RuntimeConfig()
        self._loaded_from_mongo: bool = False

    @classmethod
    def get(cls) -> ConfigManager:
        """Singleton accessor."""
        ...

    def load_runtime_from_mongo(self, mongo_doc: dict[str, Any] | None) -> None:
        """
        Override runtime config với values từ MongoDB `service_config`.
        Nếu doc là None (collection chưa có data) → giữ defaults.
        Gọi 1 lần khi startup sau khi kết nối MongoDB thành công.
        """
        ...

    def reload_runtime(self) -> None:
        """
        Reload runtime config từ MongoDB — có thể gọi mà không restart service.
        Dùng khi admin muốn thay đổi threshold có hiệu lực ngay.
        """
        ...
