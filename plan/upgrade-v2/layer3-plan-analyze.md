# Plan: Layer 3 — Plan Analysis Component

> **Mục tiêu:** Thêm nút "Analyze" cạnh "Show Plan XML". Kết quả render qua `PlanAnalysisComponent` —  
> component độc lập, dùng được trong modal, standalone page, hoặc embedded bất kỳ đâu.  
> **Tham khảo UI:** https://www.mssql.ee/tools/sql-plan-parser.html (phần output)  
> **Phụ thuộc:** Layer 2 `POST /api/v1/plan/analyze` (plan từ `layer2-analyze.md`)

---

## 1. Bối Cảnh

### Trigger point hiện tại

`dashboard.ts` line 675 — callback `onShowPlanXml` trong `qpObj.bindQueryActions()`:

```typescript
onShowPlanXml: function () { ... }      // ← thêm "Analyze" cạnh đây
onOpenQueryPopup: function () { ... }
onCopyPlanXml: function () { ... }
```

Plan XML lấy từ: `getCurrentXml()` → `data-current-plan-xml` trên planBox.

### Cơ sở hạ tầng sẵn có

| Có sẵn | Dùng cho |
|---|---|
| `openModal(title, html)` trong `modal.ts` | Host component trong modal |
| `apiPost(path, payload)` trong `api-client.ts` | Gọi backend Layer 3 |
| `postJsonWithTimeout()` trong `l2-proxy.ts` | Backend proxy sang Layer 2 |
| `withButtonLoading(btn, fn)` | Loading state nút Analyze |
| `config.l2ApiUrl` trong `config.ts` | URL Layer 2 |

---

## 2. Kiến Trúc Component

### Nguyên tắc

`PlanAnalysisComponent` là **self-contained** — nhận `HTMLElement` container và `PlanAnalysisResult` data, tự render và bind events bên trong container đó. Không phụ thuộc vào modal, dashboard, hay bất kỳ context nào bên ngoài.

```
PlanAnalysisResult (data)
        │
        ▼
PlanAnalysisComponent(root: HTMLElement, result: PlanAnalysisResult)
  .render()   → ghi HTML vào root, bind events
  .destroy()  → xoá HTML, cleanup listeners

Use cases:
  1. Modal          → openModal(...) + mount vào #pa-root
  2. Standalone page → plan-analysis.html mount vào #app
  3. Embedded       → mount vào container bất kỳ trong finding detail
```

### Class API

```typescript
// apps/web/dashboard/plan-analysis-component.ts

export class PlanAnalysisComponent {
  constructor(
    private readonly root: HTMLElement,
    private readonly result: PlanAnalysisResult,
  ) {}

  render(): void {
    this.root.innerHTML = this._buildHtml();
    this._bindEvents();
  }

  destroy(): void {
    this.root.innerHTML = "";
  }

  // Private — rendering
  private _buildHtml(): string
  private _buildSummaryBar(): string
  private _buildTabBar(stmt: StatementResult): string
  private _buildFindingsPanel(stmt: StatementResult): string
  private _buildOperatorsPanel(stmt: StatementResult): string
  private _buildIndexesPanel(stmt: StatementResult): string
  private _buildMemoryPanel(stmt: StatementResult): string
  private _buildWaitsPanel(stmt: StatementResult): string
  private _buildParamsPanel(stmt: StatementResult): string

  // Private — events (scoped vào this.root, không dùng document.querySelector global)
  private _bindEvents(): void
  private _bindTabSwitching(): void
  private _bindCopyDdl(): void
}
```

> **Lý do scoped events:** `this.root.querySelectorAll(...)` thay vì `document.querySelectorAll(...)` — nhiều instance component có thể tồn tại cùng lúc trên 1 trang mà không conflict.

---

## 3. Cấu Trúc File

```
Layer 3 API (Express)               Layer 3 Frontend (TypeScript)
─────────────────────               ──────────────────────────────
apps/api/src/routes/                apps/web/dashboard/
  plan.ts             ← MỚI          plan-analysis-component.ts  ← MỚI (core component)
                                      dashboard.ts                ← SỬA (thêm callback)
apps/api/src/
  server.ts           ← SỬA        apps/web/pages/
  (register route)                    plan-analysis.html          ← MỚI (standalone page)
                                      plan-analysis.ts            ← MỚI (standalone entry)

packages/core/src/types/            apps/web/css/
  plan-analysis.ts    ← MỚI          plan-analysis.css           ← MỚI (CSS riêng)
```

