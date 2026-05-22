# Layer 2 — Architecture Improvements Plan

Ngày: 2026-04-22
Thảo luận: Long Do + Claude Opus 4.6

---

## Mục tiêu

1. **Giảm chi phí** ~70% per analysis bằng cách giảm tokens input
2. **Tăng chất lượng** bằng cách cho Claude data đã pre-process thay vì raw
3. **Tăng kiểm soát** qua tool filtering, cost budget, quality enforcement
4. **Linh hoạt cho nhiều loại phân tích** — không chỉ slow query

---

## Nguyên tắc thiết kế

**Tách Mechanical (deterministic) khỏi Creative (cần AI)**:
- Claude KHÔNG nên parse XML, đếm partitions, extract table names
- Claude NÊN diễn giải patterns, tìm mối liên hệ, đưa ra recommendations
- Pre-processing bằng Python code → structured data → Claude interprets

---

## Phase 1 — Quick Wins (không thay đổi architecture)

### 1.0 Chuẩn hoá Output Format — Giảm output tokens

**Vấn đề**: Output hiện tại không có cấu trúc chuẩn. Claude viết tự do 2000-4000 output tokens.
Output tokens Sonnet = $15/M — **đắt gấp 5x input** ($3/M). Viết lan man = đốt tiền.

**Hiện tại** (`_base.yaml`): Chỉ nói "plain text, KHÔNG dùng markdown" — không có format template.
Claude tự quyết structure, độ dài, level of detail → kết quả không đồng nhất, thường dài.

**Mục tiêu**: Output file ~600-1200 tokens thay vì 2000-4000 → **tiết kiệm ~60% output cost**.

---

**Output template chuẩn** — thêm vào `_base.yaml`:

```yaml
base_system_prompt: |
  [... giữ nguyên phần role + analysis principles ...]

  Định dạng output: plain text, KHÔNG dùng markdown.
  
  BẮT BUỘC viết theo cấu trúc sau, mỗi section ngắn gọn:
  
  ROOT CAUSE
  <2-3 câu: nguyên nhân gốc rễ, dựa trên evidence từ tools>
  
  BANG CHUNG
  - <data point 1 từ tool, có số liệu cụ thể>
  - <data point 2>
  - <data point 3>
  (tối đa 5 dòng, mỗi dòng 1 evidence cụ thể có số liệu)
  
  ANH HUONG
  <1-2 câu: scope ảnh hưởng, severity thực tế>
  
  HANH DONG
  1. [CAO] <action cụ thể, có thể thực thi ngay, có syntax nếu là SQL>
  2. [TRUNG BINH] <action>
  3. [THAP] <action>
  (tối đa 5 actions, sắp theo priority)
  
  GHI CHU
  <1-2 câu nếu có: cảnh báo, điều cần theo dõi thêm, hoặc bỏ trống nếu không có>

  Quy tắc viết:
  - KHÔNG lặp lại thông tin finding (node, time, query hash) — đã có trong caption
  - KHÔNG giải thích lý thuyết chung (vd: "partition elimination là gì") — DBA đã biết
  - KHÔNG liệt kê tất cả data từ tools — chỉ trích dẫn evidence liên quan đến root cause
  - MỖI câu phải chứa số liệu cụ thể hoặc tên object cụ thể
  - Toàn bộ phân tích KHÔNG quá 400 từ (không tính <insight> block)

  SAU KHI PHÂN TÍCH XONG, bắt buộc kết thúc bằng:
  <insight>
  { ... JSON ... }
  </insight>
```

---

**Ví dụ output TRƯỚC (hiện tại, ~2500 tokens)**:
```
Tôi đã kiểm tra query hash 0xABCD1234 trên node SQL-01.

Đầu tiên, tôi gọi get_query_stats và thấy query có avg_elapsed_ms = 1200ms,
avg_logical_reads = 450000. Query này chạy khá chậm.

Tiếp theo, tôi kiểm tra Query Store history bằng get_query_store_history.
Kết quả cho thấy query có 2 plan: plan_id=1 với avg 300ms và plan_id=2
với avg 2100ms. Plan 2 bắt đầu xuất hiện từ 2026-04-15.

Điều này cho thấy có plan regression. Plan cũ (plan_id=1) tốt hơn nhiều
so với plan mới (plan_id=2).

Tôi tiếp tục kiểm tra statistics bằng get_statistics_info trên bảng bill.
Statistics cho thấy last_updated = 2026-04-10, tức là 12 ngày trước.
modification_counter = 15000000, cho thấy rất nhiều rows đã thay đổi
kể từ lần update statistics cuối.

Partition elimination: Query có WHERE norm_quarter = 20261 nên partition
elimination hoạt động đúng. Không phải vấn đề ở đây.

Kết luận: Root cause là plan regression do stale statistics trên bảng bill.
Statistics chưa được update 12 ngày, trong khi 15M rows đã thay đổi,
dẫn đến cardinality estimate sai và SQL Server chọn plan kém hơn.

Khuyến nghị:
1. Chạy UPDATE STATISTICS dbo.bill WITH FULLSCAN ngay
2. Force plan_id=1 trong Query Store tạm thời
3. Review lại auto statistics schedule

<insight>...</insight>
```

