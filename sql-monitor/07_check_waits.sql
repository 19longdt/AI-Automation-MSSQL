-- ============================================================================
-- FILE: 07_check_waits.sql
-- MUC DICH: Phan tich Wait Statistics - "SQL Server dang cho gi?"
-- THOI DIEM CHAY: Khi can hieu bottleneck tong the cua SQL Server
-- ============================================================================

-- ============================================================================
-- WAIT STATS LA GI?
-- ============================================================================
-- Moi khi 1 thread trong SQL Server khong the tiep tuc vi phai CHO gi do,
-- SQL Server ghi nhan wait type va thoi gian cho.
-- Phan tich wait stats = xac dinh bottleneck LON NHAT cua he thong.
--
-- PHUONG PHAP:
--   1. Chay query nay, xem top waits
--   2. Dua vao wait type → biet bottleneck o dau (CPU, I/O, Lock, Memory...)
--   3. Drill down bang cac file check tuong ung (check_cpu, check_disk_io, ...)
-- ============================================================================

-- ============================================================================
-- 1. TOP WAIT TYPES (tich luy tu restart)
-- ============================================================================
-- CAC COT QUAN TRONG:
--   wait_type           : Loai event dang cho
--   wait_time_s         : Tong thoi gian cho (giay)
--   signal_wait_time_s  : Thoi gian cho CPU scheduler SAU KHI resource da san sang
--                         Signal wait cao = CPU busy
--   resource_wait_s     : Thoi gian cho resource (I/O, lock...) = wait - signal
--   pct                 : % cua wait nay so voi tong tat ca waits
--
-- TOP WAIT TYPES VA Y NGHIA:
--
-- === I/O RELATED ===
--   PAGEIOLATCH_SH/EX    : Doc/ghi page tu disk → thieu RAM hoac disk cham
--   WRITELOG              : Ghi transaction log → log disk cham
--   IO_COMPLETION         : Doi I/O hoan thanh (sort, hash spill to tempdb)
--   ASYNC_IO_COMPLETION   : Doi async I/O (backup, bulk import)
--
-- === CPU RELATED ===
--   SOS_SCHEDULER_YIELD   : Thread tra CPU cho thread khac → CPU busy
--   CXPACKET              : Parallel query doi thread khac hoan thanh
--   CXCONSUMER            : Consumer thread trong parallel query doi data
--   THREADPOOL            : Het worker thread → NGUY HIEM
--
-- === LOCK RELATED ===
--   LCK_M_S/X/U/IX/IS    : Doi lock → blocking
--
-- === MEMORY RELATED ===
--   RESOURCE_SEMAPHORE    : Doi memory grant → thieu RAM cho query
--   CMEMTHREAD            : Tranh chap memory allocation
--
-- === NETWORK RELATED ===
--   ASYNC_NETWORK_IO      : Doi client nhan data → client cham hoac tra nhieu data
--
-- === LATCH RELATED ===
--   PAGELATCH_*           : Doi access 1 page trong memory (khong phai I/O)
--                           Thuong do hot page contention (vd: last page insert)
--
-- === BENIGN (BO QUA) ===
--   Cac wait type sau la BINH THUONG, khong phai bottleneck:
--   WAITFOR, LAZYWRITER_SLEEP, BROKER_*, SQLTRACE_*, CLR_*, XE_*, SP_SERVER_*
--   SLEEP_*, HADR_*, DIRTY_PAGE_POLL, REQUEST_FOR_DEADLOCK_SEARCH
-- ============================================================================

