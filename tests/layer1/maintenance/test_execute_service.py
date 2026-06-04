"""Unit tests cho ExecuteService.tick() — fakes toàn bộ deps, DRY_RUN path."""
from __future__ import annotations

from datetime import datetime

from layer1.maintenance.config import MaintEnvSettings
from layer1.maintenance.execute.execute_service import ExecuteService
from layer1.maintenance.models.history import MaintenanceHistory, MaintenanceOutcome
from layer1.maintenance.models.policy import MaintenancePolicy, PolicyScope
from layer1.maintenance.models.window import MaintenanceWindow, WindowSlot, WindowState
from layer1.maintenance.models.work_item import ActionType, WorkItem, WorkItemStatus

from .conftest import FakePolicyRepo, make_item
from layer1.maintenance.policy.policy_resolver import PolicyResolver


# ── Fakes ────────────────────────────────────────────────────────────────────

class FakeWindowService:
    def __init__(self, state: WindowState) -> None:
        self._state = state

    def state(self, now) -> WindowState:
        return self._state


class FakeWindowRepo:
    def __init__(self) -> None:
        self.window = MaintenanceWindow(default=WindowSlot())

    def get(self):
        return self.window


class FakeGateService:
    def __init__(self, passed: bool = True) -> None:
        self.passed = passed
        self.checked = 0

    def check(self, host, gates):
        from layer1.maintenance.safety.gate_service import GateResult
        self.checked += 1
        return GateResult(passed=self.passed, reasons=[] if self.passed else ["cpu 90% >= 60%"])


class FakeQueueRepo:
    def __init__(self, items: list[WorkItem] | None = None) -> None:
        self.items = list(items or [])
        self.released: list[tuple] = []
        self.finalized: list[tuple] = []

    def claim_paused_resumable(self):
        return None

    def claim_next_approved(self):
        return self.items.pop(0) if self.items else None

    def release(self, item_id, status, **kwargs):
        self.released.append((item_id, status, kwargs))

    def finalize(self, item_id, status, **kwargs):
        self.finalized.append((item_id, status, kwargs))


class FakeHistoryRepo:
    def __init__(self) -> None:
        self.records: list[MaintenanceHistory] = []

    def insert(self, history: MaintenanceHistory) -> str:
        self.records.append(history)
        return history.history_id


class FakeRoleCache:
    def is_stale(self) -> bool:
        return False

    def refresh(self) -> None:
        pass

    def resolve(self, targets):
        return [("10.0.0.1", "primary")]


def _settings(**overrides) -> MaintEnvSettings:
    return MaintEnvSettings(maint_dry_run=True, **overrides)


def _service(
    *,
    items: list[WorkItem] | None = None,
    window_state: WindowState | None = None,
    gate_passed: bool = True,
    policies: list[MaintenancePolicy] | None = None,
    settings: MaintEnvSettings | None = None,
) -> tuple[ExecuteService, FakeQueueRepo, FakeHistoryRepo, FakeGateService]:
    queue = FakeQueueRepo(items)
    history = FakeHistoryRepo()
    gate = FakeGateService(gate_passed)
    default = MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT)
    service = ExecuteService(
        queue_repo=queue,
        history_repo=history,
        window_repo=FakeWindowRepo(),
        window_service=FakeWindowService(
            window_state or WindowState(open=True, remaining_minutes=120.0, reason="open")
        ),
        gate_service=gate,
        policy_resolver=PolicyResolver(FakePolicyRepo(policies or [default])),
        role_cache=FakeRoleCache(),
        maint_settings=settings or _settings(),
    )
    return service, queue, history, gate


# ── Tests ────────────────────────────────────────────────────────────────────

def test_window_closed_no_claim():
    service, queue, history, gate = _service(
        items=[make_item()],
        window_state=WindowState(open=False, reason="outside_window"),
    )
    assert service.tick() == 0
    assert gate.checked == 0       # không check gate khi window đóng
    assert len(queue.items) == 1   # item không bị claim


def test_gate_fail_no_claim_no_attempts():
    service, queue, history, gate = _service(items=[make_item()], gate_passed=False)
    assert service.tick() == 0
    assert gate.checked == 1
    assert len(queue.items) == 1   # gate fail = trạng thái hệ thống, không đụng item
    assert history.records == []


def test_dry_run_executes_and_finalizes_done():
    item = make_item(ActionType.REBUILD)
    service, queue, history, _ = _service(items=[item])
    assert service.tick() == 1
    assert queue.finalized[0][0] == item.item_id
    assert queue.finalized[0][1] == WorkItemStatus.DONE
    record = history.records[0]
    assert record.outcome == MaintenanceOutcome.DRY_RUN
    assert "ALTER INDEX [IX_Bill_Date]" in record.statement
    assert "RESUMABLE = ON" in record.statement


def test_insufficient_budget_defers_item():
    """Item non-resumable est 50p > remaining 10p → release + history skip."""
    item = make_item(ActionType.REORGANIZE, est=50.0)
    service, queue, history, _ = _service(
        items=[item],
        window_state=WindowState(open=True, remaining_minutes=10.0, reason="open"),
    )
    assert service.tick() == 0
    assert queue.released[0][0] == item.item_id
    assert queue.released[0][1] == WorkItemStatus.APPROVED
    assert history.records[0].outcome == MaintenanceOutcome.SKIPPED
    assert "insufficient_budget" in history.records[0].skip_reason


def test_resumable_rebuild_allowed_over_budget():
    """REBUILD resumable được start dù est > remaining — MAX_DURATION sẽ pause."""
    item = make_item(ActionType.REBUILD, est=500.0)
    service, queue, history, _ = _service(
        items=[item],
        window_state=WindowState(open=True, remaining_minutes=10.0, reason="open"),
    )
    assert service.tick() == 1  # DRY_RUN done
    assert history.records[0].outcome == MaintenanceOutcome.DRY_RUN
    assert "MAX_DURATION = 10 MINUTES" in history.records[0].statement


def test_deferred_item_not_reclaimed_same_window():
    item = make_item(ActionType.REORGANIZE, est=50.0)
    service, queue, history, _ = _service(
        items=[item],
        window_state=WindowState(open=True, remaining_minutes=10.0, reason="open"),
    )
    service.tick()                  # defer
    queue.items = [item]            # giả lập claim trả lại đúng item đó
    assert service.tick() == 0
    # Lần 2: item bị release ngay (trong _claim_next), KHÔNG ghi thêm history skip
    assert len(history.records) == 1


def test_policy_disabled_finalizes_skipped():
    disabled = MaintenancePolicy(
        policy_id="table:dbo.Bill", scope=PolicyScope.TABLE,
        schema_name="dbo", table_name="Bill", enabled=False,
    )
    default = MaintenancePolicy(policy_id="default", scope=PolicyScope.DEFAULT)
    item = make_item()
    service, queue, history, _ = _service(items=[item], policies=[default, disabled])
    assert service.tick() == 0
    assert queue.finalized[0][1] == WorkItemStatus.SKIPPED
    assert history.records[0].skip_reason == "policy_disabled"


def test_stop_requested_skips_tick():
    service, queue, _, gate = _service(items=[make_item()])
    service.request_stop()
    assert service.tick() == 0
    assert gate.checked == 0
