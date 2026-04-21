-- ============================================================================
-- FILE: 05_check_index.sql
-- MUC DICH: Giam sat Index health, Missing Index, Unused Index
-- THOI DIEM CHAY: Dinh ky hang tuan, hoac khi co query cham
-- ============================================================================

-- ============================================================================
-- 1. MISSING INDEX (Index ma SQL Server de xuat)
-- ============================================================================
-- MUC DICH: SQL Server tu dong ghi nhan khi optimizer thay 1 index se giup query nhanh hon
--           Day la nguon thong tin QUAN TRONG NHAT de toi uu query
--
-- CAC COT QUAN TRONG:
--   avg_user_impact     : % cai thien performance uoc tinh (cang cao cang tot)
--   user_seeks          : So lan query co the dung seek neu co index nay
--   user_scans          : So lan query co the dung scan
--   improvement_measure : Diem tong hop = (user_seeks + user_scans) * avg_impact
--                         Dung de sap xep uu tien tao index nao truoc
--   equality_columns    : Cot dung trong dieu kien = (nen dat dau trong index key)
--   inequality_columns  : Cot dung trong dieu kien <, >, BETWEEN (dat sau equality)
--   included_columns    : Cot chi can trong SELECT (dat trong INCLUDE, khong phai key)
--
-- NGUONG:
--   improvement_measure > 100000 : Can tao index nay
--   avg_user_impact > 90%        : Index rat hieu qua
--   user_seeks > 10000            : Query dung thuong xuyen
--
-- LUU Y TRUOC KHI TAO INDEX:
--   1. KHONG tao tat ca index SQL Server de xuat! Qua nhieu index = cham INSERT/UPDATE
--   2. Kiem tra xem co index tuong tu da ton tai chua (co the chi can them INCLUDE column)
--   3. Kiem tra kich thuoc table - table nho (< 1000 rows) khong can index
--   4. Tao index vao gio thap diem (ONLINE = ON cho Enterprise de khong block)
--   5. Toi da 5-7 non-clustered index tren 1 table (guideline, khong phai hard rule)
--   6. Missing index stats bi reset khi restart SQL Server
-- ============================================================================

SELECT TOP 30
    DB_NAME(d.database_id)                               AS database_name,
    OBJECT_NAME(d.object_id, d.database_id)              AS table_name,
    d.equality_columns,
    d.inequality_columns,
    d.included_columns,
    s.user_seeks,
    s.user_scans,
    s.avg_user_impact,
    CAST(s.avg_user_impact * (s.user_seeks + s.user_scans) AS BIGINT) AS improvement_measure,
    s.last_user_seek,
    s.last_user_scan,

    -- Tu dong generate CREATE INDEX statement
    'CREATE NONCLUSTERED INDEX [IX_'
        + OBJECT_NAME(d.object_id, d.database_id) + '_'
        + REPLACE(REPLACE(REPLACE(ISNULL(d.equality_columns, ''), ', ', '_'), '[', ''), ']', '')
        + '] ON '
        + d.statement
        + ' (' + ISNULL(d.equality_columns, '')
        + CASE WHEN d.inequality_columns IS NOT NULL
            THEN CASE WHEN d.equality_columns IS NOT NULL THEN ', ' ELSE '' END
                 + d.inequality_columns
            ELSE '' END
        + ')'
        + CASE WHEN d.included_columns IS NOT NULL
            THEN ' INCLUDE (' + d.included_columns + ')'
            ELSE '' END
        + ' WITH (ONLINE = ON, SORT_IN_TEMPDB = ON)'
        + ';'                                            AS create_index_sql

FROM sys.dm_db_missing_index_details d
    JOIN sys.dm_db_missing_index_groups g ON d.index_handle = g.index_handle
    JOIN sys.dm_db_missing_index_group_stats s ON g.index_group_handle = s.group_handle
WHERE d.database_id = DB_ID()  -- Chi xem database hien tai
ORDER BY improvement_measure DESC;


