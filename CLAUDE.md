# CLAUDE.md — AI-Automation-MSSQL

## Project Overview

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**:

- **1 Primary** + **2 Secondary** nodes — roles auto-detected, không hardcode
- **CDC** (Change Data Capture) enabled
- **Resource Governor** với nhiều pools/workload groups
- **Partition tables** theo ngày/tháng

Kiến trúc 2 layer:
- **Layer 1** (`layer1/`): Python monitoring service — config-driven, generic executor ✅ Implemented
- **Layer 2** (on-demand via Telegram bot): Claude API phân tích findings khi user yêu cầu `/analyze`

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
├── detectors/                 ← Registry pattern: threshold, baseline
├── storage/                   ← MongoDB repositories
├── job_manager/               ← Job execution tracking + health check
├── notifications/             ← Alert channels (Telegram, Teams)
└── ai/                        ← Claude API integration (on-demand analysis)
```

Xem `layer1/CLAUDE.md` cho chi tiết đầy đủ từng module, code rules, constraints.

## Deployment

Docker Compose — build machine tạo image, server chỉ cần `docker-compose.yml` + `.env`:

```bash
# Build & push
docker build -t longdt/ai-automation-mssql:vX.X.X -t longdt/ai-automation-mssql:latest .
docker push longdt/ai-automation-mssql:vX.X.X && docker push longdt/ai-automation-mssql:latest

# Server
docker compose pull layer1 && docker compose up -d layer1
```

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
# MSSQL — comma-separated IPs (không dùng hostname trong Docker)
MSSQL_NODES=10.x.x.1,10.x.x.2,10.x.x.3
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=secret
MONGODB_URI=mongodb://mongodb:27017   # "mongodb" = service name trong docker-compose
MONGODB_DB=db_monitor
NODE_ROLE_REFRESH_SEC=3600

# Notifications (để trống = không gửi)
TEAMS_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# AI on-demand analysis (cần cho /analyze command)
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

---

## Plan Document

Roadmap chi tiết: `plan/bubbly-snuggling-brooks.md`
