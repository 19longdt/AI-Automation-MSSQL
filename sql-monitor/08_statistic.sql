-- ============================================================================
-- FILE: 08_statistics\01_diagnostics.sql
-- MUC DICH: Chan doan cac van de lien quan den SQL Server Statistics
-- THOI DIEM CHAY: Khi query dot ngot cham, estimated rows sai, plan thay doi
--                 Hoac dinh ky kiem tra suc khoe statistics
-- YEU CAU: Query Store can duoc bat tren database (Section 5)
-- ============================================================================
--
-- DANH SACH SECTION:
--   Section 1: Cau hinh statistics va uptime
--   Section 2: Statistics cu - can update
--   Section 3: Sample rate thap (bang lon)
--   Section 4: Ascending key risk
--   Section 5: Cardinality estimate errors (Query Store)
--   Section 6: Parameter sniffing detection (plan cache)
--   Section 7: Incremental statistics tren partitioned tables
--   Section 8: Template lenh update statistics
-- ============================================================================


-- ============================================================================
-- 1. CAU HINH STATISTICS VA UPTIME
-- ============================================================================
-- MUC DICH: Kiem tra tong quan truoc khi phan tich chi tiet
--
-- CAC COT QUAN TRONG:
--   is_auto_update_stats_on  : Stats tu dong cap nhat khi du rows thay doi
--   is_auto_create_stats_on  : Stats tu dong tao khi optimizer can
--   is_auto_update_stats_async_on : Cap nhat background (query dung plan cu truoc)
--   compatibility_level      : Quyet dinh CE version va auto-update threshold
--                              >= 130 dung dynamic threshold (chinh xac hon)
--   uptime_hours             : DMV reset sau restart - can > 24h de co data tin cay
-- ============================================================================

-- 1a. Cau hinh statistics theo database
SELECT
    name                                                AS database_name,
    compatibility_level,
    CASE compatibility_level
        WHEN 150 THEN 'CE150 (SQL 2019)'
        WHEN 140 THEN 'CE140 (SQL 2017)'
        WHEN 130 THEN 'CE130 (SQL 2016)'
        WHEN 120 THEN 'CE120 (SQL 2014)'
        ELSE            'CE Legacy (CE70)'
    END                                                 AS ce_version,
    CASE WHEN compatibility_level >= 130
         THEN 'Dynamic: sqrt(1000 x rows)'
         ELSE 'Fixed: 20% of rows'
    END                                                 AS auto_update_threshold,
    is_auto_update_stats_on,
    is_auto_update_stats_async_on,
    is_auto_create_stats_on,
    is_auto_create_stats_incremental_on
FROM sys.databases
WHERE state_desc = 'ONLINE'
  AND database_id > 4   -- bo qua system databases
ORDER BY name;

-- 1b. SQL Server uptime
SELECT
    sqlserver_start_time,
    DATEDIFF(HOUR, sqlserver_start_time, GETDATE())     AS uptime_hours,
    CASE
        WHEN DATEDIFF(HOUR, sqlserver_start_time, GETDATE()) < 24
        THEN '*** CANH BAO: Uptime < 24h, DMV chua du data ***'
        ELSE 'OK'
    END                                                 AS uptime_status
FROM sys.dm_os_sys_info;


