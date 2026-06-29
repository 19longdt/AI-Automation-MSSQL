from __future__ import annotations

import json
import logging
import queue
import threading
import urllib.request
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_QUEUE_MAX = 200


@dataclass
class NotifyMessage:
    bot_token: str
    chat_id: str
    text: str


class NotifyQueue:
    _instance: "NotifyQueue | None" = None

    @classmethod
    def get(cls) -> "NotifyQueue":
        if cls._instance is None:
            cls._instance = cls()
            cls._instance.start()
        return cls._instance

    def __init__(self) -> None:
        self._queue: queue.Queue[NotifyMessage | None] = queue.Queue(maxsize=_QUEUE_MAX)
        self._thread = threading.Thread(target=self._loop, daemon=True, name="notify-queue")

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def stop(self) -> None:
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass

    def enqueue(self, bot_token: str, chat_id: str, text: str) -> None:
        msg = NotifyMessage(bot_token=bot_token, chat_id=chat_id, text=text)
        try:
            self._queue.put_nowait(msg)
        except queue.Full:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            self._queue.put_nowait(msg)
            logger.warning("NotifyQueue full - dropped oldest message")

    def _loop(self) -> None:
        while True:
            msg = self._queue.get()
            if msg is None:
                break
            try:
                payload = json.dumps({"chat_id": msg.chat_id, "text": msg.text}).encode()
                req = urllib.request.Request(
                    f"https://api.telegram.org/bot{msg.bot_token}/sendMessage",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=10):
                    pass
            except Exception as exc:
                logger.warning("Telegram send failed: %s", exc)
