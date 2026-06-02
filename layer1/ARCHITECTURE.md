# ARCHITECTURE.md — Layer 1: MSSQL Monitoring Service

## Mục đích

Daemon Python chạy liên tục, định kỳ truy vấn MSSQL cluster, phát hiện sự cố, ghi findings vào MongoDB, gửi alert. Output chính (`findings` + `finding_diagnostics`) là đầu vào cho Layer 2 AI Agent.

---

## Kiến trúc tổng thể

```
python -m layer1.main
    │
    ├── Thread: APScheduler (daemon)      ← monitoring jobs
    │       │
    │       └── TopicRunner.run(topic_id) × N topics (không đồng thời)
    │               max_instances=1, coalesce=True per job
    │
    ├── Thread: TelegramBot._poll_loop() (daemon)  ← on-demand commands
    │
    └── Main thread: HTTP server (ThreadingHTTPServer — stdlib)
            GET /health
            POST /kill-session
```

Hai daemon thread chạy song song với main thread HTTP server. Không có shared mutable state giữa các thread ngoài `MongoClient` (thread-safe singleton) và `NodeRoleCache` (read-heavy, có lock).

---

## Startup Sequence

```
1. _setup_logging()
       → basicConfig level từ LOG_LEVEL env
       → AsynchronousLogstashHandler nếu LOGSTASH_HOST set (UDP transport)

2. MongoConnection.initialize(settings)
       → MongoClient singleton (thread-safe, dùng chung)
       create_all_indexes(db)  ← idempotent, chạy mỗi startup

3. CaptureToolLoader.load_all()
       → Load tất cả CaptureToolDef từ capture_tool_defs MongoDB
       → Fail fast nếu collection rỗng (chưa seed)
       → Cache in-memory để DiagnosticCapture dùng

4. NodeRoleCache.initialize()
       → Query sys.dm_hadr_availability_replica_states trên first reachable node
       → Cache: { host → NodeRole (PRIMARY/SECONDARY) }
       → Fail fast nếu không node nào reachable

5. Khởi tạo repositories, executors, detector registry, DiagnosticCapture
       → Tất cả inject vào TopicRunner constructor

6. TopicRepo.find_all(enabled=True)
       → Đọc tất cả monitor_topics enabled
       → Đăng ký 1 APScheduler interval job per topic
       → job_id = topic_id, interval = topic.schedule_sec

7. System jobs:
       node_role_refresh (NODE_ROLE_REFRESH_SEC, default 3600s)
       health_check (120s) → detect stuck/missed jobs, MongoDB ping

8. NotificationDispatcher:
       TelegramNotifier nếu TELEGRAM_BOT_TOKEN set
       TeamsNotifier nếu TEAMS_WEBHOOK_URL set

9. TelegramBot.start() nếu TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set
       → daemon thread: /quick, /kill-session, → forward Layer 2

10. scheduler.start()  ← blocking
        main thread: HTTP server.serve_forever()
```

---

## Core Data Flow — 1 Topic Run

