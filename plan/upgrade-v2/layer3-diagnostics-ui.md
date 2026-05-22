# Layer 3 — Finding Diagnostics UI Plan

## Mục Tiêu

Hiển thị dữ liệu capture từ `finding_diagnostics` (do Layer 1 v2 sinh ra) ngay trong dashboard
Layer 3 — không cần mở công cụ khác. User click vào finding nào có `has_diagnostics=true` sẽ thấy
tab **Diagnostics** với đầy đủ thông tin DMV snapshot, static analysis, table details và historical context.

**Phụ thuộc:** Layer 1 v2 phải deploy và đã seed `capture_tool_defs` trước khi UI này có dữ liệu
để hiển thị. UI không crash nếu `finding_diagnostics` chưa có — chỉ hiện "No diagnostics data."

---

## Luồng Hiển Thị

```
User click finding row
    │
    ├─ has_diagnostics = false  →  Modal "Finding Detail" (existing JSON tree, không đổi)
    │
    └─ has_diagnostics = true
           ↓
       Modal có 2 tab:
       [Detail | Diagnostics]
           │
           ├─ Tab "Detail"   → existing JSON tree (load ngay, không lazy)
           │
           └─ Tab "Diagnostics" (lazy-load khi click)
                  ↓
              GET /api/findings/:id/diagnostics
                  ↓
              Render DiagnosticsPanel:
                ┌─ Capture summary ─────────────────┐
                │ 4.8s · 8 ok · 1 failed             │
                ├─ Phase 1: DMV Snapshot ────────────┤
                │ [wait_stats ✓ 5r 120ms] [blocking] │
                │ [query_store ✗ timeout]             │
                ├─ Phase 2: Static Analysis ─────────┤
                │ [plan_analysis ✓] [query_structure] │
                ├─ Phase 3: Table Details ────────────┤
                │ [index_usage ✓ 12r] [statistics ✓]  │
                ├─ Phase 4: Historical Context ───────┤
                │ [recent_findings ✓ 3r] [analysis ✓] │
                └───────────────────────────────────┘
                      ↓ click badge
                ┌─ Tool detail (toggleable) ──────────┐
                │ <table> các rows của tool đó          │
                └────────────────────────────────────┘
```

**Slow session finding** (topic `slow_sessions`): tương tự nhưng tab đầu là "Metrics" thay vì "Detail".

---

## Files — Implementation Order

```
1.  layer3/apps/api/src/db/collections.ts              MODIFY — add findingDiagnostics
2.  layer3/apps/api/src/services/findings-diagnostics-service.ts  CREATE
3.  layer3/apps/api/src/routes/findings.ts             MODIFY — add GET /api/findings/:id/diagnostics
4.  layer3/apps/web/css/dashboard.css                  MODIFY — add diagnostics + tab styles
5.  layer3/apps/web/dashboard/dashboard.ts             MODIFY — tab modal + diagnostics rendering
```

---

## Chi Tiết Từng File

### 1. `collections.ts`

Thêm 1 entry:

```typescript
findingDiagnostics: "finding_diagnostics"
```

---

### 2. `findings-diagnostics-service.ts` (NEW)

```typescript
import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function getDiagnosticsByFindingId(db: Db, findingId: string) {
  return db.collection(collections.findingDiagnostics).findOne(
    { finding_id: findingId },
    { projection: { _id: 0 } }
  );
}
```

---

### 3. `findings.ts`

Import thêm:
```typescript
import { getDiagnosticsByFindingId } from "../services/findings-diagnostics-service";
```

Thêm route mới vào `registerFindingRoutes`:
```typescript
app.get("/api/findings/:id/diagnostics", async (req, reply) => {
  if (!app.mongoReady) return reply.code(503).send({ message: "MongoDB is unavailable" });
  const { id } = req.params as { id: string };
  const doc = await getDiagnosticsByFindingId(app.getDb(), id);
  if (!doc) return reply.code(404).send({ message: "Not found" });
  return reply.send(doc);
});
```

---

### 4. `dashboard.css`

Append vào cuối file — 2 nhóm:

#### A. Tab bar styles