WITH WaitStats AS (
    SELECT
        wait_type,
        waiting_tasks_count,
        wait_time_ms / 1000.0                           AS wait_time_s,
        signal_wait_time_ms / 1000.0                     AS signal_wait_time_s,
        (wait_time_ms - signal_wait_time_ms) / 1000.0    AS resource_wait_s,
        100.0 * wait_time_ms / SUM(wait_time_ms) OVER()  AS pct,
        ROW_NUMBER() OVER(ORDER BY wait_time_ms DESC)     AS rn
    FROM sys.dm_os_wait_stats
    WHERE wait_type NOT IN (
        -- Bo qua cac benign/background waits
        N'BROKER_EVENTHANDLER', N'BROKER_RECEIVE_WAITFOR', N'BROKER_TASK_STOP',
        N'BROKER_TO_FLUSH', N'BROKER_TRANSMITTER', N'CHECKPOINT_QUEUE',
        N'CHKPT', N'CLR_AUTO_EVENT', N'CLR_MANUAL_EVENT', N'CLR_SEMAPHORE',
        N'DBMIRROR_DBM_EVENT', N'DBMIRROR_EVENTS_QUEUE', N'DBMIRROR_WORKER_QUEUE',
        N'DBMIRRORING_CMD', N'DIRTY_PAGE_POLL', N'DISPATCHER_QUEUE_SEMAPHORE',
        N'EXECSYNC', N'FSAGENT', N'FT_IFTS_SCHEDULER_IDLE_WAIT', N'FT_IFTSHC_MUTEX',
        N'HADR_CLUSAPI_CALL', N'HADR_FILESTREAM_IOMGR_IOCOMPLETION',
        N'HADR_LOGCAPTURE_WAIT', N'HADR_NOTIFICATION_DEQUEUE',
        N'HADR_TIMER_TASK', N'HADR_WORK_QUEUE', N'KSOURCE_WAKEUP',
        N'LAZYWRITER_SLEEP', N'LOGMGR_QUEUE', N'MEMORY_ALLOCATION_EXT',
        N'ONDEMAND_TASK_QUEUE', N'PARALLEL_REDO_DRAIN_WORKER',
        N'PARALLEL_REDO_LOG_CACHE', N'PARALLEL_REDO_TRAN_LIST',
        N'PARALLEL_REDO_WORKER_SYNC', N'PARALLEL_REDO_WORKER_WAIT_WORK',
        N'PREEMPTIVE_OS_FLUSHFILEBUFFERS', N'PREEMPTIVE_XE_GETTARGETSTATE',
        N'PVS_PREALLOCATE', N'PWAIT_ALL_COMPONENTS_INITIALIZED',
        N'PWAIT_DIRECTLOGCONSUMER_GETNEXT', N'QDS_PERSIST_TASK_MAIN_LOOP_SLEEP',
        N'QDS_ASYNC_QUEUE', N'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP',
        N'QDS_SHUTDOWN_QUEUE', N'REDO_THREAD_PENDING_WORK',
        N'REQUEST_FOR_DEADLOCK_SEARCH', N'RESOURCE_QUEUE',
        N'SERVER_IDLE_CHECK', N'SLEEP_BPOOL_FLUSH', N'SLEEP_DBSTARTUP',
        N'SLEEP_DCOMSTARTUP', N'SLEEP_MASTERDBREADY', N'SLEEP_MASTERMDREADY',
        N'SLEEP_MASTERUPGRADED', N'SLEEP_MSDBSTARTUP', N'SLEEP_SYSTEMTASK',
        N'SLEEP_TASK', N'SLEEP_TEMPDBSTARTUP', N'SNI_HTTP_ACCEPT',
        N'SOS_WORK_DISPATCHER', N'SP_SERVER_DIAGNOSTICS_SLEEP',
        N'SQLTRACE_BUFFER_FLUSH', N'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
        N'SQLTRACE_WAIT_ENTRIES', N'VDI_CLIENT_OTHER',
        N'WAIT_FOR_RESULTS', N'WAITFOR', N'WAITFOR_TASKSHUTDOWN',
        N'WAIT_XTP_CKPT_CLOSE', N'WAIT_XTP_HOST_WAIT',
        N'WAIT_XTP_OFFLINE_CKPT_NEW_LOG', N'WAIT_XTP_RECOVERY',
        N'XE_BUFFERMGR_ALLPROCESSED_EVENT', N'XE_DISPATCHER_JOIN',
        N'XE_DISPATCHER_WAIT', N'XE_LIVE_TARGET_TVF', N'XE_TIMER_EVENT'
    )
    AND waiting_tasks_count > 0
)
SELECT
    wait_type,
    CAST(wait_time_s AS DECIMAL(16,2))          AS wait_time_s,
    CAST(resource_wait_s AS DECIMAL(16,2))      AS resource_wait_s,
    CAST(signal_wait_time_s AS DECIMAL(16,2))   AS signal_wait_s,
    waiting_tasks_count,
    CAST(pct AS DECIMAL(5,2))                   AS pct,
    CAST(SUM(pct) OVER(ORDER BY rn) AS DECIMAL(5,2)) AS running_pct,
    -- Goi y hanh dong
    CASE
        WHEN wait_type LIKE 'PAGEIOLATCH%'    THEN '→ Kiem tra: 03_check_disk_io.sql + 02_check_memory.sql (PLE)'
        WHEN wait_type = 'WRITELOG'           THEN '→ Kiem tra: Log file I/O trong 03_check_disk_io.sql'
        WHEN wait_type LIKE 'LCK_M_%'        THEN '→ Kiem tra: 04_check_session_blocking.sql'
        WHEN wait_type = 'SOS_SCHEDULER_YIELD' THEN '→ Kiem tra: 01_check_cpu.sql (top CPU queries)'
        WHEN wait_type IN ('CXPACKET','CXCONSUMER') THEN '→ Xem xet: MAXDOP setting hoac query-level MAXDOP hint'
        WHEN wait_type = 'ASYNC_NETWORK_IO'  THEN '→ Kiem tra: Client app cham nhan data, hoac SELECT tra qua nhieu rows'
        WHEN wait_type = 'RESOURCE_SEMAPHORE' THEN '→ NGUY HIEM: 02_check_memory.sql (memory grants)'
        WHEN wait_type = 'THREADPOOL'        THEN '→ NGUY HIEM: Het worker thread, tang max worker threads'
        WHEN wait_type LIKE 'PAGELATCH%'     THEN '→ Hot page contention, xem xet partitioning hoac hash index'
        ELSE ''
    END AS action_goi_y
