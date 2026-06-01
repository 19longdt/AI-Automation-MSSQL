# Plan: Layer 1 — Cải Thiện Nội Dung Alert

> **Vấn đề:**
> 1. Một số nội dung tiếng Việt hiển thị lỗi font (mojibake) trong Telegram — nguyên nhân: seed data MongoDB được insert từ file encoding cp1258
> 2. `description` trong seed_topics, capture_tools đang dùng tiếng Anh
> 3. Nội dung alert vắn tắt — không có `recommendation`, không giải thích ý nghĩa metric
> 4. Các keyword kỹ thuật (`cv_ratio`, `ple_sec`, `log_send_queue_size`, ...) hiển thị raw không có giải thích
>
> **Phạm vi:** `layer1/seed/`, `layer1/models/`, `layer1/detectors/`, `layer1/notifications/`  
> **Không thay đổi:** SQL queries, threshold values, detector logic, alert schedule

---

## 1. Chẩn Đoán Vấn Đề Font

### Nguyên nhân

Layer2 có 7 file `.py` encoding cp1258 (đã fix). Layer1 Python files đều UTF-8 sạch.  
Tuy nhiên **seed data** (`seed_topics.py`, `seed_capture_tools.py`) khi chạy trên môi trường Windows với locale cp1258 sẽ insert string vào MongoDB với encoding sai → hiển thị mojibake trong Telegram.

### Fix

```
1. Đảm bảo file seed đều UTF-8 (đã OK)
2. Re-run seed script sau khi fix nội dung (Phase 2 bên dưới)
   → Drop + re-insert collection: monitor_topics, capture_tools
3. Thêm # -*- coding: utf-8 -*- ở đầu mỗi file seed (Python 2 legacy, optional nhưng safe)
```

---

## 2. Cấu Trúc Thay Đổi

```
layer1/
├── seed/
│   ├── seed_topics.py          ← SỬA: description + recommendation tiếng Việt + metric_glossary
│   └── seed_capture_tools.py  ← SỬA: display_name + description tiếng Việt
│
├── models/
│   └── findings.py             ← SỬA: thêm field description + recommendation vào Finding
│
├── detectors/
│   ├── threshold_detector.py   ← SỬA: populate description + recommendation từ topic config
│   └── baseline_detector.py   ← SỬA: populate description + recommendation
│
└── notifications/
    └── telegram_notifier.py    ← SỬA: hiển thị description + recommendation + metric glossary
```

---

## 3. Schema Thay Đổi — `MonitorTopic` & `Finding`

### 3.1 Thêm vào `MonitorTopic` (seed_topics.py + MongoDB)

```python
class MonitorTopic(BaseModel):
    # ... fields hiện tại giữ nguyên ...

    # THÊM MỚI:
    alert_description: str = ""
    # Mô tả tiếng Việt — hiển thị đầu alert, giải thích vấn đề này là gì và tại sao quan trọng
    # VD: "Query đang chạy quá lâu có thể chiếm tài nguyên, ảnh hưởng đến các phiên khác."

    recommendations: dict[str, str] = {}
    # Map: threshold_field → câu khuyến nghị tiếng Việt
    # VD: {"elapsed_seconds": "Kill session nếu > 300s hoặc escalate DBA ngay."}

    metric_glossary: dict[str, str] = {}
    # Map: metric_key → định nghĩa + ý nghĩa tác động (tiếng Việt)
    # VD: {"elapsed_seconds": "Thời gian query đã chạy (giây). > 300s = critical, cần can thiệp ngay."}
```

### 3.2 Thêm vào `Finding` (findings.py)

```python
class Finding(BaseModel):
    # ... fields hiện tại giữ nguyên ...

    # THÊM MỚI:
    description: str = ""
    # Mô tả vấn đề cụ thể — do detector sinh ra, kết hợp topic config + metric thực tế
    # VD: "Session 58 đã chạy 420 giây trên Primary. Query: SELECT * FROM Orders WHERE..."

    recommendation: str = ""
    # Hành động khuyến nghị — lấy từ topic.recommendations[triggered_field]
    # VD: "Xem xét KILL SESSION 58. Chạy /quick để phân tích nhanh."
```

---

## 4. Nội Dung Mới — Toàn Bộ Topics

### Topic: `slow_sessions` — Slow Query / Active Sessions

