"""
seed_topics.py — Seed toàn bộ monitoring topics vào MongoDB.

Chạy một lần trước khi start service lần đầu, hoặc chạy lại để update config.
Idempotent: dùng upsert theo topic_id — chạy nhiều lần không tạo duplicate.

Cách chạy:
    python -m layer1.seed.seed_topics                          # seed tất cả
    python -m layer1.seed.seed_topics --topic blocking         # 1 topic
    python -m layer1.seed.seed_topics --topic blocking,deadlock  # nhiều topics
    python -m layer1.seed.seed_topics --topic blocking --dry-run

Topics được seed:
    1.  ag_health          — AG Health & CDC (2 phút)
    2.  blocking           — Blocking Chain, head-blocker-centric (1 phút)
    2b. deadlock           — Deadlock từ System Health XEvent (5 phút)
    3.  blocked_query      — Blocked Query Snapshot (DISABLED — defer)
    4.  slow_sessions         — Slow Query / Baseline (5 phút)
    5.  plan_regression    — Plan Regression (5 phút)
    6.  plan_instability   — Plan Instability (5 phút)
    7.  index_usage        — Non-Optimal Index Usage (5 phút)
    8.  high_variation     — High Variation Query (5 phút)
    9.  tempdb_memory      — TempDB & Memory Pressure (5 phút)
    10. wait_stats         — Wait Statistics Anomaly (5 phút)
    11. agent_maintenance  — SQL Agent Jobs & Backup (10 phút)
    12. missing_index      — Missing Index Detector (1 giờ)
    13. resource_governor  — Resource Governor Monitor (5 phút)
    14. index_fragmentation — Index Fragmentation (hàng ngày 3AM — cron)
"""
from __future__ import annotations

import logging
import sys

from ..config import settings
from ..models.topic_constants import (
    TOPIC_AG_HEALTH,
    TOPIC_AG_REDO_SECONDARY,
    TOPIC_AGENT_MAINTENANCE,
    TOPIC_BLOCKED_QUERY,
    TOPIC_BLOCKING,
    TOPIC_DEADLOCK,
    TOPIC_HIGH_VARIATION,
    TOPIC_INDEX_FRAGMENTATION,
    TOPIC_INDEX_USAGE,
    TOPIC_MISSING_INDEX,
    TOPIC_PLAN_INSTABILITY,
    TOPIC_PLAN_REGRESSION,
    TOPIC_RESOURCE_GOVERNOR,
    TOPIC_slow_sessions,
    TOPIC_TEMPDB_MEMORY,
    TOPIC_WAIT_STATS,
)
from ..storage.mongo_client import MongoConnection
from ..storage.repositories.topic_repo import TopicRepo
from ..models.topic import (
    AnalysisConfig,
    BaselineConfig,
    MonitorTopic,
    QueryConfig,
    ThresholdConfig,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Topic definitions
# ─────────────────────────────────────────────────────────────────────────────

def _all_topics() -> list[MonitorTopic]:
    return [
        _ag_health(),
        _ag_redo_secondary(),
        _blocking(),
        _deadlock(),
        _blocked_query(),
        _slow_sessions(),
        _plan_regression(),
        _plan_instability(),
        _index_usage(),
        _high_variation(),
        _tempdb_memory(),
        _wait_stats(),
        _agent_maintenance(),
        _missing_index(),
        _resource_governor(),
        _index_fragmentation(),
    ]


# ── 1. AG Health & CDC ───────────────────────────────────────────────────────

def _ag_health() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_AG_HEALTH,
        display_name="AG Health & CDC Monitor",
        enabled=True,
        schedule_sec=120,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="ag_sync_state",
                description="AG replica sync state, suspend/failover/connected + lag queues (view từ Primary)",
                sql="""
SELECT TOP 20
    ar.replica_server_name,
    DB_NAME(drs.database_id)            AS database_name,
    ars.role_desc,
    ars.connected_state_desc,
    ars.operational_state_desc,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    drs.is_suspended,
    CASE drs.suspend_reason
        WHEN 0 THEN 'USER'    WHEN 1 THEN 'PARTNER' WHEN 2 THEN 'REDO'
        WHEN 3 THEN 'APPLY'   WHEN 4 THEN 'CAPTURE' WHEN 5 THEN 'RESTART'
        WHEN 6 THEN 'UNDO'    WHEN 7 THEN 'REVALIDATION' ELSE NULL
    END                                  AS suspend_reason_desc,
    dcs.is_failover_ready,
    drs.log_send_queue_size,
    drs.log_send_rate,
    drs.redo_queue_size,
    drs.redo_rate,
    drs.last_commit_time
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar
    ON drs.replica_id = ar.replica_id
JOIN sys.dm_hadr_availability_replica_states ars
    ON drs.replica_id = ars.replica_id
LEFT JOIN sys.dm_hadr_database_replica_cluster_states dcs
    ON drs.group_database_id = dcs.group_database_id
   AND drs.replica_id = dcs.replica_id
WHERE drs.is_local = 0
""",
                timeout_sec=30,
            ),
            QueryConfig(
                query_id="cdc_jobs",
                description="CDC capture va cleanup job status",
                sql="""
SELECT TOP 20
    j.name AS job_name,
    j.enabled,
    jh.run_status,         -- 0=Failed, 1=Succeeded, 2=Retry, 3=Cancelled
    -- run_status là enum (không phải thang liên tục) → threshold range không biểu diễn
    -- được. Tách thành flag boolean để detector "cao=tệ" chạy đúng: chỉ Failed(0) →
    -- critical, Retry(2) → warning; Succeeded(1)/Cancelled(3) không sinh finding.
    CASE WHEN jh.run_status = 0 THEN 1 ELSE 0 END AS cdc_job_failed,
    CASE WHEN jh.run_status = 2 THEN 1 ELSE 0 END AS cdc_job_retry,
    jh.run_date,
    jh.run_time,
    jh.run_duration,
    jh.message
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobhistory jh
    ON j.job_id = jh.job_id
WHERE j.name LIKE 'cdc.%'
  AND jh.step_id = 0
  AND jh.run_date >= CAST(CONVERT(VARCHAR, GETDATE(), 112) AS INT)
ORDER BY jh.run_date DESC, jh.run_time DESC
""",
                timeout_sec=20,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "log_send_queue_size": ThresholdConfig(warning=500, critical=1000),
            "is_suspended": ThresholdConfig(warning=1, critical=1),
            "cdc_job_failed": ThresholdConfig(warning=1, critical=1),
            "cdc_job_retry": ThresholdConfig(warning=1, critical=2),
        },
        extra={
            "issue_type_map": {
                "log_send_queue_size": "ag_lag",
                "is_suspended": "ag_lag",
                "cdc_job_failed": "cdc_failure",
                "cdc_job_retry": "cdc_failure",
            },
        },
        analysis_config=AnalysisConfig(
            context=(
                "AG replica sync health + CDC job status (view từ Primary). "
                "is_suspended=1 = data movement đã dừng (xem suspend_reason_desc) - nguy hiểm nhất. "
                "connected_state_desc=DISCONNECTED = replica rớt kết nối. "
                "is_failover_ready=0 = không failover an toàn được. "
                "log_send_queue lớn = primary gửi log chậm/secondary nhận chậm. "
                "CDC run_status=0 (Failed) làm version store TempDB phình + capture latency tăng. "
                "Redo lag chi tiết xem topic ag_redo_secondary (đo cục bộ trên secondary)."
            ),
            focus_metrics=[
                "synchronization_state_desc", "synchronization_health_desc",
                "is_suspended", "suspend_reason_desc", "connected_state_desc",
                "operational_state_desc", "is_failover_ready",
                "log_send_queue_size", "last_commit_time",
                "job_name", "run_status", "cdc_job_failed", "cdc_job_retry",
                "run_duration", "message",
            ],
        ),
    )


