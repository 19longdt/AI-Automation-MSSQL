# Plan — Maintenance Module: Index Reorganize/Rebuild + Update Statistics (`layer1/maintenance/`)

> Plan chi tiết theo layer:
> - [maintenance-layer1-detail.md](./maintenance-layer1-detail.md) — Core runner: models, repos, scan, T-SQL, Telegram approval, execute loop, SIGTERM, tests
> - [maintenance-layer2-detail.md](./maintenance-layer2-detail.md) — AI context: tools `get_maintenance_history`/`get_maintenance_queue_status`, ContextBuilder, skill YAML
> - [maintenance-layer3-detail.md](./maintenance-layer3-detail.md) — Web UI: API routes, trang /maintenance, approve/kill-switch trên web

## Context

Các SQL Agent job cũ (kiểm tra fragmentation, statistics) đã bị **tắt** vì chạy trên index/table lớn gây quá tải CPU, ảnh hưởng người dùng. Để lâu không xử lý → query performance không ổn định (I/O tăng, buffer pool lãng phí, estimate sai). Cần một service đặt lịch kiểm tra và thực hiện REORGANIZE / REBUILD / UPDATE STATISTICS theo ngưỡng, có kiểm soát tải.

**Quyết định kiến trúc đã chốt:**
- Tích hợp vào project `AI-Automation-MSSQL` (KHÔNG tạo project riêng) — module mới `layer1/maintenance/`, chạy như **process/container riêng** (`python -m layer1.maintenance.runner`, docker-compose service `maintenance` dùng chung image layer1) → stop độc lập khi treo/lag mà không ảnh hưởng monitoring.
- **Maintenance window config động trong MongoDB** (default + override theo thứ trong tuần + time budget mỗi đêm).
- **TẤT CẢ action phải DBA phê duyệt qua Telegram** trước khi thực thi.
- **Scope v1 đầy đủ**: index reorganize/rebuild, update statistics, partition-level rebuild, heap rebuild.
- **T-SQL tự sinh trong Python** (không dùng Ola Hallengren) — kiểm soát budget/safety gate giữa từng object, log granular vào MongoDB.
- `maintenance_history` thiết kế để Layer 2 AI agent đọc làm context sau này (follow-up, ngoài scope v1).

## Phát hiện quan trọng từ code thực tế (định hình thiết kế)

1. **`mssql_connection()` set statement timeout** (`layer1/executor/mssql_connection.py:41`, default 30s) → ALTER INDEX dài sẽ bị abort. Cần `maint_connection(host)` riêng: `autocommit=True`, `conn.timeout=0`.
2. **Hai process KHÔNG thể cùng poll 1 bot token** (Telegram getUpdates → 409). Process monitoring (`layer1.main`) đã chạy `TelegramBot._poll_loop()`. → Maintenance runner **chỉ SEND message + đọc Mongo**; approval callback do bot hiện tại xử lý (extend `_handle_callback_query` tại `telegram_bot.py:128-167`, pattern `l1|<action>|<id>|<arg>`), ghi quyết định vào MongoDB.
3. Entry point hiện tại của monitoring là **`layer1.main`** (scheduler thread + HTTP API). Maintenance runner mirror pattern `Layer1Service` trong `layer1/scheduler.py`.
4. `callback_data` giới hạn 64 byte → batch dùng full uuid (`l1|mntb|<uuid>|all` vừa), per-item dùng `short_id` 8 ký tự.
5. Hạ tầng tái sử dụng nguyên trạng: `EnvSettings` + `get_connection_string` (`layer1/config.py`), `MongoConnection` (`layer1/storage/mongo_client.py`), `create_all_indexes`/`_ensure_ttl_index` (`layer1/storage/indexes.py`), `NodeRoleCache.resolve(["primary"])` (`layer1/executor/node_role_cache.py`), `JobRunner.wrap` (`layer1/job_manager/job_runner.py`), `HealthChecker`, `QueryExecutor` (cho scan/gate SELECT), `now_vn()` (`layer1/utils/time_utils.py`), seed pattern (`layer1/seed/seed_topics.py`).
6. Tuân thủ code rules layer1/CLAUDE.md: full type hints, Pydantic giữa modules, pyodbc per-call, không để exception crash scheduler, fail-fast env, comment WHY, KHÔNG dùng python-telegram-bot (urllib.request).

