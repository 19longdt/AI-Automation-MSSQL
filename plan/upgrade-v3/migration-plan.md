# Layer 3 — Migration Plan v3
> Kết hợp: Code Review + UI/UX Design System + Framework Upgrade
> Nguồn: `review-and-upgrade-plan.md` + `ui-ux-design-system.md` + framework analysis
> Ngày: 2026-06-11

---

## Tổng quan chiến lược

```
HIỆN TẠI                          MỤC TIÊU
─────────────────────────────     ──────────────────────────────────
apps/web/  Vanilla TS + CSS       apps/web-v2/  React 19 + Vite 6
           HTML string concat   →              TSX components + shadcn/ui
           Global var state                    TanStack Query + typed state
           2193-line god module                ~15 focused components
           home-grown esc()                    JSX (XSS-safe by default)

apps/api/  Fastify (GIỮ NGUYÊN)   apps/api/    + schema validation
           No try/catch         →              + try/catch all routes
           No rate limit                       + rate limit kill-session
           No response schema                  + response schema

packages/core/  shared types      packages/core/  mở rộng thêm types
```

**Nguyên tắc migration:**
- Backend Express/Fastify **không đổi** — chỉ hardening
- Frontend rewrite hoàn toàn sang React, chạy song song với web cũ
- Cutover bằng nginx config swap — zero downtime
- Không break API contract — response shape giữ nguyên

---

## Stack mới

| Layer | Package | Lý do |
|---|---|---|
| UI Framework | React 19 | Component model, JSX safe, ecosystem lớn nhất |
| Build Tool | Vite 6 | HMR < 50ms, ESM native, không cần webpack |
| CSS | Tailwind CSS v4 | Utility-first, CSS vars native, zero-runtime |
| Components | shadcn/ui | Radix UI base — accessible by default, copy-paste |
| Data Fetching | TanStack Query v5 | Cache, refetch, loading/error state built-in |
| TypeScript | 5.x strict | `noImplicitAny`, `strictNullChecks` bật |
| Icons | Lucide React | SVG icons nhất quán, tree-shakeable |
| Charts | Recharts | React-native, SVG, responsive |
| State (nhỏ) | Zustand | Chỉ cho global UI state (theme, activeTopicId) |

**Không thêm:** Router (3 pages dùng MPA), i18n (English only), Redux (overkill).

---

## Phase 0 — Backend Hardening (Ưu tiên cao, làm ngay)
> **Thời gian: 2–3 ngày | Không đụng frontend | Giảm rủi ro production ngay**

Xử lý các lỗi Critical + High từ `review-and-upgrade-plan.md` trước khi bắt đầu migrate frontend.

### 0.1 — [C3] Rate limit kill-session (30 phút)

```bash
cd apps/api
pnpm add @fastify/rate-limit
```

```ts
// apps/api/src/server.ts
import rateLimit from "@fastify/rate-limit";

await app.register(rateLimit, {
  global: false   // chỉ apply khi route opt-in
});

// apps/api/src/routes/actions.ts
app.post("/api/actions/kill-session", {
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
}, async (req, reply) => { ... });
```

### 0.2 — [H5] Try/catch tất cả route handlers (2 giờ)

Pattern thống nhất — apply cho tất cả 8 routes:

```ts
// Pattern chuẩn — copy cho mọi route handler
app.get("/api/findings", { schema: findingsQuerySchema }, async (req, reply) => {
  try {
    const q = req.query as FindingsQuery;
    const { total, items } = await listFindings(app.getDb(), q);
    reply.header("X-Total-Count", String(total));
    return reply.send(items);
  } catch (err) {
    app.log.error({ err, path: req.url }, "listFindings failed");
    return reply.code(500).send({ message: "Internal server error" });
  }
});
```

Files cần update: `findings.ts`, `analyses.ts`, `insights.ts`, `topics.ts`, `jobs.ts`, `actions.ts`, `plan.ts`, `health.ts`

### 0.3 — [C1] Fastify request schema validation (4 giờ)

Tạo `apps/api/src/schemas/` — 1 file per route:

```ts
// apps/api/src/schemas/findings.schema.ts
export const findingsQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      finding_id:     { type: "string", maxLength: 64 },
      topic_id:       { type: "string", maxLength: 64 },
      severity:       { type: "string", enum: ["CRITICAL", "WARNING", "INFO", ""] },
      alert_status:   { type: "string", enum: ["sent", "suppressed", "pending", ""] },
      blocking_status:{ type: "string", enum: ["blocked", "not_blocked", ""] },
      since:          { type: "string", maxLength: 32 },
      until:          { type: "string", maxLength: 32 },
      limit:          { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page:           { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false   // ← block MongoDB operator injection
  }
} as const;

export const findingByIdSchema = {
  params: {
    type: "object",
    properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
    required: ["id"],
    additionalProperties: false
  }
} as const;
```

```ts
// actions.ts — validate body
export const killSessionBodySchema = {
  body: {
    type: "object",
    required: ["session_id"],
    properties: {
      session_id: { type: "integer", minimum: 1, maximum: 32767 },
      node:       { type: "string", maxLength: 64, default: "" }
    },
    additionalProperties: false
  }
} as const;
```

### 0.4 — [M4] Fix N+1 analyses query (1 giờ)

```ts
// apps/api/src/services/findings-service.ts
// THAY BẰNG aggregation — chỉ lấy latest per finding_id
const latestAnalyses = await analysesColl.aggregate([
  { $match: { finding_id: { $in: findingIds } } },
  { $sort: { started_at: -1 } },
  { $group: { _id: "$finding_id", doc: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$doc" } },
  { $unset: ["finding_snapshot", "tool_snapshots"] }   // strip heavy fields
]).toArray();
```

### 0.5 — [M8] Request ID trong logs (30 phút)

```ts
// apps/api/src/server.ts
const app = Fastify({
  logger: {
    level: config.logLevel,
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, reqId: req.id };
      }
    }
  },
  requestIdHeader: "x-request-id",
  requestIdLogLabel: "reqId"
});
```

**Deliverable Phase 0:** Backend production-safe. Deploy lên server trước khi bắt đầu frontend migration.

---

## Phase 1 — Frontend Foundation (Scaffold + Design System)
> **Thời gian: 3–5 ngày | Chạy song song với web cũ**

### 1.1 — Scaffold React app trong monorepo

```bash
# Tại root layer3/
pnpm create vite apps/web-v2 --template react-ts
cd apps/web-v2

# Core deps
pnpm add react@19 react-dom@19
pnpm add @tanstack/react-query@5
pnpm add zustand
pnpm add lucide-react
pnpm add recharts

# Tailwind v4
pnpm add tailwindcss@4 @tailwindcss/vite

# shadcn/ui init (chọn: style=default, baseColor=slate, cssVariables=yes)
npx shadcn@latest init
```

**`apps/web-v2/vite.config.ts`:**
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@layer3/core": path.resolve(__dirname, "../../packages/core/src"),
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000"   // proxy sang Express backend
    }
  },
  build: {
    outDir: "../../dist-v2",
    emptyOutDir: true
  }
});
```

### 1.2 — Tailwind v4 config + CSS Design System

**`apps/web-v2/src/styles/globals.css`** — CSS variables từ `ui-ux-design-system.md` §2:

```css
@import "tailwindcss";

/* Inter + JetBrains Mono */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