-- ============================================================================
-- 2. UNUSED INDEX (Index ton tai nhung khong duoc dung)
-- ============================================================================
-- MUC DICH: Tim index khong ai query dung nhung van ton chi phi khi INSERT/UPDATE/DELETE
--           Xoa bot de tang performance ghi va giam dung luong disk
--
-- CAC COT QUAN TRONG:
--   user_seeks    : So lan dung index seek (tot nhat)
--   user_scans    : So lan dung index scan (it gia tri hon)
--   user_lookups  : So lan bookmark lookup tu index nay
--   user_updates  : So lan phai update index khi data thay doi
--
-- QUY TAC DANH GIA:
--   user_seeks = 0 va user_scans = 0 : Index KHONG duoc dung de doc
--   user_updates >> (user_seeks + user_scans) : Index ton chi phi nhieu hon gia tri mang lai
--
-- LUU Y TRUOC KHI XOA:
--   1. Stats bi reset khi restart SQL Server → kiem tra uptime truoc
--      (query cuoi file kiem tra SQL Server uptime)
--   2. Co the co query chay monthly/quarterly su dung index nay → cho du 1 chu ky
--   3. KHONG xoa PRIMARY KEY hoac UNIQUE constraint index
--   4. Script lai CREATE INDEX truoc khi xoa (phong tao lai)
--   5. Disable index truoc, theo doi 1-2 tuan, roi moi DROP
-- ============================================================================

SELECT
    OBJECT_NAME(i.object_id)         AS table_name,
    i.name                           AS index_name,
    i.type_desc                      AS index_type,
    us.user_seeks,
    us.user_scans,
    us.user_lookups,
    us.user_seeks + us.user_scans + us.user_lookups AS total_reads,
    us.user_updates                  AS total_writes,
    us.last_user_seek,
    us.last_user_scan,
    -- Ti le ghi/doc: cang cao = index cang "dat" so voi gia tri mang lai
    CASE WHEN (us.user_seeks + us.user_scans + us.user_lookups) > 0
        THEN CAST(us.user_updates * 1.0 / (us.user_seeks + us.user_scans + us.user_lookups) AS DECIMAL(10,2))
        ELSE 999999  -- Khong co read nao → toan ghi
    END AS write_to_read_ratio,
    -- Kich thuoc index
    (SELECT SUM(ps.used_page_count) * 8 / 1024
     FROM sys.dm_db_partition_stats ps
     WHERE ps.object_id = i.object_id AND ps.index_id = i.index_id
    ) AS index_size_mb,
    CASE
        WHEN us.user_seeks = 0 AND us.user_scans = 0 AND us.user_lookups = 0
        THEN '!! KHONG DUOC DUNG - Xem xet xoa'
        WHEN us.user_updates > (us.user_seeks + us.user_scans + us.user_lookups) * 10
        THEN '! Chi phi ghi >> gia tri doc'
        ELSE 'OK'
    END AS trang_thai,
    -- Script de disable (an toan hon DROP)
    'ALTER INDEX [' + i.name + '] ON [' + OBJECT_SCHEMA_NAME(i.object_id) + '].[' + OBJECT_NAME(i.object_id) + '] DISABLE;' AS disable_sql
FROM sys.indexes i
    JOIN sys.dm_db_index_usage_stats us
        ON i.object_id = us.object_id AND i.index_id = us.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND i.type_desc = 'NONCLUSTERED'
  AND i.is_primary_key = 0
  AND i.is_unique_constraint = 0
  AND us.database_id = DB_ID()
ORDER BY total_reads ASC, us.user_updates DESC;


-- ============================================================================
-- 3. INDEX FRAGMENTATION
-- ============================================================================
-- MUC DICH: Kiem tra do phan manh cua index
--           Index bi phan manh → doc nhieu page hon can thiet → cham
--
-- NGUONG:
--   fragmentation 5-30%   : REORGANIZE (nhe, online, khong block)
--   fragmentation > 30%   : REBUILD (nang hon, nen dung ONLINE = ON cho Enterprise)
--   fragmentation < 5%    : Khong can lam gi
--   page_count < 1000     : Index nho, phan manh khong anh huong dang ke
--
-- LUU Y:
--   - Query nay CO THE CHAM tren database lon (scan moi index)
--   - Chi chay ngoai gio lam viec hoac tren read replica
--   - Dung MODE = 'LIMITED' (nhanh, du chinh xac) thay vi 'DETAILED'
--   - Heap (index_id = 0) bi phan manh → can tao clustered index
--   - Sau REBUILD: statistics tu dong duoc update
-- ============================================================================

