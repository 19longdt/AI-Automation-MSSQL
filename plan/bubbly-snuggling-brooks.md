# Roadmap: Python Monitoring Service + AI Agent cho MSSQL Server DBA Operations

## Context

Vận hành cụm MSSQL Server 2019 Enterprise AG (1 Primary + 2 Secondary) với CDC, Resource Governor, Partition DB.
Đã có Java job xử lý session/kill query quá tải. Cần bổ sung:
- **Layer 1:** Python Monitoring Service — chạy thường xuyên, tự động phát hiện vấn đề
- **Layer 2:** AI Agents (Claude API) — nhận output từ Layer 1, phân tích sâu, đề xuất fix

---

## Kiến trúc 2 lớp

```
┌─────────────────────────────────────────────────────────────┐
│                     MSSQL AG Cluster                         │
│  [Primary]──sync──[Secondary 1]──sync──[Secondary 2]        │
└──────────────────────┬──────────────────────────────────────┘
                       │ DMV queries (pyodbc, cả 3 nodes)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         LAYER 1: Python Monitoring Service                   │
│  Chạy theo schedule (1-5 phút/lần)                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Query Store  │  │ AG / CDC     │  │ Index & Resource │  │
│  │ + DMV Checks │  │ Health Check │  │ Governor Monitor │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         └─────────────────┴──────────────────┘              │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │  MongoDB    │  raw_metrics / findings   │
│                    │  (local)    │  baselines / dedup_cache  │
│                    └──────┬──────┘                          │
└───────────────────────────┼─────────────────────────────────┘
                            │ Khi phát hiện issue
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         LAYER 2: AI Agent (Claude API)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Analyzer: nhận issue data → gọi Claude API → trả về    │ │
│  │  - Root cause analysis                                  │ │
│  │  - Suggested action (phân loại SELECT vs non-SELECT)   │ │
│  │  - Severity & priority                                  │ │
│  └──────────────────────────┬─────────────────────────────┘ │
│                             │                                │
│             ┌───────────────┴───────────────┐               │
│             │ Action type?                  │               │
│        SELECT only                    non-SELECT             │
│     (read-only queries)        (DDL/DML/EXEC/config)        │
│             │                          │                    │
│             ▼                          ▼                    │
│      Auto-execute              Pending Approval Queue       │
│      (Layer 1 DMV)             (MongoDB — chờ admin)        │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴────────────────────┐
              │                                     │
              ▼                                     ▼
  Notification (info/alert)          Approval Request Alert
  Teams/Slack/Telegram/Email         (gửi kèm nút APPROVE / REJECT)
                                               │
                               ┌───────────────┴──────────────┐
                               │ Admin response                │
                           APPROVE                         REJECT
                               │                              │
                               ▼                              ▼
                        Execute action               Log lý do từ chối
                        + ghi audit_log              + đóng ticket
```

---

## LAYER 1: Python Monitoring Service — Chi tiết

### 1.1 Query Problem Detector
**Tần suất:** Mỗi 5 phút — chạy trên **TẤT CẢ nodes** trong AG

**Node scope:**
- **Primary:** Tất cả checks (Query Store + DMV)
- **Secondary:** Tất cả checks nếu Readable Secondary được bật — Query Store trên Secondary là subset của read workload, chấp nhận được; DMV checks (`sys.dm_exec_requests`, `sys.dm_exec_query_stats`) luôn available bất kể readable hay không

> Mỗi finding document ghi rõ `node: "SQL-NODE-01"` để phân biệt issue từ Primary vs Secondary.

---

#### 1.1.1 Slow Query / Performance Regression
- **Tiêu chí:** avg_duration tăng đột biến so với baseline **cùng ngày trong tuần + cùng giờ** (day-of-week aware, 4 tuần gần nhất)
- **Ngưỡng:** tăng > `slow_sessions_THRESHOLD_PCT` (default 50%), chỉ xét queries có last_execution_time trong 30 phút gần nhất và count_executions ≥ `slow_sessions_MIN_EXECUTIONS`
- **Hướng xử lý:** AI phân tích plan XML, so sánh với baseline plan, đề xuất index / rewrite / update statistics

---

#### 1.1.2 Plan Regression
- **Tiêu chí:** một query xuất hiện execution plan mới trong 24h, tệ hơn plan cũ — thường xảy ra sau stats update, index rebuild, hoặc parameter sniffing thay đổi
- **Ngưỡng:** avg_duration plan mới > plan cũ × 1.5 (tệ hơn 50%), plan cũ đã có ≥ 100 executions
- **Hướng xử lý:** AI so sánh 2 plan XML, xác định optimizer chọn sai chỗ nào (wrong join type, index choice, partition elimination lost), đề xuất force plan cũ bằng USE PLAN hint hoặc plan guide

---

