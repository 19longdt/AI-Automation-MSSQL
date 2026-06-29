# Maintenance Runner — Background Jobs

## Per-cluster (mỗi cụm MSSQL đăng ký 4 jobs)

| Job ID | Trigger | Làm gì |
|---|---|---|
| `maint_catalog_{cluster_id}` | Cron `MAINT_CATALOG_CRON` (default `0 6 * * *` = 06:00 VN) | Snapshot toàn bộ bảng/index/stats/heap theo scope đã config → ghi vào `maintenance_catalog` |
| `maint_discovery_{cluster_id}` | Interval 60s | So snapshot catalog mới nhất với ngưỡng của từng campaign → sinh work item vào `maintenance_queue`. Chỉ thực sự chạy discovery nếu đúng `scan_times` của campaign |
| `maint_tick_{cluster_id}` | Interval `MAINT_TICK_SEC` (default 60s) | Trong window đêm: gates → claim 1 item đã approve → chạy T-SQL (REBUILD/REORG/UPDATE STATS/HEAP) → ghi `maintenance_history` |
| `maint_summary_{cluster_id}` | Cron `MAINT_SUMMARY_CRON` (default `30 5 * * *` = 05:30 VN) | Tổng kết đêm qua, gửi Telegram |

## Global (2 jobs, không theo cluster)

| Job ID | Trigger | Làm gì |
|---|---|---|
| `command_poll` | Interval 30s | Poll `maintenance_commands` → claim command `run_catalog`/`run_discovery` do Layer 3 insert → trigger in-process tương ứng |
| `health_check` | Interval 120s | Kiểm tra `job_executions` xem có job nào bị MISSED (không chạy quá lâu so với interval dự kiến) → log WARNING |

## Threads ngoài scheduler

| Thread | Interval | Làm gì |
|---|---|---|
| `HealthMonitorThread` (`health-{cluster_id}`) | `health_monitor.interval_sec` (default 30s từ window config) | 24/7 kiểm tra gates (CPU / active sessions / AG send+redo queue) → nếu fail + đang có job chạy → `request_health_stop` + Telegram alert |
| `MaintenanceBot` | Long-poll Telegram | Poll Telegram callback updates → DBA bấm ✅/⛔ trên batch approval → ghi `maintenance_queue` |

---

## Log tương ứng

Format: `2026-06-29T06:00:01 INFO     [trace_id] maintenance.catalog.catalog_service - ...`

| Event | Level | Message pattern |
|---|---|---|
| Catalog bắt đầu | INFO | `Catalog run started for cluster=...` |
| Catalog xong | INFO | `Catalog run complete: X tables captured` |
| Discovery skip (sai giờ scan) | DEBUG | `Discovery: campaign=... not in scan window` |
| Discovery tạo items | INFO | `Discovery: created N work items for campaign=...` |
| Discovery supersede | INFO | `Re-discovery: superseded N un-executed item(s)` |
| Tick skip (ngoài window) | DEBUG | `Tick: outside maintenance window` |
| Tick claim item | INFO | `Executing item: action=REBUILD table=... partition=...` |
| Tick done | INFO | `Item done: duration=...ms frag_before=... frag_after=...` |
| Tick failed | ERROR | `Item failed attempt=.../...` |
| Health gate fail | WARNING | `HealthMonitor: stop requested cluster=... reason=...` |
| Health recover | INFO | `HealthMonitor: gates recovered...` |
| Job MISSED | WARNING | `Health: job maint_tick_... missed (last run ...s ago, expected ...s)` |
| APScheduler success chatter | DEBUG | downgrade từ INFO bởi `SchedulerSuccessLogFilter` — chỉ thấy khi `LOG_LEVEL=DEBUG` |
