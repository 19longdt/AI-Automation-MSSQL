# CLAUDE.md — AI-Automation-MSSQL

## Project Context

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**:

- **1 Primary node** (SQL-NODE-01): ghi + đọc, nguồn chính của Query Store
- **2 Secondary nodes** (SQL-NODE-02, SQL-NODE-03): Readable Secondary, AG sync target
- **CDC** (Change Data Capture) enabled trên Primary — ảnh hưởng đến TempDB version store
- **Resource Governor** với nhiều pools/workload groups — cần monitor CPU per pool
- **Partition tables** theo ngày/tháng — cần detect partition elimination failure

Kiến trúc 2 layer:
- **Layer 1** (`layer1/`): Python monitoring service — thu thập metrics, phát hiện issues, ghi MongoDB
- **Layer 2** (chưa implement): AI Agent dùng Claude API — phân tích issues từ Layer 1, đề xuất fix

---

## Layer 1 — Entry Point & Structure

```
layer1/
├── scheduler.py          ← Entry point: python -m layer1.scheduler
├── config.py             ← Tất cả config/thresholds dùng Pydantic Settings
├── models/               ← Pydantic data models dùng xuyên suốt service
├── job_manager/          ← Leader Election + job execution tracking
├── collectors/           ← Thu thập raw data từ MSSQL (per-node)
├── plan_parser/          ← XML execution plan analyzer (lxml)
├── detectors/            ← Business logic: raw data → findings
├── storage/              ← MongoDB repositories
└── notifications/        ← Alert channels (Teams, Slack, Telegram)
```

---

## Code Rules — BẮT BUỘC

### R1 · Type Hints — Full annotation trên mọi function/method

```python
# ĐÚNG
def collect(self, node: NodeConfig) -> list[RawMetric]:
    ...

# SAI — không có type hints
def collect(self, node):
    ...
```

### R2 · Pydantic Models — Dùng cho mọi data structure truyền giữa modules

- Collector output → `list[RawMetric]` (Pydantic)
- Finding → `Finding` (Pydantic)
- Config → `Settings` (Pydantic Settings)
- **KHÔNG** dùng raw `dict` cho data flow giữa modules
- **KHÔNG** dùng `dataclass` khi Pydantic phù hợp hơn

### R3 · Thread Safety — MSSQL connections

```python
# pyodbc connection KHÔNG thread-safe → tạo mới per-job, KHÔNG share
# ĐÚNG: mỗi job/thread tạo connection riêng qua context manager
with mssql_connection(node) as conn:
    rows = conn.execute(sql).fetchall()

# SAI: share connection giữa các threads
self.conn = pyodbc.connect(...)  # class-level → race condition
```

- `MongoClient` của pymongo: thread-safe, dùng singleton toàn service
- APScheduler jobs: set `max_instances=1` để tránh overlap

### R4 · Error Handling — Phân tầng rõ ràng

| Tình huống | Xử lý |
|---|---|
| MSSQL node unreachable | Log ERROR, mark node unhealthy, **return `[]`**, không crash |
| Query timeout | Log WARNING, return `[]` |
| MongoDB unavailable | Log CRITICAL, retry với exponential backoff |
| Config thiếu required key | `raise ValueError` ngay khi startup (fail fast) |
| Collector bất kỳ exception | Log ERROR với traceback, return `[]`, scheduler tiếp tục |

### R5 · Logging — Structured với context đầy đủ

```python
import logging
logger = logging.getLogger(__name__)

# ĐÚNG — có context, dễ grep/filter
logger.warning("Slow query detected", extra={
    "node": "SQL-NODE-01",
    "query_hash": "0xABCD",
    "avg_ms": 1500,
    "baseline_ms": 80,
    "pct_increase": 1775,
})

# SAI — không có context
logger.warning(f"Slow query on SQL-NODE-01")
```

### R6 · Comments — Giải thích WHY (không giải thích WHAT)

```python
# ĐÚNG — giải thích lý do business/kỹ thuật
# Dùng day-of-week aware baseline thay vì rolling 7-day average vì workload
# có pattern theo ngày (Thứ Hai cao điểm, Chủ Nhật thấp) → rolling average
# tạo false positives vào giờ cao điểm đầu tuần.

# Không bao giờ gợi ý OPTION(OPTIMIZE FOR UNKNOWN) — đã xác nhận gây CPU
# overload khi throughput cao: optimizer dùng average statistics dẫn đến
# suboptimal plan cho phần lớn workload thực tế của hệ thống này.

# SAI — chỉ mô tả code đang làm gì (self-documenting code không cần comment)
# Loop through all queries and check duration against threshold
```

### R7 · Performance — DMV Queries

- Tất cả DMV queries **bắt buộc** có `TOP N` hoặc `WHERE` giới hạn thời gian
- `sys.dm_exec_query_stats`: không query không giới hạn (có thể 100k+ rows)
- Timeout mặc định per query: **30 giây** (configurable qua `MSSQL_QUERY_TIMEOUT_SEC`)
- Mỗi collector chạy **parallel per node** dùng `ThreadPoolExecutor`
- Raw metrics batch write vào MongoDB dùng `insert_many`

