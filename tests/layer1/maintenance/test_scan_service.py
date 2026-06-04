"""Unit tests cho ScanService — fake QueryExecutor, không cần MSSQL/MongoDB."""
from __future__ import annotations

from datetime import datetime

from layer1.maintenance.config import MaintEnvSettings
from layer1.maintenance.execute.duration_estimator import DurationEstimator
from layer1.maintenance.models.policy import MaintenancePolicy, PolicyScope
from layer1.maintenance.models.work_item import ActionType, ItemKind, WorkItem
from layer1.maintenance.policy.policy_resolver import PolicyResolver
from layer1.maintenance.scan.scan_service import ScanService
from layer1.models.metrics import QueryResult

from .conftest import FakePolicyRepo


# ── Fakes ────────────────────────────────────────────────────────────────────

class FakeQueryExecutor:
    """Trả canned rows theo query_id."""

    def __init__(self, rows_by_query: dict[str, list[dict]]) -> None:
        self._rows = rows_by_query

    def execute(self, query, host, topic_id, node_role) -> QueryResult:
        return QueryResult(
            topic_id=topic_id, query_id=query.query_id, node=host, role=node_role,
            rows=self._rows.get(query.query_id, []),
            success=True, duration_ms=1.0,
        )


class FakeRoleCache:
    def is_stale(self) -> bool:
        return False

    def refresh(self) -> None:
        pass

    def resolve(self, targets):
        return [("10.0.0.1", "primary")]


class FakeQueueRepo:
    def __init__(self, open_keys: set | None = None) -> None:
        self.inserted: list[WorkItem] = []
        self._open_keys = open_keys or set()

    def insert_many(self, items):
        self.inserted.extend(items)
        return len(items)

    def find_open_keys(self):
        return self._open_keys

    def expire_stale_awaiting(self, older_than):
        return 0


class FakeBatchRepo:
    def __init__(self) -> None:
        self.batches = []

    def insert(self, batch):
        self.batches.append(batch)
        return batch.batch_id

    def expire_stale(self, older_than):
        return 0

    def set_message_id(self, batch_id, message_id):
        pass


def _frag_row(**overrides) -> dict:
    row = {
        "database_name": "TestDB", "schema_name": "dbo", "table_name": "Bill",
        "index_name": "IX_Bill_Date", "object_id": 100, "index_id": 5,
        "partition_number": 1, "index_type_desc": "NONCLUSTERED INDEX",
        "fragmentation_pct": 45.0, "page_count": 50_000, "record_count": 1_000_000,
        "is_partitioned": 0,
    }
    row.update(overrides)
    return row


def _scan_service(
    rows_by_query: dict[str, list[dict]],
    policies: list[MaintenancePolicy] | None = None,
    open_keys: set | None = None,
) -> tuple[ScanService, FakeQueueRepo, FakeBatchRepo]:
    queue_repo = FakeQueueRepo(open_keys)
    batch_repo = FakeBatchRepo()
    default = MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT)
    service = ScanService(
        query_executor=FakeQueryExecutor(rows_by_query),
        role_cache=FakeRoleCache(),
        policy_resolver=PolicyResolver(FakePolicyRepo(policies or [default])),
        queue_repo=queue_repo,
        batch_repo=batch_repo,
        estimator=DurationEstimator(150_000, 2_000_000),
        maint_settings=MaintEnvSettings(),
        notifier=None,
    )
    return service, queue_repo, batch_repo


# ── Tests ────────────────────────────────────────────────────────────────────

def test_frag_above_rebuild_threshold_creates_rebuild():
    service, queue, batches = _scan_service({
        "scan_fragmentation": [_frag_row(fragmentation_pct=45.0)],
    })
    count = service.run()
    assert count == 1
    item = queue.inserted[0]
    assert item.action_type == ActionType.REBUILD
    assert item.kind == ItemKind.INDEX_FRAG
    assert item.partition_number is None  # không partitioned
    assert len(batches.batches) == 1
    assert batches.batches[0].summary.rebuild == 1


def test_frag_between_thresholds_creates_reorganize():
    service, queue, _ = _scan_service({
        "scan_fragmentation": [_frag_row(fragmentation_pct=15.0)],
    })
    service.run()
    assert queue.inserted[0].action_type == ActionType.REORGANIZE


def test_partitioned_index_creates_partition_rebuild():
    service, queue, _ = _scan_service({
        "scan_fragmentation": [_frag_row(fragmentation_pct=50.0, is_partitioned=1, partition_number=7)],
    })
    service.run()
    item = queue.inserted[0]
    assert item.action_type == ActionType.REBUILD_PARTITION
    assert item.partition_number == 7


def test_policy_disabled_table_excluded():
    disabled = MaintenancePolicy(
        policy_id="table:dbo.Bill", scope=PolicyScope.TABLE,
        schema_name="dbo", table_name="Bill", enabled=False,
    )
    default = MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT)
    service, queue, _ = _scan_service(
        {"scan_fragmentation": [_frag_row()]},
        policies=[default, disabled],
    )
    assert service.run() == 0
    assert queue.inserted == []


def test_max_page_count_policy_skips_huge_table():
    capped = MaintenancePolicy(
        policy_id="table:dbo.Bill", scope=PolicyScope.TABLE,
        schema_name="dbo", table_name="Bill", max_page_count=10_000,
    )
    default = MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT)
    service, queue, _ = _scan_service(
        {"scan_fragmentation": [_frag_row(page_count=50_000)]},
        policies=[default, capped],
    )
    assert service.run() == 0


def test_dedupe_against_open_queue():
    service, queue, _ = _scan_service(
        {"scan_fragmentation": [_frag_row()]},
        open_keys={("dbo", "Bill", "IX_Bill_Date", None, None, "index_frag")},
    )
    assert service.run() == 0
    assert queue.inserted == []


def test_stats_staleness_creates_update_statistics():
    service, queue, _ = _scan_service({
        "scan_stats_staleness": [{
            "database_name": "TestDB", "schema_name": "dbo", "table_name": "Bill",
            "stats_name": "ST_Bill_Date", "object_id": 100, "stats_id": 3,
            "last_updated": datetime(2026, 5, 1), "rows": 5_000_000,
            "rows_sampled": 500_000, "modification_counter": 800_000,
        }],
    })
    service.run()
    item = queue.inserted[0]
    assert item.action_type == ActionType.UPDATE_STATISTICS
    assert item.stats_name == "ST_Bill_Date"
    assert item.metrics.modification_counter == 800_000


def test_heap_forwarded_creates_heap_rebuild():
    service, queue, _ = _scan_service({
        "scan_heap_forwarded": [{
            "database_name": "TestDB", "schema_name": "dbo", "table_name": "StagingData",
            "object_id": 200, "partition_number": 1, "forwarded_record_count": 9_000,
            "record_count": 100_000, "page_count": 5_000, "is_partitioned": 0,
        }],
    })
    service.run()
    item = queue.inserted[0]
    assert item.action_type == ActionType.HEAP_REBUILD
    assert item.index_name is None
    assert item.index_id == 0


def test_priority_ordering_rebuild_first():
    service, queue, _ = _scan_service({
        "scan_fragmentation": [
            _frag_row(index_name="IX_low", fragmentation_pct=12.0),
            _frag_row(index_name="IX_high", fragmentation_pct=60.0),
        ],
    })
    service.run()
    by_name = {i.index_name: i for i in queue.inserted}
    assert by_name["IX_high"].priority > by_name["IX_low"].priority
