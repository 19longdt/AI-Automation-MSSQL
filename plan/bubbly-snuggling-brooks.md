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
│  │ Slow Query   │  │ AG / CDC     │  │ Index & Resource │  │
│  │ Detector     │  │ Health Check │  │ Governor Monitor │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         └─────────────────┴──────────────────┘              │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │ Issue Store │  (SQLite / file / memory) │
│                    │ (structured │                          │
│                    │  findings)  │                          │
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
│      (Layer 1 DMV)             (SQLite — chờ admin)         │
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
                        + ghi audit log              + đóng ticket
```

---

## LAYER 1: Python Monitoring Service — Chi tiết

### 1.1 Query Problem Detector (mở rộng)
**Tần suất:** Mỗi 5 phút (chạy trên Primary)

Phát hiện **6 loại vấn đề query** khác nhau từ Query Store + DMVs:

---

#### 1.1.1 Slow Query / Performance Regression
So sánh avg_duration với baseline 7 ngày trước → flag nếu tăng > threshold %

```sql
SELECT qt.query_sql_text, q.query_hash,
       rs.avg_duration / 1000.0   AS avg_duration_ms,
       rs.avg_logical_io_reads,
       rs.count_executions,
       qp.query_plan               -- XML plan gửi cho AI
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q  ON qt.query_id = q.query_id
JOIN sys.query_store_plan qp  ON q.query_id  = qp.query_id
JOIN sys.query_store_runtime_stats rs ON qp.plan_id = rs.plan_id
WHERE rs.last_execution_time > DATEADD(MINUTE, -30, GETUTCDATE())
  AND rs.avg_duration > {threshold_microseconds}
ORDER BY rs.avg_duration DESC
```

---

#### 1.1.2 Plan Regression (thực hiện sai plan)
Phát hiện khi một query đột ngột chuyển sang dùng execution plan mới kém hơn — thường xảy ra sau khi stats update, index rebuild, hoặc parameter sniffing thay đổi.

```sql
-- Tìm queries có plan mới xuất hiện trong 24h, tệ hơn plan cũ
SELECT q.query_id, qt.query_sql_text,
       new_plan.plan_id            AS new_plan_id,
       new_rs.avg_duration / 1000.0 AS new_avg_ms,
       old_rs.avg_duration / 1000.0 AS old_avg_ms,
       (new_rs.avg_duration - old_rs.avg_duration) * 100.0
           / NULLIF(old_rs.avg_duration, 0)  AS pct_worse,
       new_plan.query_plan          -- XML plan của plan mới (xấu) gửi AI
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
-- plan mới (xuất hiện trong 24h gần nhất)
JOIN sys.query_store_plan new_plan ON q.query_id = new_plan.query_id
JOIN sys.query_store_runtime_stats new_rs ON new_plan.plan_id = new_rs.plan_id
-- plan cũ (plan trước đó của cùng query)
JOIN sys.query_store_plan old_plan ON q.query_id = old_plan.query_id
    AND old_plan.plan_id != new_plan.plan_id
JOIN sys.query_store_runtime_stats old_rs ON old_plan.plan_id = old_rs.plan_id
WHERE new_plan.last_compile_start_time > DATEADD(HOUR, -24, GETUTCDATE())
  AND new_rs.avg_duration > old_rs.avg_duration * 1.5  -- tệ hơn 50%
  AND old_rs.count_executions > 100  -- plan cũ đã có đủ dữ liệu
ORDER BY pct_worse DESC
```

**AI sẽ phân tích:** So sánh 2 plan XML, xác định optimizer chọn sai chỗ nào (wrong join type, index choice, partition elimination lost...), đề xuất: force plan cũ bằng USE PLAN hint hoặc plan guide.

---

#### 1.1.3 Plan Instability (query không có tính ổn định)
Cùng một query hash nhưng có nhiều plan khác nhau đang được dùng → dấu hiệu của parameter sniffing hoặc stats stale.

```sql
-- Query có > N plan khác nhau đang active trong Query Store
SELECT q.query_id, qt.query_sql_text,
       COUNT(DISTINCT qp.plan_id)   AS plan_count,
       MIN(rs.avg_duration) / 1000.0 AS best_plan_ms,
       MAX(rs.avg_duration) / 1000.0 AS worst_plan_ms,
       MAX(rs.avg_duration) * 1.0 / NULLIF(MIN(rs.avg_duration), 0)
                                     AS instability_ratio
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan qp       ON q.query_id = qp.query_id
JOIN sys.query_store_runtime_stats rs ON qp.plan_id = rs.plan_id
WHERE rs.last_execution_time > DATEADD(DAY, -7, GETUTCDATE())
GROUP BY q.query_id, qt.query_sql_text
HAVING COUNT(DISTINCT qp.plan_id) > 3        -- nhiều hơn 3 plan
   AND MAX(rs.avg_duration) / NULLIF(MIN(rs.avg_duration), 0) > 5  -- worst 5x best