## Cấu trúc module mới

```
layer1/maintenance/
├── __init__.py
├── runner.py                 ← Entry. MaintenanceService mirror Layer1Service: Mongo init →
│                                indexes → NodeRoleCache → repos/services → APScheduler jobs →
│                                SIGTERM graceful (PAUSE resumable rebuild đang chạy)
├── config.py                 ← Env vars riêng: MAINT_SCAN_CRON, MAINT_TICK_SEC (60),
│                                MAINT_DRY_RUN, MAINT_MAX_ATTEMPTS. Reuse layer1 settings.
├── connection.py             ← maint_connection(host): autocommit=True, conn.timeout=0
├── models/                   ← policy.py, work_item.py, window.py, history.py, approval.py
├── scan/
│   ├── scan_queries.py       ← SQL constants (fragmentation+partition, stats staleness, heap)
│   └── scan_service.py       ← scan → áp policy → dedupe vs open items → enqueue → tạo batch
│                                → gửi Telegram approval
├── policy/policy_resolver.py ← merge default ← table ← index override
├── window/window_service.py  ← state(now_vn()) → WindowState{open, remaining_minutes}
├── safety/
│   ├── gate_queries.py       ← CPU ring buffer, active sessions, AG redo/send queue
│   └── gate_service.py       ← check(primary, policy) → GateResult{passed, reasons}
├── execute/
│   ├── statement_builder.py  ← Sinh T-SQL thuần (unit-testable, escape identifier ]→]])
│   ├── duration_estimator.py ← page_count heuristic → estimated_minutes
│   └── execute_service.py    ← tick(): claim 1 item → gates → execute → history
├── notify/
│   ├── maintenance_notifier.py ← send-only (batch approval message, nightly summary)
│   └── approval_adapter.py     ← MaintenanceApprovalAdapter: pure Mongo writes, inject vào
│                                  TelegramBot của process monitoring
├── repositories/             ← policy_repo, queue_repo (claim atomic findOneAndUpdate),
│                                window_repo (+kill_switch), history_repo, batch_repo
└── seed/seed_maintenance.py  ← Seed default policy + window (idempotent, --dry-run)
```

## MongoDB collections (timestamps = `now_vn()`)

| Collection | Nội dung chính | Indexes / TTL |
|---|---|---|
| `maintenance_policies` | `policy_id`, `scope`(default\|table\|index), `schema/table/index_name`, `enabled`, `reorganize_threshold_pct`(10), `rebuild_threshold_pct`(30), `min_page_count`(1000), `maxdop`(4), `online`(true), `resumable`(true), `stats_modification_threshold`, `stats_fullscan`, `heap_forwarded_records_threshold`, `window_override`, `priority_boost` | unique `(policy_id)`; no TTL |
| `maintenance_window` | `window_id`("default"), `default{start,end,time_budget_minutes}`, `day_overrides{"0".."6"}`, `kill_switch`, `enabled` | unique `(window_id)`; no TTL |
| `maintenance_queue` | `item_id`(uuid), `short_id`(8 ký tự), `batch_id`, `kind`, `action_type`, object identity + `partition_number`/`stats_name`, `metrics{...}`, `estimated_minutes`, `priority`, `status`(pending→awaiting_approval→approved→running→done/failed/skipped/expired/paused/rejected), `approval{decided_by,decided_at}`, `attempts`, `resume_token`, `terminal_at` | `(status, priority DESC, created_at)`, `(batch_id)`, dedupe `(schema,table,index,partition,status)`; TTL trên `terminal_at` 14d — **item active không có terminal_at → sống qua nhiều ngày** |
| `maintenance_batches` | `batch_id`, `item_count`, `summary{counts, est_total_minutes}`, `decided_by/at`, `telegram_message_id`, `status` | unique `(batch_id)`; TTL `created_at` 14d |
| `maintenance_history` | `item_id`, object identity, `action_type`, `statement` (T-SQL exact), `outcome`, `frag_before_pct/frag_after_pct`, `duration_ms`, `skip_reason`, `error` | `(table_name, created_at DESC)`, `(action_type, created_at DESC)`; TTL **90d** (AI context) |

## T-SQL chính

