"""
telegram_bot.py — Telegram Bot polling + /analyze command handler.

Chạy trong daemon thread song song với APScheduler.
Long-poll getUpdates (timeout=25s) để nhận command từ user.

Hỗ trợ 2 cách gọi /analyze:
  1. Reply vào alert message → bot đọc finding_id đầy đủ từ dòng "🔗 ID: ..."
  2. /analyze <finding_id>  → tìm finding theo ID đầy đủ (UUIDv4)

Sau khi resolve finding, load analysis_config từ monitor_topics →
build prompt → gọi Claude API → gửi kết quả về Telegram.
"""
from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING

from ..models.findings import Finding

if TYPE_CHECKING:
    from ..ai.plan_analyzer import PlanAnalyzer
    from ..storage.repositories.findings_repo import FindingsRepo
    from ..storage.repositories.topic_repo import TopicRepo

logger = logging.getLogger(__name__)


class TelegramBot:
    """
    Polling bot nhận /analyze command và trả về Claude AI analysis.
    Thread-safe: chỉ 1 daemon thread, không share state với APScheduler.
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        findings_repo: FindingsRepo,
        topic_repo: TopicRepo,
        analyzer: PlanAnalyzer,
    ) -> None:
        self._chat_id = chat_id
        self._findings_repo = findings_repo
        self._topic_repo = topic_repo
        self._analyzer = analyzer
        self._api_base = f"https://api.telegram.org/bot{bot_token}"

    def start(self) -> None:
        """Khởi động polling loop trong daemon thread."""
        thread = threading.Thread(
            target=self._poll_loop,
            daemon=True,
            name="telegram-bot",
        )
        thread.start()
        logger.info("TelegramBot polling started.")

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
                        logger.error("TelegramBot handle_update error: %s", exc)
            except Exception as exc:
                logger.warning("TelegramBot poll error: %s — retry in 5s", exc)
                time.sleep(5)

    def _get_updates(self, offset: int, timeout: int) -> list[dict]:
        url = f"{self._api_base}/getUpdates?offset={offset}&timeout={timeout}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout + 5) as resp:
            data = json.loads(resp.read())
        return data.get("result", [])

    # ── Command handling ────────────────────────────────────────────────────

    def _handle_update(self, update: dict) -> None:
        message = update.get("message", {})
        text = (message.get("text") or "").strip()
        chat_id = message.get("chat", {}).get("id")
        sender = self._get_sender(message)

        logger.info(
            "TelegramBot: message received from %s — %r",
            sender,
            text[:80] if text else "(no text)",
        )

        if not text.startswith("/analyze"):
            return

        logger.info("TelegramBot: /analyze received from %s", sender)

        finding_id = self._resolve_finding_id(text, message)

        if not finding_id:
            logger.warning("TelegramBot: /analyze without finding_id from %s", sender)
            self._send(chat_id, "Usage: /analyze &lt;finding_id&gt;\nHoặc reply trực tiếp vào alert message.")
            return

        logger.info(
            "TelegramBot: looking up finding id=%s requested_by=%s",
            finding_id, sender,
        )

        finding = self._findings_repo.find_by_id(finding_id) \
            or self._findings_repo.find_by_id_prefix(finding_id)
        if not finding:
            logger.warning(
                "TelegramBot: finding not found id=%s requested_by=%s",
                finding_id, sender,
            )
            self._send(chat_id, f"❌ Không tìm thấy finding: <code>{finding_id}</code>")
            return

        topic = self._topic_repo.find_by_id(finding.topic_id)
        if not topic or not topic.analysis_config:
            logger.warning(
                "TelegramBot: no analysis_config for topic=%s finding=%s",
                finding.topic_id, finding_id,
            )
            self._send(
                chat_id,
                f"⚠️ Topic <code>{finding.topic_id}</code> chưa có <b>analysis_config</b>.\n"
                "Thêm analysis_config vào monitor_topics trong MongoDB.",
            )
            return

        self._send(chat_id, "⏳ Đang phân tích với Claude AI...")
        logger.info(
            "TelegramBot: calling Claude API finding=%s topic=%s requested_by=%s",
            finding.finding_id, finding.topic_id, sender,
        )

        try:
            result = self._analyzer.analyze(finding, topic.analysis_config)
            self._send(chat_id, self._format_analysis_result(finding, result))
            logger.info(
                "TelegramBot: analysis sent finding=%s requested_by=%s",
                finding.finding_id, sender,
            )
        except Exception as exc:
            logger.error(
                "TelegramBot: analyze failed finding=%s requested_by=%s error=%s",
                finding_id, sender, exc,
            )
            self._send(chat_id, f"❌ Lỗi phân tích: {exc}")

    @staticmethod
    def _get_sender(message: dict) -> str:
        """Trả về chuỗi định danh người gửi: 'FirstName (@username, id=123)'."""
        user = message.get("from") or {}
        first = user.get("first_name", "")
        last = user.get("last_name", "")
        username = user.get("username", "")
        user_id = user.get("id", "?")
        name = f"{first} {last}".strip() or "Unknown"
        suffix = f"@{username}" if username else f"id={user_id}"
        return f"{name} ({suffix})"

    def _format_analysis_result(self, finding: Finding, analysis_text: str) -> str:
        """Format kết quả Claude AI theo template chuẩn trước khi gửi Telegram."""
        # detected_at đã lưu giờ VN — format trực tiếp
        time_str = finding.detected_at.strftime("%Y-%m-%d %H:%M:%S +07")
        header = "\n".join([
            f"🔍 <b>AI Analysis — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🖥 Node:   <code>{html.escape(finding.node)}</code> ({html.escape(finding.role)})",
            f"📋 Topic:  <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 Time:   {time_str}",
            "",
        ])
        footer = f"\n\n🔗 Finding: <code>{finding.finding_id}</code>"
        # Telegram giới hạn 4096 ký tự — cắt phần analysis nếu cần
        max_analysis = 4096 - len(header) - len(footer)
        return header + html.escape(analysis_text[:max_analysis]) + footer

    def _resolve_finding_id(self, text: str, message: dict) -> str | None:
        """
        Resolve finding_id từ 2 nguồn:
          1. /analyze <id>    — lấy từ argument
          2. reply vào alert  — parse dòng "🔗 ID: 03cc0a88" trong message gốc
        """
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            return parts[1].strip()

        # Reply case: tìm finding_id trong text của message được reply
        reply_text = (message.get("reply_to_message") or {}).get("text", "")
        for line in reply_text.splitlines():
            if "ID:" in line:
                # Match full UUIDv4: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                m = re.search(r"ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", line)
                if m:
                    return m.group(1)

        return None

    # ── HTTP helper ─────────────────────────────────────────────────────────

    def _send(self, chat_id: int | str, text: str) -> None:
        """Gửi message HTML, không raise — log ERROR nếu thất bại."""
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
            logger.error("TelegramBot send HTTP %d: %s", exc.code, body)
        except Exception as exc:
            logger.error("TelegramBot send failed: %s", exc)