#### 1.1.3 Plan Instability
- **Tiêu chí:** cùng một query_hash có nhiều execution plan khác nhau đang active — dấu hiệu của parameter sniffing hoặc stats stale
- **Ngưỡng:** > 3 plan khác nhau trong 7 ngày, worst_plan / best_plan > 5x về avg_duration
- **Hướng xử lý:** AI phân tích nguyên nhân instability (parameter sniffing, stats stale, schema change), đề xuất fix thực sự (fix stats, rewrite dùng local variable, OPTION(RECOMPILE) chỉ khi low-frequency + high variation)
- **Không gợi ý:** `OPTION(OPTIMIZE FOR UNKNOWN)` — đã xác nhận gây CPU overload khi throughput cao, optimizer dùng average statistics dẫn đến plan suboptimal cho phần lớn workload

---

#### 1.1.4 Non-Optimal Index Usage
- **Tiêu chí:** query có logical reads cao, kết hợp với các dấu hiệu xấu trong execution plan XML
- **Ngưỡng:** avg_logical_reads > high_io_threshold (configurable per table size)
- **Dấu hiệu detect từ plan XML (Python parser):**
  - `PhysicalOp="Index Scan"` hoặc `PhysicalOp="Clustered Index Scan"` trên EstimateRows lớn
  - `PhysicalOp="Key Lookup"` — tốn thêm 1 IO per row, cần covering index
  - `PhysicalOp="Hash Match"` thay vì `Nested Loops` khi join trên indexed column
  - Implicit conversion warning trong `<Warnings>` → index không dùng được do type mismatch
- **Hướng xử lý:** AI đề xuất covering index, loại bỏ implicit conversion (sửa data type hoặc cast phía application)

---

#### 1.1.5 Partition Elimination Failure
- **Tiêu chí:** query trên bảng partitioned nhưng không có partition pruning → scan toàn bộ partition thay vì chỉ partition cần thiết
- **Dấu hiệu detect từ plan XML:** `<SeekPredicates>` thiếu trên cột partition key, hoặc Actual Partitions Accessed = tổng số partition của bảng
- **Hướng xử lý:** AI kiểm tra WHERE clause có đang dùng function/CONVERT/implicit cast trên cột partition không, đề xuất rewrite để SQL Server có thể eliminate partition

---

#### 1.1.6 High Variation Query
- **Tiêu chí:** query có execution time không ổn định — chạy nhanh đôi khi, rất chậm lúc khác → ảnh hưởng SLA
- **Ngưỡng:** count_executions > 50, CV (stdev/avg) > 0.5 (tức độ lệch chuẩn > 50% avg), avg_duration > min_threshold
- **Hướng xử lý:** AI phân tích nguyên nhân biến động (data skew, lock contention, parameter sniffing theo giờ cao điểm), đề xuất stabilize plan hoặc rewrite

---

#### 1.1.7 Blocking & Deadlock Monitor
**Tần suất:** Mỗi 1 phút

- **Tiêu chí:** phát hiện blocking chain, deadlock, và long-running transaction gây lock escalation
- **Ngưỡng:**
  - Session bị block > 30 giây → WARNING
  - Session bị block > 2 phút → CRITICAL
  - Blocking chain depth > 3 (head blocker cascade sang nhiều session) → CRITICAL
  - Deadlock xuất hiện bất kỳ → CRITICAL (alert ngay)
  - Lock escalation từ row/page lên table lock trên bảng lớn → WARNING
- **Dấu hiệu detect:**
  - `sys.dm_exec_requests`: `blocking_session_id` ≠ 0, `wait_type` thuộc nhóm `LCK_M_*`
  - Deadlock: System Health Extended Event session hoặc SQL Server Error Log deadlock graph
  - Lock escalation: `sys.dm_tran_locks` có `resource_type = OBJECT` với `request_mode = X`
- **Hướng xử lý:** AI phân tích head blocker đang chạy query gì, transaction có bị open quá lâu không; đề xuất kill session (cần approval) hoặc tối ưu transaction scope; với deadlock thì phân tích graph xác định thứ tự lock, đề xuất reorder truy cập resource

---

#### 1.1.8 TempDB & Memory Pressure Monitor
**Tần suất:** Mỗi 5 phút

- **Tiêu chí:** phát hiện TempDB bị áp lực và memory pressure toàn server
- **Ngưỡng — TempDB:**
  - Data file usage > 70% dung lượng đã cấp phát → WARNING; > 85% → CRITICAL
  - Version store size > 500 MB (CDC + snapshot isolation làm tăng version store) → WARNING
  - Spill to disk (Sort/Hash spill) tăng đột biến trong Query Store (`avg_tempdb_space_used`) → WARNING
- **Ngưỡng — Memory:**
  - Page Life Expectancy (PLE) < 300 giây → WARNING; < 100 giây → CRITICAL
  - Memory grants pending > 0 liên tục trong 5 phút → WARNING
  - Stolen server memory tăng liên tục trong 15 phút → WARNING
