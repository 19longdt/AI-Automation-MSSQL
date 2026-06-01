# Plan: Highlight Keywords trong Finding Text (Option B — Backtick Convention)

## Mục tiêu

Làm nổi bật các identifier, SQL keywords, và số liệu quan trọng trong
`description` và `recommendation` của findings — thay vì hiển thị thuần text.

---

## Convention

Dùng **backtick** `` ` `` để đánh dấu nội dung cần render thành `<code>`:

```python
# Trước
description=f"Key Lookup tại NodeId={node.node_id}, bảng={node.table_name}"
recommendation="Tạo covering index bằng cách INCLUDE các cột..."

# Sau
description=f"Key Lookup tại `NodeId={node.node_id}`, bảng=`{node.table_name}`"
recommendation="Tạo covering index bằng cách `INCLUDE` các cột..."
```

Renderer TypeScript chuyển `` `text` `` → `<code class="pa-kw">text</code>`.

---

## Phân loại những gì cần backtick

### Trong `description` (instance-specific)

| Pattern | Ví dụ | Backtick |
|---|---|---|
| Tên bảng/schema | `dbo.rs_inoutward_detail` | ✅ |
| Tên index/statistic | `idx_rs_inoutward_detail_fromWarehouseId` | ✅ |
| NodeId | `NodeId=7` | ✅ (muted style) |
| Physical operator | `Hash Match`, `Index Scan` | ✅ |
| SQL expression | `CONVERT_IMPLICIT(varchar...)` | ✅ |
| Số liệu với đơn vị | `500×`, `27%`, `170272 lần` | **bold** (không cần backtick) |

### Trong `recommendation` (shared per group)

| Pattern | Ví dụ | Backtick |
|---|---|---|
| SQL keywords/commands | `UPDATE STATISTICS`, `CREATE INDEX`, `WITH FULLSCAN` | ✅ |
| SQL clauses | `INCLUDE`, `ORDER BY`, `GROUP BY` | ✅ |
| Options/hints | `OPTIMIZE FOR`, `RECOMPILE`, `WITH (NOLOCK)` | ✅ |
| Technology terms | `iTVF`, `CXPACKET`, `DOP`, `CE 70` | ✅ |
| Compatibility level | `150`, `120` | không — context không rõ |
| Numbered steps `(1)`, `(2)` | giữ nguyên | ✅ styled differently |

### Không backtick

- Prose thuần: "Xem xét index theo ORDER BY để..."
- Số % / số thường trong prose

---

## Renderer function

Thêm vào `plan-analysis-component.ts`:

```typescript
private _renderText(text: string): string {
    // `` `code` `` → <code class="pa-kw">code</code>
    var escaped = this._esc(text);
    return escaped.replace(/`([^`]+)`/g, "<code class='pa-kw'>$1</code>");
}
```

Dùng trong `_buildWarningsSection`:
```typescript
// Thay _esc() bằng _renderText() cho description và recommendation
"<div class='pa-finding-desc'>" + this._renderText(g.instances[0].description) + "</div>"
"<div class='pa-recommendation'>" + this._renderText(g.recommendation) + "</div>"
// Instances:
"<span class='pa-finding-inst-desc'>" + this._renderText(inst.description) + "</span>"
```

**Lưu ý:** `_renderText` phải escape HTML trước khi apply backtick regex — đảm bảo không bị XSS.

---

## CSS cần thêm

```css
/* plan-analysis.css */
code.pa-kw {
  font-family: var(--font-code);
  font-size: 11px;
  background: var(--color-code-bg);
  color: var(--color-code-text);
  border: 1px solid var(--color-code-border);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}

/* Light mode: subtle blue tint cho SQL keywords */
:root code.pa-kw {
  background: var(--color-primary-soft);
  color: var(--color-accent-strong);
  border-color: var(--color-accent-border);
}

/* Dark mode: keep code style */
:root[data-theme="dark"] code.pa-kw {
  background: var(--color-surface-soft);
  color: var(--color-code-text);
  border-color: var(--color-code-border);
}
```

---

## Danh sách strings cần cập nhật (29 recommendation + 29 description = 58 strings)

### `operator_analyzer.py` (10 desc + 9 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | key_lookup desc | `bảng=\`{node.table_name}\`` |
| 2 | key_lookup rec | `\`INCLUDE\`` |
| 3 | rid_lookup desc | không có identifier → OK |
| 4 | sort_expensive desc | `\`Sort #{node.node_id}\`` |
| 5 | sort_expensive rec | `\`ORDER BY\``, `\`GROUP BY\`` |
| 6 | hash_match desc | `\`Hash Match\``, `NodeId` |
| 7 | scan_with_predicate desc | `\`{op}\``, `NodeId` |
| 8 | row_underestimate desc | `\`{op_label}\``, `NodeId` |
| 9 | row_underestimate rec | `\`UPDATE STATISTICS WITH FULLSCAN\`` |
| 10 | row_overestimate desc | `\`{op_label}\``, `NodeId` |
| 11 | row_overestimate rec | `\`UPDATE STATISTICS WITH FULLSCAN\`` |
| 12 | spill_to_tempdb desc | `\`{node.physical_op}\``, `NodeId` |
| 13 | spill_to_tempdb rec | `\`Sort\`/\`Hash\`` |
| 14 | non_sargable desc | `\`CONVERT_IMPLICIT\``, `NodeId` |
| 15 | non_sargable rec | `\`VARCHAR\``, `\`NVARCHAR\``, `\`INT\``, `\`BIGINT\`` |

