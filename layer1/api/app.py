from __future__ import annotations

import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .http import RouteRegistry, send_json
from .routes.health import register_health_routes
from .routes.sessions import register_session_routes

logger = logging.getLogger(__name__)


def build_registry(runtime) -> RouteRegistry:
    registry = RouteRegistry()
    register_health_routes(registry, runtime)
    register_session_routes(registry, runtime)
    return registry


def make_handler(registry: RouteRegistry):
    class AppHandler(BaseHTTPRequestHandler):
        server_version = "Layer1API/1.0"

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

        def _dispatch(self, method: str) -> None:
            handler = registry.resolve(method, self.path)
            if not handler:
                send_json(self, 404, {"message": "Not found"})
                return
            try:
                status, payload = handler(self)
                send_json(self, status, payload)
            except Exception as exc:
                logger.exception("Unhandled API error: %s", exc)
                send_json(self, 500, {"message": "Internal server error", "error": str(exc)})

        def log_message(self, fmt: str, *args) -> None:
            logger.info("%s - - %s", self.address_string(), fmt % args)

    return AppHandler


def create_http_server(host: str, port: int, runtime) -> ThreadingHTTPServer:
    registry = build_registry(runtime)
    handler = make_handler(registry)
    return ThreadingHTTPServer((host, port), handler)

