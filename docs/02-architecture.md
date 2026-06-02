# Kien truc he thong

## 1. So do tong the

```text
MSSQL AG Cluster
    |
    | pyodbc
    v
Layer 1 (Python Monitoring, port 8001)
    |-- doc monitor_topics, capture_tool_defs
    |-- ghi raw_metrics, findings, finding_diagnostics, baselines, dedup_cache, job_executions
    |
    v
MongoDB
    ^
    |
Layer 2 (FastAPI AI Agent, port 8000)
    |-- doc findings, finding_diagnostics, db_context
    |-- ghi ai_analyses, issue_insights, analysis_sessions
    |
    v
Layer 3 (Fastify + Web UI, port 3000)
    |-- doc MongoDB truc tiep cho dashboard
    |-- proxy plan analysis sang Layer 2
    |-- forward kill-session sang Layer 1
    v
Browser
```

## 2. Layer 1

### Trach nhiem

- Chay scheduler va cac monitoring topic
- Tu dong resolve Primary/Secondary
- Tao `findings` tu raw query results
- Capture snapshot diagnostics cho cac su co critical
- Gui canh bao operational

### Thanh phan chinh

- `layer1/scheduler.py`: orchestration chinh
- `layer1/main.py`: runtime gom scheduler thread va HTTP server
- `layer1/executor/topic_runner.py`: chay 1 topic
- `layer1/executor/node_role_cache.py`: cache role cua cluster
- `layer1/detectors/`: `threshold`, `baseline`, `plan`, `blocking`
- `layer1/capture/`: full diagnostics capture 4 phase
- `layer1/notifications/`: Teams, Telegram notifier va bot
- `layer1/api/`: route `/health`, `/kill-session`

### Startup thuc te

1. Load env tu `layer1/config.py`
2. Khoi tao MongoDB
3. Tao indexes
4. Load `capture_tool_defs`
5. Khoi tao `NodeRoleCache`
6. Tao repositories, detectors, dispatcher
7. Dang ky jobs tu `monitor_topics`
8. Start APScheduler

### API thuc te

- `GET /health`
- `POST /kill-session`

`POST /kill-session` hien tai yeu cau:

```json
{
  "session_id": 123,
  "node": "SQL-NODE-01"
}
```

Luu y quan trong:

- API nay chi co khi chay `python -m layer1.main`
- Stack Docker Compose mac dinh dang chay `python -m layer1.scheduler`, nen Layer 1 API khong tu expose trong runtime mac dinh

## 3. Layer 2

### Trach nhiem

- Phan tich AI on-demand cho finding
- Luu ket qua AI va structured insights
- Quan ly Telegram follow-up session
- Phan tich execution plan XML cho Layer 1 va Layer 3

### Startup thuc te

1. `_setup_logging()` - basicLog + optional Logstash handler
2. `MongoConnection.initialize()` + `create_all_indexes()`
3. `SkillLoader.load_all(skills_dir)` - eager load YAML, fail fast neu `_base.yaml` thieu
4. `NodeRoleCache.initialize()` - detect AG roles, fail fast neu cluster unreachable
5. Khoi tao agent components: `ContextBuilder`, `ToolExecutor`, `AgentOrchestrator`
6. Khoi tao plan engine: `PlanAnalysisService.create()` + `PipelineRegistry.register(PlanAnalysisPipeline)`
7. `TelegramBot.start()` daemon thread (neu L2_TELEGRAM_BOT_TOKEN set)
8. `asyncio.create_task(_node_role_refresh_loop(nrc))` - background refresh moi NODE_ROLE_REFRESH_SEC
9. `uvicorn.run(app)` serving

### Thanh phan chinh

- `layer2/main.py`: FastAPI app + lifespan
- `layer2/agent/`: skill loader, orchestrator, context builder, tool executor
- `layer2/plan/`: parser va analyzers cho execution plan (pure Python, khong AI)
- `layer2/analysis/plan/pipeline.py`: PlanAnalysisPipeline, PipelineRegistry
- `layer2/api/routes/`: health, analysis, insights, skills, admin, plan
- `layer2/storage/`: MongoDB repos va indexes

### API thuc te

Prefix chinh:

- `/api/v1`

Routes:

- `POST /api/v1/analyze`
- `GET /api/v1/analyses`
- `GET /api/v1/analyses/{analysis_id}`
- `GET /api/v1/insights`
- `GET /api/v1/insights/summary`
- `GET /api/v1/skills`
- `GET /api/v1/skills/mapping`
- `POST /api/v1/plan/analyze`
- `GET /health`
- `POST /admin/refresh-db-context`
- `GET /admin/db-context`

### Dac diem quan trong

- Tool execution duoc whitelist, Claude khong tu viet SQL tuy y
- Plan analysis engine la pure Python, khong can AI
- `source="layer1"` tra ve `ToolSnapshot`
- `source="ui"` hoac `source="layer3"` tra ve full output cho giao dien

## 4. Layer 3

### Trach nhiem

- Serve dashboard va query plan UI
- Cung cap API read-only cho dashboard
- Proxy cac thao tac lien layer

### Thanh phan chinh

- `layer3/apps/api/src/main.ts`: startup Fastify
- `layer3/apps/api/src/server.ts`: route va static assets
- `layer3/apps/api/src/routes/`: API routes
- `layer3/apps/web/`: HTML, CSS, TypeScript dashboard
- `layer3/packages/core/`: shared types va parser utilities

### Pages thuc te

- `/`
- `/history`
- `/dashboard`
- `/insights`
- `/query-plan`
- `/extract-query-plan`

### API thuc te

- `GET /health`
- `GET /api/findings`
- `GET /api/findings/:id`
- `GET /api/findings/:id/diagnostics`
- `GET /api/analyses`
- `GET /api/analyses/:id`
- `GET /api/insights`
- `GET /api/insights/summary`
- `GET /api/topics`
- `GET /api/jobs/health`
- `POST /api/actions/kill-session`
- `POST /api/plan/analyze`

Luu y:

- Route `POST /api/actions/kill-session` ton tai trong code
- Route nay chi hoat dong khi Layer 3 duoc cau hinh `L1_API_URL` tro toi mot Layer 1 dang chay `layer1.main`

## 5. Docker Compose hien tai

`docker-compose.yml` dang co 4 services:

- `layer1`
- `layer2`
- `layer3`
- `mongodb`

Ports public:

- `8000`: Layer 2
- `3000`: Layer 3
- `27017`: MongoDB

Layer 1 khong expose port trong compose, nhung HTTP API van chay ben trong network noi bo o `8001`.

## 6. Nguyen tac thiet ke

- Config-driven: topic monitoring nam trong MongoDB
- Separation of concerns: detect, analyze, visualize tach rieng
- Fail-fast cho startup quan trong
- Stateless theo topic run: moi lan chay deu reload config
- Node role auto-detect de chiu duoc AG failover
- AI on-demand: khong auto-analyze tat ca findings
- UI read MongoDB qua Layer 3 thay vi truc tiep tu browser
