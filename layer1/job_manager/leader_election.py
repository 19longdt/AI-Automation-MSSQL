"""
leader_election.py — MongoDB-based Leader Election cho multi-instance deployment.

Cơ chế:
  1. Startup: mọi instance thử ghi vào cluster_leader (findOneAndUpdate upsert)
  2. Instance ghi được → LEADER: chạy jobs + update heartbeat/10s
  3. Instance không ghi được → STANDBY: poll/15s, chờ leader expire
  4. Khi leader crash → TTL index xóa document sau 30s → standby race để lên leader

Tại sao Leader Election thay vì distributed lock per-job:
  Distributed lock per-job: N jobs × M intervals/giờ = nhiều MongoDB writes
  Leader Election: 1 heartbeat/10s cho toàn cluster → MongoDB write thấp hơn nhiều
  Khi 2 instances có tốc độ tiệm cận, distributed lock gây contention liên tục
  và instance "thua" waste roundtrip mà không làm gì có ích.
"""
from __future__ import annotations

import logging
import threading
from enum import Enum

from ..storage.repositories.leader_repo import LeaderRepo
from .instance_registry import get_instance_id

logger = logging.getLogger(__name__)


class InstanceRole(str, Enum):
    LEADER = "leader"
    STANDBY = "standby"
    UNKNOWN = "unknown"


class LeaderElection:
    """
    Quản lý vòng đời leader election cho 1 service instance.

    Lifecycle:
        election = LeaderElection(leader_repo, cfg)
        election.start()          # non-blocking, bắt đầu election + heartbeat thread
        election.is_leader()      # check current role
        election.stop()           # graceful shutdown, release leadership nếu là leader
    """

    def __init__(self, leader_repo: LeaderRepo, heartbeat_interval_sec: int, ttl_sec: int, poll_interval_sec: int) -> None:
        self._repo = leader_repo
        self._heartbeat_interval_sec = heartbeat_interval_sec
        self._ttl_sec = ttl_sec
        self._poll_interval_sec = poll_interval_sec
        self._instance_id: str = get_instance_id()
        self._role: InstanceRole = InstanceRole.UNKNOWN
        self._stop_event: threading.Event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Bắt đầu election và khởi động background thread (heartbeat hoặc poll)."""
        ...

    def stop(self) -> None:
        """Graceful shutdown — release leadership nếu đang là leader."""
        ...

    def is_leader(self) -> bool: ...

    def get_role(self) -> InstanceRole: ...

    def _run_as_leader(self) -> None:
        """Background loop: update heartbeat mỗi heartbeat_interval_sec."""
        ...

    def _run_as_standby(self) -> None:
        """Background loop: poll leader status mỗi poll_interval_sec.
        Khi leader expire → thử race để trở thành leader."""
        ...

    def _try_elect(self) -> bool:
        """Thử ghi vào cluster_leader, trả về True nếu thành công."""
        ...
