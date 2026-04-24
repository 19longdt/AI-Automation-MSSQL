"""
config.py — Environment-only configuration cho Layer 1.

Chỉ chứa connection strings và credentials — những thứ cần có TRƯỚC khi
kết nối MongoDB. Tất cả thresholds, intervals, queries đã chuyển vào
MongoDB `monitor_topics` collection.
"""
from __future__ import annotations

import logging

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class EnvSettings(BaseSettings):
    """Config đọc từ env vars / .env file. Load 1 lần khi startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── MSSQL Nodes (tất cả hosts trong AG cluster) ────────────────────────
    # default_factory=list để pydantic-settings cho phép parse failure,
    # field_validator bên dưới sẽ xử lý cả 2 format: JSON array và comma-separated.
    mssql_nodes: list[str] = Field(
        default_factory=list,
        description="Danh sách hostname của tất cả nodes trong AG cluster. "
                    "Chấp nhận 2 format:\n"
                    "  MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03\n"
                    '  MSSQL_NODES=["SQL-NODE-01","SQL-NODE-02","SQL-NODE-03"]',
    )

    @field_validator("mssql_nodes", mode="before")
    @classmethod
    def parse_mssql_nodes(cls, v: object) -> list[str]:
        """Hỗ trợ cả comma-separated lẫn JSON array từ env var."""
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                return json.loads(v)
            return [node.strip() for node in v.split(",") if node.strip()]
        return v  # type: ignore[return-value]

    @model_validator(mode="after")
    def validate_nodes_not_empty(self) -> "EnvSettings":
        if not self.mssql_nodes:
            raise ValueError(
                "MSSQL_NODES là bắt buộc. "
                "Ví dụ: MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03"
            )
        return self

    # ── MSSQL Connection ───────────────────────────────────────────────────
    mssql_database: str = Field(...)
    mssql_username: str = Field(...)
    mssql_password: str = Field(...)
    mssql_port: int = Field(default=1433)
    mssql_query_timeout_sec: int = Field(
        default=30,
        description="Default timeout per query. Có thể override per-query trong topic config.",
    )

    # ── MongoDB ─────────────────────────────────────────────────────────────
    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    mongodb_db: str = Field(default="db_monitor")

    # ── Node Role Cache ─────────────────────────────────────────────────────
    node_role_refresh_sec: int = Field(
        default=3600,
        description="Tần suất refresh role cache (giây). Default 1 giờ.",
    )
    dedup_suppress_minutes: int = Field(
        default=30,
        ge=1,
        description="Window suppress alert trùng theo finding_hash (phút).",
    )

    # ── Notification Credentials ────────────────────────────────────────────
    teams_webhook_url: str = Field(default="")
    slack_bot_token: str = Field(default="")
    telegram_bot_token: str = Field(default="")
    telegram_chat_id: str = Field(default="")

    # ── AI (Layer 2) ────────────────────────────────────────────────────────
    claude_api_key: str = Field(default="")
    claude_model: str = Field(default="claude-sonnet-4-6")

    # ── Logging ─────────────────────────────────────────────────────────────
    log_level: str = Field(default="INFO")

    # ── Logstash centralized logging ────────────────────────────────────────
    # Để trống logstash_host = disable, vẫn log ra console.
    logstash_host: str = Field(default="")
    logstash_port: int = Field(default=5044)
    logstash_app_name: str = Field(default="sds.ep.ai-automation")
    # SQLite path cho persistent queue. Trống = in-memory queue (mất log nếu crash).
    logstash_database_path: str = Field(default="")

    def get_connection_string(self, host: str) -> str:
        """Tạo pyodbc connection string cho 1 node."""
        return (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={host},{self.mssql_port};"
            f"DATABASE={self.mssql_database};"
            f"UID={self.mssql_username};"
            f"PWD={self.mssql_password};"
            f"TrustServerCertificate=yes;"
        )


# Singleton — import settings từ module này
settings = EnvSettings()
