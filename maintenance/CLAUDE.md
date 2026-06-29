# CLAUDE.md — Maintenance Runner (`maintenance/`)

## Maintenance làm gì?

Một **process riêng** (`python -m maintenance.runner`) tự động bảo trì **index / statistics / heap**
cho nhiều cụm MSSQL Always On AG, chạy an toàn trong **window đêm**.

DBA điều khiển toàn bộ qua **Web UI (Layer 3)**; runner thực thi và báo cáo qua **Telegram**.
Runner **không có HTTP** — mọi phối hợp với Layer 3 đi qua **MongoDB**.

> Cơ chế chi tiết (lifecycle, ngưỡng, supersede, gates): xem **`ARCHITECTURE.md`**.
> Luồng xử lý job từng bước (check, skip, execute, error, recovery): xem **`CAMPAIGN_FLOW.md`**.

---

## Luồng tổng quan

```
①  Catalog          ②  Campaign           ③  Discovery         ④  Approval      ⑤  Execute
   (runner, cron)      (DBA, Layer 3)         (runner, 60s)        (DBA, Telegram)   (runner, window đêm)

 Snapshot bảng/      Chọn bảng + ngưỡng     So snapshot mới       Bấm ✅ / ⛔     Gates → REBUILD /
 index/stats  ─────► + execution types ───► nhất với ngưỡng ───► trên batch  ───► REORG / UPDATE
 vào catalog         + lịch scan_times      → tạo work items                      STATS / HEAP
                                              (1 item / partition)                 → ghi history
```

1. **Catalog** (`catalog/catalog_service.py`) — cron hằng ngày, snapshot scope (db/schema/table do DBA
   cấu hình) vào `maintenance_catalog`: fragmentation per-partition, stats modification, heap forwarded.
2. **Campaign** — DBA tạo trên Layer 3: chọn bảng, execution types (index/statistic/heap), ngưỡng (trống
   = dùng default), window override, lịch `scan_times`. Đây là "ý định bảo trì".
3. **Discovery** (`discovery/discovery_service.py`) — mỗi 60s, chỉ chạy đúng `scan_times` campaign: so
   catalog snapshot **mới nhất** với ngưỡng → sinh `maintenance_queue` (**1 work item / partition vượt ngưỡng**).
4. **Approval** — runner gửi batch lên Telegram; DBA bấm ✅/⛔ (`notify/maintenance_bot.py` ghi MongoDB).
5. **Execute** (`execute/execute_service.py`) — tick 60s trong window đêm: kiểm tra gates → claim item đã
   duyệt theo priority → chạy T-SQL → ghi `maintenance_history`. SIGTERM → PAUSE resumable rebuild.

**Catalog = đo lường** (capture cái gì) · **Campaign = hành động** (làm gì, bảng nào, ngưỡng nào).
1 catalog snapshot dùng được cho nhiều campaign; đổi ngưỡng campaign → discovery lần sau áp dụng ngay
mà không cần capture lại.

---

## Cấu trúc thư mục

```
maintenance/
├── runner.py              ← Bootstrap: đăng ký scheduler jobs + poll command
├── config.py              ← MaintEnvSettings (MAINT_* cron/tick/dry-run, telegram)
├── indexes.py             ← MongoDB index + TTL
├── catalog/               ← Snapshot scope → maintenance_catalog
├── discovery/             ← Catalog → maintenance_queue (theo campaign)
├── execute/               ← Tick loop, statement_builder (T-SQL), duration_estimator
├── policy/                ← PolicyResolver: execution params (maxdop/online/resumable/enabled)
├── window/                ← WindowService: window VN-time + budget
├── safety/                ← Gates (CPU/active load/AG queue) + health_monitor (auto-pause)
├── notify/                ← Telegram: batch approval, nightly summary, callback bot
├── infra/                 ← Mongo/MSSQL connection, cluster_reader, job_runner (audit + trace_id),
│                             health_checker, time_utils, trace (TraceIdFilter + thread-local)
├── models/                ← Pydantic: catalog, campaign, thresholds, work_item, policy, window, command
├── repositories/          ← MongoDB access (1 repo / collection)
└── seed/seed_maintenance.py  ← Seed default policy + window (chạy 1 lần)
```

---

## MongoDB Collections