ORDER BY instability_ratio DESC
```

**AI sẽ phân tích:** Nguyên nhân instability (parameter sniffing, stats stale, schema change), đề xuất fix thực sự (fix stats, rewrite query dùng local variable, OPTION(RECOMPILE) chỉ khi thực sự cần và low-frequency).

> ⚠️ **Lưu ý:** `OPTION (OPTIMIZE FOR UNKNOWN)` KHÔNG được gợi ý — đã xác nhận gây CPU overload khi throughput cao do optimizer phải estimate với giá trị trung bình, thường dẫn đến plan suboptimal cho majority of workload.

---

#### 1.1.4 Non-Optimal Index Usage (dùng index không tối ưu)
Phát hiện các patterns phổ biến: Index Scan thay vì Seek, Key Lookup tốn kém, Clustered Index Scan trên bảng lớn.

```sql
-- Từ DMV sys.dm_exec_query_stats: queries có high logical reads
-- kết hợp với execution plan XML parsing để detect scan vs seek
SELECT TOP 30
    qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
    qs.total_worker_time   / qs.execution_count AS avg_cpu_us,
    qs.execution_count,
    SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1)
                                                 AS query_text,
    qp.query_plan                                -- XML để parse PhysicalOp
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qs.total_logical_reads / qs.execution_count > {high_io_threshold}
  AND qp.query_plan IS NOT NULL
ORDER BY avg_logical_reads DESC
```

**Python parser sẽ scan XML plan** tìm các dấu hiệu:
- `PhysicalOp="Index Scan"` hoặc `PhysicalOp="Clustered Index Scan"` trên EstimateRows lớn
- `PhysicalOp="Key Lookup"` — tốn thêm 1 IO per row, cần covering index
- `PhysicalOp="Hash Match"` thay vì `Nested Loops` khi join trên indexed column
- Implicit conversion warning trong `<Warnings>` → index không dùng được do type mismatch

---

#### 1.1.5 Partition Elimination Failure
Query trên bảng partitioned nhưng không dùng partition pruning → scan tất cả partitions thay vì chỉ partition cần thiết.

```sql
-- Detect qua execution plan: PartitionCount > expected trong Actual Rows
-- Kết hợp với sys.dm_db_partition_stats để biết số partition thực tế
SELECT
    OBJECT_NAME(p.object_id)    AS table_name,
    COUNT(p.partition_number)   AS total_partitions
FROM sys.partitions p
WHERE p.object_id IN (
    SELECT DISTINCT object_id FROM sys.partition_schemes ps
    JOIN sys.indexes i ON i.data_space_id = ps.data_space_id
)
GROUP BY p.object_id
```

**Python parser scan XML plan** tìm: `<SeekPredicates>` thiếu trên cột partition, hoặc `Actual Partitions Accessed` = tổng số partitions (dấu hiệu full partition scan).

**AI sẽ phân tích:** WHERE clause có đang dùng function/CONVERT trên cột partition không → đề xuất rewrite để SQL Server có thể eliminate partition.

---

#### 1.1.6 High Variation Query (execution time bất ổn)
Query có stddev execution time cao — chạy nhanh đôi khi, chạy rất chậm lúc khác → khó debug và ảnh hưởng SLA.

```sql
SELECT q.query_id, qt.query_sql_text,
       rs.avg_duration / 1000.0         AS avg_ms,
       rs.stdev_duration / 1000.0       AS stddev_ms,
       rs.stdev_duration * 1.0 / NULLIF(rs.avg_duration, 0)
                                         AS cv_ratio,  -- coefficient of variation
       rs.min_duration / 1000.0         AS min_ms,
       rs.max_duration / 1000.0         AS max_ms,
       rs.count_executions
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN sys.query_store_plan qp       ON q.query_id = qp.query_id
JOIN sys.query_store_runtime_stats rs ON qp.plan_id = rs.plan_id
WHERE rs.count_executions > 50
  AND rs.stdev_duration / NULLIF(rs.avg_duration, 0) > 0.5  -- CV > 50%
  AND rs.avg_duration > {min_threshold}
