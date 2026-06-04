"""Shared fixtures/fakes cho maintenance tests — không cần MSSQL/MongoDB.

NOTE: pydantic-settings mới (venv local) raise SettingsError khi parse
MSSQL_NODES comma-format trong .env (production pin 2.3.0 không bị).
Pre-import layer1.config tại đây với env vars test + CWD tạm (không có .env)
— conftest load TRƯỚC mọi test module nên settings singleton được build an toàn.
"""
from __future__ import annotations

import os
import tempfile

os.environ.setdefault("MSSQL_NODES", '["TEST-NODE-01"]')
os.environ.setdefault("MSSQL_DATABASE", "TestDB")
os.environ.setdefault("MSSQL_USERNAME", "test")
os.environ.setdefault("MSSQL_PASSWORD", "test")

_original_cwd = os.getcwd()
_tmp = tempfile.mkdtemp(prefix="maint-test-")
os.chdir(_tmp)  # CWD không có .env → dotenv source bị skip
try:
    import layer1.config  # noqa: F401 — build settings singleton từ env vars
    import layer1.maintenance.config  # noqa: F401
finally:
    os.chdir(_original_cwd)

import pytest

from layer1.maintenance.models.policy import MaintenancePolicy, PolicyScope
from layer1.maintenance.models.work_item import (
    ActionType,
    ItemKind,
    WorkItem,
    WorkItemMetrics,
)


@pytest.fixture
def default_policy() -> MaintenancePolicy:
    return MaintenancePolicy(
        policy_id="default",
        scope=PolicyScope.DEFAULT,
    )


def make_item(
    action: ActionType = ActionType.REBUILD,
    *,
    schema: str = "dbo",
    table: str = "Bill",
    index: str | None = "IX_Bill_Date",
    stats: str | None = None,
    partition: int | None = None,
    frag: float | None = 45.0,
    pages: int | None = 500_000,
    est: float = 5.0,
    kind: ItemKind = ItemKind.INDEX_FRAG,
) -> WorkItem:
    return WorkItem(
        batch_id="batch-test",
        kind=kind,
        action_type=action,
        database_name="TestDB",
        schema_name=schema,
        table_name=table,
        index_name=index,
        stats_name=stats,
        partition_number=partition,
        object_id=1234,
        index_id=5 if index else 0,
        metrics=WorkItemMetrics(fragmentation_pct=frag, page_count=pages),
        estimated_minutes=est,
    )


class FakePolicyRepo:
    """Duck-typed PolicyRepo — policies giữ in-memory."""

    def __init__(self, policies: list[MaintenancePolicy]) -> None:
        self._policies = policies

    def find_all(self) -> list[MaintenancePolicy]:
        return list(self._policies)

    def find_default(self) -> MaintenancePolicy | None:
        for p in self._policies:
            if p.policy_id == "default":
                return p
        return None
