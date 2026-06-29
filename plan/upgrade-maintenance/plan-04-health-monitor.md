# Plan 04 — Mid-execution Health Monitor

## Mục tiêu

Thêm background health monitoring chạy liên tục trong quá trình execute (không chỉ check 1 lần trước mỗi tick). Khi metrics vượt ngưỡng cấu hình → dừng toàn bộ job của cluster đó, notify Telegram.

---

## 1. Thiết kế

### Vòng đời health monitor

```
MaintenanceService startup
  └── per cluster: HealthMonitorThread(cluster, execute_service, notifier).start()

HealthMonitorThread (daemon thread, loop)
  └── mỗi interval_sec (default 30s):
        check CPU + active requests + AG queues
        nếu ANY gate fail:
          execute_service.request_health_stop(reason, metrics)
        nếu ALL gates pass và đang bị stopped:
          execute_service.clear_health_stop()
          log "Health recovered, resuming"
```

### Tách biệt với GateService hiện tại

GateService hiện tại vẫn giữ — check trước mỗi tick (coarse filter).
HealthMonitorThread là lớp bổ sung, check **trong khi** item đang execute.

---

## 2. MongoDB — Thêm config vào `maintenance_window`

### `maintenance/models/window.py` — Sửa

```python
class HealthMonitorConfig(BaseModel):
    enabled: bool = True
    interval_sec: int = 30              # tần suất check (giây)
    cpu_max_pct: float = 80.0           # CPU% ngưỡng dừng
    active_requests_max: int = 60       # số active sessions ngưỡng dừng
    log_send_queue_max_kb: int | None = None   # AG log send queue
    redo_queue_max_kb: int | None = None       # AG redo queue
    # auto_resume: khi metrics về ngưỡng → tự resume (default True)
    auto_resume: bool = True

class MaintenanceWindow(BaseModel):
    ...
    # Thêm:
    health_monitor: HealthMonitorConfig = Field(default_factory=HealthMonitorConfig)
```

---

## 3. Python — Files Mới/Sửa

### 3a. `maintenance/safety/health_monitor.py` — Mới

```python
import threading
import logging
from ..models.window import HealthMonitorConfig
from ..safety.gate_service import GateService
from ..safety.health_state import HealthState
from ..execute.execute_service import ClusterExecuteService
from ..notify.event_publisher import MaintenanceEventPublisher

logger = logging.getLogger(__name__)


class HealthMonitorThread:
    """Background thread: check gates mỗi interval_sec, request stop nếu fail."""

    def __init__(
        self,
        cluster_id: str,
        window_repo,
        gate_service: GateService,
        execute_service: ClusterExecuteService,
        publisher: MaintenanceEventPublisher | None,
    ) -> None:
        # Không nhận host_resolver riêng — dùng execute_service.get_primary_host()
        # để đảm bảo nhất quán với node role refresh của execute service (plan-02)
        self._cluster_id = cluster_id
        self._window_repo = window_repo
        self._gate_service = gate_service
        self._execute_service = execute_service
        self._publisher = publisher
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"health-{cluster_id}")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._check_once()
            except Exception as exc:
                logger.warning("HealthMonitor check failed for cluster=%s: %s", self._cluster_id, exc)
            window = self._window_repo.find_by_cluster(self._cluster_id)
            interval = window.health_monitor.interval_sec if window and window.health_monitor else 30
            self._stop_event.wait(timeout=interval)

    def _check_once(self) -> None:
        window = self._window_repo.find_by_cluster(self._cluster_id)
        if not window or not window.health_monitor or not window.health_monitor.enabled:
            return

        cfg: HealthMonitorConfig = window.health_monitor

        # Dùng execute_service để lấy primary host — đảm bảo dùng cùng node role
        # cache đã được refresh (plan-02). Không có host_resolver riêng.
        host = self._execute_service.get_primary_host()
        if host is None:
            return

        conn_str = self._execute_service.get_primary_conn_str(host)

        # Build gate config từ health_monitor cfg — KHÔNG dùng window.effective_gates()
        # vì health monitor có thể có ngưỡng khác (thường nghiêm hơn) so với tick gate
        health_gates = _build_health_gates(cfg)
        gate_result = self._gate_service.check(host, health_gates, conn_str)
        state = self._execute_service.get_health_state()

        if not gate_result.passed:
            metrics = gate_result.metrics   # dict: cpu_pct, active_requests, ...
            reason = gate_result.reason
            # HEALTHY → STOPPING (notify một lần); STOPPING/STOPPED → cập nhật metrics
            notify = (state == HealthState.HEALTHY)
            self._execute_service.request_health_stop(reason, metrics)
            if notify and self._publisher is not None:
                self._publisher.on_health_stop(reason, metrics)
            logger.warning(
                "HealthMonitor: stop requested cluster=%s state=%s reason=%s metrics=%s",
                self._cluster_id, state.value, reason, metrics,
            )
        elif cfg.auto_resume:
            if state == HealthState.STOPPED:
                # Gates pass lần đầu → RECOVERING (chờ cycle tiếp theo xác nhận)
                self._execute_service.notify_gates_recovered()
                logger.info("HealthMonitor: gates recovered, entering RECOVERING for cluster=%s", self._cluster_id)
            elif state == HealthState.RECOVERING:
                # Gates pass lần 2 → HEALTHY
                self._execute_service.confirm_recovery()
                logger.info("HealthMonitor: health confirmed, resuming cluster=%s", self._cluster_id)
```

