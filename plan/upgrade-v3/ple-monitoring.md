# Plan: PLE (Page Life Expectancy) Monitoring — 3 Layer

> Ngày: 2026-06-19
> Mục tiêu: Implement đầy đủ PLE monitoring từ thu thập → AI phân tích → hiển thị UI

---

## Hiện trạng

| Layer | Trạng thái |
|---|---|
| Layer 1 | PLE query có trong `tempdb_memory` topic — nhưng **có bug** và thiếu NUMA + trend |
| Layer 2 | `memory.yaml` skill tồn tại nhưng chưa có gợi ý PLE-specific |
| Layer 3 | Không có visualization riêng cho PLE |

---

## Bug đang tồn tại (cần fix ngay)

**File:** `layer1/seed/seed_topics.py` — hàm `_tempdb_memory()`

```python
# HIỆN TẠI — SAI KEY
"lower_is_worse": ["ple_sec"],   # ← key sai

# ĐÚNG PHẢI LÀ
"lower_is_worse_fields": ["ple_sec"],   # ← detector đọc key này
```

`threshold_detector.py` đọc `topic.extra.get("lower_is_worse_fields", [])`.
Với key sai hiện tại, PLE sẽ bị check theo hướng **ngược** (cao hơn = tệ hơn)
→ không bao giờ alert khi PLE thấp.

---

## Vấn đề với threshold hiện tại

Ngưỡng cứng `warning=300, critical=100` là rule cũ (server ~4GB RAM).

Server hiện đại công thức đúng hơn:

```
PLE_recommended = (RAM_GB / 4) × 300 giây
```

Ngưỡng theo RAM thực tế của hệ thống này:

| RAM | PLE tối thiểu | Warning | Critical |
|---|---|---|---|
| **24 GB** (hiện tại) | 1800s | **1500s** | **600s** |
| **32 GB** | 2400s | **2000s** | **800s** |
| **64 GB** | 4800s | **4000s** | **1600s** |

Threshold nằm trong MongoDB → khi nâng RAM chỉ cần update MongoDB, **không cần redeploy**:

```js
// Ví dụ khi nâng lên 32GB
db.monitor_topics.updateOne(
  { topic_id: "tempdb_memory" },
  { $set: { "thresholds.ple_sec.warning": 2000, "thresholds.ple_sec.critical": 800 }}
)
```

---

## Layer 1 — Việc cần làm

### Task L1-1: Fix bug `lower_is_worse_fields`
**File:** `layer1/seed/seed_topics.py`
**Loại:** Bug fix

```python
# Đổi key trong topic extra của _tempdb_memory()
"lower_is_worse_fields": ["ple_sec", "pending_grants"],
```

Sau khi fix cần re-seed topic vào MongoDB (hoặc update trực tiếp document).

---

### Task L1-2: Thêm query PLE per-NUMA node
**File:** `layer1/seed/seed_topics.py` — hàm `_tempdb_memory()`

Query hiện tại chỉ lấy global Buffer Manager PLE.
Cần thêm query lấy PLE theo từng NUMA node:

```sql
SELECT
    object_name AS numa_node,
    cntr_value  AS ple_sec
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND object_name LIKE '%Buffer Node%'
ORDER BY object_name
```

**Tại sao cần:** Nếu 1 NUMA node bị pressure nặng trong khi node kia ổn,
global PLE có thể che khuất vấn đề. Server multi-socket thường có 2-4 NUMA nodes.

Thêm vào topic queries với `query_id="ple_numa"`.
Threshold cho NUMA cũng dùng `lower_is_worse_fields`.

---

### Task L1-3: Thêm PLE drop rate detection (baseline)
**File:** `layer1/seed/seed_topics.py`

Ngoài threshold tuyệt đối (PLE < 300s), cần phát hiện PLE **giảm đột ngột**:
- PLE từ 5000s xuống 800s trong 10 phút → đáng alert dù chưa dưới 300s
- Dùng `detector_type: "baseline"` với day-of-week aware

Hoặc đơn giản hơn: thêm 1 topic riêng `ple_trend` với baseline detector
so sánh PLE hiện tại vs baseline cùng giờ 7 ngày trước,
alert khi giảm > 50%.

---

### Task L1-4: Cập nhật threshold theo RAM thực tế
**File:** `layer1/seed/seed_topics.py`

Thay `warning=300, critical=100` bằng giá trị đúng cho server 24GB hiện tại:

```python
"ple_sec": ThresholdConfig(warning=1500, critical=600),
```

Khi nâng RAM, update MongoDB trực tiếp (không cần redeploy):
```js
// Nâng lên 32GB
db.monitor_topics.updateOne({ topic_id: "tempdb_memory" },
  { $set: { "thresholds.ple_sec.warning": 2000, "thresholds.ple_sec.critical": 800 }})

// Nâng lên 64GB
db.monitor_topics.updateOne({ topic_id: "tempdb_memory" },
  { $set: { "thresholds.ple_sec.warning": 4000, "thresholds.ple_sec.critical": 1600 }})
```

---

## Layer 2 — Việc cần làm

### Task L2-1: Bổ sung PLE-specific guidance vào `memory.yaml`

**File:** `layer2/skills/memory.yaml`

Hiện `memory.yaml` generic về memory pressure. Cần thêm:
- Hướng dẫn AI đọc `ple_sec` và `numa_node` để phân tích NUMA imbalance
- Gợi ý công thức threshold theo RAM (`RAM_GB / 4 × 300`)
- Checklist nguyên nhân phổ biến: large table scan, missing index, max server memory chưa set

