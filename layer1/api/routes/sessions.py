from __future__ import annotations

from ...services.session_service import kill_session
from ..http import parse_json_body


def register_session_routes(registry, _runtime) -> None:
    def kill_handler(req):
        try:
            body = parse_json_body(req)
        except Exception:
            return 400, {"message": "Invalid JSON body"}

        session_raw = body.get("session_id") if isinstance(body, dict) else None
        node_raw = body.get("node") if isinstance(body, dict) else None
        try:
            session_id = int(session_raw)
        except Exception:
            return 400, {"message": "session_id must be integer"}

        node = str(node_raw).strip() if node_raw is not None else ""
        if not node:
            return 400, {"message": "node is required"}
        result = kill_session(session_id, hosts=[node])
        status = int(result.pop("status", 200))
        return status, result

    registry.add("POST", "/kill-session", kill_handler)
