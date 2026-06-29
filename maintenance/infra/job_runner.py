"""
job_runner.py — Wrapper ghi job_executions trước và sau mỗi job run.

Mọi APScheduler job function phải được wrap qua JobRunner để:
  - Ghi execution record khi bắt đầu (status=RUNNING)
  - Update record khi hoàn thành (status=SUCCESS/FAILED)
  - Catch tất cả exceptions — job không bao giờ crash scheduler
  - Tính duration_ms tự động

Sử dụng dạng decorator:
    @job_runner.wrap("slow_sessions_check")
    def run_slow_sessions_check() -> int:
        ...  # return số findings_created
"""
from __future__ import annotations

import logging
import os
import socket
import uuid
from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from ..models.job import JobExecution, JobStatus
from .apm import get_client
from .job_execution_repo import JobExecutionRepo
from .trace import clear_trace_id, set_trace_id

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable)


class JobRunner:
    """
    Factory cho job wrapper functions.
    Instance được inject vào scheduler khi startup.
    """

    def __init__(self, execution_repo: JobExecutionRepo) -> None:
        self._repo = execution_repo
        self._instance_id = f"{socket.gethostname()}:{os.getpid()}"

    def wrap(self, job_name: str) -> Callable[[F], F]:
        """
        Decorator factory. Sử dụng:
            @runner.wrap("my_job")
            def my_job_fn() -> int: ...
        """
        def decorator(func: F) -> F:
            @wraps(func)
            def wrapper(*args, **kwargs):
                self._execute(job_name, lambda: func(*args, **kwargs))
            return wrapper  # type: ignore[return-value]
        return decorator  # type: ignore[return-value]

    def _execute(self, job_name: str, func: Callable) -> None:
        """
        Thực thi job với full lifecycle tracking:
          1. Generate trace_id (8 hex chars) — set vào thread-local trước khi gọi func()
          2. Insert job_execution (status=RUNNING, trace_id)
          3. Gọi func()
          4. Update job_execution (status=SUCCESS/FAILED, duration_ms, findings_created)
          5. Catch mọi exception → log ERROR, update status=FAILED
          6. Clear trace_id khỏi thread-local
        """
        trace_id = uuid.uuid4().hex[:8]
        set_trace_id(trace_id)

        apm_client = get_client()
        if apm_client:
            apm_client.begin_transaction("scheduled-job")

        execution = JobExecution(
            job_name=job_name,
            instance_id=self._instance_id,
            trace_id=trace_id,
        )
        doc_id = self._repo.start(execution)
        findings_created = 0
        apm_outcome = "success"
        try:
            logger.info("Job started: name=%s trace=%s", job_name, trace_id)
            result = func()
            # func() trả về số findings_created (int) hoặc None
            if isinstance(result, int):
                findings_created = result
            self._repo.finish(doc_id, JobStatus.SUCCESS, findings_created)
            logger.info(
                "Job finished: name=%s trace=%s findings=%d", job_name, trace_id, findings_created
            )
        except Exception as exc:
            apm_outcome = "failure"
            logger.error(
                "Job failed: name=%s trace=%s error=%s", job_name, trace_id, exc, exc_info=True
            )
            if apm_client:
                apm_client.capture_exception()
            self._repo.finish(doc_id, JobStatus.FAILED, findings_created, error=str(exc))
        finally:
            if apm_client:
                apm_client.end_transaction(job_name, apm_outcome)
            clear_trace_id()
