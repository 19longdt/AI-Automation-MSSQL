# Upgrade Plan: Layer 2 — Plan Analysis Module

> **Mục tiêu:** Thay thế `executor/plan_analyzer.py` (sơ sài) bằng module phân tích plan XML toàn diện.  
> **Phạm vi:** Layer 2 thêm endpoint mới. Layer 1 và Layer 3 gọi qua HTTP — không thay đổi gì ở hai layer đó.  
> **Tham khảo:** `plan/analyze/xml-plan-analysis-guide.md`, `PerformanceMonitor/ShowPlanParser.cs`, `PlanAnalyzer.cs`

---

## 1. Bối Cảnh & Vấn Đề Hiện Tại

### plan_analyzer.py hiện tại — những gì còn thiếu

| Capability | Hiện tại | Cần có |
|---|---|---|
| Top operators | ✅ Top 10 by cost | ✅ + actual elapsed, logical reads, row estimate ratio |
| Missing indexes | ✅ Basic extract | ✅ + impact scoring, quality warnings, auto DDL |
| Implicit conversion | ✅ Regex trên ScalarString | ✅ + phân biệt seek-blocked vs predicate |
| Spill detection | ✅ Tag check | ✅ + loại spill, severity |
| Parallelism | ✅ DOP + count | ✅ + efficiency %, serial reason, thread skew |
| **Warnings** | ❌ Chỉ list tag names | ✅ 33+ rules với description + recommendation |
| **Memory grant** | ❌ | ✅ Spill risk, waste, grant wait |
| **Row estimate mismatch** | ❌ | ✅ Ratio, harm assessment |
| **Key/RID Lookup** | ❌ | ✅ + columns fetched, DDL suggestion |
| **Eager Index Spool** | ❌ | ✅ + CREATE INDEX DDL |
| **Scalar UDF** | ❌ | ✅ Detection + rewrite options |
| **Parameter sniffing** | ❌ | ✅ Compiled vs runtime mismatch |
| **Wait stats** | ❌ | ✅ Per wait type + advice |
| **Statistics stale** | ❌ | ✅ ModificationCount + LastUpdate |
| **Recommendations** | ❌ | ✅ description + recommendation + action.ddl |

### Yêu cầu tích hợp

```
Layer 1 (Python)  ──POST /api/v1/plan/analyze──► Layer 2
                                                  Parse XML → Findings
                                                  Return PlanAnalysisResult
Layer 1 nhận kết quả → lưu MongoDB

Layer 3 (Node.js) ──POST /api/v1/plan/analyze──► Layer 2
                                                  Parse XML → Findings
                                                  Return PlanAnalysisResult
Layer 3 nhận kết quả → render UI (không lưu)
```

**Endpoint mới** tách biệt hoàn toàn với `/api/v1/analyze` (AI orchestrator).  
Phân tích plan là **pure XML parsing** — không gọi Claude, không query DB.

---

## 2. Thiết Kế Module

### 2.1 Vị trí trong Layer 2

```
layer2/
├── executor/
│   ├── plan_analyzer.py       ← GIỮ NGUYÊN (dùng bởi AI agent tool)
│   └── ...
│
└── plan/                      ← MODULE MỚI
    ├── __init__.py
    ├── service.py              ← PlanAnalysisService (Facade — entry point duy nhất)
    ├── models/                 ← Pydantic data models
    │   ├── __init__.py
    │   ├── parsed_plan.py      ← ParsedStatement, PlanNode, MemoryGrant, ...
    │   └── result.py           ← PlanAnalysisResult, Finding, Action, Severity
    ├── parser/                 ← XML → ParsedPlan (pure data extraction, không logic)
    │   ├── __init__.py
    │   ├── plan_parser.py      ← PlanParser — orchestrate các sub-parsers
    │   ├── statement_parser.py ← Statement-level metadata
    │   ├── operator_parser.py  ← RelOp tree (recursive)
    │   └── index_parser.py     ← MissingIndexes + OptimizerStatsUsage
    └── analyzers/              ← ParsedPlan → Findings (business logic)
        ├── __init__.py
        ├── base.py             ← AbstractAnalyzer (Template Method)
        ├── memory_analyzer.py
        ├── operator_analyzer.py
        ├── index_analyzer.py
        ├── parallelism_analyzer.py
        ├── parameter_analyzer.py
        ├── wait_analyzer.py
        └── registry.py         ← AnalyzerRegistry — quản lý danh sách analyzers
```

> **Tại sao tách `plan/` thay vì sửa `executor/plan_analyzer.py`?**  
> `executor/plan_analyzer.py` đang được AI agent dùng qua tool executor. Thay đổi nó sẽ break AI flow. Module `plan/` là independent, phục vụ endpoint mới.

---

## 3. Data Models (`plan/models/`)

### 3.1 `parsed_plan.py` — Output của parser

