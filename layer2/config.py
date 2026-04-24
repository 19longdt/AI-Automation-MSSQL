"""
config.py — Environment-only configuration cho Layer 2.

Chỉ chứa connection strings, credentials, và runtime tunables.
Không hardcode threshold hay logic — những thứ đó nằm trong skill YAMLs.
"""
from __future__ import annotations

import json
import logging

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Layer2Settings(BaseSettings):
    """Config đọc từ env vars / .env (chung với Layer 1). Load 1 lần khi startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── MSSQL Nodes ───────────────────────────────────────────────────────────
    mssql_nodes: list[str] = Field(
        default_factory=list,
        description="Danh sách hostname của tất cả nodes trong AG cluster. "
                    "Chấp nhận comma-separated hoặc JSON array.",
    )

    @field_validator("mssql_nodes", mode="before")
    @classmethod
    def parse_mssql_nodes(cls, v: object) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [node.strip() for node in v.split(",") if node.strip()]
        return v  # type: ignore[return-value]

    @model_validator(mode="after")
    def validate_nodes_not_empty(self) -> "Layer2Settings":
        if not self.mssql_nodes:
            raise ValueError(
                "MSSQL_NODES là bắt buộc. "
                "Ví dụ: MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03"
            )
        return self

    # ── MSSQL Connection ───────────────────────────────────────────────────────
    mssql_database: str = Field(...)
    mssql_username: str = Field(...)
    mssql_password: str = Field(...)
    mssql_port: int = Field(default=1433)
    mssql_query_timeout_sec: int = Field(
        default=30,
        description="Timeout per DMV query. Agent sẽ trả error tool result khi vượt.",
    )

    # ── MongoDB ────────────────────────────────────────────────────────────────
    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    mongodb_db: str = Field(default="db_monitor")

    # ── Claude API ─────────────────────────────────────────────────────────────
    claude_api_key: str = Field(...)
    claude_model: str = Field(default="claude-sonnet-4-6")

    # ── Telegram (Layer 2 bot — token riêng tránh polling conflict với Layer 1) ─
    telegram_bot_token: str = Field(
        default="",
        validation_alias="l2_telegram_bot_token",
        description="Layer 2 bot token — set L2_TELEGRAM_BOT_TOKEN trong .env. Để trống = bot disabled.",
    )
    telegram_chat_id: str = Field(default="")

    # ── Agent Runtime ──────────────────────────────────────────────────────────
    agent_timeout_sec: int = Field(
        default=120,
        description="Hard timeout toàn bộ agentic loop (giây). Tránh Claude loop vô hạn.",
    )
    node_role_refresh_sec: int = Field(
        default=3600,
        description="Tần suất refresh NodeRoleCache (giây). Dùng chung với Layer 1.",
    )

    # ── Peak Hours ─────────────────────────────────────────────────────────────
    # Trong peak hours, một số tool nặng (get_index_fragmentation) bị block.
    peak_hours_start: int = Field(default=8, description="Giờ bắt đầu peak (0-23, VN time).")
    peak_hours_end: int = Field(default=18, description="Giờ kết thúc peak (0-23, VN time).")

    # ── DB Context ─────────────────────────────────────────────────────────────
    db_context_max_tables: int = Field(
        default=50,
        description="Số lượng tối đa tables lấy từ MSSQL vào DB context (theo row count).",
    )
    db_context_max_age_hours: int = Field(
        default=24,
        description="Auto-refresh db_context nếu collected_at cũ hơn số giờ này.",
    )

    # ── Logging ────────────────────────────────────────────────────────────────
    log_level: str = Field(
        default="INFO",
        validation_alias=AliasChoices("L2_LOG_LEVEL", "LOG_LEVEL"),
    )
    logstash_host: str = Field(default="")
    logstash_port: int = Field(default=5044)
    logstash_app_name: str = Field(
        default="sds.ep.ai-automation-layer2",
        validation_alias=AliasChoices("L2_LOGSTASH_APP_NAME", "LOGSTASH_APP_NAME"),
    )
    logstash_transport: str = Field(
        default="udp",
        validation_alias=AliasChoices("L2_LOGSTASH_TRANSPORT", "LOGSTASH_TRANSPORT"),
    )
    logstash_database_path: str = Field(default="")

    @field_validator("logstash_transport", mode="before")
    @classmethod
    def validate_logstash_transport(cls, v: object) -> str:
        text = str(v or "udp").strip().lower()
        if text not in {"udp", "tcp"}:
            raise ValueError("LOGSTASH_TRANSPORT must be 'udp' or 'tcp'")
        return text

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
settings = Layer2Settings()
