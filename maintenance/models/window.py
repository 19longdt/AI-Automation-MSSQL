"""
window.py — Maintenance window config (dynamic trong MongoDB) + computed state.

Window theo giờ VN (now_vn). Hỗ trợ window qua đêm (start 23:00, end 04:00).
day_overrides key = weekday của ngày window BẮT ĐẦU ("0"=Mon .. "6"=Sun —
khớp convention day_of_week của baseline).
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
    """1 khung giờ window + budget."""

    start: str = "01:00"  # HH:MM giờ VN
    end: str = "04:00"
    time_budget_minutes: int = Field(default=170, ge=1)

    @field_validator("start", "end")
    @classmethod
    def validate_hhmm(cls, v: str) -> str:
        _parse_hhmm(v)
        return v.strip()

    def start_tuple(self) -> tuple[int, int]:
        return _parse_hhmm(self.start)

    def end_tuple(self) -> tuple[int, int]:
        return _parse_hhmm(self.end)

    def crosses_midnight(self) -> bool:
        return self.start_tuple() > self.end_tuple()


# Gate thresholds default — override được trong maintenance_window doc (field `gates`)
DEFAULT_GATES = {
    "cpu_max_pct": 60,
    "max_active_requests": 50,
    "max_log_send_queue_kb": 100_000,
    "max_redo_queue_kb": 200_000,
}


class MaintenanceWindow(BaseModel):
    """Document duy nhất trong `maintenance_window` (window_id="default")."""

    window_id: str = "default"
    enabled: bool = True
    default: WindowSlot = Field(default_factory=WindowSlot)
    # {"0": WindowSlot, ..., "6": WindowSlot} — 0=Mon
    day_overrides: dict[str, WindowSlot] = Field(default_factory=dict)
    # True = dừng execute sau item hiện tại (DBA bật qua Telegram/Web/Compass)
    kill_switch: bool = False
    # Safety gate thresholds — merge với DEFAULT_GATES
    gates: dict[str, int] = Field(default_factory=dict)

    def slot_for_weekday(self, weekday: int) -> WindowSlot:
        """weekday: 0=Mon..6=Sun (datetime.weekday())."""
        return self.day_overrides.get(str(weekday), self.default)

    def effective_gates(self) -> dict[str, int]:
        merged = dict(DEFAULT_GATES)
        merged.update(self.gates)
        return merged


class WindowState(BaseModel):
    """Trạng thái window tại 1 thời điểm — output của WindowService.state()."""

    open: bool
    remaining_minutes: float = 0.0
    reason: str = ""  # "open" | "outside_window" | "kill_switch" | "disabled" | "budget_exhausted"
