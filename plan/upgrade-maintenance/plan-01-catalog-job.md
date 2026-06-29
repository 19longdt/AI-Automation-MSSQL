# Plan 01 — Catalog Job (Schema/Table/Index/Stats Snapshot)

## Mục tiêu

- Thu thập snapshot định kỳ **theo phạm vi cấu hình** (không phải toàn bộ DB): databases → schemas → tables → indexes + statistics
- Chạy **per-table song song** (không phải 1 query quét toàn schema) — fault isolated, interruptible
- Lưu vào `maintenance_catalog` làm nguồn dữ liệu duy nhất cho campaign scope selection
- Campaign discovery **đọc từ catalog** thay vì chạy lại DMV scan — không tốn thêm I/O
- Thêm `execution_types` vào Campaign — chỉ tạo work items cho loại được chọn

---

## 1. Catalog Scope Config — MongoDB Collection Mới: `maintenance_catalog_config`

DBA cấu hình **một lần**, catalog job chỉ scan trong phạm vi này. Nếu không có config → skip cluster đó (không scan mù toàn DB).

### Schema document

```
{
  cluster_id: str,                    # leading field, 1 doc per cluster
  databases: [
    {
      database_name: str,             # tên database cụ thể
      schemas: [
        {
          schema_name: str,
          table_names: [str]          # rỗng = toàn bộ tables trong schema này
        }
      ]
    }
  ],
  updated_at: datetime
}
```

### Ví dụ

```json
{
  "cluster_id": "prod-cl1",
  "databases": [
    {
      "database_name": "YourDatabase",
      "schemas": [
        { "schema_name": "dbo", "table_names": [] },
        { "schema_name": "sales", "table_names": ["Orders", "OrderItems", "Invoices"] }
      ]
    }
  ]
}
```

### Index MongoDB

```python
{ "cluster_id": 1 }  # unique
```

---

## 2. MongoDB Collection: `maintenance_catalog`

1 document per table — snapshot tại thời điểm `captured_at`.

### Schema document

```
{
  cluster_id: str,
  database_name: str,
  schema_name: str,
  table_name: str,
  object_id: int,
  row_count: int,
  reserved_kb: int,
  data_kb: int,
  index_kb: int,
  indexes: [
    {
      index_id: int,
      index_name: str | null,        # null nếu là heap
      index_type: str,               # "CLUSTERED" | "NONCLUSTERED" | "HEAP" | ...
      is_unique: bool,
      is_partitioned: bool,
      fragmentation_pct: float | null,
      page_count: int | null,
      partition_count: int
    }
  ],
  statistics: [
    {
      stats_id: int,
      stats_name: str,
      last_updated: datetime | null,
      rows: int,
      rows_sampled: int,
      modification_counter: int,
      auto_created: bool
    }
  ],
  heap_forwarded_count: int | null,  # null nếu không phải heap
  captured_at: datetime
}
```

### Indexes MongoDB

```python
{ cluster_id: 1, database_name: 1, schema_name: 1, table_name: 1 }  # unique, leading
{ cluster_id: 1, captured_at: -1 }
TTL: captured_at — expireAfterSeconds: 7 * 24 * 3600  # 7 ngày
```

---

## 3. SQL Queries (Per-table — scoped theo object_id)

Không dùng query quét toàn schema. Mỗi table chạy 3 queries độc lập, truyền `object_id` cụ thể.

### 3a — Table metadata + row count (1 query per database — nhẹ, không scan pages)

Chạy 1 lần per database để lấy danh sách tables + object_id trong scope. Kết quả làm input cho bước parallel.

```sql
SELECT
  s.name           AS schema_name,
  t.name           AS table_name,
  t.object_id,
  p.row_count,
  au.reserved_pages * 8 AS reserved_kb,
  au.data_pages    * 8 AS data_kb,
  (au.reserved_pages - au.data_pages - au.used_pages) * 8 AS index_kb
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.dm_db_partition_stats p
  ON p.object_id = t.object_id AND p.index_id IN (0, 1)
JOIN (
  SELECT container_id,
    SUM(total_pages) AS reserved_pages,
    SUM(used_pages)  AS used_pages,
    SUM(data_pages)  AS data_pages
  FROM sys.allocation_units
  GROUP BY container_id
) au ON au.container_id = p.partition_id
WHERE t.is_ms_shipped = 0
  AND s.name IN ({schema_placeholders})      -- filter theo scope config
  AND t.name IN ({table_placeholders})       -- filter nếu table_names không rỗng
ORDER BY p.row_count DESC
```

