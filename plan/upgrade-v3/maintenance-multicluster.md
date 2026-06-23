# Plan: Maintenance Multi-Cluster Support

## Context

Package `maintenance/` hiện chỉ hỗ trợ single-cluster qua env vars (`MSSQL_NODES`, `MSSQL_DATABASE`...).
Hệ thống đã có `db_monitor.db_clusters` lưu nhiều cụm (prod/UAT) với credentials riêng — giống pattern
layer1 monitoring. Cần align maintenance theo cùng mô hình: đọc cluster config từ `db_clusters`,
chạy scan/execute độc lập per cluster, lưu toàn bộ maintenance data có `cluster_id`.

**Quyết định đã chốt:**
- Window config: **per-cluster** (`window_id = cluster_id`) — bật/tắt, đổi giờ riêng từng cụm
- Connection: **chỉ đọc từ `db_clusters`** — bỏ hoàn toàn `MSSQL_*` env vars

---

## Architecture After Refactor

```
db_monitor.db_clusters  ← nguồn cluster config (nodes, creds, node_roles)
        │
        ▼
maintenance/runner.py
  ├── ClusterReader(monitor_db) → find_all_enabled()   ← maintenance-side thin reader
  │     (KHÔNG dùng layer1.ClusterRepo — repo đó bind vào layer1 MongoConnection singleton)
  ├── per cluster: ClusterScanService + ClusterExecuteService
  └── jobs: maint_scan_{cluster_id} | maint_tick_{cluster_id} | maint_summary_{cluster_id}

db_maintenance (per cluster_id isolation)
  ├── maintenance_queue     cluster_id field + compound indexes
  ├── maintenance_batches   cluster_id field + compound indexes
  ├── maintenance_history   cluster_id field + compound indexes
  ├── maintenance_window    window_id = cluster_id (1 doc per cluster)
  └── maintenance_policies  GLOBAL (thresholds chung, không per-cluster)
```

**Node role detection:** Đọc `cluster.node_roles` từ `db_clusters` (layer1 refresh mỗi giờ),
lấy host có `role = "primary"`. Không query AG DMV riêng, không duplicate logic.

---

## Env Vars — Thay Đổi

```env
# BỎ HOÀN TOÀN (không còn dùng):
# MSSQL_NODES, MSSQL_DATABASE, MSSQL_USERNAME, MSSQL_PASSWORD, MSSQL_PORT

# THÊM MỚI — đọc db_clusters từ db_monitor:
MONGODB_DB=db_monitor           # database chứa db_clusters (shared URI)

# GIỮ NGUYÊN:
MONGODB_URI=mongodb://mongodb:27017
MAINT_MONGODB_DB=db_maintenance
MAINT_TELEGRAM_BOT_TOKEN=...
MAINT_TELEGRAM_CHAT_ID=...
MAINT_DRY_RUN=true
MAINT_SCAN_CRON=0 20 * * *
MAINT_SUMMARY_CRON=30 5 * * *
MAINT_TICK_SEC=60
# ...các MAINT_* khác giữ nguyên
```

---

## Files to Create / Modify

### Python `maintenance/`

| File | Action |
|---|---|
| `infra/cluster_reader.py` | **Tạo** — `ClusterReader(db)` thin reader, nhận `Database` trực tiếp |
| _(layer1)_ `models/cluster.py` | **Sửa** — thêm `max_length=12` cho `cluster_id` ở `ClusterConfig` + `ClusterCreate` |
| `config.py` | **Sửa** — bỏ `mssql_*` fields, thêm `monitor_mongodb_db: str` |
| `infra/mssql_connection.py` | **Sửa** — thêm `conn_str: str` param, bỏ đọc từ settings singleton |
| `infra/query_executor.py` | **Sửa** — forward `conn_str` xuống `mssql_connection(host, conn_str, ...)` |
| `connection.py` | **Sửa** — thêm `conn_str: str` param, bỏ đọc từ settings singleton |
| `runner.py` | **Sửa** — dual MongoDB, load clusters, jobs per-cluster, failure isolation |
| `models/work_item.py` | **Sửa** — thêm `cluster_id: str` |
| `models/approval.py` | **Sửa** — thêm `cluster_id: str` vào `MaintenanceBatch` |
| `models/history.py` | **Sửa** — thêm `cluster_id: str` vào `MaintenanceHistory` |
| `models/window.py` | **Sửa** — `window_id` = cluster_id (bỏ hardcode "default"), `enabled` per-cluster |
| `repositories/window_repo.py` | **Sửa** — `find_by_cluster(cluster_id)` thay `find_default()` |
| `repositories/queue_repo.py` | **Sửa** — `cluster_id` filter trong mọi query + claim |
| `repositories/batch_repo.py` | **Sửa** — `cluster_id` filter trong mọi query |
| `repositories/history_repo.py` | **Sửa** — `cluster_id` filter trong mọi query |
| `scan/scan_service.py` | **Sửa** — nhận `cluster: ClusterConfig`, dùng cluster creds, ghi `cluster_id` |
| `execute/execute_service.py` | **Sửa** — nhận `cluster: ClusterConfig`, dùng cluster creds, ghi `cluster_id` |
| `safety/gate_service.py` | **Sửa** — `check(host, gates, conn_str)` thêm `conn_str` param |
| `notify/maintenance_notifier.py` | **Sửa** — prefix message + **đổi callback format** thêm `cluster_id` |
| `notify/approval_adapter.py` | **Sửa** — parse format mới (5 parts), pass `cluster_id` vào repos |
| `seed/seed_maintenance.py` | **Sửa** — `--cluster-id` arg, seed window per cluster |
| `indexes.py` | **Sửa** — thêm `cluster_id` vào compound indexes |

