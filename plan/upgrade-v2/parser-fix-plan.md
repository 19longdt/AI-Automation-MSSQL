# Parser Fix Plan — layer2/plan/parser/

Ngày phân tích: 2026-05-30
Scope: `operator_parser.py`, `plan_parser.py`, `statement_parser.py`
Nguyên nhân phát hiện: top operators thiếu so với web tool https://www.mssql.ee/tools/sql-plan-parser.html

---

## P1 · `operator_parser.py:56–61` — Whitelist container thiếu [CRITICAL]

### Vấn đề

`parse_node()` chỉ tìm child RelOp trong 5 container cố định:

```python
for container_tag in ("Children", "NestedLoops", "Hash", "Merge", "Parallelism"):
```

SQL Server plan XML có nhiều operator-specific container khác không nằm trong whitelist.
Bất kỳ node nào nằm dưới `Sort`, `ComputeScalar`, `StreamAggregate`, `Filter`, `Assert`, `Top`,
`Spool`, v.v. đều bị bỏ qua hoàn toàn → cây operator bị cụt → top operators thiếu.

Đã xác nhận từ `partition-seek.xml` của hệ thống:

| Container | Có trong whitelist? |
|---|---|
| `NestedLoops` | ✅ |
| `Hash` | ✅ |
| `Merge` | ✅ |
| `Parallelism` | ✅ |
| `Sort` | ❌ Missing |
| `ComputeScalar` | ❌ Missing |
| `StreamAggregate` | ❌ Missing |
| `Filter`, `Assert`, `Top`, `Spool`, `Bitmap`, `Concatenation`, `Segment`, `WindowAggregate` | ❌ Missing |

Ví dụ cây bị cụt:
```
QueryPlan
  └─ ComputeScalar         ← parser thấy (root RelOp)
       └─ ComputeScalar    ← BỎ QUA
            └─ StreamAggregate  ← BỎ QUA
                 └─ Sort        ← BỎ QUA
                      └─ NestedLoops  ← BỎ QUA (dù trong whitelist, nhưng đã bị cắt từ trên)
```

### Fix

Bỏ whitelist. Duyệt tất cả direct children của `relop_el`, tìm `RelOp` ở 1 cấp trong.
Dedupe bằng `NodeId` để tránh double-count.

**Thay thế lines 56–61:**

```python
# Trước (lines 56–61):
for nested in relop_el.findall(f"./{self._tag('RelOp')}"):
    node.children.append(self.parse_node(nested))
for container_tag in ("Children", "NestedLoops", "Hash", "Merge", "Parallelism"):
    for container in relop_el.findall(self._tag(container_tag)):
        for nested in container.findall(self._tag("RelOp")):
            node.children.append(self.parse_node(nested))

# Sau:
child_relop_map: dict[int, ET.Element] = {}
for child in relop_el:
    child_tag = self._strip_tag(child.tag)
    if child_tag == "RelOp":
        nid = self._to_int(child.get("NodeId"))
        child_relop_map[nid] = child
    else:
        # operator-specific container: Sort, ComputeScalar, StreamAggregate, Filter, v.v.
        for grandchild in child:
            if self._strip_tag(grandchild.tag) == "RelOp":
                nid = self._to_int(grandchild.get("NodeId"))
                child_relop_map[nid] = grandchild
for child_el in child_relop_map.values():
    node.children.append(self.parse_node(child_el))
```

---

## P2 · `operator_parser.py:94–98` — SeekPredicates không extract được [WARNING]

### Vấn đề

```python
def _first_scalar(self, relop_el: ET.Element, name: str) -> str | None:
    target = relop_el.find(f".//{self._tag(name)}/{self._tag('ScalarOperator')}")
```

`Predicate > ScalarOperator` tồn tại ở 1 cấp → OK.

`SeekPredicates` có cấu trúc sâu hơn, `ScalarOperator` không phải direct child:

```xml
<SeekPredicates>
  <SeekPredicateNew>
    <SeekKeys>
      <Prefix ScanType="EQ">
        <RangeExpressions>
          <ScalarOperator ScalarString="[@CustomerID]"/>   ← 4 cấp sâu
```

`SeekPredicates/ScalarOperator` không tồn tại → trả `None` → `seek_predicates = null`
cho mọi Index Seek → `OperatorAnalyzer` không detect được `CONVERT_IMPLICIT` trong seek key.

### Fix

Thay `_first_scalar` để collect tất cả `ScalarString` bên trong container bằng `iter()`:

```python
# Trước:
def _first_scalar(self, relop_el: ET.Element, name: str) -> str | None:
    target = relop_el.find(f".//{self._tag(name)}/{self._tag('ScalarOperator')}")
    if target is None:
        return None
    return target.get("ScalarString")

# Sau:
def _first_scalar(self, relop_el: ET.Element, name: str) -> str | None:
    container = relop_el.find(f".//{self._tag(name)}")
    if container is None:
        return None
    parts = [
        el.get("ScalarString", "")
        for el in container.iter(self._tag("ScalarOperator"))
        if el.get("ScalarString")
    ]
    return "; ".join(parts) if parts else None
```

