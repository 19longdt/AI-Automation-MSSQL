# Fix Plan — Plan Analysis UI/Backend Gaps

**Tạo từ:** rà soát code vs image minh họa (image1–image9)  
**Branch đề xuất:** `feature/plan-analysis-fix`  
**Files liên quan:** `service.py`, `result.py`, `plan-analysis.ts`, `plan-analysis-component.ts`

---

## Tổng hợp vấn đề phát hiện

| # | Vấn đề | Layer | Mức độ |
|---|---|---|---|
| F1 | Summary bar hiển thị sai data (dùng result-level thay vì statement-level) | L3 Frontend | BLOCKER |
| F2 | TEO: tên operator không format `table → index` cho SEEK/LOOKUP | L3 Frontend | HIGH |
| F3 | TEO: bar color dùng critical/warning/ok thay vì per op_type_tag | L3 Frontend | HIGH |
| F4 | TEO: cost % không có màu (đỏ khi cao) | L3 Frontend | HIGH |
| F5 | I/O Stats: thiếu phys/RA/scans, thiếu badge, thiếu "highest" flag | L3 Frontend | HIGH |
| F6 | JOIN TYPES backend thiếu Sort + Parallelism counts | L2 Backend | HIGH |
| F7 | CompilationInfo thiếu `cached_plan_size_kb` + `non_parallel_reason` | L2 Backend + L3 | MEDIUM |
| F8 | Section dot không có màu dynamic | L3 Frontend | MEDIUM |
| F9 | Warnings: render raw `f.type` thay vì human-readable label | L3 Frontend | MEDIUM |
| F10 | Statistics: thiếu `.stale` class trên `<tr>` | L3 Frontend | LOW |

---

## Task 1 — Layer 2 Backend fixes

### T1.1 — `_build_join_types()` trong `service.py`

**Vấn đề F6:** Hiện chỉ đếm Nested Loops/Merge Join/Hash Match. Image1 cần thêm Sort và Parallelism chips.

**Sửa `layer2/plan/service.py`:**

```python
def _build_join_types(self, stmt: ParsedStatement) -> list[JoinTypeSummary]:
    counts: dict[str, JoinTypeSummary] = {}
    TRACKED = {"Nested Loops", "Merge Join", "Hash Match", "Sort", "Parallelism"}
    for node in self._flatten(stmt.root_node):
        if node.physical_op not in TRACKED:
            continue
        key = node.physical_op
        if key not in counts:
            counts[key] = JoinTypeSummary(join_type=key, count=0, has_spill=False)
        counts[key].count += 1
        if any(w.name == "SpillToTempDb" for w in node.warnings):
            counts[key].has_spill = True
    # Thêm Spill summary riêng
    spill_total = sum(
        1 for n in self._flatten(stmt.root_node)
        if any(w.name == "SpillToTempDb" for w in n.warnings)
    )
    if spill_total > 0:
        counts["__spill__"] = JoinTypeSummary(join_type="__spill__", count=spill_total, has_spill=True)
    return sorted(counts.values(), key=lambda x: x.count, reverse=True)
```

---

### T1.2 — `CompilationInfo` + `_build_compilation()` — thêm 2 fields

**Vấn đề F7:** `ParsedStatement` có sẵn `cached_plan_size_kb` và `non_parallel_reason` nhưng không được expose ra `CompilationInfo`.

**Sửa `layer2/plan/models/result.py`** — thêm 2 fields vào `CompilationInfo`:

```python
class CompilationInfo(BaseModel):
    ce_model_version: int = 0
    dop: int = 0
    non_parallel_reason: str | None = None      # THÊM
    compile_cpu_ms: int = 0
    compile_memory_kb: int = 0
    cached_plan_size_kb: int = 0                # THÊM
    optm_level: str | None = None
    early_abort_reason: str | None = None
    query_hash: str | None = None
    query_plan_hash: str | None = None
```

**Sửa `layer2/plan/service.py`** — `_build_compilation()`:

```python
def _build_compilation(self, stmt: ParsedStatement) -> CompilationInfo:
    return CompilationInfo(
        ce_model_version=stmt.ce_model_version,
        dop=stmt.dop,
        non_parallel_reason=stmt.non_parallel_reason,     # THÊM
        compile_cpu_ms=stmt.compile_cpu_ms,
        compile_memory_kb=stmt.compile_memory_kb,
        cached_plan_size_kb=stmt.cached_plan_size_kb,     # THÊM
        optm_level=stmt.optm_level,
        early_abort_reason=stmt.early_abort_reason,
        query_hash=stmt.query_hash,
        query_plan_hash=stmt.query_plan_hash,
    )
```

---

## Task 2 — TypeScript type update

**File:** `layer3/packages/core/src/types/plan-analysis.ts`

**Sửa `CompilationInfo`** — thêm 2 fields mới:

```typescript
export interface CompilationInfo {
  ce_model_version: number;
  dop: number;
  non_parallel_reason: string | null;   // THÊM
  compile_cpu_ms: number;
  compile_memory_kb: number;
  cached_plan_size_kb: number;           // THÊM
  optm_level: string | null;
  early_abort_reason: string | null;
  query_hash: string | null;
  query_plan_hash: string | null;
}
```

Không cần sửa gì khác trong file này — `IOStatSummary`, `OperatorSummary`, `JoinTypeSummary`, `StatementResult` đã đúng.

---

## Task 3 — Frontend: Summary bar (F1)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

**Thay `_buildSummaryBar()`** để hiển thị per-statement data theo image9:

```
0.1741  EST. TOTAL COST  |  SELECT  STATEMENT TYPE  |  FULL  OPTIMIZATION  |  0  MISSING INDEXES  |  1  WARNINGS  |  No  PARALLELISM  |  —  MEM USED
```

Logic:
- `total_cost` → `s.total_cost` (format 4 decimal)
- `statement_type` → `s.statement_type`
- `optm_level` → `s.compilation?.optm_level ?? "—"`
- `missing_indexes` → `s.missing_indexes.length`
- `warnings` → `s.warning_count` (màu đỏ nếu > 0)
- `parallelism` → nếu `s.dop > 1` → `DOP ${s.dop}`, nếu `s.compilation?.non_parallel_reason` → `No`, không có info → `—`
- `mem_used` → nếu `s.memory_grant?.max_used_kb` → format KB/MB, không có → `—`

**Cấu trúc HTML mới:**
```html
<div class='pa-summary'>
  <span class='pa-sum-item'><span class='pa-sum-val'>{total_cost}</span><span class='pa-sum-label'>EST. TOTAL COST</span></span>
  <span class='pa-sum-sep'>|</span>
  <span class='pa-sum-item'><span class='pa-sum-val'>{stmt_type}</span><span class='pa-sum-label'>STATEMENT TYPE</span></span>
  <span class='pa-sum-sep'>|</span>
  ...
</div>
```

---

## Task 4 — Frontend: TOP EXPENSIVE OPERATIONS (F2, F3, F4)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

### T4.1 — Format tên operator

Thêm helper `_opDisplayName(o: OperatorSummary): string`:

```typescript
private _opDisplayName(o: OperatorSummary): string {
  if ((o.op_type_tag === "SEEK" || o.op_type_tag === "LOOKUP" || o.op_type_tag === "SCAN") 
      && o.table_name) {
    var label = o.table_name;
    if (o.index_name) label += " → " + o.index_name;  // →
    return o.physical_op + ": [" + label + "]";
  }
  return o.physical_op;
}
```

### T4.2 — Bar color per op_type_tag

Thay vì `cls = cost_pct >= 70 ? "critical" : ...`, dùng:

```typescript
private _opTagClass(tag: string): string {
  var map: Record<string, string> = {
    "SORT": "teo-sort", "PARALLEL": "teo-parallel", "JOIN": "teo-join",
    "SEEK": "teo-seek", "AGG": "teo-agg", "HASH": "teo-hash",
    "SCAN": "teo-scan", "LOOKUP": "teo-seek",
  };
  return map[tag] || "teo-other";
}
```

Bar: `<div class='pa-teo-bar ${this._opTagClass(o.op_type_tag)}' style='width:${pct}%'></div>`