# ── 1b. AG Redo Lag Monitor (Secondary, đo cục bộ) ──────────────────────────

def _ag_redo_secondary() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_AG_REDO_SECONDARY,
        display_name="AG Redo Lag Monitor (Secondary local)",
        enabled=True,
        schedule_sec=120,
        nodes=["secondary"],
        queries=[QueryConfig(
            query_id="redo_state_local",
            description="Redo queue/rate + secondary_lag_seconds đo cục bộ trên secondary (is_local=1)",
            sql="""
SELECT TOP 20
    ar.replica_server_name,
    DB_NAME(drs.database_id)            AS database_name,
    drs.synchronization_state_desc,
    drs.synchronization_health_desc,
    drs.is_suspended,
    CASE drs.suspend_reason
        WHEN 0 THEN 'USER'    WHEN 1 THEN 'PARTNER' WHEN 2 THEN 'REDO'
        WHEN 3 THEN 'APPLY'   WHEN 4 THEN 'CAPTURE' WHEN 5 THEN 'RESTART'
        WHEN 6 THEN 'UNDO'    WHEN 7 THEN 'REVALIDATION' ELSE NULL
    END                                  AS suspend_reason_desc,
    drs.redo_queue_size,
    drs.redo_rate,
    drs.secondary_lag_seconds,
    drs.last_redone_time,
    drs.last_commit_time
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar
    ON drs.replica_id = ar.replica_id
WHERE drs.is_local = 1
""",
            timeout_sec=30,
        )],
        detector_type="threshold",
        thresholds={
            "redo_queue_size": ThresholdConfig(warning=1000, critical=5000),
            "secondary_lag_seconds": ThresholdConfig(warning=30, critical=120),
        },
        extra={
            "issue_type_map": {
                "redo_queue_size": "ag_lag",
                "secondary_lag_seconds": "ag_lag",
            },
        },
        analysis_config=AnalysisConfig(
            context=(
                "Redo lag đo cục bộ trên từng readable secondary (is_local=1) - chính xác hơn view từ primary. "
                "redo_queue lớn + redo_rate thấp = redo thread nghẽn (CPU/IO secondary hoặc bị read query block). "
                "secondary_lag_seconds = thời gian secondary trễ so với primary (RPO khi đọc trên secondary)."
            ),
            focus_metrics=[
                "redo_queue_size", "redo_rate", "secondary_lag_seconds",
                "synchronization_state_desc", "is_suspended", "suspend_reason_desc",
                "last_redone_time",
            ],
        ),
    )


# ── 2. Blocking Chain (head-blocker-centric) ─────────────────────────────────
# 3 queries BẮT BUỘC cùng 1 topic: detector correlate session_id giữa
# victim ↔ head blocker ↔ locks — chỉ có nghĩa khi cùng 1 snapshot
# (execute_batch chạy liền nhau trên 1 connection).
# Deadlock đã tách sang topic riêng `deadlock` (data lịch sử, XML parse nặng).

