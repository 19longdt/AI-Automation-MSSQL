# Plan: Maintenance Page — Pipeline Visualization UI (Layer 3)

## Context

Package `maintenance/` quản lý toàn bộ vòng đời bảo trì index/stats SQL Server theo flow:
**SCAN (20:00) → Telegram Approval → QUEUE (execute đêm) → HISTORY (audit)**. Hiện DBA chỉ tương tác qua Telegram. Cần page trong Layer 3 để:
- Nhìn thấy pipeline state: batch đang chờ duyệt? bao nhiêu items trong queue? đang chạy không?
- Theo dõi window mở/đóng, budget đã dùng, safety gate thresholds
- Xem queue items theo status với đầy đủ metadata (frag%, pages, est time)
- Xem lịch sử với frag delta (before → after) để đánh giá hiệu quả

**Key constraint:** Maintenance dùng `db_maintenance` — cùng MongoDB instance với `db_monitor`, khác database name. Layer 3 Express cần thêm Db handle, không cần connection mới.

---

## Architecture Overview

```
MongoDB URI (shared — same container)
├── db_monitor       ← existing
└── db_maintenance   ← NEW access from Layer 3
    ├── maintenance_queue     (work items: AWAITING_APPROVAL/APPROVED/RUNNING/PAUSED/DONE/FAILED)
    ├── maintenance_batches   (batch approval state)
    ├── maintenance_history   (audit log: frag before/after, duration, outcome)
    ├── maintenance_window    (single doc: time slot, budget, kill_switch, gate thresholds)
    └── maintenance_scan_queries (scan SQL templates)

Layer 3 Express
├── db/client.ts              ← add getDbByName(name)
├── config.ts                 ← add maintMongoDb (MAINT_MONGODB_DB)
├── server.ts                 ← add getMaintDb() decorator + /maintenance SPA route
├── routes/maintenance.ts     ← NEW: 3 endpoints
└── services/maintenance-service.ts ← NEW: MongoDB queries + window state computation

Layer 3 React
├── App.tsx             ← add /maintenance route + lazy import
├── Topbar.tsx          ← add "Maintenance" nav link
├── pages/MaintenancePage.tsx               ← NEW: page container
├── components/maintenance/WindowStatusBar.tsx  ← compact sticky bar
├── components/maintenance/PipelineStages.tsx   ← 4-node pipeline visualization
├── components/maintenance/QueueTable.tsx        ← work items table with status tabs
├── components/maintenance/HistoryTable.tsx      ← audit history table
└── hooks/useMaintenance.ts                     ← React Query hooks
```

---

## UI Layout