@theme {
  /* Map Tailwind utilities → CSS variables */
  --color-bg:           var(--color-bg);
  --color-surface:      var(--color-surface);
  --color-critical:     var(--color-critical);
  --color-warning:      var(--color-warning);
  --font-ui:   'Inter', system-ui, sans-serif;
  --font-code: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Light mode (default) ── */
:root {
  --color-bg:             #f8fafc;
  --color-surface:        #ffffff;
  --color-surface-2:      #f1f5f9;
  --color-surface-3:      #e2e8f0;
  --color-text:           #0f172a;
  --color-text-2:         #1e293b;
  --color-muted:          #64748b;
  --color-subtle:         #94a3b8;
  --color-primary:        #2563eb;
  --color-primary-soft:   #eff6ff;
  --color-primary-hover:  #1d4ed8;
  --color-critical:       #dc2626;
  --color-critical-soft:  #fef2f2;
  --color-warning:        #d97706;
  --color-warning-soft:   #fffbeb;
  --color-info:           #2563eb;
  --color-info-soft:      #eff6ff;
  --color-success:        #16a34a;
  --color-success-soft:   #f0fdf4;
  --color-border:         #e2e8f0;
  --color-border-2:       #cbd5e1;
  --color-row-hover:      #f1f5f9;
  --color-overlay:        rgba(15,23,42,0.40);
  --color-code-bg:        #0f172a;
  --color-code-text:      #e2e8f0;
  --color-role-primary:   #1d4ed8;
  --color-role-secondary: #6b7280;
  --group-color-orientation: #2563eb;
  --group-color-cost:        #7c3aed;
  --group-color-actionable:  #dc2626;
  --group-color-context:     #0891b2;
  --group-color-deepdive:    #6b7280;
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 9999px;
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
}

/* ── Dark mode ── */
[data-theme="dark"] {
  --color-bg:             #020617;
  --color-surface:        #0f172a;
  --color-surface-2:      #1e293b;
  --color-surface-3:      #334155;
  --color-text:           #f1f5f9;
  --color-text-2:         #cbd5e1;
  --color-muted:          #94a3b8;
  --color-subtle:         #475569;
  --color-primary:        #3b82f6;
  --color-primary-soft:   #1e3a5f;
  --color-primary-hover:  #60a5fa;
  --color-critical:       #ef4444;
  --color-critical-soft:  #2d1515;
  --color-warning:        #f59e0b;
  --color-warning-soft:   #2d1f0a;
  --color-info:           #3b82f6;
  --color-info-soft:      #1e3a5f;
  --color-success:        #22c55e;
  --color-success-soft:   #0f2d1c;
  --color-border:         #1e293b;
  --color-border-2:       #334155;
  --color-row-hover:      rgba(59,130,246,0.06);
  --color-overlay:        rgba(2,6,23,0.72);
  --color-code-bg:        #020617;
  --color-code-text:      #e2e8f0;
  --color-role-primary:   #60a5fa;
  --color-role-secondary: #94a3b8;
  --group-color-orientation: #3b82f6;
  --group-color-cost:        #a855f7;
  --group-color-actionable:  #ef4444;
  --group-color-context:     #06b6d4;
  --group-color-deepdive:    #64748b;
}

/* Reduced motion — bắt buộc */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

/* Tabular numbers cho mọi metric */
.tabular { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

body {
  font-family: var(--font-ui);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.6;
}

/* Focus visible */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

### 1.3 — shadcn/ui components cần install

```bash
# Install theo thứ tự dùng
npx shadcn@latest add button badge card table tabs dialog
npx shadcn@latest add select input skeleton toast separator
npx shadcn@latest add dropdown-menu popover tooltip scroll-area
```

**Customize shadcn tokens** để map vào CSS variables đã định nghĩa — edit `components.json`.

### 1.4 — API Client + TanStack Query setup

**`apps/web-v2/src/lib/api-client.ts`:**
```ts
export class ApiError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload, `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const apiGet  = <T>(url: string, params?: Record<string, unknown>) => {
  const qs = params ? "?" + new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString() : "";
  return apiFetch<T>(url + qs);
};

export const apiPost = <T>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
```

**`apps/web-v2/src/lib/query-keys.ts`:**
```ts
export const qk = {
  topics:   () => ["topics"] as const,
  findings: (p: FindingsParams) => ["findings", p] as const,
  timeline: (p: TimelineParams) => ["findings-timeline", p] as const,
  findingById: (id: string) => ["finding", id] as const,
  diagnostics: (id: string) => ["diagnostics", id] as const,
  insights: (p: InsightsParams) => ["insights", p] as const,
  analyses: (p: AnalysesParams) => ["analyses", p] as const,
  jobs:     () => ["jobs-health"] as const,
};
```

**`apps/web-v2/src/main.tsx`:**
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </QueryClientProvider>
);
```

### 1.5 — Zustand store cho global UI state

```ts
// apps/web-v2/src/store/dashboard.store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DashboardState {
  activeTopicId: string;
  setActiveTopicId: (id: string) => void;

  timeRange: TimeRangeState;
  setTimeRange: (range: TimeRangeState) => void;

  page: number;
  setPage: (p: number) => void;

  autoRefresh: AutoRefreshConfig;
  setAutoRefresh: (cfg: AutoRefreshConfig) => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      activeTopicId: "",
      setActiveTopicId: (id) => set({ activeTopicId: id, page: 0 }),
      timeRange: { mode: "preset", presetId: "last_1_hour" },
      setTimeRange: (timeRange) => set({ timeRange, page: 0 }),
      page: 0,
      setPage: (page) => set({ page }),
      autoRefresh: { enabled: false, intervalMs: 60_000 },
      setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
    }),
    { name: "dashboard-v3" }   // localStorage key
  )
);
```

**Deliverable Phase 1:** App shell chạy được ở `localhost:5173`, CSS tokens khớp design system, API client + Query setup xong, shadcn/ui components sẵn sàng.

---

## Phase 2 — Core Components
> **Thời gian: 1 tuần**

Cấu trúc thư mục target:

```
apps/web-v2/src/
├── components/
│   ├── layout/
│   │   ├── Topbar.tsx            ← Navigation + live indicator + theme toggle
│   │   └── PageShell.tsx         ← max-width wrapper + padding
│   ├── dashboard/
│   │   ├── TopicTabs.tsx         ← Tab list với count badge + alert dot
│   │   ├── FilterBar.tsx         ← 1-row compact filter
│   │   ├── KpiCards.tsx          ← 4 stat cards (Critical/Warning/Info/Total)
│   │   ├── TimelineChart.tsx     ← SVG stacked bar (port từ dashboard.ts)
│   │   ├── FindingsTable.tsx     ← shadcn Table + skeleton + empty state
│   │   ├── FindingRow/
│   │   │   ├── SlowSessionRow.tsx
│   │   │   ├── BlockingRow.tsx
│   │   │   ├── DeadlockRow.tsx
│   │   │   ├── AgHealthRow.tsx
│   │   │   ├── AgRedoRow.tsx
│   │   │   ├── CdcHealthRow.tsx
│   │   │   └── DefaultRow.tsx
│   │   └── modals/
│   │       ├── FindingDetailModal.tsx
│   │       ├── DiagnosticsPanel.tsx
│   │       ├── KillSessionConfirm.tsx
│   │       ├── BlockingChainModal.tsx
│   │       ├── AgHealthModal.tsx
│   │       └── DeadlockModal.tsx
│   ├── plan/
│   │   ├── PlanAnalysisPanel.tsx ← port PlanAnalysisComponent
│   │   └── PlanInputPanel.tsx
│   ├── insights/
│   │   └── InsightCard.tsx
│   ├── shared/
│   │   ├── SeverityBadge.tsx
│   │   ├── AlertStatusBadge.tsx
│   │   ├── RoleNodeCell.tsx      ← CSS class thay inline style
│   │   ├── EmptyState.tsx
│   │   ├── ErrorState.tsx
│   │   ├── LiveIndicator.tsx
│   │   ├── GlossaryTooltip.tsx
│   │   └── JsonTree.tsx
│   └── ui/                       ← shadcn/ui generated components
├── hooks/
│   ├── useFindings.ts            ← TanStack Query wrapper
│   ├── useTopics.ts
│   ├── useTimeline.ts
│   ├── useInsights.ts
│   ├── useAnalyses.ts
│   ├── useAutoRefresh.ts         ← refetchInterval từ store
│   └── useTimeRange.ts           ← resolve TimeRangeState → {from, to}
├── pages/
│   ├── DashboardPage.tsx
│   ├── InsightsPage.tsx
│   └── QueryPlanPage.tsx
├── store/
│   └── dashboard.store.ts
├── lib/
│   ├── api-client.ts
│   ├── query-keys.ts
│   ├── time-range.ts             ← port từ dashboard.ts (pure functions)
│   └── format.ts                 ← formatDate, formatMs, truncate...
├── styles/
│   └── globals.css
└── main.tsx
```

### 2.1 — Topbar component

```tsx
// components/layout/Topbar.tsx
import { Database } from "lucide-react";
import { LiveIndicator } from "@/components/shared/LiveIndicator";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/insights",  label: "Insights"  },
  { href: "/query-plan",label: "Query Plan" },
];

export function Topbar() {
  const pathname = window.location.pathname;
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-[var(--color-border)]
                       bg-[var(--color-surface)]/90 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-4 max-w-screen-2xl mx-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 font-semibold text-sm shrink-0">
          <Database className="w-4 h-4 text-[var(--color-primary)]" />
          <span className="text-[var(--color-text)]">MSSQL Monitor</span>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <a key={href} href={href}
               className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                 ${pathname === href
                   ? "text-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                   : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-row-hover)]"
                 }`}>
              {label}
            </a>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <LiveIndicator />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
```

### 2.2 — SeverityBadge (thay badge cũ, type-safe)

```tsx
// components/shared/SeverityBadge.tsx
type Severity = "CRITICAL" | "WARNING" | "INFO";

const config: Record<Severity, { label: string; className: string }> = {
  CRITICAL: {
    label: "Critical",
    className: "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)]"
  },
  WARNING: {
    label: "Warning",
    className: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)]"
  },
  INFO: {
    label: "Info",
    className: "bg-[var(--color-info-soft)] text-[var(--color-info)] border border-[color-mix(in_srgb,var(--color-info)_30%,transparent)]"
  }
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, className } = config[severity] ?? config.INFO;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                      text-[11px] font-semibold tracking-wide ${className}`}>
      {label}
    </span>
  );
}
```

