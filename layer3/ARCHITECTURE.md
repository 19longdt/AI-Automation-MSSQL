# ARCHITECTURE.md — Layer 3: Web UI Dashboard

## Mục đích

Web dashboard cho phép DBA:
- Xem findings, AI analyses, insights từ hệ thống giám sát
- Phân tích SQL execution plan XML (paste → visualize)
- Trigger actions (kill session) qua UI

---

## Kiến trúc tổng thể

```
Browser
    │
    │  HTTP (port 3000)
    ▼
┌───────────────────────────────────────────────────────────────────┐
│  Fastify server (Node.js)                                          │
│                                                                   │
│  Static files:                                                    │
│    /apps/web/pages/    → HTML pages                               │
│    /apps/web/css/      → CSS (base, dashboard, plan-analysis)     │
│    /dist/              → Compiled TypeScript → JS bundles         │
│    /assets/            → SSMS-style icons (SQL operator images)   │
│                                                                   │
│  Pages:                                                           │
│    GET /dashboard     → dashboard.html                            │
│    GET /insights      → insights.html                             │
│    GET /query-plan    → query-plan.html                           │
│                                                                   │
│  API routes:                                                      │
│    GET  /findings              ←── MongoDB (findings)             │
│    GET  /analyses              ←── MongoDB (ai_analyses)          │
│    GET  /insights              ←── MongoDB (issue_insights)       │
│    GET  /topics                ←── MongoDB (monitor_topics)       │
│    GET  /jobs                  ←── MongoDB (job_executions)       │
│    POST /actions               ──► Layer 1 HTTP API               │
│    POST /api/v1/plan/analyze   ──► Layer 2 FastAPI                │
│    GET  /health                                                   │
└───────────────────────────────────────────────────────────────────┘
    │                   │                        │
    │ Direct read       │ POST /kill-session      │ POST /api/v1/plan/analyze
    ▼                   ▼                        ▼
 MongoDB             Layer 1                  Layer 2
 (port 27017)       (port 8001)              (port 8000)
```

**Thiết kế:** Frontend không gọi MongoDB hay Layer 1/2 trực tiếp. Tất cả qua Fastify API — giúp thêm auth, rate limit, aggregation sau này mà không sửa frontend.

---

## Fastify Server — Startup Sequence

```
main.ts:
    1. Load AppConfig từ env vars
           L2_API_URL = http://layer2:8000
           MONGODB_URI = mongodb://mongodb:27017
           LOG_LEVEL, PORT (default 3000)

    2. MongoClient.connect(MONGODB_URI)
           mongoReady = true nếu connect thành công
           mongoReady = false nếu không (server vẫn start, API trả 503)

    3. createServer(config, db, mongoReady)
           Register CORS, static file handlers
           Register all API routes
           Decorate: getDb(), checkL2(), config, mongoReady

    4. app.listen({ port: 3000, host: "0.0.0.0" })
```

---

## API Routes — Chi tiết

### GET /findings
```typescript
FindingsService.getFindings({
    severity?: "critical" | "warning" | "info"
    issue_type?: string
    node?: string
    from?: ISO datetime
    to?: ISO datetime
    limit?: number (default 50, max 200)
    offset?: number
})
→ MongoDB: db.findings.find(filter).sort({ detected_at: -1 }).skip().limit()
→ { findings: Finding[], total: number }
```

### GET /analyses
```typescript
AnalysesService.getAnalyses({ finding_id?, limit? })
→ MongoDB: db.ai_analyses.find().sort({ created_at: -1 })
→ { analyses: AnalysisResult[] }
```

### GET /insights
```typescript
InsightsService.getInsights({ issue_type?, node?, limit? })
→ MongoDB: db.issue_insights.find().sort({ last_seen: -1 })
→ { insights: IssueInsight[] }
```