### Layer 3

| File | Action |
|---|---|
| `apps/api/src/schemas/maintenance.schema.ts` | **Sửa** — thêm `cluster_id` vào 3 schemas |
| `apps/api/src/routes/maintenance.ts` | **Sửa** — thêm `cluster_id?` vào interfaces + handlers |
| `apps/api/src/services/maintenance-service.ts` | **Sửa** — `cluster_id` filter trong mọi MongoDB query |
| `apps/web-v2/src/types/index.ts` | **Sửa** — thêm `MaintenanceSummaryQuery` + `cluster_id?` vào Queue/History |
| `apps/web-v2/src/lib/query-keys.ts` | **Sửa** — `maintenanceSummary` nhận `MaintenanceSummaryQuery` thay vì `()` |
| `apps/web-v2/src/hooks/useMaintenance.ts` | **Sửa** — 3 hooks đều inject `selectedClusterId`, pass vào `queryKey` + `queryFn` |

---

## Task 0 — `infra/cluster_reader.py` (NEW)

`layer1.storage.repositories.ClusterRepo` phụ thuộc vào `MongoConnection.get_db()` — đây là layer1 singleton, chỉ được init trong layer1 process. Maintenance là process riêng, có `MongoClient` của riêng mình. Vì vậy **không thể** `import ClusterRepo` và gọi trực tiếp.

Giải pháp: thin reader trong maintenance package, nhận `Database` từ runner — reuse `ClusterConfig` model (import từ `layer1.models.cluster`), không import repo.

```python
# maintenance/infra/cluster_reader.py
from __future__ import annotations

from pymongo.database import Database
from layer1.models.cluster import ClusterConfig   # model only, không import repo


class ClusterReader:
    """Đọc db_clusters từ db_monitor — nhận Database trực tiếp từ runner.

    KHÔNG dùng layer1.ClusterRepo vì repo đó bind vào MongoConnection singleton
    của layer1 process. Maintenance là process riêng với MongoClient riêng.
    """

    COLLECTION = "db_clusters"

    def __init__(self, monitor_db: Database) -> None:
        self._col = monitor_db[self.COLLECTION]

    def find_all_enabled(self) -> list[ClusterConfig]:
        docs = self._col.find({"enabled": True}, sort=[("name", 1)])
        return [
            ClusterConfig(**{k: v for k, v in doc.items() if k != "_id"})
            for doc in docs
        ]

    def find_by_id(self, cluster_id: str) -> ClusterConfig | None:
        doc = self._col.find_one({"cluster_id": cluster_id, "enabled": True})
        if not doc:
            return None
        return ClusterConfig(**{k: v for k, v in doc.items() if k != "_id"})
```

---

## Task 1 — `config.py`

```python
class MaintEnvSettings(BaseSettings):
    # MSSQL_* fields: ĐÃ XÓA — chỉ đọc từ db_clusters

    # MongoDB — monitoring db (đọc db_clusters)
    mongodb_uri: str = "mongodb://localhost:27017"
    monitor_mongodb_db: str = "db_monitor"    # NEW

    # MongoDB — maintenance db
    maint_mongodb_db: str = "db_maintenance"

    # Maintenance execution (giữ nguyên)
    maint_dry_run: bool = True
    maint_scan_cron: str = "0 20 * * *"
    maint_summary_cron: str = "30 5 * * *"
    maint_tick_sec: int = 60
    maint_max_attempts: int = 3
    maint_approval_expire_hours: int = 30
    maint_batch_top_n_items: int = 10
    maint_estimate_pages_per_minute: int = 150_000
    maint_estimate_rows_per_minute: int = 2_000_000

    # Telegram
    maint_telegram_bot_token: str = ""
    maint_telegram_chat_id: str = ""

    # Logging
    log_level: str = "INFO"
    # ...logstash fields giữ nguyên

    class Config:
        env_file = ".env"
        extra = "ignore"
```