```python
alert_description=(
    "Phát hiện query đang chạy quá lâu trên server. "
    "Query chậm chiếm CPU và lock tài nguyên, có thể gây blocking cho các phiên khác "
    "và làm giảm throughput toàn hệ thống."
),
recommendations={
    "elapsed_seconds": (
        "Kiểm tra query text và execution plan. "
        "Nếu > 300s và không có lý do hợp lệ — cân nhắc KILL SESSION. "
        "Dùng ⚡ Quick để phân tích nhanh hoặc 🤖 Analyze để chẩn đoán sâu."
    ),
},
metric_glossary={
    "elapsed_seconds": (
        "Elapsed time (giây): thời gian query đã chạy tính từ lúc bắt đầu. "
        "Ngưỡng cảnh báo: WARNING > 30s, CRITICAL > 300s."
    ),
    "session_id": "Session ID: định danh phiên kết nối trong SQL Server (sys.dm_exec_sessions).",
    "blocking_session_id": (
        "Blocking session ID: session đang chặn session này. "
        "Giá trị 0 = không bị block, > 0 = có blocking chain."
    ),
    "wait_type": (
        "Wait type: loại tài nguyên session đang chờ. "
        "LCK_M_* = chờ lock, PAGEIOLATCH_* = chờ disk I/O, CXPACKET = chờ parallel thread."
    ),
    "cpu_time": "CPU time (ms): tổng CPU đã tiêu thụ từ lúc query bắt đầu.",
    "logical_reads": (
        "Logical reads: số data page đọc từ buffer cache. "
        "Con số cao (> 100,000) thường chỉ ra thiếu index hoặc table scan."
    ),
},
```

---

### Topic: `blocking` — Blocking Chain & Deadlock

```python
alert_description=(
    "Phát hiện blocking chain — một hoặc nhiều session đang bị chặn bởi session khác đang giữ lock. "
    "Blocking chain sâu (> 3 cấp) là dấu hiệu contention nghiêm trọng, "
    "có thể leo thang thành deadlock nếu không xử lý kịp thời."
),
recommendations={
    "wait_sec": (
        "Xác định head blocker (session không bị block nhưng đang giữ lock). "
        "Ưu tiên: (1) kiểm tra head blocker đang làm gì, "
        "(2) KILL head blocker nếu là long-running transaction không cần thiết, "
        "(3) review transaction scope để tránh hold lock lâu."
    ),
    "chain_depth": (
        "Chain depth > 3: có thể đã hoặc sắp có deadlock. "
        "Dùng ⛔ Kill Blocking để terminate head blocker, "
        "sau đó dùng 🤖 Analyze để tìm root cause lâu dài."
    ),
},
metric_glossary={
    "chain_depth": (
        "Chain depth: số cấp trong chuỗi blocking (A block B block C = depth 2). "
        "WARNING ≥ 2, CRITICAL ≥ 3. Depth càng cao = impact càng rộng."
    ),
    "wait_sec": (
        "Wait time (giây): thời gian session đã bị chặn. "
        "WARNING > 30s, CRITICAL > 120s."
    ),
    "wait_type": (
        "Wait type: loại lock đang bị block. "
        "LCK_M_S = shared lock, LCK_M_X = exclusive lock, LCK_M_U = update lock."
    ),
    "head_blocker_session_id": (
        "Head blocker: session đứng đầu chain — session này giữ lock mà không bị block bởi ai. "
        "Đây là target cần xử lý trước."
    ),
    "blocked_session_count": "Số session đang bị block trong toàn bộ chain tại thời điểm check.",
},
```

---

### Topic: `blocked_query` — Blocked Query Snapshot

```python
alert_description=(
    "Snapshot chi tiết về các query đang bị block tại thời điểm phát hiện. "
    "Thông tin bao gồm SQL text, wait type, và session đang gây block — "
    "phục vụ chẩn đoán nhanh mà không cần query thêm."
),
recommendations={
    "wait_duration_sec": (
        "Query đang bị block > 60s là dấu hiệu nghiêm trọng. "
        "Xác định head blocker từ metrics và cân nhắc terminate "
        "nếu business cho phép. Review locking strategy trong transaction."
    ),
},
metric_glossary={
    "wait_duration_sec": (
        "Thời gian query đã bị block (giây). WARNING > 10s, CRITICAL > 60s. "
        "Thời gian dài = user/app bị treo, timeout risk tăng."
    ),
    "blocking_session_id": "Session ID của kẻ đang giữ lock gây chặn query này.",
    "wait_resource": (
        "Tài nguyên cụ thể đang bị tranh chấp, VD: KEY: 5:72057594043957248 (lock trên index key). "
        "Dùng DBCC PAGE hoặc sys.dm_os_waiting_tasks để decode."
    ),
},
```