**Ví dụ output SAU (format mới, ~800 tokens)**:
```
ROOT CAUSE
Plan regression trên query 0xABCD1234 do stale statistics bảng bill.
Statistics cũ 12 ngày + 15M rows modified → cardinality estimate sai → plan kém.

BANG CHUNG
- Query Store: plan_id=1 avg 300ms (tốt), plan_id=2 avg 2100ms (xấu, xuất hiện từ 15/04)
- Statistics bill: last_updated 10/04, modification_counter 15M, sample_pct 2.1%
- dm_exec_query_stats: avg_elapsed 1200ms, avg_logical_reads 450K

ANH HUONG
Query chạy chậm 7x so với plan cũ. execution_count 12K/ngày → ảnh hưởng throughput đáng kể.

HANH DONG
1. [CAO] UPDATE STATISTICS dbo.bill WITH FULLSCAN — fix cardinality estimate ngay
2. [CAO] EXEC sp_query_store_force_plan @query_id=1234, @plan_id=1 — force plan tốt tạm thời
3. [TRUNG BINH] Review auto statistics job — schedule chạy hàng ngày thay vì mặc định

GHI CHU
CDC enabled trên bill → DML cao → statistics drift nhanh. Cân nhắc tăng frequency update.

<insight>...</insight>
```

**Giảm**: 2500 → 800 tokens = **-68% output tokens** = **-$0.025/analysis** (Sonnet)

---

**Giảm max_tokens theo category** (vì output ngắn hơn, không cần buffer lớn):

| Category | max_tokens hiện tại | max_tokens mới | Lý do |
|----------|-------------------|---------------|-------|
| A: Query (Sonnet) | 4096 | 2500 | Output ~800-1200 tokens + insight ~300 tokens |
| B: Infra (Haiku) | 2048 | 1500 | Output ~500-800 tokens + insight ~200 tokens |
| C: Lock (Sonnet) | 3000 | 2000 | Output ~600-1000 tokens + insight ~300 tokens |
| D: Maint (Haiku) | 1500 | 1000 | Output ~400-600 tokens + insight ~200 tokens |

**Lưu ý**: max_tokens là CAP, không phải target. Claude có thể dùng ít hơn. Nhưng cap thấp hơn
buộc Claude phải cô đọng hơn khi gần limit.

---

**Files sửa**:
- `skills/_base.yaml`: Thay phần format output bằng template mới
- Tất cả skill YAMLs: Giảm max_tokens theo bảng trên

---

### 1.1 Filter tools theo skill config

**File sửa**: `agent/orchestrator.py`, `agent/tool_registry.py`

**Hiện tại** (orchestrator.py:203):
```python
all_tools = build_claude_tools()  # luôn 15 tools
```

**Thay đổi**:

Thêm function trong `tool_registry.py`:
```python
def build_tools_for_skill(skill: AnalysisSkill) -> list[dict]:
    """
    Trả về tools CHỈ trong skill.required_tools + skill.optional_tools.
    Luôn thêm base_tools (get_table_context, get_analysis_history) nếu tồn tại.
    """
    allowed = set(skill.required_tools) | set(skill.optional_tools)
    # Base tools mọi skill nên có access (thêm sau khi implement Phase 2)
    # allowed |= BASE_TOOL_NAMES
    return [
        {"name": td.name, "description": td.description, "input_schema": td.input_schema}
        for td in TOOL_REGISTRY.values()
        if td.name in allowed
    ]
```

Sửa `orchestrator.py`:
```python
# Thay vì:
all_tools = build_claude_tools()

# Dùng:
from .tool_registry import build_tools_for_skill
skill_tools = build_tools_for_skill(skill)
```

**Impact**: Giảm ~1500 tokens/call. slow_sessions: 8 tools thay vì 15. blocking: 5 tools.

---

### 1.2 Tool result truncation

**File sửa**: `agent/tool_executor.py`

**Thêm vào ToolExecutor** (sau khi execute, trước khi return):
```python
MAX_TOOL_RESULT_ROWS = 20  # có thể config per tool
MAX_TOOL_RESULT_CHARS = 5000

def _truncate_result(self, result: Any, tool_name: str) -> Any:
    """Truncate tool result để giữ context gọn."""
    if isinstance(result, list) and len(result) > MAX_TOOL_RESULT_ROWS:
        total = len(result)
        result = result[:MAX_TOOL_RESULT_ROWS]
        result.append({"_truncated": True, "_total_rows": total, 
                       "_shown": MAX_TOOL_RESULT_ROWS})
    return result
```

Gọi trong `execute()`:
```python
result = self._dispatch(tool_name, tool_input)
result = self._truncate_result(result, tool_name)
```

**Impact**: Ngăn tool result phình to. Đặc biệt quan trọng cho get_wait_stats, get_index_usage.

---

### 1.3 Thêm `max_cost_usd` vào skill config

**File sửa**: `models/skill.py`, `agent/orchestrator.py`

Thêm field trong `AnalysisSkill`:
```python
max_cost_usd: float = Field(
    default=0.15,
    description="Budget tối đa USD cho 1 analysis. Vượt → force end_turn.",
)
```

Thêm check trong agentic loop (`orchestrator.py`, trong while loop):
```python
# Sau khi tích lũy tokens:
current_cost = calculate_cost(
    skill.model or settings.claude_model,
    result.input_tokens, result.output_tokens,
    result.cache_read_tokens, result.cache_creation_tokens,
)
if current_cost > skill.max_cost_usd:
    logger.warning(
        "Cost budget exceeded: $%.4f > $%.4f, forcing end_turn analysis_id=%s",
        current_cost, skill.max_cost_usd, result.analysis_id,
    )
    remaining_rounds = 0  # Force next call without tools
```

**Cập nhật skill YAMLs**:
```yaml
# slow_sessions.yaml
max_cost_usd: 0.15

# index.yaml (dùng Haiku)
max_cost_usd: 0.05

# blocking.yaml
max_cost_usd: 0.10

# generic.yaml
max_cost_usd: 0.10
```

---

### 1.4 Enforce required_tools

**File sửa**: `agent/orchestrator.py`