---

## Task 2 — Connection Layer Refactor (3 paths)

### Bối cảnh — 3 SQL connection paths khác nhau

Tất cả hiện đọc `conn_str` từ `maint_settings` singleton:

| Path | File hiện tại | Dùng ở |
|---|---|---|
| Read-only + timeout | `infra/mssql_connection.py` | scan (via QueryExecutor), gate check, measure frag |
| DDL — không timeout | `connection.py` | execute statement, offline retry, SIGTERM PAUSE |

Cả 2 file đều call `settings.get_connection_string(host)` → `MSSQL_*` env vars. Phải sửa cả 2.

**Reuse `ClusterConfig` từ `layer1/models/cluster.py`** — import trực tiếp, không duplicate.
Import path: `from layer1.models.cluster import ClusterConfig`.

---

### 2a. `infra/mssql_connection.py` — thêm `conn_str` param

```python
# Bỏ import: from ..config import maint_settings as settings

@contextmanager
def mssql_connection(
    host: str,
    conn_str: str,                    # NEW — caller cung cấp từ ClusterConfig
    timeout_sec: int | None = None,
) -> Generator[pyodbc.Connection, None, None]:
    timeout = timeout_sec if timeout_sec is not None else 30  # hardcode default (bỏ settings)
    conn = pyodbc.connect(conn_str, timeout=timeout, autocommit=True)
    conn.timeout = timeout
    try:
        yield conn
    finally:
        conn.close()


def test_connection(host: str, conn_str: str) -> bool:  # conn_str bắt buộc
    try:
        with mssql_connection(host, conn_str) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception as exc:
        logger.debug("test_connection failed for host=%s: %s", host, exc)
        return False
```

### 2b. `infra/query_executor.py` — forward `conn_str`

`QueryExecutor.execute()` nhận thêm `conn_str`:

```python
def execute(
    self,
    query: QueryConfig,
    host: str,
    topic_id: str,
    node_role: str,
    conn_str: str,           # NEW — truyền xuống mssql_connection
) -> QueryResult:
    ...
    with mssql_connection(host, conn_str, timeout_sec=query.timeout_sec) as conn:
        ...

def execute_batch(
    self,
    queries: list[QueryConfig],
    host: str,
    topic_id: str,
    node_role: str,
    conn_str: str,           # NEW
) -> list[QueryResult]:
    ...
    with mssql_connection(host, conn_str) as conn:
        ...
```

### 2c. `connection.py` — thêm `conn_str` param (DDL path)

```python
# Bỏ import: from .config import maint_settings as settings

@contextmanager
def maint_connection(host: str, conn_str: str) -> Generator[pyodbc.Connection, None, None]:
    """Connection cho ALTER INDEX / UPDATE STATISTICS — không statement timeout."""
    conn = pyodbc.connect(conn_str, timeout=15, autocommit=True)
    conn.timeout = 0  # No statement timeout — rebuilds run for hours
    try:
        yield conn
    finally:
        conn.close()
```

---

## Task 3 — `models/` — Thêm `cluster_id`

### `work_item.py`
```python
class WorkItem(BaseModel):
    cluster_id: str          # NEW — bắt buộc
    item_id: str = Field(default_factory=lambda: str(uuid4()))
    # ...các fields hiện tại giữ nguyên
```

### `approval.py` — MaintenanceBatch
```python
class MaintenanceBatch(BaseModel):
    cluster_id: str          # NEW
    batch_id: str = ...
    # ...giữ nguyên
```

### `history.py` — MaintenanceHistory
```python
class MaintenanceHistory(BaseModel):
    cluster_id: str          # NEW
    history_id: str = ...
    # ...giữ nguyên
```

### `window.py` — MaintenanceWindow
```python
class MaintenanceWindow(BaseModel):
    window_id: str           # = cluster_id (không còn hardcode "default")
    cluster_id: str          # NEW — explicit field
    enabled: bool = True     # per-cluster enable/disable
    default: WindowSlot = WindowSlot()
    day_overrides: dict[str, WindowSlot] = {}
    kill_switch: bool = False
    gates: dict[str, int] = Field(default_factory=lambda: {
        "cpu_max_pct": 60,
        "max_active_requests": 50,
        "max_log_send_queue_kb": 100_000,
        "max_redo_queue_kb": 200_000,
    })
```

---

## Task 4 — `repositories/` — Thêm `cluster_id` Filter

