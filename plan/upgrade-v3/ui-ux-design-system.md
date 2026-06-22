# Layer 3 — UI/UX Design System v3
> Chuẩn hiện đại 2025–2026 | Real-Time Monitoring Dashboard
> Tổng hợp từ: UI/UX Pro Max skill + code review layer3
> Ngày: 2026-06-11

---

## 1. Design Direction

### Phong cách chính: **Real-Time Monitoring × Data-Dense Dashboard**

Hybrid của 2 style được skill xác nhận phù hợp nhất:

| Style | Đặc điểm áp dụng |
|---|---|
| **Real-Time Monitoring** | Pulsing status dots, alert colors (red/amber/green), auto-refresh indicator, streaming feel |
| **Data-Dense Dashboard** | 12-col grid, compact card (8–12px padding), sortable table, KPI row, information density tối đa |

**Không dùng:** HUD/Sci-Fi (overdesign, accessibility kém), Material You (app mobile, không phải web admin).

### Mood & Tone
- Precision, trust, professional — như Datadog / Grafana / Linear
- Dark mode mặc định (DBA làm việc nhiều giờ, OLED-friendly)
- Light mode là secondary — không sacrifice vì dark mode

---

## 2. Color System

### 2.1 Palette mới — "Midnight Slate" (dark-first, dual mode)

