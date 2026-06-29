# CAMPAIGN_FLOW.md — Luồng xử lý Campaign & Execute

Tài liệu này mô tả chi tiết từng bước xử lý của các job khi một campaign đang chạy: điều kiện
skip, logic rẽ nhánh, các trường hợp lỗi và recovery.
Đọc `ARCHITECTURE.md` trước để nắm cơ chế Catalog, ngưỡng, và vòng đời campaign.

---

## 0. Tạo & Quản lý Campaign (Layer 3)

### 0.1 Tạo Campaign mới — `POST /api/maintenance/campaigns`

```
DBA điền CampaignForm (Layer 3 UI)
    │  cluster_id, name, start_date / end_date
    │  execution_types   (mặc định: index + statistic + heap)
    │  scan_times        (mặc định: ["20:00"])
    │  scope             (null = toàn bộ catalog scope; hoặc subset db/schema/table)
    │  thresholds        (null = kế thừa default policy; hoặc DBA tự đặt nhóm theo
    │                     index / statistic / heap)
    │  window_override   (null = dùng window mặc định của cluster; hoặc override
    │                     start/end/time_budget_minutes)
    │
    ▼ Fastify API validate
    ├─ cluster_id có catalog_config?            → 400 nếu chưa configure Catalog
    ├─ scope nằm trong catalog_config?          → 400 nếu db/schema/table ngoài scope
    ├─ end_date > start_date?                   → 400 nếu không
    └─ Đã có campaign ACTIVE / DISCOVERING?     → 409 (chỉ 1 campaign active/cụm)
    │
    ▼ Insert MongoDB `maintenance_campaigns`
    status          = "pending"
    campaign_id     = 8-char UUID hex (auto-generated)
    counters        = 0 (total_items / done / failed / skipped)
    discovered_run_ids = {}
    │
    ▼ Discovery job poll (maint_discovery_{cluster_id}, 60s)
    Phát hiện campaign PENDING → bắt đầu quá trình Discovery (xem mục 2)
```

### 0.2 Validation scope

```
scope = null  → Discovery quét toàn bộ catalog_config của cluster

scope != null → Layer 3 validate trước khi lưu:
                ① db phải tồn tại trong catalog_config → 400 nếu thiếu
                ② schema phải tồn tại trong db đó     → 400 nếu thiếu
                ③ table_names != []? → mỗi bảng phải có trong danh sách catalog_config
                   (catalog_config table_names = [] nghĩa là "toàn bộ schema" → bỏ qua ③)
```

### 0.3 Chỉnh sửa Campaign — `PUT /api/maintenance/campaigns/:id`

#### Các field được phép cập nhật theo status

| Field | PENDING | ACTIVE | EXPIRED | Ghi chú |
|---|---|---|---|---|
| `name` / `description` | ✅ | ✅ | ✅ | Luôn chỉnh được |
| `scan_times` | ✅ | ✅ | ✅ | Luôn chỉnh được |
| `scope` | ✅ | ❌ | ❌ | Chỉ khi chưa discover; re-validate vs catalog_config |
| `execution_types` | ✅ | ❌ | ❌ | Chỉ khi chưa discover |
| `thresholds` | ✅ | ✅ | ❌ | ACTIVE: áp dụng ở lần re-discovery kế tiếp |
| `window_override` | ✅ | ✅ | ❌ | ACTIVE: có hiệu lực tick kế tiếp |
| `end_date` | ✅ | ✅ | ✅ | Xem logic riêng bên dưới |

> Gửi field không hợp lệ với status hiện tại → `400`.

#### Logic cập nhật `end_date`

```
┌─ Status hiện tại = ACTIVE:
│       end_date mới > now_vn()  →  cập nhật end_date, giữ ACTIVE     (gia hạn)
│       end_date mới ≤ now_vn()  →  cập nhật end_date + status = EXPIRED  (rút ngắn)
│
├─ Status hiện tại = EXPIRED:
│       end_date mới > now_vn()  →  kiểm tra conflict:
│           Có campaign ACTIVE / DISCOVERING cùng cluster? → 409
│           Không?  →  cập nhật end_date + status = ACTIVE     (reactivate)
│       end_date mới ≤ now_vn()  →  cập nhật end_date, giữ EXPIRED
│
└─ Status khác (PENDING, DISCOVERY_FAILED, ...):
        end_date mới > start_date? → 400 nếu không
        Cập nhật end_date, không đổi status
```

