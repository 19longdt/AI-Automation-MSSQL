# CLAUDE.md — layer1/maintenance

## Mục đích

Process riêng biệt (KHÔNG chung với monitoring) — tự động bảo trì index/statistics MSSQL Server 2019 Enterprise Always On:

- Scan fragmentation, stale statistics, heap forwarded records mỗi đêm
- Gửi batch lên Telegram để DBA duyệt trước khi thực thi
- Thực thi REBUILD/REORGANIZE/UPDATE STATISTICS trong window đêm có kiểm soát an toàn
- Ghi audit log đầy đủ vào `maintenance_history`

---

## Entry Point & Scheduler

**Entry:** `python -m layer1.maintenance.runner`

3 APScheduler jobs:

| Job | Trigger | Mặc định | Làm gì |
|---|---|---|---|
| `maint_scan` | cron | 20:00 VN | Scan DMV → tạo work items → gửi batch approval Telegram |
| `maint_window_tick` | interval 60s | liên tục | Thực thi tối đa 1 item/tick nếu window đang mở |
| `maint_summary` | cron | 05:30 VN | Gửi báo cáo đêm qua: budget dùng, top 3 chậm nhất |

---

## Cấu trúc thư mục

```
layer1/maintenance/
├── runner.py                  ← Entry, APScheduler, khởi tạo infrastructure + SIGTERM handler
├── config.py                  ← MAINT_* env vars: cron, tick, DRY_RUN, max attempts, maint_mongodb_db
├── mongo.py                   ← get_maint_db(): trả về Database của db_maintenance (reuse MongoClient L1)
├── indexes.py                 ← create_maint_indexes(db): tạo index cho tất cả maintenance collections
├── connection.py              ← maint_connection: autocommit=True, KHÔNG statement timeout
├── models/
│   ├── policy.py              ← MaintenancePolicy (3-level merge), ActionType enum
│   ├── work_item.py           ← WorkItem + WorkItemStatus lifecycle (queue)
│   ├── window.py              ← MaintenanceWindow (open/close, budget, kill_switch, gates)
│   ├── history.py             ← MaintenanceHistory (audit log)
│   ├── batch.py               ← MaintenanceBatch (approval state, Telegram message_id)
│   └── scan_query.py          ← ScanQueryConfig (query_id, sql, timeout_sec, enabled)
├── scan/
│   ├── scan_service.py        ← ScanService: load queries từ MongoDB → query PRIMARY → WorkItems → batch
│   └── scan_queries.py        ← SQL constants — chỉ dùng bởi seed, KHÔNG dùng runtime
├── policy/
│   └── policy_resolver.py     ← PolicyResolver: merge default ← table ← index (field-level)
├── window/
│   └── window_service.py      ← WindowService: trạng thái mở/đóng + budget còn lại
├── safety/
│   └── gate_service.py        ← GateService: CPU%, active requests, AG send/redo queue
├── execute/
│   ├── execute_service.py     ← ExecuteService: tick loop, claim, T-SQL exec, PAUSE/RESUME
│   ├── statement_builder.py   ← Sinh T-SQL thuần (ALTER INDEX, UPDATE STATISTICS, HEAP)
│   └── duration_estimator.py  ← Ước tính phút + tính priority score
├── notify/
│   ├── maintenance_notifier.py ← Gửi Telegram (SEND-ONLY, batch approval UI, nightly summary)
│   └── approval_adapter.py    ← Xử lý callback approval (chạy trong process monitoring)
├── repositories/
│   ├── queue_repo.py          ← maintenance_queue
│   ├── batch_repo.py          ← maintenance_batches
│   ├── policy_repo.py         ← maintenance_policies
│   ├── window_repo.py         ← maintenance_window
│   ├── history_repo.py        ← maintenance_history
│   └── scan_query_repo.py     ← maintenance_scan_queries (load/upsert SQL scan)
└── seed/
    └── seed_maintenance.py    ← Seed policy + window + 3 scan queries (chạy 1 lần khi setup)
```

---

## Luồng chính

### 1. Scan (mỗi tối)

