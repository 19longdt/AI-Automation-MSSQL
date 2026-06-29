# Plan 02 — Campaign Scope & Window Config

## Mục tiêu

- Campaign được giới hạn phạm vi: DBA chọn db/schema/tables **từ catalog data** (Plan 01) — không cần chạy lại DMV scan
- Discovery đọc từ `maintenance_catalog` → tạo work items — nhanh (seconds thay vì phút/giờ)
- Campaign có thể định nghĩa window thực thi riêng (thay vì dùng global window của cluster)
- Default window seed đổi: 02:30–05:00

**Phụ thuộc:** Plan 01 — `maintenance_catalog` phải có data trước khi DBA tạo campaign

---

## 1. Thay đổi kiến trúc Discovery

### Trước (scan live DMV)
```
Campaign PENDING → scan job → dm_db_index_physical_stats (30–60 phút) → work items
```

### Sau (đọc từ catalog)
```
Campaign PENDING → discovery → đọc maintenance_catalog → apply thresholds → work items (seconds)
```

**Lợi ích:**
- Không tốn I/O production trong window đêm để scan
- Discovery cực nhanh — DBA không phải chờ
- Catalog data đã có frag%, modification_counter → đủ để tạo work items với estimated_minutes chính xác
- Nếu catalog stale (> 1 ngày) → discovery log warning nhưng vẫn chạy

---

## 2. Model Changes

### 2a. `maintenance/models/campaign.py` — Sửa

```python
import re
from pydantic import BaseModel, Field, field_validator, model_validator

_HH_MM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

class CampaignScopeTable(BaseModel):
    """Value object: schema + optional table list trong campaign scope."""
    schema_name: str
    table_names: list[str] = Field(default_factory=list)
    # Rỗng = toàn bộ tables trong schema (đã có trong catalog)

    @field_validator("schema_name")
    @classmethod
    def schema_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("schema_name cannot be empty")
        return v

    @field_validator("table_names")
    @classmethod
    def table_names_strip(cls, v: list[str]) -> list[str]:
        return [t.strip() for t in v if t.strip()]

class CampaignScopeDatabase(BaseModel):
    """Value object: database + schemas trong campaign scope."""
    database_name: str
    schemas: list[CampaignScopeTable] = Field(min_length=1)

    @field_validator("database_name")
    @classmethod
    def database_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("database_name cannot be empty")
        return v

class CampaignWindowOverride(BaseModel):
    """Value object: window thực thi riêng cho campaign (thay global window)."""
    start: str                  # "HH:MM" VN time
    end: str                    # "HH:MM" VN time (hỗ trợ qua đêm: start > end)
    time_budget_minutes: int = Field(ge=30, le=1440)

    @field_validator("start", "end")
    @classmethod
    def must_be_hhmm(cls, v: str) -> str:
        if not _HH_MM_RE.match(v):
            raise ValueError(f"Must be HH:MM format, got: {v!r}")
        return v

    @model_validator(mode="after")
    def start_not_equal_end(self) -> "CampaignWindowOverride":
        if self.start == self.end:
            raise ValueError("start and end cannot be identical")
        return self

class MaintenanceCampaign(BaseModel):
    ...
    # Thêm vào fields hiện có:
    scope: list[CampaignScopeDatabase] | None = None
    # None = lấy tất cả tables có trong catalog của cluster này

    window_override: CampaignWindowOverride | None = None
    # None = dùng global window của cluster

    # Từ plan-01:
    execution_types: list[ExecutionType] = Field(
        default_factory=lambda: [ExecutionType.INDEX, ExecutionType.STATISTIC, ExecutionType.HEAP],
        min_length=1,
    )

    # Budget tích lũy khi dùng window_override (xem section 11)
    window_budget_used_minutes: float = 0.0
```

---

## 3. Discovery — Đọc Từ Catalog

### 3a. `maintenance/discovery/discovery_service.py` — Sửa hoàn toàn `_run_discovery()`

