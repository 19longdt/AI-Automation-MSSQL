# Analyzer Fix Plan — layer2/plan/analyzers/

Ngày phân tích: 2026-05-30  
Scope: 9 analyzers trong `layer2/plan/analyzers/`  
Mục tiêu: giảm false positive, tăng signal quality cho AI Agent

---

## Danh sách vấn đề

### 🔴 Bug — sửa ngay

#### BUG-1 · Encoding lỗi trong `ParameterAnalyzer`
- **File:** `parameter_analyzer.py:33`
- **Hiện tại:** `"Có th? query dùng local variable"`
- **Sửa:** `"Có thể query dùng local variable"`

#### BUG-2 · `_flatten` duplicate giữa `OperatorAnalyzer` và `CodePatternAnalyzer`
- **File:** `operator_analyzer.py:90–96`, `code_pattern_analyzer.py:37–43`
- **Vấn đề:** Cả hai tự khai báo method `_flatten()` y hệt nhau
- **Sửa:** Chuyển lên `AbstractAnalyzer` base class (`base.py`), xóa khỏi 2 file con

---

### 🟠 Noisy findings — false positive / finding lặp

#### NOISE-1 · `key_lookup` CRITICAL bất kể row count
- **File:** `operator_analyzer.py:21–29`
- **Vấn đề:** Mỗi Key Lookup node = 1 CRITICAL finding, kể cả khi chỉ lookup 5 hàng hoặc cost < 1% total
- **Sửa:**
  - Chỉ raise CRITICAL khi `node.actual_rows > 100` hoặc `node.estimated_cost / total_cost > 0.05`
  - Còn lại: WARNING
  - Nếu không có actual stats: dùng `estimated_cost / total_cost` làm proxy
- **Logic mới:**
  ```python
  rows = node.actual_rows if node.actual_rows is not None else node.estimate_rows
  cost_pct = node.estimated_cost / total_cost if total_cost > 0 else 0
  severity = Severity.CRITICAL if (rows > 100 or cost_pct > 0.05) else Severity.WARNING
  ```

#### NOISE-2 · `scan_with_predicate` không có threshold
- **File:** `operator_analyzer.py:50–57`
- **Vấn đề:** Scan trên bảng 100 dòng → vẫn WARNING. Không có điều kiện cost/row.
- **Sửa:**
  - Thêm điều kiện: `node.estimated_cost / total_cost > 0.1` (scan chiếm >10% cost)
  - Hoặc: `node.estimate_rows > 1000` khi không có actual stats
  - Nếu cả hai đều thấp → bỏ qua (không tạo finding)

#### NOISE-3 · `parameter_sniffing` — 1 finding mỗi parameter
- **File:** `parameter_analyzer.py:18–26`
- **Vấn đề:** Stored proc có 5 params bị sniffing → 5 findings riêng lẻ, AI đọc rất noisy
- **Sửa:** Gom tất cả params bị sniffing thành 1 finding duy nhất
  ```python
  # Collect all sniffing params first, then emit 1 finding
  sniffing = [(p.name, p.compiled_value, p.runtime_value) for p in params if ...]
  if sniffing:
      findings.append(Finding(
          severity=Severity.WARNING,
          type="parameter_sniffing",
          description=f"Parameter sniffing trên {len(sniffing)} param: "
                      + "; ".join(f"{n} compiled={c!r} runtime={r!r}" for n,c,r in sniffing[:3]),
          ...
      ))
  ```
  - Giới hạn hiển thị tối đa 3 params trong description, phần còn lại ghi "... và N params khác"

#### NOISE-4 · `scalar_udf` — 1 finding mỗi node
- **File:** `code_pattern_analyzer.py:19–26`
- **Vấn đề:** UDF xuất hiện ở 10 nodes → 10 CRITICAL findings gần như giống nhau
- **Sửa:** Deduplicate theo tên UDF, emit 1 finding per unique UDF name
  ```python
  seen_udfs: set[str] = set()
  for node in nodes:
      new_udfs = [u for u in node.scalar_udfs if u not in seen_udfs]
      if new_udfs:
          seen_udfs.update(new_udfs)
          findings.append(Finding(
              description=f"Scalar UDF {', '.join(new_udfs)} — chạy tuần tự từng hàng...",
              ...
          ))
  ```

---

### 🟡 Severity không scale — AI hiểu sai mức độ