Trong `_agentic_loop()`, trước khi chấp nhận `end_turn`:
```python
# Sau khi nhận response với stop_reason != "tool_use":
if response.stop_reason != "tool_use" or remaining_rounds <= 0:
    # Check required_tools đã được gọi chưa
    called_tools = {tc.tool_name for tc in result.tool_calls}
    missing = set(skill.required_tools) - called_tools
    
    if missing and remaining_rounds > 0:
        # Inject reminder, cho Claude thêm 1 round
        reminder = (
            f"Bạn chưa gọi các tools bắt buộc: {', '.join(missing)}. "
            "Hãy gọi chúng trước khi kết luận phân tích."
        )
        messages.append({"role": "user", "content": reminder})
        remaining_rounds = 1  # Cho thêm 1 round
        continue
    
    result.analysis_text = _extract_text_blocks(response.content)
    result.status = AnalysisStatus.COMPLETED
    return
```

**Impact**: Claude phải gọi required tools trước khi kết luận → phân tích dựa trên đủ data.

---

### 1.5 Insight retry

**File sửa**: `agent/orchestrator.py`

Trong `_execute()`, sau khi extract insight:
```python
insight = _extract_insight(result)

# Retry 1 lần nếu không có insight block
if insight is None and result.analysis_text:
    logger.info("Insight missing, retrying analysis_id=%s", result.analysis_id)
    retry_msg = (
        "Response thiếu block <insight>JSON</insight> bắt buộc. "
        "Hãy thêm block này vào cuối response dựa trên phân tích trên."
    )
    messages.append({"role": "user", "content": retry_msg})
    
    retry_response = self._client.messages.create(
        model=skill.model or settings.claude_model,
        max_tokens=1500,
        system=system,
        messages=messages,
        # Không truyền tools — chỉ cần text
    )
    # Tích lũy tokens
    result.input_tokens += retry_response.usage.input_tokens
    result.output_tokens += retry_response.usage.output_tokens
    result.cache_read_tokens += getattr(retry_response.usage, "cache_read_input_tokens", 0)
    result.cache_creation_tokens += getattr(retry_response.usage, "cache_creation_input_tokens", 0)
    
    retry_text = _extract_text_blocks(retry_response.content)
    if retry_text:
        result.analysis_text = result.analysis_text + "\n\n" + retry_text
        insight = _extract_insight(result)
```

**Impact**: Tăng tỷ lệ có structured insight data → recurrence tracking hoạt động đúng.

---

### 1.6 Fix bugs đã phát hiện

**a) Cost calculation wrong model** (`orchestrator.py:148`):
```python
# Thay:
result.cost_usd = calculate_cost(settings.claude_model, ...)
# Bằng:
result.cost_usd = calculate_cost(result.model, ...)
```

**b) ThreadPoolExecutor per-request** (`api/routes/analysis.py:26`):
```python
# Thay:
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    result = await loop.run_in_executor(pool, orch.run, body)
# Bằng:
result = await loop.run_in_executor(None, orch.run, body)
```

**c) Remove dead code** (`notifications/telegram_bot.py`):
Xóa function `_format_analysis()` (lines 416-449).

---

## Phase 2 — Core: Pre-processing Tools

### 2.1 Tool: `get_plan_analysis(finding_id)`

**File mới**: `executor/plan_analyzer.py`

**Logic** (Python, dùng xml.etree.ElementTree — stdlib, không cần lxml):

