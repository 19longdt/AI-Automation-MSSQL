# Layer 3 — Web Dashboard + API: Implementation Plan
Last updated: 2026-04-29
Owner: LongDo + Claude assistant
## Context

Layer 1 (Python) giám sát cụm MSSQL AG và lưu findings/metrics vào MongoDB. Layer 2 (FastAPI + Claude) thực hiện AI analysis theo yêu cầu và lưu kết quả vào MongoDB. DBA hiện chỉ tiếp cận dữ liệu này qua Telegram — không có cách nào xem lịch sử alerts, so sánh nhiều findings, hay theo dõi insights.

Layer 3 lấp đầy khoảng trống này: một web dashboard đọc từ MongoDB của L1/L2, đồng thời giữ nguyên execution plan viewer (html-query-plan) hiện có. Cấu trúc được thiết kế chuẩn từ đầu (monorepo workspace) để dễ mở rộng sau này.

**Trạng thái hiện tại**: `layer3/` là bản copy nguyên vẹn của `html-query-plan` v2.6.1 — TypeScript 3.0 + webpack 4, browser-only, chưa có dashboard hay Node.js backend.

---

## Target Architecture

**Nguyên tắc**: monorepo workspace để tổ chức code rõ ràng, nhưng **deploy 1 image duy nhất** — Fastify serve cả API lẫn static files. Không cần nginx riêng, không cần 2 container.

```
layer3/
├── package.json               ← root workspace ("workspaces": ["apps/*", "packages/*"])
├── tsconfig.base.json         ← shared compiler options
├── Dockerfile                 ← single image: build web + api, run Fastify
├── docker-compose.yml         ← 1 service: layer3
├── apps/
│   ├── api/                   ← Fastify Node.js server (NEW)
│   │   └── src/
│   └── web/                   ← Frontend: migrated html-query-plan + new dashboard pages
│       ├── src/               ← migrated từ layer3/src/
│       ├── pages/             ← HTML pages (migrated + new dashboard pages)
│       ├── dashboard/         ← dashboard TypeScript bundles
│       └── css/
└── packages/
    └── core/                  ← Pure functions: XML parse + L1/L2 TypeScript types
```

**Runtime**: Fastify dùng `@fastify/static` để serve `apps/web/dist/` (JS bundles), `apps/web/pages/` (HTML), `apps/web/css/`, `apps/web/assets/`. API routes mounted tại `/api/*`. 1 process, 1 port (3000), 1 image.

---

## Phase A — Scaffold Monorepo

**Goal**: Thiết lập workspace layout và TypeScript configs. Không di chuyển feature nào — chỉ cấu trúc.

**Files to create**:
- `layer3/package.json` — thay root package.json: `"name": "layer3"`, `"workspaces": ["apps/*", "packages/*"]`, `"private": true`, `engines: { node: ">=18" }`
- `layer3/tsconfig.base.json` — shared: `target: "es2019"`, `strict: true`, `esModuleInterop: true`, `declaration: true`, `sourceMap: true`, `skipLibCheck: true`
- `apps/api/package.json` — `"name": "@layer3/api"`, deps placeholder
- `apps/api/tsconfig.json` — extends base, `outDir: "dist"`, `rootDir: "src"`
- `apps/web/package.json` — `"name": "@layer3/web"`, giữ tất cả devDependencies webpack/karma hiện tại
- `apps/web/tsconfig.json` — extends base, override `target: "es5"` (giữ browser compat cho XSLT code)
- `apps/web/webpack.config.js` — copy từ root, sửa `context` trỏ vào `apps/web/`
- `packages/core/package.json` — `"name": "@layer3/core"`, `"main": "dist/index.js"`
- `packages/core/tsconfig.json` — extends base, `lib: ["es2019"]` (NO `dom` — enforce zero browser dep)

**Root `package.json` scripts**:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev --workspace=apps/web\" \"npm run dev --workspace=apps/api\"",
    "build": "npm run build --workspace=packages/core && npm run build --workspace=apps/web && npm run build --workspace=apps/api",
    "start": "node apps/api/dist/main.js"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