#### Luồng xử lý tổng quát

```
PUT /api/maintenance/campaigns/:id
    │
    ▼ Tìm campaign theo campaign_id
    Không tìm thấy → 404
    │
    ▼ Với từng field trong body:
    ├─ name / description / scan_times
    │       → set trực tiếp
    │
    ├─ scope (chỉ khi status = PENDING)
    │       → normalizeScope() → validateScopeAgainstCatalogConfig()
    │       → 400 nếu ngoài catalog scope
    │
    ├─ execution_types (chỉ khi status = PENDING)
    │       → normalizeExecutionTypes()  (lọc giá trị không hợp lệ)
    │       → 400 nếu mảng rỗng sau khi lọc
    │
    ├─ thresholds (khi status = PENDING hoặc ACTIVE)
    │       → normalizeThresholds()  (gán default cho field bỏ trống)
    │
    ├─ window_override (khi status = PENDING hoặc ACTIVE)
    │       → set trực tiếp (null = dùng window mặc định cluster)
    │
    └─ end_date (mọi status)
            → xử lý theo logic gia hạn / rút ngắn / reactivate ở trên
    │
    ▼ updateOne({ campaign_id }) + updated_at = now
    ▼ findOne lại → trả về document đã cập nhật
```

### 0.4 Huỷ Campaign — `DELETE /api/maintenance/campaigns/:id`

```
DELETE /api/maintenance/campaigns/:id
    │
    ▼ Tìm campaign theo campaign_id
    Không tìm thấy → 404
    │
    ▼ Kiểm tra status hiện tại
    ├─ PENDING / ACTIVE / DISCOVERY_FAILED
    │       → updateOne: status = "cancelled", updated_at = now
    │       → trả về document đã cập nhật
    │
    └─ COMPLETED / EXPIRED / CANCELLED
            → 400 "Only pending, active, or discovery_failed campaigns can be cancelled"
```

> **Lưu ý:** Huỷ campaign **không** tự động terminal các work item đang OPEN trong queue.
> Item `APPROVED` / `AWAITING_APPROVAL` / `PAUSED` vẫn tồn tại trong `maintenance_queue`
> nhưng sẽ không được execute tick claim nữa (tick chỉ xử lý campaign `ACTIVE`).

---

## 1. Trạng thái Campaign

```
PENDING ──► DISCOVERING ──┬─ có item ──► ACTIVE ─────────────────────────────────────────────────┐
                          │                  │  re-discover hằng ngày khi có capture mới           │
                          └─ 0 item  ──► COMPLETED ◄── tất cả item terminal                        │
         ▲                                                                                          │
         │  (60s retry)                                                                             │
  DISCOVERY_FAILED ◄── lỗi lần đầu                                                                │
                                                                                                    │
EXPIRED ◄── end_date < now_vn()        CANCELLED ◄── DBA huỷ thủ công qua Layer 3 UI ◄────────────┘
```

Trạng thái terminal: `EXPIRED`, `CANCELLED`, `COMPLETED`. Execute tick chỉ xử lý campaign `ACTIVE`.

---

## 2. Discovery Job — `maint_discovery_{cluster_id}` (IntervalTrigger 60s)

### 2.1 Điều kiện skip

| Điều kiện | Hành động |
|---|---|
| Lock bận (cùng cluster đang có discovery chạy) | raise `TriggerBusyError` → ghi log INFO, return 0 |
| Không có campaign `PENDING`/`DISCOVERY_FAILED` (lần đầu) và không có `ACTIVE` (re-discover) | return 0 |
| `now_vn()` không nằm trong `scan_times` của campaign | return 0 |
| Cách lần trigger trước < 55 phút (`last_scan_triggered`) | return 0 (chống double-fire) |