```
APScheduler trigger → TopicRunner.run("slow_sessions")
│
│  [Inject từ constructor — không tạo mới per-run]
│  _topic_repo, _raw_metrics_repo, _findings_repo, _dedup_repo
│  _executor, _role_cache, _detectors, _dispatcher, _diagnostic_capture
│
├── ① topic_repo.find_by_id("slow_sessions")
│       → Reload config từ MongoDB mỗi run
│       → topic.enabled? Nếu False: return 0 (skip)
│
├── ② node_role_cache.resolve(topic.nodes)
│       topic.nodes = ["primary"]  → [("10.x.x.1", NodeRole.PRIMARY)]
│       topic.nodes = ["secondary"] → [("10.x.x.2", ...), ("10.x.x.3", ...)]
│       topic.nodes = ["all"]       → tất cả nodes
│
├── ③ Parallel per node (ThreadPoolExecutor, max_workers=len(nodes))
│       Thread per node:
│           query_executor.execute(topic.queries, host)
│               → 1 pyodbc connection per node (tạo mới, không cache)
│               → Execute tất cả queries trong topic.queries
│               → Convert Decimal→float (pyodbc trả Decimal, MongoDB không serialize)
│               → Return QueryResult{ rows, duration_ms, success }
│
├── ④ raw_metrics_repo.insert_many(all_results)
│       → TTL 30 ngày
│
├── ⑤ detector = registry.get(topic.detector_type)
│       "threshold"  → ThresholdDetector
│       "baseline"   → BaselineDetector
│       "plan"       → PlanDetector
│       "blocking"   → BlockingDetector
│       None         → skip (chỉ lưu raw)
│
│       detector.detect(results, topic) → list[Finding]
│           ThresholdDetector: value > topic.thresholds[metric].warning → WARNING
│                              value > topic.thresholds[metric].critical → CRITICAL
│           BaselineDetector:  value > baseline_avg + 3*stddev → CRITICAL
│                              baseline query: cùng day_of_week + hour trong 4 tuần
│
├── ⑥ Per finding:
│       if finding.severity == CRITICAL and topic.capture_tools:
│           DiagnosticCapture.capture(finding, topic)
│               ← xem chi tiết Diagnostic Capture section
│           finding.has_diagnostics = True
│
├── ⑦ findings_repo.insert(finding)
│
└── ⑧ DedupRepo.check_and_set(finding_hash):
        finding_hash = hash(topic_id + issue_type + node + query_hash)
        Đã alert trong DEDUP_SUPPRESS_MINUTES? → skip
        Không? → dispatcher.dispatch(finding)
                    → TelegramNotifier.send_alert()
                    → TeamsNotifier.send_alert()
```

---

## Diagnostic Capture — 4 Phases

Chạy ngay khi phát hiện CRITICAL finding. Mục tiêu: snapshot đầy đủ tại T+0 để Layer 2 phân tích sau mà không cần query DB lại.

```
DiagnosticCapture.capture(finding, topic)
│
│  tool_ids = set(topic.capture_tools)  ← từ MongoDB config
│  all_results: dict[str, dict] = {}
│
├── Phase 1: Parallel DMV snapshot (budget 15s)
│       ThreadPoolExecutor — tất cả SQL tools chạy đồng thời
│       Mỗi tool: CaptureToolDef.execution_type == "sql"
│           mssql_connection(finding.node) → pyodbc cursor
│           execute SQL template với params từ finding.metrics
│           → {"status": "ok", "rows": [...], "duration_ms": ...}
│       Timeout 15s tổng — tool nào chưa xong sau 15s → kết quả partial/timeout
│
│       Ví dụ tools: get_wait_stats, get_blocking_info,
│                    get_query_stats, get_plan_xml, get_session_details
│
├── Phase 2: Static analysis (in-process, không query MSSQL)
│       CaptureToolDef.execution_type == "static"
│       STATIC_HANDLERS registry:
│           "get_plan_analysis":
│               Lấy query_plan_xml từ Phase 1 results
│               PlanAnalyzer.analyze(xml) → ToolSnapshot (plan findings)
│           "get_query_structure":
│               Lấy query_text từ finding.metrics hoặc Phase 1
│               QueryAnalyzer.analyze(sql) → tables, joins, predicates
│       → affected_tables: list[str]  ← dùng cho Phase 3
│
├── Phase 3: Table-specific DMV (sequential, max 3 tables)
│       CaptureToolDef có affected_table_required = True
│       Ví dụ: get_index_usage, get_statistics_info
│       Mỗi table: execute SQL template với table_name param
│       Max 3 tables để tránh excessive queries
│
├── Phase 4: MongoDB reads (không query MSSQL)
│       CaptureToolDef.execution_type == "mongo"
│       MONGO_HANDLERS registry:
│           "get_table_context":      db_context → schema info cho affected_tables
│           "get_recent_findings":    findings 24h gần nhất cùng issue_type + node
│           "get_analysis_history":   issue_insights + ai_analyses cho issue_type
│
└── Insert finding_diagnostics document:
        {
          finding_id,
          topic_id,
          captured_at,
          duration_ms,
          tools_captured: ["get_wait_stats", ...],
          tools_failed: [],
          results: {
            "get_wait_stats": { status: "ok", rows: [...] },
            "get_plan_analysis": { status: "ok", findings: [...], signals: {...} },
            ...
          }
        }
```