- `npm run dev` → chạy webpack watch (web) + ts-node Fastify (api) song song trong 1 terminal
- `npm run build` → build tuần tự: core → web → api (đúng dependency order)
- `npm start` → chạy production build tại chỗ (không cần Docker nếu muốn)

`apps/web/package.json` scripts:
```json
{ "dev": "NODE_OPTIONS=--openssl-legacy-provider webpack --watch --mode development" }
```

`apps/api/package.json` scripts:
```json
{ "dev": "ts-node src/main.ts", "build": "tsc", "start": "node dist/main.js" }
```

**Exit criteria**:
- `npm install` từ `layer3/` resolve tất cả workspaces không lỗi
- `npm run dev` từ root khởi động cả webpack watch lẫn Fastify trong 1 lần
- `tsc --project apps/web/tsconfig.json` compile được (output giống hiện tại)

---

## Phase B — packages/core: Pure Functions + L1/L2 Types

**Goal**: Extract browser-independent logic từ `src/index.ts` vào `packages/core/src/`. Định nghĩa TypeScript interfaces cho toàn bộ MongoDB data dùng trong dashboard.

**Files to create**:

```
packages/core/src/
├── index.ts                   ← barrel export
├── plan/
│   ├── validate.ts            ← validateShowPlan(xml): ValidationResult
│   ├── parse.ts               ← parseShowPlan(xml): ParsedPlan; extractStatements(doc)
│   ├── resolve.ts             ← resolveStatementQuery(text, params): string
│   └── indexes.ts             ← extractMissingIndexes(doc): MissingIndex[]
└── types/
    ├── plan.ts                ← ParsedPlan, Statement, MissingIndex, ValidationResult
    ├── finding.ts             ← Finding, IssueType (20 types), Severity
    ├── analysis.ts            ← AnalysisResult, InsightData, InsightAction, InsightSummary
    ├── topic.ts               ← MonitorTopic, QueryConfig
    └── job.ts                 ← JobExecution, JobStatus
```

**Migration map** (từ `layer3/src/index.ts`):

| Hiện tại | Đích | Ghi chú |
|---|---|---|
| `getStatementNodes()`, `extractParamMap()` | `core/plan/parse.ts` | Pure XML parse |
| `replaceSqlParameters()`, `stripLeadingParamsPrelude()`, `applyParams()` | `core/plan/resolve.ts` | Pure string logic |
| `showPlan()`, `initQueryTabs()`, `initDiagramInteractions()` | Ở lại `apps/web/src/index.ts` | DOM manipulation |
| `lines.ts`, `tooltip.ts`, `node.ts` | Ở lại `apps/web/src/` | Browser-only |

**Dependency**: `@xmldom/xmldom: "^0.9.0"` — W3C-compatible XML parser cho Node.js, API giống `DOMParser` của browser.

**Key types** (phản ánh đúng schema MongoDB của L1/L2):

```typescript
// finding.ts
type IssueType = "slow_sessions" | "plan_regression" | "blocking_chain" | "deadlock"
  | "non_optimal_index" | "missing_index" | "tempdb_pressure" | "memory_pressure"
  | "wait_anomaly" | "ag_lag" | "cdc_failure" | "index_fragmentation"
  | "resource_pool_spike" | "job_failure" | "backup_gap" | "dbcc_overdue"
  | "plan_instability" | "partition_elimination_failure" | "high_variation_query"
  | "blocked_query_snapshot" | "blocked_query_trend"

type Severity = "INFO" | "WARNING" | "CRITICAL"

interface Finding {
  finding_id: string; detected_at: string; topic_id: string
  issue_type: IssueType; severity: Severity; node: string; role: string
  metrics: Record<string, unknown>; plan_patterns: string[]
  status: "new" | "analyzing" | "analyzed" | "resolved" | "suppressed"
  ai_analysis_id?: string; query_text?: string; finding_hash: string
}

// analysis.ts
interface AnalysisResult {
  analysis_id: string; finding_id: string; skill_id: string
  analysis_text: string; cost_usd: number; model: string
  root_cause_summary: string; top_actions: string[]
  status: "pending" | "running" | "completed" | "failed" | "timeout"
  started_at: string; completed_at?: string; total_duration_ms?: number
}
```