> **CSS riêng `plan-analysis.css`** — import được vào dashboard.html, plan-analysis.html, hoặc bất kỳ page nào host component.

---

## 4. Backend — `apps/api/src/routes/plan.ts`

```typescript
import { FastifyInstance } from "fastify";
import { postJsonWithTimeout } from "../proxy/l2-proxy.js";

export async function planRoutes(app: FastifyInstance) {
  app.post("/api/plan/analyze", async (req, reply) => {
    const { plan_xml } = req.body as { plan_xml: string };

    if (!plan_xml?.trim()) {
      return reply.status(400).send({ error: "plan_xml is required" });
    }

    const result = await postJsonWithTimeout(
      `${app.config.l2ApiUrl}/api/v1/plan/analyze`,
      { plan_xml, source: "layer3" },
      10_000,
    );

    return reply.send(result);
  });
}
```

Đăng ký trong `server.ts`:
```typescript
import { planRoutes } from "./routes/plan.js";
app.register(planRoutes);
```

---

## 5. Component — `plan-analysis-component.ts`

### 5.1 render() — entry point

```typescript
render(): void {
  // Multi-statement: render từng statement trong accordion hoặc tabs cấp 1
  // Single-statement (thường gặp): render trực tiếp không có wrapper
  const stmts = this.result.statements;

  this.root.innerHTML = stmts.length === 1
    ? this._buildSingleStatement(stmts[0])
    : this._buildMultiStatement(stmts);

  this._bindEvents();
}

private _buildSingleStatement(stmt: StatementResult): string {
  return `
    ${this._buildSummaryBar()}
    ${this._buildTabBar(stmt)}
    ${this._buildAllPanels(stmt)}
  `;
}
```

### 5.2 Summary Bar

```
⏱ 45ms   |   1 statement   |   🔴 1 Critical   🟡 2 Warning   🔵 1 Info
```

```typescript
private _buildSummaryBar(): string {
  const r = this.result;
  return `
    <div class="pa-summary">
      <span class="pa-summary-item">⏱ ${r.analysis_duration_ms}ms</span>
      <span class="pa-summary-sep">|</span>
      <span class="pa-summary-item">${r.statements.length} statement${r.statements.length > 1 ? "s" : ""}</span>
      <span class="pa-summary-sep">|</span>
      ${r.critical_count > 0 ? `<span class="pa-sev critical">🔴 ${r.critical_count} Critical</span>` : ""}
      ${r.warning_count  > 0 ? `<span class="pa-sev warning">🟡 ${r.warning_count} Warning</span>`  : ""}
      ${r.has_actual_stats ? `<span class="pa-actual-badge">Actual Plan</span>` : `<span class="pa-est-badge">Estimated</span>`}
    </div>
  `;
}
```

### 5.3 Tab Bar

Tabs ẩn động khi không có data:

```typescript
private _buildTabBar(stmt: StatementResult): string {
  const tabs: Array<{ id: string; label: string; count?: number; hide?: boolean }> = [
    { id: "findings",  label: "Findings",  count: stmt.findings.length },
    { id: "operators", label: "Operators", count: stmt.top_operators.length },
    { id: "indexes",   label: "Indexes",   count: stmt.missing_indexes.length, hide: stmt.missing_indexes.length === 0 },
    { id: "memory",    label: "Memory",    hide: stmt.memory_grant === null },
    { id: "waits",     label: "Waits",     count: stmt.wait_stats.length, hide: stmt.wait_stats.length === 0 },
    { id: "params",    label: "Parameters",count: stmt.parameters.length, hide: stmt.parameters.length === 0 },
  ];

  return `
    <div class="pa-tabs" role="tablist">
      ${tabs.filter(t => !t.hide).map((t, i) => `
        <button class="pa-tab ${i === 0 ? "active" : ""}"
                role="tab" data-tab="${t.id}">
          ${t.label}
          ${t.count !== undefined ? `<span class="pa-tab-badge">${t.count}</span>` : ""}
        </button>
      `).join("")}
    </div>
  `;
}
```