### `statistics_analyzer.py` (3 desc + 3 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | stale_statistics desc | `\`{s.table}\``, `\`{s.statistic}\`` |
| 2 | stale_statistics rec | `\`UPDATE STATISTICS {s.table} {s.statistic} WITH FULLSCAN\`` |
| 3 | low_sampling desc | `\`{s.statistic}\`` |
| 4 | low_sampling rec | `\`UPDATE STATISTICS WITH FULLSCAN\`` |
| 5 | never_updated desc | `\`{s.statistic}\`` |
| 6 | never_updated rec | `\`UPDATE STATISTICS {s.table}\`` |

### `compilation_analyzer.py` (4 desc + 4 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | high_compile_cpu desc | số `{compile_cpu_ms}ms` → bold (không backtick) |
| 2 | compile_memory_exceeded rec | không cần |
| 3 | ce_model_legacy rec | `\`compatibility level\`` lên `150` |
| 4 | trivial_plan rec | `\`FULL\`` optimization |

### `memory_analyzer.py` (4 desc + 4 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | memory_spill_risk desc | `\`Sort\`/\`Hash\`` |
| 2 | memory_spill_risk rec | `\`Sort\`/\`Hash\`` |
| 3 | memory_large_grant desc | số MB → bold |
| 4 | memory_grant_wait rec | `\`max server memory\`` |

### `operator_analyzer` — `index_analyzer.py` (3 desc + 2 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | missing_index desc | `\`{table}\`` |
| 2 | missing_index rec | `\`INSERT\`/\`UPDATE\`` |
| 3 | wide_index desc | `\`{table}\`` |

### `parallelism_analyzer.py` (2 desc + 2 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | ineffective_parallelism rec | `\`CXPACKET\``, `\`DOP\`` |
| 2 | serial_plan_actionable rec | `\`MAXDOP\`` |

### `parameter_analyzer.py` (2 desc + 2 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | sniffing desc | param names |
| 2 | sniffing rec | `\`OPTIMIZE FOR\``, `\`RECOMPILE\`` |

### `code_pattern_analyzer.py` (2 desc + 2 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | scalar_udf desc | `\`Scalar UDF\`` |
| 2 | scalar_udf rec | `\`iTVF\`` |

### `wait_analyzer.py` (1 desc + 1 rec)

| # | Type | Thay đổi |
|---|---|---|
| 1 | wait_anomaly desc | `\`{wt}\`` wait type |
| 2 | wait_anomaly rec | per-type: `\`CXPACKET\``, `\`PAGEIOLATCH\`` etc. |

---

## Trình tự implement

- [ ] **Bước 1 — CSS** (`plan-analysis.css`): Thêm `.pa-kw` style (light + dark)
- [ ] **Bước 2 — Renderer** (`plan-analysis-component.ts`): Thêm `_renderText()`, áp dụng cho desc/rec
- [ ] **Bước 3 — Build + smoke test** UI trước khi sửa Python (verify renderer hoạt động với text mẫu)
- [ ] **Bước 4 — Python analyzers**: Cập nhật strings theo thứ tự: `statistics_analyzer` → `operator_analyzer` → `compilation_analyzer` → `memory_analyzer` → `index_analyzer` → `parallelism_analyzer` → `parameter_analyzer` → `code_pattern_analyzer` → `wait_analyzer`
- [ ] **Bước 5 — End-to-end test**: Trigger plan analysis, verify toàn bộ 9 analyzers render đúng

---

## Ví dụ before/after

### stale_statistics (grouped ×8)

**Trước:**
```
STATS: STALE STATISTICS
Cập nhật statistics: UPDATE STATISTICS dbo.rs_inoutward_detail
idx_rs_inoutward_detail_fromWarehouseId WITH FULLSCAN; Đặt lịch maintenance
hoặc bật auto_update_stats_async.

• Statistics idx_a trên dbo.rs_inoutward_detail có 170272 lần thay đổi
• Statistics idx_b trên dbo.rs_inoutward có 11193 lần thay đổi
```

**Sau:**
```
STATS: STALE STATISTICS
Cập nhật statistics: [UPDATE STATISTICS dbo.rs_inoutward_detail idx_a WITH FULLSCAN]
Đặt lịch maintenance hoặc bật auto_update_stats_async.

• Statistics [idx_a] trên [dbo.rs_inoutward_detail] có 170272 lần thay đổi
• Statistics [idx_b] trên [dbo.rs_inoutward] có 11193 lần thay đổi
```
_(`[]` = rendered as `<code class="pa-kw">`)_

### row_underestimate

**Trước:**
```
Hash Match [rs_inoutward] (NodeId=7): under-estimate 500× — optimizer ước lượng
1 hàng nhưng thực tế 500 hàng.
```

**Sau:**
```
[Hash Match] [[rs_inoutward]] ([NodeId=7]): under-estimate 500× — optimizer ước lượng
1 hàng nhưng thực tế 500 hàng.
```

---

## Rủi ro

| Rủi ro | Mức | Giải pháp |
|---|---|---|
| Quên escape HTML trước khi apply regex | Cao | `_renderText` = `_esc()` trước, regex sau |
| Backtick trong tên bảng thực (hiếm) | Thấp | Không ảnh hưởng vì tên bảng SQL không dùng backtick |
| String quá dài trong backtick làm vỡ layout | Thấp | CSS `white-space: nowrap` + `overflow: hidden` |
| AI Agent nhận text có backtick thô | Thấp | `ToolSnapshot.summary` dùng `description`/`recommendation` trực tiếp — backtick là văn bản bình thường, Claude hiểu được |