```python
def _run_discovery(self, campaign: MaintenanceCampaign) -> int:
    """
    Thay vì chạy DMV queries, đọc từ maintenance_catalog.
    Return: số work items được tạo.
    """
    self._resolver.reload()
    default_policy = self._resolver.resolve("__default__", "__default__")

    # Cảnh báo nếu catalog stale
    catalog_age = self._check_catalog_age()
    if catalog_age is not None and catalog_age.total_seconds() > 48 * 3600:
        logger.warning(
            "Catalog data is %d hours old for cluster=%s — work items may not reflect current state",
            catalog_age.total_seconds() / 3600,
            self._cluster.cluster_id,
        )

    # Đọc từ catalog theo scope + execution_types
    catalog_tables = self._catalog_repo.find_for_campaign(
        cluster_id=self._cluster.cluster_id,
        scope=campaign.scope,
        execution_types=campaign.execution_types,
    )
    if not catalog_tables:
        logger.info(
            "Discovery: no catalog data for cluster=%s scope=%s",
            self._cluster.cluster_id, campaign.scope,
        )
        return 0

    batch = MaintenanceBatch(cluster_id=self._cluster.cluster_id)
    items: list[WorkItem] = []

    for table_doc in catalog_tables:
        schema = table_doc["schema_name"]
        table = table_doc["table_name"]
        policy = self._resolver.resolve(schema, table)
        if not policy.enabled:
            continue

        db_name = table_doc["database_name"]

        # INDEX items (REBUILD / REORGANIZE)
        if ExecutionType.INDEX in campaign.execution_types:
            for idx in table_doc.get("indexes", []):
                item = self._map_index_from_catalog(
                    idx, table_doc, db_name, batch.batch_id, campaign.campaign_id, policy
                )
                if item:
                    items.append(item)

        # STATISTIC items (UPDATE STATISTICS)
        if ExecutionType.STATISTIC in campaign.execution_types:
            for stat in table_doc.get("statistics", []):
                item = self._map_stat_from_catalog(
                    stat, table_doc, db_name, batch.batch_id, campaign.campaign_id, policy
                )
                if item:
                    items.append(item)

        # HEAP items (HEAP REBUILD)
        if ExecutionType.HEAP in campaign.execution_types:
            fwd = table_doc.get("heap_forwarded_count")
            if fwd is not None:
                item = self._map_heap_from_catalog(
                    fwd, table_doc, db_name, batch.batch_id, campaign.campaign_id, policy
                )
                if item:
                    items.append(item)

    if not items:
        return 0

    # Dedup vs open queue
    open_keys = self._queue_repo.find_open_keys(self._cluster.cluster_id)
    fresh = [i for i in items if i.dedupe_key() not in open_keys]
    if not fresh:
        return 0

    batch.item_count = len(fresh)
    batch.summary = self._build_summary(fresh)
    self._queue_repo.insert_many(fresh)
    self._batch_repo.insert(batch)

    if self._notifier is not None:
        message_id = self._notifier.send_batch_approval(
            batch, fresh, top_n=self._settings.maint_batch_top_n_items
        )
        if message_id is not None:
            self._batch_repo.set_message_id(self._cluster.cluster_id, batch.batch_id, message_id)

    return len(fresh)
```

### 3b. `_map_index_from_catalog()` — Apply thresholds từ policy

```python
def _map_index_from_catalog(self, idx, table_doc, db_name, batch_id, campaign_id, policy) -> WorkItem | None:
    frag = idx.get("fragmentation_pct") or 0.0
    pages = idx.get("page_count") or 0
    if pages < policy.min_page_count:
        return None
    if frag < policy.reorganize_threshold_pct:
        return None

    is_partitioned = idx.get("is_partitioned", False)
    action = (ActionType.REBUILD_PARTITION if is_partitioned else ActionType.REBUILD) \
             if frag >= policy.rebuild_threshold_pct else ActionType.REORGANIZE

    item = WorkItem(
        cluster_id=self._cluster.cluster_id,
        campaign_id=campaign_id,
        batch_id=batch_id,
        kind=ItemKind.INDEX_FRAG,
        action_type=action,
        database_name=db_name,
        schema_name=table_doc["schema_name"],
        table_name=table_doc["table_name"],
        index_name=idx["index_name"],
        object_id=table_doc["object_id"],
        index_id=idx["index_id"],
        metrics=WorkItemMetrics(
            fragmentation_pct=frag,
            page_count=pages,
            record_count=table_doc.get("row_count", 0),
        ),
    )
    self._finalize_item(item, policy)
    return item
```

Tương tự cho `_map_stat_from_catalog()` và `_map_heap_from_catalog()`.

### 3c. `catalog_repo.find_for_campaign()` — Query MongoDB

```python
def find_for_campaign(
    self,
    cluster_id: str,
    scope: list[CampaignScopeDatabase] | None,
    execution_types: list[str],
) -> list[dict]:
    """
    Trả về catalog documents phù hợp với scope.
    Filter trên MongoDB: cluster_id + database + schema + table.
    Không filter theo frag/stats threshold ở đây — để scan_service apply policy.
    """
    match: dict = {"cluster_id": cluster_id}

    if scope:
        or_conditions = []
        for db_scope in scope:
            for schema_scope in db_scope.schemas:
                cond = {
                    "database_name": db_scope.database_name,
                    "schema_name": schema_scope.schema_name,
                }
                if schema_scope.table_names:
                    cond["table_name"] = {"$in": schema_scope.table_names}
                or_conditions.append(cond)
        if or_conditions:
            match["$or"] = or_conditions

    # Chỉ lấy documents có data liên quan đến execution_types được chọn
    # Nếu chỉ INDEX → không cần documents không có indexes
    # Để đơn giản: lấy tất cả document trong scope, scan_service tự filter
    return list(self.collection.find(match))
```