### 5.4 _bindEvents() — scoped vào this.root

```typescript
private _bindEvents(): void {
  this._bindTabSwitching();
  this._bindCopyDdl();
}

private _bindTabSwitching(): void {
  const tabs   = this.root.querySelectorAll<HTMLElement>(".pa-tab");
  const panels = this.root.querySelectorAll<HTMLElement>(".pa-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach(t   => t.classList.remove("active"));
      panels.forEach(p => p.classList.add("hidden"));
      tab.classList.add("active");
      this.root.querySelector(`#pa-panel-${tab.dataset.tab}`)?.classList.remove("hidden");
    });
  });
}

private _bindCopyDdl(): void {
  this.root.querySelectorAll<HTMLElement>("[data-copy-ddl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copyDdl ?? "");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = orig), 1500);
    });
  });
}
```

---

## 6. Layout Từng Tab

### 6.1 Findings

```
┌─────────────────────────────────────────────────────┐
│ 🔴 CRITICAL  [operator]  key_lookup                 │
├─────────────────────────────────────────────────────┤
│ Key Lookup trên dbo.Orders chiếm ~45% estimated     │
│ cost. Columns cần fetch: Status, TotalAmount.       │
│                                                     │
│ ▸ Recommendation                                    │
│   Thêm Status, TotalAmount vào INCLUDE list...     │
│                                                     │
│ ▸ Action — create_index                             │
│ ┌───────────────────────────────────────────────┐   │
│ │ CREATE NONCLUSTERED INDEX [IX_...]            │   │
│ │ ON [dbo].[Orders] ([CustomerId])              │   │
│ │ INCLUDE ([Status], [TotalAmount]);            │ [Copy DDL]
│ └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Severity colors: `critical` #dc2626 · `warning` #d97706 · `info` #2563eb

### 6.2 Operators

Bảng — cột actual hiển thị `—` khi `has_actual_stats = false`:

| Node | Operator | Table | Cost % | Est Rows | Act Rows | Elapsed ms | Logical Reads |
|---|---|---|---|---|---|---|---|
| 5 | Key Lookup | dbo.Orders | **45.2%** | 1,500 | 1,489 | 3,200 | 89,432 |

Cost % ≥ 30% → đỏ, 15–29% → cam.

### 6.3 Missing Indexes

```
┌─────────────────────────────────────────────────────┐
│ dbo.Orders                                          │
│ Impact: ████████████████░░░░  78.5%                 │
├─────────────────────────────────────────────────────┤
│ Key:     CustomerId, OrderDate                      │
│ Include: Status, TotalAmount                        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ CREATE NONCLUSTERED INDEX ...                   │ [Copy DDL]
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Impact bar: ≥ 70% đỏ · 40–69% cam · < 40% xanh.

### 6.4 Memory

```
┌─────────────────────────────────────┐
│ Requested   512 MB                  │
│ Granted     512 MB                  │
│ Max Used    480 MB  ████████████ 93%│  ← đỏ nếu > 90%
│ Grant Wait  0 ms                    │
└─────────────────────────────────────┘
```

### 6.5 Waits / Parameters

Bảng đơn giản — ẩn tab nếu data rỗng. Parameters thêm cột "Sniffed?" ⚠️ khi compiled ≠ runtime.

---

## 7. Sử Dụng Component — 3 Contexts

### 7.1 Trong Modal (dashboard.ts)

```typescript
// Callback trong bindExecutionPlanActions()
onAnalyzePlan: async function (btn: HTMLButtonElement) {
  const xml = getCurrentXml();
  if (!xml?.trim()) return;

  await withButtonLoading(btn, async () => {
    try {
      const result: PlanAnalysisResult = await apiPost("/api/plan/analyze", { plan_xml: xml });

      // Modal chỉ cung cấp container — component tự lo phần còn lại
      openModal("Plan Analysis", `<div id="pa-root"></div>`);
      new PlanAnalysisComponent(
        document.getElementById("pa-root")!,
        result,
      ).render();

    } catch (err) {
      openModal("Plan Analysis — Error", `
        <div class="pa-error">
          <p>Không thể phân tích plan. Kiểm tra Layer 2 đang chạy.</p>
          <pre>${String(err)}</pre>
        </div>
      `);
    }
  });
},
```

### 7.2 Standalone Page (`plan-analysis.html` + `plan-analysis.ts`)

Dùng khi muốn mở toàn trang từ link, hoặc sau này embed vào iframe.

```html
<!-- apps/web/pages/plan-analysis.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Plan Analysis</title>
  <link rel="stylesheet" href="../css/base.css">
  <link rel="stylesheet" href="../css/plan-analysis.css">