-- ============================================================================
-- 2. STATISTICS CU - CAN UPDATE
-- ============================================================================
-- MUC DICH: Tim cac stat objects co nhieu rows thay doi ke tu lan update cuoi
--           Day la nguyen nhan pho bien nhat cua bad execution plan
--
-- CAC COT QUAN TRONG:
--   modification_counter : So rows INSERT/UPDATE/DELETE ke tu lan update stats cuoi
--   last_updated         : Thoi diem stats duoc cap nhat lan cuoi
--   rows                 : Tong so rows hien tai cua bang
--   rows_sampled         : So rows duoc dung de build histogram
--   mod_pct              : modification_counter / rows * 100 (%)
--   over_legacy_threshold: Vuot nguong 20% (threshold SQL < 2016)
--   over_dynamic_threshold: Vuot nguong sqrt(1000*rows) (threshold SQL 2016+)
--
-- CACH DOC KET QUA:
--   over_dynamic_threshold = 1 -> stats NEN duoc cap nhat ngay (neu compat >= 130)
--   over_legacy_threshold = 1  -> stats cu nghiem trong (du nguong cu)
--   mod_pct cao nhung chua qua nguong -> can theo doi
--
-- LUU Y:
--   - Ket qua chi co y nghia khi uptime > 24h (xem Section 1b)
--   - Chay trong nguong cua database hien tai (USE your_database truoc)
-- ============================================================================

SELECT TOP 50
    OBJECT_SCHEMA_NAME(s.object_id)                     AS schema_name,
    OBJECT_NAME(s.object_id)                            AS table_name,
    s.name                                              AS stat_name,
    s.auto_created,
    s.user_created,
    sp.last_updated,
    sp.rows,
    sp.rows_sampled,
    CAST(sp.rows_sampled * 100.0 / NULLIF(sp.rows, 0) AS DECIMAL(5,1))
                                                        AS sample_pct,
    sp.modification_counter,
    CAST(sp.modification_counter * 100.0 / NULLIF(sp.rows, 0) AS DECIMAL(18,2))
                                                        AS mod_pct,
    CASE WHEN sp.modification_counter > sp.rows * 0.20
         THEN 1 ELSE 0
    END                                                 AS over_legacy_threshold,
    CASE WHEN sp.modification_counter > SQRT(1000.0 * sp.rows)
         THEN 1 ELSE 0
    END                                                 AS over_dynamic_threshold,
    -- FULLSCAN cho bang < 5M rows, SAMPLE 30% cho bang lon hon
    'UPDATE STATISTICS '
    + QUOTENAME(OBJECT_SCHEMA_NAME(s.object_id))
    + '.' + QUOTENAME(OBJECT_NAME(s.object_id))
    + ' ' + QUOTENAME(s.name)
    + CASE WHEN sp.rows <= 5000000 THEN ' WITH FULLSCAN;'
           ELSE ' WITH SAMPLE 30 PERCENT;'
      END                                               AS action_sql
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE sp.rows > 0 and OBJECT_NAME(s.object_id) = 'product_product_unit'
  AND sp.modification_counter > 0
  AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
ORDER BY sp.modification_counter DESC;
-- ============================================================================
-- 3. SAMPLE RATE THAP (BANG LON)
-- ============================================================================
-- MUC DICH: Tim cac bang lon co stats duoc build tu sample qua nho
--           Histogram khong dai dien -> optimizer estimate sai
--
-- CAC COT QUAN TRONG:
--   rows          : Tong so rows cua bang
--   rows_sampled  : So rows duoc dung khi build histogram
--   sample_pct    : Ti le mau (cang cao cang chinh xac)
--   unsampled_rows: So rows khong duoc tinh vao histogram
--
-- NGUONG DANH GIA:
--   sample_pct < 10% : Nghiem trong - histogram rat khong chinh xac
--   sample_pct < 20% : Can theo doi - nen update voi sample cao hon
--   sample_pct >= 30%: Chap nhan duoc cho bang lon
--
-- LUU Y:
--   - Bang < 100,000 rows: mac dinh dung FULLSCAN, khong lo sample
--   - Bang > 10M rows: fullscan ton I/O, can chay ngoai gio cao diem
-- ============================================================================

