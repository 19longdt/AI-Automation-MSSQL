# CLAUDE.md — maintenance/

## Mục đích

Process riêng biệt (KHÔNG chung với monitoring) — tự động bảo trì index/statistics cho **nhiều cụm MSSQL Server 2019 Enterprise Always On** (multi-cluster):

- DBA tạo **Campaign** (chiến dịch 1–2 tháng) qua Layer 3 UI
- **Discovery** chạy 1 lần khi campaign bắt đầu: full scan → build queue toàn bộ objects cần xử lý
- Gửi batch lên Telegram để DBA duyệt trước khi thực thi
- Thực thi REBUILD/REORGANIZE/UPDATE STATISTICS trong window đêm có kiểm soát an toàn
- Ghi audit log đầy đủ vào `maintenance_history` (bao gồm `campaign_id`)

---

## Entry Point & Scheduler

**Entry:** `python -m maintenance.runner`

3 APScheduler jobs **per cluster** (`cluster_id` = ID cụm):

| Job | ID | Trigger | Mặc định | Làm gì |
|---|---|---|---|---|
| scan | `maint_scan_{cluster_id}` | cron | 20:00 VN | Campaign-aware: discovery nếu PENDING, skip nếu ACTIVE |
| tick | `maint_tick_{cluster_id}` | interval | 60s | Thực thi tối đa 1 item/tick nếu có ACTIVE campaign và window đang mở |
| summary | `maint_summary_{cluster_id}` | cron | 05:30 VN | Gửi báo cáo đêm qua: budget dùng, top 3 chậm nhất |

Thêm 1 job chung: `health_check` (interval 120s) — kiểm tra job execution timeouts.

Cluster bị skip nếu chưa seed `maintenance_window` — log warning, không crash.

---

## Cấu trúc thư mục

```
maintenance/
├── runner.py                  ← Entry, MaintenanceService, APScheduler, SIGTERM handler
├── config.py                  ← MaintEnvSettings (env vars — KHÔNG có MSSQL_* nữa)
├── indexes.py                 ← create_maint_indexes(db): tạo compound indexes với cluster_id leading
├── connection.py              ← maint_connection(host, conn_str): autocommit=True, không timeout (DDL)
├── mongo.py                   ← legacy shim (có thể bỏ qua)
├── infra/
│   ├── mongo_client.py        ← MongoConnection: initialize/get_db/get_client/close
│   ├── cluster_reader.py      ← ClusterReader(monitor_db): find_all_enabled() → list[ClusterConfig]
│   ├── mssql_connection.py    ← mssql_connection(host, conn_str, timeout_sec): read-only + timeout
│   ├── query_executor.py      ← QueryExecutor: execute(..., conn_str) / execute_batch(..., conn_str)
│   ├── node_role_cache.py     ← cache role detection (dùng bởi scan_service)
│   ├── time_utils.py          ← now_vn(), utc_now()
│   ├── metrics.py             ← Prometheus metrics
│   ├── query_config.py        ← query config helpers
│   ├── health_checker.py      ← HealthChecker: kiểm tra job execution timeouts
│   ├── job_execution_repo.py  ← JobExecutionRepo: ghi/đọc job execution records
│   └── job_runner.py          ← JobRunner.wrap(): decorator ghi execution log
├── models/
│   ├── campaign.py            ← MaintenanceCampaign + CampaignStatus enum
│   ├── policy.py              ← MaintenancePolicy (3-level merge), ActionType enum
│   ├── work_item.py           ← WorkItem + WorkItemStatus lifecycle; field đầu: cluster_id; có campaign_id
│   ├── window.py              ← MaintenanceWindow (window_id=cluster_id, enabled, budget, gates)
│   ├── history.py             ← MaintenanceHistory (audit log); field đầu: cluster_id; có campaign_id
│   ├── approval.py            ← MaintenanceBatch (approval state, Telegram msg_id); field đầu: cluster_id
│   ├── scan_query.py          ← ScanQueryConfig (query_id, sql, timeout_sec, enabled)
│   └── job.py                 ← JobExecution model
├── scan/
│   ├── scan_service.py        ← ClusterScanService(cluster: ClusterConfig, campaign_repo, ...)
│   └── scan_queries.py        ← SQL constants — chỉ dùng bởi seed, KHÔNG dùng runtime
├── policy/
│   └── policy_resolver.py     ← PolicyResolver: merge default ← table ← index (field-level)
├── window/
│   └── window_service.py      ← WindowService(cluster_id, ...): trạng thái mở/đóng + budget
├── safety/
│   ├── gate_service.py        ← GateService: check(host, gates, conn_str)
│   └── gate_queries.py        ← SQL queries cho safety gates
├── execute/
│   ├── execute_service.py     ← ClusterExecuteService(cluster, campaign_repo, ...)
│   ├── statement_builder.py   ← Sinh T-SQL thuần (ALTER INDEX, UPDATE STATISTICS, HEAP)
│   └── duration_estimator.py  ← Ước tính phút + tính priority score
├── notify/
│   ├── maintenance_bot.py     ← MaintenanceBot: poll Telegram daemon thread (own token)
│   ├── maintenance_notifier.py ← MaintenanceNotifier(bot_token, chat_id, cluster_id): send-only
│   └── approval_adapter.py    ← MaintenanceApprovalAdapter: xử lý callback → ghi MongoDB
├── repositories/
│   ├── campaign_repo.py       ← maintenance_campaigns; lifecycle methods per cluster_id
│   ├── queue_repo.py          ← maintenance_queue; claim methods nhận campaign_id param
│   ├── batch_repo.py          ← maintenance_batches; tất cả methods nhận cluster_id param
│   ├── policy_repo.py         ← maintenance_policies
│   ├── window_repo.py         ← maintenance_window; find_by_cluster(cluster_id)
│   ├── history_repo.py        ← maintenance_history; tất cả queries filter by cluster_id
│   └── scan_query_repo.py     ← maintenance_scan_queries (load/upsert SQL scan)
└── seed/
    └── seed_maintenance.py    ← Seed policy + window + scan queries; CLI --cluster-id / --all-clusters
```