---

## 4. Execute Service — Window Override

### `maintenance/execute/execute_service.py` — Sửa

```python
def tick(self) -> int:
    ...
    campaign = self._campaign_repo.find_active_or_discovering(self._cluster.cluster_id)
    if not campaign or campaign.status != CampaignStatus.ACTIVE:
        return 0

    # Dùng window override nếu campaign có cấu hình riêng
    state = self._resolve_window_state(campaign, now)
    if not state.open:
        return 0
    ...

def _resolve_window_state(self, campaign: MaintenanceCampaign, now: datetime) -> WindowState:
    if campaign.window_override:
        return self._window_service.state_from_override(
            now,
            start=campaign.window_override.start,
            end=campaign.window_override.end,
            budget_minutes=campaign.window_override.time_budget_minutes,
            budget_used_minutes=campaign.window_budget_used_minutes,  # tích lũy qua các đêm
        )
    return self._window_service.state(now)
```

### `maintenance/window/window_service.py` — Sửa

Thêm `state_from_override(now, start, end, budget_minutes, budget_used_minutes) -> WindowState`:
- Parse HH:MM → datetime (hỗ trợ qua đêm khi start > end)
- Budget tích lũy: `remaining = max(0, budget_minutes - budget_used_minutes)` — nhất quán với section 11
- `budget_used_minutes` được đọc từ `campaign.window_budget_used_minutes` mỗi tick

---

## 5. Layer 3 API — Sửa

### `layer3/apps/api/src/schemas/campaigns.schema.ts` — Sửa

```typescript
const scopeTableSchema = {
  type: "object",
  required: ["schema_name"],
  properties: {
    schema_name: { type: "string", minLength: 1 },
    table_names: { type: "array", items: { type: "string" }, default: [] },
  },
};

const scopeDatabaseSchema = {
  type: "object",
  required: ["database_name", "schemas"],
  properties: {
    database_name: { type: "string", minLength: 1 },
    schemas: { type: "array", items: scopeTableSchema, minItems: 1 },
  },
};

const windowOverrideSchema = {
  type: "object",
  required: ["start", "end", "time_budget_minutes"],
  properties: {
    start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    end:   { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    time_budget_minutes: { type: "integer", minimum: 30, maximum: 1440 },
  },
};

// Thêm vào campaignCreateSchema.body và campaignUpdateSchema.body:
// scope: { type: "array", items: scopeDatabaseSchema, nullable: true, default: null }
// window_override: { ...windowOverrideSchema, nullable: true, default: null }
// execution_types: { type: "array", items: { enum: ["index","statistic","heap"] }, default: ["index","statistic","heap"] }
```

### `layer3/apps/api/src/services/campaign-service.ts` — Sửa

- `CampaignCreateBody`, `CampaignUpdateBody`: thêm `scope?`, `window_override?`, `execution_types?`
- `mapCampaign()`: map đầy đủ các fields mới
- `createCampaign()`: persist scope + window_override + execution_types
- `updateCampaign()`: cho phép update scope + window_override khi PENDING; execution_types khi PENDING

---

## 6. Layer 3 UI — CampaignForm.tsx

### Luồng tạo campaign mới

```
Bước 1: Chọn Cluster  →  Load catalog databases

Bước 2: Chọn phạm vi thực thi
┌─────────────────────────────────────────────────────────────┐
│ Database: [YourDatabase ▼]                                  │
│ Schema:   [dbo ▼]         Captured: 2026-06-24 06:03       │
│                                                             │
│ ☐ Tất cả bảng trong schema                                 │
│ ● Chọn bảng cụ thể (từ catalog):                           │
│                                                             │
│  ☑ Orders         2.45M rows  Frag: 42% ⚠  Stats: 3 stale │
│  ☑ OrderItems     8.12M rows  Frag: 15%    Stats: OK       │
│  ☐ Customers        890K rows  Frag:  2%    Stats: OK       │
│  ☑ TempLog           500 rows  Frag:  1%    Heap: 5% ⚠     │
│                                                             │
│ [+ Thêm schema/database khác]                              │
└─────────────────────────────────────────────────────────────┘

Bước 3: Loại thực thi
  ☑ Index (Rebuild/Reorganize)
  ☑ Statistics (Update Stats)
  ☑ Heap Rebuild

Bước 4: Thời gian
  Ngày bắt đầu: [2026-07-01]   Ngày kết thúc: [2026-07-31]
  Giờ discovery (scan): [20:00] [+ thêm giờ]

  ☐ Dùng window mặc định của cluster (02:30–05:00)
  ● Tùy chỉnh window:
      Bắt đầu: [08:00]  Kết thúc: [12:00]  Budget: [120] phút
      ⚠ Chạy ban ngày — đảm bảo gates đã cấu hình nghiêm ngặt
```

