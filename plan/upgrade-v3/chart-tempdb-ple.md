# Plan: Chart cho `tempdb_memory` & `ple_trend` — Layer 3

> Ngày: 2026-06-20
> Tham chiếu pattern: `AgHealthPreview.tsx`, `AgRedoSecondaryPreview.tsx`

---

## Kiến trúc chung (pattern hiện có)

```
DashboardPage.tsx
  showAgHealthPreview → <AgHealthPreview />
  showAgRedoPreview   → <AgRedoSecondaryPreview />
  [cần thêm]
  showTempdbPreview   → <TempdbMemoryPreview />
  showPleTrendPreview → <PleTrendPreview />

Preview component:
  1. fetchAllFindings(/api/findings?topic_id=X) — paginated, tối đa 200/trang
  2. aggregateSeries() — time-bucket client-side (bucket = schedule_sec / 1 lần)
  3. KpiCard × N — latest snapshot + severity tone
  4. BaseMetricChart × 2 — lines + referenceLines từ useTopicMetricThreshold
  5. comparePastEnabled → mergeCompareSeries() + opacity 0.28
```

---

## File cần tạo / sửa

| File | Loại |
|---|---|
| `components/dashboard/TempdbMemoryPreview.tsx` | **Tạo mới** |
| `components/dashboard/PleTrendPreview.tsx` | **Tạo mới** |
| `pages/DashboardPage.tsx` | **Sửa** — thêm 2 điều kiện |

---

## Task 1 — `TempdbMemoryPreview.tsx`

### Fields cần dùng từ `finding.metrics`

| Field | Ý nghĩa | Threshold |
|---|---|---|
| `ple_sec` | Page Life Expectancy (giây) | warning=1500, critical=600, **lower_is_worse** |
| `pending_grants` | Sessions đang chờ memory grant | warning=1, critical=5 |
| `used_pct` | TempDB used % | warning=70, critical=85 |
| `version_store_mb` | Version store size (MB) | warning=500, critical=1000 |
| `internal_mb` | Internal objects (MB) | — hiển thị thông tin |
| `user_object_mb` | User objects (MB) | — hiển thị thông tin |
| `numa_node` | NUMA node (từ query `ple_numa`) | — group by nếu có |

### KPI Cards (4 cards, grid `md:grid-cols-2 xl:grid-cols-4`)

```
┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ 🧠 PLE              │ │ ⏳ Memory Grants     │ │ 💾 TempDB Used   │ │ 📦 Version Store │
│ <ple_sec> s         │ │ <pending_grants>     │ │ <used_pct> %     │ │ <version_store_mb│
│ tone: lower_is_worse│ │ tone: higher=worse   │ │ tone: warn/bad   │ │ tone: warn/bad   │
└─────────────────────┘ └─────────────────────┘ └──────────────────┘ └──────────────────┘
```

**Lưu ý PLE:** giá trị thấp = tệ hơn → dùng `getThresholdSeverity` với `lowerIsBetter: true`
(hoặc invert logic như threshold_detector: `value <= critical → bad, value <= warning → warn`).

### Charts (2 charts, layout `xl:grid-cols-[1.6fr_1fr]`)

**Chart trái — PLE Trend (1.6fr):**
```
eyebrow: "Page Life Expectancy"
title:   "PLE theo thời gian"

Lines:
  - dataKey: "ple_sec"
    name: "PLE (giây)"
    stroke: "#2563eb"

  - Nếu có numa_node: group by numa_node → mỗi node 1 line
    dataKey: "ple__<numa_node_key>"
    (tương tự pattern queue__<replica_key> trong AgHealth)

referenceLines:
  - y: 1500, stroke: "#f59e0b"   // warning
  - y: 600,  stroke: "#dc2626"   // critical

yAxis:
  tickFormatter: (v) => v >= 3600 ? `${Math.round(v/3600)}h` : `${Math.round(v)}s`

tooltip unit: "s"
```