```python
# Trung gian giữa parser và analyzer
# Không có logic — chỉ là data container

class PlanNode(BaseModel):
    node_id: int
    physical_op: str
    logical_op: str
    estimated_cost: float
    estimate_rows: float
    table_cardinality: float
    estimate_rows_without_row_goal: float
    parallel: bool
    lookup: bool                          # Key Lookup flag
    # Actual stats (None nếu estimated plan)
    actual_rows: int | None
    actual_executions: int | None
    actual_elapsed_ms: int | None
    actual_cpu_ms: int | None
    actual_logical_reads: int | None
    actual_physical_reads: int | None
    has_actual_stats: bool
    # Predicates
    predicate: str | None
    seek_predicates: str | None
    defined_values: str | None
    output_columns: str | None
    # Sub-items
    warnings: list[NodeWarning]           # Warnings từ XML (SpillToTempDb, etc.)
    scalar_udfs: list[str]                # UserDefinedFunction names
    per_thread_stats: list[PerThreadStat] # Parallel skew analysis
    children: list["PlanNode"]
    parent: "PlanNode | None"

class ParsedStatement(BaseModel):
    statement_text: str
    statement_type: str
    total_cost: float
    dop: int
    non_parallel_reason: str | None
    query_hash: str | None
    query_plan_hash: str | None
    cached_plan_size_kb: int
    compile_cpu_ms: int
    compile_memory_kb: int
    optm_level: str | None               # TRIVIAL / FULL
    early_abort_reason: str | None       # MemoryLimitExceeded
    ce_model_version: int                # 70/120/130/150
    has_actual_stats: bool
    # Sub-elements
    memory_grant: MemoryGrant | None
    parameters: list[PlanParameter]
    missing_indexes: list[MissingIndex]
    stats_usage: list[StatsUsageItem]
    wait_stats: list[WaitStat]
    query_time: QueryTime | None
    root_node: PlanNode | None

class ParsedPlan(BaseModel):
    statements: list[ParsedStatement]
    build_version: str | None
```

### 3.2 `result.py` — Output trả về caller

```python
class Severity(str, Enum):
    CRITICAL = "critical"   # Cần fix ngay
    WARNING  = "warning"    # Có vấn đề, nên xem xét
    INFO     = "info"       # Awareness

class Action(BaseModel):
    type: str               # "create_index" | "rewrite_query" | "update_stats" | "config"
    ddl: str | None         # SQL có thể copy-paste chạy ngay
    description: str        # Mô tả action

class Finding(BaseModel):
    severity: Severity
    category: str           # "memory" | "operator" | "index" | "parallelism" | "parameter" | "wait" | "code"
    type: str               # "key_lookup" | "spill" | "missing_index" | "implicit_conversion" | ...
    description: str        # Mô tả vấn đề + context (table, cost%, actual numbers)
    recommendation: str     # Hướng giải quyết bằng ngôn ngữ tự nhiên
    action: Action | None   # DDL hoặc SQL cụ thể nếu có

class StatementResult(BaseModel):
    # Summary
    statement_text: str
    statement_type: str
    total_cost: float
    dop: int
    has_actual_stats: bool
    ce_model_version: int
    query_hash: str | None
    query_plan_hash: str | None

    # Findings (kết quả phân tích)
    findings: list[Finding]              # Sorted by severity desc
    critical_count: int
    warning_count: int
    info_count: int

    # Structured data sections (dùng cho UI rendering)
    top_operators: list[OperatorSummary] # Top 10 by cost/elapsed
    missing_indexes: list[IndexSuggestion]
    memory_grant: MemoryGrantSummary | None
    parameters: list[ParameterInfo]
    wait_stats: list[WaitStatSummary]
    statistics: list[StatsSummary]
    io_stats: list[IOStatSummary]        # Logical reads per table

class PlanAnalysisResult(BaseModel):
    statements: list[StatementResult]
    # Aggregate
    total_findings: int
    critical_count: int
    warning_count: int
    has_actual_stats: bool
    # Meta
    analyzed_at: datetime
    analysis_duration_ms: int
```

---

## 4. Parser Layer (`plan/parser/`)

**Nguyên tắc:** Parser chỉ **đọc XML và map sang model**. Không có logic "cái này tốt hay xấu". Không raise exception — trả về partial data nếu element thiếu.

### 4.1 `plan_parser.py` — Entry point

```python
class PlanParser:
    """
    Orchestrate toàn bộ XML parsing.
    Single Responsibility: chỉ coordinate sub-parsers.
    """
    NS = "http://schemas.microsoft.com/sqlserver/2004/07/showplan"

    def __init__(
        self,
        statement_parser: StatementParser,
        operator_parser: OperatorParser,
        index_parser: IndexParser,
    ) -> None:
        self._statement_parser = statement_parser
        self._operator_parser = operator_parser
        self._index_parser = index_parser

    def parse(self, xml: str) -> ParsedPlan:
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as e:
            raise PlanParseError(f"Invalid XML: {e}") from e

        statements = []
        for stmt_el in root.iter(self._tag("StmtSimple")):
            stmt = self._statement_parser.parse(stmt_el)
            if stmt:
                statements.append(stmt)
        return ParsedPlan(
            statements=statements,
            build_version=root.get("Version"),
        )
```