**Exit criteria**:
- `tsc --project packages/core/tsconfig.json` zero errors, zero `dom` lib references
- `validateShowPlan` và `parseShowPlan` chạy được trong Node.js script với file `.sqlplan` thực tế
- `apps/web` build vẫn pass

---

## Phase C — apps/api: Fastify Node.js Server

**Goal**: API server đọc MongoDB (L1/L2 collections) và proxy L2 API. Frontend không gọi L2/MongoDB trực tiếp.

**File tree**:

```
apps/api/src/
├── main.ts                    ← entry: connect MongoDB, start Fastify
├── server.ts                  ← Fastify app factory + register routes + @fastify/static
├── config.ts                  ← typed env config (dotenv-free, dùng process.env)
├── db/
│   ├── client.ts              ← MongoClient singleton (connect/close/getDb)
│   └── collections.ts         ← collection name constants
├── routes/
│   ├── health.ts              ← GET /health
│   ├── findings.ts            ← GET /api/findings, GET /api/findings/:id
│   ├── analyses.ts            ← GET /api/analyses, GET /api/analyses/:id
│   ├── insights.ts            ← GET /api/insights/summary, GET /api/insights
│   ├── topics.ts              ← GET /api/topics
│   └── jobs.ts                ← GET /api/jobs/health
├── services/
│   ├── findings-service.ts    ← MongoDB query logic + pagination
│   ├── insights-service.ts    ← proxy L2 với fallback sang MongoDB trực tiếp
│   └── jobs-service.ts        ← aggregate job_executions → health status
└── proxy/
    └── l2-proxy.ts            ← thin wrapper quanh Node 18 built-in fetch
```

**Env config** (`config.ts`):
```
MONGODB_URI       (required) — same as L1/L2
MONGODB_DB        (required) — e.g. db_monitor
L2_API_URL        (optional) — http://layer2:8000
API_PORT          (default 3000)
LOG_LEVEL         (default "info")
```

**Endpoints**:

| Method | Path | MongoDB collection | Notes |
|---|---|---|---|
| GET | `/health` | ping | + L2 reachability check (3s timeout) |
| GET | `/api/findings` | `findings` | params: severity, issue_type, node, status, since, until, limit(50), page(0). Header `X-Total-Count` |
| GET | `/api/findings/:id` | `findings` + `ai_analyses` | Merge analysis_text, root_cause_summary, top_actions vào response |
| GET | `/api/analyses` | `ai_analyses` | Bỏ `finding_snapshot` ở list view |
| GET | `/api/analyses/:id` | `ai_analyses` | Full document |
| GET | `/api/insights/summary` | proxy L2 → fallback `issue_insights` | days param |
| GET | `/api/insights` | proxy L2 → fallback `issue_insights` | filters: issue_type, table, resolved, priority |
| GET | `/api/topics` | `monitor_topics` | Bỏ `queries[].sql` ở list |
| GET | `/api/jobs/health` | `job_executions` | Aggregate: latest per job + `is_healthy` derived field |

**MongoDB access pattern**: read-only (`find`, `aggregate`). Không có write operation nào trong `apps/api/`.

**Dependencies** (`apps/api/package.json`):
```json
{
  "dependencies": {
    "@layer3/core": "*",
    "fastify": "^4.28.0",
    "@fastify/static": "^7.0.0",
    "@fastify/cors": "^9.0.0",
    "mongodb": "^6.8.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.2"
  }
}
```

**Exit criteria**:
- `npm run build` trong `apps/api` pass
- `curl localhost:3000/health` → `{"status":"ok","mongodb":true}`
- `curl localhost:3000/api/findings?limit=5` → JSON array (không 500)
- `curl localhost:3000/api/topics` → topic documents
- Zero write operations trong toàn bộ `apps/api/src/`

---

## Phase D — apps/web: Dashboard Pages

**Goal**: Thêm dashboard pages, giữ nguyên các route hiện có.

**UX nguyên tắc**:
- **Không chuyển trang** — mọi detail (finding, AI analysis, execution plan) đều mở dạng popup overlay ngay trên trang hiện tại
- **Tối giản** — nhất quán với `qp.css` (white background, `#ccc` borders, `#000` text). Không CSS framework ngoài. Không animation. Không icon pack mới

