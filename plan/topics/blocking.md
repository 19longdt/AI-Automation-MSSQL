# Monitor Topic — Query Blocking (Master Plan)

Ngày tạo: 2026-04-24 | Cập nhật: 2026-06-04
Tác giả: Long Do + Claude

> **Trạng thái tài liệu**: Plan tổng quát (Phần A) đã chốt. Thiết kế chi tiết
> (Phần B) là tham chiếu — sẽ review lại từng phần khi bàn thực thi per-layer.

---

# PHẦN A — PLAN TỔNG QUÁT

## A0. Scope (chốt 2026-06-04)

**Giai đoạn này chỉ làm topic `blocking` với 2 issue types, tập trung vào SESSION GÂY RA (head blocker):**

| Issue Type | In scope? | Ghi chú |
|---|---|---|
| `blocking_chain` | ✅ | Topic `blocking` (60s) — trọng tâm = **head blocker**: session nào gây block, đang giữ lock gì, active hay idle (forgotten transaction) |
| `deadlock` | ✅ | Topic `deadlock` **riêng** (300s) — từ System Health XEvent. Tách khỏi `blocking` vì là data lịch sử + XML parse nặng (quyết định 2026-06-04) |
| `blocked_query_snapshot` | ⏸️ Defer | Victim-centric — làm sau; topic `blocked_query` hiện có sẽ **disable** để tránh chạy nửa vời |
| `blocked_query_trend` | ⏸️ Defer | Structural contention — làm sau khi blocking core ổn định |

> Lý do tập trung head blocker: victim chỉ là triệu chứng. Muốn xử lý incident
> (kill session, fix app) thì thông tin quyết định là **ai đang giữ lock và tại sao**.

## A1. Mục Tiêu

### Mục tiêu nghiệp vụ

| # | Mục tiêu | Đo lường |
|---|---|---|
| G1 | **Phát hiện blocking incident real-time** — chain depth, head blocker, victims — trong vòng 1 chu kỳ check (60s) | Finding `blocking_chain` có đủ `chain_depth`, `head_blocker_session_id`, `blocked_session_count` |
| G2 | **Phát hiện forgotten transaction** (idle session giữ lock — nguyên nhân phổ biến nhất) | Finding phân biệt được active blocker vs idle blocker (`blocker_idle_sec`, `open_transaction_count`) |
| G3 | ~~Phát hiện pattern lặp lại~~ → **DEFER** (xem A0) | — |
| G4 | **Phát hiện deadlock** từ System Health XEvent | Finding `deadlock` với victim query + resources |
| G5 | **AI phân tích được root cause** khi DBA gõ `/analyze` — đủ context trong finding, không cần query thêm nhiều | Analysis có head blocker, lock type, recommendation cụ thể |
| G6 | **Actionable từ Telegram**: alert có đủ info để DBA quyết định `/kill-session` head blocker | Alert hiển thị head_blocker_session_id + login + idle/active + query — pattern `/kill-blocking` đã có sẵn ở topic `slow_sessions` |

### Mục tiêu kỹ thuật (clean code / kiến trúc)

- **Tuân thủ pattern hiện có**: detector qua registry, config-driven (SQL/thresholds trong MongoDB), Pydantic models, không crash scheduler
- **Detector là pure logic**: nhận `list[QueryResult]` + `MonitorTopic` → trả `list[Finding]`. Không I/O, không side-effect → unit test được không cần MSSQL
- **Tách concerns trong detector**: chain analysis / deadlock parsing là 2 trách nhiệm khác nhau — tách module để tái sử dụng và test độc lập
- **Mở rộng không sửa code cũ**: thêm issue type blocking mới = thêm query trong MongoDB + 1 handler nhỏ, không đụng detector core

---

## A2. Phân Tích Hiện Trạng (2026-06-04)

### Đã có ✅