### Helper `_build_health_gates()` — trong `health_monitor.py`

Build gate config riêng từ `HealthMonitorConfig` — tách biệt với tick gate:

```python
def _build_health_gates(cfg: HealthMonitorConfig) -> dict:
    """
    Convert HealthMonitorConfig thành gate dict cho GateService.check().
    Chỉ include gate nếu field không None — None = không check gate đó.
    """
    gates = {}
    if cfg.cpu_max_pct is not None:
        gates["cpu_max_pct"] = cfg.cpu_max_pct
    if cfg.active_requests_max is not None:
        gates["active_requests_max"] = cfg.active_requests_max
    if cfg.log_send_queue_max_kb is not None:
        gates["log_send_queue_max_kb"] = cfg.log_send_queue_max_kb
    if cfg.redo_queue_max_kb is not None:
        gates["redo_queue_max_kb"] = cfg.redo_queue_max_kb
    return gates
```

---

### 3b. `maintenance/safety/health_state.py` — Mới (State Machine)

Thay vì dùng raw flag `_health_stop_reason`, dùng enum state machine để dễ debug và mở rộng:

```python
from enum import Enum

class HealthState(Enum):
    HEALTHY   = "healthy"    # gates pass, execute bình thường
    STOPPING  = "stopping"   # gate fail, đang chờ item hiện tại hoàn thành
    STOPPED   = "stopped"    # không claim item mới; resumable đã PAUSE
    RECOVERING = "recovering" # gates pass trở lại, chờ 1 check-cycle xác nhận trước khi resume
```

**Transition hợp lệ:**

```
HEALTHY   → STOPPING   : gate fail lần đầu
STOPPING  → STOPPED    : item hiện tại kết thúc (hoặc PAUSE resumable thành công)
STOPPED   → RECOVERING : auto_resume=True + gates pass
RECOVERING → HEALTHY   : gates pass ở check-cycle tiếp theo (xác nhận ổn định)
RECOVERING → STOPPED   : gates fail lại trong recovery window
* → HEALTHY            : clear_health_stop() (manual override)
```

### 3c. `maintenance/execute/execute_service.py` — Sửa

**Thêm state:**

```python
from ..safety.health_state import HealthState

self._health_state: HealthState = HealthState.HEALTHY
self._health_reason: str = ""
self._health_metrics: dict = {}
self._health_lock = threading.Lock()
```

**Thêm methods:**

```python
def get_primary_host(self) -> str | None:
    """Public wrapper — dùng chung refresh logic với tick (plan-02 node role cache)."""
    return self._get_primary_host()

def get_primary_conn_str(self, host: str) -> str:
    """Public wrapper để health monitor lấy connection string đúng cluster."""
    return self._cluster.get_connection_string(host)

def get_health_state(self) -> HealthState:
    with self._health_lock:
        return self._health_state

def request_health_stop(self, reason: str, metrics: dict) -> None:
    with self._health_lock:
        if self._health_state == HealthState.HEALTHY:
            self._health_state = HealthState.STOPPING
        self._health_reason = reason
        self._health_metrics = metrics

    # Nếu đang execute REBUILD resumable → PAUSE ngay → transition STOPPING → STOPPED
    with self._lock:
        item = self._current_item
        host = self._current_host
        conn_str = self._current_conn_str
    if item is not None and item.action_type in _REBUILD_ACTIONS:
        try:
            pause_stmt = statement_builder.build_pause(item)
            with maint_connection(host, conn_str) as conn:
                conn.execute(pause_stmt)
            logger.info("HealthMonitor: paused resumable REBUILD for %s", item.object_label())
            with self._health_lock:
                self._health_state = HealthState.STOPPED
        except Exception as exc:
            logger.error("HealthMonitor: PAUSE failed: %s", exc)
    # Các loại khác (REORG, UPDATE STATS): transition STOPPING → STOPPED xảy ra
    # sau khi item kết thúc trong _finalize_item()

def mark_health_stopped(self) -> None:
    """Gọi từ _finalize_item() khi item kết thúc trong state STOPPING."""
    with self._health_lock:
        if self._health_state == HealthState.STOPPING:
            self._health_state = HealthState.STOPPED

def notify_gates_recovered(self) -> None:
    """Gọi từ HealthMonitorThread khi gates pass trong state STOPPED."""
    with self._health_lock:
        if self._health_state == HealthState.STOPPED:
            self._health_state = HealthState.RECOVERING

def confirm_recovery(self) -> None:
    """Gọi từ HealthMonitorThread khi gates pass ở check-cycle thứ 2 (RECOVERING → HEALTHY)."""
    with self._health_lock:
        if self._health_state == HealthState.RECOVERING:
            self._health_state = HealthState.HEALTHY
            self._health_reason = ""
            self._health_metrics = {}

def clear_health_stop(self) -> None:
    """Manual override — force về HEALTHY ngay."""
    with self._health_lock:
        self._health_state = HealthState.HEALTHY
        self._health_reason = ""
        self._health_metrics = {}

def is_health_stopped(self) -> bool:
    with self._health_lock:
        return self._health_state in (HealthState.STOPPING, HealthState.STOPPED, HealthState.RECOVERING)
```

