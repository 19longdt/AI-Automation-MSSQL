# CLAUDE.md — AI-Automation-MSSQL

## Project Overview

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**:

- **1 Primary** + **2 Secondary** nodes — roles auto-detected, không hardcode
- **CDC** (Change Data Capture) enabled
- **Resource Governor** với nhiều pools/workload groups
- **Partition tables** theo ngày/tháng

Kiến trúc 3 layer:
- **Layer 1** (`layer1/`): Python monitoring service — config-driven, generic executor ✅ Implemented
- **Layer 2** (`layer2/`): FastAPI + Claude AI + Telegram bot — on-demand analysis khi user yêu cầu `/analyze` ✅ Implemented
- **Layer 3** (`layer3/`): Web UI — dashboard, insights, query plan visualization (Node.js/TypeScript + nginx) ✅ Implemented
- **Maintenance** (`layer1/maintenance/`): Index/statistics maintenance runner — PROCESS RIÊNG cùng image layer1 ✅ Implemented (xem `plan/index-statistics-maintenance.md`)

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
├── detectors/                 ← Registry pattern: threshold, baseline, plan_analysis, blocking_chain
├── storage/                   ← MongoDB repositories
├── job_manager/               ← Job execution tracking + health check
├── notifications/             ← Alert channels (Telegram, Teams) + Telegram bot (/quick)
├── ai/                        ← Claude API integration (PlanAnalyzer — on-demand /quick)
├── seed/                      ← Seed monitor_topics vào MongoDB (chạy 1 lần khi setup)
└── utils/                     ← time_utils (now_vn, utc_now)
```

Xem `layer1/CLAUDE.md` cho chi tiết đầy đủ từng module, code rules, constraints.

### Maintenance Runner (`layer1/maintenance/` — process riêng)

```
layer1/maintenance/
├── runner.py                  ← Entry: python -m layer1.maintenance.runner
├── config.py                  ← MAINT_* env vars (cron, tick, DRY_RUN, max attempts)
├── connection.py              ← maint_connection: autocommit, KHÔNG statement timeout
├── models/                    ← policy, work_item (queue lifecycle), window, history, approval
├── scan/                      ← Scan frag/stats/heap → enqueue work items → batch approval
├── policy/                    ← PolicyResolver: merge default ← table ← index (field-level)
├── window/                    ← WindowService: window VN-time + budget, hỗ trợ qua đêm
├── safety/                    ← Gates: CPU, active load, AG redo/send queue — fail = không chạy
├── execute/                   ← statement_builder (T-SQL), execute_service (tick loop),
│                                 duration_estimator (admission control)
├── notify/                    ← MaintenanceNotifier (Telegram SEND-ONLY — KHÔNG poll getUpdates),
│                                 MaintenanceApprovalAdapter (chạy trong process monitoring)
├── repositories/              ← maintenance_policies/_window/_queue/_batches/_history
└── seed/seed_maintenance.py   ← Seed default policy + window (chạy trước lần đầu)
```

**Flow:** scan (cron tối) → Telegram batch approval (DBA bấm ✅/⛔) → execute tick (60s)
trong window đêm: gates → claim theo priority → REORGANIZE/REBUILD ONLINE RESUMABLE/
UPDATE STATS → `maintenance_history` (AI context). SIGTERM → PAUSE resumable rebuild.

**Quan trọng:** 2 process KHÔNG cùng poll 1 Telegram token — approval callback
(`l1|mntb|...`, `l1|mnti|...`) do bot của process monitoring xử lý, ghi MongoDB.

---

## Layer 2 — Structure

```
layer2/
├── main.py                    ← FastAPI app entry point
├── config.py                  ← Layer2Settings (env vars)
├── plan/                      ← Execution plan analysis engine (pure Python, no AI)
│   ├── service.py             ← PlanAnalysisService: parse XML + run all analyzers
│   ├── models/result.py       ← Finding, FindingInstance, FindingGroup, StatementResult, ...
│   ├── parser/                ← plan_parser, statement_parser, operator_parser, index_parser
│   └── analyzers/             ← 10 analyzers: operator, index, memory, wait, stats, ...
├── analysis/                  ← Pipeline abstraction (AnalysisPipeline, ToolSnapshot, registry)
│   └── plan/pipeline.py       ← PlanAnalysisPipeline → PlanAnalysisOutput (Layer 3) + ToolSnapshot (Layer 1)
├── agent/                     ← AgentOrchestrator, SkillLoader, ContextBuilder, ToolRegistry, ToolExecutor
├── executor/                  ← DiagnosticExecutor, plan_analyzer, query_analyzer, node_role_cache
├── models/                    ← AnalysisRequest/Result, InsightData, AnalysisSkill
├── storage/                   ← MongoDB repositories (ai_analyses, issue_insights, db_context, sessions)
├── notifications/             ← TelegramBot (/analyze + multi-turn reply + send_analysis_result)
├── api/routes/                ← analysis, plan (/api/v1/plan/analyze), insights, skills, admin, health
├── skills/                    ← 14 YAML skill files (_base + 13 issue-specific)
├── utils/                     ← time_utils, peak_hours, cost_calculator
└── db_business_context.yaml   ← DBA-written schema/pattern context
```

Xem `layer2/CLAUDE.md` và `layer2/AGENT_MECHANISM.md` cho chi tiết đầy đủ.

---

## Layer 3 — Structure

```
layer3/
├── apps/api/                  ← Express.js backend (proxy + data aggregation)
│   └── src/                   ← routes (findings, analyses, insights, plan, topics, jobs), services
├── apps/web/                  ← Frontend: dashboard.html, insights.html, query-plan.html
│   ├── css/                   ← base.css (+CSS vars), dashboard.css, plan-analysis.css, ...
│   └── dashboard/             ← TypeScript: dashboard.ts, plan-analysis-component.ts,
│                                 glossary.ts (70+ entries), glossary-tooltip.ts, modal, loading
└── packages/core/src/types/   ← Shared TypeScript types (plan-analysis.ts mirrors Python models)
```

Xem `layer3/CLAUDE.md` cho chi tiết đầy đủ component, CSS architecture, design decisions.

## Deployment

Docker Compose — build machine tạo image, server chỉ cần `docker-compose.yml` + `.env`:

```bash
# Build & push (build.sh / build.ps1)
docker build -t 19longdt/ai-automation-mssql:vX.X.X -t 19longdt/ai-automation-mssql:latest .
docker push 19longdt/ai-automation-mssql:vX.X.X && docker push 19longdt/ai-automation-mssql:latest

