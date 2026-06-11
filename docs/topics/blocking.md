# Topic: Blocking Chain Monitor

**topic_id**: `blocking` | **Schedule**: 60s (1 phút) | **Nodes**: `all` | **Detector**: `blocking_chain`

**Related topics**:
- [`deadlock`](deadlock.md) — deadlock events từ XEvent ring buffer (300s)
- [`slow_sessions`](slow_sessions.md) — slow query snapshot với blocking context inline (300s)

---

## 1. Bối cảnh

Blocking xảy ra khi session A giữ lock và session B phải chờ. Khác với deadlock (cả 2 chờ nhau → SQL Server chọn victim rollback), blocking là **chờ đơn chiều** — B chờ A release. Nếu A không release (forgotten transaction, long-running query, hoặc chủ ý giữ lock), B chờ mãi và cascade ra nhiều session khác.

**Hai pattern cần phân biệt:**

| Pattern | Dấu hiệu | Hành động |
|---|---|---|
| **Active lock** | Head blocker có active request đang chạy | Xem query + plan, tìm nguyên nhân slow query |
| **Forgotten transaction** | Head blocker `session_status=sleeping` + `open_transaction_count > 0` | Kill session hoặc fix app (quên `COMMIT`/`ROLLBACK`) |

Topic tập trung **head-blocker-centric**: 1 finding per head blocker, victims là detail trong `metrics.blocked_sessions`. Tránh 50 findings cho 1 incident.

**Deadlock đã tách riêng** vì dùng XEvent historical data (không phải real-time DMV), parse nặng hơn, schedule 300s là đủ.

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện |
|---|---|---|
| B1 | **Chain chờ lâu** — victim bị block > ngưỡng | `max_wait_sec ≥ 30` (warning) / `≥ 120` (critical) |
| B2 | **Chain sâu** — cascading nhiều tầng | `chain_depth ≥ 3` (warning) / `≥ 5` (critical) |
| B3 | **Nhiều session chờ** — cascading rộng | `blocked_session_count ≥ 5` (warning) / `≥ 20` (critical) |
| B4 | **Forgotten transaction** | `head_blocker_is_idle=true` + `open_txn_count > 0` — phát hiện qua head_blocker_sessions |

Severity = max qua tất cả thresholds. Dưới mọi ngưỡng warning → không tạo finding (SQL đã filter `wait_time > 10s` phía query, nhưng chain ngắn/wait thấp vẫn tự resolve).

---

## 3. Queries (3 queries — cùng 1 snapshot)

3 queries **bắt buộc chạy trên cùng 1 connection** (`execute_batch`) để đảm bảo correlate `session_id` nhất quán. Tách connection → race condition nếu session thay đổi giữa 2 queries.

### `blocking_sessions` — Victims (bắt buộc, routing key)

Các session đang bị block (`blocking_session_id > 0`, `wait_time > 10s`). Là routing key để `BlockingChainDetector` nhận biết đây là topic blocking.

| Field | Ý nghĩa |
|---|---|
| `session_id` | Session đang bị block |
| `blocking_session_id` | Session đang giữ lock (direct parent trong chain) |
| `wait_type` | Loại wait (LCK_M_X, LCK_M_S...) → loại lock contention |
| `wait_sec` | `wait_time / 1000` — giây đang chờ |
| `wait_resource` | Resource bị lock (page, key, object ID) |
| `query_hash` | Native optimizer fingerprint — join được với Query Store / dm_exec_query_stats |
| `query_text` | SQL đang chạy của victim (truncate 300 ký tự trong `blocked_sessions` list) |

### `head_blocker_sessions` — Head blockers (enrich)

Session đang **giữ** lock, kể cả idle transaction (không có active request).

| Field | Ý nghĩa |
|---|---|
| `session_id` | Head blocker session ID |
| `session_status` | `sleeping` = idle, `running`/`suspended` = active |
| `open_transaction_count` | > 0 khi `sleeping` → forgotten transaction |
| `idle_sec` | `DATEDIFF(SECOND, last_request_start_time, GETDATE())` |
| `last_query_text` | SQL cuối của head blocker (full, không truncate) |
| `blocker_plan_xml` | Plan của head blocker: active plan → từ request; idle → từ plan cache |
| `query_hash` | `COALESCE(r.query_hash, cached_plan.query_hash)` — active ưu tiên, idle fallback cache |

### `head_blocker_locks` — Held locks (enrich)

Locks đang `GRANT` bởi head blockers, aggregate theo `(resource_type, mode, object_name)`.

---

## 4. Metrics trong Finding

`BlockingChainDetector._build_chain_metrics()` tổng hợp metrics từ 3 queries:

| Metric | Nguồn | Ý nghĩa |
|---|---|---|
| `chain_depth` | Tính từ chain graph | Số tầng A→B→C→D... |
| `blocked_session_count` | Đếm victims | Tổng số session đang chờ |
| `head_blocker_session_id` | Từ chain graph | Session gây ra blocking |
| `max_wait_sec` | Max của victims | Victim chờ lâu nhất |
| `wait_type` | Mode phổ biến nhất | Counter(wait_types).most_common(1) |
| `blocked_sessions[]` | Top 10 victims (sort by wait_sec DESC) | Chi tiết từng victim |
| `head_blocker_login/host/program` | head_blocker_sessions | Identity của head blocker |
| `head_blocker_is_idle` | `session_status == "sleeping"` | True → forgotten transaction |
| `head_blocker_idle_sec` | head_blocker_sessions | Idle bao lâu |
| `head_blocker_open_txn_count` | head_blocker_sessions | Transaction chưa commit |
| `head_blocker_query` | head_blocker_sessions | SQL của head blocker (full) |
| `blocker_plan_xml` | head_blocker_sessions | Execution plan của head blocker |
| `held_locks[]` | head_blocker_locks | Top 10 locks đang giữ |

