# CLAUDE.md — AI-Automation-MSSQL

## Project Overview

Hệ thống tự động giám sát và phân tích sự cố cho **nhiều cụm MSSQL Server 2019 Enterprise Always On Availability Groups** (multi-cluster):

- Mỗi cụm: **1 Primary** + **2 Secondary** nodes — roles auto-detected, không hardcode
- **CDC** (Change Data Capture) enabled
- **Resource Governor** với nhiều pools/workload groups
- **Partition tables** theo ngày/tháng
- Cụm được quản lý qua MongoDB `db_clusters` — thêm/bật/tắt cụm không cần redeploy

Kiến trúc 3 layer + 1 process maintenance độc lập:
- **Layer 1** (`layer1/`): Python monitoring service — config-driven, generic executor ✅ Implemented
- **Layer 2** (`layer2/`): FastAPI + Claude AI + Telegram bot — on-demand analysis khi user yêu cầu `/analyze` ✅ Implemented
- **Layer 3** (`layer3/`): Web UI — dashboard, insights, query plan, **maintenance** (React SPA `web-v2` + Fastify API) ✅ Implemented
- **Maintenance** (`maintenance/` — **package độc lập ở root**): Catalog → Campaign → Discovery → Execute runner. Process riêng, image riêng (`python -m maintenance.runner`). ✅ Implemented — xem `maintenance/CLAUDE.md` + `maintenance/ARCHITECTURE.md`
---

## Architecture — Config-Driven

**SQL queries, thresholds, schedule intervals** cấu hình hoàn toàn trong MongoDB `monitor_topics`. Python app chỉ là generic executor:

```
MongoDB db_clusters (cluster config) + monitor_topics (topic config)
    │
    ▼
scheduler.py → register 1 APScheduler job per (cluster_id, topic_id)
    │               APScheduler ThreadPoolExecutor(max_workers=50)
    ▼ mỗi job run
topic_runner.run(topic_id):           [per cluster — cụm lỗi không ảnh hưởng cụm khác]
    1. Reload topic config từ MongoDB
    2. Resolve node targets ("primary"/"secondary"/"all") từ role cache của cluster đó
    3. Execute queries parallel per node
    4. Save raw_metrics
    5. Run detector (threshold / baseline / plan_analysis / blocking_chain)
    6. Save findings (kèm cluster_id) → dedup → notify
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

## Maintenance Runner (`maintenance/` — package độc lập ở root, process riêng)

```
maintenance/
├── runner.py                  ← Entry: python -m maintenance.runner — APScheduler bootstrap
├── config.py                  ← MaintEnvSettings (MAINT_* cron/tick/DRY_RUN, telegram, logstash)
├── indexes.py                 ← MongoDB index + TTL setup
├── catalog/catalog_service.py ← SNAPSHOT scope (db/schema/table) → maintenance_catalog (per-partition frag, stats, heap)
├── discovery/discovery_service.py ← Catalog snapshot → maintenance_queue work items (per campaign)
├── execute/                   ← execute_service (tick loop), statement_builder (T-SQL), duration_estimator
├── policy/policy_resolver.py  ← Merge default ← table ← index (CHỈ execution params: maxdop/online/resumable/enabled)
├── window/window_service.py   ← Window VN-time + budget, hỗ trợ qua đêm
├── safety/                    ← gate_service (CPU/active load/AG redo-send queue), health_monitor (auto-pause)
├── notify/                    ← MaintenanceNotifier (impl MaintenanceEventPublisher), MaintenanceBot
│                                 (poll callback ✅/⛔), notify_queue (async send), approval_adapter
├── infra/                     ← MongoConnection, mssql_connection, cluster_reader, node_role_cache,
│                                 job_runner (job_executions audit), health_checker, time_utils
├── models/                    ← catalog, campaign, thresholds, work_item, policy, window, history,
│                                 approval, command, job, scan_query
├── repositories/              ← catalog_config / catalog / campaign / queue / batch / history /
│                                 policy / window / command repos
└── seed/seed_maintenance.py   ← Seed default policy + window (chạy 1 lần trước go-live)
```

**Pipeline (4 job/cluster + 2 job global):**
`Catalog` (cron, mặc định 06:00 — snapshot scope vào `maintenance_catalog`) → DBA tạo **Campaign** qua Layer 3 (scope theo bảng + ngưỡng theo execution type + window override) → `Discovery` (mỗi 60s, chỉ chạy đúng `scan_times` campaign — sinh `maintenance_queue` từ catalog snapshot mới nhất; **1 work item / partition vượt ngưỡng**) → Telegram batch approval (DBA bấm ✅/⛔) → `Tick` (60s, trong window đêm: gates → claim theo priority → REORGANIZE / REBUILD [PARTITION] ONLINE RESUMABLE / UPDATE STATS / HEAP REBUILD → `maintenance_history`) → `Summary` (cron sáng). SIGTERM → PAUSE resumable rebuild.

**Re-discovery hằng ngày:** campaign ACTIVE tự re-discover theo `last capture` mỗi `scan_times` — capture mới supersede các item chưa execute (status `superseded`); KHÔNG chạy lại catalog cũ.

**Ngưỡng = cấp Campaign (không phải catalog/policy):** `CampaignThresholds` nhóm theo `index` / `statistic` / `heap`; field để trống → kế thừa default policy. Discovery resolve thành `EffectiveThresholds` (phẳng) để quyết định REORGANIZE vs REBUILD. **Catalog scope = đo lường thuần** (capture cái gì); **Campaign = ý định hành động** (làm gì, ngưỡng nào, bảng nào).

**IPC với Layer 3 = MongoDB-only (runner KHÔNG có HTTP):** Layer 3 ghi config/campaign/command vào MongoDB; runner poll. Manual trigger qua collection `maintenance_commands` (`run_catalog` / `run_discovery`) — job `command_poll` (30s) claim → route tới trigger in-process (lock-backed, không chạy song song cùng cluster). Approval callback do `MaintenanceBot` của chính process maintenance xử lý.

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
├── apps/api/                  ← Fastify backend (proxy + MongoDB reads/writes + JSON-schema validation)
│   └── src/
│       ├── routes/            ← findings, analyses, insights, plan, topics, jobs, clusters, actions,
│       │                         maintenance, catalog, campaigns
│       ├── services/          ← *-service.ts (findings, maintenance, catalog, campaign, command, ...)
│       ├── schemas/           ← *.schema.ts (Fastify JSON Schema: maintenance, campaigns, ...)
│       ├── proxy/l2-proxy.ts  ← Proxy /api/v1/* sang Layer 2
│       └── db/collections.ts  ← Typed MongoDB collection accessors
├── apps/web-v2/               ← Frontend SPA: React + Vite + TypeScript + React Query + Zustand + shadcn/ui
│   └── src/
│       ├── pages/             ← DashboardPage, InsightsPage, QueryPlanPage, SettingsPage,
│       │                         MaintenanceCampaignPage, MaintenanceCatalogPage
│       ├── components/        ← dashboard/, insights/, plan/, maintenance/, layout/, shared/, ui/
│       ├── hooks/             ← useFindings, useMaintenance (catalog/campaign/queue/history), ...
│       └── lib/qp/            ← Embedded html-query-plan renderer (SSMS-style diagram)
└── packages/core/src/types/   ← Shared TypeScript types (plan-analysis.ts mirrors Python models)
```

> `apps/web/` (vanilla TS) là frontend **cũ** đã được thay bằng `apps/web-v2/` (React SPA). Maintenance UI chỉ tồn tại trong web-v2.

Xem `layer3/CLAUDE.md` cho chi tiết đầy đủ component, maintenance UI/API, design decisions.

## Deployment

Docker Compose — build machine tạo image, server chỉ cần `docker-compose.yml` + `.env`:

```bash
# Build & push (build.sh / build.ps1)
docker build -t 19longdt/ai-automation-mssql:vX.X.X -t 19longdt/ai-automation-mssql:latest .
docker push 19longdt/ai-automation-mssql:vX.X.X && docker push 19longdt/ai-automation-mssql:latest

# Server — pull và restart từng service độc lập
docker compose pull layer1 && docker compose up -d layer1
docker compose pull layer2 && docker compose up -d layer2
docker compose pull layer3 && docker compose up -d layer3
docker compose pull maintenance && docker compose up -d maintenance
```

Dockerfile riêng: `Dockerfile` (layer1), `Dockerfile.layer2` (layer2), `Dockerfile.combined` (combined build).
Service `maintenance` chạy cùng codebase Python (`python -m maintenance.runner`), image `…-maintenance`; `stop_grace_period: 30s` để PAUSE resumable rebuild khi SIGTERM. Seed 1 lần: `docker compose run --rm maintenance python -m maintenance.seed.seed_maintenance`.

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
| **Job per `(cluster_id, topic_id)`** | Cụm lỗi không block topic jobs của cụm khác |
| **`cluster_id` trong findings** | Layer 3 filter findings đúng per cluster; backfill cũ bằng lệnh MongoDB |
| **APScheduler `max_workers=50`** | Multi-cluster: N cụm × M topics jobs có thể fire cùng lúc; I/O-bound nên thread rẻ |
| **`_refresh_all_node_roles` ngoài lock** | Snapshot dict → refresh từng cụm bên ngoài lock; UAT timeout không block prod |
| **Maintenance = package độc lập, IPC qua MongoDB** | Tách hẳn khỏi monitoring; runner không cần HTTP; Layer 3 ghi config/command, runner poll |
| **Catalog snapshot tách khỏi Campaign** | Catalog = đo lường (capture gì); Campaign = ý định (làm gì, ngưỡng nào, bảng nào) — capture 1 lần dùng nhiều campaign |
| **Ngưỡng ở cấp Campaign (nhóm theo execution type)** | 1 bộ ngưỡng/campaign; đổi ngưỡng → re-discover áp dụng ngay, không cần capture lại |
| **1 work item / partition vượt ngưỡng** | REBUILD/REORGANIZE chính xác từng partition cho bảng partition theo ngày/tháng |
| **Re-discover hằng ngày + supersede** | Campaign ACTIVE bám `last capture`; item cũ chưa chạy bị supersede, không thực thi catalog cũ |

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

# === Maintenance (dùng chung .env) ===
MONITOR_MONGODB_DB=db_monitor               # đọc db_clusters
MAINT_MONGODB_DB=db_maintenance             # ghi catalog/campaign/queue/history
MAINT_CATALOG_CRON=0 6 * * *                # snapshot scope hằng ngày
MAINT_SUMMARY_CRON=30 5 * * *               # nightly summary
MAINT_TICK_SEC=60                           # execute tick interval
MAINT_DRY_RUN=true                          # true = chỉ log T-SQL; set false khi go-live
MAINT_MAX_ATTEMPTS=3
MAINT_APPROVAL_EXPIRE_HOURS=30
MAINT_BATCH_TOP_N_ITEMS=10                  # số item hiển thị trong batch approval Telegram
MAINT_CATALOG_MAX_WORKERS=8                 # parallel table capture
MAINT_CATALOG_TABLE_TIMEOUT_SEC=120         # timeout per-table khi catalog capture
MAINT_ESTIMATE_PAGES_PER_MINUTE=150000      # tốc độ ước lượng thời gian REBUILD/REORGANIZE
MAINT_ESTIMATE_ROWS_PER_MINUTE=2000000      # tốc độ ước lượng UPDATE STATS / HEAP
MSSQL_QUERY_TIMEOUT_SEC=30                  # query timeout cho execute tick
MAINT_TELEGRAM_BOT_TOKEN=                   # bot RIÊNG của maintenance (poll approval callback)
TELEGRAM_CHAT_ID=                           # dùng chung biến với Layer 1
```

---

## Plan Document

Roadmap chi tiết: `plan/bubbly-snuggling-brooks.md`

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