# Server — pull và restart từng layer độc lập
docker compose pull layer1 && docker compose up -d layer1
docker compose pull layer2 && docker compose up -d layer2
docker compose pull layer3 && docker compose up -d layer3
```

Dockerfile riêng: `Dockerfile` (layer1), `Dockerfile.layer2` (layer2), `Dockerfile.combined` (combined build).

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

Chi tiết đầy đủ xem `.env.example`. Tóm tắt:

```env
# === Layer 1 (.env) ===
MSSQL_NODES=10.x.x.1,10.x.x.2,10.x.x.3   # comma-separated IPs (không dùng hostname)
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=secret
MONGODB_URI=mongodb://mongodb:27017          # "mongodb" = service name trong docker-compose
MONGODB_DB=db_monitor
NODE_ROLE_REFRESH_SEC=3600

# Notifications (để trống = không gửi)
TEAMS_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=                         # Layer 1 bot token
TELEGRAM_CHAT_ID=

# Claude API — Layer 1 /quick command (Haiku)
CLAUDE_API_KEY=sk-ant-...
HAIKU_MODEL=claude-haiku-4-5-20251001

# Layer 2 forward URL
LAYER2_URL=http://layer2:8000

# Logging
LOG_LEVEL=INFO
LOGSTASH_HOST=                              # để trống = disable centralized logging
LOGSTASH_PORT=5044

# === Layer 2 (.env.layer2.example) ===
L2_TELEGRAM_BOT_TOKEN=                      # Layer 2 bot token (khác với Layer 1)
CLAUDE_MODEL=claude-sonnet-4-6
```

---

## Plan Document

Roadmap chi tiết: `plan/bubbly-snuggling-brooks.md`

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
