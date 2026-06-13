# Layer 3 — Code Review & Upgrade Plan (v3)

> Reviewer: Principal Engineer / Architect lens  
> Tiêu chí: RULE_VERIFY.md — Clean Code, Scalability, Maintainability, Performance, Security, UI/UX  
> Ngày: 2026-06-11

---

## Executive Summary

| Tiêu chí             | Điểm | Nhận xét                                                        |
|----------------------|------|-----------------------------------------------------------------|
| Architecture         | 7/10 | Layered rõ ràng, nhưng frontend là monolith 2193-line god file  |
| Code Quality         | 5/10 | Heavy `any`, `var`, magic strings, Vietnamese hardcode in UI    |
| Maintainability      | 5/10 | dashboard.ts quá lớn, global mutable state, inline HTML string  |
| Performance          | 6/10 | SVG re-render full, getComputedStyle mỗi frame, không caching   |
| Security             | 6/10 | Không có Fastify schema validation, home-grown HTML escaper      |
| UI/UX                | 7/10 | Light/dark mode tốt, nhưng không có empty/error state chuẩn    |
| Production Readiness | 6/10 | Không có rate limit, không có route-level try/catch             |

**Điểm tổng thể: 6.0 / 10**

**Mức độ sẵn sàng production:** _Conditional_ — hệ thống hoạt động được, nhưng cần xử lý một số vấn đề security và maintainability trước khi scale team hoặc thêm tính năng mới.

---

## Critical Issues

### C1 — Không có Fastify route schema validation (Security + Robustness)
**File:** `apps/api/src/routes/findings.ts`, `analyses.ts`, `insights.ts`, `topics.ts`, `jobs.ts`  
**Vấn đề:** Tất cả routes cast `req.query as Record<string, string>` không qua validation. Attacker có thể gửi `limit=-999999`, `page=999999`, `severity[$ne]=CRITICAL` (MongoDB operator injection).

```ts
// Hiện tại — KHÔNG AN TOÀN
const q = req.query as Record<string, string>;
const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200); // client-side guard sót
```

**Fix:** Dùng Fastify JSON schema cho mỗi route:
```ts
const schema = {
  querystring: {
    type: "object",
    properties: {
      topic_id: { type: "string", maxLength: 64 },
      severity: { type: "string", enum: ["CRITICAL", "WARNING", "INFO", ""] },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      page: { type: "integer", minimum: 0, default: 0 },
      // ...
    },
    additionalProperties: false  // ← block MongoDB operator injection
  }
};
app.get("/api/findings", { schema }, async (req, reply) => { ... });
```

### C2 — Home-grown HTML escaper trong frontend (XSS risk)
**File:** `apps/web/dashboard/dashboard.ts:940`  
**Vấn đề:** Hàm `esc()` tự viết không cover hết các vector XSS (backtick injection vào onclick, CSS injection qua `style=`). Hàng trăm chỗ trong code build HTML string bằng tay.

```ts
// Hiện tại — fragile, dễ miss
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")...
}
// Sau đó dùng như thế này:
return "<span style='" + roleStyle + "'>" + esc(roleText) + "</span>"; // roleStyle không được esc!
```

**Fix (ngắn hạn):** Đảm bảo mọi attribute value được escape; không cho phép dynamic `style=` string. Dùng `data-` attribute + CSS class thay vì inline style.

**Fix (dài hạn):** Chuyển sang DOM API hoặc tagged template literal helper thay vì string concatenation.

### C3 — Không có rate limiting cho `/api/actions/kill-session` (Security)
**File:** `apps/api/src/routes/actions.ts`  
**Vấn đề:** Route POST kill-session không có rate limit. Có thể bị spam KILL nhiều session liên tục, gây outage production.

**Fix:** Thêm `@fastify/rate-limit` cho route này:
```ts
await app.register(rateLimit, {
  max: 5, timeWindow: "1 minute",
  keyGenerator: (req) => req.ip
});
```

---

## High Priority Issues