### 2.2 Lần discover đầu tiên (`_first_discovery`)

```
PENDING / DISCOVERY_FAILED
         │
         ▼  cập nhật status
    DISCOVERING
         │
         ▼
  _run_discovery() ──┬─ sinh được ≥ 1 item ──► ACTIVE
                     └─ 0 item               ──► COMPLETED
         │ exception
         ▼
  DISCOVERY_FAILED  (job 60s tự retry)
```

### 2.3 Re-discover hằng ngày (`_maybe_rediscover`)

Điều kiện kích hoạt: campaign ACTIVE + catalog có `run_id` mới hơn `discovered_run_ids[db]` đã lưu.

```
1. Supersede item AWAITING_APPROVAL + APPROVED → status = SUPERSEDED
   (item đang RUNNING hoặc PAUSED không bị động tới)
2. _run_discovery() trên snapshot mới nhất
3. Ghi discovered_run_ids[db] = run_id mới
4. Tính lại total_items = (done + failed + skipped) + số item đang mở
```

Lỗi re-discover **không** kill campaign — giữ ACTIVE, chỉ ghi `discovery_error`.

### 2.4 `_run_discovery()` — tạo work items

```
1. Cảnh báo nếu catalog snapshot > 48 giờ tuổi
2. Expire batch và approval item quá hạn
3. Đọc table snapshot mới nhất trong scope campaign
4. Resolve EffectiveThresholds một lần cho cả run:
       campaign.thresholds (None = kế thừa) → merge với default policy

5. Mỗi bảng trong snapshot:
   ┌─ Policy enabled=False cho bảng/index? → bỏ qua toàn bộ bảng
   │
   ├─ INDEX execution type (mỗi index, mỗi partition):
   │      page_count < min_page_count                     → skip partition
   │      max_page_count set AND page_count > max_page_count → skip partition
   │      frag < reorganize_pct                           → skip partition
   │      reorganize_pct ≤ frag < rebuild_pct             → REORGANIZE
   │      frag ≥ rebuild_pct:
   │           bảng partition                             → REBUILD_PARTITION (partition số N)
   │           bảng không partition                       → REBUILD
   │
   ├─ STATISTIC execution type (mỗi stats object):
   │      modification_counter < stats_modification_threshold → skip
   │      Vượt ngưỡng                                         → UPDATE_STATISTICS
   │
   └─ HEAP execution type:
          forwarded_record_count < heap_forwarded_threshold → skip
          Vượt ngưỡng                                       → HEAP_REBUILD

6. Dedup: bỏ qua item nếu đã có item cùng
   (cluster, database, schema, table, index/stats/heap, partition) ở OPEN status

7. Ước lượng estimated_minutes:
       REORGANIZE / REBUILD / REBUILD_PARTITION → pages / MAINT_ESTIMATE_PAGES_PER_MINUTE
       UPDATE_STATISTICS / HEAP_REBUILD         → rows  / MAINT_ESTIMATE_ROWS_PER_MINUTE

8. Tính priority = page_count + policy.priority_boost

9. Insert maintenance_queue (AWAITING_APPROVAL) + maintenance_batches
10. Gửi batch approval lên Telegram (top MAINT_BATCH_TOP_N_ITEMS items, inline keyboard ✅/⛔)
```

---

## 3. Trạng thái Work Item

