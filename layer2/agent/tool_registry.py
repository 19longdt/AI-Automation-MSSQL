"""
tool_registry.py - Claude tool whitelist and tool schema definitions.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..models.skill import AnalysisSkill


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict
    block_in_peak_hours: bool = False


def _schema(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": properties, "required": required}


_NODE = {"type": "string", "description": "Hostname cua MSSQL node can query"}
_TOP_N = {"type": "integer", "description": "So rows toi da tra ve", "default": 20}
_TABLE = {"type": "string", "description": "Ten bang, khong kem schema"}
_QUERY_HASH = {"type": "string", "description": "Query hash dang hex, vi du: 0xABCD1234ABCD1234"}


TOOL_REGISTRY: dict[str, ToolDefinition] = {
    "get_plan_analysis": ToolDefinition(
        name="get_plan_analysis",
        description=(
            "Phan tich query_plan_xml cua finding va tra ve summary co cau truc: top operators, warnings, "
            "partition access, implicit conversions, missing index hints, parallelism, va spills."
        ),
        input_schema=_schema(
            {"finding_id": {"type": "string", "description": "Finding ID can phan tich plan"}},
            required=["finding_id"],
        ),
    ),
    "get_query_structure": ToolDefinition(
        name="get_query_structure",
        description=(
            "Phan tich query_text cua finding va tra ve cau truc query: tables, joins, where clause, "
            "order/group by, function calls, va query type."
        ),
        input_schema=_schema(
            {"finding_id": {"type": "string", "description": "Finding ID can phan tich query"}},
            required=["finding_id"],
        ),
    ),
    "get_table_context": ToolDefinition(
        name="get_table_context",
        description=(
            "Lay business context lien quan den mot bang tu db_context MongoDB, thay vi inject toan bo db_context "
            "vao prompt."
        ),
        input_schema=_schema(
            {"table_name": {"type": "string", "description": "Ten bang can tra context"}},
            required=["table_name"],
        ),
    ),
    "get_analysis_history": ToolDefinition(
        name="get_analysis_history",
        description=(
            "Lay lich su phan tich gan day va recurrence context tu issue_insights va ai_analyses cho finding hien tai."
        ),
        input_schema=_schema(
            {
                "finding_id": {"type": "string", "description": "Finding ID hien tai"},
                "issue_type": {"type": "string", "description": "Issue type de tim recurrence gan dung"},
                "node": {"type": "string", "description": "Node de loc context recurrence"},
            },
            required=["finding_id"],
        ),
    ),
    "get_query_stats": ToolDefinition(
        name="get_query_stats",
        description=(
            "Lay execution stats tu sys.dm_exec_query_stats cho 1 query hash, grouped by plan_handle "
            "de phat hien parameter sniffing va plan variation. "
            "Truyen finding_time de nhan co plan_predates_finding: False = cache da evict plan cu, "
            "stats la cua plan MOI (spill/physical_read van dung); True = stats lien quan den su co."
        ),
        input_schema=_schema(
            {
                "query_hash": _QUERY_HASH,
                "node": _NODE,
                "top_n": {**_TOP_N, "default": 10},
                "finding_time": {
                    "type": "string",
                    "description": (
                        "ISO 8601 timestamp cua finding (detected_at) — dung de tinh plan_predates_finding. "
                        "Vi du: '2024-01-15T10:42:43'"
                    ),
                },
            },
            required=["query_hash", "node"],
        ),
    ),
    "get_query_store_history": ToolDefinition(
        name="get_query_store_history",
        description=(
            "Lay lich su execution tu Query Store theo query hash de phat hien plan regression, "
            "plan change timeline, va forced plan status."
        ),
        input_schema=_schema(
            {
                "query_hash": _QUERY_HASH,
                "node": _NODE,
                "days_back": {"type": "integer", "description": "So ngay nhin lai", "default": 7},
                "top_n": {**_TOP_N, "default": 20},
            },
            required=["query_hash", "node"],
        ),
    ),
    "get_statistics_info": ToolDefinition(
        name="get_statistics_info",
        description=(
            "Kiem tra freshness cua statistics cho 1 bang. last_updated cu, sample_pct thap, "
            "hoac modification_counter cao deu la dau hieu cardinality estimate xau."
        ),
        input_schema=_schema(
            {
                "table_name": _TABLE,
                "node": _NODE,
                "top_n": {**_TOP_N, "default": 50},
            },
            required=["table_name", "node"],
        ),
    ),
    "get_memory_grant": ToolDefinition(
        name="get_memory_grant",
        description=(
            "Xem memory grants dang active. requested_memory_kb >> granted_memory_kb la memory pressure. "
            "used_memory_kb << granted_memory_kb la estimate qua cao."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),
    "get_ple_numa": ToolDefinition(
        name="get_ple_numa",
        description=(
            "Lay PLE theo tung NUMA node tu Buffer Node counters. Dung de phat hien 1 node bi pressure "
            "du global PLE van co ve on."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 16}},
            required=["node"],
        ),
    ),
    "get_blocking_chain": ToolDefinition(
        name="get_blocking_chain",
        description=(
            "Lay blocking chain hien tai tu sys.dm_exec_requests, bao gom head blocker, blocked sessions, "
            "wait type, va command dang chay."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 30}},
            required=["node"],
        ),
    ),
    "get_wait_stats": ToolDefinition(
        name="get_wait_stats",
        description=(
            "Lay top wait types da loc idle waits. Dung de phan biet I/O, memory, lock, parallelism, "
            "TempDB, va network pressure."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),
    "get_index_usage": ToolDefinition(
        name="get_index_usage",
        description=(
            "Xem index usage stats cho 1 bang. user_seeks=0 voi user_scans cao la dau hieu index khong "
            "duoc dung dung cach hoac dang full scan."
        ),
        input_schema=_schema(
            {
                "table_name": _TABLE,
                "node": _NODE,
                "top_n": {**_TOP_N, "default": 50},
            },
            required=["table_name", "node"],
        ),
    ),
    "get_missing_indexes": ToolDefinition(
        name="get_missing_indexes",
        description=(
            "Lay missing index recommendations tu DMV. Co the filter theo table_name de tap trung vao 1 bang."
        ),
        input_schema=_schema(
            {
                "node": _NODE,
                "table_name": {**_TABLE, "description": "Loc theo bang cu the; de trong = tat ca"},
                "top_n": {**_TOP_N, "default": 20},
            },
            required=["node"],
        ),
    ),
    "get_tempdb_usage": ToolDefinition(
        name="get_tempdb_usage",
        description=(
            "Xem TempDB space usage theo session de phan biet user objects, internal objects, va version store."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),
    "get_ag_status": ToolDefinition(
        name="get_ag_status",
        description=(
            "Lay trang thai AG replicas: synchronization health, log_send_queue_size, redo_queue_size, va lag."
        ),
        input_schema=_schema({"node": _NODE}, required=["node"]),
    ),
    "get_memory_pressure": ToolDefinition(
        name="get_memory_pressure",
        description=(
            "Kiem tra memory pressure: PLE, Target vs Total Server Memory, top memory clerks, "
            "va memory grants pending."
        ),
        input_schema=_schema({"node": _NODE}, required=["node"]),
    ),
    "get_resource_governor_stats": ToolDefinition(
        name="get_resource_governor_stats",
        description=(
            "Xem Resource Governor pool stats: CPU, memory grants, active requests, va queued requests per pool."
        ),
        input_schema=_schema({"node": _NODE}, required=["node"]),
    ),
    "get_cdc_status": ToolDefinition(
        name="get_cdc_status",
        description=(
            "Xem CDC log scan sessions de phat hien capture lag, cleanup lag, va scan failure."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 10}},
            required=["node"],
        ),
    ),
    "get_recent_findings": ToolDefinition(
        name="get_recent_findings",
        description=(
            "Lay findings gan day tu MongoDB de phat hien recurring issues va recent trend."
        ),
        input_schema=_schema(
            {
                "node": {**_NODE, "description": "Loc theo node; de trong = tat ca"},
                "issue_type": {"type": "string", "description": "Loc theo issue type; de trong = tat ca"},
                "hours_back": {"type": "integer", "description": "So gio nhin lai", "default": 24},
                "limit": {"type": "integer", "description": "So findings toi da", "default": 10},
            },
            required=[],
        ),
    ),
    "get_index_fragmentation": ToolDefinition(
        name="get_index_fragmentation",
        description=(
            "Do fragmentation cua indexes bang sys.dm_db_index_physical_stats (SAMPLED). "
            "Tool nay bi block trong peak hours do I/O overhead."
        ),
        input_schema=_schema(
            {
                "table_name": _TABLE,
                "node": _NODE,
                "top_n": {**_TOP_N, "default": 30},
            },
            required=["table_name", "node"],
        ),
        block_in_peak_hours=True,
    ),
}


def build_claude_tools() -> list[dict]:
    return [
        {
            "name": td.name,
            "description": td.description,
            "input_schema": td.input_schema,
        }
        for td in TOOL_REGISTRY.values()
    ]


def build_tools_for_skill(skill: AnalysisSkill) -> list[dict]:
    """Return only tools allowed by the skill config."""
    allowed = set(skill.required_tools) | set(skill.optional_tools)
    return [
        {
            "name": td.name,
            "description": td.description,
            "input_schema": td.input_schema,
        }
        for td in TOOL_REGISTRY.values()
        if td.name in allowed
    ]
