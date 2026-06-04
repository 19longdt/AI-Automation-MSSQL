"""
policy.py — Policy maintenance per object (dynamic config trong MongoDB).

3 scope theo độ ưu tiên tăng dần: default < table < index.
PolicyResolver merge field-level: field nào override explicit set thì thắng.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from ...utils.time_utils import now_vn


class PolicyScope(str, Enum):
    DEFAULT = "default"
    TABLE = "table"
    INDEX = "index"


# Các field merge được khi resolve (default ← table ← index).
# Field định danh (policy_id, scope, schema/table/index_name, updated_at) không merge.
MERGEABLE_FIELDS = (
    "enabled",
    "reorganize_threshold_pct",
    "rebuild_threshold_pct",
    "min_page_count",
    "max_page_count",
    "maxdop",
    "online",
    "resumable",
    "offline_fallback",
    "stats_modification_threshold",
    "stats_fullscan",
    "stats_sample_pct",
    "heap_forwarded_records_threshold",
    "window_override",
    "priority_boost",
)


class MaintenancePolicy(BaseModel):
    """1 document trong `maintenance_policies`."""

    # "default" | "table:dbo.Bill" | "index:dbo.Bill.IX_Bill_Date"
    policy_id: str
    scope: PolicyScope
    schema_name: str | None = None
    table_name: str | None = None
    index_name: str | None = None

    # False = exclude object khỏi maintenance hoàn toàn
    enabled: bool = True

    # ── Index fragmentation ──────────────────────────────────────────────────
    reorganize_threshold_pct: float = 10.0
    rebuild_threshold_pct: float = 30.0
    min_page_count: int = 1000
    # None = không giới hạn. Set cho bảng quá lớn cần DBA xử lý tay.
    max_page_count: int | None = None
    maxdop: int = 4
    online: bool = True
    resumable: bool = True
    # Cho phép retry ONLINE=OFF khi gặp restriction (LOB columns...)
    offline_fallback: bool = False

    # ── Statistics ───────────────────────────────────────────────────────────
    stats_modification_threshold: int = 20_000
    stats_fullscan: bool = False
    # None = để SQL Server tự chọn sample rate
    stats_sample_pct: int | None = None

    # ── Heap ─────────────────────────────────────────────────────────────────
    heap_forwarded_records_threshold: int = 1000

    # ── Scheduling ───────────────────────────────────────────────────────────
    # {"start": "02:00", "end": "03:00"} — window riêng cho object đặc thù
    window_override: dict | None = None
    priority_boost: int = 0

    updated_at: datetime = Field(default_factory=now_vn)

    @staticmethod
    def default_policy_id() -> str:
        return "default"

    @staticmethod
    def table_policy_id(schema_name: str, table_name: str) -> str:
        return f"table:{schema_name}.{table_name}"

    @staticmethod
    def index_policy_id(schema_name: str, table_name: str, index_name: str) -> str:
        return f"index:{schema_name}.{table_name}.{index_name}"

    def merge_override(self, override: "MaintenancePolicy") -> "MaintenancePolicy":
        """
        Trả về policy mới = self với các field được override EXPLICIT SET.

        Dùng model_fields_set của override — field không set trong document
        MongoDB giữ giá trị từ policy cấp thấp hơn (default/table).
        """
        data = self.model_dump()
        for field in MERGEABLE_FIELDS:
            if field in override.model_fields_set:
                data[field] = getattr(override, field)
        # Kết quả merge mang định danh của override (scope cụ thể nhất)
        data["policy_id"] = override.policy_id
        data["scope"] = override.scope
        data["schema_name"] = override.schema_name
        data["table_name"] = override.table_name
        data["index_name"] = override.index_name
        return MaintenancePolicy(**data)