#### SCALE-1 · `row_estimate_mismatch` severity phẳng
- **File:** `operator_analyzer.py:58–70`
- **Vấn đề:** Ratio 10× và 5000× cùng là WARNING, AI không phân biệt được
- **Sửa:**
  ```python
  if ratio >= 100 or ratio <= 0.01:
      severity = Severity.CRITICAL
  elif ratio >= 10 or ratio <= 0.1:
      severity = Severity.WARNING
  ```
- **Description** nên ghi rõ hướng lệch: over-estimate hay under-estimate
  ```python
  direction = "under-estimate" if ratio > 1 else "over-estimate"
  description = f"Row estimate {direction} {ratio:.0f}× tại NodeId={node.node_id}: ..."
  ```

#### SCALE-2 · `WaitAnalyzer` severity luôn WARNING
- **File:** `wait_analyzer.py:37–43`
- **Vấn đề:** Wait 10ms và wait 30,000ms cùng severity
- **Sửa:** Scale theo `wait_time_ms`:
  ```python
  # Blocking (LCK_M_*): CRITICAL nếu > 5000ms
  # Disk IO (PAGEIOLATCH): CRITICAL nếu > 10000ms
  # Memory (RESOURCE_SEMAPHORE): CRITICAL luôn
  # Others: WARNING nếu > 1000ms, INFO nếu thấp hơn
  ```
  Chi tiết:
  ```python
  if wt.startswith("LCK_M_"):
      severity = Severity.CRITICAL if w.wait_time_ms > 5000 else Severity.WARNING
  elif wt.startswith("PAGEIOLATCH"):
      severity = Severity.CRITICAL if w.wait_time_ms > 10000 else Severity.WARNING
  elif wt == "RESOURCE_SEMAPHORE":
      severity = Severity.CRITICAL   # memory pressure luôn nghiêm trọng
  elif wt in {"CXPACKET", "CXCONSUMER"}:
      severity = Severity.WARNING
  elif wt == "SOS_SCHEDULER_YIELD":
      severity = Severity.WARNING
  ```

---

### 🔵 Missing context — AI cần gọi thêm tool không cần thiết

#### CTX-1 · `parameter_sniffing` thiếu data_type và độ chênh lệch
- **File:** `parameter_analyzer.py:18–26`
- **Vấn đề:** `"Compiled value khác runtime value cho @StartDate"` — không biết kiểu gì, chênh bao nhiêu
- **Sửa:** Gộp vào NOISE-3, description mới:
  ```
  "Parameter sniffing: @StartDate (datetime) compiled='2024-01-01' runtime='2025-05-29' — 
   optimizer chọn plan cho giá trị cũ, có thể không phù hợp với distribution hiện tại."
  ```
- Nếu không có `data_type` thì bỏ qua phần kiểu

#### CTX-2 · `non_sargable_implicit` thiếu biểu thức cụ thể
- **File:** `operator_analyzer.py:79–87`
- **Vấn đề:** `"CONVERT_IMPLICIT tại NodeId=5"` — không biết cột nào, kiểu gì
- **Sửa:** Trích xuất expression từ predicate string
  ```python
  # Extract tối đa 150 chars của expression
  import re
  matches = re.findall(r'CONVERT_IMPLICIT\([^)]{0,100}\)', pred)
  expr_hint = matches[0][:150] if matches else "(xem predicate)"
  description = f"CONVERT_IMPLICIT tại NodeId={node.node_id}: {expr_hint} — ép kiểu ngầm làm mất khả năng index seek."
  ```

#### CTX-3 · `WaitAnalyzer` bỏ qua các wait type quan trọng
- **File:** `wait_analyzer.py:19–43`
- **Vấn đề:** `WRITELOG`, `ASYNC_NETWORK_IO`, `IO_COMPLETION`, `PAGEIOLATCH_SH/EX` phân biệt... đều bị `continue`
- **Sửa:** Thêm các nhóm còn thiếu:
  ```python
  elif wt == "WRITELOG":
      t, rec = "wait_log_io", "I/O log chậm: kiểm tra latency ổ đĩa log, tránh small transaction nhiều lần, gom batch."
      severity = Severity.CRITICAL if w.wait_time_ms > 5000 else Severity.WARNING
  elif wt == "ASYNC_NETWORK_IO":
      t, rec = "wait_network", "Client đọc kết quả chậm (network/client-side throttle): xem xét pagination, giảm result set."
      severity = Severity.WARNING
  elif wt == "IO_COMPLETION":
      t, rec = "wait_io_completion", "I/O async completion chậm: kiểm tra storage latency."
      severity = Severity.WARNING
  elif wt.startswith("LATCH_"):
      t, rec = "wait_latch", "Latch contention: hotspot page (PFS/GAM/SGAM) hoặc index contention."
      severity = Severity.WARNING
  else:
      # Unknown wait — vẫn emit INFO thay vì bỏ qua hoàn toàn
      t, rec = "wait_other", f"Wait type {wt} cần điều tra thêm."
      severity = Severity.INFO
  ```