| Collection | Vai trò | Ghi bởi |
|---|---|---|
| `maintenance_catalog_config` | Scope capture per cluster (db → schema → table) | Layer 3 |
| `maintenance_catalog` | Snapshot table/index/stats/heap (mỗi run = 1 `run_id`) | Catalog |
| `maintenance_campaigns` | Campaign + tiến độ (scope/thresholds/execution_types/scan_times) | Layer 3 |
| `maintenance_queue` | Work item (awaiting_approval → approved → running → done/failed/superseded) | Discovery / Execute |
| `maintenance_batches` | Batch approval (summary theo action type) | Discovery |
| `maintenance_history` | Lịch sử thực thi (outcome, duration) | Execute |
| `maintenance_policies` | Execution params + default ngưỡng | seed / Layer 3 |
| `maintenance_window` | Window VN-time + budget + gates (default slot, day_overrides, gates, kill_switch) | Layer 3 UI / seed |
| `maintenance_commands` | Manual trigger từ Layer 3 (`run_catalog`/`run_discovery`) | Layer 3 |
| `job_executions` | Audit scheduler | runner |

Cluster config (`db_clusters`) đọc từ DB `db_monitor`.

---

## Scheduler Jobs

**Mỗi cluster:**

| Job | Trigger | Việc |
|---|---|---|
| `maint_catalog_{id}` | cron `MAINT_CATALOG_CRON` (06:00) | Catalog snapshot |
| `maint_discovery_{id}` | 60s | Discovery (chỉ chạy đúng `scan_times`) |
| `maint_tick_{id}` | `MAINT_TICK_SEC` (60s) | Execute tick |
| `maint_summary_{id}` | cron `MAINT_SUMMARY_CRON` (05:30) | Nightly summary |

**Toàn cục:** `command_poll` (30s, poll `maintenance_commands`) · `health_check` (120s).

`BlockingScheduler`, timezone `Asia/Ho_Chi_Minh`, mọi job `max_instances=1` + `coalesce=True`.

---

## Điều khiển từ Layer 3

Layer 3 ghi MongoDB, runner poll. Để **force chạy ngay** (không chờ cron), Layer 3 insert document vào
`maintenance_commands` (`run_catalog` / `run_discovery`); job `command_poll` claim và route tới trigger
in-process. Trigger có **lock** → catalog/discovery của cùng cluster không bao giờ chạy song song.

---

## Quy tắc khi sửa code

- **Ngưỡng quyết định ở cấp Campaign** (nhóm theo index/statistic/heap), không ở catalog, không ở policy.
  PolicyResolver chỉ cấp execution params (maxdop/online/resumable/enabled/priority_boost).
- **Catalog scope = đo lường thuần, KHÔNG chứa ngưỡng.**
- **Validation trùng scope đặt ở Layer 3** (write-only). Không đặt validator chặn trùng trong Pydantic
  model — sẽ crash runner khi đọc config legacy có entry trùng.
- Runner **không thêm HTTP API** — manual trigger luôn qua `maintenance_commands`.
- Thêm command type mới → cập nhật `models/command.py`, `repositories/command_repo.py`, `runner.py`, Layer 3.
- Thêm execution type / threshold field → đồng bộ `models/thresholds.py`, `discovery_service.py`,
  và Layer 3 (`campaigns.schema.ts`, `campaign-service.ts`, `CampaignForm.tsx`, `types/index.ts`).

---

## Chạy

```bash
# Seed default policy + scan queries (bắt buộc trước go-live)
docker compose run --rm maintenance python -m maintenance.seed.seed_maintenance

# Seed window cho từng cluster (tuỳ chọn — có thể cấu hình qua Layer 3 UI sau)
docker compose run --rm maintenance python -m maintenance.seed.seed_maintenance --all-clusters
# hoặc cho 1 cluster cụ thể:
docker compose run --rm maintenance python -m maintenance.seed.seed_maintenance --cluster-id prod

# Start runner
docker compose up -d maintenance
```

**Cluster không có `maintenance_window`:** runner vẫn đăng ký đủ 4 jobs. Catalog + discovery chạy bình thường; execute tick tự skip (return 0) cho tới khi DBA tạo window qua Layer 3 UI (Maintenance → Configure window).

`MAINT_DRY_RUN=true` (default) → chỉ log T-SQL. Set `false` khi go-live.

**Biến tuning thường gặp (đầy đủ xem `.env.example`):**

| Biến | Mặc định | Mô tả |
|---|---|---|
| `MAINT_ESTIMATE_PAGES_PER_MINUTE` | `150000` | Tốc độ ước lượng thời gian REBUILD/REORGANIZE (pages/phút) |
| `MAINT_ESTIMATE_ROWS_PER_MINUTE` | `2000000` | Tốc độ ước lượng UPDATE STATS / HEAP REBUILD (rows/phút) |
| `MAINT_CATALOG_TABLE_TIMEOUT_SEC` | `120` | Timeout per-table trong catalog capture |
| `MSSQL_QUERY_TIMEOUT_SEC` | `30` | Query timeout cho execute tick |
| `LOGSTASH_HOST` | `` | Logstash host (dùng chung với Layer 1; trống = tắt) |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
