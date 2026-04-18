"""
base_collector.py — Abstract base class cho tất cả collectors.

Mỗi collector con implement collect_node() để query 1 node.
BaseCollector.run_all_nodes() chạy parallel qua ThreadPoolExecutor —
3 nodes query concurrent thay vì sequential (tiết kiệm 2/3 thời gian).

Thread safety: pyodbc connection KHÔNG thread-safe.
BaseCollector tạo connection mới trong mỗi thread qua _connect(node).
KHÔNG lưu connection là class attribute hay instance attribute tồn tại qua threads.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from typing import Generator

import pyodbc

from ..config import ConfigManager
from ..models.metrics import CollectorResult, RawMetric

logger = logging.getLogger(__name__)


class BaseCollector(ABC):
    """Abstract base cho tất cả MSSQL collectors."""

    # Override trong subclass để set query timeout phù hợp
    QUERY_TIMEOUT_SEC: int = 30

    def __init__(self, cfg: ConfigManager) -> None:
        self._cfg = cfg

    @abstractmethod
    def collect_node(self, node_host: str) -> list[RawMetric]:
        """
        Thu thập metrics từ 1 node. Tạo connection mới trong method này.
        Phải trả về [] thay vì raise nếu node unavailable.
        """
        ...

    def run_all_nodes(self) -> list[CollectorResult]:
        """
        Chạy collect_node() trên tất cả nodes song song qua ThreadPoolExecutor.
        Mỗi node trong thread riêng với connection riêng — thread-safe.
        Max workers = số nodes để tránh tạo thừa threads.
        """
        ...

    @contextmanager
    def _connect(self, node_host: str) -> Generator[pyodbc.Connection, None, None]:
        """
        Context manager tạo và đóng pyodbc connection.
        Tạo mới mỗi lần gọi — KHÔNG cache connection.
        Set AUTOCOMMIT=True vì collectors chỉ đọc, không cần transaction.
        """
        ...

    def _execute_query(self, conn: pyodbc.Connection, sql: str, params: tuple = ()) -> list[pyodbc.Row]:
        """
        Execute query với timeout. Trả về [] và log WARNING nếu timeout.
        Tất cả DMV queries phải có TOP N hoặc WHERE thời gian — enforce ở đây
        bằng cách check sql string chứa 'TOP' hoặc 'WHERE' (dev-time guard).
        """
        ...
