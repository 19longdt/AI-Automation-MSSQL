"""
maintenance_notifier.py - Telegram notifier for maintenance runner.
"""
from __future__ import annotations

import html
import json
import logging
import secrets
import urllib.error
import urllib.request

from ..infra.time_utils import now_vn
from ..models.approval import MaintenanceBatch
from ..models.campaign import MaintenanceCampaign
from ..models.history import MaintenanceOutcome
from ..models.window import WindowSlot
from ..models.work_item import WorkItem
from .event_publisher import MaintenanceEventPublisher
from .notify_queue import NotifyQueue

logger = logging.getLogger(__name__)

_ACTION_SHORT = {
    "REBUILD": "REBUILD",
    "REBUILD_PARTITION": "REBUILD",
    "REORGANIZE": "REORG",
    "UPDATE_STATISTICS": "STATS",
    "HEAP_REBUILD": "HEAP",
}


def _esc(value: object) -> str:
    return html.escape(str(value))


class MaintenanceNotifier(MaintenanceEventPublisher):
    def __init__(self, bot_token: str, chat_id: str, cluster_id: str) -> None:
        self._bot_token = bot_token
        self._chat_id = chat_id
        self._cluster_id = cluster_id
        self._api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        self._doc_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"

    def on_item_started(self, item: WorkItem) -> None:
        self._send(self._fmt_started(item))

    def on_item_done(
        self,
        item: WorkItem,
        frag_before: float | None,
        frag_after: float | None,
        duration_ms: float | None,
    ) -> None:
        self._send(self._fmt_done(item, frag_before, frag_after, duration_ms))

    def on_item_failed(
        self,
        item: WorkItem,
        error: str,
        attempt: int,
        max_attempts: int,
        duration_ms: float | None,
    ) -> None:
        self._send(self._fmt_failed(item, error, attempt, max_attempts, duration_ms))

    def on_item_paused(self, item: WorkItem, duration_ms: float | None) -> None:
        self._send(self._fmt_paused(item, duration_ms))

    def on_health_stop(self, reason: str, metrics: dict, current_item: WorkItem | None = None) -> None:
        self._send(self._fmt_health_stop(reason, metrics, current_item))

    def on_campaign_completed(self, campaign: MaintenanceCampaign, done_items: list[dict]) -> None:
        self._post(self._fmt_campaign_completed(campaign, done_items))

    def send_batch_approval(
        self,
        batch: MaintenanceBatch,
        items: list[WorkItem],
        top_n: int = 10,
        window_label: str = "",
    ) -> int | None:
        s = batch.summary
        lines = [
            f"🔧 <b>[{_esc(batch.cluster_id)}] Batch cần duyệt</b> · {batch.created_at:%d/%m %H:%M}",
            f"📊 {batch.item_count} items · ước tính <b>{s.est_total_minutes:.0f} phút</b>",
            f"   REBUILD: {s.rebuild + s.rebuild_partition} · REORG: {s.reorganize}"
            f" · STATS: {s.update_statistics} · HEAP: {s.heap_rebuild}",
        ]
        if window_label:
            lines.append(f"🪟 {_esc(window_label)}")

        _TOP = min(top_n, 5)
        top_items = sorted(items, key=lambda i: i.priority, reverse=True)[:_TOP]
        if top_items:
            lines.append("")
            lines.append("<b>Top items:</b>")
            lines.append("<code>")
            for item in top_items:
                lines.append(self._fmt_batch_row(item))
            lines.append("</code>")
            if len(items) > _TOP:
                lines.append(f"<i>... và {len(items) - _TOP} item khác — xem file đính kèm</i>")

        keyboard = {
            "inline_keyboard": [[
                {"text": "✅ Duyệt tất cả", "callback_data": f"l1|mntb|{self._cluster_id}|{batch.batch_id}|all"},
                {"text": "⛔ Từ chối tất cả", "callback_data": f"l1|mntb|{self._cluster_id}|{batch.batch_id}|reject"},
            ]]
        }
        message_id = self._post("\n".join(lines), reply_markup=keyboard)

        if len(items) > _TOP:
            content = self._build_full_list(items)
            self._post_document(
                f"maintenance_batch_{batch.batch_id[:8]}.txt",
                content.encode("utf-8"),
                caption=f"Full list - {batch.item_count} items",
            )
        return message_id

    def send_nightly_summary(
        self,
        records: list[dict],
        slot: WindowSlot | None,
        used_minutes: float,
    ) -> None:
        counts: dict[str, int] = {}
        for rec in records:
            outcome = rec.get("outcome", "")
            counts[outcome] = counts.get(outcome, 0) + 1

        done = counts.get(MaintenanceOutcome.DONE.value, 0)
        skipped = counts.get(MaintenanceOutcome.SKIPPED.value, 0)
        failed = counts.get(MaintenanceOutcome.FAILED.value, 0)
        paused = counts.get(MaintenanceOutcome.PAUSED.value, 0)
        dry = counts.get(MaintenanceOutcome.DRY_RUN.value, 0)

        # Skipped breakdown by reason
        skipped_budget = sum(
            1 for r in records
            if r.get("outcome") == MaintenanceOutcome.SKIPPED.value
            and "insufficient_budget" in (r.get("skip_reason") or "")
        )
        skipped_policy = sum(
            1 for r in records
            if r.get("outcome") == MaintenanceOutcome.SKIPPED.value
            and r.get("skip_reason") == "policy_disabled"
        )
        skipped_other = skipped - skipped_budget - skipped_policy
        skipped_parts = []
        if skipped_budget:
            skipped_parts.append(f"{skipped_budget} budget")
        if skipped_policy:
            skipped_parts.append(f"{skipped_policy} policy")
        if skipped_other:
            skipped_parts.append(f"{skipped_other} other")
        skipped_detail = f" <i>({' · '.join(skipped_parts)})</i>" if skipped_parts else ""

        budget_text = ""
        if slot is not None:
            budget_text = f"\n⏱ Budget: {used_minutes:.0f}/{slot.time_budget_minutes}p"

        lines = [
            f"🌙 <b>[{_esc(self._cluster_id)}] Tổng kết đêm qua</b>",
            f"✅ Done: {done} · ❌ Failed: {failed} · ⏸ Paused: {paused}"
            + (f"\n⏭ Skipped: {skipped}{skipped_detail}" if skipped else "")
            + (f"\n🧪 Dry run: {dry}" if dry else "")
            + budget_text,
        ]

        # Done — grouped by table
        done_records = [r for r in records if r.get("outcome") == MaintenanceOutcome.DONE.value]
        if done_records:
            table_actions: dict[str, dict[str, int]] = {}
            for rec in done_records:
                key = f"{rec.get('schema_name', '')}.{rec.get('table_name', '')}"
                short = _ACTION_SHORT.get(rec.get("action_type", ""), rec.get("action_type", ""))
                if key not in table_actions:
                    table_actions[key] = {}
                table_actions[key][short] = table_actions[key].get(short, 0) + 1
            _TABLE_LIMIT = 15
            lines.append(f"\n<b>Done ({done}):</b>")
            for tbl, actions in list(table_actions.items())[:_TABLE_LIMIT]:
                parts = [f"{act}×{cnt}" for act, cnt in sorted(actions.items())]
                lines.append(f"  {_esc(tbl)} — {' · '.join(parts)}")
            if len(table_actions) > _TABLE_LIMIT:
                lines.append(f"<i>... và {len(table_actions) - _TABLE_LIMIT} bảng khác</i>")

        # Failed — show object name + short error
        failed_records = [r for r in records if r.get("outcome") == MaintenanceOutcome.FAILED.value]
        if failed_records:
            _FAILED_LIMIT = 5
            lines.append("\n<b>Failed:</b>")
            for rec in failed_records[:_FAILED_LIMIT]:
                label = self._fmt_history_label(rec)
                err = (rec.get("error") or "")[:100]
                lines.append(f"  {_esc(label)}")
                if err:
                    lines.append(f"  <i>{_esc(err)}</i>")
            if len(failed_records) > _FAILED_LIMIT:
                lines.append(f"<i>... và {len(failed_records) - _FAILED_LIMIT} failed khác</i>")

        self._post("\n".join(lines))

    def send_health_issue(self, message: str) -> None:
        self._post(f"🔧⚠️ <b>Maintenance</b>: {_esc(message)}")

    @staticmethod
    def _fmt_item_metrics(item: WorkItem) -> str:
        """Chọn metric phù hợp theo loại action — plain text, không HTML tag."""
        m = item.metrics
        if m.fragmentation_pct is not None:
            pages = f" · {m.page_count:,} pages" if m.page_count else ""
            return f"Frag: {m.fragmentation_pct:.1f}%{pages}"
        if m.modification_counter is not None:
            rows_sampled = f" ({m.rows_sampled:,} sampled)" if m.rows_sampled else ""
            return f"Modifications: {m.modification_counter:,} rows{rows_sampled}"
        if m.forwarded_record_count is not None:
            return f"Forwarded: {m.forwarded_record_count:,} records"
        return ""

    @staticmethod
    def _format_item_line(item: WorkItem) -> str:
        m = item.metrics
        if m.fragmentation_pct is not None:
            metric_text = f"frag <b>{m.fragmentation_pct:.1f}%</b> · {m.page_count or 0:,} pages"
        elif m.modification_counter is not None:
            rows_sampled = f" ({m.rows_sampled:,} sampled)" if m.rows_sampled else ""
            metric_text = f"mod <b>{m.modification_counter:,}</b> rows{rows_sampled}"
        elif m.forwarded_record_count is not None:
            metric_text = f"fwd <b>{m.forwarded_record_count:,}</b> records"
        else:
            metric_text = ""
        return (
            f"<code>{_esc(item.short_id)}</code> · <b>{_esc(item.action_type.value.upper())}</b>\n"
            f"{_esc(item.object_label())}\n"
            f"{metric_text} · est {item.estimated_minutes:.0f}p · pri {item.priority}"
        )

    @staticmethod
    def _fmt_batch_row(item: WorkItem) -> str:
        """1 dòng compact cho bảng top-items trong batch approval (gửi trong <code> block)."""
        m = item.metrics
        action_short = _ACTION_SHORT.get(item.action_type.value, item.action_type.value[:8])
        name = item.index_name or item.stats_name or item.table_name or ""
        if item.partition_number and item.index_name:
            name = f"{name} P{item.partition_number}"
        name = (name[:21] + "…") if len(name) > 22 else name

        if m.fragmentation_pct is not None:
            metric = f"{m.fragmentation_pct:5.1f}%"
        elif m.modification_counter is not None:
            k = m.modification_counter
            metric = f"{k // 1000:4}k mod" if k >= 1000 else f"{k:4} mod"
        else:
            metric = " " * 9

        est = f"{item.estimated_minutes:.0f}p"
        return f"{name:<22} {action_short:<8} {metric}  {est}"

    @staticmethod
    def _build_full_list(items: list[WorkItem]) -> str:
        lines = [
            f"Maintenance batch full list - generated {now_vn():%Y-%m-%d %H:%M}",
            f"{'short_id':<10}{'action':<20}{'est_min':>8}{'priority':>9}  object",
            "-" * 100,
        ]
        for item in sorted(items, key=lambda i: i.priority, reverse=True):
            lines.append(
                f"{item.short_id:<10}{item.action_type.value:<20}"
                f"{item.estimated_minutes:>8.0f}{item.priority:>9}  {item.object_label()}"
            )
        return "\n".join(lines)

    def _fmt_started(self, item: WorkItem) -> str:
        action = item.action_type.value.replace("_", " ").upper()
        est = f"~{item.estimated_minutes:.0f} phút" if item.estimated_minutes else "?"
        metric_text = self._fmt_item_metrics(item)
        detail = f"   {metric_text} · Ước tính {est}" if metric_text else f"   Ước tính {est}"
        return (
            f"🔨 [{self._cluster_id}] Bắt đầu {action}\n"
            f"   {self._fmt_target(item)}\n"
            f"{detail}"
        )

    def _fmt_done(
        self,
        item: WorkItem,
        frag_before: float | None,
        frag_after: float | None,
        duration_ms: float | None,
    ) -> str:
        action = item.action_type.value.replace("_", " ").upper()
        dur = self._fmt_duration(duration_ms)
        if frag_before is not None and frag_after is not None:
            pages = f" · {item.metrics.page_count:,} pages" if item.metrics.page_count else ""
            return (
                f"✅ [{self._cluster_id}] {action} · {dur}\n"
                f"   {self._fmt_target(item)}\n"
                f"   {frag_before:.1f}% → {frag_after:.1f}%{pages}"
            )
        # STATS / HEAP — no post-execution metric worth repeating; keep it short
        return (
            f"✅ [{self._cluster_id}] {action} · {dur}\n"
            f"   {self._fmt_target(item)}"
        )

    def _fmt_failed(
        self,
        item: WorkItem,
        error: str,
        attempt: int,
        max_attempts: int,
        duration_ms: float | None,
    ) -> str:
        del duration_ms
        action = item.action_type.value.replace("_", " ").upper()
        short_err = (error or "")[:200]
        return (
            f"❌ [{self._cluster_id}] Lỗi (attempt {attempt}/{max_attempts})\n"
            f"   {action} · {self._fmt_target(item)}\n"
            f"   Lỗi: {short_err}"
        )

    def _fmt_paused(self, item: WorkItem, duration_ms: float | None) -> str:
        action = item.action_type.value.replace("_", " ").upper()
        return (
            f"⏸ [{self._cluster_id}] Tạm dừng (resumable)\n"
            f"   {action} · {self._fmt_target(item)}\n"
            f"   Đã chạy: {self._fmt_duration(duration_ms)} · Tiếp tục tối mai"
        )

    def _fmt_health_stop(self, reason: str, metrics: dict, current_item: WorkItem | None = None) -> str:
        now_str = now_vn().strftime("%H:%M")
        lines = [f"🛑 <b>[{_esc(self._cluster_id)}] Dừng do tải cao · {now_str}</b>"]
        # Lý do thật sự gây dừng — luôn hiển thị trước
        lines.append(f"   {_esc(reason)}")
        # Thông số bổ sung (chỉ những gì đáng chú ý)
        context: list[str] = []
        if "cpu_pct" in metrics:
            thr = metrics.get("cpu_threshold", "?")
            context.append(f"CPU {metrics['cpu_pct']:.0f}%/{thr:.0f}%")
        if "active_requests" in metrics:
            thr = metrics.get("active_threshold", "?")
            context.append(f"Sessions {metrics['active_requests']}/{thr}")
        for rep in metrics.get("ag_replicas", []):
            state = rep.get("state", "")
            send_q = rep.get("log_send_queue_kb", 0)
            redo_q = rep.get("redo_queue_kb", 0)
            name = rep.get("replica_server_name", "?")
            if state.upper() not in ("SYNCHRONIZED", "SYNCHRONIZING"):
                context.append(f"AG {name} {state}")
            if send_q:
                context.append(f"AG {name} send={send_q:,}KB")
            if redo_q:
                context.append(f"AG {name} redo={redo_q:,}KB")
        if context:
            lines.append(f"   <i>{_esc(' · '.join(context))}</i>")
        # Item đang chạy tại thời điểm dừng
        if current_item is not None:
            action = current_item.action_type.value.replace("_", " ").upper()
            lines.append(f"   ⚙️ Đang chạy: {_esc(action)} · {_esc(self._fmt_target(current_item))}")
        else:
            lines.append("   ⚙️ Không có job đang chạy lúc phát hiện")
        lines.append("   Sẽ tiếp tục khi metrics về ngưỡng an toàn")
        return "\n".join(lines)

    def _fmt_campaign_completed(self, campaign: MaintenanceCampaign, done_items: list[dict]) -> str:
        table_actions: dict[str, dict[str, int]] = {}
        for rec in done_items:
            key = f"{rec.get('schema_name', '')}.{rec.get('table_name', '')}"
            short = _ACTION_SHORT.get(rec.get("action_type", ""), rec.get("action_type", ""))
            if key not in table_actions:
                table_actions[key] = {}
            table_actions[key][short] = table_actions[key].get(short, 0) + 1

        lines = [
            f"🎉 <b>[{_esc(self._cluster_id)}] Campaign hoàn thành</b>",
            f"<b>{_esc(campaign.name or '')}</b>",
            "",
            f"✅ done: {campaign.done_count} · ❌ failed: {campaign.failed_count}"
            f" · ⏭ skipped: {campaign.skipped_count}",
        ]
        if campaign.window_budget_used_minutes:
            lines.append(f"⏱ Budget dùng: {campaign.window_budget_used_minutes:.0f}p")

        if table_actions:
            lines.append("")
            lines.append("<b>Đã xử lý:</b>")
            _TABLE_LIMIT = 10
            for tbl, actions in list(table_actions.items())[:_TABLE_LIMIT]:
                parts = [f"{act}×{cnt}" for act, cnt in sorted(actions.items())]
                lines.append(f"  {_esc(tbl)} — {' · '.join(parts)}")
            if len(table_actions) > _TABLE_LIMIT:
                lines.append(f"<i>... và {len(table_actions) - _TABLE_LIMIT} bảng khác</i>")

        return "\n".join(lines)

    @staticmethod
    def _fmt_history_label(rec: dict) -> str:
        """db.schema.table · index_name [P3] hoặc [stats_name]"""
        db = rec.get("database_name", "")
        schema = rec.get("schema_name", "")
        table = rec.get("table_name", "")
        index = rec.get("index_name")
        stats = rec.get("stats_name")
        part = rec.get("partition_number")

        base = f"{db}.{schema}.{table}"
        obj = index if index else (f"[{stats}]" if stats else "")
        label = f"{base} · {obj}" if obj else base
        if part:
            label += f" P{part}"
        return label

    @staticmethod
    def _build_done_list(records: list[dict]) -> str:
        lines = [
            f"Maintenance done list - generated {now_vn():%Y-%m-%d %H:%M}",
            f"{'action':<22}{'dur_min':>8}  object",
            "-" * 100,
        ]
        for rec in records:
            action = rec.get("action_type", "")
            dur = (rec.get("duration_ms") or 0) / 60_000
            label = MaintenanceNotifier._fmt_history_label(rec)
            lines.append(f"{action:<22}{dur:>8.1f}  {label}")
        return "\n".join(lines)

    @staticmethod
    def _fmt_target(item: WorkItem) -> str:
        parts = [f"{item.schema_name}.{item.table_name}"]
        if item.index_name:
            parts.append(item.index_name)
        elif item.stats_name:
            parts.append(item.stats_name)
        if item.partition_number:
            parts.append(f"P{item.partition_number}")
        target = " · ".join(filter(None, parts))
        if len(target) > 80:
            return f"{target[:77]}..."
        return target

    @staticmethod
    def _fmt_duration(duration_ms: float | None) -> str:
        if duration_ms is None:
            return "?"
        total_sec = int(duration_ms / 1000)
        minutes, seconds = divmod(total_sec, 60)
        return f"{minutes}m {seconds}s" if minutes > 0 else f"{seconds}s"

    def _send(self, text: str) -> None:
        try:
            NotifyQueue.get().enqueue(self._bot_token, self._chat_id, text)
        except Exception as exc:
            logger.error("MaintenanceNotifier enqueue failed: %s", exc)

    def _post(self, text: str, reply_markup: dict | None = None) -> int | None:
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
        body.extend(f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'.encode())
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
