# Plan — Tách CDC Health thành topic riêng

Ngày tạo: 2026-06-10
Tác giả: Long Do + Claude

## Context

`ag_health` hiện gộp 2 concerns khác nhau vào 1 topic:
- **AG sync** (`ag_sync_state`): giám sát replication state từ Primary, issue_type=`ag_lag`, skill=`ag.yaml`
- **CDC jobs** (`cdc_jobs`): giám sát msdb job history, issue_type=`cdc_failure`, skill=`cdc.yaml`

Tách ra vì:
- Hai vấn đề độc lập — AG lag không liên quan đến CDC failure
- Alert từ `ag_health` không rõ ngay đang báo AG hay CDC
- Schedule khác nhau: AG sync cần 120s (failover risk), CDC có thể 300s
- Doc/skill mỗi topic tập trung hơn

---

## Phần 1 — Layer 1

### Bước 1.1 — `layer1/models/topic_constants.py`

Thêm sau dòng `TOPIC_AG_REDO_SECONDARY`:
```python
TOPIC_CDC_HEALTH = "cdc_health"
```

### Bước 1.2 — `layer1/seed/seed_topics.py`

**(a) Import** — thêm `TOPIC_CDC_HEALTH` vào block import từ `..models.topic_constants`:
```python
from ..models.topic_constants import (
    ...
    TOPIC_CDC_HEALTH,           # thêm dòng này
    ...
)
```

**(b) Docstring** (dòng 13-28) — sửa entry `1.` và thêm entry `1c.`:
```
    1.  ag_health          — AG Health (2 phút)           ← bỏ "& CDC"
    1c. cdc_health         — CDC Job Status (5 phút)      ← thêm mới
```

**(c) `_all_topics()`** — thêm `_cdc_health()` ngay sau `_ag_health()`:
```python
def _all_topics() -> list[MonitorTopic]:
    return [
        _ag_health(),
        _cdc_health(),       # thêm dòng này
        _ag_redo_secondary(),
        ...
    ]
```

**(d) Update `_ag_health()`** — bỏ toàn bộ phần CDC:

- **Bỏ QueryConfig `cdc_jobs`** (query + timeout_sec block)
- **Bỏ khỏi `thresholds`**: `cdc_job_failed`, `cdc_job_retry`
- **Bỏ khỏi `extra.issue_type_map`**: `cdc_job_failed`, `cdc_job_retry`
- **`emit_info_when_healthy` và `info_issue_type` GIỮ LẠI** (vẫn dùng cho AG)
- **Update `analysis_config.context`**: bỏ câu đề cập CDC, thêm cuối:
  `"CDC job status xem topic cdc_health."`
- **Update `analysis_config.focus_metrics`**: bỏ
  `"job_name"`, `"run_status"`, `"cdc_job_failed"`, `"cdc_job_retry"`, `"run_duration"`, `"message"`

Kết quả `_ag_health()` thresholds + extra sau khi bỏ CDC:
```python
thresholds={
    "log_send_queue_size": ThresholdConfig(warning=500, critical=1000),
    "is_suspended": ThresholdConfig(warning=1, critical=1),
},
extra={
    "issue_type_map": {
        "log_send_queue_size": "ag_lag",
        "is_suspended": "ag_lag",
    },
    "emit_info_when_healthy": True,
    "info_issue_type": "ag_lag",
},
```

**(e) Tạo mới `_cdc_health()`** — đặt ngay sau `_ag_health()`:

```python
# ── 1c. CDC Health Monitor ────────────────────────────────────────────────────
# Tách từ _ag_health() — CDC job status có concern và schedule riêng.

def _cdc_health() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_CDC_HEALTH,
        display_name="CDC Health Monitor",
        enabled=True,
        schedule_sec=300,
        nodes=["primary"],
        queries=[
            QueryConfig(
                query_id="cdc_jobs",
                description="CDC capture va cleanup job status",
                sql="""
SELECT TOP 20
    j.name AS job_name,
    j.enabled,
    jh.run_status,
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
            "cdc_job_failed": ThresholdConfig(warning=1, critical=1),
            "cdc_job_retry": ThresholdConfig(warning=1, critical=2),
        },
        extra={
            "issue_type_map": {
                "cdc_job_failed": "cdc_failure",
                "cdc_job_retry": "cdc_failure",
            },
        },
        analysis_config=AnalysisConfig(
            context=(
                "CDC capture/cleanup job status từ msdb. "
                "cdc_job_failed=1 (run_status=0) = job thất bại — version store TempDB không được dọn "
                "+ capture latency tăng cho downstream consumers. "
                "cdc_job_retry=1 (run_status=2) = dấu hiệu instability trước khi fail hoàn toàn. "
                "Xem message để biết error cụ thể. "
                "TempDB pressure do CDC failure xem topic tempdb_memory."
            ),
            focus_metrics=[
                "job_name", "run_status", "cdc_job_failed", "cdc_job_retry",
                "run_duration", "message",
            ],
        ),
    )
```

### Bước 1.3 — Apply Layer 1

