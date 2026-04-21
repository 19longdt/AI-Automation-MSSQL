"""
telegram_bot.py — Telegram Bot polling + /quick + /analyze command handlers.

Chạy trong daemon thread song song với APScheduler.
Long-poll getUpdates (timeout=25s) để nhận command từ user.

Hỗ trợ 2 lệnh:
  /quick <finding_id>  → Layer 1 Haiku model (nhanh, phân tích sơ bộ)
  /analyze <finding_id> → Layer 2 agent (full orchestration, tools, Sonnet)

Cả 2 lệnh hỗ trợ reply vào alert message để lấy finding_id tự động.
"""
from __future__ import annotations

import html
import json
import logging
import re
import socket
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
    Polling bot nhận /quick + /analyze commands.

    /quick: Dùng Haiku model Layer 1 — phân tích nhanh, rẻ
    /analyze: Forward tới Layer 2 agent — full orchestration

    Thread-safe: chỉ 1 daemon thread, không share state với APScheduler.
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        findings_repo: FindingsRepo,
        topic_repo: TopicRepo,
        analyzer: PlanAnalyzer | None,  # None nếu không có claude_api_key
        layer2_url: str = "",
    ) -> None:
        self._chat_id = chat_id
        self._findings_repo = findings_repo
        self._topic_repo = topic_repo
        self._analyzer = analyzer
        self._layer2_url = layer2_url.rstrip("/") if layer2_url else ""
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

        if text.startswith("/quick"):
            self._handle_quick(chat_id, text, message, sender)
        elif text.startswith("/analyze"):
            self._handle_analyze(chat_id, text, message, sender)

    def _handle_quick(self, chat_id: int | str, text: str, message: dict, sender: str) -> None:
        """Xử lý /quick — phân tích nhanh với Haiku model (Layer 1)."""
        if not self._analyzer:
            logger.warning("TelegramBot: /quick requested but analyzer not configured")
            self._send(chat_id, "⚠️ <b>/quick không khả dụng</b> — <code>CLAUDE_API_KEY</code> chưa set.")
            return

        finding_id = self._resolve_finding_id(text, message)
        if not finding_id:
            logger.warning("TelegramBot: /quick without finding_id from %s", sender)
            self._send(chat_id, "Usage: /quick &lt;finding_id&gt;\nHoặc reply trực tiếp vào alert message.")
            return

        logger.info(
            "TelegramBot: /quick looking up finding id=%s requested_by=%s",
            finding_id[:8], sender,
        )

        finding = self._findings_repo.find_by_id(finding_id) \
            or self._findings_repo.find_by_id_prefix(finding_id)
        if not finding:
            logger.warning(
                "TelegramBot: /quick finding not found id=%s requested_by=%s",
                finding_id, sender,
            )
            self._send(chat_id, f"❌ Không tìm thấy finding: <code>{finding_id}</code>")
            return

        topic = self._topic_repo.find_by_id(finding.topic_id)
        if not topic or not topic.analysis_config:
            logger.warning(
                "TelegramBot: /quick no analysis_config for topic=%s finding=%s",
                finding.topic_id, finding_id,
            )
            self._send(
                chat_id,
                f"⚠️ Topic <code>{finding.topic_id}</code> chưa có <b>analysis_config</b>.\n"
                "Thêm analysis_config vào monitor_topics trong MongoDB.",
            )
            return

        self._send(chat_id, "⚡ Phân tích nhanh với Haiku...")
        logger.info(
            "TelegramBot: /quick calling Haiku analyzer finding=%s topic=%s requested_by=%s",
            finding.finding_id[:8], finding.topic_id, sender,
        )

        try:
            analysis_response = self._analyzer.analyze(finding, topic.analysis_config)
            self._send(chat_id, self._format_quick_result(finding, analysis_response))
            logger.info(
                "TelegramBot: /quick analysis sent finding=%s requested_by=%s tokens=%d duration=%dms cost=%.4f",
                finding.finding_id[:8], sender,
                analysis_response.input_tokens + analysis_response.output_tokens,
                analysis_response.duration_ms,
                analysis_response.cost_usd,
            )
        except Exception as exc:
            logger.error(
                "TelegramBot: /quick analyze failed finding=%s requested_by=%s error=%s",
                finding_id[:8], sender, exc,
            )
            self._send(chat_id, f"❌ Lỗi phân tích: {exc}")

    def _handle_analyze(self, chat_id: int | str, text: str, message: dict, sender: str) -> None:
        """Xử lý /analyze — forward tới Layer 2 agent."""
        if not self._layer2_url:
            logger.warning("TelegramBot: /analyze requested but LAYER2_URL not configured")
            self._send(chat_id, "⚠️ <b>/analyze không khả dụng</b> — <code>LAYER2_URL</code> chưa set.")
            return

        finding_id = self._resolve_finding_id(text, message)
        if not finding_id:
            logger.warning("TelegramBot: /analyze without finding_id from %s", sender)
            self._send(chat_id, "Usage: /analyze &lt;finding_id&gt;\nHoặc reply trực tiếp vào alert message.")
            return

        logger.info(
            "TelegramBot: /analyze looking up finding id=%s requested_by=%s",
            finding_id[:8], sender,
        )

        # Verify finding exists locally trước khi gửi Layer 2
        finding = self._findings_repo.find_by_id(finding_id) \
            or self._findings_repo.find_by_id_prefix(finding_id)
        if not finding:
            logger.warning(
                "TelegramBot: /analyze finding not found id=%s requested_by=%s",
                finding_id[:8], sender,
            )
            self._send(chat_id, f"❌ Không tìm thấy finding: <code>{finding_id}</code>")
            return

        self._send(chat_id, "🤖 Đang phân tích sâu với AI Agent...")
        logger.info(
            "TelegramBot: /analyze forwarding to Layer 2 finding=%s requested_by=%s",
            finding.finding_id[:8], sender,
        )

        try:
            # POST to Layer 2
            payload = json.dumps({
                "finding_id": finding_id,
                "channel": "telegram",
                "requested_by": sender,
            }).encode()
            req = urllib.request.Request(
                f"{self._layer2_url}/api/v1/analyze",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                result_json = json.loads(resp.read())

            analysis_text = result_json.get("analysis_text", "")
            cost = result_json.get("cost_usd", 0.0)
            tool_calls = len(result_json.get("tool_calls", []))
            input_tokens = result_json.get("input_tokens", 0)
            output_tokens = result_json.get("output_tokens", 0)
            cache_read_tokens = result_json.get("cache_read_tokens", 0)
            cache_creation_tokens = result_json.get("cache_creation_tokens", 0)
            duration_ms = result_json.get("total_duration_ms", 0)

            # Format và gửi kết quả
            self._send(chat_id, self._format_layer2_result(
                finding, analysis_text, cost, tool_calls,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                duration_ms
            ))
            logger.info(
                "TelegramBot: /analyze result sent finding=%s requested_by=%s cost=%.4f tools=%d tokens=%d cache_hit=%s duration=%dms",
                finding.finding_id[:8], sender, cost, tool_calls,
                input_tokens + output_tokens,
                "YES" if cache_read_tokens > 0 else "NO",
                duration_ms,
            )
        except socket.timeout:
            logger.error(
                "TelegramBot: /analyze Layer 2 timeout finding=%s requested_by=%s",
                finding_id[:8], sender,
            )
            self._send(chat_id, "❌ Layer 2 agent timeout (>120s). Thử lại sau.")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error(
                "TelegramBot: /analyze Layer 2 HTTP %d finding=%s requested_by=%s body=%s",
                exc.code, finding_id[:8], sender, body[:200],
            )
            self._send(chat_id, f"❌ Layer 2 lỗi: HTTP {exc.code}. Xem logs chi tiết.")
        except urllib.error.URLError as exc:
            logger.error(
                "TelegramBot: /analyze Layer 2 connection error finding=%s requested_by=%s error=%s",
                finding_id[:8], sender, exc,
            )
            self._send(chat_id, "❌ Không kết nối được Layer 2 agent. Kiểm tra LAYER2_URL.")
        except Exception as exc:
            logger.error(
                "TelegramBot: /analyze unexpected error finding=%s requested_by=%s error=%s",
                finding_id[:8], sender, exc,
            )
            self._send(chat_id, f"❌ Lỗi: {exc}")

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

    def _format_quick_result(self, finding: Finding, response) -> str:
        """Format kết quả /quick (Haiku) — ngắn gọn + metadata + clear separation."""
        time_str = finding.detected_at.strftime("%Y-%m-%d %H:%M:%S +07")
        total_tokens = response.input_tokens + response.output_tokens

        metadata = "\n".join([
            f"⚡ <b>Quick Analysis — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━",
            f"🖥 Node: <code>{html.escape(finding.node)}</code> | 📋 <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 {time_str} | 🤖 {html.escape(response.model)}",
            f"⏱️  {response.duration_ms}ms | 📊 {total_tokens}t | 💰 ${response.cost_usd:.6f}",
        ])

        divider = "\n" + "━" * 50 + "\n"

        footer = f"\n\n🔗 ID: <code>{finding.finding_id[:8]}</code>"
        # Estimate lengths để đảm bảo analysis_text không bị cắt quá ngắn
        max_analysis = 4096 - len(metadata) - len(divider) - len(footer) - 50

        return metadata + divider + html.escape(response.analysis_text[:max_analysis]) + footer

    def _format_layer2_result(
        self, finding: Finding, analysis_text: str, cost_usd: float, tool_calls_count: int,
        input_tokens: int, output_tokens: int, cache_read_tokens: int, cache_creation_tokens: int,
        duration_ms: int
    ) -> str:
        """Format kết quả /analyze (Layer 2 agent) — metadata + analysis + clear separation."""
        time_str = finding.detected_at.strftime("%Y-%m-%d %H:%M:%S +07")
        total_tokens = input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens
        cache_status = f"HIT ({cache_read_tokens:,} cached)" if cache_read_tokens > 0 else "MISS"

        metadata = "\n".join([
            f"🔍 <b>Agent Analysis — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🖥 Node: <code>{html.escape(finding.node)}</code> | 📋 <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 {time_str} | 🤖 <code>claude-sonnet-4-6</code>",
            f"⏱️  {duration_ms}ms | 🔧 {tool_calls_count} tools | 💾 {cache_status}",
            f"📊 {total_tokens:,}t (in: {input_tokens:,}, out: {output_tokens:,}) | 💰 ${cost_usd:.6f}",
        ])

        divider = "\n" + "━" * 50 + "\n"

        footer = f"\n\n🔗 ID: <code>{finding.finding_id[:8]}</code>"
        # Estimate lengths để đảm bảo analysis_text không bị cắt quá ngắn
        max_analysis = 4096 - len(metadata) - len(divider) - len(footer) - 50

        return metadata + divider + html.escape(analysis_text[:max_analysis]) + footer

    def _resolve_finding_id(self, text: str, message: dict) -> str | None:
        """
        Resolve finding_id từ 2 nguồn:
          1. /quick <id> hoặc /analyze <id> — lấy từ argument
          2. reply vào alert — parse dòng "🔗 ID: ..." trong message gốc
        """
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            return parts[1].strip()

        # Reply case: tìm finding_id trong text của message được reply
        reply_text = (message.get("reply_to_message") or {}).get("text", "")
        for line in reply_text.splitlines():
            if "ID:" in line:
                # Match UUIDv4: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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