Tổng hợp từ **Financial Dashboard palette** (skill result #5) + điều chỉnh cho monitoring context:

```css
/* ───── DARK MODE (default) ───── */
:root[data-theme="dark"] {
  /* Backgrounds — 3 tầng rõ ràng */
  --color-bg:           #020617;   /* deep midnight — body bg */
  --color-surface:      #0f172a;   /* card, panel bg */
  --color-surface-2:    #1e293b;   /* elevated card, modal */
  --color-surface-3:    #334155;   /* hover row, input bg */

  /* Text */
  --color-text:         #f1f5f9;   /* primary text */
  --color-text-2:       #cbd5e1;   /* secondary text */
  --color-muted:        #94a3b8;   /* muted / placeholder */
  --color-subtle:       #475569;   /* very muted (dividers text) */

  /* Primary — Electric Blue */
  --color-primary:      #3b82f6;   /* active tab, link, primary btn */
  --color-primary-soft: #1e3a5f;   /* chip bg, tag bg */
  --color-primary-hover:#60a5fa;   /* hover state */

  /* Status — semantic (không dùng màu khác cho status) */
  --color-critical:     #ef4444;   /* CRITICAL finding */
  --color-critical-soft:#2d1515;
  --color-warning:      #f59e0b;   /* WARNING finding */
  --color-warning-soft: #2d1f0a;
  --color-info:         #3b82f6;   /* INFO finding */
  --color-info-soft:    #1e3a5f;
  --color-success:      #22c55e;   /* healthy / ok */
  --color-success-soft: #0f2d1c;

  /* Node roles */
  --color-role-primary:   #60a5fa; /* PRIMARY node — clear blue */
  --color-role-secondary: #94a3b8; /* SECONDARY node — muted */

  /* Plan analysis groups */
  --group-color-orientation: #3b82f6;
  --group-color-cost:        #a855f7;
  --group-color-actionable:  #ef4444;
  --group-color-context:     #06b6d4;
  --group-color-deepdive:    #64748b;

  /* Borders */
  --color-border:       #1e293b;
  --color-border-2:     #334155;   /* stronger divider */

  /* Misc */
  --color-overlay:      rgba(2, 6, 23, 0.72);
  --color-row-hover:    rgba(59, 130, 246, 0.06);
  --color-code-bg:      #020617;
  --color-code-text:    #e2e8f0;
}

/* ───── LIGHT MODE ───── */
:root {
  --color-bg:           #f8fafc;
  --color-surface:      #ffffff;
  --color-surface-2:    #f1f5f9;
  --color-surface-3:    #e2e8f0;

  --color-text:         #0f172a;
  --color-text-2:       #1e293b;
  --color-muted:        #64748b;
  --color-subtle:       #94a3b8;

  --color-primary:      #2563eb;
  --color-primary-soft: #eff6ff;
  --color-primary-hover:#1d4ed8;

  --color-critical:     #dc2626;
  --color-critical-soft:#fef2f2;
  --color-warning:      #d97706;
  --color-warning-soft: #fffbeb;
  --color-info:         #2563eb;
  --color-info-soft:    #eff6ff;
  --color-success:      #16a34a;
  --color-success-soft: #f0fdf4;

  --color-role-primary:   #1d4ed8;
  --color-role-secondary: #6b7280;

  --group-color-orientation: #2563eb;
  --group-color-cost:        #7c3aed;
  --group-color-actionable:  #dc2626;
  --group-color-context:     #0891b2;
  --group-color-deepdive:    #6b7280;

  --color-border:       #e2e8f0;
  --color-border-2:     #cbd5e1;

  --color-overlay:      rgba(15, 23, 42, 0.40);
  --color-row-hover:    #f1f5f9;
  --color-code-bg:      #0f172a;
  --color-code-text:    #e2e8f0;
}
```

### 2.2 Semantic Status Colors — Quy tắc dùng

| Context | Color token | KHÔNG dùng |
|---|---|---|
| CRITICAL finding | `--color-critical` | raw `#dc2626` |
| WARNING finding | `--color-warning` | raw `#ca8a04` |
| INFO finding | `--color-info` | raw `#2563eb` |
| Success / healthy | `--color-success` | raw `#16a34a` |
| Primary node | `--color-role-primary` | inline `style="color:#0b3d91"` |
| Secondary node | `--color-role-secondary` | inline `style="color:#4f8edc"` |

**Nguyên tắc:** Màu KHÔNG phải nguồn thông tin duy nhất — luôn kèm icon hoặc text label (WCAG `color-not-only`).

---

## 3. Typography

### Phương án đề xuất: **Inter** (Modern Dark Cinema)

Lý do chọn Inter thay vì Fira Code/Sans:
- Inter là tiêu chuẩn de-facto của SaaS admin dashboard (Linear, Vercel, Supabase, Raycast)
- Variable font → 1 request duy nhất, mọi weight
- Render sắc nét trên mọi DPI (sub-pixel optimized)
- Monospace fallback: `font-variant-numeric: tabular-nums` cho số trong table

```css
/* Google Fonts — Variable font, 1 request */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap');

/* Code / SQL / JSON */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --font-ui:   'Inter', system-ui, -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}
```

### Type Scale

| Token | Size | Weight | Line-height | Dùng cho |
|---|---|---|---|---|
| `--text-xs`  | 11px | 400 | 1.4 | Table cell meta, timestamps |
| `--text-sm`  | 12px | 400/500 | 1.5 | Table content, labels |
| `--text-base`| 14px | 400 | 1.6 | Body text, descriptions |
| `--text-md`  | 15px | 500 | 1.5 | Card title, section header |
| `--text-lg`  | 18px | 600 | 1.4 | Page section title |
| `--text-xl`  | 24px | 700 | 1.3 | KPI stat number |
| `--text-2xl` | 32px | 700 | 1.2 | Dashboard header |

**Tabular numbers** cho mọi metric:
```css
.metric-value, .table-cell-number, .stat-count {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

---

## 4. Spacing & Layout

### 4px / 8px grid system (Data-Dense Dashboard)

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Component-specific */
  --card-padding:      12px 16px;  /* compact card */
  --card-padding-lg:   16px 20px;  /* standard card */
  --table-row-height:  40px;       /* compact but touchable */
  --header-height:     56px;       /* topbar */
  --sidebar-width:     0px;        /* không có sidebar — topic tabs thay thế */

  /* Border radius */
  --radius-sm:  4px;
  --radius-md:  8px;
  --radius-lg:  12px;
  --radius-xl:  16px;
  --radius-full: 9999px;  /* badge, pill */
}
```

### 12-column Grid Layout

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-3); /* 12px gap */
  padding: var(--space-4); /* 16px edge */
}

/* KPI row — 4 cards × 3 cols */
.kpi-card   { grid-column: span 3; }
/* Timeline chart — full width */
.chart-card { grid-column: span 12; }
/* Findings table — full width */
.table-card { grid-column: span 12; }