**File structure** (mới):
```
apps/web/
├── pages/
│   ├── index.html             ← migrated từ examples/index.html, thêm tab Dashboard + Insights
│   ├── upload.html            ← migrated từ examples/upload.html (unchanged — embedded iframe)
│   ├── dashboard.html         ← /dashboard
│   └── insights.html          ← /insights
├── dashboard/
│   ├── api-client.ts          ← typed fetch wrapper cho /api/* endpoints
│   ├── modal.ts               ← shared popup/modal logic (open/close/ESC/backdrop click)
│   ├── dashboard.ts           ← /dashboard + finding popup + plan popup
│   └── insights.ts            ← /insights + insight detail popup
└── css/
    └── dashboard.css          ← minimal, nhất quán với qp.css
```

**webpack.config.js** — 3 entry points:
```javascript
entry: {
  qp: "./src/index.ts",                // existing, unchanged
  dashboard: "./dashboard/dashboard.ts",
  insights: "./dashboard/insights.ts",
}
```

**`dashboard/api-client.ts`**:
- Base URL từ `window.LAYER3_API_BASE` (set bởi `<script>` tag trong HTML — không cần rebuild khi đổi URL)
- Functions: `getFindings(params)`, `getFinding(id)`, `getInsightsSummary()`, `getInsights(params)`, `getTopics()`, `getJobsHealth()`, `getHealth()`
- Types import từ `@layer3/core` (type-only, không bundle runtime)
- Lỗi throw `ApiError { status, message }` — render inline error text, không modal

**`dashboard/modal.ts`** — shared popup logic:
- `openModal(title, contentHtml)` — render overlay + panel + title + close button
- `closeModal()` — xóa overlay
- ESC key và click backdrop tự động đóng
- CSS: overlay `position:fixed`, panel trắng, max-width 800px, overflow-y scroll

**Dashboard page designs** (UI tiếng Việt):

**`/dashboard`** (`dashboard.html` + `dashboard.ts`):
- Tab nav trên cùng: `Dashboard | Lịch sử | Insights | Query Plan` (dùng tab pattern giống `index.html`)
- Row 1: 3 stat cards — CRITICAL/WARNING/INFO findings trong 24h
- Row 2: Findings table — thời gian, loại sự cố, node, severity badge, nút "Xem"
  - Filter inline: dropdown severity + issue_type + node ngay trên table
  - Pagination: prev/next buttons dưới table
  - Click "Xem" → `getFinding(id)` → `openModal(...)` hiển thị:
    - Metadata: topic, issue_type, severity, node, detected_at, status, metrics key-value
    - AI Analysis: analysis_text (pre monospace), root_cause_summary, top_actions
    - Nếu `plan_xml_ref` có: nút "Xem Execution Plan" → popup thứ 2 render `QP.showPlan()`
- Row 3: Job health table (job_name, status dot, started_at, duration_ms, findings_created)

**`/insights`** (`insights.html` + `insights.ts`):
- Summary cards: top 3 root causes, top 3 affected tables, unresolved high-priority count, 30-day cost USD
- Insights table: root_cause_category, affected_tables, recurrence_count, unresolved actions, first/last seen
  - Click row → `openModal(...)`: full root_cause_summary, danh sách actions với priority/effort/resolved, affected indexes
- Filter inline: issue_type, resolved state

**Badge colors** (`dashboard.css`):
```css
.badge-critical { color: #8a1f1b; background: #fdecea }
.badge-warning  { color: #6d4c00; background: #fff3cd }
.badge-info     { color: #004085; background: #cce5ff }
```

Empty state: plain text "Chưa có dữ liệu." Error: inline red text, không modal.

**Exit criteria**:
- `/dashboard` render stat cards + findings table + job health từ API thực
- Click "Xem" trên finding row → popup mở đúng, hiển thị metadata + AI analysis
- Nếu finding có `plan_xml_ref` → popup "Xem Plan" render execution plan dùng `QP.showPlan()`
- `/insights` render summary cards + insights table; click row → popup detail
- `/`, `/history`, `/extract-query-plan` hoạt động giống trước Phase D

---

## Phase E — Docker & Deployment

**Goal**: 1 Dockerfile, 1 image, 1 container. Fastify serve cả API lẫn static files.

