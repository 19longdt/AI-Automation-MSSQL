# Plan: Maintenance Campaign Feature

## Context

Hiện tại maintenance chạy theo kiểu **ad-hoc hàng đêm**: scan toàn DB → enqueue → execute → lặp lại ngày hôm sau. Vấn đề: `dm_db_index_physical_stats` quét toàn bộ pages mỗi đêm → rất chậm trên DB lớn, kể cả bảng vừa REBUILD xong.

**Campaign model** thay thế hoàn toàn:
- DBA tạo **chiến dịch** (1–2 tháng) qua Layer 3 UI
- **Discovery** chạy 1 lần: full scan → build queue toàn bộ objects cần xử lý
- **Nightly execution**: chỉ pick từ campaign queue, không scan lại
- Campaign hết hạn → DBA có thể gia hạn hoặc tạo mới

**Quy tắc thiết kế:**
- Chỉ 1 campaign ACTIVE/DISCOVERING per cluster tại 1 thời điểm
- Tin vào frag% của discovery — không re-check trước khi execute
- Campaign expiry chỉ đổi status campaign, KHÔNG expire từng work item
- Execute tick check campaign status trước khi claim item

---

## Architecture

### Campaign Lifecycle

```
PENDING ──(scan cron)──→ DISCOVERING ──(scan ok)───→ ACTIVE
                                     ↘(scan fail)──→ DISCOVERY_FAILED
                                                          │
                         (scan cron auto-retry) ←────────┘

DISCOVERING ──(process crash)──→ DISCOVERY_FAILED  [startup recovery]

ACTIVE ──(end_date pass)──→ EXPIRED ──(DBA extend)──→ ACTIVE
ACTIVE ──(all items terminal)──→ COMPLETED
PENDING/ACTIVE/DISCOVERY_FAILED ──(DBA cancel via DELETE)──→ CANCELLED
```

### Scan Job (maint_scan_{cluster_id}) — thay đổi logic

```
Hiện tại: luôn scan toàn DB → enqueue

Mới:
  1. Expire campaign: if active campaign.end_date < now → EXPIRED
  2. ACTIVE/DISCOVERING campaign? → skip (nightly chỉ execute)
  3. Find PENDING hoặc DISCOVERY_FAILED campaign?
     → set DISCOVERING
     → try: run full scan → set ACTIVE(total_items=count)
     → except: set DISCOVERY_FAILED(error=str(e))
  4. Không có campaign → skip hoàn toàn
```

**Failure detection trong `_run_query()`:**
- Đổi signature: `_run_query(...) → tuple[list[dict], bool]` — trả `([], False)` khi lỗi
- `_run_discovery()` tổng hợp: nếu **tất cả** queries fail và items=0 → raise `DiscoveryError`
- Nếu **một số** queries fail nhưng vẫn có items → log warning, tiếp tục (partial discovery chấp nhận được)
- Caller bắt exception → set DISCOVERY_FAILED

**Startup recovery (trong `runner.py`):**
- Khi khởi động, trước khi register jobs: `campaign_repo.reset_stuck_discovering(cluster_id)`
- Chuyển bất kỳ campaign nào còn DISCOVERING → DISCOVERY_FAILED với `error="Process restarted during discovery"`
- Scan cron tiếp theo sẽ retry tự động

### Execute Tick (maint_tick_{cluster_id}) — thêm campaign gate

```
Thêm bước đầu: find active campaign → nếu không có hoặc EXPIRED → return 0
Còn lại giữ nguyên (claim → gate → execute → finalize)
```

---

## MongoDB Collections

### Mới: `maintenance_campaigns` (db_maintenance)

```python
campaign_id: str           # UUID 8-char
cluster_id: str            # leading field, max 12 chars
name: str                  # "Chiến dịch tháng 6/2026"
description: str | None
status: CampaignStatus     # PENDING|DISCOVERING|DISCOVERY_FAILED|ACTIVE|COMPLETED|EXPIRED|CANCELLED
discovery_error: str | None  # error message khi DISCOVERY_FAILED
start_date: datetime
end_date: datetime
discovery_started_at: datetime | None
discovery_finished_at: datetime | None
total_items: int = 0       # set sau discovery
done_count: int = 0        # incremented by execute service
failed_count: int = 0
skipped_count: int = 0
created_at: datetime
updated_at: datetime
```

Index: `{cluster_id: 1, status: 1}` (find active/pending per cluster)

### Sửa: `maintenance_queue` — thêm field

```python
campaign_id: str | None = None    # None cho items legacy (nếu có)
```

### Sửa: `maintenance_history` — thêm field

