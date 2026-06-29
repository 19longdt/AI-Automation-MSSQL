# Plan 03 — Telegram Per-item Notifications

## Mục tiêu

Thêm thông báo Telegram chi tiết theo từng work item trong quá trình execute:
- Thông báo khi bắt đầu thực thi 1 item (action type, target, ước tính thời gian)
- Thông báo khi hoàn thành item (kết quả, frag before→after, duration)
- Thông báo khi lỗi hoặc dừng (nội dung lỗi, lý do)
- **Không** thông báo SKIPPED (tránh spam khi budget thiếu hoặc policy disabled)

**Kiến trúc:** `execute_service` không gọi `MaintenanceNotifier` trực tiếp mà emit event qua interface `MaintenanceEventPublisher`. Telegram là 1 adapter — sau này có thể thêm Teams/Webhook mà không sửa execute logic.

---

## 1. Danh sách Events & Format

### Event 1 — Item bắt đầu

```
🔧 [PROD-CL1] Bắt đầu
   REBUILD INDEX · dbo.Orders · IX_Orders_Date
   Pages: 12,450 · Frag: 43.2% · Ước tính: ~8 phút
```

### Event 2 — Item DONE

```
✅ [PROD-CL1] Hoàn thành (6m 42s)
   REBUILD INDEX · dbo.Orders · IX_Orders_Date
   Frag: 43.2% → 0.8% · Pages: 12,450
```

### Event 3 — Item FAILED

```
❌ [PROD-CL1] Lỗi (attempt 1/3)
   UPDATE STATISTICS · dbo.OrderItems · [_WA_Sys_...]
   Lỗi: Cannot find object 'dbo.OrderItems'...
```

### Event 4 — Item PAUSED (resumable rebuild — budget hết hoặc SIGTERM)

```
⏸ [PROD-CL1] Tạm dừng (resumable)
   REBUILD INDEX · dbo.LargeTable · PK_LargeTable
   Đã chạy: 45 phút · Tiếp tục tối mai
```

### Event 5 — Health stop (từ Plan 04 — ghi ở đây để thống nhất format)

```
🛑 [PROD-CL1] Dừng do tải cao
   CPU: 87% (ngưỡng 80%) · Active sessions: 68 (ngưỡng 50)
   Sẽ tiếp tục khi metrics về ngưỡng an toàn
```

### Event 6 — Campaign hoàn thành

```
🎉 [PROD-CL1] Campaign hoàn thành
   "Chiến dịch tháng 6/2026"
   ✅ 189 done · ❌ 2 failed · ⏭ 4 skipped · ⏱ 14h 23m tổng
```

---

## 2. Interface — `maintenance/notify/event_publisher.py` — Mới

`execute_service` phụ thuộc vào interface này, không phải trực tiếp `MaintenanceNotifier`. Sau này thêm Teams/Webhook chỉ cần tạo thêm adapter, không sửa execute logic.

```python
from abc import ABC, abstractmethod
from ..models.work_item import WorkItem
from ..models.campaign import MaintenanceCampaign

class MaintenanceEventPublisher(ABC):
    """Port: publish maintenance execution events."""

    @abstractmethod
    def on_item_started(self, item: WorkItem) -> None: ...

    @abstractmethod
    def on_item_done(
        self,
        item: WorkItem,
        frag_before: float | None,
        frag_after: float | None,
        duration_ms: float | None,
    ) -> None: ...

    @abstractmethod
    def on_item_failed(
        self,
        item: WorkItem,
        error: str,
        attempt: int,
        max_attempts: int,
        duration_ms: float | None,
    ) -> None: ...

    @abstractmethod
    def on_item_paused(self, item: WorkItem, duration_ms: float | None) -> None: ...

    @abstractmethod
    def on_health_stop(self, reason: str, metrics: dict) -> None: ...

    @abstractmethod
    def on_campaign_completed(self, campaign: MaintenanceCampaign) -> None: ...
```

### `MaintenanceNotifier` — Adapter implements `MaintenanceEventPublisher`