SELECT TOP 30
    OBJECT_SCHEMA_NAME(s.object_id)                     AS schema_name,
    OBJECT_NAME(s.object_id)                            AS table_name,
    s.name                                              AS stat_name,
    sp.rows,
    sp.rows_sampled,
    CAST(sp.rows_sampled * 100.0 / NULLIF(sp.rows, 0) AS DECIMAL(5,1))
                                                        AS sample_pct,
    sp.rows - sp.rows_sampled                           AS unsampled_rows,
    sp.last_updated,
    CASE
        WHEN sp.rows_sampled * 100.0 / sp.rows < 10 THEN 'NGHIEM TRONG < 10%'
        WHEN sp.rows_sampled * 100.0 / sp.rows < 20 THEN 'THAP < 20%'
        ELSE 'Chap nhan duoc'
    END                                                 AS sample_assessment,
    -- Bang > 10M rows: FULLSCAN ton I/O, de nghi SAMPLE 50%
    -- Bang 1-10M rows: SAMPLE 30% can bang giua toc do va do chinh xac
    -- Bang < 1M rows : FULLSCAN la toi uu
    'UPDATE STATISTICS '
    + QUOTENAME(OBJECT_SCHEMA_NAME(s.object_id))
    + '.' + QUOTENAME(OBJECT_NAME(s.object_id))
    + ' ' + QUOTENAME(s.name)
    + CASE
        WHEN sp.rows > 10000000 THEN ' WITH SAMPLE 50 PERCENT; -- Bang lon > 10M rows'
        WHEN sp.rows >  1000000 THEN ' WITH SAMPLE 30 PERCENT; -- Bang trung 1-10M rows'
        ELSE                         ' WITH FULLSCAN;           -- Bang < 1M rows'
      END                                               AS action_sql
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE sp.rows > 100000
  AND sp.rows_sampled > 0
  AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
ORDER BY sp.rows DESC;


-- ============================================================================
-- 4. ASCENDING KEY RISK
-- ============================================================================
-- MUC DICH: Tim bang co nguy co Ascending Key Problem
--           Cot tang dan (IDENTITY, DATE) + nhieu rows moi -> histogram khong cover
--
-- CAC COT QUAN TRONG:
--   leading_column_type  : Kieu du lieu cua cot dau tien trong stat
--   modification_counter : Rows thay doi ke tu lan update stats cuoi
--                          Cao + cot tang dan = nguy co cao
--   last_updated         : Stats cu cang lau = risk cang cao
--   is_ascending_key_type: 1 neu cot co kieu thuong tang dan (int, bigint, date, datetime)
--
-- CACH XAC NHAN VAN DE:
--   Sau khi tim duoc bang nghi ngo, chay:
--   DBCC SHOW_STATISTICS ('schema.table', 'stat_name') WITH HISTOGRAM
--   -> Xem RANGE_HI_KEY cao nhat trong histogram
--   -> So sanh voi SELECT MAX(column) FROM table
--   -> Neu MAX > RANGE_HI_KEY cao nhat -> co ascending key problem
--
-- XU LY:
--   UPDATE STATISTICS schema_name.table_name WITH FULLSCAN;
--   -> Sau do xem lai execution plan
-- ============================================================================

SELECT
    OBJECT_SCHEMA_NAME(s.object_id)                     AS schema_name,
    OBJECT_NAME(s.object_id)                            AS table_name,
    s.name                                              AS stat_name,
    c.name                                              AS leading_column,
    t.name                                              AS leading_column_type,
    CASE WHEN t.name IN ('int','bigint','smallint','tinyint',
                         'date','datetime','datetime2','smalldatetime')
         THEN 1 ELSE 0
    END                                                 AS is_ascending_key_type,
    sp.rows,
    sp.modification_counter,
    CAST(sp.modification_counter * 100.0 / NULLIF(sp.rows,0) AS DECIMAL(8,2))
                                                        AS mod_pct,
    sp.last_updated,
    DATEDIFF(HOUR, sp.last_updated, GETDATE())          AS hours_since_update
FROM sys.stats s
JOIN sys.stats_columns sc ON s.object_id = sc.object_id
                          AND s.stats_id = sc.stats_id
                          AND sc.stats_column_id = 1   -- chi cot dau tien
JOIN sys.columns c         ON sc.object_id = c.object_id
                          AND sc.column_id = c.column_id
