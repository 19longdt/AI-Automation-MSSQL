DECLARE @TableNames TABLE (TableName NVARCHAR(128))

INSERT INTO @TableNames VALUES
  ('product'),('product_product_unit'),
  ('product_unit'),('product_group'),('batch'),('warehouse'),('inventory'),
  ('bill'),('bill_product'),('invoice'),('invoice_product'),
  ('rs_inoutward'),('rs_inoutward_detail'),('mc_payment'),('mc_receipt'),
  ('customer'),('payment_history'),('debt')

-- 1. Row count + size
SELECT SCHEMA_NAME(t.schema_id) AS [Schema], t.name, SUM(p.rows) AS total_rows,
    SUM(a.total_pages)*8/1024 AS size_mb,
    COUNT(DISTINCT p.partition_number) AS partitions
FROM sys.tables t
JOIN sys.indexes i ON t.object_id=i.object_id AND i.index_id IN(0,1)
JOIN sys.partitions p ON i.object_id=p.object_id AND i.index_id=p.index_id
JOIN sys.allocation_units a ON p.partition_id=a.container_id
WHERE t.name IN (select * from @TableNames)
GROUP BY t.name, t.schema_id ORDER BY [Schema], total_rows DESC;

-- 2. Resource Governor
SELECT p.name AS pool, p.min_cpu_percent, p.max_cpu_percent,
    p.min_memory_percent, p.max_memory_percent, wg.name AS workload_group
FROM sys.resource_governor_resource_pools p
JOIN sys.resource_governor_workload_groups wg ON p.pool_id=wg.pool_id
ORDER BY p.name;

-- 3. AG topology
SELECT ar.replica_server_name, ar.availability_mode_desc,
    ar.secondary_role_allow_connections_desc, ars.role_desc
FROM sys.availability_replicas ar
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id=ars.replica_id
ORDER BY ars.role_desc;

-- 4. CDC tables
SELECT OBJECT_NAME(source_object_id) AS table_name, capture_instance
FROM cdc.change_tables ORDER BY table_name;


-- ============================================================================
-- Get Indexes, Keys, Constraints for specified tables (with Schema info)
-- ============================================================================

DECLARE @TableNames TABLE (TableName NVARCHAR(128))

INSERT INTO @TableNames VALUES
  ('product'),('product_product_unit'),
  ('product_unit'),('product_group'),('batch'),('warehouse'),('inventory'),
  ('bill'),('bill_product'),('invoice'),('invoice_product'),
  ('rs_inoutward'),('rs_inoutward_detail'),('mc_payment'),('mc_receipt'),
  ('customer'),('payment_history'),('debt')

-- ============================================================================
-- 1. INDEXES (with Schema)
-- ============================================================================
SELECT
  SCHEMA_NAME(t.schema_id) AS [Schema],
  t.name AS [TableName],
  i.name AS [IndexName],
  i.type_desc AS [IndexType],
  CASE WHEN i.is_primary_key = 1 THEN 'PRIMARY'
       WHEN i.is_unique = 1 THEN 'UNIQUE'
       ELSE 'NON-UNIQUE' END AS [Uniqueness],
  STRING_AGG(c.name, ', ') AS [Columns],
  i.is_primary_key AS [IsPrimaryKey],
  i.is_unique AS [IsUnique],
  i.fill_factor AS [FillFactor],
  ps.name AS [PartitionScheme]
FROM sys.indexes i
INNER JOIN sys.tables t ON i.object_id = t.object_id
INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
LEFT JOIN sys.partition_schemes ps ON i.data_space_id = ps.data_space_id
INNER JOIN @TableNames tn ON t.name = tn.TableName
WHERE i.name IS NOT NULL  -- exclude heaps
GROUP BY SCHEMA_NAME(t.schema_id), t.name, i.name, i.type_desc, i.is_primary_key, i.is_unique, i.fill_factor, ps.name
ORDER BY [Schema], t.name, i.is_primary_key DESC, i.name