```python
"""
plan_analyzer.py — Parse XML execution plan, extract structured patterns.

Input: query_plan_xml string (từ finding trong MongoDB)
Output: dict với operators, warnings, partition info, etc.

Deterministic — không dùng AI, không tốn tokens.
"""
import xml.etree.ElementTree as ET
from typing import Any

# SQL Server Showplan namespace
NS = {"sp": "http://schemas.microsoft.com/sqlserver/2004/07/showplan"}


def analyze_plan(plan_xml: str) -> dict[str, Any]:
    """Parse execution plan XML và extract structured summary."""
    if not plan_xml or not plan_xml.strip():
        return {"error": "Empty plan XML"}
    
    try:
        root = ET.fromstring(plan_xml)
    except ET.ParseError as e:
        return {"error": f"XML parse error: {e}"}
    
    result = {
        "top_operators": _extract_operators(root),
        "warnings": _extract_warnings(root),
        "partition_info": _extract_partition_info(root),
        "implicit_conversions": _extract_conversions(root),
        "missing_index_hints": _extract_missing_indexes(root),
        "parallelism": _extract_parallelism(root),
        "spill_warnings": _extract_spills(root),
        "estimated_cost": _extract_total_cost(root),
    }
    return result


def _extract_operators(root: ET.Element) -> list[dict]:
    """Extract top expensive operators (Scan, Lookup, Sort, Hash Match)."""
    operators = []
    for relop in root.iter(f"{{{NS['sp']}}}RelOp"):
        op_type = relop.get("PhysicalOp", "")
        est_rows = float(relop.get("EstimateRows", 0))
        est_cost = float(relop.get("EstimatedTotalSubtreeCost", 0))
        actual_rows = float(relop.get("ActualRows", 0)) if relop.get("ActualRows") else None
        
        # Chỉ giữ operators đáng chú ý
        if op_type in ("Index Scan", "Table Scan", "Clustered Index Scan",
                        "Key Lookup", "RID Lookup", "Sort", "Hash Match",
                        "Index Seek", "Clustered Index Seek"):
            # Tìm table name
            table_name = ""
            for obj in relop.iter(f"{{{NS['sp']}}}Object"):
                table_name = obj.get("Table", "").strip("[]")
                break
            
            op = {
                "type": op_type,
                "table": table_name,
                "estimated_rows": est_rows,
                "estimated_cost": round(est_cost, 4),
            }
            if actual_rows is not None:
                op["actual_rows"] = actual_rows
                if est_rows > 0:
                    op["estimate_ratio"] = round(actual_rows / est_rows, 2)
            
            operators.append(op)
    
    # Sort by cost, top 10
    operators.sort(key=lambda x: x["estimated_cost"], reverse=True)
    return operators[:10]


def _extract_warnings(root: ET.Element) -> list[str]:
    """Extract warning types."""
    warnings = set()
    for w in root.iter(f"{{{NS['sp']}}}Warnings"):
        for child in w:
            tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            warnings.add(tag)
    return sorted(warnings)


def _extract_partition_info(root: ET.Element) -> dict | None:
    """Extract partition elimination status."""
    for relop in root.iter(f"{{{NS['sp']}}}RelOp"):
        partition_accessed = relop.get("ActualPartitionsAccessed") or relop.get("EstimatedPartitionCount")
        if partition_accessed:
            # Parse "1..22" format
            parts = str(partition_accessed)
            return {
                "partitions_accessed": parts,
                "likely_full_scan": ".." in parts  # rough heuristic
            }
    return None


def _extract_conversions(root: ET.Element) -> list[dict]:
    """Extract CONVERT_IMPLICIT from ScalarOperator expressions."""
    conversions = []
    for scalar in root.iter(f"{{{NS['sp']}}}ScalarOperator"):
        text = scalar.get("ScalarString", "")
        if "CONVERT_IMPLICIT" in text:
            conversions.append({"expression": text[:200]})
    return conversions[:5]  # Top 5


def _extract_missing_indexes(root: ET.Element) -> list[dict]:
    """Extract MissingIndexGroup hints from plan."""
    hints = []
    for mig in root.iter(f"{{{NS['sp']}}}MissingIndexGroup"):
        impact = float(mig.get("Impact", 0))
        for mi in mig.iter(f"{{{NS['sp']}}}MissingIndex"):
            table = mi.get("Table", "").strip("[]")
            equality = []
            inequality = []
            include = []
            for col_group in mi:
                usage = col_group.get("Usage", "")
                for col in col_group.iter(f"{{{NS['sp']}}}Column"):
                    col_name = col.get("Name", "").strip("[]")
                    if usage == "EQUALITY":
                        equality.append(col_name)
                    elif usage == "INEQUALITY":
                        inequality.append(col_name)
                    elif usage == "INCLUDE":
                        include.append(col_name)
            hints.append({
                "table": table,
                "impact_pct": impact,
                "equality_columns": equality,
                "inequality_columns": inequality,
                "include_columns": include,
            })
    return hints


def _extract_parallelism(root: ET.Element) -> dict | None:
    """Extract DOP info."""
    for relop in root.iter(f"{{{NS['sp']}}}RelOp"):
        if relop.get("Parallel") == "true" or relop.get("PhysicalOp") == "Parallelism":
            dop = relop.get("EstimatedAvailableDegreeOfParallelism")
            return {"parallel": True, "estimated_dop": int(dop) if dop else None}
    return None


def _extract_spills(root: ET.Element) -> list[dict]:
    """Extract SpillToTempDb warnings."""
    spills = []
    for w in root.iter(f"{{{NS['sp']}}}SpillToTempDb"):
        spill_level = w.get("SpillLevel")
        spills.append({"spill_level": spill_level or "unknown"})
    return spills


def _extract_total_cost(root: ET.Element) -> float | None:
    """Extract estimated total cost from root operator."""
    for stmt in root.iter(f"{{{NS['sp']}}}StmtSimple"):
        cost = stmt.get("StatementSubTreeCost")
        if cost:
            return round(float(cost), 4)
    return None
```

**Đăng ký tool** — thêm vào `tool_registry.py`:
```python
"get_plan_analysis": ToolDefinition(
    name="get_plan_analysis",
    description=(
        "Phân tích execution plan XML của finding. Trả về structured summary: "
        "top operators (Scan/Seek/Lookup/Sort), warnings, partition elimination status, "
        "implicit conversions, missing index hints, parallelism, spill warnings. "
        "LUÔN gọi tool này TRƯỚC khi phân tích slow_sessions hoặc plan issues — "
        "KHÔNG đọc raw XML, dùng summary từ tool này."
    ),
    input_schema=_schema(
        {"finding_id": {"type": "string", "description": "ID của finding cần phân tích plan"}},
        required=["finding_id"],
    ),
),
```

**Dispatch** — thêm vào `tool_executor.py`:
```python
if tool_name == "get_plan_analysis":
    return ex.get_plan_analysis(finding_id=inp["finding_id"])
```

**DiagnosticExecutor method** — thêm vào `diagnostic_executor.py`:
```python
def get_plan_analysis(self, finding_id: str) -> dict[str, Any]:
    """Load finding từ MongoDB, parse plan XML bằng plan_analyzer."""
    from .plan_analyzer import analyze_plan
    finding = MongoConnection.get_db()["findings"].find_one(
        {"finding_id": finding_id},
        projection={"query_plan_xml": 1, "metrics.query_plan_xml": 1, "_id": 0},
    )
    if not finding:
        return {"error": f"Finding '{finding_id}' không tìm thấy"}
    
    plan_xml = finding.get("query_plan_xml") or (finding.get("metrics") or {}).get("query_plan_xml", "")
    if not plan_xml:
        return {"error": "Finding không có query_plan_xml"}
    
    return analyze_plan(plan_xml)
```

---

### 2.2 Tool: `get_query_structure(finding_id)`

**File mới**: `executor/query_analyzer.py`

