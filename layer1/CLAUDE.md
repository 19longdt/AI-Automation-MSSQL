# CLAUDE.md — Layer 1: MSSQL Monitoring Service

## Mục đích

Service Python chạy daemon, tự động giám sát cụm **MSSQL Server 2019 Enterprise AG** (1 Primary + 2 Secondary). Phát hiện performance issues, ghi vào MongoDB. Output (`findings`) là input cho Layer 2 AI Agent.

**Config-driven architecture:** SQL queries, thresholds, schedule intervals cấu hình hoàn toàn trong MongoDB `monitor_topics`. Python app chỉ là generic executor — không hardcode query nào.

---

## Hệ thống đích

- **MSSQL 2019 Enterprise** — Always On Availability Groups, synchronous commit
- **Primary** (auto-detected): ghi + đọc, Query Store, CDC enabled
- **Secondary 1, 2** (auto-detected): Readable Secondary
- **Resource Governor**: nhiều pools/workload groups
- **Partition tables**: partition scheme theo ngày/tháng
- **CDC** (Change Data Capture): ảnh hưởng TempDB version store

> **Node roles tự động detect** — KHÔNG hardcode node nào là Primary. Service query AG DMV khi startup và refresh mỗi giờ.

---

## Entry Point & Startup

```
python -m layer1.main
```

> **Docker/Compose migration:** Nếu `docker-compose.yml` đang override command, cập nhật:
> - Cũ: `["python", "-m", "layer1.scheduler"]`
> - Mới: `["python", "-m", "layer1.main"]`
>
> Nếu không override command, Dockerfile đã đổi default CMD sang `layer1.main`.

```
1. Load EnvSettings từ env vars / .env
   → MSSQL_NODES (danh sách hosts), MONGODB_URI, credentials
   → Fail fast nếu thiếu required vars

2. Kết nối MongoDB → tạo indexes (idempotent)

3. Detect node roles (Primary/Secondary) từ AG DMV → cache in-memory + MongoDB
   → Query sys.dm_hadr_availability_replica_states trên first reachable node

4. Đọc monitor_topics (enabled=true) từ MongoDB
   → Mỗi topic = 1 APScheduler interval job

5. Đăng ký system jobs:
   → node_role_refresh (mỗi NODE_ROLE_REFRESH_SEC, default 1 giờ)
   → health_check (mỗi 2 phút)

6. Khởi tạo notification dispatcher (TelegramNotifier nếu token có)
   → dispatch_startup() gửi thông báo service đã start

7. Khởi tạo TelegramBot (nếu có TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
   → PlanAnalyzer (Haiku, nếu có CLAUDE_API_KEY) + TelegramBot.start() (daemon thread)
   → /quick enabled nếu CLAUDE_API_KEY set; /analyze enabled nếu LAYER2_URL set

8. CaptureToolLoader.load_all() → load capture tool defs từ MongoDB vào memory
   → Fail fast nếu collection `capture_tool_defs` rỗng (chưa seed)

9. scheduler.start() trong daemon thread → main thread khởi HTTP API server (L1_API_HOST:L1_API_PORT)
   → SIGTERM/SIGINT → graceful shutdown
```

**Deployment:** Standalone single-instance.

---

## Cấu trúc Module

