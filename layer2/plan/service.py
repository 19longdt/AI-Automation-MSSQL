from __future__ import annotations

import time
from datetime import datetime, timezone

from .analyzers.registry import AnalyzerRegistry
from .models.parsed_plan import ParsedStatement, PlanContext, PlanNode
from .models.result import (
    CompilationInfo,
    Finding,
    FindingGroup,
    FindingInstance,
    IOStatSummary,
    IndexUsage,
    IndexSuggestion,
    JoinTypeSummary,
    LookupQueries,
    MemoryGrantSummary,
    OperatorSummary,
    ParameterInfo,
    PlanAnalysisResult,
    Severity,
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
                    statement_text_truncated=stmt.statement_text_truncated,
                    statement_type=stmt.statement_type,
                    total_cost=stmt.total_cost,
                    elapsed_ms=stmt.query_time.elapsed_time if stmt.query_time else None,
                    cpu_ms=stmt.query_time.cpu_time if stmt.query_time else None,
                    dop=stmt.dop,
                    has_actual_stats=stmt.has_actual_stats,
                    ce_model_version=stmt.ce_model_version,
                    optm_level=stmt.optm_level,
                    query_hash=stmt.query_hash,
                    query_plan_hash=stmt.query_plan_hash,
                    finding_groups=self._build_finding_groups(findings),
                    critical_count=critical_count,
                    warning_count=warning_count,
                    info_count=info_count,
                    top_operators=self._build_top_operators(stmt),
                    missing_indexes=self._build_index_summary(stmt),
                    memory_grant=self._build_memory_summary(stmt),
                    parameters=self._build_parameter_summary(stmt),
                    wait_stats=self._build_wait_summary(stmt),
                    statistics=self._build_stats_summary(stmt),
                    io_stats=self._build_io_stats(stmt),
                    join_types=self._build_join_types(stmt),
                    indexes_used=self._build_indexes_used(stmt),
                    compilation=self._build_compilation(stmt),
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

    def _build_finding_groups(self, findings: list[Finding]) -> list[FindingGroup]:
        _sev_order = {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}
        groups: dict[str, FindingGroup] = {}
        for f in findings:
            key = f.type
            if key not in groups:
                groups[key] = FindingGroup(
                    severity=f.severity,
                    category=f.category,
                    type=f.type,
                    recommendation=f.recommendation,
                    shared_action=f.action,
                )
            g = groups[key]
            g.instances.append(FindingInstance(description=f.description, action=f.action))
            g.count = len(g.instances)
            if _sev_order[f.severity] < _sev_order[g.severity]:
                g.severity = f.severity
            # shared_action chỉ giữ khi mọi instance có cùng DDL
            if f.action != g.shared_action:
                g.shared_action = None
        return sorted(groups.values(), key=lambda g: (_sev_order[g.severity], -g.count))

    def _build_top_operators(self, stmt: ParsedStatement) -> list[OperatorSummary]:
        nodes = self._flatten(stmt.root_node)
        total_cost = stmt.total_cost if stmt.total_cost > 0 else 1.0
        top = sorted(nodes, key=lambda n: n.estimated_cost, reverse=True)[:10]
        return [
            OperatorSummary(
                node_id=n.node_id,
                physical_op=n.physical_op,
                logical_op=n.logical_op,
                op_type_tag=self._op_type_tag(n.physical_op, n.lookup),
                cost=n.estimated_cost,
                cost_pct=(n.estimated_cost / total_cost) * 100,
                estimated_rows=n.estimate_rows,
                actual_rows=n.actual_rows,
                actual_elapsed_ms=n.actual_elapsed_ms,
                actual_logical_reads=n.actual_logical_reads,
                actual_physical_reads=n.actual_physical_reads,
                read_ahead_reads=0.0,
                scan_count=n.actual_executions,
                has_row_est_off=self._is_row_est_off(n),
                has_spill=any(w.name == "SpillToTempDb" for w in n.warnings),
                table_name=n.table_name,
                index_name=n.index_name,
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
                ddl = f"CREATE NONCLUSTERED INDEX [IX_{m.table}_Auto] ON [{m.schema_name or 'dbo'}].[{m.table}] ({keys})"
                if includes:
                    ddl += f" INCLUDE ({includes})"
                ddl += ";"
            out.append(
                IndexSuggestion(
                    table=f"{m.schema_name}.{m.table}".strip("."),
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
            wt = w.wait_type
            if wt.startswith("LCK_M_"):
                category = "blocking"
            elif wt.startswith("PAGEIOLATCH") or wt.startswith("PAGELATCH"):
                category = "disk_io"
            elif wt in {"CXPACKET", "CXCONSUMER", "EXECSYNC"}:
                category = "parallelism"
            elif wt in {"RESOURCE_SEMAPHORE", "RESOURCE_SEMAPHORE_QUERY_COMPILE",
                        "MEMORY_ALLOCATION_EXT", "RESERVED_MEMORY_ALLOCATION_EXT"}:
                category = "memory"
            elif wt in {"SOS_SCHEDULER_YIELD", "THREADPOOL"}:
                category = "cpu"
            elif wt in {"WRITELOG", "LOGBUFFER", "LOG_RATE_GOVERNOR"}:
                category = "log_io"
            elif wt in {"HADR_SYNC_COMMIT", "HADR_WORK_QUEUE", "HADR_FILESTREAM_IOMGR_IOCOMPLETION",
                        "DBMIRRORING_CMD", "DBMIRROR_EVENTS_QUEUE"}:
                category = "hadr"
            elif wt in {"IO_COMPLETION", "ASYNC_IO_COMPLETION"}:
                category = "disk_io"
            elif wt == "ASYNC_NETWORK_IO":
                category = "network"
            elif wt.startswith("LATCH_"):
                category = "latch"
            else:
                category = "other"
            out.append(WaitStatSummary(type=wt, ms=w.wait_time_ms, count=w.wait_count, category=category))
        return out

    def _build_stats_summary(self, stmt: ParsedStatement) -> list[StatsSummary]:
        table_cardinality: dict[str, float] = {}
        for node in self._flatten(stmt.root_node):
            if not node.table_name or node.table_cardinality <= 0:
                continue
            key = node.table_name.lower()
            table_cardinality[key] = max(table_cardinality.get(key, 0.0), node.table_cardinality)

        out: list[StatsSummary] = []
        for s in stmt.stats_usage:
            mod = s.modification_count or 0
            card = table_cardinality.get((s.table or "").lower(), 0.0)
            is_stale = (card > 0 and mod > 0 and (mod / card) > 0.1)
            out.append(StatsSummary(
                table=s.table,
                statistic=s.statistic,
                modification_count=s.modification_count,
                sampling_percent=s.sampling_percent,
                last_update=s.last_update,
                is_stale=is_stale,
            ))
        return out

    def _build_indexes_used(self, stmt: ParsedStatement) -> list[IndexUsage]:
        seen: set[tuple[str, str, str]] = set()
        out: list[IndexUsage] = []
        for node in self._flatten(stmt.root_node):
            table = node.table_name or ""
            index = node.index_name or ""
            if not table or not index:
                continue
            tag = self._op_type_tag(node.physical_op, node.lookup)
            if tag not in {"SEEK", "SCAN", "LOOKUP"}:
                continue
            op_type = "Lookup" if tag == "LOOKUP" else ("Seek" if tag == "SEEK" else "Scan")
            key = (table, index, op_type)
            if key in seen:
                continue
            seen.add(key)
            out.append(IndexUsage(
                table=table,
                index=index,
                index_kind=node.index_kind or ("Clustered" if "Clustered" in node.physical_op else "NonClustered"),
                op_type=op_type,
                is_partitioned=node.partitioned,
            ))
        return out

    def _build_lookup_queries(self, query_hash: str | None) -> LookupQueries | None:
        if not query_hash:
            return None
        qh = query_hash
        plan_cache_sql = (
            "SELECT TOP (50) qs.execution_count, qs.total_elapsed_time, qs.total_worker_time, st.text\n"
            "FROM sys.dm_exec_query_stats qs\n"
            "CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st\n"
            f"WHERE qs.query_hash = {qh}\n"
            "ORDER BY qs.last_execution_time DESC;"
        )
        query_store_sql = (
            "SELECT TOP (50) q.query_hash, qt.query_sql_text, rs.count_executions, rs.avg_duration\n"
            "FROM sys.query_store_query q\n"
            "JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id\n"
            "JOIN sys.query_store_plan p ON q.query_id = p.query_id\n"
            "JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id\n"
            f"WHERE q.query_hash = {qh}\n"
            "ORDER BY rs.last_execution_time DESC;"
        )
        return LookupQueries(plan_cache_sql=plan_cache_sql, query_store_sql=query_store_sql)

    def _build_io_stats(self, stmt: ParsedStatement) -> list[IOStatSummary]:
        out: list[IOStatSummary] = []
        for node in self._flatten(stmt.root_node):
            logical_reads = int(node.actual_logical_reads or 0)
            physical_reads = int(node.actual_physical_reads or 0)
            if logical_reads <= 0 and physical_reads <= 0:
                continue
            out.append(IOStatSummary(
                node_id=node.node_id,
                physical_op=node.physical_op,
                op_type_tag=self._op_type_tag(node.physical_op, node.lookup),
                table_name=node.table_name,
                index_name=node.index_name,
                logical_reads=logical_reads,
                physical_reads=physical_reads,
                read_ahead_reads=0,
                scan_count=int(node.actual_executions or 0),
            ))
        return sorted(out, key=lambda x: x.logical_reads, reverse=True)

    def _build_join_types(self, stmt: ParsedStatement) -> list[JoinTypeSummary]:
        counts: dict[str, JoinTypeSummary] = {}
        tracked = {"Nested Loops", "Merge Join", "Hash Match", "Sort", "Parallelism"}
        spill_total = 0
        for node in self._flatten(stmt.root_node):
            has_spill = any(w.name == "SpillToTempDb" for w in node.warnings)
            if has_spill:
                spill_total += 1
            if node.physical_op not in tracked:
                continue
            key = node.physical_op
            if key not in counts:
                counts[key] = JoinTypeSummary(join_type=key, count=0, has_spill=False)
            counts[key].count += 1
            if has_spill:
                counts[key].has_spill = True
        if spill_total > 0:
            counts["__spill__"] = JoinTypeSummary(join_type="__spill__", count=spill_total, has_spill=True)
        return sorted(counts.values(), key=lambda x: x.count, reverse=True)

    def _build_compilation(self, stmt: ParsedStatement) -> CompilationInfo:
        return CompilationInfo(
            ce_model_version=stmt.ce_model_version,
            dop=stmt.dop,
            non_parallel_reason=stmt.non_parallel_reason,
            compile_cpu_ms=stmt.compile_cpu_ms,
            compile_memory_kb=stmt.compile_memory_kb,
            cached_plan_size_kb=stmt.cached_plan_size_kb,
            optm_level=stmt.optm_level,
            early_abort_reason=stmt.early_abort_reason,
            query_hash=stmt.query_hash,
            query_plan_hash=stmt.query_plan_hash,
            lookup_queries=self._build_lookup_queries(stmt.query_hash),
        )

    def _is_row_est_off(self, node: PlanNode) -> bool:
        if node.actual_rows is None or node.estimate_rows <= 0:
            return False
        ratio = node.actual_rows / node.estimate_rows
        return ratio >= 10 or ratio <= 0.1

    def _op_type_tag(self, physical_op: str, is_lookup: bool = False) -> str:
        if is_lookup:
            return "LOOKUP"
        mapping: dict[str, str] = {
            "Sort": "SORT",
            "Hash Match": "HASH",
            "Merge Join": "JOIN",
            "Nested Loops": "JOIN",
            "Parallelism": "PARALLEL",
            "Stream Aggregate": "AGG",
            "Compute Scalar": "SCALAR",
            "Index Seek": "SEEK",
            "Clustered Index Seek": "SEEK",
            "Index Scan": "SCAN",
            "Clustered Index Scan": "SCAN",
            "Table Scan": "SCAN",
            "Key Lookup": "LOOKUP",
            "RID Lookup": "LOOKUP",
        }
        return mapping.get(physical_op, "OTHER")

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

