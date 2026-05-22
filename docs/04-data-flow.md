# Data Flow — Luồng dữ liệu

Tài liệu này giải thích chi tiết điều gì xảy ra từ lúc APScheduler trigger một job cho đến khi thông báo được gửi đi.

---

## Luồng tổng quan

```
APScheduler (mỗi N giây)
      │
      │ trigger job "ag_health"
      ▼
TopicRunner.run("ag_health")
      │
      ├─[1]─ Đọc config từ MongoDB
      │
      ├─[2]─ Resolve nodes: ["primary"] → [("SQL-NODE-01", "primary")]
      │
      ├─[3]─ Thực thi queries song song trên các nodes
      │       Thread 1: chạy trên SQL-NODE-01
      │       Thread 2: chạy trên SQL-NODE-02 (nếu nodes=["all"])
      │
      ├─[4]─ Lưu raw_metrics vào MongoDB
      │
      ├─[5]─ Chạy detector phân tích
      │
      ├─[6]─ Lưu findings vào MongoDB
      │
      ├─[7]─ Check dedup (đã alert gần đây chưa?)
      │
      └─[8]─ Gửi thông báo nếu cần
```

---

## Bước 1: Đọc config từ MongoDB

**Mỗi lần job chạy đều đọc lại config** — không cache config từ lần trước.

```python
# topic_runner.py
topic = topic_repo.find_by_id("ag_health")
# → MonitorTopic(
#     topic_id="ag_health",
#     schedule_sec=120,
#     nodes=["primary"],
#     queries=[QueryConfig(sql="SELECT ...", timeout_sec=30)],
#     detector_type="threshold",
#     thresholds={"log_send_queue_size": {warning: 500, critical: 1000}}
#   )
```

**Ý nghĩa**: Bạn có thể sửa SQL query hoặc thay đổi threshold trong MongoDB và nó có hiệu lực ngay lần chạy tiếp theo mà **không cần restart service**.

---

## Bước 2: Resolve nodes

Topic config chứa `nodes: ["primary"]` — đây là alias, không phải hostname cụ thể.

```python
resolved = role_cache.resolve(["primary"])
# → [("SQL-NODE-01", "primary")]

resolved = role_cache.resolve(["all"])
# → [("SQL-NODE-01", "primary"), ("SQL-NODE-02", "secondary"), ("SQL-NODE-03", "secondary")]

resolved = role_cache.resolve(["secondary"])
# → [("SQL-NODE-02", "secondary"), ("SQL-NODE-03", "secondary")]
```

NodeRoleCache được refresh mỗi giờ từ AG DMV. Nếu Primary failover từ NODE-01 sang NODE-02, lần refresh tiếp theo sẽ cập nhật cache và log WARNING.

---

## Bước 3: Thực thi queries song song

```python
# topic_runner.py — _execute_on_nodes()
with ThreadPoolExecutor(max_workers=3) as pool:
    futures = {
        pool.submit(executor.execute_batch, queries, "SQL-NODE-01", "primary"): ...,
        pool.submit(executor.execute_batch, queries, "SQL-NODE-02", "secondary"): ...,
        pool.submit(executor.execute_batch, queries, "SQL-NODE-03", "secondary"): ...,
    }
```

**Tại sao song song?** 3 nodes × tuần tự = 3× latency. Song song = latency của node chậm nhất.

**Thread safety**: Mỗi thread tạo **kết nối MSSQL riêng**. pyodbc connection KHÔNG thread-safe nên không bao giờ dùng chung.

**Lỗi 1 node không ảnh hưởng node khác**: Nếu SQL-NODE-02 unreachable, chỉ có kết quả của node đó là `success=False`. Node khác vẫn tiếp tục bình thường.

### Bên trong `execute_batch()`