```
AWAITING_APPROVAL ──┬─ DBA ✅ ──► APPROVED ──────────────────────────────────────────────────────────┐
                    │                  │ claim                                                         │
                    └─ DBA ⛔ ──► REJECTED (terminal)                                                  │
                                       │                                                               │
                                       ▼                                                               │
                                   RUNNING ──┬─ thành công ──────────────────────────► DONE (terminal) │
                                             │                                                         │
                                             ├─ PAUSE error (REBUILD RESUMABLE) ──► PAUSED             │
                                             │    └─ (re-claim ưu tiên lần sau)        │               │
                                             │                                          └── re-claim ──┘
                                             │
                                             ├─ ONLINE/RESUMABLE restriction
                                             │  + offline_fallback=True
                                             │  + chưa resume lần nào (not resume_token)
                                             │       ├─ retry offline OK ──────────────► DONE (terminal)
                                             │       └─ retry offline lỗi ─► (tiếp tục logic lỗi bên dưới)
                                             │
                                             ├─ lỗi, attempts < MAINT_MAX_ATTEMPTS ──► APPROVED (retry)
                                             └─ lỗi, attempts ≥ MAINT_MAX_ATTEMPTS ──► FAILED (terminal)

SUPERSEDED (terminal) ◄── re-discover trên capture mới (chỉ AWAITING_APPROVAL + APPROVED)
EXPIRED    (terminal) ◄── hết hạn approval (MAINT_APPROVAL_EXPIRE_HOURS)
SKIPPED    (terminal) ◄── policy disabled hoặc insufficient_budget (xem mục 5.2)
```

`TERMINAL_STATUSES` = `{REJECTED, DONE, FAILED, SKIPPED, EXPIRED, SUPERSEDED}` — khi finalize,
`terminal_at` được set → TTL cleanup MongoDB tự động.

`OPEN_STATUSES` = `{AWAITING_APPROVAL, APPROVED, RUNNING, PAUSED}` — dùng cho dedup check.

---

## 4. Execute Tick — `maint_tick_{cluster_id}` (IntervalTrigger 60s)

### 4.1 Chuỗi kiểm tra (bất kỳ fail → return 0)

```
┌─ ① Health state ≠ HEALTHY?
│       STOPPING / STOPPED / RECOVERING → skip (DEBUG log)
│
├─ ② Campaign ACTIVE tồn tại?
│       expire_if_past_end_date() trước (ACTIVE + end_date ≤ now → EXPIRED)
│       Không có campaign → skip (DEBUG log)
│       Campaign status ≠ ACTIVE → skip (DEBUG log)
│
├─ ③ Window mở?
│       Campaign có window_override → WindowService.state_from_override()
│       Không → WindowService.state() (window_config + day_overrides theo weekday)
│       Window đóng hoặc budget hết → skip (DEBUG log)
│       Transition: window mới mở → clear deferred_item_ids
│
├─ ④ Primary host resolve được?
│       Không có primary trong node_roles → skip (WARNING log)
│       (node_roles refresh mỗi 30 phút từ cluster config)
│
├─ ⑤ Gate check (3 check song song — bất kỳ fail → skip):
│       CPU% > cpu_limit_pct
│       active_requests > active_requests_limit
│       AG log_send_queue > log_send_queue_limit_mb
│       AG redo_queue    > redo_queue_limit_mb
│       GateService log lý do ở INFO; tick chỉ thêm DEBUG context
│
└─ ⑥ Claim item tiếp theo:
        Ưu tiên 1: claim_paused_resumable() — PAUSED item (có resume_token)
        Ưu tiên 2: claim_next_approved() — APPROVED item (priority DESC, created_at ASC)
            Skip nếu item_id ∈ deferred_item_ids (budget đã từ chối trong window này)
            Thử tối đa 10 item (bỏ qua deferred, release về APPROVED)
        Không có item → skip (DEBUG log)
```

Sau khi claim → `_process_item(item, host, conn_str, remaining_minutes, campaign)`

---

## 5. `_process_item()` — Kiểm tra trước thực thi

### 5.1 Policy disabled

```
PolicyResolver.resolve(schema, table, index) → policy
policy.enabled = False:
    → finalize(SKIPPED)
    → ghi history(skip_reason="policy_disabled")
    → return 0
```

### 5.2 Budget admission (chỉ áp dụng với non-resumable item)