**Lưu ý:** Dùng `.//{name}` (có `//`) để tìm container bất kể nó nằm cấp nào trong relop_el.
`iter()` bên trong container tự nhiên không đi vào child RelOp vì child RelOp là sibling,
không phải descendant của container.

---

## P3 · `plan_parser.py:35–41` — Outer EXEC wrapper tạo statement rỗng [WARNING]

### Vấn đề

`iter(StmtSimple)` trả tất cả `StmtSimple` ở mọi cấp, kể cả outer EXEC wrapper
của stored procedure — cái này không có `QueryPlan` trực tiếp:

```xml
<StmtSimple StatementText="EXEC dbo.MyProc @p1=N'...'" StatementType="EXECUTE">
  <!-- không có QueryPlan ở đây -->
  <StmtSimple StatementText="SELECT o.OrderID FROM dbo.Orders...">
    <QueryPlan>...</QueryPlan>   ← cái này mới có plan
  </StmtSimple>
</StmtSimple>
```

Parser tạo `ParsedStatement` cho EXEC wrapper với `total_cost=0`, `root_node=None`,
`statement_text="EXEC dbo.MyProc ..."`. Statement này được append vào `statements[]`
và trở thành `statements[0]` — cái mà analyzer và pipeline đọc đầu tiên.

### Fix

Bỏ qua `StmtSimple` không có `QueryPlan` con trực tiếp:

```python
# Trước:
for stmt_el in root.iter(self._tag("StmtSimple")):
    stmt = self._statement_parser.parse(stmt_el)
    if stmt is None:
        continue
    self._index_parser.parse_into(stmt, stmt_el)
    self._operator_parser.parse_into(stmt, stmt_el)
    statements.append(stmt)

# Sau:
for stmt_el in root.iter(self._tag("StmtSimple")):
    # Bỏ qua outer wrapper (EXEC, batch container) không có QueryPlan con
    if stmt_el.find(f".//{self._tag('QueryPlan')}") is None:
        continue
    stmt = self._statement_parser.parse(stmt_el)
    if stmt is None:
        continue
    self._index_parser.parse_into(stmt, stmt_el)
    self._operator_parser.parse_into(stmt, stmt_el)
    statements.append(stmt)
```

**Lưu ý:** Dùng `.//{QueryPlan}` chứ không phải `./{QueryPlan}` vì `QueryPlan` là child
của `StmtSimple` nhưng có thể cách 1 cấp qua `StmtCondition` trong một số plan type.

---

## P4 · `statement_parser.py:15` — StatementText bị truncate không có dấu hiệu [INFO]

### Vấn đề

SQL Server truncates `StatementText` ở 4000 ký tự trong một số DMV và plan cache.
Hiện tại parser không phân biệt text đầy đủ hay bị cắt → AI Agent có thể đọc
query không đầy đủ mà không biết.

### Fix

Thêm flag `statement_text_truncated` vào `ParsedStatement`:

```python
# statement_parser.py — thêm vào ParsedStatement sau khi set statement_text:
stmt.statement_text = stmt_el.get("StatementText", "")
stmt.statement_text_truncated = len(stmt.statement_text) >= 3990
```

Thêm field vào `ParsedStatement` model (`parsed_plan.py`):
```python
statement_text_truncated: bool = False
```

Và truyền flag này vào `StatementResult` để AI Agent / UI biết:
```python
# service.py — trong StatementResult construction:
statement_text_truncated=stmt.statement_text_truncated,
```

Thêm field vào `StatementResult` model (`result.py`):
```python
statement_text_truncated: bool = False
```

---

## Thứ tự thực hiện

```
Bước 1 — P1 (30 phút) · operator_parser.py lines 56–61
  → Fix ngay: bỏ whitelist, dùng child traversal chung
  → Kiểm tra: flatten() trên partition-seek.xml phải trả đủ 13 nodes

Bước 2 — P3 (15 phút) · plan_parser.py lines 35–41
  → Fix: skip StmtSimple không có QueryPlan
  → Kiểm tra: plan của stored proc không còn statement rỗng đầu tiên

Bước 3 — P2 (20 phút) · operator_parser.py _first_scalar
  → Fix: dùng iter() để collect SeekPredicates
  → Kiểm tra: Index Seek nodes có seek_predicates không còn null

Bước 4 — P4 (20 phút) · statement_parser.py + models
  → Thêm flag statement_text_truncated vào model + parser + service
```

---

## Files cần sửa

| File | Bước | Thay đổi |
|---|---|---|
| `layer2/plan/parser/operator_parser.py` | P1, P2 | Lines 56–61 (child traversal) + `_first_scalar` |
| `layer2/plan/parser/plan_parser.py` | P3 | Skip StmtSimple không có QueryPlan |
| `layer2/plan/parser/statement_parser.py` | P4 | Thêm truncation flag |
| `layer2/plan/models/parsed_plan.py` | P4 | Thêm `statement_text_truncated: bool = False` |
| `layer2/plan/models/result.py` | P4 | Thêm `statement_text_truncated: bool = False` |
| `layer2/plan/service.py` | P4 | Truyền flag vào StatementResult |
