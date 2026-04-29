# Monitor Topics — Query Blocking

Ngày: 2026-04-24
Tác giả: Long Do + Claude Sonnet 4.6

---

## 1. Định Nghĩa và Cơ Chế

Query Blocking xảy ra khi Session A giữ **lock** trên một resource (row, page,
table, key range), và Session B cần lock **không tương thích** trên cùng resource
đó → B phải chờ đến khi A release lock.

### Ví dụ chuỗi blocking

```
Session A: BEGIN TRAN → UPDATE Orders WHERE id=1 → [chưa COMMIT]
Session B: SELECT * FROM Orders WHERE id=1 → bị BLOCK bởi A
Session C: UPDATE Orders WHERE id=1        → bị BLOCK bởi A
             → Chain: A → B, A → C  (head blocker=A, chain_depth=1)
```

### Lock Compatibility Matrix

| Holder ↓ / Requester → | S (Shared) | X (Exclusive) | U (Update) |
|---|---|---|---|
| **S** | ✅ tương thích | ❌ block | ✅ tương thích |
| **X** | ❌ block | ❌ block | ❌ block |
| **U** | ✅ tương thích | ❌ block | ❌ block |

**Wait types** khi bị block:
`LCK_M_S`, `LCK_M_X`, `LCK_M_U`, `LCK_M_IS`, `LCK_M_IX`,
`LCK_M_SCH_S`, `LCK_M_SCH_M`

---

## 2. Ảnh Hưởng Lên Hệ Thống

| Tầng | Ảnh hưởng | Severity |
|---|---|---|
| **Application** | Response time tăng → user timeout | Trực tiếp |
| **Connection Pool** | Connections blocked chiếm pool → exhaustion → "Cannot connect" | Nghiêm trọng |
| **Cascading Blocking** | Chain 1→2→…→N: 1 head blocker gây hàng trăm sessions chờ | Rất nghiêm trọng |
| **AG Replication** | Long transaction → large log → redo_queue tăng trên Secondary | Gián tiếp |
| **TempDB** | Deadlock rollback → version store spike | Gián tiếp |
| **CPU** | Lock scheduling overhead + rollback cost | Vừa |

### Đặc Thù Hệ Thống AG + CDC + Resource Governor

- **Primary**: mọi DML đều ở đây → blocking tập trung ở Primary
- **Readable Secondary**: read-only query có thể bị block bởi redo thread
  (HADR wait types: `HADR_SYNC_COMMIT`, `HADR_DATABASE_WAIT_FOR_RECOVERY`)
- **CDC**: scan thread giữ SCH-S lock → conflict với DDL (SCH-M lock)
- **Resource Governor**: head blocker có thể từ workload group khác với victim,
  nhưng blocking xuyên pool vẫn xảy ra

---

## 3. Taxonomy — 4 Issue Types (Category C: Session/Lock)

Tất cả thuộc **Category C: Session/Lock** theo `layer2/FRAMEWORK_monitoring_analysis.md`.

| Issue Type | Khi nào phát sinh | Detector | Topic |
|---|---|---|---|
| `blocking_chain` | Chain depth ≥ 3, head blocker giữ lock > 30s | `blocking_chain` | `blocking` |
| `blocked_query_snapshot` | Query cụ thể bị block lâu tại thời điểm check | `blocking_chain` | `blocked_query` |
| `blocked_query_trend` | Blocking lặp lại > 3 lần trong 5 phút — dấu hiệu vấn đề thiết kế | `threshold` | `blocked_query_trend` (**mới**) |
| `deadlock` | Deadlock graph xuất hiện trong System Health XEvent | `blocking_chain` | `blocking` |

**Lý do cần 3 topics riêng biệt** (không gộp):
- `blocking` phát hiện incident **đang xảy ra** ngay tại thời điểm check (real-time)
- `blocked_query` track query cụ thể + blocker context cho từng incident
- `blocked_query_trend` phát hiện **pattern lặp lại** → vấn đề thiết kế cần fix dài hạn

---

## 4. Monitor Topics — Thiết Kế Chi Tiết

### 4.1 Topic `blocking` — Blocking Chain & Deadlock (hiện có)

