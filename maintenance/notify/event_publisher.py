from __future__ import annotations

from abc import ABC, abstractmethod

from ..models.campaign import MaintenanceCampaign
from ..models.work_item import WorkItem


class MaintenanceEventPublisher(ABC):
    @abstractmethod
    def on_item_started(self, item: WorkItem) -> None:
        raise NotImplementedError

    @abstractmethod
    def on_item_done(
        self,
        item: WorkItem,
        frag_before: float | None,
        frag_after: float | None,
        duration_ms: float | None,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def on_item_failed(
        self,
        item: WorkItem,
        error: str,
        attempt: int,
        max_attempts: int,
        duration_ms: float | None,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def on_item_paused(self, item: WorkItem, duration_ms: float | None) -> None:
        raise NotImplementedError

    @abstractmethod
    def on_health_stop(self, reason: str, metrics: dict, current_item: WorkItem | None = None) -> None:
        raise NotImplementedError

    @abstractmethod
    def on_campaign_completed(self, campaign: MaintenanceCampaign, done_items: list[dict]) -> None:
        raise NotImplementedError