| Thành phần | File | Trạng thái |
|---|---|---|
| `IssueType` enum đủ 4 types | `layer1/models/common.py:61-64` | `BLOCKING_CHAIN`, `DEADLOCK`, `BLOCKED_QUERY_SNAPSHOT`, `BLOCKED_QUERY_TREND` |
| Topic `blocking` (seed) | `layer1/seed/seed_topics.py` `_blocking()` | 2 queries: `blocking_sessions`, `deadlock_events` — **bản cũ, thiếu head blocker** |
| Topic `blocked_query` (seed) | `layer1/seed/seed_topics.py` `_blocked_query()` | 1 query `blocked_snapshot` — **bản cũ, thiếu plan XML + idle blocker detection đầy đủ** |
| Skill `blocking.yaml` Layer 2 | `layer2/skills/blocking.yaml` | Tồn tại, cover 3 issue types — **specialization chỉ 1 dòng placeholder** |
| Skill `deadlock.yaml` Layer 2 | `layer2/skills/deadlock.yaml` | File riêng cho `deadlock` (quyết định đã chốt: KHÔNG gộp vào blocking) |
| Tool `get_blocking_chain` Layer 2 | `layer2/agent/tool_registry.py`, `diagnostic_executor.py` | Hoạt động — agent query được chain hiện tại |
| Capture tool `get_blocking_chain` | `layer1/seed/seed_capture_tools.py:129` | Def đã seed — sẵn sàng cho DiagnosticCapture |
| Detector stub | `layer1/detectors/blocking_detector.py` | Skeleton + docstring đúng hướng |

### Còn thiếu / Gap ❌

| # | Gap | Mức độ | Chi tiết |
|---|---|---|---|
| GAP-1 | **`BlockingChainDetector` chưa implement** — 4 methods đều là `...` | 🔴 Blocker | `detect()`, `_build_chain()`, `_calculate_chain_depth()`, `_parse_deadlock_graph()` |
| GAP-2 | **`blocking_chain` chưa được register** trong `DetectorRegistry.build_default()` | 🔴 Blocker | `registry.py:52` chỉ có `threshold` + `baseline` → 2 topics blocking đang chạy queries nhưng **không tạo finding nào** (silent — chỉ log warning) |
| GAP-3 | Seed queries bản cũ: thiếu `head_blocker_sessions`, `head_blocker_locks`, thiếu `query_hash` + plan XML trong `blocking_sessions` | 🟡 Cao | Không identify được idle blocker (forgotten transaction) — case phổ biến nhất |
| GAP-4 | Thresholds cũ: `wait > 5s` (noise), `chain_depth` warning=2 (depth 2 là bình thường), thiếu `blocked_session_count` | 🟡 Cao | Sẽ spam alert khi detector hoạt động |
| GAP-5 | ~~Topic `blocked_query_trend` chưa tồn tại~~ | ⏸️ Defer | Ngoài scope (A0) |
| GAP-6 | `blocking.yaml` specialization trống — agent không có hướng dẫn phân tích blocking | 🟡 Trung | Phân tích sẽ generic, không tận dụng context AG/CDC/RG |
| GAP-7 | Topic `blocking` chưa khai báo `capture_tools` + `analysis_config` | 🟢 Thấp | CRITICAL finding không trigger DiagnosticCapture; `/quick` không hoạt động |
| GAP-8 | Layer 3 chưa có visualization riêng cho blocking chain | ✅ Done 2026-06-04 | Layout `blocking` 13 cột (head blocker, IDLE TXN badge, kill head blocker) + chain tree modal. Wire `layout-registry.ts` vào `dashboard.ts` (xóa inline duplicate); module mới `topics/blocking-detail.ts` |
| GAP-9 | Topic `blocked_query` đang `enabled=true` với detector chưa tồn tại | 🟡 Trung | Khi register detector mà không handle `blocked_snapshot` → behavior nửa vời. **Quyết định: disable topic này trong seed** (giữ config để bật lại sau) |

### Insight quan trọng từ phân tích