```
ScanService.run()
  ├── Reload policy (PolicyResolver)
  ├── Load scan queries từ MongoDB (ScanQueryRepo.find_all_enabled())
  │   → 3 ScanQueryConfig: scan_fragmentation / scan_stats_staleness / scan_heap_forwarded
  │   → SQL có thể chứa placeholders {min_page_count}, {min_frag_pct},
  │     {mod_threshold}, {fwd_threshold} — format với giá trị default policy
  ├── Resolve PRIMARY node (NodeRoleCache)
  ├── Expire batch/item cũ chưa duyệt (> maint_approval_expire_hours)
  ├── Query PRIMARY (timeout_sec per query, read-only):
  │   ├── scan_fragmentation  → avg_fragmentation_in_percent per partition
  │   ├── scan_stats_staleness → modification_counter
  │   └── scan_heap_forwarded  → forwarded_record_count
  ├── Map rows → WorkItem per partition (apply policy: enabled?, min/max_page_count, thresholds)
  ├── Dedupe vs open queue (tránh insert trùng object đang chờ)
  └── Create MaintenanceBatch → queue_repo.insert_many() → gửi Telegram approval
```

**Policy thresholds mặc định:**
- `reorganize_threshold_pct`: 10% → REORGANIZE
- `rebuild_threshold_pct`: 30% → REBUILD
- `stats_modification_threshold`: 20,000 rows → UPDATE STATISTICS
- `heap_forwarded_records_threshold`: 1,000 records → REBUILD HEAP

### 2. Approval (DBA duyệt qua Telegram)

Monitoring process nhận callback → `MaintenanceApprovalAdapter` → cập nhật MongoDB:

| Callback | Hành động |
|---|---|
| `l1\|mntb\|<batch_id>\|all` | Approve toàn batch |
| `l1\|mntb\|<batch_id>\|reject` | Reject toàn batch |
| `l1\|mnti\|<short_id>\|ok` | Approve item đơn lẻ |
| `l1\|mnti\|<short_id>\|no` | Reject item đơn lẻ |

### 3. Execute Tick (mỗi 60 giây)

```
ExecuteService.tick()
  ├── 1. Kiểm tra window mở không? budget còn không? kill_switch?
  ├── 2. Safety gates: CPU%, active_requests, AG queue sizes
  ├── 3. Claim item ưu tiên: PAUSED-resumable trước → APPROVED theo priority
  ├── 4. Admission control: est_minutes > budget còn → DEFERRED
  ├── 5. Build T-SQL (statement_builder.py)
  ├── 6. Execute trên PRIMARY (autocommit, no timeout)
  ├── 7. Đo fragmentation before/after (post-verify)
  └── 8. Ghi maintenance_history
```

---

## Work Item Lifecycle

```
AWAITING_APPROVAL ──→ APPROVED ──→ RUNNING ──→ DONE
        │                                  │
        ├──→ REJECTED (terminal)           ├──→ FAILED (max attempts → terminal)
        └──→ EXPIRED (30h, terminal)       └──→ PAUSED ──→ (APPROVED lại → tick kế tiếp)
                                           │
                                           └──→ SKIPPED (policy off / budget không đủ)
```

PAUSED xảy ra khi:
- MAX_DURATION hết (resumable rebuild server tự pause)
- SIGTERM — handler pause resumable rebuild trước khi shutdown

---

## T-SQL Statements sinh ra

| Loại | Statement |
|---|---|
| REBUILD (online resumable) | `ALTER INDEX [idx] ON [tbl] REBUILD PARTITION=N WITH (ONLINE=ON, RESUMABLE=ON, MAX_DURATION=N)` |
| REBUILD (online) | `ALTER INDEX [idx] ON [tbl] REBUILD PARTITION=N WITH (ONLINE=ON, MAXDOP=N)` |
| REBUILD (offline fallback) | `ALTER INDEX [idx] ON [tbl] REBUILD PARTITION=N WITH (ONLINE=OFF, MAXDOP=N)` |
| REORGANIZE | `ALTER INDEX [idx] ON [tbl] REORGANIZE PARTITION=N` |
| UPDATE STATISTICS (fullscan) | `UPDATE STATISTICS [tbl] [stat] WITH FULLSCAN` |
| UPDATE STATISTICS (sample) | `UPDATE STATISTICS [tbl] [stat] WITH SAMPLE N PERCENT` |
| REBUILD HEAP | `ALTER TABLE [tbl] REBUILD PARTITION=N` |
| RESUME | `ALTER INDEX [idx] ON [tbl] RESUME` |
| PAUSE | `ALTER INDEX [idx] ON [tbl] PAUSE` |
| ABORT | `ALTER INDEX [idx] ON [tbl] ABORT` |

