# Upgrade Plan: Layer 2 â€” Plan Analysis Module

> **Má»¥c tiÃªu:** Thay tháº¿ `executor/plan_analyzer.py` (sÆ¡ sÃ i) báº±ng module phÃ¢n tÃ­ch plan XML toÃ n diá»‡n.  
> **Pháº¡m vi:** Layer 2 thÃªm endpoint má»›i. Layer 1 vÃ  Layer 3 gá»i qua HTTP â€” khÃ´ng thay Ä‘á»•i gÃ¬ á»Ÿ hai layer Ä‘Ã³.  
> **Tham kháº£o:** `plan/analyze/xml-plan-analysis-guide.md`, `PerformanceMonitor/ShowPlanParser.cs`, `PlanAnalyzer.cs`

---

## 1. Bá»‘i Cáº£nh & Váº¥n Äá» Hiá»‡n Táº¡i

### plan_analyzer.py hiá»‡n táº¡i â€” nhá»¯ng gÃ¬ cÃ²n thiáº¿u

| Capability | Hiá»‡n táº¡i | Cáº§n cÃ³ |
|---|---|---|
| Top operators | âœ… Top 10 by cost | âœ… + actual elapsed, logical reads, row estimate ratio |
| Missing indexes | âœ… Basic extract | âœ… + impact scoring, quality warnings, auto DDL |
| Implicit conversion | âœ… Regex trÃªn ScalarString | âœ… + phÃ¢n biá»‡t seek-blocked vs predicate |
| Spill detection | âœ… Tag check | âœ… + loáº¡i spill, severity |
| Parallelism | âœ… DOP + count | âœ… + efficiency %, serial reason, thread skew |
| **Warnings** | âŒ Chá»‰ list tag names | âœ… 33+ rules vá»›i description + recommendation |
| **Memory grant** | âŒ | âœ… Spill risk, waste, grant wait |
| **Row estimate mismatch** | âŒ | âœ… Ratio, harm assessment |
| **Key/RID Lookup** | âŒ | âœ… + columns fetched, DDL suggestion |
| **Eager Index Spool** | âŒ | âœ… + CREATE INDEX DDL |
| **Scalar UDF** | âŒ | âœ… Detection + rewrite options |
| **Parameter sniffing** | âŒ | âœ… Compiled vs runtime mismatch |
| **Wait stats** | âŒ | âœ… Per wait type + advice |
| **Statistics stale** | âŒ | âœ… ModificationCount + LastUpdate |
| **Recommendations** | âŒ | âœ… description + recommendation + action.ddl |

### YÃªu cáº§u tÃ­ch há»£p

```
Layer 1 (Python)  â”€â”€POST /api/v1/plan/analyzeâ”€â”€â–º Layer 2
                                                  Parse XML â†’ Findings
                                                  Return PlanAnalysisResult
Layer 1 nháº­n káº¿t quáº£ â†’ lÆ°u MongoDB

Layer 3 (Node.js) â”€â”€POST /api/v1/plan/analyzeâ”€â”€â–º Layer 2
                                                  Parse XML â†’ Findings
                                                  Return PlanAnalysisResult
Layer 3 nháº­n káº¿t quáº£ â†’ render UI (khÃ´ng lÆ°u)
```

**Endpoint má»›i** tÃ¡ch biá»‡t hoÃ n toÃ n vá»›i `/api/v1/analyze` (AI orchestrator).  
PhÃ¢n tÃ­ch plan lÃ  **pure XML parsing** â€” khÃ´ng gá»i Claude, khÃ´ng query DB.

---

## 2. Thiáº¿t Káº¿ Module

### 2.1 Vá»‹ trÃ­ trong Layer 2

```
layer2/
â”œâ”€â”€ executor/
â”‚   â”œâ”€â”€ plan_analyzer.py       â† GIá»® NGUYÃŠN (dÃ¹ng bá»Ÿi AI agent tool)
â”‚   â””â”€â”€ ...
â”‚
â””â”€â”€ plan/                      â† MODULE Má»šI
    â”œâ”€â”€ __init__.py
    â”œâ”€â”€ service.py              â† PlanAnalysisService (Facade â€” entry point duy nháº¥t)
    â”œâ”€â”€ models/                 â† Pydantic data models
    â”‚   â”œâ”€â”€ __init__.py
    â”‚   â”œâ”€â”€ parsed_plan.py      â† ParsedStatement, PlanNode, MemoryGrant, ... + PlanContext
    â”‚   â””â”€â”€ result.py           â† PlanAnalysisResult, Finding, Action, Severity
    â”œâ”€â”€ parser/                 â† XML â†’ ParsedPlan (pure data extraction, khÃ´ng logic)
    â”‚   â”œâ”€â”€ __init__.py
    â”‚   â”œâ”€â”€ plan_parser.py      â† PlanParser â€” orchestrate cÃ¡c sub-parsers
    â”‚   â”œâ”€â”€ statement_parser.py â† Statement-level metadata
    â”‚   â”œâ”€â”€ operator_parser.py  â† RelOp tree (recursive)
    â”‚   â””â”€â”€ index_parser.py     â† MissingIndexes + OptimizerStatsUsage
    â””â”€â”€ analyzers/              â† ParsedPlan â†’ Findings (business logic)
        â”œâ”€â”€ __init__.py
        â”œâ”€â”€ base.py             â† AbstractAnalyzer (Template Method)
        â”œâ”€â”€ memory_analyzer.py
        â”œâ”€â”€ operator_analyzer.py
        â”œâ”€â”€ index_analyzer.py
        â”œâ”€â”€ parallelism_analyzer.py
        â”œâ”€â”€ parameter_analyzer.py
        â”œâ”€â”€ wait_analyzer.py
        â””â”€â”€ registry.py         â† AnalyzerRegistry â€” quáº£n lÃ½ danh sÃ¡ch analyzers
```

