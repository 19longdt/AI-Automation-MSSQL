"""
config.py — Environment-only configuration cho Layer 1.

Chỉ chứa connection strings và credentials — những thứ cần có TRƯỚC khi
kết nối MongoDB. Tất cả thresholds, intervals, queries đã chuyển vào
MongoDB `monitor_topics` collection.
"""
from __future__ import annotations

import logging

from pydantic import Field
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
    mssql_nodes: list[str] = Field(
        description="Danh sách hostname:port của tất cả nodes trong AG cluster. "
                    "Service sẽ tự detect Primary/Secondary, không cần chỉ định role.",
        # Ví dụ: ["SQL-NODE-01", "SQL-NODE-02", "SQL-NODE-03"]
    )
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

    # ── Notification Credentials ────────────────────────────────────────────
    teams_webhook_url: str = Field(default="")
    slack_bot_token: str = Field(default="")
    telegram_bot_token: str = Field(default="")

    # ── AI (Layer 2) ────────────────────────────────────────────────────────
    claude_api_key: str = Field(default="")
    claude_model: str = Field(default="claude-sonnet-4-6")

    def get_connection_string(self, host: str) -> str:
        """Tạo pyodbc connection string cho 1 node."""
        ...


# Singleton — import settings từ module này
settings = EnvSettings()
