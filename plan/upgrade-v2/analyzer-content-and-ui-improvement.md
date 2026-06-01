# Plan: Analyzer Content & UI Improvement

**Scope:** Layer 2 analyzer content fix + Layer 3 UI redesign  
**Branch:** `feature/layer2`  
**Liên quan:** `layer2-analyze.md`, `layer3-plan-analyze.md`

---

## Tổng quan vấn đề

| Vấn đề | Vị trí | Mức độ |
|---|---|---|
| Ký tự `?` thay cho dấu tiếng Việt | `layer2/plan/analyzers/*.py` | BLOCKER |
| Description/recommendation tiếng Anh, vắn tắt | 3 file analyzer | MEDIUM |
| `plan-analysis.css` hardcode hex color, không hỗ trợ dark mode | `layer3/apps/web/css/plan-analysis.css` | HIGH |
| Chuỗi tiếng Việt bị mojibake trong HTML script block | `layer3/apps/web/pages/query-plan.html` | LOW |
| Visualization thiếu bar chart, badge, progress bar | `layer3` PlanAnalysisComponent | HIGH |
| Không có keyword glossary / tooltip `?` | Layer 3 | MEDIUM |

---

## Phase 1 — Fix nội dung Layer 2 Analyzer

### 1.1 — Danh sách file cần sửa `?` → ký tự tiếng Việt đúng

Nguyên nhân: developer dùng editor không hỗ trợ Unicode, gõ `?` thay cho ký tự có dấu.  
Giải pháp: rewrite toàn bộ chuỗi recommendation/description bị lỗi.

---

#### `compilation_analyzer.py`

| Finding type | Description (mới — VI) | Recommendation (mới — VI) | Severity | Ngưỡng |
|---|---|---|---|---|
| `high_compile_cpu` | `Compile CPU cao: {compile_cpu_ms}ms — optimizer tốn nhiều tài nguyên để chọn plan.` | `Rà độ phức tạp query: giảm số bảng join, đơn giản hóa predicate, cân nhắc tách truy vấn lớn thành nhiều bước nhỏ.` | WARNING > 1000ms, CRITICAL > 5000ms | compile_cpu_ms > 1000 |
| `compile_memory_exceeded` | `Optimizer dừng sớm (early abort) do vượt giới hạn bộ nhớ trong quá trình tối ưu hóa — plan có thể không tối ưu.` | `Giảm độ phức tạp query: bỏ bớt join không cần thiết, rà biểu thức ORDER BY/GROUP BY, kiểm tra view nesting sâu.` | CRITICAL | early_abort_reason == "MemoryLimitExceeded" |
| `ce_model_legacy` | `Cardinality Estimation model 70 (SQL Server 2012 legacy) — ước lượng số hàng có thể kém chính xác với dữ liệu hiện đại.` | `Đánh giá tác động khi nâng compatibility level lên 150 (SQL 2019 CE). Dùng Query Store để so sánh plan trước/sau.` | INFO | ce_model_version == 70 |

---

#### `operator_analyzer.py`

| Finding type | Description (mới — VI) | Recommendation (mới — VI) | Severity | Ngưỡng / Công thức |
|---|---|---|---|---|
| `key_lookup` | `Key Lookup tại NodeId={node_id}, bảng={table_name} — SQL Server đọc thêm cột ngoài index dẫn đến 2 lần I/O.` | `Tạo covering index bằng cách INCLUDE các cột được truy xuất thêm vào index hiện tại, tránh lookup.` | CRITICAL | physical_op == "Key Lookup" |
| `rid_lookup` | `RID Lookup tại NodeId={node_id} — bảng dạng heap (không có clustered index), SQL đọc thêm cột qua RowID.` | `Cân nhắc tạo clustered index cho heap table để loại bỏ RID Lookup và giảm I/O.` | WARNING | physical_op == "RID Lookup" |
| `sort_expensive` | `Sort chiếm khoảng {pct:.0%} estimated cost — operation sort tốn kém, dữ liệu chưa được sắp xếp sẵn.` | `Xem xét index theo ORDER BY/GROUP BY để dữ liệu đọc ra đã có thứ tự, loại bỏ Sort operation.` | WARNING | node_cost / total_cost > 0.2 |
| `scan_with_predicate` | `{op} với predicate tại NodeId={node_id} — scan toàn bộ index/bảng rồi lọc, thay vì seek trực tiếp vào dòng cần.` | `Đánh giá lại index và selectivity: tạo index phù hợp để chuyển từ Scan sang Seek khi predicate có selectivity cao.` | WARNING | op in (Scan ops) AND predicate không rỗng |
| `row_estimate_mismatch` | `Row estimate mismatch tại NodeId={node_id}: ước lượng {est} hàng nhưng thực tế {act} hàng (ratio={ratio:.2f}).` | `Kiểm tra statistics (UPDATE STATISTICS), xem xét parameter sniffing, implicit type conversion.` | WARNING | ratio ≥ 10× hoặc ≤ 0.1× |
| `spill_to_tempdb` | `SpillToTempDb tại NodeId={node_id} ({physical_op}) — bộ nhớ không đủ, dữ liệu tràn ra đĩa (TempDB).` | `Tối ưu row estimate và memory grant: sửa statistics, kiểm tra Sort/Hash spill path, tăng query memory nếu cần.` | CRITICAL | warnings có SpillToTempDb |
| `non_sargable_implicit` | `CONVERT_IMPLICIT tại NodeId={node_id} — SQL Server ép kiểu dữ liệu ngầm, không thể dùng index seek.` | `Đồng bộ kiểu dữ liệu giữa parameter và cột (tránh VARCHAR vs NVARCHAR, INT vs BIGINT) để index seek hoạt động.` | WARNING | predicate chứa CONVERT_IMPLICIT |

---

#### `memory_analyzer.py`

| Finding type | Description (mới — VI) | Recommendation (mới — VI) | Severity | Ngưỡng / Công thức |
|---|---|---|---|---|
| `memory_spill_risk` | `Memory grant gần tràn: dùng {max_used_kb}KB / cấp {granted_kb}KB ({pct:.0%}) — nguy cơ spill sang TempDB.` | `Rà lại row estimate và statistics cho các operator Sort/Hash. Nếu spill xảy ra, tăng memory grant hoặc sửa plan.` | WARNING | max_used_kb ≥ 90% granted_kb |
| `memory_wasted_grant` | `Memory grant overestimate: chỉ dùng {max_used_kb}KB / cấp {granted_kb}KB ({pct:.0%}) — lãng phí workspace memory.` | `Kiểm tra statistics và cardinality: estimate hàng quá cao dẫn đến grant thừa. Sửa stats để cấp đúng mức cần.` | WARNING | max_used_kb < 50% granted_kb |
| `memory_grant_wait` | `Memory grant wait {grant_wait_ms}ms — query phải chờ để được cấp bộ nhớ, có thể do server memory pressure.` | `Server đang dưới áp lực memory: tối ưu query nặng memory, xem xét điều chỉnh max server memory hoặc resource pool.` | WARNING > 0ms, CRITICAL ≥ 5000ms | grant_wait_ms > 0 |
| `memory_large_grant` | `Large memory grant: {granted_kb//1024}MB được cấp — query chiếm lượng lớn workspace memory.` | `Xem plan shape (Sort/Hash nhiều không), ước lượng hàng có chính xác không. Grant lớn có thể chèn ép query khác.` | WARNING ≥ 1GB, CRITICAL ≥ 4GB | granted_kb ≥ 1024*1024 |

---

#### `parallelism_analyzer.py`