> **Táº¡i sao tÃ¡ch `plan/` thay vÃ¬ sá»­a `executor/plan_analyzer.py`?**  
> `executor/plan_analyzer.py` Ä‘ang Ä‘Æ°á»£c AI agent dÃ¹ng qua tool executor. Thay Ä‘á»•i nÃ³ sáº½ break AI flow. Module `plan/` lÃ  independent, phá»¥c vá»¥ endpoint má»›i.

---

## 3. Data Models (`plan/models/`)

### 3.1 `parsed_plan.py` â€” Output cá»§a parser

```python
# Trung gian giá»¯a parser vÃ  analyzer
# KhÃ´ng cÃ³ logic â€” chá»‰ lÃ  data container

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
    # Actual stats (None náº¿u estimated plan)
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
    warnings: list[NodeWarning]           # Warnings tá»« XML (SpillToTempDb, etc.)
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


# Context object truyá»n vÃ o analyzer â€” bá»c (statement, plan) thÃ nh 1 unit
# Khi cáº§n phÃ¢n tÃ­ch loáº¡i khÃ¡c (deadlock, query text, ...) â†’ táº¡o context riÃªng,
# khÃ´ng sá»­a AbstractAnalyzer.
@dataclass(frozen=True)
class PlanContext:
    statement: ParsedStatement
    plan: ParsedPlan
```

### 3.2 `result.py` â€” Output tráº£ vá» caller

