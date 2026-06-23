"""
window_service.py — Tính trạng thái maintenance window tại 1 thời điểm.

Window theo giờ VN. Hỗ trợ qua đêm (start 23:00 end 04:00).
remaining_minutes = min(budget còn lại, phút đến khi window đóng) —
admission control dùng giá trị này để quyết định có start item không.

Đọc window config fresh mỗi lần (qua WindowRepo) — DBA sửa có hiệu lực ngay.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from ..models.window import MaintenanceWindow, WindowSlot, WindowState
from ..repositories.history_repo import HistoryRepo
from ..repositories.window_repo import WindowRepo

logger = logging.getLogger(__name__)


class WindowService:

    def __init__(self, cluster_id: str, window_repo: WindowRepo, history_repo: HistoryRepo) -> None:
        self._cluster_id = cluster_id
        self._window_repo = window_repo
        self._history_repo = history_repo

    def state(self, now: datetime) -> WindowState:
        """Trạng thái window tại `now` (naive VN time — truyền now_vn())."""
        window = self._window_repo.find_by_cluster(self._cluster_id)
        if window is None:
            return WindowState(open=False, reason="missing_config")
        if not window.enabled:
            return WindowState(open=False, reason="disabled")
        if window.kill_switch:
            return WindowState(open=False, reason="kill_switch")

        bounds = self.current_window_bounds(window, now)
        if bounds is None:
            return WindowState(open=False, reason="outside_window")
        window_start, window_end, slot = bounds

        used_minutes = self._history_repo.sum_done_minutes_between(self._cluster_id, window_start, now)
        budget_left = slot.time_budget_minutes - used_minutes
        minutes_to_end = (window_end - now).total_seconds() / 60.0
        remaining = min(budget_left, minutes_to_end)

        if remaining <= 0:
            return WindowState(open=False, remaining_minutes=0.0, reason="budget_exhausted")
        return WindowState(open=True, remaining_minutes=round(remaining, 1), reason="open")

    def current_slot(self, now: datetime) -> WindowSlot | None:
        """Slot của window gần nhất (đang mở hoặc đêm vừa rồi) — cho summary."""
        window = self._window_repo.find_by_cluster(self._cluster_id)
        if window is None:
            return None
        bounds = self.current_window_bounds(window, now)
        if bounds is not None:
            return bounds[2]
        # Ngoài window — trả slot của đêm gần nhất (hôm qua/hôm nay tùy giờ)
        last = self.last_window_bounds(window, now)
        return last[2] if last else None

    @staticmethod
    def current_window_bounds(
        window: MaintenanceWindow, now: datetime
    ) -> tuple[datetime, datetime, WindowSlot] | None:
        """
        (start, end, slot) của window ĐANG MỞ chứa `now`, hoặc None nếu ngoài window.

        day_overrides key theo weekday của ngày window BẮT ĐẦU — window qua đêm
        bắt đầu 23:00 Thứ 2 thuộc về override của Thứ 2 kể cả khi now là 2h Thứ 3.
        """
        # Window có thể bắt đầu hôm nay hoặc hôm qua (trường hợp qua đêm)
        for day_offset in (0, -1):
            day = (now + timedelta(days=day_offset)).date()
            slot = window.slot_for_weekday(day.weekday())
            sh, sm = slot.start_tuple()
            eh, em = slot.end_tuple()
            start = datetime(day.year, day.month, day.day, sh, sm)
            end = datetime(day.year, day.month, day.day, eh, em)
            if slot.crosses_midnight():
                end += timedelta(days=1)
            if start <= now < end:
                return start, end, slot
        return None

    @staticmethod
    def last_window_bounds(
        window: MaintenanceWindow, now: datetime
    ) -> tuple[datetime, datetime, WindowSlot] | None:
        """Bounds của window gần nhất ĐÃ ĐÓNG trước `now` — cho nightly summary."""
        for day_offset in (0, -1, -2):
            day = (now + timedelta(days=day_offset)).date()
            slot = window.slot_for_weekday(day.weekday())
            sh, sm = slot.start_tuple()
            eh, em = slot.end_tuple()
            start = datetime(day.year, day.month, day.day, sh, sm)
            end = datetime(day.year, day.month, day.day, eh, em)
            if slot.crosses_midnight():
                end += timedelta(days=1)
            if end <= now:
                return start, end, slot
        return None
