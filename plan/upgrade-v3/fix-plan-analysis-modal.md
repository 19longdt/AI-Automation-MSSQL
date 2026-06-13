# Fix Plan: PlanAnalysisPanel — Align với logic bản cũ + Glossary System

**File:** `plan/upgrade-v3/fix-plan-analysis-modal.md`  
**Ngày:** 2026-06-13  
**Scope:** `apps/web-v2/src/components/plan/` + `apps/web-v2/src/components/dashboard/modals/`

---

## Bối cảnh

Bản mới (`PlanAnalysisPanel.tsx`) có **6 điểm lệch** so với bản cũ (`plan-analysis-component.ts`):

1. **Group collapse** — bản mới không có cơ chế toggle group; bản cũ chỉ expand ORIENTATION mặc định, 4 group còn lại collapsed.
2. **Section defaultOpen** — bản mới tự mở 5 section thêm so với bản cũ chỉ mở "Missing Indexes" khi có data.
3. **Warnings badge count** — bản mới dùng `groups.length`, bản cũ dùng `sum(g.count)`.
4. **Glossary data** — bản mới thiếu hoàn toàn file `glossary.ts` (~70 entries).
5. **Glossary tooltip component** — bản mới không có component React tương đương `glossary-tooltip.ts`.
6. **Glossary wiring** — bản mới có 0 `data-glossary` / `GlossaryTip` trong toàn bộ `apps/web-v2`; bản cũ có 45 vị trí trong `plan-analysis-component.ts` và thêm 2 vị trí trong `ag-health-detail.ts`.

---

## Thứ tự thực hiện

1. **Task 3** — sửa Warnings badge count (1 dòng, không phụ thuộc gì).
2. **Task 2** — sửa defaultOpen sections (không cần state mới).
3. **Task 1** — thêm group collapse.
4. **Task 4** — tạo `glossary.ts` + `GlossaryTip` component (cần hoàn thành trước Task 5 và 6).
5. **Task 5** — wire `GlossaryTip` vào Plan Analysis sections.
6. **Task 6** — wire `GlossaryTip` vào các modal khác (AgHealth, AgRedoSecondary).

---

## Task 1 — Group-level collapse

**File:** `apps/web-v2/src/components/plan/PlanAnalysisPanel.tsx`

Thêm state `collapsedGroups`. Mặc định:
- `orientation` → expanded
- `cost`, `actionable`, `context`, `deepdive` → collapsed

```tsx
const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
  () => new Set(["cost", "actionable", "context", "deepdive"])
);

function toggleGroup(id: string) {
  setCollapsedGroups(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
}
```

Đổi JSX `<section>` group thành clickable header + body ẩn/hiện:

```tsx
<section key={group.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
  <header
    className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 cursor-pointer select-none"
    onClick={() => toggleGroup(group.id)}
  >
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
      <span className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: group.color }}>
        {group.title}
      </span>
      <span className="text-[11px] text-[var(--color-muted)]">· {group.description}</span>
      <ChevronDown className={cn("ml-auto h-4 w-4 text-[var(--color-muted)] transition-transform duration-150",
        !collapsedGroups.has(group.id) && "rotate-180")} />
    </div>
  </header>
  {!collapsedGroups.has(group.id) && (
    <div className="space-y-2.5 p-3">
      {renderGroup(group.id, statement, group.color)}
    </div>
  )}
</section>
```

---

## Task 2 — Sửa `defaultOpen` sections

**File:** `apps/web-v2/src/components/plan/PlanAnalysisPanel.tsx` — hàm `renderGroup`

Quy tắc: **chỉ** Missing Indexes được `defaultOpen`. Tất cả section còn lại bỏ prop (mặc định `false`).

| Section | Trước | Sau |
|---|---|---|
| Query Text | `defaultOpen` | bỏ |
| Warnings | `defaultOpen` | bỏ |
| Top Operators | `defaultOpen` | bỏ |
| Missing Indexes | `defaultOpen` | **giữ** |
| Index Usage | `defaultOpen` | bỏ |
| Compilation | `defaultOpen` | bỏ |

---

## Task 3 — Sửa Warnings badge count

**File:** `apps/web-v2/src/components/plan/PlanAnalysisPanel.tsx` — hàm `renderGroup`, nhánh `orientation`