JOIN sys.types t           ON c.user_type_id = t.user_type_id
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND t.name IN ('int','bigint','smallint','tinyint',
                 'date','datetime','datetime2','smalldatetime')
  AND sp.rows > 10000
  AND sp.modification_counter > 1000
ORDER BY sp.modification_counter DESC;


-- ============================================================================
-- 5. CARDINALITY ESTIMATE ERRORS (QUERY STORE)
-- ============================================================================
-- MUC DICH: Tim cac query co estimated rows vs actual rows chenh lech nhieu
--           Chenh lech lon = statistics sai hoac CE version khong phu hop
--
-- YEU CAU: Query Store phai duoc bat
--   ALTER DATABASE your_db SET QUERY_STORE = ON;
--   Kiem tra: SELECT actual_state_desc FROM sys.database_query_store_options;
--
-- CAC COT QUAN TRONG:
--   avg_est_rows       : Trung binh so rows optimizer uoc luong
--   avg_actual_rows    : Trung binh so rows thuc te tra ve
--   est_vs_actual_ratio: avg_est / avg_actual (> 10 hoac < 0.1 = co van de)
--   avg_duration_ms    : Thoi gian chay trung binh (ms)
--
-- CACH DOC KET QUA:
--   ratio >> 1  : Optimizer uoc luong NHIEU hon thuc te -> over-allocate memory
--   ratio << 1  : Optimizer uoc luong IT hon thuc te    -> under-allocate, spill
--   ratio ~ 1   : Uoc luong tot
--
-- HANH DONG:
--   1. Xem text query -> tim table/column nao co trong WHERE/JOIN
--   2. Chay DBCC SHOW_STATISTICS cho column do
--   3. UPDATE STATISTICS voi FULLSCAN
--   4. So sanh plan truoc/sau trong Query Store
-- ============================================================================

-- Kiem tra Query Store co bat khong
SELECT
    actual_state_desc,
    readonly_reason,
    current_storage_size_mb,
    max_storage_size_mb
FROM sys.database_query_store_options;

-- Tim query co cardinality estimate sai nhieu
-- Dung CTE de parse estimated rows tu plan XML (StatementEstRows)
-- tranh parse XML nhieu lan
-- Pre-filter: chi lay plan co du lieu thoa dieu kien truoc khi parse XML
-- Tranh parse XML toan bo Query Store
;WITH cte_slow_plans AS (
    SELECT DISTINCT p.plan_id, p.query_id,
        p.plan_forcing_type_desc, p.avg_compile_duration, p.query_plan
    FROM sys.query_store_plan p
    JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
    WHERE p.last_compile_start_time > DATEADD(DAY, -1, GETDATE())
      AND rs.count_executions >= 5
      AND rs.avg_duration > 100000
),
cte_plan_est AS (
    SELECT
        plan_id, query_id, plan_forcing_type_desc, avg_compile_duration,
        TRY_CAST(
            TRY_CAST(query_plan AS XML)
                .value('(//StmtSimple/@StatementEstRows)[1]', 'float')
        AS BIGINT)                                      AS est_rows
    FROM cte_slow_plans
)
SELECT TOP 20
    qt.query_sql_text,
    q.query_id,
    pe.plan_id,
    rs.count_executions,
    pe.est_rows                                         AS avg_est_rows,
    CAST(rs.avg_rowcount AS BIGINT)                     AS avg_actual_rows,
    CAST(rs.last_rowcount AS BIGINT)                    AS last_actual_rows,
    CASE
        WHEN rs.avg_rowcount > 0 AND pe.est_rows IS NOT NULL
        THEN CAST(pe.est_rows * 1.0 / rs.avg_rowcount AS DECIMAL(10,2))
        ELSE NULL
    END                                                 AS est_vs_actual_ratio,
    -- Nhan xet nhanh ve muc do lech
    CASE
        WHEN rs.avg_rowcount = 0 OR pe.est_rows IS NULL THEN 'N/A'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount > 100  THEN 'OVER-ESTIMATE > 100x'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount > 10   THEN 'Over-estimate > 10x'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount > 2    THEN 'Over-estimate > 2x'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount < 0.01 THEN 'UNDER-ESTIMATE < 1%'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount < 0.1  THEN 'Under-estimate < 10%'
        WHEN pe.est_rows * 1.0 / rs.avg_rowcount < 0.5  THEN 'Under-estimate < 50%'
        ELSE 'OK'
    END                                                 AS estimate_assessment,
    CAST(pe.avg_compile_duration / 1000.0 AS DECIMAL(10,2))
                                                        AS avg_compile_ms,
    CAST(rs.avg_duration / 1000.0 AS DECIMAL(10,2))    AS avg_duration_ms,
    rs.avg_logical_io_reads,
    pe.plan_forcing_type_desc,
    q.last_execution_time
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
JOIN cte_plan_est pe               ON q.query_id = pe.query_id
JOIN sys.query_store_runtime_stats rs ON pe.plan_id = rs.plan_id
WHERE rs.count_executions >= 5
  AND rs.avg_duration > 100000    -- > 100ms