@media (max-width: 1024px) {
  .kpi-card { grid-column: span 6; }
}
@media (max-width: 768px) {
  .kpi-card { grid-column: span 12; }
  .dashboard-grid { gap: var(--space-2); padding: var(--space-3); }
}
```

---

## 5. Component Design System

### 5.1 Topbar / Navigation

**Hiện tại:** Không có topbar — navigation ẩn.  
**Đề xuất:** Topbar sticky, height 56px:

```
┌────────────────────────────────────────────────────────────────────────┐
│  🗄️ MSSQL Monitor    [Dashboard] [Insights] [Query Plan]    [●Live] [☀/☾] │
└────────────────────────────────────────────────────────────────────────┘
```

- Logo + product name bên trái
- Navigation links ở giữa (active indicator: bottom border `--color-primary`, 2px)
- Live status indicator (pulsing green dot) + theme toggle bên phải
- `position: sticky; top: 0; z-index: 40;`
- Backdrop blur khi scroll: `backdrop-filter: blur(12px); background: rgba(bg, 0.85);`

### 5.2 KPI Stat Cards (4 cards)

**Hiện tại:** `stats-cards.css` — basic, không animated.  
**Đề xuất:**

```
┌─────────────────────────┐
│ 🔴 Critical             │
│                         │
│  247                    │  ← text-xl 24px bold tabular
│  ────────────           │  ← subtle progress bar (màu critical)
│  ▲ 12 vs last hour      │  ← trend indicator
└─────────────────────────┘
```

```css
.kpi-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--card-padding-lg);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.kpi-card:hover {
  border-color: var(--color-border-2);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.kpi-number {
  font-size: var(--text-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
/* Accent bar dưới số */
.kpi-accent-bar {
  height: 3px;
  border-radius: 2px;
  margin-top: 8px;
  background: var(--kpi-color, var(--color-primary));
  width: var(--kpi-pct, 60%);  /* animate từ 0 khi load */
  transition: width 600ms ease-out;
}
```

### 5.3 Topic Tabs

**Hiện tại:** Tab horizontal, không có active indicator rõ.  
**Đề xuất:** Tab với count badge + severity indicator:

```
[ slow_sessions (12) ]  [ blocking ● (3) ]  [ deadlock ]  [ ag_health ]
       ─────── active indicator                 ↑ alert dot khi có CRITICAL
```

```css
.topic-tab {
  padding: 8px 16px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border-bottom: 2px solid transparent;
  transition: all 150ms ease;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
}
.topic-tab:hover {
  color: var(--color-text);
  background: var(--color-row-hover);
}
.topic-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: transparent;
}
.topic-tab .tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  background: var(--color-surface-3);
  color: var(--color-text-2);
  margin-left: 6px;
}
.topic-tab .tab-alert-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--color-critical);
  margin-left: 5px;
  animation: pulse-dot 2s infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.85); }
}
```

### 5.4 Findings Table

**Hiện tại:** Basic HTML table, không có skeleton, không có sort indicators.  
**Đề xuất:**

```css
.findings-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.findings-table th {
  padding: 8px 12px;
  text-align: left;
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  user-select: none;
}
.findings-table th.sortable {
  cursor: pointer;
}
.findings-table th.sortable:hover {
  color: var(--color-text);
}
.findings-table tr {
  transition: background 120ms ease;
}
.findings-table tr:hover td {
  background: var(--color-row-hover);
}
.findings-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
  line-height: 1.4;
}
```

**Severity Badge — thiết kế lại:**
```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.badge-critical {
  background: var(--color-critical-soft);
  color: var(--color-critical);
  border: 1px solid color-mix(in srgb, var(--color-critical) 30%, transparent);
}
.badge-warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}
.badge-info {
  background: var(--color-info-soft);
  color: var(--color-info);
  border: 1px solid color-mix(in srgb, var(--color-info) 30%, transparent);
}
```

### 5.5 Timeline Chart — Upgrade

**Hiện tại:** SVG stacked bar — đủ tốt về logic, cần polish visual.  
**Đề xuất cải thiện (không đổi library):**

1. **Bar style:** `rx="2"` để round top corner bars
2. **Grid lines:** `stroke-opacity: 0.3` nhẹ hơn, chỉ ngang
3. **"now" marker:** Dashed line `#ef4444` + text trên top
4. **Hover tooltip:** Glassmorphism style
5. **Anomaly highlight:** Bucket có CRITICAL count > threshold → border glow đỏ
6. **Color:** Dùng CSS variables thay vì fallback hex