```
topic_id:      blocking
schedule_sec:  60
nodes:         ["all"]
detector_type: blocking_chain
```

**Query `blocking_sessions`** — active blocking sessions với chain info:

```sql
SELECT TOP 100
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000              AS wait_sec,
    r.command,
    r.status,
    DB_NAME(r.database_id)          AS database_name,
    s.login_name,
    s.host_name,
    s.program_name,
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qt.text), 2) AS query_hash,
    SUBSTRING(qt.text, 1, 500)      AS query_text,
    -- Execution plan của victim — để biết victim đang làm gì (scan? seek? lookup?)
    -- NULL nếu plan chưa compile hoặc session chờ quá sớm
    CONVERT(NVARCHAR(MAX), qp.query_plan) AS query_plan_xml
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) qp
WHERE r.blocking_session_id > 0
  AND r.wait_time > 10000          -- >= 10 giây (tăng từ 5s để giảm noise)
ORDER BY r.wait_time DESC
```

> **Lý do tăng ngưỡng từ 5s lên 10s**: blocking < 10s thường tự resolve,
> gây quá nhiều noise finding. Blocking > 10s mới cần DBA chú ý.

> **Giới hạn của query này**: chỉ lấy **victim** (sessions đang chờ). Head blocker
> thường không có `blocking_session_id > 0` nên không xuất hiện ở đây.
> Hai query bổ sung dưới đây lấy chính xác head blocker.

**Query `head_blocker_sessions`** — sessions đang GIỮ lock và gây blocking cho người khác:

```sql
-- Lấy các session đang là nguyên nhân block, kể cả khi không có active request
-- (idle transaction — phổ biến nhất: BEGIN TRAN → UPDATE → quên COMMIT)
SELECT TOP 20
    s.session_id,
    s.login_name,
    s.host_name,
    s.program_name,
    s.open_transaction_count,
    s.status                                            AS session_status,
    DATEDIFF(SECOND, s.last_request_start_time, GETDATE()) AS idle_sec,
    -- SQL text: dùng most_recent_sql_handle từ connection (có cả khi session idle)
    SUBSTRING(ISNULL(qt.text, ''), 1, 500)              AS last_query_text,
    -- Active request nếu có
    r.command,
    r.cpu_time / 1000                                   AS cpu_sec,
    r.reads,
    -- Execution plan — 2 case:
    --   Active blocker:  lấy từ dm_exec_requests.plan_handle (chính xác nhất)
    --   Idle blocker:    tìm trong plan cache bằng most_recent_sql_handle từ connection
    --                    → plan của câu query cuối cùng session này chạy (câu đã acquire lock)
    CONVERT(NVARCHAR(MAX), COALESCE(
        active_plan.query_plan,      -- active blocker
        cached_plan.query_plan       -- idle blocker — tìm qua plan cache
    )) AS blocker_plan_xml
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r       ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_connections c    ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) qt
-- Plan cho active blocker (plan_handle từ dm_exec_requests)
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) active_plan
-- Plan cho idle blocker: dùng dm_exec_query_stats — DMV duy nhất có cả sql_handle + plan_handle
-- dm_exec_sql_text KHÔNG có cột sql_handle, không thể dùng để filter
OUTER APPLY (
    SELECT TOP 1 qp2.query_plan
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp2
    WHERE qs.sql_handle = c.most_recent_sql_handle
      AND r.plan_handle IS NULL       -- chỉ chạy khi không có active request
) cached_plan(query_plan)
WHERE s.session_id IN (
    SELECT DISTINCT blocking_session_id
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0
)
ORDER BY s.open_transaction_count DESC, idle_sec DESC
```

> **Plan cho idle blocker**: `sys.dm_exec_query_stats` là DMV duy nhất có cả
> `sql_handle` và `plan_handle` trong cùng 1 row — dùng để bridge từ
> `dm_exec_connections.most_recent_sql_handle` → plan XML.
> `dm_exec_sql_text` và `dm_exec_cached_plans` không có cột `sql_handle` để filter trực tiếp.
> Subquery `cached_plan` chỉ chạy khi `r.plan_handle IS NULL` (idle session).
> Plan có thể NULL nếu query chưa từng chạy đủ lần để vào `query_stats` hoặc bị evict.