### H1 — `dashboard.ts` là God Module (2193 lines, 25+ responsibilities)
**File:** `apps/web/dashboard/dashboard.ts`  
**Vấn đề:** Một file xử lý: SVG chart, time picker, recent ranges, auto-refresh, topic tabs, findings table, diagnostics panel, KILL session confirm, AI analysis display, JSON tree renderer. Không thể test từng phần, không thể maintain khi thêm tính năng.

**Module cần tách:**

| Module mới | Dòng ước tính | Trách nhiệm |
|---|---|---|
| `time-picker.ts` | ~200 | State, preset, recent, popover position |
| `timeline-chart.ts` | ~200 | SVG render, ticks, tooltip, resize |
| `findings-table.ts` | ~150 | Render rows, pagination, empty/error state |
| `diagnostics-panel.ts` | ~150 | Phase groups, tool badges, detail box |
| `finding-detail.ts` | ~150 | Modal content, tabs, AI analysis section |
| `auto-refresh.ts` | ~60  | Timer, persist/restore settings |
| `dashboard.ts` (còn lại) | ~200 | Orchestration, init, event wiring |

### H2 — Global mutable state không được encapsulate
**File:** `apps/web/dashboard/dashboard.ts:14-24`  
**Vấn đề:** 9 module-level `var` biến chia sẻ state toàn cục. Không có single source of truth, race condition khi auto-refresh chạy song song với user action.

```ts
var page = 0;
var limit = 15;
var activeTopicId = "";
var topics: any[] = [];
var activeTimeRange: any = null;
var autoRefreshTimer: number | null = null;
var isLoadingFindings = false;
var autoRefreshTick = 0;
var latestTimelineData: any = null;
```

**Fix:** Encapsulate trong một `DashboardState` class hoặc object:
```ts
const state = {
  page: 0,
  limit: 15,
  activeTopicId: "",
  topics: [] as Topic[],
  activeTimeRange: null as TimeRangeState | null,
  autoRefreshTimer: null as ReturnType<typeof setTimeout> | null,
  isLoadingFindings: false,
  autoRefreshTick: 0,
  latestTimelineData: null as TimelineResponse | null,
};
```

### H3 — `any` type pervasive, thiếu type safety
**File:** `apps/web/dashboard/dashboard.ts`, `layout-registry.ts`  
**Vấn đề:**
- `var topics: any[]` — nên là `Topic[]`
- `var activeTimeRange: any` — nên là `TimeRangeState | null`
- `var latestTimelineData: any` — nên là `TimelineResponse | null`
- Hàng chục hàm nhận `finding: any`, `metrics: any`, `diag: any`
- `buildCleanDetailPayload(d: any)`, `renderCleanDetail(finding: any)` — không biết shape

**Fix:** Định nghĩa interfaces cho mọi API response và finding shape, import từ `@layer3/core`.

### H4 — `var` thay vì `const`/`let` toàn bộ dashboard.ts
**File:** `apps/web/dashboard/dashboard.ts`  
**Vấn đề:** Dùng `var` xuyên suốt file (~400+ lần). `var` có function scope và hoisting — dễ dẫn đến bug khó debug, không nhất quán với TypeScript best practices.

**Fix:** Toàn bộ đổi sang `const`/`let`. TypeScript compiler sẽ flag nếu có reassign.

### H5 — Không có try/catch ở route handlers (Production Readiness)
**File:** `apps/api/src/routes/findings.ts`, `analyses.ts`, `insights.ts`, `topics.ts`, `jobs.ts`  
**Vấn đề:** Mọi route gọi service trực tiếp không wrap try/catch. MongoDB timeout, network error → unhandled exception → Fastify trả 500 không có context log.

```ts
// Hiện tại
app.get("/api/findings", async (req, reply) => {
  const { total, items } = await listFindings(app.getDb(), q); // nếu throw → unhandled
  return reply.send(items);
});
```

**Fix:** Thêm try/catch với log context:
```ts
try {
  const { total, items } = await listFindings(app.getDb(), q);
  reply.header("X-Total-Count", String(total));
  return reply.send(items);
} catch (err) {
  app.log.error({ err, query: q }, "listFindings failed");
  return reply.code(500).send({ message: "Internal server error" });
}
```

