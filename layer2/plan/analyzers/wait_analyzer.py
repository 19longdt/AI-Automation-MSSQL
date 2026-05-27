from __future__ import annotations

from ..models.parsed_plan import PlanContext
from ..models.result import Finding, Severity
from .base import AbstractAnalyzer


class WaitAnalyzer(AbstractAnalyzer[PlanContext]):
    @property
    def category(self) -> str:
        return "wait"

    def _is_applicable(self, context: PlanContext) -> bool:
        return bool(context.statement.wait_stats)

    def _collect_findings(self, context: PlanContext) -> list[Finding]:
        findings: list[Finding] = []
        for w in context.statement.wait_stats:
            wt = w.wait_type
            if wt.startswith("LCK_M_"):
                t = "wait_blocking"
                rec = "Ki?m tra blocking chain và transaction dài."
            elif wt.startswith("PAGEIOLATCH"):
                t = "wait_disk_io"
                rec = "Ki?m tra I/O latency, cache warmup, và index/selectivity."
            elif wt in {"CXPACKET", "CXCONSUMER"}:
                t = "wait_parallelism"
                rec = "Ðánh giá skew và hi?u qu? parallelism."
            elif wt == "RESOURCE_SEMAPHORE":
                t = "wait_memory"
                rec = "Memory grant contention, c?n t?i uu query ho?c c?u hình memory."
            elif wt == "SOS_SCHEDULER_YIELD":
                t = "wait_cpu"
                rec = "CPU pressure, xem top CPU queries và plan quality."
            else:
                continue
            findings.append(Finding(
                severity=Severity.WARNING,
                category=self.category,
                type=t,
                description=f"Wait {wt}: {w.wait_time_ms}ms / {w.wait_count} waits.",
                recommendation=rec,
            ))
        return findings