### `window_repo.py`
```python
# Thay find_default():
def find_by_cluster(self, cluster_id: str) -> MaintenanceWindow | None:
    doc = self._col.find_one({"cluster_id": cluster_id})
    return MaintenanceWindow(**doc) if doc else None

def upsert(self, window: MaintenanceWindow) -> None:
    self._col.replace_one(
        {"cluster_id": window.cluster_id},
        window.model_dump(),
        upsert=True,
    )
```

### `queue_repo.py`
Mọi method thêm `cluster_id` vào filter:
```python
def find_pending(self, cluster_id: str) -> list[WorkItem]:
    return self._query({"cluster_id": cluster_id, "status": {"$in": [...]}})

def claim_next(self, cluster_id: str, ...) -> WorkItem | None:
    # findOneAndUpdate thêm filter: cluster_id = cluster_id
```

### `batch_repo.py` và `history_repo.py`
Tương tự — thêm `cluster_id` vào mọi `find_one`, `find`, `update` filter.

---

## Task 5 — `indexes.py`

```python
# maintenance_queue
col.create_index([
    ("cluster_id", ASCENDING),
    ("status", ASCENDING),
    ("priority", DESCENDING),
    ("created_at", ASCENDING),
], name="claim_order")

col.create_index([
    ("cluster_id", ASCENDING),
    ("schema_name", ASCENDING),
    ("table_name", ASCENDING),
    ("index_name", ASCENDING),
    ("partition_number", ASCENDING),
    ("status", ASCENDING),
], name="dedupe_lookup")

# maintenance_batches
col.create_index([
    ("cluster_id", ASCENDING),
    ("status", ASCENDING),
    ("created_at", DESCENDING),
], name="status_time")

# maintenance_history
col.create_index([
    ("cluster_id", ASCENDING),
    ("table_name", ASCENDING),
    ("finished_at", DESCENDING),
], name="table_time")

# maintenance_window — unique per cluster
col.create_index([("cluster_id", ASCENDING)], unique=True, name="unique_cluster")
```

---

## Task 6 — `scan/scan_service.py`

```python
class ClusterScanService:
    def __init__(
        self,
        cluster: ClusterConfig,    # NEW — replaces env-var connection
        maint_db: Database,
        notifier: MaintenanceNotifier,
        policy_resolver: PolicyResolver,
        window_repo: MaintenanceWindowRepo,
        queue_repo: MaintenanceQueueRepo,
        batch_repo: MaintenanceBatchRepo,
        scan_query_repo: ScanQueryRepo,
        config: MaintEnvSettings,
    ): ...

    def _get_primary_host(self) -> str | None:
        # Đọc cluster.node_roles (đã có từ db_clusters, layer1 refresh mỗi giờ)
        for nr in self._cluster.node_roles:
            if nr.role == "primary":
                return nr.host
        return None

    def run(self) -> int:
        host = self._get_primary_host()
        if not host:
            logger.warning("No primary found for cluster=%s, skip scan", self._cluster.cluster_id)
            return 0

        conn_str = self._cluster.get_connection_string(host)
        # Scan dùng QueryExecutor (read-only, có timeout) — KHÔNG dùng maint_connection.
        # conn_str được pass vào query_executor.execute(..., conn_str=conn_str) mỗi lần _run_query.
        # Tạo WorkItem với cluster_id = self._cluster.cluster_id
        # Tạo MaintenanceBatch với cluster_id = self._cluster.cluster_id

    def _run_query(self, host: str, conn_str: str, query_id: str, sql: str, timeout_sec: int) -> list[dict]:
        config = QueryConfig(query_id=query_id, sql=sql, timeout_sec=timeout_sec)
        result = self._query_executor.execute(config, host, _TOPIC_ID, "primary", conn_str)
        # conn_str forwarded qua QueryExecutor → mssql_connection(host, conn_str, timeout_sec)
```

---

## Task 6b — `safety/gate_service.py`

Hiện `GateService.check(host, gates)` gọi `mssql_connection(host, ...)` nội bộ → đọc từ settings singleton. Sau refactor, thêm `conn_str` param:

```python
class GateService:

    def check(self, host: str, gates: dict[str, int], conn_str: str) -> GateResult:
        """conn_str từ ClusterConfig — không còn đọc từ settings."""
        reasons: list[str] = []
        try:
            with mssql_connection(host, conn_str, timeout_sec=gate_queries.GATE_TIMEOUT_SEC) as conn:
                reasons.extend(self._check_cpu(conn, gates))
                reasons.extend(self._check_active_load(conn, gates))
                reasons.extend(self._check_ag_queues(conn, gates))
        except Exception as exc:
            logger.warning("Gate check connection failed on %s: %s", host, exc)
            reasons.append(f"gate_unreachable: {exc}")
        ...
```

`ClusterExecuteService.tick()` gọi: `self._gate_service.check(host, gates, conn_str)`.

