# CLAUDE.md — Layer 3: Web UI Dashboard

## Mục đích

Web UI cho hệ thống giám sát + bảo trì MSSQL, gồm:
- **Dashboard**: Theo dõi findings, metrics real-time
- **Insights**: Tổng hợp issue insights từ AI analysis
- **Query Plan**: Phân tích và visualize SQL execution plan
- **Maintenance**: Catalog scope/snapshot + Campaign + Queue/History (điều khiển maintenance runner qua MongoDB)

**Stack:** Fastify (API backend, TypeScript, `@fastify/static` phục vụ frontend) + React SPA
(`apps/web-v2`: Vite + React Query + Zustand + shadcn/ui)

---

## Kiến trúc

```
Browser (React SPA — apps/web-v2)
    │ HTTP /api/*
    ▼
apps/api (Fastify — phục vụ static web-v2 + JSON API)
    │ MongoDB reads/writes (direct)        ← findings, insights, maintenance_*, campaigns, ...
    │ /api/v1/* proxy                       ← plan analysis
    ▼
layer2 (FastAPI — port 8000)

maintenance runner ◄──poll── MongoDB ◄──writes── apps/api   (catalog_config / campaigns / commands)
```

- Frontend **không gọi trực tiếp Layer 2** — qua Fastify proxy (`/api/v1/*`)
- Fastify API đọc MongoDB trực tiếp (findings, insights, topics, jobs, maintenance) — không qua Layer 1/2
- Plan analysis route (`/api/v1/plan/analyze`) proxy sang Layer 2
- **Maintenance:** API ghi config/campaign/command vào MongoDB; **maintenance runner là process riêng**
  poll MongoDB (không có HTTP). Xem `maintenance/CLAUDE.md`.

---

## Cấu trúc Module

```
layer3/
├── apps/
│   ├── api/                       ← Fastify backend (TypeScript)
│   │   └── src/
│   │       ├── main.ts            ← Entry point
│   │       ├── server.ts          ← Fastify factory + route/plugin registration + @fastify/static (web-v2)
│   │       ├── config.ts          ← Layer3Settings (env vars)
│   │       ├── db/collections.ts  ← Typed MongoDB collection accessors
│   │       ├── proxy/l2-proxy.ts  ← Proxy /api/v1/* sang Layer 2
│   │       ├── routes/            ← findings, analyses, insights, topics, jobs, actions, plan, health,
│   │       │                         clusters, maintenance, catalog, campaigns
│   │       ├── schemas/           ← *.schema.ts — Fastify JSON Schema (maintenance, campaigns, findings, ...)
│   │       └── services/          ← findings, analyses, insights, topics, jobs, time-filter,
│   │                                 maintenance, catalog, campaign, command (maintenance writes)
│   │
│   └── web-v2/                    ← Frontend SPA — React + Vite + React Query + Zustand + shadcn/ui
│       └── src/
│           ├── main.tsx, App.tsx  ← Entry + path-based routing (lazy pages)
│           ├── pages/             ← DashboardPage, InsightsPage, QueryPlanPage, SettingsPage,
│           │                         MaintenanceCampaignPage, MaintenanceCatalogPage
│           ├── components/
│           │   ├── dashboard/     ← KPI cards, findings table, charts, modals
│           │   ├── insights/, plan/ ← Insight cards; plan analysis panel + embedded QP diagram
│           │   ├── maintenance/   ← CampaignControl/Form/List, Catalog{Charts,View,TableDetailDialog},
│           │   │                     ScopeEditor, QueueTable, HistoryTable, PipelineStages,
│           │   │                     WindowStatusBar, MaintenanceSubNav
│           │   ├── layout/, shared/, ui/ ← Shell/topbar/cluster selector; badges; shadcn primitives
│           ├── hooks/             ← useFindings, useInsights, useMaintenance (catalog/campaign/queue/history), ...
│           ├── store/             ← dashboard.store.ts (Zustand: selectedClusterId, filters)
│           └── lib/qp/            ← Embedded html-query-plan renderer (SSMS-style diagram)
│
└── packages/core/src/types/      ← Shared TS types (plan-analysis.ts mirrors Python models)
```

> Plan analysis (glossary, 5 groups, summary bar) nằm trong `components/plan/`; build output ở `dist-v2/`.

---

## Plan Analysis Component (`plan-analysis-component.ts`)

Component chính visualize kết quả phân tích execution plan từ Layer 2.

### 5 Section Groups (theo thứ tự ưu tiên phân tích)