> **Tại sao cần query này?** Head blocker hay là session **idle với open transaction**:
> app mở transaction, gọi UPDATE, rồi đợi user input hoặc bị treo mà không COMMIT/ROLLBACK.
> Session đó không có active request → không xuất hiện trong `blocking_sessions`,
> nhưng vẫn giữ X lock và block tất cả sessions khác đụng vào cùng rows.

**Query `head_blocker_locks`** — locks đang được GIỮ (GRANT) bởi head blockers:

```sql
-- Xem chính xác resource nào bị lock, loại lock gì, bởi session nào
-- Kết hợp với head_blocker_sessions để có đủ bức tranh
SELECT TOP 50
    tl.request_session_id                               AS session_id,
    tl.resource_type,                                   -- DATABASE, OBJECT, PAGE, KEY, RID, ...
    DB_NAME(tl.resource_database_id)                    AS database_name,
    -- OBJECT_NAME chỉ hợp lệ với resource_type='OBJECT' (object_id fits int)
    -- KEY/PAGE/RID: resource_associated_entity_id là hash — overflow nếu cast thẳng sang int
    CASE WHEN tl.resource_type = 'OBJECT'
         THEN OBJECT_NAME(
                  TRY_CAST(tl.resource_associated_entity_id AS INT),
                  tl.resource_database_id
              )
         ELSE NULL
    END                                                 AS object_name,
    tl.resource_associated_entity_id,                  -- raw value để debug KEY/PAGE/RID
    tl.request_mode,                                    -- S, X, U, IS, IX, SIX, SCH-S, SCH-M
    tl.request_type,                                    -- LOCK, PAGE, KEY, ...
    tl.resource_description
FROM sys.dm_tran_locks tl
WHERE tl.request_session_id IN (
    SELECT DISTINCT blocking_session_id
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0
)
  AND tl.request_status = 'GRANT'     -- chỉ lấy locks đang được giữ (không phải chờ)
  AND tl.resource_type NOT IN ('DATABASE', 'METADATA')  -- bỏ noise system locks
ORDER BY tl.request_session_id, tl.resource_type
```

> **Kết hợp 3 queries**: `blocking_sessions` (victim context) +
> `head_blocker_sessions` (blocker context) + `head_blocker_locks` (lock details)
> → Layer 2 có đủ thông tin để kết luận root cause mà không cần query thêm nhiều.

**Query `deadlock_events`** — deadlock graph từ System Health XEvent (24h gần nhất):

```sql
SELECT TOP 20
    xdr.value('@timestamp', 'datetime2')    AS deadlock_time,
    xdr.value('(//deadlock/process-list/process/@id)[1]', 'varchar(50)') AS victim_id,
    SUBSTRING(
        xdr.value('(//deadlock/process-list/process/inputbuf)[1]', 'varchar(max)'),
        1, 500
    )                                        AS victim_query
FROM (
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets t
    JOIN sys.dm_xe_sessions s ON t.event_session_address = s.address
    WHERE s.name = 'system_health'
      AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xr(xdr)
WHERE xdr.value('@timestamp', 'datetime2') > DATEADD(HOUR, -24, GETUTCDATE())
ORDER BY deadlock_time DESC
```

**Thresholds:**

| Metric | Warning | Critical | Lý do |
|---|---|---|---|
| `wait_sec` | 30 | 120 | 30s: DBA chú ý; 120s = 2 phút = SLA violation rõ ràng |
| `chain_depth` | 3 | 5 | Depth 2 là bình thường; depth 3+ mới là dấu hiệu vấn đề |
| `blocked_session_count` | 5 | 20 | 20+ sessions = cascading nguy hiểm, cần can thiệp ngay |

> **Tại sao `chain_depth` warning=3 (không phải 2)?** Depth 2 (A block B) rất phổ biến
> và thường tự resolve dưới 30s. Depth 3+ là dấu hiệu long transaction hoặc deadlock-prone code.

---

### 4.2 Topic `blocked_query` — Blocked Query Snapshot (hiện có)

```
topic_id:      blocked_query
schedule_sec:  60
nodes:         ["all"]
detector_type: blocking_chain
```

