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
                rec = "Kiểm tra blocking chain: query nào đang giữ lock, transaction có được commit/rollback đúng lúc không."
                severity = Severity.CRITICAL if w.wait_time_ms > 5000 else Severity.WARNING
            elif wt.startswith("PAGEIOLATCH"):
                t = "wait_disk_io"
                rec = "Kiểm tra I/O latency (disk health), cache warmup, index/selectivity để giảm physical reads."
                severity = Severity.CRITICAL if w.wait_time_ms > 10000 else Severity.WARNING
            elif wt in {"CXPACKET", "CXCONSUMER"}:
                t = "wait_parallelism"
                rec = "Đánh giá data skew (một partition gánh nhiều hàng hơn), kiểm tra MAXDOP và COST THRESHOLD FOR PARALLELISM."
                severity = Severity.WARNING
            elif wt == "RESOURCE_SEMAPHORE":
                t = "wait_memory"
                rec = "Tối ưu query nặng memory, xem xét điều chỉnh max server memory, Resource Governor memory limit."
                severity = Severity.CRITICAL
            elif wt == "SOS_SCHEDULER_YIELD":
                t = "wait_cpu"
                rec = "Xem top CPU queries, kiểm tra plan quality (missing stats -> bad plan -> loop scan), tăng phần cứng nếu cần."
                severity = Severity.WARNING
            elif wt == "WRITELOG":
                t = "wait_log_io"
                rec = "I/O log chậm: kiểm tra latency ổ đĩa log, tránh small transaction nhiều lần, gom batch."
                severity = Severity.CRITICAL if w.wait_time_ms > 5000 else Severity.WARNING
            elif wt == "ASYNC_NETWORK_IO":
                t = "wait_network"
                rec = "Client đọc kết quả chậm (network/client-side throttle): xem xét pagination, giảm result set."
                severity = Severity.WARNING
            elif wt == "IO_COMPLETION":
                t = "wait_io_completion"
                rec = "I/O async completion chậm: kiểm tra storage latency."
                severity = Severity.WARNING
            elif wt.startswith("LATCH_"):
                t = "wait_latch"
                rec = "Latch contention: hotspot page (PFS/GAM/SGAM) hoặc index contention."
                severity = Severity.WARNING
            else:
                t = "wait_other"
                rec = f"Wait type {wt} cần điều tra thêm."
                severity = Severity.INFO

            findings.append(Finding(
                severity=severity,
                category=self.category,
                type=t,
                description=f"Wait {wt}: {w.wait_time_ms}ms / {w.wait_count} lần - dấu hiệu nghẽn tài nguyên cần theo dõi.",
                recommendation=rec,
            ))
        return findings