### T4.3 — Cost % color

`cost_pct` hiển thị với class màu:
- ≥ 70% → `class='val high'` (đỏ)
- ≥ 30% → `class='val mid'` (cam/warning)  
- < 30% → `class='val'` (muted)

### T4.4 — Layout mới theo image3/image6

```
[tên operator] [TAG badge] [▲ row est off flag]          #N
Cost: X.XX  % total: XX.X%  Est rows: N  Act rows: N (nếu có)
[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━] (bar màu per tag)
```

---

## Task 5 — Frontend: I/O Statistics (F5)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

**Thay `_buildIoSection()`** theo image2:

- Dòng 1: `{op_name} [TAG badge]` + `▲ highest` nếu index 0 + phải: `374.5K log | 284 phys | 766 RA | 21896 scans`
- Dòng 2: progress bar màu heat (≥75%=danger, ≥40%=warning, ≥15%=seek-blue, <15%=muted)
- Footer note: `ℹ Logical reads = buffer pool 8KB page reads...`

```typescript
private _fmtReads(n: number): string {
  if (n >= 1000000) return this._num(n / 1000000, 1) + "M";
  if (n >= 1000) return this._num(n / 1000, 1) + "K";
  return String(n);
}
```

Stats line chỉ hiện metric khi > 0:
- `logical_reads` → luôn hiện
- `physical_reads` → chỉ hiện khi > 0
- `read_ahead_reads` → chỉ hiện khi > 0
- `scan_count` → chỉ hiện khi > 0

---

## Task 6 — Frontend: JOIN TYPES (F6 frontend part)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

**Thay `_buildJoinTypesSection()`:**

```typescript
private _buildJoinTypesSection(s: StatementResult): string {
  if (!s.join_types || !s.join_types.length) return "<div class='pa-empty'>No join operations.</div>";
  var chips = s.join_types.map((j) => {
    if (j.join_type === "__spill__") {
      return "<span class='pa-jchip spill'>⚠ Spill to TempDB ×" + j.count + "</span>";
    }
    var cls = j.join_type === "Sort" ? "sort" : 
              j.join_type === "Parallelism" ? "parallel" : "join";
    return "<span class='pa-jchip " + cls + "'>" + this._esc(j.join_type) + " ×" + j.count + "</span>";
  }).join("");
  var spill = s.join_types.find(j => j.join_type === "__spill__");
  var note = spill ? "<div class='pa-section-note'>⚠ Spills detected — operations exceeded memory grant and wrote to disk.</div>" : "";
  return "<div class='pa-join-chips'>" + chips + "</div>" + note;
}
```

---

## Task 7 — Frontend: Section dot color (F8)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

**Thay `_section()`** thành nhận thêm tham số `dotColor`:

```typescript
private _section(title: string, body: string, open: boolean, dotColor: string = "blue"): string {
  return "<details class='pa-section'" + (open ? " open" : "") + 
    "><summary class='pa-section-header'>" +
    "<span class='pa-section-dot " + dotColor + "'></span>" +
    this._esc(title) + "</summary><div class='pa-section-body'>" + body + "</div></details>";
}
```

**Logic màu dot cho từng section** (trong `_buildHtml()`):

| Section | Màu dot | Điều kiện |
|---|---|---|
| Query Text | `blue` | luôn |
| I/O Statistics | `yellow` nếu có data, `green` nếu trống | `s.io_stats.length > 0` |
| Top Expensive Ops | `red` nếu có spill, `yellow` nếu có data | `s.top_operators.some(o => o.has_spill)` |
| Warnings | `red` nếu critical > 0, `yellow` nếu warning > 0 | `s.critical_count / s.warning_count` |
| Est vs Actual | `yellow` nếu có mismatch, `green` nếu sạch | `top_operators.some(o => o.has_row_est_off)` |
| Join Types | `red` nếu có spill chip, `blue` nếu không | `join_types.some(j => j.join_type === "__spill__")` |
| Statistics | `yellow` nếu có stale, `green` nếu sạch | `statistics.some(x => (x.modification_count||0) > 10000)` |
| Memory Grant | `red` ≥90%, `yellow` ≥50%, `green` <50% | ratio từ granted/used |
| Wait Statistics | `yellow` nếu có data | `s.wait_stats.length > 0` |
| Compilation | `yellow` nếu CE=70 hoặc compile_cpu>1000ms, else `blue` | |
| Missing Indexes | `red` nếu có, `green` nếu không | `s.missing_indexes.length > 0` |

