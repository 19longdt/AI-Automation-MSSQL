from __future__ import annotations

import xml.etree.ElementTree as ET

from ..models.parsed_plan import MemoryGrant, ParsedStatement, PlanParameter, QueryTime, WaitStat

SHOWPLAN_URI = "http://schemas.microsoft.com/sqlserver/2004/07/showplan"


class StatementParser:
    def parse(self, stmt_el: ET.Element) -> ParsedStatement | None:
        qp = stmt_el.find(f".//{self._tag('QueryPlan')}")

        stmt = ParsedStatement(
            statement_text=stmt_el.get("StatementText", ""),
            statement_type=stmt_el.get("StatementType", ""),
            total_cost=self._to_float(stmt_el.get("StatementSubTreeCost")),
            query_hash=stmt_el.get("QueryHash"),
            query_plan_hash=stmt_el.get("QueryPlanHash"),
            optm_level=stmt_el.get("StatementOptmLevel"),
            early_abort_reason=stmt_el.get("StatementOptmEarlyAbortReason"),
            ce_model_version=self._to_int(stmt_el.get("CardinalityEstimationModelVersion")),
            compile_cpu_ms=self._to_int(stmt_el.get("CompileCPU")),
            compile_memory_kb=self._to_int(stmt_el.get("CompileMemory")),
        )

        if qp is not None:
            stmt.dop = self._to_int(qp.get("DegreeOfParallelism"))
            stmt.non_parallel_reason = qp.get("NonParallelPlanReason")
            stmt.cached_plan_size_kb = self._to_int(qp.get("CachedPlanSize"))

            mg = qp.find(self._tag("MemoryGrantInfo"))
            if mg is not None:
                stmt.memory_grant = MemoryGrant(
                    requested_kb=self._to_int(mg.get("RequestedMemory")),
                    granted_kb=self._to_int(mg.get("GrantedMemory")),
                    max_used_kb=self._to_optional_int(mg.get("MaxUsedMemory")),
                    grant_wait_ms=self._to_int(mg.get("GrantWaitTime")),
                )

            qts = qp.find(self._tag("QueryTimeStats"))
            if qts is not None:
                stmt.query_time = QueryTime(
                    cpu_time=self._to_int(qts.get("CpuTime")),
                    elapsed_time=self._to_int(qts.get("ElapsedTime")),
                )

            for wait_el in qp.findall(f".//{self._tag('Wait')}"):
                stmt.wait_stats.append(
                    WaitStat(
                        wait_type=wait_el.get("WaitType", ""),
                        wait_time_ms=self._to_int(wait_el.get("WaitTimeMs")),
                        wait_count=self._to_int(wait_el.get("WaitCount")),
                    )
                )

            for p in qp.findall(f".//{self._tag('ParameterList')}/{self._tag('ColumnReference')}"):
                stmt.parameters.append(
                    PlanParameter(
                        name=p.get("Column", ""),
                        data_type=p.get("ParameterDataType"),
                        compiled_value=p.get("ParameterCompiledValue"),
                        runtime_value=p.get("ParameterRuntimeValue"),
                    )
                )

        stmt.has_actual_stats = bool(stmt.query_time is not None)
        return stmt

    def _tag(self, name: str) -> str:
        return f"{{{SHOWPLAN_URI}}}{name}"

    def _to_int(self, value: str | None) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    def _to_optional_int(self, value: str | None) -> int | None:
        try:
            if value is None:
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _to_float(self, value: str | None) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