```css
.finding-modal-tabs {
  display: flex;
  flex-direction: column;
}

.finding-tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 12px;
}

.finding-tab-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  position: relative;
  bottom: -1px;
  transition: color .12s, background .12s;
}

.finding-tab-btn:hover {
  color: var(--color-text);
  background: var(--color-surface-soft);
}

.finding-tab-btn.active {
  color: var(--color-accent-strong);
  background: var(--color-surface);
  border-color: var(--color-border);
  border-bottom-color: var(--color-surface);
}

.finding-tab-pane.hidden {
  display: none;
}
```

#### B. Diagnostics panel styles

```css
.diag-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.diag-summary {
  font-size: 13px;
  color: var(--color-muted);
  padding: 4px 0;
}

.diag-ok-count   { color: var(--color-success); font-weight: 600; }
.diag-fail-count { color: var(--color-danger);  font-weight: 600; }

.diag-phase-section {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.diag-phase-title {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-accent-strong);
  background: var(--color-primary-soft);
  border-bottom: 1px solid var(--color-border);
}

.diag-phase-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
}

.diag-tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: filter .12s, border-color .12s;
  background: var(--color-surface-soft);
}

.diag-tool-badge:hover         { filter: brightness(0.95); }
.diag-tool-badge.diag-active   { border-color: var(--color-accent-strong); outline: 2px solid var(--color-accent-strong); }

.diag-status-ok      { color: var(--color-success); background: var(--color-success-soft); border-color: var(--color-border-strong); }
.diag-status-empty,
.diag-status-skipped { color: var(--color-tag-neutral-text); background: var(--color-tag-neutral-bg); }
.diag-status-timeout { color: var(--color-warning); background: var(--color-warning-soft); border-color: var(--color-border-strong); }
.diag-status-error   { color: var(--color-danger);  background: var(--color-danger-soft);  border-color: var(--color-border-strong); }

.diag-rowcount  { font-size: 11px; font-weight: 700; opacity: 0.8; }
.diag-duration  { font-size: 10px; font-weight: 400; opacity: 0.7; }

.diag-detail-box {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}
.diag-detail-box.hidden { display: none; }

.diag-detail-title {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-code);
  color: var(--color-text);
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
}

.diag-detail-msg   { padding: 10px 12px; font-size: 12px; }
.diag-rows-scroll  { overflow: auto; max-height: 300px; }
.diag-loading      { padding: 20px; text-align: center; color: var(--color-muted); font-size: 13px; }
.diag-empty-msg    { padding: 20px; text-align: center; color: var(--color-muted); font-size: 13px; }

.diag-badge-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-info);
  background: var(--color-info-soft);
  border: 1px solid var(--color-border-strong);
}
```

---

### 5. `dashboard.ts`

#### 5.1 Thêm hằng số + 7 hàm mới (chèn ngay sau hàm `esc`, trước `removePlanXmlFields`)