### 4.2 `operator_parser.py` — Đệ quy qua RelOp tree

```python
class OperatorParser:
    """Parse RelOp tree recursively. Handles per-thread stats aggregation."""

    def parse_node(self, relop_el: ET.Element, parent: PlanNode | None = None) -> PlanNode:
        node = PlanNode(
            node_id=int(relop_el.get("NodeId", -1)),
            physical_op=relop_el.get("PhysicalOp", ""),
            logical_op=relop_el.get("LogicalOp", ""),
            estimated_cost=float(relop_el.get("EstimatedTotalSubtreeCost", 0)),
            estimate_rows=float(relop_el.get("EstimateRows", 0)),
            table_cardinality=float(relop_el.get("TableCardinality", 0)),
            estimate_rows_without_row_goal=float(
                relop_el.get("EstimateRowsWithoutRowGoal", 0)
            ),
            parallel=relop_el.get("Parallel") == "1",
            lookup=self._is_lookup(relop_el),
            parent=parent,
            **self._parse_runtime(relop_el),
            **self._parse_predicates(relop_el),
            warnings=self._parse_node_warnings(relop_el),
            scalar_udfs=self._parse_udfs(relop_el),
            per_thread_stats=self._parse_threads(relop_el),
            children=[],
        )
        # Recurse
        for child_el in self._find_child_relops(relop_el):
            child = self.parse_node(child_el, parent=node)
            node.children.append(child)
        return node
```

---

## 5. Analyzer Layer (`plan/analyzers/`)

### 5.1 `base.py` — Template Method Pattern

Template Method định nghĩa **skeleton của thuật toán** phân tích. Subclass chỉ override các bước cụ thể.

```python
from abc import ABC, abstractmethod

class AbstractAnalyzer(ABC):
    """
    Template Method Pattern.

    Skeleton cố định:
      analyze() → _is_applicable() → _collect_findings() → _post_process()

    Subclass implement:
      - _is_applicable(): điều kiện để analyzer này có thể chạy
      - _collect_findings(): logic phát hiện vấn đề, trả raw findings

    Subclass có thể override (optional):
      - _post_process(): dedup, sort, limit findings
    """

    @property
    @abstractmethod
    def category(self) -> str:
        """Category của analyzer: memory/operator/index/parallelism/..."""

    def analyze(
        self,
        statement: ParsedStatement,
        plan: ParsedPlan,
    ) -> list[Finding]:
        """Entry point — KHÔNG override method này."""
        if not self._is_applicable(statement, plan):
            return []
        findings = self._collect_findings(statement, plan)
        return self._post_process(findings)

    @abstractmethod
    def _is_applicable(
        self,
        statement: ParsedStatement,
        plan: ParsedPlan,
    ) -> bool:
        """
        Guard condition. Trả False để skip analyzer này.
        Ví dụ: WaitAnalyzer chỉ chạy khi has_actual_stats=True.
        """

    @abstractmethod
    def _collect_findings(
        self,
        statement: ParsedStatement,
        plan: ParsedPlan,
    ) -> list[Finding]:
        """Core logic — detect issues, build Finding objects."""

    def _post_process(self, findings: list[Finding]) -> list[Finding]:
        """
        Optional override. Default: sort by severity desc.
        Subclass có thể override để dedup hoặc limit.
        """
        order = {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}
        return sorted(findings, key=lambda f: order[f.severity])
```

### 5.2 Ví dụ concrete analyzers

#### `memory_analyzer.py`
```python
class MemoryAnalyzer(AbstractAnalyzer):
    """Phát hiện memory grant issues: spill risk, waste, grant wait, large grant."""

    @property
    def category(self) -> str:
        return "memory"

    def _is_applicable(self, statement, plan) -> bool:
        return statement.memory_grant is not None

    def _collect_findings(self, statement, plan) -> list[Finding]:
        findings = []
        mg = statement.memory_grant

        # Spill risk
        if mg.max_used_kb and mg.granted_kb:
            if mg.max_used_kb >= mg.granted_kb * 0.9:
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="memory_spill_risk",
                    description=(
                        f"Query đã dùng {mg.max_used_kb // 1024} MB / "
                        f"{mg.granted_kb // 1024} MB được cấp "
                        f"({mg.max_used_kb * 100 // mg.granted_kb}%). "
                        "Gần chạm giới hạn — rất có thể đã hoặc sắp spill ra TempDB."
                    ),
                    recommendation=(
                        "Cập nhật statistics để optimizer ước lượng rows chính xác hơn, "
                        "giúp memory grant phù hợp với dữ liệu thực."
                    ),
                    action=Action(
                        type="update_stats",
                        ddl="UPDATE STATISTICS [schema].[table] WITH FULLSCAN;",
                        description="Update statistics cho các bảng lớn trong plan",
                    ),
                ))

        # Grant wait — server memory pressure
        if mg.grant_wait_ms and mg.grant_wait_ms > 0:
            severity = Severity.CRITICAL if mg.grant_wait_ms >= 5000 else Severity.WARNING
            findings.append(Finding(
                severity=severity,
                category=self.category,
                type="memory_grant_wait",
                description=(
                    f"Query phải chờ {mg.grant_wait_ms:,} ms để được cấp memory. "
                    "Server đang thiếu workspace memory."
                ),
                recommendation=(
                    "Kiểm tra memory pressure tổng thể trên server. "
                    "Xem xét giảm max_grant_percent hoặc tối ưu các query tốn nhiều memory."
                ),
                action=None,
            ))

        # Wasted grant
        if mg.max_used_kb and mg.granted_kb:
            if mg.granted_kb >= 1_048_576 and mg.max_used_kb < mg.granted_kb * 0.5:
                waste_ratio = mg.granted_kb // mg.max_used_kb
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="memory_wasted_grant",
                    description=(
                        f"Query được cấp {mg.granted_kb // 1024} MB nhưng chỉ dùng "
                        f"{mg.max_used_kb // 1024} MB ({waste_ratio}x overestimate). "
                        "Memory dư bị giữ lock, giảm concurrency server."
                    ),
                    recommendation=(
                        "Statistics có thể đã stale — row estimate quá cao dẫn đến "
                        "memory grant thừa. Chạy UPDATE STATISTICS."
                    ),
                    action=None,
                ))
        return findings
```

