"""
scan_queries.py — SQL templates cho scan job (read-only, chạy trên PRIMARY).

Placeholder {min_page_count}, {min_frag_pct}... được format bằng GIÁ TRỊ SỐ
từ default policy (int/float) — không có injection path từ string user.

Dùng 'SAMPLED' mode (khớp topic index_fragmentation có sẵn) — 'DETAILED'
quá nặng cho scan toàn DB. Scan timeout dài (300s) vì dm_db_index_physical_stats
đọc nhiều page; chạy qua QueryExecutor với timeout riêng, KHÔNG phải maint_connection.
"""
from __future__ import annotations

SCAN_TIMEOUT_SEC = 300

# Q1 — Index fragmentation, per-partition (DMV trả 1 row/partition).
# Wide-net theo default policy; refine per-object bằng policy override ở Python.
FRAGMENTATION_SQL = """
SELECT DB_NAME() AS database_name, s.name AS schema_name,
  o.name AS table_name, i.name AS index_name,
  ips.object_id, ips.index_id, ips.partition_number, ips.index_type_desc,
  CAST(ips.avg_fragmentation_in_percent AS DECIMAL(5,2)) AS fragmentation_pct,
  ips.page_count, ips.record_count,
  CASE WHEN EXISTS (SELECT 1 FROM sys.partitions p
       WHERE p.object_id = ips.object_id AND p.index_id = ips.index_id
         AND p.partition_number > 1)
       THEN 1 ELSE 0 END AS is_partitioned
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'SAMPLED') ips
JOIN sys.indexes i  ON ips.object_id = i.object_id AND ips.index_id = i.index_id
JOIN sys.objects o  ON ips.object_id = o.object_id
JOIN sys.schemas s  ON o.schema_id = s.schema_id
WHERE ips.page_count > {min_page_count}
  AND ips.avg_fragmentation_in_percent >= {min_frag_pct}
  AND ips.index_type_desc IN ('CLUSTERED INDEX', 'NONCLUSTERED INDEX')
  AND o.is_ms_shipped = 0
ORDER BY ips.avg_fragmentation_in_percent DESC
"""

# Q2 — Statistics staleness theo modification_counter.
STATS_STALENESS_SQL = """
SELECT DB_NAME() AS database_name, sch.name AS schema_name, o.name AS table_name,
  st.name AS stats_name, st.object_id, st.stats_id,
  sp.last_updated, sp.rows, sp.rows_sampled, sp.modification_counter,
  DATEDIFF(HOUR, sp.last_updated, GETUTCDATE()) AS hours_since_update
FROM sys.stats st
JOIN sys.objects o  ON st.object_id = o.object_id
JOIN sys.schemas sch ON o.schema_id = sch.schema_id
CROSS APPLY sys.dm_db_stats_properties(st.object_id, st.stats_id) sp
WHERE o.is_ms_shipped = 0 AND o.type = 'U'
  AND sp.modification_counter >= {mod_threshold}
ORDER BY sp.modification_counter DESC
"""

# Q3 — Heap forwarded records (index_id = 0).
HEAP_FORWARDED_SQL = """
SELECT DB_NAME() AS database_name, s.name AS schema_name,
  o.name AS table_name, ips.object_id, ips.partition_number,
  ips.forwarded_record_count, ips.record_count, ips.page_count,
  CASE WHEN EXISTS (SELECT 1 FROM sys.partitions p
       WHERE p.object_id = ips.object_id AND p.index_id = 0
         AND p.partition_number > 1)
       THEN 1 ELSE 0 END AS is_partitioned
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, 0, NULL, 'SAMPLED') ips
JOIN sys.objects o  ON ips.object_id = o.object_id
JOIN sys.schemas s  ON o.schema_id = s.schema_id
WHERE ips.index_id = 0
  AND ips.forwarded_record_count >= {fwd_threshold}
  AND o.is_ms_shipped = 0
ORDER BY ips.forwarded_record_count DESC
"""