ORDER BY rs.avg_duration DESC;


-- ============================================================================
-- 6. PARAMETER SNIFFING DETECTION (PLAN CACHE)
-- ============================================================================
-- MUC DICH: Tim cac query co cung query_hash nhung performance chenh lech nhieu
--           Chenh lech lon giua max va min elapsed = dau hieu parameter sniffing
--           Kem theo plan XML cua lan cham nhat va nhanh nhat de so sanh
--
-- CAC COT QUAN TRONG:
--   query_hash        : Hash cua query text (bo qua literal values)
--   plan_count        : So luong plan khac nhau cho cung query
--   max_elapsed_ms    : Lan chay cham nhat
--   min_elapsed_ms    : Lan chay nhanh nhat
--   elapsed_ratio     : max / min (> 10 = nghi ngo parameter sniffing)
--   worst_plan_xml    : Plan XML cua lan chay CHAM nhat -> click trong SSMS de xem
--   best_plan_xml     : Plan XML cua lan chay NHANH nhat -> so sanh voi worst
--
-- CACH XEM PLAN XML TRONG SSMS:
--   Click vao o worst_plan_xml / best_plan_xml -> mo sang tab moi
--   -> Graphical execution plan hien thi truc tiep
--   -> So sanh join operator, index operation giua 2 plan
--
-- LUU Y:
--   - Plan cache bi flush khi memory pressure hoac DBCC FREEPROCCACHE
--   - Nen chay sau khi he thong chay on dinh > 30 phut
--   - plan_count > 1 cung co the do ad-hoc queries khac nhau (khong phai sniffing)
-- ============================================================================

