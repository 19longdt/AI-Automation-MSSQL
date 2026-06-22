# Plan: Rebuild PlanAnalysisPanel (web-v2)

> **Mục tiêu:** Khôi phục toàn bộ tính năng từ `apps/web/dashboard/plan-analysis-component.ts` (Vanilla TS cũ)
> sang React 19 + shadcn/ui + Tailwind CSS v4, tuân thủ `RULE_VERIFY.md`.
>
> Cập nhật: 2026-06-12

---

## Phân tích Gap: Version cũ → Version mới

### Tính năng bị mất hoặc đơn giản hóa

| Section | Old (đầy đủ) | New (thiếu) |
|---|---|---|
| **SummaryBar** | 2 row sticky: Row1=(STMT TYPE, OPTIMIZATION, WARNINGS có màu, MISSING IDX, PARALLELISM) + Row2=(EST.COST, ELAPSED màu, CPU TIME màu, MEM USED màu, TOP WAIT màu, WAIT TIME) | Flat, thiếu CPU/MEM/TOP WAIT/WAIT TIME, không có màu coding |
| **Warnings** | Card đầy đủ: left-border màu severity, accent bar theo category, `renderText()` backtick→`<code>`, recommendation với 💡, DDL Copy button, per-instance list | Chỉ severity text + type + recommendation text |
| **Top Operators** | Card/row: op type tag, Spill + "Row Est Off" badge, 4 metrics (Cost/% Total/Est Rows/Act Rows), colored bar by type | Chỉ progress bar đơn giản + text |
| **Est vs Actual** | Sorted by worst ratio, progress bar visual, `+Nx`/`÷Nx` format | Bảng plain, ratio `×` cơ bản |
| **I/O Stats** | Card per object với relative bar, metric chips (log/phys/RA/scans) màu theo % | Bảng plain |
| **Missing Indexes** | Impact badge + equality/inequality/include columns grid + DDL Copy | Thiếu columns grid breakdown |
| **Statistics** | Tất cả stats (không filter), stale border highlight, sampling%, modification count | Chỉ stale stats |
| **Parameters** | DECLARE block ở đầu + "Sniffing" badge khi mismatch | Chỉ bảng, thiếu DECLARE block |
| **Join Types** | Colored chips (join/sort/parallel/spill), ghi chú cho spill+hash | Danh sách text đơn giản |
| **Memory Grant** | KPI row + visual bar với threshold lines 50%/90% | Chỉ KPI, không có bar |
| **Wait Stats** | Card per wait với relative progress bar, ms + count | Danh sách text đơn giản |
| **Compilation** | CE Model 70 → badge "Legacy SQL 2012", compile CPU colored | Không có badge |
| **Query Text** | Format SQL với line breaks + prepend DECLARE params | Raw text |
| **Section level** | `<details>/<summary>` collapsible, dot màu + count badge | Div tiêu đề phẳng, không collapse |

---

## Cấu trúc file mới

```
apps/web-v2/src/components/plan/
├── PlanAnalysisPanel.tsx          ← Orchestrator chính (~100 lines)
├── PlanSummaryBar.tsx             ← Sticky 2-row summary bar (~130 lines)
├── PlanSection.tsx                ← Collapsible section wrapper (reusable, ~70 lines)
├── sections/
│   ├── PlanWarnings.tsx           ← Warning cards đầy đủ với DDL copy (~180 lines)
│   ├── PlanOperators.tsx          ← Top operators: metrics + colored bar (~130 lines)
│   ├── PlanRowEst.tsx             ← Est vs Actual: bar + ratio format (~90 lines)
│   ├── PlanIoStats.tsx            ← I/O cards: relative bar + metric chips (~100 lines)
│   ├── PlanMissingIndexes.tsx     ← Impact badge + column grid + DDL copy (~100 lines)
│   ├── PlanStatistics.tsx         ← All stats + stale highlight (~80 lines)
│   ├── PlanParameters.tsx         ← DECLARE block + sniffing badge (~90 lines)
│   ├── PlanIndexUsage.tsx         ← Lookup badge + partitioned (~70 lines)
│   ├── PlanJoinTypes.tsx          ← Colored chips + spill/hash notes (~90 lines)
│   ├── PlanMemoryGrant.tsx        ← KPI row + bar với threshold lines (~90 lines)
│   ├── PlanWaitStats.tsx          ← Wait cards + relative bar (~80 lines)
│   ├── PlanCompilation.tsx        ← CE Model badge + compile metrics (~80 lines)
│   └── PlanLookupQueries.tsx      ← Plan cache + Query store + copy (~60 lines)
└── planUtils.ts                   ← Shared utils (~120 lines)
```