```
layer1/
├── main.py                    ← Entry: start scheduler thread + start HTTP API server
├── scheduler.py               ← Orchestrator: setup → register topic jobs → APScheduler.start()
├── config.py                  ← EnvSettings only (MSSQL hosts, MongoDB URI, credentials, API keys)
│
├── api/
│   ├── app.py                 ← HTTP server factory + route registration
│   ├── http.py                ← RouteRegistry + JSON helpers (parse_json_body, send_json)
│   └── routes/
│       ├── health.py          ← GET /health
│       └── sessions.py        ← POST /kill-session
│
├── services/
│   ├── session_service.py     ← Business logic: execute KILL <session_id> trên MSSQL nodes
│   └── topic_action_service.py ← Template Method + Registry cho topic-specific Telegram actions
│
├── models/
│   ├── common.py              ← Severity, NodeRole, IssueType enums
│   ├── topic.py               ← MonitorTopic, QueryConfig, ThresholdConfig, BaselineConfig, AnalysisConfig
│   │                             [capture_tools: list[str] = [] — tools chạy sau khi detect CRITICAL finding]
│   ├── metrics.py             ← RawMetric, QueryResult
│   ├── findings.py            ← Finding (output → MongoDB → Telegram bot → Claude)
│   │                             [has_diagnostics: bool — True nếu DiagnosticCapture đã chạy thành công]
│   ├── capture_tool.py        ← ExecutionType enum (sql/static/mongo) + CaptureToolDef + AiHints
│   └── job.py                 ← JobExecution, JobStatus
│
├── capture/
│   ├── capture_tool_loader.py ← Eager load + cache CaptureToolDef từ MongoDB tại startup (fail fast nếu rỗng)
│   ├── diagnostic_capture.py  ← 4-phase snapshot: parallel DMV → static analysis → table DMV → MongoDB reads
│   ├── plan_analyzer.py       ← Parse XML execution plan (copy từ layer2, stdlib only)
│   ├── query_analyzer.py      ← Parse query text structure (copy từ layer2, stdlib only)
│   └── handlers/
│       ├── types.py                       ← StaticToolHandler, MongoToolHandler ABCs
│       ├── static_registry.py             ← Registry: tool_id → StaticToolHandler
│       ├── mongo_registry.py              ← Registry: tool_id → MongoToolHandler
│       ├── static_get_plan_analysis.py    ← Handler: parse query_plan_xml
│       ├── static_get_query_structure.py  ← Handler: parse query_text
│       ├── mongo_get_table_context.py     ← Handler: lookup db_context
│       ├── mongo_get_recent_findings.py   ← Handler: findings 24h gần nhất
│       └── mongo_get_analysis_history.py  ← Handler: issue_insights + ai_analyses
│
├── executor/
│   ├── mssql_connection.py    ← pyodbc context manager (tạo mới per-call, KHÔNG cache)
│   ├── query_executor.py      ← Generic: nhận QueryConfig + host → execute → QueryResult
│   │                             [NOTE: Decimal→float conversion tại đây — pyodbc trả Decimal, MongoDB không serialize]
│   ├── topic_runner.py        ← Orchestrate 1 topic: reload config → resolve nodes → query → detect → notify
│   └── node_role_cache.py     ← Detect Primary/Secondary từ AG DMV, cache, refresh mỗi giờ
│
├── detectors/
│   ├── registry.py            ← Map detector_type string → handler class (build_default() đăng ký threshold + baseline)
│   ├── threshold_detector.py  ← Generic: value vs config thresholds → WARNING/CRITICAL
│   ├── baseline_detector.py   ← Day-of-week baseline comparison (4 tuần cùng ngày/giờ)
│   ├── plan_detector.py       ← XML execution plan analysis (lxml)
│   └── blocking_detector.py   ← Blocking chain depth, deadlock graph
│
├── storage/
│   ├── mongo_client.py        ← Singleton MongoClient (thread-safe, dùng chung toàn service)
│   ├── indexes.py             ← TTL + compound indexes, tạo khi startup (idempotent)
│   └── repositories/
│       ├── topic_repo.py          ← CRUD monitor_topics
│       ├── raw_metrics_repo.py    ← insert_many query results
│       ├── findings_repo.py       ← insert_one findings; find_by_id_prefix() cho Telegram bot
│       ├── baseline_repo.py       ← Day-of-week baseline CRUD
│       ├── dedup_repo.py          ← Atomic check-and-set chống spam alert
│       └── job_execution_repo.py  ← Job run history + stuck/missed detection
│
├── job_manager/
│   ├── job_runner.py          ← Decorator: ghi job_executions (start/finish/fail)
│   └── health_checker.py      ← Detect stuck/missed jobs, MongoDB ping
│
├── notifications/
│   ├── base_notifier.py       ← ABC + NotificationDispatcher (severity filter + multi-channel)
│   ├── teams_notifier.py      ← Microsoft Teams Incoming Webhook
│   ├── telegram_notifier.py   ? Telegram alert: HTML parse mode, file attachment, dynamic action template theo topic_id
│   └── telegram_bot.py        ? Bot polling (daemon thread): /quick + forward Layer 2 + dispatch topic actions qua registry
│
├── ai/
│   └── plan_analyzer.py       ← Build prompt từ AnalysisConfig → gọi Claude API → trả text phân tích
│
├── seed/
│   ├── seed_topics.py         ← Seed monitor_topics vào MongoDB (chạy 1 lần khi setup mới)
│   │                             13 topic builders: ag_health, slow_sessions, blocking, tempdb, ...
│   │                             Entry: python -m layer1.seed.seed_topics
│   └── seed_capture_tools.py  ← Seed 18 capture tool defs vào capture_tool_defs (chạy trước khi start)
│                                 Entry: python -m layer1.seed.seed_capture_tools
│
└── utils/
    └── time_utils.py          ← now_vn() (UTC+7 naive, cho MongoDB), utc_now() (cho APScheduler)
```