**Ghi chú UI:**
- Bảng hiển thị thông tin từ catalog (`captured_at` rõ ràng)
- Bảng có warning icon nếu frag > 30%, stats stale, heap > threshold
- Nếu catalog rỗng (chưa chạy) → hiện thông báo "Chưa có dữ liệu catalog. Vui lòng chạy catalog job trước."
- `execution_types` ảnh hưởng đến filter: chọn "Index only" → ẩn bảng không có index issue

---

## 7. Types (`types/index.ts`) — Sửa

```typescript
export interface CampaignScopeTable { schema_name: string; table_names: string[]; }
export interface CampaignScopeDatabase { database_name: string; schemas: CampaignScopeTable[]; }

export interface CampaignWindowOverride {
  start: string; end: string; time_budget_minutes: number;
}

// Thêm vào CampaignCreateBody và CampaignUpdateBody:
scope?: CampaignScopeDatabase[] | null;
window_override?: CampaignWindowOverride | null;
execution_types?: ExecutionType[];

// Thêm vào MaintenanceCampaign:
scope: CampaignScopeDatabase[] | null;
window_override: CampaignWindowOverride | null;
execution_types: ExecutionType[];
```

---

## 8. Seed — Default Window

`maintenance/seed/seed_maintenance.py` — đổi default:

```python
DEFAULT_WINDOW_SLOTS = [{"start": "02:30", "end": "05:00", "time_budget_minutes": 150}]
```

---

## 9. Rename: scan → discovery

| Cũ | Mới |
|---|---|
| `maintenance/scan/scan_service.py` | `maintenance/discovery/discovery_service.py` |
| `ClusterScanService` | `ClusterDiscoveryService` |
| `ScanService` alias | `DiscoveryService` alias |
| job id `maint_scan_{cid}` | `maint_discovery_{cid}` |
| `runner.py`: `scan_service` var | `discovery_service` var |

`maintenance/scan/` directory — xóa sau khi move xong. `ScanQueryRepo` + `maintenance_scan_queries` — giữ lại, đánh dấu obsolete (xem plan-01 section 13).

---

## 10. Scope Validation tại API

`campaign-service.ts` — trong `createCampaign()`, sau khi validate schema, check scope với catalog config:

```typescript
async function validateScopeAgainstCatalogConfig(
  clusterId: string,
  scope: CampaignScopeDatabase[] | null | undefined,
  db: Db,
): Promise<string | null> {
  if (!scope || scope.length === 0) return null;  // null scope = OK

  const config = await db.collection("maintenance_catalog_config")
    .findOne({ cluster_id: clusterId });
  if (!config) {
    return `No catalog config found for cluster '${clusterId}'. Configure scope in Catalog tab first.`;
  }

  const configDbs = new Map(
    config.databases.map((d: any) => [
      d.database_name,
      new Map(d.schemas.map((s: any) => [s.schema_name, s.table_names as string[]]))
    ])
  );

  for (const dbScope of scope) {
    const configSchemas = configDbs.get(dbScope.database_name);
    if (!configSchemas) {
      return `Database '${dbScope.database_name}' not in catalog scope for cluster '${clusterId}'.`;
    }
    for (const schemaScope of dbScope.schemas) {
      const configTables = configSchemas.get(schemaScope.schema_name);
      if (configTables === undefined) {
        return `Schema '${schemaScope.schema_name}' not in catalog scope.`;
      }
      // configTables rỗng = toàn schema → OK dù campaign chọn table cụ thể
      if (configTables.length > 0 && schemaScope.table_names.length > 0) {
        const missing = schemaScope.table_names.filter(t => !configTables.includes(t));
        if (missing.length > 0) {
          return `Tables not in catalog scope: ${missing.join(", ")}`;
        }
      }
    }
  }
  return null;  // OK
}

// Trong createCampaign():
const scopeError = await validateScopeAgainstCatalogConfig(body.cluster_id, body.scope, db);
if (scopeError) {
  throw { status: 400, message: scopeError };
}
```