```
is_resumable_rebuild = action ∈ {REBUILD, REBUILD_PARTITION}
                       AND policy.online = True
                       AND policy.resumable = True

NOT is_resumable_rebuild AND estimated_minutes > remaining_minutes:
    → thêm item_id vào deferred_item_ids
    → release(APPROVED)  ← item vẫn APPROVED, không mất
    → ghi history(skip_reason="insufficient_budget: est Xp > remaining Yp")
    → return 0
    (deferred_item_ids bị clear khi window mở lại lần sau)

Resumable rebuild KHÔNG bị kiểm tra budget:
    → có thể bị PAUSE giữa chừng → PAUSED, resume đêm sau
```

Sau khi qua hết hai kiểm tra → `_execute_item()`

---

## 6. `_execute_item()` — Thực thi T-SQL

```
① Chọn statement:
     item.resume_token tồn tại → build_resume(item, policy, remaining_minutes)
         "ALTER INDEX [idx] ON [tbl] RESUME WITH (MAX_DURATION=N MINUTES)"
     Không → build_statement(item, policy, remaining_minutes)
         REORGANIZE         → "ALTER INDEX [idx] ON [db].[s].[t] REORGANIZE [PARTITION=N]"
         REBUILD            → "ALTER INDEX [idx] ON [db].[s].[t] REBUILD WITH (ONLINE=ON/OFF,
                               MAXDOP=N [,RESUMABLE=ON, MAX_DURATION=M MINUTES])"
         REBUILD_PARTITION  → như REBUILD nhưng WITH PARTITION=N
         UPDATE_STATISTICS  → "UPDATE STATISTICS [db].[s].[t] [stats] WITH FULLSCAN / SAMPLE N PERCENT"
         HEAP_REBUILD       → "ALTER TABLE [db].[s].[t] REBUILD PARTITION=ALL"

② DRY_RUN=True?
     → finalize(DONE)
     → ghi history(outcome=DRY_RUN, statement=<T-SQL log only>)
     → return 1  ← đếm là "thực thi" trong job_execution

③ Gửi Telegram "🔨 started" nếu estimated_minutes ≥ 15

④ Đo fragmentation trước (dm_db_index_physical_stats SAMPLED, timeout 120s)
   Chỉ đo cho INDEX_FRAG và HEAP_FORWARDED; trả về None nếu lỗi / không áp dụng

⑤ Ghi _current_item + _current_host vào state (lock) để SIGTERM / HealthMonitor có thể PAUSE

⑥ Thực thi T-SQL (pyodbc, timeout = mssql_query_timeout_sec):

   Thành công:
     → Đo fragmentation sau
     → finalize(DONE) → set terminal_at
     → ghi history(DONE, frag_before, frag_after, duration_ms)
     → increment_stats campaign (done+1)
           Nếu done+failed+skipped == total_items → campaign ACTIVE → COMPLETED
               → publisher.on_campaign_completed() → Telegram summary
     → cập nhật window_budget nếu campaign có window_override
     → gửi Telegram "✅ done" (frag trước→sau, duration)
     → return 1

   Lỗi → _handle_execute_error()

⑦ finally:
     mark_health_stopped() (STOPPING → STOPPED nếu health dang chờ)
     xoá _current_item (unlock)
```

---

## 7. `_handle_execute_error()` — Xử lý lỗi

```
① PAUSE error? (message chứa "pause" hoặc error code 3643)
   AND action ∈ {REBUILD, REBUILD_PARTITION}:
     → release(PAUSED, resume_token=True)
     → ghi history(outcome=PAUSED, frag_before, duration_ms)
     → cập nhật window_budget
     → gửi Telegram "⏸ paused"
     → return 0
     (lần tick kế, claim_paused_resumable() ưu tiên item này)

② ONLINE / RESUMABLE restriction? (message chứa "ONLINE" hoặc "RESUMABLE")
   AND policy.online=True AND policy.offline_fallback=True AND NOT item.resume_token:
     → thử lại với force_offline=True:
             "ALTER INDEX ... REBUILD WITH (ONLINE=OFF, MAXDOP=N)"
         Thành công:
             → finalize(DONE), ghi history(skip_reason="online_fallback_to_offline")
             → return 1
         Lỗi:
             → error = "offline retry failed: {e2} (original: {e1})"
             → tiếp tục xử lý như lỗi thường (bước ③)

③ Lỗi thường:
     attempts = item.attempts + 1
     attempts < MAINT_MAX_ATTEMPTS:
         → release(APPROVED, attempts=attempts, last_error=error)
         → ghi history(FAILED)
         → gửi Telegram "❌ failed (attempt N/max)"
         → return 0  ← sẽ retry lần tick kế

     attempts ≥ MAINT_MAX_ATTEMPTS:
         → finalize(FAILED, attempts, last_error) → set terminal_at
         → ghi history(FAILED)
         → increment_stats campaign (failed+1)
         → gửi Telegram "❌ failed (attempt N/max — exceeded)"
         → return 0
```

