# Configuration — Cấu hình hệ thống

Hệ thống có 2 loại cấu hình:
1. **Environment variables** (`.env` file) — thông tin kết nối, credentials
2. **MongoDB `monitor_topics`** — queries, thresholds, schedules

---

## 1. Environment Variables (`.env` file)

Tạo file `.env` trong thư mục gốc dự án:

```env
# ── MSSQL Nodes ──────────────────────────────────────────────────────
# Danh sách tất cả nodes trong AG cluster, ngăn cách bằng dấu phẩy
# Roles (Primary/Secondary) được tự động detect — không cần chỉ định
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03

# Database cần monitor
MSSQL_DATABASE=YourDatabase

# Service account (cần quyền: VIEW SERVER STATE, VIEW DATABASE STATE)
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=your_secure_password

# Port (default 1433)
MSSQL_PORT=1433

# Timeout mặc định cho mỗi query (giây). Có thể override per-query
MSSQL_QUERY_TIMEOUT_SEC=30

# ── MongoDB ──────────────────────────────────────────────────────────
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor

# ── Node Role Cache ──────────────────────────────────────────────────
# Refresh AG node roles mỗi N giây (default 3600 = 1 giờ)
NODE_ROLE_REFRESH_SEC=3600

# ── Notifications ────────────────────────────────────────────────────
# Chỉ cần điền kênh bạn muốn dùng, để trống = không gửi

# Microsoft Teams (Incoming Webhook URL)
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...

# Slack (Bot Token)
SLACK_BOT_TOKEN=xoxb-...

# Telegram (Bot Token + Chat ID)
TELEGRAM_BOT_TOKEN=1234567890:ABC...
TELEGRAM_CHAT_ID=-1001234567890    # Dùng @userinfobot để lấy chat_id

# ── AI Analysis (Claude API) ─────────────────────────────────────────
# Dùng cho /analyze command trong Telegram bot
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6

# ── Logging ───────────────────────────────────────────────────────────
L1_LOG_LEVEL=INFO   # DEBUG | INFO | WARNING | ERROR
L2_LOG_LEVEL=INFO   # DEBUG | INFO | WARNING | ERROR
# LOG_LEVEL=INFO    # fallback legacy cho ca 2 layer

# ── Logstash centralized logging ─────────────────────────────────────
# Để trống LOGSTASH_HOST → disable (chỉ log ra console/stdout)
# Tuỳ transport:
#   tcp -> input tcp { port => 5044 codec => json_lines }
#   udp -> input udp { port => 5044 codec => json }
LOGSTASH_HOST=10.100.110.185
LOGSTASH_PORT=5044
LOGSTASH_TRANSPORT=tcp  # tcp | udp (khuyen nghi tcp)
L1_LOGSTASH_APP_NAME=sds.ep.ai-automation-layer1
L2_LOGSTASH_APP_NAME=sds.ep.ai-automation-layer2
# LOGSTASH_APP_NAME=sds.ep.ai-automation   # fallback legacy neu muon dung chung
# SQLite persistent queue để không mất log khi container restart.
# Trống = in-memory queue (tiện cho dev, không dùng cho production).
LOGSTASH_DATABASE_PATH=/var/lib/layer1/logstash/queue.db
```

### Quyền SQL Server cần thiết

Service account `sa_monitor` cần các quyền sau:

```sql
-- Tạo login và user
CREATE LOGIN sa_monitor WITH PASSWORD = 'your_password';
USE YourDatabase;
CREATE USER sa_monitor FOR LOGIN sa_monitor;

-- Quyền đọc DMV system-wide
GRANT VIEW SERVER STATE TO sa_monitor;
GRANT VIEW DATABASE STATE TO sa_monitor;

-- Đọc Query Store
GRANT EXECUTE ON sys.sp_query_store_flush_db TO sa_monitor;

-- Đọc SQL Agent job history (dùng msdb)
USE msdb;
CREATE USER sa_monitor FOR LOGIN sa_monitor;
GRANT SELECT ON dbo.sysjobhistory TO sa_monitor;
GRANT SELECT ON dbo.backupset TO sa_monitor;
```