```tsx
// HIỆN TẠI (sai):
count={statement.finding_groups.length}

// SỬA THÀNH:
count={statement.finding_groups.reduce((sum, g) => sum + g.count, 0)}
```

---

## Task 4 — Tạo Glossary infrastructure

### 4a. Data file

**File tạo mới:** `apps/web-v2/src/components/plan/glossary.ts`

Port toàn bộ từ `apps/web/dashboard/glossary.ts`. Giữ nguyên interface và data.
Chỉ export những gì cần cho Plan Analysis + AG Health modals (~70 entries hiện có trong bản cũ, giữ tất cả).

```ts
export interface GlossaryEntry {
  term: string;
  definition: string;
  threshold?: string;
  impact: string;
  formula?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ... port từ apps/web/dashboard/glossary.ts
};
```

### 4b. GlossaryTip component

**File tạo mới:** `apps/web-v2/src/components/plan/GlossaryTip.tsx`

Thay thế cơ chế `attachGlossaryTooltips(root)` bằng React component inline:

```tsx
import { useState, useRef, useEffect } from "react";
import { GLOSSARY } from "./glossary";
import type { ReactNode } from "react";

interface Props {
  glossaryKey: string;
  children?: ReactNode;
}

export function GlossaryTip({ glossaryKey, children }: Props) {
  const entry = GLOSSARY[glossaryKey];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  // đóng khi click ngoài
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span className="inline-flex items-center gap-1 relative">
      {children}
      <button
        ref={btnRef}
        type="button"
        className="gl-tip-btn"
        aria-label={`Giải thích: ${entry.term}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
      >
        ?
      </button>
      {open && (
        <div className="gl-tooltip">
          <div className="gl-tooltip-term">{entry.term}</div>
          <div className="gl-tooltip-def">{entry.definition}</div>
          {entry.threshold && (
            <div className="gl-tooltip-row">
              <span className="gl-tooltip-label">Threshold</span>
              <span className="gl-tooltip-val">{entry.threshold}</span>
            </div>
          )}
          <div className="gl-tooltip-row">
            <span className="gl-tooltip-label">Impact</span>
            <span className="gl-tooltip-val">{entry.impact}</span>
          </div>
          {entry.formula && <div className="gl-tooltip-formula">{entry.formula}</div>}
        </div>
      )}
    </span>
  );
}
```

**CSS** — thêm vào `base.css` hoặc tạo `glossary.css` (port từ bản cũ):
- `.gl-tip-btn` — nút `?` nhỏ inline
- `.gl-tooltip` — tooltip popup (position: absolute hoặc fixed tùy layout)
- `.gl-tooltip-term`, `.gl-tooltip-def`, `.gl-tooltip-row`, `.gl-tooltip-label`, `.gl-tooltip-val`, `.gl-tooltip-formula`

---

## Task 5 — Wire GlossaryTip vào Plan Analysis

Sau khi Task 4 xong, thêm `<GlossaryTip>` vào các file sau:

### `PlanSummaryBar.tsx` — 11 key

| Label | Key |
|---|---|
| STMT TYPE | `statement_type` |
| OPTIMIZATION | `optm_level` |
| WARNINGS | `warnings_count` |
| MISSING IDX | `missing_index_impact` |
| PARALLELISM | `dop` |
| EST. COST | `total_cost` |
| ELAPSED | `actual_elapsed` |
| CPU TIME | `cpu_time` |
| MEM USED | `mem_used` |
| TOP WAIT | `[dynamic: top wait type lowercase]` |
| WAIT TIME | `wait_stat` |

Cách implement: label `<span>` bọc trong `<GlossaryTip glossaryKey="...">`:
```tsx
<span className="text-[9px] ...">
  <GlossaryTip glossaryKey="statement_type">STMT TYPE</GlossaryTip>
</span>
```

### `PlanAnalysisPanel.tsx` — 5 key (group descriptions)

Bọc `group.description` span trong `<GlossaryTip glossaryKey={`group_${group.id}`}>`:
```tsx
<span className="text-[11px] text-[var(--color-muted)]">
  <GlossaryTip glossaryKey={`group_${group.id}`}>· {group.description}</GlossaryTip>