- **Dấu hiệu detect:**
  - `sys.dm_os_performance_counters`: PLE counter, memory grants pending, stolen pages
  - `sys.dm_db_file_space_usage`: version store pages, internal object pages, user object pages
  - Query Store: `avg_tempdb_space_used` của các query cao bất thường
- **Hướng xử lý:** AI xác định query nào đang gây spill (đề xuất rewrite giảm working set hoặc tăng memory grant hint); TempDB spike do CDC version store thì đề xuất điều chỉnh snapshot retention; memory pressure thì map sang workload group qua Resource Governor

---

#### 1.1.9 Wait Statistics Anomaly Monitor
**Tần suất:** Mỗi 5 phút (snapshot diff)

- **Tiêu chí:** phát hiện wait type nào đó tăng bất thường so với baseline cùng giờ, cho thấy bottleneck hệ thống đang thay đổi
- **Ngưỡng:**
  - Bất kỳ wait type top-10 nào tăng > 200% so với baseline cùng giờ 7 ngày trước → WARNING
  - `PAGEIOLATCH_SH` / `PAGEIOLATCH_EX` tăng đột biến → I/O bottleneck
  - `CXPACKET` / `CXCONSUMER` tăng đột biến → parallelism không hiệu quả
  - `WRITELOG` tăng cao → transaction log I/O bottleneck (liên quan đến AG sync)
  - `LCK_M_*` tăng cao → lock contention gia tăng (phối hợp với Blocking Monitor)
  - `ASYNC_NETWORK_IO` tăng cao → client không đọc kịp kết quả (slow client hoặc network issue)
- **Dấu hiệu detect:**
  - `sys.dm_os_wait_stats`: lấy snapshot mỗi interval, tính delta wait_time_ms per wait type
  - So sánh với baseline **cùng ngày trong tuần + cùng giờ** trong MongoDB `baselines` (4 tuần gần nhất, day-of-week aware)
- **Hướng xử lý:** AI map wait type dominant sang vấn đề cụ thể (I/O, CPU, network, locking), đề xuất hướng điều tra tiếp theo (query nào đang wait, disk throughput, AG log send queue trend)

---

#### 1.1.10 SQL Agent Job & Maintenance Monitor
**Tần suất:** Mỗi 10 phút

- **Tiêu chí:** giám sát SQL Agent jobs thất bại, backup thiếu, và các task maintenance quan trọng
- **Ngưỡng — Job failures:**
  - Job failed trong 24h gần nhất → WARNING
  - Job failed liên tiếp 2 lần trở lên → CRITICAL
  - Job chạy lâu hơn expected duration > 150% → WARNING (schedule có thể bị ảnh hưởng)
- **Ngưỡng — Backup:**
  - Database FULL backup > 24h chưa chạy (với database không phải read-only) → CRITICAL
  - LOG backup > 60 phút chưa chạy (recovery model = FULL) → WARNING
  - Backup verify (RESTORE VERIFYONLY) failed → CRITICAL
- **Ngưỡng — DBCC / Stats:**
  - DBCC CHECKDB chưa chạy trong 7 ngày → WARNING
  - Auto-update statistics bị disable trên database quan trọng → WARNING
- **Dấu hiệu detect:**
  - `msdb.dbo.sysjobhistory`: job outcome, run duration, run date/time
  - `msdb.dbo.backupset`: last backup date per database per type (FULL/LOG/DIFF)
  - `sys.databases`: `is_auto_update_stats_on`, page_verify_option
- **Hướng xử lý:** AI phân tích failure message xác định nguyên nhân (disk full, permission, deadlock trong job), đề xuất retry hay cần can thiệp thủ công; với backup gap thì alert CRITICAL và đề xuất chạy backup khẩn cấp (đưa vào approval queue vì là non-SELECT action)

---

#### 1.1.11 Blocked Query Detector
**Tần suất:** Mỗi 1 phút — chạy trên **TẤT CẢ nodes**

**Phần A — Snapshot realtime (alert ngay):**
- **Tiêu chí:** thu thập tất cả queries đang bị blocked tại thời điểm check
- **Ngưỡng:** wait_duration > `BLOCKED_QUERY_SNAPSHOT_MIN_SEC` (default 10 giây)
- **Dữ liệu thu thập — blocked session:**
  - query_text, query_hash, wait_type (`LCK_M_*`), wait_resource, wait_duration_ms, node
  - database_name, login_name, host_name
- **Dữ liệu thu thập — head blocker:**
  - blocking_session_query (query text của session đang giữ lock)
  - login_name, host_name của head blocker
- **Nguồn detect:** `sys.dm_exec_requests` (blocked session) JOIN `sys.dm_exec_sql_text` để lấy query text của cả 2 đầu
- **Hướng xử lý:** ghi vào `raw_metrics` với metric_type = `blocked_query_snapshot`; phối hợp với 1.1.7 để có full blocking picture (1.1.7 phát hiện chain structure, 1.1.11 cung cấp query-level detail); nếu cùng query_hash xuất hiện ≥ `BLOCKED_QUERY_TREND_MIN_COUNT` lần trong 7 ngày → trigger Phần B