---

## Task 7 — `execute/execute_service.py`

```python
class ClusterExecuteService:
    def __init__(self, cluster: ClusterConfig, ...): ...

    def tick(self) -> int:
        host = self._get_primary_host()  # Same as ScanService
        if not host:
            return 0

        window = self._window_repo.find_by_cluster(self._cluster.cluster_id)
        if not window or not window.enabled:
            return 0  # Cluster disabled

        conn_str = self._cluster.get_connection_string(host)
        # conn_str được pass đến:
        #   gate_service.check(host, gates, conn_str)
        #   maint_connection(host, conn_str)          — DDL execute + offline retry + SIGTERM PAUSE
        #   mssql_connection(host, conn_str, timeout)  — _measure_frag before/after
        # History ghi cluster_id = self._cluster.cluster_id

    def _measure_frag(self, host: str, conn_str: str, item: WorkItem) -> float | None:
        # mssql_connection cần conn_str (đã sửa ở Task 2a)
        with mssql_connection(host, conn_str, timeout_sec=_MEASURE_TIMEOUT_SEC) as conn:
            ...
```

---

## Task 8 — `runner.py`

```python
def main():
    config = MaintEnvSettings()

    # Dual MongoDB connection
    mongo_client = MongoClient(config.mongodb_uri)
    monitor_db  = mongo_client[config.monitor_mongodb_db]   # db_monitor → db_clusters
    maint_db    = mongo_client[config.maint_mongodb_db]     # db_maintenance

    # Ensure indexes
    ensure_maintenance_indexes(maint_db)

    cluster_reader = ClusterReader(monitor_db)       # maintenance-side thin reader
    enabled_clusters = cluster_reader.find_all_enabled()

    scheduler = BlockingScheduler(
        executors={"default": ThreadPoolExecutor(max_workers=20)},
        timezone="Asia/Ho_Chi_Minh",
    )

    for cluster in enabled_clusters:
        _register_cluster_jobs(scheduler, cluster, maint_db, config)

    # Shared jobs (không per-cluster):
    scheduler.add_job(health_check, IntervalTrigger(seconds=120), id="health_check")

    scheduler.start()


def _register_cluster_jobs(scheduler, cluster: ClusterConfig, maint_db, config):
    cid = cluster.cluster_id
    try:
        scan_svc  = ClusterScanService(cluster, maint_db, ...)
        exec_svc  = ClusterExecuteService(cluster, maint_db, ...)

        scheduler.add_job(
            scan_svc.run,
            CronTrigger.from_crontab(config.maint_scan_cron, timezone="Asia/Ho_Chi_Minh"),
            id=f"maint_scan_{cid}",
            max_instances=1,
        )
        scheduler.add_job(
            exec_svc.tick,
            IntervalTrigger(seconds=config.maint_tick_sec),
            id=f"maint_tick_{cid}",
            max_instances=1,
        )
        scheduler.add_job(
            lambda: send_nightly_summary(cluster, maint_db, ...),
            CronTrigger.from_crontab(config.maint_summary_cron, timezone="Asia/Ho_Chi_Minh"),
            id=f"maint_summary_{cid}",
        )
        logger.info("Registered maintenance jobs for cluster=%s", cid)
    except Exception:
        logger.exception("Failed to register jobs for cluster=%s — skipping", cid)
        # Cluster lỗi không block các cluster khác
```

---

## Task 9 — `notify/maintenance_notifier.py`

### 9a. Callback data format — thêm `cluster_id`

Telegram callback_data giới hạn **64 bytes**. Thêm `cluster_id` vào giữa prefix và id:

```
# Format cũ (single-cluster):
l1|mntb|<batch_id>|all          # 8 + 36 + 4 = 48 bytes ✓
l1|mnti|<short_id>|ok           # 8 + 8 + 3 = 19 bytes ✓

# Format mới (multi-cluster):
l1|mntb|<cluster_id>|<batch_id>|all     # ← budget tính dưới
l1|mntb|<cluster_id>|<batch_id>|reject  # ← chuỗi dài nhất → constraint
l1|mnti|<cluster_id>|<short_id>|ok      # ngắn hơn nhiều
```

**Derivation — max cluster_id length:**

```
Callback dài nhất: l1|mntb|<cluster_id>|<batch_id>|reject

Phân tích byte count (1 byte = 1 ASCII char):
  "l1|mntb|"  = 8
  cluster_id  = N  ← cần tìm N max
  "|"         = 1
  batch_id    = 36  (UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  "|reject"   = 7
  ─────────────
  Total       = 52 + N ≤ 64
  → N ≤ 12
```