```python
class MaintenanceNotifier(MaintenanceEventPublisher):
    def on_item_started(self, item: WorkItem) -> None:
        self._send(self._fmt_started(item))

    def on_item_done(self, item, frag_before, frag_after, duration_ms) -> None:
        self._send(self._fmt_done(item, frag_before, frag_after, duration_ms))

    def on_item_failed(self, item, error, attempt, max_attempts, duration_ms) -> None:
        self._send(self._fmt_failed(item, error, attempt, max_attempts))

    def on_item_paused(self, item, duration_ms) -> None:
        self._send(self._fmt_paused(item, duration_ms))

    def on_health_stop(self, reason, metrics) -> None:
        self._send(self._fmt_health_stop(reason, metrics))

    def on_campaign_completed(self, campaign) -> None:
        self._send(self._fmt_campaign_completed(campaign))
```

Format text (`_fmt_*`) giữ nguyên như section trước — chỉ tách ra thành private helpers.

---

## 3. `MaintenanceNotifier` — Private Format Helpers

`MaintenanceNotifier` implements `MaintenanceEventPublisher`. Mỗi `on_*` method chỉ gọi `self._send(self._fmt_*(...))`; format logic nằm trong private `_fmt_*` helpers.

```python
class MaintenanceNotifier(MaintenanceEventPublisher):

    # --- interface implementation ---

    def on_item_started(self, item: WorkItem) -> None:
        self._send(self._fmt_started(item))

    def on_item_done(self, item, frag_before, frag_after, duration_ms) -> None:
        self._send(self._fmt_done(item, frag_before, frag_after, duration_ms))

    def on_item_failed(self, item, error, attempt, max_attempts, duration_ms) -> None:
        self._send(self._fmt_failed(item, error, attempt, max_attempts, duration_ms))

    def on_item_paused(self, item, duration_ms) -> None:
        self._send(self._fmt_paused(item, duration_ms))

    def on_health_stop(self, reason, metrics) -> None:
        self._send(self._fmt_health_stop(reason, metrics))

    def on_campaign_completed(self, campaign) -> None:
        self._send(self._fmt_campaign_completed(campaign))

    # --- private format helpers ---

    def _fmt_started(self, item: WorkItem) -> str:
        action = item.action_type.value.replace("_", " ").title()
        target = self._fmt_target(item)
        est = f"~{item.estimated_minutes:.0f} phút" if item.estimated_minutes else "?"
        pages = f"{item.metrics.page_count:,}" if item.metrics and item.metrics.page_count else "?"
        frag  = f"{item.metrics.fragmentation_pct:.1f}%" if item.metrics and item.metrics.fragmentation_pct else "?"
        return (
            f"🔧 [{self._cluster_id}] Bắt đầu\n"
            f"   {action} · {target}\n"
            f"   Pages: {pages} · Frag: {frag} · Ước tính: {est}"
        )

    def _fmt_done(self, item, frag_before, frag_after, duration_ms) -> str:
        action = item.action_type.value.replace("_", " ").title()
        target = self._fmt_target(item)
        dur    = self._fmt_duration(duration_ms)
        frag_str = (
            f"Frag: {frag_before:.1f}% → {frag_after:.1f}%"
            if frag_before is not None and frag_after is not None else ""
        )
        pages = f"Pages: {item.metrics.page_count:,}" if item.metrics and item.metrics.page_count else ""
        detail = " · ".join(filter(None, [frag_str, pages]))
        return (
            f"✅ [{self._cluster_id}] Hoàn thành ({dur})\n"
            f"   {action} · {target}\n"
            f"   {detail}"
        )

    def _fmt_failed(self, item, error, attempt, max_attempts, duration_ms) -> str:
        action = item.action_type.value.replace("_", " ").title()
        target = self._fmt_target(item)
        short_err = (error or "")[:200]
        return (
            f"❌ [{self._cluster_id}] Lỗi (attempt {attempt}/{max_attempts})\n"
            f"   {action} · {target}\n"
            f"   Lỗi: {short_err}"
        )

    def _fmt_paused(self, item, duration_ms) -> str:
        action = item.action_type.value.replace("_", " ").title()
        target = self._fmt_target(item)
        dur    = self._fmt_duration(duration_ms)
        return (
            f"⏸ [{self._cluster_id}] Tạm dừng (resumable)\n"
            f"   {action} · {target}\n"
            f"   Đã chạy: {dur} · Tiếp tục tối mai"
        )

    def _fmt_health_stop(self, reason: str, metrics: dict) -> str:
        parts = []
        if "cpu_pct" in metrics:
            parts.append(f"CPU: {metrics['cpu_pct']:.0f}% (ngưỡng {metrics['cpu_threshold']:.0f}%)")
        if "active_requests" in metrics:
            parts.append(f"Sessions: {metrics['active_requests']} (ngưỡng {metrics['active_threshold']})")
        detail = " · ".join(parts) if parts else reason
        return (
            f"🛑 [{self._cluster_id}] Dừng do tải cao\n"
            f"   {detail}\n"
            f"   Sẽ tiếp tục khi metrics về ngưỡng an toàn"
        )

    def _fmt_campaign_completed(self, campaign: MaintenanceCampaign) -> str:
        return (
            f"🎉 [{self._cluster_id}] Campaign hoàn thành\n"
            f"   \"{campaign.name}\"\n"
            f"   ✅ {campaign.done_count} done · "
            f"❌ {campaign.failed_count} failed · "
            f"⏭ {campaign.skipped_count} skipped"
        )

    @staticmethod
    def _fmt_target(item: WorkItem) -> str:
        parts = [f"{item.schema_name}.{item.table_name}"]
        if item.index_name:
            parts.append(item.index_name)
        elif item.stats_name:
            parts.append(item.stats_name)
        if item.partition_number:
            parts.append(f"P{item.partition_number}")
        return " · ".join(filter(None, parts))

    @staticmethod
    def _fmt_duration(duration_ms: float | None) -> str:
        if duration_ms is None:
            return "?"
        total_sec = int(duration_ms / 1000)
        m, s = divmod(total_sec, 60)
        return f"{m}m {s}s" if m > 0 else f"{s}s"
```

