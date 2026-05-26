"""
telegram_bot.py — Layer 1 Telegram Bot polling + /quick command handler.

Chạy trong daemon thread song song với APScheduler.
Long-poll getUpdates (timeout=25s) để nhận /quick command từ user.

Hỗ trợ 1 lệnh:
  /quick <finding_id>  → Layer 1 Haiku model (nhanh, phân tích sơ bộ)
                         Gửi file .txt + caption metadata

Hỗ trợ reply vào alert message để lấy finding_id tự động.

NOTE: /analyze command được xử lý bởi Layer 2 bot riêng (token khác) —
      tránh conflict với multi-turn session của Layer 2.
"""
from __future__ import annotations

import html
import json
import logging
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING

from ..models.findings import Finding
from ..services.topic_action_service import topic_action_registry

if TYPE_CHECKING:
    from ..ai.plan_analyzer import PlanAnalyzer
    from ..storage.repositories.findings_repo import FindingsRepo
    from ..storage.repositories.topic_repo import TopicRepo

logger = logging.getLogger(__name__)


class TelegramBot:
    """
    Polling bot Layer 1 nhận /quick command.

    /quick: Dùng Haiku model Layer 1 — phân tích nhanh, rẻ, gửi file .txt

    /analyze: Được xử lý bởi Layer 2 bot riêng (token TELEGRAM_BOT_TOKEN khác).

    Thread-safe: chỉ 1 daemon thread, không share state với APScheduler.
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        findings_repo: FindingsRepo,
        topic_repo: TopicRepo,
        analyzer: PlanAnalyzer | None,  # None nếu không có claude_api_key
        action_bot_token: str = "",
    ) -> None:
        self._chat_id = chat_id
        self._findings_repo = findings_repo
        self._topic_repo = topic_repo
        self._analyzer = analyzer
        self._api_base = f"https://api.telegram.org/bot{bot_token}"
        self._action_api_base = (
            f"https://api.telegram.org/bot{action_bot_token}"
            if action_bot_token
            else self._api_base
        )

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
        if update.get("callback_query"):
            self._handle_callback_query(update["callback_query"])
            return

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
        elif message.get("reply_to_message"):
            self._handle_reply_to_alert(chat_id, text, message, sender)

    def _handle_callback_query(self, callback_query: dict) -> None:
        """Handle inline keyboard callback and dispatch to existing handlers."""
        callback_id = str(callback_query.get("id") or "")
        data = str(callback_query.get("data") or "")
        msg = callback_query.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id")
        sender = self._get_sender_from_user(callback_query.get("from") or {})

        if not data.startswith("l1|"):
            self._answer_callback_query(callback_id, "Callback không hợp lệ.")
            return

        parts = data.split("|")
        if len(parts) < 3:
            self._answer_callback_query(callback_id, "Callback thiếu dữ liệu.")
            return

        action = parts[1]
        finding_id = parts[2].strip()
        if not finding_id:
            self._answer_callback_query(callback_id, "Thiếu finding_id.")
            return

        self._answer_callback_query(callback_id, "Đang xử lý...")

        if action == "quick":
            self._handle_quick(chat_id, f"/quick {finding_id}", {}, sender)
            return
        if action == "analyze":
            self._forward_to_layer2(finding_id, chat_id, sender)
            return
        if action == "act":
            if len(parts) < 4:
                self._send(chat_id, "⚠️ Callback action thiếu command.")
                return
            command = parts[3].strip()
            self._handle_topic_action(chat_id, command, finding_id, sender)
            return

        self._send(chat_id, f"⚠️ Callback action không hỗ trợ: <code>{html.escape(action)}</code>")

    def _handle_reply_to_alert(self, chat_id: int | str, text: str, message: dict, sender: str) -> None:
        """Reply vào Layer 1 alert → /quick hoặc forward to Layer 2."""
        finding_id = self._resolve_finding_id("", message)
        if not finding_id:
            return  # Reply vào message không phải Layer 1 alert

        cmd = text.strip().split(maxsplit=1)[0].lower()
        if cmd.startswith("/quick"):
            self._handle_quick(chat_id, f"/quick {finding_id}", message, sender)
        elif cmd.startswith("/") and cmd not in {"/analyze"}:
            self._handle_topic_action(chat_id, cmd, finding_id, sender)
        else:
            self._forward_to_layer2(finding_id, chat_id, sender)

    def _handle_topic_action(self, chat_id: int | str, command: str, finding_id: str, sender: str) -> None:
        """Chạy command theo topic handler (Template Method)."""
        finding = self._findings_repo.find_by_id(finding_id) \
            or self._findings_repo.find_by_id_prefix(finding_id)
        if not finding:
            self._send(chat_id, f"❌ Không tìm thấy finding: <code>{html.escape(finding_id)}</code>")
            return

        logger.warning(
            "TelegramBot: %s requested_by=%s finding=%s",
            command, sender, finding.finding_id[:8],
        )
        self._send(chat_id, f"🛠 Đang xử lý <code>{html.escape(command)}</code>...")
        result = topic_action_registry.execute(finding, command)

        if result.get("code") == "topic_not_allowed":
            self._send(
                chat_id,
                f"⚠️ Lệnh <code>{html.escape(command)}</code> không áp dụng cho topic <code>{html.escape(finding.topic_id)}</code>.",
            )
            return
        if result.get("code") == "invalid_metric":
            metric_key = str(result.get("metric_key") or "session_id")
            self._send(
                chat_id,
                f"❌ Finding <code>{finding.finding_id[:8]}</code> không có <code>metrics.{html.escape(metric_key)}</code> hợp lệ.",
            )
            return
        if result.get("code") == "unsupported_command":
            self._send(chat_id, f"⚠️ Lệnh <code>{html.escape(command)}</code> chưa được hỗ trợ cho topic này.")
            return

        if result.get("ok"):
            session_id = str(result.get("session_id") or "")
            host = str(result.get("host") or "unknown")
            target_node = str(result.get("target_node") or host)
            self._send_action_report(
                chat_id,
                f"✅ Thực thi <code>{html.escape(command)}</code> thành công:\n"
                f"• target_session: <code>{html.escape(session_id)}</code>\n"
                f"• target_node: <code>{html.escape(target_node)}</code>\n"
                f"• executed_host: <code>{html.escape(host)}</code>",
            )
            return

        message = html.escape(str(result.get("message") or "Unknown error"))
        errors = result.get("errors") or []
        target_node = str(result.get("target_node") or "")
        detail = ""
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, dict):
                detail = html.escape(str(first.get("error") or ""))[:200]
        if detail:
            node_line = f"\n• target_node: <code>{html.escape(target_node)}</code>" if target_node else ""
            self._send_action_report(
                chat_id,
                f"❌ Thực thi <code>{html.escape(command)}</code> thất bại:{node_line}\n{message}\n<code>{detail}</code>",
            )
        else:
            node_line = f"\n• target_node: <code>{html.escape(target_node)}</code>" if target_node else ""
            self._send_action_report(
                chat_id,
                f"❌ Thực thi <code>{html.escape(command)}</code> thất bại:{node_line}\n{message}",
            )

    def _forward_to_layer2(self, finding_id: str, chat_id: int | str, sender: str) -> None:
        """Forward finding analysis request tới Layer 2 agent qua HTTP."""
        from ..config import settings

        if not settings.layer2_url:
            logger.warning("TelegramBot: /analyze requested but LAYER2_URL not configured")
            self._send(chat_id, "⚠️ <b>/analyze không khả dụng</b> — <code>LAYER2_URL</code> chưa set.")
            return

        logger.info(
            "TelegramBot: forwarding to Layer 2 finding_id=%s requested_by=%s",
            finding_id[:8], sender,
        )
        self._send(chat_id, f"⏳ Phân tích sâu <code>{html.escape(finding_id[:8])}</code>... (Layer 2 agent)")

        try:
            payload = json.dumps({
                "finding_id": finding_id,
                "channel": "telegram",
                "telegram_chat_id": str(chat_id),
                "requested_by": sender,
            }).encode()
            url = f"{settings.layer2_url}/api/v1/analyze"
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            logger.debug("TelegramBot: forwarding to Layer 2 %s", url)
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())

            # Layer 2 bot đã gửi Telegram message trực tiếp — chỉ cần log
            logger.info(
                "TelegramBot: Layer 2 analysis done finding=%s requested_by=%s cost=%.6f duration=%dms",
                finding_id[:8], sender,
                result.get("cost_usd", 0.0),
                result.get("total_duration_ms", 0),
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error("TelegramBot: /analyze HTTP %d: %s", exc.code, body[:200])
            self._send(chat_id, f"❌ Layer 2 lỗi HTTP {exc.code}: {html.escape(body[:100])}")
        except urllib.error.URLError as exc:
            reason = str(exc.reason)
            logger.error("TelegramBot: /analyze URLError: %s", reason)
            if "timed out" in reason.lower():
                self._send(
                    chat_id,
                    "⏰ Layer 2 không phản hồi (timeout 120s).\nKiểm tra <code>layer2</code> container status.",
                )
            else:
                self._send(
                    chat_id,
                    f"❌ Không kết nối được Layer 2: {html.escape(reason[:80])}\n"
                    f"Kiểm tra <code>LAYER2_URL</code> và service status.",
                )
        except Exception as exc:
            logger.error(
                "TelegramBot: /analyze failed finding=%s requested_by=%s error=%s",
                finding_id[:8], sender, exc, exc_info=True,
            )
            self._send(chat_id, f"❌ Lỗi phân tích: {html.escape(str(exc)[:100])}")

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
            root_cause, quick_fix, detail_text = self._extract_quick_summary(analysis_response.analysis_text)
            logger.debug(
                "TelegramBot /quick: extracted root_cause_len=%d quick_fix_len=%d detail_text_len=%d",
                len(root_cause), len(quick_fix), len(detail_text),
            )
            caption = self._format_quick_caption(finding, analysis_response, root_cause, quick_fix)
            filename = f"quick_{finding.finding_id[:8]}.txt"
            self._send_document(chat_id, filename, detail_text.encode("utf-8"), caption)
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

    @staticmethod
    def _get_sender_from_user(user: dict) -> str:
        """Format sender string from callback_query.from."""
        first = user.get("first_name", "")
        last = user.get("last_name", "")
        username = user.get("username", "")
        user_id = user.get("id", "?")
        name = f"{first} {last}".strip() or "Unknown"
        suffix = f"@{username}" if username else f"id={user_id}"
        return f"{name} ({suffix})"

    def _format_quick_caption(self, finding: Finding, response, root_cause: str, quick_fix: str) -> str:
        """Caption cho document /quick — metadata + summary + link file."""
        time_str = finding.detected_at.strftime("%Y-%m-%d %H:%M:%S +07")
        total_tokens = response.input_tokens + response.output_tokens

        parts = [
            f"⚡ <b>Quick Analysis — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━",
            f"🖥 Node: <code>{html.escape(finding.node)}</code> | 📋 <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 {time_str} | 🤖 {html.escape(response.model)}",
            f"⏱️  {response.duration_ms}ms | 📊 {total_tokens}t | 💰 ${response.cost_usd:.6f}",
            f"🔗 ID: <code>{finding.finding_id}</code>",
        ]
        if root_cause:
            parts.append("")
            parts.append(f"💡 <b>Root cause:</b> {html.escape(root_cause)}")
        if quick_fix:
            parts.append(f"⚡ <b>Fix ngay:</b> {html.escape(quick_fix)}")
        parts.append("")
        parts.append("📄 Xem phân tích đầy đủ trong file đính kèm")
        return "\n".join(parts)

    @staticmethod
    def _extract_quick_summary(analysis_text: str) -> tuple[str, str, str]:
        """
        Parse structured output từ plan_analyzer.
        Trả về (root_cause, quick_fix, full_detail_text).
        full_detail_text là phần sau dòng '---' (phần phân tích chi tiết).
        Nếu không có separator, toàn bộ text là full_detail_text.
        """
        root_cause = ""
        quick_fix = ""
        full_text = analysis_text

        lines = analysis_text.splitlines()
        separator_idx = None
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("ROOT_CAUSE:"):
                root_cause = stripped[len("ROOT_CAUSE:"):].strip()
            elif stripped.startswith("QUICK_FIX:"):
                quick_fix = stripped[len("QUICK_FIX:"):].strip()
            elif stripped == "---":
                separator_idx = i
                break

        if separator_idx is not None:
            full_text = "\n".join(lines[separator_idx + 1:]).strip()

        return root_cause, quick_fix, full_text

    @staticmethod
    def _truncate_to_sentence(text: str, max_chars: int) -> str:
        """Lấy tối đa max_chars ký tự từ text, cắt tại cuối câu gần nhất."""
        if not text:
            return ""
        if len(text) <= max_chars:
            return text.strip()
        chunk = text[:max_chars]
        for sep in (".", "!", "?", "\n"):
            idx = chunk.rfind(sep)
            if idx > max_chars // 2:
                return chunk[:idx + 1].strip()
        return chunk.strip() + "..."

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
        self._send_with_api_base(self._api_base, chat_id, text)

    def _send_action_report(self, chat_id: int | str, text: str) -> None:
        """Send action execution result via ACTION_BOT_TOKEN when configured."""
        self._send_with_api_base(self._action_api_base, chat_id, text)

    @staticmethod
    def _send_with_api_base(api_base: str, chat_id: int | str, text: str) -> None:
        """Send HTML message to a specific Telegram bot api base."""
        try:
            payload = json.dumps({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            }).encode()
            req = urllib.request.Request(
                f"{api_base}/sendMessage",
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

    def _answer_callback_query(self, callback_query_id: str, text: str | None = None) -> None:
        """Answer callback query so Telegram client stops loading state."""
        if not callback_query_id:
            return
        try:
            body = {"callback_query_id": callback_query_id}
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
            logger.error("TelegramBot answerCallbackQuery failed: %s", exc)

    def _send_document(self, chat_id: int | str, filename: str, content: bytes, caption: str) -> None:
        """Gửi file document với caption HTML. Dùng multipart/form-data, không raise."""
        try:
            boundary = f"----LayerOneBot{secrets.token_hex(12)}"
            body = bytearray()

            def _field(name: str, value: str) -> None:
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
                body.extend(value.encode("utf-8"))
                body.extend(b"\r\n")

            _field("chat_id", str(chat_id))
            # Telegram caption limit: 1024 chars
            _field("caption", caption[:1024])
            _field("parse_mode", "HTML")

            body.extend(f"--{boundary}\r\n".encode())
            body.extend(
                f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'.encode()
            )
            body.extend(b"Content-Type: text/plain; charset=utf-8\r\n\r\n")
            body.extend(content)
            body.extend(b"\r\n")
            body.extend(f"--{boundary}--\r\n".encode())

            req = urllib.request.Request(
                f"{self._api_base}/sendDocument",
                data=bytes(body),
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                method="POST",
            )
            logger.debug("TelegramBot sendDocument: chat_id=%s filename=%s content_size=%d", chat_id, filename, len(content))
            with urllib.request.urlopen(req, timeout=15) as resp:
                logger.info("TelegramBot sendDocument: success chat_id=%s filename=%s status=%d", chat_id, filename, resp.status)
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode(errors="replace")
            logger.error("TelegramBot sendDocument HTTP %d chat_id=%s filename=%s: %s", exc.code, chat_id, filename, err_body[:500])
        except urllib.error.URLError as exc:
            logger.error("TelegramBot sendDocument URLError chat_id=%s filename=%s: %s", chat_id, filename, exc)
        except Exception as exc:
            logger.error("TelegramBot sendDocument failed chat_id=%s filename=%s: %s", chat_id, filename, exc, exc_info=True)