### 3b — Index fragmentation per table (SAMPLED, scoped theo object_id)

Chạy per-table, truyền `?` = `object_id` cụ thể. SQL Server chỉ scan index của bảng đó.

```sql
SELECT
  i.index_id,
  i.name          AS index_name,
  i.type_desc     AS index_type,
  i.is_unique,
  ips.avg_fragmentation_in_percent AS fragmentation_pct,
  ips.page_count,
  ips.partition_number,
  (SELECT COUNT(*) FROM sys.partitions p2
   WHERE p2.object_id = i.object_id AND p2.index_id = i.index_id) AS partition_count
FROM sys.indexes i
CROSS APPLY sys.dm_db_index_physical_stats(
  DB_ID(), ?,          -- object_id truyền vào
  i.index_id, NULL, 'SAMPLED'
) ips
WHERE i.object_id = ?  -- object_id truyền vào
  AND ips.alloc_unit_type_desc IN ('IN_ROW_DATA', NULL)
ORDER BY ips.avg_fragmentation_in_percent DESC
```

### 3c — Statistics per table (scoped theo object_id)

```sql
SELECT
  stat.stats_id,
  stat.name       AS stats_name,
  stat.auto_created,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter
FROM sys.stats stat
CROSS APPLY sys.dm_db_stats_properties(stat.object_id, stat.stats_id) sp
WHERE stat.object_id = ?   -- object_id truyền vào
```

### 3d — Heap forwarded records per table (chỉ cho heap — index_id = 0)

Chỉ chạy nếu table là heap (không có clustered index).

```sql
SELECT
  ps.forwarded_record_count,
  ps.page_count,
  ps.record_count,
  ps.avg_fragmentation_in_percent AS frag_pct
FROM sys.dm_db_index_physical_stats(
  DB_ID(), ?,   -- object_id
  0, NULL, 'SAMPLED'   -- index_id=0 = heap
) ps
WHERE ps.index_type_desc = 'HEAP'
```

---

## 4. Python — Flow Thực Thi (Per-table Parallel)

### 4a. `maintenance/catalog/catalog_service.py` — Mới

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

MAX_PARALLEL_TABLES = 8     # config được
TABLE_TIMEOUT_SEC   = 120   # timeout per table, skip nếu quá

class CatalogService:
    def run(self) -> int:
        config = self._config_repo.find_by_cluster(self._cluster.cluster_id)
        if config is None:
            logger.info("Catalog skip: no scope config for cluster=%s", self._cluster.cluster_id)
            return 0

        host = self._get_primary_host()
        if host is None:
            return 0

        total = 0
        for db_scope in config.databases:
            total += self._run_database(host, db_scope)
        return total

    def _run_database(self, host: str, db_scope: DatabaseScope) -> int:
        conn_str = self._cluster.get_connection_string(host, database=db_scope.database_name)

        # Bước 1: lấy table list (1 query nhẹ)
        tables = self._collect_table_list(host, conn_str, db_scope)
        if not tables:
            return 0

        # Bước 2: per-table parallel (queries nặng)
        docs = []
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL_TABLES) as executor:
            futures = {
                executor.submit(self._collect_table_detail, host, conn_str, tbl): tbl
                for tbl in tables
            }
            for future in as_completed(futures):
                tbl = futures[future]
                try:
                    doc = future.result(timeout=TABLE_TIMEOUT_SEC)
                    if doc:
                        docs.append(doc)
                except Exception as exc:
                    logger.warning(
                        "Catalog skip table %s.%s.%s: %s",
                        db_scope.database_name, tbl["schema_name"], tbl["table_name"], exc
                    )

        # Bước 3: upsert batch vào MongoDB
        if docs:
            self._catalog_repo.upsert_batch(self._cluster.cluster_id, db_scope.database_name, docs)
        return len(docs)

    def _collect_table_detail(self, host, conn_str, tbl: dict) -> dict:
        """Chạy trong thread — queries 3b, 3c, 3d cho 1 table."""
        object_id = tbl["object_id"]
        indexes = self._query_indexes(host, conn_str, object_id)
        stats = self._query_stats(host, conn_str, object_id)
        heap_fwd = None
        is_heap = any(i["index_type"] == "HEAP" for i in indexes)
        if is_heap:
            heap_fwd = self._query_heap(host, conn_str, object_id)
        return {**tbl, "indexes": indexes, "statistics": stats,
                "heap_forwarded_count": heap_fwd, "captured_at": now_vn()}
