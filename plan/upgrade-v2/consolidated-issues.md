# Consolidated Issues — Plan Analysis (Layer 2 + Layer 3)

**Nguồn:** review code + so sánh với https://www.mssql.ee/tools/sql-plan-parser.html  
**XML mẫu:** `layer3/examples/example.xml`  
**Cập nhật:** 2026-05-30

---

## Tóm tắt nhanh

| Nhóm | Số vấn đề | Mức độ cao nhất |
|---|---|---|
| A — Parser (layer2) | 3 | 🔴 CRITICAL |
| B — Analyzer content (layer2) | 8 | 🔴 CRITICAL |
| C — Backend model / API (layer2) | 5 | 🟠 HIGH |
| D — UI — thiếu section (layer3) | 4 | 🟠 HIGH |
| E — UI — hiển thị sai / kém (layer3) | 9 | 🟠 HIGH |
| F — UI — CSS / dark mode (layer3) | 2 | 🟡 MEDIUM |

**Tổng: 31 vấn đề**

---

## Nhóm A — Parser (`layer2/plan/parser/`)

### A1 · Whitelist container thiếu — cây operator bị cụt 🔴 CRITICAL

**File:** `operator_parser.py`  
**Vấn đề:** `parse_node()` chỉ tìm child RelOp trong 5 container cứng:
```python
for container_tag in ("Children", "NestedLoops", "Hash", "Merge", "Parallelism"):
```
Các container `Sort`, `ComputeScalar`, `StreamAggregate`, `Filter`, `Assert`, `Top`, `Spool`, `MergeInterval`, `Concatenation`, `MergeInterval` bị bỏ qua hoàn toàn → cây operator bị cụt → **top operators thiếu so với thực tế** (confirmed qua mssql.ee: 8 ops vs parser chỉ thấy ít hơn).

**Sửa:** Thay whitelist cứng bằng traverse tất cả child element có tag `RelOp`, hoặc mở rộng whitelist đầy đủ.

---

### A2 · `StatementParser` bỏ qua `OptimizerStatsUsage` 🟠 HIGH

**File:** `plan_parser.py` / `statement_parser.py`  
**Vấn đề:** Statistics từ XML (`<OptimizerStatsUsage><StatisticsInfo .../>`) chưa được parse → `statistics: []` rỗng.  
XML mẫu có 28 statistics entries, tất cả đều bị bỏ qua.

**Sửa:** Parse `OptimizerStatsUsage/StatisticsInfo` → populate `statistics: list[StatsSummary]`.

---

### A3 · `IndexParser` thiếu `op_type_tag` LOOKUP 🟡 MEDIUM

**File:** `index_parser.py`  
**Vấn đề:** Node có `Lookup="1"` trong `<IndexScan>` không được gán `op_type_tag = "LOOKUP"` — bị nhầm thành `SEEK`.  
Dẫn đến Key Lookup không được highlight đúng trong Top Operators.

**Sửa:** Kiểm tra `IndexScan[@Lookup="1"]` → `op_type_tag = "LOOKUP"`.

---

## Nhóm B — Analyzer Content (`layer2/plan/analyzers/`)

### B1 · Encoding lỗi `?` thay ký tự tiếng Việt 🔴 CRITICAL (BLOCKER)

**Files:** `compilation_analyzer.py`, `operator_analyzer.py`, `memory_analyzer.py`,  
`parallelism_analyzer.py`, `statistics_analyzer.py`, `wait_analyzer.py`, `parameter_analyzer.py`  
**Vấn đề:** Chuỗi description/recommendation chứa `?` thay vì ký tự có dấu (vd: `"Có th? query dùng"`).  
Hiển thị lên giao diện bị lỗi, không đọc được.

**Sửa:** Rewrite toàn bộ string tiếng Việt đúng encoding.

---

### B2 · `_flatten()` duplicate trong 2 analyzer 🟠 HIGH

**Files:** `operator_analyzer.py:90–96`, `code_pattern_analyzer.py:37–43`  
**Vấn đề:** Cả 2 file tự khai báo method `_flatten()` y hệt nhau — vi phạm DRY.

**Sửa:** Chuyển lên `AbstractAnalyzer.base.py`, xóa khỏi 2 file con.

---

### B3 · `key_lookup` CRITICAL bất kể row count 🟠 HIGH (false positive)

**File:** `operator_analyzer.py`  
**Vấn đề:** Mỗi Key Lookup node = 1 CRITICAL finding, kể cả khi cost < 1% total hoặc chỉ lookup 5 hàng.  
Gây noise: user thấy CRITICAL nhưng thực ra không đáng lo.