**`cluster_id` tối đa 12 ký tự** — constraint này phải được enforce ở model,
không phải chỉ dựa vào convention. Nếu không enforce, DBA có thể tạo cluster_id dài
và nút Telegram sẽ hỏng âm thầm (Telegram trả 400 mà không có error rõ ràng).

### 9a-1. Enforce constraint tại `layer1/models/cluster.py`

Sửa validator `cluster_id` trong cả `ClusterConfig` và `ClusterCreate`:

```python
# ClusterConfig (và ClusterCreate — cùng validator)
@field_validator("cluster_id", "name", "database", "username")
@classmethod
def strip_required_text(cls, value: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError("field is required")
    return text

# THÊM validator riêng cho cluster_id:
@field_validator("cluster_id")
@classmethod
def validate_cluster_id(cls, value: str) -> str:
    # max_length=12 được derive từ Telegram 64-byte callback_data limit:
    # "l1|mntb|" (8) + cluster_id + "|" (1) + UUID (36) + "|reject" (7) = 52 + len ≤ 64
    if len(value) > 12:
        raise ValueError(
            f"cluster_id must be ≤ 12 characters "
            f"(Telegram callback_data limit: 64 bytes). Got {len(value)}."
        )
    return value
```

**Lưu ý thứ tự validator:** Pydantic chạy validator theo thứ tự khai báo trong class.
`strip_required_text` chạy trước (strip + not-empty check), `validate_cluster_id` chạy sau
(max_length check trên giá trị đã strip). Validator `"cluster_id"` trong `strip_required_text`
phải ở `field_validator("cluster_id", "name", ...)` — tức là cluster_id vẫn nằm trong danh sách
đó, `validate_cluster_id` chỉ thêm max_length check sau khi đã pass qua strip.

Thực tế với Pydantic v2, cách ngắn gọn hơn là dùng `Field` annotation:

```python
# Cách ngắn gọn hơn — dùng Field constraint, không cần validator riêng:
class ClusterConfig(BaseModel):
    cluster_id: str = Field(..., min_length=1, max_length=12)
    # Field constraint chạy trước field_validator → strip_required_text vẫn hoạt động

class ClusterCreate(BaseModel):
    cluster_id: str = Field(..., min_length=1, max_length=12)
```

Tuy nhiên cần thêm comment lý do max_length=12 ngay tại field definition để
future dev không tự ý tăng lên mà không tính lại Telegram budget.

### 9b. Code changes

```python
class MaintenanceNotifier:

    def __init__(self, bot_token: str, chat_id: str, cluster_id: str) -> None:
        self._chat_id = chat_id
        self._cluster_id = cluster_id          # NEW — nhúng vào callback data
        self._api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        self._doc_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"

    def send_batch_approval(self, batch: MaintenanceBatch, items: list[WorkItem], ...):
        # Header prefix:
        lines = [f"🔧 <b>[{batch.cluster_id}] Maintenance Batch</b> ...", ...]

        # Batch buttons — cluster_id ở parts[2]:
        keyboard = {"inline_keyboard": [[
            {"text": "✅ Approve ALL",
             "callback_data": f"l1|mntb|{self._cluster_id}|{batch.batch_id}|all"},
            {"text": "⛔ Reject ALL",
             "callback_data": f"l1|mntb|{self._cluster_id}|{batch.batch_id}|reject"},
        ]]}

        # Per-item buttons — cluster_id ở parts[2]:
        for item in top_items:
            self._post(
                self._format_item_line(item),
                reply_markup={"inline_keyboard": [[
                    {"text": "✅",
                     "callback_data": f"l1|mnti|{self._cluster_id}|{item.short_id}|ok"},
                    {"text": "⛔",
                     "callback_data": f"l1|mnti|{self._cluster_id}|{item.short_id}|no"},
                ]]},
            )

    def send_nightly_summary(self, records, slot, used_minutes):
        # Prefix mọi summary message:
        lines = [f"🌙 <b>[{self._cluster_id}] Maintenance đêm qua</b>...", ...]
```

---

## Task 9c — `notify/approval_adapter.py`

Parse format mới — parts giờ có 5 phần thay vì 4:

```
l1|mntb|<cluster_id>|<batch_id>|all    → parts = ["l1","mntb","prod","<uuid>","all"]
l1|mnti|<cluster_id>|<short_id>|ok     → parts = ["l1","mnti","prod","abcd1234","ok"]
```

