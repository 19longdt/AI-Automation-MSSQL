from __future__ import annotations

from dataclasses import dataclass, field

from ..models.parsed_plan import PlanContext
from .base import AbstractAnalyzer
from .code_pattern_analyzer import CodePatternAnalyzer
from .compilation_analyzer import CompilationAnalyzer
from .index_analyzer import IndexAnalyzer
from .memory_analyzer import MemoryAnalyzer
from .operator_analyzer import OperatorAnalyzer
from .parallelism_analyzer import ParallelismAnalyzer
from .parameter_analyzer import ParameterAnalyzer
from .statistics_analyzer import StatisticsAnalyzer
from .wait_analyzer import WaitAnalyzer


@dataclass
class AnalyzerRegistry:
    _analyzers: list[AbstractAnalyzer[PlanContext]] = field(default_factory=list)

    def register(self, analyzer: AbstractAnalyzer[PlanContext]) -> None:
        self._analyzers.append(analyzer)

    def get_all(self) -> list[AbstractAnalyzer[PlanContext]]:
        return list(self._analyzers)

    @classmethod
    def default(cls) -> "AnalyzerRegistry":
        reg = cls()
        reg.register(MemoryAnalyzer())
        reg.register(OperatorAnalyzer())
        reg.register(IndexAnalyzer())
        reg.register(ParallelismAnalyzer())
        reg.register(ParameterAnalyzer())
        reg.register(WaitAnalyzer())
        reg.register(StatisticsAnalyzer())
        reg.register(CodePatternAnalyzer())
        reg.register(CompilationAnalyzer())
        return reg
