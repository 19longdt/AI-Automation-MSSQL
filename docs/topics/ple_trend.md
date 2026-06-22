# Topic: PLE Trend Monitor

**topic_id**: `ple_trend` | **Schedule**: 300s (5 phút) | **Nodes**: `primary` | **Detector**: `baseline`

**Related topics**:
- [`tempdb_memory`](tempdb_memory.md) — threshold tuyệt đối cho PLE + TempDB space (300s)

---

## 1. Bối cảnh

Topic này bổ sung cho [`tempdb_memory`](tempdb_memory.md) bằng cách phát hiện PLE giảm **tương đối so với pattern lịch sử** thay vì so với ngưỡng tuyệt đối.

**Vấn đề với threshold tuyệt đối đơn thuần:**

Server 64GB RAM có PLE bình thường = 10.000s. Nếu PLE giảm xuống 3.000s:
- `tempdb_memory` → **không alert** (3.000 > 1.500, vẫn trên ngưỡng warning)
- `ple_trend` → **alert** (giảm 70% so với baseline — bất thường rõ ràng)

**Cơ chế baseline:**

Mỗi lần chạy, detector tra cứu lịch sử 4 tuần trước với cùng thứ và cùng giờ (day-of-week aware). Workload thứ 2 sáng khác thứ 6 chiều — baseline phản ánh đúng pattern thực tế thay vì dùng trung bình toàn thời gian.

```
Thứ 3, 14:05 hôm nay   → PLE = 3.500s
Baseline thứ 3 14:00    → avg = 8.000s (trung bình 4 tuần qua)
Độ lệch                 → (8.000 - 3.500) / 8.000 = 56% → vượt ngưỡng 50% → ALERT
```

> **Lưu ý:** Baseline cần ít nhất 1 tuần dữ liệu để có ý nghĩa. Trong tuần đầu sau khi seed, topic này chưa alert được.

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện phát hiện |
|---|---|---|
| G1 | **PLE giảm đột ngột** — workload bất thường chưa chạm ngưỡng tuyệt đối | `deviation_pct > 50%` so với baseline cùng thứ-và-giờ |
| G2 | **Phát hiện sớm** — bắt memory pressure trước khi `tempdb_memory` alert | Baseline-aware: nếu server này PLE thường cao, drop nhỏ cũng được phát hiện |

---

## 3. Metrics & Thresholds

### Query `ple_global` — PLE toàn server

**DMV:** `sys.dm_os_performance_counters WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%'`

| Field | Ý nghĩa |
|---|---|
| `ple_sec` | PLE hiện tại — giá trị đem so với baseline |

### Baseline Config

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `metric_field` | `ple_sec` | Field đem so sánh |
| `threshold_pct` | 50.0 | Alert khi PLE giảm > 50% so với baseline |
| `baseline_weeks` | 4 | Dùng 4 tuần lịch sử cùng thứ-và-giờ |
| `min_executions` | 1 | Cần ít nhất 1 data point lịch sử |

**Fields detector trả về trong `finding.metrics`:**

| Field | Ý nghĩa |
|---|---|
| `ple_sec` | PLE thực tế tại thời điểm đó |
| `baseline_avg` | Trung bình 4 tuần cùng thứ cùng giờ |
| `baseline_stddev` | Độ lệch chuẩn baseline |
| `deviation_pct` | `(baseline_avg - ple_sec) / baseline_avg × 100` — dương = PLE thấp hơn baseline |
| `threshold_pct` | Ngưỡng alert = 50.0 |

