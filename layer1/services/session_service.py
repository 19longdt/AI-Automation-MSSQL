from __future__ import annotations

import logging

from ..executor.mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


def kill_session(session_id: int, hosts: list[str] | None = None) -> dict:
    if session_id <= 0:
        logger.warning("kill_session rejected: invalid session_id=%s", session_id)
        return {"ok": False, "status": 400, "message": "session_id must be > 0"}

    target_hosts = [h for h in (hosts or []) if str(h).strip()]
    if not target_hosts:
        logger.error("kill_session aborted: no target host provided (session_id=%s)", session_id)
        return {"ok": False, "status": 400, "message": "target host is required"}

    logger.info(
        "kill_session requested: session_id=%s target_hosts=%s",
        session_id, target_hosts,
    )

    errors: list[dict] = []
    for host in target_hosts:
        try:
            logger.info("kill_session connect: session_id=%s host=%s", session_id, host)
            with mssql_connection(host) as conn:
                conn.execute(f"KILL {session_id}")
            logger.warning("kill_session executed: session_id=%s host=%s", session_id, host)
            return {
                "ok": True,
                "status": 200,
                "session_id": session_id,
                "host": host,
                "message": f"KILL {session_id} executed",
            }
        except Exception as exc:
            logger.error(
                "kill_session failed on host: session_id=%s host=%s error=%s",
                session_id, host, exc,
            )
            errors.append({"host": host, "error": str(exc)})

    logger.error(
        "kill_session failed on all target hosts: session_id=%s target_hosts=%s",
        session_id, target_hosts,
    )
    return {
        "ok": False,
        "status": 502,
        "session_id": session_id,
        "message": "Failed to execute KILL on target hosts",
        "errors": errors,
    }


def kill_session_with_conn_str(session_id: int, host: str, conn_str: str) -> dict:
    if session_id <= 0:
        return {"ok": False, "status": 400, "message": "session_id must be > 0"}
    if not host.strip():
        return {"ok": False, "status": 400, "message": "target host is required"}
    try:
        with mssql_connection(host, conn_str=conn_str) as conn:
            conn.execute(f"KILL {session_id}")
        return {
            "ok": True,
            "status": 200,
            "session_id": session_id,
            "host": host,
            "message": f"KILL {session_id} executed",
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": 502,
            "session_id": session_id,
            "host": host,
            "message": "Failed to execute KILL on target host",
            "errors": [{"host": host, "error": str(exc)}],
        }