| Finding type | Description (mới — VI) | Recommendation (mới — VI) | Severity | Ngưỡng / Công thức |
|---|---|---|---|---|
| `serial_plan_actionable` | `Plan serial (DOP=1) do {non_parallel_reason} — query có chi phí lớn nhưng chạy đơn luồng.` | `Rà MAXDOP setting, UDF inline-able không, table variable có thể đổi sang temp table, loại bỏ non_parallel_reason.` | WARNING | total_cost ≥ 1 AND dop ≤ 1 AND reason không phải auto |
| `serial_plan_passive` | `Plan serial do {non_parallel_reason} — đây là hành vi bình thường theo thiết kế.` | `Không cần can thiệp; lý do serial là policy (DOP=1 ước lượng) hoặc edition.` | INFO | reason in (EstimatedDOPIsOne, ...) |
| `ineffective_parallelism` | `Hiệu quả song song thấp: {efficiency:.1f}% (DOP={dop}) — CPU/elapsed ratio cho thấy các thread không đồng đều.` | `Kiểm tra skew data (một thread gánh quá nhiều hàng), chờ CXPACKET. Cân nhắc giảm DOP hoặc đổi plan shape.` | WARNING | efficiency < 40% — công thức: `(cpu_time/elapsed_time − 1) / (dop − 1) × 100` |

**Công thức parallel efficiency:**
```
speedup = cpu_time_ms / elapsed_time_ms
efficiency = (speedup - 1) / (dop - 1) × 100%

Ngưỡng:
  efficiency ≥ 70%  → tốt
  40% ≤ eff < 70%   → cần theo dõi
  eff < 40%         → WARNING — không hiệu quả
```

---

#### `statistics_analyzer.py`

| Finding type | Description (mới — VI) | Recommendation (mới — VI) | Severity | Ngưỡng |
|---|---|---|---|---|
| `stale_statistics` | `Statistics {statistic} trên {table} có {modification_count} lần thay đổi kể từ lần cập nhật cuối — ước lượng hàng có thể sai.` | `Cập nhật statistics: `UPDATE STATISTICS {table} {statistic} WITH FULLSCAN;` Đặt lịch maintenance hoặc bật auto_update_stats_async.` | WARNING | modification_count > 10000 |
| `low_sampling` | `Sampling thấp ({sampling_percent:.0f}%) cho statistics {statistic} — ước lượng cardinality kém chính xác với dữ liệu lệch.` | `Cân nhắc `UPDATE STATISTICS WITH FULLSCAN` cho bảng lớn hoặc phân bố lệch để tăng chất lượng statistics.` | INFO | sampling_percent < 20% |
| `never_updated_statistics` | `Statistics {statistic} chưa từng được cập nhật (LastUpdate = NULL) — cardinality estimate dựa trên số liệu rất cũ hoặc mặc định.` | `Chạy `UPDATE STATISTICS {table};` ngay. Kiểm tra auto_update_statistics có bật không.` | WARNING | last_update is None |

---

#### `wait_analyzer.py`

| Finding type | Wait type | Description (mới — VI) | Recommendation (mới — VI) |
|---|---|---|---|
| `wait_blocking` | `LCK_M_*` | `Lock wait {wt}: {wait_ms}ms / {count} lần — query bị block bởi transaction giữ lock.` | `Kiểm tra blocking chain: query nào đang giữ lock, transaction có được commit/rollback đúng lúc không.` |
| `wait_disk_io` | `PAGEIOLATCH_*` | `I/O latch wait {wt}: {wait_ms}ms / {count} lần — SQL Server đợi trang dữ liệu load từ đĩa vào buffer pool.` | `Kiểm tra I/O latency (disk health), cache warmup, index/selectivity để giảm physical reads.` |
| `wait_parallelism` | `CXPACKET`, `CXCONSUMER` | `Parallelism wait {wt}: {wait_ms}ms / {count} lần — thread phụ đợi thread chính hoặc ngược lại.` | `Đánh giá data skew (một partition gánh nhiều hàng hơn), kiểm tra MAXDOP và COST THRESHOLD FOR PARALLELISM.` |
| `wait_memory` | `RESOURCE_SEMAPHORE` | `Memory semaphore wait: {wait_ms}ms / {count} lần — query chờ cấp memory grant vì server đang áp lực.` | `Tối ưu query nặng memory, xem xét điều chỉnh max server memory, Resource Governor memory limit.` |
| `wait_cpu` | `SOS_SCHEDULER_YIELD` | `CPU scheduler yield: {wait_ms}ms / {count} lần — thread nhường CPU cho scheduler, có thể do CPU pressure.` | `Xem top CPU queries, kiểm tra plan quality (missing stats → bad plan → loop scan), tăng phần cứng nếu cần.` |

---

#### `index_analyzer.py` — Hiện đang tiếng Anh, cần dịch + làm rõ

| Finding type | Description (mới — VI) | Recommendation (mới — VI) |
|---|---|---|
| `missing_index` | `Gợi ý index bị thiếu cho {table} — SQL Server ước tính impact {impact:.1f}% nếu có index này.` | `Đánh giá workload trước khi tạo: index mới có hữu ích cho nhiều query không? Tránh tạo quá nhiều index (over-indexing) làm chậm INSERT/UPDATE.` |
| `wide_index_suggestion` | `Gợi ý index rộng trên {table}: {key_cols} key columns, {include_cols} INCLUDE columns.` | `Cân bằng lợi ích đọc và chi phí bảo trì: index rộng tốn nhiều bộ nhớ và làm chậm write operation.` |

---

#### `code_pattern_analyzer.py` — Hiện đang tiếng Anh

| Finding type | Description (mới — VI) | Recommendation (mới — VI) |
|---|---|---|
| `scalar_udf` | `Scalar UDF tại NodeId={node_id} — hàm UDF vô hướng chạy tuần tự từng hàng, không thể song song hóa.` | `Viết lại dưới dạng inline Table-Valued Function (iTVF) hoặc set-based logic để SQL Server có thể tối ưu và song song hóa.` |
| `row_goal` | `Row goal active tại NodeId={node_id} — optimizer chọn plan tối ưu cho N hàng đầu, nhưng có thể kém hiệu quả khi cần nhiều hơn.` | `Kiểm tra TOP/EXISTS/FAST N hint: nếu thực tế lấy nhiều hàng hơn dự kiến, row goal plan sẽ scan nhiều hơn cần.` |

---

### 1.2 — Thông số và công thức cần hiển thị trong output

Với mỗi finding hiển thị thêm context dạng bảng nhỏ trong description:

**Operator findings — thêm metric summary:**
```
Sort #3 | Cost: 40.19 | 100.0% of total | Est rows: 1 → Act rows: 241,800
```

**Memory findings — thêm usage bar context:**
```
Granted: 2,048 MB | Used: 1,843 MB (89.9%) | Wait: 0ms
```

**Parallelism — thêm efficiency formula:**
```
DOP: 8 | CPU: 4,200ms | Elapsed: 980ms | Efficiency: (4.28-1)/(8-1)×100 = 46.9%
```

---

## Phase 2 — Fix Layer 3 `plan-analysis.css` → CSS variables

Hiện tại toàn bộ file dùng hardcode hex. File `base.css` đã định nghĩa đủ CSS variables cho light/dark mode.

### Mapping hex → CSS variable

| Hex hiện tại | CSS variable | Dùng cho |
|---|---|---|
| `#1e293b` | `var(--color-text)` | text chính |
| `#64748b`, `#6b7280`, `#475569` | `var(--color-muted)` | text phụ, label |
| `#f8fafc`, `#f1f5f9` | `var(--color-surface-soft)` | background card, header |
| `#ffffff` | `var(--color-surface)` | background chính |
| `#e5e7eb`, `#e2e8f0`, `#cbd5e1` | `var(--color-border)` | đường viền |
| `#dc2626` | `var(--color-danger)` | text màu đỏ (critical) |
| `#fee2e2` | `var(--color-danger-soft)` | background badge critical |
| `#d97706` | `var(--color-warning)` | text màu vàng (warning) |
| `#fef3c7` | `var(--color-warning-soft)` | background badge warning |
| `#2563eb`, `#1e40af` | `var(--color-primary)` | text màu xanh, tab active |
| `#dbeafe` | `var(--color-primary-soft)` | background badge info, tab active bg |
| `#16a34a` | `var(--color-success)` | bar ok, actual badge text |
| `#dcfce7` | `var(--color-success-soft)` | actual badge background |
| `#0f172a` | `var(--color-text)` (dark mode base) | DDL code block background → cần custom var |

### Thêm CSS variables cho code block trong `base.css`