---

## 4. Execute Service — Emit events qua publisher

### `maintenance/execute/execute_service.py` — Sửa

`ClusterExecuteService` nhận `publisher: MaintenanceEventPublisher | None` thay vì `notifier`:

```python
from ..notify.event_publisher import MaintenanceEventPublisher

class ClusterExecuteService:
    def __init__(self, ..., publisher: MaintenanceEventPublisher | None = None) -> None:
        self._publisher = publisher
```

**4a. Trước khi execute — `_execute_item()`:**

```python
if self._publisher is not None and not self._settings.maint_dry_run:
    self._publisher.on_item_started(item)
```

**4b. Sau khi DONE:**

```python
self._queue_repo.finalize(item.item_id, WorkItemStatus.DONE)
self._write_history(...)
self._increment_campaign_terminal(campaign, WorkItemStatus.DONE)
if self._publisher is not None:
    self._publisher.on_item_done(
        item,
        frag_before=frag_before,
        frag_after=frag_after,
        duration_ms=(finished_at - started_at).total_seconds() * 1000,
    )
```

**4c. Trong `_handle_execute_error()` — PAUSED:**

```python
if outcome == MaintenanceOutcome.PAUSED and self._publisher is not None:
    self._publisher.on_item_paused(
        item,
        duration_ms=(finished_at - started_at).total_seconds() * 1000,
    )
```

**4d. Trong `_handle_execute_error()` — FAILED:**

```python
if self._publisher is not None:
    self._publisher.on_item_failed(
        item,
        error=error,
        attempt=attempts,
        max_attempts=self._settings.maint_max_attempts,
        duration_ms=(finished_at - started_at).total_seconds() * 1000,
    )
```

**4e. Sau `increment_stats` → campaign COMPLETED:**

```python
# Trong _increment_campaign_terminal(), sau khi set COMPLETED:
if just_completed and self._publisher is not None:
    self._publisher.on_campaign_completed(campaign)
```

---

## 5. Async Notify Queue — Tránh Block Execute Loop

Telegram HTTP call đồng bộ trong `_execute_item()` sẽ block execute nếu Telegram API chậm hoặc timeout (mặc định 10–30s). Budget window bị ăn bởi I/O network thay vì DDL thực tế.

