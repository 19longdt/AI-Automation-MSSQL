# Tong quan du an

Du an `AI-Automation-MSSQL` hien tai la mot he thong 3 layer de giam sat, phat hien su co, phan tich AI va hien thi dashboard cho cum Microsoft SQL Server Always On Availability Groups.

Ba tai lieu kien truc goc:

- `ARCHITECTURE.md`: tong quan toan he thong
- `layer1/ARCHITECTURE.md`: Layer 1 monitoring
- `layer2/ARCHITECTURE.md`: Layer 2 AI analysis
- `layer3/ARCHITECTURE.md`: Layer 3 web dashboard

Tai lieu trong thu muc `docs/` nay da duoc dong bo lai theo ma nguon hien tai cua repo.

## 1. Ba layer hien tai

### Layer 1 - Python Monitoring Service

- Chay APScheduler de doc `monitor_topics` tu MongoDB
- Query MSSQL theo node `primary`, `secondary`, `all` hoac host cu the
- Chay detector de tao `findings`
- Capture them diagnostics cho finding critical vao `finding_diagnostics`
- Gui canh bao qua Teams, Telegram
- Cung cap HTTP API nho o port `8001`

Entry points:

- `python -m layer1.scheduler`: scheduler service
- `python -m layer1.main`: scheduler + HTTP API trong mot process

### Layer 2 - FastAPI AI Analysis Agent

- Phan tich on-demand cho finding qua `POST /api/v1/analyze`
- Phan tich execution plan XML qua `POST /api/v1/plan/analyze`
- Load skill YAML tu `layer2/skills/`
- Dung MongoDB de luu `ai_analyses`, `issue_insights`, `analysis_sessions`, `db_context`
- Co Telegram bot rieng cho phan hoi multi-turn

Entry point:

- `python -m layer2.main`

### Layer 3 - Fastify API + Web UI

- Fastify API doc MongoDB truc tiep cho dashboard
- Proxy plan analysis sang Layer 2
- Forward action kill-session sang Layer 1
- Serve cac trang:
  - `/dashboard`
  - `/insights`
  - `/query-plan`
  - `/extract-query-plan`

Entry points:

- `npm run dev` trong `layer3/`
- `npm run build && npm run start` trong `layer3/`

## 2. Luong chinh cua he thong

### Monitoring flow

1. Layer 1 doc topic tu `monitor_topics`
2. Resolve node roles bang `NodeRoleCache`
3. Query MSSQL song song theo node
4. Ghi `raw_metrics`
5. Detector tao `findings`
6. Neu finding critical va topic co `capture_tools` thi ghi `finding_diagnostics`
7. Dedup alert
8. Gui Telegram/Teams

### AI analysis flow

1. User hoac Layer 1 goi `POST /api/v1/analyze`
2. Layer 2 load finding va context
3. Chon skill theo `issue_type`
4. Chay agentic loop voi tool whitelist
5. Luu `ai_analyses`
6. Rut trich insight va upsert `issue_insights`

### Dashboard flow

1. Browser goi Layer 3 API
2. Layer 3 doc MongoDB cho findings, topics, analyses, jobs, insights
3. Layer 3 proxy plan XML sang Layer 2
4. Layer 3 goi Layer 1 khi can `kill-session`

## 3. Stack hien tai

| Thanh phan | Cong nghe |
|---|---|
| Layer 1 | Python 3, APScheduler, pyodbc, pymongo |
| Layer 2 | Python 3, FastAPI, uvicorn, Anthropic SDK, pyodbc, pymongo |
| Layer 3 API | Node.js, Fastify, MongoDB driver |
| Layer 3 Web | TypeScript, webpack, vanilla TS |
| Shared DB | MongoDB 7 |
| Deployment | Docker Compose |

## 4. Nhung thay doi quan trong so voi tai lieu cu

- He thong hien tai la 3 layer, khong con mo ta 2 layer
- Layer 3 da tro thanh mot phan chinh thuc trong `docker-compose.yml`
- Layer 1 co `finding_diagnostics`, `capture_tool_defs`, `seed_capture_tools.py`
- Layer 2 co plan analysis engine doc lap, khong dung AI cho XML plan
- Layer 3 API dung prefix `/api/*` cho cac route JSON
- TTL collection thuc te da thay doi theo ma nguon, khong giong bo docs cu

## 5. Thu muc nen doc tiep

- `docs/02-architecture.md`: kien truc tong the chi tiet
- `docs/03-project-structure.md`: cau truc repo hien tai
- `docs/04-data-flow.md`: luong du lieu giua 3 layer
- `docs/05-database.md`: collections va TTL thuc te
- `docs/06-configuration.md`: bien moi truong va config MongoDB
- `docs/07-deployment.md`: build va deploy
- `docs/08-local-development.md`: chay local
