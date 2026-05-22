# Database — MongoDB Collections

Tất cả dữ liệu được lưu trong **MongoDB Community** chạy trên `localhost:27017`, database `db_monitor`.

---

## Sơ đồ tổng thể

```
db_monitor (database)
│
├── monitor_topics        ← Config: queries, thresholds, schedules
├── node_roles            ← Cache: Primary/Secondary của từng node
│
├── raw_metrics           ← Raw data từ queries (TTL 30 ngày)
├── findings              ← Issues phát hiện được (TTL 90 ngày)
├── baselines             ← Lịch sử baseline (không TTL)
│
├── dedup_cache           ← Chống spam alert (TTL 7 ngày)
├── job_executions        ← History mỗi lần job chạy (TTL 30 ngày)
│
├── ai_analysis           ← Kết quả từ Claude API [Layer 2]
├── approval_queue        ← Actions chờ admin duyệt [Layer 2]
└── audit_log             ← Log mọi action đã thực thi [Layer 2]
```

---

## monitor_topics

**Mục đích**: Source of truth cho toàn bộ monitoring config. Thêm/sửa topic ở đây → service tự pick up.

**TTL**: Không có (giữ mãi)

**Indexes**: `unique(topic_id)`, `(enabled)`

### Schema
```json
{
  "topic_id": "ag_health",           // String, unique
  "display_name": "AG Health & CDC",
  "enabled": true,                    // false → job bị skip
  "schedule_sec": 120,               // Chạy mỗi 120 giây (2 phút)
  "nodes": ["primary"],              // "primary" | "secondary" | "all" | hostname
  
  "queries": [
    {
      "query_id": "ag_sync_state",
      "description": "AG replica sync state",
      "sql": "SELECT TOP 100 ar.replica_server_name, drs.synchronization_state_desc, drs.log_send_queue_size FROM sys.dm_hadr_database_replica_states drs JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id",
      "timeout_sec": 30
    }
  ],
  
  "detector_type": "threshold",      // null | threshold | baseline | plan_analysis | blocking_chain
  
  "thresholds": {
    "log_send_queue_size": {
      "warning": 500,
      "critical": 1000
    }
  },
  
  "baseline_config": null,           // Dùng khi detector_type = "baseline"
  
  "extra": {}                        // Config bổ sung cho detector cụ thể
}
```

### Ví dụ topic dùng baseline detector
```json
{
  "topic_id": "slow_sessions",
  "schedule_sec": 300,
  "nodes": ["all"],
  "queries": [{ "query_id": "query_stats", "sql": "SELECT ..." }],
  "detector_type": "baseline",
  "baseline_config": {
    "metric_field": "avg_duration_ms",
    "threshold_pct": 50.0,
    "min_executions": 10,
    "baseline_weeks": 4
  }
}
```

---

## node_roles

**Mục đích**: Persist cache của AG node roles để survive service restart.

**TTL**: Không có

**Indexes**: `unique(host)`

### Schema
```json
{
  "host": "SQL-NODE-01",
  "role": "primary",           // "primary" | "secondary"
  "detected_at": "2026-04-19T10:00:00Z"
}
```

---

## raw_metrics

**Mục đích**: Lưu toàn bộ data thu thập được từ SQL Server — dùng để tính baseline và Layer 2 phân tích.

**TTL**: 30 ngày (tự xóa)

**Indexes**:
- `(topic_id, query_id, collected_at DESC)`
- `(node, collected_at DESC)`
- TTL index trên `collected_at`

### Schema
```json
{
  "topic_id": "ag_health",
  "query_id": "ag_sync_state",
  "node": "SQL-NODE-01",
  "role": "primary",
  "collected_at": "2026-04-19T10:05:00Z",
  "rows": [
    {
      "replica_server_name": "SQL-NODE-02",
      "synchronization_state_desc": "SYNCHRONIZED",
      "log_send_queue_size": 750
    },
    {
      "replica_server_name": "SQL-NODE-03",
      "synchronization_state_desc": "SYNCHRONIZED",
      "log_send_queue_size": 320
    }
  ],
  "row_count": 2,
  "duration_ms": 45.2
}
```

**Lưu ý**: Trường `rows` chứa raw data trực tiếp từ SQL Server. Schema của rows phụ thuộc vào query trong `monitor_topics` — không có schema cố định.

---

## findings

**Mục đích**: Lưu các issues đã được detector xác nhận. Là input cho Layer 2 AI Agent.

**TTL**: 90 ngày