```
┌─ Topbar ─── Dashboard | Insights | Query Plan | Maintenance | Settings ──┐
│                                                                            │
│ ┌── WindowStatusBar (sticky below Topbar, ~48px) ──────────────────────┐  │
│ │ 🟢 OPEN  01:00–04:00  │  Budget: 124/170 min ████████░░ 73%  ~46min  │  │
│ │ Gates: CPU ≤60%  │  Requests ≤50  │  AG Send ≤100MB  │  AG Redo ≤200MB│  │
│ └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│ ┌── PipelineStages ──────────────────────────────────────────────────┐    │
│ │  [SCAN]────→[APPROVAL]────→[QUEUE]────→[KẾT QUẢ]                  │    │
│ │  20:00 hôm nay  Đã duyệt   42 APPROVED   38 DONE                  │    │
│ │  47 items       Toàn bộ     1 RUNNING ⚡   2 FAILED                │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│ ┌── Tabs: [Hàng chờ] [Lịch sử] ─────────────────────────────────────┐    │
│ │  QueueTable (status sub-tabs) | HistoryTable                       │    │
│ └────────────────────────────────────────────────────────────────────┘    │
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `layer3/apps/api/src/db/client.ts` | **Sửa** — export `getDbByName(name)` |
| `layer3/apps/api/src/config.ts` | **Sửa** — thêm `maintMongoDb` |
| `layer3/apps/api/src/server.ts` | **Sửa** — `getMaintDb()` decorator + SPA route `/maintenance` |
| `layer3/apps/api/src/routes/maintenance.ts` | **Tạo** |
| `layer3/apps/api/src/services/maintenance-service.ts` | **Tạo** |
| `layer3/apps/web-v2/src/pages/MaintenancePage.tsx` | **Tạo** |
| `layer3/apps/web-v2/src/components/maintenance/WindowStatusBar.tsx` | **Tạo** |
| `layer3/apps/web-v2/src/components/maintenance/PipelineStages.tsx` | **Tạo** |
| `layer3/apps/web-v2/src/components/maintenance/QueueTable.tsx` | **Tạo** |
| `layer3/apps/web-v2/src/components/maintenance/HistoryTable.tsx` | **Tạo** |
| `layer3/apps/web-v2/src/hooks/useMaintenance.ts` | **Tạo** |
| `layer3/apps/web-v2/src/components/layout/Topbar.tsx` | **Sửa** — thêm nav link |
| `layer3/apps/web-v2/src/App.tsx` | **Sửa** — thêm route + lazy import |

---

## Task 1 — Express API Backend

### 1a. `db/client.ts`

```typescript
export function getDbByName(name: string): Db {
  if (!client) throw new Error("MongoDB is not connected");
  return client.db(name);  // same MongoClient, different Db — no reconnect
}
```

### 1b. `config.ts`

```typescript
interface AppConfig { /* existing */ maintMongoDb: string; }
// readConfig():
maintMongoDb: env.MAINT_MONGODB_DB || "db_maintenance",
```

### 1c. `server.ts`

```typescript
declare module "fastify" {
  interface FastifyInstance { getMaintDb(): Db; }
}
app.decorate("getMaintDb", () => getDbByName(config.maintMongoDb));
app.get("/maintenance", async (_req, reply) => reply.sendFile("index.html", dist2Root));
await registerMaintenanceRoutes(app);
```

### 1d. API Endpoints (`routes/maintenance.ts`)

**`GET /api/maintenance/summary`** — dashboard data:
```json
{
  "window": {
    "open": true, "remaining_minutes": 45.5,
    "reason": "open",
    "slot": { "start": "01:00", "end": "04:00", "time_budget_minutes": 170 },
    "budget_used_minutes": 124.5, "kill_switch": false,
    "gates": { "cpu_max_pct": 60, "max_active_requests": 50,
                "max_log_send_queue_kb": 100000, "max_redo_queue_kb": 200000 }
  },
  "queue_counts": { "awaiting_approval": 0, "approved": 42, "running": 1,
                    "paused": 3, "done": 38, "failed": 2 },
  "last_batch": {
    "batch_id": "abc12345", "status": "DECIDED", "decision": "all",
    "item_count": 47, "decided_at": "...",
    "summary": { "reorganize": 10, "rebuild": 30, "update_statistics": 7, "est_total_minutes": 160 }
  },
  "last_scan_job": { "ran_at": "...", "status": "SUCCESS", "records_processed": 47 }
}
```

**`GET /api/maintenance/queue?status=&action_type=&page=0&limit=50`**
```json
{
  "total": 42,
  "items": [{
    "item_id": "...", "short_id": "abc12345",
    "table_name": "Orders", "schema_name": "dbo", "index_name": "IX_Orders_Date",
    "action_type": "REBUILD", "kind": "INDEX_FRAG",
    "fragmentation_pct": 67.4, "page_count": 85000,
    "estimated_minutes": 4.5, "priority": 97.3,
    "status": "APPROVED", "attempts": 0, "last_error": null,
    "resume_token": false, "created_at": "..."
  }]
}
```

**`GET /api/maintenance/history?page=0&limit=50&outcome=`**
```json
{
  "total": 120,
  "items": [{
    "history_id": "...", "table_name": "Orders", "schema_name": "dbo",
    "index_name": "IX_Orders_Date", "action_type": "REBUILD", "outcome": "DONE",
    "frag_before_pct": 67.4, "frag_after_pct": 0.1,
    "duration_ms": 245000, "skip_reason": null, "error": null,
    "started_at": "...", "finished_at": "..."
  }]
}
```

### 1e. Window State Computation (`maintenance-service.ts`)

Vietnam = UTC+7, không có DST → tính đơn giản:
```typescript
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function toVnMinutes(d: Date): number {
  return Math.floor((d.getTime() + VN_OFFSET_MS) / 60000) % 1440;
}
function slotContains(slot, vnMin): boolean {
  // handles midnight-crossing (start=23:00, end=04:00)
}
```
Budget used = aggregate `maintenance_history` WHERE `started_at >= window_start AND outcome IN [DONE,FAILED,PAUSED]`, sum `duration_ms / 60000`.

---

## Task 2 — React Frontend

### `WindowStatusBar.tsx` — compact sticky strip (~48px)

Hai row:
- Row 1: status badge (🟢 OPEN / 🔴 CLOSED) + slot time + budget progress bar + remaining
- Row 2 (muted): gate thresholds (từ config, không phải live values)

```
[ 🟢 OPEN  01:00–04:00 ]  [ ████████░░  124/170 min (73%)  ~46 min còn ]  [ Kill-switch: — ]
  CPU ≤60%  ·  Requests ≤50  ·  AG Send ≤100MB  ·  AG Redo ≤200MB
