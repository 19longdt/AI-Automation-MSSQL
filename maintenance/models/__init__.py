"""Pydantic models cho maintenance module."""
from .approval import ApprovalInfo, BatchStatus, BatchSummary, MaintenanceBatch
from .campaign import (
    CampaignScopeDatabase,
    CampaignScopeTable,
    CampaignStatus,
    CampaignWindowOverride,
    ExecutionType,
    MaintenanceCampaign,
)
from .catalog import CatalogConfig, CatalogScopeDatabase as CatalogConfigDatabase, CatalogScopeSchema, CatalogTableDocument
from .command import MaintenanceCommand, MaintenanceCommandStatus, MaintenanceCommandType
from .history import MaintenanceHistory, MaintenanceOutcome
from .policy import MaintenancePolicy, PolicyScope
from .window import MaintenanceWindow, WindowSlot, WindowState
from .work_item import (
    ActionType,
    ItemKind,
    WorkItem,
    WorkItemMetrics,
    WorkItemStatus,
)

__all__ = [
    "ActionType",
    "ApprovalInfo",
    "BatchStatus",
    "BatchSummary",
    "CampaignScopeDatabase",
    "CampaignScopeTable",
    "CampaignStatus",
    "CampaignWindowOverride",
    "CatalogConfig",
    "CatalogConfigDatabase",
    "CatalogScopeSchema",
    "CatalogTableDocument",
    "MaintenanceCommand",
    "MaintenanceCommandStatus",
    "MaintenanceCommandType",
    "ExecutionType",
    "ItemKind",
    "MaintenanceBatch",
    "MaintenanceCampaign",
    "MaintenanceHistory",
    "MaintenanceOutcome",
    "MaintenancePolicy",
    "MaintenanceWindow",
    "PolicyScope",
    "WindowSlot",
    "WindowState",
    "WorkItem",
    "WorkItemMetrics",
    "WorkItemStatus",
]