SELECT top(10)
    OBJECT_NAME(ips.object_id)       AS table_name,
    i.name                           AS index_name,
    i.type_desc,
    ips.index_type_desc,
    ips.avg_fragmentation_in_percent AS frag_pct,
    ips.page_count,
    ips.page_count * 8 / 1024       AS size_mb,
    ips.avg_page_space_used_in_percent AS avg_page_fill_pct,
    ips.record_count,
    CASE
        WHEN ips.page_count < 1000 THEN 'NHO - Bo qua'
        WHEN ips.avg_fragmentation_in_percent > 30
        THEN 'REBUILD: ALTER INDEX [' + i.name + '] ON ['
             + OBJECT_SCHEMA_NAME(ips.object_id) + '].[' + OBJECT_NAME(ips.object_id)
             + '] REBUILD WITH (ONLINE = ON, SORT_IN_TEMPDB = ON);'
        WHEN ips.avg_fragmentation_in_percent > 5
        THEN 'REORGANIZE: ALTER INDEX [' + i.name + '] ON ['
             + OBJECT_SCHEMA_NAME(ips.object_id) + '].[' + OBJECT_NAME(ips.object_id)
             + '] REORGANIZE;'
        ELSE 'OK'
    END AS action_sql
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
    JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 5
  AND ips.page_count > 100  -- Bo qua index qua nho
  AND i.name IS NOT NULL    -- Bo qua heap
ORDER BY ips.avg_fragmentation_in_percent DESC;


-- ============================================================================
-- 4. DUPLICATE INDEX (Index trung lap)
-- ============================================================================
-- MUC DICH: Tim cac index co cung key columns tren 1 table
--           Duplicate index = lang phi disk + cham ghi ma khong them gia tri doc
--
-- LUU Y:
--   - Hai index cung key nhung khac INCLUDE columns → khong hoan toan duplicate
--     → co the merge thanh 1 index voi nhieu INCLUDE columns hon
-- ============================================================================

;WITH IndexColumns AS (
    SELECT
        OBJECT_NAME(i.object_id) AS table_name,
        i.name AS index_name,
        i.index_id,
        i.object_id,
        i.type_desc,
        (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
         FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
        ) AS key_columns,
        (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY c.column_id)
         FROM sys.index_columns ic
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
        ) AS include_columns
    FROM sys.indexes i
    WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
      AND i.type_desc = 'NONCLUSTERED'
)
SELECT
    a.table_name,
    a.index_name       AS index_1,
    b.index_name       AS index_2,
    a.key_columns,
    a.include_columns  AS include_1,
    b.include_columns  AS include_2,
    'Xem xet merge hoac xoa 1 trong 2 index' AS action
FROM IndexColumns a
    JOIN IndexColumns b
        ON a.object_id = b.object_id
        AND a.index_id < b.index_id
        AND a.key_columns = b.key_columns;


-- ============================================================================
-- 5. SQL SERVER UPTIME (de biet stats da tich luy bao lau)
-- ============================================================================
-- QUAN TRONG: Tat ca DMV stats (missing index, usage stats, wait stats)
-- deu bi reset khi restart SQL Server.
-- Nen kiem tra uptime truoc khi ra quyet dinh dua tren DMV stats.
-- Neu SQL Server moi restart < 7 ngay → du lieu stats chua du tin cay.
-- ============================================================================

SELECT
    sqlserver_start_time,
    DATEDIFF(DAY, sqlserver_start_time, GETDATE()) AS uptime_days,
    DATEDIFF(HOUR, sqlserver_start_time, GETDATE()) AS uptime_hours,
    CASE
        WHEN DATEDIFF(DAY, sqlserver_start_time, GETDATE()) < 7
        THEN '! SQL Server moi restart < 7 ngay - DMV stats chua du tin cay'
        ELSE 'OK - Stats da tich luy du lau'
    END AS canh_bao
FROM sys.dm_os_sys_info;


