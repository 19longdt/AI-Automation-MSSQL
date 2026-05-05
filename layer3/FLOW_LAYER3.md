# Layer3 Flow Documentation

Last updated: 2026-04-29

## 1) Muc tieu Layer3
Layer3 la web dashboard + API de doc du lieu monitoring tu MongoDB (du lieu do Layer1/Layer2 ghi vao), hien thi danh sach finding theo topic, xem detail finding, va xem trang thai AI analysis.

Layer3 KHONG tu phan tich AI.
Layer3 chi:
- Doc data findings/analyses/topics/jobs
- Render dashboard
- Tong hop thong tin de DBA xem nhanh

---

## 2) Kien truc runtime hien tai
1 process Node.js (Fastify) trong `apps/api`:
- Serve API JSON (`/api/*`)
- Serve static frontend (pages + bundles)

Frontend TypeScript build ra bundle trong `dist/`:
- `dist/dashboard.js`
- `dist/insights.js`
- `dist/qp.js`

---

## 3) Luong tong quan (E2E)
### B1. User vao Dashboard
- URL: `/dashboard`
- Server tra file: `apps/web/pages/dashboard.html`
- Browser load script: `/dist/dashboard.js`

### B2. Frontend load topic tabs
- Frontend goi: `GET /api/topics`
- API doc collection: `monitor_topics`
- UI render tab theo `topic_id`/`name`

### B3. Frontend load findings theo topic
- Frontend goi: `GET /api/findings?topic_id=<...>&...`
- API doc collection: `findings`
- API bo sung field `ai_analyzed` bang cach kiem tra trong `ai_analyses` theo `finding_id`

### B4. User bam Detail
- Frontend goi: `GET /api/findings/:id`
- API lay finding trong `findings`
- API tim `ai_analysis` lien quan trong `ai_analyses` theo `finding_id`
- API tra ve finding + thong tin AI (khong phan tich moi)

### B5. Frontend render popup
- Popup hien thi detail theo UI mode cua topic
- Voi `slow_sessions`, list co cot AI status va nut `Xem metrics`

---

## 4) API va du lieu
## 4.1 Health
- `GET /health`
- Dung de check service + mongo/l2 reachability

## 4.2 Topics
- `GET /api/topics`
- Nguon: `monitor_topics`
- Muc dich: render tab theo topic

## 4.3 Findings list
- `GET /api/findings`
- Query params chinh:
  - `topic_id`
  - `finding_id`
  - `severity`
  - `issue_type`
  - `node`
  - `status`
  - `since`, `until`
  - `limit`, `page`
- Nguon: `findings`
- Bo sung output: `ai_analyzed` (true/false)

## 4.4 Finding detail
- `GET /api/findings/:id`
- Nguon:
  - finding: `findings`
  - ai_analysis: `ai_analyses` (match theo `finding_id`)
- Tra ve:
  - finding fields
  - `analysis_text`, `root_cause_summary`, `top_actions`
  - `ai_analysis` object (neu co)

## 4.5 Insights
- `GET /api/insights`
- `GET /api/insights/summary`
- Co co che try Layer2, fallback Mongo

## 4.6 Jobs
- `GET /api/jobs/health`
- Nguon: `job_executions`

---

## 5) UI logic theo topic
Dashboard dang theo model topic-first:
1. Load topics
2. Chon topic
3. Query findings theo topic_id
4. Render bang theo rule cua topic

### Rule hien tai
- Topic `slow_sessions`:
  - Cot: id, time, role+node, severity, alert status, ai analyses, detail
  - AI badge dung `ai_analyzed`
  - Detail button: `Xem metrics`

- Topic khac (vd `ag_health`):
  - Dung layout generic

---

## 6) Mapping voi Layer1/Layer2
- Layer1/L2 ghi findings vao MongoDB
- Layer2 ghi AI analyses vao `ai_analyses`
- Layer3 khong ghi de-lai vao Mongo
- Layer3 doc va tong hop de hien thi

---

## 7) Loi thuong gap
1. `Not found` tren route web
- Thuong do dang chay nham process/port
- Hoac static routing sai

2. Build web loi TS/webpack
- Toolchain web la TS3 + webpack4
- Can dung `NODE_OPTIONS=--openssl-legacy-provider`

3. AI status sai
- Can dam bao `ai_analyses.finding_id` khop `findings.finding_id`

---

## 8) Luong van hanh de chay Layer3
```powershell
cd C:\GIT\AI-Automation-MSSQL\layer3
npm.cmd run build
npm.cmd run start
```

URLs:
- `/dashboard`
- `/insights`
- `/extract-query-plan`
- `/health`

---

## 9) Dinh huong mo rong
1. Topic renderer registry
- `renderers[topic_id]` de custom manh cho tung topic

2. Popup AI detail table
- Hien thi key-value tu `ai_analysis`
- Loai bo cac field khong can (vd `finding_snapshot`)

3. Caching/read model
- Them cache nhe cho list endpoints neu du lieu lon
