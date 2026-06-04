"""
config.py — Env vars riêng cho maintenance runner.

Connection/credentials (MSSQL, MongoDB, Telegram) reuse từ layer1.config.settings.
Ở đây chỉ chứa cấu hình lịch chạy và chế độ thực thi của maintenance process.
Window/budget/policy KHÔNG ở đây — chúng là dynamic config trong MongoDB.
"""
from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _validate_cron(expr: str) -> str:
    """5 field cron đơn giản — fail fast tại startup thay vì lúc register job."""
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Cron expression phải có 5 fields: {expr!r}")
    return expr.strip()


class MaintEnvSettings(BaseSettings):
    """Config maintenance process. Load 1 lần khi startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        # .env chứa key của layer1/layer2 — ignore thay vì forbid
        extra="ignore",
    )

    # Cron (giờ VN) cho job scan + gửi batch approval — chạy buổi tối TRƯỚC window
    # để DBA có thời gian duyệt trước khi window mở.
    maint_scan_cron: str = Field(default="0 20 * * *")

    # Cron (giờ VN) gửi tổng kết đêm — đặt SAU window end.
    maint_summary_cron: str = Field(default="30 5 * * *")

    # Interval tick execute (giây). Mỗi tick xử lý tối đa 1 item —
    # để tái kiểm tra window/kill-switch thường xuyên.
    maint_tick_sec: int = Field(default=60, ge=10)

    # DRY RUN: default TRUE — chỉ log statement, không execute DDL.
    # Phải chủ động set MAINT_DRY_RUN=false sau khi đã verify trên môi trường thật.
    maint_dry_run: bool = Field(default=True)

    # Số lần gate-fail/error trước khi item bị skipped/failed hẳn.
    maint_max_attempts: int = Field(default=3, ge=1)

    # Heuristic ước lượng duration: số pages xử lý được mỗi phút khi REBUILD.
    maint_estimate_pages_per_minute: int = Field(default=150_000, ge=1000)

    # Heuristic cho UPDATE STATISTICS: số rows scan được mỗi phút (FULLSCAN).
    maint_estimate_rows_per_minute: int = Field(default=2_000_000, ge=10_000)

    # Số item top-priority gửi nút approve riêng trên Telegram (keyboard limit).
    maint_batch_top_n_items: int = Field(default=10, ge=0, le=20)

    # Batch chưa được duyệt quá số giờ này → expire (không bao giờ chạy).
    maint_approval_expire_hours: int = Field(default=30, ge=1)

    @field_validator("maint_scan_cron", "maint_summary_cron")
    @classmethod
    def validate_cron_fields(cls, v: str) -> str:
        return _validate_cron(v)


# Singleton — import maint_settings từ module này
maint_settings = MaintEnvSettings()
