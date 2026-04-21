-- ============================================================================
-- FILE: 06_check_query_slow.sql
-- MUC DICH: Tim va phan tich cac query cham
-- THOI DIEM CHAY: Khi ung dung cham, hoac dinh ky de toi uu
-- ============================================================================

-- ============================================================================
-- 1. ACTIVE SLOW QUERIES (Dang chay ngay bay gio)
-- ============================================================================
-- MUC DICH: Tim cac query dang chay lau nhat TAI THOI DIEM NAY
--           Day la query dau tien can chay khi user bao "ung dung cham"
--
-- CAC COT QUAN TRONG:
--   elapsed_ms       : Tong thoi gian tu luc bat dau (bao gom ca wait time)
--   cpu_ms           : Thoi gian CPU thuc su chay
--   wait_type        : Tai sao query cham? (CPU, I/O, Lock, Network...)
--   logical_reads    : So page doc tu RAM (cang cao cang ton)
--   physical_reads   : So page phai doc tu disk (RAM khong du)
--
-- PHAN TICH elapsed vs cpu:
--   cpu ~ elapsed        : Query dang chay tren CPU (compute-heavy)
--   cpu << elapsed       : Query dang CHO gi do (xem wait_type)
--   cpu > elapsed        : Query chay parallel (nhieu CPU core cung luc)
--
-- WAIT TYPE THUONG GAP VA Y NGHIA:
--   CXPACKET/CXCONSUMER  : Parallelism wait → co the can MAXDOP hint
--   PAGEIOLATCH_SH       : Doi doc page tu disk → thieu RAM hoac index
--   LCK_M_*              : Doi lock → bi blocking
--   ASYNC_NETWORK_IO     : Doi client nhan data → client cham, hoac tra qua nhieu data
--   SOS_SCHEDULER_YIELD  : CPU busy → query nang
--   WRITELOG             : Doi ghi transaction log → log disk cham
--   NULL                 : Dang chay tren CPU, khong cho gi
-- ============================================================================

-- Dung stored procedure da tao (toi uu hon query ad-hoc)
-- Xem tat ca query chay > 3 giay
EXEC dbo.usp_GetHighResourceSessions
    @MinElapsedTimeMs   = 3000,
    @MinCpuTimeMs       = 0,      -- Lay ca query bi block (CPU = 0 nhung elapsed cao)
    @MinLogicalReads    = 0,
    @IncludeSelect      = 1,
    @IncludeInsert      = 1,
    @IncludeUpdate      = 1,
    @IncludeDelete      = 1,
    @LoginName          = NULL,    -- Tat ca login
    @OrderBy            = 'elapsed',
    @TopN               = 20;


-- ============================================================================
-- 2. TOP QUERY CHAM NHAT TRONG PLAN CACHE (lich su)
-- ============================================================================
-- MUC DICH: Tim cac query ton nhieu tai nguyen nhat ke tu lan compile cuoi
--           Co 4 goc nhin: CPU, Duration, Logical Reads, Execution Count
--
-- CACH DOC KET QUA:
--   - Sort theo avg_elapsed_ms: Query cham nhat moi lan chay
--   - Sort theo total_elapsed_ms: Query chiem nhieu thoi gian tong cong nhat
--   - Sort theo avg_logical_reads: Query doc nhieu data nhat → can index
--   - Sort theo execution_count: Query chay nhieu nhat → toi uu nho cung co hieu qua lon
--
-- LUU Y:
--   - Plan cache co the bi flush bat ky luc nao (memory pressure, DBCC FREEPROCCACHE)
--   - Gia tri la tich luy, nen chia cho execution_count de co average
--   - Query adhoc co the co nhieu plan khac nhau (parameter sniffing)
-- ============================================================================