### 2.3 — Findings hook (thay apiGet + isLoadingFindings)

```ts
// hooks/useFindings.ts
import { useQuery } from "@tanstack/react-query";
import { useDashboardStore } from "@/store/dashboard.store";
import { useTimeRange } from "@/hooks/useTimeRange";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { FindingsResponse } from "@layer3/core";

export function useFindings(filters: FindingFilters) {
  const { page, activeTopicId, autoRefresh } = useDashboardStore();
  const { from, to } = useTimeRange();

  return useQuery({
    queryKey: qk.findings({ ...filters, topic_id: activeTopicId, page, from, to }),
    queryFn: () => apiGet<FindingsResponse>("/api/findings", {
      topic_id: activeTopicId,
      severity: filters.severity,
      alert_status: filters.alertStatus,
      blocking_status: filters.blockingStatus,
      since: from.toISOString(),
      until: to.toISOString(),
      limit: 15,
      page
    }),
    refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
    placeholderData: (prev) => prev   // giữ data cũ khi refetch (không flash)
  });
}
```

### 2.4 — FindingsTable với skeleton + empty state

```tsx
// components/dashboard/FindingsTable.tsx
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useFindings } from "@/hooks/useFindings";
import { useDashboardStore } from "@/store/dashboard.store";
import { getTopicRowRenderer } from "@/components/dashboard/FindingRow";

export function FindingsTable({ filters }: { filters: FindingFilters }) {
  const { data, isLoading, error } = useFindings(filters);
  const { activeTopicId } = useDashboardStore();
  const RowRenderer = getTopicRowRenderer(activeTopicId);

  if (error) return <ErrorState message="Failed to load findings" onRetry={...} />;

  return (
    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <RowRenderer.Header />
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : data?.items.length === 0
              ? <tr><td colSpan={8}><EmptyState
                    title="No findings"
                    description="No findings match your current filters and time range."
                    action={{ label: "Clear filters", onClick: clearFilters }}
                  /></td></tr>
              : data?.items.map((finding) => (
                  <RowRenderer.Row key={finding.finding_id} finding={finding} />
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### 2.5 — TimelineChart (port SVG logic thành component)

```tsx
// components/dashboard/TimelineChart.tsx
// Port toàn bộ logic SVG từ dashboard.ts:325-565
// Ưu điểm: tái dùng được, props type-safe, không dùng window.document

