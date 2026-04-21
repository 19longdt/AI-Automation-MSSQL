-- ============================================================================
-- FILE: 02_check_memory.sql
-- MUC DICH: Giam sat Memory cua SQL Server 2019 Enterprise
-- THOI DIEM CHAY: Khi nghi ngo memory pressure, query cham, hoac dinh ky
-- ============================================================================

-- ============================================================================
-- 1. TONG QUAN MEMORY CUA SQL SERVER
-- ============================================================================
-- MUC DICH: Xem SQL Server dang su dung bao nhieu RAM, gioi han nhu the nao
--
-- CAC COT QUAN TRONG:
--   sql_server_memory_mb       : RAM thuc te SQL Server dang su dung
--   target_memory_mb           : RAM ma SQL Server muon su dung (dua tren workload)
--   max_server_memory_mb       : Gioi han cau hinh (sp_configure 'max server memory')
--
-- NGUONG VA PHAN TICH:
--   sql_server_memory = target_memory : Binh thuong, SQL dang dung du RAM can
--   sql_server_memory < target_memory : Internal memory pressure - SQL muon nhieu hon nhung khong lay duoc
--   target_memory < max_server_memory : External memory pressure - OS dang yen cau SQL tra lai RAM
--
-- LUU Y:
--   - SQL Server 2019 Enterprise co Memory-Optimized TempDB (xem rieng)
--   - Nen de max server memory = Total RAM - 4GB (cho OS) - RAM cho cac service khac
--   - Tren may 64GB RAM: max server memory nen ~ 54-56GB
-- ============================================================================

SELECT
    physical_memory_in_use_kb / 1024           AS sql_server_memory_mb,
    locked_page_allocations_kb / 1024          AS locked_pages_mb,
    total_virtual_address_space_kb / 1024      AS virtual_address_space_mb,
    virtual_address_space_committed_kb / 1024  AS committed_mb,
    memory_utilization_percentage              AS memory_util_pct,
    available_commit_limit_kb / 1024           AS available_commit_limit_mb,
    process_physical_memory_low                AS is_physical_memory_low,
    process_virtual_memory_low                 AS is_virtual_memory_low
FROM sys.dm_os_process_memory;

-- Target vs Committed memory
SELECT
    cntr_value / 1024 AS value_mb,
    counter_name
FROM sys.dm_os_performance_counters
WHERE counter_name IN (
    'Target Server Memory (KB)',
    'Total Server Memory (KB)',
    'Database Cache Memory (KB)',
    'Free Memory (KB)',
    'Stolen Server Memory (KB)',
    'Connection Memory (KB)',
    'Lock Memory (KB)',
    'SQL Cache Memory (KB)',
    'Optimizer Memory (KB)',
    'Granted Workspace Memory (KB)'
)
ORDER BY cntr_value DESC;


-- ============================================================================
-- 2. BUFFER POOL USAGE THEO DATABASE
-- ============================================================================
-- MUC DICH: Xem database nao dang chiem nhieu buffer pool (RAM) nhat
--           Giup quyet dinh database nao can toi uu index/query
--
-- CAC COT QUAN TRONG:
--   cached_pages       : So page (8KB) dang nam trong RAM
--   cached_size_mb     : Quy doi ra MB
--   dirty_pages        : So page da thay doi nhung chua ghi xuong disk (lazy writer se ghi)
--
-- NGUONG:
--   1 database chiem > 70% buffer pool : Kiem tra co query scan lon khong
--   dirty_pages > 20% tong pages       : Disk write cham, kiem tra I/O
--
-- LUU Y:
--   - Query nay scan toan bo buffer pool, co the mat vai giay tren server lon
--   - Ket qua thay doi lien tuc vi SQL Server lien tuc doc/evict page
-- ============================================================================

SELECT
    DB_NAME(database_id)          AS database_name,
    COUNT(*)                      AS cached_pages,
    COUNT(*) * 8 / 1024          AS cached_size_mb,
    SUM(CASE WHEN is_modified = 1 THEN 1 ELSE 0 END) AS dirty_pages,
    SUM(CASE WHEN is_modified = 1 THEN 1 ELSE 0 END) * 8 / 1024 AS dirty_mb
FROM sys.dm_os_buffer_descriptors
GROUP BY database_id
ORDER BY cached_pages DESC;


-- ============================================================================
-- 3. PAGE LIFE EXPECTANCY (PLE)
-- ============================================================================
-- MUC DICH: Chi so quan trong nhat de danh gia memory pressure
--           PLE = thoi gian trung binh 1 page ton tai trong buffer pool truoc khi bi evict
--
-- NGUONG (cho server 64GB+ RAM):
--   PLE > 1000s   : Tot, du RAM
--   PLE 300-1000s : Canh bao, co the thieu RAM hoac co query scan lon
--   PLE < 300s    : NGUY HIEM - Memory pressure nghiem trong
--                   Query phai doc tu disk nhieu → performance te
--
-- CONG THUC NGUONG DE XUAT:
--   PLE toi thieu = (Max Server Memory GB / 4) * 300
--   Vi du: 64GB RAM → PLE toi thieu = 16 * 300 = 4800s
--
-- NEU PLE THAP:
--   1. Kiem tra co query scan lon (logical_reads cao) → them index
--   2. Kiem tra co nhieu ad-hoc query → bat 'optimize for ad hoc workloads'
--   3. Kiem tra max server memory co du chua
--   4. Tang RAM neu da toi uu het query
-- ============================================================================