---

## 8. SIGTERM — Graceful Shutdown

Container nhận SIGTERM; `stop_grace_period: 30s` trong docker-compose cho đủ thời gian PAUSE.

```
signal handler → MaintenanceService.stop():
  ① Mỗi HealthMonitorThread.stop()
  ② Mỗi ClusterExecuteService.request_stop():
         set _stop_requested = True  (tick sẽ skip từ lần sau)
         _pause_current_rebuild("SIGTERM"):
             item đang chạy có action ∈ REBUILD?
               → "ALTER INDEX ... PAUSE"
               → release(PAUSED, resume_token=True)
  ③ NotifyQueue.stop()
  ④ scheduler.shutdown(wait=False)
  ⑤ MongoConnection.close()
```

Khi container restart (rolling update, crash, manual restart):
```
startup:
  → QueueRepo.recover_running() → orphaned RUNNING items → APPROVED (tránh mắc kẹt)
  → campaign_repo.reset_stuck_discovering() → DISCOVERING → DISCOVERY_FAILED
  → lần tick đầu: claim_paused_resumable() ưu tiên item PAUSED → RESUME T-SQL
```

---

## 9. Health Monitor — Auto-Pause / Auto-Resume

`HealthMonitorThread` chạy thread riêng song song với scheduler (mỗi `health_monitor.interval_sec`).

### Khi gate fail

```
HealthMonitorThread phát hiện gate fail liên tục:
  → execute_service.request_health_stop(reason, metrics):
         state machine (lock):
           HEALTHY → STOPPING
           RECOVERING → STOPPED   (phục hồi không thành)
         → _pause_current_rebuild("HealthMonitor"):
               item đang chạy REBUILD → ALTER INDEX ... PAUSE
         (sau _execute_item.finally → mark_health_stopped()):
           STOPPING → STOPPED

  → publisher.on_health_stop()  ← Telegram "🛑 high load"

tick_job: health_state ≠ HEALTHY → skip ngay (không claim item mới)
```

### Khi phục hồi

```
Gates trở về ngưỡng bình thường:
  → execute_service.notify_gates_recovered(): STOPPED → RECOVERING
  → confirmation pass: execute_service.confirm_recovery(): RECOVERING → HEALTHY
  → tick_job chạy lại bình thường
```

Trạng thái `HealthState`:

| State | Ý nghĩa |
|---|---|
| `HEALTHY` | Bình thường, tick chạy |
| `STOPPING` | Đang chờ execute_item hoàn thành hoặc PAUSE xong |
| `STOPPED` | Execute bị tắt, tick skip |
| `RECOVERING` | Gates phục hồi, chờ confirm tick đầu tiên |

---

## 10. Campaign COMPLETED — Kết thúc tự nhiên

```
Mỗi lần finalize item terminal (DONE/FAILED/SKIPPED):
  → campaign_repo.increment_stats(done/failed/skipped +1)
  → kiểm tra: done + failed + skipped == total_items?
       YES + status == ACTIVE → status = COMPLETED
             → publisher.on_campaign_completed(campaign, done_items)
                   → Telegram "🎉 campaign completed: N done, M failed, K skipped"
```

Nightly summary (cron `MAINT_SUMMARY_CRON`) gửi báo cáo riêng cho đêm vừa kết thúc:
counts theo outcome, danh sách bảng đã xử lý, item lỗi, budget đã dùng.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
