# Plan: Cập nhật slow_sessions topic — Active Sessions + Blocking Info

## Context

Topic `slow_sessions` hiện dùng Query Store (`sys.query_store_query`) để phát hiện slow query theo baseline lịch sử. User muốn chuyển sang query real-time từ `sys.dm_exec_requests`, bổ sung thông tin blocking (blocker login, host, sql_text, plan). Khi có session bị block (`blocking_session_id > 0`), Layer 1 alert cần hiển thị `blocker_sql_text`, và Layer 2 cần phân tích thêm blocking chain.

## Files cần thay đổi

| File | Loại thay đổi |
|---|---|
| `layer1/seed/seed_topics.py` | Replace `_slow_sessions()` — query mới, detector threshold |
| `layer2/skills/slow_sessions.yaml` | Thêm blocking tools + tăng budget |

**Không cần thay đổi:** `telegram_notifier.py` (đã xử lý `_text` suffix), `threshold_detector.py` (đã copy all row fields vào metrics), `findings.py`.

---

## 1. `layer1/seed/seed_topics.py` — Hàm `_slow_sessions()`

### 1a. SQL mới (thay toàn bộ nội dung sql=)

- Đổi `query_id` từ `"query_store_stats"` → `"active_slow_sessions"`
- Dùng query user cung cấp với các điều chỉnh:
  - **Bỏ** `AND blocking_session_id > 0` khỏi WHERE (lấy tất cả active sessions)
  - **SUBSTRING** `t.text` → `SUBSTRING(t.text, 1, 1000) AS sql_text` (compact cho Telegram ≤1500 inline)
  - **SUBSTRING** `bt.text` → `SUBSTRING(bt.text, 1, 500) AS blocker_sql_text` (compact)
  - **Giữ nguyên** `query_plan_xml` và `blocker_plan_xml` (lưu MongoDB per user's request; suffix `_xml` tự động skip trong Telegram alert)

```sql
SELECT TOP 10
    s.session_id,
    r.status,
    r.command,
    s.login_name,
    s.host_name,
    r.cpu_time / 1000.0           AS cpu_time_seconds,
    r.total_elapsed_time / 1000.0 AS elapsed_seconds,
    r.logical_reads,
    r.reads,
    r.writes,
    SUBSTRING(t.text, 1, 1000)    AS sql_text,
    qp.query_plan                 AS query_plan_xml,
    -- Blocking info
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000.0          AS wait_seconds,
    r.wait_resource,
    -- Blocker context
    bs.login_name                 AS blocker_login,
    bs.host_name                  AS blocker_host,
    bs.status                     AS blocker_status,
    bs.open_transaction_count     AS blocker_open_txn,
    SUBSTRING(bt.text, 1, 500)    AS blocker_sql_text,
    CONVERT(NVARCHAR(MAX), COALESCE(
        blocker_active_plan.query_plan,
        blocker_cached_plan.query_plan
    ))                            AS blocker_plan_xml
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s
    ON r.session_id = s.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) AS qp
LEFT JOIN sys.dm_exec_sessions bs
    ON r.blocking_session_id = bs.session_id
LEFT JOIN sys.dm_exec_connections bc
    ON r.blocking_session_id = bc.session_id
OUTER APPLY sys.dm_exec_sql_text(bc.most_recent_sql_handle) bt
OUTER APPLY (
    SELECT TOP 1 qp2.query_plan
    FROM sys.dm_exec_requests br
    CROSS APPLY sys.dm_exec_query_plan(br.plan_handle) qp2
    WHERE br.session_id = r.blocking_session_id
) blocker_active_plan(query_plan)
OUTER APPLY (
    SELECT TOP 1 qp3.query_plan
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp3
    WHERE qs.sql_handle = bc.most_recent_sql_handle
      AND NOT EXISTS (
          SELECT 1 FROM sys.dm_exec_requests br2
          WHERE br2.session_id = r.blocking_session_id
      )
) blocker_cached_plan(query_plan)
WHERE s.login_name != 'HDDT\sqleasypos'
  AND s.host_name  != 'EASYPOS-DB1'
ORDER BY elapsed_seconds DESC
```

### 1b. Đổi detector_type

```python
# CŨ
detector_type="baseline",
baseline_config=BaselineConfig(
    metric_field="avg_duration_ms",
    threshold_pct=50.0,
    min_executions=10,
    baseline_weeks=4,
),

# MỚI
detector_type="threshold",
thresholds={
    "elapsed_seconds": ThresholdConfig(warning=30.0, critical=300.0),
},
extra={
    "issue_type": "slow_sessions",  # → maps sang slow_sessions.yaml skill ở Layer 2
},
```

### 1c. Cập nhật display_name

```python
display_name="Slow Query / Active Sessions with Blocking",
```

### Ghi chú về alert behavior

- `sql_text` (≤1000 chars) và `blocker_sql_text` (≤500 chars) → suffix `_text` → telegram_notifier tự hiển thị inline trong `<blockquote expandable>` (< 1500 char threshold). **Không cần sửa notifier.**
- `query_plan_xml`, `blocker_plan_xml` → suffix `_xml` → **tự động bị skip** khỏi Telegram alert. Chỉ lưu MongoDB.
- Khi `blocking_session_id = 0` (không có blocker): `blocker_*` fields sẽ là `NULL` → stored as `None` trong metrics → notifier bỏ qua field None. Alert chỉ hiện blocking fields khi có giá trị.
- **Dedup (sau code change mới nhất):** threshold_detector vừa được thêm `query_hash=result.query_id` (trước đó query_hash=None → tất cả topics trên cùng node dùng 1 hash). Giờ:
  `finding_hash = MD5("slow_sessions:slow_sessions:<node>:active_slow_sessions")`
  → 1 alert / node / 30 phút, scoped theo query_id này.
  Row đầu tiên vượt threshold (elapsed_seconds cao nhất, ORDER BY DESC) tạo alert; các row sau bị suppress đúng cách.

---

## 2. `layer2/skills/slow_sessions.yaml`

### 2a. KHÔNG thêm `get_blocking_chain` vào slow_sessions skill

**Lý do:** `get_blocking_chain` query live `sys.dm_exec_requests` tại thời điểm Layer 2 phân tích — blocking có thể đã resolved → kết quả sai. Hơn nữa, **finding.metrics đã có snapshot đầy đủ** tại thời điểm detect:
- `blocking_session_id`, `wait_type`, `wait_seconds`, `wait_resource`
- `blocker_login`, `blocker_host`, `blocker_sql_text`, `blocker_status`, `blocker_open_txn`
- `blocker_plan_xml`

Claude nhận tất cả trường này trong `metrics_json` của user prompt → phân tích trực tiếp, không cần tool live.

**`optional_tools` giữ nguyên** (không thêm `get_blocking_chain`).

### 2b. Cập nhật specialization — hướng dẫn phân tích blocking từ metrics

Thêm vào **đầu** specialization (2 dòng):

```yaml
specialization: |
  Focus: slow query, high variation query, va blocked sessions.

  Neu metrics co blocking_session_id > 0: phan tich blocking context (blocker_sql_text,
  wait_type, wait_seconds, blocker_login) nhu root cause chinh truoc khi xem plan.

  Bat dau bang viec hieu query va plan:
  1. Dung get_plan_analysis(finding_id) ...
  [... phan con lai giu nguyen ...]
```

**Tại sao chỉ cần 2 dòng:** Blocking data đã có sẵn trong metrics_json → Claude thấy và phân tích ngay. Không cần dạy Claude cách đọc blocking chain.

### 2c. Tăng budget

```yaml
# CŨ
max_tool_rounds: 6
max_tokens: 2500
max_cost_usd: 0.15

# MỚI
max_tool_rounds: 8
max_tokens: 3500
max_cost_usd: 0.25
```

---

## Verification

1. **MongoDB update** — sau khi sửa seed_topics.py, chạy:
   ```bash
   docker compose exec layer1 python -m layer1.seed.seed_topics
   ```
   Script dùng `repo.upsert(topic)` → idempotent, an toàn re-run.

2. **Test Layer 1 alert** — trigger thủ công topic hoặc chờ schedule 300s, kiểm tra:
   - Session có `elapsed_seconds >= 30` → alert được gửi
   - Alert hiện `sql_text` trong blockquote
   - Nếu có blocking: `blocker_sql_text`, `blocker_login`, `blocker_host`, `wait_type` xuất hiện trong metrics
   - `query_plan_xml` / `blocker_plan_xml` KHÔNG hiện trong Telegram (bị skip đúng)

3. **Test Layer 2 analysis** — dùng `/analyze <finding_id>` trên Telegram:
   - Nếu metrics có `blocking_session_id > 0`: AI gọi `get_blocking_chain` ở bước đầu
   - Cost không vượt $0.25
   - Tool rounds không vượt 8