**Hệ thống hiện tại đang "monitoring mù" với blocking**: 2 topics chạy mỗi 60s trên cả 3 nodes,
tốn DMV queries, lưu `raw_metrics`, nhưng vì GAP-1 + GAP-2 nên **không một finding nào được tạo**.
Đây là silent failure đúng kiểu mà design "detector exception → return []" che giấu.
→ Ưu tiên cao nhất là Phase 1 (detector core), không phải thêm topic mới.

---

## A3. Kiến Trúc & Nguyên Tắc Thiết Kế

### Vị trí trong kiến trúc 3 layer (không đổi — tuân thủ flow hiện có)

```
MongoDB monitor_topics (2 topics: blocking 60s, deadlock 300s)
    │ config-driven: SQL + thresholds
    ▼
Layer 1: topic_runner → query 3 nodes parallel → BlockingChainDetector / ThresholdDetector
    │ findings (chain_depth, head_blocker, ...) → dedup → Telegram alert
    │ CRITICAL → DiagnosticCapture (capture_tools)
    ▼
Layer 2: /analyze → skill blocking.yaml / deadlock.yaml → agentic loop
    │ tools: get_blocking_chain, get_wait_stats, get_query_stats, ...
    ▼
Layer 3: dashboard hiển thị findings + insights (generic — phase sau mới custom)
```

### Quyết định thiết kế cho detector (mới)

| Quyết định | Lý do |
|---|---|
| **Tách `chain_analysis.py`** (pure functions: build graph, depth, head blockers) khỏi `blocking_detector.py` | SRP — graph logic test độc lập; tái sử dụng được trong capture handlers; detector chỉ còn orchestration + threshold mapping |
| **Tách topic `deadlock` riêng khỏi `blocking`** | 3 queries blocking phải cùng snapshot (correlate session_id giữa victim ↔ head blocker ↔ locks — `execute_batch` chạy liền nhau trên 1 connection); còn `deadlock_events` là data lịch sử 24h + parse XML ring_buffer (~4MB) nặng → 300s là đủ, không cần 60s. Đồng thời align với skill `deadlock.yaml` riêng ở Layer 2 |
| **Route theo `query_id`** trong detector: `blocking_sessions` + `head_blocker_sessions` + `head_blocker_locks` → chain analysis (join theo session_id); `deadlock_events` → deadlock parsing. Query_id lạ → log warning + skip | 1 detector dùng chung cho cả 2 topics, nhiều row shapes — explicit routing thay vì đoán theo column; mở rộng sau (blocked_snapshot, trend) chỉ là thêm route |
| **Finding xoay quanh head blocker**: 1 Finding per head blocker (không per victim) | Scope A0 — session gây ra là trung tâm; victims là detail (`blocked_sessions[]` trong metrics). Tránh 50 findings cho 1 incident → dedup + alert sạch |
| **Deadlock parse bằng stdlib `xml.etree`** (pattern giống `capture/plan_analyzer.py`) | Không thêm dependency; XEvent XML đơn giản |
| **Deadlock dedup theo `deadlock_time`** (nằm trong finding_hash input) | Query lấy 24h window → cùng deadlock xuất hiện trong nhiều lần check; không dedup đúng sẽ spam |
| **Detector không bao giờ raise** — lỗi parse 1 row/1 XML → log + skip row | Tuân thủ R4: 1 topic fail không được dừng scheduler |

### Nguyên tắc clean code áp dụng

1. **Full type hints + Pydantic** (R1, R2) — metrics dict của Finding có schema document rõ trong docstring
2. **Comments giải thích WHY** (R6) — ví dụ: tại sao chain_depth warning=3 không phải 2
3. **Không hardcode SQL trong Python** — mọi query nằm trong seed → MongoDB
4. **Mọi SQL có TOP N** (R7)
5. **Test trước khi tích hợp**: unit tests cho chain builder (cycle, multi-chain, orphan blocker), deadlock parser (malformed XML), detector (threshold mapping) — đây là logic thuần, phải có coverage

---

## A4. Roadmap — 5 Phases