---

## Chi tiết từng file

### `planUtils.ts` — utilities thuần, không React

| Hàm | Mô tả |
|---|---|
| `formatMs(ms)` | `"1.2 s"` / `"247 ms"` |
| `fmtReads(n)` | `"1.2M"` / `"34K"` |
| `fmtKbOrMb(kb)` | `"1.4 MB"` / `"512 KB"` |
| `kbToMb(kb)` | number → `"1.4"` (string) |
| `num(v, d)` | locale string với fixed decimals |
| `nullableNum(v, d)` | `"—"` nếu null |
| `waitCls(type)` | `"sum-red"` / `"sum-orange"` / `"sum-blue"` / `"sum-neutral"` |
| `elapsedCls(ms)` | red ≥10s, orange ≥1s, green otherwise |
| `cpuCls(ms)` | same as elapsedCls |
| `memCls(used, granted)` | red ≥90%, orange ≥50%, green otherwise |
| `opTagClass(tag)` | CSS class per op type tag |
| `opGlossaryKey(physOp, logOp)` | glossary key string for tooltip |
| `warnCat(type)` | `"spill"` / `"perf"` / `"parallel"` / `"index"` / `"stats"` |
| `warnLabel(type)` | Human-readable label string |
| `opDisplayName(op)` | Include table/index name nếu SEEK/SCAN/LOOKUP |
| `formatQueryText(s)` | Format SQL line breaks + prepend DECLARE block |

**Note:** `renderText(s)` phải return `React.ReactNode` (parse backtick → `<code className="pa-kw">`), đặt trong file helper riêng hoặc trong component vì return JSX.

---

### `PlanAnalysisPanel.tsx` — Orchestrator

```tsx
// Props: { result: PlanAnalysisResult }
// State: activeStmt (number, useState(0))
// Render:
//   - Statement tabs (nếu > 1 statement)
//   - <PlanSummaryBar s={s} />
//   - 5 groups: orientation, cost, actionable, context, deepdive
//   - Mỗi group là accordion với PlanSection bên trong
```

---

### `PlanSummaryBar.tsx` — Sticky 2-row summary

**Row 1:**
- STMT TYPE — `s.statement_type || "—"`, color neutral
- OPTIMIZATION — `s.compilation?.optm_level || "—"`, color purple
- WARNINGS — `sum(finding_groups[].count)`, color: red nếu critical_count>0, orange nếu warning_count>0, neutral nếu 0
- MISSING IDX — `missing_indexes.length`, color: orange nếu >0, neutral
- PARALLELISM — `dop>1 → "DOP N"`, `dop===1 → "None"`, else `"—"`, color blue nếu parallel

**Row 2:**
- EST. COST — `total_cost.toFixed(4)`, color blue
- ELAPSED — `formatMs(elapsed_ms)`, color theo `elapsedCls()`
- CPU TIME — `formatMs(cpu_ms)`, color theo `cpuCls()`
- MEM USED — `fmtKbOrMb(max_used_kb)`, color theo `memCls()`
- TOP WAIT — `topWait.type` (wait với ms lớn nhất), color theo `waitCls(topWait.type)`
- WAIT TIME — `formatMs(totalWaitMs)`, color: red ≥10s, orange ≥1s, neutral

**Layout:** sticky top, border-bottom, box-shadow, 2 rows flex-wrap, divider giữa.

---

### `PlanSection.tsx` — Collapsible section wrapper

```tsx
interface PlanSectionProps {
  title: string;
  dotColor: "red" | "yellow" | "blue" | "green";
  count?: number;
  defaultOpen?: boolean;
  groupColor?: string;  // CSS variable value for left-border
  children: React.ReactNode;
}
```

- `useState(defaultOpen ?? false)` control open/close
- Header: dot màu + title + count badge + chevron
- Body: collapsible
- Khi mở: `border-left: 1px solid <groupColor>`

---

### `PlanWarnings.tsx` — Warning cards đầy đủ

