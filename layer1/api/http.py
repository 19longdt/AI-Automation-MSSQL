from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler
from typing import Callable

logger = logging.getLogger(__name__)


RouteHandler = Callable[[BaseHTTPRequestHandler], tuple[int, dict]]


class RouteRegistry:
    def __init__(self) -> None:
        self._routes: dict[tuple[str, str], RouteHandler] = {}

    def add(self, method: str, path: str, handler: RouteHandler) -> None:
        self._routes[(method.upper(), path)] = handler

    def resolve(self, method: str, path: str) -> RouteHandler | None:
        return self._routes.get((method.upper(), path))


def parse_json_body(req: BaseHTTPRequestHandler) -> dict:
    content_len = int(req.headers.get("Content-Length", "0") or "0")
    if content_len <= 0:
        return {}
    raw = req.rfile.read(content_len).decode("utf-8")
    return json.loads(raw) if raw else {}


def send_json(req: BaseHTTPRequestHandler, status_code: int, payload: dict) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req.send_response(status_code)
    req.send_header("Content-Type", "application/json; charset=utf-8")
    req.send_header("Content-Length", str(len(raw)))
    req.end_headers()
    req.wfile.write(raw)

