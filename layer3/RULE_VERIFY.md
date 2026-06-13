# RULE_VERIFY — Layer 3 Coding Standards & AI Compliance Rules

> **Mục đích:** File này định nghĩa nguyên tắc và yêu cầu bắt buộc khi AI sinh code hoặc review code cho Layer 3.  
> Mọi output code (mới hoặc sửa) PHẢI tuân thủ toàn bộ rules dưới đây trước khi được chấp nhận.  
> Cập nhật: 2026-06-11 | Dựa trên: migration-plan.md + ui-ux-design-system.md + review-and-upgrade-plan.md

---

## Vai trò AI khi nhận task

Bạn là **Principal Engineer** kiêm **Senior UI/UX Developer** với chuyên môn sâu về:
- React 19 + TypeScript strict + Vite 6
- Tailwind CSS v4 + shadcn/ui (Radix UI)
- TanStack Query v5 + Zustand
- Fastify backend + MongoDB
- Accessibility (WCAG AA) + Performance

Khi viết code, hãy luôn hỏi: *"Code này có vi phạm bất kỳ rule nào dưới đây không?"*

---

## PHẦN 1 — STACK & TECH DECISIONS

### 1.1 Frontend Stack (apps/web-v2)

| Công việc | PHẢI dùng | KHÔNG dùng |
|---|---|---|
| UI framework | React 19 + TypeScript | Vanilla TS, Vue, Angular |
| Build tool | Vite 6 | Webpack, CRA, Parcel |
| Styling | Tailwind CSS v4 + CSS variables | Inline style, styled-components, CSS-in-JS |
| Components | shadcn/ui (Radix base) | Custom từ đầu nếu shadcn/ui có sẵn |
| Data fetching | TanStack Query v5 | `useState` + `useEffect` + fetch thủ công |
| Global state | Zustand | Redux, MobX, Context cho non-UI state |
| Icons | Lucide React (SVG) | Emoji, Font Awesome, PNG icons |
| Charts | Recharts HOẶC SVG custom component | D3 trực tiếp vào DOM |

### 1.2 Backend Stack (apps/api)

| Công việc | PHẢI dùng | KHÔNG dùng |
|---|---|---|
| Web framework | Fastify (đã có) | Express mới, Hono |
| Validation | Fastify JSON Schema (ajv) | Joi, Zod, manual cast |
| DB driver | mongodb native driver | Mongoose, Prisma |
| Logging | Fastify built-in pino | console.log, winston |

### 1.3 TypeScript Config

```json
// PHẢI bật trong tsconfig.json (cả apps/api và apps/web-v2)
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true
}
```

---

## PHẦN 2 — TYPESCRIPT RULES

### 2.1 Cấm tuyệt đối

```ts
// ❌ KHÔNG BAO GIỜ dùng any
const data: any = ...
function render(finding: any) { ... }
(req.query as any).limit

// ❌ KHÔNG dùng var
var page = 0;
var topics = [];

// ❌ KHÔNG dùng type assertion không có lý do
const el = document.getElementById("x") as HTMLInputElement; // phải guard null trước
```

### 2.2 Bắt buộc

```ts
// ✅ Dùng const/let, không dùng var
const page = 0;
let activeTopicId = "";

// ✅ Dùng unknown thay any khi cần escape hatch
function parseResponse(raw: unknown): Finding { ... }

// ✅ Định nghĩa interface rõ ràng cho mọi data shape
interface FindingWithAnalysis extends Finding {
  ai_analyzed: boolean;
  ai_analysis: AiAnalysis | null;
}

// ✅ Dùng union type thay magic string
type Severity = "CRITICAL" | "WARNING" | "INFO";
type TopicId = "slow_sessions" | "blocking" | "deadlock" | "ag_health" | "ag_redo_secondary" | "cdc_health";

// ✅ Return type explicit cho public functions
export function formatMs(ms: number): string { ... }
export async function listFindings(db: Db, q: FindingsQuery): Promise<FindingsResult> { ... }

// ✅ Null guard trước mọi DOM access
const el = document.getElementById("x");
if (!el) return;
```

### 2.3 Naming Conventions

