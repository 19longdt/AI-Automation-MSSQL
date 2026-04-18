"""
resource_governor.py — Monitor Resource Governor pool CPU usage (check 1.5).

Chạy trên Primary vì Resource Governor config trên Primary.
Alert khi pool vượt max_cpu_percent liên tục trong resource_pool_sustained_min phút
— tránh false positive từ burst ngắn.
"""
from __future__ import annotations

import logging

from .base_collector import BaseCollector
from ..models.metrics import RawMetric

logger = logging.getLogger(__name__)


class ResourceGovernorCollector(BaseCollector):

    METRIC_RESOURCE_POOL = "resource_pool_usage"

    def collect_node(self, node_host: str) -> list[RawMetric]:
        """
        sys.dm_resource_governor_resource_pools: active_request_count, active_worker_count.
        sys.resource_governor_resource_pools: max_cpu_percent, min_cpu_percent.
        """
        ...
