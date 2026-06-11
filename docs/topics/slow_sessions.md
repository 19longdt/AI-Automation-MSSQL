# Topic: Slow Query / Active Sessions

**topic_id**: `slow_sessions` | **Schedule**: 300s (5 phút) | **Nodes**: `all` | **Detector**: `threshold`

**Related topics**:
- [`blocking`](blocking.md) — blocking chain chuyên sâu, head-blocker-centric (60s)
- [`deadlock`](deadlock.md) — deadlock events từ XEvent (300s)

---

## 1. Bối cảnh

Topic capture **active sessions đang chạy** tại thời điểm check với `elapsed_seconds` vượt ngưỡng. Khác với `blocking` (tập trung head blocker và chain structure), topic này cung cấp **full context của từng slow session**: execution plan (cả compile plan và runtime actual plan), blocking info inline, và SQL text.

**Đặc điểm chính:**
- Real-time snapshot — không phải historical query. Session hoàn thành trước 5 phút sẽ không bị capture
- `TOP 10 ORDER BY elapsed_seconds DESC` — chỉ 10 session chậm nhất tại mỗi lần check
- Có cả `query_plan_xml` (compile plan từ cache) lẫn `actual_plan_xml` (runtime plan qua `dm_exec_query_statistics_xml`) — Layer 3 cho phép xem và analyze cả 2

**Exclusions được hardcode trong SQL** (production-specific):
- `login_name != 'HDDT\sqleasypos'` — system user nội bộ
- `host_name != 'EASYPOS-DB1'` — node hệ thống khác

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện |
|---|---|---|
| S1 | **Query chạy chậm** — vượt ngưỡng thời gian | `elapsed_seconds ≥ 30` (warning) / `≥ 300` (critical) |
| S2 | **Blocking context inline** | `blocking_session_id > 0` lưu trong metrics — không raise threshold riêng, là enrichment |
| S3 | **Head blocker detection** | `is_head_blocker = 1` khi session đang bị block bởi người khác nhưng chính nó cũng block người khác |

---

## 3. Query `active_slow_sessions`

`TOP 10` active sessions (`session_id > 50`, `is_user_process = 1`) ordered by `elapsed_seconds DESC`.

### Session metrics

| Field | Ý nghĩa |
|---|---|
| `session_id` | Session ID |
| `elapsed_seconds` | `total_elapsed_time / 1000.0` — threshold field |
| `cpu_time_seconds` | `cpu_time / 1000.0` |
| `logical_reads` | I/O đọc từ buffer pool |
| `reads` | Physical reads |
| `writes` | Writes |
| `login_name` | User đang chạy |
| `host_name` | Client host |
| `database_name` | Database đang query |
| `query_hash` | Native optimizer fingerprint (`CONVERT(NVARCHAR(18), r.query_hash, 1)`) — join Query Store |
| `sql_text` | SQL đang chạy (full text) |
| `query_plan_xml` | Compile plan từ `dm_exec_query_plan` |
| `actual_plan_xml` | Runtime plan từ `dm_exec_query_statistics_xml` (có `ActualRows`, `RuntimeCountersPerThread`) |
| `is_head_blocker` | 1 nếu session này đang block người khác |

### Blocking context (inline)