**Logic** (dùng `sqlparse` library — đã có trong requirements hoặc thêm vào):

```python
"""
query_analyzer.py — Parse SQL query text, extract structured elements.

Input: query_text string (từ finding)
Output: dict với tables, joins, predicates, order_by, etc.

Dùng regex-based parsing (không cần full SQL parser).
Đủ chính xác cho T-SQL phổ biến trong hệ thống POS.
"""
import re
from typing import Any

# Regex patterns cho T-SQL
_TABLE_RE = re.compile(
    r'\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+'
    r'(?:\[?(\w+)\]?\.)?\[?(\w+)\]?'
    r'(?:\s+(?:AS\s+)?\[?(\w+)\]?)?',
    re.IGNORECASE,
)

_JOIN_RE = re.compile(
    r'\b(INNER|LEFT|RIGHT|CROSS|FULL\s+OUTER?)\s+JOIN\s+'
    r'(?:\[?(\w+)\]?\.)?\[?(\w+)\]?',
    re.IGNORECASE,
)

_WHERE_RE = re.compile(
    r'\bWHERE\s+(.*?)(?=\bGROUP\b|\bORDER\b|\bHAVING\b|\bUNION\b|$)',
    re.IGNORECASE | re.DOTALL,
)

_ORDERBY_RE = re.compile(
    r'\bORDER\s+BY\s+(.*?)(?=\bOFFSET\b|\bFOR\b|$)',
    re.IGNORECASE | re.DOTALL,
)

_GROUPBY_RE = re.compile(
    r'\bGROUP\s+BY\s+(.*?)(?=\bHAVING\b|\bORDER\b|\bUNION\b|$)',
    re.IGNORECASE | re.DOTALL,
)

_FUNCTION_ON_COL_RE = re.compile(
    r'\b(YEAR|MONTH|DAY|DATEPART|CONVERT|CAST|FORMAT|DATEDIFF)\s*\(\s*[\w.]*?(norm_quarter|norm_date|bill_date|created_at|arising_date)',
    re.IGNORECASE,
)


def analyze_query(query_text: str) -> dict[str, Any]:
    """Parse SQL query text và extract structured elements."""
    if not query_text or not query_text.strip():
        return {"error": "Empty query text"}
    
    # Normalize whitespace
    normalized = re.sub(r'\s+', ' ', query_text.strip())
    
    return {
        "tables": _extract_tables(normalized),
        "joins": _extract_joins(normalized),
        "where_summary": _extract_where(normalized),
        "order_by": _extract_orderby(normalized),
        "group_by": _extract_groupby(normalized),
        "function_on_date_columns": _extract_function_on_date(normalized),
        "has_top_or_limit": bool(re.search(r'\bTOP\s*\(?\s*\d+', normalized, re.IGNORECASE)),
        "has_subquery": normalized.upper().count("SELECT") > 1,
        "has_cte": bool(re.search(r'\bWITH\s+\w+\s+AS\s*\(', normalized, re.IGNORECASE)),
        "has_hints": bool(re.search(r'\bWITH\s*\(\s*(NOLOCK|READUNCOMMITTED|FORCESEEK|FORCESCAN)', normalized, re.IGNORECASE)),
        "query_type": _detect_query_type(normalized),
    }


def _extract_tables(sql: str) -> list[dict]:
    tables = []
    seen = set()
    for match in _TABLE_RE.finditer(sql):
        schema = match.group(1) or "dbo"
        table = match.group(2)
        alias = match.group(3) or ""
        key = f"{schema}.{table}"
        if key not in seen:
            seen.add(key)
            tables.append({"schema": schema, "name": table, "alias": alias})
    return tables


def _extract_joins(sql: str) -> list[dict]:
    joins = []
    for match in _JOIN_RE.finditer(sql):
        join_type = match.group(1).upper().strip()
        schema = match.group(2) or "dbo"
        table = match.group(3)
        joins.append({"type": join_type, "table": f"{schema}.{table}"})
    return joins


def _extract_where(sql: str) -> str:
    """Extract WHERE clause, truncated."""
    match = _WHERE_RE.search(sql)
    if not match:
        return ""
    where = match.group(1).strip()
    return where[:500] if len(where) > 500 else where


def _extract_orderby(sql: str) -> str:
    match = _ORDERBY_RE.search(sql)
    return match.group(1).strip()[:200] if match else ""


def _extract_groupby(sql: str) -> str:
    match = _GROUPBY_RE.search(sql)
    return match.group(1).strip()[:200] if match else ""


def _extract_function_on_date(sql: str) -> list[dict]:
    """Detect functions applied on date/partition columns → partition elimination killer."""
    results = []
    for match in _FUNCTION_ON_COL_RE.finditer(sql):
        results.append({
            "function": match.group(1).upper(),
            "column": match.group(2),
            "warning": "Function trên partition/date column → có thể vô hiệu hóa partition elimination",
        })
    return results


def _detect_query_type(sql: str) -> str:
    upper = sql.upper().lstrip()
    if upper.startswith("SELECT"):
        return "SELECT"
    elif upper.startswith("INSERT"):
        return "INSERT"
    elif upper.startswith("UPDATE"):
        return "UPDATE"
    elif upper.startswith("DELETE"):
        return "DELETE"
    elif upper.startswith("EXEC"):
        return "EXEC"
    return "OTHER"
```

**Đăng ký tool** — thêm vào `tool_registry.py`:
```python
"get_query_structure": ToolDefinition(
    name="get_query_structure",
    description=(
        "Phân tích cấu trúc SQL query text của finding. Trả về: tables, joins, "
        "WHERE predicates, ORDER BY, GROUP BY, functions trên partition columns "
        "(gây mất partition elimination), query type. "
        "Gọi tool này thay vì đọc raw query text."
    ),
    input_schema=_schema(
        {"finding_id": {"type": "string", "description": "ID của finding cần phân tích query"}},
        required=["finding_id"],
    ),
),
```

