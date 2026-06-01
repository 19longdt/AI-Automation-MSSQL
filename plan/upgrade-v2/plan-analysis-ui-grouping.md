# Plan: Plan Analysis UI — Section Grouping & Visual Hierarchy

## Mục tiêu

Tổ chức lại 14 sections hiện tại thành 5 nhóm có chủ đề rõ ràng, thêm visual
group headers để DBA nhìn vào biết ngay đang ở tầng phân tích nào. Hỗ trợ
light mode và dark mode.

---

## 1. Cấu trúc nhóm đề xuất

```
┌─────────────────────────────────────────────────────────┐
│  ▸ ORIENTATION                                     [2]  │  ← group header
├─────────────────────────────────────────────────────────┤
│  ● Query Text                                           │
│  ● Warnings                                        [12] │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ▸ COST ANALYSIS                                   [3]  │
├─────────────────────────────────────────────────────────┤
│  ● Top Expensive Operations                        [8]  │
│  ● Est vs Actual Rows                              [3]  │
│  ● I/O Statistics                                 [13]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ▸ ACTIONABLE                                      [3]  │
├─────────────────────────────────────────────────────────┤
│  ● Missing Indexes                                 [1]  │
│  ● Statistics Used                                [16]  │
│  ● Parameters                                      [4]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ▸ CONTEXT                                         [4]  │
├─────────────────────────────────────────────────────────┤
│  ● Indexes Used                                    [4]  │
│  ● Join Types & Operations                         [9]  │
│  ● Memory Grant                                         │
│  ● Wait Statistics                                 [8]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ▸ DEEP DIVE                                       [2]  │
├─────────────────────────────────────────────────────────┤
│  ● Compilation & Settings                               │
│  ● Lookup Queries                                       │
└─────────────────────────────────────────────────────────┘
```

**[N]** = tổng count badge của các sections trong nhóm (sections có data).

---

## 2. Design của Group Header

### 2.1 Anatomy

```
┌──────────────────────────────────────────────────────────────┐
│  ── COST ANALYSIS ────────────────────────────────── [3] ──  │
└──────────────────────────────────────────────────────────────┘
```

Chi tiết:
- Đường kẻ ngang mảnh (1px, `color-border`) chạy suốt chiều rộng
- Label nhóm ngắt đường kẻ ở bên trái: uppercase, font-size 10px, letter-spacing 0.12em
- Mỗi nhóm có **accent color** riêng (dot nhỏ 6px trước label)
- Badge `[N]` ở bên phải: số sections có data trong nhóm — giúp DBA thấy ngay nhóm nào có vấn đề
- Click vào header: collapse/expand toàn bộ sections trong nhóm

### 2.2 Màu accent theo nhóm

| Nhóm | Accent | Light mode | Dark mode |
|---|---|---|---|
| ORIENTATION | xanh dương | `#2563eb` | `#60a5fa` |
| COST ANALYSIS | cam đỏ | `#dc2626` | `#f87171` |
| ACTIONABLE | xanh lá | `#16a34a` | `#4ade80` |
| CONTEXT | tím nhạt | `#7c3aed` | `#c084fc` |
| DEEP DIVE | xám | `#6b7280` | `#9ca3af` |

### 2.3 HTML structure

```html
<!-- Group header -->
<div class="pa-group" data-group="cost">
  <div class="pa-group-header" role="button">
    <span class="pa-group-dot cost"></span>
    <span class="pa-group-label">COST ANALYSIS</span>
    <span class="pa-group-line"></span>
    <span class="pa-group-badge">3</span>
    <span class="pa-group-chevron">▾</span>
  </div>

  <!-- sections bên trong -->
  <div class="pa-group-body">
    <details class="pa-section"> ... </details>
    <details class="pa-section"> ... </details>
    <details class="pa-section"> ... </details>
  </div>
</div>
```

---

## 3. CSS cần thêm/sửa

