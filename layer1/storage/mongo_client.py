"""
mongo_client.py — MongoDB connection singleton cho toàn service.

pymongo MongoClient là thread-safe và quản lý connection pool nội bộ.
Tất cả repositories dùng chung 1 instance duy nhất — không tạo mới per-job.

Retry strategy: exponential backoff với tenacity khi MongoDB unavailable.
Collector jobs không crash khi MongoDB down — chỉ log CRITICAL và skip write.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pymongo import MongoClient
from pymongo.database import Database

if TYPE_CHECKING:
    from ..config import ConfigManager

logger = logging.getLogger(__name__)


class MongoConnection:
    """Singleton wrapper cho MongoClient."""

    _client: MongoClient | None = None
    _db: Database | None = None

    @classmethod
    def initialize(cls, cfg: ConfigManager) -> None:
        """
        Khởi tạo connection pool. Gọi 1 lần khi service startup.
        Raise ConnectionError nếu không kết nối được — MongoDB là hard dependency.
        """
        ...

    @classmethod
    def get_db(cls) -> Database:
        """Trả về database instance. Raise nếu chưa initialize."""
        ...

    @classmethod
    def close(cls) -> None:
        """Đóng connection khi service shutdown."""
        ...

    @classmethod
    def ping(cls) -> bool:
        """Health check — dùng trong job_manager health checker."""
        ...
