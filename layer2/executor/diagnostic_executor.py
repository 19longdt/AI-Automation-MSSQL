"""
diagnostic_executor.py — Pre-written SQL templates cho 15 DMV tools.

Claude gọi tool_name + params → tool_executor → dispatch tới phương thức tương ứng ở đây.
Mọi SQL phải có TOP N hoặc WHERE thời gian — không query DMV không có giới hạn.

Thread safety: mỗi method tạo connection mới qua mssql_connection() — không cache.
Sanitize: Decimal → float, datetime → str, bytes → hex string để JSON-serializable.
"""
from __future__ import annotations

import decimal
import logging
import time
from datetime import datetime
from typing import Any

from ..storage.mongo_client import MongoConnection
from ..utils.time_utils import now_vn
from .mssql_connection import mssql_connection

logger = logging.getLogger(__name__)


# ── Row sanitization ────────────────────────────────────────────────────────────

def _sanitize(v: object) -> object:
    """Convert pyodbc/SQL Server types sang JSON-serializable Python types."""
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, bytes):
        return "0x" + v.hex().upper()
    return v


def _rows(cursor: Any) -> list[dict[str, Any]]:
    cols = [c[0] for c in cursor.description] if cursor.description else []
    return [{col: _sanitize(val) for col, val in zip(cols, row)} for row in cursor.fetchall()]


def _hex_to_bytes(query_hash: str) -> bytes:
    """Convert '0xABCD...' hoặc 'ABCD...' sang bytes. Dùng cho binary(8) comparison."""
    return bytes.fromhex(query_hash.lstrip("0x").lstrip("0X"))


# ── DiagnosticExecutor ──────────────────────────────────────────────────────────