```css
:root {
  --color-code-bg: #0f172a;
  --color-code-text: #e2e8f0;
  --color-code-border: #334155;
}
:root[data-theme="dark"] {
  --color-code-bg: #07111e;
  --color-code-text: #cbd5e1;
  --color-code-border: #243856;
}
```

### Dark mode additions cần trong `plan-analysis.css`

```css
/* Thêm các rule dark-specific */
:root[data-theme="dark"] .pa-ddl { background: var(--color-code-bg); color: var(--color-code-text); }
:root[data-theme="dark"] .pa-table th { background: var(--color-surface-soft); }
:root[data-theme="dark"] .pa-bar-wrap { background: var(--color-border); }
```

---

## Phase 3 — Layer 2: Bổ sung dữ liệu cho UI mới

### 3.0 — Đánh giá vấn đề hiện tại

**image7** (UI đang chạy) cho thấy:
- Flat list cards — stale_statistics xuất hiện 4–5 lần cùng format, không có hierarchy
- Không có section "TOP EXPENSIVE OPERATIONS" (thiếu hoàn toàn)
- Tab "Operators" chỉ là bar chart đơn giản, không có rank/type/row est off flags
- Không có "JOIN TYPES & OPERATIONS" summary
- Không có "COMPILATION & SETTINGS" section

**Nguyên nhân từ Layer 2:**

| Vấn đề | Root cause |
|---|---|
| `io_stats` group by table, không phải per-operator | `_build_io_summary` dùng `table_name` làm key |
| `OperatorSummary` thiếu op_type_tag, has_row_est_off, has_spill | fields chưa extract |
| Không có JOIN TYPES summary | chưa có `_build_join_types` |
| Không có COMPILATION section data | data có trong stmt nhưng không expose riêng |
| TypeScript `StatementResult` thiếu `statistics`, `io_stats` | chưa định nghĩa trong plan-analysis.ts |

---

### 3.1 — Extend `OperatorSummary` (`result.py`)

```python
class OperatorSummary(BaseModel):
    node_id: int
    physical_op: str
    logical_op: str
    op_type_tag: str = "OTHER"          # NEW: "SORT"|"AGG"|"JOIN"|"HASH"|"SEEK"|"SCAN"|"PARALLEL"|"OTHER"
    cost: float = 0.0                   # NEW: estimated_cost giá trị tuyệt đối
    cost_pct: float = 0.0
    estimated_rows: float = 0.0
    actual_rows: float | None = None
    actual_elapsed_ms: float | None = None
    actual_logical_reads: float | None = None
    actual_physical_reads: float | None = None  # NEW
    read_ahead_reads: float | None = None        # NEW
    scan_count: float | None = None             # NEW
    has_row_est_off: bool = False               # NEW: actual/est ratio ≥ 10× hoặc ≤ 0.1×
    has_spill: bool = False                     # NEW: node.warnings chứa SpillToTempDb
    table_name: str | None = None               # NEW: cho "Index Seek: [table] → [index]"
    index_name: str | None = None               # NEW
```

**Mapping `physical_op` → `op_type_tag`** (thêm helper trong `service.py`):
```python
_OP_TAG: dict[str, str] = {
    "Sort": "SORT",
    "Hash Match": "HASH",
    "Merge Join": "JOIN",
    "Nested Loops": "JOIN",
    "Parallelism": "PARALLEL",
    "Stream Aggregate": "AGG",
    "Compute Scalar": "AGG",
    "Index Seek": "SEEK",
    "Clustered Index Seek": "SEEK",
    "Index Scan": "SCAN",
    "Clustered Index Scan": "SCAN",
    "Table Scan": "SCAN",
    "Key Lookup": "SEEK",
    "RID Lookup": "SEEK",
}

def _op_type_tag(self, physical_op: str) -> str:
    return self._OP_TAG.get(physical_op, "OTHER")

def _has_row_est_off(self, node: PlanNode) -> bool:
    if node.actual_rows is None or node.estimate_rows <= 0:
        return False
    ratio = node.actual_rows / node.estimate_rows
    return ratio >= 10 or ratio <= 0.1
```

---

### 3.2 — Thêm `JoinTypesSummary` và `CompilationInfo` (`result.py`)

```python
class JoinTypesSummary(BaseModel):
    nested_loops: int = 0
    hash_match: int = 0
    merge_join: int = 0
    sort_count: int = 0
    parallelism_count: int = 0
    spill_count: int = 0      # nodes có warning SpillToTempDb
    total_operators: int = 0

class CompilationInfo(BaseModel):
    statement_type: str = ""
    total_cost: float = 0.0
    dop: int = 0
    non_parallel_reason: str | None = None
    compile_cpu_ms: int = 0
    compile_memory_kb: int = 0
    ce_model_version: int = 0
    optm_level: str | None = None
    cached_plan_size_kb: int = 0
    query_hash: str | None = None
    query_plan_hash: str | None = None
```

---

### 3.3 — Sửa `StatementResult` (`result.py`)

```python
class StatementResult(BaseModel):
    statement_text: str
    statement_type: str
    total_cost: float
    dop: int
    has_actual_stats: bool
    ce_model_version: int
    query_hash: str | None = None
    query_plan_hash: str | None = None
    findings: list[Finding] = Field(default_factory=list)
    critical_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    top_operators: list[OperatorSummary] = Field(default_factory=list)  # by cost %
    io_stats: list[OperatorSummary] = Field(default_factory=list)       # by logical reads (per-operator)
    missing_indexes: list[IndexSuggestion] = Field(default_factory=list)
    memory_grant: MemoryGrantSummary | None = None
    parameters: list[ParameterInfo] = Field(default_factory=list)
    wait_stats: list[WaitStatSummary] = Field(default_factory=list)
    statistics: list[StatsSummary] = Field(default_factory=list)
    join_types: JoinTypesSummary = Field(default_factory=JoinTypesSummary)  # NEW
    compilation: CompilationInfo = Field(default_factory=CompilationInfo)   # NEW
```

---

### 3.4 — Sửa `service.py`

**`_build_top_operators`** — thêm fields mới:
```python
def _build_top_operators(self, stmt: ParsedStatement) -> list[OperatorSummary]:
    nodes = self._flatten(stmt.root_node)
    total_cost = stmt.total_cost if stmt.total_cost > 0 else 1.0
    top = sorted(nodes, key=lambda n: n.estimated_cost, reverse=True)[:10]
    return [
        OperatorSummary(
            node_id=n.node_id,
            physical_op=n.physical_op,
            logical_op=n.logical_op,
            op_type_tag=self._op_type_tag(n.physical_op),
            cost=n.estimated_cost,
            cost_pct=(n.estimated_cost / total_cost) * 100,
            estimated_rows=n.estimate_rows,
            actual_rows=n.actual_rows,
            actual_elapsed_ms=n.actual_elapsed_ms,
            actual_logical_reads=n.actual_logical_reads,
            actual_physical_reads=n.actual_physical_reads,
            has_row_est_off=self._has_row_est_off(n),
            has_spill=any(w.name == "SpillToTempDb" for w in n.warnings),
            table_name=n.table_name,
            index_name=n.index_name,
        )
        for n in top
    ]
```

**`_build_io_stats`** — per-operator sorted by logical reads (thay `_build_io_summary` per-table):
```python
def _build_io_stats(self, stmt: ParsedStatement) -> list[OperatorSummary]:
    nodes = self._flatten(stmt.root_node)
    with_reads = [n for n in nodes if (n.actual_logical_reads or 0) > 0]
    top = sorted(with_reads, key=lambda n: n.actual_logical_reads or 0, reverse=True)[:15]
    total_cost = stmt.total_cost if stmt.total_cost > 0 else 1.0
    return [
        OperatorSummary(
            node_id=n.node_id,
            physical_op=n.physical_op,
            logical_op=n.logical_op,
            op_type_tag=self._op_type_tag(n.physical_op),
            cost=n.estimated_cost,
            cost_pct=(n.estimated_cost / total_cost) * 100,
            estimated_rows=n.estimate_rows,
            actual_rows=n.actual_rows,
            actual_logical_reads=n.actual_logical_reads,
            actual_physical_reads=n.actual_physical_reads,
            table_name=n.table_name,
            index_name=n.index_name,
        )
        for n in top
    ]
```

