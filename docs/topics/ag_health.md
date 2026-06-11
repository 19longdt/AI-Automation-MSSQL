# Topic: AG Health Monitor

**topic_id**: `ag_health` | **Schedule**: 120s (2 phút) | **Nodes**: `primary` | **Detector**: `threshold`

**Related topics**:
- [`ag_redo_secondary`](ag_redo_secondary.md) — redo lag local trên từng secondary (120s)
- [`cdc_health`](cdc_health.md) — CDC capture/cleanup job status (300s)

---

## 1. Bối cảnh

**Always On Availability Groups (AG)** là cơ chế HA/DR của cụm. Primary liên tục gửi log transactions sang các Secondary (synchronous commit). Nếu quá trình đồng bộ gặp sự cố — secondary bị treo redo, log send queue tích lũy, hoặc data movement bị suspend — hệ thống mất khả năng failover an toàn và các query đọc trên secondary trả data cũ.

Topic này query **từ góc nhìn Primary** (`is_local = 0`) để thấy trạng thái tất cả replica trong một lần query. CDC job status đã tách sang topic [`cdc_health`](cdc_health.md) vì là concern độc lập với schedule khác.

**Đặc thù hệ thống:**
- Cụm 1 Primary + 2 Secondary, synchronous commit → `is_failover_ready = 0` trên bất kỳ secondary nào là rủi ro ngay lập tức
- Redo lag chi tiết đo cục bộ trên secondary bởi topic [`ag_redo_secondary`](ag_redo_secondary.md) (`is_local=1`) — chính xác hơn view từ Primary

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện phát hiện |
|---|---|---|
| G1 | **AG sync bị treo** — data movement dừng hoàn toàn | `is_suspended = 1` trên bất kỳ replica/database nào |
| G2 | **Log send queue tích lũy** — primary gửi log chậm hoặc secondary nhận chậm | `log_send_queue_size > 500 KB` (warning) / `> 1000 KB` (critical) |
| G3 | **Failover không an toàn** — secondary không sẵn sàng nhận vai Primary | Qua `connected_state_desc`, `synchronization_health_desc`, `is_failover_ready` (context, không threshold) |
| G4 | **Lưu lịch sử trạng thái AG** dù replica khỏe mạnh | `emit_info_when_healthy = True` → finding `severity=INFO` cho mỗi replica |

---

## 3. Metrics & Thresholds

### Query `ag_sync_state` — AG replica state (view từ Primary, `is_local = 0`)

| Metric | Warning | Critical | Ý nghĩa |
|---|---|---|---|
| `log_send_queue_size` (KB) | 500 | 1000 | Log chưa gửi đến secondary. Kết hợp với `log_send_rate` để ước tính thời gian resolve |
| `is_suspended` (0/1) | 1 | 1 | Data movement bị suspend. Luôn CRITICAL — suspend luôn nghiêm trọng. Xem `suspend_reason_desc` để biết nguyên nhân |

**Fields bổ sung** (không có threshold, context quan trọng cho `/analyze`):

| Field | Khi nào đáng chú ý |
|---|---|
| `synchronization_state_desc` | `NOT SYNCHRONIZING` = sync đã dừng hẳn |
| `synchronization_health_desc` | `NOT_HEALTHY` / `PARTIALLY_HEALTHY` = cần điều tra |
| `connected_state_desc` | `DISCONNECTED` = secondary rớt khỏi cluster |
| `operational_state_desc` | `FAILED` / `PENDING` = replica không hoạt động |
| `is_failover_ready` | `0` = không thể failover an toàn |
| `suspend_reason_desc` | `USER` = DBA tắt thủ công; `REDO`/`APPLY` = overflow redo thread |
| `log_send_rate` (KB/s) | Kết hợp với `log_send_queue_size` → ước tính thời gian giải quyết |
| `redo_queue_size` (KB) | Có trong query nhưng không đặt threshold tại đây — xem topic `ag_redo_secondary` |
| `redo_rate` (KB/s) | Có trong query, dùng làm context cho `/analyze` |

> **Lưu ý:** `last_commit_time` luôn `NULL` khi query với `is_local = 0` (primary-side view của secondary replica) — không hiển thị trên dashboard và không dùng làm metric.

**issue_type mapping**:

| Metric vi phạm | issue_type | Skill Layer 2 |
|---|---|---|
| `log_send_queue_size`, `is_suspended` | `ag_lag` | `ag.yaml` |

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 120s)                            │
│                                                                  │
│  MongoDB monitor_topics["ag_health"]                            │
│    └── scheduler.py → topic_runner.run("ag_health")             │
│                                                                  │
│  1. Resolve nodes: ["primary"] → [SQL-NODE-01]                  │
│     (node_role_cache — auto-detect, refresh mỗi giờ)           │
│                                                                  │
│  2. Execute: ag_sync_state                                       │
│     (is_local=0, view toàn bộ cluster từ Primary)               │
│                                                                  │
│  3. raw_metrics_repo.insert_many()                              │
│                                                                  │
│  4. ThresholdDetector.detect()                                  │
│     ├── Vi phạm threshold → Finding(severity=WARNING/CRIT)      │
│     │    issue_type = "ag_lag"                                   │
│     └── Healthy → Finding(severity=INFO)                        │
│          vì emit_info_when_healthy=True (lưu history)            │
│                                                                  │
│  5. findings_repo.insert_one()                                   │
│  6. Dedup (30 phút) → Telegram alert nếu WARNING/CRITICAL       │
│                                                                  │
│  NOTE: capture_tools = [] → không trigger DiagnosticCapture     │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  Skill: ag.yaml (skill_id: ag_v1)                               │
│  issue_type: ag_lag                                              │
│                                                                  │
│  model: claude-haiku-4-5-20251001                               │
│  max_tool_rounds: 3 | max_tokens: 1500 | max_cost: $0.05        │
│                                                                  │
│  Required tools: get_ag_status                                   │
│  Optional tools: get_wait_stats, get_query_stats,               │
│                  get_resource_governor_stats                     │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic=ag_health
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "ag_health"                                        │
│                                                                  │
│  Table columns:                                                  │
│  No | ID | Time | Role+Node | Database | Replica | Severity     │
│  | Sync State | Sync Health | Connected | Suspended             │
│  | Failover Ready | Log Send Queue | Log Send Rate              │
│  | AI Analyses | Action                                          │
│                                                                  │
│  Detail modal (renderAgHealthModal):                            │
│  ┌── Status header: replica + role + health pills               │
│  ├── KPI: Sync Health | Log Send Queue | Redo Queue | Lag       │
│  ├── Sync section: role/state/connected/operational             │
│  ├── Lag section: log_send_queue/rate, redo_queue/rate          │
│  └── Suspend section: is_suspended + reason + failover_ready    │
│                                                                  │
│  Nút ? trên mỗi label → glossary tooltip (13 AG terms)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **Query từ Primary (`is_local=0`)**, chỉ nodes=["primary"] | 1 query từ Primary thấy tất cả replica. Secondary-local view dành riêng cho `ag_redo_secondary` |
| **Tách `cdc_health` thành topic riêng** | CDC là concern độc lập (msdb jobs, không phải AG DMV), schedule 300s thay vì 120s, skill khác |
| **`emit_info_when_healthy=True`** | Lưu time-series lịch sử trạng thái AG — cho phép phân tích xu hướng "replica X thường PARTIALLY_HEALTHY lúc nào?" |
| **Không có `capture_tools`** | AG lag không cần T+0 snapshot. Agent tự query qua `get_ag_status` khi cần |
| **Skill dùng Haiku thay vì Sonnet** | AG lag reasoning đơn giản, nhanh hơn 5× và rẻ hơn 15× |
| **KHÔNG đặt threshold `redo_queue_size` ở topic này** | Đo chính xác hơn tại secondary local (topic `ag_redo_secondary`). Đặt ở đây tạo duplicate alert |
| **Layout key riêng, không dùng chung với `ag_redo_secondary`** | 2 topics có cột khác nhau hoàn toàn: ag_health có Connected/Failover Ready/Log Send; ag_redo_secondary có Redo Queue/Redo Rate/Lag |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- Node roles phải qua `node_role_cache` — không hardcode hostname

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_ag_health()` | Topic config: SQL, thresholds, nodes, analysis_config |
| L1 Detector | `layer1/detectors/threshold_detector.py` | Evaluate `log_send_queue_size`, `is_suspended` |
| L1 Capture tool | `layer1/seed/seed_capture_tools.py` → `_get_ag_status()` | Tool definition cho Layer 2 agent |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_AG_HEALTH` | topic_id constant |
| L2 Skill | `layer2/skills/ag.yaml` | Specialization + tools cho `ag_lag` |
| L3 Layout | `layer3/apps/web/dashboard/topics/layout-registry.ts` → `ag_health` entry | Table columns + `renderAgHealthFindingRow` |
| L3 Renderer | `layer3/apps/web/dashboard/topics/ag-health-detail.ts` → `renderAgHealthModal` | Detail modal |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `"ag_health"` → layout key `"ag_health"` |
| L3 Glossary | `layer3/apps/web/dashboard/glossary.ts` | 13 AG terms: `is_suspended`, `log_send_queue_size`, ... |
