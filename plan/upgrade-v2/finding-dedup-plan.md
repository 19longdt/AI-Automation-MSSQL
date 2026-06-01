# Plan: Finding Deduplication — Grouped Recommendations

## Vấn đề

Nhiều findings có cùng `type` sinh ra **recommendation giống hệt nhau**,
chỉ khác `description` (tên bảng, index, column cụ thể). Ví dụ điển hình:

```
[WARNING] stale_statistics
  Description: Statistics idx_rs_inoutward_detail_fromWarehouseId trên dbo.rs_inoutward_detail có 170272 lần thay đổi
  Recommendation: Cập nhật statistics: UPDATE STATISTICS dbo.rs_inoutward_detail idx_rs_inoutward_detail_fromWarehouseId WITH FULLSCAN...

[WARNING] stale_statistics
  Description: Statistics _WA_Sys_00000003_71D1E811 trên dbo.rs_inoutward có 11193 lần thay đổi
  Recommendation: Cập nhật statistics: UPDATE STATISTICS dbo.rs_inoutward _WA_Sys_00000003_71D1E811 WITH FULLSCAN...   ← GIỐNG HỆT

[WARNING] stale_statistics
  Description: Statistics idx_id trên dbo.rs_inoutward_detail có 170397 lần thay đổi
  Recommendation: Cập nhật statistics: UPDATE STATISTICS dbo.rs_inoutward_detail idx_id WITH FULLSCAN...              ← GIỐNG HỆT
```

Kết quả: DBA phải đọc recommendation lặp lại 12–16 lần trong cùng một analysis.
AI Agent cũng nhận context dư thừa tốn tokens.

---

## Phân tích các loại finding dễ bị trùng

| Analyzer | Type | Trùng recommendation? | Trùng DDL pattern? |
|---|---|---|---|
| statistics_analyzer | `stale_statistics` | ✅ giống hệt | ✅ chỉ khác tên table/statistic |
| statistics_analyzer | `low_sampling` | ✅ giống hệt | ❌ không có DDL |
| operator_analyzer | `key_lookup` | ✅ giống hệt | ✅ chỉ khác tên index |
| operator_analyzer | `rid_lookup` | ✅ giống hệt | ❌ không có DDL |
| operator_analyzer | `scan_with_predicate` | ✅ giống hệt | ❌ không có DDL |
| operator_analyzer | `sort_expensive` | ✅ giống hệt | ❌ không có DDL |
| index_analyzer | `missing_index` | ✅ giống hệt | ✅ chỉ khác CREATE INDEX DDL |
| memory_analyzer | `memory_large_grant` | ✅ giống hệt | ❌ |
| code_pattern_analyzer | `scalar_udf` | ✅ giống hệt | ❌ |

---

## Design options

### Option A — Grouping ở UI (render-time, không đổi model)

Trong `_buildWarningsSection()`, nhóm findings theo `(type, recommendation)`.
Hiển thị recommendation **một lần** cho group, list descriptions bên trong.

**Ưu:** Không thay đổi Python/TypeScript model, ít rủi ro.  
**Nhược:** AI Agent vẫn nhận findings lặp lại trong context → tốn tokens không cần thiết.
Plan XML analyzer cũng vẫn trả JSON dư thừa về client.

---

### Option B — Grouped model (Python + TypeScript + UI + AI) ← **Đề xuất**

Thêm `FindingGroup` vào model layer, giữ `findings` flat list cho backward compat.

```
StatementResult
  ├── findings: list[Finding]          ← giữ nguyên, backward compat
  └── finding_groups: list[FindingGroup]  ← MỚI, dùng cho UI + AI
```

Mỗi `FindingGroup`:
```python
class FindingGroup(BaseModel):
    severity: Severity
    category: str
    type: str
    recommendation: str          # chung cho cả group
    shared_action: Action | None # action/DDL pattern chung (nếu có)
    instances: list[FindingInstance]  # mỗi instance = 1 description + DDL riêng
    count: int

class FindingInstance(BaseModel):
    description: str
    action: Action | None = None  # DDL riêng nếu khác nhau
```

Service layer group findings theo `(type, recommendation)`.

**Ưu:**
- UI sạch hơn — recommendation 1 lần per type
- AI context ngắn hơn — không lặp recommendation
- Số thực tế (count) rõ ràng hơn trong summary

**Nhược:** Thêm model class, thêm TypeScript interface, thêm service logic.

---

### Option C — Dedup recommendation trong Finding

Giữ `Finding` nhưng thêm flag `is_duplicate_recommendation: bool`.
Recommendation chỉ render khi `is_duplicate_recommendation = False`.

**Ưu:** Ít thay đổi nhất.  
**Nhược:** Logic phức tạp hơn, không giải quyết được AI context repetition.

---

## Phương án chọn: Option B

Lý do:
1. **UI và AI nhất quán** — cùng dùng `finding_groups`
2. **Backward compat** — `findings` flat list vẫn giữ cho các consumer khác
3. **Clean data** — AI nhận structured groups, không phải parse repetition
4. **Count rõ ràng** — "stale_statistics: 12 instances" thay vì 12 cards riêng biệt

---

## Chi tiết thiết kế

### 1. Python model (`result.py`)