**Indexes**:
- `(issue_type, detected_at DESC)`
- `(topic_id, detected_at DESC)`
- `(status, severity)`
- `(query_hash, detected_at DESC)` — sparse (bỏ qua nếu query_hash null)
- TTL index trên `detected_at`

### Schema
```json
{
  "finding_id": "550e8400-e29b-41d4-a716-446655440000",  // UUID
  "detected_at": "2026-04-19T10:05:23Z",
  
  "topic_id": "ag_health",
  "issue_type": "ag_lag",           // Xem IssueType enum
  "severity": "WARNING",            // INFO | WARNING | CRITICAL
  "node": "SQL-NODE-01",
  "role": "primary",
  
  "query_hash": null,               // Có giá trị nếu liên quan đến query cụ thể
  "query_text": null,               // SQL text của query gây vấn đề
  
  "metrics": {
    "log_send_queue_size": 750,
    "threshold_warning": 500,
    "threshold_critical": 1000
  },
  
  "plan_patterns": [],              // List patterns từ XML plan parser
  "plan_xml_ref": null,             // Path đến file XML plan (lưu riêng vì lớn)
  
  "status": "new",                  // new | analyzing | analyzed | resolved | suppressed
  "ai_analysis_id": null            // Reference đến ai_analysis khi Layer 2 xử lý xong
}
```

### Các giá trị `issue_type`
| Value | Ý nghĩa |
|-------|---------|
| `slow_sessions` | Query chậm hơn baseline |
| `plan_regression` | Execution plan thay đổi xấu |
| `plan_instability` | Query có nhiều plan khác nhau |
| `non_optimal_index` | Dùng Index Scan thay vì Seek |
| `partition_elimination_failure` | Không prune được partitions |
| `high_variation_query` | Execution time không ổn định |
| `blocking_chain` | Chuỗi blocking sessions |
| `deadlock` | Deadlock xảy ra |
| `blocked_query_snapshot` | Snapshot query đang bị block |
| `blocked_query_trend` | Pattern block lặp lại |
| `tempdb_pressure` | TempDB gần đầy |
| `memory_pressure` | PLE thấp hoặc memory grants pending |
| `wait_anomaly` | Wait type tăng bất thường |
| `ag_lag` | Secondary tụt hậu so với Primary |
| `cdc_failure` | CDC job thất bại |
| `index_fragmentation` | Index bị phân mảnh |
| `missing_index` | SQL Server gợi ý index chưa có |
| `resource_pool_spike` | Resource pool gần giới hạn CPU |
| `job_failure` | SQL Agent job thất bại |
| `backup_gap` | Backup quá lâu chưa chạy |

---

## baselines

**Mục đích**: Lưu trung bình lịch sử theo ngày trong tuần + giờ. Dùng để phát hiện anomaly.

**TTL**: Không có (giữ mãi — đây là knowledge base)

**Indexes**: `unique(metric_type, day_of_week, hour, node, query_hash)` — sparse

### Schema
```json
{
  "metric_type": "slow_sessions",
  "day_of_week": 2,           // 0=Thứ Hai, 1=Thứ Ba, ..., 6=Chủ Nhật
  "hour": 10,                 // 0-23
  "node": "SQL-NODE-01",
  "query_hash": "0xABCD1234", // "" nếu là node-level baseline (không gắn với query)
  
  "samples": [
    { "date": "2026-03-26", "avg_ms": 118 },
    { "date": "2026-04-02", "avg_ms": 122 },
    { "date": "2026-04-09", "avg_ms": 120 },
    { "date": "2026-04-17", "avg_ms": 125 }
  ],
  
  "baseline_avg": 121.25,     // avg của samples — tính lại tự động
  "baseline_stddev": 2.5,     // độ lệch chuẩn — tính lại tự động
  "updated_at": "2026-04-17T10:05:00Z"
}
```

**Tại sao `day_of_week`?** Workload Thứ Hai (đầu tuần, nhiều batch jobs) khác hẳn Chủ Nhật. Dùng rolling 7-day average sẽ gây false positives vào ngày cao điểm.

**Tại sao giữ 4 samples?** 4 tuần = đủ để smooth out outliers, vừa đủ để phản ánh trend gần đây (nếu query được optimize → baseline tự cập nhật theo).

---

## dedup_cache

**Mục đích**: Tránh gửi alert trùng lặp cho cùng một vấn đề đang diễn ra liên tục.

**TTL**: 7 ngày (tự xóa)

**Indexes**: `unique(finding_hash)`, TTL trên `last_alerted_at`