</span>
```

### `PlanIoStats.tsx` — 4 key

| Element | Key |
|---|---|
| "log" unit label | `logical_reads` |
| "phys" unit label | `physical_reads` |
| "RA" unit label | `read_ahead` |
| "scans" unit label | `scan_count` |

### `PlanOperators.tsx` — 3 key

| Element | Key |
|---|---|
| Operator name | dynamic: `_opGlossaryKey(physicalOp, logicalOp)` — port mapping từ bản cũ |
| "Est Rows" label | `estimated_rows` |
| Spill badge | `spill_to_tempdb` |

### `PlanRowEst.tsx` — 3 key

| Label | Key |
|---|---|
| "Est Rows" | `estimated_rows` |
| "Act Rows" | `actual_rows` |
| "Ratio" | `row_est_ratio` |

### `PlanJoinTypes.tsx` — 2 key

| Element | Key |
|---|---|
| Spill chip | `spill_to_tempdb` |
| Hash Match note | `hash_match` |

### `PlanParameters.tsx` — 2 key

| Label | Key |
|---|---|
| "Compiled" column header | `parameter_sniffing` |
| "Runtime" column header | `parameter_sniffing` |

### `PlanIndexUsage.tsx` — 1 key

| Element | Key |
|---|---|
| "Lookup" badge | `key_lookup` |

### `PlanMemoryGrant.tsx` — 3 key

| Label | Key |
|---|---|
| "Granted" | `memory_grant` |
| "Used" | `memory_grant` |
| "Wait" | `resource_semaphore` |

### `PlanCompilation.tsx` — 8 key

| Label | Key |
|---|---|
| CE Model | `cardinality_estimation` |
| DOP | `dop` |
| Compile CPU | `compile_cpu` |
| Compile Memory | `compile_memory` |
| Optm level | `optm_level` |
| Non-parallel reason | `non_parallel_reason` |
| Query hash | `query_hash` |
| Plan hash | `plan_hash` |

### `PlanMissingIndexes.tsx` — 4 key

| Element | Key |
|---|---|
| IMPACT badge | `missing_index_impact` |
| "Equality" label | `idx_equality_col` |
| "Inequality" label | `idx_inequality_col` |
| "Include" label | `idx_include_col` |

### `PlanWarnings.tsx` — 1 key (dynamic)

Warning category label — key = `g.type` (nếu có trong GLOSSARY):
```tsx
<GlossaryTip glossaryKey={g.type}>
  {warnLabel(g.type)}
</GlossaryTip>
```

---

## Task 6 — Wire GlossaryTip vào các modal khác

Bản cũ dùng `fieldRow(label, glossaryKey, valueHtml)` và `kpi(label, key, valueHtml, cls)` — cả hai đều embed `data-glossary` vào label cell, sau đó `attachGlossaryTooltips(root)` pick up.

Bản mới cần sửa `FieldRow` và `KpiStrip` components để nhận `glossaryKey` prop.

### `AgHealthModal.tsx` — ~12 vị trí

Sửa `FieldRow` component:
```tsx
// TRƯỚC:
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <tr>
    <td>{label}</td>
    ...
  </tr>
}