**Chart phải — TempDB Space (1fr):**
```
eyebrow: "TempDB Space"
title:   "Sử dụng TempDB"

Lines:
  - dataKey: "used_pct"
    name: "TempDB Used %"
    stroke: "#0891b2"
    yAxisId: "pct"

  - dataKey: "version_store_mb"
    name: "Version Store MB"
    stroke: "#7c3aed"
    yAxisId: "mb"

yAxes:
  - id: "pct", width: 44, tickFormatter: (v) => `${v}%`
  - id: "mb", orientation: "right", width: 52, tickFormatter: (v) => `${v}`

referenceLines:
  - yAxisId: "pct", y: 70, stroke: "#f59e0b"    // warning
  - yAxisId: "pct", y: 85, stroke: "#dc2626"    // critical
  - yAxisId: "mb",  y: 500, stroke: "#7c3aed"   // version_store warning

tooltip unit: "mixed"
```

### Aggregation function

```typescript
// Bucket size: 5 phút (khớp với schedule_sec=300)
const TEMPDB_BUCKET_MS = 5 * 60_000;

interface TempdbPoint {
  ts: string;
  bucketTs: number;
  ple_sec: number | null;
  pending_grants: number | null;
  used_pct: number | null;
  version_store_mb: number | null;
  internal_mb: number | null;
  user_object_mb: number | null;
  // per-NUMA nếu có: ple__<key>: number | null
  latestFinding: FindingWithAnalysis | null;
  [key: string]: unknown;
}
```

Aggregation: lấy **giá trị mới nhất trong bucket** (không average) — vì mỗi job run cho 1 snapshot.

---

## Task 2 — `PleTrendPreview.tsx`

### Fields cần dùng từ `finding.metrics`

| Field | Ý nghĩa |
|---|---|
| `ple_sec` | PLE thực tế tại thời điểm đó |
| `baseline_avg` | Trung bình 4 tuần cùng ngày/giờ |
| `baseline_stddev` | Độ lệch chuẩn baseline |
| `deviation_pct` | % lệch so với baseline (computed by detector) |
| `threshold_pct` | Ngưỡng alert = 50.0 |

### KPI Cards (3 cards, grid `md:grid-cols-3`)

```
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ 📉 PLE hiện tại      │ │ 📊 Baseline (4 tuần) │ │ ⚠️  Độ lệch          │
│ <ple_sec> s          │ │ <baseline_avg> s      │ │ <deviation_pct> %    │
│ tone: by deviation   │ │ tone: neutral         │ │ tone: > 50% = bad    │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

**Tone cho PLE card:** nếu `deviation_pct > 50` → bad, nếu `deviation_pct > 25` → warn, còn lại good.

### Charts (2 charts, layout `xl:grid-cols-[1.6fr_1fr]`)

**Chart trái — PLE vs Baseline (1.6fr):**
```
eyebrow: "Baseline Comparison"
title:   "PLE thực tế so với baseline"

Lines:
  - dataKey: "ple_sec"
    name: "PLE thực tế"
    stroke: "#2563eb"
    strokeWidth: 2

  - dataKey: "baseline_avg"
    name: "Baseline 4 tuần"
    stroke: "#94a3b8"
    strokeDasharray: "6 4"
    strokeWidth: 1.5

yAxis:
  tickFormatter: (v) => v >= 3600 ? `${(v/3600).toFixed(1)}h` : `${Math.round(v)}s`

tooltip: hiển thị cả ple_sec + baseline_avg + deviation_pct
```

**Chart phải — Deviation % (1fr):**
```
eyebrow: "Phát hiện bất thường"
title:   "Độ lệch so với baseline"

Lines:
  - dataKey: "deviation_pct"
    name: "Lệch so với baseline (%)"
    stroke: "#dc2626"

referenceLines:
  - y: 50, stroke: "#f59e0b", label: "Ngưỡng alert 50%"

yAxis:
  tickFormatter: (v) => `${v}%`

Lưu ý: deviation_pct = (baseline_avg - ple_sec) / baseline_avg * 100
  → giá trị dương = PLE đang thấp hơn baseline
  → giá trị âm = PLE cao hơn baseline (tốt)
```

### Aggregation

```typescript
const PLE_TREND_BUCKET_MS = 5 * 60_000;