---

## Task 8 — Frontend: Warnings human-readable label (F9)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

Thêm mapping `_warnLabel()` và `_warnCat()`:

```typescript
private _warnLabel(type: string): string {
  var labels: Record<string, string> = {
    "spill_to_tempdb": "SPILL TO TEMPDB",
    "memory_spill_risk": "SPILL RISK: MEMORY NEAR LIMIT",
    "sort_expensive": "PERFORMANCE: EXPENSIVE SORT",
    "ineffective_parallelism": "PARALLEL: LOW EFFICIENCY",
    "key_lookup": "INDEX: KEY LOOKUP",
    "rid_lookup": "INDEX: RID LOOKUP",
    "scan_with_predicate": "INDEX: SCAN WITH PREDICATE",
    "non_sargable_implicit": "INDEX: IMPLICIT CONVERSION",
    "row_estimate_mismatch": "STATS: ROW ESTIMATE MISMATCH",
    "stale_statistics": "STATS: STALE STATISTICS",
    "high_compile_cpu": "COMPILE: HIGH CPU",
    "compile_memory_exceeded": "COMPILE: MEMORY EXCEEDED",
    "ce_model_legacy": "CE MODEL: LEGACY (SQL 2012)",
    "memory_grant_wait": "MEMORY: GRANT WAIT",
    "memory_large_grant": "MEMORY: LARGE GRANT",
    "serial_plan_actionable": "PARALLEL: SERIAL PLAN (FIXABLE)",
    "scalar_udf": "CODE: SCALAR UDF",
    "missing_index": "INDEX: MISSING INDEX",
  };
  return labels[type] || type.toUpperCase().replace(/_/g, " ");
}

private _warnCat(type: string): string {
  if (type.indexOf("spill") >= 0 || type === "memory_spill_risk") return "spill";
  if (type.indexOf("sort") >= 0 || type.indexOf("scan") >= 0 || type.indexOf("compile") >= 0) return "perf";
  if (type.indexOf("parallel") >= 0 || type.indexOf("serial") >= 0) return "parallel";
  if (type.indexOf("key_lookup") >= 0 || type.indexOf("rid_lookup") >= 0 || 
      type.indexOf("index") >= 0 || type.indexOf("sargable") >= 0) return "index";
  return "";
}
```

Sửa `_buildWarningsSection()`: thay `f.type` → `this._warnLabel(f.type)` trong header.

---

## Task 9 — Frontend: Statistics stale row (F10)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

Sửa `_buildStatsSection()`:

```typescript
// Hiện tại: không có class trên <tr>
"<tr><td>..."

// Sửa thành:
var staleRow = (x.modification_count || 0) > 10000 ? " class='stale'" : "";
"<tr" + staleRow + "><td>..."
```

---

## Task 10 — Frontend: Compilation section — thêm Plan Size + hashes (F7 frontend)

**File:** `layer3/apps/web/dashboard/plan-analysis-component.ts`

Sửa `_buildCompilationSection()` thêm:
- `cached_plan_size_kb` → "Plan Size: X KB"
- `non_parallel_reason` → "Non-parallel reason: ..."
- `query_hash` / `query_plan_hash` → hiển thị nếu có
- CE Model: nếu `ce_model_version === 70` → thêm badge `[Legacy SQL 2012]` màu warning

---

## Thứ tự implement