**Phần B — Trend phân tích (phát hiện pattern dài hạn):**
- **Tiêu chí:** query_hash bị block lặp lại trong nhiều ngày → dấu hiệu contention cấu trúc, không phải sự cố nhất thời
- **Ngưỡng:** cùng query_hash bị block ≥ 5 lần trong 7 ngày (so sánh với baseline **cùng ngày trong tuần**) → flag để AI phân tích
- **Metrics tổng hợp từ `raw_metrics` (group by query_hash, 7 ngày):**
  - `blocked_count`: tổng số lần bị block
  - `avg_wait_ms` / `max_wait_ms`: thời gian chờ trung bình / lâu nhất
  - `peak_hours`: giờ cao điểm bị block nhiều nhất
  - `frequent_blocker_query`: query của head blocker xuất hiện nhiều nhất → dấu hiệu ai đang gây contention
- **Hướng xử lý:** AI phân tích nguyên nhân query thường xuyên bị block — thiếu covering index khiến lock range rộng hơn cần thiết, transaction scope quá lớn ở head blocker, hoặc schema design cần điều chỉnh; đề xuất covering index để thu hẹp lock scope, rewrite transaction để release lock sớm hơn, hoặc điều chỉnh isolation level nếu phù hợp

---

### 1.2 AG Health + CDC Monitor
**Tần suất:** Mỗi 2 phút (check cả 3 nodes)

- **Tiêu chí:** kiểm tra sync state của AG và trạng thái CDC jobs trên Primary
- **Ngưỡng:**
  - `log_send_queue_size` > 500 MB → WARNING
  - `synchronization_state_desc` ≠ SYNCHRONIZED liên tục > 3 phút → CRITICAL
  - CDC job `last_run_outcome` = failed → CRITICAL
- **Hướng xử lý:** alert ngay lập tức; nếu AG lag kéo dài AI phân tích nguyên nhân (high log generation rate, network congestion, Secondary redo lag) và đề xuất hướng xử lý

---

### 1.3 Index Fragmentation Monitor
**Tần suất:** 1 lần/ngày (chạy lúc 3:00 AM)

- **Tiêu chí:** index bị phân mảnh trên các bảng có kích thước đủ lớn để ảnh hưởng đến performance
- **Ngưỡng:** avg_fragmentation > 10%, page_count > 1,000
- **Logic phân loại:** REORGANIZE khi 10–30%, REBUILD khi > 30%
- **Hướng xử lý:** đề xuất schedule vào maintenance window (non-REBUILD giờ cao điểm), đưa vào approval queue vì là DDL action

---

### 1.4 Missing Index Detector
**Tần suất:** Mỗi 1 giờ

- **Tiêu chí:** SQL Server gợi ý index còn thiếu có giá trị cải thiện cao, tồn tại trong DMV kể từ lần restart gần nhất
- **Ngưỡng:** improvement_measure > 10,000 (tích của avg_total_user_cost × avg_user_impact × (user_seeks + user_scans))
- **Hướng xử lý:** AI đánh giá liệu nên tạo index mới hay merge vào index hiện có (tránh index overlap), xem xét impact lên INSERT/UPDATE, đưa vào approval queue

---

### 1.5 Resource Governor Monitor
**Tần suất:** Mỗi 5 phút

- **Tiêu chí:** resource pool đang tiêu thụ CPU gần mức giới hạn được cấu hình
- **Ngưỡng:** pool đang chạy > 85% max_cpu_percent liên tục trong 10 phút → WARNING
- **Hướng xử lý:** AI phân tích workload group nào đang gây áp lực, session nào đang consume nhiều nhất, đề xuất điều chỉnh classifier function hoặc giới hạn pool (cần approval vì là config change)

---

### 1.6 Storage Layer — MongoDB Local (Community)

**Connection:** `mongodb://localhost:27017/db_monitor`

#### Collections

| Collection | Nội dung | TTL |
|---|---|---|
| `raw_metrics` | Số liệu thô từng lần chạy collector (wait stats snapshot, TempDB usage, AG lag...) | 30 ngày |
| `findings` | Issue đã phân loại — issue_type, severity, node, metrics snapshot, plan_patterns | 90 ngày |
| `ai_analysis` | Kết quả Claude API — reasoning, root_cause, suggested_actions, risk_level | 90 ngày |
| `approval_queue` | Non-SELECT actions chờ admin duyệt — sql_script, ai_reasoning, expires_at, status | Không xóa |
| `audit_log` | Mọi action đã thực thi (approve/reject/auto) — approved_by, executed_at, result | Không xóa |
| `baselines` | Baseline metrics theo giờ/ngày cho từng check (wait stats, slow query threshold) | Không xóa |
| `dedup_cache` | Tracking issue đã alert để tránh spam — finding_hash → last_alerted_at | 7 ngày |
| `job_executions` | Lịch sử mỗi lần job chạy — status, duration, records_processed, error | 30 ngày |
| `monitor_topics` | Toàn bộ monitoring config — queries, thresholds, schedule, detector_type | Không xóa |
| `node_roles` | Cached AG node roles (auto-detect Primary/Secondary, refresh mỗi giờ) | Không xóa |

