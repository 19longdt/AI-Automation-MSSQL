"""Standalone environment settings for the maintenance package."""
from __future__ import annotations

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _validate_cron(expr: str) -> str:
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Cron expression must have 5 fields: {expr!r}")
    return expr.strip()


class MaintEnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    monitor_mongodb_db: str = Field(default="db_monitor")
    maint_mongodb_db: str = Field(default="db_maintenance")
    mssql_query_timeout_sec: int = Field(default=30)

    maint_scan_cron: str = Field(default="0 20 * * *")
    maint_summary_cron: str = Field(default="30 5 * * *")
    maint_tick_sec: int = Field(default=60, ge=10)
    maint_dry_run: bool = Field(default=True)
    maint_max_attempts: int = Field(default=3, ge=1)
    maint_estimate_pages_per_minute: int = Field(default=150_000, ge=1000)
    maint_estimate_rows_per_minute: int = Field(default=2_000_000, ge=10_000)
    maint_batch_top_n_items: int = Field(default=10, ge=0, le=20)
    maint_approval_expire_hours: int = Field(default=30, ge=1)

    maint_telegram_bot_token: str
    telegram_chat_id: str

    log_level: str = Field(
        default="INFO",
        validation_alias=AliasChoices("MAINT_LOG_LEVEL", "LOG_LEVEL"),
    )
    logstash_host: str = Field(default="")
    logstash_port: int = Field(default=5044)
    logstash_app_name: str = Field(default="sds.ep.ai-automation-maintenance")
    logstash_transport: str = Field(default="tcp")
    logstash_database_path: str = Field(default="")

    @field_validator("maint_scan_cron", "maint_summary_cron")
    @classmethod
    def validate_cron_fields(cls, v: str) -> str:
        return _validate_cron(v)

    @field_validator("logstash_transport", mode="before")
    @classmethod
    def validate_logstash_transport(cls, v: object) -> str:
        text = str(v or "tcp").strip().lower()
        if text not in {"udp", "tcp"}:
            raise ValueError("LOGSTASH_TRANSPORT must be 'udp' or 'tcp'")
        return text

maint_settings = MaintEnvSettings()
