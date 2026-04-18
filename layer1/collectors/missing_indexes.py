"""
missing_indexes.py — Thu thập missing index suggestions từ DMV (check 1.4).

dm_db_missing_index_details reset khi SQL Server restart — không có history.
improvement_measure = avg_total_user_cost × avg_user_impact × (seeks + scans)
là metric composite phản ánh cả tần suất lẫn benefit ước tính.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class MissingIndexesCollector(BaseCollector):

    METRIC_MISSING_INDEX = "missing_index"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """
        TOP 20 missing indexes có improvement_measure > missing_index_min_measure.
        Kèm equality_columns, inequality_columns, included_columns để AI đánh giá
        liệu có thể merge vào existing index hay cần tạo mới.
        """
        ...
