"""
maintenance_notifier.py — Telegram SEND-ONLY cho maintenance runner.

QUAN TRỌNG: process này KHÔNG poll getUpdates — process monitoring (layer1.main)
giữ độc quyền poll (2 process cùng poll 1 token → Telegram 409 giết cả 2 bot).
Approval callbacks được monitoring process xử lý qua MaintenanceApprovalAdapter.

Callback data format (64-byte limit):
  l1|mntb|<batch_id>|all     — approve toàn bộ batch
  l1|mntb|<batch_id>|reject  — reject toàn bộ batch
  l1|mnti|<short_id>|ok      — approve 1 item
  l1|mnti|<short_id>|no      — reject 1 item
"""
from __future__ import annotations

import html
import json
import logging
import secrets
import urllib.error
import urllib.request

from ...utils.time_utils import now_vn
from ..models.approval import MaintenanceBatch
from ..models.history import MaintenanceOutcome
from ..models.window import WindowSlot
from ..models.work_item import WorkItem

logger = logging.getLogger(__name__)


def _esc(value: object) -> str:
    return html.escape(str(value))


class MaintenanceNotifier:

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self._chat_id = chat_id
        self._api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        self._doc_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"

    # ── Batch approval ───────────────────────────────────────────────────────

    def send_batch_approval(
        self,
        batch: MaintenanceBatch,
        items: list[WorkItem],
        top_n: int = 10,
        window_label: str = "",
    ) -> int | None:
        """
        Gửi batch summary + nút Approve ALL/Reject ALL, top-N item có nút riêng,
        full list dạng .txt attachment. Trả về message_id của message chính.
        """
        s = batch.summary
        lines = [
            f"🔧 <b>Maintenance Batch</b> {batch.created_at:%d/%m %H:%M}",
            f"🆔 <code>{_esc(batch.batch_id[:8])}</code>",
            f"📊 {batch.item_count} items — ước tính <b>{s.est_total_minutes:.0f} phút</b>",
            f"   • REBUILD: {s.rebuild} (partition: {s.rebuild_partition})"
            f"  • REORG: {s.reorganize}",
            f"   • UPDATE STATS: {s.update_statistics}  • HEAP: {s.heap_rebuild}",
        ]
        if window_label:
            lines.append(f"🪟 {_esc(window_label)}")
        lines.append("")
        lines.append("Duyệt toàn bộ bằng nút bên dưới, hoặc duyệt từng item ở các message sau.")

        keyboard = {
            "inline_keyboard": [[
                {"text": "✅ Approve ALL", "callback_data": f"l1|mntb|{batch.batch_id}|all"},
                {"text": "⛔ Reject ALL", "callback_data": f"l1|mntb|{batch.batch_id}|reject"},
            ]]
        }
        message_id = self._post("\n".join(lines), reply_markup=keyboard)

        # Top-N items priority cao nhất — nút approve/reject riêng
        top_items = sorted(items, key=lambda i: i.priority, reverse=True)[:top_n]
        for item in top_items:
            self._post(
                self._format_item_line(item),
                reply_markup={
                    "inline_keyboard": [[
                        {"text": "✅", "callback_data": f"l1|mnti|{item.short_id}|ok"},
                        {"text": "⛔", "callback_data": f"l1|mnti|{item.short_id}|no"},
                    ]]
                },
            )

        # Full list .txt — DBA xem chi tiết toàn bộ
        if len(items) > len(top_items):
            content = self._build_full_list(items)
            self._post_document(
                f"maintenance_batch_{batch.batch_id[:8]}.txt",
                content.encode("utf-8"),
                caption=f"Full list — {batch.item_count} items",
            )
        return message_id

    @staticmethod
    def _format_item_line(item: WorkItem) -> str:
        m = item.metrics
        metric_text = ""
        if m.fragmentation_pct is not None:
            metric_text = f"frag <b>{m.fragmentation_pct:.1f}%</b> · {m.page_count or 0:,} pages"
        elif m.modification_counter is not None:
            metric_text = f"mod <b>{m.modification_counter:,}</b> rows"
        elif m.forwarded_record_count is not None:
            metric_text = f"fwd <b>{m.forwarded_record_count:,}</b> records"
        return (
            f"<code>{_esc(item.short_id)}</code> · <b>{_esc(item.action_type.value.upper())}</b>\n"
            f"{_esc(item.object_label())}\n"
            f"{metric_text} · est {item.estimated_minutes:.0f}p · pri {item.priority}"
        )

    @staticmethod
    def _build_full_list(items: list[WorkItem]) -> str:
        lines = [
            f"Maintenance batch full list — generated {now_vn():%Y-%m-%d %H:%M}",
            f"{'short_id':<10}{'action':<20}{'est_min':>8}{'priority':>9}  object",
            "-" * 100,
        ]
        for item in sorted(items, key=lambda i: i.priority, reverse=True):
            lines.append(
                f"{item.short_id:<10}{item.action_type.value:<20}"
                f"{item.estimated_minutes:>8.0f}{item.priority:>9}  {item.object_label()}"
            )
        return "\n".join(lines)

    # ── Nightly summary ──────────────────────────────────────────────────────

    def send_nightly_summary(
        self,
        records: list[dict],
        slot: WindowSlot | None,
        used_minutes: float,
    ) -> None:
        """Tổng kết đêm từ maintenance_history records."""
        counts: dict[str, int] = {}
        for rec in records:
            outcome = rec.get("outcome", "")
            counts[outcome] = counts.get(outcome, 0) + 1

        done = counts.get(MaintenanceOutcome.DONE.value, 0)
        skipped = counts.get(MaintenanceOutcome.SKIPPED.value, 0)
        failed = counts.get(MaintenanceOutcome.FAILED.value, 0)
        paused = counts.get(MaintenanceOutcome.PAUSED.value, 0)
        dry = counts.get(MaintenanceOutcome.DRY_RUN.value, 0)

        budget_text = ""
        if slot is not None:
            budget_text = f" — {used_minutes:.0f}/{slot.time_budget_minutes}p budget"

        lines = [
            f"🌙 <b>Maintenance đêm qua</b>{budget_text}",
            f"✅ done: {done}  ⏭ skipped: {skipped}  ❌ failed: {failed}  ⏸ paused: {paused}"
            + (f"  🧪 dry_run: {dry}" if dry else ""),
        ]

        # Top 3 item lâu nhất — để DBA thấy gì chiếm budget
        timed = [r for r in records if r.get("duration_ms")]
        timed.sort(key=lambda r: r["duration_ms"], reverse=True)
        for rec in timed[:3]:
            mins = rec["duration_ms"] / 60_000
            frag = ""
            if rec.get("frag_before_pct") is not None and rec.get("frag_after_pct") is not None:
                frag = f" · frag {rec['frag_before_pct']:.1f}% → {rec['frag_after_pct']:.1f}%"
            lines.append(
                f"• {_esc(rec.get('action_type', ''))} "
                f"{_esc(rec.get('schema_name', ''))}.{_esc(rec.get('table_name', ''))}"
                f"{('.' + _esc(rec['index_name'])) if rec.get('index_name') else ''}"
                f" — {mins:.0f}p{frag}"
            )

        if failed:
            lines.append("⚠️ Có item FAILED — xem maintenance_history để biết chi tiết error.")

        self._post("\n".join(lines))

    def send_health_issue(self, message: str) -> None:
        self._post(f"🔧⚠️ <b>Maintenance</b>: {_esc(message)}")

    # ── HTTP helpers (pattern từ telegram_notifier.py — thêm trả về message_id) ──

    def _post(self, text: str, reply_markup: dict | None = None) -> int | None:
        """sendMessage — trả về message_id nếu thành công, None nếu fail."""
        try:
            body: dict = {
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
                data = json.loads(resp.read())
            return (data.get("result") or {}).get("message_id")
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode(errors="replace")
            logger.error("MaintenanceNotifier HTTP %d: %s", exc.code, err_body)
            return None
        except Exception as exc:
            logger.error("MaintenanceNotifier failed: %s", exc)
            return None

    def _post_document(self, filename: str, content: bytes, caption: str | None = None) -> bool:
        """sendDocument multipart — build thủ công, không phụ thuộc requests."""
        boundary = f"----Maint{secrets.token_hex(12)}"
        body = bytearray()

        def _add_field(name: str, value: str) -> None:
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            body.extend(value.encode("utf-8"))
            body.extend(b"\r\n")

        _add_field("chat_id", str(self._chat_id))
        if caption:
            _add_field("caption", caption)

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
            logger.error("MaintenanceNotifier sendDocument HTTP %d: %s", exc.code, err_body)
            return False
        except Exception as exc:
            logger.error("MaintenanceNotifier sendDocument failed: %s", exc)
            return False