### POST /actions
```typescript
{ action: "kill_session", session_id: number, node?: string }
→ fetch(`http://layer1:8001/kill-session`, { body: { session_id } })
→ Trả lại response từ Layer 1
```

### POST /api/v1/plan/analyze
```typescript
// Proxy sang Layer 2
{ plan_xml: string, source?: "ui" | "layer1" }
→ fetch(`${L2_API_URL}/api/v1/plan/analyze`, body)
→ PlanAnalysisOutput | ToolSnapshot
```

---

## Frontend — TypeScript Components

Compiled TypeScript (không có framework) — tất cả components là plain classes.

### Build System

```
TypeScript source: apps/web/dashboard/*.ts
    ↓ tsc (tsconfig.json)
Compiled JS: dist/*.js
    ↓ Fastify static serve
Browser: <script src="/dist/plan-analysis-component.js">
```

### PlanAnalysisComponent (query-plan.html)

Component chính visualize XML execution plan — phức tạp nhất trong Layer 3.

```
new PlanAnalysisComponent(rootEl, planAnalysisResult)
    .render()
    │
    ├── _buildHtml():
    │       s = result.statements[activeStatement]
    │       │
    │       ├── Group ORIENTATION:
    │       │     _section("Query Text"):   <pre> với formatted SQL
    │       │     _section("Warnings"):     _buildWarningsSection(s)
    │       │
    │       ├── Group COST ANALYSIS:
    │       │     _section("Top Expensive"):  _buildTopExpensiveSection(s)
    │       │     _section("Est vs Actual"):  _buildEstActualSectionBalanced(s)
    │       │     _section("I/O Statistics"): _buildIoSection(s)
    │       │
    │       ├── Group ACTIONABLE:
    │       │     _section("Missing Indexes"):  _buildIndexesSection(s)
    │       │     _section("Statistics Used"):  _buildStatsSection(s)
    │       │     _section("Parameters"):       _buildParametersSection(s)
    │       │
    │       ├── Group CONTEXT:
    │       │     _section("Indexes Used"):       _buildIndexesUsedSection(s)
    │       │     _section("Join Types"):         _buildJoinTypesSection(s)
    │       │     _section("Memory Grant"):       _buildMemorySectionBalanced(s)
    │       │     _section("Wait Statistics"):    _buildWaitsSection(s)
    │       │
    │       └── Group DEEP DIVE:
    │             _section("Compilation"):     _buildCompilationSection(s)
    │             _section("Lookup Queries"):  _buildLookupQueriesSection(s)
    │
    ├── _buildSummaryBar():
    │       Row 1: [ELAPSED ms] [CPU ms] [DOP] [COST] [CE MODEL] [N STATEMENTS]
    │       Divider ─────────────────────
    │       Row 2: [TOP WAIT type + class-colored] [WAIT TIME ms] [⚠ N warnings]
    │
    ├── _bindEvents():
    │       statement tabs → switch activeStatement → re-render
    │       group header click → toggle body collapse/expand
    │       section header click → toggle section collapse/expand
    │
    └── attachGlossaryTooltips(root)
            Scan [data-glossary] elements → append ? button → tooltip on hover
```

#### FindingGroup Rendering

```
_buildWarningsSection(s):
    for group in s.finding_groups:
        severity badge: critical(red) / warning(yellow) / info(blue)
        warn label: _warnLabel(group.type)         ← human-readable name
        warn accent: _warnCat(group.type)           ← màu accent (spill/perf/parallel/index/stats)
        count badge: ×N (nếu count > 1)
        recommendation: group.recommendation

        instances (collapse/expand nếu > 1):
            • group.instances[i].description
```

#### Est vs Actual Rows — Sorting

```
_buildEstActualSectionBalanced(s):
    operators_with_off = s.top_operators.filter(o => o.has_row_est_off)
    Sort by: max(ratio, 1/ratio) DESC  ← worst estimate first
    Display: NodeId, operator, table, Estimate, Actual, Ratio
        ratio ≥ 10: "+Nx" (underestimate, đỏ)
        ratio ≤ 0.1: "÷Nx" (overestimate, cam)
```

---

## Glossary System

### glossary.ts — Data store

```typescript
const GLOSSARY: Record<string, string> = {
    // SQL operators
    "op_sort":           "...",
    "op_hash_match":     "...",
    "op_nested_loops":   "...",
    "op_index_seek":     "...",
    "op_key_lookup":     "...",
    ...

    // Wait types
    "wait_lck":          "...",
    "memory_allocation_ext": "...",
    "hadr_sync_commit":  "...",
    "pagelatch_sh":      "...",
    ...

    // Plan groups
    "group_orientation": "...",
    "group_cost":        "...",
    "group_actionable":  "...",
    "group_context":     "...",
    "group_deepdive":    "...",

    // Summary fields
    "elapsed_time":      "...",
    "cpu_time":          "...",
    "dop":               "...",
    "ce_model":          "...",
    ...
}
// 70+ entries tổng
```

### glossary-tooltip.ts — Auto-attach

```typescript
attachGlossaryTooltips(root: HTMLElement):
    root.querySelectorAll("[data-glossary]").forEach(el => {
        const key = el.getAttribute("data-glossary")
        const text = GLOSSARY[key]
        if (!text) return
        const btn = create <button class="pa-glossary-btn">?</button>
        el.appendChild(btn)
        btn.addEventListener("mouseenter", showTooltip(text))
        btn.addEventListener("mouseleave", removeTooltip)
    })

removeTooltip():
    document.querySelector(".pa-tooltip")?.remove()
```

**Naming convention `data-glossary`:**
- Operators: `op_sort`, `op_hash_match`, `op_index_seek`, ...
- Wait types: `memory_allocation_ext`, `hadr_sync_commit`, ...
- Groups: `group_orientation`, `group_cost`, ...
- Summary: `elapsed_time`, `cpu_time`, `dop`, `total_cost`, ...

---

## CSS Architecture

### File Structure

```
css/
├── base.css          ← CSS custom properties, reset, typography
│                        :root { --group-color-* }
│                        :root[data-theme="dark"] { overrides }
├── dashboard.css     ← Dashboard page layout
├── stats-cards.css   ← Stats card grid components
├── query-plan.css    ← SSMS-style XML plan viewer (legacy qp.js)
└── plan-analysis.css ← Plan analysis component (PlanAnalysisComponent)
```

### CSS Variables — Group Colors

```css
/* base.css — light mode */
:root {
    --group-color-orientation: #2563eb;   /* blue */
    --group-color-cost:        #7c3aed;   /* purple */
    --group-color-actionable:  #dc2626;   /* red */
    --group-color-context:     #0891b2;   /* cyan */
    --group-color-deepdive:    #64748b;   /* slate */
}