### H6 — Inline style strings hardcoded color values (CSS Consistency)
**File:** `apps/web/dashboard/dashboard.ts:824-829`  
**Vấn đề:** `roleStyle = "color:#0b3d91;font-weight:700;"` — hardcoded hex color không dùng CSS variable, không hỗ trợ dark mode.

```ts
if (roleLower === "primary") roleStyle = "color:#0b3d91;font-weight:700;";
else if (roleLower === "secondary") roleStyle = "color:#4f8edc;font-weight:600;";
```

**Fix:** Dùng CSS class:
```css
.role-primary { color: var(--color-primary); font-weight: 700; }
.role-secondary { color: var(--color-primary-soft); font-weight: 600; }
```

---

## Medium Priority Issues

### M1 — Vietnamese strings hardcoded trong production UI code
**File:** `apps/web/dashboard/dashboard.ts:1874`, `1889`  
**Vấn đề:** Error messages bằng tiếng Việt mix trong TypeScript:
- `"Chua co topic."` 
- `"Khong tai duoc topics."`
- `"Khoang thoi gian khong hop le: from > to."`

Không nhất quán với phần code còn lại (English). Không thể i18n, khó tìm kiếm.

**Fix:** Chuẩn hóa sang English. Nếu cần đa ngôn ngữ, tạo `messages.ts` constants file.

### M2 — `magic string` localStorage keys khai báo bằng `var`
**File:** `apps/web/dashboard/dashboard.ts:22-23`  
```ts
var TIME_RANGE_STORAGE_KEY = "dashboard.timeRange.recent.v1";
var AUTO_REFRESH_STORAGE_KEY = "dashboard.timeRange.autoRefresh.v1";
```
**Fix:** Khai báo `const` và extract ra `constants.ts`.

### M3 — `getComputedStyle()` gọi mỗi lần render chart
**File:** `apps/web/dashboard/dashboard.ts:431-437`  
**Vấn đề:** `getComputedStyle(document.documentElement)` gọi bên trong `renderFindingTimeline()` — forced reflow mỗi lần data update.

**Fix:** Cache computed styles, invalidate khi theme thay đổi:
```ts
let _cachedChartColors: ChartColors | null = null;
function getChartColors(): ChartColors {
  if (_cachedChartColors) return _cachedChartColors;
  const styles = getComputedStyle(document.documentElement);
  _cachedChartColors = { gridColor: ..., criticalColor: ... };
  return _cachedChartColors;
}
document.addEventListener("themechange", () => { _cachedChartColors = null; });
```

### M4 — `analyses.ts` service fetch all analyses rồi filter ở memory
**File:** `apps/api/src/services/findings-service.ts:100-117`  
**Vấn đề:** Khi `findingIds.length > 0`, fetch ALL analyses cho list finding IDs không có pagination. Nếu mỗi finding có 100 analyses → fetch 1500 documents cho page 15 findings.

```ts
const analyses = await analysesColl
  .find({ finding_id: { $in: findingIds } }, { sort: { started_at: -1 } })
  .toArray(); // toArray() không có limit → full scan
```

**Fix:** Group by finding_id trong aggregation hoặc dùng `$limit` per ID:
```ts
// Chỉ lấy latest analysis per finding_id bằng $group + $first sau $sort
const latestAnalyses = await analysesColl.aggregate([
  { $match: { finding_id: { $in: findingIds } } },
  { $sort: { started_at: -1 } },
  { $group: { _id: "$finding_id", doc: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$doc" } },
  { $unset: "finding_snapshot" }
]).toArray();
```

### M5 — Không có response schema (type safety backend → frontend bị mất)
**File:** `apps/api/src/routes/`  
**Vấn đề:** Fastify hỗ trợ response schema để: serialize nhanh hơn (fast-json-stringify), validate output, tự động loại bỏ sensitive fields. Hiện tại không có response schema nào.

**Fix:** Định nghĩa response schema cho mỗi route, đặc biệt là `/api/findings` — ngăn `finding_snapshot`, `query_plan_xml` leak ra client ngoài ý muốn.