#### `operator_analyzer.py`
```python
class OperatorAnalyzer(AbstractAnalyzer):
    """
    Phân tích operator tree: Key Lookup, Eager Spool, Sort, NL high exec,
    Scan with predicate, Non-SARGable, Row estimate mismatch.
    """

    @property
    def category(self) -> str:
        return "operator"

    def _is_applicable(self, statement, plan) -> bool:
        return statement.root_node is not None

    def _collect_findings(self, statement, plan) -> list[Finding]:
        findings = []
        all_nodes = self._flatten(statement.root_node)
        for node in all_nodes:
            findings.extend(self._analyze_node(node, statement))
        return findings

    def _analyze_node(self, node: PlanNode, stmt: ParsedStatement) -> list[Finding]:
        findings = []

        # Key Lookup
        if node.lookup and node.physical_op != "RID Lookup":
            cost_pct = self._cost_pct(node, stmt)
            severity = Severity.CRITICAL if cost_pct > 20 else Severity.WARNING
            include_cols = node.output_columns or "?"
            findings.append(Finding(
                severity=severity,
                category=self.category,
                type="key_lookup",
                description=(
                    f"Key Lookup trên {node.object_name or 'unknown'} "
                    f"chiếm ~{cost_pct:.0f}% estimated cost. "
                    f"Columns cần fetch: {include_cols}."
                ),
                recommendation=(
                    "Thêm các columns này vào INCLUDE list của nonclustered index "
                    "để tạo covering index, loại bỏ Key Lookup."
                ),
                action=self._build_include_action(node),
            ))

        # Eager Index Spool
        if "Eager" in node.physical_op and "Spool" in node.physical_op:
            findings.append(Finding(
                severity=Severity.CRITICAL,
                category=self.category,
                type="eager_index_spool",
                description=(
                    f"Eager Index Spool tại node {node.node_id}. "
                    "SQL Server đang tự build temporary index trong TempDB mỗi lần execute."
                ),
                recommendation=(
                    "Tạo permanent index trên bảng nguồn để loại bỏ spool. "
                    "Spool này rebuild index từ đầu mỗi lần query chạy."
                ),
                action=Action(
                    type="create_index",
                    ddl=node.suggested_index,
                    description="Tạo index permanent để thay thế spool",
                ) if node.suggested_index else None,
            ))

        # Row estimate mismatch (actual plan)
        if node.has_actual_stats and node.estimate_rows > 0 and node.actual_rows is not None:
            executions = max(node.actual_executions or 1, 1)
            actual_per_exec = node.actual_rows / executions
            ratio = actual_per_exec / node.estimate_rows
            if ratio >= 10 or ratio <= 0.1:
                direction = "underestimate" if ratio >= 10 else "overestimate"
                factor = ratio if ratio >= 10 else 1 / ratio
                findings.append(Finding(
                    severity=Severity.CRITICAL if factor >= 100 else Severity.WARNING,
                    category=self.category,
                    type="row_estimate_mismatch",
                    description=(
                        f"{node.physical_op} (node {node.node_id}): "
                        f"Estimated {node.estimate_rows:,.0f} rows, "
                        f"actual {actual_per_exec:,.0f} rows/exec — "
                        f"{factor:.0f}x {direction}."
                    ),
                    recommendation=(
                        "Row estimate sai dẫn đến sai join type, memory grant, "
                        "và access method. Cập nhật statistics hoặc dùng "
                        "OPTION(RECOMPILE) để force re-estimate."
                    ),
                    action=None,
                ))

        return findings
```

