"""
telegram_notifier.py — Gửi alert qua Telegram Bot API.

Dùng urllib (stdlib) thay vì python-telegram-bot async để phù hợp
với APScheduler synchronous execution model.
"""
from __future__ import annotations

import html
import json
import logging
import secrets
import urllib.error
import urllib.request

from .base_notifier import BaseNotifier
from ..models.findings import Finding
from ..services.topic_action_service import topic_action_registry
from ..utils.time_utils import now_vn

logger = logging.getLogger(__name__)

_SEVERITY_ICON = {
    "CRITICAL": "🔴",
    "WARNING":  "🟡",
    "INFO":     "🔵",
}

# _xml/_json thường rất lớn và không đọc được trong Telegram — skip.
# _text (SQL/query text) được inline nếu ngắn, gửi kèm file nếu dài.
_SKIP_SUFFIXES = ("_xml", "_json")
_TEXT_SUFFIX = "_text"

# Ngưỡng chuyển _text field từ inline -> file attachment.
_INLINE_TEXT_MAX = 1500


class TelegramNotifier(BaseNotifier):

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self._chat_id = chat_id
        self._api_base = f"https://api.telegram.org/bot{bot_token}"
        self._api_url = f"{self._api_base}/sendMessage"
        self._doc_url = f"{self._api_base}/sendDocument"

    def send(self, finding: Finding) -> bool:
        """Gửi finding alert. Long _text fields gửi kèm dạng file attachment.

        Trả về True nếu message chính thành công. Attachment failure log
        warning nhưng không fail toàn bộ (alert core đã delivered).
        """
        text, attachments = self._format_finding(finding)
        ok = self._post(text, reply_markup=self._build_inline_keyboard(finding))
        if not ok:
            return False

        for filename, content in attachments:
            if not self._post_document(filename, content, caption=None):
                logger.warning(
                    "TelegramNotifier: attachment %s failed (finding=%s)",
                    filename, finding.finding_id,
                )
        return True

    def send_health_issue(self, message: str) -> bool:
        """Gửi infra health alert (stuck job, MongoDB down...)."""
        return self._post(f"⚠️ <b>Health Alert</b>\n{html.escape(message)}")

    def send_startup(self, nodes: list[str], topic_count: int) -> bool:
        """Gửi thông báo deploy mới khi service khởi động."""
        time_str = now_vn().strftime("%Y-%m-%d %H:%M:%S +07")
        nodes_str = ", ".join(html.escape(n) for n in nodes)
        text = "\n".join([
            "🚀 <b>Layer 1 Monitoring — Deploy mới</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🕐 {time_str}",
            f"🖥 Nodes:  <code>{nodes_str}</code>",
            f"📋 Topics: {topic_count} enabled",
        ])
        return self._post(text)

    def _format_finding(self, finding: Finding) -> tuple[str, list[tuple[str, bytes]]]:
        """Build message HTML + danh sách (filename, content) cần gửi kèm.

        _text fields:
          - <= _INLINE_TEXT_MAX chars -> inline trong <blockquote expandable>
          - > _INLINE_TEXT_MAX chars  -> gửi kèm file .txt
        _xml/_json fields: skip (quá lớn, không đọc được).
        Các field khác: hiển thị scalar như cũ.
        """
        icon = _SEVERITY_ICON.get(finding.severity.value, "⚪")
        time_str = finding.detected_at.strftime("%Y-%m-%d %H:%M:%S +07")

        cluster_part = f"<b>[{html.escape(finding.cluster_id)}]</b> " if finding.cluster_id else ""
        lines = [
            f"{icon} {cluster_part}<b>{html.escape(finding.severity.value)} — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🖥 Node:   <code>{html.escape(finding.node)}</code> ({html.escape(finding.role)})",
            f"📋 Topic:  <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 Time:   {time_str}",
        ]

        scalar_metrics: dict = {}
        inline_texts: list[tuple[str, str]] = []
        attachments: list[tuple[str, bytes]] = []

        for k, v in finding.metrics.items():
            if v is None:
                continue
            if any(k.endswith(s) for s in _SKIP_SUFFIXES):
                continue
            if k.endswith(_TEXT_SUFFIX):
                text_value = str(v)
                if len(text_value) <= _INLINE_TEXT_MAX:
                    inline_texts.append((k, text_value))
                else:
                    attachments.append((self._safe_filename(finding.finding_id, k), text_value.encode("utf-8")))
                continue
            scalar_metrics[k] = v

        if scalar_metrics:
            lines.append("")
            lines.append("📊 <b>Metrics:</b>")
            for k, v in scalar_metrics.items():
                if isinstance(v, float):
                    lines.append(f"  • {html.escape(k)}: <code>{v:,.2f}</code>")
                elif isinstance(v, int):
                    lines.append(f"  • {html.escape(k)}: <code>{v:,}</code>")
                else:
                    lines.append(f"  • {html.escape(k)}: <code>{html.escape(str(v))}</code>")

        for k, text_value in inline_texts:
            lines.append("")
            lines.append(f"📝 <b>{html.escape(k)}:</b>")
            # expandable blockquote: Telegram client shows 4 lines then "Show more".
            lines.append(f"<blockquote expandable>{html.escape(text_value)}</blockquote>")

        if attachments:
            attached_names = ", ".join(html.escape(n) for n, _ in attachments)
            lines.append("")
            lines.append(f"📎 <b>Attachments:</b> <i>{attached_names}</i>")

        lines.append("")
        lines.append(f"🔗 ID: <code>{finding.finding_id}</code>")

        return "\n".join(lines), attachments

    @staticmethod
    def _build_inline_keyboard(finding: Finding) -> dict:
        """Build inline keyboard for one-tap actions without reply parsing."""
        rows: list[list[dict[str, str]]] = [[
            {"text": "⚡ Quick", "callback_data": f"l1|quick|{finding.finding_id}"},
            {"text": "🤖 Analyze", "callback_data": f"l1|analyze|{finding.finding_id}"},
        ]]
        topic_actions = topic_action_registry.commands_for_topic(finding.topic_id)
        if topic_actions:
            action_row: list[dict[str, str]] = []
            for cmd in topic_actions:
                label = cmd
                if cmd == "/kill-session":
                    label = "🛑 Kill Session"
                elif cmd == "/kill-blocking":
                    label = "⛔ Kill Blocking"
                elif cmd == "/kill-head-blocker":
                    label = "⛔ Kill Head Blocker"
                action_row.append({
                    "text": label,
                    "callback_data": f"l1|act|{finding.finding_id}|{cmd}",
                })
            rows.append(action_row)
        return {"inline_keyboard": rows}

    @staticmethod
    def _safe_filename(finding_id: str, field_key: str) -> str:
        """Build tên file đính kèm từ finding_id đầy đủ + field key.
        Giữ ký tự an toàn, thay khác bằng '_'. Luôn đuôi .txt."""
        safe_id = "".join(c if c.isalnum() or c in "-" else "_" for c in finding_id)
        safe_key = "".join(c if c.isalnum() or c in "._-" else "_" for c in field_key)
        return f"{safe_id}_{safe_key}.txt"

    def _post(self, text: str, reply_markup: dict | None = None) -> bool:
        """HTTP POST sendMessage JSON."""
        try:
            body = {
                "chat_id": self._chat_id,
                "text": text,
                "parse_mode": "HTML",
            }
            if reply_markup:
                body["reply_markup"] = reply_markup
            payload = json.dumps(body).encode()
            req = urllib.request.Request(
                self._api_url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            logger.error("TelegramNotifier HTTP %d: %s", exc.code, body)
            return False
        except Exception as exc:
            logger.error("TelegramNotifier failed: %s", exc)
            return False

    def _post_document(self, filename: str, content: bytes, caption: str | None) -> bool:
        """HTTP POST sendDocument multipart/form-data.

        Telegram sendDocument file size limit: 50MB — đủ cho mọi SQL/query text.
        Build multipart body thủ công để không phụ thuộc `requests` library.
        """
        boundary = f"----LayerOne{secrets.token_hex(12)}"
        body = bytearray()

        def _add_field(name: str, value: str) -> None:
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            body.extend(value.encode("utf-8"))
            body.extend(b"\r\n")

        _add_field("chat_id", str(self._chat_id))
        if caption:
            _add_field("caption", caption)
            _add_field("parse_mode", "HTML")

        # Document part
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'.encode()
        )
        body.extend(b"Content-Type: text/plain; charset=utf-8\r\n\r\n")
        body.extend(content)
        body.extend(b"\r\n")
        body.extend(f"--{boundary}--\r\n".encode())

        try:
            req = urllib.request.Request(
                self._doc_url,
                data=bytes(body),
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status == 200
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode(errors="replace")
            logger.error("TelegramNotifier sendDocument HTTP %d: %s", exc.code, err_body)
            return False
        except Exception as exc:
            logger.error("TelegramNotifier sendDocument failed: %s", exc)
            return False