```python
class Severity(str, Enum):
    CRITICAL = "critical"   # Cáº§n fix ngay
    WARNING  = "warning"    # CÃ³ váº¥n Ä‘á», nÃªn xem xÃ©t
    INFO     = "info"       # Awareness

class Action(BaseModel):
    type: str               # "create_index" | "rewrite_query" | "update_stats" | "config"
    ddl: str | None         # SQL cÃ³ thá»ƒ copy-paste cháº¡y ngay
    description: str        # MÃ´ táº£ action

class Finding(BaseModel):
    severity: Severity
    category: str           # "memory" | "operator" | "index" | "parallelism" | "parameter" | "wait" | "code"
    type: str               # "key_lookup" | "spill" | "missing_index" | "implicit_conversion" | ...
    description: str        # MÃ´ táº£ váº¥n Ä‘á» + context (table, cost%, actual numbers)
    recommendation: str     # HÆ°á»›ng giáº£i quyáº¿t báº±ng ngÃ´n ngá»¯ tá»± nhiÃªn
    action: Action | None   # DDL hoáº·c SQL cá»¥ thá»ƒ náº¿u cÃ³

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

    # Findings (káº¿t quáº£ phÃ¢n tÃ­ch)
    findings: list[Finding]              # Sorted by severity desc
    critical_count: int
    warning_count: int
    info_count: int

    # Structured data sections (dÃ¹ng cho UI rendering)
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

**NguyÃªn táº¯c:** Parser chá»‰ **Ä‘á»c XML vÃ  map sang model**. KhÃ´ng cÃ³ logic "cÃ¡i nÃ y tá»‘t hay xáº¥u". KhÃ´ng raise exception â€” tráº£ vá» partial data náº¿u element thiáº¿u.

### 4.1 `plan_parser.py` â€” Entry point

```python
class PlanParser:
    """
    Orchestrate toÃ n bá»™ XML parsing.
    Single Responsibility: chá»‰ coordinate sub-parsers.
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

### 4.2 `operator_parser.py` â€” Äá»‡ quy qua RelOp tree

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

### 5.1 `base.py` â€” Template Method Pattern

Template Method Ä‘á»‹nh nghÄ©a **skeleton cá»§a thuáº­t toÃ¡n** phÃ¢n tÃ­ch. Subclass chá»‰ override cÃ¡c bÆ°á»›c cá»¥ thá»ƒ.

```python
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

TContext = TypeVar("TContext")


class AbstractAnalyzer(ABC, Generic[TContext]):
    """
    Template Method Pattern + Generic[TContext].

    TContext = kiá»ƒu context analyzer nháº­n vÃ o.
    - XML plan analyzers dÃ¹ng: AbstractAnalyzer[PlanContext]
    - Deadlock analyzers dÃ¹ng: AbstractAnalyzer[DeadlockContext]
    - Má»—i loáº¡i source cÃ³ TContext riÃªng â€” AbstractAnalyzer khÃ´ng thay Ä‘á»•i.

    Skeleton cá»‘ Ä‘á»‹nh:
      analyze() â†’ _is_applicable() â†’ _collect_findings() â†’ _post_process()

    Subclass implement:
      - _is_applicable(): Ä‘iá»u kiá»‡n Ä‘á»ƒ analyzer nÃ y cÃ³ thá»ƒ cháº¡y
      - _collect_findings(): logic phÃ¡t hiá»‡n váº¥n Ä‘á», tráº£ raw findings

    Subclass cÃ³ thá»ƒ override (optional):
      - _post_process(): dedup, sort, limit findings
    """

    @property
    @abstractmethod
    def category(self) -> str:
        """Category cá»§a analyzer: memory/operator/index/parallelism/..."""

    def analyze(self, context: TContext) -> list[Finding]:
        """Entry point â€” KHÃ”NG override method nÃ y."""
        if not self._is_applicable(context):
            return []
        findings = self._collect_findings(context)
        return self._post_process(findings)

    @abstractmethod
    def _is_applicable(self, context: TContext) -> bool:
        """
        Guard condition. Tráº£ False Ä‘á»ƒ skip analyzer nÃ y.
        VÃ­ dá»¥: WaitAnalyzer chá»‰ cháº¡y khi has_actual_stats=True.
        """

    @abstractmethod
    def _collect_findings(self, context: TContext) -> list[Finding]:
        """Core logic â€” detect issues, build Finding objects."""

    def _post_process(self, findings: list[Finding]) -> list[Finding]:
        """
        Optional override. Default: sort by severity desc.
        Subclass cÃ³ thá»ƒ override Ä‘á»ƒ dedup hoáº·c limit.
        """
        order = {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}
        return sorted(findings, key=lambda f: order[f.severity])
```

### 5.2 VÃ­ dá»¥ concrete analyzers

#### `memory_analyzer.py`
```python
class MemoryAnalyzer(AbstractAnalyzer[PlanContext]):
    """PhÃ¡t hiá»‡n memory grant issues: spill risk, waste, grant wait, large grant."""

    @property
    def category(self) -> str:
        return "memory"

    def _is_applicable(self, context: PlanContext) -> bool:
        return context.statement.memory_grant is not None

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings = []
        mg = context.statement.memory_grant

        # Spill risk
        if mg.max_used_kb and mg.granted_kb:
            if mg.max_used_kb >= mg.granted_kb * 0.9:
                findings.append(Finding(
                    severity=Severity.CRITICAL,
                    category=self.category,
                    type="memory_spill_risk",
                    description=(
                        f"Query Ä‘Ã£ dÃ¹ng {mg.max_used_kb // 1024} MB / "
                        f"{mg.granted_kb // 1024} MB Ä‘Æ°á»£c cáº¥p "
                        f"({mg.max_used_kb * 100 // mg.granted_kb}%). "
                        "Gáº§n cháº¡m giá»›i háº¡n â€” ráº¥t cÃ³ thá»ƒ Ä‘Ã£ hoáº·c sáº¯p spill ra TempDB."
                    ),
                    recommendation=(
                        "Cáº­p nháº­t statistics Ä‘á»ƒ optimizer Æ°á»›c lÆ°á»£ng rows chÃ­nh xÃ¡c hÆ¡n, "
                        "giÃºp memory grant phÃ¹ há»£p vá»›i dá»¯ liá»‡u thá»±c."
                    ),
                    action=Action(
                        type="update_stats",
                        ddl="UPDATE STATISTICS [schema].[table] WITH FULLSCAN;",
                        description="Update statistics cho cÃ¡c báº£ng lá»›n trong plan",
                    ),
                ))

        # Grant wait â€” server memory pressure
        if mg.grant_wait_ms and mg.grant_wait_ms > 0:
            severity = Severity.CRITICAL if mg.grant_wait_ms >= 5000 else Severity.WARNING
            findings.append(Finding(
                severity=severity,
                category=self.category,
                type="memory_grant_wait",
                description=(
                    f"Query pháº£i chá» {mg.grant_wait_ms:,} ms Ä‘á»ƒ Ä‘Æ°á»£c cáº¥p memory. "
                    "Server Ä‘ang thiáº¿u workspace memory."
                ),
                recommendation=(
                    "Kiá»ƒm tra memory pressure tá»•ng thá»ƒ trÃªn server. "
                    "Xem xÃ©t giáº£m max_grant_percent hoáº·c tá»‘i Æ°u cÃ¡c query tá»‘n nhiá»u memory."
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
                        f"Query Ä‘Æ°á»£c cáº¥p {mg.granted_kb // 1024} MB nhÆ°ng chá»‰ dÃ¹ng "
                        f"{mg.max_used_kb // 1024} MB ({waste_ratio}x overestimate). "
                        "Memory dÆ° bá»‹ giá»¯ lock, giáº£m concurrency server."
                    ),
                    recommendation=(
                        "Statistics cÃ³ thá»ƒ Ä‘Ã£ stale â€” row estimate quÃ¡ cao dáº«n Ä‘áº¿n "
                        "memory grant thá»«a. Cháº¡y UPDATE STATISTICS."
                    ),
                    action=None,
                ))
        return findings
```

#### `operator_analyzer.py`
```python
class OperatorAnalyzer(AbstractAnalyzer[PlanContext]):
    """
    PhÃ¢n tÃ­ch operator tree: Key Lookup, Eager Spool, Sort, NL high exec,
    Scan with predicate, Non-SARGable, Row estimate mismatch.
    """

    @property
    def category(self) -> str:
        return "operator"

    def _is_applicable(self, context: PlanContext) -> bool:
        return context.statement.root_node is not None

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings = []
        all_nodes = self._flatten(context.statement.root_node)
        for node in all_nodes:
            findings.extend(self._analyze_node(node, context.statement))
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
                    f"Key Lookup trÃªn {node.object_name or 'unknown'} "
                    f"chiáº¿m ~{cost_pct:.0f}% estimated cost. "
                    f"Columns cáº§n fetch: {include_cols}."
                ),
                recommendation=(
                    "ThÃªm cÃ¡c columns nÃ y vÃ o INCLUDE list cá»§a nonclustered index "
                    "Ä‘á»ƒ táº¡o covering index, loáº¡i bá» Key Lookup."
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
                    f"Eager Index Spool táº¡i node {node.node_id}. "
                    "SQL Server Ä‘ang tá»± build temporary index trong TempDB má»—i láº§n execute."
                ),
                recommendation=(
                    "Táº¡o permanent index trÃªn báº£ng nguá»“n Ä‘á»ƒ loáº¡i bá» spool. "
                    "Spool nÃ y rebuild index tá»« Ä‘áº§u má»—i láº§n query cháº¡y."
                ),
                action=Action(
                    type="create_index",
                    ddl=node.suggested_index,
                    description="Táº¡o index permanent Ä‘á»ƒ thay tháº¿ spool",
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
                        f"actual {actual_per_exec:,.0f} rows/exec â€” "
                        f"{factor:.0f}x {direction}."
                    ),
                    recommendation=(
                        "Row estimate sai dáº«n Ä‘áº¿n sai join type, memory grant, "
                        "vÃ  access method. Cáº­p nháº­t statistics hoáº·c dÃ¹ng "
                        "OPTION(RECOMPILE) Ä‘á»ƒ force re-estimate."
                    ),
                    action=None,
                ))

        return findings
```

#### `index_analyzer.py`
```python
class IndexAnalyzer(AbstractAnalyzer[PlanContext]):
    """PhÃ¢n tÃ­ch missing indexes: impact, cháº¥t lÆ°á»£ng gá»£i Ã½, auto DDL."""

    @property
    def category(self) -> str:
        return "index"

    def _is_applicable(self, context: PlanContext) -> bool:
        return len(context.statement.missing_indexes) > 0

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings = []
        table_counts: dict[str, int] = {}

        for mi in context.statement.missing_indexes:
            table_key = f"{mi.schema}.{mi.table}"
            table_counts[table_key] = table_counts.get(table_key, 0) + 1

        seen_tables: set[str] = set()
        for mi in context.statement.missing_indexes:
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
                        f"{table_counts[table_key]} gá»£i Ã½ missing index cÃ¹ng báº£ng {table_key}. "
                        "Táº¡o háº¿t sáº½ gÃ¢y maintenance overhead."
                    ),
                    recommendation="Consolidate thÃ nh 1-2 composite index thay vÃ¬ táº¡o riÃªng láº».",
                    action=None,
                ))

            # Wide INCLUDE
            if len(include_cols) > 5:
                findings.append(Finding(
                    severity=Severity.WARNING,
                    category=self.category,
                    type="wide_index_suggestion",
                    description=(
                        f"Missing index trÃªn {table_key} cÃ³ {len(include_cols)} INCLUDE columns. "
                        "\"Kitchen sink\" index â€” SQL Server gá»£i Ã½ cover má»i column query dÃ¹ng."
                    ),
                    recommendation=(
                        "ÄÃ¡nh giÃ¡ láº¡i xem columns nÃ o thá»±c sá»± cáº§n. "
                        "Index rá»™ng tá»‘n storage vÃ  lÃ m cháº­m INSERT/UPDATE/DELETE."
                    ),
                    action=Action(
                        type="create_index",
                        ddl=mi.create_statement,
                        description=f"Tham kháº£o DDL (review trÆ°á»›c khi apply): impact {mi.impact:.1f}%",
                    ),
                ))
            elif mi.impact >= 25:
                findings.append(Finding(
                    severity=Severity.CRITICAL if mi.impact >= 70 else Severity.WARNING,
                    category=self.category,
                    type="missing_index",
                    description=(
                        f"Missing index trÃªn {table_key} vá»›i impact {mi.impact:.1f}%. "
                        f"Key columns: {', '.join(key_cols)}. "
                        + (f"Include: {', '.join(include_cols)}." if include_cols else "")
                    ),
                    recommendation=(
                        f"Táº¡o index nÃ y Ä‘á»ƒ cáº£i thiá»‡n Æ°á»›c tÃ­nh {mi.impact:.0f}% query cost. "
                        "Test trÃªn mÃ´i trÆ°á»ng staging trÆ°á»›c."
                    ),
                    action=Action(
                        type="create_index",
                        ddl=mi.create_statement,
                        description="Ready-to-run CREATE INDEX statement",
                    ),
                ))

        return findings
```

### 5.3 `registry.py` â€” Quáº£n lÃ½ danh sÃ¡ch analyzers

```python
class AnalyzerRegistry(Generic[TContext]):
    """
    Open/Closed Principle: thÃªm analyzer má»›i chá»‰ cáº§n register, khÃ´ng sá»­a code cÅ©.
    Dependency Inversion: PlanAnalysisService phá»¥ thuá»™c vÃ o abstraction (AbstractAnalyzer),
    khÃ´ng phá»¥ thuá»™c vÃ o concrete implementations.

    Generic[TContext]: registry chá»‰ chá»©a analyzers cÃ¹ng loáº¡i context.
    - AnalyzerRegistry[PlanContext]   â†’ plan XML analyzers
    - AnalyzerRegistry[DeadlockContext] â†’ deadlock analyzers (tÆ°Æ¡ng lai)
    """

    def __init__(self) -> None:
        self._analyzers: list[AbstractAnalyzer[TContext]] = []

    def register(self, analyzer: AbstractAnalyzer[TContext]) -> "AnalyzerRegistry[TContext]":
        self._analyzers.append(analyzer)
        return self  # Fluent interface

    def get_all(self) -> list[AbstractAnalyzer[TContext]]:
        return list(self._analyzers)

    @classmethod
    def default(cls) -> "AnalyzerRegistry[PlanContext]":
        """Factory method â€” táº¡o registry vá»›i táº¥t cáº£ built-in plan analyzers."""
        return (
            cls()
            .register(MemoryAnalyzer())
            .register(OperatorAnalyzer())
            .register(IndexAnalyzer())
            .register(ParallelismAnalyzer())
            .register(ParameterAnalyzer())
            .register(WaitAnalyzer())
            .register(StatisticsAnalyzer())
            # ThÃªm analyzer má»›i á»Ÿ Ä‘Ã¢y khi cáº§n
        )
```

---

## 6. Service Layer (`plan/service.py`) â€” Facade

```python
class PlanAnalysisService:
    """
    Facade â€” entry point duy nháº¥t cho toÃ n bá»™ plan analysis.
    Caller (API route, Layer 1) chá»‰ cáº§n biáº¿t class nÃ y.
    """

    def __init__(
        self,
        parser: PlanParser,
        registry: AnalyzerRegistry[PlanContext],
    ) -> None:
        self._parser = parser
        self._registry = registry

    def analyze(self, plan_xml: str) -> PlanAnalysisResult:
        start = time.monotonic()

        parsed = self._parser.parse(plan_xml)  # XML â†’ ParsedPlan

        statement_results = []
        for stmt in parsed.statements:
            context = PlanContext(statement=stmt, plan=parsed)
            findings: list[Finding] = []
            for analyzer in self._registry.get_all():
                findings.extend(analyzer.analyze(context))

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
        """Factory â€” wiring dependencies. DÃ¹ng trong main.py startup."""
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

## 7. API Endpoint Má»›i

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
    Parse vÃ  phÃ¢n tÃ­ch SQL Server execution plan XML.
    Pure deterministic â€” khÃ´ng gá»i AI, khÃ´ng query DB.
    Layer 1: gá»i Ä‘á»ƒ láº¥y káº¿t quáº£ rá»“i tá»± lÆ°u MongoDB.
    Layer 3: gá»i Ä‘á»ƒ render UI.
    """
    if not body.plan_xml or not body.plan_xml.strip():
        raise HTTPException(status_code=400, detail="plan_xml khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng")

    service: PlanAnalysisService = request.app.state.plan_analysis_service
    try:
        result = service.analyze(body.plan_xml)
    except PlanParseError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    return result