**Sửa:** Chỉ raise CRITICAL khi `estimated_rows > 1000` hoặc `cost_pct > 5%`. Dưới ngưỡng → WARNING.

---

### B4 · `stale_statistics` threshold tuyệt đối, không tính kích thước bảng 🟡 MEDIUM

**File:** `statistics_analyzer.py`  
**Vấn đề:** `modification_count > 10000` cứng. Bảng 40M rows với 193K mods = 0.5% — không đáng báo. Nhưng bảng 50K rows với 10K mods = 20% — nguy hiểm hơn nhiều.

**Sửa:** Dùng `modification_count / table_cardinality > 0.1` (10%) làm threshold stale.

---

### B5 · `low_sampling` thiếu context table size 🟡 MEDIUM

**File:** `statistics_analyzer.py`  
**Vấn đề:** `sampling_percent < 20%` → INFO finding. Nhưng table 40M rows với sampling 0.6% trên dữ liệu lệch cao là vấn đề thực sự, không chỉ INFO.

**Sửa:** Nếu `sampling_percent < 5%` → WARNING. Chỉ INFO khi `5% ≤ sampling < 20%`.

---

### B6 · `index_analyzer.py` và `code_pattern_analyzer.py` dùng tiếng Anh 🟡 MEDIUM

**Files:** `index_analyzer.py`, `code_pattern_analyzer.py`  
**Vấn đề:** Description/recommendation bằng tiếng Anh, không nhất quán với các analyzer khác.

**Sửa:** Dịch sang tiếng Việt, thêm metric context.

---

### B7 · `description` quá vắn tắt, thiếu metric context 🟡 MEDIUM

**Files:** Nhiều analyzer  
**Vấn đề:** Description như `"High compile CPU"` không kèm giá trị thực. User không biết là 57ms hay 5700ms.

**Sửa:** Format description kèm giá trị: `"Compile CPU cao: 57ms — optimizer tốn nhiều tài nguyên."`  
Thêm metric summary trong finding (vd: `"Cost: 22.99 | 96.6% total | Est rows: 1"`).

---

### B8 · `join types recommendation` chưa có trong analyzer 🟢 LOW

**Vấn đề:** mssql.ee hiển thị gợi ý: `"Hash Match — check indexes on join columns to allow more efficient seeks."` Layer2 không tạo finding này.

**Sửa:** Thêm finding INFO trong analyzer khi có `Hash Match` — gợi ý kiểm tra index trên cột join.

---

## Nhóm C — Backend Model / API (`layer2/plan/`)

### C1 · `statistics: []` rỗng do parser chưa extract (liên quan A2) 🔴 CRITICAL

**File:** `service.py`, `plan_parser.py`  
**Vấn đề:** `StatementResult.statistics` luôn rỗng vì parser không lấy `OptimizerStatsUsage`. Layer3 hiển thị "No statistics usage" dù XML có 28 entries.

**Sửa:** Fix parser (A2) → `service.py` tự động populate đúng.

---

### C2 · Không có field `indexes_used` riêng 🟠 HIGH

**File:** `result.py`, `service.py`  
**Vấn đề:** Danh sách index thực sự dùng trong plan (SEEK/SCAN/LOOKUP với table+index name) không có field riêng. Chỉ nằm lẫn trong `top_operators`.  
mssql.ee có panel "INDEXES USED" riêng biệt, rất hữu ích để DBA xem ngay.

**Sửa:** Thêm `indexes_used: list[IndexUsage]` vào `StatementResult`. Extract từ operators có `op_type_tag ∈ {SEEK, SCAN, LOOKUP}` và group unique theo `table + index`.

```python
class IndexUsage(BaseModel):
    table: str
    index: str
    index_kind: str        # "Clustered" | "NonClustered"
    op_type: str           # "Seek" | "Scan" | "Lookup"
    is_partitioned: bool = False
```

---

### C3 · Không có field `lookup_queries` 🟠 HIGH

**File:** `result.py`  
**Vấn đề:** mssql.ee cung cấp sẵn SQL để DBA tìm query trong Plan Cache và Query Store theo `query_hash`. Layer2/Layer3 không có.

**Sửa:** Thêm vào `CompilationInfo` (hoặc `StatementResult`):

```python
class LookupQueries(BaseModel):
    plan_cache_sql: str     # SELECT ... WHERE query_hash = 0x...
    query_store_sql: str    # SELECT ... WHERE q.query_hash = 0x...
```

Generate dựa trên `query_hash` khi có.

---