### R8 · APScheduler — Job isolation

```python
# Mọi job function phải idempotent — chạy lại không tạo duplicate
# max_instances=1 tránh overlap khi job chạy lâu hơn interval
# coalesce=True bỏ qua missed runs thay vì chạy bù hàng loạt
scheduler.add_job(
    func=run_slow_query_check,
    trigger="interval",
    minutes=5,
    max_instances=1,
    coalesce=True,
    id="slow_query_check",
)
```

### R9 · MongoDB Writes

- `insert_one` cho findings (mỗi finding cần được log riêng)
- `insert_many` cho raw_metrics (batch để tối ưu throughput)
- `update_one` với `upsert=True` cho baselines và dedup_cache
- Tất cả writes phải có error handling — MongoDB unavailable không được crash collector

### R10 · Imports — Tổ chức theo thứ tự

```python
# 1. stdlib
from __future__ import annotations
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

# 2. third-party
import pyodbc
from pydantic import BaseModel, Field

# 3. internal (relative imports trong cùng package)
from ..models.findings import Finding, Severity
from ..config import Settings
```

---

## Monitors & Schedule

| Monitor | Tần suất | Nodes | Mô tả |
|---|---|---|---|
| Query Problem (1.1.1–1.1.6) | 5 phút | Tất cả | QS + DMV checks |
| Blocking & Deadlock (1.1.7) | 1 phút | Tất cả | Chain structure + deadlock |
| TempDB & Memory (1.1.8) | 5 phút | Primary | TempDB usage, PLE |
| Wait Statistics (1.1.9) | 5 phút | Tất cả | Snapshot diff vs baseline |
| SQL Agent / Maintenance (1.1.10) | 10 phút | Primary | Jobs, backup, DBCC |
| Blocked Query Detector (1.1.11) | 1 phút | Tất cả | Snapshot + 7-day trend |
| AG Health + CDC (1.2) | 2 phút | Primary | AG sync, CDC jobs |
| Index Fragmentation (1.3) | Daily 03:00 | Tất cả | Fragmentation scan |
| Missing Index (1.4) | 1 giờ | Tất cả | DMV missing index |
| Resource Governor (1.5) | 5 phút | Primary | Pool CPU usage |

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Leader Election** thay vì distributed lock per-job | Khi 2 instance tốc độ tiệm cận, per-job lock gây contention liên tục; leader election chỉ cần 1 heartbeat/10s cho toàn cluster |
| **Day-of-week baseline** thay vì rolling 7-day average | Workload khác nhau theo ngày trong tuần → rolling avg tạo false positives |
| **MongoDB** thay vì SQLite | Schema linh hoạt; TTL index tự cleanup; JSON-native cho AI output |
| **Pydantic** cho data models | Type safety giữa modules; validation miễn phí; tự document schema |
| **`OPTION(OPTIMIZE FOR UNKNOWN)`** KHÔNG được gợi ý bao giờ | Test thực tế: gây CPU overload khi throughput cao vì optimizer dùng average statistics → suboptimal plan cho majority workload |
| **All nodes** cho 1.1 checks | Secondary Readable có workload riêng — slow query trên Secondary cũng cần detect |
| **Parallel per node** trong collectors | 3 nodes × query time → sequential sẽ triple latency của mỗi job run |

---

## MongoDB Collections

| Collection | TTL | Mục đích |
|---|---|---|
| `raw_metrics` | 30 ngày | Số liệu thô từ DMV mỗi lần collector chạy |
| `findings` | 90 ngày | Issues đã phân loại, kèm plan_patterns |
| `ai_analysis` | 90 ngày | Response từ Claude API (Layer 2) |
| `approval_queue` | Không xóa | Non-SELECT actions chờ admin duyệt |
| `audit_log` | Không xóa | Toàn bộ actions đã thực thi |
| `baselines` | Không xóa | Day-of-week aware baseline per metric_type/hour |
| `dedup_cache` | 7 ngày | Chống spam alert cùng finding |
| `cluster_leader` | TTL 30s | Leader Election singleton document |
| `job_executions` | 30 ngày | Job run history: status, duration, records |

---

## Environment Variables

```env
# MSSQL
MSSQL_NODE_PRIMARY=SQL-NODE-01
MSSQL_NODE_SECONDARY_1=SQL-NODE-02
MSSQL_NODE_SECONDARY_2=SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=secret
MSSQL_QUERY_TIMEOUT_SEC=30

# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor

# Notification
NOTIFY_CHANNELS=teams
TEAMS_WEBHOOK_URL=https://...

# AI (Layer 2 — chưa dùng ở Layer 1)
CLAUDE_API_KEY=sk-ant-...
```

Xem `layer1/config.py` cho danh sách đầy đủ tất cả config params và default values.