interface PleTrendPoint {
  ts: string;
  bucketTs: number;
  ple_sec: number | null;
  baseline_avg: number | null;
  deviation_pct: number | null;
  latestFinding: FindingWithAnalysis | null;
}
```

---

## Task 3 — Sửa `DashboardPage.tsx`

```tsx
// Thêm imports
import { TempdbMemoryPreview } from "@/components/dashboard/TempdbMemoryPreview";
import { PleTrendPreview } from "@/components/dashboard/PleTrendPreview";

// Thêm conditions
const showTempdbPreview  = activeTopicId === "tempdb_memory";
const showPleTrendPreview = activeTopicId === "ple_trend";

// Thêm vào JSX (trước else branch)
} : showPleTrendPreview ? (
  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
    <div className="flex min-h-full flex-col gap-3 pb-1">
      <KpiCards />
      <PleTrendPreview />
      <div className="min-h-[420px] shrink-0">
        <FindingsTable useOuterScroll />
      </div>
    </div>
  </div>
) : showTempdbPreview ? (
  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
    <div className="flex min-h-full flex-col gap-3 pb-1">
      <KpiCards />
      <TempdbMemoryPreview />
      <div className="min-h-[420px] shrink-0">
        <FindingsTable useOuterScroll />
      </div>
    </div>
  </div>
) : (
  // ... existing default branch
```

---

## Các hàm/hook dùng lại từ pattern hiện có

| Utility | Import từ |
|---|---|
| `BaseMetricChart` | `@/components/dashboard/BaseMetricChart` |
| `useTopicMetricThreshold` | `@/hooks/useTopics` |
| `buildFindingsQuery` | `@/lib/dashboard-query` |
| `parseWallClockDate` | `@/lib/format` |
| `formatNumber` | `@/lib/format` |
| `getThresholdSeverity` | `@/lib/topic-thresholds` |
| `useDashboardStore` | `@/store/dashboard.store` |
| `useTimeRange` | `@/hooks/useTimeRange` |
| `RefreshingOverlay` | `@/components/dashboard/AsyncState` |
| `GlossaryTip` | `@/components/plan/GlossaryTip` |
| `EmptyState` / `ErrorState` | `@/components/shared/` |

`KpiCard`, `ChartFrame`, `LegendItem`, `MetricTooltip`, `LoadingState` —
copy local vào mỗi file (cùng pattern với AgHealth và AgRedo).

---

## Thứ tự thực thi

```
1. TempdbMemoryPreview.tsx        (2-3h)
   ├── aggegate function
   ├── 4 KPI cards
   ├── PLE Trend chart (với/không NUMA)
   └── TempDB Space chart (dual y-axis)

2. PleTrendPreview.tsx            (1.5-2h)
   ├── aggregate function
   ├── 3 KPI cards
   ├── PLE vs Baseline chart (2 lines)
   └── Deviation % chart (reference line 50%)

3. DashboardPage.tsx              (15 phút)
   └── import + 2 conditions

4. Verify                         (30 phút)
   └── smoke test với data thực trong time range đủ rộng
```

---

## Điểm cần chú ý khi implement

1. **PLE là lower_is_worse** — severity tone phải invert:
   `ple_sec <= 600 → bad`, `ple_sec <= 1500 → warn`, còn lại `good`

2. **NUMA grouping trong TempdbMemory** — field `numa_node` chỉ có trong findings từ query `ple_numa` (query_id riêng). Cùng `detected_at` bucket có thể có nhiều findings với `numa_node` khác nhau. Group như `replicaKey()` pattern của AgHealth.

3. **deviation_pct sign convention** — kiểm tra Layer 1 detector trả về dương hay âm khi PLE thấp hơn baseline trước khi render label.

4. **Empty state** — `ple_trend` mới seed, sẽ không có data cho đến khi baseline được build (cần ~1 tuần dữ liệu). Empty state message nên giải thích: "Cần ít nhất 1 tuần dữ liệu để build baseline."

5. **Bucket size** — cả 2 topic đều có `schedule_sec=300` → bucket 5 phút hợp lý. Khác với AgHealth (2 phút).