```python
campaign_id: str | None = None    # propagate từ WorkItem — cho phép audit per-campaign
```

**Lý do:** history TTL = 90 ngày, queue TTL = 14 ngày. Sau 14 ngày `item_id` không còn join được về queue để biết thuộc campaign nào. `campaign_id` phải được denormalize vào history ngay lúc insert.

---

## Files to Create / Modify

### Python — maintenance/

| File | Action | Nội dung |
|---|---|---|
| `maintenance/models/campaign.py` | **Tạo** | `CampaignStatus` enum + `MaintenanceCampaign` model |
| `maintenance/repositories/campaign_repo.py` | **Tạo** | CRUD + `find_active_or_discovering`, `find_pending`, `expire_if_past_end_date`, `increment_stats` |
| `maintenance/models/work_item.py` | **Sửa** | Thêm `campaign_id: str \| None = None` |
| `maintenance/models/history.py` | **Sửa** | Thêm `campaign_id: str \| None = None` |
| `maintenance/repositories/queue_repo.py` | **Sửa** | `claim_next_approved(cluster_id, campaign_id)` và `claim_paused_resumable(cluster_id, campaign_id)` filter by campaign_id |
| `maintenance/scan/scan_service.py` | **Sửa** | Campaign-aware: PENDING → discovery, ACTIVE → skip, no campaign → skip |
| `maintenance/execute/execute_service.py` | **Sửa** | Bước đầu: find active campaign; sau finalize: increment_stats |
| `maintenance/runner.py` | **Sửa** | Pass `campaign_repo` vào scan/execute services; gọi `reset_stuck_discovering` per cluster trước khi register jobs |

### Layer 3 Express API

| File | Action | Nội dung |
|---|---|---|
| `layer3/apps/api/src/db/collections.ts` | **Sửa** | Thêm `campaigns: "maintenance_campaigns"` |
| `layer3/apps/api/src/schemas/campaigns.schema.ts` | **Tạo** | Schema validation cho tất cả campaign routes (xem chi tiết bên dưới) |
| `layer3/apps/api/src/routes/campaigns.ts` | **Tạo** | GET/POST/PUT/DELETE `/api/maintenance/campaigns` — import schema + rate limit per route |
| `layer3/apps/api/src/services/campaign-service.ts` | **Tạo** | MongoDB CRUD + business rules (conflict check, auto-reactivate on extend) |
| `layer3/apps/api/src/server.ts` | **Sửa** | Register campaign routes |

### Layer 3 React UI

| File | Action | Nội dung |
|---|---|---|
| `layer3/apps/web-v2/src/types/index.ts` | **Sửa** | Thêm `MaintenanceCampaign`, `CampaignStatus`, `CampaignListResponse`, `CampaignCreateBody`, `CampaignUpdateBody` types |
| `layer3/apps/web-v2/src/lib/query-keys.ts` | **Sửa** | Thêm `campaigns(p)` key — bắt buộc, không hardcode string |
| `layer3/apps/web-v2/src/hooks/useMaintenance.ts` | **Sửa** | Thêm `useCampaigns()`, `useCreateCampaign()`, `useUpdateCampaign()`, `useCancelCampaign()` — tất cả dùng `qk.*` |
| `layer3/apps/web-v2/src/pages/MaintenancePage.tsx` | **Sửa** | Thêm tab "Chiến dịch" |
| `layer3/apps/web-v2/src/components/maintenance/CampaignList.tsx` | **Tạo** | Danh sách campaigns + status badge + progress bar + actions |
| `layer3/apps/web-v2/src/components/maintenance/CampaignForm.tsx` | **Tạo** | Modal tạo/sửa campaign (name, description, start/end date) |

---

## API Endpoints & Schema

```
GET    /api/maintenance/campaigns?cluster_id=&status=&page=0&limit=20   [no rate limit]
POST   /api/maintenance/campaigns          body: { cluster_id, name, description?, start_date, end_date }  [max: 10/min]
PUT    /api/maintenance/campaigns/:id      body: { name?, description?, end_date? }                        [max: 10/min]
DELETE /api/maintenance/campaigns/:id                                                                      [max: 5/min]
```

**`schemas/campaigns.schema.ts`** — theo đúng pattern `maintenance.schema.ts`:

```typescript
const campaignStatusEnum = ["PENDING","DISCOVERING","DISCOVERY_FAILED",
                            "ACTIVE","COMPLETED","EXPIRED","CANCELLED", ""] as const;
const isoDatePattern = "^\\d{4}-\\d{2}-\\d{2}(T[\\d:.Z+-]+)?$";

export const campaignListSchema = {
  querystring: {
    type: "object",
    properties: {
      cluster_id: { type: "string", minLength: 1, maxLength: 12 },
      status:     { type: "string", enum: campaignStatusEnum },
      limit:      { type: "integer", minimum: 1, maximum: 100, default: 20 },
      page:       { type: "integer", minimum: 0, default: 0 }
    },
    additionalProperties: false
  }
} as const;

export const campaignCreateSchema = {
  body: {
    type: "object",
    required: ["cluster_id", "name", "start_date", "end_date"],
    properties: {
      cluster_id:  { type: "string", minLength: 1, maxLength: 12 },
      name:        { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      start_date:  { type: "string", pattern: isoDatePattern },
      end_date:    { type: "string", pattern: isoDatePattern }
    },
    additionalProperties: false
  }
} as const;

export const campaignUpdateSchema = {
  params: { type: "object", required: ["id"],
            properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
            additionalProperties: false },
  body: {
    type: "object",
    properties: {
      name:        { type: "string", minLength: 1, maxLength: 100 },
      description: { type: "string", maxLength: 500 },
      end_date:    { type: "string", pattern: isoDatePattern }
    },
    additionalProperties: false,
    minProperties: 1     // ít nhất 1 field phải có
  }
} as const;

export const campaignIdParamSchema = {
  params: { type: "object", required: ["id"],
            properties: { id: { type: "string", minLength: 1, maxLength: 64 } },
            additionalProperties: false }
} as const;
```

**Rate limit trong `routes/campaigns.ts`** — cùng pattern `actions.ts`:
```typescript
// POST
{ schema: campaignCreateSchema, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }

// PUT
{ schema: campaignUpdateSchema, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }

// DELETE — destructive, same as kill-session
{ schema: campaignIdParamSchema, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }
```

**Business rules trong service:**
- POST: check không có ACTIVE/DISCOVERING campaign cùng cluster → 409 nếu có
- POST: validate `end_date > start_date` → 400 nếu sai
- PUT end_date: nếu campaign đang EXPIRED và end_date mới > now → auto set status=ACTIVE
- DELETE: chỉ PENDING/ACTIVE/DISCOVERY_FAILED → CANCELLED; COMPLETED/EXPIRED → 400

---

## UI — Campaign là tab thứ 3 trong "Operations Detail"

**Layout thực tế của `MaintenancePage.tsx`:**
```
<PageShell>
  <HeroSection>           ← MetricCards (Awaiting/Running/Done/Failed)
  <WindowStatusBar>       ← standalone block
  <PipelineStages>        ← standalone block (không phải tab)
  <Tabs "Operations Detail">
    Queue | History | Campaigns ← Campaign thêm vào đây
  </Tabs>
</PageShell>
```

**Thay đổi trong `MaintenancePage.tsx`:**
- Đổi type state: `"queue" | "history" | "campaigns"`
- Thêm `<TabsTrigger value="campaigns">Campaigns</TabsTrigger>`
- Thêm `<TabsContent value="campaigns"><CampaignList /></TabsContent>`
- Reset tab về `"queue"` khi đổi cluster (giữ nguyên logic hiện tại)

**`CampaignList.tsx`** — nội dung tab Campaigns:
```
┌─────────────────────────────────────────────────────┐
│ [+ Tạo chiến dịch]                          (right) │
│                                                      │
│ 🟢 ACTIVE   Chiến dịch tháng 6        01/06–30/06   │
│             247 items │ ████████░░ 180 done │ 67 còn │
│             [Gia hạn] [Huỷ]                          │
│                                                      │
│ ⚠  DISCOVERY_FAILED  Chiến dịch tháng 7  01/07–31/07│
│             Lỗi: "All scan queries failed"           │
│             [Thử lại sẽ auto vào 20:00] [Huỷ]       │
│                                                      │
│ ⏳ PENDING  Chiến dịch tháng 8        01/08–31/08   │
│             Chờ discovery (scan 20:00 tối nay)       │
│             [Sửa] [Huỷ]                              │
│                                                      │
│ ✓ COMPLETED Chiến dịch tháng 5        01/05–31/05   │
│             189/189 done                             │
└─────────────────────────────────────────────────────┘
```

**`CampaignForm.tsx`** — modal dùng chung cho tạo và sửa:
- Tên chiến dịch (required)
- Mô tả (optional)
- Ngày bắt đầu / Ngày kết thúc (date picker, validate end > start)
- Cluster auto-fill từ `selectedClusterId`

**Gia hạn:** reuse `CampaignForm` với mode `"extend"` — chỉ hiện field end_date