---

## HTTP API

Layer 1 expose một HTTP server nhỏ (stdlib `http.server`, không dùng framework nặng) chạy song song với APScheduler.

### Endpoints hiện tại

| Method | Path | Body | Mô tả |
|---|---|---|---|
| `GET` | `/health` | — | Service status + scheduler alive check |
| `POST` | `/kill-session` | `{ "session_id": <int>, "node": "<host>" }` | Execute `KILL <session_id>` trên node chỉ định — `node` là bắt buộc |

### Rule — Thêm API mới

1. Tạo route file trong `layer1/api/routes/`
2. Tạo/bổ sung business logic trong `layer1/services/`
3. Đăng ký route trong `layer1/api/app.py` → `build_registry()`
4. **Không** đặt business logic trong `main.py` hoặc route handler

---

## Configuration

### Env Vars (`config.py` — EnvSettings)
Load 1 lần khi startup, immutable. Chỉ chứa connection info và credentials.

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=secret
MSSQL_PORT=1433
MSSQL_QUERY_TIMEOUT_SEC=30

MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor

NODE_ROLE_REFRESH_SEC=3600
DEDUP_SUPPRESS_MINUTES=30

TEAMS_WEBHOOK_URL=https://...

# Telegram — alerts + on-demand /quick + /analyze bot
TELEGRAM_BOT_TOKEN=1234567890:ABC...
TELEGRAM_CHAT_ID=-1001234567890

# Claude API — dùng cho TelegramBot /quick command (Haiku analysis Layer 1)
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6  # (config only, unused by Layer 1)

# Haiku model — dùng cho /quick command (phân tích nhanh, rẻ)
HAIKU_MODEL=claude-haiku-4-5-20251001

# Layer 2 agent URL — để forward /analyze requests tới Layer 2
# Format: http://layer2:8000 (Docker Compose), http://localhost:8000 (local), etc.
LAYER2_URL=http://layer2:8000

# Logging
LOG_LEVEL=INFO