```typescript
// --- Diagnostics ---

var DIAG_PHASE_GROUPS: Array<{ label: string; tools: string[] }> = [
  {
    label: "Phase 1 — DMV Snapshot",
    tools: ["get_blocking_chain","get_wait_stats","get_memory_grant","get_tempdb_usage",
            "get_ag_status","get_memory_pressure","get_resource_governor_stats",
            "get_cdc_status","get_missing_indexes","get_query_stats","get_query_store_history"]
  },
  { label: "Phase 2 — Static Analysis", tools: ["get_plan_analysis","get_query_structure"] },
  { label: "Phase 3 — Table Details",   tools: ["get_index_usage","get_statistics_info"] },
  { label: "Phase 4 — Historical Context", tools: ["get_table_context","get_recent_findings","get_analysis_history"] }
];

function diagStatusClass(status: string): string {
  if (status === "ok")                   return "diag-status-ok";
  if (status === "empty")                return "diag-status-empty";
  if (status === "skipped")              return "diag-status-skipped";
  if (status === "timeout")              return "diag-status-timeout";
  return "diag-status-error";
}

function renderDiagnosticsPanel(diag: any): string {
  if (!diag) return "<div class='diag-empty-msg'>No diagnostics data.</div>";
  var results: Record<string,any> = diag.results || {};
  var requested: string[] = diag.tools_requested || [];
  var captured: string[] = diag.tools_captured || [];
  var failed:   string[] = diag.tools_failed   || [];
  var durSec = diag.capture_duration_ms ? (diag.capture_duration_ms / 1000).toFixed(1) : "?";

  var summary = "<div class='diag-summary'>" +
    "Captured in <strong>" + esc(durSec) + "s</strong>" +
    " &nbsp;·&nbsp; <span class='diag-ok-count'>" + esc(String(captured.length)) + " ok</span>" +
    (failed.length ? " &nbsp;·&nbsp; <span class='diag-fail-count'>" + esc(String(failed.length)) + " failed</span>" : "") +
    (diag.captured_at ? " &nbsp;·&nbsp; " + esc(String(diag.captured_at)) : "") +
    "</div>";

  var phases = DIAG_PHASE_GROUPS.map(function(g) {
    var inPhase = requested.filter(function(tid) { return g.tools.indexOf(tid) >= 0; });
    if (!inPhase.length) return "";
    var badges = inPhase.map(function(tid) {
      var r = results[tid]; if (!r) return "";
      var cls   = diagStatusClass(r.status || "error");
      var label = tid.replace(/^get_/, "").replace(/_/g, " ");
      var cnt   = (r.status === "ok" && r.row_count > 0) ? " <span class='diag-rowcount'>" + esc(String(r.row_count)) + "</span>" : "";
      var dur   = (r.duration_ms != null) ? " <span class='diag-duration'>" + esc(String(r.duration_ms)) + "ms</span>" : "";
      return "<button type='button' class='diag-tool-badge " + cls + "' data-tool='" + esc(tid) + "'>" + esc(label) + cnt + dur + "</button>";
    }).join("");
    return "<div class='diag-phase-section'>" +
      "<div class='diag-phase-title'>" + esc(g.label) + "</div>" +
      "<div class='diag-phase-badges'>" + badges + "</div>" +
      "</div>";
  }).join("");

  return "<div class='diag-panel'>" + summary + phases + "<div id='diagDetailBox' class='diag-detail-box hidden'></div></div>";
}

function renderDiagToolRows(result: any): string {
  if (!result) return "<div class='diag-detail-msg'>No data.</div>";
  var status = String(result.status || "unknown");
  if (status !== "ok") {
    return "<div class='diag-detail-msg " + diagStatusClass(status) + "'>" + esc(String(result.reason || result.error || status)) + "</div>";
  }
  var rows: any[] = result.rows || [];
  if (!rows.length) return "<div class='diag-detail-msg diag-status-empty'>No rows returned.</div>";

  // Nested object (multi-query như get_memory_pressure) → JSON tree
  if (rows.length === 1 && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    var isNested = Object.keys(rows[0]).some(function(k) {
      return typeof rows[0][k] === "object" && rows[0][k] !== null;
    });
    if (isNested) {
      return "<div style='font-family:var(--font-code);font-size:12px;line-height:1.5;padding:8px'>" + renderJsonTree(rows[0]) + "</div>";
    }
  }

  // Flat array of objects → table
  if (typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    var cols = Object.keys(rows[0]);
    if (cols.length) {
      var thead = cols.map(function(c) { return "<th>" + esc(c) + "</th>"; }).join("");
      var tbody = rows.map(function(row: any, ri: number) {
        var cells = cols.map(function(c) {
          var v = row[c]; var s = (v == null) ? "" : String(v);
          if (s.length > 300) s = s.substring(0, 300) + "...";
          return "<td><pre class='cell-pre'>" + esc(s) + "</pre></td>";
        }).join("");
        return "<tr><td class='no-cell'>" + String(ri + 1) + "</td>" + cells + "</tr>";
      }).join("");
      return "<div class='diag-rows-scroll'><table class='kv-table'>" +
        "<thead><tr><th class='no-cell'>No</th>" + thead + "</tr></thead>" +
        "<tbody>" + tbody + "</tbody></table></div>";
    }
  }

  return "<div style='font-family:var(--font-code);font-size:12px;line-height:1.5;padding:8px'>" + renderJsonTree(rows) + "</div>";
}

function bindDiagnosticsPanel(diag: any): void {
  var panel = document.querySelector(".diag-panel") as HTMLElement | null;
  if (!panel) return;
  var detailBox = document.getElementById("diagDetailBox");
  if (!detailBox) return;
  var results: Record<string,any> = (diag && diag.results) || {};
  var badges = panel.querySelectorAll(".diag-tool-badge");
  var active = "";

  for (var i = 0; i < badges.length; i++) {
    (function(b: Element) {
      b.addEventListener("click", function() {
        var tid = (b as HTMLElement).getAttribute("data-tool") || "";
        if (active === tid) {
          detailBox.classList.add("hidden"); detailBox.innerHTML = "";
          active = ""; b.classList.remove("diag-active"); return;
        }
        for (var j = 0; j < badges.length; j++) badges[j].classList.remove("diag-active");
        b.classList.add("diag-active"); active = tid;
        detailBox.innerHTML = "<div class='diag-detail-title'>" + esc(tid) + "</div>" + renderDiagToolRows(results[tid]);
        detailBox.classList.remove("hidden");
      });
    })(badges[i]);
  }
}

function renderTabbedFindingModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderCleanDetail(finding);
  return "<div class='finding-modal-tabs'>" +
    "<div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button>" +
    "</div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderCleanDetail(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div>" +
    "</div>";
}

function renderTabbedMetricsModal(metrics: any, hasDiag: boolean): string {
  var metricsHtml = renderSlowSessionMetricsTable(metrics);
  if (!hasDiag) return metricsHtml;
  return "<div class='finding-modal-tabs'>" +
    "<div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Metrics</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button>" +
    "</div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + metricsHtml + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div>" +
    "</div>";
}

function bindFindingModalTabs(findingId: string): void {
  var tabBar = document.querySelector(".finding-tab-bar") as HTMLElement | null;
  if (!tabBar) return;
  var loaded = false;
  var btns = tabBar.querySelectorAll(".finding-tab-btn");
  for (var i = 0; i < btns.length; i++) {
    (function(btn: Element) {
      btn.addEventListener("click", async function() {
        var tab = (btn as HTMLElement).getAttribute("data-tab") || "";
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        btn.classList.add("active");
        var dp = document.getElementById("ftab-detail");
        var pp = document.getElementById("ftab-diag");
        if (dp) dp.classList.toggle("hidden", tab !== "detail");
        if (pp) pp.classList.toggle("hidden", tab !== "diag");
        if (tab === "diag" && !loaded) {
          loaded = true;
          try {
            var diag = await apiGet("/api/findings/" + encodeURIComponent(findingId) + "/diagnostics");
            if (pp) { pp.innerHTML = renderDiagnosticsPanel(diag); bindDiagnosticsPanel(diag); }
          } catch (_e) {
            if (pp) pp.innerHTML = "<div class='diag-empty-msg'>Failed to load diagnostics.</div>";
          }
        }
      });
    })(btns[i]);
  }
}
```