---

### Topic: `ag_health` — AG Health & CDC

```python
alert_description=(
    "Giám sát sức khỏe Always On Availability Group và CDC. "
    "Log send queue và redo queue tăng cao = secondary đang lag sau primary, "
    "tăng nguy cơ mất dữ liệu khi failover và làm chậm read workload trên secondary."
),
recommendations={
    "log_send_queue_size": (
        "Log send queue > 1000 KB: network bandwidth hoặc secondary đang quá tải. "
        "Kiểm tra network latency giữa primary và secondary. "
        "Review I/O subsystem trên secondary node."
    ),
    "redo_queue_size": (
        "Redo queue > 5000 KB: secondary không redo log đủ nhanh. "
        "Kiểm tra disk I/O trên secondary, xem xét tăng redo thread "
        "(ALTER AVAILABILITY GROUP ... SET REDO_QUEUE_SIZE)."
    ),
    "run_status": (
        "CDC job không chạy (run_status = 0): CDC capture hoặc cleanup bị dừng. "
        "Kiểm tra SQL Agent job, restart nếu cần. "
        "CDC dừng sẽ làm version store TempDB tích lũy."
    ),
},
metric_glossary={
    "log_send_queue_size": (
        "Log send queue (KB): lượng log chưa gửi từ primary → secondary. "
        "Đây là thước đo RPO (Recovery Point Objective). "
        "WARNING > 500 KB, CRITICAL > 1,000 KB. Cao = secondary lag = data loss risk khi failover."
    ),
    "redo_queue_size": (
        "Redo queue (KB): lượng log đã nhận nhưng chưa được apply vào secondary database. "
        "WARNING > 1,000 KB, CRITICAL > 5,000 KB. "
        "Cao = secondary đọc data cũ hơn primary nhiều."
    ),
    "synchronization_state_desc": (
        "Trạng thái đồng bộ AG: SYNCHRONIZED = bình thường, "
        "SYNCHRONIZING = đang bắt kịp, NOT SYNCHRONIZING = ngắt kết nối/lỗi."
    ),
    "run_status": (
        "Trạng thái SQL Agent job: 4 = đang chạy (bình thường), "
        "0/1/3 = không chạy/failed/retry. CDC job dừng → capture ngừng hoạt động."
    ),
},
```

---

### Topic: `tempdb_memory` — TempDB & Memory Pressure

```python
alert_description=(
    "Giám sát áp lực bộ nhớ và TempDB — hai tài nguyên chia sẻ ảnh hưởng toàn bộ workload. "
    "PLE thấp và memory grant pending cao = server thiếu RAM cho query execution. "
    "TempDB đầy sẽ làm fail tất cả query cần sort/hash/spool."
),
recommendations={
    "ple_sec": (
        "PLE < 300s: tăng RAM hoặc tối ưu các query có large memory grant. "
        "Kiểm tra top memory consumers qua sys.dm_exec_query_memory_grants. "
        "Xem xét Resource Governor để giới hạn memory per workload group."
    ),
    "pending_grants": (
        "Memory grants pending > 0: query đang xếp hàng chờ memory. "
        "> 5 grant chờ = CRITICAL, latency user tăng đột biến. "
        "Tối ưu query tốn memory (sort, hash join) hoặc tăng max server memory."
    ),
    "used_pct": (
        "TempDB > 85%: nguy cơ đầy TempDB trong thời gian ngắn. "
        "Xác định session dùng nhiều TempDB nhất (sys.dm_db_session_space_usage). "
        "Kill session nếu cần, hoặc thêm data file TempDB."
    ),
    "version_store_mb": (
        "Version store > 1,000 MB: CDC job dừng hoặc long-running read-committed snapshot transaction. "
        "Kiểm tra CDC job status và các transaction snapshot isolation lâu."
    ),
},
metric_glossary={
    "ple_sec": (
        "Page Life Expectancy (giây): thời gian trung bình một data page được giữ trong buffer pool (RAM). "
        "PLE là chỉ số sức khỏe memory quan trọng nhất. "
        "WARNING < 300s, CRITICAL < 100s. "
        "PLE thấp = SQL Server liên tục phải đọc disk thay vì từ RAM → latency tăng."
    ),
    "pending_grants": (
        "Memory grants pending: số query đang chờ được cấp workspace memory để thực thi. "
        "WARNING ≥ 1, CRITICAL ≥ 5. "
        "Mỗi query cần memory cho sort/hash/aggregate — nếu không đủ RAM sẽ phải spill ra TempDB."
    ),
    "used_pct": (
        "TempDB used %: phần trăm dung lượng TempDB đã dùng (version store + user objects + internal). "
        "WARNING > 70%, CRITICAL > 85%. TempDB đầy = mọi query cần sort/spool đều fail."
    ),
    "version_store_mb": (
        "Version store (MB): vùng TempDB lưu các phiên bản dữ liệu cũ cho RCSI/snapshot isolation và CDC. "
        "Tăng khi CDC job bị dừng hoặc transaction chạy lâu với snapshot isolation."
    ),
},
```