**DiagnosticExecutor method**:
```python
def get_query_structure(self, finding_id: str) -> dict[str, Any]:
    """Load finding từ MongoDB, parse query text bằng query_analyzer."""
    from .query_analyzer import analyze_query
    finding = MongoConnection.get_db()["findings"].find_one(
        {"finding_id": finding_id},
        projection={"query_text": 1, "_id": 0},
    )
    if not finding:
        return {"error": f"Finding '{finding_id}' không tìm thấy"}
    
    query_text = finding.get("query_text", "")
    if not query_text:
        return {"error": "Finding không có query_text"}
    
    return analyze_query(query_text)
```

---

### 2.3 Tool: `get_table_context(table_name)`

**Đăng ký tool** — thêm vào `tool_registry.py`:
```python
"get_table_context": ToolDefinition(
    name="get_table_context",
    description=(
        "Lấy business context cho 1 bảng cụ thể: description, access patterns, "
        "index notes, known performance patterns. "
        "Gọi tool này khi cần hiểu bảng liên quan — KHÔNG đọc toàn bộ db_context."
    ),
    input_schema=_schema(
        {"table_name": {"type": "string", "description": "Tên bảng (vd: bill, bill_product, inventory)"}},
        required=["table_name"],
    ),
),
```

**DiagnosticExecutor method**:
```python
def get_table_context(self, table_name: str) -> dict[str, Any]:
    """Lấy db_context cho 1 table cụ thể từ MongoDB db_context collection."""
    db_ctx = MongoConnection.get_db()["db_context"].find_one(
        {"context_id": "main"},
        projection={"business_context": 1, "_id": 0},
    )
    if not db_ctx or not db_ctx.get("business_context"):
        return {"error": "db_context chưa được collect. Gọi POST /admin/refresh-db-context."}
    
    biz = db_ctx["business_context"]
    
    # Tìm table trong critical_tables
    table_info = None
    for t in biz.get("critical_tables", []):
        if t.get("name", "").lower() == table_name.lower():
            table_info = t
            break
    
    if not table_info:
        return {"info": f"Bảng '{table_name}' không có trong db_context. Có thể là bảng nhỏ hoặc ít quan trọng."}
    
    # Tìm known patterns liên quan
    related_patterns = []
    for p in biz.get("known_patterns", []):
        desc = p.get("description", "") + p.get("pattern", "")
        if table_name.lower() in desc.lower():
            related_patterns.append(p)
    
    result = {
        "table": table_info,
        "related_patterns": related_patterns,
    }
    
    # Thêm resource_governor nếu relevant
    if biz.get("resource_governor"):
        result["resource_governor_note"] = biz["resource_governor"].get("classifier_note", "")
    
    return result
```

---

### 2.4 Tool: `get_analysis_history(finding_id | issue_type + node)`

**Đăng ký tool**:
```python
"get_analysis_history": ToolDefinition(
    name="get_analysis_history",
    description=(
        "Lấy lịch sử phân tích cho cùng pattern: recurrence count, previous root causes, "
        "actions đã resolved hay chưa. Dùng để biết finding này là lần đầu hay recurring, "
        "và tham khảo phân tích trước."
    ),
    input_schema=_schema(
        {
            "finding_id": {"type": "string", "description": "Finding ID hiện tại"},
            "issue_type": {"type": "string", "description": "Issue type để tìm pattern tương tự"},
            "node": {"type": "string", "description": "Node để lọc (để trống = tất cả)"},
        },
        required=["finding_id"],
    ),
),
```

**DiagnosticExecutor method**:
```python
def get_analysis_history(
    self,
    finding_id: str,
    issue_type: str | None = None,
    node: str | None = None,
) -> dict[str, Any]:
    """Tra cứu lịch sử phân tích: insights + previous analyses."""
    db = MongoConnection.get_db()
    
    # 1. Tìm insights liên quan (cùng issue_type)
    insight_query: dict = {}
    if issue_type:
        insight_query["issue_type"] = issue_type
    if node:
        insight_query["node"] = node
    
    insights = list(db["issue_insights"].find(
        insight_query,
        projection={"_id": 0, "insight_id": 1, "root_cause_category": 1,
                     "root_cause_summary": 1, "affected_tables": 1,
                     "recurrence_count": 1, "actions": 1, "systemic": 1,
                     "updated_at": 1},
        sort=[("recurrence_count", -1)],
        limit=5,
    ))
    
    # Sanitize datetime
    for ins in insights:
        if isinstance(ins.get("updated_at"), datetime):
            ins["updated_at"] = ins["updated_at"].isoformat()
        # Giảm kích thước actions
        for a in ins.get("actions", []):
            if isinstance(a.get("resolved_at"), datetime):
                a["resolved_at"] = a["resolved_at"].isoformat()
    
    # 2. Tìm previous analyses cho cùng finding hoặc pattern
    prev_analyses = list(db["ai_analyses"].find(
        {"finding_id": finding_id, "status": "completed"},
        projection={"_id": 0, "analysis_id": 1, "skill_id": 1,
                     "root_cause_summary": 1, "top_actions": 1,
                     "cost_usd": 1, "started_at": 1},
        sort=[("started_at", -1)],
        limit=3,
    ))
    for a in prev_analyses:
        if isinstance(a.get("started_at"), datetime):
            a["started_at"] = a["started_at"].isoformat()
    
    return {
        "related_insights": insights,
        "previous_analyses": prev_analyses,
        "total_recurrences": sum(i.get("recurrence_count", 0) for i in insights),
    }
```