interface TimelineChartProps {
  data: TimelineResponse | null;
  isLoading: boolean;
}

export function TimelineChart({ data, isLoading }: TimelineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 960 });

  // ResizeObserver — tự resize chart
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setDimensions({ width: e.contentRect.width });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Cache CSS vars — tránh getComputedStyle mỗi render (fix M3)
  const colors = useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      grid:     s.getPropertyValue("--color-border").trim(),
      axis:     s.getPropertyValue("--color-muted").trim(),
      critical: s.getPropertyValue("--color-critical").trim(),
      warning:  s.getPropertyValue("--color-warning").trim(),
      info:     s.getPropertyValue("--color-info").trim(),
    };
  }, [/* re-compute khi theme change */]);

  if (isLoading) return <Skeleton className="h-[160px] w-full rounded-lg" />;

  return (
    <div className="relative" ref={wrapRef}>
      <svg ref={svgRef} role="img" aria-label="Findings activity timeline"
           className="w-full" style={{ height: 160 }} />
      <div ref={tooltipRef}
           className="absolute hidden pointer-events-none rounded-lg px-3 py-2.5 text-xs
                      border border-[var(--color-border-2)] shadow-xl"
           style={{ background: "rgba(15,23,42,0.88)", backdropFilter: "blur(8px)" }} />
    </div>
  );
}
```

### 2.6 — RoleNodeCell (fix H6 — xóa inline style)

```tsx
// components/shared/RoleNodeCell.tsx
// Thay roleStyle = "color:#0b3d91;font-weight:700;" bằng CSS class