ORDER BY cv_ratio DESC
```

---

**Output tổng hợp gửi Layer 2:** Với mỗi issue, đính kèm: issue_type, query_hash, query_text, plan_xml, metrics (before/after nếu có regression), detected_patterns từ XML parser.

---

### 1.2 AG Health + CDC Monitor
**Tần suất:** Mỗi 2 phút (check cả 3 nodes)

**Checks:**
```sql
-- AG Sync Lag
SELECT ar.replica_server_name,
       drs.synchronization_state_desc,
       drs.log_send_queue_size,   -- KB — tăng đột biến = dấu hiệu lag
       drs.redo_queue_size,
       drs.synchronization_health_desc
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id

-- CDC Job Status (Primary)
SELECT job_name, last_run_outcome, last_run_date, last_run_duration,
       last_run_retries
FROM msdb.dbo.sysjobs sj
JOIN msdb.dbo.sysjobhistory sjh ON sj.job_id = sjh.job_id
WHERE sj.name LIKE 'cdc.%'
  AND sjh.run_date = CONVERT(int, FORMAT(GETDATE(), 'yyyyMMdd'))
```

**Thresholds (configurable):**
- `log_send_queue_size` > 500 MB → WARNING
- `synchronization_state_desc` != 'SYNCHRONIZED' > 3 phút → CRITICAL
- CDC job `last_run_outcome` = 0 (failed) → CRITICAL

---

### 1.3 Index Fragmentation Monitor
**Tần suất:** 1 lần/ngày (chạy lúc ít tải, ví dụ 3:00 AM)

```sql
SELECT OBJECT_SCHEMA_NAME(ips.object_id) AS schema_name,
       OBJECT_NAME(ips.object_id)        AS table_name,
       i.name                            AS index_name,
       ips.partition_number,
       ips.avg_fragmentation_in_percent,
       ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 10
  AND ips.page_count > 1000
ORDER BY ips.avg_fragmentation_in_percent DESC
```

**Logic:** Tự quyết định REORGANIZE (10-30%) vs REBUILD (>30%), schedule vào window ít tải.

---

### 1.4 Missing Index Detector
**Tần suất:** Mỗi 1 giờ

```sql
SELECT TOP 20
    OBJECT_NAME(mid.object_id)          AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans)
                                         AS improvement_measure,
    migs.user_seeks, migs.user_scans
FROM sys.dm_db_missing_index_details mid
JOIN sys.dm_db_missing_index_groups mig   ON mid.index_handle = mig.index_handle
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
WHERE migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) > 10000
ORDER BY improvement_measure DESC
```

---

### 1.5 Resource Governor Monitor
**Tần suất:** Mỗi 5 phút

```sql
SELECT rp.name AS pool_name,
       rp.max_cpu_percent,
       rpstats.active_request_count,
       rpstats.active_worker_count,
       CAST(rpstats.statistics_start_time AS varchar) AS stats_since
FROM sys.resource_governor_resource_pools rp
JOIN sys.dm_resource_governor_resource_pools rpstats ON rp.pool_id = rpstats.pool_id
```

**Alert:** Pool nào đang > 85% max_cpu_percent liên tục trong 10 phút → flag để AI phân tích workload group.

---

## LAYER 2: AI Agent — Chi tiết

### Trigger conditions (khi nào gọi Claude API)
Layer 1 phát hiện issue → chỉ gọi Claude khi:
- Slow query mới xuất hiện (chưa từng analyze)
- AG lag tăng đột biến (cần giải thích nguyên nhân)
- Resource Governor pool spike > threshold
- Missing index với improvement_measure cao mới xuất hiện

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
  Tạo ApprovalRequest trong SQLite:
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
+ audit log   + đóng ApprovalRequest
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
Mọi execution (dù approve hay reject) đều được ghi vào bảng `audit_log` trong SQLite:
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
                 partition_failure | slow_query | high_variation]
  - query_text, plan_xml, detected_patterns từ XML parser
  - metrics: avg_ms, baseline_ms, cv_ratio, plan_count...
  - Context: thời điểm xảy ra, node nào, trend 7 ngày
```

---

## Stack kỹ thuật

```
Python 3.11+
├── pyodbc           — kết nối MSSQL (3 nodes)
├── anthropic        — Claude API (claude-sonnet-4-6 + prompt caching)
├── APScheduler      — chạy các checker theo tần suất khác nhau
├── pymsteams        — push Microsoft Teams notification
├── slack-sdk        — push Slack notification
├── python-telegram-bot — push Telegram notification
├── pydantic         — validate/structure data từ DMV queries
├── lxml             — parse execution plan XML (detect scan/seek/key lookup)
└── sqlite3 (stdlib) — lưu issue history, baseline metrics, dedup alerts

Notification config (chọn 1 hoặc nhiều kênh qua config.py):
  NOTIFY_CHANNELS = ["teams", "slack", "telegram", "email"]
```

