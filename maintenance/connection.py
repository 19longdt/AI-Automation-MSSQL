"""
connection.py — pyodbc connection cho maintenance ACTION statements.

KHÔNG dùng executor.mssql_connection: nó set conn.timeout = mssql_query_timeout_sec
(default 30s) — ALTER INDEX REBUILD trên index lớn chạy hàng chục phút sẽ bị abort.

Budget/window được kiểm soát ở tầng khác:
  - Admission control: chỉ start item có estimate vừa budget còn lại
  - MAX_DURATION (resumable rebuild): server tự PAUSE khi hết giờ
nên statement timeout = 0 (không giới hạn) là an toàn.
"""
from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

import pyodbc

from .config import maint_settings as settings


@contextmanager
def maint_connection(host: str) -> Generator[pyodbc.Connection, None, None]:
    """
    Connection cho ALTER INDEX / UPDATE STATISTICS.

    autocommit=True: mỗi statement là transaction riêng — tránh 1 transaction
    khổng lồ giữ transaction log suốt nhiều statement.
    Tạo mới per-call, KHÔNG cache (pyodbc không thread-safe).
    """
    conn = pyodbc.connect(
        settings.get_connection_string(host),
        timeout=15,  # login/connect timeout — kết nối thất bại phải fail nhanh
        autocommit=True,
    )
    conn.timeout = 0  # statement timeout: 0 = không giới hạn
    try:
        yield conn
    finally:
        conn.close()