def _blocking() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_BLOCKING,
        display_name="Blocking Chain Monitor (Head Blocker)",
        enabled=True,
        schedule_sec=60,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="blocking_sessions",
                description="Victims — sessions đang bị block, có chain info",
                sql="""
SELECT TOP 100
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000          AS wait_sec,
    r.wait_resource,
    r.command,
    r.status,
    DB_NAME(r.database_id)      AS database_name,
    s.login_name,
    s.host_name,
    s.program_name,
    -- Native query_hash (optimizer fingerprint) — join được với dm_exec_query_stats /
    -- Query Store; cùng format với topic slow_sessions
    CONVERT(NVARCHAR(18), r.query_hash, 1) AS query_hash,
    qt.text                     AS query_text
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
WHERE r.blocking_session_id > 0
  AND r.wait_time > 10000          -- >= 10s: blocking ngắn hơn thường tự resolve (noise)
ORDER BY r.wait_time DESC
""",
                timeout_sec=15,
            ),
            QueryConfig(
                query_id="head_blocker_sessions",
                description="Head blockers — sessions GIỮ lock gây block, kể cả idle transaction",
                sql="""
-- Head blocker hay là session idle với open transaction (forgotten transaction):
-- không có active request nên không xuất hiện trong blocking_sessions,
-- nhưng vẫn giữ X lock và block mọi session đụng vào cùng rows.
SELECT TOP 20
    s.session_id,
    s.login_name,
    s.host_name,
    s.program_name,
    s.open_transaction_count,
    s.status                                            AS session_status,
    DATEDIFF(SECOND, s.last_request_start_time, GETDATE()) AS idle_sec,
    ISNULL(qt.text, '')                                 AS last_query_text,
    r.command,
    r.cpu_time / 1000                                   AS cpu_sec,
    r.reads,
    -- Native query_hash: active blocker từ request; idle blocker bridge qua
    -- dm_exec_query_stats (cùng row với plan bên dưới) — format giống slow_sessions
    CONVERT(NVARCHAR(18), COALESCE(r.query_hash, cached_plan.query_hash), 1) AS query_hash,
    -- Plan của blocker: active → từ request plan_handle;
    -- idle → bridge qua dm_exec_query_stats (DMV duy nhất có cả sql_handle + plan_handle)
    COALESCE(active_plan.query_plan, cached_plan.query_plan) AS blocker_plan_xml
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r       ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_connections c    ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) qt
OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) active_plan
OUTER APPLY (
    SELECT TOP 1 qp2.query_plan, qs.query_hash
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp2
    WHERE qs.sql_handle = c.most_recent_sql_handle
      AND r.plan_handle IS NULL       -- chỉ tìm plan cache khi không có active request
) cached_plan(query_plan, query_hash)
WHERE s.session_id IN (
    SELECT DISTINCT blocking_session_id
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0
)
ORDER BY s.open_transaction_count DESC, idle_sec DESC
""",
                timeout_sec=15,
            ),
            QueryConfig(
                query_id="head_blocker_locks",
                description="Locks đang GIỮ (GRANT) bởi head blockers",
                sql="""
SELECT TOP 50
    tl.request_session_id                               AS session_id,
    tl.resource_type,
    DB_NAME(tl.resource_database_id)                    AS database_name,
    -- OBJECT_NAME chỉ hợp lệ với resource_type='OBJECT';
    -- KEY/PAGE/RID: resource_associated_entity_id là hash, cast int sẽ overflow
    CASE WHEN tl.resource_type = 'OBJECT'
         THEN OBJECT_NAME(
                  TRY_CAST(tl.resource_associated_entity_id AS INT),
                  tl.resource_database_id
              )
         ELSE NULL
    END                                                 AS object_name,
    tl.request_mode,
    tl.request_type,
    tl.resource_description
FROM sys.dm_tran_locks tl
WHERE tl.request_session_id IN (
    SELECT DISTINCT blocking_session_id
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0
)
  AND tl.request_status = 'GRANT'
  AND tl.resource_type NOT IN ('DATABASE', 'METADATA')  -- bỏ noise system locks
ORDER BY tl.request_session_id, tl.resource_type
""",
                timeout_sec=15,
            ),
        ],
        detector_type="blocking_chain",
        thresholds={
            # wait_sec so với max_wait_sec của chain (alias trong detector)
            "wait_sec": ThresholdConfig(warning=30, critical=120),
            # Depth 2 (A block B) phổ biến và tự resolve — depth 3+ mới là vấn đề
            "chain_depth": ThresholdConfig(warning=3, critical=5),
            # 20+ sessions chờ = cascading nguy hiểm, cần can thiệp ngay
            "blocked_session_count": ThresholdConfig(warning=5, critical=20),
        },
        # Capture = bằng chứng T+0 mà metrics KHÔNG có (blocking tự resolve nhanh).
        # Không dùng get_blocking_chain (trùng subset của metrics) và get_wait_stats
        # (dm_os_wait_stats cumulative từ restart — không phản ánh incident hiện tại).
        capture_tools=[
            "get_blocked_victims_snapshot",   # per-victim: full text, wait_resource, victim plan
            "get_analysis_history",           # AI recurrence context (mongo, rẻ)
        ],
        analysis_config=AnalysisConfig(
            context=(
                "Blocking chain — head blocker (session gây block) là trọng tâm. "
                "head_blocker_is_idle=true + open_txn_count>0 = forgotten transaction "
                "(app quên COMMIT) — cần kill session hoặc fix app, khác với active lock."
            ),
            focus_metrics=[
                "head_blocker_session_id",
                "head_blocker_is_idle",
                "head_blocker_idle_sec",
                "head_blocker_open_txn_count",
                "chain_depth",
                "blocked_session_count",
                "max_wait_sec",
                "wait_type",
            ],
        ),
    )


# ── 2b. Deadlock (tách riêng khỏi blocking) ──────────────────────────────────
# Data lịch sử 24h từ XEvent — không cần real-time 60s;
# CAST ring_buffer (~4MB) AS XML + XQuery là query nặng → 5 phút là đủ.

def _deadlock() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_DEADLOCK,
        display_name="Deadlock Monitor (System Health XEvent)",
        enabled=True,
        schedule_sec=300,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="deadlock_events",
                description="Deadlock events từ System Health XEvent (24h gần nhất)",
                sql="""
SELECT TOP 20
    xdr.value('@timestamp', 'datetime2')    AS deadlock_time,
    xdr.value('(//deadlock/process-list/process/@id)[1]', 'varchar(50)') AS victim_id,
    SUBSTRING(
        xdr.value('(//deadlock/process-list/process/inputbuf)[1]', 'varchar(max)'),
        1, 500
    )                                        AS victim_query
FROM (
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets t
    JOIN sys.dm_xe_sessions s ON t.event_session_address = s.address
    WHERE s.name = 'system_health'
      AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xr(xdr)
WHERE xdr.value('@timestamp', 'datetime2') > DATEADD(HOUR, -24, GETUTCDATE())
ORDER BY deadlock_time DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="blocking_chain",  # detector route theo query_id → deadlock parsing
        # Không thresholds: deadlock đã xảy ra → detector luôn tạo CRITICAL per event mới
        capture_tools=[
            "get_recent_findings",
            "get_analysis_history",
        ],
        analysis_config=AnalysisConfig(
            context=(
                "Deadlock từ System Health XEvent — transaction victim đã bị rollback. "
                "Phân tích victim query + resource để đề xuất consistent access order hoặc index."
            ),
            focus_metrics=["deadlock_time", "victim_id"],
        ),
    )


# ── 3. Blocked Query Snapshot ────────────────────────────────────────────────
# DISABLED (plan/topics/blocking.md A0): victim-centric — defer.
# Scope hiện tại tập trung head blocker (topic `blocking`).
# Giữ config để bật lại khi làm phase blocked_query_snapshot.

def _blocked_query() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_BLOCKED_QUERY,
        display_name="Blocked Query Snapshot & Trend",
        enabled=False,
        schedule_sec=60,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="blocked_snapshot",
                description="Chi tiết query đang bị block tại thời điểm check",
                sql="""