> Thứ tự tối ưu theo dependency + giá trị: detector trước (hệ thống đang mù),
> config sau (cần detector để thresholds có nghĩa), AI skill sau cùng (cần findings thật để tune).

### Phase 1 — Layer 1: Detector Core 🔴 (ưu tiên cao nhất)

**Giải quyết**: GAP-1, GAP-2, GAP-9 — hệ thống bắt đầu tạo findings từ topic `blocking`.

| Việc | File |
|---|---|
| Tạo `chain_analysis.py` — pure functions: build graph, max depth, **find head blockers**, group victims per head | `layer1/detectors/chain_analysis.py` (mới) |
| Implement `BlockingChainDetector` — route by query_id (`blocking_sessions`, `head_blocker_sessions`, `head_blocker_locks`, `deadlock_events`), build Finding head-blocker-centric, map thresholds | `layer1/detectors/blocking_detector.py` |
| Register `"blocking_chain"` vào `build_default()` | `layer1/detectors/registry.py` |
| Disable topic `blocked_query` (`enabled=False` — giữ config, bật lại khi làm phase defer) | `layer1/seed/seed_topics.py` |
| Unit tests: chain graph (depth, cycle, multi-head), deadlock XML parse, detector end-to-end với fake QueryResult | `tests/` |

**Output Phase 1**: Detector hoạt động — topic `blocking` hiện tại (seed cũ, còn chứa `deadlock_events`) tạo findings `blocking_chain` + `deadlock` được ngay. Việc tách topic diễn ra ở Phase 2 — detector route theo `query_id` nên không phụ thuộc topic nào chứa query nào.

### Phase 2 — Layer 1: Config & Seed 🟡

**Giải quyết**: GAP-3, GAP-4, GAP-7 + tách topic `deadlock`.

| Việc | File |
|---|---|
| Update `_blocking()`: **bỏ query `deadlock_events`**, thêm queries `head_blocker_sessions` + `head_blocker_locks`, thêm `query_hash`/plan XML vào `blocking_sessions`, nâng wait filter 5s→10s | `layer1/seed/seed_topics.py` |
| Thêm `_deadlock()` — topic mới: `topic_id="deadlock"`, query `deadlock_events`, `schedule_sec=300`, nodes `["all"]`, `detector_type="blocking_chain"` (detector route theo query_id) | nt |
| Update thresholds `blocking`: `chain_depth` 3/5, `wait_sec` 30/120, thêm `blocked_session_count` 5/20 | nt |
| Khai báo `capture_tools` + `analysis_config` cho 2 topics | nt |
| Cân nhắc topic action `/kill-blocking` cho alert blocking (pattern đã có ở `slow_sessions` — `services/topic_action_service.py`) | quyết định khi thực thi |
| Re-seed + xóa dedup cache cũ | runbook |

**Output Phase 2**: 2 topics tách bạch — `blocking` (60s, snapshot correlate được session_id) + `deadlock` (300s, XML parse nhẹ tải); context head blocker đầy đủ (session, locks, plan, idle/active), noise giảm.

### Phase 3 — Layer 2: AI Skill 🟡

**Giải quyết**: GAP-6.

| Việc | File |
|---|---|
| Viết `specialization` đầy đủ cho `blocking.yaml` — head-blocker-centric; bỏ `blocked_query_trend` khỏi issue_types (defer) | `layer2/skills/blocking.yaml` |
| Review `deadlock.yaml` cho consistency với data mới từ detector | `layer2/skills/deadlock.yaml` |
| Nâng `max_tokens` 2000→3000 (blocking reasoning dài hơn) | `layer2/skills/blocking.yaml` |

### Phase 4 — Verification E2E 🟡