**Self-contained:** `finding_diagnostics` document đủ để Layer 2 phân tích mà không cần query MSSQL thêm. Layer 2 đọc `results` dict và truyền vào agentic context.

---

## Node Role Cache

```
NodeRoleCache
│
├── initialize()
│       Query: SELECT ar.replica_server_name, ar.role_desc
│              FROM sys.dm_hadr_availability_replica_states ar
│              JOIN sys.availability_replicas r ON ...
│       → _cache: { "10.x.x.1": PRIMARY, "10.x.x.2": SECONDARY, ... }
│       → _last_refresh: datetime
│
├── resolve(node_targets: list[str]) → list[(host, role)]
│       "primary"    → host với role == PRIMARY
│       "secondary"  → hosts với role == SECONDARY
│       "all"        → tất cả hosts
│       "10.x.x.1"   → hostname cụ thể (override)
│
├── get_primary_host() → str | None
│
├── refresh()
│       Gọi bởi system job mỗi NODE_ROLE_REFRESH_SEC (default 3600s)
│       Detect failover: primary thay đổi → log WARNING
│
└── _is_stale() → bool
        Cache > 2 giờ không refresh → coi là stale
        TopicRunner kiểm tra trước khi execute
```

**AG Failover handling:** Nếu Primary failover, job run kế tiếp (`cache.resolve("primary")`) sẽ dùng cache cũ tối đa 1 giờ. Sau đó `node_role_refresh` job cập nhật cache. TopicRunner không hardcode IP nào.

---

## Detector Registry

```
DetectorRegistry.build_default()
    ├── register("threshold",  ThresholdDetector)
    ├── register("baseline",   BaselineDetector)
    ├── register("plan",       PlanDetector)
    └── register("blocking",   BlockingDetector)

ThresholdDetector.detect(results, topic):
    for row in results:
        for metric, threshold in topic.thresholds.items():
            value = row[metric]
            if value > threshold.critical → Finding(CRITICAL)
            elif value > threshold.warning → Finding(WARNING)

BaselineDetector.detect(results, topic):
    now = current day_of_week + hour
    baseline = BaselineRepo.get(metric, day_of_week, hour, node)
    if baseline.samples < 2: skip (không đủ data)
    z_score = (value - baseline_avg) / baseline_stddev
    if z_score > 3.0 → Finding(CRITICAL)
    Update baseline samples (rolling 4-week window)
```

---

## Telegram Bot — Command Dispatch

```
TelegramBot._poll_loop()
    │ getUpdates (long-poll, timeout=25s)
    │
    └── Per update:
            ├── /quick <id>
            │       → PlanAnalyzer(haiku_model).analyze(finding) → reply text
            │
            ├── Reply vào Layer 1 alert message:
            │       extract finding_id từ "🔗 ID: <code>XXXXXXXX</code>"
            │       │
            │       ├── text.startswith("/quick"):
            │       │       → PlanAnalyzer(haiku_model).analyze(finding)
            │       │
            │       ├── TopicActionRegistry.get(topic_id, command):
            │       │       /kill-session, /kill-blocking (cho slow_sessions topic)
            │       │       → TopicActionHandler.execute(finding, command)
            │       │           → SessionService.kill_session(session_id, nodes)
            │       │               → KILL <id> trên tất cả resolved nodes
            │       │
            │       └── Else (bất kỳ text khác):
            │               → POST http://layer2:8000/api/v1/analyze
            │                   { finding_id, telegram_chat_id, channel="telegram" }
            │               (Layer 2 xử lý, gửi document riêng)
            │
            └── /analyze <text>
                    (redirect DBA sang Layer 2 bot — Layer 1 không xử lý lệnh này)
```