**Schema của `baselines` collection (day-of-week aware):**
```json
{
  "metric_type": "slow_sessions",
  "day_of_week": 2,
  "hour": 10,
  "query_hash": "0x...",
  "node": "SQL-NODE-01",
  "samples": [
    { "date": "ISODate", "avg_ms": 120 },
    { "date": "ISODate", "avg_ms": 115 }
  ],
  "baseline_avg": 117.5,
  "baseline_stddev": 3.5,
  "updated_at": "ISODate"
}
```
> `day_of_week`: 0 = Monday … 6 = Sunday (Python `weekday()`). Mỗi check so sánh với baseline **cùng day_of_week + cùng hour** trong 4 tuần gần nhất thay vì rolling average — phản ánh đúng pattern workload theo ngày trong tuần.

#### Document structure ví dụ — `findings`
```json
{
  "_id": "ObjectId",
  "finding_id": "uuid",
  "detected_at": "ISODate",
  "issue_type": "plan_regression",
  "severity": "HIGH",
  "node": "SQL-NODE-01",
  "query_hash": "0x...",
  "query_text": "...",
  "metrics": {
    "new_avg_ms": 450,
    "old_avg_ms": 80,
    "pct_worse": 462
  },
  "plan_patterns": ["index_scan_large_table", "missing_seek_predicate"],
  "plan_xml_ref": "findings/plan_xml/uuid.xml",
  "ai_analysis_id": "uuid",
  "status": "analyzed"
}
```

#### Indexing strategy
- `findings`: compound index `(issue_type, detected_at)`, `(query_hash, detected_at)`, `(status, severity)`
- `raw_metrics`: compound index `(metric_type, collected_at)` + TTL index trên `collected_at`
- `approval_queue`: index `(status, expires_at)` để query pending items hiệu quả
- `dedup_cache`: unique index `(finding_hash)` + TTL index trên `last_alerted_at`

#### Data flow
```
Layer 1 Collector chạy
    │
    ├─► raw_metrics ← ghi raw data ngay
    │
    ▼
Detector phân tích → phát hiện issue
    │
    ├─► findings ← ghi finding document
    │
    ├─ dedup_cache check → đã alert gần đây? → skip notify
    │
    ▼
Layer 2: AI phân tích (Claude API)
    │
    ├─► ai_analysis ← ghi kết quả Claude
    │
    ├─ [SELECT action] → tự execute → cập nhật findings.status = "resolved"
    │
    └─ [non-SELECT action] ──► approval_queue ← tạo document PENDING
                                        │
                                        ▼
                              Admin approve/reject
                                        │
                                        ▼
                                   audit_log ← ghi kết quả
```

---

### 1.7 Job Management — Execution Tracking

**Deployment:** Standalone single-instance — không cần Leader Election.

#### Job Execution Tracking

Mỗi lần Leader chạy 1 job, ghi execution record vào MongoDB để:
- Biết job nào đã chạy, khi nào, mất bao lâu
- Phát hiện job bị stuck (status = "running" quá lâu)
- Phát hiện job miss schedule (khoảng cách giữa 2 lần chạy > interval × 1.5)
- Dashboard hiển thị health của toàn bộ scheduler

**Collection `job_executions`** (TTL: 30 ngày):
```json
{
  "job_name": "slow_sessions_check",
  "instance_id": "host-A:pid-1234",
  "started_at": "ISODate",
  "finished_at": "ISODate",
  "duration_ms": 1240,
  "status": "success",
  "records_processed": 6,
  "findings_created": 2,
  "error_message": null,
  "next_expected_at": "ISODate"
}
```

**Status values:**
| Status | Ý nghĩa |
|---|---|
| `running` | Đang thực thi — nếu kéo dài > timeout → stuck |
| `success` | Hoàn thành bình thường |
| `failed` | Exception xảy ra trong quá trình chạy |
| `skipped` | Topic disabled — bỏ qua |

**Indexes:**
- `(job_name, started_at DESC)` — query latest run per job
- `(status, started_at)` — phát hiện stuck jobs
- TTL index trên `started_at` — auto cleanup sau 30 ngày

---

#### Job Health Dashboard

Query MongoDB để biết trạng thái toàn bộ scheduler tại bất kỳ thời điểm nào:

```
Job Name               | Last Run         | Duration | Status  | Next Expected    | Health
-----------------------|------------------|----------|---------|------------------|--------
slow_sessions_check       | 14/04 10:05:00   | 1.2s     | success | 14/04 10:10:00   | OK
ag_health_check        | 14/04 10:04:00   | 0.3s     | success | 14/04 10:06:00   | OK
blocking_monitor       | 14/04 10:04:30   | 0.5s     | success | 14/04 10:05:30   | OK
wait_stats_check       | 14/04 09:55:00   | 2.1s     | success | 14/04 10:00:00   | MISSED ⚠️
index_frag_monitor     | 14/04 03:00:00   | 45s      | success | 15/04 03:00:00   | OK
agent_job_monitor      | 14/04 10:03:00   | 0.8s     | running | —                | STUCK ⚠️
```

