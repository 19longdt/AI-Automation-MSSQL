from __future__ import annotations

from datetime import datetime

from pymongo import ASCENDING

from ..infra.time_utils import now_vn
from ..models.campaign import CampaignStatus, MaintenanceCampaign
from ..mongo import get_maint_db

COLLECTION = "maintenance_campaigns"


def _to_campaign(doc: dict | None) -> MaintenanceCampaign | None:
    if not doc:
        return None
    doc.pop("_id", None)
    return MaintenanceCampaign(**doc)


class CampaignRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def insert(self, campaign: MaintenanceCampaign) -> str:
        self.collection.insert_one(campaign.model_dump())
        return campaign.campaign_id

    def find_by_id(self, campaign_id: str) -> MaintenanceCampaign | None:
        return _to_campaign(self.collection.find_one({"campaign_id": campaign_id}))

    def find_active_or_discovering(self, cluster_id: str) -> MaintenanceCampaign | None:
        return _to_campaign(
            self.collection.find_one(
                {
                    "cluster_id": cluster_id,
                    "status": {
                        "$in": [
                            CampaignStatus.ACTIVE.value,
                            CampaignStatus.DISCOVERING.value,
                        ]
                    },
                },
                sort=[("start_date", ASCENDING)],
            )
        )

    def find_pending_or_failed(self, cluster_id: str) -> MaintenanceCampaign | None:
        return _to_campaign(
            self.collection.find_one(
                {
                    "cluster_id": cluster_id,
                    "status": {
                        "$in": [
                            CampaignStatus.PENDING.value,
                            CampaignStatus.DISCOVERY_FAILED.value,
                        ]
                    },
                },
                sort=[("start_date", ASCENDING)],
            )
        )

    def reset_stuck_discovering(self, cluster_id: str) -> int:
        now = now_vn()
        result = self.collection.update_many(
            {"cluster_id": cluster_id, "status": CampaignStatus.DISCOVERING.value},
            {"$set": {
                "status": CampaignStatus.DISCOVERY_FAILED.value,
                "discovery_error": "Process restarted during discovery",
                "updated_at": now,
            }},
        )
        return result.modified_count

    def expire_if_past_end_date(self, cluster_id: str, now: datetime) -> bool:
        result = self.collection.update_one(
            {
                "cluster_id": cluster_id,
                "status": CampaignStatus.ACTIVE.value,
                "end_date": {"$lt": now},
            },
            {"$set": {"status": CampaignStatus.EXPIRED.value, "updated_at": now}},
        )
        return result.modified_count > 0

    def update_last_scan_triggered(self, campaign_id: str, at: datetime) -> None:
        self.collection.update_one(
            {"campaign_id": campaign_id},
            {"$set": {"last_scan_triggered_at": at, "updated_at": at}},
        )

    def update_status(self, campaign_id: str, status: CampaignStatus, **fields: object) -> bool:
        set_fields = {**fields, "status": status.value, "updated_at": now_vn()}
        result = self.collection.update_one({"campaign_id": campaign_id}, {"$set": set_fields})
        return result.modified_count > 0

    def increment_stats(self, campaign_id: str, *, done: int = 0, failed: int = 0, skipped: int = 0) -> None:
        self.collection.update_one(
            {"campaign_id": campaign_id},
            {
                "$inc": {
                    "done_count": done,
                    "failed_count": failed,
                    "skipped_count": skipped,
                },
                "$set": {"updated_at": now_vn()},
            },
        )
        campaign = self.find_by_id(campaign_id)
        if not campaign:
            return
        terminal_count = campaign.done_count + campaign.failed_count + campaign.skipped_count
        if campaign.total_items > 0 and terminal_count >= campaign.total_items:
            self.collection.update_one(
                {
                    "campaign_id": campaign_id,
                    "status": CampaignStatus.ACTIVE.value,
                },
                {"$set": {"status": CampaignStatus.COMPLETED.value, "updated_at": now_vn()}},
            )
