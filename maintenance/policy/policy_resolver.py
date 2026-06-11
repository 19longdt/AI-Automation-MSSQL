"""
policy_resolver.py — Merge policy theo precedence: default ← table ← index.

Override field-level: chỉ field explicit set trong override document mới đè
(PolicyRepo lưu override sparse + _to_policy chỉ truyền field có mặt).

reload() load toàn bộ policies 1 lần → resolve() là in-memory lookup.
Scan vài trăm objects không bắn vài trăm query Mongo; caller gọi reload()
đầu mỗi scan/tick để pick up thay đổi DBA vừa sửa.
"""
from __future__ import annotations

import logging

from ..models.policy import MaintenancePolicy
from ..repositories.policy_repo import PolicyRepo

logger = logging.getLogger(__name__)


class PolicyResolver:

    def __init__(self, policy_repo: PolicyRepo) -> None:
        self._repo = policy_repo
        self._by_id: dict[str, MaintenancePolicy] = {}
        self._loaded = False

    def reload(self) -> None:
        """Load fresh toàn bộ policies. Gọi đầu mỗi scan run / execute tick."""
        self._by_id = {p.policy_id: p for p in self._repo.find_all()}
        self._loaded = True

    def resolve(
        self,
        schema_name: str,
        table_name: str,
        index_name: str | None = None,
    ) -> MaintenancePolicy:
        """
        Trả về policy hiệu lực cho 1 object.
        Thiếu default policy → raise (fail fast — phải seed trước khi chạy).
        """
        if not self._loaded:
            self.reload()

        default = self._by_id.get(MaintenancePolicy.default_policy_id())
        if default is None:
            raise RuntimeError(
                "Thiếu default maintenance policy — chạy: "
                "python -m maintenance.seed.seed_maintenance"
            )

        effective = default

        table_override = self._by_id.get(
            MaintenancePolicy.table_policy_id(schema_name, table_name)
        )
        if table_override is not None:
            effective = effective.merge_override(table_override)

        if index_name:
            index_override = self._by_id.get(
                MaintenancePolicy.index_policy_id(schema_name, table_name, index_name)
            )
            if index_override is not None:
                effective = effective.merge_override(index_override)

        return effective