---

## HTTP API

Stdlib `http.server.ThreadingHTTPServer` — mỗi request xử lý trong thread riêng (không phải async).

```
POST /kill-session
    Body: { "session_id": 12345, "node": "SQL-NODE-01" }  ← node là bắt buộc
    → SessionService.kill_session(session_id, hosts=[node])
        → KILL 12345 trên node được chỉ định
    → 200 { "killed": true, ... }  hoặc 400 nếu thiếu node/session_id

GET /health
    → { "status": "ok", "scheduler_alive": true, "mongodb": "connected" }
    200 nếu ok, 503 nếu scheduler crash
```

---

## Threading Model

```
Main thread (HTTP server — ThreadingHTTPServer)
    Request N: Thread N (tạo mới per-request, stdlib)
    → SessionService.kill_session() — tạo pyodbc connection riêng

Daemon thread: APScheduler (BlockingScheduler, single thread)
    Job 1: TopicRunner.run("ag_health")          ← sequential
    Job 2: TopicRunner.run("slow_sessions")       ← sequential
    ...
    Trong TopicRunner.run():
        ThreadPoolExecutor (len(resolved_nodes) threads)
            Thread: query_executor.execute(queries, "SQL-NODE-01")
            Thread: query_executor.execute(queries, "SQL-NODE-02")
        (Sau đó sequential: detect → capture → notify)

Daemon thread: TelegramBot._poll_loop()
    Single thread, xử lý 1 update tại 1 thời điểm
    Tạo pyodbc connection riêng khi cần
```

**Thread safety rules:**
- `pyodbc.Connection`: tạo mới trong `mssql_connection()` context manager, KHÔNG cache, KHÔNG share
- `pymongo.MongoClient`: singleton thread-safe, share được
- APScheduler jobs: `max_instances=1, coalesce=True` — không bao giờ chạy song song cùng topic
- `NodeRoleCache._cache`: có threading.Lock khi write (refresh), read không cần lock

---

## MongoDB Collections

| Collection | Write | Read | TTL | Notes |
|---|---|---|---|---|
| `monitor_topics` | seed/manual | TopicRunner mỗi run | — | Source of truth cho config |
| `node_roles` | NodeRoleCache | — | — | Persist role state |
| `raw_metrics` | TopicRunner | — | **3d** | Mọi query result |
| `findings` | TopicRunner | Layer 2, Layer 3 | **9d** | Phát hiện sự cố |
| `finding_diagnostics` | DiagnosticCapture | Layer 2 | **9d** | Snapshot T+0 |
| `capture_tool_defs` | seed | CaptureToolLoader | — | SQL templates |
| `baselines` | BaselineDetector | BaselineDetector | — | Day-of-week samples |
| `dedup_cache` | TopicRunner | TopicRunner | 7d | Chống duplicate alert |
| `job_executions` | JobRunner | HealthChecker | **3d** | Run history |

---

## Constraints

| Constraint | Lý do |
|---|---|
| KHÔNG hardcode SQL trong Python | Queries nằm trong MongoDB — thêm/sửa không cần redeploy |
| KHÔNG hardcode node roles | AG failover có thể xảy ra bất kỳ lúc |
| KHÔNG `OPTION(OPTIMIZE FOR UNKNOWN)` | CPU overload trên hệ thống high-throughput |
| KHÔNG share pyodbc connection | pyodbc không thread-safe |
| KHÔNG query DMV không có TOP/WHERE | `dm_exec_query_stats` có thể 100k+ rows |
| KHÔNG dùng rolling 7-day average | Workload pattern khác nhau theo ngày trong tuần |
| KHÔNG auto-analyze với Claude | On-demand only — DBA chủ động |
| KHÔNG bỏ `topic_id` khỏi `finding_hash` | Dedup collision giữa các topics |
| KHÔNG capture khi severity < CRITICAL | WARNING không cần full snapshot |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
