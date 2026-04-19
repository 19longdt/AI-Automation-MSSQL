"""
telegram_notifier.py — Gửi alert qua Telegram Bot API.

Dùng urllib (stdlib) thay vì python-telegram-bot async để phù hợp
với APScheduler synchronous execution model.
"""
from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta, timezone

from .base_notifier import BaseNotifier
from ..models.findings import Finding

logger = logging.getLogger(__name__)

_TZ_HCM = timezone(timedelta(hours=7))

_SEVERITY_ICON = {
    "CRITICAL": "🔴",
    "WARNING":  "🟡",
    "INFO":     "🔵",
}

# Các suffix này thường chứa XML/JSON/query text lớn — bỏ qua khi format message
_SKIP_SUFFIXES = ("_text", "_xml", "_json")


class TelegramNotifier(BaseNotifier):

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self._chat_id = chat_id
        self._api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"

    def send(self, finding: Finding) -> bool:
        """Gửi finding alert, trả về True nếu thành công."""
        text = self._format_finding(finding)
        return self._post(text)

    def send_health_issue(self, message: str) -> bool:
        """Gửi infra health alert (stuck job, MongoDB down...)."""
        return self._post(f"⚠️ <b>Health Alert</b>\n{html.escape(message)}")

    def send_startup(self, nodes: list[str], topic_count: int) -> bool:
        """Gửi thông báo deploy mới khi service khởi động."""
        from datetime import datetime
        now_hcm = datetime.utcnow().replace(tzinfo=timezone.utc).astimezone(_TZ_HCM)
        time_str = now_hcm.strftime("%Y-%m-%d %H:%M:%S +07")
        nodes_str = ", ".join(html.escape(n) for n in nodes)
        text = "\n".join([
            "🚀 <b>Layer 1 Monitoring — Deploy mới</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🕐 {time_str}",
            f"🖥 Nodes:  <code>{nodes_str}</code>",
            f"📋 Topics: {topic_count} enabled",
        ])
        return self._post(text)

    def _format_finding(self, finding: Finding) -> str:
        icon = _SEVERITY_ICON.get(finding.severity.value, "⚪")

        # detected_at lưu naive UTC → convert sang giờ Hà Nội
        detected_hcm = finding.detected_at.replace(tzinfo=timezone.utc).astimezone(_TZ_HCM)
        time_str = detected_hcm.strftime("%Y-%m-%d %H:%M:%S +07")

        lines = [
            f"{icon} <b>{html.escape(finding.severity.value)} — {html.escape(finding.issue_type.value)}</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            f"🖥 Node:   <code>{html.escape(finding.node)}</code> ({html.escape(finding.role)})",
            f"📋 Topic:  <code>{html.escape(finding.topic_id)}</code>",
            f"🕐 Time:   {time_str}",
        ]

        metrics = {
            k: v
            for k, v in finding.metrics.items()
            if v is not None and not any(k.endswith(s) for s in _SKIP_SUFFIXES)
        }
        if metrics:
            lines.append("")
            lines.append("📊 <b>Metrics:</b>")
            for k, v in metrics.items():
                if isinstance(v, float):
                    lines.append(f"  • {html.escape(k)}: <code>{v:,.2f}</code>")
                elif isinstance(v, int):
                    lines.append(f"  • {html.escape(k)}: <code>{v:,}</code>")
                else:
                    lines.append(f"  • {html.escape(k)}: <code>{html.escape(str(v))}</code>")

        lines.append("")
        lines.append(f"🔗 ID: <code>{finding.finding_id[:8]}</code>")
        lines.append("<i>Reply /analyze để phân tích với Claude AI</i>")

        return "\n".join(lines)

    def _post(self, text: str) -> bool:
        """HTTP POST tới Telegram Bot API."""
        try:
            payload = json.dumps({
                "chat_id": self._chat_id,
                "text": text,
                "parse_mode": "HTML",
            }).encode()
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