| Check | Cách |
|---|---|
| Detector tạo finding đúng | Simulate blocking trên môi trường test (`BEGIN TRAN` + UPDATE không commit, session 2 SELECT) → finding có `chain_depth`, `head_blocker_session_id` |
| Idle blocker detect được | Simulate forgotten transaction → `blocker_idle_sec` + `open_transaction_count` trong metrics |
| Deadlock detect + dedup | Simulate deadlock 2 sessions → finding `deadlock` 1 lần duy nhất dù query 24h window mỗi 60s |
| Alert + dedup | Telegram alert 1 lần, không spam khi blocking kéo dài |
| `/analyze` end-to-end | Reply alert → Layer 2 analysis có head blocker + recommendation |
| `/quick` | Haiku trả phân tích nhanh từ `analysis_config` |

### Deferred (ngoài scope đợt này) ⏸️

- Topic `blocked_query` (victim snapshot chi tiết) — bật lại + queries mới khi cần
- Topic `blocked_query_trend` (structural contention) — thêm khi blocking core ổn định
- ~~Layer 3 visualization~~ → ✅ Done 2026-06-04 (layout `blocking` + chain tree modal; còn lại: trend chart cho blocked_query_trend khi bật topic, glossary lock modes — dashboard chưa dùng glossary nên skip)

---

## A5. Rủi Ro & Lưu Ý

| Rủi ro | Mitigation |
|---|---|
| Sau khi detector hoạt động → **alert storm** từ blocking tồn đọng | Phase 1 deploy kèm Phase 2 thresholds (hoặc deploy ngoài giờ peak + theo dõi); dedup 30 phút đã có sẵn |
| `dedup_cache` cũ chứa hash từ format finding cũ | Xóa dedup cache sau re-seed (đã có precedent trong Known Bugs) |
| Query `head_blocker_locks` trên `sys.dm_tran_locks` có thể nặng khi lock count lớn | `TOP 50` + filter `request_status='GRANT'` + bỏ DATABASE/METADATA locks |
| Plan XML trong query results làm `raw_metrics` phình to (NVARCHAR(MAX)) | TTL 3 ngày đã có; cân nhắc chỉ lấy plan khi wait_sec lớn — quyết định khi bàn thực thi Phase 2 |
| Deadlock từ ring_buffer chỉ giữ ~4MB → có thể miss deadlock cũ | Chấp nhận — 24h window + check mỗi 60s là đủ; XEvent file target là cải tiến tương lai |
| Blocking trên Readable Secondary do redo thread (HADR) là expected behavior | Skill specialization phải dạy agent phân biệt → không khuyến nghị can thiệp app |

---

# PHẦN B — THIẾT KẾ CHI TIẾT (THAM CHIẾU)

> Phần này là thiết kế chi tiết đã soạn trước (2026-04-24), giữ làm tham chiếu
> cho khi thực thi từng phase. Sẽ review/điều chỉnh từng mục khi bàn thực thi.

## B1. Định Nghĩa và Cơ Chế

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

## B2. Ảnh Hưởng Lên Hệ Thống

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

## B3. Taxonomy — 4 Issue Types (Category C: Session/Lock)

Tất cả thuộc **Category C: Session/Lock** theo `layer2/FRAMEWORK_monitoring_analysis.md`.

| Issue Type | Khi nào phát sinh | Detector | Topic |
|---|---|---|---|
| `blocking_chain` | Chain depth ≥ 3, head blocker giữ lock > 30s | `blocking_chain` | `blocking` |
| `blocked_query_snapshot` | Query cụ thể bị block lâu tại thời điểm check | `blocking_chain` | `blocked_query` |
| `blocked_query_trend` | Blocking lặp lại > 3 lần trong 5 phút — dấu hiệu vấn đề thiết kế | `threshold` | `blocked_query_trend` (⏸️ defer) |
| `deadlock` | Deadlock graph xuất hiện trong System Health XEvent | `blocking_chain` | `deadlock` (**tách riêng**) |

**Lý do tách topics** (không gộp):
- `blocking` (60s): incident **đang xảy ra** real-time — 3 queries phải cùng 1 job để snapshot cùng thời điểm (correlate session_id)
- `deadlock` (300s): data **lịch sử 24h** từ XEvent — không cần real-time; parse XML ring_buffer nặng, giảm tần suất tiết kiệm tải
- `blocked_query` / `blocked_query_trend`: defer (xem A0)