```

Colors: `var(--color-ok)` open, `var(--color-bad)` closed, `var(--color-warning)` kill_switch=true.

### `PipelineStages.tsx` — n8n-inspired 4 nodes

4 cards với connector arrows (`→`). CSS `grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]`:

| Node | Icon | Hiển thị | Glow condition |
|---|---|---|---|
| SCAN | `Calendar` | last_scan ran_at + items count | luôn neutral |
| APPROVAL | `CheckCircle2` | batch status badge + decision + item_count | `--color-warning` nếu AWAITING_APPROVAL |
| QUEUE | `ListOrdered` | approved/running/paused counts | `--color-primary` nếu running > 0 |
| KẾT QUẢ | `BarChart2` | done/failed counts (đêm qua) | `--color-ok` nếu failed = 0 |

Node active state: `border-[var(--color-X)] shadow-[0_0_10px_var(--color-X)]`
Node default: `border-[var(--color-border)] bg-[var(--color-surface)]`

### `QueueTable.tsx` — work items

Status tabs (horizontal scrollable): **ALL | ⏳ CHỜ DUYỆT | APPROVED | ⚡ RUNNING | ⏸ PAUSED | ✓ DONE | ✕ FAILED**

Columns: `#` | `Đối tượng (schema.table / index)` | `Action badge` | `Frag %` | `Pages` | `Est` | `Priority` | `Trạng thái` | `Lỗi`

Row decoration (left border):
- RUNNING: `border-l-2 border-[var(--color-primary)] bg-[var(--color-primary-soft)]`
- PAUSED: `border-l-2 border-[var(--color-warning)]`
- FAILED: `border-l-2 border-[var(--color-bad)]`

Action badges: REBUILD=red-soft, REORGANIZE=warning-soft, UPDATE_STATS=primary-soft, HEAP_REBUILD=muted

### `HistoryTable.tsx` — audit log

Outcome filter dropdown. Columns: `Bảng.Index` | `Action` | `Kết quả badge` | `Frag trước→sau` | `Thời gian` | `Bắt đầu` | `Lỗi`

Frag delta: `67.4% → 0.1%` — màu `--color-ok` nếu sau < trước, màu `--color-muted` nếu null/skipped.

### `MaintenancePage.tsx`

```tsx
const [tab, setTab] = useState<"queue"|"history">("queue");
return (
  <div className="h-full overflow-hidden flex flex-col">
    <WindowStatusBar data={summary?.window} />
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-col gap-3">
        <PipelineStages data={summary} isLoading={summaryLoading} />
        <TabBar tab={tab} onChange={setTab} />
        {tab === "queue"   && <QueueTable />}
        {tab === "history" && <HistoryTable />}
      </div>
    </div>
  </div>
);
```

