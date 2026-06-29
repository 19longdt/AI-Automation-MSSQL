# Upgrade Maintenance — Tổng quan

Tài liệu này tóm tắt 4 nhóm thay đổi bổ sung cho maintenance service sau khi campaign feature đã được implement.

---

## Phạm vi thay đổi

| # | Tên | File plan | Độ phức tạp | Phụ thuộc |
|---|---|---|---|---|
| 1 | Catalog Job — snapshot schema/table/index/stats | `plan-01-catalog-job.md` | Medium | Độc lập |
| 2 | Campaign Scope & Window Config | `plan-02-campaign-scope-window.md` | High | Phụ thuộc #1 (catalog làm data source) |
| 3 | Telegram Per-item Notifications | `plan-03-telegram-notify.md` | Low-Medium | Độc lập |
| 4 | Mid-execution Health Monitor | `plan-04-health-monitor.md` | Medium | Độc lập |

**Thứ tự triển khai khuyến nghị:** 01 → 03 → 04 → 02

> Lý do: ổn định schema `maintenance_catalog` (plan-01) trước khi build campaign scope/UI (plan-02).
> Plan-03 và 04 độc lập với catalog nên triển khai sớm được.

---

## Tóm tắt từng yêu cầu

### #1 — Catalog Job

Job mới chạy mỗi sáng (cron config), thu thập snapshot theo **phạm vi cấu hình** (không scan mù toàn DB):
- DBA cấu hình scope trong `maintenance_catalog_config`: db → schema → tables[]
- Chạy **per-table song song** (ThreadPoolExecutor) — fault isolated, timeout per table
- Thu thập: row count, indexes (frag%, page count), statistics (modification_counter), heap forwarded count
- Lưu vào `maintenance_catalog` — nguồn dữ liệu duy nhất cho campaign

**Bổ sung:** Campaign được config `execution_types: list["index" | "statistic" | "heap"]` — discovery chỉ tạo work items tương ứng với loại được chọn. Mặc định: cả 3.

---

### #2 — Campaign Scope & Window Config

**Kiến trúc thay đổi quan trọng:** Campaign discovery **không còn chạy DMV scan live**. Thay vào đó:
- DBA tạo campaign → chọn db/schema/tables từ **catalog data** (snapshot sáng cùng ngày)
- Discovery đọc từ `maintenance_catalog` → apply policy thresholds → tạo work items (seconds thay vì phút/giờ)
- UI CampaignForm hiển thị frag%, stale stats, heap issue trực tiếp từ catalog để DBA quyết định

**Window override per campaign:** Campaign có thể định nghĩa window thực thi riêng (start/end time, budget) thay vì dùng global window. Cho phép chạy ban ngày nếu DBA cấu hình.

**Default window seed:** Đổi từ 01:00–04:00 thành 02:30–05:00.

---

### #3 — Telegram Per-item Notifications

Thông báo Telegram theo từng work item:
- **Bắt đầu:** action type, table/index, ước tính thời gian
- **Hoàn thành:** kết quả DONE/FAILED/PAUSED, frag before→after, duration
- **Lỗi/dừng:** nội dung lỗi chi tiết, lý do dừng

SKIPPED không notify (tránh spam). Thêm notify khi health monitor dừng job (xem #4).

---

### #4 — Mid-execution Health Monitor

`HealthMonitorThread` per cluster (daemon thread), check CPU/active requests/AG queue mỗi N giây (config, default 30s) bằng ngưỡng riêng từ `health_monitor` config — **không dùng chung** gate config của tick.

State machine 4 trạng thái (`HEALTHY → STOPPING → STOPPED → RECOVERING → HEALTHY`):
- Gate fail → `STOPPING`: nếu đang REBUILD resumable → PAUSE ngay; loại khác → chờ item hiện tại xong rồi → `STOPPED`
- Tick kế tiếp: bỏ qua nếu state không phải `HEALTHY`
- Gates hồi phục: `STOPPED → RECOVERING` (cycle 1) → `HEALTHY` (cycle 2, xác nhận ổn định)
- Notify Telegram 1 lần duy nhất khi transition `HEALTHY → STOPPING`

Host lấy qua `execute_service.get_primary_host()` — dùng chung node role cache với execute tick (plan-02), không có stale snapshot riêng.

Ngưỡng config trong `maintenance_window.health_monitor`, đọc động mỗi interval — không cần redeploy.

---

## Các collection MongoDB thay đổi

| Collection | Thay đổi |
|---|---|
| `maintenance_catalog_config` | **Mới** — scope config: cluster → db → schema → tables[] |
| `maintenance_catalog` | **Mới** — snapshot per-table: row count, indexes, stats, heap |
| `maintenance_campaigns` | Thêm field: `execution_types`, `scope`, `window_override` |
| `maintenance_window` | Thêm field: `health_monitor` (interval_sec + thresholds) |

## Files thay đổi chính

**Python (maintenance/):**

| File | Trạng thái | Ghi chú |
|---|---|---|
| `models/campaign.py` | Sửa | Thêm `CampaignScope`, `CampaignWindowOverride` value objects + validators; `execution_types`, `window_budget_used_minutes` |
| `models/window.py` | Sửa | Thêm `HealthMonitorConfig` block |
| `discovery/discovery_service.py` | **Mới** (rename từ `scan/scan_service.py`) | Đọc từ catalog thay vì DMV scan; filter scope + execution_types |
| `execute/execute_service.py` | Sửa | Window override; `HealthState` machine; `get_primary_host()` public; node role refresh (plan-02) |
| `notify/event_publisher.py` | **Mới** | `MaintenanceEventPublisher` ABC — port interface |
| `notify/maintenance_notifier.py` | Sửa | Adapter implements `MaintenanceEventPublisher`; `_fmt_*` helpers; async via `NotifyQueue` |
| `notify/notify_queue.py` | **Mới** | Background thread gửi Telegram bất đồng bộ |
| `safety/health_state.py` | **Mới** | `HealthState` enum (HEALTHY/STOPPING/STOPPED/RECOVERING) |
| `safety/health_monitor.py` | **Mới** | `HealthMonitorThread`; dùng `execute_service.get_primary_host()`; build gate từ `HealthMonitorConfig` |
| `runner.py` | Sửa | Catalog job; health monitor thread per cluster; stop order |
| `repositories/catalog_repo.py` | **Mới** | CRUD + `find_for_campaign()` |
| `catalog/catalog_service.py` | **Mới** | Snapshot per-table song song (ThreadPoolExecutor) |

> `scan/scan_service.py` và `scan/` directory bị xóa sau khi move xong (plan-02 section 9).
> `maintenance_scan_queries` collection — đánh dấu obsolete, xóa sau ổn định (plan-01 section 13).

**Layer 3 API:**

| File | Trạng thái | Ghi chú |
|---|---|---|
| `routes/catalog.ts` | **Mới** | GET catalog data + config |
| `services/catalog-service.ts` | **Mới** | Query MongoDB catalog |
| `services/campaign-service.ts` | Sửa | Thêm scope/window_override/execution_types; scope validation vs catalog_config |

**Layer 3 UI:**

| File | Trạng thái | Ghi chú |
|---|---|---|
| `pages/MaintenancePage.tsx` | Sửa | Thêm tab Catalog |
| `components/maintenance/CatalogView.tsx` | **Mới** | Hiển thị catalog + config panel |
| `components/maintenance/CampaignForm.tsx` | Sửa | Scope selector từ catalog; window override; execution_types |
| `types/index.ts` | Sửa | `CampaignScope*`, `CampaignWindowOverride`, `CatalogStatus`, `ExecutionType` |
