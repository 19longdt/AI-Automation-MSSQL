from __future__ import annotations

import time
from datetime import datetime, timezone

from .analyzers.registry import AnalyzerRegistry
from .models.parsed_plan import ParsedStatement, PlanContext, PlanNode
from .models.result import (
    IOStatSummary,
    IndexSuggestion,
    MemoryGrantSummary,
    OperatorSummary,
    ParameterInfo,
    PlanAnalysisResult,
    StatementResult,
    StatsSummary,
    WaitStatSummary,
)
from .parser import IndexParser, OperatorParser, PlanParser, StatementParser


class PlanAnalysisService:
    def __init__(self, parser: PlanParser, registry: AnalyzerRegistry) -> None:
        self._parser = parser
        self._registry = registry

    def analyze(self, plan_xml: str) -> PlanAnalysisResult:
        start = time.monotonic()
        parsed = self._parser.parse(plan_xml)

        statement_results: list[StatementResult] = []
        for stmt in parsed.statements:
            context = PlanContext(statement=stmt, plan=parsed)
            findings = []
            for analyzer in self._registry.get_all():
                findings.extend(analyzer.analyze(context))

            critical_count = sum(1 for f in findings if f.severity.value == "critical")
            warning_count = sum(1 for f in findings if f.severity.value == "warning")
            info_count = sum(1 for f in findings if f.severity.value == "info")

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
                    critical_count=critical_count,
                    warning_count=warning_count,
                    info_count=info_count,
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
            analyzed_at=datetime.now(timezone.utc),
            analysis_duration_ms=duration_ms,
        )

    def _build_top_operators(self, stmt: ParsedStatement) -> list[OperatorSummary]:
        nodes = self._flatten(stmt.root_node)
        total_cost = stmt.total_cost if stmt.total_cost > 0 else 1.0
        top = sorted(nodes, key=lambda n: n.estimated_cost, reverse=True)[:10]
        return [
            OperatorSummary(
                node_id=n.node_id,
                physical_op=n.physical_op,
                logical_op=n.logical_op,
                cost_pct=(n.estimated_cost / total_cost) * 100,
                estimated_rows=n.estimate_rows,
                actual_rows=n.actual_rows,
                actual_elapsed_ms=n.actual_elapsed_ms,
                actual_logical_reads=n.actual_logical_reads,
            )
            for n in top
        ]

    def _build_index_summary(self, stmt: ParsedStatement) -> list[IndexSuggestion]:
        out: list[IndexSuggestion] = []
        for m in stmt.missing_indexes:
            key_cols = [*m.equality_columns, *m.inequality_columns]
            ddl = None
            if m.table and key_cols:
                keys = ", ".join(f"[{c}]" for c in key_cols)
                includes = ", ".join(f"[{c}]" for c in m.include_columns)
                ddl = f"CREATE NONCLUSTERED INDEX [IX_{m.table}_Auto] ON [{m.schema or 'dbo'}].[{m.table}] ({keys})"
                if includes:
                    ddl += f" INCLUDE ({includes})"
                ddl += ";"
            out.append(
                IndexSuggestion(
                    table=f"{m.schema}.{m.table}".strip("."),
                    impact=m.impact,
                    equality_columns=m.equality_columns,
                    inequality_columns=m.inequality_columns,
                    include_columns=m.include_columns,
                    create_statement=ddl,
                )
            )
        return out

    def _build_memory_summary(self, stmt: ParsedStatement) -> MemoryGrantSummary | None:
        mg = stmt.memory_grant
        if mg is None:
            return None
        return MemoryGrantSummary(
            requested_kb=mg.requested_kb,
            granted_kb=mg.granted_kb,
            max_used_kb=mg.max_used_kb,
            grant_wait_ms=mg.grant_wait_ms,
        )

    def _build_parameter_summary(self, stmt: ParsedStatement) -> list[ParameterInfo]:
        return [
            ParameterInfo(
                name=p.name,
                data_type=p.data_type,
                compiled_value=p.compiled_value,
                runtime_value=p.runtime_value,
            )
            for p in stmt.parameters
        ]

    def _build_wait_summary(self, stmt: ParsedStatement) -> list[WaitStatSummary]:
        out: list[WaitStatSummary] = []
        for w in stmt.wait_stats:
            category = "other"
            if w.wait_type.startswith("LCK_M_"):
                category = "blocking"
            elif w.wait_type.startswith("PAGEIOLATCH"):
                category = "disk_io"
            elif w.wait_type in {"CXPACKET", "CXCONSUMER"}:
                category = "parallelism"
            elif w.wait_type == "RESOURCE_SEMAPHORE":
                category = "memory"
            elif w.wait_type == "SOS_SCHEDULER_YIELD":
                category = "cpu"
            out.append(WaitStatSummary(type=w.wait_type, ms=w.wait_time_ms, count=w.wait_count, category=category))
        return out

    def _build_stats_summary(self, stmt: ParsedStatement) -> list[StatsSummary]:
        return [
            StatsSummary(
                table=s.table,
                statistic=s.statistic,
                modification_count=s.modification_count,
                sampling_percent=s.sampling_percent,
                last_update=s.last_update,
            )
            for s in stmt.stats_usage
        ]

    def _build_io_summary(self, stmt: ParsedStatement) -> list[IOStatSummary]:
        reads: dict[str, int] = {}
        for node in self._flatten(stmt.root_node):
            if not node.table_name:
                continue
            reads[node.table_name] = reads.get(node.table_name, 0) + int(node.actual_logical_reads or 0)
        return [IOStatSummary(table=t, logical_reads=v) for t, v in sorted(reads.items(), key=lambda i: i[1], reverse=True)]

    def _flatten(self, root: PlanNode | None) -> list[PlanNode]:
        if root is None:
            return []
        out = [root]
        for c in root.children:
            out.extend(self._flatten(c))
        return out

    @classmethod
    def create(cls) -> "PlanAnalysisService":
        return cls(
            parser=PlanParser(
                statement_parser=StatementParser(),
                operator_parser=OperatorParser(),
                index_parser=IndexParser(),
            ),
            registry=AnalyzerRegistry.default(),
        )