**Scan fragmentation** (per-partition, SAMPLED — giống topic `index_fragmentation` có sẵn tại `seed_topics.py:870-916`): `sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'SAMPLED')` join `sys.indexes/objects/schemas/partitions`, lọc `page_count > @min`, `avg_fragmentation_in_percent >= @min_frag`, `is_ms_shipped=0`, kèm `partition_number`, `forwarded_record_count`, flag `is_partitioned`.

**Scan stats**: `sys.stats CROSS APPLY sys.dm_db_stats_properties` — `modification_counter >= @threshold`, kèm `last_updated`, `rows_sampled`.

**Scan heap**: `dm_db_index_physical_stats(..., 0, ...)` với `index_id=0`, `forwarded_record_count >= @threshold`.

**Safety gates**: CPU từ `RING_BUFFER_SCHEDULER_MONITOR` (ProcessUtilization); active requests từ `dm_exec_requests`; AG `log_send_queue_size`/`redo_queue_size` từ `dm_hadr_database_replica_states` (fail nếu secondary vượt ngưỡng hoặc không SYNCHRONIZED).

**Action templates** (`statement_builder.py`, identifier escape `]→]]`):
- `ALTER INDEX [ix] ON [s].[t] REORGANIZE [PARTITION = n]` — luôn online, kill an toàn, KHÔNG nhận MAXDOP/ONLINE/RESUMABLE
- `ALTER INDEX [ix] ON [s].[t] REBUILD [PARTITION = n] WITH (ONLINE=ON, MAXDOP=<n>, RESUMABLE=ON, MAX_DURATION=<remaining> MINUTES)` — Enterprise
- `UPDATE STATISTICS [s].[t] ([stats]) WITH FULLSCAN | SAMPLE <p> PERCENT`
- `ALTER TABLE [s].[t] REBUILD [PARTITION = n] WITH (ONLINE=ON, MAXDOP=<n>)` — heap
- Control: `ALTER INDEX ... PAUSE | RESUME | ABORT`

## Luồng Telegram approval

1. Job `maint_scan` (cron buổi tối, trước window) → tạo batch → runner **send** message tổng hợp: số lượng theo action, est tổng phút, top-N item chi tiết + file .txt full list.
2. Inline keyboard: `[✅ Approve ALL → l1|mntb|<batch_id>|all]` `[⛔ Reject ALL → l1|mntb|<batch_id>|reject]`; top-N item có nút riêng `l1|mnti|<short_id>|ok|no`.
3. **Process monitoring** xử lý callback: thêm 2 branch `mntb`/`mnti` vào `_handle_callback_query` (`layer1/notifications/telegram_bot.py:128-167`, đặt TRƯỚC logic finding-id, ~25 dòng) gọi `MaintenanceApprovalAdapter` (ctor param mới, optional, default None → reply "maintenance chưa bật") → flip status trong Mongo.
4. Item `approved` nằm chờ; tick trong window claim và chạy. Item không được quyết → `awaiting_approval` → expire theo TTL batch, **không bao giờ chạy**.

## Execution loop (`execute_service.tick()` — interval 60s, 1 item/tick)

```
window không mở / kill_switch / stop_requested → return
re-resolve primary (refresh nếu stale — failover safety)
claim item: paused-resumable trước, rồi approved theo (priority DESC, created_at)
policy.enabled? → skip nếu excluded
estimated_minutes > remaining_budget? → trả về approved, history(skip, "insufficient_budget")
safety gates fail? → attempts++, trả về approved, history(skip, reasons); quá MAX → skipped
đo frag_before → build statement (REBUILD resumable kèm MAX_DURATION=remaining)
DRY_RUN? → log statement, done
execute trên maint_connection (no timeout) → đo frag_after → history(done)
SIGTERM giữa chừng: resumable rebuild → PAUSE trên connection mới, status=paused;
                    REORGANIZE → kill an toàn, trả về approved
pyodbc error: ONLINE/RESUMABLE restriction (LOB...) → retry 1 lần ONLINE=OFF nếu policy cho phép;
              ngược lại failed/approved theo attempts
```

**Enforcement window/budget** (không interrupt được pyodbc call cùng thread): (a) `MAX_DURATION` server-side auto-pause cho resumable rebuild; (b) admission control — chỉ start item ước lượng vừa budget còn lại; (c) REORGANIZE incremental tự nhiên. 1 item/tick để tái kiểm tra kill-switch/window mỗi phút và job_executions không bị flag stuck.

