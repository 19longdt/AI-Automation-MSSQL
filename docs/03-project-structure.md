# Cấu trúc dự án

## Sơ đồ thư mục

```
AI-Automation-MSSQL/
│
├── Dockerfile                # Build image Python + ODBC Driver 17
├── docker-compose.yml        # Stack: layer1 + mongodb
├── .dockerignore
├── .env.example              # Template environment variables
├── requirements.txt          # Thư viện Python
├── CLAUDE.md                 # Hướng dẫn cho AI assistant
│
├── docs/                     # Tài liệu (thư mục này)
│   ├── 01-overview.md
│   ├── 02-architecture.md
│   ├── 03-project-structure.md  ← Bạn đang đọc file này
│   ├── 04-data-flow.md
│   ├── 05-database.md
│   ├── 06-configuration.md
│   ├── 07-deployment.md      # Docker Compose deployment
│   └── 08-local-development.md
│
└── layer1/                   # Layer 1: Python Monitoring Service
    ├── __init__.py
    ├── scheduler.py          # Entry point — chạy ở đây
    ├── config.py             # Cấu hình từ .env file
    │
    ├── models/               # Cấu trúc dữ liệu (Pydantic models)
    │   ├── common.py         # Enums: Severity, NodeRole, IssueType
    │   ├── topic.py          # MonitorTopic, AnalysisConfig — config từ MongoDB
    │   ├── metrics.py        # QueryResult, RawMetric
    │   ├── findings.py       # Finding — kết quả phân tích
    │   └── job.py            # JobExecution — tracking job run
    │
    ├── executor/             # Thực thi SQL queries
    │   ├── mssql_connection.py   # Tạo/đóng kết nối MSSQL
    │   ├── node_role_cache.py    # Detect Primary/Secondary từ AG DMV → cache IP
    │   ├── query_executor.py     # Chạy SQL query → QueryResult (Decimal→float)
    │   └── topic_runner.py       # Orchestrate 1 topic run
    │
    ├── detectors/            # Phân tích kết quả → tìm vấn đề
    │   ├── registry.py           # Map "threshold"/"baseline" → handler
    │   ├── threshold_detector.py # So sánh với ngưỡng cố định
    │   └── baseline_detector.py  # So sánh với lịch sử day-of-week
    │
    ├── storage/              # Lưu/đọc dữ liệu MongoDB
    │   ├── mongo_client.py       # Kết nối MongoDB (singleton)
    │   ├── indexes.py            # Tạo indexes + TTL khi startup
    │   └── repositories/
    │       ├── topic_repo.py         # CRUD monitor_topics
    │       ├── raw_metrics_repo.py   # Lưu raw query results
    │       ├── findings_repo.py      # Lưu findings, find_by_id_prefix()
    │       ├── baseline_repo.py      # Đọc/ghi baseline lịch sử
    │       ├── dedup_repo.py         # Check/ghi dedup cache (atomic)
    │       └── job_execution_repo.py # Track job run history
    │
    ├── job_manager/          # Quản lý vòng đời job
    │   ├── job_runner.py         # Decorator ghi job_executions
    │   └── health_checker.py     # Phát hiện stuck/missed jobs
    │
    ├── notifications/        # Gửi thông báo + Telegram bot
    │   ├── base_notifier.py      # ABC + NotificationDispatcher
    │   ├── teams_notifier.py     # Microsoft Teams webhook
    │   ├── telegram_notifier.py  # Telegram alert (HTML parse mode)
    │   └── telegram_bot.py       # Bot polling + /analyze command handler
    │
    └── ai/                   # Claude API integration
        └── plan_analyzer.py      # Build prompt từ analysis_config → gọi Claude
```

---

## Giải thích chi tiết từng phần

### `scheduler.py` — Entry point

Đây là file bạn chạy khi start service. Nó làm:
1. Khởi tạo tất cả components theo đúng thứ tự
2. Đọc tất cả topics enabled từ MongoDB
3. Đăng ký APScheduler job cho mỗi topic
4. Gọi `scheduler.start()` — chương trình chạy mãi cho đến khi nhận SIGTERM

```python
# Cách chạy
python -m layer1.scheduler
```

---

### `config.py` — Cấu hình môi trường

Đọc biến môi trường từ `.env` file. Chỉ chứa thông tin kết nối và credentials — những thứ cần biết **trước khi** kết nối MongoDB.

```python
# Tất cả query và threshold được lưu trong MongoDB
# config.py chỉ biết: địa chỉ node, username/password, URI MongoDB
```

---

### `models/` — Cấu trúc dữ liệu

Tất cả dữ liệu truyền giữa các modules **phải** là Pydantic model, không phải dict thô. Điều này giúp:
- Validate dữ liệu tự động (sai kiểu → báo lỗi rõ ràng)
- IDE gợi ý code (autocomplete)
- Dễ đọc hiểu cấu trúc

**`common.py`** — 3 enum dùng khắp nơi:
- `Severity`: INFO < WARNING < CRITICAL
- `NodeRole`: primary / secondary
- `IssueType`: 20 loại vấn đề (slow_query, blocking, ag_lag, ...)