Tất cả identifier được bracket và escape (`]` → `]]`).

---

## Policy — 3-level Merge

MongoDB collection `maintenance_policies`, scope: `default` / `table` / `index`.

Merge theo **field-level** (dùng Pydantic `model_fields_set`):
- Scope `default` là base
- Scope `table` override chỉ field nào được set tường minh
- Scope `index` override tương tự — không override = kế thừa cấp dưới

Các field policy đáng chú ý:

```python
enabled: bool                    # bật/tắt index này
min_page_count: int              # bỏ qua index nhỏ (mặc định 1000)
max_page_count: int | None       # bỏ qua index cực lớn
reorganize_threshold_pct: float  # 10%
rebuild_threshold_pct: float     # 30%
online: bool                     # ONLINE=ON mặc định
resumable: bool                  # RESUMABLE=ON mặc định
offline_fallback: bool           # thử OFFLINE nếu ONLINE fail
maxdop: int                      # 0 = dùng server default
priority_boost: int              # điểm cộng thêm vào priority score
```

---

## Safety Gates

Được kiểm tra **trước mỗi item** trong tick:

| Gate | Nguồn dữ liệu | Điều kiện fail |
|---|---|---|
| CPU | `sys.dm_os_ring_buffers` | avg CPU > ngưỡng (mặc định 70%) |
| Active requests | `sys.dm_exec_requests` | count > ngưỡng (mặc định 50) |
| AG log_send_queue | `sys.dm_hadr_database_replica_states` | > ngưỡng KB |
| AG redo_queue | `sys.dm_hadr_database_replica_states` | > ngưỡng KB |

Bất kỳ gate nào fail → tick bỏ qua, item được trả về queue.

---

## Window Service

- Đọc từ MongoDB `maintenance_window` mỗi tick (DBA có thể sửa live)
- Hỗ trợ qua đêm: start > end → wrap midnight
- Day overrides: override per weekday
- `kill_switch: true` → dừng ngay sau item hiện tại
- Budget còn lại = `budget_minutes - Σ actual_duration` các item DONE/PAUSED trong window hôm nay

---

## Duration Estimator

Heuristic đơn giản (không ML):

```
REBUILD: pages / PAGES_PER_MIN_REBUILD    (mặc định 1000 pages/min)
REORGANIZE: pages / PAGES_PER_MIN_REORG   (mặc định 2000 pages/min)
UPDATE STATS: rows / ROWS_PER_MIN_STATS   (mặc định 500,000 rows/min)
HEAP: pages / PAGES_PER_MIN_REBUILD
```

Priority score = base_action_score + fragmentation% + log10(page_count) + priority_boost

---

## MongoDB — Database riêng (`db_maintenance`)

Tất cả collections maintenance nằm trong database **`MAINT_MONGODB_DB`** (default: `db_maintenance`), tách hoàn toàn khỏi `db_monitor` của Layer 1. Reuse cùng `MongoClient` (connection pool chung), truy cập qua `get_maint_db()` trong `mongo.py`.

| Collection | Mô tả | TTL |
|---|---|---|
| `maintenance_scan_queries` | SQL scan templates (config-driven, DBA có thể sửa trực tiếp) | — |
| `maintenance_policies` | Policy config (default/table/index scope) | — |
| `maintenance_window` | Single document: window + kill_switch + gate thresholds | — |
| `maintenance_queue` | Work items + status (lifecycle queue) | 14 ngày (terminal_at) |
| `maintenance_batches` | Batch + approval state + Telegram message_id | 14 ngày (created_at) |
| `maintenance_history` | Audit log đầy đủ (statement, duration, frag before/after) | 90 ngày |

Indexes được tạo bởi `create_maint_indexes(db)` trong `indexes.py`, gọi từ `runner.py` lúc startup (idempotent).

---

## Environment Variables (`config.py`)