### 3.1 Group container & header

```css
/* Group wrapper */
.pa-group {
  margin-bottom: 6px;
}

/* Group header — dòng phân cách có label */
.pa-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 2px 6px;
  cursor: pointer;
  user-select: none;
}

.pa-group-header:hover .pa-group-label {
  color: var(--color-text);
}

/* Dot accent màu theo nhóm */
.pa-group-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pa-group-dot.orientation { background: var(--group-color-orientation); }
.pa-group-dot.cost        { background: var(--group-color-cost); }
.pa-group-dot.actionable  { background: var(--group-color-actionable); }
.pa-group-dot.context     { background: var(--group-color-context); }
.pa-group-dot.deepdive    { background: var(--group-color-deepdive); }

/* Label */
.pa-group-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
  white-space: nowrap;
  transition: color 0.15s;
}

/* Đường kẻ ngang flex-grow */
.pa-group-line {
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

/* Badge tổng count */
.pa-group-badge {
  font-size: 10px;
  font-weight: 700;
  background: var(--color-border);
  color: var(--color-muted);
  border-radius: 10px;
  padding: 1px 7px;
  flex-shrink: 0;
}

/* Chevron collapse/expand */
.pa-group-chevron {
  font-size: 11px;
  color: var(--color-muted);
  flex-shrink: 0;
  transition: transform 0.2s;
}
.pa-group.collapsed .pa-group-chevron {
  transform: rotate(-90deg);
}

/* Body ẩn khi collapsed */
.pa-group-body {
  display: block;
}
.pa-group.collapsed .pa-group-body {
  display: none;
}
```

### 3.2 CSS variables theo nhóm (thêm vào base.css)

```css
/* Light mode */
:root {
  --group-color-orientation: #2563eb;
  --group-color-cost:        #dc2626;
  --group-color-actionable:  #16a34a;
  --group-color-context:     #7c3aed;
  --group-color-deepdive:    #6b7280;
}

/* Dark mode */
:root[data-theme="dark"] {
  --group-color-orientation: #60a5fa;
  --group-color-cost:        #f87171;
  --group-color-actionable:  #4ade80;
  --group-color-context:     #c084fc;
  --group-color-deepdive:    #9ca3af;
}
```

### 3.3 Section spacing trong nhóm

```css
/* Sections bên trong nhóm sát nhau hơn một chút */
.pa-group-body .pa-section {
  margin-bottom: 6px;
}

/* Section header có left border màu nhóm khi active/open */
.pa-group[data-group="cost"] .pa-section[open] {
  border-left: 1px solid var(--group-color-cost);
}
.pa-group[data-group="actionable"] .pa-section[open] {
  border-left: 1px solid var(--group-color-actionable);
}
/* ... tương tự cho các nhóm khác */
```

---

## 4. Thứ tự sections đầy đủ sau reorder

```
ORIENTATION
  1. Query Text          — luôn mở sẵn (open)
  2. Warnings            — luôn mở sẵn (open) nếu có critical

COST ANALYSIS
  3. Top Expensive Operations
  4. Est vs Actual Rows
  5. I/O Statistics

ACTIONABLE
  6. Missing Indexes
  7. Statistics Used
  8. Parameters

CONTEXT
  9. Indexes Used
 10. Join Types & Operations
 11. Memory Grant
 12. Wait Statistics

DEEP DIVE
 13. Compilation & Settings
 14. Lookup Queries
```

**Auto-open rules:**
- `Query Text` — luôn open
- `Warnings` — open nếu `critical_count > 0 || warning_count > 0`
- `Missing Indexes` — open nếu `missing_indexes.length > 0`
- Còn lại — đóng mặc định

---

## 5. Mockup tổng thể (light mode)

