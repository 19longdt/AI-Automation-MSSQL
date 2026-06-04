"""
statement_builder.py — Sinh T-SQL cho maintenance actions. Pure functions.

Identifier từ DMV (schema/table/index/stats name) được quote bằng bracket
với escape ] → ]] — chống injection từ tên object độc hại.

Lưu ý syntax (đã verify với SQL Server 2019 Enterprise):
  - REORGANIZE: luôn online, KHÔNG nhận MAXDOP/ONLINE/RESUMABLE
  - REBUILD ONLINE=ON: Enterprise only; RESUMABLE=ON yêu cầu ONLINE=ON
  - MAX_DURATION chỉ hợp lệ khi RESUMABLE=ON — server tự PAUSE khi hết giờ
  - Partition-level: REBUILD PARTITION = n / REORGANIZE PARTITION = n
"""
from __future__ import annotations

from ..models.policy import MaintenancePolicy
from ..models.work_item import ActionType, WorkItem


def quote_ident(ident: str) -> str:
    """Bracket-quote 1 identifier, escape ] → ]]."""
    return "[" + ident.replace("]", "]]") + "]"


def _qualified_table(item: WorkItem) -> str:
    return f"{quote_ident(item.schema_name)}.{quote_ident(item.table_name)}"


def build_statement(
    item: WorkItem,
    policy: MaintenancePolicy,
    remaining_minutes: float,
    *,
    force_offline: bool = False,
) -> str:
    """
    Sinh statement cho work item theo policy.
    remaining_minutes: budget còn lại — thành MAX_DURATION của resumable rebuild.
    force_offline: retry path khi gặp ONLINE/RESUMABLE restriction (LOB...).
    """
    if item.action_type == ActionType.REORGANIZE:
        return _build_reorganize(item)
    if item.action_type in (ActionType.REBUILD, ActionType.REBUILD_PARTITION):
        return _build_rebuild(item, policy, remaining_minutes, force_offline)
    if item.action_type == ActionType.UPDATE_STATISTICS:
        return _build_update_statistics(item, policy)
    if item.action_type == ActionType.HEAP_REBUILD:
        return _build_heap_rebuild(item, policy, force_offline)
    raise ValueError(f"Action type không hỗ trợ: {item.action_type}")


def _build_reorganize(item: WorkItem) -> str:
    if not item.index_name:
        raise ValueError("REORGANIZE cần index_name")
    stmt = f"ALTER INDEX {quote_ident(item.index_name)} ON {_qualified_table(item)} REORGANIZE"
    if item.partition_number is not None:
        stmt += f" PARTITION = {int(item.partition_number)}"
    return stmt


def _build_rebuild(
    item: WorkItem,
    policy: MaintenancePolicy,
    remaining_minutes: float,
    force_offline: bool,
) -> str:
    if not item.index_name:
        raise ValueError("REBUILD cần index_name")

    online = policy.online and not force_offline
    # RESUMABLE yêu cầu ONLINE=ON
    resumable = policy.resumable and online

    options = [f"ONLINE = {'ON' if online else 'OFF'}", f"MAXDOP = {int(policy.maxdop)}"]
    if resumable:
        options.append("RESUMABLE = ON")
        max_duration = max(int(remaining_minutes), 1)
        options.append(f"MAX_DURATION = {max_duration} MINUTES")

    stmt = f"ALTER INDEX {quote_ident(item.index_name)} ON {_qualified_table(item)} REBUILD"
    if item.partition_number is not None:
        stmt += f" PARTITION = {int(item.partition_number)}"
    stmt += " WITH (" + ", ".join(options) + ")"
    return stmt


def _build_update_statistics(item: WorkItem, policy: MaintenancePolicy) -> str:
    if not item.stats_name:
        raise ValueError("UPDATE STATISTICS cần stats_name")
    stmt = f"UPDATE STATISTICS {_qualified_table(item)} ({quote_ident(item.stats_name)})"
    if policy.stats_fullscan:
        stmt += " WITH FULLSCAN"
    elif policy.stats_sample_pct is not None:
        stmt += f" WITH SAMPLE {int(policy.stats_sample_pct)} PERCENT"
    # Không option = SQL Server tự chọn sample rate (default sampling)
    return stmt


def _build_heap_rebuild(item: WorkItem, policy: MaintenancePolicy, force_offline: bool) -> str:
    online = policy.online and not force_offline
    options = [f"ONLINE = {'ON' if online else 'OFF'}", f"MAXDOP = {int(policy.maxdop)}"]
    stmt = f"ALTER TABLE {_qualified_table(item)} REBUILD"
    if item.partition_number is not None:
        stmt += f" PARTITION = {int(item.partition_number)}"
    stmt += " WITH (" + ", ".join(options) + ")"
    return stmt


# ── Control statements cho resumable rebuild ────────────────────────────────

def build_pause(item: WorkItem) -> str:
    if not item.index_name:
        raise ValueError("PAUSE cần index_name")
    return f"ALTER INDEX {quote_ident(item.index_name)} ON {_qualified_table(item)} PAUSE"


def build_resume(item: WorkItem, policy: MaintenancePolicy, remaining_minutes: float) -> str:
    if not item.index_name:
        raise ValueError("RESUME cần index_name")
    max_duration = max(int(remaining_minutes), 1)
    return (
        f"ALTER INDEX {quote_ident(item.index_name)} ON {_qualified_table(item)} "
        f"RESUME WITH (MAX_DURATION = {max_duration} MINUTES)"
    )


def build_abort(item: WorkItem) -> str:
    if not item.index_name:
        raise ValueError("ABORT cần index_name")
    return f"ALTER INDEX {quote_ident(item.index_name)} ON {_qualified_table(item)} ABORT"