```

### 4b. `maintenance/repositories/catalog_config_repo.py` — Mới

```python
class CatalogConfigRepo:
    COLLECTION = "maintenance_catalog_config"

    def find_by_cluster(self, cluster_id: str) -> CatalogConfig | None: ...
    def upsert(self, config: CatalogConfig) -> None: ...
```

### 4c. `maintenance/repositories/catalog_repo.py` — Mới

```python
class CatalogRepo:
    COLLECTION = "maintenance_catalog"

    def upsert_batch(self, cluster_id, database_name, docs: list[dict]) -> None:
        # bulk_write: replaceOne upsert per (cluster_id, database_name, schema_name, table_name)

    def find_databases(self, cluster_id) -> list[str]: ...
    def find_schemas(self, cluster_id, database_name) -> list[str]: ...
    def find_tables(self, cluster_id, database_name, schema_name,
                    min_frag_pct=None, has_stale_stats=False, has_heap=False
                    ) -> list[dict]: ...
    def find_table(self, cluster_id, database_name, schema_name, table_name) -> dict | None: ...
    def find_for_campaign(self, cluster_id, scope: list[ScopeItem],
                          execution_types: list[str]) -> list[dict]:
        # Query catalog theo scope + trả về tables có vấn đề cần xử lý
        # Dùng bởi discovery khi tạo work items từ catalog
        ...
```

### 4d. `maintenance/runner.py` — Sửa

```python
catalog_job_id = f"maint_catalog_{cluster_id}"

@self._job_runner.wrap(catalog_job_id)
def catalog_job(service=catalog_service) -> int:
    return service.run()

self._scheduler.add_job(
    catalog_job,
    CronTrigger.from_crontab(maint_settings.maint_catalog_cron, timezone="Asia/Ho_Chi_Minh"),
    id=catalog_job_id,
    max_instances=1,
    coalesce=True,
)
self._job_intervals[catalog_job_id] = 24 * 3600
```

### 4e. `maintenance/config.py` — Sửa

```python
maint_catalog_cron: str = "0 6 * * *"         # 06:00 VN mỗi sáng
maint_catalog_max_workers: int = 8            # số tables chạy song song
maint_catalog_table_timeout_sec: int = 120   # timeout per table
```

---

## 5. Campaign — `execution_types`

### 5a. `maintenance/models/campaign.py` — Sửa

```python
class ExecutionType(str, Enum):
    INDEX = "index"          # REBUILD / REORGANIZE
    STATISTIC = "statistic"  # UPDATE STATISTICS
    HEAP = "heap"            # HEAP REBUILD

class MaintenanceCampaign(BaseModel):
    ...
    execution_types: list[ExecutionType] = Field(
        default_factory=lambda: [ExecutionType.INDEX, ExecutionType.STATISTIC, ExecutionType.HEAP]
    )
```

Discovery (xem plan-02) đọc từ catalog và chỉ tạo work items theo `execution_types`.

---

## 6. Layer 3 API

### Routes mới: `/api/maintenance/catalog/`

```
GET /api/maintenance/catalog/databases?cluster_id=
GET /api/maintenance/catalog/schemas?cluster_id=&database=
GET /api/maintenance/catalog/tables?cluster_id=&database=&schema=
        &min_frag_pct=&has_stale_stats=&has_heap=     ← filter params
