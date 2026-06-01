from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from ..models.parsed_plan import PlanNode
from ..models.result import Finding, Severity

TContext = TypeVar("TContext")


class AbstractAnalyzer(ABC, Generic[TContext]):
    @property
    @abstractmethod
    def category(self) -> str:
        raise NotImplementedError

    def analyze(self, context: TContext) -> list[Finding]:
        if not self._is_applicable(context):
            return []
        findings = self._collect_findings(context)
        return self._post_process(findings)

    @abstractmethod
    def _is_applicable(self, context: TContext) -> bool:
        raise NotImplementedError

    @abstractmethod
    def _collect_findings(self, context: TContext) -> list[Finding]:
        raise NotImplementedError

    def _post_process(self, findings: list[Finding]) -> list[Finding]:
        order = {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}
        return sorted(findings, key=lambda f: order.get(f.severity, 3))

    def _flatten(self, root: PlanNode | None) -> list[PlanNode]:
        if root is None:
            return []
        out = [root]
        for child in root.children:
            out.extend(self._flatten(child))
        return out

