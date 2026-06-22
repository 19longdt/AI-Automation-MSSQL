# Topic: TempDB & Memory Pressure Monitor

**topic_id**: `tempdb_memory` | **Schedule**: 300s (5 phút) | **Nodes**: `primary` | **Detector**: `threshold`

**Related topics**:
- [`ple_trend`](ple_trend.md) — phát hiện PLE giảm đột ngột so với baseline 4 tuần (300s)
- [`ag_health`](ag_health.md) — AG sync lag có thể gây memory pressure trên Primary

---

## 1. Bối cảnh

Topic này giám sát **2 nhóm vấn đề liên quan đến nhau**:

**Buffer Pool Memory (RAM):** SQL Server dùng buffer pool để cache data pages trong RAM. Khi RAM không đủ, pages bị đẩy ra đĩa → mỗi query phải đọc đĩa thay vì đọc RAM → throughput giảm mạnh. Page Life Expectancy (PLE) đo số giây một page tồn tại trong RAM trước khi bị đẩy ra — PLE thấp là dấu hiệu rõ nhất của memory pressure.

**TempDB Disk:** TempDB là database tạm dùng chung cho toàn server. Khi RAM thiếu, query sort/hash join không đủ memory grant sẽ spill xuống TempDB. CDC + snapshot isolation cũng ghi version cũ vào version store trong TempDB. Nếu TempDB đầy, query sẽ lỗi `Could not allocate space in tempdb`.

**Mối liên hệ leo thang:**
```
RAM thiếu (PLE thấp)
    → query sort/hash spill xuống TempDB (internal_mb tăng)
    → pending_grants tăng (query chờ memory)
    → TempDB used_pct tăng
    → version_store tích tụ nếu CDC không dọn kịp
    → TempDB đầy → query lỗi
```

**Đặc thù hệ thống:**
- Server hiện tại 24GB RAM → PLE khuyến nghị tối thiểu ≥ 1800s (= 24/4 × 300)
- Server có thể có nhiều NUMA node — query `ple_numa` phát hiện imbalance giữa các node

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện phát hiện |
|---|---|---|
| G1 | **PLE thấp** — buffer pool bị churn, SQL Server đọc đĩa liên tục | `ple_sec < 1500` (warning) / `< 600` (critical) |
| G2 | **NUMA imbalance** — 1 node bị pressure trong khi global PLE trông ổn | `ple_sec` per NUMA node — context cho AI, không có threshold riêng |
| G3 | **Memory grant nghẽn** — query đang xếp hàng chờ memory | `pending_grants >= 1` (warning) / `>= 5` (critical) |
| G4 | **TempDB sắp đầy** — rủi ro lỗi query nếu không can thiệp | `used_pct >= 70%` (warning) / `>= 85%` (critical) |
| G5 | **Version store phình to** — CDC failure hoặc snapshot isolation giữ lâu | `version_store_mb >= 500` (warning) / `>= 1000` (critical) |
| G6 | **Lưu lịch sử liên tục dù hệ thống khỏe mạnh** | `emit_info_when_healthy = True` → finding `severity=INFO` mỗi 5 phút |

---

## 3. Metrics & Thresholds

### Query `ple` — PLE toàn server (Buffer Manager)

**DMV:** `sys.dm_os_performance_counters WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%'`

| Metric | Warning | Critical | Hướng |
|---|---|---|---|
| `ple_sec` | 1500 | 600 | **Thấp hơn = tệ hơn** (`lower_is_worse_fields`) |

**Công thức ngưỡng theo RAM:** `PLE_min = (RAM_GB / 4) × 300`

| RAM | PLE tối thiểu | Warning | Critical |
|---|---|---|---|
| 24 GB (hiện tại) | 1800s | **1500s** | **600s** |
| 32 GB | 2400s | **2000s** | **800s** |
| 64 GB | 4800s | **4000s** | **1600s** |

Cập nhật ngưỡng khi nâng RAM (không cần redeploy):
```js
db.monitor_topics.updateOne(
  { topic_id: "tempdb_memory" },
  { $set: { "thresholds.ple_sec.warning": 2000, "thresholds.ple_sec.critical": 800 }}
)
```

---

### Query `ple_numa` — PLE từng NUMA node

**DMV:** `sys.dm_os_performance_counters WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Node%'`

| Field | Ý nghĩa |
|---|---|
| `numa_node` | Tên NUMA node (e.g., `SQLServer:Buffer Node`) |
| `ple_sec` | PLE cục bộ của node đó |

**Không có threshold riêng** — dùng làm context cho AI và hiển thị per-node lines trên chart. PLE global có thể che khuất vấn đề: nếu Node 0 = 6000s và Node 1 = 800s, global = ~3400s nhưng Node 1 đang bị pressure nặng.

> Server 1 CPU socket (1 NUMA node) → query này trả về rỗng — bình thường.

---

### Query `memory_grants` — Memory Grants Pending

**DMV:** `sys.dm_os_performance_counters WHERE counter_name = 'Memory Grants Pending'`

| Metric | Warning | Critical | Ý nghĩa |
|---|---|---|---|
| `pending_grants` | 1 | 5 | Số query đang chờ SQL Server cấp phát memory trước khi chạy |

Mỗi query có sort/hash join cần được cấp 1 memory grant trước khi thực thi. `pending_grants > 0` nghĩa là throughput đang bị giảm.

---

### Query `tempdb_space` — TempDB Space Usage

**DMV:** `sys.dm_db_file_space_usage`

| Metric | Warning | Critical | Ý nghĩa |
|---|---|---|---|
| `used_pct` | 70% | 85% | % TempDB đã dùng — threshold chính |
| `version_store_mb` | 500 | 1000 | CDC + snapshot isolation; tăng khi CDC failure |

