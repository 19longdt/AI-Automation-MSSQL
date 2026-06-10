# Topic: CDC Health Monitor

**topic_id**: `cdc_health` | **Schedule**: 300s (5 phút) | **Nodes**: `primary` | **Detector**: `threshold`

**Related topics**:
- [`ag_health`](ag_health.md) — AG replica sync state (tách ra từ đây)
- [`tempdb_memory`](tempdb_memory.md) — TempDB pressure do CDC failure gây ra

---

## 1. Bối cảnh

**Change Data Capture (CDC)** là feature theo dõi thay đổi row-level trên các bảng được bật CDC. Hai SQL Agent job chạy liên tục:
- `cdc.<db>.capture` — đọc transaction log, ghi vào change tables
- `cdc.<db>.cleanup` — dọn dẹp change tables cũ theo retention policy

Khi CDC job fail, SQL Server không thể release version store trong TempDB (các snapshot transaction cũ bị giữ lại) → TempDB phình to, ảnh hưởng workload toàn server. Đồng thời capture latency tăng, downstream consumers (ETL, replication) nhận data trễ.

Topic này tách riêng khỏi `ag_health` vì:
- Concern hoàn toàn độc lập — CDC dùng `msdb.dbo.sysjobhistory`, không phải AG DMV
- Schedule 300s phù hợp (AG cần 120s vì failover risk, CDC không cần sub-minute detection)
- Skill Layer 2 khác nhau (`cdc.yaml` vs `ag.yaml`)

**Đặc thù hệ thống:**
- CDC enabled trên database chính → CDC fail kéo TempDB pressure theo
- Resource Governor: CDC scan có thể cạnh tranh CPU pool với workload chính nếu pool không được cấu hình đúng

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện phát hiện |
|---|---|---|
| G1 | **CDC job thất bại** — capture/cleanup không chạy được | `cdc_job_failed = 1` (derived từ `run_status = 0`) |
| G2 | **CDC job retry liên tục** — dấu hiệu instability trước khi fail hoàn toàn | `cdc_job_retry >= 1` (warning) / `>= 2` (critical) |

---

## 3. Metrics & Thresholds

### Query `cdc_jobs` — CDC job history (msdb, today only)

`run_status` là enum (`0=Failed, 1=Succeeded, 2=Retry, 3=Cancelled`) — không phải thang liên tục, không đặt threshold trực tiếp trên enum. Detector dùng hai boolean derived:

| Metric | Warning | Critical | Ý nghĩa |
|---|---|---|---|
| `cdc_job_failed` (0/1) | 1 | 1 | `run_status=0 → cdc_job_failed=1`. Job fail = version store không được dọn → TempDB pressure. Warning=Critical vì bất kỳ failure nào cũng cần xem xét |
| `cdc_job_retry` (0/1) | 1 | 2 | `run_status=2 → cdc_job_retry=1`. Retry liên tục = sắp fail hoàn toàn |

**Fields bổ sung** (không có threshold, context cho `/analyze`):

| Field | Khi nào đáng chú ý |
|---|---|
| `job_name` | Phân biệt capture job (`cdc.db.capture`) vs cleanup job (`cdc.db.cleanup`) |
| `run_duration` | Duration dài bất thường = transaction log lớn hoặc resource contention |
| `message` | Error message cụ thể — quan trọng nhất để diagnose nguyên nhân |
| `run_date`, `run_time` | Xác định thời điểm fail, đối chiếu với peak hours |

**issue_type mapping**:

| Metric vi phạm | issue_type | Skill Layer 2 |
|---|---|---|
| `cdc_job_failed`, `cdc_job_retry` | `cdc_failure` | `cdc.yaml` |

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 300s)                            │
│                                                                  │
│  MongoDB monitor_topics["cdc_health"]                           │
│    └── scheduler.py → topic_runner.run("cdc_health")            │
│                                                                  │
│  1. Resolve nodes: ["primary"] → [SQL-NODE-01]                  │
│     (node_role_cache — auto-detect, refresh mỗi giờ)           │
│                                                                  │
│  2. Execute: cdc_jobs                                            │
│     (msdb.dbo.sysjobs JOIN sysjobhistory, WHERE today only)     │
│                                                                  │
│  3. raw_metrics_repo.insert_many()                              │
│                                                                  │
│  4. ThresholdDetector.detect()                                  │
│     ├── cdc_job_failed=1 → Finding(severity=WARNING/CRIT)       │
│     │    issue_type = "cdc_failure"                              │
│     └── cdc_job_retry≥1 → Finding(severity=WARNING/CRIT)        │
│          issue_type = "cdc_failure"                              │
│                                                                  │
│  5. findings_repo.insert_one()                                   │
│  6. Dedup (30 phút) → Telegram alert                            │
│                                                                  │
│  NOTE: capture_tools = [] → không trigger DiagnosticCapture     │
│  NOTE: KHÔNG có emit_info_when_healthy — CDC succeed mỗi 5      │
│  phút không cần lưu history (khác với AG sync state)            │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  Skill: cdc.yaml (skill_id: cdc_v1)                             │
│  issue_type: cdc_failure                                        │
│                                                                  │
│  model: claude-haiku-4-5-20251001                               │
│  max_tool_rounds: 3 | max_tokens: 1500 | max_cost: $0.05        │
│                                                                  │
│  Required tools: get_cdc_status                                  │
│  Optional tools: get_tempdb_usage, get_wait_stats,              │
│                  get_query_stats                                 │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic=cdc_health
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "cdc_health" (riêng, không dùng ag_health)         │
│                                                                  │
│  Table columns:                                                  │
│  No | ID | Time | Node | Severity | Job | Status                │
│  | AI Analyses | Action                                          │
│                                                                  │
│  Detail modal: reuse renderAgHealthModal (ag-health-detail.ts)  │
│  → isCdc branch kích hoạt khi issue_type="cdc_failure"          │
│     hoặc has(metrics, "job_name")                                │
│  CDC section hiển thị: Job name | Run Status | Duration         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **Tách khỏi `ag_health`** | CDC dùng msdb (không phải AG DMV), skill khác, schedule khác — gộp chung làm mờ ranh giới concern và khó tune riêng |
| **Schedule 300s thay vì 120s** | CDC failure không cần sub-minute detection (khác AG suspend có failover risk). 5 phút đủ để alert kịp thời |
| **`cdc_job_failed` / `cdc_job_retry` là boolean derived** | `run_status` là enum, không phải thang liên tục. Threshold detector hoạt động theo "giá trị cao = xấu" — cần boolean để `warning=1` hoạt động đúng |
| **KHÔNG có `emit_info_when_healthy`** | CDC succeed mỗi 5 phút không có giá trị lưu history (khác AG sync state — DBA cần biết replica đang ở trạng thái nào mỗi lúc) |
| **Reuse `renderAgHealthModal` ở Layer 3** | Renderer đã có `isCdc` branch handle CDC fields đúng. Tạo renderer mới = duplicate code không cần thiết |
| **Layout key riêng `cdc_health`** | Header table cần "Job \| Status" thay vì "Sync State \| Lag" — không thể share layout với ag_health mà giữ header đúng |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- Node roles phải qua `node_role_cache`

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_cdc_health()` | Topic config: SQL, thresholds, analysis_config |
| L1 Detector | `layer1/detectors/threshold_detector.py` | Evaluate `cdc_job_failed`, `cdc_job_retry` |
| L1 Capture tool | `layer1/seed/seed_capture_tools.py` → `_get_cdc_status()` | Tool definition cho Layer 2 agent |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_CDC_HEALTH` | topic_id constant |
| L2 Skill | `layer2/skills/cdc.yaml` | Specialization + tools cho `cdc_failure` |
| L3 Layout | `layer3/apps/web/dashboard/topics/layout-registry.ts` → `cdc_health` entry + `renderCdcHealthFindingRow` | Table columns + row renderer |
| L3 Renderer | `layer3/apps/web/dashboard/topics/ag-health-detail.ts` → `renderAgHealthModal` (isCdc branch) | Detail modal reuse |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `cdc_health` → layout `cdc_health` |