```python
def _handle_batch(self, parts: list[str], sender: str) -> ApprovalResult:
    if len(parts) < 5:
        return ApprovalResult(ok=False, message="⚠️ Callback batch thiếu cluster_id hoặc decision.")
    cluster_id   = parts[2].strip()    # NEW — index shift
    batch_id     = parts[3].strip()    # was parts[2]
    decision_raw = parts[4].strip().lower()  # was parts[3]
    decision = "approved" if decision_raw == "all" else "rejected"

    decided  = self._batch_repo.decide(cluster_id, batch_id, decision_raw, sender)
    affected = self._queue_repo.bulk_decide_batch(cluster_id, batch_id, decision, sender)
    ...

def _handle_item(self, parts: list[str], sender: str) -> ApprovalResult:
    if len(parts) < 5:
        return ApprovalResult(ok=False, message="⚠️ Callback item thiếu cluster_id hoặc decision.")
    cluster_id = parts[2].strip()        # NEW
    short_id   = parts[3].strip()        # was parts[2]
    decision   = "approved" if parts[4].strip().lower() == "ok" else "rejected"  # was parts[3]

    changed = self._queue_repo.decide_item(cluster_id, short_id, decision, sender)
    ...
```

**Tương thích ngược:** Nếu cần backward-compat với callback cũ (len == 4), có thể fallback:
```python
if len(parts) == 4:
    # callback cũ single-cluster — không có cluster_id
    short_id = parts[2].strip()
    decision = "approved" if parts[3].strip().lower() == "ok" else "rejected"
    changed = self._queue_repo.decide_item(None, short_id, decision, sender)
```
Nhưng vì cả notifier và adapter được deploy cùng lúc, không cần backward-compat — bỏ qua.

### Repo method signatures sau thay đổi

**`queue_repo.py`:**
```python
def decide_item(self, cluster_id: str, short_id: str, decision: str, decided_by: str) -> bool:
    result = self.collection.update_one(
        {
            "cluster_id": cluster_id,            # NEW — ngăn nhầm cluster
            "short_id": short_id,
            "status": WorkItemStatus.AWAITING_APPROVAL.value,
        },
        {"$set": set_fields},
    )
    return result.modified_count > 0

def bulk_decide_batch(self, cluster_id: str, batch_id: str, decision: str, decided_by: str) -> int:
    result = self.collection.update_many(
        {
            "cluster_id": cluster_id,            # NEW
            "batch_id": batch_id,
            "status": WorkItemStatus.AWAITING_APPROVAL.value,
        },
        update,
    )
    return result.modified_count
```

**`batch_repo.py`:**
```python
def decide(self, cluster_id: str, batch_id: str, decision: str, decided_by: str) -> bool:
    result = self.collection.update_one(
        {
            "cluster_id": cluster_id,            # NEW
            "batch_id": batch_id,
            "status": BatchStatus.AWAITING_APPROVAL.value,
        },
        {"$set": {...}},
    )
    return result.modified_count > 0
```

---

## Task 10 — `seed/seed_maintenance.py`

```bash
# Seed window cho 1 cluster:
python -m maintenance.seed.seed_maintenance --cluster-id prod
python -m maintenance.seed.seed_maintenance --cluster-id uat

# Seed chỉ policy global (1 lần):
python -m maintenance.seed.seed_maintenance --policy-only

# Seed window cho tất cả enabled clusters (auto-discover từ db_clusters):
python -m maintenance.seed.seed_maintenance --all-clusters
```

Logic seed window: `upsert` với `window_id = cluster_id`, không overwrite nếu đã tồn tại.

---

## Task 11 — Layer 3 API

### `schemas/maintenance.schema.ts` — thêm `cluster_id` vào 3 schemas

```typescript
// Thêm vào maintenanceQueueSchema.querystring.properties:
cluster_id: { type: "string", minLength: 1, maxLength: 128 },

// Tương tự maintenanceHistorySchema
// maintenanceSummarySchema: thêm querystring với cluster_id
export const maintenanceSummarySchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
  },
} as const;
```

### `routes/maintenance.ts`

```typescript
interface SummaryQuery { cluster_id?: string; }
interface QueueQuery   { cluster_id?: string; status?: string; action_type?: string; limit?: number; page?: number; }
interface HistoryQuery { cluster_id?: string; outcome?: string; limit?: number; page?: number; }
```

### `services/maintenance-service.ts`

```typescript
// Trong mọi hàm query:
if (cluster_id) filter.cluster_id = cluster_id;

// getMaintenanceSummary(maintDb, cluster_id?):
//   window: findOne({ cluster_id }) — nếu không có cluster_id, trả null
//   queue_counts: aggregate với cluster_id filter
//   last_batch: findOne({ cluster_id })
```

### `types/index.ts`

Thêm `MaintenanceSummaryQuery` mới — cùng file, cùng pattern với Queue/History:

```typescript
export interface MaintenanceSummaryQuery {
  cluster_id?: string;    // NEW
}

export interface MaintenanceQueueQuery {
  cluster_id?: string;    // NEW
  status?: string;
  action_type?: string;
  limit?: number;
  page?: number;
}

export interface MaintenanceHistoryQuery {
  cluster_id?: string;    // NEW
  outcome?: string;
  limit?: number;
  page?: number;
}
```

