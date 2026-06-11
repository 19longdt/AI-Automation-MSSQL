"""policy_repo.py — CRUD maintenance_policies."""
from __future__ import annotations

import logging

from ..models.policy import MaintenancePolicy, PolicyScope
from ..mongo import get_maint_db

logger = logging.getLogger(__name__)

COLLECTION = "maintenance_policies"

# Field MongoDB internal — loại trước khi parse Pydantic
_EXCLUDE = {"_id"}


def _to_policy(doc: dict) -> MaintenancePolicy:
    """
    Parse document → MaintenancePolicy.

    QUAN TRỌNG: chỉ truyền field có trong doc — model_fields_set phản ánh
    đúng field được override explicit, để merge field-level hoạt động.
    """
    return MaintenancePolicy(**{k: v for k, v in doc.items() if k not in _EXCLUDE})


class PolicyRepo:

    @property
    def collection(self):
        return get_maint_db()[COLLECTION]

    def find_default(self) -> MaintenancePolicy | None:
        doc = self.collection.find_one({"policy_id": MaintenancePolicy.default_policy_id()})
        return _to_policy(doc) if doc else None

    def find_table_override(self, schema_name: str, table_name: str) -> MaintenancePolicy | None:
        doc = self.collection.find_one(
            {"policy_id": MaintenancePolicy.table_policy_id(schema_name, table_name)}
        )
        return _to_policy(doc) if doc else None

    def find_index_override(
        self, schema_name: str, table_name: str, index_name: str
    ) -> MaintenancePolicy | None:
        doc = self.collection.find_one(
            {"policy_id": MaintenancePolicy.index_policy_id(schema_name, table_name, index_name)}
        )
        return _to_policy(doc) if doc else None

    def find_all(self) -> list[MaintenancePolicy]:
        return [_to_policy(doc) for doc in self.collection.find()]

    def upsert(self, policy: MaintenancePolicy) -> None:
        """
        Override policies (scope=table/index) lưu SPARSE — chỉ field explicit set,
        để field không override fallback về default khi merge.
        Default policy lưu đầy đủ (là baseline).
        """
        if policy.scope == PolicyScope.DEFAULT:
            doc = policy.model_dump()
        else:
            doc = policy.model_dump(exclude_unset=True)
            # Định danh luôn phải có mặt
            doc["policy_id"] = policy.policy_id
            doc["scope"] = policy.scope.value
            doc["schema_name"] = policy.schema_name
            doc["table_name"] = policy.table_name
            doc["index_name"] = policy.index_name
        # replace_one (không phải $set) — bỏ override field cũ phải biến mất
        # khỏi document, nếu không nó vẫn đè default sau khi DBA xoá.
        self.collection.replace_one(
            {"policy_id": policy.policy_id},
            doc,
            upsert=True,
        )