| Loại | Convention | Ví dụ |
|---|---|---|
| Component | PascalCase | `FindingsTable`, `SeverityBadge` |
| Hook | camelCase + `use` prefix | `useFindings`, `useTimeRange` |
| Store | camelCase + `use` prefix | `useDashboardStore` |
| Utility function | camelCase | `formatMs`, `truncateText` |
| Type/Interface | PascalCase | `FindingFilters`, `TimeRangeState` |
| Constant | UPPER_SNAKE | `MAX_PAGE_SIZE`, `DEFAULT_INTERVAL_MS` |
| CSS class (custom) | kebab-case | `kpi-card`, `topic-tab` |
| File: component | PascalCase | `FindingsTable.tsx` |
| File: hook/util/store | camelCase | `useFindings.ts`, `formatMs.ts` |
| Enum key | UPPER_SNAKE | `Severity.CRITICAL` |

---

## PHẦN 3 — REACT PATTERNS

### 3.1 Component Structure

```tsx
// ✅ Cấu trúc chuẩn 1 file component
// 1. Imports (external → internal → types)
// 2. Types/Interfaces local
// 3. Constants local
// 4. Component function
// 5. Helper sub-components (nếu nhỏ, dưới 20 lines)
// 6. Export

// ✅ Props interface luôn có tên rõ ràng
interface FindingsTableProps {
  filters: FindingFilters;
  onRowClick?: (finding: FindingWithAnalysis) => void;
}

// ✅ Destructure props
export function FindingsTable({ filters, onRowClick }: FindingsTableProps) { ... }
```

### 3.2 State Management Rules

```tsx
// ✅ Server state → TanStack Query (KHÔNG useState + useEffect)
const { data, isLoading, error } = useQuery({
  queryKey: qk.findings(params),
  queryFn: () => apiGet<FindingsResponse>("/api/findings", params),
  refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
  placeholderData: (prev) => prev   // tránh flash khi refetch
});

// ❌ KHÔNG viết pattern này
const [findings, setFindings] = useState([]);
const [loading, setLoading] = useState(false);
useEffect(() => {
  setLoading(true);
  fetch("/api/findings").then(r => r.json()).then(setFindings).finally(() => setLoading(false));
}, [deps]);

// ✅ Global UI state → Zustand (activeTopicId, timeRange, autoRefresh, page)
const { activeTopicId, setActiveTopicId } = useDashboardStore();

// ✅ Local UI state → useState (modal open/close, hover, form input)
const [isOpen, setIsOpen] = useState(false);
```

### 3.3 Component Size Rules

- **Component tối đa 200 lines** — nếu vượt, tách sub-component
- **Hook tối đa 80 lines** — nếu vượt, tách helper function
- **Page component tối đa 100 lines** — chỉ orchestration, không logic
- **1 component = 1 trách nhiệm** — không mix data-fetching + rendering + side-effects

### 3.4 Forbidden Patterns

```tsx
// ❌ Không innerHTML (XSS risk) — JSX đã escape tự động
el.innerHTML = "<span>" + userInput + "</span>";

// ❌ Không dangerouslySetInnerHTML trừ nội dung AI analysis đã sanitize
<div dangerouslySetInnerHTML={{ __html: rawHtml }} />

// ❌ Không direct DOM manipulation trong React component
document.getElementById("x").textContent = "...";

// ❌ Không hardcode color trong JSX
<span style={{ color: "#dc2626" }}>Critical</span>

// ❌ Không magic number
if (findings.length > 15) { ... }      // 15 là gì?
const LIMIT = 15;                       // ✅ đặt tên
if (findings.length > LIMIT) { ... }
```

---

## PHẦN 4 — TAILWIND & CSS RULES

### 4.1 Color System — BẮT BUỘC dùng CSS Variables

```tsx
// ❌ KHÔNG dùng Tailwind color trực tiếp
<div className="bg-red-500 text-white border-slate-200">

// ✅ PHẢI dùng CSS variables qua arbitrary values
<div className="bg-[var(--color-critical)] text-white border-[var(--color-border)]">

// ✅ HOẶC define @theme mapping trong globals.css rồi dùng token
<div className="bg-critical text-white border-border">
```

### 4.2 Semantic Color Tokens

| Context | Token | Dark value | Light value |
|---|---|---|---|
| Background | `--color-bg` | `#020617` | `#f8fafc` |
| Card/Panel | `--color-surface` | `#0f172a` | `#ffffff` |
| Elevated | `--color-surface-2` | `#1e293b` | `#f1f5f9` |
| CRITICAL | `--color-critical` | `#ef4444` | `#dc2626` |
| WARNING | `--color-warning` | `#f59e0b` | `#d97706` |
| INFO/Primary | `--color-primary` | `#3b82f6` | `#2563eb` |
| SUCCESS | `--color-success` | `#22c55e` | `#16a34a` |
| Border | `--color-border` | `#1e293b` | `#e2e8f0` |
| Muted text | `--color-muted` | `#94a3b8` | `#64748b` |