---

### 2.5 Thay đổi Prompt Construction

**File sửa**: `agent/context_builder.py`

**Bỏ db_context khỏi system prompt**:
```python
def build_system_prompt(self, skill: AnalysisSkill) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": self._skill_loader.base_system_prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]

    variable_parts: list[str] = []

    if skill.specialization:
        variable_parts.append(skill.specialization.strip())

    # BỎ: Không inject db_context vào system prompt nữa
    # Claude sẽ dùng get_table_context() tool khi cần
    
    # Thêm note ngắn về AG topology + RG (context nhỏ, luôn relevant)
    ag_rg_note = self._get_compact_infrastructure_note()
    if ag_rg_note:
        variable_parts.append(ag_rg_note)

    if variable_parts:
        blocks.append({"type": "text", "text": "\n\n---\n\n".join(variable_parts)})

    return blocks


def _get_compact_infrastructure_note(self) -> str:
    """AG topology + RG pools — compact, luôn relevant."""
    return (
        "Infrastructure:\n"
        "- AG: 3-node synchronous commit, Primary auto-detected, all secondaries readable\n"
        "- Resource Governor: default(50-60% CPU), PoolBackoffice(10%), PoolReport(20%), PoolMonitor(5%)\n"
        "- CDC enabled: 10 tables captured via Debezium on Primary\n"
        "- Dùng get_table_context(table_name) để lấy schema/index/patterns cho bảng cụ thể"
    )
```

**Bỏ raw query_plan_xml và query_text khỏi user message**:
```python
def build_user_message(self, skill: AnalysisSkill, finding: dict[str, Any]) -> str:
    template = skill.user_prompt_template
    subs = _extract_substitutions(skill, finding)
    try:
        return template.format_map(_SafeDict(subs))
    except Exception as exc:
        logger.warning("Template format failed: %s", exc)
        return template
```

Sửa `_extract_substitutions()`:
```python
def _extract_substitutions(skill: AnalysisSkill, finding: dict[str, Any]) -> dict[str, str]:
    metrics = finding.get("metrics") or {}
    
    detected_at = finding.get("detected_at", "")
    if hasattr(detected_at, "isoformat"):
        detected_at = detected_at.isoformat()

    metrics_str = json.dumps(metrics, ensure_ascii=False, indent=2, default=str)
    if len(metrics_str) > _MAX_METRICS_CHARS:
        metrics_str = metrics_str[:_MAX_METRICS_CHARS] + "\n... (truncated)"

    # BỎ: Không inject raw query_text và query_plan_xml
    # Claude sẽ dùng get_query_structure() và get_plan_analysis() tools
    
    return {
        "issue_type": str(finding.get("issue_type", "")),
        "severity": str(finding.get("severity", "")),
        "node": finding.get("node", ""),
        "role": finding.get("role", ""),
        "detected_at": str(detected_at),
        "metrics_json": metrics_str,
        "query_hash": finding.get("query_hash") or "(không có)",
        "finding_id": finding.get("finding_id", ""),
        "topic_id": finding.get("topic_id", ""),
    }
```

---

### 2.6 Cập nhật Skill YAMLs

**slow_sessions.yaml** (sau Phase 2):
```yaml
skill_id: slow_sessions_v2

issue_types:
  - slow_sessions
  - high_variation_query

specialization: |
  Focus: slow query và query có execution time biến động bất thường.
  
  Bắt đầu bằng việc hiểu query và plan:
  1. get_plan_analysis(finding_id) — xem operators, warnings, partition info
  2. get_query_structure(finding_id) — xem tables, joins, predicates
  3. get_table_context(table_name) — cho từng table liên quan
  
  Sau đó phân tích root cause:
  4. get_query_store_history — có plan regression không?
  5. get_query_stats — parameter sniffing? nhiều plan_handle?
  6. get_statistics_info — statistics stale?
  7. get_wait_stats — I/O bound? memory? blocking?
  
  Nếu cần thêm context:
  8. get_analysis_history — finding này recurring?
  9. get_index_usage, get_missing_indexes — index optimization

user_prompt_template: |
  Phân tích finding sau:
  
  Issue: {issue_type} | Severity: {severity}
  Node: {node} ({role}) | Detected: {detected_at}
  Finding ID: {finding_id}
  Query Hash: {query_hash}
  
  Metrics:
  {metrics_json}
  
  Dùng get_plan_analysis và get_query_structure để phân tích plan và query.
  Dùng get_table_context cho từng bảng liên quan.

required_tools:
  - get_plan_analysis
  - get_query_structure
  - get_query_stats
  - get_query_store_history

optional_tools:
  - get_table_context
  - get_statistics_info
  - get_wait_stats
  - get_index_usage
  - get_missing_indexes
  - get_memory_grant
  - get_analysis_history

model: claude-sonnet-4-6
max_tool_rounds: 6
max_tokens: 4096
max_cost_usd: 0.15
include_fields: []
```

**_base.yaml** — thêm instruction về new tools:
```yaml
base_system_prompt: |
  Bạn là chuyên gia SQL Server 2019 Enterprise performance tuning.
  [... giữ nguyên phần hiện tại ...]
  
  Tools đặc biệt:
  - get_plan_analysis: phân tích plan XML đã pre-process — LUÔN dùng thay vì đọc raw XML
  - get_query_structure: phân tích query text đã pre-process — LUÔN dùng thay vì đọc raw SQL
  - get_table_context: lấy schema/index/patterns cho 1 bảng — gọi cho mỗi bảng liên quan
  - get_analysis_history: xem finding này recurring không, phân tích trước kết luận gì
  
  [... giữ nguyên phần output format và <insight> instruction ...]
```