#### 5.2 `renderFindingsHeader` — non-slow header thêm cột Diag

Tìm:
```typescript
row.innerHTML = "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th>";
```
Sửa thành:
```typescript
row.innerHTML = "<th class='no-cell'>No</th><th>Time</th><th>Issue</th><th>Status</th><th>Node</th><th>Severity</th><th></th>";
```

#### 5.3 Non-slow row — thêm badge cell

Tìm:
```typescript
tr.innerHTML = noCell + "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td><td>" + esc(x.issue_type || "") + "</td><td>" + alertStatusBadge(x.alert_status || "") + "</td><td>" + esc(x.node || "") + "</td><td>" + severityBadge(x.severity || "INFO") + "</td>";
```
Sửa thành (thêm `<td>` cuối):
```typescript
tr.innerHTML = noCell +
  "<td>" + esc(formatDetectedAtForUi(x.detected_at)) + "</td>" +
  "<td>" + esc(x.issue_type || "") + "</td>" +
  "<td>" + alertStatusBadge(x.alert_status || "") + "</td>" +
  "<td>" + esc(x.node || "") + "</td>" +
  "<td>" + severityBadge(x.severity || "INFO") + "</td>" +
  "<td>" + (x.has_diagnostics ? "<span class='diag-badge-indicator' title='Diagnostics captured'>D</span>" : "") + "</td>";
```

#### 5.4 Slow-session click handler — thêm tabs

Tìm:
```typescript
tr.addEventListener("click", async function () {
  await withGlobalLoading(async function () {
    var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
    var metrics = (d && d.metrics) || {};
    openModal("Finding Metrics", renderSlowSessionMetricsTable(metrics));
    bindSlowSessionMetricActions(metrics);
  });
});
```
Sửa thành:
```typescript
tr.addEventListener("click", async function () {
  await withGlobalLoading(async function () {
    var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
    var metrics = (d && d.metrics) || {};
    var hasDiag = !!(d && d.has_diagnostics);
    openModal("Finding Metrics", renderTabbedMetricsModal(metrics, hasDiag));
    bindSlowSessionMetricActions(metrics);
    if (hasDiag) bindFindingModalTabs(x.finding_id);
  });
});
```