;WITH cte_raw AS (
    -- Thu thap tat ca plan voi thong tin performance
    SELECT
        qs.query_hash,
        qs.plan_handle,
        qs.execution_count,
        qs.max_elapsed_time,
        qs.min_elapsed_time,
        qs.total_elapsed_time,
        qs.last_execution_time,
        SUBSTRING(
            st.text,
            (qs.statement_start_offset / 2) + 1,
            (CASE qs.statement_end_offset
                 WHEN -1 THEN DATALENGTH(st.text)
                 ELSE qs.statement_end_offset
             END - qs.statement_start_offset) / 2 + 1
        )                                               AS query_text
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
    WHERE qs.execution_count > 3
),
cte_summary AS (
    -- Tinh toan tong hop va loc query co chenh lech lon
    SELECT
        query_hash,
        COUNT(DISTINCT plan_handle)                     AS plan_count,
        SUM(execution_count)                            AS total_executions,
        MAX(max_elapsed_time) / 1000                    AS max_elapsed_ms,
        MIN(min_elapsed_time) / 1000                    AS min_elapsed_ms,
        SUM(total_elapsed_time) / SUM(execution_count) / 1000
                                                        AS avg_elapsed_ms,
        MAX(max_elapsed_time) / NULLIF(MIN(min_elapsed_time), 0)
                                                        AS elapsed_ratio,
        MAX(last_execution_time)                        AS last_execution_time,
        MAX(query_text)                                 AS query_text
    FROM cte_raw
    GROUP BY query_hash
    HAVING COUNT(DISTINCT plan_handle) >= 1
       AND MAX(max_elapsed_time) / NULLIF(MIN(min_elapsed_time), 0) > 10
),
cte_worst AS (
    -- Plan co avg_elapsed cao nhat per query_hash (plan cham nhat trung binh)
    SELECT r.query_hash, r.plan_handle,
           r.total_elapsed_time / r.execution_count     AS avg_elapsed_per_plan,
           ROW_NUMBER() OVER (
               PARTITION BY r.query_hash
               ORDER BY r.total_elapsed_time / r.execution_count DESC
           )                                            AS rn
    FROM cte_raw r
    JOIN cte_summary s ON r.query_hash = s.query_hash
),
cte_best AS (
    -- Plan co avg_elapsed thap nhat per query_hash (plan nhanh nhat trung binh)
    SELECT r.query_hash, r.plan_handle,
           r.total_elapsed_time / r.execution_count     AS avg_elapsed_per_plan,
           ROW_NUMBER() OVER (
               PARTITION BY r.query_hash
               ORDER BY r.total_elapsed_time / r.execution_count ASC
           )                                            AS rn
    FROM cte_raw r
    JOIN cte_summary s ON r.query_hash = s.query_hash
)
SELECT TOP 20
    s.query_hash,
    s.plan_count,
    s.total_executions,
    s.max_elapsed_ms,
    s.min_elapsed_ms,
    s.avg_elapsed_ms,
    s.elapsed_ratio,
    s.last_execution_time,
    s.query_text,
    -- plan_count = 1: chi co 1 plan duy nhat, performance chenh lech
    --   do cung 1 plan phuc vu nhieu parameter khac nhau (classic sniffing)
    -- plan_count > 1: nhieu plan duoc compile, co the do sniffing hoac recompile
    CASE WHEN w.plan_handle = b.plan_handle
         THEN '1 plan - classic sniffing'
         ELSE CAST(s.plan_count AS VARCHAR) + ' plans - multiple compiled'
    END                                                 AS sniffing_type,
    w.avg_elapsed_per_plan / 1000                       AS worst_plan_avg_ms,
    b.avg_elapsed_per_plan / 1000                       AS best_plan_avg_ms,
    qp_worst.query_plan                                 AS worst_plan_xml,
    -- NULL neu cung plan voi worst (khong co gi them de so sanh)
    CASE WHEN w.plan_handle <> b.plan_handle
         THEN qp_best.query_plan
         ELSE NULL
    END                                                 AS best_plan_xml
FROM cte_summary s
JOIN cte_worst w  ON s.query_hash = w.query_hash AND w.rn = 1
JOIN cte_best b   ON s.query_hash = b.query_hash AND b.rn = 1
CROSS APPLY sys.dm_exec_query_plan(w.plan_handle) qp_worst
CROSS APPLY sys.dm_exec_query_plan(b.plan_handle) qp_best
ORDER BY s.elapsed_ratio DESC;


-- ============================================================================
-- 7. INCREMENTAL STATISTICS TREN PARTITIONED TABLES
-- ============================================================================
-- MUC DICH: Kiem tra bang nao phan vung chua dung incremental statistics
--           Incremental stats: update tung partition thay vi full table scan
--           -> Tiet kiem I/O rat nhieu cho bang partition theo date
--
-- CAC COT QUAN TRONG:
--   is_incremental   : 1 = da bat incremental stats cho stat object nay
--   partition_count  : So luong partition cua bang
--
-- HANH DONG:
--   Bang co nhieu partition nhung is_incremental = 0:
--   -> Can xem xet bat incremental stats de toi uu maintenance window
--   -> Tao lai stats voi: CREATE STATISTICS ... WITH INCREMENTAL = ON
--   -> Hoac: ALTER INDEX ... REBUILD PARTITION = ALL
--            WITH (STATISTICS_INCREMENTAL = ON)
-- ============================================================================