---

## MongoDB — Dual Database

Maintenance process tự tạo `MongoClient` qua `infra/mongo_client.py` (`MongoConnection`), **KHÔNG dùng** `MongoConnection` của Layer 1.

```python
MongoConnection.initialize(maint_settings)
maint_db    = MongoConnection.get_db()                          # db_maintenance
monitor_db  = MongoConnection.get_client()[settings.monitor_mongodb_db]  # db_monitor
```

| Database | Mục đích | Truy cập qua |
|---|---|---|
| `db_monitor` (MONITOR_MONGODB_DB) | Đọc cluster config (`db_clusters`) | `ClusterReader(monitor_db)` |
| `db_maintenance` (MAINT_MONGODB_DB) | Toàn bộ maintenance data | `MongoConnection.get_db()` |

| Collection | Database | Mô tả | TTL |
|---|---|---|---|
| `db_clusters` | db_monitor | ClusterConfig — read-only từ maintenance | — |
| `maintenance_campaigns` | db_maintenance | Campaign metadata + lifecycle per cluster | — |
| `maintenance_scan_queries` | db_maintenance | SQL scan templates | — |
| `maintenance_policies` | db_maintenance | Policy config (default/table/index scope) | — |
| `maintenance_window` | db_maintenance | **1 doc per cluster** (window_id=cluster_id): slot, budget, gates, enabled | — |
| `maintenance_queue` | db_maintenance | Work items + status lifecycle; có `campaign_id` | 14 ngày |
| `maintenance_batches` | db_maintenance | Batch + approval state + Telegram message_id | 14 ngày |
| `maintenance_history` | db_maintenance | Audit log đầy đủ (frag before/after, duration); có `campaign_id` | 90 ngày |

Indexes được tạo bởi `create_maint_indexes(db)` lúc startup (idempotent). Tất cả compound indexes có `cluster_id` là leading field.

---

## Campaign Model

```
CampaignStatus: PENDING | DISCOVERING | DISCOVERY_FAILED | ACTIVE | COMPLETED | EXPIRED | CANCELLED
```

