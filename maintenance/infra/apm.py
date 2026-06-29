"""apm.py — Elastic APM client singleton. No-op when ELASTIC_APM_SERVER_URL is not set."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)
_client = None  # elasticapm.Client | None


def init_apm(settings) -> None:
    if not settings.elastic_apm_server_url:
        return
    global _client
    try:
        import elasticapm
        _client = elasticapm.Client(
            service_name=settings.elastic_apm_service_name,
            server_url=settings.elastic_apm_server_url,
            secret_token=settings.elastic_apm_secret_token or None,
            environment=settings.elastic_apm_environment,
            service_version=settings.elastic_apm_service_version or None,
        )
        logger.info("Elastic APM initialized: service=%s", settings.elastic_apm_service_name)
    except ImportError:
        logger.warning("ELASTIC_APM_SERVER_URL set but elastic-apm not installed; skipping.")


def get_client():
    """Return the APM Client instance, or None if APM is not configured."""
    return _client


def get_apm_ids() -> tuple[str, str, str]:
    """Return (trace_id, transaction_id, span_id) from active APM context, or empty strings."""
    try:
        import elasticapm
        return (
            elasticapm.get_trace_id() or "",
            elasticapm.get_transaction_id() or "",
            elasticapm.get_span_id() or "",
        )
    except Exception:
        return "", "", ""