**`_build_join_types`** — mới:
```python
def _build_join_types(self, stmt: ParsedStatement) -> JoinTypesSummary:
    nodes = self._flatten(stmt.root_node)
    s = JoinTypesSummary(total_operators=len(nodes))
    for n in nodes:
        op = n.physical_op
        if op == "Nested Loops":  s.nested_loops += 1
        elif op == "Hash Match":  s.hash_match += 1
        elif op == "Merge Join":  s.merge_join += 1
        elif op == "Sort":        s.sort_count += 1
        elif op == "Parallelism": s.parallelism_count += 1
        if any(w.name == "SpillToTempDb" for w in n.warnings):
            s.spill_count += 1
    return s
```

**`_build_compilation`** — mới:
```python
def _build_compilation(self, stmt: ParsedStatement) -> CompilationInfo:
    return CompilationInfo(
        statement_type=stmt.statement_type,
        total_cost=stmt.total_cost,
        dop=stmt.dop,
        non_parallel_reason=stmt.non_parallel_reason,
        compile_cpu_ms=stmt.compile_cpu_ms,
        compile_memory_kb=stmt.compile_memory_kb,
        ce_model_version=stmt.ce_model_version,
        optm_level=stmt.optm_level,
        cached_plan_size_kb=stmt.cached_plan_size_kb,
        query_hash=stmt.query_hash,
        query_plan_hash=stmt.query_plan_hash,
    )
```

Trong `analyze()` thêm 2 build calls:
```python
statement_results.append(StatementResult(
    ...
    io_stats=self._build_io_stats(stmt),           # thay _build_io_summary
    join_types=self._build_join_types(stmt),        # NEW
    compilation=self._build_compilation(stmt),      # NEW
))
```

---

### 3.5 — TypeScript: update `plan-analysis.ts`

```typescript
export interface OperatorSummary {
  node_id: number;
  physical_op: string;
  logical_op: string;
  op_type_tag: string;              // NEW
  cost: number;                     // NEW
  cost_pct: number;
  estimated_rows: number;
  actual_rows: number | null;
  actual_elapsed_ms: number | null;
  actual_logical_reads: number | null;
  actual_physical_reads: number | null;  // NEW
  has_row_est_off: boolean;         // NEW
  has_spill: boolean;               // NEW
  table_name: string | null;        // NEW
  index_name: string | null;        // NEW
}

export interface JoinTypesSummary {
  nested_loops: number;
  hash_match: number;
  merge_join: number;
  sort_count: number;
  parallelism_count: number;
  spill_count: number;
  total_operators: number;
}

export interface CompilationInfo {
  statement_type: string;
  total_cost: number;
  dop: number;
  non_parallel_reason: string | null;
  compile_cpu_ms: number;
  compile_memory_kb: number;
  ce_model_version: number;
  optm_level: string | null;
  cached_plan_size_kb: number;
  query_hash: string | null;
  query_plan_hash: string | null;
}

export interface StatsSummary {
  table: string;
  statistic: string;
  modification_count: number | null;
  sampling_percent: number | null;
  last_update: string | null;
}

export interface StatementResult {
  statement_text: string;
  statement_type: string;
  total_cost: number;
  dop: number;
  has_actual_stats: boolean;
  ce_model_version: number;
  query_hash: string | null;
  query_plan_hash: string | null;
  findings: PlanFinding[];
  critical_count: number;
  warning_count: number;
  info_count: number;
  top_operators: OperatorSummary[];    // sorted by cost %
  io_stats: OperatorSummary[];         // sorted by logical reads, per-operator (NEW replaces IOStatSummary)
  missing_indexes: IndexSuggestion[];
  memory_grant: MemoryGrantSummary | null;
  parameters: ParameterInfo[];
  wait_stats: WaitStatSummary[];
  statistics: StatsSummary[];          // was missing
  join_types: JoinTypesSummary;        // NEW
  compilation: CompilationInfo;        // NEW
}
```

---

## Phase 4 — Layer 3 UI: Tab → Accordion Section

**Vấn đề image7:** Flat list cards, stale_statistics lặp 4+ lần cùng format, không hierarchy, không "Top Expensive Operations", không "Join Types", không "Compilation" — khó scan, không trực quan.

**Thiết kế mới:** Accordion sections (tham khảo image1–image6 mssql.ee).

---

### 4.1 — Layout tổng thể

```
● QUERY TEXT                                               ▲
────────────────────────────────────────────────────────────
● I/O STATISTICS                             [13]          ▲
────────────────────────────────────────────────────────────
● TOP EXPENSIVE OPERATIONS                   [8]           ▲
────────────────────────────────────────────────────────────
● WARNINGS                                   [5]           ▲
────────────────────────────────────────────────────────────
● EST VS ACTUAL ROWS                         [0]           ▲
────────────────────────────────────────────────────────────
● JOIN TYPES & OPERATIONS                    [9]           ▲
────────────────────────────────────────────────────────────
● STATISTICS USED                            [16]          ▲
────────────────────────────────────────────────────────────
● MEMORY GRANT                                             ▲
────────────────────────────────────────────────────────────
● WAIT STATISTICS                            [8]           ▲
────────────────────────────────────────────────────────────
● COMPILATION & SETTINGS                                   ▲
────────────────────────────────────────────────────────────
● MISSING INDEXES                            [1]           ▲
────────────────────────────────────────────────────────────
```

Màu dot:
- 🔴 đỏ: section có critical (WARNINGS nếu spill, MISSING INDEXES nếu có)
- 🟡 vàng: warning level (TOP EXPENSIVE, I/O STATISTICS, STATISTICS USED khi stale)
- 🔵 xanh: informational (COMPILATION, EST VS ACTUAL, QUERY TEXT)
- 🟢 xanh lá: clean (WAIT, MEMORY khi OK)

Default state: các section có dữ liệu critical/warning **mở sẵn**, còn lại collapse.

---

### 4.2 — HTML/CSS: Section accordion

```html
<div class="pa-section [collapsed]">
  <button class="pa-section-header" data-section="teo">
    <span class="pa-section-dot yellow"></span>
    <span class="pa-section-title">TOP EXPENSIVE OPERATIONS</span>
    <span class="pa-section-badge">8</span>
    <span class="pa-section-chevron">▲</span>
  </button>
  <div class="pa-section-body">
    <!-- section content -->
  </div>
</div>
```

```css
.pa-section { border-bottom: 1px solid var(--color-border); }
.pa-section-header {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 10px 14px; background: none; border: none;
  cursor: pointer; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-text); text-align: left;
}
.pa-section-header:hover { background: var(--color-row-hover); }
.pa-section-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pa-section-dot.red    { background: var(--color-danger); }
.pa-section-dot.yellow { background: var(--color-warning); }
.pa-section-dot.blue   { background: var(--color-primary); }
.pa-section-dot.green  { background: var(--color-success); }
.pa-section-title { flex: 1; }
.pa-section-badge {
  font-size: 10px; background: var(--color-surface-soft);
  border: 1px solid var(--color-border); border-radius: 10px;
  padding: 1px 7px; color: var(--color-muted);
}
.pa-section-chevron { color: var(--color-muted); font-size: 10px; transition: transform 0.15s; }
.pa-section-body { padding: 0 14px 14px; }
.pa-section.collapsed .pa-section-body { display: none; }
.pa-section.collapsed .pa-section-chevron { transform: rotate(180deg); }
```

---

### 4.3 — TOP EXPENSIVE OPERATIONS (image3)

Dữ liệu: `stmt.top_operators` (sorted by cost desc, rank = index+1).

```
Sort  [SORT]  ▲ row est off                                            #1
Cost: 40.19  % total: 100.0%  Est rows: 1  Act rows: 241.8K
████████████████████████████████████████████████████████████████ (đỏ, 100%)

Stream Aggregate  [AGG]  ▲ row est off                                 #2
Cost: 40.19  % total: 100.0%  Est rows: 1  Act rows: 241.8K
████████████████████████████████████████████████████████████████ (tím, 100%)

Parallelism  [PARALLEL]  ▲ row est off                                 #3
Cost: 40.18  % total: 99.9%  Est rows: 1  Act rows: 241.8K
████████████████████████████████████████████████████████████████ (xanh lá, 100%)
```