| Field | Mô tả |
|---|---|
| `campaign_id` | UUID 8-char |
| `cluster_id` | Leading field, max 12 chars |
| `name` | Tên chiến dịch |
| `status` | Lifecycle state |
| `start_date` / `end_date` | Thời hạn chiến dịch |
| `discovery_started_at` / `discovery_finished_at` | Timestamp discovery |
| `discovery_error` | Error message nếu DISCOVERY_FAILED |
| `total_items` | Set sau discovery |
| `done_count` / `failed_count` / `skipped_count` | Incremented by execute service |

**Campaign lifecycle:**

```
PENDING ──(scan cron)──→ DISCOVERING ──(scan ok)───→ ACTIVE
                                     ↘(scan fail)──→ DISCOVERY_FAILED
                                                          │
                         (scan cron auto-retry) ←────────┘

DISCOVERING ──(process crash)──→ DISCOVERY_FAILED  [startup recovery]

ACTIVE ──(end_date pass)──→ EXPIRED ──(DBA extend end_date)──→ ACTIVE
ACTIVE ──(all items terminal)──→ COMPLETED
PENDING/ACTIVE/DISCOVERY_FAILED ──(DBA cancel)──→ CANCELLED
```

**Chỉ 1 ACTIVE hoặc DISCOVERING campaign per cluster tại 1 thời điểm.**

---

## Luồng chính

### 1. Startup — Multi-cluster bootstrap

```
MaintenanceService._setup_infrastructure()
  ├── MongoConnection.initialize() → maint_db + monitor_db
  ├── create_maint_indexes(maint_db)
  ├── ClusterReader(monitor_db).find_all_enabled() → list[ClusterConfig]
  ├── Validate: default policy seeded? scan queries seeded?
  ├── queue_repo.recover_running()  ← reset RUNNING → APPROVED sau restart
  ├── MaintenanceBot(maint_telegram_bot_token).start()  ← daemon thread
  └── for cluster in clusters:
        if no window seeded → log warning + skip cluster
        campaign_repo.reset_stuck_discovering(cluster_id)  ← DISCOVERING → DISCOVERY_FAILED
        notifier = MaintenanceNotifier(token, chat_id, cluster.cluster_id)
        scan_service = ClusterScanService(cluster, campaign_repo, ...)
        execute_service = ClusterExecuteService(cluster, campaign_repo, ...)
        register: maint_scan_{cid}, maint_tick_{cid}, maint_summary_{cid}
```

`reset_stuck_discovering` xử lý crash recovery: nếu process tắt giữa chừng khi đang DISCOVERING, campaign được reset về DISCOVERY_FAILED để scan cron retry tự động.

### 2. Scan (mỗi tối — per cluster) — Campaign-aware

```
ClusterScanService.run()
  ├── campaign_repo.expire_if_past_end_date(cluster_id, now)
  │     → ACTIVE campaign quá hạn → EXPIRED
  ├── Có ACTIVE/DISCOVERING campaign? → return 0 (skip scan)
  ├── Có PENDING/DISCOVERY_FAILED campaign?
  │   ├── campaign_repo.update_status(DISCOVERING)
  │   ├── try:
  │   │     _run_discovery(campaign_id)
  │   │       ├── Reload policy, load scan queries
  │   │       ├── Resolve PRIMARY từ cluster.node_roles
  │   │       ├── _run_query(host, conn_str, ...) → (rows, ok: bool)
  │   │       │     Nếu TẤT CẢ queries fail và items=0 → raise DiscoveryError
  │   │       │     Nếu 1 số queries fail nhưng có items → log warning, tiếp tục
  │   │       ├── Map rows → WorkItem(campaign_id=campaign_id, cluster_id=...)
  │   │       ├── Dedupe vs open queue
  │   │       └── Create batch → queue_repo + batch_repo → notifier.send_batch()
  │   │     campaign_repo.update_status(ACTIVE, total_items=count)
  │   └── except DiscoveryError:
  │         campaign_repo.update_status(DISCOVERY_FAILED, discovery_error=str(e))
  └── Không có campaign → return 0
```

Conn_str luôn đến từ `cluster.get_connection_string(host)` — KHÔNG đọc MSSQL_* env.

### 3. Approval (DBA duyệt qua Telegram)

`MaintenanceBot` poll Telegram bằng `MAINT_TELEGRAM_BOT_TOKEN` trong daemon thread.
Callback routing: `l1|` prefix → `action` (mntb/mnti) → `MaintenanceApprovalAdapter` → ghi MongoDB.