---

## 2. MongoDB `monitor_topics` Config

Đây là nơi bạn cấu hình **tất cả** queries, thresholds và schedules. **Không sửa code Python để thêm monitoring.**

### Schema đầy đủ

```json
{
  "topic_id": "string",           // [BẮT BUỘC] ID duy nhất
  "display_name": "string",       // Tên hiển thị (tuỳ chọn)
  "enabled": true,                // [BẮT BUỘC] true/false
  "schedule_sec": 300,            // [BẮT BUỘC] Chạy mỗi N giây

  "nodes": ["primary"],           // [BẮT BUỘC] Danh sách node targets
                                  // Giá trị hợp lệ:
                                  //   "primary"   → node đang là Primary
                                  //   "secondary" → tất cả Secondary
                                  //   "all"       → tất cả nodes
                                  //   "SQL-NODE-01" → hostname cụ thể

  "queries": [                    // [BẮT BUỘC] Ít nhất 1 query
    {
      "query_id": "string",       // ID duy nhất trong topic
      "description": "string",    // Mô tả (tuỳ chọn)
      "sql": "SELECT TOP ...",    // [BẮT BUỘC] SQL phải có TOP N hoặc WHERE time
      "timeout_sec": 30           // Override timeout (tuỳ chọn, default từ env)
    }
  ],

  // detector_type: null = chỉ lưu raw data, không phân tích
  "detector_type": null,

  // Dùng khi detector_type = "threshold"
  "thresholds": {
    "column_name": {
      "warning": 70,
      "critical": 85
    }
  },

  // Dùng khi detector_type = "baseline"
  "baseline_config": {
    "metric_field": "avg_duration_ms",
    "threshold_pct": 50.0,
    "min_executions": 10,
    "baseline_weeks": 4
  },

  // Config cho /analyze command trong Telegram bot (tuỳ chọn)
  // Không có → bot báo "topic chưa có analysis_config" thay vì crash
  "analysis_config": {
    "context": "Mô tả topic cho Claude — ngữ cảnh phân tích (1-2 câu)",
    "include_fields": ["sql_text", "xml_query_plan"],  // Field lớn trong finding.metrics cần đính kèm đầy đủ
    "focus_metrics": ["elapsed_seconds", "cpu_time_seconds", "logical_reads"]  // Metric cần highlight
  },

  "extra": {}                     // Config bổ sung (tuỳ detector)
}
```

---

## Ví dụ: Các topics thường dùng