FROM WaitStats
WHERE rn <= 20  -- Top 20 waits
ORDER BY rn;


-- ============================================================================
-- 2. SIGNAL WAITS RATIO
-- ============================================================================
-- MUC DICH: Xac dinh nhanh CPU co phai bottleneck khong
--
-- signal_wait = thoi gian cho CPU scheduler SAU KHI resource da san sang
-- Neu signal_wait_pct > 15-20% → CPU la bottleneck
--
-- NGUONG:
--   signal_wait_pct < 10%  : CPU OK
--   signal_wait_pct 10-20% : Bat dau busy
--   signal_wait_pct > 20%  : CPU bottleneck → xem 01_check_cpu.sql
-- ============================================================================

SELECT
    CAST(SUM(signal_wait_time_ms) * 100.0 / NULLIF(SUM(wait_time_ms), 0) AS DECIMAL(5,2)) AS signal_wait_pct,
    CASE
        WHEN SUM(signal_wait_time_ms) * 100.0 / NULLIF(SUM(wait_time_ms), 0) > 20
        THEN '!! CPU BOTTLENECK'
        WHEN SUM(signal_wait_time_ms) * 100.0 / NULLIF(SUM(wait_time_ms), 0) > 10
        THEN '! CPU bat dau busy'
        ELSE 'CPU OK'
    END AS trang_thai
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (N'SLEEP_TASK', N'WAITFOR', N'LAZYWRITER_SLEEP',
    N'SQLTRACE_BUFFER_FLUSH', N'REQUEST_FOR_DEADLOCK_SEARCH', N'CLR_AUTO_EVENT');


-- ============================================================================
-- 3. WAIT STATS TAI THOI DIEM NAY (khong phai tich luy)
-- ============================================================================
-- MUC DICH: Xem cac session dang CHO gi TAI THOI DIEM NAY
--           Huu ich khi CPU cao hoac system dang cham NGAY BAY GIO
-- ============================================================================

SELECT
    owt.session_id,
    owt.wait_type,
    owt.wait_duration_ms,
    owt.resource_description,
    owt.blocking_session_id,
    s.login_name,
    s.host_name,
    DB_NAME(r.database_id) AS database_name,
    t.text AS sql_text
FROM sys.dm_os_waiting_tasks owt
    JOIN sys.dm_exec_sessions s ON owt.session_id = s.session_id
    LEFT JOIN sys.dm_exec_requests r ON owt.session_id = r.session_id
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE s.is_user_process = 1
ORDER BY owt.wait_duration_ms DESC;


-- ============================================================================
-- 4. RESET WAIT STATS (chi chay khi can baseline moi)
-- ============================================================================
-- Uncomment dong duoi de reset wait stats va bat dau do tu dau.
-- Huu ich sau khi toi uu xong, muon do lai xem da cai thien chua.
-- DBCC SQLPERF('sys.dm_os_wait_stats', CLEAR);