-- 7a. Bang da bat incremental statistics
SELECT
    OBJECT_SCHEMA_NAME(s.object_id)                     AS schema_name,
    OBJECT_NAME(s.object_id)                            AS table_name,
    s.name                                              AS stat_name,
    s.is_incremental,
    sp.rows,
    sp.last_updated
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.is_incremental = 1
  AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
ORDER BY sp.rows DESC;

-- 7b. Bang co partition nhung CHUA bat incremental statistics
SELECT
    OBJECT_SCHEMA_NAME(t.object_id)                     AS schema_name,
    t.name                                              AS table_name,
    COUNT(DISTINCT p.partition_number)                  AS partition_count,
    SUM(p.rows)                                         AS total_rows,
    SUM(CASE WHEN s.is_incremental = 1 THEN 1 ELSE 0 END)
                                                        AS incremental_stat_count,
    SUM(CASE WHEN s.is_incremental = 0 THEN 1 ELSE 0 END)
                                                        AS global_stat_count
FROM sys.tables t
JOIN sys.partitions p  ON t.object_id = p.object_id AND p.index_id IN (0, 1)
LEFT JOIN sys.stats s  ON t.object_id = s.object_id
WHERE OBJECTPROPERTY(t.object_id, 'IsUserTable') = 1
GROUP BY t.object_id, t.name
HAVING COUNT(DISTINCT p.partition_number) > 1
ORDER BY SUM(p.rows) DESC;


-- ============================================================================
-- 8. TEMPLATE LENH UPDATE STATISTICS
-- ============================================================================
-- MUC DICH: Cac lenh mau de su dung khi can cap nhat statistics
--           Dua tren ket qua cac section tren
-- ============================================================================

-- 8a. Cap nhat tat ca stats trong database hien tai
--     (dung sample rate mac dinh, nhanh nhung it chinh xac hon FULLSCAN)
-- EXEC sp_updatestats;

-- 8b. Cap nhat tat ca stats cua 1 bang cu the voi FULLSCAN
--     (chinh xac nhat, nen dung cho bang < 5M rows hoac ngoai gio cao diem)
-- UPDATE STATISTICS schema_name.table_name WITH FULLSCAN;

-- 8c. Cap nhat 1 stat object cu the voi sample cao
--     (can bang giua toc do va do chinh xac cho bang lon)
-- UPDATE STATISTICS schema_name.table_name stat_name WITH SAMPLE 30 PERCENT;

-- 8d. Cap nhat index statistics cu the
-- UPDATE STATISTICS schema_name.table_name index_name WITH FULLSCAN;

-- 8e. Script tu dong: Update stats cho tat ca bang co modification_counter > nguong
--     (Chay ket qua nay de generate lenh UPDATE STATISTICS)
SELECT
    'UPDATE STATISTICS '
    + QUOTENAME(OBJECT_SCHEMA_NAME(s.object_id))
    + '.' + QUOTENAME(OBJECT_NAME(s.object_id))
    + ' ' + QUOTENAME(s.name)
    + ' WITH FULLSCAN;'                                 AS update_stats_command,
    OBJECT_NAME(s.object_id)                            AS table_name,
    sp.rows,
    sp.modification_counter,
    sp.last_updated
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE sp.rows > 0
  AND sp.modification_counter > SQRT(1000.0 * sp.rows)  -- vuot dynamic threshold
  AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
ORDER BY sp.modification_counter DESC;

-- ============================================================================
-- HET DIAGNOSTICS
-- ============================================================================