### M6 — `PlanFinding` import nhưng type đã deprecated
**File:** `apps/web/dashboard/plan-analysis-component.ts:7`  
**Vấn đề:** Import `PlanFinding` nhưng CLAUDE.md nói `findings: PlanFinding[]` đã bị xóa, thay bằng `finding_groups`. Có thể còn dead import.

**Fix:** Kiểm tra và xóa import không dùng, chạy TypeScript strict check.

### M7 — CLAUDE.md documentation mismatch với source CSS
**File:** `apps/web/css/base.css` vs `layer3/CLAUDE.md`  
**Vấn đề:** CLAUDE.md ghi:
- `--group-color-cost: #7c3aed` (purple)
- `--group-color-actionable: #dc2626` (red)

Nhưng `base.css` thực tế:
- `--group-color-cost: #dc2626` (red)
- `--group-color-actionable: #16a34a` (green)

**Fix:** Cập nhật CLAUDE.md cho đúng với code thực tế.

### M8 — Không có request ID / correlation ID trong logs
**File:** `apps/api/src/server.ts`, `routes/`  
**Vấn đề:** Khi debug production issue, không thể trace một request cụ thể qua logs. Fastify mặc định có `req.id` nhưng không được log kèm theo.

**Fix:** Thêm `requestIdLogLabel` vào Fastify config, đảm bảo mọi service log đều include `reqId`.

---

## Low Priority Issues

### L1 — `declare const window: any` unsafe
**File:** `apps/web/dashboard/dashboard.ts:12`  
`declare const window: any` override type an toàn của `window`. Fix: remove declaration, dùng `(window as Window & typeof globalThis)` hoặc properly type.

### L2 — SVG chart không có ARIA labels (Accessibility)
**File:** `apps/web/dashboard/dashboard.ts:325-565`  
Chart timeline không có `role="img"`, không có `aria-label`, `aria-describedby`. Screen reader không hiểu được chart.

### L3 — `chooseTimelineIntervalMinutes` duplicated
**File:** `apps/web/dashboard/dashboard.ts:288` và `buildTimelineQueryParams:314`  
Hàm `chooseTimelineIntervalMinutes` được tính 2 lần — một lần trong `buildTimelineQueryParams` gửi lên API, một lần API tự tính. Nên dùng interval do API trả về.

### L4 — `server.ts` có nhiều `fastifyStatic` register với paths tương đối runtime
**File:** `apps/api/src/server.ts:46-82`  
7 static file registrations với `path.resolve(__dirname, "../../..")` — fragile khi build path thay đổi. Nên cấu hình root path qua env var `STATIC_ROOT`.

### L5 — `insights-service.ts` fallback L2 không có timeout
**File:** `apps/api/src/services/insights-service.ts` (referenced in CLAUDE.md)  
L2 API fallback nếu không có timeout có thể làm `/api/insights` hang indefinitely.

---

## Refactoring Roadmap

### Quick Wins (1–2 ngày)

1. **[C3] Rate limit kill-session** — 1 file, install `@fastify/rate-limit`, 30 phút
2. **[H5] Thêm try/catch route handlers** — 8 file routes, pattern lặp lại, 2 giờ
3. **[H4] `var` → `const`/`let` trong dashboard.ts** — TypeScript codemod, 1 giờ
4. **[H6] Xóa inline style strings, thêm CSS classes** — `roleNodeCell()`, 30 phút
5. **[M1] Chuẩn hóa error messages sang English** — search + replace, 30 phút
6. **[M7] Update CLAUDE.md** — fix documentation, 15 phút

### Short-term Refactor (1–2 tuần)

7. **[C1] Fastify request schema validation** — tất cả routes, ưu tiên `findings.ts` và `actions.ts`
8. **[M4] Aggregation pipeline cho latest analysis per finding** — `findings-service.ts`
9. **[H2] Encapsulate global state** — tạo `DashboardState` object
10. **[H3] Định nghĩa interfaces thay thế `any`** — tạo `apps/web/dashboard/types.ts`
11. **[M3] Cache getComputedStyle** — `timeline-chart` section
12. **[M5] Fastify response schema** — `/api/findings` trước, block sensitive fields

