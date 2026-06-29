# ARCHITECTURE.md — Maintenance Runner

Cơ chế chi tiết của package `maintenance/`. Đọc `CLAUDE.md` trước để nắm tổng quan.

---

## 1. Hai khái niệm cốt lõi: Catalog vs Campaign

| | **Catalog** | **Campaign** |
|---|---|---|
| Trả lời | "Theo dõi / đo bảng nào?" | "Bảo trì gì, bảng nào, ngưỡng nào, khi nào?" |
| Ai định nghĩa | DBA cấu hình scope (tab Catalog) | DBA tạo campaign (tab Campaign) |
| Chứa ngưỡng? | Không — chỉ đo lường | Có — nhóm theo index/statistic/heap |
| Sản phẩm | `maintenance_catalog` snapshot | `maintenance_queue` work items |
| Tần suất | Cron hằng ngày (06:00) | Discovery bám `scan_times` của campaign |

Tách 2 trục này cho phép: **1 snapshot dùng cho nhiều campaign**, và **đổi ngưỡng → áp dụng ngay ở lần
discovery kế tiếp** mà không cần truy vấn lại SQL Server.

---

## 2. Catalog — capture snapshot

`catalog/catalog_service.py::run()` cho mỗi cluster:

1. Đọc scope từ `maintenance_catalog_config`. Không có → skip.
2. Chọn **primary host** của cluster (capture luôn chạy trên primary).
3. Sinh 1 `run_id` cho cả lần chạy. Mỗi database trong scope:
   - **Danh sách bảng** — 1 query, filter chính xác per-schema để không rò tên bảng chéo schema:
     `(s.name='dbo' AND t.name IN (...)) OR (s.name='audit' AND t.name IN (...))`.
     `table_names` rỗng = cả schema.
   - **Chi tiết từng bảng** (song song, `MAINT_CATALOG_MAX_WORKERS`):
     - Index: `dm_db_index_physical_stats('SAMPLED')` — giữ **fragmentation per-partition** nếu bảng partition.
     - Stats: `dm_db_stats_properties` — `modification_counter`, `last_updated`.
     - Heap: `forwarded_record_count` (chỉ với bảng có index HEAP).
4. Upsert vào `maintenance_catalog` theo (cluster, database, run_id).

---

## 3. Campaign — vòng đời

```
 PENDING ──(đến scan_times)──► DISCOVERING ──┬─ có item ─► ACTIVE ──┐
   ▲                                         └─ 0 item  ─► COMPLETED │
   │ (job 60s tự retry)                                             │ re-discover mỗi ngày
 DISCOVERY_FAILED ◄── lỗi lần đầu                                    │ theo capture mới nhất
                                                                     │
 EXPIRED ◄── quá end_date          CANCELLED ◄── DBA huỷ      ◄──────┘
```

- **Lần đầu** (`_first_discovery`): PENDING → DISCOVERING → sinh item → ACTIVE (có item) / COMPLETED
  (không có). Lỗi → DISCOVERY_FAILED, job 60s tự thử lại.
- **Re-discover hằng ngày** (`_maybe_rediscover`): campaign ACTIVE, mỗi `scan_times`, nếu có catalog
  capture mới hơn lần discover trước → chạy lại trên snapshot mới (xem mục 4). Lỗi re-discover
  **không** giết campaign — giữ ACTIVE, chỉ ghi `discovery_error`.
- `discovered_run_ids` (dict `db → run_id`) đánh dấu campaign đã discover tới capture nào.
- Chống double-fire: chỉ trigger khi `now ∈ scan_times` và cách lần trước ≥ 55 phút.

---

## 4. Re-discover & supersede

Khi campaign ACTIVE thấy capture mới:

1. Các item **chưa thực thi** (`awaiting_approval` + `approved`) → đánh dấu `superseded`.
   Item đang `running`/`paused` **không** bị động tới.
2. Discovery chạy lại trên snapshot mới → sinh item mới.
3. `total_items` tính lại = (done + failed + skipped) + số item đang mở.

→ Campaign luôn thực thi theo **capture mới nhất**, không bao giờ chạy lại snapshot cũ đã lỗi thời.

---

## 5. Ngưỡng: từ Campaign → quyết định

Ngưỡng ở campaign là optional và nhóm theo loại; field để trống thì kế thừa default policy.