GET /api/maintenance/catalog/table?cluster_id=&database=&schema=&table=
GET /api/maintenance/catalog/config?cluster_id=         ← đọc scope config
PUT /api/maintenance/catalog/config                     ← DBA cập nhật scope config
```

---

## 7. Layer 3 UI

### Types mới (`types/index.ts`)

```typescript
export type ExecutionType = "index" | "statistic" | "heap";

export interface CatalogScopeTable { schema_name: string; table_names: string[]; }
export interface CatalogScopeDatabase { database_name: string; schemas: CatalogScopeTable[]; }
export interface CatalogConfig { cluster_id: string; databases: CatalogScopeDatabase[]; }

export interface CatalogIndexEntry {
  index_id: number; index_name: string | null; index_type: string;
  is_unique: boolean; fragmentation_pct: number | null; page_count: number | null;
}
export interface CatalogStatsEntry {
  stats_name: string; last_updated: string | null;
  rows: number; modification_counter: number;
}
export interface CatalogTableEntry {
  table_name: string; schema_name: string; row_count: number;
  indexes: CatalogIndexEntry[]; statistics: CatalogStatsEntry[];
  heap_forwarded_count: number | null; captured_at: string;
}
export interface CatalogTableSummary {
  table_name: string; schema_name: string; row_count: number;
  max_fragmentation_pct: number | null; stale_stats_count: number;
  has_heap_issue: boolean;
}
```

### CatalogView.tsx (tab Catalog trong MaintenancePage)

```
┌──────────────────────────────────────────────────────────────┐
│ Database: [YourDatabase ▼]   Schema: [dbo ▼]                │
│ Lọc: [☐ Frag > 30%] [☐ Stale stats] [☐ Heap issue]         │
│ Last captured: 2026-06-24 06:03  [🔄 Trigger ngay]          │
│                                                              │
│ Table              Rows        Max Frag   Stale   Heap       │
│ ──────────────────────────────────────────────────────────   │
│ ▶ Orders         2,450,000     42.3% ⚠    3 ⚠     -        │
│ ▶ OrderItems     8,123,000     15.1%      0        -        │
│ ▶ TempLog              500      2.1%      0       5% ⚠      │
│                                                              │
│ [Expand row → chi tiết indexes + stats per index/stat]      │
└──────────────────────────────────────────────────────────────┘
```

Nút "Trigger ngay": gọi API trigger catalog job thủ công (hữu ích sau khi DBA sửa config scope).

---

## 8. Seed / Indexes

`maintenance/indexes.py` — thêm:

```python
db["maintenance_catalog"].create_index(
    [("cluster_id", 1), ("database_name", 1), ("schema_name", 1), ("table_name", 1)],
    unique=True,
)
db["maintenance_catalog"].create_index([("cluster_id", 1), ("captured_at", -1)])
db["maintenance_catalog"].create_index(
    "captured_at", expireAfterSeconds=7 * 24 * 3600
)
db["maintenance_catalog_config"].create_index("cluster_id", unique=True)
```

`maintenance_catalog_config` không có seed mặc định — DBA tạo qua UI hoặc trực tiếp MongoDB sau khi setup.

---

## 9. Catalog Status trong MaintenanceSummary API

Thêm `catalog` vào response `GET /api/maintenance/summary?cluster_id=`.

```typescript
// types/index.ts — thêm:
export interface CatalogStatus {
  has_config: boolean;        // false = chưa có maintenance_catalog_config
  last_run_at: string | null; // null = chưa bao giờ chạy thành công
  table_count: number;        // số tables trong catalog hiện tại
  age_hours: number | null;   // giờ kể từ lần chạy gần nhất
  is_stale: boolean;          // true nếu age_hours > 25
}

// Trong MaintenanceSummary — thêm field:
catalog: CatalogStatus;
```

**Express service:** `summary-service.ts` thêm:
- Query `maintenance_catalog_config` → `has_config`
- Aggregate `maintenance_catalog` → `last_run_at` (max `captured_at`), `table_count`

**UI Pipeline Status card:** thêm dòng trạng thái catalog:
- Bình thường: "Catalog: cập nhật 06:03 hôm nay · 247 tables"
- Chưa config: badge đỏ "Catalog chưa cấu hình"
- Stale: badge vàng "Catalog > 1 ngày"

---

## 10. Startup Warning & Prerequisite Check

`maintenance/runner.py` — sau khi khởi tạo per cluster:

```python
config = catalog_config_repo.find_by_cluster(cluster.cluster_id)
if config is None:
    logger.warning(
        "Cluster=%s: no maintenance_catalog_config found. "
        "Catalog job will skip. Campaign discovery requires catalog data. "
        "Configure via Layer 3 UI (tab Catalog > Configure Scope).",
        cluster.cluster_id,
    )