**Query `blocked_snapshot`** — chi tiết query đang bị block + đầy đủ context của blocker:

```sql
SELECT TOP 100
    -- Victim info
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000              AS wait_duration_sec,
    r.wait_resource,
    DB_NAME(r.database_id)          AS database_name,
    s.login_name,
    s.host_name,
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qt.text), 2) AS query_hash,
    SUBSTRING(qt.text, 1, 1000)     AS query_text,
    -- Blocker info — bao gồm idle transaction detection
    bs.login_name                   AS blocker_login,
    bs.host_name                    AS blocker_host,
    bs.program_name                 AS blocker_program,
    bs.open_transaction_count       AS blocker_open_txn_count,
    bs.status                       AS blocker_status,
    DATEDIFF(SECOND, bs.last_request_start_time, GETDATE())
                                    AS blocker_idle_sec,
    SUBSTRING(ISNULL(bt.text, ''), 1, 500) AS blocker_last_query,
    -- Plan của victim — biết victim đang thực thi operation gì (scan? seek?)
    CONVERT(NVARCHAR(MAX), victim_plan.query_plan) AS victim_plan_xml,
    -- Plan của blocker — quan trọng hơn: tại sao blocker giữ lock lâu?
    -- Active blocker: từ dm_exec_requests.plan_handle
    -- Idle blocker:   từ plan cache qua most_recent_sql_handle
    CONVERT(NVARCHAR(MAX), COALESCE(
        blocker_active_plan.query_plan,
        blocker_cached_plan.query_plan
    ))                              AS blocker_plan_xml
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s    ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
LEFT JOIN sys.dm_exec_sessions bs ON r.blocking_session_id = bs.session_id
LEFT JOIN sys.dm_exec_connections bc ON r.blocking_session_id = bc.session_id
OUTER APPLY (
    SELECT TOP 1 text
    FROM sys.dm_exec_connections c
    CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle)
    WHERE c.session_id = r.blocking_session_id
) bt
-- Victim plan
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) victim_plan
-- Blocker plan — active case
OUTER APPLY (
    SELECT TOP 1 qp.query_plan
    FROM sys.dm_exec_requests br
    CROSS APPLY sys.dm_exec_query_plan(br.plan_handle) qp
    WHERE br.session_id = r.blocking_session_id
) blocker_active_plan(query_plan)
-- Blocker plan — idle case: dm_exec_query_stats link sql_handle → plan_handle
OUTER APPLY (
    SELECT TOP 1 qp2.query_plan
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp2
    WHERE qs.sql_handle = bc.most_recent_sql_handle
      AND NOT EXISTS (
          SELECT 1 FROM sys.dm_exec_requests br2
          WHERE br2.session_id = r.blocking_session_id
      )
) blocker_cached_plan(query_plan)
WHERE r.blocking_session_id > 0
  AND r.wait_time > 10000
ORDER BY r.wait_time DESC
```

> **`blocker_idle_sec` + `blocker_status = 'sleeping'`** là chỉ số quan trọng nhất:
> nếu blocker idle > 30s với `open_transaction_count > 0` → đây là **forgotten transaction**,
> khác hoàn toàn với active lock (cần action khác nhau).

**Thresholds:**

| Metric | Warning | Critical | Ghi chú |
|---|---|---|---|
| `wait_duration_sec` | 30 | 120 | Tăng từ 10/60 — align với `blocking` topic |

---

### 4.3 Topic `blocked_query_trend` — Recurring Lock Contention (**MỚI**)

```
topic_id:      blocked_query_trend
display_name:  Blocked Query Trend — Recurring Lock Contention
schedule_sec:  300
nodes:         ["primary"]
detector_type: threshold
```

**Mục đích**: Phát hiện **pattern lặp lại** — cùng query/table bị block nhiều lần
trong 5 phút. Đây là dấu hiệu của **vấn đề thiết kế** (lock contention structural):
thiếu index covering, isolation level không phù hợp, transaction quá dài.
Khác với `blocking` (incident real-time), `blocked_query_trend` → phân tích thiết kế dài hạn.

**Query `blocking_frequency`**:

```sql
SELECT TOP 30
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qt.text), 2) AS query_hash,
    SUBSTRING(qt.text, 1, 300)          AS query_text,
    r.wait_resource,
    COUNT(*)                            AS block_event_count,
    AVG(r.wait_time / 1000.0)           AS avg_wait_sec,
    MAX(r.wait_time / 1000.0)           AS max_wait_sec,
    MIN(r.start_time)                   AS first_seen,
    MAX(r.start_time)                   AS last_seen
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
WHERE r.blocking_session_id > 0
  AND r.wait_time > 10000
GROUP BY qt.text, r.wait_resource
HAVING COUNT(*) >= 2
ORDER BY block_event_count DESC
```

**Thresholds:**

| Metric | Warning | Critical | Lý do |
|---|---|---|---|
| `block_event_count` | 3 | 10 | 3 lần trong 5 phút = cùng query bị block lặp lại |
| `avg_wait_sec` | 30 | 90 | Pattern avg cao → không phải noise, cần fix |

---

## 5. Layer 2 Skill — `blocking.yaml`

Thuộc **Category C: Session/Lock** theo Framework:
- Model: `claude-sonnet-4-6` (blocking chain reasoning phức tạp)
- `max_tool_rounds`: 4
- `max_tokens`: 3000
- `max_cost_usd`: 0.10

### Issue Types Covered

```yaml
issue_types:
  - blocking_chain
  - blocked_query_snapshot
  - blocked_query_trend
  - deadlock
```

### Specialization

```
Focus: xác định head blocker, root cause lock contention, đề xuất giải pháp cụ thể.

Phân tích theo thứ tự:

1. Đọc metrics trong finding:
   - chain_depth, blocked_session_count, wait_sec → đánh giá severity
   - wait_type (LCK_M_X, LCK_M_S, LCK_M_SCH_M) → loại lock để suy ra nguyên nhân
   - head_blocker_session_id, blocker_login, blocker_query → context head blocker

2. get_blocking_chain (node từ finding):
   - Xác định head blocker hiện tại (nếu blocking đang diễn ra)
   - Đọc toàn bộ chain: mỗi bước là session nào, query gì, lock resource nào
   - Nếu chain đã giải quyết (finding cũ) → bỏ qua, chuyển sang get_wait_stats

3. get_wait_stats (node):
   - LCK_M_* wait types: xác nhận blocking là nguyên nhân chính
   - PAGEIOLATCH_*: blocking có kèm I/O pressure không?
   - HADR_*: blocking có liên quan replication không?

4. get_query_stats (query_hash của head blocker nếu có):
   - Execution history: query này có thường xuyên chạy lâu không?
   - avg_logical_reads: có full scan không?
   - Nếu head blocker không có query_hash → bỏ qua

5. get_analysis_history (issue_type, node):
   - Blocking này recurring? Pattern theo giờ/ngày?
   - Lần trước root cause là gì? Đã resolve chưa?

Phân loại tình huống và hướng xử lý:
- LCK_M_X + long transaction → COMMIT sớm hơn, chia nhỏ batch DML
- LCK_M_S + index scan full table → index covering, READ_COMMITTED_SNAPSHOT (RCSI)
- LCK_M_SCH_M → DDL conflict với CDC/read → schedule DDL ngoài giờ peak
- Deadlock (issue_type=deadlock) → phân tích victim query, resource,
  đề xuất consistent access order hoặc thêm index
- blocked_query_trend + recurring → vấn đề thiết kế: index, isolation level RCSI,
  hoặc query redesign để giảm lock duration

Lưu ý hệ thống:
- Peak hours 8:00-18:00 VN: blocking trong peak = severity cao hơn, escalate nhanh hơn
- CDC enabled: scan thread có thể là nguồn contention trên log/version store
- Readable Secondary: blocking giữa redo thread và read query → không cần can thiệp app,
  chỉ cần thông báo "expected behavior" nếu HADR wait types chiếm đa số
```

### Required / Optional Tools

```yaml
required_tools:
  - get_blocking_chain
  - get_wait_stats

optional_tools:
  - get_query_stats
  - get_query_store_history
  - get_table_context
  - get_recent_findings
  - get_analysis_history
```

---

## 6. Plan Triển Khai

### Thứ tự thực hiện