| Callback data | Hành động |
|---|---|
| `l1\|mntb\|<cluster_id>\|<batch_id>\|all` | Approve toàn batch |
| `l1\|mntb\|<cluster_id>\|<batch_id>\|reject` | Reject toàn batch |
| `l1\|mnti\|<cluster_id>\|<short_id>\|ok` | Approve item đơn lẻ |
| `l1\|mnti\|<cluster_id>\|<short_id>\|no` | Reject item đơn lẻ |

**Byte budget:** `l1|mntb|` (8) + cluster_id + `|` (1) + UUID (36) + `|reject` (7) = 52 + len(cluster_id) ≤ 64 → **`cluster_id` max 12 ký tự** (enforced bởi `ClusterConfig.cluster_id: Field(..., max_length=12)`).

### 4. Execute Tick (mỗi 60 giây — per cluster)

```
ClusterExecuteService.tick()
  ├── 0. Campaign gate: find_active_or_discovering(cluster_id)
  │       Không có ACTIVE campaign → return 0
  ├── 1. Kiểm tra window (WindowService) — mở? budget? kill_switch?
  ├── 2. Safety gates: GateService.check(host, gates, conn_str)
  │       └── mssql_connection(host, conn_str, timeout_sec)
  ├── 3. Claim theo campaign_id: PAUSED-resumable trước → APPROVED theo priority
  ├── 4. Admission control: est_minutes > budget → DEFERRED
  ├── 5. Build T-SQL (statement_builder.py)
  ├── 6. Execute trên PRIMARY: maint_connection(host, conn_str)  ← no timeout (DDL)
  ├── 7. Measure frag after: mssql_connection(host, conn_str, timeout_sec)
  ├── 8. Ghi maintenance_history(cluster_id=..., campaign_id=item.campaign_id, ...)
  └── 9. campaign_repo.increment_stats(campaign_id, done/failed/skipped)
           → nếu done+failed+skipped >= total_items → set COMPLETED
```

---

## Connection Paths — Hai loại khác nhau

| Hàm | File | Dùng cho | Timeout |
|---|---|---|---|
| `mssql_connection(host, conn_str, timeout_sec)` | `infra/mssql_connection.py` | Scan queries, gate checks, frag measurement | Có (mặc định 30s) |
| `maint_connection(host, conn_str)` | `connection.py` | DDL execution (REBUILD, REORGANIZE, UPDATE STATS) | Không (`conn.timeout=0`) |

`conn_str` luôn đến từ `cluster.get_connection_string(host)` và được truyền explicitly qua call chain — không đọc từ env.

---

## Work Item Lifecycle

```
AWAITING_APPROVAL ──→ APPROVED ──→ RUNNING ──→ DONE
        │                                  │
        ├──→ REJECTED (terminal)           ├──→ FAILED (max attempts → terminal)
        └──→ EXPIRED (30h, terminal)       └──→ PAUSED ──→ (tick kế tiếp nếu còn budget)
                                           │
                                           └──→ SKIPPED (policy off / budget không đủ)
```

Tất cả WorkItem có `campaign_id` — dùng để claim đúng theo campaign hiện tại và propagate vào history.

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

Merge theo **field-level** (Pydantic `model_fields_set`) — chỉ field được set tường minh mới override:

```python
enabled: bool                    # bật/tắt index này
min_page_count: int              # bỏ qua index nhỏ (mặc định 1000)
max_page_count: int | None       # bỏ qua index cực lớn
reorganize_threshold_pct: float  # 10%
rebuild_threshold_pct: float     # 30%
online: bool                     # ONLINE=ON mặc định
resumable: bool                  # RESUMABLE=ON mặc định
offline_fallback: bool           # thử OFFLINE nếu ONLINE fail
maxdop: int                      # 0 = server default
priority_boost: int              # điểm cộng vào priority score
```

Policy là **shared** — không phân theo cluster. Dùng priority_boost để ưu tiên một số object trong cluster cụ thể.

---

## Safety Gates

Kiểm tra **trước mỗi item** trong tick, qua `gate_service.check(host, gates, conn_str)`:

| Gate | DMV | Điều kiện fail |
|---|---|---|
| CPU | `sys.dm_os_ring_buffers` | avg CPU > ngưỡng (mặc định 70%) |
| Active requests | `sys.dm_exec_requests` | count > ngưỡng (mặc định 50) |
| AG log_send_queue | `sys.dm_hadr_database_replica_states` | > ngưỡng KB |
| AG redo_queue | `sys.dm_hadr_database_replica_states` | > ngưỡng KB |

Bất kỳ gate nào fail → tick bỏ qua, item trả về queue. Ngưỡng config trong `maintenance_window.gates`.

---

## Window Service

- `window_id = cluster_id` — 1 document per cluster trong `maintenance_window`
- `enabled: bool` per cluster — cluster window disabled → tick skip hoàn toàn
- Đọc từ MongoDB mỗi tick (DBA có thể sửa live, không cần redeploy)
- Hỗ trợ qua đêm: `start > end` → wrap midnight
- Day overrides: override per weekday (mặc định: Fri/Sat mở rộng 00:00–05:00 / 280 phút)
- `kill_switch: true` → dừng ngay sau item hiện tại
- Budget còn lại = `time_budget_minutes - Σ actual_duration` item DONE/PAUSED trong window hôm nay

---

## Duration Estimator

Heuristic (không ML):

```
REBUILD:  pages / PAGES_PER_MIN  (default: 150,000 pages/min)
REORG:    pages / PAGES_PER_MIN  (default: 150,000 pages/min)
STATS:    rows  / ROWS_PER_MIN   (default: 2,000,000 rows/min)
HEAP:     pages / PAGES_PER_MIN
```

Priority score = base_action_score + fragmentation% + log10(page_count) + priority_boost

---

## Environment Variables (`config.py`)

| Var | Default | Mô tả |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017` | URI chung (cả maint + monitor DB) |
| `MONITOR_MONGODB_DB` | `db_monitor` | DB đọc cluster config (`db_clusters`) |
| `MAINT_MONGODB_DB` | `db_maintenance` | DB maintenance data |
| `MSSQL_QUERY_TIMEOUT_SEC` | `30` | Timeout cho read queries (scan, gate, frag) |
| `MAINT_SCAN_CRON` | `0 20 * * *` | Cron scan (VN time) |
| `MAINT_SUMMARY_CRON` | `30 5 * * *` | Cron summary (VN time) |
| `MAINT_TICK_SEC` | `60` | Interval tick thực thi |
| `MAINT_DRY_RUN` | `true` | True = log T-SQL, không execute — **default an toàn** |
| `MAINT_MAX_ATTEMPTS` | `3` | Số lần retry tối đa trước FAILED |
| `MAINT_APPROVAL_EXPIRE_HOURS` | `30` | Thời gian AWAITING_APPROVAL tự EXPIRED |
| `MAINT_ESTIMATE_PAGES_PER_MINUTE` | `150000` | Heuristic ước tính thời gian REBUILD |
| `MAINT_ESTIMATE_ROWS_PER_MINUTE` | `2000000` | Heuristic ước tính thời gian UPDATE STATS |
| `MAINT_BATCH_TOP_N_ITEMS` | `10` | Số items hiện trong Telegram approval message |
| `MAINT_TELEGRAM_BOT_TOKEN` | *(required)* | Bot token **riêng** của maintenance (khác Layer 1) |
| `TELEGRAM_CHAT_ID` | *(required)* | Chat ID dùng chung với Layer 1 (fallback, không set riêng) |

**Không còn `MSSQL_*` env vars** — connection string đến từ `ClusterConfig.get_connection_string(host)`.
**Không có `MAINT_TELEGRAM_CHAT_ID`** — dùng chung `TELEGRAM_CHAT_ID` qua `MaintEnvSettings.telegram_chat_id`.

---

## Telegram — Hai Token Tách Biệt

| Process | Bot token | Poll getUpdates? | Vai trò |
|---|---|---|---|
| Monitoring (Layer 1) | `TELEGRAM_BOT_TOKEN` | ✅ (monitoring bot) | /quick commands, alert notifications |
| Maintenance | `MAINT_TELEGRAM_BOT_TOKEN` | ✅ (`MaintenanceBot` daemon thread) | Approval callbacks, nightly summary |

**`MaintenanceBot`** (`notify/maintenance_bot.py`) chạy trong daemon thread trong process maintenance — poll `maint_telegram_bot_token`, route callback `l1|mntb|...` / `l1|mnti|...` đến `MaintenanceApprovalAdapter`.

**`MaintenanceNotifier`** (`notify/maintenance_notifier.py`) — send-only, mỗi notifier gắn với 1 `cluster_id`, dùng cùng `maint_telegram_bot_token`.

Hai process không xung đột vì dùng hai token khác nhau.

---

## SIGTERM Graceful Shutdown

`runner.py` đăng ký handler:
1. `service.stop()` → gọi `execute_service.request_stop()` cho từng cluster
2. Nếu đang REBUILD resumable → gửi `ALTER INDEX ... PAUSE` (bảo toàn tiến độ)
3. `MongoConnection.close()`
4. `scheduler.shutdown(wait=False)`

---

## Scan Query Config (MongoDB-driven)

SQL scan lưu trong `maintenance_scan_queries` — **shared** cho tất cả clusters (không phân theo cluster). DBA sửa trực tiếp trong MongoDB, không cần redeploy.

| `query_id` | DMV | Mục đích |
|---|---|---|
| `scan_fragmentation` | `sys.dm_db_index_physical_stats` (SAMPLED) | REBUILD/REORGANIZE |
| `scan_stats_staleness` | `sys.dm_db_stats_properties` | UPDATE STATISTICS |
| `scan_heap_forwarded` | `sys.dm_db_index_physical_stats` (index_id=0) | HEAP REBUILD |

**Placeholders trong SQL** (format với giá trị từ default policy):

| Placeholder | Nguồn |
|---|---|
| `{min_page_count}` | `default_policy.min_page_count` |
| `{min_frag_pct}` | `default_policy.reorganize_threshold_pct` |
| `{mod_threshold}` | `default_policy.stats_modification_threshold` |
| `{fwd_threshold}` | `default_policy.heap_forwarded_records_threshold` |

`scan_queries.py` chỉ là constants cho seed — **không dùng runtime**.

---

## Seed (chạy trước lần đầu)

```bash
# Seed policy + scan queries (shared, 1 lần)
python -m maintenance.seed.seed_maintenance --policy-only

