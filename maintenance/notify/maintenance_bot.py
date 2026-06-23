"""
maintenance_bot.py — Telegram bot riêng cho maintenance process.

Chạy trong daemon thread — poll getUpdates trên MAINT_TELEGRAM_BOT_TOKEN.
Chỉ xử lý approval callbacks (l1|mntb|... và l1|mnti|...) — không có /quick,
không lookup findings, không forward Layer 2.

Tách khỏi monitoring bot: mỗi token chỉ có 1 poller duy nhất — tránh
Telegram 409 Conflict nếu 2 process cùng poll 1 token.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request

from ..repositories.batch_repo import BatchRepo
from ..repositories.queue_repo import QueueRepo
from .approval_adapter import MaintenanceApprovalAdapter

logger = logging.getLogger(__name__)


class MaintenanceBot:
    """
    Polling bot chuyên dụng cho maintenance approval.

    Thread-safe: 1 daemon thread, chỉ ghi MongoDB qua MaintenanceApprovalAdapter.
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        queue_repo: QueueRepo | None = None,
        batch_repo: BatchRepo | None = None,
    ) -> None:
        self._chat_id = chat_id
        self._api_base = f"https://api.telegram.org/bot{bot_token}"
        self._adapter = MaintenanceApprovalAdapter(
            queue_repo=queue_repo or QueueRepo(),
            batch_repo=batch_repo or BatchRepo(),
        )

    def start(self) -> None:
        """Khởi động polling loop trong daemon thread."""
        thread = threading.Thread(
            target=self._poll_loop,
            daemon=True,
            name="maint-bot",
        )
        thread.start()
        logger.info("MaintenanceBot polling started.")

    # ── Polling loop ────────────────────────────────────────────────────────

    def _poll_loop(self) -> None:
        offset = 0
        while True:
            try:
                updates = self._get_updates(offset, timeout=25)
                for update in updates:
                    offset = update["update_id"] + 1
                    try:
                        self._handle_update(update)
                    except Exception as exc:
                        logger.error("MaintenanceBot handle_update error: %s", exc)
            except Exception as exc:
                logger.warning("MaintenanceBot poll error: %s — retry in 5s", exc)
                time.sleep(5)

    def _get_updates(self, offset: int, timeout: int) -> list[dict]:
        url = f"{self._api_base}/getUpdates?offset={offset}&timeout={timeout}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout + 5) as resp:
            data = json.loads(resp.read())
        return data.get("result", [])

    # ── Update handling ──────────────────────────────────────────────────────

    def _handle_update(self, update: dict) -> None:
        if update.get("callback_query"):
            self._handle_callback_query(update["callback_query"])

    def _handle_callback_query(self, callback_query: dict) -> None:
        callback_id = str(callback_query.get("id") or "")
        data = str(callback_query.get("data") or "")
        msg = callback_query.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id") or self._chat_id
        sender = self._get_sender(callback_query.get("from") or {})

        if not data.startswith("l1|"):
            self._answer_callback(callback_id, "Callback không hợp lệ.")
            return

        parts = data.split("|")
        if len(parts) < 5:
            self._answer_callback(callback_id, "Callback thiếu dữ liệu.")
            return

        action = parts[1]
        if action not in ("mntb", "mnti"):
            self._answer_callback(callback_id, f"Action không hỗ trợ: {action}")
            return

        self._answer_callback(callback_id, "Đang xử lý...")
        result = self._adapter.handle(action, parts, sender)
        self._send(chat_id, result.message)

    # ── HTTP helpers ─────────────────────────────────────────────────────────

    def _send(self, chat_id: int | str, text: str) -> None:
        try:
            payload = json.dumps({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            }).encode()
            req = urllib.request.Request(
                f"{self._api_base}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10):
                pass
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error("MaintenanceBot send HTTP %d: %s", exc.code, body)
        except Exception as exc:
            logger.error("MaintenanceBot send failed: %s", exc)

    def _answer_callback(self, callback_id: str, text: str | None = None) -> None:
        if not callback_id:
            return
        try:
            body: dict = {"callback_query_id": callback_id}
            if text:
                body["text"] = text[:180]
            payload = json.dumps(body).encode()
            req = urllib.request.Request(
                f"{self._api_base}/answerCallbackQuery",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception as exc:
            logger.error("MaintenanceBot answerCallbackQuery failed: %s", exc)

    @staticmethod
    def _get_sender(user: dict) -> str:
        first = user.get("first_name", "")
        last = user.get("last_name", "")
        username = user.get("username", "")
        user_id = user.get("id", "?")
        name = f"{first} {last}".strip() or "Unknown"
        suffix = f"@{username}" if username else f"id={user_id}"
        return f"{name} ({suffix})"