### `query-keys.ts`

Sửa `maintenanceSummary` từ `()` → nhận `MaintenanceSummaryQuery`:

```typescript
import type {
  ...,
  MaintenanceSummaryQuery,     // NEW
  MaintenanceQueueQuery,
  MaintenanceHistoryQuery,
} from "@/types";

export const qk = {
  // ...các keys khác giữ nguyên...
  maintenanceSummary: (p: MaintenanceSummaryQuery)  => ["maintenance-summary", p]  as const,  // CHANGED
  maintenanceQueue:   (p: MaintenanceQueueQuery)    => ["maintenance-queue",   p]  as const,
  maintenanceHistory: (p: MaintenanceHistoryQuery)  => ["maintenance-history", p]  as const,
};
```

### `hooks/useMaintenance.ts`

3 hook cùng pattern: inject `selectedClusterId` từ store → merge vào params → pass vào cả `queryKey` và `queryFn`:

```typescript
import { useDashboardStore } from "@/store/dashboard.store";

export function useMaintenanceSummary() {
  const { selectedClusterId } = useDashboardStore();
  const params: MaintenanceSummaryQuery = selectedClusterId ? { cluster_id: selectedClusterId } : {};
  return useQuery({
    queryKey: qk.maintenanceSummary(params),   // params trong key → cache riêng mỗi cluster
    queryFn: () => apiGet<MaintenanceSummary>("/api/maintenance/summary", params),
    staleTime: 30_000, refetchInterval: 60_000, retry: 1,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}

export function useMaintenanceQueue(filters: MaintenanceQueueQuery) {
  const { selectedClusterId } = useDashboardStore();
  const params = { ...filters, ...(selectedClusterId ? { cluster_id: selectedClusterId } : {}) };
  return useQuery({
    queryKey: qk.maintenanceQueue(params),
    queryFn: () => apiGet<MaintenanceQueueResponse>("/api/maintenance/queue", params),
    staleTime: 30_000, refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useMaintenanceHistory(filters: MaintenanceHistoryQuery) {
  const { selectedClusterId } = useDashboardStore();
  const params = { ...filters, ...(selectedClusterId ? { cluster_id: selectedClusterId } : {}) };
  return useQuery({
    queryKey: qk.maintenanceHistory(params),
    queryFn: () => apiGet<MaintenanceHistoryResponse>("/api/maintenance/history", params),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
```

---

## Migration Data Hiện Tại

Nếu đã có data trong `db_maintenance` từ single-cluster cũ:

```javascript
// Backfill cluster_id vào documents không có field này
const PROD_CLUSTER_ID = "prod"; // đổi theo cluster_id thực tế

db.maintenance_queue.updateMany(
  { cluster_id: { $exists: false } },
  { $set: { cluster_id: PROD_CLUSTER_ID } }
);
db.maintenance_batches.updateMany(
  { cluster_id: { $exists: false } },
  { $set: { cluster_id: PROD_CLUSTER_ID } }
);
db.maintenance_history.updateMany(
  { cluster_id: { $exists: false } },
  { $set: { cluster_id: PROD_CLUSTER_ID } }
);

// Đổi window "default" thành window của cluster prod
db.maintenance_window.updateOne(
  { window_id: "default" },
  { $set: { window_id: PROD_CLUSTER_ID, cluster_id: PROD_CLUSTER_ID } }
);
```

---

## First-Run Checklist (sau khi deploy)

```bash
# 1. Seed global policy (1 lần)
docker compose run --rm maintenance \
  python -m maintenance.seed.seed_maintenance --policy-only

# 2. Seed window per cluster
docker compose run --rm maintenance \
  python -m maintenance.seed.seed_maintenance --cluster-id prod

docker compose run --rm maintenance \
  python -m maintenance.seed.seed_maintenance --cluster-id uat

# 3. Start
docker compose up -d maintenance

# 4. Verify — expect logs per cluster:
# "Registered maintenance jobs for cluster=prod"
# "Registered maintenance jobs for cluster=uat"
```

---

## Verification

1. Logs startup: `"Registered maintenance jobs for cluster=prod"` + `"cluster=uat"`
2. Tại giờ scan: 2 Telegram messages riêng với prefix `[prod]` / `[uat]`
3. DBA approve prod → chỉ items của prod chuyển APPROVED, uat không bị ảnh hưởng
4. Tắt UAT window (`enabled: false`) → UAT tick trả về ngay, không chạy
5. Layer 3: chọn cluster prod → `MaintenancePage` chỉ hiển thị data của prod
6. Layer 3: chọn cluster uat → hiển thị data của uat
