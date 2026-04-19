# Kiến trúc hệ thống

## Sơ đồ tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MSSQL AG Cluster                              │
│                                                                      │
│   SQL-NODE-01 (Primary)    SQL-NODE-02 (Secondary)                   │
│   ┌─────────────────┐      ┌─────────────────┐                      │
│   │ Query Store     │      │ Readable        │                      │
│   │ CDC enabled     │◄────►│ Secondary       │                      │
│   │ Resource Gov.   │      │                 │                      │
│   │ Partition DB    │      └─────────────────┘                      │
│   └─────────────────┘                                               │
│                            SQL-NODE-03 (Secondary)                   │
│                            ┌─────────────────┐                      │
│                            │ Readable        │                      │
│                            │ Secondary       │                      │
│                            └─────────────────┘                      │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ pyodbc queries (DMV, Query Store, sys.*)
                   │ Mỗi 1-5 phút, chạy song song trên nhiều nodes
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: Python Monitoring Service                 │
│                    (chạy trên 1 máy chủ riêng, 24/7)                 │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  APScheduler — quản lý tất cả jobs                           │   │
│  │                                                              │   │
│  │  Job: ag_health (2 phút)    Job: blocking (1 phút)           │   │
│  │  Job: slow_query (5 phút)   Job: tempdb (5 phút)             │   │
│  │  Job: wait_stats (5 phút)   Job: index_frag (hàng ngày)      │   │
│  │  ... (15+ topics)                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                           │
│                          ▼                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  TopicRunner — trung tâm data flow                           │   │
│  │                                                              │   │
│  │  1. Đọc config từ MongoDB (reload mỗi lần chạy)             │   │
│  │  2. Xác định node cần query (Primary/Secondary/All)          │   │
│  │  3. Chạy SQL queries song song trên từng node                │   │
│  │  4. Lưu raw_metrics vào MongoDB                              │   │
│  │  5. Chạy detector phân tích                                  │   │
│  │  6. Lưu findings, check dedup, gửi alert                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                           │
│           ┌──────────────┼──────────────┐                           │
│           ▼              ▼              ▼                           │
│  ┌──────────────┐ ┌──────────┐ ┌─────────────────┐                 │
│  │  MongoDB     │ │ Detectors│ │  Notifications  │                 │
│  │  (local)     │ │          │ │                 │                 │
│  │  raw_metrics │ │threshold │ │  Teams webhook  │                 │
│  │  findings    │ │baseline  │ │  Slack          │                 │
│  │  baselines   │ │plan XML  │ │  Telegram       │                 │
│  │  dedup_cache │ │blocking  │ │                 │                 │
│  └──────────────┘ └──────────┘ └─────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                          │ Khi phát hiện issue nghiêm trọng
                          │ (chưa implement)
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 2: AI Agent                                  │
│                                                                      │
│  Claude API ──► Phân tích root cause ──► Đề xuất action             │
│                                                                      │
│  SELECT queries     Non-SELECT (DDL/DML)                             │
│  ┌──────────┐       ┌──────────────────────┐                       │
│  │ Auto     │       │ Gửi approval request  │                       │
│  │ execute  │       │ đến admin             │                       │
│  └──────────┘       │ Admin APPROVE/REJECT  │                       │
│                     └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Config-driven: Tại sao quan trọng?

Hầu hết các hệ thống monitoring viết query và threshold trực tiếp trong code:

```python
# Cách thông thường — BAD
if ple_value < 300:
    alert("PLE thấp!")

slow_query_sql = "SELECT TOP 100 query_hash, avg_duration FROM sys.query_store..."
```

Vấn đề: Mỗi lần muốn thay đổi phải **sửa code → commit → deploy → restart**.

Hệ thống này lưu mọi thứ trong MongoDB:

```json
// MongoDB collection: monitor_topics
{
  "topic_id": "tempdb_pressure",
  "schedule_sec": 300,
  "nodes": ["primary"],
  "queries": [
    {
      "query_id": "tempdb_usage",
      "sql": "SELECT usage_pct FROM sys.dm_db_file_space_usage..."
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "usage_pct": { "warning": 70, "critical": 85 }
  }
}
```

**Kết quả**: Thêm query mới, đổi ngưỡng → chỉ cần update MongoDB → có hiệu lực ngay lần chạy tiếp theo.

---

## Node Role Cache: Tại sao cần thiết?

Trong AG cluster, **Primary có thể thay đổi bất kỳ lúc nào** (failover). Nếu hardcode:

```python
# KHÔNG BAO GIỜ làm thế này!
PRIMARY_HOST = "SQL-NODE-01"  # Sẽ sai sau failover
```

Hệ thống dùng `NodeRoleCache`:

```
Startup:
  → Query DMV trên node đầu tiên reachable:
    SELECT replica_server_name, role_desc
    FROM sys.dm_hadr_availability_replica_states
  → Cache: { "SQL-NODE-01": "primary", "SQL-NODE-02": "secondary", ... }

Mỗi giờ:
  → Refresh cache
  → Nếu Primary thay đổi → log WARNING "AG FAILOVER DETECTED"

Khi topic chạy:
  → nodes: ["primary"] → resolve → ["SQL-NODE-01"] (hostname thực tế)
  → nodes: ["all"]     → resolve → ["SQL-NODE-01", "SQL-NODE-02", "SQL-NODE-03"]
```

---

## Detector Types: 4 cách phân tích

Mỗi topic config chỉ định `detector_type` để xác định cách phân tích kết quả:

### 1. Threshold Detector
So sánh giá trị với ngưỡng warning/critical cố định.

```
Ví dụ: TempDB usage
  row["usage_pct"] = 87%
  threshold.critical = 85%
  → 87 > 85 → Tạo CRITICAL finding
```

**Dùng cho**: PLE, TempDB%, AG lag, backup gap, Resource Governor.

### 2. Baseline Detector
So sánh với lịch sử **cùng ngày trong tuần + cùng giờ**.

```
Ví dụ: Slow query check chạy lúc Thứ Tư 10:05
  → Baseline = avg của các Thứ Tư 10:00-11:00 trong 4 tuần qua
  → avg_duration hiện tại tăng > 50% so với baseline → WARNING
```

**Tại sao không dùng rolling 7-day average?**
Workload Thứ Hai (peak) rất khác Chủ Nhật (thấp). Nếu dùng rolling average, Thứ Hai sẽ luôn bị coi là "bất thường" mặc dù đó là pattern bình thường.

**Dùng cho**: Slow query, wait stats anomaly, blocked query trend.

### 3. Plan Detector
Parse XML execution plan từ SQL Server, tìm các pattern xấu.

```
Pattern phát hiện được:
  - "Index Scan" trên bảng lớn (thay vì Index Seek) → scan toàn bảng
  - "Key Lookup" → cần covering index
  - "Hash Match" → join không dùng index
  - "Implicit conversion" → type mismatch, index bị bỏ qua
  - Partition elimination failure → scan toàn bộ partitions
```

**Dùng cho**: Plan regression, non-optimal index, partition failure.

### 4. Blocking Chain Detector
Xây dựng đồ thị blocking chain từ session data.

```
Session 55 bị block bởi Session 42
Session 67 bị block bởi Session 42
Session 89 bị block bởi Session 55
→ Chain depth = 3, head blocker = Session 42
→ 3 > threshold.chain_depth (2) → CRITICAL finding
```

**Dùng cho**: Blocking chain, deadlock.

---

## Deduplication: Tránh spam alert

Nếu TempDB đầy và giữ đầy trong 1 giờ, hệ thống sẽ phát hiện 12 lần (mỗi 5 phút). Không nên gửi 12 thông báo.

**Dedup logic**:
```
Mỗi finding có finding_hash = MD5(topic_id + ":" + issue_type + ":" + node + ":" + query_hash)

topic_id được include để tránh collision khi 2 topic khác nhau cùng node
sinh ra cùng issue_type (ví dụ: ag_health và slow_sessions cùng dùng WAIT_ANOMALY).

Khi muốn gửi alert:
  → Check dedup_cache: hash này đã alert trong 30 phút qua chưa?
  → Nếu đã alert → suppress (log INFO "Dedup suppressed")
  → Nếu chưa alert → gửi + ghi vào dedup_cache
```

`dedup_cache` có TTL 7 ngày → tự động dọn sạch.

---

## Telegram Bot: Operational Interface

Ngoài alert tự động, service cung cấp Telegram bot để DBA tương tác on-demand:

```
Alert finding → Telegram message (kèm Finding ID 8 ký tự)

DBA reply /analyze  ─────────────────────────────────────────┐
  hoặc /analyze <id>                                          │
                                                              ▼
                                          TelegramBot (daemon thread)
                                              │
                                              ├── FindingsRepo.find_by_id_prefix()
                                              ├── TopicRepo.find_by_id() → analysis_config
                                              └── PlanAnalyzer.analyze()
                                                    │
                                                    ▼
                                              Claude API (claude-sonnet-4-6)
                                              Build prompt từ:
                                                - analysis_config.context
                                                - analysis_config.focus_metrics
                                                - analysis_config.include_fields
                                                  (sql_text, xml_query_plan...)
                                                    │
                                                    ▼
                                              Phân tích → reply Telegram
```

**Config-driven analysis:** Mỗi topic tự định nghĩa cách phân tích trong `analysis_config` — Python không hardcode logic phân tích nào.
