# Plan — AG health: phân tích được (L1) + AG detail view khoa học trên dashboard (L3)

## Context

Reply `/quick` hoặc bấm **Analyze** trên alert `ag_health` → bot báo *"Topic ag_health chưa có analysis_config"*. Gốc: `_ag_health()` ([seed_topics.py:97-155](layer1/seed/seed_topics.py#L97-L155)) seed **thiếu `analysis_config`** → bot chặn ở [telegram_bot.py:343](layer1/notifications/telegram_bot.py#L343). Rà soát thêm: query AG thiếu suspend/failover/connected state; finding gắn nhầm `wait_anomaly` (fallback [threshold_detector.py:163](layer1/detectors/threshold_detector.py#L163)) khiến L2 route nhầm skill; redo lag đọc từ primary bị trễ; và L3 hiện đổ JSON thô vì finding rơi vào layout `default`.

Đã chốt với user: (1) tách 2 topic — primary cho AG sync+CDC, secondary cho redo lag cục bộ; (2) L3 hiển thị view "Status header + sections" có tooltip glossary `?` cho từng field.

---
# PHẦN 1 — Layer 1

## Bước 1.1 — [layer1/models/topic_constants.py](layer1/models/topic_constants.py)
Thêm sau dòng `TOPIC_AG_HEALTH`:
```python
TOPIC_AG_REDO_SECONDARY = "ag_redo_secondary"
```

## Bước 1.2 — [layer1/seed/seed_topics.py](layer1/seed/seed_topics.py)

**(a)** Import: thêm `TOPIC_AG_REDO_SECONDARY` vào block import từ `..models.topic_constants` (dòng 36-52).

**(b)** `_all_topics()` (dòng 75-92): thêm `_ag_redo_secondary(),` ngay sau `_ag_health(),`.

**(c)** Docstring (dòng 13-28): thêm dòng `1b. ag_redo_secondary  — AG Redo Lag trên Secondary (2 phút)`.

**(d)** Thay toàn bộ phần `detector_type=...` cuối `_ag_health()` (dòng 148-155) — và mở rộng SQL query `ag_sync_state` (dòng 108-122). Hàm `_ag_health()` sau khi sửa:

```python
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
                description="CDC capture và cleanup job status",
                sql="""<GIỮ NGUYÊN SQL cdc_jobs hiện tại (dòng 128-144)>""",
                timeout_sec=20,
            ),
        ],
        detector_type="threshold",
        thresholds={
            "log_send_queue_size": ThresholdConfig(warning=500, critical=1000),
            # is_suspended: bit (1=data movement đã dừng) → higher-is-worse, suspend = CRITICAL
            "is_suspended": ThresholdConfig(warning=1, critical=1),
            # run_status: 0 = Failed → critical
            "run_status": ThresholdConfig(warning=1, critical=0),
            # NOTE: redo_queue_size CHUYỂN sang topic ag_redo_secondary (đo cục bộ chính xác hơn)
        },
        extra={
            "issue_type_map": {
                "log_send_queue_size": "ag_lag",
                "is_suspended": "ag_lag",
                "run_status": "cdc_failure",
            },
        },
        analysis_config=AnalysisConfig(
            context=(
                "AG replica sync health + CDC job status (view từ Primary). "
                "is_suspended=1 = data movement đã dừng (xem suspend_reason_desc) — nguy hiểm nhất. "
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
                "job_name", "run_status", "run_duration", "message",
            ],
        ),
    )
```

**(e)** Thêm hàm mới (đặt ngay sau `_ag_health()`):

```python
# ── 1b. AG Redo Lag (đo cục bộ trên Secondary) ───────────────────────────────
def _ag_redo_secondary() -> MonitorTopic:
    return MonitorTopic(
        topic_id=TOPIC_AG_REDO_SECONDARY,
        display_name="AG Redo Lag Monitor (Secondary local)",
        enabled=True,
        schedule_sec=120,
        nodes=["secondary"],          # node_role_cache → tất cả secondary, query song song per-node
        queries=[QueryConfig(
            query_id="redo_state_local",
            description="Redo queue/rate + secondary_lag_seconds đọc CỤC BỘ trên secondary (is_local=1)",
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
            # is_suspended chỉ context ở đây (threshold đặt ở ag_health primary để tránh double-alert)
        },
        extra={
            "issue_type_map": {
                "redo_queue_size": "ag_lag",
                "secondary_lag_seconds": "ag_lag",
            },
        },
        analysis_config=AnalysisConfig(
            context=(
                "Redo lag đo CỤC BỘ trên từng readable secondary (is_local=1) — chính xác hơn view từ primary. "
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
```

## Bước 1.3 — Áp dụng L1
```powershell
python -m layer1.seed.seed_topics --topic ag_health,ag_redo_secondary --dry-run   # xem trước
python -m layer1.seed.seed_topics --topic ag_health,ag_redo_secondary             # ghi MongoDB
docker compose restart layer1   # đăng ký APScheduler job cho topic mới ag_redo_secondary
```
> `ag_health` chỉ đổi query/threshold/config (không đổi interval) → reload mỗi run, không cần restart. Topic mới cần restart.

---
# PHẦN 2 — Layer 3 (AG detail view: "Status header + sections" + tooltip `?`)

## Bước 2.1 (FILE MỚI) — `layer3/apps/web/dashboard/topics/ag-health-detail.ts`
Pure HTML-string renderer (mirror [blocking-detail.ts](layer3/apps/web/dashboard/topics/blocking-detail.ts)). Khung:

```ts
// ag-health-detail.ts — Pure HTML-string renderer cho finding detail topic ag_health / ag_redo_secondary.
// Data contract (finding.metrics — dict PHẲNG của 1 replica từ ThresholdDetector):
//   replica_server_name, role_desc, connected_state_desc, operational_state_desc,
//   synchronization_state_desc, synchronization_health_desc, is_suspended, suspend_reason_desc,
//   is_failover_ready, log_send_queue_size, log_send_rate, redo_queue_size, redo_rate,
//   secondary_lag_seconds, last_commit_time, last_redone_time,
//   (cdc_failure): job_name, run_status, run_duration, message
//   + threshold_warning / threshold_critical (field gây alert)

function escapeHtml(s: any): string { /* giống blocking-detail.ts */ }
function has(m: any, k: string): boolean { return m[k] !== undefined && m[k] !== null && m[k] !== ""; }

// severity class cho 1 field: field gây alert lấy theo finding.severity; field phụ so threshold tĩnh
function sevClass(higherIsWorse: boolean, val: number, warn?: number, crit?: number): "ok"|"warning"|"critical" {
  if (warn === undefined) return "ok";
  if (higherIsWorse) return val >= (crit ?? Infinity) ? "critical" : val >= warn ? "warning" : "ok";
  return "ok";
}

// 1 dòng label–value; label gắn data-glossary để attachGlossaryTooltips chèn nút "?"
function fieldRow(label: string, glossaryKey: string, valueHtml: string, flagHtml = ""): string {
  return "<tr><td class='ag-label' data-glossary='" + escapeHtml(glossaryKey) + "'>" + escapeHtml(label) + "</td>" +
         "<td>" + valueHtml + flagHtml + "</td></tr>";
}
function flag(text: string, cls: string): string { return " <span class='ag-flag " + cls + "'>" + escapeHtml(text) + "</span>"; }
function pill(text: string, cls: string): string { return "<span class='ag-pill " + cls + "'>" + escapeHtml(text) + "</span>"; }
function kpi(label: string, key: string, valueHtml: string, cls: string, flagHtml = ""): string {
  return "<div class='ag-kpi'>" +
    "<div class='ag-kpi-label' data-glossary='" + escapeHtml(key) + "'>" + escapeHtml(label) + "</div>" +
    "<div class='ag-kpi-val " + cls + "'>" + valueHtml + flagHtml + "</div></div>";
}

function healthClass(m: any): "ok"|"warning"|"critical" {
  if (Number(m.is_suspended) === 1) return "critical";
  var h = String(m.synchronization_health_desc || "").toUpperCase();
  if (h === "NOT_HEALTHY") return "critical";
  if (h === "PARTIALLY_HEALTHY") return "warning";
  return "ok";
}

function renderAgHealthDetailBody(finding: any): string {
  var m = (finding && finding.metrics) || {};
  var sev = String(finding && finding.severity || "INFO");
  var isCdc = String(finding && finding.issue_type) === "cdc_failure" || has(m, "job_name");

  // 1) Status header
  var header = "<div class='ag-header'>" +
    "<div class='ag-header-title'>AG HEALTH — " + escapeHtml(m.replica_server_name || finding.node || "") +
      (m.role_desc ? " · " + escapeHtml(m.role_desc) : "") + "</div>" +
    "<div class='ag-pills'>" +
      (has(m,"synchronization_health_desc") ? pill(m.synchronization_health_desc, healthClass(m)) : "") +
      (has(m,"synchronization_state_desc") ? pill(m.synchronization_state_desc, "ok") : "") +
      (has(m,"connected_state_desc") ? pill(m.connected_state_desc,
        String(m.connected_state_desc).toUpperCase()==="CONNECTED" ? "ok":"critical") : "") +
    "</div></div>";

  // 2) KPI summary (AG) hoặc CDC
  var kpis = isCdc
    ? "<div class='ag-kpis'>" +
        kpi("CDC JOB","job_name", escapeHtml(m.job_name||""), "ok") +
        kpi("RUN STATUS","run_status", Number(m.run_status)===1?"Succeeded":"Failed", Number(m.run_status)===1?"ok":"critical") +
        kpi("DURATION","run_duration", escapeHtml(String(m.run_duration||"")), "ok") +
      "</div>"
    : "<div class='ag-kpis'>" +
        kpi("SYNC HEALTH","synchronization_health_desc", escapeHtml(m.synchronization_health_desc||"-"), healthClass(m)) +
        kpi("LOG SEND Q","log_send_queue_size", fmtKb(m.log_send_queue_size), sevClass(true, Number(m.log_send_queue_size), m.threshold_warning, m.threshold_critical)) +
        kpi("REDO Q","redo_queue_size", fmtKb(m.redo_queue_size), "ok") +
        kpi("LAG","secondary_lag_seconds", has(m,"secondary_lag_seconds")?fmtSec(m.secondary_lag_seconds):"-", sevClass(true, Number(m.secondary_lag_seconds), 30, 120)) +
      "</div>";

  // 3) Sections (label–value tables)
  var body = isCdc ? cdcSection(m) : (syncSection(m) + lagSection(m) + suspendSection(m));
  return "<div class='ag-detail'>" + header + kpis + body + "</div>";
}

// syncSection / lagSection / suspendSection / cdcSection: mỗi cái = "<div class='metric-section'>
//   <div class='metric-section-title'>...</div><table class='kv-table'><tbody>...fieldRow()...</tbody></table></div>"
// fmtKb(v)= v==null?"-": Number(v).toLocaleString()+" KB"; fmtSec(v)=...+" s"

// Tab shell match #ftab-detail / #ftab-diag (giống blocking) để bindFindingModalTabs() tái dùng
export function renderAgHealthModal(finding: any): string {
  if (!finding || !finding.has_diagnostics) return renderAgHealthDetailBody(finding);
  return "<div class='finding-modal-tabs'><div class='finding-tab-bar'>" +
    "<button type='button' class='finding-tab-btn active' data-tab='detail'>Detail</button>" +
    "<button type='button' class='finding-tab-btn' data-tab='diag'>Diagnostics</button></div>" +
    "<div class='finding-tab-pane' id='ftab-detail'>" + renderAgHealthDetailBody(finding) + "</div>" +
    "<div class='finding-tab-pane hidden' id='ftab-diag'><div class='diag-loading'>Loading...</div></div></div>";
}
```
> 3 hàm `syncSection`/`lagSection`/`suspendSection` + `cdcSection` build `.kv-table` từ các `fieldRow(...)` tương ứng (sync: replica/role/state/health/connected/operational; lag: log_send_queue/rate, redo_queue/rate, secondary_lag_seconds, last_commit/redone_time + `flag("⚠ warning >N","warning")` khi vượt; suspend: is_suspended + suspend_reason_desc + is_failover_ready, badge đỏ khi xấu).

## Bước 2.2 — [layout-registry.ts](layer3/apps/web/dashboard/topics/layout-registry.ts)
1. Dòng 1: `export type TopicLayoutKey = "slow_sessions" | "blocking" | "ag_health" | "default";`
2. Trong `TopicLayoutDeps` (cạnh `renderBlockingChainModal`): thêm
   `renderAgHealthModal: (finding: any) => string;` và `attachGlossaryTooltips: (root: HTMLElement) => void;`
3. Thêm hàm `renderAgHealthFindingRow(tr, x, idx)` (mẫu theo `renderBlockingFindingRow` dòng 127-207). innerHTML cột:
   `No | ID(copy) | Time | Role+Node | Severity | Sync State(badge) | Lag(metric chính) | AI | Action`.
   Row click:
   ```ts
   tr.addEventListener("click", async function () {
     await deps.withGlobalLoading(async function () {
       var d = await deps.apiGet("/api/findings/" + encodeURIComponent(x.finding_id));
       var hasDiag = !!(d && d.has_diagnostics);
       deps.openModal("AG Health", deps.renderAgHealthModal(d));
       var bodies = document.querySelectorAll(".modal .modal-body");
       var body = bodies[bodies.length - 1] as HTMLElement | undefined;
       if (body) deps.attachGlossaryTooltips(body);   // chèn nút "?" cho mọi [data-glossary]
       if (hasDiag) deps.bindFindingModalTabs(x.finding_id);
     });
   });
   ```
   Nút AI Analysis copy y nguyên từ handler blocking.
4. Trong object trả về (dòng 229-248) thêm entry:
   ```ts
   ag_health: {
     key: "ag_health",
     headerHtml: "<th class='no-cell'>No</th><th>ID</th><th>Time</th><th>Role + Node</th><th>Severity</th><th>Sync State</th><th>Lag</th><th>AI Analyses</th><th>Action</th>",
     showBlockingFilter: false,
     renderRow: renderAgHealthFindingRow
   },
   ```

## Bước 2.3 — [dashboard.ts](layer3/apps/web/dashboard/dashboard.ts)
1. Cạnh import dòng 6-7: thêm
   `import { renderAgHealthModal } from "./topics/ag-health-detail";`
   `import { attachGlossaryTooltips } from "./glossary-tooltip";`
2. `layoutKeyForTopic` (dòng 53-58): thêm trước `return "default";`
   `if (id === "ag_health" || id === "ag_redo_secondary") return "ag_health";`
3. `createTopicLayoutHandlers({...})` (dòng 1047-1073): thêm 2 dòng deps
   `renderAgHealthModal: renderAgHealthModal,`
   `attachGlossaryTooltips: attachGlossaryTooltips`

## Bước 2.4 — [glossary.ts](layer3/apps/web/dashboard/glossary.ts)
Thêm 13 entry (theo cấu trúc `{ term, definition, threshold?, impact, formula? }` đang dùng, tiếng Việt) với key:
`log_send_queue_size`, `log_send_rate`, `redo_queue_size`, `redo_rate`, `secondary_lag_seconds`,
`synchronization_state_desc`, `synchronization_health_desc`, `is_suspended`, `suspend_reason_desc`,
`is_failover_ready`, `connected_state_desc`, `operational_state_desc`, `run_status`.
(`hadr_sync_commit`/`hadr_work_queue` đã có — không trùng.) Mẫu 1 entry:
```ts
secondary_lag_seconds: {
  term: "secondary_lag_seconds",
  definition: "Số giây secondary đang trễ so với primary (ước lượng RPO khi đọc trên secondary).",
  threshold: "> 30s cảnh báo, > 120s nghiêm trọng (readable secondary trả data cũ).",
  impact: "Read trên secondary thấy dữ liệu cũ; nếu failover async có thể mất tới ngần ấy giây giao dịch."
},
```

## Bước 2.5 — [dashboard.css](layer3/apps/web/css/dashboard.css)
Append (dùng var màu sẵn có `--color-danger/--color-warning/--color-success`):
```css
.ag-header { padding:10px 12px; border:1px solid var(--color-border); border-radius:8px; background:var(--color-surface); margin-bottom:10px; }
.ag-header-title { font-weight:700; margin-bottom:6px; }
.ag-pills { display:flex; gap:6px; flex-wrap:wrap; }
.ag-pill { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--color-border); }
.ag-pill.ok { color:var(--color-success); border-color:var(--color-success); }
.ag-pill.warning { color:var(--color-warning); border-color:var(--color-warning); }
.ag-pill.critical { color:#fff; background:var(--color-danger); border-color:var(--color-danger); }
.ag-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
.ag-kpi { border:1px solid var(--color-border); border-radius:8px; padding:8px; background:var(--color-surface); }
.ag-kpi-label { font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--color-muted); }
.ag-kpi-val { font-size:16px; font-weight:700; margin-top:2px; }
.ag-kpi-val.ok { color:var(--color-success); }
.ag-kpi-val.warning { color:var(--color-warning); }
.ag-kpi-val.critical { color:var(--color-danger); }
.ag-label { white-space:nowrap; }
.ag-flag { font-size:11px; margin-left:6px; }
.ag-flag.warning { color:var(--color-warning); }
.ag-flag.critical { color:var(--color-danger); }
```
Không tạo file CSS mới / không sửa dashboard.html (dashboard.css đã link sẵn).

## Bước 2.6 — Build & deploy L3
Build TS theo cơ chế hiện hành của layer3, rồi `docker compose build layer3 && docker compose up -d layer3`.

---
## Lưu ý kỹ thuật
- Field text mới tự được threshold_detector đính vào `finding.metrics` ([dòng 117-120](layer1/detectors/threshold_detector.py#L117-L120)) — không cần threshold.
- `secondary_lag_seconds` có từ SQL 2016+ → OK trên 2019 Enterprise.
- Enum `AG_LAG`/`CDC_FAILURE` ([common.py:68-69](layer1/models/common.py#L68-L69)) + skill `layer2/skills/ag.yaml`/`cdc.yaml` đã map sẵn → L2 route đúng.
- L3 bundler gom file mới qua import trong dashboard.ts (giống blocking-detail.ts).

## Verification
1. **L1 dry-run**: 2 topic build OK, log in ra có `analysis_config` + `extra.issue_type_map`.
2. **MongoDB**: `db.monitor_topics.findOne({topic_id:"ag_redo_secondary"})` tồn tại; `ag_health` có `analysis_config`, không còn threshold `redo_queue_size`.
3. **Query**: log `topic_runner` — `ag_sync_state` (is_local=0, primary) + `redo_state_local` (is_local=1, mỗi secondary) chạy không lỗi SQL.
4. **/quick + /analyze**: hết báo thiếu analysis_config; L2 route đúng skill `ag.yaml`/`cdc.yaml`.
5. **Label**: alert AG → `ag_lag`, CDC → `cdc_failure` (hết `wait_anomaly`).
6. **L3 smoke (node)**: import `renderAgHealthModal` với metrics mẫu (ag_lag + cdc_failure) → trả HTML string hợp lệ, không throw (giống cách verify blocking-detail.ts).
7. **L3 UI**: mở finding `ag_health`/`ag_redo_secondary` → modal hiện status header + KPI + sections, **mỗi nhãn field có nút `?`** bật popover định nghĩa/threshold/impact; finding CDC hiện KPI + section CDC Job; có diag thì tab Diagnostics hoạt động. Không còn JSON thô.