**Màu bar theo op_type_tag:**

| Tag | Màu bar | CSS class |
|---|---|---|
| SORT | `#ef4444` đỏ | `.teo-sort` |
| PARALLEL | `#22c55e` xanh lá | `.teo-parallel` |
| JOIN | `#06b6d4` cyan | `.teo-join` |
| SEEK | `#3b82f6` xanh | `.teo-seek` |
| AGG | `#a855f7` tím | `.teo-agg` |
| HASH | `#f97316` cam | `.teo-hash` |
| SCAN | `#fbbf24` vàng | `.teo-scan` |
| OTHER | `var(--color-muted)` | `.teo-other` |

Dark mode: các màu này đủ contrast trên dark background, không cần override.

CSS:
```css
.pa-teo-row { padding: 10px 0; border-bottom: 1px solid var(--color-border); }
.pa-teo-row:last-child { border-bottom: none; }
.pa-teo-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
.pa-teo-left { display: flex; align-items: center; gap: 6px; }
.pa-teo-name { font-weight: 600; font-size: 13px; }
.pa-teo-flag { font-size: 10px; color: var(--color-warning); }
.pa-teo-rank { font-family: var(--font-code); color: var(--color-muted); font-size: 12px; }
.pa-teo-metrics { font-size: 12px; color: var(--color-muted); margin-bottom: 5px; }
.pa-teo-metrics .val { color: var(--color-text); }
.pa-teo-metrics .val.high { color: var(--color-danger); font-weight: 600; }
.pa-teo-bar-wrap { height: 3px; background: var(--color-border); border-radius: 2px; }
.pa-teo-bar { height: 3px; border-radius: 2px; }
.pa-teo-bar.teo-sort     { background: #ef4444; }
.pa-teo-bar.teo-parallel { background: #22c55e; }
.pa-teo-bar.teo-join     { background: #06b6d4; }
.pa-teo-bar.teo-seek     { background: #3b82f6; }
.pa-teo-bar.teo-agg      { background: #a855f7; }
.pa-teo-bar.teo-hash     { background: #f97316; }
.pa-teo-bar.teo-scan     { background: #fbbf24; }
.pa-teo-bar.teo-other    { background: var(--color-muted); }
```

---

### 4.4 — I/O STATISTICS (image2)

Dữ liệu: `stmt.io_stats` (per-operator, sorted by logical reads desc).

```
Sort  [SORT]  ▲ highest          374.5K log  284 phys  766 RA
              ████████████████████████████████████████████ (đỏ, 100%)

Stream Agg    [AGG]               374.5K log  284 phys  766 RA
              ████████████████████████████████████████████ (đỏ, 100%)

Clustered Index Seek              197.5K log
              █████████████████████              (cam, 52%)
```

Bar màu theo % logical reads:
- ≥ 75% → `var(--color-danger)` đỏ  
- ≥ 40% → `var(--color-warning)` vàng/cam
- ≥ 15% → `#3b82f6` xanh
- < 15% → `var(--color-muted)` xám

Note footer: `ℹ Logical reads = buffer pool 8KB page reads. Physical reads = disk I/O (0 sau warm-up là lý tưởng).`

---

### 4.5 — JOIN TYPES & OPERATIONS (image1 join section)

Dữ liệu: `stmt.join_types`.

```html
<div class="pa-join-chips">
  <span class="pa-jchip join">Nested Loops ×3</span>
  <span class="pa-jchip sort">Sort ×3</span>
  <span class="pa-jchip parallel">Parallelism ×1</span>
  <span class="pa-jchip spill">⚠ Spill to TempDB ×2</span>
</div>
<div class="pa-section-note">⚠ Spills detected — operations exceeded memory grant and wrote to disk.</div>
```

```css
.pa-join-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; }
.pa-jchip { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 12px; }
.pa-jchip.join     { background: var(--color-primary-soft); color: var(--color-primary); }
.pa-jchip.sort     { background: var(--color-danger-soft); color: var(--color-danger); }
.pa-jchip.parallel { background: var(--color-purple-soft); color: var(--color-purple); }
.pa-jchip.spill    { background: var(--color-danger-soft); color: var(--color-danger); border: 1px solid var(--color-danger); }
```

Cần thêm vào `base.css`:
```css
:root {
  --color-purple: #7c3aed;
  --color-purple-soft: #f3e8ff;
}
:root[data-theme="dark"] {
  --color-purple: #c084fc;
  --color-purple-soft: #2e1065;
}
```

---

### 4.6 — STATISTICS USED (image1 statistics section)

Dữ liệu: `stmt.statistics` (table, statistic, modification_count, sampling_percent, last_update).

Table view, highlight stale (modification_count > 10000):
```html
<table class="pa-table pa-stats-table">
  <thead><tr>
    <th>Table</th><th>Statistic</th>
    <th class="num">Modifications</th><th class="num">Sampling</th><th>Last Updated</th>
  </tr></thead>
  <tbody>
    <tr class="stale">  <!-- stale nếu mod_count > 10000 -->
      <td>dbo.rs_inoutward_detail</td>
      <td class="stat-name">idx_rs_inoutward_detail_fromWarehouseId</td>
      <td class="num high">170,272</td>
      <td class="num">100%</td>
      <td class="muted">2024-01-15</td>
    </tr>
  </tbody>
</table>
```

CSS:
```css
.pa-stats-table .stale td { background: var(--color-warning-soft); }
.pa-stats-table .stat-name { font-family: var(--font-code); font-size: 11px; }
```

---

### 4.7 — WARNINGS (image6)

Dữ liệu: findings có type chứa `spill`/`sort_expensive`/`non_sargable`/`scan_with_predicate`/`key_lookup`/`rid_lookup`. Group by warning category.

```html
<div class="pa-warn-group">
  <div class="pa-warn-cat spill">SPILL TO TEMPDB</div>
  <div class="pa-warn-item">
    <strong>Spill level 2</strong>
    <div class="pa-warn-note">💡 Row estimate mismatch gây memory grant quá nhỏ — dữ liệu tràn ra đĩa.</div>
  </div>
</div>
<div class="pa-warn-group">
  <div class="pa-warn-cat perf">PERFORMANCE: EXPENSIVE SORT</div>
  <div class="pa-warn-item">
    <strong>Sort chiếm 100% estimated cost.</strong>
    <div class="pa-warn-note">💡 Tạo index theo ORDER BY/GROUP BY để loại bỏ Sort operation.</div>
  </div>
</div>
```

```css
.pa-warn-group { border-left: 3px solid var(--color-border); padding: 8px 0 8px 12px; margin-bottom: 10px; }
.pa-warn-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.pa-warn-cat.spill    { color: var(--color-danger); }
.pa-warn-cat.perf     { color: var(--color-warning); }
.pa-warn-cat.parallel { color: var(--color-purple); }
.pa-warn-cat.index    { color: var(--color-primary); }
.pa-warn-note { color: var(--color-muted); font-size: 12px; margin-top: 3px; }
```

**Mapping finding.type → warning category:**
```
spill_to_tempdb, memory_spill_risk  → "spill"
sort_expensive                      → "perf"
ineffective_parallelism             → "parallel"
key_lookup, rid_lookup, scan_with_predicate, non_sargable_implicit → "index"
```

---

### 4.8 — MEMORY GRANT

Dữ liệu: `stmt.memory_grant` (granted_kb, max_used_kb, grant_wait_ms).

```
Granted:    2,048 MB
Used:       1,843 MB  [████████████████████████████████▌   ] 90%  ← WARNING màu
Wait:       0 ms

ℹ ≥90% = nguy cơ spill sang TempDB | <50% = overestimate memory
```

Bar màu: ratio ≥ 90% → danger, ≥ 50% → warning, < 50% → ok (overestimate).

---

### 4.9 — WAIT STATISTICS (image4)

Dữ liệu: `stmt.wait_stats` (sorted by ms desc).

```
CXPACKET         58,385 ms  9×   █████████████████████████████████████████████████████
PAGEIOLATCH_SH    8,396 ms  7127× █████████
MEMORY_ALLOC_EXT    188 ms  35583× ▌

ℹ Parallelism waits (CXPACKET) — thường bình thường nếu đi kèm CPU cao.
```