export function RoleNodeCell({ role, node }: { role: string; node: string }) {
  const roleLower = role.toLowerCase();
  return (
    <span>
      <span className={
        roleLower === "primary"   ? "text-[var(--color-role-primary)] font-bold" :
        roleLower === "secondary" ? "text-[var(--color-role-secondary)] font-semibold" :
        "text-[var(--color-muted)]"
      }>
        {role}
      </span>
      {" | "}
      <span className="text-[var(--color-text-2)]">{node}</span>
    </span>
  );
}
```

**Deliverable Phase 2:** Tất cả components core exist và render đúng. Dashboard page functional với data thật.

---

## Phase 3 — Page Migration
> **Thời gian: 1 tuần**

### 3.1 — Dashboard Page

```tsx
// pages/DashboardPage.tsx — orchestration ~100 lines
export function DashboardPage() {
  const [filters, setFilters] = useState<FindingFilters>({});
  const { activeTopicId } = useDashboardStore();
  const { data: topics } = useTopics();
  const { data: timeline, isLoading: timelineLoading } = useTimeline(filters);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-3 space-y-3">
      {/* Topic tabs */}
      <TopicTabs topics={topics ?? []} />

      {/* Filter bar — 1 row compact */}
      <FilterBar value={filters} onChange={setFilters} showBlockingFilter={activeTopicId === "slow_sessions"} />

      {/* KPI cards */}
      <KpiCards topicId={activeTopicId} filters={filters} />

      {/* Timeline chart */}
      <TimelineChart data={timeline ?? null} isLoading={timelineLoading} />

      {/* Findings table */}
      <FindingsTable filters={filters} />
    </div>
  );
}
```

**Layout Dashboard** theo `ui-ux-design-system.md §6.1`:
- Filter bar 1 row (Severity + Alert Status + Time Range + Live indicator)
- KPI cards 4-col grid, responsive 2-col → 1-col
- Timeline chart full width, height 160px

### 3.2 — Query Plan Page — Split Panel

```tsx
// pages/QueryPlanPage.tsx
export function QueryPlanPage() {
  const [xml, setXml] = useState("");
  const [result, setResult] = useState<PlanAnalysisResult | null>(null);
  const mutation = useMutation({ mutationFn: (xml: string) =>
    apiPost<PlanAnalysisResult>("/api/plan/analyze", { plan_xml: xml }) });

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-3">
      {/* Split panel — 40/60 trên desktop, stacked trên mobile */}
      <div className="flex flex-col lg:flex-row gap-3 h-[calc(100vh-80px)]">
        {/* Input panel */}
        <div className="lg:w-2/5 flex flex-col gap-3">
          <PlanInputPanel
            value={xml}
            onChange={setXml}
            onAnalyze={() => mutation.mutate(xml)}
            isLoading={mutation.isPending}
          />
        </div>

        {/* Result panel */}
        <div className="lg:w-3/5 overflow-y-auto">
          {mutation.isPending && <PlanAnalysisSkeleton />}
          {mutation.error && <ErrorState message="Analysis failed" />}
          {result && <PlanAnalysisPanel result={result} />}
          {!result && !mutation.isPending && <PlanEmptyState />}
        </div>
      </div>
    </div>
  );
}
```

### 3.3 — Insights Page — Card Grid

```tsx
// pages/InsightsPage.tsx
export function InsightsPage() {
  const [filters, setFilters] = useState<InsightFilters>({});
  const { data: insights, isLoading } = useInsights(filters);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-3 space-y-3">
      <InsightFilterBar value={filters} onChange={setFilters} />

      {isLoading
        ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {insights?.map((insight) => (
              <InsightCard key={insight._id} insight={insight} />
            ))}
          </div>
      }
    </div>
  );
}
```

### 3.4 — Toast system (thay một số openModal calls)

```tsx
// Với shadcn/ui Sonner hoặc built-in Toast
// Dùng cho: KILL session success/fail, plan analyze error