SELECT TOP 100
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000                  AS wait_duration_sec,
    r.wait_resource,
    DB_NAME(r.database_id)              AS database_name,
    s.login_name,
    s.host_name,
    CONVERT(NVARCHAR(18), r.query_hash, 1) AS query_hash,
    SUBSTRING(qt.text, 1, 1000)         AS query_text,
    -- Head blocker info
    bs.login_name                       AS blocker_login,
    SUBSTRING(bt.text, 1, 500)          AS blocker_query
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s   ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
LEFT JOIN sys.dm_exec_sessions bs ON r.blocking_session_id = bs.session_id
OUTER APPLY (
    SELECT TOP 1 text
    FROM sys.dm_exec_connections c
    CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle)
    WHERE c.session_id = r.blocking_session_id
) bt
WHERE r.blocking_session_id > 0
  AND r.wait_time > 10000
ORDER BY r.wait_time DESC
""",
                timeout_sec=15,
            ),
        ],
        detector_type="blocking_chain",
        thresholds={
            "wait_duration_sec": ThresholdConfig(warning=10, critical=60),
        },
    )


# ── 4. Slow Query / Performance Regression ───────────────────────────────────

def _slow_sessions() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_slow_sessions,
        display_name="Slow Query / Active Sessions with Blocking",
        enabled=True,
        schedule_sec=300,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="active_slow_sessions",
                description="Active sessions real-time với thông tin blocking",
                sql="""
SELECT TOP 10 r.session_id,
              r.status,
              r.command,
              s.login_name,
              s.host_name,
              r.cpu_time / 1000.0                    AS cpu_time_seconds,
              r.total_elapsed_time / 1000.0          AS elapsed_seconds,
              r.logical_reads,
              r.reads,
              r.writes,
              DB_NAME(r.database_id)                 AS database_name,
              CONVERT(NVARCHAR(18), r.query_hash, 1) AS query_hash,
              ----------------------------------------------------------------
              -- Current SQL
              ----------------------------------------------------------------
              t.text                                 AS sql_text,
              ----------------------------------------------------------------
              -- Current query plans
              ----------------------------------------------------------------
              runtime_stats.query_plan               AS actual_plan_xml,
              qp.query_plan                          AS query_plan_xml,
              ----------------------------------------------------------------
              -- Blocking info
              ----------------------------------------------------------------
              r.blocking_session_id,
              r.wait_type,
              r.wait_time / 1000.0                   AS wait_seconds,
              NULLIF(r.wait_resource, '')            AS wait_resource,
              ----------------------------------------------------------------
              -- Head blocker detection
              ----------------------------------------------------------------
              CASE
                  WHEN r.blocking_session_id = 0
                      AND EXISTS (SELECT 1
                                  FROM sys.dm_exec_requests r2
                                  WHERE r2.blocking_session_id = r.session_id)
                      THEN 1
                  ELSE 0
                  END                                AS is_head_blocker,
              ----------------------------------------------------------------
              -- Blocker session info
              ----------------------------------------------------------------
              bs.login_name                          AS blocker_login,
              bs.host_name                           AS blocker_host,
              bs.status                              AS blocker_status,
              bs.open_transaction_count              AS blocker_open_txn,
              ----------------------------------------------------------------
              -- Blocker SQL
              ----------------------------------------------------------------
              COALESCE(
                      blocker_active_sql.sql_text,
                      blocker_recent_sql.sql_text
              )                                      AS blocker_sql_text,
              ----------------------------------------------------------------
              -- Blocker plans
              ----------------------------------------------------------------
              COALESCE(
                      blocker_actual_plan.query_plan,
                      blocker_active_plan.query_plan,
                      blocker_cached_plan.query_plan
              )                                      AS blocker_plan_xml,
              blocker_actual_plan.query_plan         AS blocker_actual_plan,
              blocker_active_plan.query_plan         AS blocker_active_plan,
              blocker_cached_plan.query_plan         AS blocker_cached_plan
FROM sys.dm_exec_requests r
         JOIN sys.dm_exec_sessions s
              ON r.session_id = s.session_id
         CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
    ----------------------------------------------------------------
-- Current query plans
----------------------------------------------------------------
         OUTER APPLY sys.dm_exec_query_statistics_xml(r.session_id) runtime_stats
         OUTER APPLY sys.dm_exec_query_plan(r.plan_handle) qp
    ----------------------------------------------------------------
-- Blocker session
----------------------------------------------------------------
         LEFT JOIN sys.dm_exec_sessions bs
                   ON r.blocking_session_id = bs.session_id
         LEFT JOIN sys.dm_exec_connections bc
                   ON r.blocking_session_id = bc.session_id
    ----------------------------------------------------------------
-- Blocker active SQL
----------------------------------------------------------------
         OUTER APPLY (SELECT TOP 1 txt.text AS sql_text
                      FROM sys.dm_exec_requests br
                               CROSS APPLY sys.dm_exec_sql_text(br.sql_handle) txt
                      WHERE br.session_id = r.blocking_session_id) blocker_active_sql
    ----------------------------------------------------------------
-- Blocker recent SQL fallback
----------------------------------------------------------------
         OUTER APPLY (SELECT bt.text AS sql_text
                      FROM sys.dm_exec_sql_text(bc.most_recent_sql_handle) bt) blocker_recent_sql
    ----------------------------------------------------------------
-- Blocker actual runtime plan
----------------------------------------------------------------
         OUTER APPLY (SELECT TOP 1 qstats.query_plan
                      FROM sys.dm_exec_requests br
                               OUTER APPLY sys.dm_exec_query_statistics_xml(br.session_id) qstats
                      WHERE br.session_id = r.blocking_session_id) blocker_actual_plan
    ----------------------------------------------------------------
