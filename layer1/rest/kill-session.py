"""
Minimal Layer1 HTTP API for operational actions.

Endpoints:
  - GET /health
  - POST /kill-session  {"session_id": 123}

Run:
  python -m layer1.kill_api
"""
from __future__ import annotations

import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import settings
from .executor.mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


def _kill_session_on_host(host: str, session_id: int) -> None:
    # session_id is already validated as positive integer.
    sql = f"KILL {session_id}"
    with mssql_connection(host) as conn:
        conn.execute(sql)


class KillApiHandler(BaseHTTPRequestHandler):
    server_version = "Layer1KillAPI/1.0"

    def _send_json(self, status_code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_json(404, {"message": "Not found"})
            return
        self._send_json(200, {"status": "ok", "service": "layer1-kill-api"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/kill-session":
            self._send_json(404, {"message": "Not found"})
            return

        content_len = int(self.headers.get("Content-Length", "0") or "0")
        try:
            body = json.loads(self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}")
        except Exception:
            self._send_json(400, {"message": "Invalid JSON body"})
            return

        session_raw = body.get("session_id") if isinstance(body, dict) else None
        try:
            session_id = int(session_raw)
        except Exception:
            self._send_json(400, {"message": "session_id must be integer"})
            return

        if session_id <= 0:
            self._send_json(400, {"message": "session_id must be > 0"})
            return

        errors: list[dict] = []
        for host in settings.mssql_nodes:
            try:
                _kill_session_on_host(host, session_id)
                self._send_json(200, {
                    "ok": True,
                    "session_id": session_id,
                    "host": host,
                    "message": f"KILL {session_id} executed"
                })
                return
            except Exception as exc:
                logger.warning("KILL failed on host=%s session_id=%s error=%s", host, session_id, exc)
                errors.append({"host": host, "error": str(exc)})

        self._send_json(502, {
            "ok": False,
            "session_id": session_id,
            "message": "Failed to execute KILL on all configured hosts",
            "errors": errors,
        })

    def log_message(self, fmt: str, *args) -> None:
        logger.info("%s - - %s", self.address_string(), fmt % args)


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    port = int(os.getenv("L1_API_PORT", "8001"))
    bind_host = os.getenv("L1_API_HOST", "0.0.0.0")
    server = ThreadingHTTPServer((bind_host, port), KillApiHandler)
    logger.info("Layer1 kill API listening at http://%s:%d", bind_host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()

"""
Minimal Layer1 HTTP API for operational actions.

Endpoints:
  - GET /health
  - POST /kill-session  {"session_id": 123}

Run:
  python -m layer1.kill_api
"""
from __future__ import annotations

import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import settings
from .executor.mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


def _kill_session_on_host(host: str, session_id: int) -> None:
    # session_id is already validated as positive integer.
    sql = f"KILL {session_id}"
    with mssql_connection(host) as conn:
        conn.execute(sql)


class KillApiHandler(BaseHTTPRequestHandler):
    server_version = "Layer1KillAPI/1.0"

    def _send_json(self, status_code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_json(404, {"message": "Not found"})
            return
        self._send_json(200, {"status": "ok", "service": "layer1-kill-api"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/kill-session":
            self._send_json(404, {"message": "Not found"})
            return

        content_len = int(self.headers.get("Content-Length", "0") or "0")
        try:
            body = json.loads(self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}")
        except Exception:
            self._send_json(400, {"message": "Invalid JSON body"})
            return

        session_raw = body.get("session_id") if isinstance(body, dict) else None
        try:
            session_id = int(session_raw)
        except Exception:
            self._send_json(400, {"message": "session_id must be integer"})
            return

        if session_id <= 0:
            self._send_json(400, {"message": "session_id must be > 0"})
            return

        errors: list[dict] = []
        for host in settings.mssql_nodes:
            try:
                _kill_session_on_host(host, session_id)
                self._send_json(200, {
                    "ok": True,
                    "session_id": session_id,
                    "host": host,
                    "message": f"KILL {session_id} executed"
                })
                return
            except Exception as exc:
                logger.warning("KILL failed on host=%s session_id=%s error=%s", host, session_id, exc)
                errors.append({"host": host, "error": str(exc)})

        self._send_json(502, {
            "ok": False,
            "session_id": session_id,
            "message": "Failed to execute KILL on all configured hosts",
            "errors": errors,
        })

    def log_message(self, fmt: str, *args) -> None:
        logger.info("%s - - %s", self.address_string(), fmt % args)


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    port = int(os.getenv("L1_API_PORT", "8001"))
    bind_host = os.getenv("L1_API_HOST", "0.0.0.0")
    server = ThreadingHTTPServer((bind_host, port), KillApiHandler)
    logger.info("Layer1 kill API listening at http://%s:%d", bind_host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()

