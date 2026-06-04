"""Unit tests cho DurationEstimator — heuristic monotonic, priority ordering."""
from __future__ import annotations

from layer1.maintenance.execute.duration_estimator import DurationEstimator
from layer1.maintenance.models.work_item import ActionType, ItemKind, WorkItemMetrics

from .conftest import make_item


def _estimator() -> DurationEstimator:
    return DurationEstimator(pages_per_minute=150_000, rows_per_minute=2_000_000)


def test_rebuild_estimate_scales_with_pages():
    small = make_item(ActionType.REBUILD, pages=150_000)
    large = make_item(ActionType.REBUILD, pages=1_500_000)
    est = _estimator()
    assert est.estimate_minutes(small) == 1.0
    assert est.estimate_minutes(large) == 10.0


def test_reorganize_scales_with_fragmentation():
    """REORGANIZE chỉ xử lý pages fragmented — est < rebuild cùng size."""
    est = _estimator()
    reorg = make_item(ActionType.REORGANIZE, pages=1_500_000, frag=20.0)
    rebuild = make_item(ActionType.REBUILD, pages=1_500_000, frag=20.0)
    assert est.estimate_minutes(reorg) < est.estimate_minutes(rebuild)


def test_stats_estimate_from_rows():
    item = make_item(
        ActionType.UPDATE_STATISTICS, index=None, stats="ST_x",
        kind=ItemKind.STATS_STALE, frag=None, pages=None,
    )
    item.metrics = WorkItemMetrics(rows=4_000_000)
    assert _estimator().estimate_minutes(item) == 2.0


def test_minimum_one_minute():
    tiny = make_item(ActionType.REBUILD, pages=100)
    assert _estimator().estimate_minutes(tiny) == 1.0


def test_priority_rebuild_above_stats():
    rebuild = make_item(ActionType.REBUILD, frag=40.0, pages=100_000)
    stats = make_item(
        ActionType.UPDATE_STATISTICS, index=None, stats="ST_x",
        kind=ItemKind.STATS_STALE, frag=None, pages=None,
    )
    assert DurationEstimator.priority(rebuild) > DurationEstimator.priority(stats)


def test_priority_boost_applied():
    item = make_item(ActionType.REBUILD)
    assert DurationEstimator.priority(item, priority_boost=20) == DurationEstimator.priority(item) + 20


def test_priority_frag_capped_at_50():
    a = make_item(ActionType.REBUILD, frag=55.0)
    b = make_item(ActionType.REBUILD, frag=99.0)
    assert DurationEstimator.priority(a) == DurationEstimator.priority(b)
