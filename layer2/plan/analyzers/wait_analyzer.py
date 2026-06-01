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
                rec = "Đánh giá data skew (một partition gánh nhiều hàng hơn), kiểm tra `MAXDOP` và `COST THRESHOLD FOR PARALLELISM`."
                severity = Severity.WARNING
            elif wt in {"RESOURCE_SEMAPHORE", "RESOURCE_SEMAPHORE_QUERY_COMPILE"}:
                t = "wait_memory"
                rec = "Tối ưu query nặng memory, xem xét điều chỉnh `max server memory`, Resource Governor memory limit."
                severity = Severity.CRITICAL
            elif wt in {"MEMORY_ALLOCATION_EXT", "RESERVED_MEMORY_ALLOCATION_EXT"}:
                t = "wait_memory_alloc"
                rec = "Workspace memory bị phân mảnh nội bộ: quá nhiều `Sort`/`Hash` operator cùng tranh memory. Tối ưu plan để giảm số operator cần memory grant."
                severity = Severity.WARNING
            elif wt == "SOS_SCHEDULER_YIELD":
                t = "wait_cpu"
                rec = "Xem top CPU queries, kiểm tra plan quality (missing stats → bad plan → loop scan), tăng phần cứng nếu cần."
                severity = Severity.WARNING
            elif wt == "THREADPOOL":
                t = "wait_cpu"
                rec = "Thread pool cạn kiệt: kill blocking sessions, kiểm tra max worker threads, scale up nếu cần."
                severity = Severity.CRITICAL
            elif wt == "WRITELOG":
                t = "wait_log_io"
                rec = "I/O log chậm: kiểm tra latency ổ đĩa log, tránh small transaction nhiều lần, gom batch."
                severity = Severity.CRITICAL if w.wait_time_ms > 5000 else Severity.WARNING
            elif wt in {"LOGBUFFER", "LOG_RATE_GOVERNOR"}:
                t = "wait_log_io"
                rec = "Log buffer pressure: log I/O không đủ nhanh. Kiểm tra `WRITELOG` latency, xem xét log file trên SSD."
                severity = Severity.WARNING
            elif wt == "ASYNC_NETWORK_IO":
                t = "wait_network"
                rec = "Client đọc kết quả chậm (network/client-side throttle): xem xét pagination, giảm result set."
                severity = Severity.WARNING
            elif wt in {"IO_COMPLETION", "ASYNC_IO_COMPLETION"}:
                t = "wait_io_completion"
                rec = "I/O async completion chậm: kiểm tra storage latency."
                severity = Severity.WARNING
            elif wt in {"HADR_SYNC_COMMIT", "HADR_WORK_QUEUE"}:
                t = "wait_hadr"
                rec = "AlwaysOn AG wait: kiểm tra network latency đến secondary, I/O secondary, xem xét async commit cho secondary xa."
                severity = Severity.CRITICAL if wt == "HADR_SYNC_COMMIT" and w.wait_time_ms > 5000 else Severity.WARNING
            elif wt.startswith("PAGELATCH_"):
                t = "wait_pagelatch"
                rec = "Hot page contention trong buffer pool: INSERT vào cuối index (identity/sequence). Xem xét GUID key, partition, hoặc giảm fill factor."
                severity = Severity.WARNING
            elif wt.startswith("LATCH_"):
                t = "wait_latch"
                rec = "Latch contention: hotspot page (PFS/GAM/SGAM) hoặc index contention."
                severity = Severity.WARNING
            elif wt == "EXECSYNC":
                t = "wait_parallelism"
                rec = "Parallel execution sync point: một thread chậm kéo toàn bộ plan. Kiểm tra data skew và `DOP`."
                severity = Severity.INFO
            else:
                t = "wait_other"
                rec = f"Wait type `{wt}` cần điều tra thêm trong sys.dm_os_wait_stats."
                severity = Severity.INFO

            findings.append(Finding(
                severity=severity,
                category=self.category,
                type=t,
                description=f"Wait `{wt}`: {w.wait_time_ms}ms / {w.wait_count} lần - dấu hiệu nghẽn tài nguyên cần theo dõi.",
                recommendation=rec,
            ))
        return findings
