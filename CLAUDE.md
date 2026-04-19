# CLAUDE.md — AI-Automation-MSSQL

## Project Overview

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**:

- **1 Primary** + **2 Secondary** nodes — roles auto-detected, không hardcode
- **CDC** (Change Data Capture) enabled
- **Resource Governor** với nhiều pools/workload groups
- **Partition tables** theo ngày/tháng

Kiến trúc 2 layer:
- **Layer 1** (`layer1/`): Python monitoring service — config-driven, generic executor
- **Layer 2** (chưa implement): AI Agent dùng Claude API — phân tích findings, đề xuất fix

---

## Architecture — Config-Driven

**SQL queries, thresholds, schedule intervals** cấu hình hoàn toàn trong MongoDB `monitor_topics`. Python app chỉ là generic executor:

```
MongoDB monitor_topics (config)
    │
    ▼
scheduler.py → register 1 APScheduler job per topic
    │
    ▼ mỗi job run
topic_runner.run(topic_id):
    1. Reload topic config từ MongoDB
    2. Resolve node targets ("primary"/"secondary"/"all") từ role cache
    3. Execute queries parallel per node
    4. Save raw_metrics
    5. Run detector (threshold / baseline / plan_analysis / blocking_chain)
    6. Save findings → dedup → notify
```

**Thêm/sửa query hoặc threshold** trong MongoDB → có hiệu lực ngay lần chạy kế tiếp, KHÔNG cần redeploy.

---

## Layer 1 — Structure

```
layer1/
├── scheduler.py               ← Entry: python -m layer1.scheduler
├── config.py                  ← EnvSettings (connections, credentials only)
├── models/                    ← Pydantic models
├── executor/                  ← Generic SQL executor + node role cache
├── detectors/                 ← Registry pattern: threshold, baseline, plan, blocking
├── storage/                   ← MongoDB repositories
├── job_manager/               ← Job execution tracking + health check
└── notifications/             ← Alert channels
```

Xem `layer1/CLAUDE.md` cho chi tiết đầy đủ từng module, code rules, constraints.

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Config-driven** (queries/thresholds trong MongoDB) | Thêm/sửa không cần redeploy code |
| **Node role auto-detect** + cache refresh/giờ | AG failover transparent |
| **Standalone single-instance** | Đơn giản; không cần leader election |
| **Day-of-week baseline** | Workload pattern khác nhau theo ngày |
| **Detector registry** | Thêm detector type = 1 class, không sửa code cũ |
| **`OPTION(OPTIMIZE FOR UNKNOWN)` KHÔNG gợi ý** | Gây CPU overload khi throughput cao |

---

## Environment Variables

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=secret
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor
NODE_ROLE_REFRESH_SEC=3600
TEAMS_WEBHOOK_URL=https://...
```

---

## Plan Document

Roadmap chi tiết: `plan/bubbly-snuggling-brooks.md`