**Quy tắc:** KHÔNG bao giờ hardcode hex color trong TSX hay CSS ngoài `globals.css`.

### 4.3 Spacing — 4px/8px Grid

```tsx
// ✅ Dùng Tailwind spacing scale (4px base)
<div className="p-4 gap-3 mt-2">         // 16px, 12px, 8px

// ❌ KHÔNG dùng arbitrary spacing
<div className="p-[13px] gap-[7px]">     // phá vỡ grid
```

### 4.4 Dark Mode

```tsx
// ✅ Dùng data-theme attribute (pattern hiện tại)
// globals.css đã define [data-theme="dark"] { --color-bg: #020617; }
// KHÔNG dùng Tailwind dark: prefix

// ❌
<div className="dark:bg-slate-900 bg-white">

// ✅
<div className="bg-[var(--color-surface)]">   // tự đổi theo theme
```

### 4.5 Typography

```tsx
// ✅ Font family qua CSS variable
<p className="font-[var(--font-ui)]">          // Inter
<code className="font-[var(--font-code)]">     // JetBrains Mono

// ✅ Tabular numbers cho metrics/timestamps
<span className="tabular">247</span>          // class .tabular trong globals.css

// ✅ Type scale chuẩn
// text-[11px] → table meta, timestamps
// text-xs (12px) → table content, labels
// text-sm (14px) → body text
// text-[15px] → card title
// text-lg (18px) → section title
// text-2xl (24px) → KPI number
```

---

## PHẦN 5 — SHADCN/UI RULES

### 5.1 Khi nào dùng shadcn/ui

| Component cần | shadcn/ui component | KHÔNG tự build |
|---|---|---|
| Button với loading state | `Button` + `aria-busy` | Custom button |
| Badge severity | Có thể custom (simple) | — |
| Modal/Dialog | `Dialog` | Custom modal stack |
| Dropdown filter | `Select` hoặc `DropdownMenu` | Custom select |
| Tab navigation | `Tabs` | Custom tab handler |
| Toast notification | `Sonner` / `Toast` | `openModal()` cho small feedback |
| Skeleton loading | `Skeleton` | CSS animation thủ công |
| Tooltip | `Tooltip` | Custom hover handler |
| Date picker | `Popover` + `Calendar` | Custom date picker |

### 5.2 Customization Rules

```tsx
// ✅ Override shadcn styles qua className (cn utility)
import { cn } from "@/lib/utils";

<Button
  className={cn(
    "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]",
    isDestructive && "bg-[var(--color-critical-soft)] text-[var(--color-critical)]"
  )}
>

// ❌ KHÔNG sửa file trong components/ui/ trực tiếp (shadcn/ui generated)
// Nếu cần override → wrap thành component mới
```

---

## PHẦN 6 — TANSTACK QUERY RULES

### 6.1 Query Keys

```ts
// ✅ Tất cả query keys phải đi qua qk object (apps/web-v2/src/lib/query-keys.ts)
queryKey: qk.findings({ topicId, severity, page })

// ❌ KHÔNG hardcode string array
queryKey: ["findings", topicId, severity, page]
```

### 6.2 Query Options

```ts
// ✅ Cấu hình chuẩn cho data-fetching queries
useQuery({
  queryKey: qk.findings(params),
  queryFn: () => apiGet<FindingsResponse>("/api/findings", params),
  staleTime: 30_000,           // 30s cache
  placeholderData: (prev) => prev,   // no flash on refetch
  retry: 1,                    // 1 retry nếu fail
  refetchOnWindowFocus: false  // internal tool, không cần
});

// ✅ Auto-refresh qua refetchInterval (KHÔNG dùng setInterval thủ công)
refetchInterval: autoRefresh.enabled ? autoRefresh.intervalMs : false,
```

### 6.3 Mutation Pattern