---

## Phase 3 — Enhancement (sau khi Phase 1+2 ổn định)

### 3.1 Tiered Skill Config

Thêm field `tiers` vào `AnalysisSkill` model:

```python
class SkillTier(BaseModel):
    model: str | None = None
    max_tool_rounds: int | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None
    specialization_addon: str = ""

class AnalysisSkill(BaseModel):
    # ... existing fields ...
    tiers: dict[str, SkillTier] = Field(default_factory=dict)
```

Orchestrator chọn tier:
```python
def _select_tier(self, skill, finding, insight_history) -> SkillTier | None:
    severity = finding.get("severity", "")
    recurrence = insight_history.get("total_recurrences", 0)
    
    if recurrence >= 3 and "recurring" in skill.tiers:
        return skill.tiers["recurring"]
    if severity == "critical" and "critical" in skill.tiers:
        return skill.tiers["critical"]
    return skill.tiers.get("default")
```

### 3.2 Base tool set

Định nghĩa `BASE_TOOLS` — tools mọi skill nên có:
```python
BASE_TOOL_NAMES = {"get_table_context", "get_analysis_history", 
                    "get_plan_analysis", "get_query_structure"}
```

Tự động thêm vào `build_tools_for_skill()`.

### 3.3 Smart metrics truncation

Thay vì truncate cố định 3000 chars, tính budget:
```python
def _adaptive_truncate(metrics: dict, budget_chars: int) -> str:
    """Truncate metrics dựa trên budget — giữ fields quan trọng nhất."""
    # Priority fields giữ full
    priority_keys = ["avg_elapsed_ms", "avg_cpu_ms", "avg_logical_reads", 
                     "execution_count", "total_spills"]
    ...
```

---

## Checklist Implementation Order

### Phase 1 (ước tính: 3-4 giờ)
- [ ] 1.0 Chuẩn hoá output format trong _base.yaml + giảm max_tokens tất cả skills
- [ ] 1.6a Fix cost calculation wrong model
- [ ] 1.6b Fix ThreadPoolExecutor per-request
- [ ] 1.6c Remove dead code _format_analysis()
- [ ] 1.1 Filter tools theo skill config (tool_registry + orchestrator)
- [ ] 1.2 Tool result truncation (tool_executor)
- [ ] 1.3 Thêm max_cost_usd vào skill model + budget check trong loop
- [ ] 1.4 Enforce required_tools (orchestrator)
- [ ] 1.5 Insight retry (orchestrator)
- [ ] Cập nhật skill YAMLs với max_cost_usd + max_tokens mới

### Phase 2 (ước tính: 4-6 giờ)
- [ ] 2.1 Implement plan_analyzer.py + đăng ký tool get_plan_analysis
- [ ] 2.2 Implement query_analyzer.py + đăng ký tool get_query_structure
- [ ] 2.3 Implement tool get_table_context (DiagnosticExecutor method)
- [ ] 2.4 Implement tool get_analysis_history (DiagnosticExecutor method)
- [ ] 2.5 Sửa context_builder: bỏ db_context, bỏ raw XML/text từ user message
- [ ] 2.6 Cập nhật tất cả skill YAMLs cho Phase 2
- [ ] 2.6 Cập nhật _base.yaml instruction về new tools
- [ ] Test end-to-end: /analyze với slow_sessions finding

### Phase 3 (ước tính: 2-3 giờ)
- [ ] 3.1 Tiered skill config model + orchestrator selection
- [ ] 3.2 Base tool set tự động thêm
- [ ] 3.3 Smart metrics truncation

---

## Files tạo mới

| File | Phase | Mục đích |
|------|-------|----------|
| `executor/plan_analyzer.py` | 2 | Parse XML plan → structured summary |
| `executor/query_analyzer.py` | 2 | Parse SQL text → structured elements |

## Files sửa chính

| File | Phase | Thay đổi |
|------|-------|----------|
| `models/skill.py` | 1+3 | Thêm max_cost_usd, tiers |
| `agent/orchestrator.py` | 1 | Tool filtering, budget check, required_tools enforce, insight retry, fix cost calc |
| `agent/tool_registry.py` | 1+2 | build_tools_for_skill(), 4 tool mới |
| `agent/tool_executor.py` | 1+2 | Truncation, dispatch 4 tools mới |
| `agent/context_builder.py` | 2 | Bỏ db_context injection, bỏ raw XML/text |
| `executor/diagnostic_executor.py` | 2 | 4 methods mới cho pre-processing tools |
| `skills/_base.yaml` | 1+2 | Output format template (1.0) + instruction new tools (2.x) |
| `skills/slow_sessions.yaml` | 1+2 | max_cost_usd, max_tokens giảm, updated tools/template |
| `skills/blocking.yaml` | 1 | max_cost_usd, max_tokens giảm |
| `skills/index.yaml` | 1 | max_cost_usd, max_tokens giảm |
| `skills/plan_xml.yaml` | 1+2 | max_cost_usd, max_tokens giảm, updated tools/template |
| `skills/generic.yaml` | 1 | max_cost_usd, max_tokens giảm |
| `skills/ag.yaml` | 1 | max_cost_usd, max_tokens giảm |
| `skills/deadlock.yaml` | 1 | max_cost_usd, max_tokens giảm |
| `skills/*.yaml` (TODO) | 1 | max_cost_usd, max_tokens theo category mới |
| `api/routes/analysis.py` | 1 | Fix ThreadPoolExecutor |
| `notifications/telegram_bot.py` | 1 | Remove dead code |

---

**Author:** Long Do + Claude Opus 4.6 | 2026-04-22