```css
/* Timeline chart container */
.timeline-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--card-padding-lg);
}

/* Tooltip glassmorphism */
.findings-timeline-tooltip {
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  font-size: 12px;
  min-width: 140px;
  pointer-events: none;
}
```

### 5.6 Modal System — Thiết kế lại

**Hiện tại:** Manual z-index stacking, không có animation.  
**Đề xuất:**

```css
/* Modal backdrop */
.modal-backdrop {
  position: fixed; inset: 0;
  background: var(--color-overlay);
  backdrop-filter: blur(4px);
  z-index: 100;
  animation: fade-in 150ms ease;
}

/* Modal panel */
.modal-panel {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-xl);
  box-shadow: 0 24px 64px rgba(0,0,0,0.4);
  z-index: 101;
  width: min(90vw, 720px);
  max-height: 80vh;
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: modal-enter 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-enter {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

/* Modal header */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.modal-title { font-size: 15px; font-weight: 600; }

/* Modal body — scrollable */
.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
```

### 5.7 Empty State Component

**Hiện tại:** Không có — blank table body.  
**Đề xuất:**

```html
<div class="empty-state">
  <svg class="empty-icon"><!-- database/search icon --></svg>
  <div class="empty-title">No findings</div>
  <div class="empty-desc">No findings match your current filters and time range.</div>
  <button class="btn btn-secondary" onclick="clearFilters()">Clear filters</button>
</div>
```

```css
.empty-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 12px;
}
.empty-icon { width: 48px; height: 48px; opacity: 0.3; }
.empty-title { font-size: 15px; font-weight: 600; color: var(--color-text); }
.empty-desc  { font-size: 13px; color: var(--color-muted); max-width: 360px; }
```

### 5.8 Skeleton Loading

**Hiện tại:** Global spinner overlay — blocking, không có context.  
**Đề xuất:** Skeleton per section:

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-2) 0px,
    var(--color-surface-3) 80px,
    var(--color-surface-2) 160px
  );
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
  border-radius: var(--radius-sm);
}

/* Skeleton rows cho table */
.skeleton-row {
  height: 40px;
  margin-bottom: 1px;
}
.skeleton-cell-sm { width: 60px; height: 20px; }
.skeleton-cell-md { width: 120px; height: 20px; }
.skeleton-cell-lg { width: 200px; height: 20px; }
```

### 5.9 Auto-Refresh Indicator

**Hiện tại:** Checkbox + input — không có visual feedback khi đang refresh.  
**Đề xuất:**

```css
/* Live indicator — pulsing green dot */
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-success);
}
.live-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--color-success);
  position: relative;
}
.live-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: var(--color-success);
  opacity: 0.3;
  animation: live-pulse 2s infinite;
}
@keyframes live-pulse {
  0%, 100% { transform: scale(1); opacity: 0.3; }
  50%       { transform: scale(1.5); opacity: 0; }
}
```

### 5.10 Button System

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 150ms ease;
  white-space: nowrap;
  user-select: none;
}
.btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Primary */
.btn-primary {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-primary:active { transform: scale(0.98); }

/* Secondary */
.btn-secondary {
  background: var(--color-surface-2);
  color: var(--color-text);
  border-color: var(--color-border-2);
}
.btn-secondary:hover { background: var(--color-surface-3); }

/* Danger */
.btn-danger {
  background: var(--color-critical-soft);
  color: var(--color-critical);
  border-color: color-mix(in srgb, var(--color-critical) 30%, transparent);
}
.btn-danger:hover { background: var(--color-critical); color: #fff; }

/* Icon-only */
.btn-icon {
  padding: 7px;
  border-radius: var(--radius-md);
}

/* Loading state */
.btn[aria-busy="true"] {
  opacity: 0.7;
  pointer-events: none;
}
.btn[aria-busy="true"]::before {
  content: '';
  width: 12px; height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 6px;
}
```