**Fields bổ sung** (không có threshold, context cho AI):

| Field | Khi nào đáng chú ý |
|---|---|
| `total_mb` | Dung lượng TempDB đã cấp phát trên đĩa |
| `free_mb` | Còn bao nhiêu chỗ trống |
| `internal_mb` | Tăng khi query sort/hash spill vì RAM không đủ |
| `user_object_mb` | `#tmp` table, `@tv` table variable đang được giữ |

**issue_type mapping:**

| Metric vi phạm | issue_type | Skill Layer 2 |
|---|---|---|
| `ple_sec`, `pending_grants` | `memory_pressure` | `memory.yaml` |
| `used_pct`, `version_store_mb` | `tempdb_pressure` | `memory.yaml` |

---

## 4. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 300s)                            │
│                                                                  │
│  MongoDB monitor_topics["tempdb_memory"]                        │
│    └── scheduler.py → topic_runner.run("tempdb_memory")         │
│                                                                  │
│  1. Resolve nodes: ["primary"] → [SQL-NODE-01]                  │
│     (node_role_cache — auto-detect, refresh mỗi giờ)           │
│                                                                  │
│  2. Execute parallel (4 queries):                                │
│     ├── ple            → 1 row  (Buffer Manager global PLE)     │
│     ├── ple_numa       → N rows (1 row/NUMA node, có thể rỗng)  │
│     ├── memory_grants  → 1 row  (pending grants count)          │
│     └── tempdb_space   → 1 row  (space breakdown)               │
│                                                                  │
│  3. raw_metrics_repo.insert_many()                              │
│                                                                  │
│  4. ThresholdDetector.detect()                                  │
│     ├── Vi phạm threshold → Finding(severity=WARNING/CRIT)      │
│     │    lower_is_worse_fields: ["ple_sec"]                      │
│     └── Không vi phạm → Finding(severity=INFO)                  │
│          vì emit_info_when_healthy=True (lưu history chart)      │
│                                                                  │
│  5. findings_repo.insert_one()                                   │
│  6. Dedup (30 phút) → Telegram alert nếu WARNING/CRITICAL       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  Skill: memory.yaml (skill_id: memory_v1)                       │
│  issue_type: memory_pressure | tempdb_pressure                  │
│                                                                  │
│  Required tools: get_memory_pressure                             │
│  Optional tools: get_ple_numa, get_memory_grant,                │
│                  get_tempdb_usage, get_wait_stats,              │
│                  get_query_stats, get_resource_governor_stats    │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic_id=tempdb_memory
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Component: TempdbMemoryPreview                                 │
│                                                                  │
│  KPI Cards (4):                                                  │
│  ┌─────────┐ ┌────────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │   PLE   │ │ Memory Grants  │ │ TempDB Used│ │Version Store│ │
│  │  (giây) │ │   Pending      │ │     %      │ │     MB      │ │
│  │tone inv │ │ tone: high=bad │ │tone: hi=bad│ │ tone: hi=bad│ │
│  └─────────┘ └────────────────┘ └────────────┘ └─────────────┘ │
│                                                                  │
│  Chart trái (1.6fr) — PLE Trend:                                │
│  · ple_sec line + reference lines warn/crit                     │
│  · Nếu có NUMA: thêm đường per node (ple__<node>)              │
│                                                                  │
│  Chart phải (1fr) — TempDB Space (dual y-axis):                 │
│  · used_pct (trái, %) + version_store_mb (phải, MB)            │
│  · reference lines warn/crit cho used_pct                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **4 queries riêng biệt** | Lấy từ 3 DMV khác nhau không thể JOIN sạch: `dm_os_performance_counters` (2 filter khác), `dm_db_file_space_usage`. `ple_numa` tách riêng vì trả về nhiều rows (1 row/NUMA node) |
| **`emit_info_when_healthy=True`** | Chart cần data points liên tục kể cả khi PLE và TempDB đang bình thường — giống pattern `ag_health` và `ag_redo_secondary` |
| **`lower_is_worse_fields: ["ple_sec"]`** | PLE ngược chiều với các metric khác: giá trị thấp là nguy hiểm. Threshold detector invert logic cho field này |
| **Không tách `ple` thành topic riêng** | PLE thấp và TempDB đầy là 2 triệu chứng cùng nguyên nhân (memory pressure) — cần xem cùng nhau khi phân tích |
| **`ple_trend` tách thành topic riêng** | Khác cơ chế: `tempdb_memory` dùng ngưỡng tuyệt đối; `ple_trend` dùng baseline so sánh tương đối. Cần detector khác nhau |
| **Thresholds trong MongoDB** | Khi nâng RAM, chỉ cần update MongoDB — không redeploy service |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- Không gợi ý tăng RAM trước khi xác định nguyên nhân (large scan, missing index, max server memory chưa set)

---

## 6. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_tempdb_memory()` | Topic config: SQL, thresholds, nodes, analysis_config |
| L1 Detector | `layer1/detectors/threshold_detector.py` | Evaluate thresholds + emit_info_when_healthy |
| L1 Capture tools | `layer1/seed/seed_capture_tools.py` | `_get_memory_pressure()`, `_get_ple_numa()`, `_get_memory_grant()`, `_get_tempdb_usage()` |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_TEMPDB_MEMORY` | topic_id constant |
| L2 Skill | `layer2/skills/memory.yaml` | Specialization + tools cho `memory_pressure`, `tempdb_pressure` |
| L3 Component | `layer3/apps/web-v2/src/components/dashboard/TempdbMemoryPreview.tsx` | KPI cards + 2 charts |
| L3 Page | `layer3/apps/web-v2/src/pages/DashboardPage.tsx` | `showTempdbPreview = activeTopicId === "tempdb_memory"` |