```

### ÄÄƒng kÃ½ trong `main.py`

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
          "description": "Key Lookup trÃªn dbo.Orders chiáº¿m ~45% estimated cost. Columns cáº§n fetch: Status, TotalAmount, CreatedAt.",
          "recommendation": "ThÃªm Status, TotalAmount, CreatedAt vÃ o INCLUDE list cá»§a IX_Orders_CustomerId Ä‘á»ƒ táº¡o covering index.",
          "action": {
            "type": "create_index",
            "ddl": "ALTER INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] REBUILD;\n-- Hoáº·c táº¡o má»›i:\nCREATE NONCLUSTERED INDEX [IX_Orders_CustomerId_Cover]\nON [dbo].[Orders] ([CustomerId])\nINCLUDE ([Status], [TotalAmount], [CreatedAt]);",
            "description": "Covering index Ä‘á»ƒ loáº¡i bá» Key Lookup"
          }
        },
        {
          "severity": "warning",
          "category": "memory",
          "type": "memory_spill_risk",
          "description": "Query Ä‘Ã£ dÃ¹ng 480 MB / 512 MB Ä‘Æ°á»£c cáº¥p (93%). Gáº§n cháº¡m giá»›i háº¡n.",
          "recommendation": "Cáº­p nháº­t statistics Ä‘á»ƒ optimizer Æ°á»›c lÆ°á»£ng rows chÃ­nh xÃ¡c hÆ¡n.",
          "action": {
            "type": "update_stats",
            "ddl": "UPDATE STATISTICS [dbo].[Orders] WITH FULLSCAN;",
            "description": "Update statistics cho báº£ng Orders"
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

## 9. Analyzers Cáº§n Implement

| Analyzer | Category | Rules chÃ­nh |
|---|---|---|
| `MemoryAnalyzer` | memory | Spill risk, wasted grant, grant wait, large grant (>1GB) |
| `OperatorAnalyzer` | operator | Key Lookup, RID Lookup, Eager Index Spool, Sort>20%, Filter operator, Lazy Spool ineffective, NL high exec, Row estimate mismatch, Non-SARGable (CONVERT_IMPLICIT, ISNULL, leading LIKE, CASE, function on column), Scan with predicate |
| `IndexAnalyzer` | index | Missing index (impact, DDL), wide INCLUDE, low impact, duplicate suggestions |
| `ParallelismAnalyzer` | parallelism | Serial plan reason (actionable vs passive), ineffective parallelism efficiency%, parallel wait bottleneck, thread skew |
| `ParameterAnalyzer` | parameter | Sniffing mismatch (compiledâ‰ runtime), local variables (no compiled value), OPTIMIZE FOR UNKNOWN |
| `WaitAnalyzer` | wait | LCK (blocking), PAGEIOLATCH (disk I/O), CXPACKET (parallelism), RESOURCE_SEMAPHORE (memory), SOS_SCHEDULER_YIELD (CPU) |
| `StatisticsAnalyzer` | statistics | Stale stats (high ModificationCount + old LastUpdate), low sampling %, never updated |
| `CodePatternAnalyzer` | code | Scalar UDF detected, table variable, CTE multi-reference, NOT IN nullable, Row Goal active |
| `CompilationAnalyzer` | compilation | High compile CPU (>1000ms), MemoryLimitExceeded early abort, CE model version 70 |

---

## 10. Danh SÃ¡ch Finding Types

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

| NguyÃªn táº¯c | Ãp dá»¥ng |
|---|---|
| **S** Single Responsibility | Parser chá»‰ parse. Má»—i Analyzer chá»‰ analyze 1 category. Service chá»‰ orchestrate. `PlanContext` chá»‰ lÃ  data holder. |
| **O** Open/Closed | ThÃªm plan analyzer má»›i: táº¡o class `AbstractAnalyzer[PlanContext]` + register. ThÃªm loáº¡i source má»›i (deadlock): táº¡o `DeadlockContext` + `AbstractAnalyzer[DeadlockContext]`. KhÃ´ng sá»­a code cÅ©. |
| **L** Liskov Substitution | Má»i `AbstractAnalyzer[PlanContext]` subclass cÃ³ thá»ƒ thay tháº¿ nhau trong `AnalyzerRegistry[PlanContext]`. |
| **I** Interface Segregation | `AbstractAnalyzer` chá»‰ expose `analyze(context)`. Parser sub-classes tÃ¡ch theo domain. `PlanContext` khÃ´ng expose method â€” chá»‰ lÃ  data. |
| **D** Dependency Inversion | `AbstractAnalyzer` phá»¥ thuá»™c `TContext` abstraction, khÃ´ng phá»¥ thuá»™c `ParsedPlan` concrete. `PlanAnalysisService` nháº­n `AnalyzerRegistry[PlanContext]` qua constructor. |

---

## 12. Template Method â€” Extensibility

Khi cáº§n thÃªm analyzer má»›i (vÃ­ dá»¥ `ColumnstoreAnalyzer` trong tÆ°Æ¡ng lai):

```python
# ThÃªm analyzer cÃ¹ng loáº¡i (XML plan) â€” chá»‰ cáº§n táº¡o class vÃ  register
class ColumnstoreAnalyzer(AbstractAnalyzer[PlanContext]):

    @property
    def category(self) -> str:
        return "columnstore"

    def _is_applicable(self, context: PlanContext) -> bool:
        return any(
            "Columnstore" in n.physical_op
            for n in self._flatten(context.statement.root_node)
        )

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings = []
        # ... logic phÃ¢n tÃ­ch segment reads/skips, batch mode, ...
        return findings

