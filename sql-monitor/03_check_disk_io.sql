-- ============================================================================
-- FILE: 03_check_disk_io.sql
-- MUC DICH: Giam sat Disk I/O cua SQL Server 2019 Enterprise
-- THOI DIEM CHAY: Khi query cham, PLE thap, hoac nghi ngo disk bottleneck
-- ============================================================================

-- ============================================================================
-- 1. I/O LATENCY THEO FILE (DATABASE FILE LEVEL)
-- ============================================================================
-- MUC DICH: Xem tung file data/log cua moi database co bi I/O cham khong
--           Day la query QUAN TRONG NHAT de xac dinh disk bottleneck
--
-- CAC COT QUAN TRONG:
--   avg_read_latency_ms   : Thoi gian trung binh de doc 1 I/O request
--   avg_write_latency_ms  : Thoi gian trung binh de ghi 1 I/O request
--   avg_io_latency_ms     : Trung binh chung (read + write)
--   io_stall_pct          : % thoi gian SQL Server phai cho I/O
--
-- NGUONG CHO DATA FILE (.mdf/.ndf):
--   avg_read_latency < 5ms    : Tuyet voi (SSD/NVMe)
--   avg_read_latency 5-10ms   : Tot (SAN tot hoac SSD)
--   avg_read_latency 10-20ms  : Chap nhan duoc (HDD RAID)
--   avg_read_latency 20-50ms  : CHAM - Can kiem tra
--   avg_read_latency > 50ms   : RAT CHAM - Bottleneck nghiem trong
--
-- NGUONG CHO LOG FILE (.ldf):
--   avg_write_latency < 2ms   : Tuyet voi
--   avg_write_latency 2-5ms   : Tot
--   avg_write_latency 5-15ms  : Chap nhan
--   avg_write_latency > 15ms  : CHAM - Anh huong den moi transaction
--
-- LUU Y:
--   - Gia tri la TICH LUY tu luc restart SQL Server, khong phai realtime
--   - Nen so sanh tuong doi giua cac file, khong phai gia tri tuyet doi
--   - Log file write latency quan trong hon data file vi moi COMMIT deu ghi log
-- ============================================================================

SELECT
    DB_NAME(vfs.database_id)                           AS database_name,
    mf.name                                            AS logical_file_name,
    mf.physical_name,
    mf.type_desc                                       AS file_type,  -- ROWS = data, LOG = log

    -- Read metrics
    vfs.num_of_reads,
    vfs.num_of_bytes_read / 1024 / 1024                AS read_mb,
    CASE WHEN vfs.num_of_reads > 0
        THEN vfs.io_stall_read_ms / vfs.num_of_reads
        ELSE 0
    END                                                AS avg_read_latency_ms,

    -- Write metrics
    vfs.num_of_writes,
    vfs.num_of_bytes_written / 1024 / 1024             AS write_mb,
    CASE WHEN vfs.num_of_writes > 0
        THEN vfs.io_stall_write_ms / vfs.num_of_writes
        ELSE 0
    END                                                AS avg_write_latency_ms,

    -- Overall
    CASE WHEN (vfs.num_of_reads + vfs.num_of_writes) > 0
        THEN vfs.io_stall / (vfs.num_of_reads + vfs.num_of_writes)
        ELSE 0
    END                                                AS avg_io_latency_ms,

    vfs.io_stall                                       AS total_io_stall_ms,

    -- Danh gia
    CASE
        WHEN mf.type_desc = 'ROWS' AND vfs.num_of_reads > 0
             AND vfs.io_stall_read_ms / vfs.num_of_reads > 50
            THEN '!! DATA READ RAT CHAM'
        WHEN mf.type_desc = 'ROWS' AND vfs.num_of_reads > 0
             AND vfs.io_stall_read_ms / vfs.num_of_reads > 20
            THEN '! DATA READ CHAM'
        WHEN mf.type_desc = 'LOG' AND vfs.num_of_writes > 0
             AND vfs.io_stall_write_ms / vfs.num_of_writes > 15
            THEN '!! LOG WRITE CHAM - Anh huong moi transaction'
        WHEN mf.type_desc = 'LOG' AND vfs.num_of_writes > 0
             AND vfs.io_stall_write_ms / vfs.num_of_writes > 5
            THEN '! LOG WRITE CAN THEO DOI'
        ELSE 'OK'
    END                                                AS trang_thai
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
    JOIN sys.master_files mf
        ON vfs.database_id = mf.database_id
        AND vfs.file_id = mf.file_id
ORDER BY vfs.io_stall DESC;


-- ============================================================================
-- 2. PENDING I/O REQUESTS (I/O dang cho xu ly)
-- ============================================================================
-- MUC DICH: Xem co bao nhieu I/O request dang cho disk xu ly TAI THOI DIEM NAY
--           Khac voi query 1 (tich luy), query nay la snapshot hien tai
--
-- NGUONG:
--   Tong pending I/O > 10        : Disk dang chiu tai
--   io_pending_ms_ticks > 100    : I/O request cu the bi cho lau
--   Nhieu pending tren 1 file    : File do tren disk cham
--
-- ACTION:
--   1. Kiem tra disk queue length trong Performance Monitor
--   2. Xem co job backup/maintenance dang chay khong
--   3. Chuyen file sang disk nhanh hon (SSD/NVMe)
-- ============================================================================