-- Blocker active cached plan
----------------------------------------------------------------
         OUTER APPLY (SELECT TOP 1 qp2.query_plan
                      FROM sys.dm_exec_requests br
                               CROSS APPLY sys.dm_exec_query_plan(br.plan_handle) qp2
                      WHERE br.session_id = r.blocking_session_id) blocker_active_plan
    ----------------------------------------------------------------
-- Blocker historical cached plan fallback
----------------------------------------------------------------
         OUTER APPLY (SELECT TOP 1 qp3.query_plan
                      FROM sys.dm_exec_query_stats qs2
                               CROSS APPLY sys.dm_exec_query_plan(qs2.plan_handle) qp3
                      WHERE qs2.sql_handle = bc.most_recent_sql_handle
                        AND NOT EXISTS (SELECT 1
                                        FROM sys.dm_exec_requests br2
                                        WHERE br2.session_id = r.blocking_session_id)) blocker_cached_plan

WHERE r.session_id > 50
  AND s.is_user_process = 1
  AND s.login_name != 'HDDT\\sqleasypos'
  AND s.host_name != 'EASYPOS-DB1'
--  AND s.login_name != 'report_user'
--  AND CONVERT(NVARCHAR(18), r.query_hash, 1) != '0xBCB0FE0D676B9C4F'
ORDER BY elapsed_seconds DESC;
""",
                timeout_sec=30,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "elapsed_seconds": ThresholdConfig(warning=30.0, critical=300.0),
        },
        extra={
            "issue_type": "slow_sessions",
        },
    )


# ── 5. Plan Regression ───────────────────────────────────────────────────────

def _plan_regression() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_PLAN_REGRESSION,
        display_name="Execution Plan Regression Detector",
        enabled=True,
        schedule_sec=300,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="new_plans_today",
                description="Query có plan mới trong 24h, tệ hơn plan cũ >= 50%",
                sql="""
SELECT TOP 30
    qsq.query_id,
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qsqt.query_sql_text), 2) AS query_hash,
    new_p.plan_id           AS new_plan_id,
    ROUND(new_p.avg_duration / 1000.0, 2) AS new_avg_ms,
    ROUND(old_p.avg_duration / 1000.0, 2) AS old_avg_ms,
    ROUND(100.0 * (new_p.avg_duration - old_p.avg_duration) / NULLIF(old_p.avg_duration, 0), 1)
                            AS pct_worse,
    new_p.query_plan        AS plan_xml,
    SUBSTRING(qsqt.query_sql_text, 1, 500) AS query_text
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
-- Plan mới (xuất hiện trong 24h qua)
JOIN sys.query_store_plan new_p
    ON qsq.query_id = new_p.query_id
   AND new_p.last_execution_time > DATEADD(HOUR, -24, GETUTCDATE())
   AND new_p.count_executions >= 10
-- Plan cũ nhất của cùng query (ít nhất 100 executions để đáng tin)
JOIN (
    SELECT query_id, plan_id, avg_duration
    FROM sys.query_store_plan
    WHERE count_executions >= 100
) old_p ON qsq.query_id = old_p.query_id
       AND old_p.plan_id != new_p.plan_id
       AND old_p.avg_duration < new_p.avg_duration  -- plan cũ tốt hơn
WHERE new_p.avg_duration > old_p.avg_duration * 1.5 -- tệ hơn 50%
ORDER BY pct_worse DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="plan_analysis",
        extra={"plan_xml_field": "plan_xml"},
    )


# ── 6. Plan Instability ──────────────────────────────────────────────────────

def _plan_instability() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_PLAN_INSTABILITY,
        display_name="Plan Instability Detector (Parameter Sniffing)",
        enabled=True,
        schedule_sec=300,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="multi_plan_queries",
                description="Query có nhiều execution plans đang active, worst/best > 5x",
                sql="""
SELECT TOP 20
    qsq.query_id,
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qsqt.query_sql_text), 2) AS query_hash,
    COUNT(DISTINCT qsp.plan_id)     AS plan_count,
    ROUND(MIN(qsp.avg_duration) / 1000.0, 2) AS best_plan_ms,
    ROUND(MAX(qsp.avg_duration) / 1000.0, 2) AS worst_plan_ms,
    ROUND(MAX(qsp.avg_duration) * 1.0 / NULLIF(MIN(qsp.avg_duration), 0), 1)
                                    AS worst_best_ratio,
    SUM(qsp.count_executions)       AS total_executions,
    SUBSTRING(qsqt.query_sql_text, 1, 500) AS query_text
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
WHERE qsp.last_execution_time > DATEADD(DAY, -7, GETUTCDATE())
  AND qsp.is_forced_plan = 0
GROUP BY qsq.query_id, qsqt.query_sql_text
HAVING COUNT(DISTINCT qsp.plan_id) > 3
   AND MAX(qsp.avg_duration) * 1.0 / NULLIF(MIN(qsp.avg_duration), 0) > 5
ORDER BY worst_best_ratio DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="plan_analysis",
        thresholds={
            "worst_best_ratio": ThresholdConfig(warning=5, critical=10),
            "plan_count": ThresholdConfig(warning=3, critical=6),
        },
    )


# ── 7. Non-Optimal Index Usage ───────────────────────────────────────────────

def _index_usage() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_INDEX_USAGE,
        display_name="Non-Optimal Index Usage (Plan XML Analysis)",
        enabled=True,
        schedule_sec=300,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="high_io_with_plan",
                description="Query có logical reads cao kèm plan XML để detect scan/lookup",
                sql="""
SELECT TOP 30
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qsqt.query_sql_text), 2) AS query_hash,
    qsq.query_id,
    ROUND(qsp.avg_logical_io_reads, 0) AS avg_logical_reads,
    ROUND(qsp.avg_duration / 1000.0, 2) AS avg_duration_ms,
    qsp.count_executions,
    qsp.query_plan                      AS plan_xml,
    SUBSTRING(qsqt.query_sql_text, 1, 500) AS query_text
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
WHERE qsp.last_execution_time > DATEADD(HOUR, -1, GETUTCDATE())
  AND qsp.count_executions >= 5
  AND qsp.avg_logical_io_reads > 10000
  AND qsp.query_plan IS NOT NULL