Bar màu: cùng logic heat như I/O STATISTICS.

---

### 4.10 — COMPILATION & SETTINGS

Dữ liệu: `stmt.compilation`.

Grid 2 columns:
```
CE Model:        150 (SQL Server 2019)   ← warn nếu = 70 (legacy)
Optimization:    FULL
DOP:             8
Compile CPU:     120 ms                  ← warn nếu > 1000ms
Compile Memory:  1,024 KB
Plan Size:       48 KB
Query Hash:      0x1A2B3C4D
Plan Hash:       0xABCDEF12
```

CE Model label: CE 70 → warning badge `[Legacy SQL 2012]`.

---

### 4.11 — Component API không thay đổi

```typescript
// Chỉ thay đổi internal render method, API public giữ nguyên
export class PlanAnalysisComponent {
  constructor(private readonly root: HTMLElement, private readonly result: PlanAnalysisResult) {}
  render(): void   // this.root.innerHTML = this._buildHtml(); this._bindEvents();
  destroy(): void  // this.root.innerHTML = "";
}
```

`_buildHtml()` sẽ tạo accordion sections thay vì tab panels.  
`_bindEvents()` thêm accordion toggle logic (click header → toggle `.collapsed`).

---

## Phase 5 — Visualization Redesign (đã tích hợp vào Phase 4 ở trên)

### 3.1 — Finding Cards (tab Findings)

**Thiết kế hiện tại:** Card đơn giản, header text.  
**Thiết kế mới:** Colored left border + operator type badge + cost % bar.

```
┌─[█ CRITICAL]──────────────────────────────────────────────┐
│ Sort  [SORT]  ▲ row est off              #3               │
│ Cost: 40.19  │ 100.0% ████████████████████████████████   │
│ Est rows: 1  │ Act rows: 241,800                          │
│ 💡 Sort chiếm 100% estimated cost — dữ liệu không có      │
│    index theo ORDER BY.                                    │
└────────────────────────────────────────────────────────────┘
```

**CSS classes cần thêm:**
```css
.pa-finding-card { border-left: 3px solid transparent; }
.pa-finding-card.critical { border-left-color: var(--color-danger); }
.pa-finding-card.warning  { border-left-color: var(--color-warning-soft); }
.pa-finding-card.info     { border-left-color: var(--color-primary); }

.pa-cost-bar-wrap { background: var(--color-border); border-radius: 2px; height: 4px; }
.pa-cost-bar { height: 4px; border-radius: 2px; }
.pa-cost-bar.critical { background: var(--color-danger); }
.pa-cost-bar.warning  { background: var(--color-warning); }
.pa-cost-bar.ok       { background: var(--color-success); }

.pa-op-tag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px;
             text-transform: uppercase; margin-left: 6px; }
.pa-op-tag.sort     { background: #fee2e2; color: #dc2626; } /* dark: danger-soft/danger */
.pa-op-tag.join     { background: #dbeafe; color: #1e40af; }
.pa-op-tag.seek     { background: #dcfce7; color: #166534; }
.pa-op-tag.parallel { background: #f3e8ff; color: #7c3aed; }
```

### 3.2 — I/O Statistics Section (tab Operators)

**Thiết kế mới:** Horizontal bar chart theo logical reads, có label type + metadata.

```
Sort  [SORT]  ▲ highest          374.5K log  284 phys  766 RA  21,896 scans
              ████████████████████████████████████████████████ (100% bar — đỏ)

Stream Agg    [AGG]               374.5K log  284 phys  766 RA  21,896 scans
              ████████████████████████████████████████████████ (100% bar — đỏ)

Clustered Index Seek              197.5K log
              ████████████████████████             (52% bar — cam)

ℹ Logical reads = buffer pool 8KB page reads (lower = better).
  Physical reads = disk I/O (0 after warmup là lý tưởng).
```

**Màu bar theo % max:**
- ≥ 75% → `var(--color-danger)` đỏ
- ≥ 40% → `#f59e0b` cam
- ≥ 15% → `#60a5fa` xanh nhạt  
- < 15% → `var(--color-muted)` xám

**HTML structure:**
```html
<div class="pa-io-row">
  <div class="pa-io-name">Sort <span class="pa-op-tag sort">SORT</span>
    <span class="pa-io-flag-highest">▲ highest</span></div>
  <div class="pa-io-bar-wrap"><div class="pa-io-bar danger" style="width:100%"></div></div>
  <div class="pa-io-stats">
    <span class="pa-io-val high">374.5K</span><span class="pa-io-unit"> log</span>
    <span class="pa-io-val">284</span><span class="pa-io-unit"> phys</span>
    <span class="pa-io-val">766</span><span class="pa-io-unit"> RA</span>
    <span class="pa-io-val">21,896</span><span class="pa-io-unit"> scans</span>
  </div>
</div>
<div class="pa-io-note">ℹ Logical reads = buffer pool 8KB page reads. Physical reads = disk I/O.</div>
```

### 3.3 — Wait Statistics (tab Waits)

**Thiết kế mới:** Bar chart + wait count, note contextual theo wait type.

```
CXPACKET          58,385 ms  9×  ████████████████████████████████████████████████████
PAGEIOLATCH_SH     8,396 ms  7127×  ███████████
MEMORY_ALLOC_EXT     188 ms  35583×  ▌

ℹ Parallelism waits (CXPACKET) — thường bình thường nếu đi kèm CPU cao.
```

**Màu bar theo ms so với max:**
- Dùng cùng logic heat coloring như I/O bar
- Note hiện ra khi có CXPACKET: "ℹ Parallelism waits..."
- Count hiển thị với `×` suffix

### 3.4 — Missing Indexes (tab Indexes)

**Thiết kế mới:** Impact badge nổi bật + cột nhóm + DDL block copy.

```
┌─────────────────────────────────────────────────────────────┐
│ [IMPACT 3393.1%]                                             │
│ [dbo].[rs_inoutward]                                         │
│ Equality:    [com_id]                                         │
│ Inequality:  [business_type_id]                              │
│ Include:     [date], [norm_date]                             │
│                                                               │
│ CREATE INDEX [IX_rs_inoutward] ON [dbo].[rs_inoutward] ...   │
│                                          [Copy DDL]          │
└─────────────────────────────────────────────────────────────┘
```

**CSS thêm:**
```css
.pa-impact-badge { background: var(--color-danger-soft); color: var(--color-danger);
                   font-weight: 700; font-size: 12px; padding: 3px 10px;
                   border-radius: 4px; display: inline-block; margin-bottom: 8px; }
.pa-index-cols { display: grid; grid-template-columns: 100px 1fr; gap: 4px 8px;
                 font-size: 12px; margin-bottom: 10px; }
.pa-index-cols-label { color: var(--color-muted); }
.pa-index-col-value { font-family: var(--font-code); color: var(--color-text); }
```

### 3.5 — Memory Grant (tab Memory)

**Thiết kế mới:** Grid metric + usage bar với threshold indicator.

```
Granted:    2,048 MB
Used:       1,843 MB  [████████████████████████████████▌    ] 90%  ← WARNING màu
Wait:       0 ms
Grant time: 45 ms

Ngưỡng: ≥90% → nguy cơ spill | ≤50% → overestimate
```

**CSS:**
```css
.pa-memory-bar-container { position: relative; }
.pa-memory-threshold-line { position: absolute; top: 0; height: 100%;
                             width: 1px; background: var(--color-danger); opacity: 0.6; }
/* line tại 90% (spill risk) và 50% (waste) */
```

### 3.6 — Warnings Section (tab Findings — subgroup)

Group findings có category đặc biệt với header màu:

```
[SPILL TO TEMPDB]                     ← header đỏ
Spill level 2
💡 Row estimate mismatch gây memory grant quá nhỏ — dữ liệu tràn ra đĩa.

[PERFORMANCE: EXPENSIVE SORT]         ← header cam
Sort chiếm 100% estimated cost.
💡 Sort tốn kém. Nếu hỗ trợ ORDER BY/GROUP BY, tạo index theo thứ tự sort.
```

