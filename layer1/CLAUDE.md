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
python -m layer1.scheduler
```

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

6. scheduler.start() — blocking
   → SIGTERM/SIGINT → graceful shutdown
```

**Deployment:** Standalone single-instance.

---

## Cấu trúc Module

```
layer1/
├── scheduler.py               ← Entry: setup → register topic jobs → start
├── config.py                  ← EnvSettings only (MSSQL hosts, MongoDB URI, credentials)
│
├── models/
│   ├── common.py              ← Severity, NodeRole, IssueType enums
│   ├── topic.py               ← MonitorTopic, QueryConfig, ThresholdConfig, BaselineConfig
│   ├── metrics.py             ← RawMetric, QueryResult
│   ├── findings.py            ← Finding (output → MongoDB → Layer 2)
│   └── job.py                 ← JobExecution, JobStatus
│
├── executor/
│   ├── mssql_connection.py    ← pyodbc context manager (tạo mới per-call, KHÔNG cache)
│   ├── query_executor.py      ← Generic: nhận QueryConfig + host → execute → QueryResult
│   ├── topic_runner.py        ← Orchestrate 1 topic: reload config → resolve nodes → query → detect → notify
│   └── node_role_cache.py     ← Detect Primary/Secondary từ AG DMV, cache, refresh mỗi giờ
│
├── detectors/
│   ├── registry.py            ← Map detector_type string → handler class
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
│       ├── findings_repo.py       ← insert_one findings
│       ├── baseline_repo.py       ← Day-of-week baseline CRUD
│       ├── dedup_repo.py          ← Atomic check-and-set chống spam alert
│       └── job_execution_repo.py  ← Job run history + stuck/missed detection
│
├── job_manager/
│   ├── job_runner.py          ← Decorator: ghi job_executions (start/finish/fail)
│   └── health_checker.py      ← Detect stuck/missed jobs, MongoDB ping
│
└── notifications/
    ├── base_notifier.py       ← ABC + NotificationDispatcher (multi-channel)
    └── teams_notifier.py      ← Microsoft Teams Incoming Webhook
```

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

TEAMS_WEBHOOK_URL=https://...
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
    ├── 6. findings_repo.insert(finding)
    │
    └── 7. dedup check → notify nếu chưa alert gần đây
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
  "metric_type": "slow_query",
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
| `raw_metrics` | 30d | `insert_many` per job run | `(topic_id, query_id, collected_at)` |
| `findings` | 90d | `insert_one` per finding | `(topic_id, detected_at)`, `(issue_type, detected_at)` |
| `baselines` | — | `update_one` upsert | `(metric_type, day_of_week, hour, node)` |
| `dedup_cache` | 7d | `findOneAndUpdate` | unique `(finding_hash)` |
| `job_executions` | 30d | `insert_one` + `update_one` | `(job_name, started_at)` |
| `ai_analysis` | 90d | (Layer 2) | — |
| `approval_queue` | — | (Layer 2) | — |
| `audit_log` | — | (Layer 2) | — |

---

## Threading Model

```
APScheduler main thread
    │
    └─► topic_runner.run(topic_id)
            │
            ├─► ThreadPoolExecutor (max_workers = len(resolved_nodes))
            │       Thread 1: query_executor.execute(queries, "SQL-NODE-01") — pyodbc conn mới
            │       Thread 2: query_executor.execute(queries, "SQL-NODE-02") — pyodbc conn mới
            │       Thread 3: query_executor.execute(queries, "SQL-NODE-03") — pyodbc conn mới
            │
            └─► detect + save + notify (main thread)
```

**Thread safety:**
- `pyodbc.Connection`: **KHÔNG thread-safe** → tạo mới trong context manager, KHÔNG cache
- `pymongo.MongoClient`: **thread-safe** → singleton
- APScheduler jobs: `max_instances=1` + `coalesce=True`

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
`insert_many` cho raw_metrics. `insert_one` cho findings. `findOneAndUpdate` cho dedup + baselines.

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

---

## Dependencies

```
pyodbc          — MSSQL connection (per-call, thread-safe usage)
pymongo         — MongoDB (singleton MongoClient)
pydantic        — Data models + validation
pydantic-settings — EnvSettings
APScheduler     — Job scheduling
lxml            — XML execution plan parsing
pymsteams       — Teams webhook notification
tenacity        — Retry exponential backoff
python-dotenv   — .env file loading
```