ORDER BY qsp.avg_logical_io_reads DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="plan_analysis",
        extra={"plan_xml_field": "plan_xml"},
    )


# ── 8. High Variation Query ──────────────────────────────────────────────────

def _high_variation() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_HIGH_VARIATION,
        display_name="High Variation Query Detector",
        enabled=True,
        schedule_sec=300,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="cv_queries",
                description="Query có coefficient of variation cao — execution time không ổn định",
                sql="""
SELECT TOP 20
    CONVERT(VARCHAR(64), HASHBYTES('MD5', qsqt.query_sql_text), 2) AS query_hash,
    qsq.query_id,
    ROUND(qsp.avg_duration / 1000.0, 2)                            AS avg_duration_ms,
    ROUND(qsp.stdev_duration / 1000.0, 2)                          AS stdev_duration_ms,
    -- CV = stdev / avg — giá trị > 0.5 là biến động cao
    ROUND(qsp.stdev_duration * 1.0 / NULLIF(qsp.avg_duration, 0), 3) AS cv_ratio,
    qsp.count_executions,
    ROUND(qsp.min_duration / 1000.0, 2)                            AS min_ms,
    ROUND(qsp.max_duration / 1000.0, 2)                            AS max_ms,
    SUBSTRING(qsqt.query_sql_text, 1, 500) AS query_text
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
WHERE qsp.last_execution_time > DATEADD(HOUR, -1, GETUTCDATE())
  AND qsp.count_executions > 50
  AND qsp.avg_duration > 50000     -- > 50ms average
  AND qsp.stdev_duration > 0
ORDER BY cv_ratio DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "cv_ratio": ThresholdConfig(warning=0.5, critical=1.0),
        },
    )


# ── 9. TempDB & Memory Pressure ──────────────────────────────────────────────

def _tempdb_memory() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_TEMPDB_MEMORY,
        display_name="TempDB & Memory Pressure Monitor",
        enabled=True,
        schedule_sec=300,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="ple",
                description="Page Life Expectancy — giá trị thấp = memory pressure",
                sql="""
SELECT TOP 5
    object_name,
    counter_name,
    cntr_value AS ple_sec
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND object_name LIKE '%Buffer Manager%'
""",
                timeout_sec=10,
            ),
            QueryConfig(
                query_id="memory_grants",
                description="Memory grants pending — > 0 = workload đang chờ memory",
                sql="""
SELECT TOP 5
    counter_name,
    cntr_value AS pending_grants
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Memory Grants Pending'
""",
                timeout_sec=10,
            ),
            QueryConfig(
                query_id="tempdb_space",
                description="TempDB space usage — version store, user objects, internal",
                sql="""
SELECT TOP 1
    ROUND(SUM(total_page_count) * 8.0 / 1024, 1)             AS total_mb,
    ROUND(SUM(unallocated_extent_page_count) * 8.0 / 1024, 1) AS free_mb,
    ROUND(
        100.0 * (1 - SUM(unallocated_extent_page_count) * 1.0 / NULLIF(SUM(total_page_count), 0)),
        1
    )                                                          AS used_pct,
    ROUND(SUM(version_store_reserved_page_count) * 8.0 / 1024, 1) AS version_store_mb,
    ROUND(SUM(internal_object_reserved_page_count) * 8.0 / 1024, 1) AS internal_mb,
    ROUND(SUM(user_object_reserved_page_count) * 8.0 / 1024, 1)     AS user_object_mb
FROM sys.dm_db_file_space_usage
""",
                timeout_sec=10,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "ple_sec": ThresholdConfig(warning=300, critical=100),
            "pending_grants": ThresholdConfig(warning=1, critical=5),
            "used_pct": ThresholdConfig(warning=70, critical=85),
            "version_store_mb": ThresholdConfig(warning=500, critical=1000),
        },
        extra={
            # ple_sec và pending_grants: giá trị thấp/cao mới là vấn đề
            # threshold detector sẽ đọc extra.lower_is_worse khi implement
            "lower_is_worse": ["ple_sec"],
        },
    )


# ── 10. Wait Statistics Anomaly ──────────────────────────────────────────────

def _wait_stats() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_WAIT_STATS,
        display_name="Wait Statistics Anomaly Monitor (Baseline)",
        enabled=True,
        schedule_sec=300,
        nodes=["all"],
        queries=[
            QueryConfig(
                query_id="wait_snapshot",
                description="Top wait types — so sánh với baseline cùng giờ",
                sql="""
SELECT TOP 20
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    max_wait_time_ms,
    signal_wait_time_ms,
    -- Delta sẽ tính ở baseline detector so với lần snapshot trước
    GETUTCDATE() AS snapshot_time
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    'SLEEP_TASK', 'BROKER_TO_FLUSH', 'BROKER_EVENTHANDLER',
    'CHECKPOINT_QUEUE', 'DBMIRROR_EVENTS_QUEUE', 'DISPATCHER_QUEUE_SEMAPHORE',
    'FT_IFTS_SCHEDULER_IDLE_WAIT', 'HADR_FILESTREAM_IOMGR_IOCOMPLETION',
    'HADR_WORK_QUEUE', 'LAZYWRITER_SLEEP', 'LOGMGR_QUEUE', 'ONDEMAND_TASK_QUEUE',
    'REQUEST_FOR_DEADLOCK_SEARCH', 'RESOURCE_QUEUE', 'SERVER_IDLE_CHECK',
    'SLEEP_DBSTARTUP', 'SLEEP_DCOMSTARTUP', 'SLEEP_MASTERDBREADY',
    'SLEEP_MASTERMDREADY', 'SLEEP_MASTERUPGRADED', 'SLEEP_MSDBSTARTUP',
    'SLEEP_TEMPDBSTARTUP', 'SNI_HTTP_ACCEPT', 'SP_SERVER_DIAGNOSTICS_SLEEP',
    'SQLTRACE_BUFFER_FLUSH', 'WAITFOR', 'XE_DISPATCHER_WAIT', 'XE_TIMER_EVENT'
)
  AND wait_time_ms > 0