| ID | Label | Mô tả | Màu |
|---|---|---|---|
| `orientation` | ORIENTATION | Query text & plan warnings | `--group-color-orientation: #2563eb` |
| `cost` | COST ANALYSIS | Operators, row estimates & I/O | `--group-color-cost: #7c3aed` |
| `actionable` | ACTIONABLE | Missing indexes, stale stats & parameters | `--group-color-actionable: #dc2626` |
| `context` | CONTEXT | Index usage, join algorithms & memory | `--group-color-context: #0891b2` |
| `deepdive` | DEEP DIVE | Compilation settings & plan lookup queries | `--group-color-deepdive: #64748b` |

### Summary Bar (2-row layout)
```
Row 1: [ELAPSED] [CPU TIME] [DOP] [COST] [CE MODEL] [STATEMENTS]
─────────────────────────────────────────
Row 2: [TOP WAIT type + ms] [WAIT TIME total ms] [warnings badge]
```

- `elapsed_ms` / `cpu_ms`: từ `StatementResult` (query runtime stats, không phải estimate)
- Wait bar: `_waitCls()` map wait type → màu (red/orange/blue/green)
- Warning count: tổng tất cả `finding_groups[].count` (KHÔNG phải `warning_count` field)

### FindingGroup Rendering (Warnings section)
```html
<div class="pa-finding-group">
  <span class="pa-warn-accent pa-warn-accent--{cat}">  ← màu theo category
  <span class="pa-finding-count">×{count}</span>       ← count badge nếu > 1
  <div class="pa-finding-instances">                   ← collapse/expand
    <div class="pa-finding-inst">• description</div>   ← mỗi instance
  </div>
</div>
```

### Glossary System

`glossary.ts` chứa 70+ entries. `glossary-tooltip.ts` export `attachGlossaryTooltips(root)`:
- Tự động scan mọi element có `[data-glossary]` attribute trong `root`
- Append `<button class="pa-glossary-btn">?</button>` inline
- Click/hover → tooltip với định nghĩa

**Naming convention:**
- Operators: `op_sort`, `op_hash_match`, `op_nested_loops`, `op_index_seek`, ...
- Wait types: `wait_lck`, `wait_pageiolatch`, `memory_allocation_ext`, `hadr_sync_commit`, ...
- Plan groups: `group_orientation`, `group_cost`, `group_actionable`, `group_context`, `group_deepdive`
- Summary fields: `elapsed_time`, `cpu_time`, `dop`, `total_cost`, `ce_model`, `memory_grant`, ...

---

## CSS Architecture (`plan-analysis.css`)

### CSS Variables (định nghĩa trong `base.css`)

```css
/* Light mode */
:root {
  --group-color-orientation: #2563eb;
  --group-color-cost:        #7c3aed;
  --group-color-actionable:  #dc2626;
  --group-color-context:     #0891b2;
  --group-color-deepdive:    #64748b;
}

/* Dark mode */
:root[data-theme="dark"] {
  --group-color-orientation: #60a5fa;
  /* ... lighter variants */
}
```

### Key CSS Classes

| Class | Mô tả |
|---|---|
| `.pa-root` | Container gốc của component |
| `.pa-group` | Section group wrapper (có dot màu + chevron collapse) |
| `.pa-group-header` | Header với group label + description + badge |
| `.pa-group-dot` | Màu dot theo group (e.g., `.pa-group-dot--orientation`) |
| `.pa-group-badge` | Count badge hiện số sections có data |
| `.pa-group-body` | Collapsible body của group |
| `.pa-summary` | Summary bar (flex-direction: column) |
| `.pa-sum-row` / `.pa-sum-row-2` | Row 1 và Row 2 của summary |
| `.pa-sum-divider` | Divider giữa 2 row |
| `.pa-finding-count` | `×N` badge cho finding group |
| `.pa-finding-instances` | Danh sách instances (collapsible nếu > 1) |
| `.pa-warn-accent--spill` / `--perf` / `--parallel` / `--index` / `--stats` | Màu accent theo warning category |

---

## TypeScript Types (`packages/core/src/types/plan-analysis.ts`)

Mirror chính xác Python models trong `layer2/plan/models/result.py`:

```typescript
interface FindingInstance { description: string; action: Action | null; }
interface FindingGroup {
    severity: string; category: string; type: string;
    recommendation: string; shared_action: Action | null;
    instances: FindingInstance[]; count: number;
}
interface StatementResult {
    statement_text: string; statement_text_truncated: boolean;
    elapsed_ms: number | null; cpu_ms: number | null;
    finding_groups: FindingGroup[];      // KHÔNG còn findings: PlanFinding[]
    top_operators: OperatorSummary[];
    wait_stats: WaitStatSummary[];
    // ...
}
```