/* base.css — dark mode override */
:root[data-theme="dark"] {
    --group-color-orientation: #60a5fa;
    --group-color-cost:        #a78bfa;
    --group-color-actionable:  #f87171;
    --group-color-context:     #22d3ee;
    --group-color-deepdive:    #94a3b8;
}
```

### Key CSS Classes (plan-analysis.css)

```
Layout:
  .pa-root                 ← Component container
  .pa-summary              ← Summary bar (flex-column)
  .pa-sum-row              ← Row 1: plan characteristics
  .pa-sum-row-2            ← Row 2: runtime signals (wait, perf)
  .pa-sum-divider          ← Separator giữa 2 rows

Groups:
  .pa-group                ← Section group wrapper
  .pa-group-header         ← Header: dot + label + description + badge + chevron
  .pa-group-dot            ← Màu dot (variant: --orientation, --cost, --actionable, ...)
  .pa-group-badge          ← Count of sections với data
  .pa-group-body           ← Collapsible, open/closed state

Findings (Warnings):
  .pa-finding-group        ← One FindingGroup
  .pa-finding-count        ← ×N badge (nếu count > 1)
  .pa-finding-instances    ← Collapse/expand list
  .pa-finding-inst         ← One instance row
  .pa-warn-accent--spill   ← Màu accent: spill/perf/parallel/index/stats
  .pa-warn-accent--perf
  .pa-warn-accent--parallel
  .pa-warn-accent--index
  .pa-warn-accent--stats