**`topic.py`** — Cấu trúc config đọc từ MongoDB:
```
MonitorTopic
  ├── topic_id: "ag_health"
  ├── schedule_sec: 120
  ├── nodes: ["primary"]
  ├── queries: [QueryConfig(...)]
  ├── detector_type: "threshold"
  └── thresholds: {"log_send_queue_size": {warning: 500, critical: 1000}}
```

**`findings.py`** — Kết quả khi detector phát hiện vấn đề:
```
Finding
  ├── issue_type: IssueType.SLOW_QUERY
  ├── severity: Severity.WARNING
  ├── node: "SQL-NODE-01"
  ├── query_hash: "0xABCD1234"
  ├── metrics: {"avg_ms": 450, "baseline_ms": 120, "pct_increase": 275}
  └── status: "new"  (new → analyzing → analyzed → resolved)
```

---

### `executor/` — Thực thi SQL

**`mssql_connection.py`**

Context manager tạo kết nối mới mỗi lần gọi. **QUAN TRỌNG**: pyodbc connection KHÔNG thread-safe, vì vậy KHÔNG bao giờ dùng chung giữa các thread.

```python
# Cách dùng đúng — mỗi lần tạo connection mới
with mssql_connection("SQL-NODE-01") as conn:
    cursor = conn.execute("SELECT @@VERSION")
    # connection tự đóng khi ra khỏi with block
```

**`node_role_cache.py`**

Cache in-memory cho AG node roles. Refresh mỗi giờ từ DMV. Thread-safe: chỉ có APScheduler refresh job mới ghi vào cache.

**`query_executor.py`**

Chạy SQL và trả về `QueryResult`. **KHÔNG raise exception** — mọi lỗi được capture vào `QueryResult.error_message`. Caller không cần try/except.

**`topic_runner.py`**

Orchestrator trung tâm. Khi APScheduler trigger một topic job:
1. Reload config từ MongoDB
2. Resolve nodes (ví dụ: "primary" → "SQL-NODE-01")
3. Chạy `execute_batch` trên mỗi node **song song** (ThreadPoolExecutor)
4. Lưu raw_metrics
5. Chạy detector
6. Lưu findings, check dedup, gửi alert

---

### `detectors/` — Phân tích vấn đề

Dùng **Registry pattern**: `detector_type` string trong config → map sang class handler.

```python
# Thêm detector mới = thêm 1 class + register trong build_default()
# Không cần sửa code cũ
registry.register("my_new_detector", MyNewDetector())
```

Mỗi detector nhận `results: list[QueryResult]` và `topic: MonitorTopic`, trả về `list[Finding]`.

---

### `storage/` — Lưu trữ

**`mongo_client.py`**: Singleton — toàn service dùng 1 `MongoClient` duy nhất. `pymongo.MongoClient` là thread-safe và tự quản lý connection pool.

**`indexes.py`**: Tạo indexes khi startup. Idempotent — gọi nhiều lần không sao.

**Repositories**: Mỗi collection có 1 repo class. Tất cả MongoDB operations đi qua đây.

---

### `job_manager/` — Quản lý job lifecycle

**`job_runner.py`**: Decorator ghi lịch sử mỗi lần job chạy vào `job_executions` collection.

```python
# Cách dùng trong scheduler
@job_runner.wrap("slow_query_check")
def run_slow_query():
    return topic_runner.run("slow_query")
# Tự động ghi: started_at, finished_at, duration_ms, status, findings_created
```

**`health_checker.py`**: Chạy mỗi 2 phút, phát hiện:
- **Stuck job**: status=RUNNING quá 5 phút
- **Missed job**: chưa chạy trong 1.5× interval
- **MongoDB down**: ping thất bại

---

### `notifications/` — Gửi thông báo

**`base_notifier.py`**: Abstract class + `NotificationDispatcher`.

`NotificationDispatcher` nhận danh sách notifiers và `min_severity`. Chỉ dispatch nếu `finding.severity >= min_severity`.

**`teams_notifier.py`**: Gửi Adaptive Card đến Teams channel qua Incoming Webhook. Color coding: đỏ=CRITICAL, vàng=WARNING.

---

## Thứ tự khởi động (startup sequence)

```
1. Load .env file → EnvSettings
2. MongoConnection.initialize() → kết nối MongoDB
3. create_all_indexes() → tạo indexes (idempotent)
4. NodeRoleCache.initialize() → detect AG roles
5. Khởi tạo repositories (không làm gì, chỉ reference MongoClient)
6. Khởi tạo QueryExecutor, DetectorRegistry, notifications
7. Khởi tạo TopicRunner (inject tất cả dependencies)
8. Khởi tạo JobRunner (execution tracking)
9. Đọc monitor_topics enabled từ MongoDB
10. Đăng ký APScheduler jobs
11. scheduler.start() — blocking, chạy mãi
```

Nếu bất kỳ bước nào từ 1-4 thất bại → service **không start** (fail fast). Đây là đúng vì không có MongoDB hoặc MSSQL thì service vô nghĩa.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