### C4 · `CompilationInfo` thiếu 2 fields 🟡 MEDIUM

**File:** `result.py`, `service.py`  
**Vấn đề:** `cached_plan_size_kb` và `non_parallel_reason` có trong `ParsedStatement` nhưng không được map vào `CompilationInfo`.

**Sửa:** Thêm 2 fields vào `CompilationInfo` và map trong `_build_compilation()`.

---

### C5 · `JoinTypeSummary` thiếu Sort + Parallelism 🟡 MEDIUM

**File:** `service.py`  
**Vấn đề:** `_build_join_types()` chỉ đếm Nested Loops / Merge Join / Hash Match. Bỏ qua Sort và Parallelism — 2 operator quan trọng trong plan.

**Sửa:** Thêm Sort + Parallelism vào tracked ops. Thêm `__spill__` entry khi có SpillToTempDb.

---

## Nhóm D — UI: Thiếu Section (`layer3/apps/web/dashboard/`)

### D1 · Thiếu Parameters section 🔴 CRITICAL

**File:** `plan-analysis-component.ts`  
**Vấn đề:** `parameters: ParameterInfo[]` có đầy đủ trong model và TypeScript type nhưng `_buildHtml()` không render. DBA không thấy plan được compile với param nào — quan trọng với **parameter sniffing diagnosis**.

**Sửa:** Thêm `_buildParametersSection()` hiển thị:
- DECLARE @P0 int = (3508) — dạng SQL executable
- Table: name | type | compiled value | runtime value (nếu khác → cảnh báo sniffing)

---

### D2 · Thiếu Indexes Used panel 🟠 HIGH

**File:** `plan-analysis-component.ts`  
**Vấn đề:** Không có panel `INDEXES USED` riêng. Index info bị ẩn trong Top Operators, DBA phải tự tìm. mssql.ee có danh sách clean: `[dbo].[table] → [index_name]` với Seek/Scan/Lookup type.

**Sửa:** Sau khi C2 thêm `indexes_used` field, render panel mới:
```
[dbo].[product] → [PK__product__3213E83F] — Seek
[dbo].[rs_inoutward] → [idx_rs_inoutward_com_id_type_date] — Seek
[dbo].[rs_inoutward_detail] → [PK_rs_inoutward_detail] — Lookup ⚠
```
Highlight Lookup vì thường là vấn đề cần tối ưu.

---

### D3 · Thiếu Lookup Queries section 🟠 HIGH

**File:** `plan-analysis-component.ts`  
**Vấn đề:** Không có SQL sẵn để DBA tìm query trong Plan Cache / Query Store. mssql.ee cung cấp 2 query copy-paste ngay.

**Sửa:** Sau khi C3 thêm `lookup_queries` field, render section với 2 code block + nút Copy:
- "Plan Cache" (in-memory, flushed on restart)
- "Query Store" (persistent, recommended)

---

### D4 · Query Text hiển thị raw 1 dòng, không format 🟡 MEDIUM

**File:** `plan-analysis-component.ts:23`  
**Vấn đề:** `<pre>` render `statement_text` là 1 dòng dài `(@P0 int,@P1 int...)select count(p.id)...` — rất khó đọc.  
mssql.ee tách thành DECLARE block + SQL xuống dòng có indent.

**Sửa:**
1. Parse parameters → render DECLARE block: `DECLARE @P0 int = (3508)\n...`
2. Format SQL: thêm newline sau `SELECT`, `FROM`, `JOIN`, `WHERE`, `AND`, `OR`

---

## Nhóm E — UI: Hiển thị sai / kém (`layer3/apps/web/dashboard/`)

### E1 · Summary bar dùng result-level data thay vì statement-level 🔴 CRITICAL (BLOCKER)

**File:** `plan-analysis-component.ts`, `_buildSummaryBar()`  
**Vấn đề:** `optm_level` lấy từ `s.compilation?.optm_level` không fallback đúng khi `compilation` null. Một số field (`non_parallel_reason`) không được dùng để tính `parallelism` label.

**Sửa:** Logic đầy đủ:
- `parallelism`: `dop > 1` → `DOP N`, else `non_parallel_reason` có → `No`, else `—`
- `mem_used`: `max_used_kb` → format KB/MB, null → `—`

---

### E2 · TEO: tên operator không format `table → index` cho SEEK/LOOKUP 🟠 HIGH

**File:** `plan-analysis-component.ts`, `_buildTopExpensiveSection()`  
**Vấn đề:** Hiển thị `Index Seek` thay vì `Index Seek: [rs_inoutward_detail] → [idx_rs_inoutward_id]`. DBA không biết seek vào đâu.