**issue_type:** `memory_pressure` | **Skill Layer 2:** `memory.yaml`

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 300s)                            │
│                                                                  │
│  MongoDB monitor_topics["ple_trend"]                            │
│    └── scheduler.py → topic_runner.run("ple_trend")             │
│                                                                  │
│  1. Resolve nodes: ["primary"] → [SQL-NODE-01]                  │
│                                                                  │
│  2. Execute: ple_global → 1 row (ple_sec)                       │
│                                                                  │
│  3. raw_metrics_repo.insert_many()                              │
│                                                                  │
│  4. BaselineDetector.detect()                                   │
│     ├── Tra cứu baseline: avg ple_sec cùng weekday+hour, 4 tuần │
│     ├── Tính deviation_pct                                       │
│     ├── deviation_pct > 50% → Finding(severity=WARNING/CRIT)    │
│     └── deviation_pct ≤ 50% → không ghi finding                │
│          (khác ag_health: KHÔNG emit_info_when_healthy)         │
│                                                                  │
│  5. findings_repo.insert_one() — chỉ khi có alert               │
│  6. Dedup (30 phút) → Telegram alert nếu WARNING/CRITICAL       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  Skill: memory.yaml (skill_id: memory_v1)                       │
│  issue_type: memory_pressure                                    │
│                                                                  │
│  Required tools: get_memory_pressure                             │
│  Optional tools: get_ple_numa, get_memory_grant,                │
│                  get_wait_stats, get_query_stats                 │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic_id=ple_trend
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Component: PleTrendPreview                                     │
│                                                                  │
│  KPI Cards (3):                                                  │
│  ┌──────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │ PLE hiện tại │ │ Baseline 4 tuần  │ │      Độ lệch        │  │
│  │   (giây)     │ │  cùng thứ+giờ   │ │  > 50% = CRITICAL   │  │
│  │ tone by dev  │ │  tone: neutral   │ │  > 25% = WARNING    │  │
│  └──────────────┘ └──────────────────┘ └─────────────────────┘  │
│                                                                  │
│  Chart trái (1.6fr) — PLE vs Baseline:                          │
│  · ple_sec (solid blue) + baseline_avg (dashed gray)            │
│                                                                  │
│  Chart phải (1fr) — Deviation %:                                 │
│  · deviation_pct line + reference line tại 50%                  │
│                                                                  │
│  Empty state khi chưa đủ dữ liệu baseline (< 1 tuần)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **Tách khỏi `tempdb_memory`** | Cơ chế khác nhau: threshold tuyệt đối vs baseline tương đối — cần detector khác, config khác, không thể gộp chung |
| **Day-of-week aware baseline** | Workload pattern khác nhau theo ngày trong tuần — trung bình toàn thời gian tạo false positive lúc peak và bỏ sót lúc off-peak |
| **Không `emit_info_when_healthy`** | Baseline detector chỉ alert khi thực sự bất thường. Không cần lưu history liên tục vì `tempdb_memory` đã có chart PLE |
| **threshold_pct = 50%** | Drop 50% là ngưỡng thực tế: đủ nhạy để bắt sớm, đủ cao để tránh noise từ dao động tự nhiên |
| **`ple_trend` có thể disable** | Nếu team chủ yếu monitor qua dashboard, `tempdb_memory` chart đã đủ để thấy xu hướng. `ple_trend` có giá trị chính ở Telegram alert tự động |

**Constraints không được vi phạm:**
- Không alert trong tuần đầu sau khi seed (baseline chưa có data)
- `deviation_pct` dương = PLE thấp hơn baseline (tệ hơn); âm = PLE cao hơn baseline (tốt hơn)

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_ple_trend()` | Topic config: SQL, baseline_config, nodes, analysis_config |
| L1 Detector | `layer1/detectors/baseline_detector.py` | Compute deviation vs historical average |
| L1 Capture tools | `layer1/seed/seed_capture_tools.py` | `_get_memory_pressure()`, `_get_ple_numa()`, `_get_memory_grant()` |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_PLE_TREND` | topic_id constant |
| L2 Skill | `layer2/skills/memory.yaml` | Specialization + tools cho `memory_pressure` |
| L3 Component | `layer3/apps/web-v2/src/components/dashboard/PleTrendPreview.tsx` | KPI cards + 2 charts |
| L3 Page | `layer3/apps/web-v2/src/pages/DashboardPage.tsx` | `showPleTrendPreview = activeTopicId === "ple_trend"` |
