"""
thresholds.py — Ngưỡng quyết định maintenance, nhóm theo execution type.

CampaignThresholds: config optional ở campaign, nhóm index/statistic/heap.
  None field = kế thừa default policy.
EffectiveThresholds: ngưỡng đã resolve đầy đủ (phẳng) — discovery dùng quyết định action.
"""
from __future__ import annotations

from pydantic import BaseModel


class IndexThresholdOverrides(BaseModel):
    reorganize_pct: float | None = None
    rebuild_pct: float | None = None
    min_page_count: int | None = None
    max_page_count: int | None = None


class StatisticThresholdOverrides(BaseModel):
    modification_threshold: int | None = None
    stats_min_sample_pct: float | None = None


class HeapThresholdOverrides(BaseModel):
    forwarded_threshold: int | None = None


class CampaignThresholds(BaseModel):
    """Override ngưỡng cấp campaign, nhóm theo execution type."""

    index: IndexThresholdOverrides | None = None
    statistic: StatisticThresholdOverrides | None = None
    heap: HeapThresholdOverrides | None = None


class EffectiveThresholds(BaseModel):
    """Ngưỡng đã resolve đầy đủ (phẳng) — căn cứ quyết định trong discovery."""

    reorganize_pct: float
    rebuild_pct: float
    min_page_count: int
    max_page_count: int | None = None
    stats_modification_threshold: int
    stats_min_sample_pct: float | None = None
    heap_forwarded_threshold: int

    @classmethod
    def resolve(cls, overrides: "CampaignThresholds | None", default: "EffectiveThresholds") -> "EffectiveThresholds":
        data = default.model_dump()
        if overrides is not None:
            if overrides.index is not None:
                idx = overrides.index
                if idx.reorganize_pct is not None:
                    data["reorganize_pct"] = idx.reorganize_pct
                if idx.rebuild_pct is not None:
                    data["rebuild_pct"] = idx.rebuild_pct
                if idx.min_page_count is not None:
                    data["min_page_count"] = idx.min_page_count
                if idx.max_page_count is not None:
                    data["max_page_count"] = idx.max_page_count
            if overrides.statistic is not None:
                if overrides.statistic.modification_threshold is not None:
                    data["stats_modification_threshold"] = overrides.statistic.modification_threshold
                if overrides.statistic.stats_min_sample_pct is not None:
                    data["stats_min_sample_pct"] = overrides.statistic.stats_min_sample_pct
            if overrides.heap is not None and overrides.heap.forwarded_threshold is not None:
                data["heap_forwarded_threshold"] = overrides.heap.forwarded_threshold
        return cls(**data)