**Mỗi `FindingGroup`:**
```
┌──────────────────────────────────────────────────┐ ← border-left màu severity
│ [CRITICAL] [SPILL] spill_to_tempdb       [×3]   │ ← header
├──────────────────────────────────────────────────┤
│ SPILL TO TEMPDB                                   │ ← category label (warnLabel)
│ Sort operator NodeId=5 spilled to TempDB          │ ← description (count=1 only)
│ 💡 Recommendation text với `backtick` → <code>   │ ← recommendation box
│ ┌──────────────────────────────────────────────┐ │
│ │ [Copy DDL]                                   │ │ ← DDL block nếu shared_action
│ │ CREATE INDEX ...                             │ │
│ └──────────────────────────────────────────────┘ │
│  • Instance 1 description                         │ ← instances (count>1)
│    [Copy DDL]                                     │
│  • Instance 2 description                         │
└──────────────────────────────────────────────────┘
```

- `renderText()` convert backtick → `<code className="pa-kw">`
- `CopyDdlButton` component dùng `navigator.clipboard` + fallback textarea
- Button label: "Copy DDL" → "Copied!" trong 1.2s

---

### `PlanOperators.tsx` — Top Expensive Operators

**Mỗi operator (tối đa 10):**
```
┌──────────────────────────────────────────────────────┐
│ Index Seek: [TableName]  [SEEK]  [Row Est Off] [#1]  │
│  Cost: 0.32  % Total: 45.2%  Est: 1,000  Act: 52,450│
│ ████████████████████░░░░░░░░░░░ 45% (teo-seek color) │
└──────────────────────────────────────────────────────┘
```

- Op name link to glossary key (`opGlossaryKey()`)
- Op type tag: SEEK/SCAN/SORT/JOIN/HASH/AGG/PARALLEL/LOOKUP
- Badges: `has_row_est_off` → orange "Row Est Off", `has_spill` → red "Spill"
- % Total: red nếu ≥70%, orange nếu ≥30%
- Bar màu: `opTagClass(op_type_tag)` → teo-sort/teo-seek/etc.
- `useMemo` cho sorted ops (đã có sẵn thứ tự từ API)

---

### `PlanRowEst.tsx` — Est vs Actual Rows

- Sort: worst ratio first (max(ratio, 1/ratio) descending)
- Ratio format: `+5.2x` nếu actual>est, `/3.4x` nếu actual<est
- Visual bar: `Math.min(100, Math.max(8, magnitude * 10))%`
- Card per mismatch với Est / Act / Ratio metric chips
- `useMemo` cho sort

---

### `PlanIoStats.tsx` — I/O Statistics

**Mỗi object (tối đa 12):**
```
┌──────────────────────────────────────────────────────┐
│ [SEEK] Index Seek: [TableName]          [Highest]    │
│  1.2M log    34K phys    12K RA    245 scans          │
│ ████████████████░░░░░░░░░░░░░░ (% of max logical)    │
└──────────────────────────────────────────────────────┘
```

- Relative bar: `pct = logical_reads / max_logical_reads * 100`
- Color: danger ≥75%, warning ≥40%, seek ≥15%, muted <15%
- Metric chips: logical (major, colored), physical (chỉ khi >0), RA (chỉ khi >0), scans (chỉ khi >0)
- "Highest" badge cho item đầu tiên
- `useMemo` cho maxIo

---

### `PlanMissingIndexes.tsx` — Missing Indexes

**Mỗi index:**
```
┌────────────────────────────────────────┐
│ [IMPACT 89.5%]                         │
│  TableName                             │
│  Equality:    col1, col2               │
│  Inequality:  col3                     │
│  Include:     col4, col5               │
│ ┌──────────────────────────────────┐   │
│ │ [Copy DDL]                       │   │
│ │ CREATE NONCLUSTERED INDEX ...    │   │
│ └──────────────────────────────────┘   │
└────────────────────────────────────────┘
```

---

### `PlanStatistics.tsx` — Statistics Used (tất cả, không filter)

- Card per statistic (không lọc — show tất cả)
- Stale: `border-color: var(--color-warning)` nếu `is_stale`
- Metrics: Last Update / Sampling% / Modification count

---

### `PlanParameters.tsx` — Parameters

- DECLARE block ở đầu (multiline code block):
  ```sql
  DECLARE @p1 bigint = 12345;
  DECLARE @p2 nvarchar(100) = N'value';
  ```
- Bảng: Name / Type / Compiled / Runtime
- "Sniffing" badge khi `compiled_value !== runtime_value`

---

### `PlanJoinTypes.tsx` — Join Types & Operations