```
Mở 1 kết nối pyodbc đến host
  │
  ├─ Chạy query 1: "SELECT TOP 100 ..."
  │   → columns = ["col1", "col2", ...]
  │   → rows = [{"col1": val, "col2": val}, ...]
  │   → QueryResult(success=True, rows=rows, duration_ms=45.2)
  │
  ├─ Chạy query 2: "SELECT TOP 50 ..."
  │   → QueryResult(success=True, ...)
  │
  └─ Đóng kết nối
```

**Kết quả**: List `QueryResult` — mỗi kết quả là 1 query trên 1 node.

---

## Bước 4: Lưu raw_metrics

Tất cả kết quả (kể cả failed) được lưu vào MongoDB `raw_metrics`:

```json
// Collection: raw_metrics
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
      "log_send_queue_size": 0
    }
  ],
  "row_count": 2,
  "duration_ms": 45.2
}
```

**Mục đích**: Dữ liệu thô này dùng để:
1. Tính baseline (trung bình lịch sử)
2. Layer 2 AI phân tích nguyên nhân sâu hơn
3. Debug khi cần kiểm tra dữ liệu thu thập được

---

## Bước 5: Chạy detector

Chỉ chạy nếu `topic.detector_type` != None.

### Ví dụ: Threshold Detector

```python
# topic.thresholds = {"log_send_queue_size": {warning: 500, critical: 1000}}

for result in results:
    for row in result.rows:
        value = row["log_send_queue_size"]  # ví dụ: 750
        threshold = topic.thresholds["log_send_queue_size"]
        
        if value >= threshold.critical:    # 750 < 1000 → False
            severity = CRITICAL
        elif value >= threshold.warning:   # 750 >= 500 → True
            severity = WARNING
        
        # Tạo Finding
        Finding(
            issue_type=IssueType.AG_LAG,
            severity=Severity.WARNING,
            node="SQL-NODE-01",
            metrics={"log_send_queue_size": 750}
        )
```

### Ví dụ: Baseline Detector

```python
# topic.baseline_config.metric_field = "avg_duration_ms"
# topic.baseline_config.threshold_pct = 50  (50% tăng so với baseline)

# Thời điểm hiện tại: Thứ Tư 10:05
day_of_week = 2  # Wednesday
hour = 10

# Lấy baseline từ MongoDB
baseline = baseline_repo.get_baseline("slow_sessions", "SQL-NODE-01", day_of_week=2, hour=10)
# → {"baseline_avg": 120.0, "baseline_stddev": 8.5}

current_value = 450  # avg_duration_ms hiện tại

# 450 > 120 * 1.5 (= 180) → True → Anomaly!
if baseline_repo.is_anomaly("slow_sessions", "SQL-NODE-01", 450, day_of_week=2, hour=10, threshold_pct=50):
    # Tạo Finding(issue_type=slow_sessions, severity=WARNING, ...)
```

---

## Bước 6: Lưu findings

```json
// Collection: findings
{
  "finding_id": "uuid-1234-...",
  "detected_at": "2026-04-19T10:05:23Z",
  "topic_id": "ag_health",
  "issue_type": "ag_lag",
  "severity": "WARNING",
  "node": "SQL-NODE-01",
  "role": "primary",
  "metrics": {
    "log_send_queue_size": 750,
    "threshold_warning": 500
  },
  "status": "new"
}
```

Finding có `status` lifecycle:
```
new → analyzing → analyzed → resolved
                           → suppressed
```

Layer 2 AI Agent sẽ đổi status khi xử lý.

---

## Bước 7: Check dedup

**Vấn đề**: AG lag có thể kéo dài 30 phút. Topic chạy mỗi 2 phút = 15 lần phát hiện = 15 alert. Người dùng sẽ bị spam.

**Giải pháp**: `DedupRepo` dùng `findOneAndUpdate` atomic:

```python
finding_hash = MD5("ag_lag:SQL-NODE-01:")  # issue_type:node:query_hash

# Atomic check: đã alert trong 30 phút qua chưa?
if dedup_repo.should_alert(finding_hash, suppress_minutes=30):
    # → Chưa alert → gửi thông báo + ghi vào dedup_cache
    dispatcher.dispatch(finding)
else:
    # → Đã alert gần đây → skip
    pass
```