---

### Topic: `wait_stats` — Wait Statistics Anomaly

```python
alert_description=(
    "Phát hiện wait type tăng bất thường so với baseline cùng giờ cùng ngày trong tuần. "
    "Wait statistics là chỉ số chẩn đoán quan trọng: mỗi wait type chỉ ra loại bottleneck cụ thể "
    "(CPU, disk, lock, memory, network...)."
),
recommendations={
    "wait_time_ms": (
        "Xác định wait type tăng mạnh nhất và tham chiếu ý nghĩa bên dưới. "
        "Mỗi loại wait cần action khác nhau — không có giải pháp chung. "
        "Dùng 🤖 Analyze để chẩn đoán chi tiết hơn với context đầy đủ."
    ),
},
metric_glossary={
    "wait_time_ms": "Tổng thời gian chờ (ms) của wait type này kể từ SQL Server restart hoặc reset.",
    "wait_type": (
        "Loại tài nguyên SQL Server đang chờ. Các wait type phổ biến:\n"
        "• CXPACKET/CXCONSUMER: chờ parallel thread — parallelism skew hoặc MAXDOP chưa tối ưu\n"
        "• PAGEIOLATCH_SH/EX: chờ đọc/ghi disk — I/O bottleneck hoặc thiếu buffer pool\n"
        "• LCK_M_*: chờ lock — blocking/contention\n"
        "• RESOURCE_SEMAPHORE: chờ memory grant — query cần nhiều RAM hơn available\n"
        "• SOS_SCHEDULER_YIELD: CPU overload — quá nhiều runnable task\n"
        "• ASYNC_NETWORK_IO: chờ client fetch kết quả — application-side bottleneck"
    ),
    "deviation_pct": (
        "Độ lệch so với baseline (%): (current - baseline) / baseline × 100. "
        "WARNING nếu tăng > 200% so với cùng giờ cùng ngày trong 4 tuần gần nhất."
    ),
},
```

---

### Topic: `high_variation` — High Variation Query

```python
alert_description=(
    "Phát hiện query có thời gian thực thi không ổn định — lúc nhanh lúc chậm với biên độ lớn. "
    "Nguyên nhân phổ biến: parameter sniffing (plan được cache với parameter không đại diện), "
    "data skew, hoặc contention tài nguyên không đều."
),
recommendations={
    "cv_ratio": (
        "CV > 1.0 (CRITICAL): query hoàn toàn không ổn định. "
        "Kiểm tra xem plan có bị sniff với parameter bất thường không "
        "(sys.dm_exec_cached_plans + sys.dm_exec_query_plan). "
        "Cân nhắc OPTION(RECOMPILE) hoặc optimize for specific parameter. "
        "LƯU Ý: KHÔNG dùng OPTION(OPTIMIZE FOR UNKNOWN) — gây CPU overload khi throughput cao."
    ),
},
metric_glossary={
    "cv_ratio": (
        "Coefficient of Variation (CV): độ lệch chuẩn / trung bình của execution time. "
        "CV = 0 = hoàn toàn ổn định, CV = 1.0 = độ lệch = trung bình (rất không ổn định). "
        "WARNING > 0.5, CRITICAL > 1.0. "
        "Query ổn định: CV < 0.2. CV cao = khó dự đoán latency, SLA risk."
    ),
    "avg_duration_ms": "Execution time trung bình (ms) trong kỳ đo.",
    "stddev_ms": (
        "Standard deviation của execution time: đơn vị đo độ phân tán. "
        "stddev cao + avg thấp = lúc rất nhanh lúc rất chậm."
    ),
    "execution_count": "Số lần query thực thi trong kỳ đo (dùng để đánh giá độ tin cậy của CV).",
},
```