class DiagnosticExecutor:
    """Thực thi pre-written SQL templates theo tool name và validated params."""

    # ── Query stats ─────────────────────────────────────────────────────────────

    def get_query_stats(
        self, node: str, query_hash: str, top_n: int = 10
    ) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            CONVERT(VARCHAR(20), qs.plan_handle, 1) AS plan_handle_hex,
            qs.execution_count,
            qs.total_elapsed_time / 1000.0 / qs.execution_count AS avg_elapsed_ms,
            qs.total_logical_reads / qs.execution_count         AS avg_logical_reads,
            qs.total_physical_reads / qs.execution_count        AS avg_physical_reads,
            qs.total_worker_time / 1000.0 / qs.execution_count  AS avg_cpu_ms,
            qs.total_spills,
            qs.total_spills / qs.execution_count                AS avg_spills,
            qs.creation_time                                     AS plan_creation_time,
            qs.last_execution_time
        FROM sys.dm_exec_query_stats qs
        WHERE qs.query_hash = ?
        ORDER BY avg_elapsed_ms DESC
        """
        return self._run(node, sql, (top_n, _hex_to_bytes(query_hash)))

    # ── Query Store ──────────────────────────────────────────────────────────────

    def get_query_store_history(
        self, node: str, query_hash: str, days_back: int = 7, top_n: int = 20
    ) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            qsq.query_id,
            qsp.plan_id,
            qsp.is_forced_plan,
            qsrs.avg_duration / 1000.0      AS avg_duration_ms,
            qsrs.avg_logical_io_reads,
            qsrs.avg_cpu_time / 1000.0      AS avg_cpu_ms,
            qsrs.count_executions,
            qsrs.first_execution_time,
            qsrs.last_execution_time,
            CONVERT(VARCHAR(20), qsp.query_plan_hash, 1) AS plan_hash_hex
        FROM sys.query_store_query qsq
        JOIN sys.query_store_plan qsp
          ON qsq.query_id = qsp.query_id
        JOIN sys.query_store_runtime_stats qsrs
          ON qsp.plan_id = qsrs.plan_id
        WHERE qsq.query_hash = ?
          AND qsrs.last_execution_time >= DATEADD(day, -?, GETDATE())
        ORDER BY qsrs.last_execution_time DESC
        """
        return self._run(node, sql, (top_n, _hex_to_bytes(query_hash), days_back))

    # ── Statistics ───────────────────────────────────────────────────────────────

    def get_statistics_info(
        self, node: str, table_name: str, top_n: int = 50
    ) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            OBJECT_NAME(s.object_id)  AS table_name,
            s.name                    AS stat_name,
            s.has_filter,
            sp.last_updated,
            sp.rows,
            sp.rows_sampled,
            CAST(sp.rows_sampled * 100.0 / NULLIF(sp.rows, 0) AS DECIMAL(5,2)) AS sample_pct,
            sp.modification_counter,
            sp.is_incremental
        FROM sys.stats s
        CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
        WHERE OBJECT_NAME(s.object_id) = ?
          AND sp.last_updated IS NOT NULL
        ORDER BY sp.last_updated ASC
        """
        return self._run(node, sql, (top_n, table_name))

    # ── Memory grant ─────────────────────────────────────────────────────────────

    def get_memory_grant(self, node: str, top_n: int = 20) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            session_id,
            request_id,
            dop,
            request_time,
            grant_time,
            requested_memory_kb,
            granted_memory_kb,
            used_memory_kb,
            max_used_memory_kb,
            query_cost
        FROM sys.dm_exec_query_memory_grants
        WHERE session_id > 50
        ORDER BY granted_memory_kb DESC
        """
        return self._run(node, sql, (top_n,))

    # ── Blocking chain ───────────────────────────────────────────────────────────

    def get_blocking_chain(self, node: str, top_n: int = 30) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            r.session_id,
            r.blocking_session_id,
            r.wait_type,
            r.wait_time / 1000.0    AS wait_sec,
            r.status,
            r.command,
            DB_NAME(r.database_id) AS database_name,
            SUBSTRING(st.text,
                (r.statement_start_offset / 2) + 1,
                ((CASE r.statement_end_offset
                    WHEN -1 THEN DATALENGTH(st.text)
                    ELSE r.statement_end_offset
                  END - r.statement_start_offset) / 2) + 1
            )                       AS current_statement,
            r.cpu_time,
            r.total_elapsed_time / 1000 AS elapsed_sec
        FROM sys.dm_exec_requests r
        CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
        WHERE r.blocking_session_id > 0
           OR r.session_id IN (
               SELECT DISTINCT blocking_session_id
               FROM sys.dm_exec_requests
               WHERE blocking_session_id > 0
           )
        ORDER BY r.blocking_session_id, r.session_id
        """
        return self._run(node, sql, (top_n,))

    # ── Wait stats ───────────────────────────────────────────────────────────────

    def get_wait_stats(self, node: str, top_n: int = 20) -> list[dict[str, Any]]:
        # Lọc bỏ SQL Server internal idle waits không liên quan đến workload thực
        sql = """
        SELECT TOP (?)
            wait_type,
            waiting_tasks_count,
            wait_time_ms,
            max_wait_time_ms,
            signal_wait_time_ms,
            CAST(wait_time_ms * 100.0 / NULLIF(SUM(wait_time_ms) OVER(), 0) AS DECIMAL(5,2)) AS pct_total
        FROM sys.dm_os_wait_stats
        WHERE wait_type NOT IN (
            'SLEEP_TASK','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_AUTO_EVENT',
            'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT',
            'HADR_FILESTREAM_IOMGR_IOCOMPLETION','HADR_WORK_QUEUE',
            'HADR_CLUSAPI_CALL','HADR_NOTIFICATION_DEQUEUE','HADR_TIMER_TASK',
            'ONDEMAND_TASK_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE',
            'SERVER_IDLE_CHECK','SLEEP_DBSTARTUP','SLEEP_DBTASK',
            'SLEEP_MASTERDBREADY','SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED',
            'SLEEP_MSDBSTARTUP','SLEEP_SYSTEMTASK','SLEEP_TEMPDBSTARTUP',
            'SNI_HTTP_ACCEPT','SP_SERVER_DIAGNOSTICS_SLEEP','SQLTRACE_BUFFER_FLUSH',
            'SQLTRACE_INCREMENTAL_FLUSH_SLEEP','WAITFOR','XE_DISPATCHER_WAIT',
            'XE_TIMER_EVENT','BROKER_EVENTHANDLER','CHECKPOINT_QUEUE',
            'DBMIRROR_EVENTS_QUEUE','SQLTRACE_WAIT_ENTRIES',
            'WAIT_XTP_OFFLINE_CKPT_NEW_LOG'
        )
          AND waiting_tasks_count > 0
        ORDER BY wait_time_ms DESC
        """
        return self._run(node, sql, (top_n,))

    # ── Index usage ──────────────────────────────────────────────────────────────

    def get_index_usage(
        self, node: str, table_name: str, top_n: int = 50
    ) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            OBJECT_NAME(i.object_id)  AS table_name,
            i.name                    AS index_name,
            i.type_desc,
            COALESCE(ius.user_seeks, 0)   AS user_seeks,
            COALESCE(ius.user_scans, 0)   AS user_scans,
            COALESCE(ius.user_lookups, 0) AS user_lookups,
            COALESCE(ius.user_updates, 0) AS user_updates,
            ius.last_user_seek,
            ius.last_user_scan,
            ius.last_user_lookup,
            ius.last_user_update
        FROM sys.indexes i
        LEFT JOIN sys.dm_db_index_usage_stats ius
          ON i.object_id  = ius.object_id
         AND i.index_id   = ius.index_id
         AND ius.database_id = DB_ID()
        WHERE OBJECT_NAME(i.object_id) = ?
          AND i.type > 0
        ORDER BY user_seeks + user_scans DESC
        """
        return self._run(node, sql, (top_n, table_name))

    # ── Missing indexes ───────────────────────────────────────────────────────────

    def get_missing_indexes(
        self, node: str, table_name: str | None = None, top_n: int = 20
    ) -> list[dict[str, Any]]:
        table_filter = "AND OBJECT_NAME(mid.object_id, mid.database_id) = ?" if table_name else ""
        sql = f"""
        SELECT TOP (?)
            OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
            mid.equality_columns,
            mid.inequality_columns,
            mid.included_columns,
            migs.unique_compiles,
            migs.user_seeks,
            migs.user_scans,
            migs.avg_total_user_cost,
            migs.avg_user_impact,
            ROUND(
                migs.avg_total_user_cost * migs.avg_user_impact
                * (migs.user_seeks + migs.user_scans), 0
            ) AS estimated_benefit
        FROM sys.dm_db_missing_index_details mid
        JOIN sys.dm_db_missing_index_groups mig
          ON mid.index_handle = mig.index_handle
        JOIN sys.dm_db_missing_index_group_stats migs
          ON mig.index_group_handle = migs.group_handle
        WHERE mid.database_id = DB_ID()
          {table_filter}
        ORDER BY estimated_benefit DESC
        """
        params: tuple = (top_n, table_name) if table_name else (top_n,)
        return self._run(node, sql, params)

    # ── TempDB usage ─────────────────────────────────────────────────────────────

    def get_tempdb_usage(self, node: str, top_n: int = 20) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            session_id,
            user_objects_alloc_page_count     * 8 / 1024.0 AS user_obj_mb,
            internal_objects_alloc_page_count * 8 / 1024.0 AS internal_obj_mb,
            (user_objects_alloc_page_count
             + internal_objects_alloc_page_count) * 8 / 1024.0 AS total_mb
        FROM sys.dm_db_session_space_usage
        WHERE session_id > 50
          AND (user_objects_alloc_page_count + internal_objects_alloc_page_count) > 0
        ORDER BY total_mb DESC
        """
        return self._run(node, sql, (top_n,))

    # ── AG status ────────────────────────────────────────────────────────────────

    def get_ag_status(self, node: str) -> list[dict[str, Any]]:
        sql = """
        SELECT
            ag.name                              AS ag_name,
            ar.replica_server_name,
            ars.role_desc,
            ars.synchronization_health_desc,
            ars.connected_state_desc,
            adbrs.synchronization_state_desc,
            adbrs.log_send_queue_size,
            adbrs.log_send_rate,
            adbrs.redo_queue_size,
            adbrs.redo_rate
        FROM sys.availability_groups ag
        JOIN sys.availability_replicas ar
          ON ag.group_id = ar.group_id
        JOIN sys.dm_hadr_availability_replica_states ars
          ON ar.replica_id = ars.replica_id
        LEFT JOIN sys.dm_hadr_database_replica_states adbrs
          ON ar.replica_id = adbrs.replica_id
        ORDER BY ag.name, ar.replica_server_name
        """
        return self._run(node, sql, ())

    # ── Memory pressure ──────────────────────────────────────────────────────────

    def get_memory_pressure(self, node: str) -> dict[str, Any]:
        """Trả về dict với 2 keys: counters (PLE, target/total) và top_clerks."""
        sql_counters = """
        SELECT counter_name, cntr_value
        FROM sys.dm_os_performance_counters
        WHERE object_name LIKE '%Memory Manager%'
          AND counter_name IN (
              'Total Server Memory (KB)',
              'Target Server Memory (KB)',
              'Free Memory (KB)',
              'Stolen Server Memory (KB)',
              'Page life expectancy'
          )
        """
        sql_clerks = """
        SELECT TOP 10
            type      AS clerk_type,
            SUM(pages_kb) / 1024.0 AS used_mb
        FROM sys.dm_os_memory_clerks
        GROUP BY type
        ORDER BY used_mb DESC
        """
        counters = self._run(node, sql_counters, ())
        clerks = self._run(node, sql_clerks, ())
        return {"counters": counters, "top_clerks": clerks}

    # ── Resource Governor ─────────────────────────────────────────────────────────

    def get_resource_governor_stats(self, node: str) -> list[dict[str, Any]]:
        sql = """
        SELECT
            rp.name                         AS pool_name,
            rp.max_cpu_percent,
            rp.max_memory_percent,
            rs.total_cpu_usage_ms,
            rs.cache_memory_kb   / 1024.0   AS cache_memory_mb,
            rs.compile_memory_kb / 1024.0   AS compile_memory_mb,
            rs.used_memgrant_kb  / 1024.0   AS used_memgrant_mb,
            rs.total_memgrant_count,
            rs.active_request_count
        FROM sys.resource_governor_resource_pools rp
        JOIN sys.dm_resource_governor_resource_pools rs
          ON rp.pool_id = rs.pool_id
        ORDER BY rs.total_cpu_usage_ms DESC
        """
        return self._run(node, sql, ())

    # ── CDC status ───────────────────────────────────────────────────────────────

    def get_cdc_status(self, node: str, top_n: int = 10) -> list[dict[str, Any]]:
        sql = """
        SELECT TOP (?)
            session_id,
            start_time,
            end_time,
            duration,
            scan_phase,
            error_count,
            tran_count,
            command_count,
            status
        FROM sys.dm_cdc_log_scan_sessions
        ORDER BY start_time DESC
        """
        return self._run(node, sql, (top_n,))

    # ── Recent findings (MongoDB) ─────────────────────────────────────────────────

    def get_recent_findings(
        self,
        node: str | None = None,
        issue_type: str | None = None,
        hours_back: int = 24,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Query MongoDB findings collection — không query MSSQL."""
        since = now_vn()
        from datetime import timedelta
        since = since - timedelta(hours=hours_back)

        query: dict[str, Any] = {"detected_at": {"$gte": since}}
        if node:
            query["node"] = node
        if issue_type:
            query["issue_type"] = issue_type

        col = MongoConnection.get_db()["findings"]
        docs = col.find(
            query,
            projection={"_id": 0, "finding_id": 1, "issue_type": 1, "severity": 1,
                        "node": 1, "detected_at": 1, "metrics": 1, "status": 1},
            sort=[("detected_at", -1)],
            limit=limit,
        )
        result = []
        for doc in docs:
            # datetime → str để JSON-serializable
            if isinstance(doc.get("detected_at"), datetime):
                doc["detected_at"] = doc["detected_at"].isoformat()
            result.append(doc)
        return result

    # ── Index fragmentation ───────────────────────────────────────────────────────

    def get_index_fragmentation(
        self, node: str, table_name: str, top_n: int = 30
    ) -> list[dict[str, Any]]:
        # SAMPLED mode: nhanh hơn DETAILED nhưng vẫn đủ chính xác cho quyết định rebuild/reorganize
        sql = """
        SELECT TOP (?)
            OBJECT_NAME(ips.object_id)  AS table_name,
            i.name                      AS index_name,
            ips.partition_number,
            ips.index_type_desc,
            ips.avg_fragmentation_in_percent,
            ips.fragment_count,
            ips.page_count,
            i.fill_factor
        FROM sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID(?), NULL, NULL, 'SAMPLED') ips
        JOIN sys.indexes i
          ON ips.object_id = i.object_id AND ips.index_id = i.index_id
        WHERE ips.avg_fragmentation_in_percent > 5
          AND ips.page_count > 100
        ORDER BY ips.avg_fragmentation_in_percent DESC
        """
        return self._run(node, sql, (top_n, table_name))

    # ── Internal helper ───────────────────────────────────────────────────────────

    def _run(
        self, node: str, sql: str, params: tuple
    ) -> list[dict[str, Any]]:
        """Execute SQL trên node, trả về list of rows. Raise exception nếu lỗi."""
        start = time.monotonic()
        with mssql_connection(node) as conn:
            cursor = conn.execute(sql, params)
            result = _rows(cursor)
        duration_ms = (time.monotonic() - start) * 1000
        logger.debug("DiagnosticExecutor: node=%s rows=%d duration_ms=%.1f", node, len(result), duration_ms)
        return result
