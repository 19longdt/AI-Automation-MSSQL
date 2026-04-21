"""
tool_registry.py — Whitelist tools Claude được phép gọi + Claude tool definitions.

Claude KHÔNG gửi SQL. Claude gửi tool_name + params → tool_executor dispatch
sang pre-written SQL template trong diagnostic_executor.py.

ToolDefinition.block_in_peak_hours=True → tool_executor skip trong 8:00–18:00 VN,
trả error result để Claude biết và tiếp tục với tool khác.

15 tools theo layer2-agent.md. get_query_plan bị loại (query_plan_xml đã có trong finding).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict
    block_in_peak_hours: bool = False


# ── Helpers để build input_schema gọn hơn ─────────────────────────────────────

def _schema(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": properties, "required": required}

_NODE = {"type": "string", "description": "Hostname của MSSQL node cần query (phải có trong AG cluster)"}
_TOP_N = {"type": "integer", "description": "Số rows tối đa trả về", "default": 20}
_TABLE = {"type": "string", "description": "Tên bảng (không kèm schema prefix)"}
_QUERY_HASH = {"type": "string", "description": "Query hash dạng hex, ví dụ: 0xABCD1234ABCD1234"}


# ── Tool Definitions ───────────────────────────────────────────────────────────

TOOL_REGISTRY: dict[str, ToolDefinition] = {

    "get_query_stats": ToolDefinition(
        name="get_query_stats",
        description=(
            "Lấy execution stats từ sys.dm_exec_query_stats cho 1 query hash. "
            "Group by plan_handle để phát hiện parameter sniffing (cùng hash, nhiều plan, perf khác nhau). "
            "Bao gồm: avg_elapsed_ms, avg_logical_reads, avg_spills, plan_creation_time."
        ),
        input_schema=_schema(
            {
                "query_hash": _QUERY_HASH,
                "node": _NODE,
                "top_n": {**_TOP_N, "default": 10},
            },
            required=["query_hash", "node"],
        ),
    ),

    "get_query_store_history": ToolDefinition(
        name="get_query_store_history",
        description=(
            "Lấy lịch sử execution từ Query Store theo query hash. "
            "Dùng để phát hiện plan regression: thời điểm plan thay đổi, "
            "plan nào tốt/xấu, forced plan status."
        ),
        input_schema=_schema(
            {
                "query_hash": _QUERY_HASH,
                "node": _NODE,
                "days_back": {"type": "integer", "description": "Số ngày nhìn lại", "default": 7},
                "top_n": {**_TOP_N, "default": 20},
            },
            required=["query_hash", "node"],
        ),
    ),

    "get_statistics_info": ToolDefinition(
        name="get_statistics_info",
        description=(
            "Kiểm tra độ tươi của statistics cho 1 bảng. "
            "last_updated cũ hoặc sample_pct thấp → cardinality estimate sai → bad plan. "
            "modification_counter cao → nên UPDATE STATISTICS."
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
            "Xem memory grants đang active (sys.dm_exec_query_memory_grants). "
            "requested_memory_kb >> granted_memory_kb → memory pressure. "
            "used_memory_kb << granted_memory_kb → estimate quá cao → spill risk."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),

    "get_blocking_chain": ToolDefinition(
        name="get_blocking_chain",
        description=(
            "Lấy blocking chain hiện tại từ sys.dm_exec_requests. "
            "Trả về cả blocker và blocked sessions với câu lệnh đang chạy, "
            "wait type, và thời gian chờ."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 30}},
            required=["node"],
        ),
    ),

    "get_wait_stats": ToolDefinition(
        name="get_wait_stats",
        description=(
            "Lấy top wait types từ sys.dm_os_wait_stats (đã lọc bỏ idle waits). "
            "PAGEIOLATCH → I/O bound. RESOURCE_SEMAPHORE → memory grant. "
            "LCK_M_* → blocking. CXPACKET → parallelism."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),

    "get_index_usage": ToolDefinition(
        name="get_index_usage",
        description=(
            "Xem index usage stats cho 1 bảng (sys.dm_db_index_usage_stats). "
            "user_seeks=0, user_scans cao → index không được dùng đúng hoặc full scan. "
            "user_updates cao → write overhead của index."
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
            "Lấy missing index recommendations từ sys.dm_db_missing_index_details. "
            "estimated_benefit = avg_total_user_cost × avg_user_impact × (seeks + scans). "
            "Có thể filter theo table_name để tập trung vào 1 bảng."
        ),
        input_schema=_schema(
            {
                "node": _NODE,
                "table_name": {**_TABLE, "description": "Lọc theo bảng cụ thể (để trống = tất cả)"},
                "top_n": {**_TOP_N, "default": 20},
            },
            required=["node"],
        ),
    ),

    "get_tempdb_usage": ToolDefinition(
        name="get_tempdb_usage",
        description=(
            "Xem TempDB space usage theo session (sys.dm_db_session_space_usage). "
            "user_objects = temp tables/table variables. "
            "internal_objects = sort/hash spills, version store (CDC)."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 20}},
            required=["node"],
        ),
    ),

    "get_ag_status": ToolDefinition(
        name="get_ag_status",
        description=(
            "Lấy trạng thái AG replicas: synchronization_health, connected_state, "
            "log_send_queue_size, redo_queue_size. "
            "Dùng để kiểm tra AG lag sau khi phát hiện issues trên Secondary."
        ),
        input_schema=_schema(
            {"node": _NODE},
            required=["node"],
        ),
    ),

    "get_memory_pressure": ToolDefinition(
        name="get_memory_pressure",
        description=(
            "Kiểm tra memory pressure: Page Life Expectancy (PLE), "
            "Target vs Total Server Memory, top memory clerks. "
            "PLE < 300 giây = memory pressure nghiêm trọng."
        ),
        input_schema=_schema(
            {"node": _NODE},
            required=["node"],
        ),
    ),

    "get_resource_governor_stats": ToolDefinition(
        name="get_resource_governor_stats",
        description=(
            "Xem Resource Governor pool stats: CPU usage, memory grants, "
            "active requests per pool. "
            "Dùng để kiểm tra query đang chạy trong pool nào và pool có đang bị cạn kiệt không."
        ),
        input_schema=_schema(
            {"node": _NODE},
            required=["node"],
        ),
    ),

    "get_cdc_status": ToolDefinition(
        name="get_cdc_status",
        description=(
            "Xem CDC log scan sessions (sys.dm_cdc_log_scan_sessions): "
            "scan_phase, duration, error_count, tran_count. "
            "Dùng để phát hiện CDC lag hoặc scan failure gây áp lực TempDB version store."
        ),
        input_schema=_schema(
            {"node": _NODE, "top_n": {**_TOP_N, "default": 10}},
            required=["node"],
        ),
    ),

    "get_recent_findings": ToolDefinition(
        name="get_recent_findings",
        description=(
            "Lấy findings gần đây từ MongoDB để phát hiện trend và recurring issues. "
            "Dùng để biết issue hiện tại có lặp lại không hay là lần đầu xuất hiện."
        ),
        input_schema=_schema(
            {
                "node": {**_NODE, "description": "Lọc theo node (để trống = tất cả nodes)"},
                "issue_type": {"type": "string", "description": "Lọc theo issue type (để trống = tất cả)"},
                "hours_back": {"type": "integer", "description": "Số giờ nhìn lại", "default": 24},
                "limit": {"type": "integer", "description": "Số findings tối đa", "default": 10},
            },
            required=[],
        ),
    ),

    # block_in_peak_hours=True: sys.dm_db_index_physical_stats scan toàn bộ allocation units
    # → I/O overhead đáng kể trên partitioned tables lớn (Orders 200M rows)
    "get_index_fragmentation": ToolDefinition(
        name="get_index_fragmentation",
        description=(
            "Đo fragmentation của indexes (sys.dm_db_index_physical_stats, mode SAMPLED). "
            "Kết quả: avg_fragmentation_in_percent, page_count, fill_factor. "
            "CẢNH BÁO: Tool này không khả dụng trong giờ cao điểm (8:00–18:00) "
            "do gây I/O overhead trên large tables."
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
    """
    Trả về danh sách tool definitions theo format Anthropic API.
    Dùng làm tham số `tools` khi gọi client.messages.create().
    """
    return [
        {
            "name": td.name,
            "description": td.description,
            "input_schema": td.input_schema,
        }
        for td in TOOL_REGISTRY.values()
    ]
