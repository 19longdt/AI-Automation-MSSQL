"""
db_context_repo.py — Repository cho collection `db_context`.

Singleton document (context_id='main') — merge từ 2 nguồn:
  schema_info      ← auto-collect từ MSSQL (sys.tables, indexes, partition, AG, RG, CDC)
  business_context ← DBA viết thủ công trong db_business_context.yaml

Refresh khi:
  - Deploy lần đầu (POST /admin/refresh-db-context)
  - Thêm/sửa index quan trọng
  - Auto-refresh mỗi DB_CONTEXT_MAX_AGE_HOURS (default 24h)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ...utils.time_utils import now_vn
from ..mongo_client import MongoConnection

logger = logging.getLogger(__name__)

COLLECTION = "db_context"
CONTEXT_ID = "main"


class DbContextRepo:

    @property
    def _col(self):
        return MongoConnection.get_db()[COLLECTION]

    def upsert(
        self,
        schema_info: dict[str, Any],
        business_context: dict[str, Any],
        schema_version: str = "",
    ) -> None:
        """
        Upsert singleton db_context document.
        Gọi từ admin/refresh-db-context endpoint sau khi collect xong.
        """
        doc = {
            "context_id": CONTEXT_ID,
            "schema_info": schema_info,
            "business_context": business_context,
            "schema_version": schema_version,
            "collected_at": now_vn(),
        }
        self._col.update_one(
            {"context_id": CONTEXT_ID},
            {"$set": doc},
            upsert=True,
        )
        logger.info("db_context upserted schema_version=%s", schema_version)

    def get(self) -> dict[str, Any] | None:
        """Lấy singleton document. Trả về None nếu chưa collect lần nào."""
        doc = self._col.find_one({"context_id": CONTEXT_ID})
        if doc:
            doc.pop("_id", None)
        return doc

    def get_collected_at(self) -> datetime | None:
        """Lấy thời điểm collect gần nhất — dùng để check có cần auto-refresh không."""
        doc = self._col.find_one(
            {"context_id": CONTEXT_ID},
            projection={"collected_at": 1, "_id": 0},
        )
        if not doc:
            return None
        return doc.get("collected_at")

    def is_stale(self, max_age_hours: int) -> bool:
        """
        Trả về True nếu context chưa có hoặc đã cũ hơn max_age_hours.
        ContextBuilder dùng để trigger auto-refresh trước khi build prompt.
        """
        collected_at = self.get_collected_at()
        if collected_at is None:
            return True
        age_seconds = (now_vn() - collected_at).total_seconds()
        return age_seconds > max_age_hours * 3600
