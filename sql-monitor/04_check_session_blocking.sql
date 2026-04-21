-- ============================================================================
-- FILE: 04_check_session_blocking.sql
-- MUC DICH: Giam sat Blocking, Deadlock va Session co van de
-- THOI DIEM CHAY: Khi ung dung bi treo, timeout, hoac performance degradation
-- ============================================================================

-- ============================================================================
-- 1. BLOCKING CHAIN HIEN TAI
-- ============================================================================
-- MUC DICH: Tim tat ca cac session dang bi block va session gay ra blocking
--           Day la query QUAN TRONG NHAT khi ung dung bi treo
--
-- CAC COT QUAN TRONG:
--   blocking_session_id  : Session dang block session hien tai (0 = khong bi block)
--   wait_type            : Loai resource dang cho
--   wait_time_ms         : Thoi gian da cho (cang lau cang nguy hiem)
--   wait_resource        : Resource cu the dang cho (table, page, key...)
--
-- WAIT TYPE THUONG GAP:
--   LCK_M_S   : Cho Shared lock (SELECT bi block boi UPDATE/DELETE)
--   LCK_M_X   : Cho Exclusive lock (UPDATE bi block boi session khac)
--   LCK_M_U   : Cho Update lock
--   LCK_M_IX  : Cho Intent Exclusive
--   LCK_M_SCH_M : Cho Schema Modification lock (ALTER TABLE bi block)
--
-- NGUONG:
--   wait_time > 30s   : Session bi block lau, can kiem tra
--   wait_time > 300s  : NGUY HIEM - Co the gay cascading blocking
--   So session bi block > 10 : Head blocker dang anh huong dien rong
--
-- ACTION:
--   1. Tim head blocker (session khong bi ai block nhung block nhieu session khac)
--   2. Xem head blocker dang chay query gi
--   3. Quyet dinh KILL head blocker neu can thiet (KILL session_id)
--   4. Sau khi giai quyet: review query/index de tranh tai dien
-- ============================================================================

-- 1a. Tat ca session dang bi block
SELECT
    r.session_id                          AS blocked_session_id,
    r.status,
    r.command,
    DB_NAME(r.database_id)                AS database_name,
    r.blocking_session_id                 AS blocker_session_id,
    r.wait_type,
    r.wait_time                           AS wait_time_ms,
    r.wait_time / 1000                    AS wait_time_seconds,
    r.wait_resource,
    s.login_name                          AS blocked_login,
    s.host_name                           AS blocked_host,
    s.program_name                        AS blocked_program,
    t.text                                AS blocked_sql,
    CASE
        WHEN r.wait_time > 300000 THEN '!! BLOCK > 5 PHUT - Xem xet KILL blocker'
        WHEN r.wait_time > 30000  THEN '! Block > 30s - Theo doi'
        ELSE 'Moi block'
    END AS trang_thai
FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.blocking_session_id > 0
ORDER BY r.wait_time DESC;


-- 1b. HEAD BLOCKER: Session gay ra blocking nhung ban than khong bi block
-- Day la session can xem xet KILL neu can thiet
SELECT
    s.session_id                          AS head_blocker_session_id,
    s.login_name,
    s.host_name,
    s.program_name,
    s.status,
    s.last_request_start_time,
    s.open_transaction_count,
    COUNT(br.session_id)                  AS num_sessions_blocked,  -- So session bi block boi no
    COALESCE(t.text, '[No active request]') AS blocker_sql,
    CASE
        WHEN s.open_transaction_count > 0 AND r.session_id IS NULL
        THEN '!! SLEEPING voi OPEN TRANSACTION - Rat nguy hiem!'
        ELSE 'Dang chay query'
    END AS trang_thai
FROM sys.dm_exec_sessions s
    -- Tim cac session dang bi block boi session nay
    JOIN sys.dm_exec_requests br ON br.blocking_session_id = s.session_id
    -- Kiem tra xem head blocker co dang chay request khong
    LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
    -- Lay SQL text cua head blocker (neu co)
    OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE NOT EXISTS (
    -- Chi lay head blocker: session khong bi ai block
    SELECT 1 FROM sys.dm_exec_requests r2
    WHERE r2.session_id = s.session_id AND r2.blocking_session_id > 0
)
GROUP BY s.session_id, s.login_name, s.host_name, s.program_name,
         s.status, s.last_request_start_time, s.open_transaction_count,
         t.text, r.session_id
ORDER BY num_sessions_blocked DESC;


-- ============================================================================
-- 2. OPEN TRANSACTIONS (Transaction chua commit/rollback)
-- ============================================================================
-- MUC DICH: Tim session co transaction mo nhung khong lam gi (sleeping)
--           Day la nguyen nhan #1 gay blocking lau va log file phinh to
--
-- NGUYEN NHAN THUONG GAP:
--   - Ung dung bat dau transaction nhung khong commit (bug code)
--   - Developer mo transaction trong SSMS roi quen commit
--   - Connection pool giu connection co open transaction
--
-- NGUONG:
--   open_tran > 0 va status = 'sleeping'  : NGUY HIEM
--   open_tran > 0 va last_request > 5 phut : Rat co the la orphaned transaction
--
-- ACTION:
--   1. Lien he application owner de fix code (commit/rollback dung cach)
--   2. Neu khan cap: KILL session_id (transaction se bi rollback)
--   3. Xem xet set lock_timeout trong ung dung
-- ============================================================================