SELECT
    [object_name],
    instance_name,
    cntr_value AS page_life_expectancy_seconds,
    CASE
        WHEN cntr_value < 300  THEN '!! NGUY HIEM - Memory pressure nghiem trong'
        WHEN cntr_value < 1000 THEN '! CANH BAO - Theo doi va kiem tra query scan'
        ELSE 'OK'
    END AS trang_thai
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND [object_name] LIKE '%Buffer Manager%';

-- PLE theo tung NUMA node (quan trong tren server nhieu CPU)
SELECT
    [object_name],
    instance_name                    AS numa_node,
    cntr_value                       AS ple_seconds
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND [object_name] LIKE '%Buffer Node%';


-- ============================================================================
-- 4. MEMORY GRANTS (Query Memory)
-- ============================================================================
-- MUC DICH: Xem cac query dang doi cap phat memory de chay (Sort, Hash Join, etc.)
--           Query can nhieu memory se xep hang cho → cham
--
-- CAC COT QUAN TRONG:
--   requested_memory_kb  : Memory query yeu cau
--   granted_memory_kb    : Memory thuc te duoc cap (co the < requested)
--   used_memory_kb       : Memory thuc te dang dung
--   is_next_candidate    : Co phai la query ke tiep duoc cap memory khong
--   wait_time_ms         : Thoi gian doi memory grant (>0 = dang xep hang)
--
-- NGUONG:
--   wait_time_ms > 0     : Co query dang cho memory → memory pressure
--   granted < requested  : SQL Server khong du memory de cap
--   query_cost > 10      : Query nang, optimizer uoc tinh chi phi cao
--
-- ACTION:
--   1. Xem query co grant lon → co the do sai estimated rows → update statistics
--   2. Nhieu query cho memory → tang 'max server memory' hoac toi uu query
--   3. granted >> used : Query xin du memory nhung dung it → sai estimate
-- ============================================================================

SELECT
    session_id,
    request_id,
    scheduler_id,
    dop,
    request_time,
    grant_time,
    requested_memory_kb,
    granted_memory_kb,
    required_memory_kb,
    used_memory_kb,
    max_used_memory_kb,
    query_cost,
    timeout_sec,
    wait_time_ms,
    is_next_candidate,
    wait_order,
    CASE
        WHEN granted_memory_kb IS NULL THEN '!! DANG CHO MEMORY GRANT'
        WHEN used_memory_kb > granted_memory_kb * 0.9 THEN '! Gan het memory grant'
        ELSE 'OK'
    END AS trang_thai,
    t.text AS sql_text
FROM sys.dm_exec_query_memory_grants mg
    CROSS APPLY sys.dm_exec_sql_text(mg.sql_handle) t
ORDER BY wait_time_ms DESC, requested_memory_kb DESC;


-- ============================================================================
-- 5. MEMORY CLERKS - Ai dang dung memory?
-- ============================================================================
-- MUC DICH: Phan tich chi tiet memory duoc su dung cho muc dich gi
--
-- CAC CLERK QUAN TRONG:
--   MEMORYCLERK_SQLBUFFERPOOL     : Buffer pool (cache data pages) - thuong lon nhat
--   MEMORYCLERK_SQLQUERYPLAN      : Plan cache
--   CACHESTORE_SQLCP              : SQL Plans (compiled plans)
--   CACHESTORE_OBJCP              : Object Plans (stored procedures)
--   MEMORYCLERK_SQLOPTIMIZER      : Query optimizer
--   OBJECTSTORE_LOCK_MANAGER      : Lock manager
--
-- NGUONG:
--   SQLQUERYPLAN > 10GB           : Qua nhieu plan cache → bat 'optimize for ad hoc workloads'
--   LOCK_MANAGER > 1GB            : Nhieu lock → kiem tra blocking
-- ============================================================================

SELECT TOP 20
    type                                    AS clerk_type,
    SUM(pages_kb) / 1024                    AS allocated_mb,
    SUM(virtual_memory_committed_kb) / 1024 AS vm_committed_mb
FROM sys.dm_os_memory_clerks
GROUP BY type
ORDER BY SUM(pages_kb) DESC;


-- ============================================================================
-- 6. KIEM TRA CAU HINH MEMORY
-- ============================================================================
-- ACTION CHECKLIST:
--   [ ] max server memory da set chua? (khong nen de default 2147483647)
--   [ ] Lock Pages in Memory da bat chua? (quan trong cho Enterprise)
--   [ ] optimize for ad hoc workloads = 1? (giam plan cache bloat)
-- ============================================================================

SELECT
    name,
    value_in_use,
    CASE name
        WHEN 'max server memory (MB)' THEN
            CASE WHEN CAST(value_in_use AS BIGINT) > 2000000
                THEN '!! CHUA SET - Dang de default, rat nguy hiem!'
                ELSE 'Da set = ' + CAST(value_in_use AS VARCHAR(20)) + ' MB'
            END
        WHEN 'min server memory (MB)' THEN
            'Nen set = 25-50% cua max server memory'
        WHEN 'optimize for ad hoc workloads' THEN
            CASE WHEN value_in_use = 0
                THEN '! Nen bat len 1 de giam plan cache bloat'
                ELSE 'OK - Da bat'
            END
        ELSE ''
    END AS khuyen_nghi
FROM sys.configurations
WHERE name IN (
    'max server memory (MB)',
    'min server memory (MB)',
    'optimize for ad hoc workloads'
);
