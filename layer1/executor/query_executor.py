"""
query_executor.py — Generic SQL executor.

Nhận QueryConfig + host → execute → trả về QueryResult.
Không biết gì về business logic — chỉ chạy SQL và trả rows.
Thread-safe: tạo connection mới mỗi lần execute.
"""
from __future__ import annotations

import logging
import time

from ..models.topic import QueryConfig
from ..models.metrics import QueryResult
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


class QueryExecutor:
    """Execute 1 query trên 1 node, trả về QueryResult."""

    def execute(
        self,
        query: QueryConfig,
        host: str,
        topic_id: str,
        node_role: str,
    ) -> QueryResult:
        """
        Execute query.sql trên host, trả về QueryResult.

        Không raise exception — mọi lỗi capture vào QueryResult.error_message.
        Caller (TopicRunner) không cần try/except.
        """
        ...

    def execute_batch(
        self,
        queries: list[QueryConfig],
        host: str,
        topic_id: str,
        node_role: str,
    ) -> list[QueryResult]:
        """
        Execute nhiều queries trên cùng 1 host, dùng chung 1 connection.
        Tối ưu: 1 connection per node thay vì 1 connection per query.
        """
        ...