### Mid-term Refactor (1–2 tháng)

13. **[H1] Tách `dashboard.ts`** — theo thứ tự:
    - Bước 1: Extract `time-picker.ts` (ít dependency nhất)
    - Bước 2: Extract `timeline-chart.ts`
    - Bước 3: Extract `auto-refresh.ts`
    - Bước 4: Extract `diagnostics-panel.ts`
    - Bước 5: Extract `finding-detail.ts`
    - Bước 6: Refactor orchestration trong `dashboard.ts` còn lại
14. **[C2] Thay HTML string concatenation** — template helper hoặc DOM API, theo từng module khi tách
15. **[M8] Request ID / Correlation ID** — Fastify plugin

### Long-term Architecture Improvement

16. **TypeScript strict mode** — `tsconfig.json`: bật `strict: true`, `noImplicitAny: true`
17. **ESLint + Prettier** — `@typescript-eslint/no-explicit-any`, `prefer-const`
18. **Unit tests** — ưu tiên `findings-service.ts`, `time-filter.ts`, `timeline-chart.ts` (pure functions)
19. **Husky + lint-staged** — enforce type check trước commit
20. **Response DTOs** — tách MongoDB document schema khỏi API response schema

---

## UI/UX Improvement Roadmap

### Màn hình cần cải thiện

1. **Dashboard — Empty State:** Khi không có findings, hiển thị empty state có icon + message thay vì table trắng
2. **Dashboard — Error State:** API error hiện chỉ set `err.textContent` mà không có visual styling
3. **Query Plan — Loading Skeleton:** Khi submit plan XML, thay loading spinner bằng skeleton của 5 section groups
4. **Insights — Pagination:** Chưa có phân trang rõ ràng

### Bootstrap components nên áp dụng

| Component | Áp dụng cho | File |
|---|---|---|
| Alert | Error/warning banners | `dashboard.html`, `insights.html` |
| Badge | Severity, alert status | Đang dùng custom — cân nhắc unify |
| Spinner | Loading state | Đang có custom `.loading-overlay` |

### Animation nên thêm

- **Timeline chart bars:** Animate height từ 0 lên khi data load lần đầu (`transition: height 200ms ease-out`)
- **Modal open/close:** CSS `animation: fadeIn 150ms ease` thay vì instant show/hide
- **Tab switch:** Fade transition giữa các tab (`opacity: 0→1, 120ms`)
- **Finding row hover:** Đã có `--color-row-hover`, thêm `transition: background 120ms`
- **Stat cards (Critical/Warning/Info counter):** Animate number count up khi refresh

### Responsive cần chỉnh sửa

- **Timeline chart:** Trên mobile (< 480px), chart height nên thu nhỏ; hiện tại `height: 170px` fixed
- **Time picker popover:** Trên mobile chiều rộng `positionTimePicker()` không handle màn hình hẹp đủ tốt
- **Findings table:** Cần horizontal scroll wrapper trên tablet/mobile
- **Diagnostics panel:** Phase badges wrap không đẹp trên màn hình nhỏ

---

## Final Verdict

**Có nên merge production không?** _Có điều kiện_ — code đang chạy stable nhưng cần xử lý ít nhất C1, C3, H5 trước khi expose rộng hơn.

**Bắt buộc sửa trước release:**
1. **C1** — Fastify schema validation để chặn MongoDB operator injection
2. **C3** — Rate limit kill-session
3. **H5** — Try/catch route handlers để tránh unhandled 500 không có log context

**Không bắt buộc nhưng khuyến khích trước khi onboard developer mới:**
- H1 (tách dashboard.ts) — file 2193 dòng là rào cản lớn khi code review
- H2 + H3 + H4 (TypeScript hygiene) — `any` + `var` làm mất hết lợi ích của TypeScript

---

*Plan này có thể được update khi có thêm context từ team hoặc yêu cầu mới.*