## APScheduler jobs trong runner (đều `job_runner.wrap`, `max_instances=1, coalesce=True`)

- `maint_scan` — cron `MAINT_SCAN_CRON` (vd 20:00) → scan + batch + gửi approval
- `maint_window_tick` — interval 60s → tick()
- `maint_summary` — cron sau window end → tổng kết đêm (done/skipped/failed) gửi Telegram
- `node_role_refresh` + `health_check` — như layer1

## Thay đổi file hiện có (tối thiểu)

1. `docker-compose.yml` — service `maintenance`: cùng image `${LAYER1_IMAGE}`, `command: ["python","-m","layer1.maintenance.runner"]`, `env_file: .env`, `MONGODB_URI: mongodb://mongodb:27017`, `depends_on: mongodb healthy`, `restart: unless-stopped`. KHÔNG port.
2. `layer1/storage/indexes.py` — thêm các `_create_maintenance_*_indexes()` + TTL consts, gọi từ `create_all_indexes()`.
3. `layer1/notifications/telegram_bot.py` — ctor param `maintenance_approval=None` + 2 branch `mntb`/`mnti` (~25 dòng, backward-compatible).
4. `layer1/scheduler.py` — inject `MaintenanceApprovalAdapter` vào TelegramBot (guarded).
5. `.env.example`, `CLAUDE.md`, `layer1/CLAUDE.md` — docs.

KHÔNG sửa: detectors, query_executor, topic_runner, monitor_topics, Layer 2/3.

## Thứ tự thực hiện

1. **Skeleton + storage**: models Pydantic, repositories, indexes.py, seed_maintenance, docker-compose service. Unit test models/repo.
2. **Scan + approval (read-only MSSQL)**: scan_queries/service, policy_resolver, maintenance_notifier, telegram_bot extension + scheduler wiring. E2E: scan → message → approve-all → items approved.
3. **Window + gates + executor**: connection.py, window_service, gate_service, statement_builder (+tests), duration_estimator, execute_service, runner + SIGTERM. Chạy `MAINT_DRY_RUN=true`.
4. **RESUMABLE + multi-day + summary**: PAUSE/RESUME, claim_paused, MAX_DURATION, kill-switch, maint_summary, attempts/expiry.
5. **Hardening**: ONLINE/RESUMABLE LOB fallback, tuning ngưỡng AG gate, docs.

## Verification

- **Unit (không cần DB)**: `statement_builder` table-driven mọi action_type + escape identifier độc hại + partition + REORGANIZE không nhận options; `policy_resolver` precedence; `window_service` biên midnight/day-override/budget (inject now_vn); priority ordering.
- **Integration Mongo (MSSQL mocked qua interface inject — giống cách TopicRunner nhận deps)**: scan với canned rows → items + batch + dedupe; callback `l1|mntb|<id>|all` → approved; tick các nhánh window-closed / gate-fail / DRY_RUN done.
- **`MAINT_DRY_RUN=true` trên SQL Server Developer edition** (feature set = Enterprise): scan + gates thật, statement chỉ log.
- **SIGTERM test**: item giả chạy dài + SIGTERM → PAUSE được gửi, item `paused`, shutdown sạch.
- **Failover test**: stub role cache đổi primary giữa chừng → tick từ chối node cũ.

## Rủi ro đã nhận diện

- Single-poller Telegram: runner tuyệt đối không gọi getUpdates (409 sẽ giết bot monitoring).
- RESUMABLE/ONLINE restrictions (LOB columns...) — cần detect error number → fallback ONLINE=OFF theo policy hoặc skip, ghi history.
- TTL không được xóa item active — chỉ set `terminal_at` khi terminal.
- REORGANIZE không nhận MAXDOP/ONLINE/RESUMABLE — builder phải branch theo action_type.
- Failover giữa đêm — re-resolve primary mỗi tick.

## Follow-up (ngoài scope v1)

- Layer 2: thêm tool `get_maintenance_history` vào `layer2/agent/tool_registry.py` + handler đọc `maintenance_history` → agent trả lời "lần rebuild trước có giúp không?".
- Layer 3: route `GET /maintenance-history` + card dashboard.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