-- ============================================================================
-- 6. HEAP TABLE DETECTION & HEALTH CHECK
-- ============================================================================
-- MUC DICH: Tim tat ca table dang luu dang heap (khong co Clustered Index)
--           va danh gia muc do anh huong den performance
--
-- TAI SAO HEAP NGUY HIEM:
--   1. Forwarding Pointers: UPDATE lam row lon hon → row bi chuyen sang page khac,
--      de lai pointer o vi tri cu. Query phai nhay 2 lan I/O thay vi 1.
--      Tich luy nhieu → query CHAM GAP BOI ma khong ai biet tai sao.
--   2. Table Scan: Khong co clustered index → moi query khong co NC index phu hop
--      phai scan TOAN BO table.
--   3. Non-clustered index lookup dat hon: NC index tren heap luu RID (FileID:PageID:SlotID)
--      → bookmark lookup la random I/O, khong duoc huong loi tu data locality.
--   4. Space wasted: DELETE de lai lo hong, khong duoc reuse hieu qua.
--   5. Khong the REORGANIZE: Heap khong the reorganize nhu clustered index.
--
-- KHI NAO HEAP LA CHAP NHAN DUOC:
--   - Staging/ETL table (chi INSERT roi TRUNCATE)
--   - Log/Audit table (chi INSERT, khong UPDATE)
--   - Table < 100 rows (qua nho, khong anh huong)
--
-- NGUONG:
--   forwarded_pct > 10%   : NGUY HIEM - Rebuild hoac tao Clustered Index ngay
--   forwarded_pct > 1%    : Canh bao - Theo doi, len ke hoach xu ly
--   Heap co > 10,000 rows va co UPDATE : Nen tao Clustered Index
--   Heap co NC index      : CHAC CHAN nen tao Clustered Index (NC lookup se nhanh hon)
-- ============================================================================

-- 6a. DANH SACH HEAP TABLES voi thong tin chi tiet
SELECT
    SCHEMA_NAME(t.schema_id)                   AS schema_name,
    t.name                                     AS table_name,
    p.rows                                     AS row_count,
    SUM(au.total_pages) * 8 / 1024            AS total_size_mb,
    SUM(au.used_pages) * 8 / 1024             AS used_size_mb,

    -- Dem so non-clustered index tren heap nay
    (SELECT COUNT(*)
     FROM sys.indexes i2
     WHERE i2.object_id = t.object_id
       AND i2.type_desc = 'NONCLUSTERED'
    )                                          AS nc_index_count,

    -- Kiem tra co bi UPDATE thuong xuyen khong (tu index usage stats)
    (SELECT SUM(us.user_updates)
     FROM sys.dm_db_index_usage_stats us
     WHERE us.object_id = t.object_id
       AND us.database_id = DB_ID()
    )                                          AS total_user_updates,

    -- Kiem tra co bi SELECT nhieu khong
    (SELECT SUM(us.user_scans + us.user_seeks + us.user_lookups)
     FROM sys.dm_db_index_usage_stats us
     WHERE us.object_id = t.object_id
       AND us.database_id = DB_ID()
    )                                          AS total_user_reads,

    t.create_date                              AS table_created,

    CASE
        WHEN p.rows > 10000
             AND (SELECT COUNT(*) FROM sys.indexes i2
                  WHERE i2.object_id = t.object_id AND i2.type_desc = 'NONCLUSTERED') > 0
        THEN '!! LON + CO NC INDEX → Tao Clustered Index ngay'
        WHEN p.rows > 10000
        THEN '! Table lon, nen tao Clustered Index'
        WHEN p.rows > 1000
        THEN 'Xem xet tao Clustered Index'
        ELSE 'NHO - Co the chap nhan heap'
    END                                        AS trang_thai,

    -- Auto-generate script tao Clustered Index (dung cot Id/ID neu co)
    CASE
        WHEN COL_LENGTH(SCHEMA_NAME(t.schema_id) + '.' + t.name, 'Id') IS NOT NULL
        THEN 'CREATE CLUSTERED INDEX CIX_' + t.name + '_Id ON ['
             + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (Id) WITH (ONLINE = ON);'
        WHEN COL_LENGTH(SCHEMA_NAME(t.schema_id) + '.' + t.name, 'ID') IS NOT NULL
        THEN 'CREATE CLUSTERED INDEX CIX_' + t.name + '_ID ON ['
             + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (ID) WITH (ONLINE = ON);'
        ELSE '-- Xem xet cot phu hop: CREATE CLUSTERED INDEX CIX_' + t.name
             + ' ON [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (???) WITH (ONLINE = ON);'
    END                                        AS suggested_create_ci_sql

