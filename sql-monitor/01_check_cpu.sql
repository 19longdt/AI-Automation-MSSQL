-- ============================================================================
-- FILE: 01_check_cpu.sql
-- MUC DICH: Giam sat CPU cua SQL Server 2019 Enterprise
-- THOI DIEM CHAY: Khi nghi ngo CPU cao, hoac chay dinh ky moi 5-10 phut
-- ============================================================================

-- ============================================================================
-- 1. CPU HIEN TAI (snapshot): SQL Server vs Other Processes vs Idle
-- ============================================================================
-- NGUON DU LIEU: sys.dm_os_ring_buffers luu lai lich su scheduler event
-- SQL Server tu ghi nhan CPU usage moi ~1 phut vao ring buffer nay
--
-- CAC COT QUAN TRONG:
--   sql_cpu           : % CPU do SQL Server su dung
--   other_process_cpu : % CPU do cac process khac (OS, antivirus, backup agent...)
--   idle_cpu          : % CPU ranh roi
--   total_cpu         : tong % CPU dang su dung (sql + other)
--
-- NGUONG CANH BAO:
--   sql_cpu > 80%     : SQL Server dang chiu tai nang → tim top query ton CPU
--   other_process_cpu > 30% : Co process khac tranh CPU voi SQL → kiem tra Task Manager
--   idle_cpu < 10%    : May chu qua tai, can tang CPU hoac toi uu query
--   sql_cpu cao + idle_cpu thap : Query performance issue, khong phai thieu hardware
--
-- LUU Y:
--   - Ring buffer chi luu khoang 4 tieng gan nhat
--   - Gia tri la trung binh trong khoang 1 phut, khong phai realtime chinh xac
--   - Tren VM, gia tri nay co the khong chinh xac neu host overcommit CPU
-- ============================================================================

WITH CPU_Usage AS (
    SELECT
        record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu_utilization,
        record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')         AS system_idle,
        100 - record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')
            - record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS other_cpu_utilization,
        [timestamp]
    FROM (
        SELECT
            [timestamp],
            CONVERT(XML, record) AS record
        FROM sys.dm_os_ring_buffers
        WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
          AND record LIKE N'%<SystemHealth>%'
    ) AS ring
)
SELECT TOP 1
    sql_cpu_utilization                            AS sql_cpu,
    other_cpu_utilization                          AS other_process_cpu,
    system_idle                                    AS idle_cpu,
    sql_cpu_utilization + other_cpu_utilization     AS total_cpu,
    CASE
        WHEN sql_cpu_utilization > 80 THEN '!! CAO - Kiem tra top query CPU'
        WHEN sql_cpu_utilization > 60 THEN '! CANH BAO - Theo doi them'
        ELSE 'OK'
    END AS trang_thai,
    [timestamp]
FROM CPU_Usage
ORDER BY [timestamp] DESC;


-- ============================================================================
-- 2. LICH SU CPU 30 PHUT GAN NHAT (trend)
-- ============================================================================
-- MUC DICH: Xem xu huong CPU de phan biet:
--   - Spike dot ngot (1 query xau) vs Sustained high (qua tai chung)
--   - Thoi diem bat dau tang CPU de correlate voi deployment/job/batch
--
-- CACH DOC:
--   Neu sql_cpu nhay tu 20% len 90% tai 1 thoi diem → tim query bat dau chay luc do
--   Neu sql_cpu duy tri > 70% lien tuc → can review toan bo workload
-- ============================================================================

WITH CPU_History AS (
    SELECT
        record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu,
        100 - record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')
            - record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS other_cpu,
        record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')         AS idle_cpu,
        [timestamp],
        DATEADD(ms, -1 * (sys.ms_ticks - [timestamp]), GETDATE()) AS event_time
    FROM (
        SELECT
            [timestamp],
            CONVERT(XML, record) AS record
        FROM sys.dm_os_ring_buffers
        WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
          AND record LIKE N'%<SystemHealth>%'
    ) AS ring
    CROSS JOIN sys.dm_os_sys_info sys
)
SELECT TOP 30
    event_time,
    sql_cpu,
    other_cpu,
    idle_cpu,
    REPLICATE('|', sql_cpu / 2) AS sql_cpu_bar  -- visual bar chart trong SSMS
FROM CPU_History
ORDER BY event_time DESC;


