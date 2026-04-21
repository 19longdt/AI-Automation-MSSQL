"""
mongo_client.py — MongoDB connection singleton cho Layer 2.

pymongo MongoClient là thread-safe và quản lý connection pool nội bộ.
Tất cả repositories dùng chung 1 instance — không tạo mới per-request.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pymongo import MongoClient
from pymongo.database import Database

if TYPE_CHECKING:
    from ..config import Layer2Settings

logger = logging.getLogger(__name__)


class MongoConnection:
    """Singleton wrapper cho MongoClient."""

    _client: MongoClient | None = None
    _db: Database | None = None

    @classmethod
    def initialize(cls, cfg: "Layer2Settings") -> None:
        """
        Khởi tạo connection pool. Gọi 1 lần khi service startup.
        Raise ConnectionError nếu không kết nối được — MongoDB là hard dependency.
        """
        # tz_aware=False: pymongo trả naive datetime khi đọc.
        # Giữ nhất quán với Layer 1 — tất cả datetime lưu là VN wall clock naive.
        client = MongoClient(
            cfg.mongodb_uri,
            serverSelectionTimeoutMS=5000,
            tz_aware=False,
        )
        client.admin.command("ping")
        cls._client = client
        cls._db = client[cfg.mongodb_db]
        logger.info("MongoDB connected: uri=%s db=%s", cfg.mongodb_uri, cfg.mongodb_db)

    @classmethod
    def get_db(cls) -> Database:
        """Trả về database instance. Raise nếu chưa initialize."""
        if cls._db is None:
            raise RuntimeError("MongoConnection chưa được initialize. Gọi initialize() trước.")
        return cls._db

    @classmethod
    def close(cls) -> None:
        """Đóng connection khi service shutdown."""
        if cls._client is not None:
            cls._client.close()
            cls._client = None
            cls._db = None
            logger.info("MongoDB connection closed.")

    @classmethod
    def ping(cls) -> bool:
        """Health check — dùng trong GET /health endpoint."""
        if cls._client is None:
            return False
        try:
            cls._client.admin.command("ping")
            return True
        except Exception as exc:
            logger.warning("MongoDB ping failed: %s", exc)
            return False
