"""Unit tests cho WindowService — biên window, qua đêm, day override, budget."""
from __future__ import annotations

from datetime import datetime

from layer1.maintenance.models.window import MaintenanceWindow, WindowSlot
from layer1.maintenance.window.window_service import WindowService


class FakeWindowRepo:
    def __init__(self, window: MaintenanceWindow | None) -> None:
        self.window = window

    def get(self) -> MaintenanceWindow | None:
        return self.window


class FakeHistoryRepo:
    def __init__(self, used_minutes: float = 0.0) -> None:
        self.used_minutes = used_minutes

    def sum_done_minutes_between(self, since, until) -> float:
        return self.used_minutes


def _window(**kwargs) -> MaintenanceWindow:
    defaults = dict(
        window_id="default",
        enabled=True,
        default=WindowSlot(start="01:00", end="04:00", time_budget_minutes=170),
        kill_switch=False,
    )
    defaults.update(kwargs)
    return MaintenanceWindow(**defaults)


def _service(window: MaintenanceWindow | None, used: float = 0.0) -> WindowService:
    return WindowService(FakeWindowRepo(window), FakeHistoryRepo(used))


# Thứ 4 2026-06-03 (weekday=2)
WED_0200 = datetime(2026, 6, 3, 2, 0)
WED_1200 = datetime(2026, 6, 3, 12, 0)


def test_open_inside_window():
    state = _service(_window()).state(WED_0200)
    assert state.open is True
    assert state.reason == "open"
    # 120p đến 04:00, budget 170p → remaining = 120
    assert state.remaining_minutes == 120.0


def test_closed_outside_window():
    state = _service(_window()).state(WED_1200)
    assert state.open is False
    assert state.reason == "outside_window"


def test_budget_exhausted():
    state = _service(_window(), used=170.0).state(WED_0200)
    assert state.open is False
    assert state.reason == "budget_exhausted"


def test_remaining_capped_by_budget():
    # Mới 01:10, còn 170p wall-clock nhưng đã dùng 150p budget → remaining 20
    state = _service(_window(), used=150.0).state(datetime(2026, 6, 3, 1, 10))
    assert state.open is True
    assert state.remaining_minutes == 20.0


def test_kill_switch_closes_window():
    state = _service(_window(kill_switch=True)).state(WED_0200)
    assert state.open is False
    assert state.reason == "kill_switch"


def test_disabled_window():
    state = _service(_window(enabled=False)).state(WED_0200)
    assert state.reason == "disabled"


def test_missing_config():
    state = _service(None).state(WED_0200)
    assert state.reason == "missing_config"


def test_crosses_midnight_belongs_to_start_day():
    """Window 23:00–04:00 bắt đầu Thứ 3 (weekday=1) — 02:00 Thứ 4 vẫn thuộc window đó."""
    window = _window(
        default=WindowSlot(start="23:00", end="04:00", time_budget_minutes=280),
    )
    state = _service(window).state(WED_0200)  # 02:00 Thứ 4
    assert state.open is True
    # 120p đến 04:00
    assert state.remaining_minutes == 120.0


def test_day_override_applies_to_start_day():
    """Override weekday 1 (Thứ 3) áp dụng cho window qua đêm bắt đầu Thứ 3."""
    window = _window(
        default=WindowSlot(start="01:00", end="02:00", time_budget_minutes=55),
        day_overrides={"1": WindowSlot(start="22:00", end="03:00", time_budget_minutes=290)},
    )
    # 02:30 Thứ 4: default window (01:00-02:00 Thứ 4) đã đóng,
    # nhưng override Thứ 3 (22:00→03:00) vẫn mở
    state = _service(window).state(datetime(2026, 6, 3, 2, 30))
    assert state.open is True
    assert state.remaining_minutes == 30.0


def test_last_window_bounds_for_summary():
    window = _window()
    # 05:30 sáng — window đêm qua (01:00–04:00 hôm nay) đã đóng
    bounds = WindowService.last_window_bounds(window, datetime(2026, 6, 3, 5, 30))
    assert bounds is not None
    start, end, slot = bounds
    assert start == datetime(2026, 6, 3, 1, 0)
    assert end == datetime(2026, 6, 3, 4, 0)
    assert slot.time_budget_minutes == 170