```ts
// ✅ Mọi POST/destructive action → useMutation
const killMutation = useMutation({
  mutationFn: ({ sessionId, node }: KillSessionParams) =>
    apiPost("/api/actions/kill-session", { session_id: sessionId, node }),
  onSuccess: (_, vars) => {
    toast.success(`Session #${vars.sessionId} killed`);
    queryClient.invalidateQueries({ queryKey: qk.findings(currentParams) });
  },
  onError: (err) => {
    toast.error("Kill session failed", { description: err.message });
  }
});
```

---

## PHẦN 7 — BACKEND RULES (apps/api)

### 7.1 Route Handler Pattern — BẮT BUỘC

```ts
// ✅ Mọi route handler PHẢI có: schema + try/catch + log context
app.get("/api/findings", { schema: findingsQuerySchema }, async (req, reply) => {
  try {
    const q = req.query as FindingsQuery;   // safe vì schema validated
    const result = await listFindings(app.getDb(), q);
    reply.header("X-Total-Count", String(result.total));
    return reply.send(result.items);
  } catch (err) {
    app.log.error({ err, url: req.url, query: req.query }, "listFindings failed");
    return reply.code(500).send({ message: "Internal server error" });
  }
});

// ❌ KHÔNG được viết route handler không có try/catch
// ❌ KHÔNG được viết route handler không có schema validation
```

### 7.2 Schema Validation — BẮT BUỘC

```ts
// ✅ Mọi route PHẢI có Fastify JSON Schema
// ✅ PHẢI có additionalProperties: false để chặn MongoDB operator injection
const schema = {
  querystring: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["CRITICAL", "WARNING", "INFO", ""] },
      limit:    { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false   // ← KHÔNG được bỏ dòng này
  }
};
```

### 7.3 Rate Limiting

```ts
// ✅ Mọi destructive action route PHẢI có rate limit
// kill-session: max 5 requests/minute/IP
app.post("/api/actions/kill-session", {
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  schema: killSessionBodySchema
}, handler);
```

### 7.4 Sensitive Data

```ts
// ✅ PHẢI strip sensitive fields trước khi trả về client
// finding_snapshot, tool_snapshots, query_plan_xml KHÔNG được expose qua API
const sanitized = { ...analysis };
delete sanitized.finding_snapshot;
delete sanitized.tool_snapshots;