---

### Topic: `plan_regression` — Plan Regression Detector

```python
alert_description=(
    "Phát hiện query vừa có execution plan mới (trong 24h) và plan mới chậm hơn plan cũ đáng kể. "
    "Plan regression thường xảy ra sau: recompile, statistics update, index rebuild, "
    "hoặc thay đổi data volume làm optimizer chọn sai plan."
),
recommendations={
    "pct_worse": (
        "Ưu tiên: (1) so sánh plan cũ và plan mới bằng Plan Analysis. "
        "(2) Nếu plan cũ tốt hơn — pin lại bằng Query Store: "
        "EXEC sys.sp_query_store_force_plan @query_id=?, @plan_id=?. "
        "(3) Tìm nguyên nhân plan đổi: check statistics update history, index change log."
    ),
},
metric_glossary={
    "pct_worse": (
        "Phần trăm plan mới chậm hơn plan cũ: (new_avg_ms - old_avg_ms) / old_avg_ms × 100. "
        "VD: 150% = plan mới chậm gấp 2.5 lần plan cũ."
    ),
    "new_avg_ms": "Execution time trung bình của plan mới (ms).",
    "old_avg_ms": "Execution time trung bình của plan cũ — baseline để so sánh (ms).",
    "new_plan_id": "Plan handle của plan mới trong sys.dm_exec_cached_plans / Query Store.",
},
```

---

### Topic: `plan_instability` — Plan Instability (Parameter Sniffing)

```python
alert_description=(
    "Phát hiện query đang có nhiều execution plan active cùng lúc với hiệu năng chênh lệch lớn. "
    "Đây là dấu hiệu điển hình của parameter sniffing: SQL Server cache plan cho một parameter "
    "nhưng parameter khác chạy với plan không phù hợp."
),
recommendations={
    "worst_best_ratio": (
        "Plan tệ nhất chậm hơn tốt nhất > 10x: cần fix parameter sniffing. "
        "Options theo thứ tự ưu tiên:\n"
        "1. Optimize for hint với parameter đại diện: OPTION(OPTIMIZE FOR (@p = value))\n"
        "2. OPTION(RECOMPILE) nếu throughput thấp (< 10 exec/s)\n"
        "3. Tách stored procedure thành branches theo data range\n"
        "LƯU Ý: KHÔNG dùng OPTIMIZE FOR UNKNOWN — gây CPU spike khi throughput cao."
    ),
    "plan_count": (
        "Nhiều plan active (> 6): query đang recompile liên tục. "
        "Kiểm tra SET STATISTICS_NORECOMPUTE, statistics update frequency."
    ),
},
metric_glossary={
    "worst_best_ratio": (
        "Tỷ lệ plan tệ nhất / plan tốt nhất theo execution time. "
        "WARNING > 5x, CRITICAL > 10x. "
        "Ratio cao = cùng 1 query nhưng hiệu năng chênh lệch rất lớn tùy parameter."
    ),
    "plan_count": (
        "Số execution plan khác nhau đang tồn tại trong cache cho cùng 1 query_hash. "
        "WARNING ≥ 3, CRITICAL ≥ 6. Nhiều plan = instability, memory waste."
    ),
},
```

---

### Topic: `missing_index` — Missing Index Detector

```python
alert_description=(
    "SQL Server phát hiện các truy vấn thực tế cho thấy thiếu index quan trọng. "
    "Improvement measure cao = query này đang full-scan hoặc lookup tốn kém, "
    "và index này sẽ giảm thiểu đáng kể I/O và latency."
),
recommendations={
    "improvement_measure": (
        "Improvement measure > 100,000: ưu tiên cao — tạo index ngay trên staging. "
        "Lưu ý trước khi tạo:\n"
        "1. Review INCLUDE columns — đừng tạo 'kitchen sink' index\n"
        "2. Check index overlap với index hiện có\n"
        "3. Test trên staging với production-like workload\n"
        "4. Monitor tác động đến INSERT/UPDATE/DELETE sau khi deploy"
    ),
},
metric_glossary={
    "improvement_measure": (
        "Improvement measure: điểm ưu tiên do SQL Server tính = "
        "avg_total_user_cost × avg_user_impact × (user_seeks + user_scans). "
        "WARNING > 10,000, CRITICAL > 100,000. "
        "Con số càng cao = index này càng cấp bách, tiết kiệm càng nhiều I/O."
    ),
    "avg_user_impact": (
        "Phần trăm cải thiện ước tính nếu tạo index này (%). "
        "VD: 90% = index sẽ giảm 90% cost của query liên quan."
    ),
    "user_seeks": "Số lần SQL Server muốn dùng index này để seek (tra cứu điểm cụ thể).",
    "user_scans": "Số lần SQL Server muốn dùng index này để scan (quét dải giá trị).",
},
```