SELECT
    s.session_id,
    s.login_name,
    s.host_name,
    s.program_name,
    s.status,
    s.open_transaction_count,
    s.last_request_start_time,
    s.last_request_end_time,
    DATEDIFF(MINUTE, s.last_request_end_time, GETDATE()) AS idle_minutes,
    CASE
        WHEN s.status = 'sleeping' AND s.open_transaction_count > 0
             AND DATEDIFF(MINUTE, s.last_request_end_time, GETDATE()) > 5
        THEN '!! SLEEPING + OPEN TRAN > 5 phut - Xem xet KILL'
        WHEN s.status = 'sleeping' AND s.open_transaction_count > 0
        THEN '! Sleeping voi open transaction'
        ELSE 'OK - Dang active'
    END AS trang_thai,
    -- Lay SQL cuoi cung da chay (de biet session dang lam gi)
    (SELECT TOP 1 t.text
     FROM sys.dm_exec_connections c
         CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
     WHERE c.session_id = s.session_id) AS last_sql_text
FROM sys.dm_exec_sessions s
WHERE s.is_user_process = 1
  AND s.open_transaction_count > 0
ORDER BY s.last_request_end_time ASC;


-- ============================================================================
-- 3. LOCK DETAIL (Chi tiet lock hien tai)
-- ============================================================================
-- MUC DICH: Xem chi tiet cac lock dang duoc giu
--           Chay khi muon hieu blocking dang xay ra tren resource nao
--
-- LOCK MODE:
--   S  (Shared)    : Doc data, khong block S khac nhung block X
--   X  (Exclusive) : Ghi data, block tat ca lock khac
--   U  (Update)    : Chuan bi update, block U va X khac
--   IS (Intent Shared)    : Co y dinh lay S lock o level thap hon
--   IX (Intent Exclusive) : Co y dinh lay X lock o level thap hon
--   Sch-S (Schema Stability) : Query dang doc schema
--   Sch-M (Schema Modification) : ALTER TABLE, block moi thu
--
-- LOCK RESOURCE TYPE:
--   DATABASE : Lock tren toan database
--   OBJECT   : Lock tren table/index
--   PAGE     : Lock tren 1 page (8KB)
--   KEY      : Lock tren 1 row trong index
--   RID      : Lock tren 1 row trong heap
--
-- ESCALATION LUU Y:
--   SQL Server tu dong escalate lock: KEY/RID → PAGE → OBJECT
--   Khi 1 transaction giu > 5000 locks tren 1 table → escalate thanh table lock
--   Table lock = block moi query khac tren table do
-- ============================================================================

SELECT
    l.request_session_id              AS session_id,
    DB_NAME(l.resource_database_id)   AS database_name,
    l.resource_type,
    l.resource_description,
    l.request_mode                    AS lock_mode,
    l.request_status,                 -- GRANT = da co lock, WAIT = dang cho, CONVERT = doi chuyen doi
    l.request_owner_type,
    OBJECT_NAME(p.object_id, l.resource_database_id) AS table_name,
    p.index_id
FROM sys.dm_tran_locks l
    LEFT JOIN sys.partitions p
        ON l.resource_associated_entity_id = p.hobt_id
        AND l.resource_type IN ('KEY', 'PAGE', 'RID', 'HOBT')
WHERE l.request_session_id <> @@SPID
  AND l.resource_database_id = DB_ID()  -- Chi xem database hien tai
  AND l.resource_type <> 'DATABASE'     -- Bo qua database-level lock
ORDER BY l.request_session_id, l.resource_type;


-- ============================================================================
-- 4. DEADLOCK INFORMATION (tu System Health)
-- ============================================================================
-- MUC DICH: Xem cac deadlock da xay ra gan day
--           SQL Server 2019 tu dong luu deadlock graph vao system_health session
--
-- DEADLOCK LA GI:
--   Session A giu lock 1, cho lock 2
--   Session B giu lock 2, cho lock 1
--   → Khong ai nhuong ai → SQL Server chon 1 session lam "victim" va rollback no
--
-- ACTION SAU KHI TIM THAY DEADLOCK:
--   1. Doc deadlock graph XML → xem 2 query dang conflict
--   2. Sua thu tu truy cap table cho nhat quan (A→B luon truoc B→A)
--   3. Giam thoi gian giu lock (transaction ngan hon, index tot hon)
--   4. Dung READ COMMITTED SNAPSHOT ISOLATION neu phu hop
-- ============================================================================

;WITH deadlock_events AS (
    SELECT
        xed.value('@timestamp', 'datetime2') AS deadlock_time,
        xed.query('.')                        AS deadlock_graph
    FROM (
        SELECT CAST(target_data AS XML) AS target_data
        FROM sys.dm_xe_session_targets st
            JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
        WHERE s.name = 'system_health'
          AND st.target_name = 'ring_buffer'
    ) AS data
    CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xed(xed)
)
SELECT TOP 20
    deadlock_time,
    deadlock_graph  -- Click vao de xem XML trong SSMS
FROM deadlock_events
ORDER BY deadlock_time DESC;