#### 5.5 Non-slow click handler — thêm tabs

Tìm:
```typescript
tr.addEventListener("click", async function () {
  await withGlobalLoading(async function () {
    var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
    openModal("Finding Detail", renderCleanDetail(d));
    bindJsonTreeToolbar();
  });
});
```
Sửa thành:
```typescript
tr.addEventListener("click", async function () {
  await withGlobalLoading(async function () {
    var d = await apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
    openModal("Finding Detail", renderTabbedFindingModal(d));
    bindJsonTreeToolbar();
    if (d && d.has_diagnostics) bindFindingModalTabs(x.finding_id);
  });
});
```

---

## Schema Tham Chiếu (`finding_diagnostics`)

```json
{
  "finding_id":          "uuid",
  "topic_id":            "slow_query",
  "node":                "10.x.x.1",
  "captured_at":         "2025-01-01T08:00:00",
  "capture_duration_ms": 4800,
  "tools_requested":     ["get_query_stats", "get_wait_stats", ...],
  "tools_captured":      ["get_query_stats", "get_wait_stats"],
  "tools_failed":        ["get_query_store_history"],
  "results": {
    "get_wait_stats": {
      "status":      "ok",
      "rows":        [{ "wait_type": "PAGEIOLATCH_SH", "wait_time_ms": 5400, "pct_total": 42.1 }],
      "row_count":   5,
      "duration_ms": 120
    },
    "get_query_store_history": {
      "status":      "timeout",
      "rows":        [],
      "row_count":   0,
      "duration_ms": 10000
    }
  },
  "capture_error": null
}
```

`has_diagnostics: bool` nằm trên document `findings` — Layer 1 set `True` sau khi capture thành công.

---

## Tool Status → Badge Color Mapping

| status | class | màu |
|---|---|---|
| `ok` | `diag-status-ok` | xanh lá |
| `empty` | `diag-status-empty` | xám trung tính |
| `skipped` | `diag-status-skipped` | xám trung tính |
| `timeout` | `diag-status-timeout` | cam/vàng |
| `error` | `diag-status-error` | đỏ |

---

## Rows Rendering Logic

| Dạng data | Render |
|---|---|
| `status != "ok"` | Text message với màu status |
| `rows = []` | "No rows returned." |
| `rows[0]` là nested object (multi-query) | JSON tree (dùng `renderJsonTree`) |
| `rows` là flat array of objects | `<table class="kv-table">` |
| Fallback | JSON tree |

---

## Edge Cases

| Case | Behavior |
|---|---|
| `has_diagnostics = false` | Modal hiện bình thường, không có tab Diagnostics |
| `GET /diagnostics` trả 404 | Tab Diagnostics hiện "Failed to load diagnostics." |
| `results[tool_id]` undefined | "No data." trong detail box |
| Tool result có string > 300 ký tự | Truncate + "..." trong table cell |
| `get_memory_pressure` (nested rows) | Render JSON tree thay vì table |
| Dark mode | Tất cả dùng CSS variables, tự động đúng |

---

## Verification

```javascript
// Seed blocking topic để test
db.monitor_topics.updateOne(
  { topic_id: "blocking" },
  { $set: { capture_tools: ["get_blocking_chain", "get_wait_stats", "get_recent_findings"] } }
)

// Kiểm tra finding có has_diagnostics
db.findings.findOne({ has_diagnostics: true }, { finding_id: 1, topic_id: 1 })

// Kiểm tra snapshot tương ứng
db.finding_diagnostics.findOne(
  { finding_id: "<finding_id từ bước trên>" },
  { tools_captured: 1, tools_failed: 1, capture_duration_ms: 1 }
)
```

Sau khi deploy Layer 3, vào dashboard → click finding có `D` badge → tab Diagnostics → kiểm tra:
- Badge màu đúng theo status
- Click badge hiện đúng rows
- Slow session finding cũng có tab Diagnostics

---

## Phụ Thuộc

- Layer 1 v2 đã implement (`layer1-v2.md`) — cần chạy trước
- `python -m layer1.seed.seed_capture_tools` đã chạy
- `capture_tools` đã được set cho ít nhất 1 topic trong MongoDB