---

## 6. Page Layouts

### 6.1 Dashboard Page — Layout mới

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR (sticky, 56px)                                           │
├──────────────────────────────────────────────────────────────────┤
│  [ slow_sessions (12) ] [ blocking ●(3) ] [ deadlock ] [ ag_health ]  ← topic tabs
├──────────────────────────────────────────────────────────────────┤
│  FILTER BAR (compact, 1 row):                                    │
│  [🔍 Finding ID] [Severity ▼] [Alert Status ▼] [Time Range ▼] [🔄 Live]
├────────────┬────────────┬────────────┬────────────────────────────┤
│ CRITICAL   │ WARNING    │ INFO       │ TOTAL (last 1h)            │ ← KPI row
│   247      │   89       │   12       │   348                      │
├──────────────────────────────────────────────────────────────────┤
│  TIMELINE CHART (findings over time, stacked bar)                │
│  ▓▓░░░▓▓▓░░░░▓░░░░░▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░|now           │
├──────────────────────────────────────────────────────────────────┤
│  FINDINGS TABLE                                                   │
│  ID │ Time │ Type │ Severity │ Node │ Metrics... │ AI │ Action   │
│  ─────────────────────────────────────────────────────────────── │
│  row...                                                          │
├──────────────────────────────────────────────────────────────────┤
│  PAGINATION  ← 1 2 3 ... 12  →                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Changes so với hiện tại:**
- Filter bar collapse thành 1 row (hiện đang 2-3 row)
- KPI cards horizontal scroll trên mobile
- Timeline chart height: 160px (compact hơn, data vẫn đủ đọc)
- Table header sticky khi scroll

### 6.2 Query Plan Page — Layout mới

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR                                                          │
├──────────────────────────────────────────────────────────────────┤
│  ┌─ INPUT PANEL ─────────────┐  ┌─ RESULT PANEL ──────────────┐ │
│  │  <textarea XML paste>     │  │  [Summary Bar]              │ │
│  │  [Analyze →]              │  │  [ORIENTATION ▼]            │ │
│  │                           │  │  [COST ANALYSIS ▼]          │ │
│  │  OR drop XML file here    │  │  [ACTIONABLE ▼]             │ │
│  └───────────────────────────┘  └─────────────────────────────┘ │
│  ← 40%                           60% →                          │
└──────────────────────────────────────────────────────────────────┘
```

Mobile: Stack vertically (input ở trên, result ở dưới).

### 6.3 Insights Page — Layout mới

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR                                                          │
├──────────────────────────────────────────────────────────────────┤
│  [ Issue Type Filter ] [ Severity Filter ] [ Time Range ]       │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Insight Card    │  │ Insight Card    │  │ Insight Card    │  │
│  │ slow_sessions   │  │ blocking        │  │ ag_health       │  │
│  │ CRITICAL ●      │  │ WARNING         │  │ INFO            │  │
│  │ Root cause...   │  │ Root cause...   │  │ Root cause...   │  │
│  │ [Top Actions]   │  │ [Top Actions]   │  │ [Top Actions]   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│       3-column grid (responsive → 2 col → 1 col)                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Animation Guidelines

Theo skill rule `duration-timing` + `motion-meaning`:

| Animation | Duration | Easing | Notes |
|---|---|---|---|
| Modal open | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Scale + fade from trigger |
| Modal close | 130ms | `ease-in` | Exit nhanh hơn enter |
| Tab switch | 150ms | `ease-out` | Opacity fade |
| Row hover | 120ms | `ease` | Background color |
| Card hover | 200ms | `ease` | Border + shadow |
| Skeleton shimmer | 1.4s | `linear` | infinite |
| Live pulse dot | 2s | `ease` | infinite |
| KPI accent bar | 600ms | `ease-out` | Load khi data vào |
| Toast slide-in | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Từ bottom-right vào |
| Toast slide-out | 150ms | `ease-in` | Exit |
| Button press | 80ms | `ease` | Scale 0.98 |

**Bắt buộc:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. Accessibility Checklist

Theo skill Priority 1 — CRITICAL:

- [ ] Contrast ratio: `--color-text` trên `--color-bg` ≥ 4.5:1 (test cả light + dark)
- [ ] Focus ring: `:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`
- [ ] Severity badges: kèm icon (⚠ ● ✓), không chỉ dùng màu
- [ ] SVG timeline chart: `role="img"`, `aria-label="Findings timeline chart"`
- [ ] Topic tabs: `role="tablist"`, `role="tab"`, `aria-selected`
- [ ] Modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- [ ] Kill session button: `aria-label="Kill session #123"`
- [ ] Auto-refresh toggle: `aria-label="Auto refresh", aria-checked`
- [ ] Table: `<th scope="col">`, sortable column có `aria-sort`

---

## 9. Dark Mode Upgrade

**Vấn đề hiện tại:** `--color-danger` không thay đổi giữa light/dark (đều `#d5443e`). Trong dark mode cần màu sáng hơn để đạt contrast.