### `useMaintenance.ts`

```typescript
export function useMaintenanceSummary() {
  return useQuery({ queryKey: ["maint","summary"],
    queryFn: () => apiGet<MaintenanceSummary>("/api/maintenance/summary"),
    staleTime: 30_000, refetchInterval: 60_000 });
}
export function useMaintenanceQueue(filters) {
  return useQuery({ queryKey: ["maint","queue",filters],
    queryFn: () => apiGet("/api/maintenance/queue", filters),
    staleTime: 30_000, refetchInterval: 60_000 });
}
export function useMaintenanceHistory(filters) {
  return useQuery({ queryKey: ["maint","history",filters],
    queryFn: () => apiGet("/api/maintenance/history", filters),
    staleTime: 60_000 });
}
```

### Navigation

**`Topbar.tsx`:** thêm `{ href: "/maintenance", label: "Maintenance" }` vào `NAV_LINKS`.

**`App.tsx`:**
```typescript
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage")
  .then(m => ({ default: m.MaintenancePage })));
// resolveRoute: if (p.startsWith("/maintenance")) return "maintenance";
// JSX: {route === "maintenance" && <MaintenancePage />}
```

---

## Design Tokens (reuse existing `base.css` — không thêm token mới)

| Element | CSS Variable |
|---|---|
| Window OPEN badge | `var(--color-ok)` |
| Window CLOSED badge | `var(--color-bad)` |
| RUNNING / node glow | `var(--color-primary)` |
| AWAITING / PAUSED | `var(--color-warning)` |
| FAILED | `var(--color-bad)` |
| DONE | `var(--color-ok)` |
| SKIPPED/EXPIRED | `var(--color-muted)` |
| Node active glow | `box-shadow: 0 0 10px currentColor` |

Icons: Lucide (`Calendar`, `CheckCircle2`, `ListOrdered`, `BarChart2`, `Zap`, `ShieldAlert`)

---

## Env Variable

Thêm vào `.env.example`:
```env
MAINT_MONGODB_DB=db_maintenance    # same URI, different database
```

---

## Verification

1. `npm run build` trong `layer3/` → no TypeScript errors
2. Mở `/maintenance` → nav link active, WindowStatusBar hiển thị (empty states graceful nếu db_maintenance trống)
3. Khi có data: PipelineStages counts đúng, QueueTable sort priority DESC
4. Status tab filter đúng
5. HistoryTable frag delta màu đúng

---

---

# Plan: Slow Sessions — Query Hash Stats Table cạnh Timeline Chart

## Context

Topic `slow_sessions` hiện dùng layout mặc định: KpiCards → TimelineChart → FindingsTable. Mỗi finding là 1 snapshot của 1 session tại thời điểm job chạy — cùng một query chậm có thể xuất hiện nhiều lần với nhiều findings riêng biệt. User cần bảng tổng hợp group by `query_hash` để thấy ngay "query nào lặp lại nhiều nhất, trung bình chạy bao lâu" — đặt cạnh TimelineChart theo layout grid.

**Layout mới:**
```
KpiCards
┌────────────────────────┬──────────────────────┐
│ TimelineChart (1.6fr)  │ Query Stats Table    │
│ (existing component)   │ (SlowQueryStatsTable)│
└────────────────────────┴──────────────────────┘
FindingsTable
```

---

## Files cần tạo / sửa

| File | Action |
|---|---|
| `src/components/dashboard/SlowQueryStatsTable.tsx` | **Tạo mới** |
| `src/pages/DashboardPage.tsx` | **Sửa** — thêm branch cho slow_sessions |

---

## Task 1: `SlowQueryStatsTable.tsx`

### Data fetch

Fetch tất cả findings của `slow_sessions` trong time range hiện tại — paginated loop giống pattern `TempdbMemoryPreview.tsx`:

```typescript
async function fetchAllFindings(params): Promise<FindingsResponse>
// loop: page 0, 1, 2... đến khi items < limit (limit=200)
```

**Inputs từ store/hooks:**
- `selectedClusterId`, `filters`, `from`, `to` từ `useDashboardStore` + `useTimeRange`
- `buildFindingsQuery` từ `@/lib/dashboard-query`
- `apiGet` từ `@/lib/api-client`

### Aggregation (client-side, pure JS)

Group findings by `query_hash`, tính:

```typescript
interface QueryHashStat {
  query_hash: string;           // e.g. "0xBCB0FE0D676B9C4F"
  count: number;                // số lần xuất hiện
  avg_elapsed: number;          // avg elapsed_seconds
  max_elapsed: number;          // max elapsed_seconds
  avg_cpu: number;              // avg cpu_time_seconds
  sql_text: string;             // từ finding mới nhất (có thể null/empty)
  severity: string;             // severity cao nhất trong group
}
```

Sort: `avg_elapsed DESC`, top 15 rows.

Exclude rows where `query_hash` là null/empty/"0x0000000000000000".

### UI

Wrap trong `ChartFrame` (import từ `@/components/dashboard/BaseMetricChart`):

```
eyebrow: "Query thường gặp"
title:   "Thống kê theo Query Hash"
```

Table layout — compact, full height của ChartFrame:

| # | Query Hash | Lần | Avg Elapsed | Max | Avg CPU | SQL |
|---|---|---|---|---|---|---|
| 1 | `0xBCB0FE0D` | 24 | 45.2s | 312s | 12.1s | `SELECT TOP 10 ... FROM Orders WHERE...` |

**Styling:**
- Table chiều cao fill ChartFrame: `overflow-y-auto`, font `text-[11px]`
- Row severity tone: CRITICAL = `text-[var(--color-bad)]`, WARNING = `text-[var(--color-warn)]`
- SQL text: truncate 70 ký tự, monospace, `text-[var(--color-muted)]`
- Query hash: truncate 10 ký tự, monospace
- Elapsed/CPU: format `Xs` hoặc `Xm Ys` nếu ≥ 60s
- Empty state: "Không có dữ liệu trong khoảng thời gian đã chọn"
- Loading state: skeleton rows

### Hooks/Utilities tái sử dụng

| Utility | Import |
|---|---|
| `buildFindingsQuery` | `@/lib/dashboard-query` |
| `apiGet` | `@/lib/api-client` |
| `useTimeRange` | `@/hooks/useTimeRange` |
| `useDashboardStore` | `@/store/dashboard.store` |
| `ChartFrame` | `@/components/dashboard/BaseMetricChart` |
| `useQuery` | `@tanstack/react-query` |
| `Skeleton` | `@/components/ui/skeleton` |

---

## Task 2: Sửa `DashboardPage.tsx`

Thêm branch cho `slow_sessions` — giữ nguyên TimelineChart, thêm grid cạnh:

```tsx
import { SlowQueryStatsTable } from "@/components/dashboard/SlowQueryStatsTable";

const showSlowSessionStats = activeTopicId === "slow_sessions";

// JSX:
{showSlowSessionStats ? (
  <>
    <KpiCards />
    <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
      <TimelineChart data={timeline} isLoading={timelineLoading} isFetching={timelineFetching} />
      <SlowQueryStatsTable />
    </div>
    <div className="flex-1 min-h-0">
      <FindingsTable />
    </div>
  </>
) : (
  // existing default layout unchanged
)}
```

`TimelineChart` đã nhận `data/isLoading/isFetching` từ props — giữ nguyên, không thay đổi component đó.

---

## Verification

1. Chọn topic `slow_sessions` → thấy TimelineChart bên trái + bảng stats bên phải
2. Bảng hiển thị đúng top queries sorted by avg_elapsed
3. SQL text truncated ở 70 ký tự
4. Đổi time range → bảng cập nhật theo
5. Khi không có data → empty state message hiện
6. `tsc --noEmit` không có lỗi TypeScript