```yaml
specialization: |
  Focus: SQL Server memory pressure, buffer pool, plan cache, memory grants.

  Khi phân tích PLE (Page Life Expectancy):
  - PLE khuyến nghị = (RAM_GB / 4) × 300 giây. Ví dụ 128GB RAM → nên ≥ 9600s.
  - Kiểm tra PLE per NUMA node — imbalance giữa các node là dấu hiệu workload lệch.
  - Nguyên nhân phổ biến khi PLE giảm đột ngột:
      1. Large table scan đẩy pages ra khỏi buffer pool
      2. Missing index → full scan thay vì seek
      3. Max server memory chưa được cấu hình (mặc định unlimited)
      4. Workload spike bất thường (batch job, ETL)
  - Không gợi ý tăng RAM ngay nếu chưa xác định nguyên nhân.
  - Ưu tiên tìm query gây scan lớn qua get_query_stats hoặc get_memory_pressure.
```

---

### Task L2-2: Thêm tool `get_ple_numa` vào capture tools
**File:** `layer1/seed/seed_capture_tools.py`

Thêm tool cho AI gọi để lấy PLE per NUMA node on-demand khi phân tích:

```python
def _get_ple_numa() -> dict[str, Any]:
    """Capture PLE per NUMA node để phát hiện memory imbalance."""
    return {
        "get_ple_numa",
        "PLE per NUMA Node",
        "PLE from sys.dm_os_performance_counters per Buffer Node",
        sql="""
            SELECT
                object_name AS numa_node,
                cntr_value  AS ple_sec
            FROM sys.dm_os_performance_counters
            WHERE counter_name = 'Page life expectancy'
              AND object_name LIKE '%Buffer Node%'
            ORDER BY object_name
        """,
        ai_hints=...,
    }
```

Đăng ký vào `memory.yaml` optional_tools:
```yaml
optional_tools:
  - get_ple_numa        # ← thêm mới
  - get_memory_grant
  - get_resource_governor_stats
  - get_query_stats
  - get_wait_stats
```

---

## Layer 3 — Việc cần làm

### Task L3-1: Hiển thị PLE trong Finding row

PLE finding có `issue_type = "memory_pressure"` và `topic_id = "tempdb_memory"`.
Khi user click vào finding này trong dashboard, modal detail cần hiển thị rõ:
- `ple_sec` với màu theo severity (đỏ critical / vàng warning)
- `threshold_warning` và `threshold_critical` để user hiểu ngưỡng
- NUMA info nếu có (`numa_node`)

**File cần xem xét:**
- `layer3/apps/web-v2/src/components/dashboard/FindingRow/` — xem row nào handle `tempdb_memory`
- `layer3/apps/web-v2/src/components/dashboard/modals/` — modal detail

---

### Task L3-2: Metric card PLE trong KpiCards (tùy chọn)

Nếu muốn hiển thị PLE nổi bật trên dashboard:
- Thêm 1 card "Buffer Health" hiển thị PLE hiện tại (lấy từ finding gần nhất của topic `tempdb_memory`)
- Color coding: xanh (≥ warning threshold) / vàng / đỏ

**Đây là enhancement, không blocking.**

---

## Thứ tự thực thi

```
Priority 1 — Fix bug (30 phút):
  └─ L1-1: Fix lower_is_worse_fields trong seed_topics.py
           Update document trực tiếp trong MongoDB nếu đã seed rồi

Priority 2 — Cải thiện threshold (15 phút):
  └─ L1-4: Đổi warning=1800, critical=300

Priority 3 — Thêm NUMA monitoring (1 giờ):
  └─ L1-2: Thêm query ple_numa vào topic
  └─ L2-2: Thêm get_ple_numa capture tool

Priority 4 — Cải thiện AI skill (30 phút):
  └─ L2-1: Bổ sung PLE guidance vào memory.yaml

Priority 5 — Trend detection (2 giờ):
  └─ L1-3: Topic ple_trend với baseline detector

Priority 6 — UI (1-2 giờ):
  └─ L3-1: Hiển thị PLE rõ trong finding modal
  └─ L3-2: PLE metric card (optional)
```

---

## Verification sau mỗi bước

| Task | Cách verify |
|---|---|
| L1-1 bug fix | Seed lại topic, chạy với PLE thấp giả lập → finding CRITICAL xuất hiện |
| L1-2 NUMA | Query `sys.dm_os_performance_counters LIKE '%Buffer Node%'` trả về đúng per node |
| L1-4 threshold | MongoDB `monitor_topics.tempdb_memory.thresholds.ple_sec` = `{warning: 1800, critical: 300}` |
| L2-1 skill | Gọi `/analyze` với `memory_pressure` finding → response đề cập PLE formula và NUMA |
| L2-2 tool | Tool `get_ple_numa` xuất hiện trong Layer 2 tool registry |
| L3-1 UI | Mở finding modal `tempdb_memory` → thấy `ple_sec` hiển thị rõ với màu severity |

---

## MongoDB update nhanh (nếu đã seed, không muốn re-seed)

```js
// Fix bug lower_is_worse_fields
db.monitor_topics.updateOne(
  { topic_id: "tempdb_memory" },
  { $rename: { "extra.lower_is_worse": "extra.lower_is_worse_fields" } }
)

// Fix threshold
db.monitor_topics.updateOne(
  { topic_id: "tempdb_memory" },
  { $set: {
      "thresholds.ple_sec.warning": 1800,
      "thresholds.ple_sec.critical": 300
  }}
)
```

Thay đổi MongoDB có hiệu lực ngay lần chạy job kế tiếp — không cần restart service.