| Var | Default | Mô tả |
|---|---|---|
| `MAINT_SCAN_CRON` | `0 20 * * *` | Cron scan (VN time) |
| `MAINT_SUMMARY_CRON` | `30 5 * * *` | Cron summary (VN time) |
| `MAINT_TICK_SEC` | `60` | Interval tick thực thi |
| `MAINT_DRY_RUN` | `true` | True = build T-SQL nhưng không execute — **default an toàn** |
| `MAINT_MAX_ATTEMPTS` | `3` | Số lần retry tối đa trước FAILED |
| `MAINT_APPROVAL_EXPIRE_HOURS` | `30` | Thời gian AWAITING_APPROVAL tự EXPIRED |
| `MAINT_MONGODB_DB` | `db_maintenance` | Tên MongoDB database riêng cho maintenance |

Các env chung dùng chung với Layer 1: `MSSQL_*`, `MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

---

## Quan trọng — Telegram

**Maintenance process KHÔNG poll Telegram getUpdates.**

- `MaintenanceNotifier`: chỉ `send_message` / `send_document` (push-only)
- `MaintenanceApprovalAdapter`: chạy **trong process monitoring** (Layer 1 scheduler) — nhận callback từ bot Layer 1 và ghi MongoDB
- Hai process không xung đột token vì chỉ 1 process poll

---

## SIGTERM Graceful Shutdown

`runner.py` đăng ký handler:
1. Set flag `_shutdown = True`
2. Nếu đang REBUILD resumable → gửi `ALTER INDEX ... PAUSE` (bảo toàn tiến độ)
3. Close MongoDB connection
4. Scheduler shutdown

---

## Scan Query Config (MongoDB-driven)

SQL scan được lưu trong `maintenance_scan_queries` — DBA có thể chỉnh trực tiếp trong MongoDB mà không cần redeploy.

**3 queries mặc định:**

| `query_id` | DMV | Mục đích |
|---|---|---|
| `scan_fragmentation` | `sys.dm_db_index_physical_stats` (SAMPLED) | Phát hiện index cần REBUILD/REORGANIZE |
| `scan_stats_staleness` | `sys.dm_db_stats_properties` | Phát hiện statistics lỗi thời |
| `scan_heap_forwarded` | `sys.dm_db_index_physical_stats` (index_id=0) | Phát hiện heap cần REBUILD |

**Placeholders trong SQL** (format với giá trị từ default policy lúc runtime):

| Placeholder | Nguồn |
|---|---|
| `{min_page_count}` | `default_policy.min_page_count` |
| `{min_frag_pct}` | `default_policy.reorganize_threshold_pct` |
| `{mod_threshold}` | `default_policy.stats_modification_threshold` |
| `{fwd_threshold}` | `default_policy.heap_forwarded_records_threshold` |

Nếu SQL không dùng placeholder nào, để nguyên — Python `str.format(**kwargs)` bỏ qua kwargs thừa.

**`scan_queries.py`** chỉ còn là nguồn constants cho seed — không dùng runtime.

---

## Seed (chạy 1 lần khi setup)

```bash
python -m layer1.maintenance.seed.seed_maintenance
```

Tạo trong `db_maintenance`:
- 1 document `maintenance_policies` (scope=`default`) với toàn bộ thresholds mặc định
- 1 document `maintenance_window` (01:00–04:00, 170 phút, gates mặc định)
- 3 documents `maintenance_scan_queries` (fragmentation, stats, heap)

Idempotent — chạy lại sẽ upsert, ghi đè về giá trị seed. Override per-table/index do DBA thêm không bị ảnh hưởng.

---

## DRY_RUN Mode

`MAINT_DRY_RUN=true` → tick loop build T-SQL, log statement, nhưng **không execute** trên SQL Server. Hữu ích khi test policy mới hoặc verify statement builder.

---

## Constraints & Không làm

- **Không query secondary** — tất cả maintenance execute trên PRIMARY
- **Không dùng statement timeout** — REBUILD lớn chạy hàng giờ là bình thường
- **Không gợi ý `OPTION(OPTIMIZE FOR UNKNOWN)`** — gây CPU overload throughput cao
- **Không hardcode server IP/role** — dùng node role cache từ executor (giống Layer 1 monitoring)
- **Không gộp nhiều item 1 tick** — mỗi tick tối đa 1 item để đảm bảo gate check + budget chính xác
- **Không dùng `MongoConnection.get_db()`** trong maintenance repos — luôn dùng `get_maint_db()` để trỏ đúng DB
- **Không sửa `scan_queries.py` để thay đổi logic scan** — sửa trực tiếp document trong MongoDB `maintenance_scan_queries`; `scan_queries.py` chỉ là seed source