### AG Health Monitor (threshold)

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
      "sql": "SELECT TOP 100 ar.replica_server_name, drs.synchronization_state_desc, drs.log_send_queue_size, drs.redo_queue_size FROM sys.dm_hadr_database_replica_states drs JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id",
      "timeout_sec": 30
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "log_send_queue_size": { "warning": 500, "critical": 1000 },
    "redo_queue_size": { "warning": 1000, "critical": 5000 }
  }
}
```

### Blocking Monitor (blocking_chain)

```json
{
  "topic_id": "blocking",
  "display_name": "Blocking & Deadlock",
  "enabled": true,
  "schedule_sec": 60,
  "nodes": ["all"],
  "queries": [
    {
      "query_id": "blocking_sessions",
      "sql": "SELECT TOP 100 r.session_id, r.blocking_session_id, r.wait_type, r.wait_time / 1000 AS wait_sec, r.command, t.text AS query_text FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE r.blocking_session_id > 0 AND r.wait_time > 10000",
      "timeout_sec": 15
    }
  ],
  "detector_type": "blocking_chain",
  "thresholds": {
    "wait_sec": { "warning": 30, "critical": 120 },
    "chain_depth": { "warning": 2, "critical": 3 }
  }
}
```

### Slow Query Monitor (baseline)

```json
{
  "topic_id": "slow_sessions",
  "display_name": "Slow Query / Performance Regression",
  "enabled": true,
  "schedule_sec": 300,
  "nodes": ["all"],
  "queries": [
    {
      "query_id": "query_stats",
      "sql": "SELECT TOP 50 qsq.query_hash, qsq.query_id, ROUND(qsp.avg_duration / 1000.0, 2) AS avg_duration_ms, qsp.count_executions, qsp.last_execution_time, SUBSTRING(qsqt.query_sql_text, 1, 500) AS query_text FROM sys.query_store_query qsq JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id WHERE qsp.last_execution_time > DATEADD(MINUTE, -30, GETUTCDATE()) AND qsp.count_executions >= 5 ORDER BY avg_duration_ms DESC",
      "timeout_sec": 30
    }
  ],
  "detector_type": "baseline",
  "baseline_config": {
    "metric_field": "avg_duration_ms",
    "threshold_pct": 50.0,
    "min_executions": 10,
    "baseline_weeks": 4
  }
}
```

### TempDB & Memory Monitor (threshold)

```json
{
  "topic_id": "tempdb_memory",
  "display_name": "TempDB & Memory Pressure",
  "enabled": true,
  "schedule_sec": 300,
  "nodes": ["primary"],
  "queries": [
    {
      "query_id": "ple_counter",
      "sql": "SELECT TOP 10 cntr_value AS ple_sec FROM sys.dm_os_performance_counters WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%'",
      "timeout_sec": 10
    },
    {
      "query_id": "tempdb_usage",
      "sql": "SELECT TOP 1 ROUND(100.0 * SUM(unallocated_extent_page_count) / SUM(total_page_count), 2) AS free_pct, ROUND(SUM(version_store_reserved_page_count) * 8.0 / 1024, 2) AS version_store_mb FROM sys.dm_db_file_space_usage",
      "timeout_sec": 15
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "ple_sec": { "warning": 300, "critical": 100 },
    "version_store_mb": { "warning": 500, "critical": 1000 }
  }
}
```

> **Lưu ý**: `ple_sec` threshold ngược chiều — giá trị **thấp hơn** mới xấu. Detector sẽ cần hỗ trợ mode `lower_is_worse` (cấu hình qua `extra` field khi implement).

### Slow Sessions Monitor với AI Analysis

Thêm `analysis_config` để cho phép DBA gõ `/analyze <id>` trong Telegram:

```json
{
  "topic_id": "slow_sessions",
  "display_name": "Slow Sessions",
  "enabled": true,
  "schedule_sec": 120,
  "nodes": ["all"],
  "queries": [
    {
      "query_id": "active_sessions",
      "sql": "SELECT TOP 50 r.session_id, r.elapsed_time / 1000000.0 AS elapsed_seconds, r.cpu_time / 1000000.0 AS cpu_time_seconds, r.logical_reads, r.command, SUBSTRING(t.text, 1, 2000) AS sql_text, p.query_plan AS xml_query_plan FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) p WHERE r.session_id <> @@SPID AND r.elapsed_time > 10000000 ORDER BY elapsed_seconds DESC",
      "timeout_sec": 20
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "elapsed_seconds": { "warning": 30, "critical": 120 }
  },
  "analysis_config": {
    "context": "Slow SELECT query đang chạy trên SQL Server AG cluster. Tập trung vào execution plan và resource usage.",
    "include_fields": ["sql_text", "xml_query_plan"],
    "focus_metrics": ["elapsed_seconds", "cpu_time_seconds", "logical_reads"]
  }
}
```

> **Lưu ý về `include_fields`**: Các field này phải tồn tại trong `finding.metrics` (được ghi bởi detector). Mỗi field bị giới hạn 8KB khi gửi lên Claude để tránh vượt context limit.

---

### Raw collector (không phân tích)

Topic với `detector_type: null` chỉ thu thập raw data để tính baseline:

```json
{
  "topic_id": "wait_stats_collector",
  "enabled": true,
  "schedule_sec": 300,
  "nodes": ["all"],
  "queries": [
    {
      "query_id": "wait_snapshot",
      "sql": "SELECT TOP 20 wait_type, waiting_tasks_count, wait_time_ms, signal_wait_time_ms FROM sys.dm_os_wait_stats WHERE wait_type NOT IN ('SLEEP_TASK','BROKER_TO_FLUSH','BROKER_EVENTHANDLER','CHECKPOINT_QUEUE') ORDER BY wait_time_ms DESC",
      "timeout_sec": 10
    }
  ],
  "detector_type": null
}
```

---

## Thêm topic mới: Hướng dẫn từng bước

### Bước 1: Viết và test SQL query trực tiếp trên SQL Server

```sql
-- Test trực tiếp trên SSMS trước
SELECT TOP 100
    r.session_id,
    r.wait_type,
    r.wait_time / 1000 AS wait_sec
FROM sys.dm_exec_requests r
WHERE r.wait_time > 5000
```

**Quy tắc bắt buộc**: Query phải có `TOP N` hoặc `WHERE` lọc theo thời gian. `sys.dm_exec_query_stats` có thể có 100k+ rows — không có TOP sẽ gây timeout.

### Bước 2: Xác định detector type

| Tình huống | Detector type |
|-----------|--------------|
| So sánh với ngưỡng cố định (ví dụ: TempDB > 85%) | `threshold` |
| So sánh với lịch sử theo ngày (ví dụ: query chậm hơn tuần trước) | `baseline` |
| Phân tích XML execution plan | `plan_analysis` |
| Phân tích blocking chain | `blocking_chain` |
| Chỉ lưu data, không cần alert | `null` |

### Bước 3: Insert vào MongoDB

```javascript
// MongoDB shell hoặc Compass
db.monitor_topics.insertOne({
  topic_id: "my_new_check",
  display_name: "My Custom Check",
  enabled: true,
  schedule_sec: 300,
  nodes: ["primary"],
  queries: [
    {
      query_id: "my_query",
      sql: "SELECT TOP 50 ...",
      timeout_sec: 30
    }
  ],
  detector_type: "threshold",
  thresholds: {
    my_metric: { warning: 70, critical: 90 }
  }
});
```

### Bước 4: Xác nhận service pick up

Service reload config **mỗi lần job chạy**. Không cần restart. Kiểm tra log:

```
2026-04-19T10:10:00 INFO  layer1.executor.topic_runner — Query OK: topic=my_new_check query=my_query node=SQL-NODE-01 rows=5 duration_ms=34.2
```

### Bước 5: Thêm topic mới có interval mới → cần restart

Nếu đây là topic **hoàn toàn mới** (chưa có trong MongoDB khi service start), scheduler chưa có job cho nó. Cần restart một lần:

```bash
# Graceful restart
kill -SIGTERM <pid>
python -m layer1.scheduler
```

Sau khi restart, service đọc lại tất cả topics và đăng ký job mới.

---

## Sửa threshold của topic đang chạy

**Không cần restart**:

```javascript
// MongoDB shell
db.monitor_topics.updateOne(
  { topic_id: "ag_health" },
  { $set: {
    "thresholds.log_send_queue_size.warning": 300,   // Giảm ngưỡng warning từ 500 xuống 300
    "thresholds.log_send_queue_size.critical": 800
  }}
)
// Có hiệu lực ngay lần chạy tiếp theo (tối đa 2 phút với topic ag_health)
```

---

## Disable một topic tạm thời

```javascript
db.monitor_topics.updateOne(
  { topic_id: "index_fragmentation" },
  { $set: { enabled: false } }
)
// Topic bị skip ở lần chạy tiếp theo, không cần restart
```

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
