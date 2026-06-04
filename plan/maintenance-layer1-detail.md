# Plan chi tiết — Layer 1: Maintenance Runner (`layer1/maintenance/`)

> Plan tổng quan: [index-statistics-maintenance.md](./index-statistics-maintenance.md)
> Phạm vi file này: toàn bộ phần core chạy trong process riêng `python -m layer1.maintenance.runner` + các sửa đổi nhỏ vào process monitoring hiện tại.

---

## 1. Entry point — `layer1/maintenance/runner.py`

Mirror `Layer1Service` trong `layer1/scheduler.py`:

```python
class MaintenanceService:
    def __init__(self) -> None:
        self._scheduler: BlockingScheduler | None = None
        self._stop_requested = False
        self._current_item: WorkItem | None = None   # item đang execute (cho SIGTERM PAUSE)

    def start(self) -> None:
        self._setup_infrastructure()   # thứ tự như Layer1Service
        self._setup_scheduler()
        self._scheduler.start()        # blocking

    def stop(self) -> None: ...        # SIGTERM handler — xem mục 9
```

**`_setup_infrastructure()` thứ tự:**
1. `MongoConnection.initialize(settings)` → `create_all_indexes(db)` (đã gồm maintenance collections sau khi sửa `indexes.py`)
2. `NodeRoleCache().initialize()` — fail fast nếu mọi node unreachable
3. Repos: `PolicyRepo`, `QueueRepo`, `WindowRepo`, `HistoryRepo`, `BatchRepo`, `JobExecutionRepo`
4. Services: `PolicyResolver`, `WindowService`, `GateService`, `DurationEstimator`, `ScanService`, `ExecuteService`
5. `MaintenanceNotifier` (nếu `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — **send-only**, KHÔNG poll)
6. `JobRunner(JobExecutionRepo())` + `HealthChecker`
7. Fail fast nếu `maintenance_window` / default policy chưa seed → log hướng dẫn chạy `python -m layer1.maintenance.seed.seed_maintenance`

**APScheduler jobs** (đều `job_runner.wrap(name)`, `max_instances=1`, `coalesce=True`):

| Job name | Trigger | Hành động |
|---|---|---|
| `maint_scan` | cron `MAINT_SCAN_CRON` (default `0 20 * * *`) | `scan_service.run()` → trả số item enqueued |
| `maint_window_tick` | interval `MAINT_TICK_SEC` (default 60s) | `execute_service.tick()` → 0 hoặc 1 item |
| `maint_summary` | cron `MAINT_SUMMARY_CRON` (default sau window end, vd `30 5 * * *`) | tổng kết đêm từ `maintenance_history` → Telegram |
| `node_role_refresh` | interval `NODE_ROLE_REFRESH_SEC` | `role_cache.refresh()` |
| `health_check` | interval 120s | `health_checker.run_check()` |

---

## 2. Config — `layer1/maintenance/config.py`

Reuse `layer1.config.settings` cho MSSQL/MongoDB/Telegram. Chỉ thêm:

```env
MAINT_SCAN_CRON=0 20 * * *          # giờ scan + gửi approval (VN time, check trong job)
MAINT_TICK_SEC=60
MAINT_SUMMARY_CRON=30 5 * * *
MAINT_DRY_RUN=true                  # default TRUE — chỉ log statement, không execute
MAINT_MAX_ATTEMPTS=3                # số lần gate-fail/error trước khi skipped/failed
MAINT_ESTIMATE_PAGES_PER_MINUTE=150000   # heuristic ước lượng duration rebuild
MAINT_BATCH_TOP_N_ITEMS=10          # số item gửi nút approve riêng trên Telegram
```

Pydantic-settings class `MaintEnvSettings`, fail-fast validate cron expression.

---

## 3. Connection — `layer1/maintenance/connection.py`

```python
@contextmanager
def maint_connection(host: str) -> Generator[pyodbc.Connection, None, None]:
    # KHÔNG dùng mssql_connection(): nó set conn.timeout=30s sẽ abort ALTER INDEX dài.
    # autocommit=True: mỗi ALTER/UPDATE STATISTICS là transaction riêng — tránh 1 transaction khổng lồ giữ log.
    conn = pyodbc.connect(settings.get_connection_string(host), timeout=15, autocommit=True)
    conn.timeout = 0   # statement không giới hạn — budget kiểm soát bằng MAX_DURATION + admission control
    try:
        yield conn
    finally:
        conn.close()
```

Scan/gate SELECT vẫn dùng `mssql_connection()`/`QueryExecutor` có timeout bình thường.

---

## 4. Models — `layer1/maintenance/models/`

### `policy.py`
```python
class PolicyScope(str, Enum): DEFAULT = "default"; TABLE = "table"; INDEX = "index"

class MaintenancePolicy(BaseModel):
    policy_id: str                          # "default" | "table:dbo.Bill" | "index:dbo.Bill.IX_Bill_Date"
    scope: PolicyScope
    schema_name: str | None = None
    table_name: str | None = None
    index_name: str | None = None
    enabled: bool = True                    # False = exclude khỏi maintenance
    reorganize_threshold_pct: float = 10.0
    rebuild_threshold_pct: float = 30.0
    min_page_count: int = 1000
    max_page_count: int | None = None       # None = không giới hạn; set cho bảng quá lớn cần xử lý tay
    maxdop: int = 4
    online: bool = True
    resumable: bool = True
    offline_fallback: bool = False          # cho phép retry ONLINE=OFF khi gặp LOB restriction
    stats_modification_threshold: int = 20000
    stats_fullscan: bool = False
    stats_sample_pct: int | None = None     # None = WITH RESAMPLE default của server
    heap_forwarded_records_threshold: int = 1000
    window_override: dict | None = None     # {start, end} riêng cho object đặc thù
    priority_boost: int = 0
    updated_at: datetime = Field(default_factory=now_vn)
```
`merge()`: default ← table ← index, field-level (chỉ override field khác None / được set explicit — dùng `model_fields_set`).

### `work_item.py`
```python
class ItemKind(str, Enum): INDEX_FRAG = "index_frag"; STATS_STALE = "stats_stale"; HEAP_FORWARDED = "heap_forwarded"
class ActionType(str, Enum): REORGANIZE = "reorganize"; REBUILD = "rebuild"; REBUILD_PARTITION = "rebuild_partition"; UPDATE_STATISTICS = "update_statistics"; HEAP_REBUILD = "heap_rebuild"
class WorkItemStatus(str, Enum): PENDING; AWAITING_APPROVAL; APPROVED; REJECTED; RUNNING; PAUSED; DONE; FAILED; SKIPPED; EXPIRED

class WorkItemMetrics(BaseModel):
    fragmentation_pct: float | None = None
    page_count: int | None = None
    record_count: int | None = None
    forwarded_record_count: int | None = None
    modification_counter: int | None = None
    rows: int | None = None
    rows_sampled: int | None = None
    last_updated: datetime | None = None

class WorkItem(BaseModel):
    item_id: str = Field(default_factory=lambda: str(uuid4()))
    short_id: str = ""                      # validator: item_id[:8]
    batch_id: str
    kind: ItemKind
    action_type: ActionType
    database_name: str
    schema_name: str
    table_name: str
    index_name: str | None = None           # None với stats/heap
    stats_name: str | None = None
    partition_number: int | None = None     # None = toàn index; set = partition-level
    object_id: int
    index_id: int | None = None
    metrics: WorkItemMetrics
    estimated_minutes: float
    priority: int
    status: WorkItemStatus = WorkItemStatus.AWAITING_APPROVAL
    approval: dict | None = None             # {decided_by, decided_at, decision}
    attempts: int = 0
    last_error: str | None = None
    resume_token: bool = False               # True = rebuild resumable đang PAUSED trên server
    created_at: datetime = Field(default_factory=now_vn)
    updated_at: datetime = Field(default_factory=now_vn)
    terminal_at: datetime | None = None      # CHỈ set khi terminal — TTL anchor
```

### `window.py`
```python
class WindowSlot(BaseModel):
    start: str          # "01:00" — VN local time
    end: str            # "04:00"; hỗ trợ qua đêm: start="23:00", end="04:00"
    time_budget_minutes: int = 180

class MaintenanceWindow(BaseModel):
    window_id: str = "default"
    enabled: bool = True
    default: WindowSlot
    day_overrides: dict[str, WindowSlot] = {}   # "0"=Mon .. "6"=Sun (khớp baseline day_of_week)
    kill_switch: bool = False

class WindowState(BaseModel):
    open: bool
    remaining_minutes: float
    reason: str         # "open" | "outside_window" | "kill_switch" | "disabled" | "budget_exhausted"
```

### `history.py`
```python
class MaintenanceOutcome(str, Enum): DONE; FAILED; SKIPPED; PAUSED; ABORTED; DRY_RUN

class MaintenanceHistory(BaseModel):
    history_id: str = Field(default_factory=lambda: str(uuid4()))
    item_id: str; batch_id: str; node: str
    database_name: str; schema_name: str; table_name: str
    index_name: str | None; stats_name: str | None; partition_number: int | None
    action_type: ActionType
    statement: str                  # T-SQL chính xác đã chạy (audit + AI context)
    outcome: MaintenanceOutcome
    frag_before_pct: float | None; frag_after_pct: float | None
    duration_ms: float | None
    skip_reason: str | None; error: str | None
    started_at: datetime | None; finished_at: datetime | None
    created_at: datetime = Field(default_factory=now_vn)
```

### `approval.py` — `MaintenanceBatch`, `BatchSummary`, `ApprovalDecision` (xem mục 7).

---

## 5. Repositories — `layer1/maintenance/repositories/`

Pattern giống `layer1/storage/repositories/*`: property `collection` → `MongoConnection.get_db()[NAME]`.

### `queue_repo.py` — quan trọng nhất
```python
def insert_many(items: list[WorkItem]) -> int
def find_open_keys() -> set[tuple]            # dedupe: (schema, table, index, partition, kind) các item chưa terminal
def claim_next_approved() -> WorkItem | None
    # findOneAndUpdate({status:"approved"}, {$set:{status:"running", updated_at}},
    #                  sort=[("priority",-1),("created_at",1)]) — ATOMIC
def claim_paused_resumable() -> WorkItem | None   # ưu tiên resume trước khi lấy item mới
def release(item_id, status, *, attempts=None, last_error=None) -> None   # trả về approved/paused
def finalize(item_id, status: WorkItemStatus) -> None    # set terminal_at=now_vn() → TTL bắt đầu đếm
def bulk_decide_batch(batch_id, decision: str, decided_by: str) -> int
    # update_many({batch_id, status:"awaiting_approval"} → approved|rejected)
def decide_item(short_id, decision, decided_by) -> bool
def expire_stale_awaiting(older_than: datetime) -> int   # gọi trong maint_scan trước khi tạo batch mới
```

### Khác
- `policy_repo.py`: `find_default()`, `find_for_object(schema, table, index)`, `upsert(policy)`
- `window_repo.py`: `get() -> MaintenanceWindow`, `set_kill_switch(bool)`
- `history_repo.py`: `insert(h)`, `find_nightly(since, until)`, `find_recent_by_table(table, limit)`
- `batch_repo.py`: `insert`, `set_message_id`, `decide`, `find_awaiting()`

---

## 6. Scan — `layer1/maintenance/scan/`

### `scan_queries.py` — SQL constants (format `{placeholders}` bằng Python, giá trị từ default policy, là số nguyên — không có injection path)

**Q1 — Fragmentation (per-partition):**
```sql
SELECT DB_NAME() AS database_name, s.name AS schema_name,
  o.name AS table_name, i.name AS index_name,
  ips.object_id, ips.index_id, ips.partition_number, ips.index_type_desc,
  CAST(ips.avg_fragmentation_in_percent AS DECIMAL(5,2)) AS fragmentation_pct,
  ips.page_count, ips.record_count, ips.forwarded_record_count,
  CASE WHEN EXISTS (SELECT 1 FROM sys.partitions p
       WHERE p.object_id = ips.object_id AND p.index_id = ips.index_id AND p.partition_number > 1)
       THEN 1 ELSE 0 END AS is_partitioned
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'SAMPLED') ips
JOIN sys.indexes i  ON ips.object_id = i.object_id AND ips.index_id = i.index_id
JOIN sys.objects o  ON ips.object_id = o.object_id
JOIN sys.schemas s  ON o.schema_id = s.schema_id
WHERE ips.page_count > {min_page_count}
  AND ips.avg_fragmentation_in_percent >= {min_frag_pct}
  AND ips.index_type_desc IN ('CLUSTERED INDEX', 'NONCLUSTERED INDEX')
  AND o.is_ms_shipped = 0
ORDER BY ips.avg_fragmentation_in_percent DESC;
```
timeout_sec=300 (SAMPLED scan toàn DB chậm — đây là lý do dùng QueryExecutor với timeout riêng, KHÔNG phải maint_connection).

**Q2 — Statistics staleness:**
```sql
SELECT DB_NAME() AS database_name, sch.name AS schema_name, o.name AS table_name,
  st.name AS stats_name, st.object_id, st.stats_id,
  sp.last_updated, sp.rows, sp.rows_sampled, sp.modification_counter,
  DATEDIFF(HOUR, sp.last_updated, GETUTCDATE()) AS hours_since_update
FROM sys.stats st
JOIN sys.objects o  ON st.object_id = o.object_id
JOIN sys.schemas sch ON o.schema_id = sch.schema_id
CROSS APPLY sys.dm_db_stats_properties(st.object_id, st.stats_id) sp
WHERE o.is_ms_shipped = 0 AND o.type = 'U'
  AND sp.modification_counter >= {mod_threshold}
ORDER BY sp.modification_counter DESC;
```

**Q3 — Heap forwarded records:** như Q1 nhưng `dm_db_index_physical_stats(DB_ID(), NULL, 0, ...)`, `index_id = 0`, lọc `forwarded_record_count >= {fwd_threshold}`.

### `scan_service.py` — flow `run() -> int`

```
1. primary = role_cache.resolve(["primary"])[0]      # scan CHỈ trên primary
2. expire_stale_awaiting(batch cũ chưa quyết)         # batch đêm trước hết hiệu lực
3. Chạy Q1, Q2, Q3 qua QueryExecutor (wide net từ default policy)
4. Map rows → WorkItem dự kiến:
   - frag: policy = resolver.resolve(row); nếu !enabled hoặc page_count ngoài [min,max] → bỏ
     frag >= rebuild_threshold → REBUILD (PARTITION nếu is_partitioned & partition_number cụ thể)
     frag >= reorganize_threshold → REORGANIZE [PARTITION]
   - stats: modification_counter >= policy threshold → UPDATE_STATISTICS
   - heap: forwarded >= threshold → HEAP_REBUILD
5. Dedupe: bỏ item trùng key với find_open_keys() (đang pending/approved/paused/running)
6. estimated_minutes = duration_estimator.estimate(item)   # page_count / PAGES_PER_MINUTE, reorganize × hệ số frag
7. priority = base_by_kind(rebuild=30, reorganize=20, stats=10, heap=25)
            + min(frag_pct, 50) + log10(page_count) + policy.priority_boost
8. queue_repo.insert_many(items); batch_repo.insert(batch)
9. maintenance_notifier.send_batch_approval(batch, items)
10. return len(items)
```

---

## 7. Telegram approval

### Gửi (maintenance runner — `notify/maintenance_notifier.py`, copy pattern `_post`/`_post_document` từ `telegram_notifier.py`, urllib.request, HTML mode)

Message batch:
```
🔧 <b>Maintenance Batch</b> 2026-06-04 20:00
📊 42 items — ước tính 185 phút
   • REBUILD: 8 (3 partition-level)  • REORGANIZE: 19
   • UPDATE STATS: 13                • HEAP REBUILD: 2
🪟 Window đêm nay: 01:00–04:00 (budget 180p)
⚠️ 5 item ước tính vượt budget — sẽ chạy các đêm sau

Top items: (10 message riêng kèm nút ✅/⛔ từng item)
📎 full-list.txt (toàn bộ 42 items: short_id | object | action | frag% | pages | est)
```
Inline keyboard message chính:
```
[ ✅ Approve ALL → l1|mntb|<batch_id>|all ]  [ ⛔ Reject ALL → l1|mntb|<batch_id>|reject ]
```
Per-item (top-N): `[✅ → l1|mnti|<short_id>|ok]  [⛔ → l1|mnti|<short_id>|no]`

### Nhận (process monitoring — sửa `layer1/notifications/telegram_bot.py`)

- Ctor thêm param `maintenance_approval: MaintenanceApprovalAdapter | None = None`
- Trong `_handle_callback_query` (telegram_bot.py:145, sau khi tách `action = parts[1]`), thêm TRƯỚC validate finding_id:

```python
if action in ("mntb", "mnti"):
    if self._maintenance_approval is None:
        self._send(chat_id, "⚠️ Maintenance module chưa được bật.")
        return
    result = self._maintenance_approval.handle(action, parts, sender)  # pure Mongo write
    self._send(chat_id, result.message)   # "✅ Đã approve 42 items (batch a1b2c3)..."
    return
```

`MaintenanceApprovalAdapter.handle()`: `mntb|<batch_id>|all` → `bulk_decide_batch`; `mnti|<short_id>|ok` → `decide_item`. Ghi `decided_by=sender`. **Không import gì từ executor/MSSQL** — chỉ Mongo, để process monitoring không gánh thêm dependency.

- `layer1/scheduler.py` (`_setup_infrastructure`): tạo adapter (guarded try/except — thiếu collection vẫn chạy monitor bình thường) và pass vào `TelegramBot(...)`.

---

## 8. Execute — `layer1/maintenance/execute/`

### `statement_builder.py` — pure functions, KHÔNG side effect

```python
def _q(ident: str) -> str:                  # escape ] → ]] rồi bọc [..]
def build(item: WorkItem, policy: MaintenancePolicy, remaining_minutes: int) -> str
```

| action_type | Template |
|---|---|
| REORGANIZE | `ALTER INDEX [ix] ON [s].[t] REORGANIZE` (+ ` PARTITION = n`) — **không** MAXDOP/ONLINE/RESUMABLE |
| REBUILD | `ALTER INDEX [ix] ON [s].[t] REBUILD WITH (ONLINE = ON, MAXDOP = {maxdop}, RESUMABLE = ON, MAX_DURATION = {remaining} MINUTES)` |
| REBUILD_PARTITION | như trên + `PARTITION = {n}` trước WITH |
| UPDATE_STATISTICS | `UPDATE STATISTICS [s].[t] ([stats]) WITH FULLSCAN` hoặc `WITH SAMPLE {p} PERCENT` |
| HEAP_REBUILD | `ALTER TABLE [s].[t] REBUILD [PARTITION = n] WITH (ONLINE = ON, MAXDOP = {maxdop})` |
| control | `ALTER INDEX [ix] ON [s].[t] PAUSE / RESUME WITH (MAXDOP={n}) / ABORT` |

Policy `online=False` hoặc `resumable=False` → bỏ option tương ứng (RESUMABLE yêu cầu ONLINE=ON → resumable chỉ khi cả 2 true).

### `safety/gate_service.py` — `check(primary, policy) -> GateResult`

| Gate | Query | Ngưỡng default (override được trong window doc) |
|---|---|---|
| CPU | `RING_BUFFER_SCHEDULER_MONITOR` → ProcessUtilization | `>= 60%` → fail |
| Active load | `dm_exec_requests` count (loại trừ @@SPID) | `>= 50` running/runnable → fail |
| AG health | `dm_hadr_database_replica_states` (is_local=0) | bất kỳ secondary: `log_send_queue_size > 100000 KB` hoặc `redo_queue_size > 200000 KB` hoặc state != SYNCHRONIZED → fail |

Mỗi gate query timeout 10s qua `mssql_connection`; query fail = gate fail (an toàn trước).

### `execute_service.py` — `tick() -> int` (pseudocode đầy đủ trong plan tổng quan)

Điểm chốt:
- 1 item / tick. Claim atomic. `paused` resumable claim trước (RESUME).
- Admission control: `estimated_minutes > window.remaining` → release về approved + history(skip, insufficient_budget).
- Gate fail → `attempts++`, release; `attempts >= MAINT_MAX_ATTEMPTS` → finalize(skipped).
- Đo `frag_before` / `frag_after` bằng single-object DMV: `dm_db_index_physical_stats(DB_ID(), @object_id, @index_id, @partition_number, 'SAMPLED')` (chỉ cho frag actions).
- `MAINT_DRY_RUN=true` → log statement, history(DRY_RUN), finalize(done).
- pyodbc error: detect msg RESUMABLE/ONLINE restriction → nếu `policy.offline_fallback` → retry 1 lần bỏ ONLINE/RESUMABLE; ngược lại theo attempts → failed/release.
- Set `self._service._current_item` trước execute, clear sau (cho SIGTERM).

---

## 9. Graceful shutdown (SIGTERM/SIGINT)

```
stop() :
  _stop_requested = True
  nếu _current_item là REBUILD resumable đang chạy:
      mở maint_connection MỚI → ALTER INDEX ... PAUSE
      queue_repo.release(item, PAUSED, resume_token=True); history(PAUSED)
  nếu _current_item là REORGANIZE/UPDATE STATS: để pyodbc call bị kill theo process
      (REORGANIZE an toàn; UPDATE STATS rollback nhanh) — item release về approved khi startup sau
      (startup: reset mọi item status=running → approved, vì process chết giữa chừng)
  scheduler.shutdown(wait=False); MongoConnection.close(); logging.shutdown()
```

→ `docker compose stop maintenance` (default 10s grace) đủ để PAUSE.
Startup recovery: `queue_repo.update_many({status:"running"} → approved)` — process crash không làm mất item.

---

## 10. Seed — `layer1/maintenance/seed/seed_maintenance.py`

Pattern `seed_topics.py`: `--dry-run`, idempotent upsert.
- 1 default policy (giá trị mục 4)
- 1 window doc: `default={start:"01:00", end:"04:00", time_budget_minutes:170}`, `kill_switch=false`
- Ví dụ override comment sẵn (bảng partition lớn: `max_page_count`, `priority_boost`)

Entry: `python -m layer1.maintenance.seed.seed_maintenance`

---

## 11. Sửa file hiện có

| File | Thay đổi |
|---|---|
| `layer1/storage/indexes.py` | + `TTL_MAINT_QUEUE_TERMINAL_SEC=14d`, `TTL_MAINT_BATCH_SEC=14d`, `TTL_MAINT_HISTORY_SEC=90d`; + 5 helper `_create_maintenance_*_indexes(db)` gọi từ `create_all_indexes()` |
| `layer1/notifications/telegram_bot.py` | + ctor param + branch `mntb`/`mnti` (~25 dòng) |
| `layer1/scheduler.py` | + build `MaintenanceApprovalAdapter` (guarded) pass vào TelegramBot |
| `docker-compose.yml` | + service `maintenance` (cùng image, command runner, env_file, depends_on mongodb) |
| `Dockerfile` | KHÔNG đổi (COPY layer1/ đã bao gồm maintenance/) |
| `.env.example`, `CLAUDE.md`, `layer1/CLAUDE.md` | + docs env vars + module |

---

## 12. Tests

```
layer1/tests/maintenance/
├── test_statement_builder.py   ← table-driven mọi action; escape "Bill]; DROP--"; REORGANIZE không
│                                  nhận options; RESUMABLE đòi ONLINE; partition forms
├── test_policy_resolver.py     ← precedence default<table<index; field-level merge
├── test_window_service.py      ← inject now; qua-đêm 23:00→04:00; day override; budget; kill_switch
├── test_duration_estimator.py  ← monotonic theo page_count
├── test_scan_service.py        ← FakeQueryExecutor canned rows → items đúng action/dedupe/priority
├── test_execute_service.py     ← FakeSqlExecutor: window-closed noop / gate-fail release /
│                                  budget-skip / DRY_RUN done / error→attempts→failed
└── test_approval_adapter.py    ← mongomock: mntb all → bulk approved; mnti ok/no
```

MSSQL inject qua interface (constructor injection như TopicRunner) → unit test không cần DB thật.

## 13. Definition of Done (Layer 1)

- [ ] `docker compose up maintenance` chạy DRY_RUN trên dev SQL Server (Developer edition), scan ra batch, gửi Telegram, approve-all hoạt động, tick log statement đúng trong window
- [ ] `docker compose stop maintenance` khi đang DRY_RUN không ảnh hưởng container layer1
- [ ] Tất cả tests pass; monitoring process không thay đổi hành vi khi chưa seed maintenance collections