---

### Topic: `index_fragmentation` — Index Fragmentation

```python
alert_description=(
    "Phát hiện index bị phân mảnh — các data page không liên tục trên disk. "
    "Fragmentation cao làm tăng I/O vì SQL Server phải đọc nhiều page hơn cần thiết, "
    "đặc biệt ảnh hưởng đến range scan và sequential read."
),
recommendations={
    "fragmentation_pct": (
        "Fragmentation > 30% (CRITICAL): cần REBUILD INDEX ngay (nên làm ngoài giờ cao điểm). "
        "Fragmentation 10–30% (WARNING): dùng REORGANIZE (online, ít lock hơn). "
        "Lưu ý: REBUILD tạo lock lớn hơn REORGANIZE. Dùng ONLINE=ON nếu có Enterprise Edition."
    ),
},
metric_glossary={
    "fragmentation_pct": (
        "Index fragmentation %: tỷ lệ page không liên tục trong index B-tree. "
        "WARNING > 10%, CRITICAL > 30%. "
        "Fragmentation cao = mỗi range scan phải đọc thêm page không cần thiết → I/O tăng."
    ),
    "page_count": (
        "Số page của index. Fragmentation chỉ quan trọng khi page_count > 1,000. "
        "Index nhỏ (< 1,000 page) thường không cần rebuild dù fragmentation cao."
    ),
    "avg_page_space_used_pct": (
        "Mức độ fill của mỗi page (%). Thấp = page chứa ít dữ liệu = nhiều I/O hơn cần. "
        "Liên quan đến FILLFACTOR setting của index."
    ),
},
```

---

### Topic: `agent_maintenance` — SQL Agent & Backup Monitor

```python
alert_description=(
    "Giám sát tính toàn vẹn của các tác vụ bảo trì: SQL Agent jobs, backup, và DBCC CHECKDB. "
    "Job fail hoặc backup gap = nguy cơ mất dữ liệu khi có sự cố. "
    "DBCC overdue = không phát hiện kịp thời corruption."
),
recommendations={
    "hours_since_full": (
        "Full backup gap > 48h: CRITICAL — cần backup ngay. "
        "Kiểm tra job history, disk space, và network path đến backup destination."
    ),
    "mins_since_log": (
        "Log backup gap > 120 phút: RPO (Recovery Point Objective) đang bị vi phạm. "
        "Mỗi phút không backup log = thêm 1 phút data có thể mất khi disaster."
    ),
    "days_since_checkdb": (
        "DBCC CHECKDB > 14 ngày: tăng risk không phát hiện corruption. "
        "Schedule DBCC CHECKDB hàng tuần (chạy ngoài giờ cao điểm, mất vài giờ với DB lớn)."
    ),
    "fail_count_7d": (
        "Job fail nhiều lần trong 7 ngày: xem job history chi tiết để tìm error. "
        "Kiểm tra SQL Agent service account permissions và destination resource."
    ),
},
metric_glossary={
    "hours_since_full": (
        "Số giờ kể từ lần FULL backup gần nhất. WARNING > 24h, CRITICAL > 48h. "
        "Full backup là nền tảng để restore — thiếu full backup không thể restore từ log."
    ),
    "mins_since_log": (
        "Số phút kể từ lần LOG backup gần nhất. WARNING > 60 phút, CRITICAL > 120 phút. "
        "Log backup đảm bảo RPO (mục tiêu khôi phục dữ liệu tối thiểu theo thỏa thuận SLA)."
    ),
    "days_since_checkdb": (
        "Số ngày kể từ lần DBCC CHECKDB gần nhất. WARNING > 7 ngày, CRITICAL > 14 ngày. "
        "DBCC CHECKDB phát hiện page corruption, allocation errors — nếu bỏ qua có thể mất data silently."
    ),
    "fail_count_7d": (
        "Số lần job fail trong 7 ngày gần nhất. WARNING ≥ 1, CRITICAL ≥ 2. "
        "Job fail liên tục = vấn đề hệ thống, không phải lỗi nhất thời."
    ),
},
```