**Logic phát hiện anomaly:**
- **MISSED:** `now - last_run_at > job_interval × 1.5` → job không chạy đúng schedule
- **STUCK:** `status = "running"` và `now - started_at > job_timeout_threshold`
- **FAILED:** status = "failed" → xem `error_message` trong document

**Alert tự động** (không cần AI) khi phát hiện:
- Job STUCK > timeout → notify CRITICAL
- Job MISSED > 2 lần liên tiếp → notify WARNING
- Node role thay đổi (Primary failover) → notify WARNING

---

## LAYER 2: AI Agent — Chi tiết

### Trigger conditions (khi nào gọi Claude API)
Layer 1 phát hiện issue → chỉ gọi Claude khi:
- Slow query / plan regression mới xuất hiện (chưa từng analyze, check qua dedup_cache)
- AG lag tăng đột biến (cần giải thích nguyên nhân)
- Resource Governor pool spike > threshold
- Missing index với improvement_measure cao mới xuất hiện
- Blocking chain depth > 3 hoặc deadlock xuất hiện

**Mục đích:** Không gọi Claude liên tục → tiết kiệm cost, chỉ dùng AI khi thực sự cần tư duy.

---

### Human-in-the-Loop: Admin Approval cho mọi non-SELECT action

**Nguyên tắc cốt lõi:** AI Agent chỉ được **tự động thực thi SELECT** (đọc dữ liệu từ DMV để thu thập thêm context). Mọi thao tác khác — DDL, DML, config change — **bắt buộc phải được admin confirm** trước khi chạy.

#### Phân loại action

| Loại | Ví dụ | Xử lý |
|------|-------|-------|
| **SELECT** | Query DMV, Query Store, sys.* | Tự động — không cần approval |
| **DDL** | `CREATE INDEX`, `ALTER INDEX REBUILD`, `UPDATE STATISTICS`, `sp_configure` | **Bắt buộc approval** |
| **DML** | `INSERT/UPDATE/DELETE` trên bất kỳ bảng nào | **Bắt buộc approval** |
| **Stored Proc** | `EXEC sp_...`, system stored procedures | **Bắt buộc approval** |
| **Plan Guide** | `sp_create_plan_guide`, `sp_control_plan_guide` | **Bắt buộc approval** |
| **Resource Governor** | `ALTER RESOURCE POOL`, `ALTER RESOURCE GOVERNOR RECONFIGURE` | **Bắt buộc approval** |

#### Approval workflow

```
AI Agent đề xuất non-SELECT action
           │
           ▼
  Tạo document trong MongoDB approval_queue:
    - action_id (UUID)
    - action_type (DDL/DML/EXEC/...)
    - sql_script   (script đầy đủ sẽ chạy khi approve)
    - ai_reasoning (tại sao AI đề xuất action này)
    - risk_level   (LOW / MEDIUM / HIGH — AI tự đánh giá)
    - target_node  (Primary / Secondary / All)
    - expires_at   (24h — quá hạn tự hủy)
    - status       (PENDING)
           │
           ▼
  Gửi Approval Alert đến admin qua Slack/Teams/Telegram:

  ┌──────────────────────────────────────────────┐
  │ ⚠️ [DB AGENT] Action cần xác nhận           │
  │                                              │
  │ Issue: Plan regression trên sp_GetOrders     │
  │ AI Analysis: Optimizer chọn Index Scan thay  │
  │   vì Seek sau khi stats stale trên           │
  │   tbl_orders.IX_created_at                  │
  │                                              │
  │ Action đề xuất: [MEDIUM RISK]               │
  │   UPDATE STATISTICS tbl_orders              │
  │   WITH FULLSCAN, NORECOMPUTE               │
  │   -- Node: Primary (SQL-NODE-01)            │
  │                                              │
  │ ✅ APPROVE — /approve {action_id}           │
  │ ❌ REJECT  — /reject  {action_id} [lý do]  │
  └──────────────────────────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
 APPROVE       REJECT
    │             │
    ▼             ▼
Execute       Log rejection reason
+ audit_log   + update approval_queue status=REJECTED
+ notify done + notify admin
```

#### Command interface (admin reply vào Slack/Teams/Telegram)
```
/approve a1b2c3d4          → approve và execute ngay
/reject  a1b2c3d4 "reason" → từ chối, ghi lý do vào log
/pending                   → liệt kê tất cả action đang chờ
/history 24h               → xem audit log 24h qua
```

> ⚠️ **Nếu action expires mà chưa được approve → tự động REJECT và alert lại.**
> Script sẽ không bao giờ tự execute khi timeout.