</head>
<body>
  <div class="page-header">
    <h2>Plan Analysis</h2>
    <a href="dashboard.html">← Back</a>
  </div>
  <div id="pa-root" class="pa-page-root"></div>
  <script type="module" src="../dashboard/plan-analysis.ts"></script>
</body>
</html>
```

```typescript
// apps/web/dashboard/plan-analysis.ts — standalone entry
import { PlanAnalysisComponent } from "./plan-analysis-component.js";

// Nhận result từ sessionStorage (dashboard set trước khi navigate)
// hoặc từ URL param ?finding_id=... rồi fetch
const raw = sessionStorage.getItem("pa_result");
if (raw) {
  const result = JSON.parse(raw);
  new PlanAnalysisComponent(document.getElementById("pa-root")!, result).render();
}
```

Dashboard trigger để mở standalone page:
```typescript
// Thêm nút "Open in Page" cạnh "Analyze" nếu muốn full-page view
sessionStorage.setItem("pa_result", JSON.stringify(result));
window.open("plan-analysis.html", "_blank");
```

### 7.3 Embedded (finding detail panel)

```typescript
// Trong openFindingDetailModal() — nếu finding có plan XML
if (finding.plan_xml) {
  const result = await apiPost("/api/plan/analyze", { plan_xml: finding.plan_xml });
  const container = document.createElement("div");
  container.className = "pa-embedded";
  detailPanel.appendChild(container);
  new PlanAnalysisComponent(container, result).render();
}
```

---

## 8. CSS — `plan-analysis.css`

File riêng, import vào bất kỳ page nào dùng component:

```css
/* Root */
.pa-root, .pa-page-root { font-size: 13px; color: #1e293b; }
.pa-page-root { max-width: 1200px; margin: 0 auto; padding: 24px; }
.pa-embedded  { border-top: 1px solid #e5e7eb; margin-top: 16px; padding-top: 16px; }

/* Summary bar */
.pa-summary { display: flex; align-items: center; gap: 12px; padding: 8px 0 12px; flex-wrap: wrap; }
.pa-summary-sep { color: #cbd5e1; }
.pa-sev.critical { color: #dc2626; font-weight: 600; }
.pa-sev.warning  { color: #d97706; font-weight: 600; }
.pa-actual-badge { font-size: 11px; background: #dcfce7; color: #16a34a; border-radius: 10px; padding: 1px 8px; }
.pa-est-badge    { font-size: 11px; background: #f1f5f9; color: #64748b; border-radius: 10px; padding: 1px 8px; }

/* Tabs */
.pa-tabs { display: flex; gap: 2px; border-bottom: 2px solid #e5e7eb; margin-bottom: 16px; }
.pa-tab  { padding: 6px 14px; background: none; border: none; border-bottom: 2px solid transparent;
           margin-bottom: -2px; cursor: pointer; font-size: 13px; color: #64748b; }
.pa-tab:hover  { color: #1e293b; }
.pa-tab.active { color: #1e40af; border-bottom-color: #1e40af; font-weight: 600; }
.pa-tab-badge  { background: #e2e8f0; color: #475569; border-radius: 10px;
                 padding: 0 6px; font-size: 11px; margin-left: 4px; }
.pa-tab.active .pa-tab-badge { background: #dbeafe; color: #1e40af; }

/* Panels */
.pa-panel.hidden { display: none; }

/* Finding card */
.pa-finding-card   { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
.pa-finding-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f8fafc; }
.pa-finding-body   { padding: 10px 14px; }
.pa-badge          { font-size: 11px; font-weight: 700; padding: 2px 8px;
                     border-radius: 10px; text-transform: uppercase; }
.pa-badge.critical { background: #fee2e2; color: #dc2626; }
.pa-badge.warning  { background: #fef3c7; color: #d97706; }
.pa-badge.info     { background: #dbeafe; color: #2563eb; }
.pa-category-tag   { font-size: 11px; color: #6b7280; border: 1px solid #e5e7eb;
                     border-radius: 4px; padding: 1px 6px; }
.pa-recommendation { color: #475569; margin-top: 6px; }
.pa-action-label   { font-size: 11px; font-weight: 600; color: #64748b;
                     text-transform: uppercase; margin-top: 10px; margin-bottom: 4px; }

/* DDL block */
.pa-ddl-wrap { position: relative; }
.pa-ddl      { background: #0f172a; color: #e2e8f0; border-radius: 4px; padding: 10px 12px;
               font-family: 'Consolas', monospace; font-size: 12px;
               white-space: pre; overflow-x: auto; }
.pa-ddl-copy { position: absolute; top: 6px; right: 8px; font-size: 11px;
               background: #1e293b; color: #94a3b8; border: 1px solid #334155;
               border-radius: 3px; padding: 2px 8px; cursor: pointer; }
.pa-ddl-copy:hover { background: #334155; color: #e2e8f0; }

/* Table */
.pa-table           { width: 100%; border-collapse: collapse; font-size: 12px; }
.pa-table th        { background: #f1f5f9; padding: 6px 10px; text-align: left;
                      font-weight: 600; white-space: nowrap; }
.pa-table td        { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; }
.pa-table .num      { text-align: right; font-variant-numeric: tabular-nums; }
.pa-table .high     { color: #dc2626; font-weight: 600; }
.pa-table .mid      { color: #d97706; }
.pa-table .na       { color: #cbd5e1; }

/* Memory */
.pa-memory-grid { display: grid; grid-template-columns: 120px 1fr; gap: 8px 16px; align-items: center; }
.pa-memory-label { color: #64748b; font-size: 12px; }
.pa-bar-wrap { background: #e5e7eb; border-radius: 4px; height: 8px; }
.pa-bar      { height: 8px; border-radius: 4px; min-width: 4px; }
.pa-bar.danger  { background: #dc2626; }
.pa-bar.warning { background: #d97706; }
.pa-bar.ok      { background: #16a34a; }

/* Impact bar */
.pa-impact-wrap { display: flex; align-items: center; gap: 8px; }
.pa-impact-bar-bg { background: #e5e7eb; border-radius: 4px; height: 6px; width: 100px; }
.pa-impact-bar   { height: 6px; border-radius: 4px; }
.pa-impact-bar.high { background: #dc2626; }
.pa-impact-bar.mid  { background: #d97706; }
.pa-impact-bar.low  { background: #2563eb; }

/* Index card */
.pa-index-card   { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px; padding: 12px 14px; }
.pa-index-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pa-index-table  { font-size: 12px; color: #64748b; }
.pa-index-table td { padding: 1px 8px 1px 0; }

/* Error state */
.pa-error { padding: 16px; background: #fef2f2; border: 1px solid #fecaca;
            border-radius: 6px; color: #991b1b; }
.pa-error pre { font-size: 11px; margin-top: 8px; white-space: pre-wrap; }

/* Analyze button in QP toolbar */
.qp-btn-analyze { background: #1e40af; color: white; border: none; border-radius: 4px;
                  padding: 4px 12px; cursor: pointer; font-size: 12px; margin-left: 4px; }
.qp-btn-analyze:hover    { background: #1d4ed8; }
.qp-btn-analyze:disabled { opacity: 0.6; cursor: not-allowed; }
```

---

## 9. Type Definitions — `packages/core/src/types/plan-analysis.ts`

```typescript
export type Severity = "critical" | "warning" | "info";
export type ActionType = "create_index" | "rewrite_query" | "update_stats" | "config";

export interface PlanAction {
  type: ActionType;
  ddl: string | null;
  description: string;
}

export interface PlanFinding {
  severity: Severity;
  category: string;
  type: string;
  description: string;
  recommendation: string;
  action: PlanAction | null;
}

export interface OperatorSummary {
  node_id: number;
  physical_op: string;
  table: string | null;
  cost_pct: number;
  estimated_rows: number;
  actual_rows: number | null;
  actual_elapsed_ms: number | null;
  actual_logical_reads: number | null;
}

export interface IndexSuggestion {
  table: string;
  impact: number;
  equality_columns: string[];
  inequality_columns: string[];
  include_columns: string[];
  create_statement: string;
}

export interface MemoryGrantSummary {
  requested_kb: number;
  granted_kb: number;
  max_used_kb: number | null;
  grant_wait_ms: number | null;
}

export interface WaitStatSummary {
  type: string;
  ms: number;
  count: number;
  category: string;
}

export interface ParameterInfo {
  name: string;
  data_type: string;
  compiled_value: string | null;
  runtime_value: string | null;
  is_sniffed: boolean;
}

export interface StatementResult {
  statement_text: string;
  statement_type: string;
  total_cost: number;
  dop: number;
  has_actual_stats: boolean;
  ce_model_version: number;
  query_hash: string | null;
  query_plan_hash: string | null;
  findings: PlanFinding[];
  critical_count: number;
  warning_count: number;
  info_count: number;
  top_operators: OperatorSummary[];
  missing_indexes: IndexSuggestion[];
  memory_grant: MemoryGrantSummary | null;
  parameters: ParameterInfo[];
  wait_stats: WaitStatSummary[];
}

export interface PlanAnalysisResult {
  statements: StatementResult[];
  total_findings: number;
  critical_count: number;
  warning_count: number;
  has_actual_stats: boolean;
  analyzed_at: string;
  analysis_duration_ms: number;
}
```

---

## 10. Thứ Tự Implementation

```
Phase 1 — Backend + Types
  [ ] packages/core/src/types/plan-analysis.ts
  [ ] apps/api/src/routes/plan.ts
  [ ] apps/api/src/server.ts  (register route)
  [ ] Test: curl POST /api/plan/analyze

Phase 2 — Component Core
  [ ] apps/web/css/plan-analysis.css
  [ ] apps/web/dashboard/plan-analysis-component.ts
      — render(), destroy()
      — _buildSummaryBar(), _buildTabBar()
      — _buildFindingsPanel(), _buildOperatorsPanel()
      — _buildIndexesPanel(), _buildMemoryPanel()
      — _buildWaitsPanel(), _buildParamsPanel()
      — _bindTabSwitching(), _bindCopyDdl()

Phase 3 — Modal integration (dashboard)
  [ ] Thêm nút "Analyze" vào QP library toolbar (src/)
  [ ] Callback onAnalyzePlan trong dashboard.ts
  [ ] Import PlanAnalysisComponent + plan-analysis.css vào dashboard.html
  [ ] Test: estimated plan + actual plan trong modal

Phase 4 — Standalone page
  [ ] apps/web/pages/plan-analysis.html
  [ ] apps/web/dashboard/plan-analysis.ts (standalone entry)
  [ ] Nút "Open in Page" option (nếu cần)
```

---

## 11. Definition of Done

**Component:**
- [ ] `new PlanAnalysisComponent(el, result).render()` hoạt động độc lập không cần context bên ngoài
- [ ] `destroy()` cleanup không leak event listeners
- [ ] Events scoped vào `this.root` — nhiều instance trên cùng trang không conflict

**Modal context:**
- [ ] Nút "Analyze" hiển thị cạnh "Show Plan XML" trong toolbar
- [ ] Loading state trên nút trong khi chờ response
- [ ] Error state rõ ràng khi Layer 2 không phản hồi

**Standalone page:**
- [ ] `plan-analysis.html` render đúng khi có data trong `sessionStorage`
- [ ] Layout không bị vỡ ở full-page width

**Behavior:**
- [ ] Tab "Findings" active mặc định, findings sorted CRITICAL → WARNING → INFO
- [ ] Tabs ẩn khi data rỗng (Parameters, Waits, Memory)
- [ ] Copy DDL hoạt động, reset text sau 1.5s
- [ ] Actual stats columns: hiển thị `—` khi estimated plan
- [ ] `plan-analysis.css` import được vào bất kỳ page nào không gây conflict với CSS khác

---

*Phụ thuộc: Layer 2 `POST /api/v1/plan/analyze` deployed trước khi test end-to-end.*