---

## Cấu trúc thư mục dự kiến

```
db_monitor/
├── config.py                    # connection strings, thresholds, API key
├── scheduler.py                 # APScheduler orchestration (entry point)
│
├── collectors/                  # Layer 1: DMV queries → structured data
│   ├── query_store.py           # slow query, plan instability, high variation
│   ├── query_stats.py           # dm_exec_query_stats: non-optimal index usage
│   ├── ag_health.py
│   ├── index_fragmentation.py
│   ├── missing_indexes.py
│   └── resource_governor.py
│
├── plan_parser/                 # XML execution plan analyzer
│   ├── plan_parser.py           # lxml-based: extract operators, warnings
│   ├── detectors/
│   │   ├── scan_detector.py     # Index Scan / Clustered Index Scan trên bảng lớn
│   │   ├── key_lookup_detector.py
│   │   ├── partition_elimination.py  # kiểm tra Actual Partitions Accessed
│   │   └── implicit_conversion.py   # <Warnings> type conversion
│   └── plan_comparer.py         # so sánh 2 plan XML để detect regression
│
├── detectors/                   # Layer 1: logic phát hiện + classify vấn đề
│   ├── query_regression.py      # so sánh avg_duration vs baseline
│   ├── plan_regression.py       # detect plan thay đổi xấu đi
│   ├── plan_instability.py      # nhiều plan cho cùng query_hash
│   ├── ag_lag_detector.py
│   └── threshold_checker.py
│
├── ai_agent/                    # Layer 2: Claude API integration
│   ├── analyzer.py              # gọi Claude API, nhận issue → trả analysis
│   ├── action_classifier.py     # phân loại SELECT vs non-SELECT action
│   ├── prompts/
│   │   ├── system_prompt.md     # context về hệ thống (được cache)
│   │   └── templates/           # prompt templates cho từng issue type
│   └── tool_definitions.py      # Claude tool use: chỉ SELECT DMV queries
│
├── approval/                    # Human-in-the-loop approval workflow
│   ├── approval_queue.py        # tạo/query/update ApprovalRequest trong SQLite
│   ├── command_listener.py      # lắng nghe /approve, /reject từ Slack/Teams/Telegram
│   ├── executor.py              # thực thi action sau khi admin approve
│   └── audit_logger.py          # ghi audit log mọi action
│
├── storage/
│   ├── issue_store.py           # SQLite: findings, baseline, alert history
│   └── schema.sql               # DDL cho approval_queue + audit_log tables
│
└── notifications/
    ├── teams_notifier.py
    └── report_generator.py      # daily/weekly HTML report
```

---

## Lộ trình triển khai (theo thứ tự ưu tiên)

| Bước | Nội dung | Giá trị | Thời gian ước tính |
|------|----------|---------|-------------------|
| 1 | Setup project, config, pyodbc kết nối 3 nodes | Foundation | 0.5 ngày |
| 2 | collectors/ + detectors/ cho slow query (Layer 1) | Tự động detect, không cần AI | 1 ngày |
| 3 | collectors/ cho AG health + CDC | Giám sát liên tục 24/7 | 0.5 ngày |
| 4 | APScheduler + Teams notification (alert cơ bản) | Nhận alert ngay, ngủ yên | 0.5 ngày |
| 5 | AI Agent: slow query analyzer (Layer 2) | Tiết kiệm thời gian phân tích | 1 ngày |
| 6 | Index fragmentation + missing index collectors | Tự động maintenance | 0.5 ngày |
| 7 | Resource Governor monitor + AI analysis | Kiểm soát workload | 0.5 ngày |
| 8 | Daily report generator (Claude tổng hợp văn bản) | Xóa báo cáo thủ công | 1 ngày |
| 9 | Claude tool use: AI tự query DMV khi cần thêm context | AI chủ động điều tra | 1 ngày |

---

## Verification sau mỗi bước

- **Bước 1-3:** Chạy thủ công từng collector, in ra JSON, verify data đúng với SSMS
- **Bước 4:** Trigger test alert → xác nhận nhận được Teams message
- **Bước 5:** Feed 1 known slow query vào AI → verify recommendation hợp lý
- **Bước 8:** Chạy report generator → review output trước khi bật auto-send