// Kill session success → toast thay vì modal
toast.success(`Session #${sessionId} killed successfully`);

// Kill session fail → toast với detail
toast.error("Kill session failed", {
  description: errorMessage,
  action: { label: "Retry", onClick: () => retryKill() }
});

// Giữ modal cho: finding detail, diagnostics panel, kill confirm (destructive action)
```

**Deliverable Phase 3:** 3 pages chạy đầy đủ ở `localhost:5173`. Feature parity với web cũ.

---

## Phase 4 — Types & Strict Mode
> **Thời gian: 3–4 ngày**

### 4.1 — Mở rộng `packages/core/src/types/`

```ts
// packages/core/src/types/finding.ts — thêm API response types
export interface FindingsResponse {
  total: number;
  items: FindingWithAnalysis[];
}

export interface FindingWithAnalysis extends Finding {
  ai_analyzed: boolean;
  ai_analysis: AiAnalysis | null;
}

// packages/core/src/types/api.ts — query param types
export interface FindingsQuery {
  finding_id?: string;
  topic_id?: string;
  severity?: "CRITICAL" | "WARNING" | "INFO" | "";
  alert_status?: "sent" | "suppressed" | "pending" | "";
  blocking_status?: "blocked" | "not_blocked" | "";
  since?: string;
  until?: string;
  limit?: number;
  page?: number;
}
```

### 4.2 — Bật TypeScript strict mode

```json
// apps/web-v2/tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### 4.3 — ESLint + Prettier

```bash
pnpm add -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm add -D eslint-plugin-react-hooks eslint-plugin-jsx-a11y
pnpm add -D prettier eslint-config-prettier
```

```js
// apps/web-v2/.eslintrc.js
module.exports = {
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "prefer-const": "error",
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/aria-props": "error"
  }
};
```

**Deliverable Phase 4:** Zero `any` trong web-v2. ESLint pass. TypeScript strict pass.

---

## Phase 5 — Cutover
> **Thời gian: 1 ngày | Zero downtime**

### 5.1 — Build production

```bash
cd apps/web-v2
pnpm build   # output → layer3/dist-v2/
```

### 5.2 — Nginx swap

```nginx
# Trước (Dockerfile.combined hoặc nginx.conf)
root /app/dist;

# Sau — đổi 1 dòng
root /app/dist-v2;
```