```

Không raise — cluster vẫn chạy tick/discovery job bình thường.

---

## 11. UI Block khi Catalog Rỗng (CampaignForm)

`CampaignForm.tsx` — check trước khi render form chính:

```tsx
const { data: summary } = useMaintSummary(selectedClusterId);
const catalogReady = summary?.catalog?.has_config
                  && !summary?.catalog?.is_stale
                  && (summary?.catalog?.table_count ?? 0) > 0;

if (!catalogReady) {
  return (
    <div className="warning-banner">
      <p>Chưa có dữ liệu catalog cho cluster này.</p>
      <ul>
        {!summary?.catalog?.has_config   && <li>Cấu hình scope: tab Catalog → Configure Scope</li>}
        {summary?.catalog?.is_stale      && <li>Catalog quá cũ — trigger catalog job lại</li>}
        {!summary?.catalog?.table_count  && <li>Catalog rỗng — catalog job chưa chạy thành công</li>}
      </ul>
      <button onClick={() => switchTab("catalog")}>Đến tab Catalog</button>
    </div>
  );
}
```

---

## 12. Catalog Config UI (tab Catalog)

`CatalogView.tsx` — thêm section Configure Scope (collapsible):

```
[⚙ Configure Scope ▼]
┌────────────────────────────────────────────────────┐
│ + Database: [YourDatabase ▼]                       │
│   + Schema: [dbo ▼]  Tables: ○ Tất cả  ● Chọn    │
│             ☑ Orders  ☑ OrderItems  ☐ Customers    │
│   + Schema: [sales ▼]  Tables: ○ Tất cả           │
│                                                    │
│  [Lưu config]    [▶ Trigger catalog job ngay]      │
└────────────────────────────────────────────────────┘
```

Gọi `PUT /api/maintenance/catalog/config` → trigger job.

---

## 13. Note: `maintenance_scan_queries` Obsolete sau Plan 02

Sau khi plan-02 implement xong:
- `discovery_service.py` (đổi tên từ `scan_service.py`) không còn gọi `ScanQueryRepo`
- `maintenance_scan_queries` collection không còn được đọc runtime
- `ScanQueryRepo` + `scan_query_repo.py` trở thành dead code

**Giữ lại** cho đến khi plan-02 verify trên production → cleanup trong PR riêng.

---

## 14. Verification

1. Chưa có `maintenance_catalog_config` → startup log warning, catalog job skip, không crash
2. Tạo config scope → catalog job scan đúng DB/schema/tables
3. Table timeout → log warning, bảng khác vẫn hoàn thành
4. `MaintenanceSummary.catalog` trả về đúng `has_config`, `last_run_at`, `table_count`, `is_stale`
5. CampaignForm: catalog rỗng → hiện warning + link tab Catalog, không render form
6. Catalog Config UI: lưu + trigger → catalog job chạy, Pipeline Status cập nhật
7. `execution_types=["index"]` → discovery chỉ tạo work items REBUILD/REORGANIZE

---

## Rủi ro & Lưu ý

- **Không có scope config → không scan:** DBA phải cấu hình trước. Đây là behavior có chủ ý — tránh scan mù toàn DB.
- **`dm_db_index_physical_stats` SAMPLED:** Scoped per `object_id` nên nhanh hơn nhiều so với quét toàn DB.
- **TTL 7 ngày:** Nếu job không chạy 7 ngày catalog rỗng → CampaignForm block với warning rõ ràng.
- **`captured_at` hiển thị rõ:** DBA biết snapshot đang xem từ sáng nào.
- **Nhiều DB per cluster:** Mỗi DB dùng connection string riêng (`database=` khác nhau).