#### `index_analyzer.py`
```python
class IndexAnalyzer(AbstractAnalyzer):
    """Phân tích missing indexes: impact, chất lượng gợi ý, auto DDL."""

    @property
    def category(self) -> str:
        return "index"

    def _is_applicable(self, statement, plan) -> bool:
        return len(statement.missing_indexes) > 0

    def _collect_findings(self, statement, plan) -> list[Finding]:
        findings = []
        table_counts: dict[str, int] = {}

        for mi in statement.missing_indexes:
            table_key = f"{mi.schema}.{mi.table}"
            table_counts[table_key] = table_counts.get(table_key, 0) + 1

        seen_tables: set[str] = set()
        for mi in statement.missing_indexes:
            table_key = f"{mi.schema}.{mi.table}"
            key_cols = mi.equality_columns + mi.inequality_columns
            include_cols = mi.include_columns

            # Duplicate suggestion warning
            if table_counts[table_key] > 1 and table_key not in seen_tables:
                seen_tables.add(table_key)
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="duplicate_index_suggestions",
                    description=(
                        f"{table_counts[table_key]} gợi ý missing index cùng bảng {table_key}. "
                        "Tạo hết sẽ gây maintenance overhead."
                    ),
                    recommendation="Consolidate thành 1-2 composite index thay vì tạo riêng lẻ.",
                    action=None,
                ))

            # Wide INCLUDE
            if len(include_cols) > 5:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="wide_index_suggestion",
                    description=(
                        f"Missing index trên {table_key} có {len(include_cols)} INCLUDE columns. "
                        "\"Kitchen sink\" index — SQL Server gợi ý cover mọi column query dùng."
                    ),
                    recommendation=(
                        "Đánh giá lại xem columns nào thực sự cần. "
                        "Index rộng tốn storage và làm chậm INSERT/UPDATE/DELETE."
                    ),
                    action=Action(
                        type="create_index",
                        ddl=mi.create_statement,
                        description=f"Tham khảo DDL (review trước khi apply): impact {mi.impact:.1f}%",
                    ),
                ))
            elif mi.impact >= 25:
                findings.append(Finding(
                    severity=Severity.CRITICAL if mi.impact >= 70 else Severity.WARNING,
                    category=self.category,
                    type="missing_index",
                    description=(
                        f"Missing index trên {table_key} với impact {mi.impact:.1f}%. "
                        f"Key columns: {', '.join(key_cols)}. "
                        + (f"Include: {', '.join(include_cols)}." if include_cols else "")
                    ),
                    recommendation=(
                        f"Tạo index này để cải thiện ước tính {mi.impact:.0f}% query cost. "
                        "Test trên môi trường staging trước."
                    ),
                    action=Action(
                        type="create_index",
                        ddl=mi.create_statement,
                        description="Ready-to-run CREATE INDEX statement",
                    ),
                ))

        return findings
```

### 5.3 `registry.py` — Quản lý danh sách analyzers

```python
class AnalyzerRegistry:
    """
    Open/Closed Principle: thêm analyzer mới chỉ cần register, không sửa code cũ.
    Dependency Inversion: PlanAnalysisService phụ thuộc vào abstraction (AbstractAnalyzer),
    không phụ thuộc vào concrete implementations.
    """

    def __init__(self) -> None:
        self._analyzers: list[AbstractAnalyzer] = []

    def register(self, analyzer: AbstractAnalyzer) -> "AnalyzerRegistry":
        self._analyzers.append(analyzer)
        return self  # Fluent interface

    def get_all(self) -> list[AbstractAnalyzer]:
        return list(self._analyzers)

    @classmethod
    def default(cls) -> "AnalyzerRegistry":
        """Factory method — tạo registry với tất cả built-in analyzers."""
        return (
            cls()
            .register(MemoryAnalyzer())
            .register(OperatorAnalyzer())
            .register(IndexAnalyzer())
            .register(ParallelismAnalyzer())
            .register(ParameterAnalyzer())
            .register(WaitAnalyzer())
            .register(StatisticsAnalyzer())
            # Thêm analyzer mới ở đây khi cần
        )
```

---

## 6. Service Layer (`plan/service.py`) — Facade