**Quan trọng:** `findings: PlanFinding[]` đã bị xóa, thay bằng `finding_groups: FindingGroup[]`.
Mọi code dùng `s.findings` cũ phải chuyển sang `s.finding_groups.reduce(count)`.

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Vanilla TypeScript, không framework** | Đơn giản, bundle nhỏ, dễ debug; dashboard không phức tạp SPA |
| **Fastify proxy thay vì gọi Layer 2 trực tiếp** | Cho phép thêm auth, rate limit, aggregation; JSON-schema validate request |
| **Maintenance: API ghi MongoDB, runner poll (không gọi trực tiếp)** | Runner không có HTTP; tách process; force-run qua `maintenance_commands` |
| **5 groups thay vì flat list** | Ưu tiên hóa thông tin: DBA đọc ORIENTATION trước, ACTIONABLE sau |
| **`data-glossary` attribute + auto-attach** | Không cần manual wiring từng tooltip — scan DOM một lần sau render |
| **CSS variables cho group colors** | Light/dark mode override 1 chỗ — component không cần biết mode |
| **`finding_groups` thay `findings[]`** | Tránh duplicate recommendation khi nhiều operator cùng loại lỗi |
| **FindingGroup grouped by `type` (không phải recommendation)** | Recommendation thường chứa tên bảng → mỗi cái unique, không group được |
| **2-row summary bar** | Row 1 = plan characteristics; Row 2 = runtime signals (wait, perf) |
| **Warning count = sum(group.count), không warning_count field** | `warning_count` chỉ đếm WARNING severity, bỏ sót CRITICAL + INFO |
| **`cluster_id` filter trong findings-service** | Mọi findings query đều filter theo `cluster_id` của cluster đang chọn — dữ liệu không lẫn giữa cụm |
| **ClusterSelector không có "All Clusters"** | Luôn filter theo 1 cluster cụ thể; auto-select cluster đầu tiên nếu chưa chọn |
| **`filters.replica` reset khi đổi cluster** | Replica options là cluster-specific — giữ lại gây empty chart vì không match |
| **Sort dùng `detected_at` khi không có date range** | `detected_at_date` (computed field) chỉ tồn tại sau `$addFields` stage — sort bằng nó khi không có date stages gây error |

---

## Multi-Cluster Data Isolation

Dashboard hỗ trợ nhiều cụm MSSQL. Mỗi finding trong MongoDB có trường `cluster_id` để phân biệt.

### Luồng filter

```
ClusterSelector (Zustand: selectedClusterId)
    │
    ▼
findings-service.ts: buildFindingsFilter()
    → filter.cluster_id = query.cluster_id   [bắt buộc khi cluster_id có]
    │
    ▼
MongoDB findings collection
    → chỉ trả documents có cluster_id khớp
```

### Backfill findings cũ (chạy 1 lần khi migrate)

Findings tạo trước khi có multi-cluster không có `cluster_id`. Cần set về cluster prod:

```javascript
db.findings.updateMany(
  { $or: [{ cluster_id: "" }, { cluster_id: { $exists: false } }, { cluster_id: null }] },
  { $set: { cluster_id: "prod" } }
)
```

### Các điểm quan trọng

- **`filters.replica`** trong Zustand store reset khi đổi cluster — replica là cluster-specific
- **`detected_at_date`** là computed field chỉ có sau `$addFields` stage; sort dùng `detected_at` khi không có date range
- **ClusterSelector** không có option "All Clusters" — luôn filter theo 1 cluster; auto-select cluster đầu tiên

---

## Maintenance UI & API

Layer 3 là **control plane** cho maintenance runner (`maintenance/` — process riêng). Mọi tương tác
qua **MongoDB**: API ghi config/campaign/command, runner poll. API cũng đọc các collection runtime
(`maintenance_*`) để hiển thị. Runner KHÔNG có HTTP — xem `maintenance/CLAUDE.md` + `maintenance/ARCHITECTURE.md`.

### Pages (web-v2)

| Page | Route | Nội dung |
|---|---|---|
| `MaintenanceCampaignPage` | `/maintenance` | Control header (KPI), WindowStatusBar, PipelineStages (Discovery→Scanning→Decision→Execution), CampaignControl, tabs Queue / History |
| `MaintenanceCatalogPage` | `/maintenance/catalog` | CatalogView: chọn database → schema → snapshot (`run_id`) → table list (lọc frag/stale/heap) → drilldown detail dialog (charts) |

`MaintenanceSubNav` chuyển giữa 2 trang; chấm đỏ trên Campaign nếu có campaign `DISCOVERY_FAILED`.