## B4. Monitor Topics — Thiết Kế Chi Tiết

### B4.1 Topic `blocking` — Blocking Chain (head-blocker-centric)

```
topic_id:      blocking
schedule_sec:  60
nodes:         ["all"]
detector_type: blocking_chain
```

> **3 queries dưới đây BẮT BUỘC cùng 1 topic/job**: detector correlate theo
> `session_id` giữa victim ↔ head blocker ↔ locks — chỉ có nghĩa khi cả 3 result
> sets là cùng 1 snapshot (`execute_batch` chạy liền nhau trên 1 connection).
> `deadlock_events` đã tách sang topic `deadlock` riêng (B4.1b).

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
    -- Native query_hash (không MD5) + full text — cùng convention với slow_sessions
    -- (cập nhật 2026-06-05: native hash join được dm_exec_query_stats / Query Store)
    CONVERT(NVARCHAR(18), r.query_hash, 1) AS query_hash,
    qt.text                         AS query_text
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
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
    -- SQL text: dùng most_recent_sql_handle từ connection (có cả khi session idle) — FULL text
    ISNULL(qt.text, '')                                 AS last_query_text,
    -- Active request nếu có
    r.command,
    r.cpu_time / 1000                                   AS cpu_sec,
    r.reads,
    -- Native query_hash: active từ request; idle bridge qua dm_exec_query_stats
    CONVERT(NVARCHAR(18), COALESCE(r.query_hash, cached_plan.query_hash), 1) AS query_hash,
    -- Execution plan — 2 case:
    --   Active blocker:  lấy từ dm_exec_requests.plan_handle (chính xác nhất)
    --   Idle blocker:    tìm trong plan cache bằng most_recent_sql_handle từ connection
    --                    → plan của câu query cuối cùng session này chạy (câu đã acquire lock)
    COALESCE(
        active_plan.query_plan,      -- active blocker
        cached_plan.query_plan       -- idle blocker — tìm qua plan cache
    ) AS blocker_plan_xml
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r       ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_connections c    ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) qt
-- Plan cho active blocker (plan_handle từ dm_exec_requests)
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) active_plan
-- Plan cho idle blocker: dùng dm_exec_query_stats — DMV duy nhất có cả sql_handle + plan_handle
-- dm_exec_sql_text KHÔNG có cột sql_handle, không thể dùng để filter
OUTER APPLY (
    SELECT TOP 1 qp2.query_plan, qs.query_hash
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp2
    WHERE qs.sql_handle = c.most_recent_sql_handle
      AND r.plan_handle IS NULL       -- chỉ chạy khi không có active request
) cached_plan(query_plan, query_hash)
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

**Thresholds:**

| Metric | Warning | Critical | Lý do |
|---|---|---|---|
| `wait_sec` | 30 | 120 | 30s: DBA chú ý; 120s = 2 phút = SLA violation rõ ràng |
| `chain_depth` | 3 | 5 | Depth 2 là bình thường; depth 3+ mới là dấu hiệu vấn đề |
| `blocked_session_count` | 5 | 20 | 20+ sessions = cascading nguy hiểm, cần can thiệp ngay |

> **Tại sao `chain_depth` warning=3 (không phải 2)?** Depth 2 (A block B) rất phổ biến
> và thường tự resolve dưới 30s. Depth 3+ là dấu hiệu long transaction hoặc deadlock-prone code.

### B4.1b Topic `deadlock` — Deadlock Events (**TÁCH RIÊNG**)

```
topic_id:      deadlock
display_name:  Deadlock Monitor (System Health XEvent)
schedule_sec:  300
nodes:         ["all"]
detector_type: blocking_chain   (detector route theo query_id → deadlock parsing)
```

