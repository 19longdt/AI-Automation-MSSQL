"""
mongo.py — Database handle riêng cho maintenance process.

Reuse MongoClient của Layer 1 (cùng connection pool, không tạo thêm kết nối)
nhưng trỏ vào database khác (MAINT_MONGODB_DB, default: db_maintenance).

Lý do tách DB: các collection maintenance (queue, history, policies...) không
liên quan đến monitoring (findings, raw_metrics, baselines...) — tách giúp
backup/retention/access-control độc lập và tránh index/collection clutter.
"""
from __future__ import annotations

from pymongo.database import Database

from ..storage.mongo_client import MongoConnection
from .config import maint_settings


def get_maint_db() -> Database:
    """Trả về maintenance Database instance. MongoConnection phải được initialize trước."""
    return MongoConnection.get_client()[maint_settings.maint_mongodb_db]
