"""Unit tests cho MaintenanceApprovalAdapter — fake repos, verify routing + messages."""
from __future__ import annotations

from layer1.maintenance.notify.approval_adapter import MaintenanceApprovalAdapter


class FakeQueueRepo:
    def __init__(self, bulk_result: int = 5, item_result: bool = True) -> None:
        self.bulk_result = bulk_result
        self.item_result = item_result
        self.calls: list[tuple] = []

    def bulk_decide_batch(self, batch_id, decision, decided_by):
        self.calls.append(("bulk", batch_id, decision, decided_by))
        return self.bulk_result

    def decide_item(self, short_id, decision, decided_by):
        self.calls.append(("item", short_id, decision, decided_by))
        return self.item_result


class FakeBatchRepo:
    def __init__(self, decided: bool = True) -> None:
        self.decided = decided
        self.calls: list[tuple] = []

    def decide(self, batch_id, decision, decided_by):
        self.calls.append((batch_id, decision, decided_by))
        return self.decided


def _adapter(queue=None, batch=None) -> MaintenanceApprovalAdapter:
    return MaintenanceApprovalAdapter(
        queue_repo=queue or FakeQueueRepo(),
        batch_repo=batch or FakeBatchRepo(),
    )


def test_batch_approve_all():
    queue = FakeQueueRepo(bulk_result=42)
    result = _adapter(queue=queue).handle(
        "mntb", ["l1", "mntb", "abc12345-batch", "all"], "LongDT",
    )
    assert result.ok is True
    assert "42" in result.message
    assert queue.calls[0] == ("bulk", "abc12345-batch", "approved", "LongDT")


def test_batch_reject():
    queue = FakeQueueRepo(bulk_result=10)
    result = _adapter(queue=queue).handle(
        "mntb", ["l1", "mntb", "abc12345-batch", "reject"], "LongDT",
    )
    assert result.ok is True
    assert queue.calls[0][2] == "rejected"


def test_batch_already_decided():
    result = _adapter(
        queue=FakeQueueRepo(bulk_result=0),
        batch=FakeBatchRepo(decided=False),
    ).handle("mntb", ["l1", "mntb", "abc12345", "all"], "LongDT")
    assert result.ok is False
    assert "đã được quyết định" in result.message


def test_item_approve():
    queue = FakeQueueRepo()
    result = _adapter(queue=queue).handle("mnti", ["l1", "mnti", "a1b2c3d4", "ok"], "LongDT")
    assert result.ok is True
    assert queue.calls[0] == ("item", "a1b2c3d4", "approved", "LongDT")


def test_item_reject():
    queue = FakeQueueRepo()
    result = _adapter(queue=queue).handle("mnti", ["l1", "mnti", "a1b2c3d4", "no"], "LongDT")
    assert queue.calls[0][2] == "rejected"


def test_item_already_decided():
    result = _adapter(queue=FakeQueueRepo(item_result=False)).handle(
        "mnti", ["l1", "mnti", "a1b2c3d4", "ok"], "LongDT",
    )
    assert result.ok is False


def test_missing_decision_part():
    result = _adapter().handle("mntb", ["l1", "mntb", "abc"], "LongDT")
    assert result.ok is False


def test_unknown_action():
    result = _adapter().handle("mntx", ["l1", "mntx", "abc", "all"], "LongDT")
    assert result.ok is False


def test_exception_never_raises():
    class BrokenRepo:
        def bulk_decide_batch(self, *a):
            raise RuntimeError("mongo down")

    adapter = MaintenanceApprovalAdapter(queue_repo=BrokenRepo(), batch_repo=FakeBatchRepo())
    result = adapter.handle("mntb", ["l1", "mntb", "abc", "all"], "LongDT")
    assert result.ok is False  # adapter chạy trong bot thread — tuyệt đối không raise