Wait:
  .pa-wait-red             ← LCK_M_*, HADR_SYNC_COMMIT, THREADPOOL
  .pa-wait-orange          ← MEMORY_ALLOCATION_EXT, PAGELATCH_*
  .pa-wait-blue            ← CXPACKET, CXCONSUMER
  .pa-wait-yellow          ← PAGEIOLATCH*, WRITELOG, default
  .pa-wait-green           ← no wait
```

---

## TypeScript Types (`packages/core/src/types/plan-analysis.ts`)

Mirror chính xác Python models. Mọi thay đổi Python model phải sync tay vào đây.

```typescript
// Mapping chính:
Python: FindingGroup        → TS: FindingGroup
Python: FindingInstance     → TS: FindingInstance
Python: StatementResult     → TS: StatementResult
Python: OperatorSummary     → TS: OperatorSummary
Python: PlanAnalysisResult  → TS: PlanAnalysisResult
Python: WaitStatSummary     → TS: WaitStatSummary
Python: IndexSuggestion     → TS: IndexSuggestion

// QUAN TRỌNG: findings: PlanFinding[] đã bị XÓA
// Thay bằng: finding_groups: FindingGroup[]
// Code cũ dùng s.findings phải chuyển sang:
//   s.finding_groups.reduce((acc, g) => acc + g.count, 0)
```

---

## Pages

### /dashboard (dashboard.html + dashboard.ts)

```
Load on init:
    GET /findings?severity=critical&limit=20
    GET /topics
    GET /jobs?limit=10
    GET /analyses?limit=5

Features:
    - Findings table: filter by severity/topic/node
    - Topic status grid: enabled/disabled, last run, schedule
    - Job execution history
    - Recent AI analyses (cost, status, duration)
    - Kill session action → POST /actions
```

### /insights (insights.html + insights.ts)

```
Load on init:
    GET /insights

Features:
    - Issue insights table: root_cause, recurrence_count, last_seen
    - Filter by issue_type, node
    - Action items per insight
```

### /query-plan (query-plan.html)

```
Two modes:
    1. SSMS-style XML viewer (legacy qp.js + qp.xslt)
           Paste XML → XSLT transform → HTML tree view
           SSMS-style icons cho operators

    2. Plan Analysis (PlanAnalysisComponent)
           Paste XML → POST /api/v1/plan/analyze → PlanAnalysisComponent.render()
           5 groups, glossary tooltips, finding groups
```

---

## Key Design Decisions

| Quyết định | Lý do |
|---|---|
| **Vanilla TypeScript, không framework** | Bundle nhỏ, không dependency hell, dễ debug; dashboard không đủ phức tạp cần React/Vue |
| **Fastify thay Express** | Nhanh hơn, typed plugins, native schema validation |
| **MongoDB direct read từ Fastify** | Không cần Layer 1/2 làm proxy cho read-only queries |
| **Layer 2 proxy qua Fastify** | Thêm auth/rate limit sau này mà không sửa frontend |
| **data-glossary attribute + auto-attach** | Không wiring manual — component render xong, `attachGlossaryTooltips` scan toàn bộ |
| **CSS variables cho group colors** | Light/dark mode swap 1 chỗ, component không cần biết theme |
| **FindingGroup thay Finding[]** | Tránh duplicate recommendation; count badge thể hiện scope vấn đề |
| **5 groups theo thứ tự ưu tiên** | ORIENTATION trước (context) → ACTIONABLE (quick wins) → DEEP DIVE (advanced) |
| **2-row summary bar** | Row 1 = plan characteristics (static); Row 2 = runtime signals (wait, perf) |
| **Warning count = sum(group.count)** | `warning_count` field chỉ đếm WARNING severity; bỏ sót CRITICAL và INFO |

---

## Pending — Keyword Highlighting (Option B)

Backtick convention: analyzer strings wrap identifiers với backtick (`` `TableName` ``, `` `NodeId=5` ``).

```
Plan: plan/upgrade-v2/highlight-keywords-plan.md

Status:
    ✅ Backtick convention: operator_analyzer.py, wait_analyzer.py
    ❌ .pa-kw CSS style chưa có
    ❌ _renderText() helper trong component chưa có
    ❌ 8 analyzer files còn lại chưa áp dụng backtick
```

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