---

### ⚪ Threshold cần xem xét

#### THR-1 · `stale_statistics` dùng ngưỡng tuyệt đối
- **File:** `statistics_analyzer.py:19–29`
- **Vấn đề:** 10,000 modifications trên bảng 50M dòng = bình thường; trên bảng 11,000 dòng = 90% stale
- **Giới hạn:** `StatsUsageItem` không có `row_count` của bảng — không thể tính tỷ lệ từ plan XML
- **Sửa tạm thời:** Raise thêm 1 WARNING nếu `modification_count > 100_000` (absolute high threshold) để phân biệt mức độ
  ```python
  if mod > 100_000:
      severity = Severity.CRITICAL   # dứt khoát stale
  elif mod > 10_000:
      severity = Severity.WARNING    # cần xem xét
  ```
- **Note:** Threshold hoàn hảo cần `row_count` từ DMV — xử lý ở AI Agent layer sau khi query thêm

#### THR-2 · `CompilationAnalyzer` thiếu check `optm_level = "TRIVIAL"`
- **File:** `compilation_analyzer.py:16–43`
- **Vấn đề:** Plan trivial bị optimizer bỏ qua nhiều bước, plan suboptimal nhưng không được flag
- **Sửa:**
  ```python
  if stmt.optm_level == "TRIVIAL":
      findings.append(Finding(
          severity=Severity.INFO,
          type="trivial_plan",
          description="Plan được compile ở mức TRIVIAL — optimizer bỏ qua nhiều bước tối ưu hóa.",
          recommendation="Nếu query chậm, kiểm tra missing index hoặc statistics để optimizer chọn FULL optimization.",
      ))
  ```

---

## Thứ tự thực hiện

```
Bước 1 — Bug (< 30 phút)
  ├─ BUG-1: sửa encoding ParameterAnalyzer
  └─ BUG-2: chuyển _flatten lên base class

Bước 2 — Noisy findings (1–2 giờ)
  ├─ NOISE-3 + CTX-1: gom parameter_sniffing + thêm context (cùng file)
  ├─ NOISE-4: deduplicate scalar_udf
  ├─ NOISE-1: thêm threshold cho key_lookup
  └─ NOISE-2: thêm threshold cho scan_with_predicate

Bước 3 — Severity scaling (1 giờ)
  ├─ SCALE-1: row_estimate_mismatch CRITICAL/WARNING theo ratio
  └─ SCALE-2: WaitAnalyzer severity theo wait_time_ms

Bước 4 — Missing context (1–2 giờ)
  ├─ CTX-2: non_sargable_implicit trích expression
  └─ CTX-3: WaitAnalyzer thêm wait types còn thiếu

Bước 5 — Threshold (30 phút)
  ├─ THR-1: stale_statistics phân 2 mức severity
  └─ THR-2: CompilationAnalyzer thêm TRIVIAL check
```

---

## Files cần sửa

| File | Vấn đề |
|---|---|
| `base.py` | BUG-2: thêm `_flatten()` |
| `operator_analyzer.py` | BUG-2, NOISE-1, NOISE-2, SCALE-1, CTX-2 |
| `parameter_analyzer.py` | BUG-1, NOISE-3, CTX-1 |
| `code_pattern_analyzer.py` | BUG-2, NOISE-4 |
| `wait_analyzer.py` | SCALE-2, CTX-3 |
| `statistics_analyzer.py` | THR-1 |
| `compilation_analyzer.py` | THR-2 |
| `memory_analyzer.py` | không cần sửa |
| `index_analyzer.py` | không cần sửa |
| `parallelism_analyzer.py` | không cần sửa |