SELECT
    DB_NAME(vfs.database_id)       AS database_name,
    mf.name                        AS logical_file_name,
    mf.physical_name,
    pio.io_type,
    pio.io_pending_ms_ticks        AS pending_ms,
    CASE
        WHEN pio.io_pending_ms_ticks > 1000 THEN '!! I/O cho qua lau'
        WHEN pio.io_pending_ms_ticks > 100  THEN '! Dang cho'
        ELSE 'OK'
    END AS trang_thai
FROM sys.dm_io_pending_io_requests pio
    JOIN sys.dm_io_virtual_file_stats(NULL, NULL) vfs
        ON pio.io_handle = vfs.file_handle
    JOIN sys.master_files mf
        ON vfs.database_id = mf.database_id
        AND vfs.file_id = mf.file_id
ORDER BY pio.io_pending_ms_ticks DESC;


-- ============================================================================
-- 3. TOP DATABASE THEO I/O TIEU THU
-- ============================================================================
-- MUC DICH: Xem database nao tieu thu nhieu I/O nhat
--           Giup quyet dinh database nao can toi uu truoc
-- ============================================================================

SELECT
    DB_NAME(database_id)                                    AS database_name,
    SUM(num_of_reads)                                       AS total_reads,
    SUM(num_of_writes)                                      AS total_writes,
    SUM(num_of_bytes_read) / 1024 / 1024                    AS total_read_mb,
    SUM(num_of_bytes_written) / 1024 / 1024                 AS total_write_mb,
    SUM(io_stall) / 1000                                    AS total_io_stall_seconds,
    SUM(io_stall_read_ms) / NULLIF(SUM(num_of_reads), 0)   AS avg_read_latency_ms,
    SUM(io_stall_write_ms) / NULLIF(SUM(num_of_writes), 0) AS avg_write_latency_ms
FROM sys.dm_io_virtual_file_stats(NULL, NULL)
GROUP BY database_id
ORDER BY SUM(io_stall) DESC;


-- ============================================================================
-- 4. KIEM TRA FILE GROWTH EVENTS (tu dong mo rong file)
-- ============================================================================
-- MUC DICH: File growth gay I/O spike va blocking trong thoi gian ngan
--           Nen pre-allocate file size du lon de tranh auto-growth
--
-- NGUONG:
--   Growth event > 5 lan/ngay   : File size dang nho, can tang
--   Duration > 1000ms           : Growth cham, co the do disk cham
--
-- ACTION:
--   1. Tang initial size cua file du lon (du lieu 3-6 thang)
--   2. Set growth = 512MB hoac 1GB (tranh growth nho 10% lien tuc)
--   3. Bat Instant File Initialization (chi ap dung data file, khong ap dung log)
--      → Grant 'Perform volume maintenance tasks' cho SQL Server service account
-- ============================================================================

-- Xem lich su growth events tu Default Trace
DECLARE @trace_path NVARCHAR(260);
SELECT @trace_path = REVERSE(SUBSTRING(REVERSE(path),
    CHARINDEX('\', REVERSE(path)), LEN(path))) + N'log.trc'
FROM sys.traces
WHERE is_default = 1;

SELECT
    te.name                          AS event_name,
    DB_NAME(t.DatabaseID)            AS database_name,
    t.FileName                       AS file_name,
    t.Duration / 1000                AS duration_ms,
    t.StartTime,
    t.EndTime,
    (t.IntegerData * 8) / 1024      AS growth_mb
FROM sys.fn_trace_gettable(@trace_path, DEFAULT) t
    JOIN sys.trace_events te ON t.EventClass = te.trace_event_id
WHERE te.name IN ('Data File Auto Grow', 'Log File Auto Grow',
                   'Data File Auto Shrink', 'Log File Auto Shrink')
ORDER BY t.StartTime DESC;


-- ============================================================================
-- 5. KIEM TRA FILE SIZE VA FREE SPACE
-- ============================================================================
-- MUC DICH: Xem con bao nhieu dung luong trong cua tung file
--
-- NGUONG:
--   Free space < 10%    : Can mo rong file hoac disk
--   Free space < 5%     : KHAN CAP - Co the gay loi khi het dung luong
-- ============================================================================

SELECT
    DB_NAME(database_id)                             AS database_name,
    name                                             AS logical_name,
    type_desc,
    physical_name,
    size * 8 / 1024                                  AS size_mb,
    FILEPROPERTY(name, 'SpaceUsed') * 8 / 1024       AS used_mb,
    (size - FILEPROPERTY(name, 'SpaceUsed')) * 8 / 1024 AS free_mb,
    CASE
        WHEN size > 0
        THEN CAST(100.0 * (size - FILEPROPERTY(name, 'SpaceUsed')) / size AS DECIMAL(5,1))
        ELSE 0
    END                                              AS free_pct,
    CASE max_size
        WHEN -1 THEN 'UNLIMITED'
        WHEN 0 THEN 'NO GROWTH'
        ELSE CAST(max_size * 8 / 1024 AS VARCHAR(20)) + ' MB'
    END                                              AS max_size_config,
    CASE
        WHEN is_percent_growth = 1
        THEN CAST(growth AS VARCHAR(10)) + '%  !! Nen doi sang MB co dinh'
        ELSE CAST(growth * 8 / 1024 AS VARCHAR(10)) + ' MB'
    END                                              AS growth_config
FROM sys.database_files
ORDER BY type_desc, size DESC;
