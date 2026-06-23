"""
approval_adapter.py — Xử lý approval callbacks TRONG PROCESS MONITORING.

Inject vào TelegramBot (layer1/notifications/telegram_bot.py) — bot poll thấy
callback `l1|mntb|...` / `l1|mnti|...` → gọi adapter này. CHỈ ghi MongoDB,
KHÔNG import gì từ executor/MSSQL — process monitoring không gánh thêm
dependency và không thể bị maintenance logic làm chậm.

Maintenance runner chỉ ĐỌC trạng thái approved từ queue ở tick kế tiếp.
"""
from __future__ import annotations

import logging

from pydantic import BaseModel

from ..repositories.batch_repo import BatchRepo
from ..repositories.queue_repo import QueueRepo

logger = logging.getLogger(__name__)


class ApprovalResult(BaseModel):
    """Kết quả xử lý callback — message trả về Telegram chat."""

    ok: bool
    message: str


class MaintenanceApprovalAdapter:

    def __init__(self, queue_repo: QueueRepo | None = None, batch_repo: BatchRepo | None = None) -> None:
        self._queue_repo = queue_repo or QueueRepo()
        self._batch_repo = batch_repo or BatchRepo()

    def handle(self, action: str, parts: list[str], sender: str) -> ApprovalResult:
        """
        action: "mntb" | "mnti"
        parts:  ["l1", action, cluster_id, id, decision]
        """
        try:
            if action == "mntb":
                return self._handle_batch(parts, sender)
            if action == "mnti":
                return self._handle_item(parts, sender)
            return ApprovalResult(ok=False, message=f"⚠️ Maintenance action không hỗ trợ: {action}")
        except Exception as exc:
            # Adapter chạy trong bot thread của monitoring — tuyệt đối không raise
            logger.error("MaintenanceApprovalAdapter error: %s", exc, exc_info=True)
            return ApprovalResult(ok=False, message="⚠️ Lỗi xử lý maintenance approval — xem log.")

    def _handle_batch(self, parts: list[str], sender: str) -> ApprovalResult:
        if len(parts) < 5:
            return ApprovalResult(ok=False, message="⚠️ Callback batch thiếu cluster_id hoặc decision.")
        cluster_id = parts[2].strip()
        batch_id = parts[3].strip()
        decision_raw = parts[4].strip().lower()
        decision = "approved" if decision_raw == "all" else "rejected"

        decided = self._batch_repo.decide(cluster_id, batch_id, decision_raw, sender)
        affected = self._queue_repo.bulk_decide_batch(cluster_id, batch_id, decision, sender)

        if not decided and affected == 0:
            return ApprovalResult(
                ok=False,
                message=f"ℹ️ Batch <code>{batch_id[:8]}</code> đã được quyết định trước đó hoặc không tồn tại.",
            )

        icon = "✅" if decision == "approved" else "⛔"
        verb = "approve" if decision == "approved" else "reject"
        note = (
            "Items sẽ chạy trong maintenance window kế tiếp."
            if decision == "approved"
            else "Items sẽ không được thực thi."
        )
        logger.info("Maintenance batch %s %s by %s (%d items).", batch_id[:8], verb, sender, affected)
        return ApprovalResult(
            ok=True,
            message=f"{icon} Đã {verb} <b>{affected}</b> items (batch <code>{batch_id[:8]}</code>) — bởi {sender}.\n{note}",
        )

    def _handle_item(self, parts: list[str], sender: str) -> ApprovalResult:
        if len(parts) < 5:
            return ApprovalResult(ok=False, message="⚠️ Callback item thiếu cluster_id hoặc decision.")
        cluster_id = parts[2].strip()
        short_id = parts[3].strip()
        decision = "approved" if parts[4].strip().lower() == "ok" else "rejected"

        changed = self._queue_repo.decide_item(cluster_id, short_id, decision, sender)
        if not changed:
            return ApprovalResult(
                ok=False,
                message=f"ℹ️ Item <code>{short_id}</code> đã được quyết định trước đó hoặc không tồn tại.",
            )

        icon = "✅" if decision == "approved" else "⛔"
        logger.info("Maintenance item %s %s by %s.", short_id, decision, sender)
        return ApprovalResult(
            ok=True,
            message=f"{icon} Item <code>{short_id}</code> → {decision} — bởi {sender}.",
        )