```python
class PlanAnalysisService:
    """
    Facade — entry point duy nhất cho toàn bộ plan analysis.
    Caller (API route, Layer 1) chỉ cần biết class này.
    """

    def __init__(
        self,
        parser: PlanParser,
        registry: AnalyzerRegistry,
    ) -> None:
        self._parser = parser
        self._registry = registry

    def analyze(self, plan_xml: str) -> PlanAnalysisResult:
        start = time.monotonic()

        parsed = self._parser.parse(plan_xml)  # XML → ParsedPlan

        statement_results = []
        for stmt in parsed.statements:
            findings: list[Finding] = []
            for analyzer in self._registry.get_all():
                findings.extend(analyzer.analyze(stmt, parsed))

            statement_results.append(
                StatementResult(
                    statement_text=stmt.statement_text,
                    statement_type=stmt.statement_type,
                    total_cost=stmt.total_cost,
                    dop=stmt.dop,
                    has_actual_stats=stmt.has_actual_stats,
                    ce_model_version=stmt.ce_model_version,
                    query_hash=stmt.query_hash,
                    query_plan_hash=stmt.query_plan_hash,
                    findings=findings,
                    critical_count=sum(1 for f in findings if f.severity == Severity.CRITICAL),
                    warning_count=sum(1 for f in findings if f.severity == Severity.WARNING),
                    info_count=sum(1 for f in findings if f.severity == Severity.INFO),
                    top_operators=self._build_top_operators(stmt),
                    missing_indexes=self._build_index_summary(stmt),
                    memory_grant=self._build_memory_summary(stmt),
                    parameters=self._build_parameter_summary(stmt),
                    wait_stats=self._build_wait_summary(stmt),
                    statistics=self._build_stats_summary(stmt),
                    io_stats=self._build_io_summary(stmt),
                )
            )

        duration_ms = int((time.monotonic() - start) * 1000)
        return PlanAnalysisResult(
            statements=statement_results,
            total_findings=sum(s.critical_count + s.warning_count + s.info_count for s in statement_results),
            critical_count=sum(s.critical_count for s in statement_results),
            warning_count=sum(s.warning_count for s in statement_results),
            has_actual_stats=any(s.has_actual_stats for s in statement_results),
            analyzed_at=datetime.utcnow(),
            analysis_duration_ms=duration_ms,
        )

    @classmethod
    def create(cls) -> "PlanAnalysisService":
        """Factory — wiring dependencies. Dùng trong main.py startup."""
        return cls(
            parser=PlanParser(
                statement_parser=StatementParser(),
                operator_parser=OperatorParser(),
                index_parser=IndexParser(),
            ),
            registry=AnalyzerRegistry.default(),
        )
```

---

## 7. API Endpoint Mới

### `api/routes/plan.py`

```python
router = APIRouter(prefix="/api/v1/plan", tags=["plan-analysis"])

class PlanAnalyzeRequest(BaseModel):
    plan_xml: str
    source: str = "unknown"     # "layer1" | "layer3" | "manual"

class PlanAnalyzeResponse(PlanAnalysisResult):
    pass

@router.post("/analyze", response_model=PlanAnalyzeResponse)
async def analyze_plan(
    request: Request,
    body: PlanAnalyzeRequest,
) -> PlanAnalyzeResponse:
    """
    Parse và phân tích SQL Server execution plan XML.
    Pure deterministic — không gọi AI, không query DB.
    Layer 1: gọi để lấy kết quả rồi tự lưu MongoDB.
    Layer 3: gọi để render UI.
    """
    if not body.plan_xml or not body.plan_xml.strip():
        raise HTTPException(status_code=400, detail="plan_xml không được để trống")

    service: PlanAnalysisService = request.app.state.plan_analysis_service
    try:
        result = service.analyze(body.plan_xml)
    except PlanParseError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    return result
```

### Đăng ký trong `main.py`

```python
# Startup
app.state.plan_analysis_service = PlanAnalysisService.create()

# Route
from .api.routes.plan import router as plan_router
app.include_router(plan_router)
```

---

## 8. Request/Response Contract

### Request
```json
POST /api/v1/plan/analyze
{
  "plan_xml": "<ShowPlanXML xmlns='...' Version='...'>...</ShowPlanXML>",
  "source": "layer1"
}
```

### Response
```json
{
  "statements": [
    {
      "statement_text": "SELECT o.OrderId, c.Name FROM Orders o JOIN...",
      "statement_type": "SELECT",
      "total_cost": 12.47,
      "dop": 4,
      "has_actual_stats": true,
      "ce_model_version": 150,
      "query_hash": "0x8F3A...",
      "query_plan_hash": "0x2B1C...",

      "findings": [
        {
          "severity": "critical",
          "category": "operator",
          "type": "key_lookup",
          "description": "Key Lookup trên dbo.Orders chiếm ~45% estimated cost. Columns cần fetch: Status, TotalAmount, CreatedAt.",
          "recommendation": "Thêm Status, TotalAmount, CreatedAt vào INCLUDE list của IX_Orders_CustomerId để tạo covering index.",
          "action": {
            "type": "create_index",
            "ddl": "ALTER INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] REBUILD;\n-- Hoặc tạo mới:\nCREATE NONCLUSTERED INDEX [IX_Orders_CustomerId_Cover]\nON [dbo].[Orders] ([CustomerId])\nINCLUDE ([Status], [TotalAmount], [CreatedAt]);",
            "description": "Covering index để loại bỏ Key Lookup"
          }
        },
        {
          "severity": "warning",
          "category": "memory",
          "type": "memory_spill_risk",
          "description": "Query đã dùng 480 MB / 512 MB được cấp (93%). Gần chạm giới hạn.",
          "recommendation": "Cập nhật statistics để optimizer ước lượng rows chính xác hơn.",
          "action": {
            "type": "update_stats",
            "ddl": "UPDATE STATISTICS [dbo].[Orders] WITH FULLSCAN;",
            "description": "Update statistics cho bảng Orders"
          }
        }
      ],

      "critical_count": 1,
      "warning_count": 2,
      "info_count": 1,

      "top_operators": [
        {
          "node_id": 5,
          "physical_op": "Key Lookup (Clustered)",
          "table": "dbo.Orders",
          "cost_pct": 45.2,
          "estimated_rows": 1500,
          "actual_rows": 1489,
          "actual_elapsed_ms": 3200,
          "actual_logical_reads": 89432
        }
      ],

      "missing_indexes": [
        {
          "table": "dbo.Orders",
          "impact": 78.5,
          "equality_columns": ["CustomerId"],
          "inequality_columns": ["OrderDate"],
          "include_columns": ["Status", "TotalAmount"],
          "create_statement": "CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId_OrderDate]\nON [dbo].[Orders] ([CustomerId], [OrderDate])\nINCLUDE ([Status], [TotalAmount]);"
        }
      ],

      "memory_grant": {
        "requested_kb": 524288,
        "granted_kb": 524288,
        "max_used_kb": 491520,
        "grant_wait_ms": 0
      },

      "wait_stats": [
        { "type": "PAGEIOLATCH_SH", "ms": 1234, "count": 56, "category": "disk_io" }
      ]
    }
  ],
  "total_findings": 4,
  "critical_count": 1,
  "warning_count": 2,
  "has_actual_stats": true,
  "analyzed_at": "2026-05-27T10:30:00Z",
  "analysis_duration_ms": 45
}
```

