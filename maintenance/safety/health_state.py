from __future__ import annotations

from enum import Enum


class HealthState(Enum):
    HEALTHY = "healthy"
    STOPPING = "stopping"
    STOPPED = "stopped"
    RECOVERING = "recovering"