### `maintenance/notify/notify_queue.py` — Mới

```python
import queue
import threading
import logging
import requests
from dataclasses import dataclass

logger = logging.getLogger(__name__)
_QUEUE_MAX = 200   # drop oldest nếu đầy

@dataclass
class NotifyMessage:
    bot_token: str
    chat_id: str
    text: str

class NotifyQueue:
    """
    Single background thread gửi Telegram messages bất đồng bộ.
    1 instance per process (không phải per cluster).
    """
    _instance: "NotifyQueue | None" = None

    @classmethod
    def get(cls) -> "NotifyQueue":
        if cls._instance is None:
            cls._instance = cls()
            cls._instance.start()
        return cls._instance

    def __init__(self) -> None:
        self._q: queue.Queue[NotifyMessage | None] = queue.Queue(maxsize=_QUEUE_MAX)
        self._thread = threading.Thread(target=self._loop, daemon=True, name="notify-queue")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._q.put(None)  # sentinel

    def enqueue(self, bot_token: str, chat_id: str, text: str) -> None:
        msg = NotifyMessage(bot_token=bot_token, chat_id=chat_id, text=text)
        try:
            self._q.put_nowait(msg)
        except queue.Full:
            # Drop oldest, enqueue mới
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self._q.put_nowait(msg)
            logger.warning("NotifyQueue full — dropped oldest message")

    def _loop(self) -> None:
        while True:
            msg = self._q.get()
            if msg is None:
                break
            try:
                requests.post(
                    f"https://api.telegram.org/bot{msg.bot_token}/sendMessage",
                    json={"chat_id": msg.chat_id, "text": msg.text},
                    timeout=10,
                )
            except Exception as exc:
                logger.warning("Telegram send failed: %s", exc)
```

### `maintenance/notify/maintenance_notifier.py` — Sửa `_send()`

```python
from .notify_queue import NotifyQueue

class MaintenanceNotifier:
    def _send(self, text: str) -> None:
        # Không block — enqueue bất đồng bộ
        NotifyQueue.get().enqueue(self._bot_token, self._chat_id, text)
```

### `runner.py` — Stop queue khi shutdown

```python
def stop(self) -> None:
    ...
    NotifyQueue.get().stop()
    MongoConnection.close()
```

---

## 6. Lưu ý về Rate Limiting Telegram

Telegram giới hạn ~30 messages/giây per bot. Campaign 200+ items × 2 notify/item = 400+ messages, nhưng trải đều qua nhiều đêm — không có vấn đề rate limiting trong thực tế (tick 60s = tối đa 1 item/phút).

Nếu nhiều cluster cùng chạy: vẫn an toàn vì mỗi cluster xử lý 1 item/tick.

---

## 7. DRY_RUN Mode

Khi `MAINT_DRY_RUN=true`: không emit `on_item_started` và per-item events (giả lập, không thực execute). Chỉ emit khi outcome thật.

Check trong các call site của `execute_service` (đã có trong section 4):

```python
if self._publisher is not None and not self._settings.maint_dry_run:
    self._publisher.on_item_started(item)
```

---

## 8. Verification

1. DRY_RUN mode → không nhận Telegram notify per-item
2. Real execution → nhận notify "bắt đầu" trước khi DDL chạy
3. Item DONE → nhận notify với frag before/after và duration
4. Item FAILED → nhận notify với error message (truncated 200 chars)
5. Resumable REBUILD bị PAUSE → nhận notify "tạm dừng"
6. Campaign về COMPLETED → nhận notify "hoàn thành" với summary
7. Multi-cluster: mỗi cluster gửi notify độc lập với `cluster_id` label đúng

---

## Rủi ro & Lưu ý

- **Message quá dài:** Error message được truncate ở 200 chars. Index/stats name dài cũng cần truncate target nếu > 80 chars.
- **Notify thất bại:** `_send()` nên wrap try/except — notify fail không được làm crash execute flow.
- **Nhiều lỗi liên tiếp:** Nếu 50 items liên tiếp FAILED → 50 notify. Xem xét thêm cooldown hoặc batch notify lỗi nếu cần (không trong scope hiện tại).
