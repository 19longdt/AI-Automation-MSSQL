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
        extra="ignore",
    )

    mongodb_uri: str = Field(default="mongodb://localhost:27017")
    monitor_mongodb_db: str = Field(default="db_monitor")
    maint_mongodb_db: str = Field(default="db_maintenance")
    mssql_query_timeout_sec: int = Field(default=30)

    maint_catalog_cron: str = Field(default="0 6 * * *")
    maint_summary_cron: str = Field(default="30 5 * * *")
    maint_tick_sec: int = Field(default=60, ge=10)
    maint_dry_run: bool = Field(default=True)
    maint_max_attempts: int = Field(default=3, ge=1)
    maint_estimate_pages_per_minute: int = Field(default=150_000, ge=1000)
    maint_estimate_rows_per_minute: int = Field(default=2_000_000, ge=10_000)
    maint_batch_top_n_items: int = Field(default=10, ge=0, le=20)
    maint_approval_expire_hours: int = Field(default=30, ge=1)
    maint_catalog_max_workers: int = Field(default=8, ge=1, le=32)
    maint_catalog_table_timeout_sec: int = Field(default=120, ge=5)
    maint_node_role_refresh_sec: int = Field(default=1800, ge=60)

    maint_telegram_bot_token: str
    telegram_chat_id: str

    log_level: str = Field(
        default="INFO",
        validation_alias=AliasChoices("MAINT_LOG_LEVEL", "LOG_LEVEL"),
    )
    logstash_host: str = Field(default="")
    logstash_port: int = Field(default=5044)
    logstash_app_name: str = Field(
        default="sds.ep.mssql-automation-maintenance",
        validation_alias=AliasChoices("MAINT_LOGSTASH_APP_NAME", "LOGSTASH_APP_NAME"),
    )
    logstash_transport: str = Field(default="tcp")
    logstash_database_path: str = Field(default="")

    elastic_apm_server_url: str = Field(
        default="",
        validation_alias=AliasChoices("MAINT_ELASTIC_APM_SERVER_URL", "ELASTIC_APM_SERVER_URL"),
    )
    elastic_apm_secret_token: str = Field(
        default="",
        validation_alias=AliasChoices("MAINT_ELASTIC_APM_SECRET_TOKEN", "ELASTIC_APM_SECRET_TOKEN"),
    )
    elastic_apm_service_name: str = Field(
        default="maintenance-runner",
        validation_alias=AliasChoices("MAINT_ELASTIC_APM_SERVICE_NAME", "ELASTIC_APM_SERVICE_NAME"),
    )
    elastic_apm_environment: str = Field(
        default="production",
        validation_alias=AliasChoices("MAINT_ELASTIC_APM_ENVIRONMENT", "ELASTIC_APM_ENVIRONMENT"),
    )
    elastic_apm_service_version: str = Field(
        default="",
        validation_alias=AliasChoices("MAINT_ELASTIC_APM_SERVICE_VERSION", "ELASTIC_APM_SERVICE_VERSION"),
    )

    @field_validator("maint_catalog_cron", "maint_summary_cron")
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
