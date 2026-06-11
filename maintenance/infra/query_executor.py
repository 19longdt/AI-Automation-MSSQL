"""
query_executor.py — Generic SQL executor.

Nhận QueryConfig + host → execute → trả về QueryResult.
Không biết gì về business logic — chỉ chạy SQL và trả rows.
Thread-safe: tạo connection mới mỗi lần execute.
"""
from __future__ import annotations

import datetime
import decimal
import logging
import time

from .metrics import QueryResult
from .query_config import QueryConfig
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


def _sanitize_value(v: object) -> object:
    """Convert pyodbc types mà MongoDB không encode được (Decimal → float, datetime → ISO string)."""
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, datetime.datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    return v


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
        start = time.monotonic()
        try:
            with mssql_connection(host, timeout_sec=query.timeout_sec) as conn:
                cursor = conn.execute(query.sql)
                columns = [col[0] for col in cursor.description] if cursor.description else []
                rows = [{col: _sanitize_value(val) for col, val in zip(columns, row)} for row in cursor.fetchall()]
            duration_ms = (time.monotonic() - start) * 1000
            logger.debug(
                "Query OK: topic=%s query=%s node=%s rows=%d duration_ms=%.1f",
                topic_id, query.query_id, host, len(rows), duration_ms,
            )
            return QueryResult(
                topic_id=topic_id,
                query_id=query.query_id,
                node=host,
                role=node_role,
                rows=rows,
                row_count=len(rows),
                duration_ms=duration_ms,
                success=True,
            )
        except Exception as exc:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error(
                "Query failed: topic=%s query=%s node=%s error=%s",
                topic_id, query.query_id, host, exc,
            )
            return QueryResult(
                topic_id=topic_id,
                query_id=query.query_id,
                node=host,
                role=node_role,
                duration_ms=duration_ms,
                success=False,
                error_message=str(exc),
            )

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
        results: list[QueryResult] = []
        try:
            with mssql_connection(host) as conn:
                for query in queries:
                    start = time.monotonic()
                    try:
                        # Enforce timeout per query trong batch mode để tránh treo job vô hạn.
                        conn.timeout = query.timeout_sec
                        cursor = conn.execute(query.sql)
                        columns = (
                            [col[0] for col in cursor.description]
                            if cursor.description
                            else []
                        )
                        rows = [{col: _sanitize_value(val) for col, val in zip(columns, row)} for row in cursor.fetchall()]
                        duration_ms = (time.monotonic() - start) * 1000
                        logger.debug(
                            "Query OK (batch): topic=%s query=%s node=%s rows=%d",
                            topic_id, query.query_id, host, len(rows),
                        )
                        results.append(
                            QueryResult(
                                topic_id=topic_id,
                                query_id=query.query_id,
                                node=host,
                                role=node_role,
                                rows=rows,
                                row_count=len(rows),
                                duration_ms=duration_ms,
                                success=True,
                            )
                        )
                    except Exception as exc:
                        duration_ms = (time.monotonic() - start) * 1000
                        logger.error(
                            "Query failed (batch): topic=%s query=%s node=%s error=%s",
                            topic_id, query.query_id, host, exc,
                        )
                        results.append(
                            QueryResult(
                                topic_id=topic_id,
                                query_id=query.query_id,
                                node=host,
                                role=node_role,
                                duration_ms=duration_ms,
                                success=False,
                                error_message=str(exc),
                            )
                        )
        except Exception as exc:
            # Kết nối đến host thất bại hoàn toàn — tất cả queries của host này fail
            logger.error("Connection failed: topic=%s node=%s error=%s", topic_id, host, exc)
            for query in queries:
                results.append(
                    QueryResult(
                        topic_id=topic_id,
                        query_id=query.query_id,
                        node=host,
                        role=node_role,
                        success=False,
                        error_message=f"Connection failed: {exc}",
                    )
                )
        return results