---

## 11. Window Budget Tracking cho Override

Campaign model — thêm field để track budget đã dùng:

```python
# maintenance/models/campaign.py
class MaintenanceCampaign(BaseModel):
    ...
    window_budget_used_minutes: float = 0.0
    # Tích lũy mỗi tick khi campaign có window_override
```

`execute_service.py` — sau khi item DONE/PAUSED, nếu campaign có `window_override`:

```python
def _increment_window_budget(self, campaign: MaintenanceCampaign, duration_ms: float) -> None:
    if campaign.window_override is None:
        return  # global window tự track qua history_repo
    minutes_used = duration_ms / 60000
    self._campaign_repo.increment_window_budget(campaign.campaign_id, minutes_used)

# campaign_repo.py:
def increment_window_budget(self, campaign_id: str, minutes: float) -> None:
    self.collection.update_one(
        {"campaign_id": campaign_id},
        {"$inc": {"window_budget_used_minutes": minutes}, "$set": {"updated_at": now_vn()}},
    )
```

`window_service.state_from_override()` — nhận `budget_used_minutes` từ campaign, tính `remaining`:

```python
def state_from_override(self, now, start, end, budget_minutes, budget_used_minutes=0.0) -> WindowState:
    remaining = max(0.0, budget_minutes - budget_used_minutes)
    # ... check giờ, tính open/closed
```

---

## 12. Node Role Refresh trong Execute Service

Hiện tại `_get_primary_host()` đọc `self._cluster.node_roles` — được load **một lần lúc startup**. Nếu AG failover xảy ra trong đêm, execute kết nối sai node.

`execute_service.py` — thêm refresh định kỳ:

```python
_NODE_ROLE_REFRESH_SEC = 1800  # 30 phút

class ClusterExecuteService:
    def __init__(self, ..., cluster_reader) -> None:
        ...
        self._cluster_reader = cluster_reader
        self._last_role_refresh: datetime | None = None

    def _get_primary_host(self) -> str | None:
        now = now_vn()
        if (self._last_role_refresh is None or
                (now - self._last_role_refresh).total_seconds() > _NODE_ROLE_REFRESH_SEC):
            try:
                fresh = self._cluster_reader.find_by_id(self._cluster.cluster_id)
                if fresh:
                    self._cluster = fresh
                    self._last_role_refresh = now
                    logger.debug("Node roles refreshed for cluster=%s", self._cluster.cluster_id)
            except Exception as exc:
                logger.warning("Node role refresh failed for cluster=%s: %s",
                               self._cluster.cluster_id, exc)
                # Dùng roles cũ nếu refresh fail

        for node_role in self._cluster.node_roles:
            if str(node_role.role).lower() == "primary":
                return node_role.host
        return None
```

`ClusterReader` — thêm `find_by_id(cluster_id) -> ClusterConfig | None`.

`runner.py` — truyền `cluster_reader` vào `ClusterExecuteService`.

---

## 13. Validation Rules (Updated)

| Rule | Enforcement |
|---|---|
| scope chỉ update khi PENDING | Service layer |
| window_override chỉ update khi PENDING/ACTIVE | Service layer |
| execution_types phải có ít nhất 1 loại | API schema validation |
| window_override.budget >= 30 phút | API schema validation |
| scope.database/schema phải khớp catalog_config | API service layer — 400 nếu không khớp |
| Catalog rong khi tao campaign | UI block (plan-01 section 11) + API warning log |

---

## 14. Verification

1. Scope nằm ngoài catalog_config → API 400 với message rõ ràng
2. Scope hợp lệ → discovery chỉ tạo items cho tables trong scope (< 5 giây)
3. Work items có đúng `action_type` theo `execution_types`
4. Campaign `window_override {22:00–23:30, budget: 90}` → tick chỉ chạy trong khung đó, dừng sau 90 phút
5. AG failover → sau 30 phút execute service tự detect primary mới
6. `window_budget_used_minutes` tăng đúng sau mỗi item DONE
7. `tsc --noEmit` không lỗi

---

## Rủi ro & Lưu ý

- **Catalog stale khi execute:** Discovery tạo work items dựa trên frag% lúc catalog chạy. Đây là trade-off được chấp nhận.
- **Catalog rỗng = discovery = 0 items:** Campaign về COMPLETED với 0 items — log phải rõ lý do.
- **Window override ban ngày:** DDL trong giờ peak nguy hiểm — UI warning nổi bật. Gates phải strict.
- **Scope null = lấy toàn catalog:** Catalog scope config nhỏ → campaign scope null chỉ lấy được những gì catalog đã capture.