**Trong `tick()` — check ngay đầu (sau campaign gate):**

```python
def tick(self) -> int:
    if self._stop_requested:
        return 0

    # Health stop gate — STOPPING/STOPPED/RECOVERING đều không claim item mới
    state = self.get_health_state()
    if state != HealthState.HEALTHY:
        logger.debug(
            "Tick skip: health_state=%s for cluster=%s", state.value, self._cluster.cluster_id
        )
        return 0

    # ... (tiếp tục campaign gate, window, gates như cũ)
```

**Trong `_finalize_item()` — sau khi item kết thúc:**

```python
def _finalize_item(self, item, outcome, ...) -> None:
    # ... finalize logic ...
    self.mark_health_stopped()   # nếu state là STOPPING → chuyển sang STOPPED
```

### 3c. `maintenance/safety/gate_service.py` — Sửa

`GateResult` cần thêm `metrics: dict` và `reason: str` để HealthMonitorThread đọc và forward vào notify:

```python
class GateResult:
    passed: bool
    reason: str = ""
    metrics: dict = {}   # cpu_pct, active_requests, log_send_queue_kb, redo_queue_kb
```

Khi gate fail, populate `reason` và `metrics` với giá trị thực đo được.

### 3d. `maintenance/runner.py` — Sửa

```python
from .safety.health_monitor import HealthMonitorThread

# Trong _setup_infrastructure(), sau khi tạo execute_service per cluster:
health_monitor = HealthMonitorThread(
    cluster_id=cluster.cluster_id,
    window_repo=window_repo,
    gate_service=GateService(),
    execute_service=execute_service,   # cung cấp get_primary_host() + get_primary_conn_str()
    publisher=publisher,
)
health_monitor.start()
self._health_monitors.append(health_monitor)

# Trong stop():
for monitor in self._health_monitors:
    monitor.stop()
```

---

## 4. Thread Ownership — Quy ước Rõ Ràng

Khi số cluster tăng, mô hình "1 HealthMonitorThread per cluster" vẫn chạy được nhưng cần quy ước rõ để runner.py không trở thành nơi chứa mọi thứ.

### Ownership Table

| Câu hỏi | Trả lời | Lý do |
|---|---|---|
| **Ai tạo monitor?** | `runner.py` trong `_setup_cluster()` — 1 lần per cluster khi startup | Runner là nơi duy nhất biết cả `execute_service` lẫn `publisher` |
| **Ai stop monitor?** | `runner.py` trong `stop()` — gọi `monitor.stop()` cho tất cả clusters | LIFO với execute_service: stop monitor trước, execute sau |
| **Monitor gọi gì vào execute_service?** | Chỉ 4 methods: `request_health_stop()`, `notify_gates_recovered()`, `confirm_recovery()`, `get_health_state()` | Không được gọi `tick()`, `claim()`, hay bất kỳ execute logic nào |
| **Monitor gọi gì vào publisher?** | Chỉ `on_health_stop()` — và chỉ khi transition `HEALTHY → STOPPING` | Tránh spam notify nếu gates tiếp tục fail |
| **Source of truth cho state?** | `execute_service._health_state` (protected bởi `_health_lock`) | Monitor chỉ trigger transitions; execute_service sở hữu state |
| **Ai đọc state để quyết định?** | `execute_service.tick()` đọc `get_health_state()` | Monitor không biết gì về window, campaign, hay item queue |

### `runner.py` — Stop Order

```python
def stop(self) -> None:
    # 1. Stop health monitors trước (không trigger stop thêm sau khi execute dừng)
    for monitor in self._health_monitors:
        monitor.stop()
    # 2. Stop execute services
    for svc in self._execute_services:
        svc.request_stop()
    # 3. Stop notify queue
    NotifyQueue.get().stop()
    # 4. Shutdown schedulers
    self._scheduler.shutdown(wait=True)
```