**Fix:**
```css
/* Light: dùng màu đậm trên nền trắng */
:root              { --color-critical: #dc2626; }
/* Dark: dùng màu nhạt hơn trên nền tối, vẫn đủ contrast */
:root[data-theme="dark"] { --color-critical: #ef4444; }

/* Tương tự cho warning */
:root              { --color-warning: #d97706; }
:root[data-theme="dark"] { --color-warning: #f59e0b; }
```

**Theme toggle:** Lưu vào `localStorage` + apply `[data-theme]` trên `<html>` (đã làm đúng).

---

## 10. Responsive Breakpoints

```css
/* Mobile first */
@media (min-width: 480px)  { /* sm — wide mobile */ }
@media (min-width: 768px)  { /* md — tablet */  }
@media (min-width: 1024px) { /* lg — laptop */  }
@media (min-width: 1280px) { /* xl — desktop */ }
@media (min-width: 1440px) { /* 2xl — wide */   }
```

**Critical fixes:**
- Timeline chart: `height: 140px` trên mobile (giảm từ 170px)
- Time picker popover: `max-width: calc(100vw - 24px)` trên mobile
- Findings table: wrap trong `<div class="table-scroll">` với `overflow-x: auto`
- Topic tabs: horizontal scroll với `overflow-x: auto; scrollbar-width: none`

---

## 11. Implementation Priorities

### Phase 1 — CSS Token Overhaul (3–5 ngày)
1. Cập nhật toàn bộ CSS variables trong `base.css` theo palette "Midnight Slate"
2. Thêm Inter font (Google Fonts variable), thêm JetBrains Mono cho code
3. Fix dark mode contrast (critical/warning colors)
4. Thêm `prefers-reduced-motion` block
5. Fix inline style strings (`roleNodeCell`) → CSS class

### Phase 2 — Component Polish (1 tuần)
6. Redesign severity badges (border + soft background)
7. Topic tabs: count badge + alert dot
8. Button system: loading state (`aria-busy`), `focus-visible` ring
9. Empty state component
10. Skeleton loading (thay global spinner cho findings table)

### Phase 3 — Layout Upgrade (1–2 tuần)
11. Thêm Topbar component (navigation, live indicator, theme toggle)
12. KPI cards: accent bar animation, trend delta
13. Filter bar: collapse thành 1 row
14. Timeline chart: glassmorphism tooltip, `rx` border-radius bars
15. Modal: animation, backdrop blur

### Phase 4 — Page-level UX (2–3 tuần)
16. Query Plan page: split-panel layout (40/60)
17. Insights page: card grid thay vì list
18. Toast notification system (thay `openModal` cho success/error nhẹ)
19. Responsive: table scroll wrapper, mobile breakpoints

---

## 12. Reference — Inspiration Sources

| Source | URL | Học gì |
|---|---|---|
| Grafana | grafana.com | Dark monitoring dashboard |
| Datadog | datadoghq.com | Real-time alerts, color system |
| Linear | linear.app | Clean dark UI, typography |
| Vercel Dashboard | vercel.com/dashboard | KPI cards, status indicators |
| Raycast | raycast.com | Glass effect, compact density |
| Supabase | supabase.com | Table design, badge system |

---

*Plan này là thiết kế system — không import thêm library nào (giữ Vanilla TS). Mọi thay đổi là CSS + TypeScript thuần.*