// SAU:
function FieldRow({ label, glossaryKey, children }: { label: string; glossaryKey?: string; children: ReactNode }) {
  return <tr>
    <td>
      {glossaryKey ? <GlossaryTip glossaryKey={glossaryKey}>{label}</GlossaryTip> : label}
    </td>
    ...
  </tr>
}
```

Tương tự `KpiStrip` — thêm `glossaryKey` vào mỗi KPI entry:
```tsx
{ label: "Sync Health",  glossaryKey: "synchronization_health_desc", ... },
{ label: "Connected",    glossaryKey: "connected_state_desc",        ... },
{ label: "Log Send Q",   glossaryKey: "log_send_queue_size",         ... },
{ label: "Log Rate",     glossaryKey: "log_send_rate",               ... },
```

Tất cả `FieldRow` call thêm `glossaryKey`:

| Label | Key |
|---|---|
| Replica | `replica_server_name` |
| Database | `database_name` |
| Role | `role_desc` |
| Sync state | `synchronization_state_desc` |
| Sync health | `synchronization_health_desc` |
| Connected | `connected_state_desc` |
| Operational | `operational_state_desc` |
| Suspended | `is_suspended` |
| Suspend reason | `suspend_reason_desc` |
| Failover ready | `is_failover_ready` |
| Log Send Queue | `log_send_queue_size` |
| Log Rate | `log_send_rate` |

### `AgRedoSecondaryModal.tsx` — ~7 vị trí

Tương tự AgHealthModal. Các key cần thêm:

| Label | Key |
|---|---|
| Sync state | `synchronization_state_desc` |
| Sync health | `synchronization_health_desc` |
| Suspended | `is_suspended` |
| Redo Queue | `redo_queue_size` |
| Redo Rate | `redo_rate` |
| Last Redone | `last_redone_time` |
| Last Commit | `last_commit_time` |

### `BlockingChainModal.tsx` — bổ sung mới (không có ở bản cũ)

Bản cũ không implement glossary cho modal này. Bản mới **phải bổ sung** vì modal đã có đầy đủ UI.

Sửa `FieldRow` (thêm `glossaryKey` prop — cùng pattern với AgHealthModal).

**KPI strip** — thêm `glossaryKey` vào mỗi entry:

| Label | Key | Ghi chú |
|---|---|---|
| Head Blocker | `head_blocker` | entry MỚI — chưa có trong glossary.ts |
| Blocked | `blocked_session_count` | entry MỚI |
| Depth | `chain_depth` | entry MỚI |
| Max Wait | `max_wait_sec` | entry MỚI |

**Chain tab** — `wait_type` hiển thị per session:
```tsx
<span className="font-code text-[11px] ...">
  <GlossaryTip glossaryKey={session.wait_type.toLowerCase()}>
    {session.wait_type}
  </GlossaryTip>
