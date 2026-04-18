"""
baseline_repo.py — Repository cho collection `baselines`.

Day-of-week aware baseline: mỗi record là average của cùng ngày trong tuần
+ cùng giờ trong N tuần gần nhất. Không dùng rolling average vì workload
có pattern theo ngày (Thứ Hai cao điểm, Chủ Nhật thấp).
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "baselines"


class BaselineRepo:

    @property
    def collection(self): ...

    def get_baseline(
        self,
        metric_type: str,
        node: str,
        day_of_week: int,
        hour: int,
        query_hash: str | None = None,
    ) -> dict | None:
        """
        Trả về baseline document cho metric_type + node + day_of_week + hour.
        day_of_week: 0=Monday … 6=Sunday (Python weekday()).
        """
        ...

    def upsert_baseline(
        self,
        metric_type: str,
        node: str,
        day_of_week: int,
        hour: int,
        new_sample: dict,
        query_hash: str | None = None,
        max_samples: int = 4,
    ) -> None:
        """
        Thêm sample mới vào danh sách samples, giữ tối đa max_samples tuần gần nhất.
        Tính lại baseline_avg và baseline_stddev sau khi update.
        Dùng $push + $slice thay vì read-modify-write để atomic.
        """
        ...

    def is_anomaly(
        self,
        metric_type: str,
        node: str,
        current_value: float,
        day_of_week: int,
        hour: int,
        threshold_pct: float,
        query_hash: str | None = None,
    ) -> bool:
        """
        Kiểm tra current_value có vượt baseline_avg * (1 + threshold_pct/100) không.
        Trả về False nếu chưa có baseline (chưa đủ dữ liệu).
        """
        ...