ORDER BY wait_time_ms DESC
""",
                timeout_sec=10,
            ),
        ],
        detector_type="baseline",
        baseline_config=BaselineConfig(
            metric_field="wait_time_ms",
            threshold_pct=200.0,  # tăng > 200% so với baseline → anomaly
            min_executions=5,
            baseline_weeks=4,
        ),
    )


# ── 11. SQL Agent Jobs & Maintenance ─────────────────────────────────────────

def _agent_maintenance() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_AGENT_MAINTENANCE,
        display_name="SQL Agent Jobs, Backup & DBCC Monitor",
        enabled=True,
        schedule_sec=600,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="failed_jobs",
                description="SQL Agent jobs thất bại trong 24h",
                sql="""
SELECT TOP 50
    j.name                          AS job_name,
    jh.step_name,
    jh.run_status,                  -- 0=Failed
    jh.run_date,
    jh.run_time,
    jh.run_duration,
    LEFT(jh.message, 500)           AS error_message,
    -- Đếm lần fail liên tiếp
    (
        SELECT COUNT(*) FROM msdb.dbo.sysjobhistory jh2
        WHERE jh2.job_id = j.job_id
          AND jh2.step_id = 0
          AND jh2.run_status = 0
          AND jh2.run_date >= CAST(FORMAT(DATEADD(DAY, -7, GETDATE()), 'yyyyMMdd') AS INT)
    ) AS fail_count_7d
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobhistory jh ON j.job_id = jh.job_id
WHERE jh.step_id = 0
  AND jh.run_status = 0
  AND jh.run_date >= CAST(FORMAT(DATEADD(DAY, -1, GETDATE()), 'yyyyMMdd') AS INT)
ORDER BY jh.run_date DESC, jh.run_time DESC
""",
                timeout_sec=20,
            ),
            QueryConfig(
                query_id="backup_status",
                description="Last backup per database — phát hiện backup gap",
                sql="""
SELECT TOP 50
    d.name                          AS database_name,
    d.recovery_model_desc,
    MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date END) AS last_full_backup,
    MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date END) AS last_log_backup,
    MAX(CASE WHEN bs.type = 'I' THEN bs.backup_finish_date END) AS last_diff_backup,
    -- Giờ kể từ full backup
    DATEDIFF(HOUR,
        MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date END),
        GETDATE()
    )                               AS hours_since_full,
    -- Giờ kể từ log backup (chỉ check database recovery model = FULL)
    CASE WHEN d.recovery_model_desc = 'FULL'
         THEN DATEDIFF(MINUTE,
             MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date END),
             GETDATE())
         ELSE NULL
    END                             AS mins_since_log
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset bs ON bs.database_name = d.name
WHERE d.database_id > 4                 -- bỏ system databases
  AND d.state_desc = 'ONLINE'
  AND d.is_read_only = 0
GROUP BY d.name, d.recovery_model_desc
ORDER BY hours_since_full DESC
""",
                timeout_sec=20,
            ),
            QueryConfig(
                query_id="dbcc_status",
                description="DBCC CHECKDB last run per database",
                sql="""
SELECT TOP 20
    name            AS database_name,
    DATABASEPROPERTYEX(name, 'LastGoodCheckDbTime') AS last_checkdb,
    DATEDIFF(DAY,
        CAST(DATABASEPROPERTYEX(name, 'LastGoodCheckDbTime') AS DATETIME),
        GETDATE()
    )               AS days_since_checkdb
FROM sys.databases
WHERE database_id > 4
  AND state_desc = 'ONLINE'
ORDER BY days_since_checkdb DESC
""",
                timeout_sec=15,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "run_status": ThresholdConfig(warning=0, critical=0),      # 0 = failed
            "fail_count_7d": ThresholdConfig(warning=1, critical=2),
            "hours_since_full": ThresholdConfig(warning=24, critical=48),
            "mins_since_log": ThresholdConfig(warning=60, critical=120),
            "days_since_checkdb": ThresholdConfig(warning=7, critical=14),
        },
    )


# ── 12. Missing Index Detector ───────────────────────────────────────────────

def _missing_index() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_MISSING_INDEX,
        display_name="Missing Index Detector",
        enabled=True,
        schedule_sec=3600,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="high_value_missing_indexes",
                description="Missing indexes với improvement_measure cao (SQL Server gợi ý)",
                sql="""
SELECT TOP 30
    DB_NAME(mid.database_id)        AS database_name,
    OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    ROUND(
        migs.avg_total_user_cost
        * migs.avg_user_impact
        * (migs.user_seeks + migs.user_scans),
        0
    )                               AS improvement_measure,
    migs.user_seeks,
    migs.user_scans,
    ROUND(migs.avg_user_impact, 1)  AS avg_user_impact_pct,
    migs.last_user_seek
FROM sys.dm_db_missing_index_details mid
JOIN sys.dm_db_missing_index_groups mig  ON mid.index_handle = mig.index_handle
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
WHERE mid.database_id = DB_ID()
  AND migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) > 10000
ORDER BY improvement_measure DESC
""",
                timeout_sec=30,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "improvement_measure": ThresholdConfig(warning=10000, critical=100000),
        },
    )


# ── 13. Resource Governor Monitor ────────────────────────────────────────────

def _resource_governor() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_RESOURCE_GOVERNOR,
        display_name="Resource Governor Pool Monitor",
        enabled=True,
        schedule_sec=300,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="pool_cpu_usage",
                description="Resource pool CPU usage so với max_cpu_percent được cấu hình",
                sql="""
SELECT TOP 20
    rp.name                         AS pool_name,
    rp.max_cpu_percent              AS max_cpu_pct_config,
    rp.min_cpu_percent              AS min_cpu_pct_config,
    rprs.avg_cpu_percent_target     AS avg_cpu_target,
    rprs.avg_cpu_percent            AS avg_cpu_actual,
    -- Phần trăm max_cpu đang được dùng
    CASE WHEN rp.max_cpu_percent > 0
         THEN ROUND(100.0 * rprs.avg_cpu_percent / rp.max_cpu_percent, 1)
         ELSE 0
    END                             AS pct_of_max_cpu,
    rprs.active_worker_count,
    rprs.active_request_count,
    rprs.blocked_task_count,
    rprs.read_io_completed          AS read_io_per_sec,
    rprs.write_io_completed         AS write_io_per_sec