</span>
```
(fallback graceful nếu key không có trong GLOSSARY)

**Locks tab** — header "Mode":
```tsx
<GlossaryTip glossaryKey="lock_mode">Mode</GlossaryTip>
```
Entry `lock_mode` là MỚI.

**IDLE TXN badge**:
```tsx
<GlossaryTip glossaryKey="idle_txn">IDLE TXN</GlossaryTip>
```
Entry `idle_txn` là MỚI.

---

### `DeadlockModal.tsx` — bổ sung mới (không có ở bản cũ)

Sửa `FieldRow` thêm `glossaryKey` prop.

**KPI strip**:

| Label | Key | Ghi chú |
|---|---|---|
| Victim | `deadlock_victim` | entry MỚI |
| Deadlock Time | `deadlock_time` | entry MỚI |

**FieldRow** trong SummaryBody:

| Label | Key | Ghi chú |
|---|---|---|
| Victim ID | `deadlock_victim` | dùng cùng key với KPI |
| Deadlock Time | `deadlock_time` | dùng cùng key |

---

### `CdcHealthModal.tsx` — bổ sung mới (không có ở bản cũ)

Sửa `FieldRow` thêm `glossaryKey` prop.

**KPI strip**:

| Label | Key | Ghi chú |
|---|---|---|
| Status | `run_status` | đã có trong glossary.ts |
| Job | `job_name` | đã có |
| Duration | `run_duration` | đã có |

**FieldRow** trong DetailBody:

| Label | Key |
|---|---|
| Job Name | `job_name` |
| Status | `run_status` |
| Run Duration | `run_duration` |
| Node | `node_name` |

---

## Task 4a bổ sung — Entries MỚI cần thêm vào `glossary.ts`

Các key xuất hiện trong modal mới nhưng **chưa có** trong bản cũ `glossary.ts`:

| Key | Term | Nội dung tóm tắt |
|---|---|---|
| `head_blocker` | Head Blocker Session | Session đang giữ lock gây blocking chain. Không bị chặn bởi session nào khác. |
| `blocked_session_count` | Blocked Session Count | Tổng số session bị block trực tiếp hoặc gián tiếp bởi head blocker. |
| `chain_depth` | Blocking Chain Depth | Số cấp lồng nhau trong blocking chain. Depth=3 nghĩa là A→B→C→D. |
| `max_wait_sec` | Max Wait (seconds) | Thời gian chờ lâu nhất trong chuỗi blocking, tính từ session bị block lâu nhất. |
| `idle_txn` | Idle Transaction | Session đang IDLE (không chạy query) nhưng vẫn giữ open transaction và lock. Nguyên nhân phổ biến nhất gây blocking kéo dài. |
| `lock_mode` | Lock Mode | Chế độ lock: X (exclusive write), IX (intent exclusive), U (update), S (shared read), IS (intent shared), SIX. X và IX gây blocking nhiều nhất. |
| `deadlock_victim` | Deadlock Victim | Session bị SQL Server chọn để rollback khi phát hiện deadlock cycle. Thường là session có transaction cost thấp hơn. |
| `deadlock_time` | Deadlock Time | Thời điểm SQL Server phát hiện và giải quyết deadlock (rollback victim). |

---

## Tổng hợp file bị ảnh hưởng

| File | Task |
|---|---|
| `apps/web-v2/src/components/plan/PlanAnalysisPanel.tsx` | 1, 2, 3, 5 |
| `apps/web-v2/src/components/plan/glossary.ts` | 4a (tạo mới — port cũ + 8 entries mới) |
| `apps/web-v2/src/components/plan/GlossaryTip.tsx` | 4b (tạo mới) |
| `apps/web-v2/src/components/plan/PlanSummaryBar.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanIoStats.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanOperators.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanRowEst.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanJoinTypes.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanParameters.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanIndexUsage.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanMemoryGrant.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanCompilation.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanMissingIndexes.tsx` | 5 |
| `apps/web-v2/src/components/plan/sections/PlanWarnings.tsx` | 5 |
| `apps/web-v2/src/components/dashboard/modals/AgHealthModal.tsx` | 6 |
| `apps/web-v2/src/components/dashboard/modals/AgRedoSecondaryModal.tsx` | 6 |
| `apps/web-v2/src/components/dashboard/modals/BlockingChainModal.tsx` | 6 (mới bổ sung) |
| `apps/web-v2/src/components/dashboard/modals/DeadlockModal.tsx` | 6 (mới bổ sung) |
| `apps/web-v2/src/components/dashboard/modals/CdcHealthModal.tsx` | 6 (mới bổ sung) |
| CSS (base.css hoặc glossary.css) | 4b |

---

## Checklist kiểm tra sau khi hoàn thành

### Group / Section behavior
- [ ] Mở Plan Analysis modal → chỉ ORIENTATION expand, 4 group còn lại collapsed
- [ ] Click header group → toggle expand/collapse
- [ ] Trong ORIENTATION: Query Text và Warnings đều closed ban đầu
- [ ] ACTIONABLE với missing indexes → chỉ Missing Indexes tự open
- [ ] Warnings badge hiện tổng instances: 3 groups × count=2 → "6", không phải "3"

### Glossary — Plan Analysis
- [ ] Summary bar: mọi label có nút `?` và tooltip đúng nội dung
- [ ] Group description: click `?` → tooltip group_orientation/cost/...
- [ ] PlanIoStats: logical/physical/RA/scan có tooltip
- [ ] PlanOperators: tên operator có tooltip (hash_match, sort, nested_loops...)
- [ ] PlanWarnings: warning category label có tooltip
- [ ] PlanCompilation: CE model, DOP, query hash có tooltip
- [ ] Tooltip đóng khi click ra ngoài

### Glossary — AG modals
- [ ] AgHealthModal KPI strip: Sync Health, Connected, Log Send Q, Log Rate có nút `?`
- [ ] AgHealthModal table: Replica, Database, Role, Sync state... có nút `?`
- [ ] AgRedoSecondaryModal KPI: Redo Queue, Redo Rate, Redo Lag, Last Commit có nút `?`
- [ ] AgRedoSecondaryModal table: Redo Queue, Redo Rate, Secondary Lag, Last Redone... có nút `?`

### Glossary — Blocking / Deadlock / CDC (bổ sung mới)
- [ ] BlockingChainModal KPI: Head Blocker, Blocked, Depth, Max Wait có nút `?`
- [ ] BlockingChainModal Chain tab: wait_type per session có tooltip (fallback graceful nếu unknown)
- [ ] BlockingChainModal Locks tab: "Mode" header có tooltip giải thích lock modes
- [ ] BlockingChainModal: IDLE TXN badge có tooltip
- [ ] DeadlockModal KPI: Victim, Deadlock Time có nút `?`
- [ ] DeadlockModal Summary: Victim ID, Deadlock Time field có nút `?`
- [ ] CdcHealthModal KPI: Status, Job, Duration có nút `?`
- [ ] CdcHealthModal Detail: Job Name, Status, Run Duration, Node có nút `?`
