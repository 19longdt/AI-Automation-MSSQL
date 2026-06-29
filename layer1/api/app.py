from __future__ import annotations

import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .http import RouteRegistry, send_json
from .routes.catalog import register_catalog_routes
from .routes.clusters import register_cluster_routes
from .routes.health import register_health_routes
from .routes.sessions import register_session_routes

logger = logging.getLogger(__name__)


def build_registry(runtime) -> RouteRegistry:
    registry = RouteRegistry()
    register_health_routes(registry, runtime)
    register_session_routes(registry, runtime)
    register_cluster_routes(registry, runtime)
    register_catalog_routes(registry, runtime)
    return registry


def make_handler(registry: RouteRegistry):
    class AppHandler(BaseHTTPRequestHandler):
        server_version = "Layer1API/1.0"

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

        def do_PUT(self) -> None:  # noqa: N802
            self._dispatch("PUT")

        def do_DELETE(self) -> None:  # noqa: N802
            self._dispatch("DELETE")

        def _dispatch(self, method: str) -> None:
            match = registry.resolve(method, self.path)
            if not match:
                send_json(self, 404, {"message": "Not found"})
                return
            self.path_params = match.path_params
            self.query_params = match.query_params
            try:
                status, payload = match.handler(self)
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
