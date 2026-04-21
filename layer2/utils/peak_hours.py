"""
peak_hours.py — Kiểm tra giờ cao điểm.

Một số DMV tool tốn I/O nặng (ví dụ: scan allocation units để đo fragmentation)
sẽ được đánh dấu `block_in_peak_hours=True` trong tool_registry.py (Phase 4).
Trong peak hours, tool_executor sẽ skip các tool đó và trả về error result
để Claude biết và tiếp tục với tool khác.

Cách dùng (Phase 4 — tool_executor.py):
    if tool_def.block_in_peak_hours and is_peak_hours(settings.peak_hours_start, settings.peak_hours_end):
        return {"error": f"Tool '{tool_name}' không khả dụng trong giờ cao điểm (peak hours)."}
"""
from __future__ import annotations

from .time_utils import now_vn


def is_peak_hours(start_hour: int = 8, end_hour: int = 18) -> bool:
    """
    Trả về True nếu giờ hiện tại (VN) nằm trong peak hours.

    Args:
        start_hour: Giờ bắt đầu peak (inclusive), 0-23.
        end_hour:   Giờ kết thúc peak (exclusive), 0-23.
    """
    current_hour = now_vn().hour
    return start_hour <= current_hour < end_hour
