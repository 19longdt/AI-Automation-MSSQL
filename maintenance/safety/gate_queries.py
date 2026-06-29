"""
gate_queries.py — Safety gate SQL (nhanh, read-only, timeout ngắn).

Chạy TRƯỚC mỗi action để chắc chắn hệ thống đang rảnh —
đây chính là cơ chế tránh lặp lại sự cố các Agent job cũ gây quá tải.
"""
from __future__ import annotations

GATE_TIMEOUT_SEC = 10

# CPU % của SQL process từ ring buffer (record mới nhất).
CPU_SQL = """
SELECT TOP 1
  record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]','int') AS sql_cpu_pct,
  record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]','int') AS system_idle_pct
FROM (
  SELECT [timestamp], CONVERT(XML, record) AS record
  FROM sys.dm_os_ring_buffers
  WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
    AND record LIKE '%<SystemHealth>%'
) AS x
ORDER BY [timestamp] DESC
"""

# Số request user đang active (loại trừ chính session gate).
ACTIVE_LOAD_SQL = """
SELECT
  (SELECT COUNT(*) FROM sys.dm_exec_requests
     WHERE session_id <> @@SPID
       AND session_id > 50
       AND status IN ('running', 'runnable', 'suspended')) AS active_requests
"""

# AG queue sizes của các secondary (is_local=0, nhìn từ primary).
AG_QUEUE_SQL = """
SELECT ar.replica_server_name,
       drs.synchronization_state_desc,
       ISNULL(drs.log_send_queue_size, 0) AS log_send_queue_size,
       ISNULL(drs.redo_queue_size, 0) AS redo_queue_size
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id
WHERE drs.is_local = 0
"""