### 5.3 — Smoke test checklist

- [ ] Dashboard load, topic tabs switch
- [ ] Findings table: filter, pagination, loading skeleton
- [ ] Finding detail modal: tabs (Detail / Diagnostics)
- [ ] KILL session: confirm modal → toast result
- [ ] Timeline chart: render, hover tooltip, resize
- [ ] Query Plan: paste XML → analyze → result panel
- [ ] Insights: card grid load
- [ ] Dark mode toggle
- [ ] Auto-refresh: bật/tắt, indicator hiển thị
- [ ] Mobile: table scroll, filter bar, chart height

### 5.4 — Cleanup

```bash
# Sau 1 tuần stable
rm -rf apps/web           # Xóa Vanilla TS cũ
rm -rf apps/web/css       # Xóa CSS cũ (giờ trong web-v2/src/styles)
```

---

## Tổng timeline

```
Tuần 1:   Phase 0 — Backend hardening (làm ngay, deploy lên prod)
           ├─ Day 1: Rate limit + try/catch routes
           ├─ Day 2: Fastify schema validation
           └─ Day 3: N+1 fix + request ID

Tuần 2:   Phase 1 — Frontend foundation
           ├─ Day 1-2: Scaffold Vite + Tailwind + shadcn/ui
           ├─ Day 3:   CSS design tokens + globals.css
           └─ Day 4-5: API client + TanStack Query + Zustand store

Tuần 3:   Phase 2 — Core components
           ├─ Day 1:   Topbar, SeverityBadge, RoleNodeCell, EmptyState
           ├─ Day 2:   TopicTabs, FilterBar, KpiCards
           ├─ Day 3:   FindingsTable (skeleton + empty state)
           ├─ Day 4:   TimelineChart (port SVG)
           └─ Day 5:   FindingRow renderers (6 topics)

Tuần 4:   Phase 2 cont — Modals + Plan component
           ├─ Day 1-2: FindingDetailModal + DiagnosticsPanel
           ├─ Day 3:   KillSessionConfirm + Toast system
           └─ Day 4-5: PlanAnalysisPanel (port từ plan-analysis-component.ts)

Tuần 5:   Phase 3 — Pages
           ├─ Day 1:   DashboardPage (orchestration)
           ├─ Day 2:   QueryPlanPage (split panel)
           ├─ Day 3:   InsightsPage (card grid)
           └─ Day 4-5: QA, bug fixes

Tuần 6:   Phase 4 + Phase 5
           ├─ Day 1-2: Types + strict mode + ESLint
           ├─ Day 3:   Final smoke test
           └─ Day 4:   Cutover (nginx swap) + monitor
```

---

## Rủi ro và mitigation

| Rủi ro | Khả năng | Mitigation |
|---|---|---|
| PlanAnalysisComponent port phức tạp (754 lines) | Cao | Port từng method 1, giữ test với real XML |
| API response shape mismatch frontend mới | Trung bình | Define types trong `@layer3/core` trước khi code UI |
| Recharts không flexible bằng SVG tự viết | Trung bình | Giữ SVG chart, chỉ wrap thành React component |
| shadcn/ui token conflict với CSS vars | Thấp | Map shadcn tokens → CSS vars trong `globals.css` |
| Backend Phase 0 break existing behavior | Thấp | `additionalProperties: false` có thể block query params hợp lệ → test kỹ trước deploy |

---

## Không thay đổi (out of scope)

- `apps/api/` Express/Fastify backend — chỉ hardening, không rewrite
- `packages/core/src/types/plan-analysis.ts` — giữ nguyên, web-v2 import
- MongoDB schema — không đổi
- Docker setup — chỉ update `dist` → `dist-v2` path
- Layer 1, Layer 2 — không liên quan

---

*Kết hợp từ: `review-and-upgrade-plan.md` (security + code quality), `ui-ux-design-system.md` (Midnight Slate design system), framework analysis (React 19 + Vite 6 + Tailwind v4 + shadcn/ui + TanStack Query).*
