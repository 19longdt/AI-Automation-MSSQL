"""
telegram_bot.py — Telegram Bot polling cho Layer 2 AI Analysis Agent.

Bot này KHÁC với Layer 1 bot — dùng token riêng để tránh polling conflict.
Layer 1 bot: gửi alert (TelegramNotifier, không poll).
Layer 2 bot: nhận /analyze, /summary, multi-turn reply.

Commands:
  /analyze <finding_id>  — phân tích finding với Claude AI
  /summary               — tổng hợp 30 ngày gần nhất
  Reply vào analysis     — follow-up question (multi-turn)

Analysis chạy trong ThreadPoolExecutor vì orchestrator là blocking I/O
(Claude API + MSSQL DMV). Bot không block poll loop khi đang phân tích.
"""
from __future__ import annotations

import concurrent.futures
import html
import json
import logging
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from ..models.analysis import AnalysisRequest, AnalysisStatus
from ..storage.repositories.insight_repo import InsightRepo
from ..storage.repositories.session_repo import SessionRepo
from ..utils.time_utils import now_vn

if TYPE_CHECKING:
    from ..agent.orchestrator import AgentOrchestrator

logger = logging.getLogger(__name__)

_SUMMARY_DAYS = 30


class TelegramBot:
    """
    Polling bot cho Layer 2. Daemon thread — dừng khi main process dừng.
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        orchestrator: AgentOrchestrator,
    ) -> None:
        self._chat_id = chat_id
        self._api_base = f"https://api.telegram.org/bot{bot_token}"
        self._orchestrator = orchestrator
        self._insight_repo = InsightRepo()
        self._session_repo = SessionRepo()
        # Pool 2 workers: cho phép 2 analysis chạy song song (tránh queue lâu)
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="layer2-analysis")

    def start(self) -> None:
        thread = threading.Thread(target=self._poll_loop, daemon=True, name="layer2-telegram-bot")
        thread.start()

    def send_startup(
        self,
        skills: list,
        primary: str | None,
        secondaries: list[str],
        model: str,
        timeout_sec: int,
        peak_start: int,
        peak_end: int,
    ) -> None:
        """Gửi thông báo khởi động Layer 2 khi deploy mới."""
        time_str = now_vn().strftime("%Y-%m-%d %H:%M:%S +07")
        nodes_primary = f"<code>{html.escape(primary)}</code>" if primary else "<i>unknown</i>"
        nodes_secondary = ", ".join(html.escape(n) for n in secondaries) if secondaries else "<i>none</i>"
        commands = "/analyze &lt;id&gt; · /summary"

        secondary_line = f"🔄 Secondary: <code>{nodes_secondary}</code>" if secondaries else "🔄 Secondary: <i>none</i>"
        parts = [
            "🤖 <b>Layer 2 Agent — Deploy mới</b>",
            "━━━━━━━━━━━━━━━━━━",
            f"🕐 {time_str}",
            f"🧠 Model:   <code>{html.escape(model)}</code>",
            f"🛠 Skills:  {len(skills)} loaded",
            f"🖥 Primary:   {nodes_primary}",
            secondary_line,
            f"⏱ Timeout:  {timeout_sec}s | ⚡ Peak: {peak_start:02d}:00–{peak_end:02d}:00",
            f"📌 Commands: {commands}",
        ]
        text = "\n".join(parts)
        try:
            self._send(self._chat_id, text)
            logger.info("TelegramBot: startup notification sent")
        except Exception as exc:
            logger.error("TelegramBot: send_startup failed: %s", exc)

    # ── Poll loop ─────────────────────────────────────────────────────────────

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
                        logger.error("TelegramBot handle_update error: %s", exc, exc_info=True)
            except Exception as exc:
                logger.warning("TelegramBot poll error: %s — retry in 5s", exc)
                time.sleep(5)

    def _get_updates(self, offset: int, timeout: int) -> list[dict]:
        url = f"{self._api_base}/getUpdates?offset={offset}&timeout={timeout}"
        with urllib.request.urlopen(url, timeout=timeout + 5) as resp:
            return json.loads(resp.read()).get("result", [])

    # ── Command routing ───────────────────────────────────────────────────────

    def _handle_update(self, update: dict) -> None:
        message = update.get("message", {})
        text = (message.get("text") or "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))
        sender = _sender_str(message)

        if not text:
            return

        logger.debug("TelegramBot: message from %s — %r", sender, text[:80])

        if text.startswith("/analyze"):
            self._handle_analyze(text, message, chat_id, sender)
        elif text.startswith("/summary"):
            self._handle_summary(chat_id, sender)
        elif message.get("reply_to_message"):
            self._handle_reply(text, message, chat_id, sender)

    # ── /analyze ──────────────────────────────────────────────────────────────

    def _handle_analyze(self, text: str, message: dict, chat_id: str, sender: str) -> None:
        parts = text.split(maxsplit=1)
        finding_id = parts[1].strip() if len(parts) > 1 else ""

        if not finding_id:
            self._send(chat_id, "Usage: <code>/analyze &lt;finding_id&gt;</code>")
            return

        self._handle_analyze_by_id(finding_id, chat_id, sender)

    def _handle_analyze_by_id(self, finding_id: str, chat_id: str, sender: str) -> None:
        """Common entry point cho /analyze command và reply từ Layer 1 alert."""
        logger.info("TelegramBot: /analyze finding_id=%s requested_by=%s", finding_id[:8], sender)
        self._send(chat_id, f"⏳ Đang phân tích <code>{html.escape(finding_id[:8])}</code>...")

        request = AnalysisRequest(
            finding_id=finding_id,
            channel="telegram",
            requested_by=sender,
        )

        # Chạy analysis trong thread pool — không block poll loop
        self._executor.submit(self._run_and_reply, request, chat_id, sender, session=None)

    # ── /summary ─────────────────────────────────────────────────────────────

    def _handle_summary(self, chat_id: str, sender: str) -> None:
        logger.info("TelegramBot: /summary requested_by=%s", sender)
        try:
            since = now_vn() - timedelta(days=_SUMMARY_DAYS)
            summary = self._insight_repo.get_summary(since)
            self._send(chat_id, _format_summary(summary))
        except Exception as exc:
            logger.error("TelegramBot: /summary failed: %s", exc)
            self._send(chat_id, f"❌ Lỗi lấy summary: {html.escape(str(exc))}")

    # ── Reply (multi-turn) ────────────────────────────────────────────────────

    def _handle_reply(self, text: str, message: dict, chat_id: str, sender: str) -> None:
        reply_to_id = message.get("reply_to_message", {}).get("message_id")
        if not reply_to_id:
            return

        session = self._session_repo.find_by_telegram_message_id(reply_to_id)
        if not session:
            # Không tìm thấy session Layer 2 → thử parse finding_id từ Layer 1 alert
            reply_text = (message.get("reply_to_message") or {}).get("text", "")
            finding_id = _extract_finding_id_from_alert(reply_text)
            if finding_id:
                self._handle_analyze_by_id(finding_id, chat_id, sender)
            return  # reply vào message khác, không phải analysis

        logger.info(
            "TelegramBot: follow-up session_id=%s requested_by=%s",
            session.get("session_id"), sender,
        )
        self._send(chat_id, "⏳ Đang xử lý câu hỏi tiếp theo...")

        request = AnalysisRequest(
            finding_id=session["finding_id"],
            channel="telegram",
            telegram_message_id=reply_to_id,
            follow_up_text=text,
            requested_by=sender,
        )
        self._executor.submit(self._run_and_reply, request, chat_id, sender, session=session)

    # ── Core: run analysis + send result ─────────────────────────────────────

    def send_analysis_result(
        self,
        result: Any,
        chat_id: str,
        session: dict[str, Any] | None = None,
        follow_up_text: str | None = None,
    ) -> None:
        """Gửi kết quả analysis tới Telegram — dùng cho cả bot-internal và API-triggered."""
        if result.status == AnalysisStatus.TIMEOUT:
            self._send(
                chat_id,
                f"⏰ Phân tích timeout: {html.escape(result.error or 'Timeout')}.\n"
                f"Thử <code>/quick {result.finding_id[:8]}</code> để phân tích nhanh hơn.",
            )
            return

        if result.status != AnalysisStatus.COMPLETED or not result.analysis_text:
            self._send(chat_id, f"❌ Phân tích thất bại: {html.escape(result.error or 'Không có kết quả.')}")
            return

        caption = _format_analysis_caption(result)
        filename = f"analyze_{result.finding_id[:8]}.txt"
        sent_msg_id = self._send_document(chat_id, filename, result.analysis_text.encode("utf-8"), caption)

        if sent_msg_id:
            try:
                if session is None:
                    self._session_repo.create(
                        finding_id=result.finding_id,
                        channel="telegram",
                        first_turn_text=result.analysis_text,
                        analysis_id=result.analysis_id,
                        telegram_message_id=sent_msg_id,
                    )
                else:
                    self._session_repo.append_turns(
                        session_id=session["session_id"],
                        user_text=follow_up_text or "",
                        assistant_text=result.analysis_text,
                        analysis_id=result.analysis_id,
                    )
            except Exception as exc:
                logger.error("TelegramBot: session update failed: %s", exc)

    def _run_and_reply(
        self,
        request: AnalysisRequest,
        chat_id: str,
        sender: str,
        session: dict[str, Any] | None,
    ) -> None:
        """Chạy trong thread pool. Gọi orchestrator → gửi kết quả → update session."""
        try:
            result = self._orchestrator.run(request)
        except Exception as exc:
            logger.error("TelegramBot: orchestrator.run failed: %s", exc)
            self._send(chat_id, f"❌ Lỗi nội bộ: {html.escape(str(exc))}")
            return

        self.send_analysis_result(result, chat_id, session, request.follow_up_text)

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def _send(self, chat_id: str, text: str) -> None:
        self._send_get_id(chat_id, text)

    def _send_get_id(self, chat_id: str, text: str) -> int | None:
        """Gửi message, trả về message_id của message đã gửi (dùng cho session key)."""
        # Telegram giới hạn 4096 ký tự
        if len(text) > 4096:
            text = text[:4050] + "\n\n<i>... (truncated)</i>"
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
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data.get("result", {}).get("message_id")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error("TelegramBot send HTTP %d: %s", exc.code, body)
        except Exception as exc:
            logger.error("TelegramBot send failed: %s", exc)
        return None

    def _send_document(self, chat_id: str, filename: str, content: bytes, caption: str) -> int | None:
        """Gửi document với caption. Trả về message_id của message đã gửi."""
        try:
            # Truncate caption nếu > 1024 (Telegram limit)
            if len(caption) > 1024:
                caption = caption[:1000] + "\n<i>... (truncated)</i>"

            boundary = f"----Layer2Bot{secrets.token_hex(12)}"
            body = bytearray()

            def _field(name: str, value: str) -> None:
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
                body.extend(value.encode("utf-8"))
                body.extend(b"\r\n")

            _field("chat_id", str(chat_id))
            _field("caption", caption)
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
            logger.debug("TelegramBot: sendDocument filename=%s content_size=%d", filename, len(content))
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                msg_id = data.get("result", {}).get("message_id")
                logger.info("TelegramBot: sendDocument success chat_id=%s filename=%s msg_id=%s", chat_id, filename, msg_id)
                return msg_id
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error("TelegramBot: sendDocument HTTP %d filename=%s: %s", exc.code, filename, body[:200])
        except Exception as exc:
            logger.error("TelegramBot: sendDocument failed filename=%s: %s", filename, exc, exc_info=True)
        return None


# ── Formatting helpers ────────────────────────────────────────────────────────

def _format_analysis_caption(result: Any) -> str:
    """Format caption cho document — hiển thị metadata + root cause + fix nhanh."""
    finding = result.finding_snapshot or {}
    node = html.escape(finding.get("node", "?"))
    topic = html.escape(finding.get("topic_id", "?"))

    detected_at = finding.get("detected_at")
    time_str = ""
    if detected_at:
        if hasattr(detected_at, "strftime"):
            time_str = detected_at.strftime("%Y-%m-%d %H:%M:%S +07")
        else:
            time_str = str(detected_at)

    # Tokens formatting
    total_tokens = result.input_tokens + result.output_tokens
    input_t = result.input_tokens
    output_t = result.output_tokens
    cache_r = result.cache_read_tokens

    cache_status = f"HIT ({cache_r:,} cached)" if cache_r > 0 else "MISS"

    parts = [
        f"🖥 Node:        <code>{node}</code>",
        f"📋 Topic:       <code>{topic}</code>",
        f"🕐 Time:        {time_str}",
        f"🤖 Model:       <code>{html.escape(result.model)}</code>",
        f"⏱️  Response:    {result.total_duration_ms or 0}ms",
        f"🔧 Tool calls:  {len(result.tool_calls)}",
        f"📊 Tokens:      {total_tokens:,} (in: {input_t:,}, out: {output_t:,})",
        f"💾 Cache:       {cache_status}",
        f"💰 Cost:        ${result.cost_usd:.6f}",
    ]

    # Root cause + fix nhanh từ insight
    if result.root_cause_summary or result.top_actions:
        parts.append("")
        parts.append("━━━━━━━━━━━━━━━━━━")

    if result.root_cause_summary:
        parts.append(f"💡 Root cause:  {html.escape(result.root_cause_summary)}")

    if result.top_actions:
        parts.append(f"⚡ Fix ngay:    {html.escape(result.top_actions[0])}")
        if len(result.top_actions) > 1:
            parts.append(f"                {html.escape(result.top_actions[1])}")

    parts.extend([
        "",
        "📄 Phân tích đầy đủ trong file đính kèm",
        "<i>Reply để hỏi thêm</i>",
    ])

    return "\n".join(parts)


def _format_summary(summary: dict) -> str:
    lines = [
        f"📊 <b>AI Insights Summary — {_SUMMARY_DAYS} ngày gần nhất</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
    ]

    root_causes = summary.get("top_root_causes", [])
    if root_causes:
        lines.append("\n🔴 <b>Top Root Causes:</b>")
        for r in root_causes[:5]:
            tables = ", ".join(r.get("tables", [])[:3])
            lines.append(
                f"  • <code>{html.escape(r['root_cause_category'])}</code>"
                f" × {r['count']}"
                + (f" ({html.escape(tables)})" if tables else "")
            )

    top_tables = summary.get("top_tables", [])
    if top_tables:
        lines.append("\n📋 <b>Top Tables bị ảnh hưởng:</b>")
        for t in top_tables[:5]:
            lines.append(f"  • <code>{html.escape(t['table'])}</code> — {t['incident_count']} incidents")

    backlog = summary.get("unresolved_high_priority_count", 0)
    if backlog:
        lines.append(f"\n⚠️ <b>Backlog:</b> {backlog} high-priority actions chưa resolve")

    arch_actions = summary.get("unresolved_architecture_actions", [])
    if arch_actions:
        lines.append(f"\n🏗 <b>Architecture actions cần xem xét:</b> {len(arch_actions)} items")

    if not root_causes and not top_tables:
        lines.append("\n✅ Chưa có insight nào trong khoảng thời gian này.")

    return "\n".join(lines)


def _sender_str(message: dict) -> str:
    user = message.get("from") or {}
    first = user.get("first_name", "")
    last = user.get("last_name", "")
    username = user.get("username", "")
    uid = user.get("id", "?")
    name = f"{first} {last}".strip() or "Unknown"
    suffix = f"@{username}" if username else f"id={uid}"
    return f"{name} ({suffix})"


def _extract_finding_id_from_alert(text: str) -> str | None:
    """Parse UUID từ Layer 1 alert message format '🔗 ID: <code>UUID</code>'."""
    m = re.search(r"ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", text)
    return m.group(1) if m else None
