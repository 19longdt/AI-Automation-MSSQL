"""
mssql_connection.py — pyodbc connection context manager.

Thread safety: pyodbc.Connection KHÔNG thread-safe.
Mỗi lần gọi mssql_connection() tạo connection MỚI — KHÔNG cache, KHÔNG share.
Dùng AUTOCOMMIT=True vì service chỉ đọc (SELECT), không cần transaction.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

import pyodbc

from ..config import settings

logger = logging.getLogger(__name__)


@contextmanager
def mssql_connection(host: str, timeout_sec: int | None = None) -> Generator[pyodbc.Connection, None, None]:
    """
    Context manager tạo và đóng pyodbc connection.

    Args:
        host: hostname của MSSQL node
        timeout_sec: override connection timeout (None = dùng default từ config)

    Yields:
        pyodbc.Connection với AUTOCOMMIT=True

    Raises:
        pyodbc.Error: nếu không kết nối được — caller phải handle
    """
    timeout = timeout_sec if timeout_sec is not None else settings.mssql_query_timeout_sec
    conn_str = settings.get_connection_string(host)
    conn = pyodbc.connect(conn_str, timeout=timeout, autocommit=True)
    # pyodbc connect(timeout=...) chỉ là login/connect timeout.
    # Cần set conn.timeout để giới hạn thời gian thực thi statement.
    conn.timeout = timeout
    try:
        yield conn
    finally:
        conn.close()


def test_connection(host: str) -> bool:
    """Kiểm tra kết nối tới 1 node. Trả về False nếu unreachable."""
    try:
        with mssql_connection(host) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception as exc:
        logger.debug("test_connection failed for host=%s: %s", host, exc)
        return False
