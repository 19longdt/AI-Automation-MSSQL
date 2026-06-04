"""
duration_estimator.py — Heuristic ước lượng phút thực thi 1 work item.

Mục đích: admission control (chỉ start item vừa budget còn lại) +
hiển thị est trong Telegram batch. Không cần chính xác tuyệt đối —
sai số được bù bằng MAX_DURATION (server tự PAUSE resumable rebuild).
"""
from __future__ import annotations

import math

from ..models.work_item import ActionType, WorkItem

_MIN_MINUTES = 1.0


class DurationEstimator:

    def __init__(self, pages_per_minute: int, rows_per_minute: int) -> None:
        self._pages_per_minute = max(pages_per_minute, 1)
        self._rows_per_minute = max(rows_per_minute, 1)

    def estimate_minutes(self, item: WorkItem) -> float:
        """Ước lượng phút theo action type + metrics."""
        m = item.metrics

        if item.action_type in (ActionType.REBUILD, ActionType.REBUILD_PARTITION, ActionType.HEAP_REBUILD):
            pages = m.page_count or 0
            return max(_MIN_MINUTES, pages / self._pages_per_minute)

        if item.action_type == ActionType.REORGANIZE:
            # REORGANIZE chỉ di chuyển pages fragmented — scale theo frag%.
            pages = m.page_count or 0
            frag_ratio = min((m.fragmentation_pct or 100.0) / 100.0, 1.0)
            return max(_MIN_MINUTES, pages * frag_ratio / self._pages_per_minute)

        if item.action_type == ActionType.UPDATE_STATISTICS:
            rows = m.rows or 0
            return max(_MIN_MINUTES, rows / self._rows_per_minute)

        return _MIN_MINUTES

    @staticmethod
    def priority(item: WorkItem, priority_boost: int = 0) -> int:
        """
        Priority claim order: action nặng/ảnh hưởng lớn trước.
        base theo action + frag% (cap 50) + log10(page_count) + boost từ policy.
        """
        base_by_action = {
            ActionType.REBUILD: 30,
            ActionType.REBUILD_PARTITION: 30,
            ActionType.HEAP_REBUILD: 25,
            ActionType.REORGANIZE: 20,
            ActionType.UPDATE_STATISTICS: 10,
        }
        base = base_by_action.get(item.action_type, 0)
        frag = min(item.metrics.fragmentation_pct or 0.0, 50.0)
        pages = item.metrics.page_count or item.metrics.rows or 0
        size_score = math.log10(pages) if pages > 0 else 0.0
        return int(base + frag + size_score + priority_boost)
