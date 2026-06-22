"""
seed_capture_tools.py - Seed capture_tool_defs collection for Layer 1 full-capture.

Run:
    python -m layer1.seed.seed_capture_tools
"""
from __future__ import annotations

import logging
from typing import Any

from ..config import settings
from ..models.capture_tool import ExecutionType
from ..storage.mongo_client import MongoConnection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


def _base_ai_hints(
    key_columns: list[str],
    interpret_as: str,
    max_rows_for_ai: int = 10,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a normalized ai_hints object used by all tool definitions."""
    return {
        "key_columns": key_columns,
        "max_rows_for_ai": max_rows_for_ai,
        "interpret_as": interpret_as,
        "thresholds": thresholds or {},
    }


def _sql_tool(
    tool_id: str,
    display_name: str,
    description: str,
    sql: str | None,
    phase: int,
    *,
    timeout_sec: int = 10,
    needs_query_hash: bool = False,
    needs_table_name: bool = False,
    is_multi_query: bool = False,
    sql_parts: dict[str, str] | None = None,
    ai_hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one SQL tool document with common defaults for params/hints."""
    return {
        "tool_id": tool_id,
        "display_name": display_name,
        "description": description,
        "execution_type": ExecutionType.SQL.value,
        "sql": sql,
        "sql_parts": sql_parts,
        "params": {
            "needs_query_hash": needs_query_hash,
            "needs_table_name": needs_table_name,
            "is_multi_query": is_multi_query,
        },
        "phase": phase,
        "timeout_sec": timeout_sec,
        "enabled": True,
        "ai_hints": ai_hints or _base_ai_hints([], ""),
    }


def _static_tool(
    tool_id: str,
    display_name: str,
    description: str,
    phase: int,
    *,
    ai_hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one static tool document (logic executed in Python, no SQL)."""
    return {
        "tool_id": tool_id,
        "display_name": display_name,
        "description": description,
        "execution_type": ExecutionType.STATIC.value,
        "sql": None,
        "sql_parts": None,
        "params": {
            "needs_query_hash": False,
            "needs_table_name": False,
            "is_multi_query": False,
        },
        "phase": phase,
        "timeout_sec": 10,
        "enabled": True,
        "ai_hints": ai_hints or _base_ai_hints([], ""),
    }


def _mongo_tool(
    tool_id: str,
    display_name: str,
    description: str,
    phase: int,
    *,
    ai_hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one mongo tool document (logic executed with Mongo reads)."""
    return {
        "tool_id": tool_id,
        "display_name": display_name,
        "description": description,
        "execution_type": ExecutionType.MONGO.value,
        "sql": None,
        "sql_parts": None,
        "params": {
            "needs_query_hash": False,
            "needs_table_name": False,
            "is_multi_query": False,
        },
        "phase": phase,
        "timeout_sec": 10,
        "enabled": True,
        "ai_hints": ai_hints or _base_ai_hints([], ""),
    }


def _get_blocking_chain() -> dict[str, Any]:
    """Capture currently blocked requests and blocker chain depth signals."""
    sql = """
SELECT TOP 50
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000.0 AS wait_sec,
    DB_NAME(r.database_id) AS database_name
FROM sys.dm_exec_requests r
WHERE r.blocking_session_id > 0
ORDER BY r.wait_time DESC
"""
    return _sql_tool(
        "get_blocking_chain",
        "Blocking Chain",
        "Current blocking chain from sys.dm_exec_requests",
        sql,
        1,
        ai_hints=_base_ai_hints(["session_id", "blocking_session_id", "wait_type", "wait_sec"], "Blocking snapshot at T+0."),
    )


def _get_blocked_victims_snapshot() -> dict[str, Any]:
    """Forensic per-victim tại T+0 cho blocking CRITICAL — những field cố tình
    KHÔNG đưa vào finding.metrics (×N victims sẽ phình finding/Telegram):
    full query text, wait_resource, host/program, victim plan XML.
    Blocking tự resolve nhanh → đây là bằng chứng duy nhất còn lại khi DBA/AI phân tích sau."""
    sql = """
SELECT TOP 30
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000.0            AS wait_sec,
    r.wait_resource,
    r.command,
    DB_NAME(r.database_id)          AS database_name,
    s.login_name,
    s.host_name,
    s.program_name,
    CONVERT(NVARCHAR(18), r.query_hash, 1) AS query_hash,
    qt.text                         AS query_text,
    qp.query_plan                   AS victim_plan_xml
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) qp
WHERE r.blocking_session_id > 0
ORDER BY r.wait_time DESC
"""
    return _sql_tool(
        "get_blocked_victims_snapshot",
        "Blocked Victims Snapshot",
        "Per-victim forensic at T+0: full query text, wait_resource, host, victim plan XML",
        sql,
        1,
        timeout_sec=15,
        ai_hints=_base_ai_hints(
            ["session_id", "blocking_session_id", "wait_resource", "wait_sec", "query_text"],
            "Victims at T+0 with full text + wait_resource; victim_plan_xml shows what victim was executing (scan/seek) when blocked.",
        ),
    )


def _get_wait_stats() -> dict[str, Any]:
    """Capture top wait categories to describe global pressure source."""
    sql = """
SELECT TOP 20
    wait_type,
    wait_time_ms,
    waiting_tasks_count
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0
ORDER BY wait_time_ms DESC
"""
    return _sql_tool(
        "get_wait_stats",
        "Wait Statistics",
        "Top wait types from sys.dm_os_wait_stats",
        sql,
        1,
        ai_hints=_base_ai_hints(
            ["wait_type", "wait_time_ms", "waiting_tasks_count"],
            "Top waits at T+0; PAGEIOLATCH often points to storage IO, LCK_M to lock contention.",
        ),
    )


def _get_memory_grant() -> dict[str, Any]:
    """Capture active/pending memory grants."""
    sql = """
SELECT TOP 50
    session_id,
    requested_memory_kb,
    granted_memory_kb,
    required_memory_kb,
    wait_time_ms
FROM sys.dm_exec_query_memory_grants
ORDER BY requested_memory_kb DESC
"""
    return _sql_tool(
        "get_memory_grant",
        "Memory Grants",
        "Memory grant queue from sys.dm_exec_query_memory_grants",
        sql,
        1,
        ai_hints=_base_ai_hints(["session_id", "requested_memory_kb", "granted_memory_kb", "wait_time_ms"], "Grant starvation indicators."),
    )


def _get_ple_numa() -> dict[str, Any]:
    """Capture PLE per NUMA node to detect local buffer pressure imbalance."""
    sql = """
SELECT
    object_name AS numa_node,
    cntr_value  AS ple_sec
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND object_name LIKE '%Buffer Node%'
ORDER BY object_name
"""
    return _sql_tool(
        "get_ple_numa",
        "PLE per NUMA Node",
        "Page life expectancy per Buffer Node from sys.dm_os_performance_counters",
        sql,
        1,
        ai_hints=_base_ai_hints(
            ["numa_node", "ple_sec"],
            "Compare PLE across NUMA nodes; one bad node can be hidden by a healthy global PLE.",
        ),
    )


def _get_tempdb_usage() -> dict[str, Any]:
    """Capture TempDB space pressure metrics."""
    sql = """
SELECT TOP 1
    SUM(total_page_count) * 8.0 / 1024 AS total_mb,
    SUM(unallocated_extent_page_count) * 8.0 / 1024 AS free_mb,
    100.0 * (1 - SUM(unallocated_extent_page_count) * 1.0 / NULLIF(SUM(total_page_count), 0)) AS used_pct
FROM sys.dm_db_file_space_usage
"""
    return _sql_tool(
        "get_tempdb_usage",
        "TempDB Usage",
        "TempDB capacity and usage percent",
        sql,
        1,
        ai_hints=_base_ai_hints(["total_mb", "free_mb", "used_pct"], "TempDB saturation and headroom."),
    )


def _get_ag_status() -> dict[str, Any]:
    """Capture AG replica synchronization status."""
    sql = """
SELECT TOP 20
    ar.replica_server_name,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    drs.log_send_queue_size,
    drs.redo_queue_size
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id
"""
    return _sql_tool(
        "get_ag_status",
        "AG Status",
        "Availability group sync health",
        sql,
        1,
        ai_hints=_base_ai_hints(["replica_server_name", "synchronization_health_desc", "log_send_queue_size", "redo_queue_size"], "AG lag and health snapshot."),
    )


def _get_memory_pressure() -> dict[str, Any]:
    """Capture memory pressure from perf counters and clerks using multi-query."""
    return _sql_tool(
        "get_memory_pressure",
        "Memory Pressure",
        "Memory pressure summary from counters and memory clerks",
        None,
        1,
        is_multi_query=True,
        sql_parts={
            "perf_counters": """
SELECT counter_name, cntr_value
FROM sys.dm_os_performance_counters
WHERE counter_name IN ('Page life expectancy', 'Memory Grants Pending')
""",
            "clerks": """
SELECT TOP 20
    type,
    pages_kb
FROM sys.dm_os_memory_clerks
ORDER BY pages_kb DESC
""",
        },
        ai_hints=_base_ai_hints(["counter_name", "cntr_value", "type", "pages_kb"], "Correlate low PLE, pending grants, and memory consumers."),
    )


def _get_resource_governor_stats() -> dict[str, Any]:
    """Capture Resource Governor pool pressure and throttling signals."""
    sql = """
SELECT TOP 20
    rp.name AS pool_name,
    rprs.avg_cpu_percent,
    rprs.blocked_task_count,
    rprs.active_request_count
FROM sys.dm_resource_governor_resource_pools rprs
JOIN sys.resource_governor_resource_pools rp ON rprs.pool_id = rp.pool_id
"""
    return _sql_tool(
        "get_resource_governor_stats",
        "Resource Governor Stats",
        "Pool utilization and blocking metrics",
        sql,
        1,
        ai_hints=_base_ai_hints(["pool_name", "avg_cpu_percent", "blocked_task_count", "active_request_count"], "Resource pool contention indicators."),
    )


def _get_cdc_status() -> dict[str, Any]:
    """Capture CDC job states from msdb history."""
    sql = """
SELECT TOP 20
    j.name AS job_name,
    j.enabled,
    jh.run_status,
    jh.run_date,
    jh.run_time
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobhistory jh ON j.job_id = jh.job_id
WHERE j.name LIKE 'cdc.%' AND jh.step_id = 0
ORDER BY jh.run_date DESC, jh.run_time DESC
"""
    return _sql_tool(
        "get_cdc_status",
        "CDC Status",
        "CDC capture/cleanup job status",
        sql,
        1,
        ai_hints=_base_ai_hints(["job_name", "enabled", "run_status", "run_date", "run_time"], "CDC ingestion health."),
    )


def _get_missing_indexes() -> dict[str, Any]:
    """Capture highest impact missing-index candidates."""
    sql = """
SELECT TOP 30
    DB_NAME(mid.database_id) AS database_name,
    OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.user_seeks,
    migs.user_scans,
    migs.avg_user_impact
FROM sys.dm_db_missing_index_details mid
JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
WHERE mid.database_id = DB_ID()
ORDER BY migs.avg_user_impact DESC
"""
    return _sql_tool(
        "get_missing_indexes",
        "Missing Indexes",
        "Missing index recommendations",
        sql,
        1,
        ai_hints=_base_ai_hints(["table_name", "equality_columns", "inequality_columns", "avg_user_impact"], "Evaluate with write overhead before creating."),
    )


def _get_query_stats() -> dict[str, Any]:
    """Capture per-query stats by query_hash for the current finding."""
    sql = """
SELECT TOP 20
    qs.execution_count,
    qs.total_worker_time,
    qs.total_elapsed_time,
    qs.total_logical_reads,
    qs.last_execution_time
FROM sys.dm_exec_query_stats qs
WHERE qs.query_hash = ?
ORDER BY qs.last_execution_time DESC
"""
    return _sql_tool(
        "get_query_stats",
        "Query Stats",
        "Query stats by query_hash from sys.dm_exec_query_stats",
        sql,
        1,
        needs_query_hash=True,
        ai_hints=_base_ai_hints(["execution_count", "total_elapsed_time", "total_worker_time", "total_logical_reads"], "Workload weight and cost profile for this query hash."),
    )


def _get_query_store_history() -> dict[str, Any]:
    """Capture historical runtime stats from Query Store by query_hash."""
    sql = """
SELECT TOP 50
    rs.last_execution_time,
    rs.avg_duration,
    rs.avg_cpu_time,
    rs.avg_logical_io_reads,
    rs.count_executions
FROM sys.query_store_runtime_stats rs
JOIN sys.query_store_plan p ON rs.plan_id = p.plan_id
JOIN sys.query_store_query q ON p.query_id = q.query_id
WHERE q.query_hash = ?
ORDER BY rs.last_execution_time DESC
"""
    return _sql_tool(
        "get_query_store_history",
        "Query Store History",
        "Historical runtime by query hash from Query Store",
        sql,
        1,
        needs_query_hash=True,
        ai_hints=_base_ai_hints(["last_execution_time", "avg_duration", "avg_cpu_time", "count_executions"], "Trend and regression signals over time."),
    )


def _get_index_usage() -> dict[str, Any]:
    """Capture index usage profile for one table extracted from query analysis."""
    sql = """
SELECT TOP 50
    OBJECT_NAME(i.object_id) AS table_name,
    i.name AS index_name,
    us.user_seeks,
    us.user_scans,
    us.user_lookups,
    us.user_updates
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats us
    ON i.object_id = us.object_id
   AND i.index_id = us.index_id
   AND us.database_id = DB_ID()
WHERE OBJECT_NAME(i.object_id) = ?
ORDER BY us.user_seeks DESC, us.user_scans DESC
"""
    return _sql_tool(
        "get_index_usage",
        "Index Usage",
        "Usage stats for indexes on a specific table",
        sql,
        3,
        needs_table_name=True,
        ai_hints=_base_ai_hints(["table_name", "index_name", "user_seeks", "user_scans", "user_updates"], "Read/write balance and potential redundant indexes."),
    )


def _get_statistics_info() -> dict[str, Any]:
    """Capture statistics freshness for one table."""
    sql = """
SELECT TOP 50
    OBJECT_NAME(s.object_id) AS table_name,
    s.name AS stats_name,
    STATS_DATE(s.object_id, s.stats_id) AS last_updated,
    sp.rows,
    sp.rows_sampled
FROM sys.stats s
OUTER APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECT_NAME(s.object_id) = ?
ORDER BY last_updated ASC
"""
    return _sql_tool(
        "get_statistics_info",
        "Statistics Info",
        "Statistics metadata and freshness for a table",
        sql,
        3,
        needs_table_name=True,
        ai_hints=_base_ai_hints(["table_name", "stats_name", "last_updated", "rows", "rows_sampled"], "Outdated or under-sampled statistics can mislead optimizer."),
    )


def _get_plan_analysis() -> dict[str, Any]:
    """Define static tool for plan XML analysis (no DB query)."""
    return _static_tool(
        "get_plan_analysis",
        "Plan Analysis",
        "Parse query_plan_xml into operators/warnings/tables",
        2,
        ai_hints=_base_ai_hints(["top_operators", "warnings", "partition_info"], "Operator-level risk patterns from execution plan."),
    )


def _get_query_structure() -> dict[str, Any]:
    """Define static tool for SQL text structure analysis."""
    return _static_tool(
        "get_query_structure",
        "Query Structure",
        "Parse query text into tables/joins/predicates",
        2,
        ai_hints=_base_ai_hints(["tables", "joins", "where_clause", "query_type"], "Structural SQL anti-patterns and complexity hints."),
    )


def _get_table_context() -> dict[str, Any]:
    """Define mongo tool for matching affected tables with business context."""
    return _mongo_tool(
        "get_table_context",
        "Table Context",
        "Match affected tables against db_context business context",
        4,
        ai_hints=_base_ai_hints(["table_name", "found_in_context"], "Business context relevance per table."),
    )


def _get_recent_findings() -> dict[str, Any]:
    """Define mongo tool for recent similar findings."""
    return _mongo_tool(
        "get_recent_findings",
        "Recent Findings",
        "Recent findings in last 24h for same node and issue_type",
        4,
        ai_hints=_base_ai_hints(["finding_id", "severity", "detected_at", "status"], "Recency and repetition pattern."),
    )


def _get_analysis_history() -> dict[str, Any]:
    """Define mongo tool for historical insight recurrence."""
    return _mongo_tool(
        "get_analysis_history",
        "Analysis History",
        "Recurring insight summaries for same issue_type/node",
        4,
        ai_hints=_base_ai_hints(["issue_type", "root_cause_summary", "recurrence_count", "updated_at"], "Known root-cause recurrence."),
    )


def _all_tools() -> list[dict[str, Any]]:
    """Return all capture tool definitions in deterministic order."""
    return [
        _get_blocking_chain(),
        _get_blocked_victims_snapshot(),
        _get_wait_stats(),
        _get_memory_grant(),
        _get_ple_numa(),
        _get_tempdb_usage(),
        _get_ag_status(),
        _get_memory_pressure(),
        _get_resource_governor_stats(),
        _get_cdc_status(),
        _get_missing_indexes(),
        _get_query_stats(),
        _get_query_store_history(),
        _get_index_usage(),
        _get_statistics_info(),
        _get_plan_analysis(),
        _get_query_structure(),
        _get_table_context(),
        _get_recent_findings(),
        _get_analysis_history(),
    ]


def _validate_tool(tool: dict[str, Any]) -> None:
    """Validate one tool definition before writing to MongoDB."""
    execution_type = ExecutionType(tool.get("execution_type"))
    sql = tool.get("sql")
    sql_parts = tool.get("sql_parts")

    # SQL tools must define either single sql text or multi-part sql_parts.
    if execution_type == ExecutionType.SQL and not (sql or sql_parts):
        raise ValueError(f"SQL tool must have sql/sql_parts: {tool.get('tool_id')}")

    # Non-SQL tools should not carry executable SQL payload.
    if execution_type in {ExecutionType.STATIC, ExecutionType.MONGO} and (sql or sql_parts):
        raise ValueError(f"Non-SQL tool cannot have sql/sql_parts: {tool.get('tool_id')}")


def seed_capture_tools() -> None:
    """Upsert all capture tool definitions into capture_tool_defs collection."""
    tools = _all_tools()
    col = MongoConnection.get_db()["capture_tool_defs"]

    for tool in tools:
        # Validate before write to keep capture_tool_defs schema consistent.
        _validate_tool(tool)
        col.update_one({"tool_id": tool["tool_id"]}, {"$set": tool}, upsert=True)
        logger.info("Seeded capture tool: %s (type=%s phase=%s)", tool["tool_id"], tool["execution_type"], tool["phase"])

    logger.info("Done: seeded %d capture tool definitions.", len(tools))


def main() -> None:
    """Entry point for CLI execution."""
    MongoConnection.initialize(settings)
    try:
        seed_capture_tools()
    finally:
        MongoConnection.close()


if __name__ == "__main__":
    main()