### Schema
```json
{
  "finding_hash": "a1b2c3d4e5f6...",  // MD5 của "issue_type:node:query_hash"
  "last_alerted_at": "2026-04-19T10:05:23Z"
}
```

### Cách hoạt động
```
Finding hash "abc123" xuất hiện lần đầu:
  → dedup_cache không có document với hash này
  → INSERT {hash: "abc123", last_alerted_at: now}
  → should_alert = True → GỬI ALERT

Finding hash "abc123" xuất hiện lần 2 (sau 10 phút):
  → dedup_cache có document, last_alerted_at = 10 phút trước
  → suppress_minutes = 30 → 10 phút < 30 phút → CÒN TRONG SUPPRESS WINDOW
  → should_alert = False → KHÔNG GỬI

Finding hash "abc123" xuất hiện lần 3 (sau 35 phút tổng):
  → last_alerted_at = 35 phút trước
  → 35 phút > 30 phút → ĐÃ QUA SUPPRESS WINDOW
  → UPDATE last_alerted_at = now
  → should_alert = True → GỬI ALERT LẠI
```

---

## job_executions

**Mục đích**: Lịch sử mỗi lần job chạy — dùng để phát hiện stuck/missed jobs và hiển thị health dashboard.

**TTL**: 30 ngày

**Indexes**: `(job_name, started_at DESC)`, `(status, started_at)`, TTL trên `started_at`

### Schema
```json
{
  "job_name": "slow_sessions_check",
  "instance_id": "monitoring-server-01:12345",  // hostname:pid
  "started_at": "2026-04-19T10:05:00Z",
  "finished_at": "2026-04-19T10:05:01.24Z",
  "duration_ms": 1240.0,
  "status": "success",              // running | success | failed
  "records_processed": 6,
  "findings_created": 2,
  "error_message": null,
  "next_expected_at": null
}
```

### Health Dashboard (query từ MongoDB)

```
Job Name               | Last Run         | Duration | Status  | Health
-----------------------|------------------|----------|---------|--------
slow_sessions_check       | 10:05:00         | 1.2s     | success | OK
ag_health_check        | 10:04:00         | 0.3s     | success | OK
blocking_monitor       | 10:04:30         | 0.5s     | success | OK
wait_stats_check       | 09:55:00         | 2.1s     | success | MISSED ⚠️
index_frag_monitor     | 03:00:00         | 45s      | success | OK
agent_job_monitor      | 10:03:00         | —        | running | STUCK ⚠️
```

---

## ai_analysis (Layer 2 — chưa implement)

**Mục đích**: Lưu kết quả phân tích từ Claude API.

**TTL**: 90 ngày

```json
{
  "analysis_id": "uuid",
  "finding_id": "uuid",
  "analyzed_at": "ISODate",
  "root_cause": "Optimizer chọn Index Scan sau khi statistics stale...",
  "suggested_actions": [
    {
      "action_type": "DDL",
      "sql": "UPDATE STATISTICS tbl_orders WITH FULLSCAN",
      "risk_level": "MEDIUM",
      "reasoning": "Statistics cũ gây cardinality estimate sai..."
    }
  ],
  "confidence": 0.87
}
```

---

## approval_queue (Layer 2 — chưa implement)

**Mục đích**: Queue các actions cần admin duyệt trước khi thực thi.

```json
{
  "action_id": "uuid",
  "action_type": "DDL",
  "sql_script": "UPDATE STATISTICS tbl_orders WITH FULLSCAN, NORECOMPUTE",
  "ai_reasoning": "Statistics stale gây plan regression...",
  "risk_level": "MEDIUM",
  "target_node": "SQL-NODE-01",
  "expires_at": "2026-04-20T10:00:00Z",  // 24h, quá hạn tự reject
  "status": "PENDING"                     // PENDING | APPROVED | REJECTED | EXPIRED
}
```

---

## Tóm tắt TTL

| Collection | TTL | Lý do |
|-----------|-----|-------|
| `raw_metrics` | 30 ngày | Dữ liệu thô, dung lượng lớn |
| `findings` | 90 ngày | Cần giữ để track resolution |
| `ai_analysis` | 90 ngày | Đi kèm với findings |
| `dedup_cache` | 7 ngày | Chỉ cần cho suppress window ngắn hạn |
| `job_executions` | 30 ngày | Đủ để debug và trend analysis |
| `baselines` | Không TTL | Knowledge base quan trọng |
| `monitor_topics` | Không TTL | Config |
| `node_roles` | Không TTL | Cache roles |
| `approval_queue` | Không TTL | Audit trail |
| `audit_log` | Không TTL | Compliance |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