**Sửa:** Helper `_opDisplayName()` — đã có trong code hiện tại ✅, kiểm tra lại đang được gọi đúng chỗ chưa.

---

### E3 · TEO: bar color dùng critical/warning/ok thay vì per op_type_tag 🟠 HIGH

**File:** `plan-analysis-component.ts`, `_buildTopExpensiveSection()`  
**Vấn đề:** Bar màu chỉ dựa vào % total (đỏ/vàng/ok). mssql.ee dùng màu per operator type (Sort=đỏ, Nested Loops=cyan, Hash=cam, Seek=xanh...) giúp nhận dạng nhanh hơn.

**Sửa:** Dùng `_opTagClass(op_type_tag)` cho class bar. CSS `.teo-sort`, `.teo-join`, `.teo-hash`... đã định nghĩa sẵn.

---

### E4 · TEO: cost % không có màu động 🟠 HIGH

**File:** `plan-analysis-component.ts`  
**Vấn đề:** `cost_pct` hiển thị không có class màu (đỏ khi cao, cam khi trung bình).

**Sửa:** `≥ 70%` → `class='val high'` (đỏ), `≥ 30%` → `class='val mid'` (cam).

---

### E5 · I/O Stats: thiếu physical/RA/scan_count metrics 🟠 HIGH

**File:** `plan-analysis-component.ts`, `_buildIoSection()`  
**Vấn đề:** Chỉ hiển thị `logical_reads`. mssql.ee hiển thị `374.5K log | 284 phys | 766 RA | 21K scans`.

**Sửa:** Render đủ 4 metrics, chỉ hiện khi > 0 (trừ logical_reads luôn hiện).

---

### E6 · JOIN TYPES: thiếu Sort + Parallelism chips, thiếu recommendation text 🟠 HIGH

**File:** `plan-analysis-component.ts`, `_buildJoinTypesSection()`  
**Vấn đề:** Chỉ render chip cho join type có trong list, không có Sort/Parallelism vì C5 chưa fix. Cũng không có recommendation text (mssql.ee: "Hash Match — check indexes on join columns").

**Sửa:** Sau C5 fix backend, render Sort + Parallelism chips. Thêm recommendation cho Hash Match.

---

### E7 · Warnings: render `f.type` raw thay vì human-readable label 🟡 MEDIUM

**File:** `plan-analysis-component.ts`, `_buildWarningsSection()`  
**Vấn đề:** Hiển thị `"spill_to_tempdb"` thay vì `"SPILL TO TEMPDB"`. Không có category header (spill/perf/parallel/index).

**Sửa:** Dùng `_warnLabel()` + `_warnCat()` mapping — đã plan trong `fix-plan.md`, implement.

---

### E8 · Statistics: stale highlight không có class trên `<tr>` 🟡 MEDIUM

**File:** `plan-analysis-component.ts`, `_buildStatsSection()`  
**Vấn đề:** Code tính `staleRow` nhưng không concat vào `<tr>` tag. CSS `.stale` không áp dụng.

**Sửa:** `"<tr" + staleRow + "><td>..."` — đơn giản, 1 dòng.

---

### E9 · Statistics: threshold stale `> 10000` tuyệt đối (liên quan B4) 🟡 MEDIUM

**File:** `plan-analysis-component.ts`, `_buildStatsSection()`  
**Vấn đề:** Cùng vấn đề như B4 nhưng ở UI layer. Bảng 40M rows với 193K mods (0.5%) bị highlight stale. Bảng 50K rows với 5K mods (10%) không bị highlight.

**Sửa:** Không có table_cardinality ở UI — cần backend trả thêm field `is_stale: bool` đã tính sẵn trong `StatsSummary`.

---

## Nhóm F — UI: CSS / Dark Mode

### F1 · `plan-analysis.css` hardcode hex, không hỗ trợ dark mode 🟠 HIGH

**File:** `layer3/apps/web/css/plan-analysis.css`  
**Vấn đề:** Toàn bộ file dùng hex cứng (`#1e293b`, `#f8fafc`, `#dc2626`...). Khi switch sang dark mode, giao diện plan analysis không đổi theo.

**Sửa:** Replace tất cả hex → CSS variables từ `base.css` (`var(--color-text)`, `var(--color-surface)`, `var(--color-danger)`, v.v.).

---

### F2 · Thiếu `--color-purple` / `--color-purple-soft` cho Parallelism chip 🟢 LOW