```
CampaignThresholds (optional)               default policy (maintenance_policies)
  index:    reorganize_pct, rebuild_pct,       reorganize_threshold_pct, rebuild_threshold_pct,
            min_page_count, max_page_count      min_page_count, max_page_count
  statistic: modification_threshold            stats_modification_threshold
  heap:     forwarded_threshold                heap_forwarded_records_threshold
              │                                          │
              └──────── resolve (None → default) ────────┘
                                  ▼
              EffectiveThresholds  ← discovery dùng để quyết định, tính 1 lần / run
```

**Quyết định cho mỗi index/partition:**

| Điều kiện | Action |
|---|---|
| `page_count < min_page_count` | bỏ qua |
| `max_page_count` set và `page_count >` nó | bỏ qua |
| `frag < reorganize_pct` | bỏ qua |
| `reorganize_pct ≤ frag < rebuild_pct` | **REORGANIZE** |
| `frag ≥ rebuild_pct` | **REBUILD** (partition → `REBUILD_PARTITION`) |
| stats: `modification_counter ≥ stats_modification_threshold` | **UPDATE_STATISTICS** |
| heap: `forwarded_count ≥ heap_forwarded_threshold` | **HEAP_REBUILD** |

`PolicyResolver` (merge default ← table ← index) chỉ cấp **execution params**
(maxdop / online / resumable / enabled / priority_boost), không cấp ngưỡng.

---

## 6. Discovery → work items

`_run_discovery`:

1. (Re-discover) supersede item chưa chạy.
2. Cảnh báo nếu catalog > 48h; expire batch/approval quá hạn.
3. Lấy table snapshot mới nhất trong scope campaign.
4. Mỗi bảng (bỏ qua nếu policy `enabled=False`), theo execution_types đã chọn:
   - **Index** → **1 item / partition vượt ngưỡng** (index không partition = 1 item toàn index).
   - **Statistic** → 1 item nếu vượt ngưỡng modification.
   - **Heap** → 1 item nếu forwarded vượt ngưỡng.
5. Dedup với item đang mở; ước lượng `estimated_minutes` + `priority`.
6. Insert `maintenance_queue` + `maintenance_batches`, gửi batch approval lên Telegram (top-N item).

---

## 7. Execute tick

`execute/execute_service.py::tick()` mỗi `MAINT_TICK_SEC`:

1. **Window** — đúng slot VN-time (có day_overrides) và còn budget phút. Ngoài window → dừng.
2. **Gates** (`safety/gate_service.py`) — CPU%, active requests, AG redo/send queue. Fail → không claim item.
3. **Claim** item `approved` theo priority; admission control theo ước lượng thời gian vs budget còn lại.
4. **Chạy** T-SQL (`statement_builder.py`): REORGANIZE / REBUILD [PARTITION] ONLINE RESUMABLE /
   UPDATE STATISTICS / HEAP REBUILD — theo execution params đã resolve.
5. Ghi `maintenance_history` (outcome, duration — làm context cho AI Layer 2).
6. **SIGTERM** → PAUSE resumable rebuild (`stop_grace_period: 30s`); khởi động lại sẽ recover.

`safety/health_monitor.py` (thread riêng) auto-pause execute khi gate fail lặp lại, auto-resume khi phục hồi.

---

## 8. Phối hợp với Layer 3 (qua MongoDB)

```
Layer 3 (Fastify)                          maintenance (runner)
  PUT  catalog/config  ──► maintenance_catalog_config ──poll──► Catalog
  POST campaigns       ──► maintenance_campaigns      ──poll──► Discovery
  POST commands {type} ──► maintenance_commands ──poll 30s──► trigger in-process (có lock)
  GET  summary/queue/history/catalog/* ◄── đọc trực tiếp collection runtime
```

Runner không có HTTP. Force chạy ngay = ghi `maintenance_commands` (`run_catalog`/`run_discovery`),
fire-and-forget; runner busy thì giữ command `pending` thử lại. Approval ✅/⛔ do bot của chính process
maintenance xử lý (token Telegram riêng).

---

## 9. Multi-cluster

- Mọi collection có `cluster_id`; mọi query filter theo `cluster_id`.
- 1 bộ service (catalog/discovery/execute/health) + job riêng cho **mỗi cluster**.
- Cluster chưa có `maintenance_window` → runner **vẫn đăng ký đủ 4 jobs** (catalog/discovery/tick/summary);
  execute tick tự skip (`return 0`) khi `window is None`; health_monitor idle. DBA tạo window qua
  Layer 3 UI (Maintenance → Configure window) — runner pick up trong ≤60s, không cần restart.
- Cluster chưa có `maintenance_catalog_config` → catalog skip; discovery không có dữ liệu cho tới khi
  DBA cấu hình scope.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