**`apps/api/src/server.ts`** — thêm `@fastify/static`:
- Mount `apps/web/dist/` tại `/dist`
- Mount `apps/web/pages/` tại `/pages`
- Mount `apps/web/css/` tại `/css`
- Mount `apps/web/assets/` tại `/assets`
- `setNotFoundHandler`: `/` `/history` `/extract-query-plan` → `pages/index.html`; `/dashboard` → `pages/dashboard.html`; `/insights` → `pages/insights.html`

**`Dockerfile`** (tại root `layer3/`, thay file hiện có, multi-stage):

```dockerfile
# Stage 1: build web bundles
FROM node:18-alpine AS web-builder
WORKDIR /app
ENV NODE_OPTIONS=--openssl-legacy-provider
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
RUN npm install --workspace=apps/web --workspace=packages/core
COPY apps/web ./apps/web
COPY packages/core ./packages/core
RUN npm run build --workspace=packages/core
RUN npm run webpack --workspace=apps/web

# Stage 2: build api
FROM node:18-alpine AS api-builder
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
RUN npm install --workspace=apps/api --workspace=packages/core
COPY apps/api ./apps/api
COPY packages/core ./packages/core
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=apps/api

# Stage 3: runtime (slim)
FROM node:18-alpine AS runtime
WORKDIR /app
COPY --from=api-builder /app/apps/api/dist ./apps/api/dist
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist
COPY --from=web-builder /app/apps/web/pages ./apps/web/pages
COPY --from=web-builder /app/apps/web/css ./apps/web/css
COPY --from=web-builder /app/apps/web/assets ./apps/web/assets
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

**`docker-compose.yml`** (tại root `layer3/`, thay file hiện có):
```yaml
services:
  layer3:
    build: .
    image: 19longdt/ai-automation-mssql-layer3:latest
    container_name: layer3
    restart: unless-stopped
    ports:
      - "8080:3000"
    environment:
      MONGODB_URI: mongodb://mongodb:27017
      MONGODB_DB: db_monitor
      L2_API_URL: http://layer2-agent:8000
      API_PORT: "3000"
      LOG_LEVEL: info
    networks:
      - monitoring-net

networks:
  monitoring-net:
    external: true   # shared network với L1/L2/MongoDB
```

**Exit criteria**:
- `docker compose up --build` khởi động 1 container không lỗi
- `curl http://localhost:8080/health` → JSON trực tiếp từ Fastify
- `curl http://localhost:8080/api/findings?limit=5` → data
- `http://localhost:8080/dashboard` render trong browser
- `http://localhost:8080/extract-query-plan` vẫn hoạt động (regression check)

---

## Critical Files

| File | Phase | Hành động |
|---|---|---|
| `layer3/package.json` | A | Replace thành workspace host |
| `layer3/src/index.ts` | B | Source extract các pure functions vào packages/core |
| `layer3/src/xml.ts`, `utils.ts` | B | Tham khảo khi viết core/plan/validate.ts |
| `layer3/nginx.conf` | E | Xóa — không cần nginx nữa (Fastify serve static) |
| `layer3/Dockerfile` | E | Replace bằng single multi-stage Dockerfile |
| `layer3/docker-compose.yml` | E | Replace: 1 service `layer3` thay vì 2 |
| `apps/api/src/server.ts` | C+E | Phase C: routes; Phase E: thêm @fastify/static + SPA routing |
| `layer3/examples/index.html` | D | Migrate → `apps/web/pages/index.html`, thêm tab Dashboard + Insights |
| `layer3/examples/upload.html` | D | Migrate → `apps/web/pages/upload.html` (content unchanged) |

---

## Verification (End-to-End)

1. **Build local**: `npm install && npm run build` từ `layer3/` — tất cả workspaces pass
2. **Dev local**: `npm run dev` từ root — webpack watch + Fastify khởi động trong 1 lần, `http://localhost:3000/dashboard` load trong browser
3. **API**: `curl localhost:3000/api/findings` trả data từ MongoDB thực
4. **Docker**: `docker compose up --build` → `http://localhost:8080/dashboard` hoạt động
5. **Regression**: `http://localhost:8080/extract-query-plan` + upload file `.sqlplan` — render đúng như trước