FROM sys.tables t
    JOIN sys.indexes i ON t.object_id = i.object_id AND i.type = 0  -- type 0 = HEAP
    JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
    JOIN sys.allocation_units au ON p.partition_id = au.container_id
WHERE t.is_ms_shipped = 0  -- Bo qua system tables
GROUP BY t.schema_id, t.name, t.object_id, p.rows, t.create_date
ORDER BY p.rows DESC;


-- 6b. FORWARDING POINTERS ANALYSIS (van de #1 cua heap)
-- LUU Y: Query nay dung MODE = 'DETAILED', co the CHAM tren table lon
--        Chi chay ngoai gio cao diem hoac tren table nghi ngo co van de
SELECT
    SCHEMA_NAME(t.schema_id)                   AS schema_name,
    OBJECT_NAME(ps.object_id)                  AS table_name,
    ps.page_count,
    ps.page_count * 8 / 1024                  AS size_mb,
    ps.record_count,
    ps.forwarded_record_count,
    ps.avg_fragmentation_in_percent            AS frag_pct,
    ps.avg_page_space_used_in_percent          AS avg_page_fill_pct,

    CASE WHEN ps.record_count > 0
        THEN CAST(ps.forwarded_record_count * 100.0 / ps.record_count AS DECIMAL(5,2))
        ELSE 0
    END                                        AS forwarded_pct,

    CASE
        WHEN ps.forwarded_record_count > ps.record_count * 0.10
        THEN '!! > 10% FORWARDED - Rebuild khan cap'
        WHEN ps.forwarded_record_count > ps.record_count * 0.01
        THEN '! > 1% forwarded - Len ke hoach xu ly'
        WHEN ps.forwarded_record_count > 0
        THEN 'Co forwarding nhung chua nhieu'
        ELSE 'OK - Khong co forwarding'
    END                                        AS trang_thai,

    -- Action script
    CASE
        WHEN ps.forwarded_record_count > ps.record_count * 0.01
        THEN 'ALTER TABLE [' + SCHEMA_NAME(t.schema_id) + '].[' + OBJECT_NAME(ps.object_id) + '] REBUILD;'
        ELSE ''
    END                                        AS fix_rebuild_sql

FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, 0, NULL, 'DETAILED') ps
    JOIN sys.tables t ON ps.object_id = t.object_id
WHERE ps.index_type_desc = 'HEAP'
  AND ps.page_count > 100         -- Bo qua table qua nho
  AND t.is_ms_shipped = 0
ORDER BY ps.forwarded_record_count DESC;


-- 6c. HEAP TABLES VOI IDENTITY/SEQUENCE COLUMN (ung vien tot cho Clustered Index)
-- MUC DICH: Tim cac heap table co cot IDENTITY → cot nay la ung vien tot nhat
--           lam Clustered Index key vi: tang dan, unique, narrow (INT/BIGINT), khong doi
SELECT
    SCHEMA_NAME(t.schema_id)                   AS schema_name,
    t.name                                     AS table_name,
    c.name                                     AS identity_column,
    TYPE_NAME(c.user_type_id)                  AS data_type,
    p.rows                                     AS row_count,
    'CREATE CLUSTERED INDEX CIX_' + t.name + '_' + c.name
        + ' ON [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] ([' + c.name + '])'
        + ' WITH (ONLINE = ON);'               AS create_ci_sql
FROM sys.tables t
    JOIN sys.indexes i ON t.object_id = i.object_id AND i.type = 0  -- HEAP
    JOIN sys.identity_columns ic ON t.object_id = ic.object_id
    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id = 0
WHERE t.is_ms_shipped = 0
  AND p.rows > 100  -- Bo qua table nho
ORDER BY p.rows DESC;