---

## 9. Analyzers Cần Implement

| Analyzer | Category | Rules chính |
|---|---|---|
| `MemoryAnalyzer` | memory | Spill risk, wasted grant, grant wait, large grant (>1GB) |
| `OperatorAnalyzer` | operator | Key Lookup, RID Lookup, Eager Index Spool, Sort>20%, Filter operator, Lazy Spool ineffective, NL high exec, Row estimate mismatch, Non-SARGable (CONVERT_IMPLICIT, ISNULL, leading LIKE, CASE, function on column), Scan with predicate |
| `IndexAnalyzer` | index | Missing index (impact, DDL), wide INCLUDE, low impact, duplicate suggestions |
| `ParallelismAnalyzer` | parallelism | Serial plan reason (actionable vs passive), ineffective parallelism efficiency%, parallel wait bottleneck, thread skew |
| `ParameterAnalyzer` | parameter | Sniffing mismatch (compiled≠runtime), local variables (no compiled value), OPTIMIZE FOR UNKNOWN |
| `WaitAnalyzer` | wait | LCK (blocking), PAGEIOLATCH (disk I/O), CXPACKET (parallelism), RESOURCE_SEMAPHORE (memory), SOS_SCHEDULER_YIELD (CPU) |
| `StatisticsAnalyzer` | statistics | Stale stats (high ModificationCount + old LastUpdate), low sampling %, never updated |
| `CodePatternAnalyzer` | code | Scalar UDF detected, table variable, CTE multi-reference, NOT IN nullable, Row Goal active |
| `CompilationAnalyzer` | compilation | High compile CPU (>1000ms), MemoryLimitExceeded early abort, CE model version 70 |

---

## 10. Danh Sách Finding Types

```python
# operator
"key_lookup"               | "rid_lookup"
"eager_index_spool"        | "lazy_spool_ineffective"
"sort_expensive"           | "filter_operator"
"nl_high_executions"       | "row_estimate_mismatch"
"non_sargable_implicit"    | "non_sargable_isnull"
"non_sargable_like"        | "non_sargable_case"
"non_sargable_function"    | "scan_with_predicate"
"top_above_scan"           | "many_to_many_merge"
"row_count_spool_not_in"   | "join_or_clause"

# memory
"memory_spill_risk"        | "memory_wasted_grant"
"memory_grant_wait"        | "memory_large_grant"

# index
"missing_index"            | "missing_index_low_impact"
"wide_index_suggestion"    | "duplicate_index_suggestions"

# parallelism
"serial_plan_actionable"   | "serial_plan_passive"
"ineffective_parallelism"  | "parallel_wait_bottleneck"
"parallel_thread_skew"

# parameter
"parameter_sniffing"       | "local_variables"
"optimize_for_unknown"

# wait
"wait_blocking"            | "wait_disk_io"
"wait_parallelism"         | "wait_memory"
"wait_cpu"

# statistics
"stale_statistics"         | "low_sampling"
"never_updated_statistics"

# code
"scalar_udf"               | "table_variable"
"cte_multi_reference"      | "row_goal"

# compilation
"high_compile_cpu"         | "compile_memory_exceeded"
"ce_model_legacy"
```

---

## 11. SOLID Compliance

| Nguyên tắc | Áp dụng |
|---|---|
| **S** Single Responsibility | Parser chỉ parse. Mỗi Analyzer chỉ analyze 1 category. Service chỉ orchestrate. |
| **O** Open/Closed | Thêm analyzer mới: tạo class + `registry.register()`. Không sửa code cũ. |
| **L** Liskov Substitution | Mọi `AbstractAnalyzer` subclass có thể thay thế nhau trong registry. |
| **I** Interface Segregation | `AbstractAnalyzer` chỉ expose `analyze()`. Parser sub-classes tách theo domain. |
| **D** Dependency Inversion | `PlanAnalysisService` nhận `PlanParser` và `AnalyzerRegistry` qua constructor — testable và replaceable. |

