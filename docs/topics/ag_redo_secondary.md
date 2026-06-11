# Topic: AG Redo Lag Monitor (Secondary local)

**topic_id**: `ag_redo_secondary` | **Schedule**: 120s (2 phút) | **Nodes**: `secondary` | **Detector**: `threshold`

**Related topics**:
- [`ag_health`](ag_health.md) — AG sync state + log send queue, view từ Primary (120s)
- [`cdc_health`](cdc_health.md) — CDC capture/cleanup job status (300s)

---

## 1. Bối cảnh

Topic bổ sung cho [`ag_health`](ag_health.md) — trong khi ag_health query từ Primary để thấy tổng quan cluster, topic này chạy **cục bộ trên từng Secondary** (`is_local = 1`) để đo redo lag chính xác hơn.

**Tại sao cần topic riêng?**

| | ag_health (Primary view) | ag_redo_secondary (Secondary local) |
|---|---|---|
| Chạy trên | Primary | Từng Secondary |
| `is_local` | `0` | `1` |
| `secondary_lag_seconds` | Có giá trị | **Luôn NULL** (primary-computed) |
| `redo_lag_ms` | Không tính được | `DATEDIFF_BIG(ms, last_redone_time, last_commit_time)` |
| `last_redone_time` | Có | Có (chính xác hơn) |
| Redo queue | Có (ước lượng) | Có (chính xác — đo tại source) |

**Lưu ý quan trọng về `redo_lag_ms`:**

`DATEDIFF_BIG(MILLISECOND, last_redone_time, last_commit_time)` — đo **gap giữa log đã committed và log đã redone**:
- Secondary caught up: `last_redone_time ≈ last_commit_time` → `redo_lag_ms ≈ 0`
- Secondary có backlog: `last_redone_time` tụt sau `last_commit_time` → `redo_lag_ms` tăng
- Database idle (ít ghi): cả 2 giá trị cùng cũ → gap vẫn nhỏ → **không false positive**

> **Không dùng** `DATEDIFF_BIG(ms, last_redone_time, GETDATE())`: node đã catch up nhưng database ít ghi sẽ có `last_redone_time` cũ → lag ảo cao dù secondary hoàn toàn OK.

**Pattern quan sát thường gặp** khi có 2 secondary:
- Node A: `redo_queue_size` cao, `redo_lag_ms` thấp → redo thread đang chạy liên tục nhưng không theo kịp log đến — **node thực sự có vấn đề**
- Node B: `redo_queue_size` thấp, `redo_lag_ms` thấp → đã caught up hoàn toàn — bình thường

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện phát hiện |
|---|---|---|
| R1 | **Redo queue tích lũy** — secondary không kịp apply log | `redo_queue_size > 1000 KB` (warning) / `> 5000 KB` (critical) |
| R2 | **Redo lag tăng** — secondary trễ so với primary | `redo_lag_ms > 30000 ms` (warning) / `> 120000 ms` (critical) |
| R3 | **Data movement bị suspend tại secondary** | `is_suspended = 1` — phát hiện cục bộ, không phụ thuộc view từ Primary |
| R4 | **Lưu lịch sử redo lag** dù secondary khỏe mạnh | `emit_info_when_healthy = True` → finding `severity=INFO` cho mỗi row |

---

## 3. Metrics & Thresholds

### Query `redo_state_local` — Redo state tại secondary (`is_local = 1`)

| Metric | Warning | Critical | Ý nghĩa |
|---|---|---|---|
| `redo_queue_size` (KB) | 1000 | 5000 | Log đã nhận từ primary nhưng chưa apply. Tăng = redo thread không theo kịp |
| `redo_lag_ms` (ms) | 30 000 | 120 000 | `DATEDIFF_BIG(ms, last_redone_time, last_commit_time)` — độ trễ thực giữa committed và redone |
| `is_suspended` (0/1) | 1 | 1 | Data movement suspend tại local secondary. Xem `suspend_reason_desc` |

**Fields bổ sung** (không có threshold, context quan trọng cho `/analyze`):

| Field | Ý nghĩa |
|---|---|
| `redo_rate` (KB/s) | Kết hợp `redo_queue_size` → ước tính thời gian clear queue: `queue / rate` giây |
| `synchronization_state_desc` | `NOT SYNCHRONIZING` = sync dừng hẳn |
| `synchronization_health_desc` | `NOT_HEALTHY` / `PARTIALLY_HEALTHY` = cần điều tra |
| `suspend_reason_desc` | `USER` = tắt thủ công; `REDO`/`APPLY` = redo thread bị block |
| `last_redone_time` | Thời điểm redo thread apply log record cuối — hỗ trợ phân tích khi nào redo dừng |
| `last_commit_time` | Thời điểm commit cuối được apply — dùng để tính `redo_lag_ms` |
| `replica_server_name` | Tên secondary node (context khi findings từ nhiều node) |

**issue_type mapping**:

| Metric vi phạm | issue_type | Skill Layer 2 |
|---|---|---|
| `redo_queue_size`, `redo_lag_ms`, `is_suspended` | `ag_lag` | `ag.yaml` |

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 120s)                            │
│                                                                  │
│  MongoDB monitor_topics["ag_redo_secondary"]                    │
│    └── scheduler.py → topic_runner.run("ag_redo_secondary")     │
│                                                                  │
│  1. Resolve nodes: ["secondary"] → [SQL-NODE-02, SQL-NODE-03]   │
│     (node_role_cache — auto-detect, refresh mỗi giờ)           │
│                                                                  │
│  2. Execute parallel: redo_state_local trên mỗi secondary       │
│     (is_local=1, chỉ thấy replica cục bộ)                      │
│                                                                  │
│  3. raw_metrics_repo.insert_many()                              │
│                                                                  │
│  4. ThresholdDetector.detect()                                  │
│     ├── Vi phạm threshold → Finding(severity=WARNING/CRIT)      │
│     │    issue_type = "ag_lag"                                   │
│     └── Healthy → Finding(severity=INFO)                        │
│          vì emit_info_when_healthy=True (lưu history redo lag)  │
│                                                                  │
│  5. findings_repo.insert_one() — per secondary node             │
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
                         ▼ GET /api/findings?topic=ag_redo_secondary
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "ag_redo_secondary" (layout riêng, không dùng      │
│  chung với ag_health)                                           │
│                                                                  │
│  Table columns:                                                  │
│  No | ID | Time | Role+Node | Database | Replica | Severity     │
│  | Sync State | Sync Health | Suspended                         │
│  | Redo Queue | Redo Rate | Lag(ms) / Last Redone | Last Commit │
│  | AI Analyses | Action                                          │
│                                                                  │
│  Không có: Connected, Failover Ready                            │
│  (is_local=1 không trả connected_state_desc, is_failover_ready) │
│                                                                  │
│  Detail modal: renderAgHealthModal (dùng chung renderer)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **`redo_lag_ms` = `DATEDIFF_BIG(ms, last_redone_time, last_commit_time)`** | Đo gap thực giữa committed và redone. Không false positive khi database idle (khác với `DATEDIFF vs GETDATE()`) |
| **Không dùng `secondary_lag_seconds` từ DMV** | Field này luôn NULL khi `is_local=1` — đây là giá trị primary-computed, không có tại secondary |
| **`DATEDIFF_BIG` thay vì `DATEDIFF`** | `DATEDIFF(MILLISECOND, ...)` overflow sau ~24 ngày. `DATEDIFF_BIG` (SQL Server 2016+) không bị giới hạn này |
| **Layout key `"ag_redo_secondary"` riêng** | Cột khác ag_health: không có Connected/Failover Ready, có Redo Queue/Rate/Lag. Dùng chung tạo cột luôn trống |
| **Nodes = ["secondary"]** | Chỉ secondary có `is_local=1` row. Chạy trên primary trả kết quả rỗng |
| **`emit_info_when_healthy=True`** | Lưu time-series redo lag — cho phép trending "secondary X thường lag lúc nào trong ngày?" |
| **Không có `capture_tools`** | Redo lag analysis đủ qua `get_ag_status`. Snapshot T+0 không thêm giá trị |
| **Datetime fields (`last_redone_time`, `last_commit_time`) serialize thành ISO string** | `query_executor._sanitize_value()` convert `datetime.datetime → isoformat()` — đảm bảo pass `isinstance(..., str)` filter trong `ThresholdDetector` và JSON-serializable |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- Node roles phải qua `node_role_cache` — không hardcode hostname
- Không đặt threshold `log_send_queue_size` tại đây — concern của `ag_health` (Primary view)

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_ag_redo_secondary()` | Topic config: SQL, thresholds, nodes, analysis_config |
| L1 Detector | `layer1/detectors/threshold_detector.py` | Evaluate `redo_queue_size`, `redo_lag_ms`, `is_suspended` |
| L1 Executor | `layer1/executor/query_executor.py` → `_sanitize_value()` | Convert `datetime → ISO string` agar `last_redone_time`/`last_commit_time` được lưu vào findings |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_AG_REDO_SECONDARY` | topic_id constant |
| L2 Skill | `layer2/skills/ag.yaml` | Specialization + tools cho `ag_lag` (dùng chung với ag_health) |
| L3 Layout | `layer3/apps/web/dashboard/topics/layout-registry.ts` → `ag_redo_secondary` entry | Table columns + `renderAgRedoSecondaryFindingRow` |
| L3 Renderer | `layer3/apps/web/dashboard/topics/ag-health-detail.ts` → `renderAgHealthModal` | Detail modal (dùng chung renderer với ag_health) |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `"ag_redo_secondary"` → layout key `"ag_redo_secondary"` |
| L3 Glossary | `layer3/apps/web/dashboard/glossary.ts` | AG terms: `redo_queue_size`, `redo_rate`, `last_redone_time`, ... |
