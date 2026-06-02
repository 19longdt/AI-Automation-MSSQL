# CLAUDE.md — Layer 3: Web UI Dashboard

## Mục đích

Web UI dashboard cho hệ thống giám sát MSSQL, gồm:
- **Dashboard**: Theo dõi findings, metrics real-time
- **Insights**: Tổng hợp issue insights từ AI analysis
- **Query Plan**: Phân tích và visualize SQL execution plan

**Stack:** Node.js/TypeScript (API backend) + Vanilla TypeScript (frontend) + nginx (static serve)

---

## Kiến trúc

```
Browser
    │ HTTP
    ▼
nginx (static files: HTML/CSS/JS)
    │ /api/*  proxy
    ▼
apps/api (Express.js — port 3000)
    │ MongoDB reads (direct)
    │ /api/v1/* proxy
    ▼
layer2 (FastAPI — port 8000)
```

- Frontend **không gọi trực tiếp Layer 2** — qua Express proxy để thêm auth, aggregation
- Express API đọc MongoDB trực tiếp (findings, insights, topics, jobs) — không qua Layer 1/2
- Plan analysis route (`/api/v1/plan/analyze`) proxy sang Layer 2

---

## Cấu trúc Module

```
layer3/
├── apps/
│   ├── api/                       ← Express.js backend
│   │   └── src/
│   │       ├── main.ts            ← Entry point
│   │       ├── server.ts          ← Express app factory + route registration
│   │       ├── config.ts          ← Layer3Settings (env vars)
│   │       ├── db/
│   │       │   ├── client.ts      ← MongoClient singleton
│   │       │   └── collections.ts ← Collection accessors (typed)
│   │       ├── proxy/
│   │       │   └── l2-proxy.ts    ← Proxy /api/v1/* sang Layer 2 URL
│   │       ├── routes/
│   │       │   ├── findings.ts    ← GET /findings (list + pagination)
│   │       │   ├── analyses.ts    ← GET /analyses
│   │       │   ├── insights.ts    ← GET /insights
│   │       │   ├── topics.ts      ← GET /topics
│   │       │   ├── jobs.ts        ← GET /jobs
│   │       │   ├── actions.ts     ← POST /actions (kill session, etc.)
│   │       │   ├── plan.ts        ← POST /api/v1/plan/analyze → proxy Layer 2
│   │       │   └── health.ts      ← GET /health
│   │       └── services/
│   │           ├── findings-service.ts            ← Query findings với filter/pagination
│   │           ├── findings-diagnostics-service.ts ← finding_diagnostics MongoDB lookup
│   │           ├── analyses-service.ts            ← ai_analyses query
│   │           ├── insights-service.ts            ← issue_insights query
│   │           ├── topics-service.ts              ← monitor_topics query
│   │           ├── jobs-service.ts                ← job_executions query
│   │           └── time-filter.ts                 ← Build MongoDB time range filter
│   │
│   └── web/                       ← Frontend (Vanilla TypeScript, no framework)
│       ├── pages/
│       │   ├── dashboard.html     ← Trang chính: findings + metrics
│       │   ├── insights.html      ← AI insights summary
│       │   └── query-plan.html    ← SQL execution plan analysis
│       ├── css/
│       │   ├── base.css           ← CSS variables (light/dark), reset, typography
│       │   │                        --group-color-* cho plan analysis groups
│       │   ├── dashboard.css      ← Dashboard layout
│       │   ├── stats-cards.css    ← Stats card components
│       │   ├── query-plan.css     ← Query plan XML viewer (SSMS-style)
│       │   └── plan-analysis.css  ← Plan analysis component styles
│       └── dashboard/             ← TypeScript components (compiled → JS)
│           ├── dashboard.ts       ← Dashboard page logic
│           ├── insights.ts        ← Insights page logic
│           ├── api-client.ts      ← Fetch wrapper cho Express API
│           ├── modal.ts           ← Modal dialog component
│           ├── loading-overlay.ts ← Loading state component
│           ├── glossary.ts        ← Glossary data store (70+ entries)
│           ├── glossary-tooltip.ts ← attachGlossaryTooltips() — tự động gắn tooltip vào [data-glossary]
│           └── plan-analysis-component.ts ← PlanAnalysisComponent — render PlanAnalysisOutput
│
└── packages/
    └── core/
        └── src/
            └── types/
                └── plan-analysis.ts  ← TypeScript types mirror Python models:
                                         FindingInstance, FindingGroup, StatementResult,
                                         PlanAnalysisResult, OperatorSummary, ...
```

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
| **Express proxy thay vì gọi Layer 2 trực tiếp** | Cho phép thêm auth, rate limit, aggregation sau này |
| **5 groups thay vì flat list** | Ưu tiên hóa thông tin: DBA đọc ORIENTATION trước, ACTIONABLE sau |
| **`data-glossary` attribute + auto-attach** | Không cần manual wiring từng tooltip — scan DOM một lần sau render |
| **CSS variables cho group colors** | Light/dark mode override 1 chỗ — component không cần biết mode |
| **`finding_groups` thay `findings[]`** | Tránh duplicate recommendation khi nhiều operator cùng loại lỗi |
| **FindingGroup grouped by `type` (không phải recommendation)** | Recommendation thường chứa tên bảng → mỗi cái unique, không group được |
| **2-row summary bar** | Row 1 = plan characteristics; Row 2 = runtime signals (wait, perf) |
| **Warning count = sum(group.count), không warning_count field** | `warning_count` chỉ đếm WARNING severity, bỏ sót CRITICAL + INFO |

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

**Status:** ✅ Fully Implemented (Express API + TypeScript frontend + Plan Analysis UI)
