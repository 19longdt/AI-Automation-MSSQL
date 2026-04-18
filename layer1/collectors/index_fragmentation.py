"""
index_fragmentation.py — Scan fragmentation trên tất cả nodes (check 1.3).

Chạy 1 lần/ngày lúc 03:00 AM (daily cron trigger, không phải interval).
dm_db_index_physical_stats với mode='LIMITED' để tránh scan toàn bộ B-tree
— LIMITED đủ cho avg_fragmentation nhưng không accurate như SAMPLED/DETAILED.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class IndexFragmentationCollector(BaseCollector):

    METRIC_INDEX_FRAG = "index_fragmentation"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """
        dm_db_index_physical_stats(LIMITED): avg_fragmentation, page_count.
        Chỉ lấy index có page_count > index_frag_min_page_count để bỏ qua index nhỏ.
        """
        ...
