"""
config.py - Environment-only configuration for Layer 1.

Legacy single-cluster MSSQL env vars are still accepted for migration
seeding, but are no longer mandatory once `db_clusters` becomes the
source of truth.
"""
from __future__ import annotations

import logging

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class EnvSettings(BaseSettings):
    """Load env vars once on startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    mssql_nodes: list[str] = Field(
        default_factory=list,
        description=(
            "AG cluster hosts. Accepts comma-separated or JSON array values."
        ),
    )

    @field_validator("mssql_nodes", mode="before")
    @classmethod
    def parse_mssql_nodes(cls, value: object) -> list[str]:
        if isinstance(value, str):
            raw = value.strip()
            if raw.startswith("["):
                import json

                return json.loads(raw)
            return [node.strip() for node in raw.split(",") if node.strip()]
        return value  # type: ignore[return-value]

    mssql_database: str = Field(default="")
    mssql_username: str = Field(default="")
    mssql_password: str = Field(default="")
    mssql_port: int = Field(default=1433)
    mssql_query_timeout_sec: int = Field(default=30)
    cluster_test_timeout_sec: int = Field(default=60)

    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    mongodb_db: str = Field(default="db_monitor")

    node_role_refresh_sec: int = Field(default=3600)
    dedup_suppress_minutes: int = Field(default=30, ge=1)
    cluster_refresh_sec: int = Field(default=60, ge=30)

    teams_webhook_url: str = Field(default="")
    slack_bot_token: str = Field(default="")
    telegram_bot_token: str = Field(default="")
    action_bot_token: str = Field(default="")
    telegram_chat_id: str = Field(default="")

    claude_api_key: str = Field(default="")
    claude_model: str = Field(default="claude-sonnet-4-6")
    layer2_url: str = Field(default="http://layer2:8000")
    haiku_model: str = Field(default="claude-haiku-4-5-20251001")

    log_level: str = Field(
        default="INFO",
        validation_alias=AliasChoices("L1_LOG_LEVEL", "LOG_LEVEL"),
    )
    logstash_host: str = Field(default="")
    logstash_port: int = Field(default=5044)
    logstash_app_name: str = Field(
        default="sds.ep.ai-automation-layer1",
        validation_alias=AliasChoices("L1_LOGSTASH_APP_NAME", "LOGSTASH_APP_NAME"),
    )
    logstash_transport: str = Field(
        default="udp",
        validation_alias=AliasChoices("L1_LOGSTASH_TRANSPORT", "LOGSTASH_TRANSPORT"),
    )
    logstash_database_path: str = Field(default="")

    @field_validator("logstash_transport", mode="before")
    @classmethod
    def validate_logstash_transport(cls, value: object) -> str:
        text = str(value or "udp").strip().lower()
        if text not in {"udp", "tcp"}:
            raise ValueError("LOGSTASH_TRANSPORT must be 'udp' or 'tcp'")
        return text

    def has_legacy_cluster_config(self) -> bool:
        return bool(
            self.mssql_nodes
            and self.mssql_database.strip()
            and self.mssql_username.strip()
            and self.mssql_password.strip()
        )

    def get_connection_string(self, host: str) -> str:
        return (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={host},{self.mssql_port};"
            f"DATABASE={self.mssql_database};"
            f"UID={self.mssql_username};"
            f"PWD={self.mssql_password};"
            f"TrustServerCertificate=yes;"
        )


settings = EnvSettings()
