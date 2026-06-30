"""internal_server.py — Lightweight diagnostic HTTP server for maintenance runner.

Exposes GET /tick-check?cluster_id=xxx — Layer 3 calls this synchronously
to re-run tick logic and get back the diagnostic result without polling.
Runs in a daemon thread alongside the APScheduler.
"""
from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

if TYPE_CHECKING:
    from ..execute.execute_service import ClusterExecuteService

logger = logging.getLogger(__name__)


def _make_handler(services: dict[str, "ClusterExecuteService"]):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/tick-check":
                params = parse_qs(parsed.query)
                cluster_id = next(iter(params.get("cluster_id", [])), None)
                if not cluster_id:
                    self._respond(400, {"error": "cluster_id required"})
                    return
                service = services.get(cluster_id)
                if service is None:
                    self._respond(404, {"error": f"No service for cluster={cluster_id}"})
                    return
                try:
                    result = service.run_tick_check()
                    self._respond(200, result)
                except Exception as exc:
                    logger.exception("tick-check failed cluster=%s", cluster_id)
                    self._respond(500, {"error": str(exc)})
            elif parsed.path == "/health":
                self._respond(200, {"ok": True})
            else:
                self._respond(404, {"error": "Not found"})

        def _respond(self, code: int, data: dict) -> None:
            body = json.dumps(data, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            pass  # suppress default per-request access logs

    return Handler


def start_internal_server(
    services: dict[str, "ClusterExecuteService"],
    port: int,
) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _make_handler(services))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("Maintenance internal HTTP server listening on port %d", port)
    return server