- Chips với màu:
  - join (Hash Match, Merge Join, Nested Loops) → `bg-[var(--color-primary-soft)]`
  - sort → `bg-[var(--color-critical-soft)]`
  - parallel → `bg-purple-soft`
  - spill → `bg-[var(--color-critical-soft)] border-[var(--color-critical)]`
- Notes phía dưới chips:
  - Khi có spill: "Spills detected: operations exceeded memory grant and wrote to disk."
  - Khi có Hash Match: "Hash Match hiện diện: kiểm tra index trên cột join."

---

### `PlanMemoryGrant.tsx` — Memory Grant

```
[Granted: 128 MB]  [Used: 115 MB (89%)]  [Wait: 0 ms]
████████████████████████████████░░▲ ← 50% mark (orange)  90% mark (red)
```

- Visual bar: `used / granted * 100`%
- Color level: danger ≥90%, warning ≥50%, ok <50%
- Threshold markers: `left: 50%` orange, `left: 90%` red

---

### `PlanWaitStats.tsx` — Wait Statistics

**Mỗi wait:**
```
┌────────────────────────────────────────────┐
│ PAGEIOLATCH_SH                  2,450 ms  ×3│
│ ██████████████░░░░░░░░░ (% of max wait ms)  │
└────────────────────────────────────────────┘
```

- Relative bar: `ms / max_ms * 100`%
- Color: danger ≥75%, warning ≥40%, ok <40%
- `useMemo` cho maxMs

---

### `PlanCompilation.tsx` — Compilation & Settings

- Grid 2 columns: label / value
- CE Model: khi `ce_model_version === 70` → badge "Legacy SQL 2012" màu warning
- Non-parallel reason, early abort: chỉ hiện khi có giá trị
- Query hash / Plan hash: font-code

---

### `PlanLookupQueries.tsx` — Lookup Queries

- Plan Cache SQL block + copy button
- Query Store SQL block + copy button
- Reuse `CopyDdlButton` component

---

## Checklist tuân thủ RULE_VERIFY.md

### TypeScript
- [ ] Không `any` — tất cả props typed từ `@layer3/core`
- [ ] Return type explicit cho mọi exported function
- [ ] Null check trước khi access `.property`

### React
- [ ] Data đã có sẵn (từ mutation), không cần TanStack Query thêm
- [ ] `useMemo` cho calculations nặng (maxIo, sorted mismatches, totalWaitMs)
- [ ] `useCallback` cho handlers truyền vào child components
- [ ] Mỗi file component ≤200 lines

### Styling
- [ ] Dùng `var(--color-*)` — không dùng Tailwind colors trực tiếp
- [ ] Không inline style với hex color
- [ ] Dùng `cn()` utility cho conditional classes

### UX / Accessibility
- [ ] Copy buttons có `aria-label`
- [ ] Accordion buttons có `aria-expanded`
- [ ] Section dots là `aria-hidden="true"`
- [ ] `renderText()`: backtick → `<code>` với proper escaping (XSS safe — JSX auto-escape)

### Security
- [ ] DDL content: render trong `<pre>` qua JSX (auto-escaped)
- [ ] Copy via `navigator.clipboard` — không dùng innerHTML

---

## Thứ tự implement

1. `planUtils.ts` — utilities (không phụ thuộc component nào)
2. `PlanSection.tsx` — wrapper reusable
3. `PlanSummaryBar.tsx` — phần quan trọng nhất, visible nhất
4. Sections theo thứ tự group:
   - ORIENTATION: `PlanWarnings.tsx`
   - COST: `PlanOperators.tsx` → `PlanRowEst.tsx` → `PlanIoStats.tsx`
   - ACTIONABLE: `PlanMissingIndexes.tsx` → `PlanStatistics.tsx` → `PlanParameters.tsx`
   - CONTEXT: `PlanIndexUsage.tsx` → `PlanJoinTypes.tsx` → `PlanMemoryGrant.tsx` → `PlanWaitStats.tsx`
   - DEEP DIVE: `PlanCompilation.tsx` → `PlanLookupQueries.tsx`
5. `PlanAnalysisPanel.tsx` — wire tất cả lại, xóa sub-components cũ trong file

---

*File này là plan reference cho task rebuild PlanAnalysisPanel.*
*Source: `apps/web/dashboard/plan-analysis-component.ts` (Vanilla TS)*
*Target: `apps/web-v2/src/components/plan/` (React 19 + shadcn/ui)*