```powershell
python -m layer1.seed.seed_topics --topic ag_health,cdc_health --dry-run   # xem trước
python -m layer1.seed.seed_topics --topic ag_health,cdc_health             # ghi MongoDB
docker compose restart layer1   # đăng ký APScheduler job mới cdc_health
```

> `ag_health` chỉ đổi query/threshold → reload tự động mỗi run, không cần restart.
> `cdc_health` là topic mới → cần restart để đăng ký job.

---

## Phần 2 — Layer 3

### Bước 2.1 — `layer3/apps/web/dashboard/topics/layout-registry.ts`

**(a) Dòng 1** — thêm `"cdc_health"` vào TopicLayoutKey union:
```typescript
export type TopicLayoutKey = "slow_sessions" | "blocking" | "ag_health" | "cdc_health" | "default";
```

**(b) Thêm `renderCdcHealthFindingRow()`** — đặt sau hàm `renderAgHealthFindingRow`.
CDC findings có metrics: `job_name`, `run_status`, `cdc_job_failed`, `cdc_job_retry`, `run_duration`, `message`.

```typescript
function renderCdcHealthFindingRow(tr: HTMLTableRowElement, x: any, idx: number, deps: TopicLayoutDeps): void {
  var m = (x && x.metrics) || {};
  var failed = Number(m.cdc_job_failed) === 1;
  var retry  = Number(m.cdc_job_retry)  === 1;
  var statusHtml = failed
    ? "<span class='badge badge-critical'>FAILED</span>"
    : retry
      ? "<span class='badge badge-warning'>RETRY</span>"
      : "<span class='badge badge-ok'>OK</span>";

  tr.innerHTML =
    "<td class='no-cell'>" + (idx + 1) + "</td>" +
    "<td>" + deps.copyIdButton(x.finding_id) + "</td>" +
    "<td>" + deps.formatTime(x.detected_at) + "</td>" +
    "<td>" + escapeHtml(x.node || "") + "</td>" +
    "<td>" + deps.severityBadge(x.severity) + "</td>" +
    "<td>" + escapeHtml(m.job_name || "") + "</td>" +
    "<td>" + statusHtml + "</td>" +
    "<td>" + deps.aiAnalysesCell(x) + "</td>" +
    "<td>" + deps.actionCell(x) + "</td>";

  tr.addEventListener("click", async function () {
    await deps.withGlobalLoading(async function () {
      var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
      deps.openModal("CDC Health", deps.renderAgHealthModal(d));   // reuse renderer — isCdc branch
      var bodies = document.querySelectorAll(".modal .modal-body");
      var body = bodies[bodies.length - 1] as HTMLElement | undefined;
      if (body) deps.attachGlossaryTooltips(body);
      if (d && d.has_diagnostics) deps.bindFindingModalTabs(x.finding_id);
    });
  });
}
```

> **Reuse `renderAgHealthModal`** — `ag-health-detail.ts` đã có `isCdc` branch dựa trên
> `issue_type === "cdc_failure"` và `has(m, "job_name")`. CDC findings từ topic `cdc_health`
> sẽ trigger đúng CDC render path mà không cần sửa renderer.

**(c) Thêm `cdc_health` entry** vào object trả về (sau `ag_health` entry):
```typescript
cdc_health: {
  key: "cdc_health",
  headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Node</th>" +
              "<th>Severity</th><th>Job</th><th>Status</th><th>AI Analyses</th><th>Action</th>",
  showBlockingFilter: false,
  renderRow: renderCdcHealthFindingRow,
},
```

### Bước 2.2 — `layer3/apps/web/dashboard/dashboard.ts`

Trong `layoutKeyForTopic()` — thêm 1 dòng sau condition ag_health:
```typescript
if (id === "ag_health" || id === "ag_redo_secondary") return "ag_health";
if (id === "cdc_health") return "cdc_health";   // thêm dòng này
return "default";
```

### Bước 2.3 — Build & deploy Layer 3

```powershell
# Từ layer3/
npm run build
docker compose build layer3 && docker compose up -d layer3
```

---

## Phần 3 — Docs cập nhật

- **`docs/topics/ag_health.md`**: bỏ phần CDC khỏi Section 3 (Metrics) và Section 4 (Flow),
  thêm link đến `docs/topics/cdc_health.md`
- **Tạo mới `docs/topics/cdc_health.md`**: reference card cho topic mới

---

## Verification

| Check | Cách verify |
|---|---|
| `ag_health` không còn CDC query | `db.monitor_topics.findOne({topic_id:"ag_health"}).queries` — chỉ còn `ag_sync_state` |
| `cdc_health` tồn tại | `db.monitor_topics.findOne({topic_id:"cdc_health"})` — có `cdc_jobs` query, schedule=300 |
| Layer 1 scheduler | Log layer1: thấy job `cdc_health` được register, chạy mỗi 300s |
| Telegram alert AG | Alert từ `ag_health` không còn field `cdc_job_failed`/`cdc_job_retry` |
| Telegram alert CDC | Alert từ `cdc_health` có `job_name` + `run_status` |
| Layer 3 CDC layout | Topic `cdc_health` hiện đúng header: "Job \| Status", không phải "Sync State \| Lag" |
| /analyze CDC finding | Route đúng `cdc.yaml` skill (issue_type=`cdc_failure`) |
