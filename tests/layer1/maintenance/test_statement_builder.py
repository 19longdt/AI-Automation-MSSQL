"""Unit tests cho statement_builder — table-driven, pure functions."""
from __future__ import annotations

import pytest

from layer1.maintenance.execute import statement_builder as sb
from layer1.maintenance.models.policy import MaintenancePolicy, PolicyScope
from layer1.maintenance.models.work_item import ActionType, ItemKind

from .conftest import make_item


def _policy(**overrides) -> MaintenancePolicy:
    return MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT, **overrides)


# ── quote_ident ──────────────────────────────────────────────────────────────

def test_quote_ident_escapes_bracket():
    # Tên object độc hại từ DMV không được phá vỡ statement
    assert sb.quote_ident("Bill]; DROP TABLE x--") == "[Bill]]; DROP TABLE x--]"


def test_quote_ident_normal():
    assert sb.quote_ident("IX_Bill_Date") == "[IX_Bill_Date]"


# ── REORGANIZE ───────────────────────────────────────────────────────────────

def test_reorganize_no_options():
    """REORGANIZE KHÔNG nhận MAXDOP/ONLINE/RESUMABLE."""
    item = make_item(ActionType.REORGANIZE)
    stmt = sb.build_statement(item, _policy(), 60)
    assert stmt == "ALTER INDEX [IX_Bill_Date] ON [dbo].[Bill] REORGANIZE"
    assert "MAXDOP" not in stmt
    assert "ONLINE" not in stmt


def test_reorganize_partition():
    item = make_item(ActionType.REORGANIZE, partition=5)
    stmt = sb.build_statement(item, _policy(), 60)
    assert stmt.endswith("REORGANIZE PARTITION = 5")


# ── REBUILD ──────────────────────────────────────────────────────────────────

def test_rebuild_online_resumable_with_max_duration():
    item = make_item(ActionType.REBUILD)
    stmt = sb.build_statement(item, _policy(maxdop=2), 45.7)
    assert "REBUILD WITH (" in stmt
    assert "ONLINE = ON" in stmt
    assert "MAXDOP = 2" in stmt
    assert "RESUMABLE = ON" in stmt
    assert "MAX_DURATION = 45 MINUTES" in stmt


def test_rebuild_partition_clause_before_with():
    item = make_item(ActionType.REBUILD_PARTITION, partition=202605)
    stmt = sb.build_statement(item, _policy(), 60)
    assert "REBUILD PARTITION = 202605 WITH (" in stmt


def test_rebuild_resumable_requires_online():
    """policy.online=False → RESUMABLE phải tắt theo (SQL Server requirement)."""
    item = make_item(ActionType.REBUILD)
    stmt = sb.build_statement(item, _policy(online=False, resumable=True), 60)
    assert "ONLINE = OFF" in stmt
    assert "RESUMABLE" not in stmt
    assert "MAX_DURATION" not in stmt


def test_rebuild_force_offline_drops_resumable():
    item = make_item(ActionType.REBUILD)
    stmt = sb.build_statement(item, _policy(), 60, force_offline=True)
    assert "ONLINE = OFF" in stmt
    assert "RESUMABLE" not in stmt


def test_rebuild_max_duration_minimum_one_minute():
    item = make_item(ActionType.REBUILD)
    stmt = sb.build_statement(item, _policy(), 0.4)
    assert "MAX_DURATION = 1 MINUTES" in stmt


# ── UPDATE STATISTICS ────────────────────────────────────────────────────────

def test_update_statistics_default_sampling():
    item = make_item(
        ActionType.UPDATE_STATISTICS, index=None, stats="ST_Bill_Date",
        kind=ItemKind.STATS_STALE,
    )
    stmt = sb.build_statement(item, _policy(), 60)
    assert stmt == "UPDATE STATISTICS [dbo].[Bill] ([ST_Bill_Date])"


def test_update_statistics_fullscan():
    item = make_item(
        ActionType.UPDATE_STATISTICS, index=None, stats="ST_x", kind=ItemKind.STATS_STALE,
    )
    stmt = sb.build_statement(item, _policy(stats_fullscan=True), 60)
    assert stmt.endswith("WITH FULLSCAN")


def test_update_statistics_sample_pct():
    item = make_item(
        ActionType.UPDATE_STATISTICS, index=None, stats="ST_x", kind=ItemKind.STATS_STALE,
    )
    stmt = sb.build_statement(item, _policy(stats_sample_pct=30), 60)
    assert stmt.endswith("WITH SAMPLE 30 PERCENT")


# ── HEAP REBUILD ─────────────────────────────────────────────────────────────

def test_heap_rebuild():
    item = make_item(ActionType.HEAP_REBUILD, index=None, kind=ItemKind.HEAP_FORWARDED)
    stmt = sb.build_statement(item, _policy(maxdop=8), 60)
    assert stmt.startswith("ALTER TABLE [dbo].[Bill] REBUILD WITH (")
    assert "ONLINE = ON" in stmt
    assert "MAXDOP = 8" in stmt
    assert "RESUMABLE" not in stmt  # ALTER TABLE REBUILD không hỗ trợ RESUMABLE


def test_heap_rebuild_partition():
    item = make_item(
        ActionType.HEAP_REBUILD, index=None, partition=3, kind=ItemKind.HEAP_FORWARDED,
    )
    stmt = sb.build_statement(item, _policy(), 60)
    assert "REBUILD PARTITION = 3 WITH (" in stmt


# ── Control statements ───────────────────────────────────────────────────────

def test_pause_resume_abort():
    item = make_item(ActionType.REBUILD)
    assert sb.build_pause(item) == "ALTER INDEX [IX_Bill_Date] ON [dbo].[Bill] PAUSE"
    assert "RESUME WITH (MAX_DURATION = 30 MINUTES)" in sb.build_resume(item, _policy(), 30)
    assert sb.build_abort(item).endswith("ABORT")


# ── Validation ───────────────────────────────────────────────────────────────

def test_reorganize_requires_index_name():
    item = make_item(ActionType.REORGANIZE, index=None)
    with pytest.raises(ValueError):
        sb.build_statement(item, _policy(), 60)


def test_update_statistics_requires_stats_name():
    item = make_item(ActionType.UPDATE_STATISTICS, index=None, stats=None)
    with pytest.raises(ValueError):
        sb.build_statement(item, _policy(), 60)
