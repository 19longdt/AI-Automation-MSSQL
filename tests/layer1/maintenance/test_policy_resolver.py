"""Unit tests cho PolicyResolver — precedence default < table < index, field-level merge."""
from __future__ import annotations

import pytest

from layer1.maintenance.models.policy import MaintenancePolicy, PolicyScope
from layer1.maintenance.policy.policy_resolver import PolicyResolver

from .conftest import FakePolicyRepo


def _default() -> MaintenancePolicy:
    return MaintenancePolicy(
        policy_id="default", scope=PolicyScope.DEFAULT,
        maxdop=4, rebuild_threshold_pct=30.0, min_page_count=1000,
    )


def test_resolve_default_only():
    resolver = PolicyResolver(FakePolicyRepo([_default()]))
    policy = resolver.resolve("dbo", "Bill", "IX_x")
    assert policy.maxdop == 4
    assert policy.rebuild_threshold_pct == 30.0


def test_table_override_field_level():
    """Table override chỉ set maxdop — các field khác giữ từ default."""
    table_override = MaintenancePolicy(
        policy_id="table:dbo.Bill", scope=PolicyScope.TABLE,
        schema_name="dbo", table_name="Bill",
        maxdop=2,
    )
    resolver = PolicyResolver(FakePolicyRepo([_default(), table_override]))
    policy = resolver.resolve("dbo", "Bill", "IX_x")
    assert policy.maxdop == 2                       # từ table override
    assert policy.rebuild_threshold_pct == 30.0     # giữ default
    assert policy.min_page_count == 1000            # giữ default


def test_index_override_wins_over_table():
    table_override = MaintenancePolicy(
        policy_id="table:dbo.Bill", scope=PolicyScope.TABLE,
        schema_name="dbo", table_name="Bill", maxdop=2,
    )
    index_override = MaintenancePolicy(
        policy_id="index:dbo.Bill.IX_x", scope=PolicyScope.INDEX,
        schema_name="dbo", table_name="Bill", index_name="IX_x",
        maxdop=1, enabled=False,
    )
    resolver = PolicyResolver(FakePolicyRepo([_default(), table_override, index_override]))

    policy = resolver.resolve("dbo", "Bill", "IX_x")
    assert policy.maxdop == 1
    assert policy.enabled is False

    # Index khác cùng bảng — chỉ ăn table override
    other = resolver.resolve("dbo", "Bill", "IX_other")
    assert other.maxdop == 2
    assert other.enabled is True


def test_no_index_name_skips_index_override():
    index_override = MaintenancePolicy(
        policy_id="index:dbo.Bill.IX_x", scope=PolicyScope.INDEX,
        schema_name="dbo", table_name="Bill", index_name="IX_x", maxdop=1,
    )
    resolver = PolicyResolver(FakePolicyRepo([_default(), index_override]))
    policy = resolver.resolve("dbo", "Bill")  # stats/heap item không có index
    assert policy.maxdop == 4


def test_missing_default_raises():
    resolver = PolicyResolver(FakePolicyRepo([]))
    with pytest.raises(RuntimeError, match="seed"):
        resolver.resolve("dbo", "Bill")