```
Step 1 (Backend — L2):
  ├── T1.1  service.py: _build_join_types() thêm Sort + Parallelism + __spill__
  └── T1.2  result.py + service.py: CompilationInfo thêm cached_plan_size_kb + non_parallel_reason

Step 2 (TypeScript types — L3):
  └── plan-analysis.ts: CompilationInfo thêm 2 fields mới

Step 3 (Frontend — L3, order quan trọng):
  ├── T3/Task 3: _buildSummaryBar() → per-statement data (image9)
  ├── T4/Task 4: _buildTopExpensiveSection() → tên + bar color + % color (image3/6)
  ├── T5/Task 5: _buildIoSection() → format mới (image2)
  ├── T6/Task 6: _buildJoinTypesSection() → Sort + Parallelism + Spill chips
  ├── T7/Task 7: _section() → dotColor param + logic màu per section
  ├── T8/Task 8: _buildWarningsSection() → human label
  ├── T9/Task 9: _buildStatsSection() → stale row class
  └── T10/Task 10: _buildCompilationSection() → Plan Size + hashes + CE legacy badge
```

---

## CSS cần thêm/sửa

**`layer3/apps/web/css/plan-analysis.css`** — cần thêm:

```css
/* Summary bar per-statement (image9) */
.pa-sum-item { display: inline-flex; flex-direction: column; align-items: center; }
.pa-sum-val  { font-weight: 700; font-size: 13px; }
.pa-sum-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); }

/* TEO bar colors per op_type_tag */
.pa-teo-bar { height: 3px; border-radius: 2px; }
.pa-teo-bar.teo-sort     { background: #ef4444; }
.pa-teo-bar.teo-parallel { background: #22c55e; }
.pa-teo-bar.teo-join     { background: #06b6d4; }
.pa-teo-bar.teo-seek     { background: #3b82f6; }
.pa-teo-bar.teo-agg      { background: #a855f7; }
.pa-teo-bar.teo-hash     { background: #f97316; }
.pa-teo-bar.teo-scan     { background: #fbbf24; }
.pa-teo-bar.teo-other    { background: var(--color-muted); }

/* Cost % colored value */
.pa-teo-metrics .val.high { color: var(--color-danger); font-weight: 600; }
.pa-teo-metrics .val.mid  { color: var(--color-warning); }

/* Section dot colors */
.pa-section-dot.red    { background: var(--color-danger); }
.pa-section-dot.yellow { background: var(--color-warning); }
.pa-section-dot.blue   { background: var(--color-primary); }
.pa-section-dot.green  { background: var(--color-success); }

/* JOIN chips */
.pa-join-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pa-jchip { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 12px; }
.pa-jchip.join     { background: var(--color-primary-soft); color: var(--color-primary); }
.pa-jchip.sort     { background: var(--color-danger-soft); color: var(--color-danger); }
.pa-jchip.parallel { background: var(--color-purple-soft); color: var(--color-purple); }
.pa-jchip.spill    { background: var(--color-danger-soft); color: var(--color-danger); border: 1px solid var(--color-danger); }

/* Stats stale row */
.pa-stats-table tr.stale td { background: var(--color-warning-soft); }
```

**`layer3/apps/web/css/base.css`** — thêm purple variables nếu chưa có:

```css
:root {
  --color-purple: #7c3aed;
  --color-purple-soft: #f3e8ff;
}
:root[data-theme="dark"] {
  --color-purple: #c084fc;
  --color-purple-soft: #2e1065;
}
```

---

## Definition of Done

- [ ] T1.1: `_build_join_types()` trả Sort + Parallelism + `__spill__` chip
- [ ] T1.2: `CompilationInfo` có `cached_plan_size_kb` + `non_parallel_reason`; `_build_compilation()` map đủ
- [ ] T2: TypeScript `CompilationInfo` sync với backend
- [ ] T3: Summary bar hiển thị 7 metrics per-statement như image9
- [ ] T4: TEO hiển thị `table → index` name, bar color per tag, % color
- [ ] T5: I/O Stats hiển thị đúng format image2 với phys/RA/scans
- [ ] T6: JOIN TYPES hiển thị Sort + Parallelism + Spill chips
- [ ] T7: Section dots có màu dynamic
- [ ] T8: Warnings dùng human-readable label
- [ ] T9: Statistics stale row có class `.stale` trên `<tr>`
- [ ] T10: Compilation hiển thị Plan Size, hashes, CE legacy badge
- [ ] Build TypeScript không lỗi
- [ ] Verify UI trong browser với data thực