---

## Key Implementation Details

### `campaign_repo.py` — method quan trọng

```python
def find_active_or_discovering(cluster_id) -> MaintenanceCampaign | None:
    # status IN [ACTIVE, DISCOVERING]

def find_pending_or_failed(cluster_id) -> MaintenanceCampaign | None:
    # status IN [PENDING, DISCOVERY_FAILED], sort start_date ASC

def reset_stuck_discovering(cluster_id) -> int:
    # updateMany: {cluster_id, status: DISCOVERING} → {status: DISCOVERY_FAILED, error: "Process restarted"}
    # Gọi trong runner.py startup trước khi register jobs

def expire_if_past_end_date(cluster_id, now) -> bool:
    # updateOne: {cluster_id, status: ACTIVE, end_date: {$lt: now}} → {status: EXPIRED}
    # returns True nếu có record bị expire

def increment_stats(campaign_id, *, done=0, failed=0, skipped=0):
    # $inc các counter; sau đó check nếu done+failed+skipped >= total_items → COMPLETED
```

### `scan_service.py` — discovery flow

```python
def run(self) -> int:
    now = now_vn()
    # 1. Expire check
    campaign_repo.expire_if_past_end_date(cluster_id, now)

    # 2. Active/Discovering? skip
    if campaign_repo.find_active_or_discovering(cluster_id):
        return 0

    # 3. Pending hoặc DISCOVERY_FAILED? → retry discovery
    pending = campaign_repo.find_pending_or_failed(cluster_id)
    if not pending:
        return 0

    campaign_repo.update_status(pending.campaign_id, DISCOVERING, discovery_started_at=now_vn())
    try:
        count = self._run_discovery(pending.campaign_id)
        # _run_discovery raise DiscoveryError nếu tất cả queries fail và items=0
        campaign_repo.update_status(pending.campaign_id, ACTIVE,
                                    discovery_finished_at=now_vn(), total_items=count)
        return count
    except Exception as exc:
        logger.error("Discovery failed for campaign=%s: %s", pending.campaign_id, exc)
        campaign_repo.update_status(pending.campaign_id, DISCOVERY_FAILED,
                                    discovery_error=str(exc))
        return 0
```

### `query-keys.ts` — thêm campaign key

```typescript
// Thêm vào qk object, cùng pattern với maintenanceSummary/Queue/History:
campaigns: (p: CampaignListQuery) => ["campaigns", p] as const,
```

**Invalidation pattern trong mutations** (trong `useMaintenance.ts`):

```typescript
// useCreateCampaign, useUpdateCampaign, useCancelCampaign:
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  // Dùng prefix ["maintenance-summary"] — phủ hết mọi variant có cluster_id
  // KHÔNG dùng qk.maintenanceSummary({}) vì tạo key ["maintenance-summary", {}]
  // không match ["maintenance-summary", { cluster_id: "prod" }]
  void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
}
```

`["campaigns"]` và `["maintenance-summary"]` đều là prefix invalidation — React Query match bất kỳ key nào bắt đầu bằng prefix đó, phủ hết mọi filter/cluster variant.

### `execute_service.py` — thêm campaign gate

```python
def tick(self) -> int:
    # TRƯỚC window check
    campaign = campaign_repo.find_active_or_discovering(cluster_id)
    if not campaign or campaign.status != CampaignStatus.ACTIVE:
        return 0

    # ... (existing window + gate + claim logic, truyền campaign_id)

    # history_repo.insert() — truyền campaign_id từ item:
    MaintenanceHistory(..., campaign_id=item.campaign_id)

    # Sau finalize(DONE/FAILED/SKIPPED):
    if status in TERMINAL_STATUSES:
        campaign_repo.increment_stats(campaign.campaign_id,
            done=1 if status==DONE else 0,
            failed=1 if status==FAILED else 0,
            skipped=1 if status==SKIPPED else 0)
```

---

## Verification

1. Tạo campaign qua Layer 3 UI → status PENDING trong MongoDB
2. Scan cron trigger (hoặc manual) → status DISCOVERING → ACTIVE; items có `campaign_id`
3. Execute tick → chỉ pick items có `campaign_id` đúng; history ghi nhận
4. Tạo 2nd campaign cùng cluster → API 409 conflict
5. PUT end_date = quá khứ → campaign EXPIRED, tick dừng claim
6. PUT end_date mới (tương lai) → status ACTIVE, tick tiếp tục
7. `tsc --noEmit` trong layer3/ → không lỗi
8. `docker compose up -d maintenance` → log không lỗi