| Field | Ý nghĩa |
|---|---|
| `blocking_session_id` | Session đang block session này (0 = không bị block) |
| `wait_type` | Loại wait nếu đang bị block |
| `wait_seconds` | `wait_time / 1000.0` |
| `wait_resource` | Resource bị lock |
| `blocker_login/host/status` | Identity của blocker |
| `blocker_open_txn` | Số transaction mở của blocker |
| `blocker_sql_text` | SQL của blocker (active request ưu tiên, fallback recent SQL) |
| `blocker_plan_xml` | Plan của blocker (actual → active cached → historical cached, fallback cascade) |

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 300s)                            │
│                                                                  │
│  1. Resolve nodes: ["all"] → [PRIMARY, SEC-1, SEC-2]            │
│                                                                  │
│  2. Execute parallel: active_slow_sessions trên mỗi node        │
│     TOP 10 ORDER BY elapsed_seconds DESC                        │
│                                                                  │
│  3. ThresholdDetector.detect()                                  │
│     ├── elapsed_seconds ≥ 300 → CRITICAL                        │
│     ├── elapsed_seconds ≥ 30  → WARNING                         │
│     └── < 30 → không tạo finding                               │
│     Full row copy vào metrics (incl. plan XML, blocker fields)  │
│                                                                  │
│  4. capture_tools = [] → không trigger DiagnosticCapture        │
│     (plan XML đã có inline trong metrics)                       │
│                                                                  │
│  5. Dedup (30 phút) → Telegram alert                            │
│     Alert có nút: Kill Session, Kill Blocking, AI Analysis      │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  issue_type: slow_sessions                                      │
│  Skill dùng sql_text + query_plan_xml + actual_plan_xml         │
│  để phân tích execution plan, missing index, parameter sniffing │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic=slow_sessions
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "slow_sessions"                                    │
│                                                                  │
│  Table columns:                                                  │
│  No | ID | Time | Role+Node | Severity | Alert Status           │
│  | Elapsed(s) | CPU(s) | Login | Host | Session Id | Blocking   │
│  | AI Analyses | Action                                          │
│                                                                  │
│  "Session Id" cell: click-to-kill badge #sid                    │
│  "Blocking" cell: #blocker_sid (click-to-kill) hoặc None        │
│  Filter "Blocking only": hiện chỉ rows có blocking_session_id  │
│                                                                  │
│  Row click → Metrics modal:                                     │
│  ┌── Slow session info: elapsed, cpu, reads, plan chips         │
│  ├── Blocking info: blocker detail + plan (nếu bị block)        │
│  ├── Execution Plan panel: compile/actual plan viewer (SSMS-like)│
│  │    Nút "Analyze" → Layer 2 /api/v1/plan/analyze              │
│  └── Diagnostics tab (nếu captured)                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **`actual_plan_xml` qua `dm_exec_query_statistics_xml`** | Có `ActualRows`, `RuntimeCountersPerThread` — phát hiện cardinality mismatch chính xác hơn compile plan |
| **Blocker info inline trong cùng query** | 1 snapshot = 1 connection = consistent. Tách query riêng cho blocker → race condition nếu blocker thay đổi |
| **Blocker plan cascade** (actual → active cached → historical cached) | Blocker có thể idle (không có active request) → phải fallback vào plan cache qua `dm_exec_query_stats` |
| **`capture_tools = []`** | `query_plan_xml` và `actual_plan_xml` đã capture inline trong metrics. DiagnosticCapture không thêm giá trị, tốn compute |
| **`TOP 10`, không phải TOP 100** | Slow sessions trên readable secondary có thể nhiều (reporting queries). TOP 10 đủ để alert, tránh phình finding |
| **Threshold chỉ trên `elapsed_seconds`** | `cpu_time` và `logical_reads` phụ thuộc workload đặc thù. `elapsed` là universal worst-case signal |
| **`query_hash` native** (`CONVERT(NVARCHAR(18), r.query_hash, 1)`) | Cùng format với `blocking` — join được với Query Store và `dm_exec_query_stats` cho cross-topic analysis |
| **Không có `analysis_config`** | Skill Layer 2 đọc từ `metrics` (sql_text, plan XML) — không cần context riêng |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- `session_id > 50` — loại system sessions (SQL Server dùng session 1–50)
- `is_user_process = 1` — loại background tasks

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_slow_sessions()` | Topic config: SQL, threshold `elapsed_seconds`, exclusions |
| L1 Detector | `layer1/detectors/threshold_detector.py` | Evaluate `elapsed_seconds`, copy full row vào metrics |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_SLOW_SESSIONS` | topic_id constant |
| L3 Layout | `layer3/apps/web/dashboard/topics/layout-registry.ts` → `slow_sessions` entry | Table columns + `renderSlowSessionFindingRow` |
| L3 Metrics modal | `layer3/apps/web/dashboard/dashboard.ts` → `renderSlowSessionMetricsTable()` | Plan viewer + blocking info + Analyze button |
| L3 Plan viewer | `layer3/apps/web/dashboard/dashboard.ts` → `renderExecutionPlanToBox()` | SSMS-style plan render qua QP parser |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `"slow_sessions"` → layout key `"slow_sessions"` |