# ÄÄƒng kÃ½ â€” KHÃ”NG cáº§n sá»­a báº¥t ká»³ file nÃ o khÃ¡c
registry.register(ColumnstoreAnalyzer())


# ThÃªm loáº¡i phÃ¢n tÃ­ch má»›i (deadlock graph) â€” TContext khÃ¡c, khÃ´ng cháº¡m code plan/
@dataclass(frozen=True)
class DeadlockContext:
    deadlock: ParsedDeadlock          # model riÃªng trong layer2/deadlock/

class VictimChainAnalyzer(AbstractAnalyzer[DeadlockContext]):

    @property
    def category(self) -> str:
        return "deadlock"

    def _is_applicable(self, context: DeadlockContext) -> bool:
        return len(context.deadlock.victims) > 1

    def _collect_findings(self, context: DeadlockContext) -> list[Finding]:
        findings = []
        # ... logic phÃ¢n tÃ­ch deadlock chain, ...
        return findings

deadlock_registry = AnalyzerRegistry[DeadlockContext]()
deadlock_registry.register(VictimChainAnalyzer())
# AbstractAnalyzer khÃ´ng thay Ä‘á»•i â€” Finding model dÃ¹ng chung
```

---

## 13. Migration tá»« plan_analyzer.py Hiá»‡n Táº¡i

`executor/plan_analyzer.py` **giá»¯ nguyÃªn** â€” AI agent tool váº«n dÃ¹ng nÃ³.

Sau khi module `plan/` hoÃ n thÃ nh:
- Layer 1's `plan_analysis` detector: giá»¯ nguyÃªn logic hiá»‡n cÃ³ hoáº·c upgrade gá»i endpoint má»›i
- AI agent (`tool_executor.py`): tool `analyze_plan` váº«n gá»i `executor/plan_analyzer.py`
- Endpoint má»›i `/api/v1/plan/analyze`: dÃ¹ng module `plan/` hoÃ n toÃ n má»›i

KhÃ´ng cÃ³ breaking change.

---

## 14. Thá»© Tá»± Implementation

```
Phase 1 â€” Foundation (khÃ´ng cÃ³ UI, test báº±ng curl)
  [ ] plan/models/parsed_plan.py  â€” PlanNode, ParsedStatement, ParsedPlan
  [ ] plan/models/result.py       â€” Finding, Action, Severity, PlanAnalysisResult
  [ ] plan/parser/plan_parser.py  â€” XML â†’ ParsedPlan
  [ ] plan/analyzers/base.py      â€” AbstractAnalyzer (Template Method)
  [ ] plan/service.py             â€” PlanAnalysisService.create()
  [ ] api/routes/plan.py          â€” POST /api/v1/plan/analyze
  [ ] main.py                     â€” register route + init service