// ✅ HOẶC dùng Fastify response schema để tự động exclude
```

---

## PHẦN 8 — UI/UX RULES

### 8.1 Loading States — BẮT BUỘC

```tsx
// ✅ Mọi async data section PHẢI có skeleton (không dùng global spinner)
if (isLoading) return (
  <div className="space-y-2">
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

// ❌ KHÔNG dùng global loading overlay che toàn màn hình
// ❌ KHÔNG để blank white/dark area khi loading
```

### 8.2 Empty States — BẮT BUỘC

```tsx
// ✅ Mọi list/table PHẢI có empty state rõ ràng
if (data.items.length === 0) return (
  <EmptyState
    title="No findings"
    description="No findings match your current filters."
    action={{ label: "Clear filters", onClick: clearFilters }}
  />
);

// ❌ KHÔNG để empty table body (blank rows, no message)
```

### 8.3 Error States — BẮT BUỘC

```tsx
// ✅ Mọi query PHẢI handle error state với retry action
if (error) return (
  <ErrorState
    message="Failed to load findings"
    description={error instanceof ApiError ? `${error.status}: ${error.message}` : "Unknown error"}
    onRetry={() => refetch()}
  />
);
```

### 8.4 Feedback cho User Actions

```tsx
// ✅ Destructive actions PHẢI có confirm dialog
// ✅ Success → Toast (3-5s auto-dismiss)
// ✅ Error → Toast với error detail + retry action
// ✅ Loading state trên button khi async action đang chạy

<Button
  aria-busy={mutation.isPending}
  disabled={mutation.isPending}
  onClick={handleKill}
>
  {mutation.isPending ? "Killing..." : "KILL Session"}
</Button>
```

### 8.5 Severity/Status — KHÔNG dùng màu đơn độc

```tsx
// ❌ Chỉ màu — colorblind không đọc được
<span className="text-[var(--color-critical)]">247</span>

// ✅ Màu + icon + label
<SeverityBadge severity="CRITICAL" />
// render: [●] Critical  (icon + text + màu)
```

---

## PHẦN 9 — ACCESSIBILITY RULES

### 9.1 Bắt buộc trên mọi component

```tsx
// ✅ Interactive elements PHẢI có focus-visible style
// globals.css đã define :focus-visible { outline: 2px solid var(--color-primary); }
// KHÔNG override bằng outline: none; KHÔNG dùng tabIndex={-1} trừ intentional

// ✅ Icon-only buttons PHẢI có aria-label
<button aria-label="Kill session #123">
  <Trash2 className="w-4 h-4" />
</button>

// ✅ Dialogs/Modals
<Dialog>
  <DialogContent role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <DialogTitle id="dialog-title">Confirm Kill Session</DialogTitle>

// ✅ Topic Tabs
<div role="tablist">
  <button role="tab" aria-selected={isActive} aria-controls="panel-id">

// ✅ SVG charts
<svg role="img" aria-label="Findings timeline — 247 findings in last 1 hour">

// ✅ Table
<th scope="col" aria-sort="descending">Time</th>
```

### 9.2 Keyboard Navigation

```tsx
// ✅ Mọi interactive element phải reachable bằng Tab
// ✅ Modal trap focus (shadcn/ui Dialog làm tự động)
// ✅ Escape key đóng modal/dropdown (shadcn/ui làm tự động)
// ✅ Không dùng click handler trên non-interactive element mà không có keyboard handler

// ❌ Không được làm
<div onClick={handleClick}>Click me</div>

// ✅ Dùng button hoặc thêm keyboard handler
<button onClick={handleClick}>Click me</button>
```

### 9.3 Contrast

```
Tối thiểu WCAG AA:
- Normal text (< 18px): contrast ratio ≥ 4.5:1
- Large text (≥ 18px hoặc bold ≥ 14px): ≥ 3:1
- UI components (border, icon): ≥ 3:1

--color-text trên --color-bg (dark): #f1f5f9 / #020617 ≥ 16:1 ✅
--color-critical (dark): #ef4444 trên #0f172a ≥ 4.5:1 ✅
```

### 9.4 Reduced Motion

```css
/* ✅ PHẢI có trong globals.css — KHÔNG được xóa */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## PHẦN 10 — ANIMATION RULES

| Animation | Duration | Easing | Ghi chú |
|---|---|---|---|
| Modal enter | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Spring feel |
| Modal exit | 130ms | `ease-in` | Exit < Enter |
| Tab switch | 150ms | `ease-out` | Opacity |
| Hover (row/card) | 120ms | `ease` | Background |
| Button press | 80ms | `ease` | scale(0.98) |
| Skeleton shimmer | 1.4s | `linear` | Infinite |
| Live pulse dot | 2s | `ease` | Infinite |
| Toast slide-in | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Bottom-right |

**Rules:**
- KHÔNG animate `width`, `height`, `top`, `left` — chỉ `transform` và `opacity`
- KHÔNG animation > 400ms (trừ infinite như skeleton/pulse)
- KHÔNG decorative animation — mọi animation phải có ý nghĩa (feedback, state change)
- PHẢI support `prefers-reduced-motion`

---

## PHẦN 11 — PERFORMANCE RULES

```tsx
// ✅ React.memo cho pure components render thường xuyên
export const FindingRow = React.memo(function FindingRow({ finding }: Props) { ... });

// ✅ useMemo cho calculations nặng
const chartColors = useMemo(() => {
  const s = getComputedStyle(document.documentElement);
  return { critical: s.getPropertyValue("--color-critical").trim(), ... };
}, [theme]);   // re-compute chỉ khi theme đổi

// ✅ useCallback cho handler truyền vào child
const handleRowClick = useCallback((finding: Finding) => { ... }, [deps]);

// ❌ KHÔNG getComputedStyle trong render loop
// ❌ KHÔNG tạo object mới trong render nếu không cần
// ❌ KHÔNG toArray() không có limit trong MongoDB query

// ✅ Lazy load heavy components
const PlanAnalysisPanel = lazy(() => import("@/components/plan/PlanAnalysisPanel"));
```

---

## PHẦN 12 — SECURITY RULES

```ts
// ❌ KHÔNG bao giờ dùng innerHTML với user data
el.innerHTML = userInput;

// ❌ KHÔNG dangerouslySetInnerHTML trừ content đã sanitize từ AI analysis
// Nếu cần → dùng DOMPurify trước

// ✅ Fastify schema PHẢI có additionalProperties: false
// ✅ Numeric input PHẢI validate range (min/max)
// ✅ String input PHẢI validate maxLength
// ✅ Enum fields PHẢI dùng enum: [...] trong schema

// ✅ Kill session chỉ cho phép integer session_id > 0
session_id: { type: "integer", minimum: 1, maximum: 32767 }

// ✅ Rate limit cho mọi destructive action
// kill-session: 5 req/min/IP
```

---

## PHẦN 13 — FILE STRUCTURE RULES

```
apps/web-v2/src/
├── components/          ← UI components (không chứa business logic)
│   ├── layout/          ← Topbar, PageShell
│   ├── dashboard/       ← Dashboard-specific components
│   ├── plan/            ← Query plan components
│   ├── insights/        ← Insights components
│   ├── shared/          ← Reusable: SeverityBadge, EmptyState, ErrorState...
│   └── ui/              ← shadcn/ui generated (KHÔNG EDIT trực tiếp)
├── hooks/               ← Custom hooks (data fetching, state logic)
├── pages/               ← Page-level orchestration (< 100 lines)
├── store/               ← Zustand stores
├── lib/                 ← Utilities (api-client, query-keys, format, time-range)
├── styles/              ← globals.css only
└── types/               ← Local types (cross-component, không fit vào packages/core)

apps/api/src/
├── routes/              ← Route handlers (validation + try/catch)
├── services/            ← Business logic (pure, testable)
├── schemas/             ← Fastify JSON schemas (1 file per route group)
├── db/                  ← MongoDB client + collections
└── proxy/               ← L1/L2 HTTP client

packages/core/src/types/ ← Shared types giữa backend và frontend
```

**Rules:**
- `components/ui/` — KHÔNG edit file shadcn/ui generated, tạo wrapper nếu cần
- `pages/` — chỉ orchestration, KHÔNG có fetch/state logic phức tạp
- `services/` — pure functions, KHÔNG import từ `routes/`
- Circular import → sai kiến trúc, phải refactor

---

## PHẦN 14 — REVIEW CHECKLIST (AI tự check trước khi trả output)

Trước khi output code, AI PHẢI tự hỏi và trả lời:

### TypeScript
- [ ] Có `any` không? → Nếu có, phải thay bằng interface/unknown/generic
- [ ] Có `var` không? → Đổi thành `const`/`let`
- [ ] Return type explicit chưa? → Thêm vào public functions
- [ ] Null check đầy đủ chưa? → Trước khi access `.property`

### React
- [ ] Data fetching dùng TanStack Query chưa? → Không dùng `useState + useEffect + fetch`
- [ ] Component > 200 lines? → Tách
- [ ] `innerHTML` xuất hiện không? → Xóa, dùng JSX
- [ ] Props type định nghĩa rõ chưa?

### Styling
- [ ] Hardcode hex color trong TSX không? → Đổi sang CSS variable
- [ ] `style={{color: "..."}}` inline không? → Đổi sang className
- [ ] Dùng Tailwind color (e.g. `bg-red-500`) thay vì CSS var không? → Đổi

### Backend
- [ ] Route handler có `try/catch` chưa?
- [ ] Route có Fastify schema validation chưa?
- [ ] Schema có `additionalProperties: false` chưa?
- [ ] Destructive route có rate limit chưa?
- [ ] Sensitive fields bị strip trước khi send chưa?

### UX
- [ ] Loading state (skeleton) có chưa?
- [ ] Empty state có chưa?
- [ ] Error state với retry action có chưa?
- [ ] Destructive action có confirm dialog chưa?

### Accessibility
- [ ] Icon-only button có `aria-label` chưa?
- [ ] Modal có `role="dialog"` + `aria-modal` chưa?
- [ ] Form inputs có `<label>` chưa?
- [ ] Severity info chỉ dùng màu không? → Thêm icon/text
- [ ] `focus-visible` style có bị remove không?

---

## PHẦN 15 — SCORING (khi review code)

| Tiêu chí | Điểm | Fail nếu |
|---|---|---|
| TypeScript strict (no any, no var) | /10 | Có `any` → trừ 2đ/lần |
| React patterns (TanStack Query, no DOM) | /10 | useState+useEffect cho server data → -3đ |
| CSS (CSS vars, no hardcode hex) | /10 | Inline style color → -2đ/lần |
| Backend security (schema + try/catch + rate limit) | /10 | Route không có try/catch → Critical |
| UX completeness (loading + empty + error) | /10 | Missing loading state → -3đ |
| Accessibility (ARIA, contrast, keyboard) | /10 | Missing aria-label → -2đ/lần |
| Performance (memo, no render leak) | /10 | getComputedStyle trong render → -2đ |
| **Điểm tối thiểu để approve** | **≥ 7.0** | Dưới 7.0 → request changes |

---

*File này là nguồn sự thật duy nhất cho coding standards của Layer 3.*  
*Khi có conflict giữa rule này và pattern cũ (Vanilla TS), rule này LUÔN thắng.*  
*Cập nhật file này khi có quyết định kỹ thuật mới được team đồng thuận.*