#### Audit log (bắt buộc cho mọi action)
Mọi execution (dù approve hay reject) đều được ghi vào `audit_log` collection trong MongoDB:
```
action_id | action_type | sql_script | ai_reasoning | risk_level
requested_at | approved_by | approved_at | executed_at | execution_result
```

### Prompt strategy cho Claude
```
System prompt (được cache — tiết kiệm token):
  - Topology: 1 Primary (SQL-NODE-01), 2 Secondary (SQL-NODE-02, 03)
  - Partition scheme: [tên scheme, cột partition, boundary values]
  - CDC tables: [danh sách capture instances]
  - Resource Governor pools: [tên pools, workload groups, classifier function logic]
  - CONSTRAINTS (không được gợi ý các giải pháp sau):
      * OPTION (OPTIMIZE FOR UNKNOWN) — đã xác nhận gây CPU overload
        khi throughput cao, optimizer dùng average statistics dẫn đến
        suboptimal plan cho phần lớn workload thực tế
  - Preferred fix approaches theo thứ tự ưu tiên:
      1. Rewrite query để partition elimination hoạt động đúng
      2. Tạo/sửa index (covering index, partition-aligned)
      3. Fix statistics (UPDATE STATISTICS, auto-update stats)
      4. Plan guide để force plan tốt đã biết
      5. OPTION(RECOMPILE) chỉ khi query low-frequency + high variation

User message (mỗi lần gọi):
  - issue_type: [plan_regression | plan_instability | index_misuse |
                 partition_failure | slow_sessions | high_variation |
                 blocking | deadlock | tempdb_pressure | memory_pressure |
                 wait_anomaly | job_failure | backup_gap]
  - query_text, plan_patterns, detected_patterns từ XML parser (nếu có)
  - metrics: avg_ms, baseline_ms, cv_ratio, plan_count, wait_delta...
  - Context: thời điểm xảy ra, node nào, trend 7 ngày
```

---

## Stack kỹ thuật

```
Python 3.11+
├── pyodbc           — kết nối MSSQL (3 nodes)
├── anthropic        — Claude API (claude-sonnet-4-6 + prompt caching)
├── APScheduler      — chạy các checker theo tần suất khác nhau
├── pymongo          — MongoDB driver (local Community)
├── pymsteams        — push Microsoft Teams notification
├── slack-sdk        — push Slack notification
├── python-telegram-bot — push Telegram notification
├── pydantic         — validate/structure data từ DMV queries
└── lxml             — parse execution plan XML (detect scan/seek/key lookup)

Notification config (chọn 1 hoặc nhiều kênh qua config.py):
  NOTIFY_CHANNELS = ["teams", "slack", "telegram", "email"]
```

---

## Configuration — Config-Driven Architecture

### Env vars (Python `config.py`)
Chỉ chứa connection strings và credentials — cần có TRƯỚC khi kết nối MongoDB.

| Param | Default | Mô tả |
|---|---|---|
| `MSSQL_NODES` | — | Danh sách hostname (comma-separated). Roles tự detect, không hardcode |
| `MSSQL_DATABASE` | — | Database cần monitor |
| `MSSQL_USERNAME` / `MSSQL_PASSWORD` | — | Service account (VIEW SERVER STATE, VIEW DATABASE STATE) |
| `MSSQL_PORT` | 1433 | |
| `MSSQL_QUERY_TIMEOUT_SEC` | 30 | Default timeout, có thể override per-query trong topic config |
| `MONGODB_URI` | `mongodb://localhost:27017` | |
| `MONGODB_DB` | `db_monitor` | |
| `NODE_ROLE_REFRESH_SEC` | 3600 | Refresh AG node roles mỗi N giây (default 1 giờ) |
| `TEAMS_WEBHOOK_URL` | — | Notification credentials |
| `CLAUDE_API_KEY` | — | Layer 2 |