Phase 2 â€” Core Analyzers (cÃ¡c váº¥n Ä‘á» quan trá»ng nháº¥t)
  [ ] OperatorAnalyzer            â€” Key Lookup, Eager Spool, Row estimate mismatch
  [ ] IndexAnalyzer               â€” Missing index + DDL
  [ ] MemoryAnalyzer              â€” Spill risk, grant wait, waste
  [ ] ParallelismAnalyzer         â€” Serial reason, efficiency

Phase 3 â€” Full Coverage
  [ ] ParameterAnalyzer           â€” Sniffing, local variables
  [ ] WaitAnalyzer                â€” Per wait type advice
  [ ] StatisticsAnalyzer          â€” Stale stats
  [ ] CodePatternAnalyzer         â€” UDF, table variable, CTE
  [ ] CompilationAnalyzer         â€” High compile CPU, CE version

Phase 4 â€” Integration
  [ ] Layer 1: gá»i endpoint + lÆ°u MongoDB
  [ ] Layer 3: gá»i endpoint + render UI
```

---

## 15. File Summary

| File | DÃ²ng Æ°á»›c tÃ­nh | MÃ´ táº£ |
|---|---|---|
| `plan/models/parsed_plan.py` | ~150 | Data containers tá»« XML |
| `plan/models/result.py` | ~100 | Output models |
| `plan/parser/plan_parser.py` | ~80 | Orchestrator parser |
| `plan/parser/statement_parser.py` | ~120 | Statement metadata |
| `plan/parser/operator_parser.py` | ~200 | RelOp tree recursion |
| `plan/parser/index_parser.py` | ~80 | Missing indexes + stats |
| `plan/analyzers/base.py` | ~60 | Template Method abstract |
| `plan/analyzers/operator_analyzer.py` | ~300 | Largest â€” 15+ rules |
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

**Tá»•ng:** ~1,900 dÃ²ng Python â€” thay tháº¿ 243 dÃ²ng hiá»‡n táº¡i vá»›i coverage tÄƒng 10x.

---

## 16. Definition of Done

### v1 â€” XML Plan Only (Phase 1â€“3)

**Parser:**
- [ ] Parse Ä‘Æ°á»£c `ShowPlanXML` há»£p lá»‡ â€” estimated plan vÃ  actual plan
- [ ] `ParsedPlan.statements` khÃ´ng rá»—ng vá»›i plan cÃ³ Ã­t nháº¥t 1 `StmtSimple`
- [ ] Tráº£ `PlanParseError` rÃµ rÃ ng khi XML malformed â€” khÃ´ng crash silently
- [ ] `PlanNode` tree Ä‘Ãºng cáº¥u trÃºc chaâ€“con (parent/children links)
- [ ] `has_actual_stats=True` khi plan cÃ³ `RunTimeCountersPerThread`

**Analyzers:**
- [ ] 9 analyzers implement Ä‘á»§ (Memory, Operator, Index, Parallelism, Parameter, Wait, Statistics, CodePattern, Compilation)
- [ ] Má»—i `Finding` cÃ³ `severity`, `category`, `type`, `description`, `recommendation` â€” khÃ´ng cÃ³ field None báº¯t buá»™c
- [ ] `Finding.action.ddl` lÃ  SQL cÃ³ thá»ƒ cháº¡y Ä‘Æ°á»£c (khÃ´ng pháº£i placeholder) cho: Key Lookup, Missing Index, Eager Spool
- [ ] `_is_applicable()` guard hoáº¡t Ä‘á»™ng â€” analyzer khÃ´ng cháº¡y khi thiáº¿u data (VD: `WaitAnalyzer` bá» qua estimated plan)

**Endpoint:**
- [ ] `POST /api/v1/plan/analyze` tráº£ HTTP 200 vá»›i valid plan
- [ ] Tráº£ HTTP 400 khi `plan_xml` rá»—ng, HTTP 422 khi XML malformed
- [ ] `analysis_duration_ms` < 500ms cho plan thÃ´ng thÆ°á»ng (< 50 nodes)
- [ ] KhÃ´ng gá»i Claude API, khÃ´ng query DB trong code path nÃ y

**Integration:**
- [ ] Layer 1 gá»i endpoint thÃ nh cÃ´ng, nháº­n `PlanAnalysisResult` JSON
- [ ] Layer 3 gá»i endpoint thÃ nh cÃ´ng, render findings trÃªn UI
- [ ] `executor/plan_analyzer.py` váº«n hoáº¡t Ä‘á»™ng bÃ¬nh thÆ°á»ng â€” khÃ´ng cÃ³ breaking change

---

### v2 â€” Multi-Source (tÆ°Æ¡ng lai â€” chÆ°a implement)

**Äiá»u kiá»‡n báº¯t Ä‘áº§u v2:** cÃ³ use case thá»±c táº¿ thá»© 2 (deadlock graph hoáº·c query text analysis).

- [ ] `AbstractAnalyzer[TContext]` tÃ¡i dÃ¹ng Ä‘Æ°á»£c cho source má»›i mÃ  khÃ´ng sá»­a `base.py`
- [ ] `Finding` model dÃ¹ng chung giá»¯a cÃ¡c domain â€” khÃ´ng fork model
- [ ] Source má»›i cÃ³ `Parser` + `Context` + `AnalyzerRegistry` riÃªng trong thÆ° má»¥c riÃªng (`layer2/deadlock/`, `layer2/querytext/`)
- [ ] Endpoint má»›i (`/api/v1/deadlock/analyze`) Ä‘á»™c láº­p â€” khÃ´ng áº£nh hÆ°á»Ÿng `/api/v1/plan/analyze`

---

### v3 â€” Cross-Source Correlation (tÆ°Æ¡ng lai)

**Äiá»u kiá»‡n báº¯t Ä‘áº§u v3:** v2 stable vá»›i Ã­t nháº¥t 2 source.

- [ ] CÃ³ thá»ƒ correlate finding tá»« nhiá»u source (VD: deadlock victim = query cÃ³ Key Lookup trong plan)
- [ ] Unified `AnalysisReport` aggregate findings tá»« nhiá»u `AnalysisResult`

---

*TÃ i liá»‡u nÃ y lÃ  implementation plan â€” khÃ´ng pháº£i code cuá»‘i cÃ¹ng. CÃ¡c method signatures vÃ  model fields cÃ³ thá»ƒ Ä‘iá»u chá»‰nh trong quÃ¡ trÃ¬nh implement.*