`dedup_cache` document:
```json
{
  "finding_hash": "a1b2c3d4...",
  "last_alerted_at": "2026-04-19T10:05:23Z"
}
// TTL 7 ngày → tự xóa
```

---

## Bước 8: Gửi thông báo

`NotificationDispatcher` gửi đến tất cả channels đã config nếu severity >= min_severity:

```
Finding severity = WARNING
dispatcher.min_severity = WARNING

→ WARNING >= WARNING → True → gửi

Finding severity = INFO
→ INFO < WARNING → False → không gửi
```

**Teams notification**: Adaptive Card với màu theo severity:

```
┌──────────────────────────────────────────────┐
│ ⚠️ WARNING — AG Health                       │
│                                              │
│ Node:       SQL-NODE-01 (primary)            │
│ Issue:      ag_lag                           │
│ Detected:   2026-04-19 10:05:23 UTC          │
│                                              │
│ log_send_queue_size: 750 MB                  │
│ (threshold: 500 MB warning, 1000 MB critical)│
└──────────────────────────────────────────────┘
```

---

## Luồng đặc biệt: Baseline được cập nhật như thế nào?

Baseline không phải là hằng số — nó được cập nhật mỗi lần job chạy thành công:

```
Thứ Tư 10:05 chạy slow_sessions check
  → avg_duration = 125ms (bình thường)
  → Không phải anomaly

Sau khi detect xong:
  → baseline_repo.upsert_baseline(
        metric_type="slow_sessions",
        node="SQL-NODE-01",
        day_of_week=2, hour=10,
        new_sample={"date": "2026-04-17", "avg_ms": 125}
    )

MongoDB baseline document:
  {
    "metric_type": "slow_sessions", "day_of_week": 2, "hour": 10,
    "node": "SQL-NODE-01",
    "samples": [
      {"date": "2026-03-26", "avg_ms": 118},
      {"date": "2026-04-02", "avg_ms": 122},
      {"date": "2026-04-09", "avg_ms": 120},
      {"date": "2026-04-17", "avg_ms": 125}  ← vừa thêm
    ],
    "baseline_avg": 121.25,   ← tính lại tự động
    "baseline_stddev": 2.5    ← tính lại tự động
  }
```

Giữ tối đa **4 samples** (4 tuần gần nhất). Sample cũ nhất bị đẩy ra khi thêm mới.

---

## Job tracking: JobRunner decorator

Mọi APScheduler job đều được wrap bởi `JobRunner.wrap()`:

```
Trước khi chạy:
  → Insert vào job_executions: {status: "running", started_at: now}
  → doc_id = "64f3a..."

Trong khi chạy:
  → topic_runner.run("ag_health") → trả về findings_created=2

Sau khi chạy:
  → Update job_executions:
    {status: "success", finished_at: now, duration_ms: 1240, findings_created: 2}
```

Nếu exception xảy ra trong khi chạy:
```
  → Update job_executions: {status: "failed", error_message: "..."}
  → Scheduler KHÔNG crash → các jobs khác tiếp tục bình thường
```

---

## Health Check: Phát hiện anomaly trong scheduler

Chạy mỗi 2 phút, kiểm tra `job_executions` collection:

```
Stuck job detection:
  → Tìm documents có {status: "running", started_at < 5 phút trước}
  → Nếu có → log WARNING "STUCK job 'slow_sessions_check' running since ..."

Missed job detection:
  → Với mỗi job trong intervals dict:
    Lần chạy cuối: 10:00:00
    Interval: 5 phút → expected next run: 10:05:00
    Threshold: 1.5× → expected by: 10:07:30
    Hiện tại: 10:09:00 → 10:09 > 10:07:30 → MISSED
  → log WARNING "MISSED schedule: 'slow_sessions_check'"
```

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