### MongoDB `monitor_topics` (toàn bộ monitoring config)
SQL queries, thresholds, schedule intervals — tất cả config-driven. Mỗi topic = 1 nhóm monitoring độc lập.

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
      "sql": "SELECT TOP 100 ar.replica_server_name, drs.synchronization_state_desc, drs.log_send_queue_size FROM sys.dm_hadr_database_replica_states drs JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id",
      "timeout_sec": 30
    }
  ],
  "detector_type": "threshold",
  "thresholds": {
    "log_send_queue_size": { "warning": 500, "critical": 1000 }
  }
}
```

**Thêm/sửa query** → có hiệu lực ngay lần chạy kế tiếp (reload mỗi job run).
**Sửa interval/thêm topic mới** → cần restart service.

### Node Role Cache
Tự động detect Primary/Secondary từ `sys.dm_hadr_availability_replica_states`. KHÔNG hardcode roles.
- Startup: query AG DMV → cache in-memory + MongoDB `node_roles`
- Refresh: mỗi `NODE_ROLE_REFRESH_SEC` (default 1 giờ)
- Topic config `nodes: ["primary"]` → resolve thành hostname thực tế từ cache

---

## Cấu trúc thư mục (Config-Driven Architecture)

```
layer1/                          # Python monitoring service
├── scheduler.py                 # Entry point: đọc topics → register jobs → start
├── config.py                    # EnvSettings only (connections, credentials)
│
├── models/                      # Pydantic data models
│   ├── topic.py                 # MonitorTopic, QueryConfig, ThresholdConfig, BaselineConfig
│   ├── metrics.py               # RawMetric, QueryResult
│   ├── findings.py              # Finding (output → Layer 2)
│   ├── common.py                # Severity, NodeRole, IssueType enums
│   └── job.py                   # JobExecution, JobStatus
│
├── executor/                    # Generic SQL executor + node management
│   ├── mssql_connection.py      # pyodbc context manager (tạo mới per-call)
│   ├── query_executor.py        # Nhận QueryConfig + host → execute → QueryResult
│   ├── topic_runner.py          # Orchestrate: reload config → resolve nodes → query → detect → notify
│   └── node_role_cache.py       # Detect Primary/Secondary từ AG DMV, cache, refresh/giờ
│
├── detectors/                   # Registry pattern — detector_type → handler
│   ├── registry.py              # Map "threshold"/"baseline"/... → handler class
│   ├── threshold_detector.py    # value vs topic.thresholds → WARNING/CRITICAL
│   ├── baseline_detector.py     # Day-of-week baseline comparison
│   ├── plan_detector.py         # XML execution plan analysis (lxml)
│   └── blocking_detector.py     # Chain depth, deadlock graph
│
├── storage/                     # MongoDB data access layer
│   ├── mongo_client.py          # Singleton MongoClient
│   ├── indexes.py               # TTL + compound indexes (idempotent)
│   └── repositories/
│       ├── topic_repo.py        # CRUD monitor_topics
│       ├── raw_metrics_repo.py  # insert_many query results
│       ├── findings_repo.py     # insert_one findings
│       ├── baseline_repo.py     # Day-of-week baseline CRUD
│       ├── dedup_repo.py        # Chống spam alert
│       └── job_execution_repo.py
│
├── job_manager/                 # Job lifecycle tracking
│   ├── job_runner.py            # Decorator ghi job_executions
│   └── health_checker.py        # Stuck/missed job detection
│
├── notifications/               # Alert channels
│   ├── base_notifier.py         # ABC + NotificationDispatcher
│   └── teams_notifier.py        # Teams Incoming Webhook
│
├── ai_agent/                    # Layer 2 (chưa implement)
│   └── ...
│
└── approval/                    # Layer 2 (chưa implement)
    └── ...
```

---

## Lộ trình triển khai (Config-Driven Architecture)

| Bước | Nội dung | Giá trị |
|------|----------|---------|
| 1 | `config.py` + `mongo_client.py` + `indexes.py` + `mssql_connection.py` | Foundation: kết nối MSSQL + MongoDB |
| 2 | `node_role_cache.py` — detect AG roles, cache, refresh job | Tự động detect Primary/Secondary |
| 3 | `models/topic.py` + `topic_repo.py` + seed sample topics vào MongoDB | Config structure sẵn sàng |
| 4 | `query_executor.py` + `topic_runner.py` — generic executor pipeline | Chạy được query từ MongoDB config |
| 5 | `job_runner.py` + `health_checker.py` + `scheduler.py` — APScheduler integration | Service chạy được end-to-end |
| 6 | `detectors/` — threshold + baseline + plan_analysis + blocking_chain | Tự động phát hiện issues |
| 7 | `notifications/` — Teams notification + dedup | Nhận alert ngay |
| 8 | Seed đầy đủ monitor_topics cho tất cả checks (AG, blocking, TempDB, wait stats, index...) | Phủ đầy đủ monitoring |
| 9 | AI Agent: analyzer + approval workflow (Layer 2) | AI phân tích + human-in-the-loop |
| 10 | Daily report generator | Xóa báo cáo thủ công |

---

## Verification sau mỗi bước

- **Bước 1:** Kết nối thành công cả 3 nodes, MongoDB collections tạo đúng indexes
- **Bước 2:** Startup → log đúng Primary/Secondary roles. Verify refresh sau 1 giờ
- **Bước 3:** Insert topic "test" vào MongoDB → topic_repo.find_all_enabled() trả về đúng
- **Bước 4:** Topic "test" với query `SELECT @@VERSION` → verify raw_metrics có rows
- **Bước 5:** Start service → jobs chạy đúng interval, job_executions ghi đúng
- **Bước 6:** Topic "tempdb" với detector_type="threshold" → verify finding khi PLE thấp
- **Bước 7:** Finding → Teams alert đúng format, dedup không spam
- **Bước 8:** Thêm/sửa query trong MongoDB → verify chạy đúng ở lần kế tiếp (không restart)

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