# Seed window cho 1 cluster cụ thể
python -m maintenance.seed.seed_maintenance --cluster-id prod

# Seed windows cho tất cả enabled clusters
python -m maintenance.seed.seed_maintenance --all-clusters

# Dry-run: in payload không ghi DB
python -m maintenance.seed.seed_maintenance --all-clusters --dry-run
```

Idempotent — chạy lại upsert policy + scan queries về giá trị seed. Window đã tồn tại không bị ghi đè.

**Campaign không được seed** — DBA tạo thủ công qua Layer 3 UI.

---

## DRY_RUN Mode

`MAINT_DRY_RUN=true` → tick loop build T-SQL, log statement, nhưng **không execute** trên SQL Server.

---

## Constraints & Không làm

- **Không query secondary** — tất cả maintenance execute trên PRIMARY
- **Không dùng statement timeout cho DDL** — REBUILD lớn chạy hàng giờ là bình thường
- **Không gợi ý `OPTION(OPTIMIZE FOR UNKNOWN)`** — gây CPU overload throughput cao
- **Không hardcode server IP** — luôn dùng `ClusterConfig.nodes` + role cache
- **Không gộp nhiều item 1 tick** — mỗi tick tối đa 1 item (gate check + budget chính xác)
- **Không dùng `ClusterRepo` của Layer 1** — `ClusterRepo` bind với `MongoConnection.get_db()` singleton Layer 1; maintenance dùng `ClusterReader(monitor_db)` thin wrapper riêng
- **Không sửa `scan_queries.py` để đổi logic** — sửa document trong MongoDB `maintenance_scan_queries`; `scan_queries.py` chỉ là seed source
- **Không scan nếu không có campaign** — scan cron skip hoàn toàn khi không có PENDING/DISCOVERY_FAILED campaign
- **Không execute nếu không có ACTIVE campaign** — tick gate đầu tiên
- **`cluster_id` ≤ 12 ký tự** — enforced bởi `ClusterConfig.cluster_id: Field(..., max_length=12)` vì Telegram callback_data limit 64 bytes