```
Step 1 → Update blocking.yaml         (Layer 2 — không cần redeploy Layer 1)
Step 2 → Add blocked_query_trend topic (Layer 1 seed)
Step 3 → Update blocking/blocked_query thresholds (Layer 1 seed)
Step 4 → Implement BlockingChainDetector stubs
Step 5 → Test end-to-end
```

---

### Step 1 — `layer2/skills/blocking.yaml`

**File**: `layer2/skills/blocking.yaml`

Thay đổi:
- Điền `specialization` đầy đủ (hiện đang trống — chỉ có "Focus: blocking chain...")
- Thêm `blocked_query_trend` vào `issue_types` list
- Giữ nguyên `required_tools`, `optional_tools`, model config

---

### Step 2+3 — `layer1/seed/seed_topics.py`

**File**: `layer1/seed/seed_topics.py`

Thay đổi:
1. Thêm hàm `_blocked_query_trend()` — topic mới với SQL và thresholds theo mục 4.3
2. Thêm `_blocked_query_trend()` vào `_all_topics()` list
3. Update `_blocking()`: `chain_depth` warning→3 (từ 2), thêm `blocked_session_count`
4. Update `_blocked_query()`: `wait_duration_sec` warning→30 (từ 10), critical→120 (từ 60)

---

### Step 4 — `layer1/detectors/blocking_detector.py`

**File**: `layer1/detectors/blocking_detector.py`

Implement các stubs hiện đang `...`:

| Method | Logic |
|---|---|
| `detect()` | build chain → tính depth → tạo Finding với metrics: `chain_depth`, `blocked_session_count`, `head_blocker_session_id`, `wait_type` |
| `_build_chain(rows)` | Build dict `{blocked_spid: blocking_spid}` từ rows |
| `_calculate_chain_depth(chain)` | DFS/BFS từ mỗi node → tìm max path length |
| `_parse_deadlock_graph(xml)` | Parse XEvent XML: extract victim process, resources, lock modes |

**Finding metrics cần ghi vào `metrics` dict:**

```python
{
    "chain_depth": int,
    "blocked_session_count": int,
    "head_blocker_session_id": int,
    "head_blocker_login": str,
    "head_blocker_query": str,
    "max_wait_sec": float,
    "wait_type": str,   # wait type của blocked sessions (LCK_M_X, ...)
    "blocked_sessions": [
        {"session_id": int, "wait_sec": float, "query_text": str, ...}
    ]
}
```

---

### Step 5 — Verification

| Check | Method |
|---|---|
| IssueType enum | `python -c "from layer1.models.common import IssueType; print(IssueType.BLOCKED_QUERY_TREND)"` |
| Seed dry-run | `python -m layer1.seed.seed_topics --dry-run` → thấy `blocked_query_trend` |
| Topic seeded | `db.monitor_topics.findOne({topic_id: "blocked_query_trend"})` |
| Skill load OK | Layer 2 startup log: "Loaded skill blocking_v1" với 4 issue types |
| Detector không crash | Trigger job thủ công, không có exception |
| Finding tạo đúng | `db.findings.findOne({issue_type: "blocking_chain"})` → có `chain_depth`, `blocked_session_count` |
| `/analyze` hoạt động | `POST /api/v1/analyze` với blocking finding_id → analysis có root cause + recommendation |

---

## 7. Cost Profile

Theo Category C (Session/Lock):

| Model | Avg Rounds | Avg Input Tokens | Avg Cost |
|---|---|---|---|
| claude-sonnet-4-6 | 3–4 | ~8K | $0.05–0.10 |

---

## 8. Liên Kết Tài Liệu

| Tài liệu | Nội dung |
|---|---|
| `layer2/FRAMEWORK_monitoring_analysis.md` | Framework 4 category, template skill YAML |
| `layer2/CLAUDE.md` | Kiến trúc Layer 2, skill system, tool safety |
| `layer1/CLAUDE.md` | Detector registry, MongoDB schema, code rules |
| `layer2/skills/blocking.yaml` | Skill YAML thực tế |
| `layer1/seed/seed_topics.py` | MongoDB topic config thực tế |
| `layer1/detectors/blocking_detector.py` | Detector implementation |