**File:** `layer3/apps/web/css/base.css`  
**Vấn đề:** `.pa-jchip.parallel` dùng `--color-purple` chưa được khai báo trong `base.css`. Chip Parallelism bị mất style.

**Sửa:** Thêm vào `base.css`:
```css
:root { --color-purple: #7c3aed; --color-purple-soft: #f3e8ff; }
:root[data-theme="dark"] { --color-purple: #c084fc; --color-purple-soft: #2e1065; }
```

---

## Ma trận ưu tiên implement

```
PHASE 1 — Unblock data (không có data → không fix được gì)
  A1  operator_parser.py: fix container whitelist (cây operator bị cụt)
  A2  plan_parser.py: parse OptimizerStatsUsage → statistics
  A3  index_parser.py: Lookup="1" → op_type_tag = LOOKUP
  B1  Fix encoding ? → tiếng Việt đúng (7 files)
  C1  (tự fix sau A2) statistics field populated

PHASE 2 — Backend model extend
  C4  CompilationInfo: thêm cached_plan_size_kb + non_parallel_reason
  C5  _build_join_types: thêm Sort + Parallelism + __spill__
  C2  Thêm indexes_used: list[IndexUsage]
  C3  Thêm lookup_queries field (generate từ query_hash)

PHASE 3 — Analyzer quality
  B2  _flatten() lên base class
  B3  key_lookup: threshold theo row count / cost_pct
  B4  stale_statistics: dùng % thay số tuyệt đối
  B5  low_sampling: WARNING nếu < 5%
  B6  index/code_pattern analyzer → tiếng Việt
  B7  description kèm metric values
  B8  Hash Match → finding INFO recommendation

PHASE 4 — UI core fixes (sau PHASE 1+2)
  E1  Summary bar: parallelism + mem_used logic
  E2  TEO: verify _opDisplayName() đang gọi đúng
  E3  TEO: bar color per op_type_tag
  E4  TEO: cost_pct màu động
  E5  I/O Stats: physical/RA/scans metrics
  E6  Join Types: Sort + Parallelism chips + recommendation
  E7  Warnings: human-readable label + category header
  E8  Statistics: stale <tr> class (1-liner fix)
  E9  Statistics: thêm is_stale từ backend (phụ thuộc B4)
  D4  Query Text: format DECLARE block + SQL indent

PHASE 5 — UI new sections (phụ thuộc PHASE 2)
  D1  Parameters section
  D2  Indexes Used panel (phụ thuộc C2)
  D3  Lookup Queries section (phụ thuộc C3)

PHASE 6 — CSS / polish
  F1  plan-analysis.css: hex → CSS variables (dark mode)
  F2  base.css: thêm --color-purple
```

---

## Definition of Done tổng hợp

**Layer 2 Parser:**
- [ ] A1: Tất cả operator nodes được parse (cây không bị cụt)
- [ ] A2: `statistics` field có data từ `OptimizerStatsUsage`
- [ ] A3: Key Lookup có `op_type_tag = "LOOKUP"`

**Layer 2 Analyzer:**
- [ ] B1: Không còn ký tự `?` trong description/recommendation
- [ ] B2: `_flatten()` chỉ định nghĩa 1 lần trong base class
- [ ] B3: `key_lookup` CRITICAL chỉ khi `estimated_rows > 1000` hoặc `cost_pct > 5%`
- [ ] B4+B5: Statistics stale/sampling dùng % threshold

**Layer 2 Model/API:**
- [ ] C2: `indexes_used: list[IndexUsage]` có trong response
- [ ] C3: `lookup_queries` có trong response khi `query_hash` != null
- [ ] C4: `CompilationInfo` có `cached_plan_size_kb` + `non_parallel_reason`
- [ ] C5: Join types có Sort + Parallelism + `__spill__`

**Layer 3 UI:**
- [ ] D1: Parameters section render DECLARE block + sniffing indicator
- [ ] D2: Indexes Used panel hiển thị
- [ ] D3: Lookup Queries section với nút Copy
- [ ] D4: Query Text format DECLARE + SQL indent
- [ ] E1: Summary bar 7 metrics đúng per-statement
- [ ] E3+E4: TEO bar color per tag + cost% màu
- [ ] E5: I/O Stats có physical/RA/scans
- [ ] E6: Join chips đầy đủ + recommendation
- [ ] E7: Warnings human-readable
- [ ] E8: Statistics stale `<tr>` có class `.stale`
- [ ] F1: Dark mode hoạt động đúng trong plan-analysis
- [ ] F2: `--color-purple` khai báo trong base.css
- [ ] Build TypeScript không lỗi
