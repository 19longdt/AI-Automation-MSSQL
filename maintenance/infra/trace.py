"""trace.py — Thread-local trace ID for correlating all logs within a single job execution."""
from __future__ import annotations

import logging
import threading

from .apm import get_apm_ids

_local = threading.local()


def current_trace_id() -> str:
    return getattr(_local, "trace_id", "-")


def set_trace_id(trace_id: str) -> None:
    _local.trace_id = trace_id


def clear_trace_id() -> None:
    _local.trace_id = "-"


class TraceIdFilter(logging.Filter):
    """Inject trace IDs into every LogRecord on this thread.

    Sets:
      - trace_id          — internal 8-char job trace (always present)
      - apm_trace_id      — Elastic APM ECS trace.id (empty when APM inactive)
      - apm_transaction_id — Elastic APM ECS transaction.id
      - apm_span_id       — Elastic APM ECS span.id
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = current_trace_id()  # type: ignore[attr-defined]
        apm_trace, apm_txn, apm_span = get_apm_ids()
        record.apm_trace_id = apm_trace          # type: ignore[attr-defined]
        record.apm_transaction_id = apm_txn      # type: ignore[attr-defined]
        record.apm_span_id = apm_span            # type: ignore[attr-defined]
        return True