```python
class FindingInstance(BaseModel):
    description: str
    action: Action | None = None

class FindingGroup(BaseModel):
    severity: Severity
    category: str
    type: str
    recommendation: str
    shared_action: Action | None = None  # DDL/action chung toàn group
    instances: list[FindingInstance] = Field(default_factory=list)
    count: int = 0
```

`StatementResult` thêm field:
```python
finding_groups: list[FindingGroup] = Field(default_factory=list)
```

---

### 2. Python service (`service.py`)

Thêm `_build_finding_groups()`:
```python
def _build_finding_groups(self, findings: list[Finding]) -> list[FindingGroup]:
    from collections import defaultdict
    groups: dict[tuple, FindingGroup] = {}
    for f in findings:
        key = (f.type, f.recommendation)
        if key not in groups:
            groups[key] = FindingGroup(
                severity=f.severity,
                category=f.category,
                type=f.type,
                recommendation=f.recommendation,
                shared_action=f.action,  # lấy từ instance đầu tiên
            )
        group = groups[key]
        group.instances.append(FindingInstance(
            description=f.description,
            action=f.action if f.action != group.shared_action else None
        ))
        group.count = len(group.instances)
    # Sort: critical trước, rồi theo count giảm dần
    return sorted(
        groups.values(),
        key=lambda g: (0 if g.severity == Severity.CRITICAL else 1 if g.severity == Severity.WARNING else 2, -g.count)
    )
```

---

### 3. TypeScript types (`plan-analysis.ts`)

```typescript
export interface FindingInstance {
  description: string;
  action: PlanAction | null;
}

export interface FindingGroup {
  severity: PlanSeverity;
  category: string;
  type: string;
  recommendation: string;
  shared_action: PlanAction | null;
  instances: FindingInstance[];
  count: number;
}
```

`StatementResult` thêm:
```typescript
finding_groups: FindingGroup[];
```

---

### 4. Layer 3 UI — `_buildWarningsSection()`

Thiết kế card mới cho `FindingGroup`:

```
┌─────────────────────────────────────────────────────────────┐
│ [WARNING] [STATISTICS]  stale_statistics              ×12  │  ← header: type + count badge
├─────────────────────────────────────────────────────────────┤
│ ▲ STATS: STALE STATISTICS                                   │  ← category label
│ Cập nhật statistics: UPDATE STATISTICS ... WITH FULLSCAN    │  ← recommendation (1 lần)
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ • idx_rs_inoutward_detail_fromWarehouseId — 170272 changes  │  ← instances
│ • _WA_Sys_00000003_71D1E811 — 11193 changes                 │
│ • idx_id — 170397 changes                                   │
│   [Copy DDL]  UPDATE STATISTICS ...                         │  ← shared DDL (nếu có)
└─────────────────────────────────────────────────────────────┘
```

**Trường hợp count = 1**: giữ nguyên layout cũ (không có instance list).

---

### 5. Layer 2 AI Agent context

Trong `DiagnosticExecutor.plan_analyzer` khi build context cho Claude,
thay vì stringify từng finding, dùng `finding_groups`:

```
WARNINGS (12 findings, 4 types):
- stale_statistics ×8 [WARNING]: UPDATE STATISTICS WITH FULLSCAN
  Affected: idx_rs_inoutward_detail_fromWarehouseId, _WA_Sys_00000003_71D1E811, idx_id...
- key_lookup ×3 [WARNING]: INCLUDE thêm cột vào nonclustered index
  Affected: PK_rs_inoutward (3 instances)
- sort_expensive ×1 [WARNING]: Xem xét index theo ORDER BY...
```

Giảm ~60–70% token cho findings section khi có nhiều stale stats.

---

## Trình tự implement

- [ ] **Bước 1 — Python model** (`result.py`): Thêm `FindingInstance`, `FindingGroup`
- [ ] **Bước 2 — Python service** (`service.py`): Thêm `_build_finding_groups()`, gán vào `StatementResult`
- [ ] **Bước 3 — TypeScript types** (`plan-analysis.ts`): Thêm `FindingInstance`, `FindingGroup`, update `StatementResult`
- [ ] **Bước 4 — Layer 3 UI** (`plan-analysis-component.ts`): Đổi `_buildWarningsSection()` dùng `finding_groups`
- [ ] **Bước 5 — Layer 2 AI context**: Update `plan_analyzer.py` format findings cho Claude
- [ ] **Bước 6 — Build + test**: Build layer3, verify UI với finding có nhiều instances

---

## Rủi ro

| Rủi ro | Mức độ | Giải pháp |
|---|---|---|
| `finding_groups` empty nếu `findings` cũng empty | Thấp | Service đảm bảo cả hai đồng bộ |
| Group key quá strict — same type nhưng recommendation khác vì dynamic table name | Trung bình | Group theo `type` only (không include recommendation trong key), recommendation lấy từ instance đầu tiên |
| AI Agent đang dùng `findings` flat list | Thấp | Giữ `findings` không thay đổi, chỉ thêm `finding_groups` |

**Lưu ý về group key:** Nếu dùng `(type, recommendation)` làm key thì `stale_statistics`
sẽ bị split thành nhiều groups vì recommendation embed tên table. Nên dùng `type` only làm key.

---

## Kết luận

Option B với group key = `type` là phương án tốt nhất:
- UI: recommendation 1 lần per type, instances list compact
- AI: context ngắn hơn, structured hơn
- Backward compat: `findings` flat không thay đổi
- Effort: ~1–2h implement (không phức tạp)
