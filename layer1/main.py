from __future__ import annotations

import logging
import os
import signal
import threading

from .api.app import create_http_server
from .scheduler import Layer1Service, _setup_logging

logger = logging.getLogger(__name__)


class Layer1Runtime:
    def __init__(self) -> None:
        self.service = Layer1Service()
        self.scheduler_thread: threading.Thread | None = None
        self.scheduler_error: str = ""

    def start_scheduler(self) -> None:
        def _run() -> None:
            try:
                self.service.start()
            except Exception as exc:  # pragma: no cover
                self.scheduler_error = str(exc)
                logger.exception("Scheduler crashed: %s", exc)

        t = threading.Thread(target=_run, name="layer1-scheduler", daemon=True)
        self.scheduler_thread = t
        t.start()

    def stop(self) -> None:
        try:
            self.service.stop()
        except Exception:
            pass

    def is_scheduler_alive(self) -> bool:
        return bool(self.scheduler_thread and self.scheduler_thread.is_alive())


def main() -> None:
    _setup_logging()
    runtime = Layer1Runtime()
    runtime.start_scheduler()

    host = os.getenv("L1_API_HOST", "0.0.0.0")
    port = int(os.getenv("L1_API_PORT", "8001"))
    server = create_http_server(host, port, runtime)
    logger.info("Layer1 unified service listening at http://%s:%d", host, port)

    def _shutdown(_signum, _frame) -> None:
        logger.info("Signal received. Stopping Layer1 unified service...")
        try:
            server.shutdown()
        finally:
            runtime.stop()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        server.serve_forever()
    finally:
        runtime.stop()


if __name__ == "__main__":
    main()

