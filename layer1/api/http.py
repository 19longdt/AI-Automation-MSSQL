from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from typing import Callable
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)


@dataclass
class RouteMatch:
    handler: "RouteHandler"
    path_params: dict[str, str]
    query_params: dict[str, list[str]]


RouteHandler = Callable[[BaseHTTPRequestHandler], tuple[int, dict]]


class RouteRegistry:
    def __init__(self) -> None:
        self._routes: list[tuple[str, str, RouteHandler]] = []

    def add(self, method: str, path: str, handler: RouteHandler) -> None:
        self._routes.append((method.upper(), path, handler))

    def resolve(self, method: str, raw_path: str) -> RouteMatch | None:
        parsed = urlparse(raw_path)
        request_segments = self._split_path(parsed.path)

        for route_method, route_path, handler in self._routes:
            if route_method != method.upper():
                continue
            route_segments = self._split_path(route_path)
            if len(route_segments) != len(request_segments):
                continue

            params: dict[str, str] = {}
            matched = True
            for route_segment, request_segment in zip(route_segments, request_segments):
                if route_segment.startswith("{") and route_segment.endswith("}"):
                    params[route_segment[1:-1]] = request_segment
                    continue
                if route_segment != request_segment:
                    matched = False
                    break
            if matched:
                return RouteMatch(
                    handler=handler,
                    path_params=params,
                    query_params=parse_qs(parsed.query, keep_blank_values=False),
                )
        return None

    @staticmethod
    def _split_path(path: str) -> list[str]:
        if path == "/":
            return []
        return [segment for segment in path.strip("/").split("/") if segment]


def get_path_param(req: BaseHTTPRequestHandler, name: str, default: str = "") -> str:
    return getattr(req, "path_params", {}).get(name, default)


def get_query_param(req: BaseHTTPRequestHandler, name: str, default: str = "") -> str:
    values = getattr(req, "query_params", {}).get(name)
    if not values:
        return default
    return values[0]


def parse_json_body(req: BaseHTTPRequestHandler) -> dict:
    content_len = int(req.headers.get("Content-Length", "0") or "0")
    if content_len <= 0:
        return {}
    raw = req.rfile.read(content_len).decode("utf-8")
    return json.loads(raw) if raw else {}


def send_json(req: BaseHTTPRequestHandler, status_code: int, payload: dict | list) -> None:
    raw = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    req.send_response(status_code)
    req.send_header("Content-Type", "application/json; charset=utf-8")
    req.send_header("Content-Length", str(len(raw)))
    req.end_headers()
    req.wfile.write(raw)