-- 2a. Top query theo TONG thoi gian chay (anh huong lon nhat den he thong)
SELECT TOP 20
    qs.execution_count,
    qs.total_elapsed_time / 1000                       AS total_elapsed_ms,
    qs.total_elapsed_time / qs.execution_count / 1000  AS avg_elapsed_ms,
    qs.total_worker_time / 1000                        AS total_cpu_ms,
    qs.total_worker_time / qs.execution_count / 1000   AS avg_cpu_ms,
    qs.total_logical_reads,
    qs.total_logical_reads / qs.execution_count        AS avg_logical_reads,
    qs.total_physical_reads / qs.execution_count       AS avg_physical_reads,
    qs.creation_time                                   AS plan_compiled_time,
    qs.last_execution_time,
    DB_NAME(t.dbid)                                    AS database_name,
    SUBSTRING(t.text,
        (qs.statement_start_offset / 2) + 1,
        (CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(t.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset) / 2 + 1
    )                                                  AS sql_statement,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qs.execution_count > 0
ORDER BY qs.total_elapsed_time DESC;


-- 2b. Top query theo TRUNG BINH logical reads (can index nhat)
SELECT TOP 20
    qs.execution_count,
    qs.total_logical_reads / qs.execution_count        AS avg_logical_reads,
    qs.total_logical_reads,
    qs.total_elapsed_time / qs.execution_count / 1000  AS avg_elapsed_ms,
    qs.total_worker_time / qs.execution_count / 1000   AS avg_cpu_ms,
    qs.last_execution_time,
    SUBSTRING(t.text,
        (qs.statement_start_offset / 2) + 1,
        (CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(t.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset) / 2 + 1
    )                                                  AS sql_statement,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qs.execution_count > 0
  AND qs.total_logical_reads / qs.execution_count > 1000  -- Chi lay query doc > 1000 pages/lan
ORDER BY qs.total_logical_reads / qs.execution_count DESC;


-- ============================================================================
-- 3. QUERY STORE - REGRESSED QUERIES (SQL Server 2016+)
-- ============================================================================
-- MUC DICH: Tim cac query da tung nhanh nhung bay gio cham (regressed)
--           Query Store luu tru lich su performance cua query theo thoi gian
--
-- DIEU KIEN:
--   Query Store phai duoc bat cho database:
--   ALTER DATABASE [YourDB] SET QUERY_STORE = ON;
--
-- LUU Y:
--   - Query Store luu theo database, khong phai server-wide
--   - Khac voi plan cache (bi flush), Query Store persist qua restart
--   - Enterprise 2019 co Custom Capture Policy de giam overhead
-- ============================================================================

-- Kiem tra Query Store da bat chua
SELECT
    name,
    is_query_store_on,
    CASE WHEN is_query_store_on = 1 THEN 'OK - Da bat' ELSE '! CHUA BAT - Nen bat len' END AS trang_thai
FROM sys.databases
WHERE database_id = DB_ID();

-- Top regressed queries (so sanh 1 gio gan nhat vs 24 gio truoc)
-- Chi chay duoc neu Query Store da bat
IF EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND is_query_store_on = 1)
BEGIN
    SELECT TOP 20
        q.query_id,
        qt.query_sql_text,
        rs_recent.avg_duration / 1000          AS recent_avg_duration_ms,
        rs_history.avg_duration / 1000         AS history_avg_duration_ms,
        (rs_recent.avg_duration - rs_history.avg_duration) / 1000 AS regression_ms,
        rs_recent.avg_logical_io_reads         AS recent_avg_reads,
        rs_history.avg_logical_io_reads        AS history_avg_reads,
        rs_recent.count_executions             AS recent_executions,
        rs_history.count_executions            AS history_executions,
        p.plan_id,
        p.is_forced_plan
    FROM sys.query_store_query q
        JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
        JOIN sys.query_store_plan p ON q.query_id = p.query_id
        -- Recent: 1 gio gan nhat
        JOIN sys.query_store_runtime_stats rs_recent ON p.plan_id = rs_recent.plan_id
        JOIN sys.query_store_runtime_stats_interval i_recent
            ON rs_recent.runtime_stats_interval_id = i_recent.runtime_stats_interval_id
            AND i_recent.start_time >= DATEADD(HOUR, -1, GETUTCDATE())
        -- History: 1-24 gio truoc
        JOIN sys.query_store_runtime_stats rs_history ON p.plan_id = rs_history.plan_id
        JOIN sys.query_store_runtime_stats_interval i_history
            ON rs_history.runtime_stats_interval_id = i_history.runtime_stats_interval_id
            AND i_history.start_time >= DATEADD(HOUR, -24, GETUTCDATE())
            AND i_history.start_time < DATEADD(HOUR, -1, GETUTCDATE())
    WHERE rs_recent.avg_duration > rs_history.avg_duration * 1.5  -- Cham hon 50%
    ORDER BY (rs_recent.avg_duration - rs_history.avg_duration) * rs_recent.count_executions DESC;
END


-- ============================================================================
-- 4. PARAMETER SNIFFING DETECTION
-- ============================================================================
-- MUC DICH: Tim stored procedure co variance cao giua cac lan chay
--           = dau hieu cua parameter sniffing
--
-- PARAMETER SNIFFING LA GI:
--   SQL Server compile plan dua tren gia tri parameter lan dau tien
--   Neu lan dau parameter tra ve 10 rows, plan duoc toi uu cho 10 rows
--   Nhung khi parameter khac tra ve 1 trieu rows → plan cu khong phu hop → cham
--
-- ACTION:
--   1. Xem plan XML co Warnings (ColumnsWithNoStatistics, UnmatchedIndexes...)
--   2. Thu OPTION (RECOMPILE) cho stored proc co van de
--   3. Thu OPTIMIZE FOR UNKNOWN hoac OPTIMIZE FOR (@param = typical_value)
--   4. Update statistics voi FULLSCAN
-- ============================================================================

SELECT TOP 20
    OBJECT_NAME(qs.object_id)              AS proc_name,
    qs.execution_count,
    qs.min_elapsed_time / 1000             AS min_elapsed_ms,
    qs.max_elapsed_time / 1000             AS max_elapsed_ms,
    qs.total_elapsed_time / qs.execution_count / 1000 AS avg_elapsed_ms,
    -- Ratio max/avg cang cao → cang co kha nang parameter sniffing
    CASE WHEN qs.total_elapsed_time / qs.execution_count > 0
        THEN qs.max_elapsed_time * 1.0 / (qs.total_elapsed_time / qs.execution_count)
        ELSE 0
    END AS max_to_avg_ratio,
    qs.min_logical_reads,
    qs.max_logical_reads,
    qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
    qs.cached_time                         AS plan_cached_time,
    qs.last_execution_time,
    CASE
        WHEN qs.max_elapsed_time > (qs.total_elapsed_time / qs.execution_count) * 10
        THEN '!! NGHI NGO PARAMETER SNIFFING - max >> avg'
        WHEN qs.max_elapsed_time > (qs.total_elapsed_time / qs.execution_count) * 5
        THEN '! Co the parameter sniffing'
        ELSE 'OK'
    END AS trang_thai
FROM sys.dm_exec_procedure_stats qs
WHERE qs.database_id = DB_ID()
  AND qs.execution_count > 10
ORDER BY qs.max_elapsed_time * 1.0 / NULLIF(qs.total_elapsed_time / qs.execution_count, 0) DESC;


-- ============================================================================
-- 5. STATISTICS CU (can update)
-- ============================================================================
-- MUC DICH: Statistics cu → optimizer uoc tinh sai so rows → chon plan sai → cham
--
-- NGUONG:
--   last_updated > 7 ngay va rows_modified > 20% total rows : Can update
--   SQL Server 2019 co auto-update stats nhung nguong la 20% + 500 rows (cu)
--   Bat Trace Flag 2371 de giam nguong tu dong (hoac dung database scoped config)
--
-- ACTION:
--   UPDATE STATISTICS [table_name] WITH FULLSCAN;  -- Chinh xac nhat
--   UPDATE STATISTICS [table_name];                 -- Sample, nhanh hon
-- ============================================================================

SELECT
    OBJECT_NAME(s.object_id)               AS table_name,
    s.name                                 AS stats_name,
    s.auto_created,
    sp.last_updated,
    sp.rows                                AS table_rows,
    sp.rows_sampled,
    sp.modification_counter                AS rows_modified_since_update,
    CASE WHEN sp.rows > 0
        THEN CAST(sp.modification_counter * 100.0 / sp.rows AS DECIMAL(10,2))
        ELSE 0
    END AS modified_pct,
    CASE
        WHEN sp.last_updated < DATEADD(DAY, -7, GETDATE())
             AND sp.modification_counter > sp.rows * 0.1
        THEN '!! CAN UPDATE - Cu va nhieu thay doi'
        WHEN sp.last_updated < DATEADD(DAY, -30, GETDATE())
        THEN '! Cu > 30 ngay'
        ELSE 'OK'
    END AS trang_thai,
    'UPDATE STATISTICS [' + OBJECT_SCHEMA_NAME(s.object_id) + '].[' + OBJECT_NAME(s.object_id)
        + '] [' + s.name + '] WITH FULLSCAN;' AS update_sql
FROM sys.stats s
    CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND sp.modification_counter > 0
ORDER BY sp.modification_counter DESC;