### `_setup_cluster()` — Tạo monitor

```python
def _setup_cluster(self, cluster: ClusterConfig) -> None:
    publisher    = MaintenanceNotifier(...)  # hoặc None nếu không config Telegram
    execute_svc  = ClusterExecuteService(..., publisher=publisher)
    # Không truyền host_resolver — monitor dùng execute_svc.get_primary_host()
    # để nhất quán với node role refresh (plan-02)
    monitor      = HealthMonitorThread(
        cluster_id=cluster.cluster_id,
        window_repo=window_repo,
        gate_service=GateService(),
        execute_service=execute_svc,
        publisher=publisher,
    )

    self._execute_services.append(execute_svc)
    self._health_monitors.append(monitor)
    monitor.start()
```

---

## 5. Hành vi theo Loại Statement

| Action Type | Có thể interrupt mid-exec? | Cách xử lý |
|---|---|---|
| REBUILD (resumable) | ✅ An toàn | Gửi `ALTER INDEX ... PAUSE` ngay khi health stop |
| REBUILD (non-resumable) | ❌ Không nên | Chờ item hiện tại xong → không claim item tiếp theo |
| REBUILD PARTITION | Tuỳ resumable flag | Như REBUILD |
| REORGANIZE | ⚠ Rollback | SQL Server rollback khi kill session — để chờ hoàn thành |
| UPDATE STATISTICS | ✅ Idempotent | Chờ hoàn thành (thường nhanh) |
| HEAP REBUILD | ❌ Không nên | Chờ item hiện tại xong |

**Nguyên tắc:** Chỉ PAUSE resumable REBUILD ngay lập tức. Mọi loại khác: không interrupt, nhưng không claim item mới sau khi health stop được set.

---

## 6. Config trong MongoDB

Seed mặc định thêm vào `maintenance_window`:

```python
DEFAULT_WINDOW = {
    ...,
    "health_monitor": {
        "enabled": True,
        "interval_sec": 30,
        "cpu_max_pct": 80.0,
        "active_requests_max": 60,
        "log_send_queue_max_kb": None,   # không check AG nếu None
        "redo_queue_max_kb": None,
        "auto_resume": True,
    }
}
```

DBA có thể sửa trực tiếp trong MongoDB — HealthMonitorThread đọc lại mỗi interval (không cache).

---

## 7. Quan hệ với GateService hiện tại

```
tick() đầu mỗi 60s:
  [1] health stop flag? → skip (set bởi background thread)
  [2] campaign gate?
  [3] window open?
  [4] GateService.check() → snapshot tức thời trước khi claim  ← giữ nguyên

HealthMonitorThread mỗi 30s (độc lập):
  [A] Đọc config từ window.health_monitor
  [B] GateService.check() → nếu fail → set flag + notify + PAUSE resumable
```

Cả hai đều gọi `GateService` — không xung đột vì mỗi call là read-only DMV query riêng biệt.

---

## 8. UI (tùy chọn, không bắt buộc trong scope này)

Layer 3 có thể hiển thị `health_monitor` config trong maintenance window UI (plan-02 scope hoặc sau này). Không bắt buộc để feature hoạt động.

---

## 9. Verification

1. Set CPU threshold thấp (e.g., 5%) trong MongoDB → HealthMonitor trigger ngay
2. Tick log: `"Tick skip: health stop active for cluster=..."` — không execute item
3. Telegram nhận notify với metrics (CPU %, active sessions)
4. Đang REBUILD resumable → nhận PAUSE khi health stop
5. Sau khi CPU về bình thường (auto_resume=true) → log `"health recovered"`, tick tiếp tục
6. Tắt `enabled: false` → HealthMonitor không check (tick GateService vẫn check bình thường)
7. SIGTERM: HealthMonitor thread kết thúc sạch (daemon thread, stop_event.set())

---

## Rủi ro & Lưu ý

- **GateService.check() timeout:** Health monitor gọi GateService mỗi 30s. Query DMV cần timeout ngắn (5–10s) để không block thread quá lâu. Cần kiểm tra timeout setting của GateService.
- **Multiple clusters:** Mỗi cluster có 1 HealthMonitorThread độc lập — cluster A stop không ảnh hưởng cluster B.
- **False positive:** CPU spike ngắn (< 30s) có thể trigger stop không cần thiết. Có thể thêm `trigger_count: int = 2` — chỉ stop khi 2 lần check liên tiếp fail (không trong scope hiện tại).
- **Auto_resume:** Nếu `auto_resume: false`, DBA phải restart process để resume. Thiết kế đơn giản — có thể thêm Telegram button resume sau.
