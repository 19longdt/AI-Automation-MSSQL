"""
seed_maintenance.py — Seed default policy + window config vào MongoDB.

Chạy 1 lần trước khi start maintenance runner:
    python -m layer1.maintenance.seed.seed_maintenance
    python -m layer1.maintenance.seed.seed_maintenance --dry-run

Idempotent — chạy lại sẽ upsert (ghi đè default policy + window về giá trị seed).
Override policies (scope=table/index) do DBA thêm KHÔNG bị động vào.

Ví dụ override per-object (DBA thêm trực tiếp MongoDB hoặc viết thêm builder):

    # Bảng partition lớn — chỉ cho rebuild partition-level, ưu tiên cao
    {
      "policy_id": "table:dbo.Bill",
      "scope": "table",
      "schema_name": "dbo", "table_name": "Bill", "index_name": null,
      "maxdop": 2,
      "priority_boost": 20
    }

    # Index có LOB — cho phép fallback offline
    {
      "policy_id": "index:dbo.Document.IX_Document_Content",
      "scope": "index",
      "schema_name": "dbo", "table_name": "Document", "index_name": "IX_Document_Content",
      "offline_fallback": true
    }

    # Loại bảng khỏi maintenance hoàn toàn
    { "policy_id": "table:dbo.AuditLog", "scope": "table",
      "schema_name": "dbo", "table_name": "AuditLog", "index_name": null,
      "enabled": false }
"""
from __future__ import annotations

import argparse
import logging

from ...config import settings
from ...storage.mongo_client import MongoConnection
from ..models.policy import MaintenancePolicy, PolicyScope
from ..models.window import MaintenanceWindow, WindowSlot
from ..repositories.policy_repo import PolicyRepo
from ..repositories.window_repo import WindowRepo

logger = logging.getLogger(__name__)


def _default_policy() -> MaintenancePolicy:
    """Baseline cho mọi object — override per table/index khi cần."""
    return MaintenancePolicy(
        policy_id=MaintenancePolicy.default_policy_id(),
        scope=PolicyScope.DEFAULT,
        enabled=True,
        reorganize_threshold_pct=10.0,
        rebuild_threshold_pct=30.0,
        min_page_count=1000,
        max_page_count=None,
        maxdop=4,
        online=True,        # Enterprise edition
        resumable=True,     # REBUILD pause/resume được — multi-day an toàn
        offline_fallback=False,
        stats_modification_threshold=20_000,
        stats_fullscan=False,
        stats_sample_pct=None,
        heap_forwarded_records_threshold=1000,
        priority_boost=0,
    )


def _default_window() -> MaintenanceWindow:
    """
    Window 01:00–04:00 hàng đêm, budget 170p (chừa ~10p slack trước 04:00).
    day_overrides: "0"=Mon .. "6"=Sun — ví dụ cuối tuần cho window dài hơn.
    """
    return MaintenanceWindow(
        window_id="default",
        enabled=True,
        default=WindowSlot(start="01:00", end="04:00", time_budget_minutes=170),
        day_overrides={
            # Đêm Thứ 7 + Chủ Nhật (window bắt đầu ngày 5=Sat, 6=Sun): dài hơn
            "5": WindowSlot(start="00:00", end="05:00", time_budget_minutes=280),
            "6": WindowSlot(start="00:00", end="05:00", time_budget_minutes=280),
        },
        kill_switch=False,
        gates={},  # dùng DEFAULT_GATES; override: {"cpu_max_pct": 50, ...}
    )


def seed(dry_run: bool = False) -> None:
    policy = _default_policy()
    window = _default_window()

    if dry_run:
        print("=== DRY RUN — không ghi MongoDB ===")
        print("\n--- maintenance_policies (default) ---")
        print(policy.model_dump_json(indent=2))
        print("\n--- maintenance_window ---")
        print(window.model_dump_json(indent=2))
        return

    MongoConnection.initialize(settings)
    try:
        PolicyRepo().upsert(policy)
        logger.info("Seeded default maintenance policy.")
        WindowRepo().upsert(window)
        logger.info(
            "Seeded maintenance window: %s-%s budget=%dp (+%d day overrides).",
            window.default.start, window.default.end,
            window.default.time_budget_minutes, len(window.day_overrides),
        )
    finally:
        MongoConnection.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
    parser = argparse.ArgumentParser(description="Seed maintenance policies + window")
    parser.add_argument("--dry-run", action="store_true", help="In config, không ghi MongoDB")
    args = parser.parse_args()
    seed(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