> **Lý do tách khỏi `blocking`**: data lịch sử 24h (không cần check 60s);
> `CAST(target_data AS XML)` + XQuery trên ring_buffer ~4MB là query nặng nhất nhóm;
> align với skill `deadlock.yaml` riêng ở Layer 2.

> **Dedup**: cùng deadlock xuất hiện trong nhiều lần check (24h window) →
> `deadlock_time` phải nằm trong finding_hash input.

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

**Thresholds**: không cần — mỗi deadlock event là 1 finding `severity=CRITICAL` trực tiếp
(deadlock đã xảy ra rồi, không có ngưỡng warning).

### B4.2 Topic `blocked_query` — Blocked Query Snapshot ⏸️ DEFERRED (xem A0)

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

### B4.3 Topic `blocked_query_trend` — Recurring Lock Contention ⏸️ DEFERRED (xem A0)

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

## B5. Detector — Finding Metrics Contract

**1 Finding per chain** — metrics dict chuẩn (input contract cho Layer 2 skill + Telegram alert):

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

Module split (Phase 1):

| Module | Trách nhiệm |
|---|---|
| `detectors/chain_analysis.py` | Pure functions: `build_chain(rows)`, `max_chain_depth(chain)`, `find_head_blockers(chain)`, `group_victims(chain)` |
| `detectors/blocking_detector.py` | Orchestration: route query_id → analysis → Finding + severity mapping từ topic.thresholds |
| Deadlock parsing | `_parse_deadlock_graph()` trong detector (stdlib `xml.etree`) — extract victim, processes, resources |

## B6. Layer 2 Skill — `blocking.yaml`

Thuộc **Category C: Session/Lock** theo Framework:
- Model: `claude-sonnet-4-6` (blocking chain reasoning phức tạp)
- `max_tool_rounds`: 4
- `max_tokens`: 3000
- `max_cost_usd`: 0.10

### Issue Types Covered

```yaml
issue_types:
  - blocking_chain
  # Defer (A0): blocked_query_snapshot, blocked_query_trend — thêm lại khi bật các topic tương ứng
```

> `deadlock` đã có skill riêng `deadlock.yaml` — giữ nguyên tách biệt.

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
- blocker idle (sleeping + open_transaction_count > 0) → forgotten transaction:
  trace app qua program_name/host_name, đề xuất fix connection handling
- blocked_query_trend + recurring → vấn đề thiết kế: index, isolation level RCSI,
  hoặc query redesign để giảm lock duration

Lưu ý hệ thống:
- Peak hours 8:00-18:00 VN: blocking trong peak = severity cao hơn, escalate nhanh hơn
- CDC enabled: scan thread có thể là nguồn contention trên log/version store
- Readable Secondary: blocking giữa redo thread và read query → không cần can thiệp app,
  chỉ cần thông báo "expected behavior" nếu HADR wait types chiếm đa số
- KHÔNG gợi ý OPTION(OPTIMIZE FOR UNKNOWN)
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

## B7. Cost Profile

Theo Category C (Session/Lock):

| Model | Avg Rounds | Avg Input Tokens | Avg Cost |
|---|---|---|---|
| claude-sonnet-4-6 | 3–4 | ~8K | $0.05–0.10 |

## B8. Liên Kết Tài Liệu

| Tài liệu | Nội dung |
|---|---|
| `layer2/FRAMEWORK_monitoring_analysis.md` | Framework 4 category, template skill YAML |
| `layer2/CLAUDE.md` | Kiến trúc Layer 2, skill system, tool safety |
| `layer1/CLAUDE.md` | Detector registry, MongoDB schema, code rules |
| `layer2/skills/blocking.yaml` | Skill YAML thực tế |
| `layer2/skills/deadlock.yaml` | Skill deadlock riêng |
| `layer1/seed/seed_topics.py` | MongoDB topic config thực tế |
| `layer1/detectors/blocking_detector.py` | Detector implementation |
| `layer1/detectors/registry.py` | Detector registry — nơi register `blocking_chain` |