-- ============================================================================
-- 3. TOP 10 QUERY TON CPU NHAT HIEN TAI (dang chay)
-- ============================================================================
-- MUC DICH: Khi CPU cao, day la query dau tien can chay de tim thu pham
--
-- CAC COT QUAN TRONG:
--   cpu_time_ms     : Tong CPU time tieu thu (co the > elapsed neu parallel)
--   elapsed_ms      : Thoi gian tu luc bat dau chay
--   worker_time     : = cpu_time, thoi gian thuc su chay tren CPU scheduler
--
-- NGUONG:
--   cpu_time > 30s   : Query can optimize khan cap
--   cpu_time > elapsed_time : Query chay parallel (DOP > 1), co the can MAXDOP hint
--
-- ACTION:
--   1. Xem query_plan → tim Table Scan, Missing Index, Hash Join lon
--   2. Neu la stored proc → xem co bi parameter sniffing khong (RECOMPILE)
--   3. Neu la ad-hoc query → can parameterize hoac tao stored proc
-- ============================================================================

SELECT TOP 100
    r.session_id,
    r.status,
    r.command,
    DB_NAME(r.database_id)            AS database_name,
    s.login_name,
    s.host_name,
    r.cpu_time                        AS cpu_time_ms,
    r.total_elapsed_time              AS elapsed_ms,
    r.logical_reads,
    r.reads                           AS physical_reads,
    r.writes,
    r.wait_type,
    r.wait_time                       AS wait_ms,
    t.text                            AS sql_text,
    qp.query_plan                     AS xml_query_plan
FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
    OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) AS qp
WHERE s.is_user_process = 1
  AND r.session_id <> @@SPID
ORDER BY r.cpu_time DESC;


-- ============================================================================
-- 4. TOP QUERY TON CPU NHAT TRONG PLAN CACHE (lich su tich luy)
-- ============================================================================
-- MUC DICH: Tim cac query thuong xuyen ton CPU nhat ke tu lan compile cuoi
--           Khac voi query 3 (chi xem dang chay), query nay xem tong tich luy
--
-- CAC COT QUAN TRONG:
--   total_worker_time   : Tong CPU time tich luy qua moi lan chay
--   execution_count     : So lan chay → query chay nhieu x CPU vua = anh huong lon
--   avg_cpu_ms          : CPU trung binh moi lan chay
--
-- NGUONG:
--   avg_cpu_ms > 1000   : Query nang, can xem plan
--   execution_count > 10000 va avg_cpu_ms > 100 : Query chay qua nhieu, toi uu nho cung co hieu qua lon
--
-- LUU Y:
--   - Plan cache bi xoa khi: restart SQL, DBCC FREEPROCCACHE, memory pressure
--   - Gia tri la tich luy ke tu lan compile, khong phai tu restart SQL Server
-- ============================================================================

SELECT TOP 20
    qs.total_worker_time / 1000                        AS total_cpu_ms,
    qs.execution_count,
    qs.total_worker_time / qs.execution_count / 1000   AS avg_cpu_ms,
    qs.total_elapsed_time / qs.execution_count / 1000  AS avg_elapsed_ms,
    qs.total_logical_reads / qs.execution_count        AS avg_logical_reads,
    qs.creation_time                                   AS plan_compiled_time,
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
ORDER BY avg_elapsed_ms DESC;


-- ============================================================================
-- 5. SCHEDULER HEALTH - Kiem tra co bi CPU starvation khong
-- ============================================================================
-- MUC DICH: Khi CPU cao nhung khong thay query nao noi bat
--           → co the do qua nhieu query nho tranh nhau scheduler
--
-- CAC COT QUAN TRONG:
--   current_tasks_count   : So task dang cho tren scheduler nay
--   runnable_tasks_count  : So task san sang chay nhung chua duoc cap CPU
--   active_workers_count  : So worker thread dang active
--   work_queue_count      : So task cho worker thread (>0 = thieu worker)
--
-- NGUONG:
--   runnable_tasks_count > 10  : CPU starvation, nhieu query xep hang cho CPU
--   work_queue_count > 0       : Thieu worker thread → tang max worker threads
--   pending_disk_io_count > 5  : I/O bottleneck anh huong scheduler
-- ============================================================================

SELECT
    scheduler_id,
    cpu_id,
    status,
    current_tasks_count,
    runnable_tasks_count,
    active_workers_count,
    work_queue_count,
    pending_disk_io_count
FROM sys.dm_os_schedulers
WHERE status = 'VISIBLE ONLINE'
ORDER BY runnable_tasks_count DESC;