---

### Topic: `resource_governor` — Resource Governor Pool

```python
alert_description=(
    "Resource Governor CPU pool đang sử dụng gần hoặc chạm giới hạn cấu hình. "
    "Khi pool chạm max_cpu_percent, các query trong pool sẽ bị throttle — "
    "latency tăng cho user thuộc workload group đó trong khi CPU tổng có thể vẫn còn trống."
),
recommendations={
    "pct_of_max_cpu": (
        "Pool dùng > 95% CPU quota: query đang bị throttle. "
        "Xác định session tốn CPU nhất trong pool (metrics.top_sessions). "
        "Short-term: tăng tạm max_cpu_percent. Long-term: tối ưu query hoặc re-balance workload group."
    ),
    "blocked_task_count": (
        "Blocked tasks trong pool > 20: scheduler saturation. "
        "Giảm MAXDOP cho workload group hoặc review query parallelism."
    ),
},
metric_glossary={
    "pct_of_max_cpu": (
        "Phần trăm CPU đã dùng so với max_cpu_percent được cấu hình trong Resource Governor pool. "
        "WARNING > 80%, CRITICAL > 95%. "
        "Đây KHÔNG phải CPU tổng server — pool có thể 100% quota trong khi server CPU 30%."
    ),
    "max_cpu_percent": "Giới hạn CPU tối đa (%) được cấu hình cho pool này trong Resource Governor.",
    "blocked_task_count": (
        "Số worker thread đang blocked trong pool này. "
        "WARNING ≥ 5, CRITICAL ≥ 20. Cao = scheduler không đủ thread để phục vụ request."
    ),
},
```

---

## 5. Alert Format — `telegram_notifier.py`

### Format mới (thêm description + recommendation + glossary)

```
🔴 CRITICAL — slow_sessions
━━━━━━━━━━━━━━━━━━━━━━
🖥 Node:   <code>10.x.x.1</code> (Primary)
📋 Topic:  <code>slow_sessions</code>
🕐 Time:   2026-05-28 10:30:15 +07

📌 <b>Vấn đề:</b>
<blockquote>Phát hiện query đang chạy quá lâu trên server. Query chậm chiếm CPU và lock tài nguyên, có thể gây blocking cho các phiên khác.</blockquote>

📊 <b>Metrics:</b>
  • elapsed_seconds: <code>420</code>
  • session_id: <code>58</code>
  • wait_type: <code>LCK_M_S</code>

💡 <b>Khuyến nghị:</b>
<blockquote>Kiểm tra query text và execution plan. Nếu > 300s và không có lý do hợp lệ — cân nhắc KILL SESSION. Dùng ⚡ Quick để phân tích nhanh.</blockquote>

📖 <b>Giải thích metric:</b>
  • <b>elapsed_seconds</b>: Thời gian query đã chạy (giây). WARNING > 30s, CRITICAL > 300s.
  • <b>wait_type</b>: LCK_M_* = chờ lock. Có thể đang bị blocking.

🔗 ID: <code>abc12345</code>
```

### Logic trong code:

```python
def _build_alert_text(self, finding: Finding, topic: MonitorTopic) -> str:
    # 1. Header (giữ nguyên)
    # 2. THÊM: description từ topic.alert_description (nếu có)
    # 3. Metrics (giữ nguyên)
    # 4. THÊM: recommendation từ topic.recommendations[triggered_field] (nếu có)
    # 5. THÊM: glossary chỉ cho các metric key có trong finding.metrics
    #          (tránh spam — chỉ show glossary của metric được trigger)
```

**Nguyên tắc:**
- Glossary: chỉ show entry cho metric nào có trong `finding.metrics` **VÀ** đã trigger threshold
- Recommendation: lấy từ `topic.recommendations[triggered_field]` — field nào vượt threshold thì show recommendation đó
- Nếu topic không có field mới → alert giữ nguyên format cũ (backward compatible)

---

## 6. Capture Tools — Tiếng Việt

`seed_capture_tools.py` — cập nhật `display_name` và `description`:

| tool_id | display_name (mới) | description (mới) |
|---|---|---|
| `get_blocking_chain` | Chuỗi Blocking | Chuỗi blocking hiện tại từ sys.dm_exec_requests — xác định head blocker và độ sâu chain |
| `get_wait_stats` | Thống Kê Wait | Top wait types — so sánh với baseline cùng giờ để phát hiện bất thường |
| `get_memory_grant` | Memory Grant Queue | Danh sách query đang chờ được cấp workspace memory |
| `get_tempdb_usage` | Sử Dụng TempDB | Dung lượng và phần trăm sử dụng TempDB (version store, user objects, internal) |
| `get_ag_status` | Trạng Thái AG | Sức khỏe đồng bộ Always On AG — log send queue, redo queue, sync state |
| `get_memory_pressure` | Áp Lực Bộ Nhớ | Tóm tắt memory pressure từ PLE, memory clerks, pending grants |
| `get_resource_governor_stats` | Thống Kê Resource Governor | CPU utilization và blocked task count theo từng pool |
| `get_cdc_status` | Trạng Thái CDC | Trạng thái CDC capture/cleanup job — phát hiện job bị dừng |
| `get_missing_indexes` | Index Còn Thiếu | Gợi ý index từ SQL Server với improvement measure và impact % |
| `get_query_stats` | Thống Kê Query | Runtime statistics theo query_hash từ sys.dm_exec_query_stats |
| `get_query_store_history` | Lịch Sử Query Store | Lịch sử thực thi theo query_hash từ Query Store — so sánh plan regression |
| `get_index_usage` | Sử Dụng Index | Usage stats của index trên bảng cụ thể (seeks, scans, lookups, updates) |
| `get_statistics_info` | Thông Tin Statistics | Metadata và độ tươi mới của statistics — phát hiện statistics stale |
| `get_plan_analysis` | Phân Tích Execution Plan | Parse query_plan_xml — operators, warnings, missing index, implicit conversion |
| `get_query_structure` | Cấu Trúc Query | Parse SQL text — bảng, joins, predicates, subquery pattern |
| `get_table_context` | Context Bảng Dữ Liệu | Khớp bảng bị ảnh hưởng với db_context — business context, volume, criticality |
| `get_recent_findings` | Findings Gần Đây | Findings trong 24h gần nhất cùng node/issue_type — phát hiện pattern lặp |
| `get_analysis_history` | Lịch Sử Phân Tích | Tóm tắt insight tái diễn theo issue_type/node — xu hướng dài hạn |

---

## 7. Thứ Tự Implementation

```
Phase 1 — Model & Schema (không break existing)
  [ ] findings.py: thêm field description: str = "", recommendation: str = ""
  [ ] MonitorTopic model: thêm alert_description, recommendations, metric_glossary

Phase 2 — Seed Data Update
  [ ] seed_topics.py: điền alert_description + recommendations + metric_glossary cho 14 topics
      (nội dung tiếng Việt từ Section 4 ở trên)
  [ ] seed_capture_tools.py: cập nhật display_name + description tiếng Việt
  [ ] Re-run seed script để update MongoDB

Phase 3 — Detector Enhancement
  [ ] threshold_detector.py: populate finding.description + finding.recommendation
      từ topic.alert_description và topic.recommendations[triggered_field]
  [ ] baseline_detector.py: tương tự

Phase 4 — Alert Format Update
  [ ] telegram_notifier.py: thêm block "Vấn đề" + "Khuyến nghị" + "Giải thích metric"
      Logic: chỉ show glossary cho metric đã trigger threshold (không show tất cả)
      Backward compatible: nếu field rỗng thì skip block đó

Phase 5 — QA
  [ ] Test với từng topic — verify alert Telegram hiển thị đúng tiếng Việt, không mojibake
  [ ] Verify description + recommendation không vượt Telegram message limit (4096 chars)
      → nếu quá dài thì truncate recommendation, ẩn glossary
```

---

## 8. Definition of Done

- [ ] Không có mojibake trong bất kỳ alert Telegram nào
- [ ] Mọi alert có block "📌 Vấn đề" bằng tiếng Việt
- [ ] Mọi alert CRITICAL/WARNING có block "💡 Khuyến nghị" bằng tiếng Việt
- [ ] Metric được trigger có giải thích trong "📖 Giải thích metric"
- [ ] Các thuật ngữ kỹ thuật (`cv_ratio`, `ple_sec`, `pct_of_max_cpu`...) được giải thích trong context alert — không hiển thị raw
- [ ] Capture tool display_name hiển thị tiếng Việt trong Layer 3 UI
- [ ] Re-seed không mất data hiện có (chỉ upsert, không drop collection)
