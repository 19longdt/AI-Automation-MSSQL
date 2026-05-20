from __future__ import annotations


def register_health_routes(registry, runtime) -> None:
    def health_handler(_req):
        return 200, {
            "status": "ok",
            "service": "layer1-main",
            "scheduler_alive": runtime.is_scheduler_alive(),
            "scheduler_error": runtime.scheduler_error or None,
        }

    registry.add("GET", "/health", health_handler)