### Components (`components/maintenance/`)

| Component | Vai trò |
|---|---|
| `CampaignControl` / `CampaignForm` / `CampaignList` | Tạo/sửa/extend/cancel campaign; form có scope theo bảng, execution_types, **ngưỡng nhóm theo execution type**, scan_times, window override; list có progress % + discovery error |
| `ScopeEditor` | CRUD catalog scope (db → schema → table); validate trùng theo key **(db, schema, table)** — cùng (db,schema) khác bảng thì CHO PHÉP, all-tables hoặc giao bảng thì chặn |
| `CatalogView` / `CatalogCharts` / `CatalogTableDetailDialog` | Duyệt snapshot; trend frag theo table / index×partition / stats modification (Recharts) |
| `QueueTable` / `HistoryTable` | Queue items theo status tab; lịch sử thực thi theo outcome |
| `PipelineStages` / `WindowStatusBar` | 4-stage pipeline với counts; trạng thái window + budget + gates |

### Hooks (`hooks/useMaintenance.ts`)

Queries: `useMaintenanceSummary`, `useMaintenanceQueue`, `useMaintenanceHistory`, `useCampaigns`,
`useCatalog{Databases,Schemas,Snapshots,Tables,LiveTables,Table,TableHistory,IndexHistory,StatsHistory,TableEvents}`,
`useCatalogConfig`.
Mutations: `useSaveCatalogConfig`, `useCreateMaintenanceCommand` (force run_catalog/run_discovery),
`useCreateCampaign`, `useUpdateCampaign`, `useCancelCampaign` — đều invalidate `summary`/`campaigns`.

### API Endpoints (Fastify, `routes/`)

```
GET  /api/maintenance/summary                  ← window/budget + queue counts + last batch/scan + catalog status
GET  /api/maintenance/queue        ?cluster_id&status&action_type   (X-Total-Count)
GET  /api/maintenance/history      ?cluster_id&outcome
POST /api/maintenance/commands     {cluster_id, type: run_catalog|run_discovery}   → 202, enqueue maintenance_commands

GET  /api/maintenance/catalog/databases | schemas | snapshots | tables | table | table-history
       | table-index-history | table-stats-history | table-events | live-tables(proxy Layer1)
GET  /api/maintenance/catalog/config           ← scope hiện tại
PUT  /api/maintenance/catalog/config           ← full-replace scope (validate trùng (db,schema,table))

GET    /api/maintenance/campaigns  ?cluster_id&status    (X-Total-Count)
POST   /api/maintenance/campaigns  (rate-limit 10/min — validate scope vs catalog config, không chồng campaign active)
PUT    /api/maintenance/campaigns/:id   (status-aware: scope/execution_types chỉ khi pending; thresholds/window khi pending|active)
DELETE /api/maintenance/campaigns/:id   (rate-limit 5/min — cancel)
```

### Services (`services/`)

- `maintenance-service.ts` — summary (window VN-time + budget từ history, queue count buckets, catalog stale >25h), queue/history list.
- `catalog-service.ts` — đọc `maintenance_catalog` (tables/snapshots/trends), `putCatalogConfig` (validate + upsert scope).
- `campaign-service.ts` — CRUD `maintenance_campaigns`; normalize `CampaignThresholds` (grouped index/statistic/heap); validate ngày + scope + chống chồng campaign.
- `command-service.ts` — enqueue `maintenance_commands` (fire-and-forget trigger).

> **Quan trọng — đồng bộ với runner:** Campaign threshold là **grouped** (index/statistic/heap) ở cả
> `campaigns.schema.ts`, `campaign-service.ts`, `types/index.ts`, `CampaignForm.tsx` — khớp với Pydantic
> `CampaignThresholds` ở runner. Catalog scope là **đo lường thuần, KHÔNG chứa ngưỡng**.

---

## Pending — Keyword Highlighting (Option B)

Plan: `plan/upgrade-v2/highlight-keywords-plan.md`

Backtick convention: analyzer strings wrap identifier trong backtick (`` `TableName` ``, `` `NodeId=5` ``).
`_renderText()` trong component convert backtick → `<code class="pa-kw">`.

**Status:** Backtick convention đã áp dụng trong `operator_analyzer.py`, `wait_analyzer.py`.
Còn lại cần implement:
1. `.pa-kw` CSS style (light + dark)
2. `_renderText()` helper trong component
3. Áp dụng backtick vào 8 analyzer files còn lại

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn

**Status:** ✅ Fully Implemented (Fastify API + React SPA web-v2 + Plan Analysis UI + Maintenance UI)