FROM sys.dm_resource_governor_resource_pools rprs
JOIN sys.resource_governor_resource_pools rp ON rprs.pool_id = rp.pool_id
WHERE rprs.pool_id > 2              -- bỏ internal và default pools
ORDER BY rprs.avg_cpu_percent DESC
""",
                timeout_sec=10,
            ),
            QueryConfig(
                query_id="top_sessions_by_pool",
                description="Top sessions đang consume nhiều CPU trong mỗi pool",
                sql="""
SELECT TOP 30
    rp.name                         AS pool_name,
    wg.name                         AS workgroup_name,
    r.session_id,
    r.cpu_time / 1000               AS cpu_sec,
    r.reads,
    r.writes,
    DB_NAME(r.database_id)          AS database_name,
    s.login_name,
    SUBSTRING(qt.text, 1, 300)      AS query_text
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
JOIN sys.dm_resource_governor_workload_groups wg ON r.group_id = wg.group_id
JOIN sys.resource_governor_resource_pools rp ON wg.pool_id = rp.pool_id
WHERE r.cpu_time > 5000             -- > 5 giây CPU
  AND rp.pool_id > 2
ORDER BY r.cpu_time DESC
""",
                timeout_sec=15,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "pct_of_max_cpu": ThresholdConfig(warning=80, critical=95),
            "blocked_task_count": ThresholdConfig(warning=5, critical=20),
        },
    )


# ── 14. Index Fragmentation (Scheduled daily) ────────────────────────────────

def _index_fragmentation() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_INDEX_FRAGMENTATION,
        display_name="Index Fragmentation Monitor (Daily)",
        enabled=True,
        # 24 giờ — scheduler dùng cron job riêng để chạy lúc 3AM
        # Ở đây đặt interval dài để không chạy liên tục
        schedule_sec=86400,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="fragmented_indexes",
                description="Indexes bị phân mảnh > 10%, page_count > 1000",
                sql="""
SELECT TOP 50
    DB_NAME()                       AS database_name,
    OBJECT_NAME(ips.object_id)      AS table_name,
    i.name                          AS index_name,
    ips.index_type_desc,
    ROUND(ips.avg_fragmentation_in_percent, 1) AS fragmentation_pct,
    ips.page_count,
    -- Khuyến nghị: REORGANIZE nếu 10-30%, REBUILD nếu > 30%
    CASE
        WHEN ips.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
        WHEN ips.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
        ELSE 'OK'
    END                             AS recommended_action,
    ips.record_count
FROM sys.dm_db_index_physical_stats(
    DB_ID(), NULL, NULL, NULL, 'SAMPLED'  -- SAMPLED nhanh hơn DETAILED
) ips
JOIN sys.indexes i
    ON ips.object_id = i.object_id
   AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 10
  AND ips.page_count > 1000
  AND ips.index_type_desc IN ('CLUSTERED INDEX', 'NONCLUSTERED INDEX')
ORDER BY ips.avg_fragmentation_in_percent DESC
""",
                timeout_sec=120,  # SAMPLED scan mất thời gian
            ),
        ],
        detector_type="threshold",
        thresholds={
            "fragmentation_pct": ThresholdConfig(warning=10, critical=30),
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def _select_topics(topic_ids: list[str] | None) -> list[MonitorTopic]:
    """
    Lọc topics theo topic_ids; None/rỗng = tất cả.
    Fail fast nếu có id không tồn tại — tránh silent skip khi gõ nhầm tên.
    """
    topics = _all_topics()
    if not topic_ids:
        return topics

    by_id = {t.topic_id: t for t in topics}
    unknown = [tid for tid in topic_ids if tid not in by_id]
    if unknown:
        logger.error(
            "Topic không tồn tại: %s. Các topics hợp lệ: %s",
            unknown, sorted(by_id),
        )
        sys.exit(1)
    # Giữ thứ tự user truyền vào, dedup nếu lặp
    seen: set[str] = set()
    return [by_id[tid] for tid in topic_ids if not (tid in seen or seen.add(tid))]


def seed(dry_run: bool = False, topic_ids: list[str] | None = None) -> None:
    """
    Upsert topics vào MongoDB.
    dry_run=True: in ra topics sẽ được seed mà không ghi vào DB.
    topic_ids: chỉ seed các topics này (None = tất cả).
    """
    topics = _select_topics(topic_ids)

    if dry_run:
        logger.info("DRY RUN — %d topics sẽ được seed:", len(topics))
        for t in topics:
            logger.info(
                "  %-25s  schedule=%4ds  nodes=%-12s  detector=%s",
                t.topic_id,
                t.schedule_sec,
                str(t.nodes),
                t.detector_type or "null",
            )
        return

    MongoConnection.initialize(settings)
    repo = TopicRepo()

    success = 0
    for topic in topics:
        try:
            repo.upsert(topic)
            logger.info(
                "Seeded: %-25s  schedule=%4ds  detector=%s",
                topic.topic_id,
                topic.schedule_sec,
                topic.detector_type or "null",
            )
            success += 1
        except Exception as exc:
            logger.error("Failed to seed topic=%s: %s", topic.topic_id, exc)

    logger.info("Done: %d/%d topics seeded successfully.", success, len(topics))
    MongoConnection.close()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Seed monitoring topics into MongoDB",
        epilog=(
            "Ví dụ: python -m layer1.seed.seed_topics                         (tất cả)\n"
            "       python -m layer1.seed.seed_topics --topic blocking        (1 topic)\n"
            "       python -m layer1.seed.seed_topics --topic blocking --topic deadlock\n"
            "       python -m layer1.seed.seed_topics --topic blocking,deadlock --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print topics without writing to MongoDB",
    )
    parser.add_argument(
        "--topic",
        metavar="TOPIC_ID",
        action="append",
        help="Seed only specific topic(s) — lặp lại flag hoặc comma-separated; bỏ qua = seed tất cả",
    )
    args = parser.parse_args()

    # "--topic a,b --topic c" → ["a", "b", "c"]
    topic_ids: list[str] = []
    for raw in args.topic or []:
        topic_ids.extend(t.strip() for t in raw.split(",") if t.strip())

    seed(dry_run=args.dry_run, topic_ids=topic_ids or None)


if __name__ == "__main__":
    main()