**CSS:**
```css
.pa-warning-category { font-size: 10px; font-weight: 700; text-transform: uppercase;
                       letter-spacing: 0.05em; margin-bottom: 4px; }
.pa-warning-category.spill    { color: var(--color-danger); }
.pa-warning-category.perf     { color: var(--color-warning); }
.pa-warning-category.parallel { color: #7c3aed; }
```

---

## Phase 4 — Keyword Glossary & Tooltip `?`

### 4.1 — Data structure: `glossary.ts`

File: `layer3/apps/web/dashboard/glossary.ts`

```typescript
export interface GlossaryEntry {
  term: string;
  definition: string;
  threshold?: string;
  impact: string;
  formula?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  logical_reads: {
    term: "Logical Reads",
    definition: "Số lần đọc trang 8KB từ buffer pool (bộ nhớ). Không tính disk I/O.",
    threshold: "Không có ngưỡng tuyệt đối — so sánh giữa các lần chạy. > 100K thường đáng xem xét.",
    impact: "Tăng CPU, giảm throughput khi buffer pool bị áp lực.",
  },
  physical_reads: {
    term: "Physical Reads",
    definition: "Số lần đọc trang 8KB từ đĩa vào buffer pool. 0 sau warm-up là lý tưởng.",
    threshold: "= 0 (warm cache). > 0 trong production thường là vấn đề I/O.",
    impact: "Gây latency cao (ms vs μs so với logical reads).",
  },
  read_ahead: {
    term: "Read-Ahead (RA)",
    definition: "SQL Server đọc trước trang dữ liệu dự đoán sẽ cần. Tính năng prefetch tự động.",
    impact: "Thường lành tính. Số lớn có thể báo hiệu full scan không cần thiết.",
  },
  estimated_rows: {
    term: "Estimated Rows (Est rows)",
    definition: "Số hàng optimizer ước lượng sẽ xử lý tại node này, dựa trên statistics.",
    threshold: "Lệch > 10× so với actual là dấu hiệu statistics cũ hoặc parameter sniffing.",
    impact: "Ước lượng sai → plan sai → performance kém.",
  },
  actual_rows: {
    term: "Actual Rows (Act rows)",
    definition: "Số hàng thực tế xử lý khi runtime. Chỉ có trong Actual Execution Plan.",
    threshold: "So với Est rows: ratio ≥ 10× hoặc ≤ 0.1× → WARNING.",
    formula: "row_estimate_ratio = actual_rows / estimated_rows",
  },
  memory_grant: {
    term: "Memory Grant",
    definition: "Lượng workspace memory được SQL Server cấp cho Sort/Hash operations.",
    threshold: "Used ≥ 90% granted → nguy cơ spill. Used < 50% → overestimate.",
    impact: "Grant không đủ → spill sang TempDB (chậm hàng chục lần). Grant thừa → chèn ép query khác.",
    formula: "efficiency = max_used_kb / granted_kb × 100%",
  },
  spill_to_tempdb: {
    term: "Spill to TempDB",
    definition: "Khi memory grant không đủ, Sort/Hash ghi dữ liệu tạm ra TempDB (đĩa).",
    threshold: "Bất kỳ spill nào là vấn đề — spill level 1 = nhẹ, level 2+ = nghiêm trọng.",
    impact: "Tăng I/O đột ngột, tăng TempDB pressure, query chậm gấp nhiều lần.",
  },
  key_lookup: {
    term: "Key Lookup",
    definition: "SQL Server đọc thêm cột từ Clustered Index vì Nonclustered Index không có đủ cột (non-covering).",
    threshold: "Bất kỳ Key Lookup nào với số hàng lớn là CRITICAL.",
    impact: "Mỗi hàng = 2 index seeks. Với hàng chục nghìn hàng = I/O khổng lồ.",
  },
  parameter_sniffing: {
    term: "Parameter Sniffing",
    definition: "SQL Server compile plan dựa trên giá trị parameter lần đầu. Plan này có thể tốt cho giá trị đó nhưng kém cho giá trị khác.",
    threshold: "Compiled value ≠ Runtime value → tiềm ẩn sniffing.",
    impact: "Query chạy nhanh lần đầu, chậm lần sau (hoặc ngược lại) tùy giá trị parameter.",
  },
  cardinality_estimation: {
    term: "Cardinality Estimation (CE)",
    definition: "Quá trình optimizer ước lượng số hàng tại mỗi node trong plan, dựa trên statistics.",
    threshold: "CE model 70 (legacy SQL 2012), 120 (SQL 2014+), 150 (SQL 2019).",
    impact: "CE kém → plan kém → performance kém. Dùng Query Store để compare CE behaviors.",
  },
  implicit_conversion: {
    term: "CONVERT_IMPLICIT",
    definition: "SQL Server ngầm chuyển đổi kiểu dữ liệu (vd: VARCHAR vs NVARCHAR) khiến không dùng được index seek.",
    threshold: "Bất kỳ CONVERT_IMPLICIT trong predicate là cần xem xét.",
    impact: "Chuyển Index Seek thành Index Scan → đọc toàn bộ index thay vì tìm trực tiếp.",
  },
  dop: {
    term: "DOP (Degree of Parallelism)",
    definition: "Số thread song song SQL Server dùng để thực thi query.",
    threshold: "DOP=1: serial. DOP > 1: parallel. Optimal DOP tùy workload và số CPU.",
    impact: "DOP cao không phải lúc nào cũng tốt: có thể gây CXPACKET waits, context switching.",
    formula: "parallel_efficiency = (cpu_time/elapsed_time − 1) / (dop − 1) × 100%",
  },
  cxpacket: {
    term: "CXPACKET",
    definition: "Wait type khi thread trong parallel plan phải đợi thread khác (exchange operator).",
    threshold: "Thường bình thường với parallel queries. Bất thường nếu một thread gánh hầu hết công việc (skew).",
    impact: "Cao không đồng đều → skew data, hiệu quả parallelism thấp.",
  },
  statistics_modification_count: {
    term: "Modification Count (Statistics)",
    definition: "Số lần INSERT/UPDATE/DELETE xảy ra trên bảng kể từ lần UPDATE STATISTICS gần nhất.",
    threshold: "> 10,000 → statistics có thể stale. SQL Server auto-update ở ~20% (bảng nhỏ) hoặc ~500+20%√n (bảng lớn).",
    impact: "Statistics stale → cardinality estimate sai → plan suboptimal.",
  },
  sampling_percent: {
    term: "Sampling Percent (Statistics)",
    definition: "% hàng được sample khi chạy UPDATE STATISTICS. 100% = FULLSCAN.",
    threshold: "< 20% có thể không đại diện tốt cho dữ liệu lệch.",
    impact: "Sample thấp → estimate không chính xác với dữ liệu có phân bố không đều.",
    formula: "Tự động: sqrt(1000 × total_rows) / total_rows × 100 (gần đúng)",
  },
  scalar_udf: {
    term: "Scalar UDF",
    definition: "Hàm người dùng tự định nghĩa trả về một giá trị vô hướng, gọi từng hàng tuần tự.",
    threshold: "Bất kỳ Scalar UDF trong query chạy nhiều hàng là vấn đề.",
    impact: "Không thể parallel hóa, không thể pushdown qua operator. Chạy N lần cho N hàng.",
  },
};
```

### 4.2 — Tooltip component

File: `layer3/apps/web/dashboard/glossary-tooltip.ts`

```typescript
export function attachGlossaryTooltips(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-glossary]").forEach(el => {
    const key = el.getAttribute("data-glossary")!;
    const entry = GLOSSARY[key];
    if (!entry) return;
    const btn = document.createElement("button");
    btn.className = "gl-tip-btn";
    btn.textContent = "?";
    btn.setAttribute("aria-label", `Giải thích: ${entry.term}`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showTooltip(btn, entry);
    });
    el.appendChild(btn);
  });
}

function showTooltip(anchor: HTMLElement, entry: GlossaryEntry): void {
  removeTooltip();
  const tip = document.createElement("div");
  tip.className = "gl-tooltip";
  tip.innerHTML = buildTooltipHtml(entry);
  document.body.appendChild(tip);
  positionTooltip(tip, anchor);
  document.addEventListener("click", removeTooltip, { once: true });
}
```