---

## 5. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 60s)                             │
│                                                                  │
│  1. Resolve nodes: ["all"] → [PRIMARY, SEC-1, SEC-2]            │
│                                                                  │
│  2. execute_batch (1 connection per node, parallel across nodes)│
│     ├── blocking_sessions    (victims, wait > 10s)              │
│     ├── head_blocker_sessions (head context, idle detection)    │
│     └── head_blocker_locks   (held locks, aggregate)            │
│                                                                  │
│  3. BlockingChainDetector.detect()                              │
│     ├── build_chain(victim_rows) → chain graph {sid: parent}   │
│     ├── group_victims_by_head(chain) → {head: [victim_ids]}    │
│     ├── 1 Finding per head blocker                              │
│     │    severity = max(wait_sec, chain_depth, blocked_count)   │
│     │    Dưới mọi ngưỡng → bỏ qua (không tạo finding)          │
│     └── issue_type = BLOCKING_CHAIN                             │
│                                                                  │
│  4. Severity ≥ CRITICAL + capture_tools:                        │
│     ├── get_blocked_victims_snapshot (T+0 full victim detail)   │
│     └── get_analysis_history (AI recurrence context — MongoDB) │
│                                                                  │
│  5. Dedup (30 phút) → Telegram alert                            │
│     Alert có nút: Kill Head Blocker, AI Analysis                │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  issue_type: blocking_chain                                     │
│  Skill: (blocking-specific yaml nếu có, fallback generic)       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic=blocking
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "blocking"                                         │
│                                                                  │
│  Table columns:                                                  │
│  No | ID | Time | Role+Node | Severity | Head Blocker           │
│  | State | Depth | Blocked | Max Wait(s) | Wait Type            │
│  | AI Analyses | Action                                          │
│                                                                  │
│  "Head Blocker" cell: #sid + login, host/program trong tooltip  │
│  "State" cell: IDLE TXN ⚠ Xs (forgotten transaction) / ACTIVE  │
│  Action: Kill Head Blocker + AI Analysis                        │
│                                                                  │
│  Row click → Blocking Chain modal:                              │
│  ┌── Chain tree: head → victim(s) với wait_sec                  │
│  ├── Head blocker detail: query, plan, locks held               │
│  └── Diagnostics tab (nếu CRITICAL + captured)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **1 Finding per head blocker** (không phải per victim) | 1 incident = 1 head blocker. 50 victims từ 1 head → 50 findings là noise. Victims là detail trong `blocked_sessions[]` |
| **3 queries trên 1 connection** (`execute_batch`) | Correlate `session_id` giữa victims ↔ head ↔ locks chỉ có nghĩa khi cùng snapshot. Tách connection → race condition |
| **Nodes = ["all"]** | Blocking xảy ra bất kỳ node — readable secondary cũng có read-only blocking |
| **Filter `wait_time > 10s` phía SQL** | Blocking ngắn hơn thường tự resolve trước khi check xong — noise |
| **Tách deadlock sang topic riêng** | XEvent historical data, parse XML nặng, schedule 300s đủ; không cần real-time 60s |
| **`capture_tools` chỉ khi CRITICAL** | Blocking tự resolve nhanh — snapshot T+0 là bằng chứng quan trọng, nhưng chỉ chi phí khi thực sự nghiêm trọng |
| **`get_blocked_victims_snapshot` thay vì `get_blocking_chain`** | `get_blocking_chain` là subset của metrics đã có. Snapshot cần full victim detail để AI phân tích sau khi blocking đã resolve |
| **Không dùng `get_wait_stats` trong capture_tools** | `dm_os_wait_stats` là cumulative từ khi SQL Server restart — không phản ánh incident hiện tại |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- `session_id` không dùng làm dedup key — recycle sau khi disconnect
- `query_hash` native (`CONVERT(NVARCHAR(18), r.query_hash, 1)`) — join được với Query Store

---

## 7. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_blocking()` | Topic config: 3 queries, thresholds, capture_tools |
| L1 Detector | `layer1/detectors/blocking_detector.py` → `BlockingChainDetector` | Chain analysis + severity evaluation |
| L1 Chain | `layer1/detectors/chain_analysis.py` | `build_chain()`, `group_victims_by_head()`, `chain_depth_for_head()` |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_BLOCKING` | topic_id constant |
| L3 Layout | `layer3/apps/web/dashboard/topics/layout-registry.ts` → `blocking` entry | Table columns + `renderBlockingFindingRow` |
| L3 Modal | `layer3/apps/web/dashboard/topics/blocking-detail.ts` → `renderBlockingChainModal` | Chain tree + head detail + locks |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `"blocking"` → layout key `"blocking"` |