---

## 12. Template Method — Extensibility

Khi cần thêm analyzer mới (ví dụ `ColumnstoreAnalyzer` trong tương lai):

```python
class ColumnstoreAnalyzer(AbstractAnalyzer):

    @property
    def category(self) -> str:
        return "columnstore"

    def _is_applicable(self, statement, plan) -> bool:
        # Chỉ chạy khi plan có columnstore operators
        return any(
            "Columnstore" in n.physical_op
            for n in self._flatten(statement.root_node)
        )

    def _collect_findings(self, statement, plan) -> list[Finding]:
        findings = []
        # ... logic phân tích segment reads/skips, batch mode, ...
        return findings

# Đăng ký — KHÔNG cần sửa bất kỳ file nào khác
registry.register(ColumnstoreAnalyzer())
```

---

## 13. Migration từ plan_analyzer.py Hiện Tại

`executor/plan_analyzer.py` **giữ nguyên** — AI agent tool vẫn dùng nó.

Sau khi module `plan/` hoàn thành:
- Layer 1's `plan_analysis` detector: giữ nguyên logic hiện có hoặc upgrade gọi endpoint mới
- AI agent (`tool_executor.py`): tool `analyze_plan` vẫn gọi `executor/plan_analyzer.py`
- Endpoint mới `/api/v1/plan/analyze`: dùng module `plan/` hoàn toàn mới

Không có breaking change.

---

## 14. Thứ Tự Implementation

```
Phase 1 — Foundation (không có UI, test bằng curl)
  [ ] plan/models/parsed_plan.py  — PlanNode, ParsedStatement, ParsedPlan
  [ ] plan/models/result.py       — Finding, Action, Severity, PlanAnalysisResult
  [ ] plan/parser/plan_parser.py  — XML → ParsedPlan
  [ ] plan/analyzers/base.py      — AbstractAnalyzer (Template Method)
  [ ] plan/service.py             — PlanAnalysisService.create()
  [ ] api/routes/plan.py          — POST /api/v1/plan/analyze
  [ ] main.py                     — register route + init service

Phase 2 — Core Analyzers (các vấn đề quan trọng nhất)
  [ ] OperatorAnalyzer            — Key Lookup, Eager Spool, Row estimate mismatch
  [ ] IndexAnalyzer               — Missing index + DDL
  [ ] MemoryAnalyzer              — Spill risk, grant wait, waste
  [ ] ParallelismAnalyzer         — Serial reason, efficiency

Phase 3 — Full Coverage
  [ ] ParameterAnalyzer           — Sniffing, local variables
  [ ] WaitAnalyzer                — Per wait type advice
  [ ] StatisticsAnalyzer          — Stale stats
  [ ] CodePatternAnalyzer         — UDF, table variable, CTE
  [ ] CompilationAnalyzer         — High compile CPU, CE version

Phase 4 — Integration
  [ ] Layer 1: gọi endpoint + lưu MongoDB
  [ ] Layer 3: gọi endpoint + render UI
```

---

## 15. File Summary

| File | Dòng ước tính | Mô tả |
|---|---|---|
| `plan/models/parsed_plan.py` | ~150 | Data containers từ XML |
| `plan/models/result.py` | ~100 | Output models |
| `plan/parser/plan_parser.py` | ~80 | Orchestrator parser |
| `plan/parser/statement_parser.py` | ~120 | Statement metadata |
| `plan/parser/operator_parser.py` | ~200 | RelOp tree recursion |
| `plan/parser/index_parser.py` | ~80 | Missing indexes + stats |
| `plan/analyzers/base.py` | ~60 | Template Method abstract |
| `plan/analyzers/operator_analyzer.py` | ~300 | Largest — 15+ rules |
| `plan/analyzers/memory_analyzer.py` | ~120 | 4 rules |
| `plan/analyzers/index_analyzer.py` | ~100 | 4 rules |
| `plan/analyzers/parallelism_analyzer.py` | ~120 | 4 rules |
| `plan/analyzers/parameter_analyzer.py` | ~80 | 3 rules |
| `plan/analyzers/wait_analyzer.py` | ~80 | 5 wait types |
| `plan/analyzers/statistics_analyzer.py` | ~70 | 3 rules |
| `plan/analyzers/code_pattern_analyzer.py` | ~120 | UDF, table var, CTE |
| `plan/analyzers/registry.py` | ~40 | Analyzer registration |
| `plan/service.py` | ~120 | Facade + wiring |
| `api/routes/plan.py` | ~40 | Endpoint |

**Tổng:** ~1,900 dòng Python — thay thế 243 dòng hiện tại với coverage tăng 10x.

---

*Tài liệu này là implementation plan — không phải code cuối cùng. Các method signatures và model fields có thể điều chỉnh trong quá trình implement.*