```
┌───────────────────────────────────────────────────────────────────┐
│  0.1741  │  SELECT  │  FULL  │  0  │  1  │  No  │  —            │
│  EST.    │  TYPE    │  OPTM  │ IDX │ WARN│ PARA │  MEM           │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ●── ORIENTATION ─────────────────────────────────── [2] ▾      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▼ Query Text                                                │  │
│  │   SELECT ...                                                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▼ Warnings                                             12  │  │
│  │   [WARNING] [OPERATOR] sort_expensive                       │  │
│  │   ────── (amber bar) ──────────────                         │  │
│  │   PERFORMANCE: EXPENSIVE SORT                               │  │
│  │   Sort chiếm 27% ...                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ●── COST ANALYSIS ───────────────────────────────── [3] ▾      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▶ Top Expensive Operations                              8  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▶ Est vs Actual Rows                                    3  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▶ I/O Statistics                                       13  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ●── ACTIONABLE ──────────────────────────────────── [3] ▾      │
│  ...                                                              │
└───────────────────────────────────────────────────────────────────┘
```

---

## 6. Light mode — màu sắc cụ thể

Group header label và dot phải đủ contrast trên `--color-surface` (trắng/xám rất nhạt):

| Element | Light | Dark |
|---|---|---|
| Group header bg | transparent | transparent |
| Group label text | `#6b7280` (gray-500) | `#9ca3af` (gray-400) |
| Group line | `#e5e7eb` (gray-200) | `#374151` (gray-700) |
| Group badge bg | `#f3f4f6` (gray-100) | `#1f2937` (gray-800) |
| Section open border-left | accent color per group | accent color per group (brighter) |

---

## 7. Files cần sửa

| File | Thay đổi |
|---|---|
| `plan-analysis-component.ts` | Bọc sections vào `_group()` helper, reorder sections, cập nhật auto-open logic |
| `plan-analysis.css` | Thêm group styles (`.pa-group`, `.pa-group-header`, `.pa-group-dot`, `.pa-group-badge`, ...) |
| `base.css` | Thêm `--group-color-*` CSS variables (light + dark) |

---

## 8. TypeScript — helper `_group()`

```typescript
private _group(
  id: string,           // "orientation" | "cost" | "actionable" | "context" | "deepdive"
  label: string,        // "ORIENTATION", "COST ANALYSIS", ...
  sections: string[],   // mảng HTML string từ _section()
  badge?: number        // tổng count (tự tính nếu undefined)
): string {
  var badgeHtml = badge !== undefined
    ? "<span class='pa-group-badge'>" + String(badge) + "</span>"
    : "";
  return "<div class='pa-group' data-group='" + id + "'>" +
    "<div class='pa-group-header'>" +
      "<span class='pa-group-dot " + id + "'></span>" +
      "<span class='pa-group-label'>" + label + "</span>" +
      "<span class='pa-group-line'></span>" +
      badgeHtml +
      "<span class='pa-group-chevron'>&#9662;</span>" +
    "</div>" +
    "<div class='pa-group-body'>" + sections.join("") + "</div>" +
    "</div>";
}
```

Bind event collapse/expand trong `_bindEvents()`:
```typescript
var groupHeaders = this.root.querySelectorAll(".pa-group-header");
groupHeaders.forEach(function(hdr) {
  hdr.addEventListener("click", function() {
    var grp = (hdr as HTMLElement).closest(".pa-group");
    if (grp) grp.classList.toggle("collapsed");
  });
});
```

---

## 9. Trình tự implement

- [ ] **Bước 1** — Thêm CSS variables vào `base.css`
- [ ] **Bước 2** — Thêm group styles vào `plan-analysis.css`
- [ ] **Bước 3** — Thêm `_group()` helper + bind collapse event trong `plan-analysis-component.ts`
- [ ] **Bước 4** — Reorder sections trong `_buildHtml()`, bọc vào 5 nhóm, cập nhật auto-open
- [ ] **Bước 5** — Build + verify light mode
- [ ] **Bước 6** — Verify dark mode (toggle theme)
