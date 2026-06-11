"""scan_query.py — Model cho scan query config lưu trong MongoDB."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ScanQueryConfig(BaseModel):
    """
    Một câu SQL scan được lưu trong maintenance_scan_queries.

    SQL có thể chứa placeholder {min_page_count}, {min_frag_pct},
    {mod_threshold}, {fwd_threshold} — được format với giá trị từ
    default policy lúc runtime.
    """

    query_id: str  # "scan_fragmentation" | "scan_stats_staleness" | "scan_heap_forwarded"
    sql: str
    timeout_sec: int = Field(default=300, ge=10)
    enabled: bool = True
    description: str = ""
