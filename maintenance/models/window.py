"""
window.py - Maintenance window config (dynamic trong MongoDB) + computed state.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


def _parse_hhmm(value: str) -> tuple[int, int]:
    parts = value.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Giờ phải có format HH:MM: {value!r}")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Giờ không hợp lệ: {value!r}")
    return hour, minute


class WindowSlot(BaseModel):
    start: str = "02:30"
    end: str = "05:00"
    time_budget_minutes: int = Field(default=150, ge=1)

    @field_validator("start", "end")
    @classmethod
    def validate_hhmm(cls, value: str) -> str:
        _parse_hhmm(value)
        return value.strip()

    def start_tuple(self) -> tuple[int, int]:
        return _parse_hhmm(self.start)

    def end_tuple(self) -> tuple[int, int]:
        return _parse_hhmm(self.end)

    def crosses_midnight(self) -> bool:
        return self.start_tuple() > self.end_tuple()


DEFAULT_GATES = {
    "cpu_max_pct": 60,
    "active_requests_max": 50,
    "log_send_queue_max_kb": 100_000,
    "redo_queue_max_kb": 200_000,
}


class HealthMonitorConfig(BaseModel):
    enabled: bool = True
    interval_sec: int = 30
    cpu_max_pct: float = 80.0
    active_requests_max: int = 60
    log_send_queue_max_kb: int | None = None
    redo_queue_max_kb: int | None = None
    auto_resume: bool = True


class MaintenanceWindow(BaseModel):
    window_id: str
    cluster_id: str
    enabled: bool = True
    default: WindowSlot = Field(default_factory=WindowSlot)
    day_overrides: dict[str, WindowSlot | None] = Field(default_factory=dict)
    kill_switch: bool = False
    gates: dict[str, int | None] = Field(default_factory=dict)
    health_monitor: HealthMonitorConfig = Field(default_factory=HealthMonitorConfig)

    def slot_for_weekday(self, weekday: int) -> WindowSlot:
        return self.day_overrides.get(str(weekday)) or self.default

    def effective_gates(self) -> dict[str, int]:
        merged = dict(DEFAULT_GATES)
        merged.update({key: value for key, value in self.gates.items() if value is not None})
        return merged


class WindowState(BaseModel):
    open: bool
    remaining_minutes: float = 0.0
    reason: str = ""
