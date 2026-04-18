"""
job_runner.py — Wrapper ghi job_executions trước và sau mỗi job run.

Mọi APScheduler job function phải được wrap qua JobRunner để:
  - Ghi execution record khi bắt đầu (status=RUNNING)
  - Update record khi hoàn thành (status=SUCCESS/FAILED)
  - Catch tất cả exceptions — job không bao giờ crash scheduler
  - Skip nếu instance không phải leader

Sử dụng dạng decorator:
    @job_runner.wrap("slow_query_check")
    def run_slow_query_check() -> int:
        ...  # return số findings_created
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from ..storage.repositories.job_execution_repo import JobExecutionRepo
from .leader_election import LeaderElection

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable)


class JobRunner:
    """
    Factory cho job wrapper functions.
    Instance được inject vào scheduler khi startup.
    """

    def __init__(self, execution_repo: JobExecutionRepo, election: LeaderElection) -> None:
        self._repo = execution_repo
        self._election = election

    def wrap(self, job_name: str, stuck_timeout_sec: int = 300) -> Callable[[F], F]:
        """
        Decorator factory. Sử dụng:
            @runner.wrap("my_job", stuck_timeout_sec=120)
            def my_job_fn() -> int: ...
        """
        ...

    def _execute(self, job_name: str, func: Callable, stuck_timeout_sec: int) -> None:
        """Thực thi job với full lifecycle tracking."""
        ...