### 4.3 — CSS: `.gl-tip-btn` và `.gl-tooltip`

```css
/* Trong plan-analysis.css hoặc base.css */
.gl-tip-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--color-border); color: var(--color-muted);
  border: none; cursor: pointer; font-size: 9px; font-weight: 700;
  margin-left: 4px; vertical-align: middle;
  line-height: 1;
}
.gl-tip-btn:hover { background: var(--color-primary-soft); color: var(--color-primary); }

.gl-tooltip {
  position: fixed; z-index: 9999; max-width: 320px; min-width: 220px;
  background: var(--color-surface); border: 1px solid var(--color-border-strong);
  border-radius: 8px; padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(2, 8, 20, 0.18);
  font-size: 12px; line-height: 1.5; color: var(--color-text);
}
.gl-tooltip-term { font-weight: 700; margin-bottom: 4px; font-size: 13px; }
.gl-tooltip-def  { color: var(--color-muted); margin-bottom: 6px; }
.gl-tooltip-row  { display: flex; gap: 6px; margin-top: 4px; font-size: 11px; }
.gl-tooltip-label { color: var(--color-muted); white-space: nowrap; min-width: 60px; }
.gl-tooltip-val  { color: var(--color-text); }
.gl-tooltip-formula { font-family: var(--font-code); font-size: 11px;
                       background: var(--color-surface-soft); padding: 3px 6px;
                       border-radius: 3px; margin-top: 4px; }
```

### 4.4 — Usage trong `PlanAnalysisComponent`

Các keyword cần có `data-glossary` attribute và nút `?`:

```html
<!-- Ví dụ trong tab Operators -->
<span class="pa-io-metric-label" data-glossary="logical_reads">Logical reads</span>
<span class="pa-io-metric-label" data-glossary="physical_reads">Physical reads</span>

<!-- Trong Memory tab -->
<span class="pa-memory-label" data-glossary="memory_grant">Memory Grant</span>

<!-- Trong Findings card -->
<span data-glossary="key_lookup">Key Lookup</span>
<span data-glossary="spill_to_tempdb">Spill to TempDB</span>
```

---

## Phase 5 — Fix `query-plan.html` mojibake strings

File: `layer3/apps/web/pages/query-plan.html`

Các chuỗi bị lỗi encoding trong script block (hiện thị như `Äang xá»­ lÃ½...`):

| Chuỗi bị lỗi | Chuỗi đúng |
|---|---|
| `'Äang xá»­ lÃ½...'` | `'Đang xử lý...'` |
| `'Äang parse XML vÃ  render diagram...'` | `'Đang parse XML và render diagram...'` |
| `'Dang chuan bi ShowPlan XML...'` | `'Đang chuẩn bị ShowPlan XML...'` |
| `'Dang tai noi dung query...'` | `'Đang tải nội dung query...'` |
| `'KhÃ´ng thá»ƒ render plan...'` | `'Không thể render plan. Vui lòng kiểm tra XML.'` |
| `'KhÃ´ng thá»ƒ Ä'á»c file XML...'` | `'Không thể đọc file XML. Vui lòng thử lại.'` |
| `'Khong co XML de hien thi...'` | `'Không có XML để hiển thị. Hãy upload hoặc paste XML trước.'` |
| `'Editor má»Ÿ trong popup, khÃ´ng chiáº¿m layout chÃ­nh'` | `'Editor mở trong popup, không chiếm layout chính'` |
| `'Auto render sau 2 giÃ¢y'` | `'Auto render sau 2 giây'` |

---

## Phase 6 — Fix `query-plan.html` HTML text mojibake

Các text node trong HTML (ngoài script block):

| Vị trí | Chuỗi lỗi | Chuỗi đúng |
|---|---|---|
| `.muted` span | `Editor má»Ÿ trong popup, khÃ´ng chiáº¿m layout chÃ­nh` | `Editor mở trong popup, không chiếm layout chính` |
| `.muted` span | `Auto render sau 2 giÃ¢y` | `Auto render sau 2 giây` |

---

## Implementation Order (updated)

```
Phase 1: Layer 2 analyzer files — fix encoding + enrich content
  ├── compilation_analyzer.py  (3 findings)
  ├── operator_analyzer.py     (7 findings)
  ├── memory_analyzer.py       (4 findings)
  ├── parallelism_analyzer.py  (3 findings)
  ├── statistics_analyzer.py   (3 findings)
  ├── wait_analyzer.py         (5 wait types)
  ├── index_analyzer.py        (English → VI)
  └── code_pattern_analyzer.py (English → VI)

Phase 2: CSS foundation
  ├── base.css — thêm --color-code-bg/text/border + --color-purple/purple-soft
  └── plan-analysis.css — replace hex → CSS variables

Phase 3: Layer 2 model + service additions
  ├── result.py — extend OperatorSummary + add JoinTypesSummary + CompilationInfo
  ├── result.py — extend StatementResult (io_stats, join_types, compilation)
  ├── service.py — _build_top_operators (new fields)
  ├── service.py — _build_io_stats (per-operator, replaces _build_io_summary)
  ├── service.py — _build_join_types (new)
  └── service.py — _build_compilation (new)

Phase 4: TypeScript types update
  └── plan-analysis.ts — OperatorSummary + JoinTypesSummary + CompilationInfo +
                         StatsSummary + StatementResult extensions

Phase 5: Glossary
  ├── glossary.ts — 16 term entries
  └── glossary-tooltip.ts — attach/show/position/remove

Phase 6: plan-analysis-component.ts — REWRITE (accordion sections)
  ├── _buildHtml() → accordion container
  ├── Section: QUERY TEXT
  ├── Section: I/O STATISTICS (bar chart per operator)
  ├── Section: TOP EXPENSIVE OPERATIONS (ranked, colored bar by op_type_tag)
  ├── Section: WARNINGS (grouped by category)
  ├── Section: EST VS ACTUAL ROWS
  ├── Section: JOIN TYPES & OPERATIONS (chips)
  ├── Section: STATISTICS USED (table, highlight stale)
  ├── Section: MEMORY GRANT (usage bar)
  ├── Section: WAIT STATISTICS (bar chart)
  ├── Section: COMPILATION & SETTINGS (grid)
  └── Section: MISSING INDEXES (impact badge + DDL)

Phase 7: plan-analysis.css — add accordion + section CSS
  (pa-section, pa-section-header, pa-section-dot, pa-teo-*, pa-io-*, pa-jchip-*, pa-warn-*)

Phase 8: query-plan.html — fix encoding strings
```

---

## Definition of Done (updated)

**Layer 2:**
- [ ] Tất cả `?` chars trong 6 analyzer files được thay thế đúng tiếng Việt
- [ ] `index_analyzer.py`, `code_pattern_analyzer.py` dùng tiếng Việt
- [ ] `OperatorSummary` có: `op_type_tag`, `cost`, `has_row_est_off`, `has_spill`, `actual_physical_reads`, `table_name`, `index_name`
- [ ] `StatementResult` có: `io_stats` (per-operator), `join_types`, `compilation`
- [ ] `_build_io_stats` trả per-operator sorted by logical reads (không phải per-table)
- [ ] API `/api/v1/plan/analyze` trả đúng schema mới

**Layer 3:**
- [ ] Light/dark theme cho toàn bộ `plan-analysis.css` qua CSS variables
- [ ] UI là accordion sections (không phải tabs)
- [ ] Section TOP EXPENSIVE OPERATIONS: rank + op type badge + cost % bar (màu per type) + row est off flag
- [ ] Section I/O STATISTICS: per-operator bar chart heat color
- [ ] Section JOIN TYPES: chips với counts + spill warning nếu có
- [ ] Section STATISTICS USED: table với highlight stale rows
- [ ] Section WARNINGS: grouped by category (spill/perf/parallel/index)
- [ ] Section COMPILATION: grid hiển thị CE model, DOP, compile CPU, hashes
- [ ] Tooltip `?` click hiện glossary (definition/threshold/formula)
- [ ] `query-plan.html` không còn chuỗi mojibake
- [ ] Build TypeScript không lỗi