# Logstash centralized logging (để trống LOGSTASH_HOST = disable, chỉ log ra console)
# Dùng UDP transport → Logstash input: udp { port => 5044 codec => json }
LOGSTASH_HOST=10.100.110.185
LOGSTASH_PORT=5044
LOGSTASH_APP_NAME=sds.ep.ai-automation
LOGSTASH_DATABASE_PATH=/var/lib/layer1/logstash/queue.db  # SQLite persistent queue
```

### MongoDB `monitor_topics` — Toàn bộ monitoring config

Mỗi topic là 1 nhóm monitoring độc lập. SQL queries, thresholds, detector type — tất cả config-driven.

```json
{
  "topic_id": "ag_health",
  "display_name": "AG Health & CDC",
  "enabled": true,
  "schedule_sec": 120,
  "nodes": ["primary"],
  "queries": [
    {
      "query_id": "ag_sync_state",
      "description": "AG replica sync state",
      "sql": "SELECT TOP 100 ar.replica_server_name, ...",
      "timeout_sec": 30
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "log_send_queue_size": { "warning": 500, "critical": 1000 }
  },
  // Tuỳ chọn — enable /analyze command trong Telegram bot cho topic này
  "analysis_config": {
    "context": "AG replica synchronization health — kiểm tra lag và failover risk.",
    "include_fields": [],
    "focus_metrics": ["log_send_queue_size", "redo_queue_size", "synchronization_state_desc"]
  }
}
```

**Config reload:** mỗi job run đọc lại topic config từ MongoDB → thêm/sửa query và threshold có hiệu lực ngay lần chạy kế tiếp. Sửa interval hoặc thêm topic mới cần restart service.

---

## Node Role Cache

**Vấn đề:** Trong AG cluster, Primary có thể failover bất kỳ lúc nào. KHÔNG hardcode node roles.

**Giải pháp:** `node_role_cache.py` — detect roles từ `sys.dm_hadr_availability_replica_states`, cache in-memory.

```
Startup:   query AG DMV → xác định Primary/Secondary → cache
Refresh:   mỗi NODE_ROLE_REFRESH_SEC (default 1 giờ)
Failover:  nếu Primary thay đổi → log WARNING
Stale:     cache > 2 giờ không refresh → query trực tiếp trước khi execute
```

**Topic config node targets** — resolve qua cache:

| Config value | Resolve thành |
|---|---|
| `"primary"` | hostname hiện tại đang là Primary |
| `"secondary"` | tất cả hostname đang là Secondary |
| `"all"` | tất cả nodes trong cluster |
| `"SQL-NODE-01"` | hostname cụ thể (override, không cần cache) |

---

## Data Flow (1 topic run)

```
APScheduler trigger → topic_runner.run("ag_health")
    │
    ├── 1. topic_repo.find("ag_health")     ← reload config mỗi run
    │
    ├── 2. node_role_cache.resolve(["primary"])
    │       → [("SQL-NODE-01", "primary")]
    │
    ├── 3. Parallel per node (ThreadPoolExecutor):
    │       query_executor.execute(query, host) → QueryResult
    │
    ├── 4. raw_metrics_repo.insert_many(results)
    │
    ├── 5. detector = registry.get("threshold")
    │       findings = detector.detect(results, topic)
    │
    ├── 6. Nếu finding.severity == CRITICAL và topic.capture_tools không rỗng:
    │       DiagnosticCapture.capture(finding, topic)
    │           → Phase 1: Parallel DMV queries   (ThreadPoolExecutor, 15s budget)
    │           → Phase 2: Static analysis         (parse plan XML / query text, extract affected_tables)
    │           → Phase 3: Table-specific DMV      (index_usage, statistics_info per affected_table)
    │           → Phase 4: MongoDB reads           (table_context, recent_findings, analysis_history)
    │           → insert finding_diagnostics
    │       finding.has_diagnostics = True
    │
    ├── 7. findings_repo.insert(finding)   [finding.cluster_id = cluster config's cluster_id]
    │
    └── 8. dedup check → notify nếu chưa alert gần đây
```

---

## Detector Types (registry pattern)

| `detector_type` | Khi nào dùng | Input | Logic |
|---|---|---|---|
| `null` | Chỉ lưu raw results | — | Không phân tích |
| `"threshold"` | PLE, TempDB%, AG lag, backup gap | rows + topic.thresholds | value vs warning/critical |
| `"baseline"` | Slow query, wait stats anomaly | rows + topic.baseline_config | value vs day-of-week baseline |
| `"plan_analysis"` | Non-optimal index, plan regression | rows có plan XML | Parse XML, detect scan/lookup/conversion |
| `"blocking_chain"` | Blocking chain, deadlock | rows blocking sessions | Build chain graph, tính depth |

**Thêm detector mới:** tạo 1 class + đăng ký trong `registry.py` → không sửa logic cũ.

---

## Baseline Strategy — Day-of-Week Aware

**KHÔNG dùng rolling 7-day average.** Workload pattern theo ngày trong tuần (Thứ Hai peak, Chủ Nhật thấp).

```
Check chạy lúc Thứ Tư 10:05
→ Baseline = avg(các Thứ Tư 10:00–11:00 trong 4 tuần gần nhất)
```

MongoDB `baselines` document:
```json
{
  "metric_type": "slow_sessions",
  "day_of_week": 2,
  "hour": 10,
  "node": "SQL-NODE-01",
  "samples": [
    { "date": "2026-03-18", "avg_ms": 120 },
    { "date": "2026-04-08", "avg_ms": 118 }
  ],
  "baseline_avg": 119.0,
  "baseline_stddev": 1.4
}
```

---

## MongoDB Collections

| Collection | TTL | Write pattern | Key indexes |
|---|---|---|---|
| `monitor_topics` | — | upsert per topic | unique `(topic_id)` |
| `node_roles` | — | upsert per host | unique `(host)` |
| `raw_metrics` | **3d** | `insert_many` per job run | `(topic_id, query_id, collected_at)` |
| `findings` | **9d** | `insert_one` per finding | `(topic_id, detected_at)`, `(issue_type, detected_at)`, `(finding_hash, detected_at)`, `(cluster_id, detected_at)` |
| `baselines` | — | `update_one` upsert | `(metric_type, day_of_week, hour, node)` |
| `dedup_cache` | 7d | `findOne` + `updateOne(upsert)` | unique `(finding_hash)` |
| `job_executions` | **3d** | `insert_one` + `update_one` | `(job_name, started_at)` |
| `finding_diagnostics` | **9d** | `insert_one` per CRITICAL finding | unique `(finding_id)`, `(topic_id, captured_at DESC)` |
| `capture_tool_defs` | — | seed only (upsert) | unique `(tool_id)`, `(enabled)`, `(phase)` |

---

## Threading Model

```
Main thread — HTTP API server (ThreadingHTTPServer, L1_API_HOST:L1_API_PORT)
    │
    └─► xử lý mỗi HTTP request trong thread riêng (ThreadingHTTPServer)

Daemon thread — APScheduler (ThreadPoolExecutor max_workers=50)
    │   Jobs: topic_{cluster_id}_{topic_id} — mỗi (cluster, topic) là 1 job riêng
    │   → Nhiều cluster chạy song song; cụm lỗi không block cụm khác
    │
    └─► topic_runner.run(topic_id)   [mỗi cluster có TopicRunner riêng]
            │
            ├─► ThreadPoolExecutor (max_workers = len(resolved_nodes))
            │       Thread 1: query_executor.execute(queries, "SQL-NODE-01") — pyodbc conn mới
            │       Thread 2: query_executor.execute(queries, "SQL-NODE-02") — pyodbc conn mới
            │       Thread 3: query_executor.execute(queries, "SQL-NODE-03") — pyodbc conn mới
            │
            ├─► detect + compute alert state
            │
            ├─► DiagnosticCapture.capture() — nếu CRITICAL + capture_tools không rỗng
            │       Phase 1: parallel DMV (ThreadPoolExecutor, 15s budget)
            │       Phase 2: static analysis (in-process, no MSSQL)
            │       Phase 3: table-specific DMV (sequential, max 3 tables)
            │       Phase 4: MongoDB reads (no MSSQL)
            │
            └─► findings_repo.insert() + dedup + notify

Daemon thread — TelegramBot._poll_loop()
    → getUpdates (long-poll timeout=25s)
    → Dispatch:
       /quick <id>   → PlanAnalyzer(haiku_model) → reply ngay (5s)
       reply to Layer 1 alert → extract finding_id → /quick or forward to Layer 2
```

**Thread safety:**
- `pyodbc.Connection`: **KHÔNG thread-safe** → tạo mới trong context manager, KHÔNG cache
- `pymongo.MongoClient`: **thread-safe** → singleton
- APScheduler jobs: `max_instances=1` + `coalesce=True`

---

## Telegram Bot — On-demand AI Analysis

Khi alert được gửi, user nhận Telegram message kèm `🔗 ID: <code>03cc0a88</code>`.

**Hai lệnh phân tích:**

### `/quick` — Phân tích nhanh (Layer 1, Haiku model)
```
/quick (reply vào alert) → Haiku model phân tích trong 3–5 giây
/quick <finding_id>      → Hoặc gõ trực tiếp
```
- ⚡ Nhanh, rẻ, output ngắn gọn
- Dùng Haiku model (Claude) → `HAIKU_MODEL=claude-haiku-4-5-20251001`
- Cần `CLAUDE_API_KEY` trong `.env`

### Reply vào Layer 1 Alert
```
reply (bất kỳ text) vào alert → Layer 1 bot extract finding_id
  - Nếu text bắt đầu `/quick` → chạy Haiku analysis (Layer 1)
  - Nếu text là topic action command (ví dụ `/kill-session`, `/kill-blocking` cho `slow_sessions`)
    → bot dispatch qua TopicActionRegistry → TopicActionHandler xử lý business logic
  - Ngược lại → forward to Layer 2 (gọi POST /api/v1/analyze với telegram_chat_id)

reply `/quick` vào alert → PlanAnalyzer(haiku_model) → Layer 1 gửi document
reply `/kill-session` hoặc `/kill-blocking` vào alert `slow_sessions`
  → resolve `metrics.session_id` / `metrics.blocking_session_id`
  → gọi `session_service.kill_session(...)`
reply (other text) vào alert → Layer 2 bot xử lý, gửi document trực tiếp
```

**Design note (topic actions):**
- Telegram bot chỉ orchestration (parse command, load finding, gửi response).
- Business logic theo topic đặt ở `services/topic_action_service.py` (Template Method + Registry).
- `telegram_notifier` lấy action options từ cùng registry để UI alert và khả năng thực thi luôn đồng bộ.

**Note**: Layer 1 bot **không xử lý `/analyze` command** nữa — chỉ Layer 2 bot listen `/analyze` (token khác).

**Điều kiện để bot hoạt động:**
- `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` phải set trong `.env` (Layer 1)
- **Để dùng `/quick`**: `CLAUDE_API_KEY` phải set
- **Để dùng `/analyze`**: `LAYER2_URL` phải set + Layer 2 bot token `L2_TELEGRAM_BOT_TOKEN`
- Topic trong MongoDB phải có `analysis_config` (nếu thiếu `/quick` báo rõ thay vì crash)

**Không tự động phân tích** — chỉ khi DBA chủ động reply alert hoặc gõ `/quick` command.

---

## Known Bugs Fixed

| Bug | Triệu chứng | Fix |
|---|---|---|
| `pyodbc Decimal` không serialize | `cannot encode object: Decimal` khi insert MongoDB | `_sanitize_value()` trong `query_executor.py`: `Decimal → float` |
| `DetectorRegistry.build_default()` stub | `NoneType.detect()` — tất cả topics crash | Implement `register()`, `detect()`, `build_default()` trong `registry.py` |
| `BaselineDetector.detect()` stub | `NoneType is not iterable` | Full implementation của `detect()` và `_compare_with_baseline()` |
| Telegram HTTP 400 | MarkdownV2 fail với IP `10.100.112.61` (dấu `.`) | Chuyển sang HTML parse mode + `html.escape()` cho tất cả user data |
| Dedup hash collision | Alert chỉ gửi lần đầu rồi dừng hẳn cho mọi topic | `finding_hash()` thêm `topic_id` vào key (trước chỉ có `issue_type + node + query_hash`) |
| Lock contention — cụm lỗi block cụm khác | `_refresh_all_node_roles` giữ `self._lock` trong lúc query SQL Server → UAT timeout 30s block prod topic jobs | Snapshot `_role_caches` dict dưới lock, sau đó refresh từng cache **bên ngoài lock**; `_build_cluster_runtime` trả về tuple thay vì mutate state trực tiếp |

**Sau khi deploy finding_hash fix**, cần xóa dedup cache cũ:
```javascript
db.dedup_cache.deleteMany({})
```

---

## Code Rules

### R1 · Type Hints
Full annotation trên mọi function: params + return type.

### R2 · Pydantic Models
Data giữa modules **bắt buộc** là Pydantic model. Exceptions: MongoDB aggregation internals.

### R3 · Thread Safety
`pyodbc.Connection` tạo mới per-call. `MongoClient` singleton. APScheduler `max_instances=1`.

### R4 · Error Handling
| Tình huống | Xử lý |
|---|---|
| MSSQL node unreachable | Log ERROR, return `QueryResult(success=False)`, skip node |
| Query timeout | Log WARNING, return empty QueryResult |
| MongoDB unavailable | Log CRITICAL, retry exponential backoff |
| Topic disabled | Skip execution, log INFO |
| Detector exception | Log ERROR + traceback, return `[]` findings, scheduler continues |
| Missing env var | `raise ValueError` ngay startup (fail fast) |

### R5 · Logging
Structured, có context: `node`, `topic_id`, `query_id`, metric values.

### R6 · Comments
Giải thích **WHY**, KHÔNG giải thích WHAT. Business/kỹ thuật decisions only.

### R7 · Query Safety
Tất cả SQL queries trong `monitor_topics` phải có `TOP N` hoặc `WHERE` thời gian. `query_executor` có thể validate tại runtime.

### R8 · APScheduler
`max_instances=1`, `coalesce=True`, mọi job idempotent.

### R9 · MongoDB Writes
`insert_many` cho raw_metrics. `insert_one` cho findings. `findOne`/`updateOne` cho dedup. `findOneAndUpdate` cho baselines.

### R10 · Import Order
stdlib → third-party → internal (relative imports).

---

## Constraints — Điều KHÔNG làm

| Constraint | Lý do |
|---|---|
| **KHÔNG** hardcode SQL queries trong Python | Config-driven: queries nằm trong MongoDB `monitor_topics` |
| **KHÔNG** hardcode node roles (Primary/Secondary) | AG failover bất kỳ lúc nào → detect dynamically qua `node_role_cache` |
| **KHÔNG** gợi ý `OPTION(OPTIMIZE FOR UNKNOWN)` | Gây CPU overload khi throughput cao trên hệ thống này |
| **KHÔNG** share pyodbc connection giữa threads | pyodbc không thread-safe → race condition |
| **KHÔNG** query DMV không có TOP/WHERE | dm_exec_query_stats có thể 100k+ rows |
| **KHÔNG** dùng rolling 7-day average cho baseline | Workload pattern theo ngày → false positives |
| **KHÔNG** để exception crash scheduler | 1 topic fail → tất cả monitoring dừng = unacceptable |
| **KHÔNG** dùng `python-telegram-bot` v21+ | Async-only, không tương thích APScheduler sync — dùng urllib.request |
| **KHÔNG** tự động phân tích finding với Claude | On-demand only — DBA chủ động gõ `/quick` hoặc `/analyze` |
| **/quick (Layer 1) vs /analyze (Layer 2)** | Phân tách: quick=Haiku (5s, giá rẻ), analyze=Sonnet agent (30–90s, full tools) |
| **KHÔNG** bỏ `topic_id` khỏi `finding_hash()` | Dẫn đến dedup collision giữa các topic khác nhau |
| **KHÔNG** capture finding khi severity < CRITICAL | WARNING findings không cần full snapshot — tốn compute không có giá trị |
| **KHÔNG** hardcode SQL trong `diagnostic_capture.py` | SQL templates nằm trong `capture_tool_defs` MongoDB — config-driven |
| **KHÔNG** start service khi `capture_tool_defs` rỗng | Fail fast tại startup thay vì silent failure lúc runtime |

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Config-driven** (queries/thresholds trong MongoDB) | Thêm/sửa query không cần redeploy Python code |
| **Node role auto-detect** + cache refresh mỗi giờ | AG failover transparent, không hardcode roles |
| **Standalone single-instance** | Đơn giản hóa; không cần leader election overhead |
| **Reload config mỗi job run** | Pick up query/threshold changes ngay, không restart |
| **Detector registry pattern** | Thêm detector type = 1 class + register, không sửa logic cũ |
| **Day-of-week baseline** | Pattern workload khác nhau theo ngày |
| **Parallel per node** (ThreadPoolExecutor) | 3 nodes × sequential = triple latency |
| **Job per `(cluster_id, topic_id)`** | Cụm lỗi không block topic jobs của cụm khác |
| **APScheduler `max_workers=50`** | N cụm × M topics fire đồng thời; I/O-bound nên thread pool lớn không tốn CPU |
| **`_refresh_all_node_roles` ngoài lock** | Snapshot dict dưới lock → refresh bên ngoài; tránh UAT timeout block prod |
| **`cluster_id` trong findings** | Layer 3 filter findings đúng per cluster khi multi-cluster |
| **DiagnosticCapture chỉ trigger khi CRITICAL** | Tiết kiệm compute — chỉ snapshot những gì thực sự quan trọng |
| **Capture tool defs trong MongoDB** (`capture_tool_defs`) | SQL templates + AI hints config-driven, không hardcode trong Python |
| **`finding_diagnostics` self-contained** | Layer 2 nhận snapshot đầy đủ, không cần query thêm MongoDB lúc phân tích |
| **Handler registry** cho static/mongo tools | Thêm tool mới = 1 handler class + register, không sửa `diagnostic_capture.py` |

---

## Dependencies

```
pyodbc                 — MSSQL connection (per-call, thread-safe usage)
pymongo                — MongoDB (singleton MongoClient)
pydantic               — Data models + validation
pydantic-settings      — EnvSettings
APScheduler            — Job scheduling
lxml                   — XML execution plan parsing
pymsteams              — Teams webhook notification
tenacity               — Retry exponential backoff
python-dotenv          — .env file loading
anthropic              — Claude API (sync client, dùng trong PlanAnalyzer)
python-logstash-async  — Centralized logging tới Logstash (optional — chỉ cần khi LOGSTASH_HOST set)
```

**Không dùng `python-telegram-bot`** — thư viện v21 là async-only, không tương thích với APScheduler sync. Thay vào đó dùng `urllib.request` (stdlib) trực tiếp cho cả TelegramNotifier lẫn TelegramBot polling.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn


