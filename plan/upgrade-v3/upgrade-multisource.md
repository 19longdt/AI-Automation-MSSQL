# Plan: Multi-Cluster Datasource Management (Upgrade v3)

## Goal

Hien tai he thong monitor dang hardcode 1 MSSQL cluster qua env vars:

- `MSSQL_NODES`
- `MSSQL_DATABASE`
- `MSSQL_USERNAME`
- `MSSQL_PASSWORD`

Muc tieu cua upgrade nay:

1. Quan ly nhieu MSSQL clusters qua UI.
2. Luu cluster config trong MongoDB collection `db_clusters`.
3. Layer 1 monitor song song tat ca clusters `enabled=true`.
4. Layer 3 co cluster selector de filter dashboard/insights/history.
5. Van backward compatible voi he thong cu trong giai doan migration.

Tai lieu nay thay the ban plan cu bang mot implementation checklist ro hon, co them:

- security rules
- migration rules
- compatibility rules
- missing changes o Layer 2 / Layer 3
- thu tu trien khai phu hop voi codebase hien tai

---

## Scope

### In scope

- CRUD cluster configs
- test connection truoc khi luu
- Layer 1 multi-cluster scheduling
- them `cluster_id` vao du lieu runtime moi
- filter theo `cluster_id` o API/UI
- auto-seed tu env cho lan deploy dau tien

### Out of scope

- ma hoa password trong MongoDB
- RBAC/phan quyen UI
- rotate secret tu external secret manager
- merge/sync cluster metadata tu he thong khac

Neu can harden them ve security sau nay, se tach thanh mot upgrade rieng.

---

## Key Decisions

### 1. `cluster_id` la partition key logic moi

Moi du lieu runtime moi phat sinh tu Layer 1 phai gan `cluster_id`:

- `findings`
- `raw_metrics`
- `ai_analyses` hoac toi thieu `finding_snapshot.cluster_id`
- `issue_insights` neu muon filter insights theo cluster on-disk

### 2. Password khong duoc tra ve browser

Khong duoc dung model kieu `ClusterResponse extends ClusterCreate` vi se lo `password`.

Contract dung:

- `ClusterCreate`: co `password`
- `ClusterUpdate`: `password` optional
- `ClusterResponse`: khong co `password`, chi co `has_password: bool`

### 3. `cluster_id` phai duoc dua vao dedup hash

Khong nen tiep tuc gia dinh `node` da du phan biet cluster.
Hash moi:

- `topic_id + cluster_id + issue_type + node + query_hash`

Dieu nay giup tranh collision neu sau nay:

- 2 clusters dung cung host alias
- co NAT/VIP/hostname overlap
- du lieu bi replay/import

### 4. Startup khong nen crash neu khong co env legacy

Behavior de xuat:

- neu `db_clusters` rong va env legacy day du -> seed 1 cluster
- neu `db_clusters` rong va env legacy cung rong -> start idle, log warning, khong crash

### 5. Layer 1 so huu cluster management

Boundary duoc chot cho phase nay:

- Layer 1 so huu `db_clusters`
- Layer 1 so huu cluster CRUD/test connection API
- Layer 1 dung `db_clusters` de van hanh scheduler runtime
- Layer 2 khong cung cap cluster management API
- Layer 2 chi consume data de phan tich

Neu sau nay can Layer 2 phan tich "theo cluster duoc chon khi goi tool/runtime",
do se la mot phase rieng.

---

## Target Data Model

## MongoDB: `db_clusters`

Document luu trong MongoDB:

```json
{
  "cluster_id": "cluster_prod_1",
  "name": "Production Cluster",
  "environment": "production",
  "nodes": ["10.x.x.1", "10.x.x.2", "10.x.x.3"],
  "port": 1433,
  "database": "YourDatabase",
  "username": "sa_monitor",
  "password": "MyPass123",
  "enabled": true,
  "color": "#ef4444",
  "created_at": "...",
  "updated_at": "..."
}
```

`environment` hop le:

- `production`
- `uat`
- `dev`
- `staging`
- `other`

### Mongo indexes cho `db_clusters`

Can tao:

```python
IndexModel([("cluster_id", ASCENDING)], unique=True, name="unique_cluster_id")
IndexModel([("enabled", ASCENDING)], name="enabled")
IndexModel([("environment", ASCENDING)], name="environment")
```

---

## API Contract

## Shared cluster API models

### `ClusterCreate`

```python
class ClusterCreate(BaseModel):
    cluster_id: str
    name: str
    environment: Literal["production", "uat", "dev", "staging", "other"]
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str
    enabled: bool = True
    color: str = "#6b7280"
```

### `ClusterUpdate`

Tat ca fields optional.
Rule dac biet:

- `password=None` -> giu nguyen password cu
- `password=""` -> khong chap nhan

### `ClusterResponse`

```python
class ClusterResponse(BaseModel):
    cluster_id: str
    name: str
    environment: Literal["production", "uat", "dev", "staging", "other"]
    nodes: list[str]
    port: int
    database: str
    username: str
    enabled: bool
    color: str
    has_password: bool
    created_at: datetime
    updated_at: datetime
```

### `ClusterConnectionTestRequest`

Dung cho pre-create test:

```python
class ClusterConnectionTestRequest(BaseModel):
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str
```

### `ClusterConnectionTestResponse`

```python
class ClusterConnectionTestResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    error: str | None = None
```

---

## Layer 1 Changes

## 1. New file: `layer1/models/cluster.py`

Them model runtime:

```python
class ClusterConfig(BaseModel):
    cluster_id: str
    name: str
    environment: str
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str
    enabled: bool = True
    color: str = "#6b7280"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    def get_connection_string(self, host: str) -> str:
        return (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={host},{self.port};"
            f"DATABASE={self.database};"
            f"UID={self.username};"
            f"PWD={self.password};"
            f"TrustServerCertificate=yes;"
        )
```

## 2. Modify: `layer1/config.py`

Can doi env settings tu "bat buoc" sang "optional for migration":

- `mssql_nodes` -> default empty
- `mssql_database` -> default empty string
- `mssql_username` -> default empty string
- `mssql_password` -> default empty string
- bo `validate_nodes_not_empty`

Giu `get_connection_string()` de seed legacy cluster.

Them helper:

```python
def has_legacy_cluster_config(self) -> bool: ...
```

Dung de quyet dinh co seed duoc khong.

## 3. New file: `layer1/storage/repositories/cluster_repo.py`

```python
class ClusterRepo:
    def find_all(self) -> list[ClusterConfig]: ...
    def find_all_enabled(self) -> list[ClusterConfig]: ...
    def find_by_id(self, cluster_id: str) -> ClusterConfig | None: ...
    def upsert(self, cluster: ClusterConfig) -> None: ...
    def delete(self, cluster_id: str) -> bool: ...
    def count(self) -> int: ...
    def seed_from_env(self, settings: EnvSettings) -> ClusterConfig | None: ...
```

Rules:

- neu `db_clusters` da co data -> khong seed
- neu env legacy khong day du -> khong seed, return `None`
- `seed_from_env()` phai idempotent

## 4. Modify: `layer1/executor/mssql_connection.py`

Them `conn_str` explicit:

```python
@contextmanager
def mssql_connection(
    host: str,
    conn_str: str | None = None,
    timeout_sec: int | None = None,
):
    resolved = conn_str or settings.get_connection_string(host)
```

Muc tieu:

- Layer 1 co the ket noi theo tung cluster
- backward compatible voi code cu

## 5. Modify: `layer1/executor/node_role_cache.py`

Refactor de inject cluster:

- `NodeRoleCache.__init__(cluster: ClusterConfig)`
- `_detect_roles()` dung `cluster.nodes`
- moi `mssql_connection()` dung `cluster.get_connection_string(ip)`
- persist MongoDB nen them `cluster_id` vao document `node_roles`

Can sua `_persist_to_mongo()` thanh key:

- `cluster_id + host`

Neu khong, node roles giua nhieu cluster co the de len nhau.

## 6. Modify: `layer1/executor/query_executor.py`

Them `conn_str` vao:

- `execute(...)`
- `execute_batch(...)`

Vi `TopicRunner` moi cluster se truyen connection string rieng.

## 7. Modify: `layer1/executor/topic_runner.py`

Them `cluster: ClusterConfig` vao constructor.

Can thay doi:

- `_execute_on_nodes()` truyen `conn_str=cluster.get_connection_string(host)`
- `RawMetric` tao ra phai co `cluster_id`
- moi `Finding` tao ra hoac process vao repo phai co `cluster_id`

Neu detector hien tai tao `Finding` ma khong biet cluster:

- co the patch trong `_process_findings()` de inject `finding.cluster_id = self._cluster.cluster_id`

## 8. Modify: `layer1/models/findings.py`

Them:

```python
cluster_id: str = Field(default="", description="ID cum MSSQL sinh ra finding nay")
```

Cap nhat hash:

```python
key = f"{self.topic_id}:{self.cluster_id}:{self.issue_type}:{self.node}:{self.query_hash or ''}"
```

## 9. Modify: `layer1/models/metrics.py`

Them `cluster_id` cho:

- `QueryResult` neu can carry qua detector/debug
- `RawMetric` bat buoc co

Toi thieu:

```python
class RawMetric(BaseModel):
    cluster_id: str = ""
```

## 10. Modify: `layer1/storage/indexes.py`

Bo sung indexes:

- `findings(cluster_id, topic_id, detected_at desc)`
- `raw_metrics(cluster_id, topic_id, collected_at desc)`
- `node_roles(cluster_id, host)` unique
- `db_clusters` indexes

Can giu backward compat:

- du lieu cu khong co `cluster_id` van doc duoc
- query "all clusters" khong them filter `cluster_id`

## 11. Refactor `layer1/scheduler.py`

Day la phan kho nhat.

Hien trang:

- service chi co 1 `NodeRoleCache`
- service chi co 1 `TopicRunner`
- jobs chi key theo `topic_id`

Can doi thanh:

```python
self._clusters: dict[str, ClusterConfig]
self._role_caches: dict[str, NodeRoleCache]
self._topic_runners: dict[str, TopicRunner]
self._registered_topic_job_ids: set[str]
```

### `_setup_infrastructure()`

Thu tu moi:

1. MongoDB connect + indexes
2. load capture tools
3. `ClusterRepo.seed_from_env()` neu can
4. load all enabled clusters
5. khoi tao repositories chung
6. khoi tao notification chung
7. voi moi cluster:
   - tao `NodeRoleCache(cluster)` va `initialize()`
   - tao `TopicRunner(cluster, ...)`

Neu khong co cluster enabled:

- service start binh thuong
- log warning
- khong register topic jobs

### `_register_jobs()`

Pseudo:

```python
for cluster in enabled_clusters:
    for topic in topics:
        job_id = f"topic_{cluster.cluster_id}_{topic.topic_id}"
```

Topic execution phai wrap theo:

```python
@self._job_runner.wrap(job_name)
def job() -> int:
    return self._topic_runners[cluster_id].run(topic_id)
```

Luu y:

- `JobRunner.wrap()` hien dang nhan `topic_id`; co the can doi sang `job_name`
- `HealthChecker` cung can hieu `job_id` moi thay vi chi `topic_id`

### System jobs

Can co:

- `cluster_refresh`: moi 5 phut
- `node_role_refresh_{cluster_id}` hoac 1 loop refresh tat ca clusters
- `health_check`

### `cluster_refresh` logic

Moi 5 phut:

1. load enabled clusters moi tu MongoDB
2. diff voi `self._clusters`
3. add cluster moi
4. remove disabled/deleted cluster
5. neu config cluster thay doi:
   - recreate role cache
   - recreate topic runner
   - remove job cu
   - register lai jobs cluster do

Can code can than de job removal/addition idempotent.

---

## Layer 1 Management API Changes

Layer 1 da co HTTP API rieng trong `layer1/api/*`, nen cluster management nen dat tai day.

## 1. New file: `layer1/api/routes/clusters.py`

Them endpoints:

- `GET /clusters`
- `POST /clusters`
- `GET /clusters/{id}`
- `PUT /clusters/{id}`
- `DELETE /clusters/{id}`
- `POST /clusters/{id}/test`
- `POST /clusters/test`

Pattern nay khop voi Layer 1 API hien tai:

- `GET /health`
- `POST /kill-session`

Khong can prefix `/api/v1` o Layer 1 neu muon giu convention don gian hien tai.

## 2. Modify: `layer1/api/app.py`

Register `clusters` routes cung voi:

- `register_health_routes`
- `register_session_routes`

## 3. Shared models placement

Co 2 cach hop ly:

- dat API request/response models trong `layer1/models/cluster.py`
- hoac tach rieng `layer1/models/cluster_api.py`

Khuyen nghi:

- neu muon don gian, dat cung `layer1/models/cluster.py`

## 4. Reuse `layer1/storage/repositories/cluster_repo.py`

Khong can duplicate repository o Layer 2.
CRUD va seed deu dung chung cung source of truth tai Layer 1.

## 5. Validation rules cho Layer 1 API

- `GET` khong tra password
- `POST/PUT` validate:
  - `cluster_id` unique
  - `nodes` non-empty
  - `color` dung format hex
- `PUT` khong co password -> giu nguyen password cu
- `DELETE` phase 1 co the:
  - cho xoa cluster disabled
  - hoac cho xoa thang neu scheduler refresh da on dinh

## 6. Test connection tai Layer 1

Dung pyodbc ket noi `nodes[0]`.
Tra:

```json
{ "ok": true, "latency_ms": 123.4 }
```

hoac:

```json
{ "ok": false, "error": "Login failed for user ..." }
```

## Layer 2 Changes

Layer 2 giu dung boundary la tang `analysis/agent`.

Khong them cluster CRUD API vao Layer 2.

## 1. Layer 2 runtime scope

Phase nay Layer 2 khong can tro thanh multi-cluster runtime manager.
Layer 2 tiep tuc dung architecture hien tai cho agent/tool execution.

Neu sau nay can "analyze against a selected cluster" theo runtime tool calls, se tach thanh phase rieng.

## 2. Filter support cho analyses/insights

Neu UI co cluster selector cho insights/history thi can them filter theo `cluster_id`.

Can sua:

- `layer2/storage/repositories/analysis_repo.py`
- `layer2/storage/repositories/insight_repo.py`
- `layer2/api/routes/analysis.py`
- `layer2/api/routes/insights.py`

It nhat phai support:

- `finding_snapshot.cluster_id`
- `issue_insights.cluster_id` neu document insight luu field nay

Neu chua them `cluster_id` vao `issue_insights`, Layer 3 fallback query Mongo se khong loc chinh xac.

---

## Layer 3 API Changes

## 1. New route: `layer3/apps/api/src/routes/clusters.ts`

Proxy tat ca cluster endpoints sang Layer 1:

- `GET /api/clusters`
- `POST /api/clusters`
- `GET /api/clusters/:id`
- `PUT /api/clusters/:id`
- `DELETE /api/clusters/:id`
- `POST /api/clusters/:id/test`
- `POST /api/clusters/test`

Can dung:

- `fetchJsonWithTimeout`
- `postJsonWithTimeout`
- them helper `putJsonWithTimeout`, `deleteJsonWithTimeout` neu chua co

## 2. Modify: `collections.ts`

Them:

```typescript
clusters: "db_clusters"
```

## 3. Modify findings filter path

Can sua:

- `services/findings-service.ts`
- `routes/findings.ts`
- `schemas/findings.schema.ts`
- frontend `types`

Them:

```typescript
cluster_id?: string
```

Logic:

- neu co `cluster_id` -> filter exact
- neu khong co -> all clusters, bao gom ca docs cu thieu field

## 4. Modify analyses filter path

Can sua:

- `services/analyses-service.ts`
- `routes/analyses.ts`
- `schemas/analyses.schema.ts`

Them support:

- `cluster_id`
- co the filter qua `finding_snapshot.cluster_id`

## 5. Modify insights filter path

Can sua:

- `services/insights-service.ts`
- `routes/insights.ts`
- `schemas/insights.schema.ts`

Them support:

- `cluster_id`

Neu Layer 2 API support query param `cluster_id`, Layer 3 proxy pass-through cho insights/analyses.
Cluster management thi khong di qua Layer 2.
Neu fallback MongoDB, filter local cung pattern.

## 6. Modify `server.ts`

Them:

- `registerClusterRoutes(app)`
- route `/settings`

Can phuc vu SPA cho:

- `/settings`

---

## Layer 3 Frontend Changes

## 1. Update shared types

Can sua `layer3/apps/web-v2/src/types/index.ts`:

- them `cluster_id?: string` vao `FindingsQuery`
- them `cluster_id?: string` vao `TimelineQuery`
- them `cluster_id?: string` vao `InsightsQuery`
- them `cluster_id?: string` vao `AnalysesQuery`

Them:

```typescript
interface ClusterResponse {
  cluster_id: string;
  name: string;
  environment: "production" | "uat" | "dev" | "staging" | "other";
  nodes: string[];
  port: number;
  database: string;
  username: string;
  enabled: boolean;
  color: string;
  has_password: boolean;
  created_at: string;
  updated_at: string;
}
```

Khong co `password` tren browser model.

## 2. Update Zustand store

Sua `dashboard.store.ts`:

```typescript
selectedClusterId: string | null;
setSelectedClusterId: (id: string | null) => void;
```

Persist vao localStorage qua `partialize`.

Rule:

- `null` = all clusters
- doi cluster -> reset page ve 0

## 3. New hook: `useClusters.ts`

```typescript
useQuery({
  queryKey: ["clusters"],
  queryFn: () => apiGet<ClusterResponse[]>("/api/clusters"),
  staleTime: 30_000,
})
```

## 4. New component: `ClusterSelector.tsx`

Yeu cau:

- option dau: `All Clusters`
- group theo environment
- chi hien thi clusters `enabled=true`
- co color dot

Khuyen nghi:

- neu current selected cluster da bi disable/delete -> auto fallback ve `All Clusters`

## 5. Modify `Topbar.tsx`

Them:

- nav link `Settings`
- `ClusterSelector` truoc `LiveIndicator`

## 6. Modify `App.tsx`

Them page route:

- `settings`

Cap nhat `resolveRoute()` cho `/settings`.

## 7. Modify data hooks

Sua:

- `useFindings.ts`
- `useTimeline.ts`
- `useInsights.ts`

De doc `selectedClusterId` tu store va truyen vao params.

## 8. Modify query builders

Sua:

- `dashboard-query.ts`
- co the ca `query-keys.ts` neu can

Dam bao `cluster_id` di cung request params.

## 9. New page: `SettingsPage.tsx`

Chuc nang:

- list clusters
- add cluster
- edit cluster
- enable/disable cluster
- delete cluster
- test connection

UI can co:

- table
- add/edit modal
- delete confirm dialog
- loading/error states ro rang

### Form rules

- edit mode khong preload password thuc
- password field de trong = giu nguyen
- neu create mode thi password bat buoc

---

## Migration Rules

## 1. Legacy env seeding

Khi Layer 1 startup:

1. connect MongoDB
2. check `db_clusters`
3. neu rong va env legacy day du -> seed 1 cluster mac dinh
4. neu rong va env legacy rong -> log warning, start idle

Suggested seeded values:

- `cluster_id = "legacy_default"`
- `name = "Legacy Default Cluster"`
- `environment = "production"` hoac `other`
- `color = "#6b7280"`

## 2. Existing findings/raw_metrics

Du lieu cu khong co `cluster_id`:

- van doc duoc
- van hien thi khi user chon `All Clusters`
- se khong hien thi khi user filter 1 cluster cu the

Dieu nay chap nhan duoc.

## 3. Existing analyses/insights

Can quyet dinh ro:

- phase nay co backfill `cluster_id` cho `ai_analyses`/`issue_insights` hay khong

Khuyen nghi:

- khong backfill phuc tap
- du lieu cu khong cluster-aware
- du lieu moi sau deploy se co `cluster_id`

Ghi ro trong docs va verification.

---

## Verification Checklist

## Layer 1

1. Khoi dong voi `db_clusters` rong va env legacy day du -> log `Seeded 1 cluster from env vars`.
2. Khoi dong lan 2 -> khong seed lai.
3. Khoi dong voi `db_clusters` rong va env legacy rong -> service start idle, khong crash.
4. Them cluster moi qua UI -> trong 5 phut Layer 1 pick up va register jobs moi.
5. Disable cluster -> jobs cluster do bi remove.
6. Sua nodes/password/port cua cluster -> jobs va role cache cua cluster do duoc recreate.
7. Finding moi duoc insert co `cluster_id`.
8. Raw metric moi duoc insert co `cluster_id`.

## Layer 1 Management API

1. `GET /clusters` -> tra list khong co `password`.
2. `POST /clusters` -> tao cluster thanh cong.
3. `PUT /clusters/{id}` voi body khong co password -> giu nguyen password cu.
4. `POST /clusters/test` voi credentials hop le -> `{ "ok": true, "latency_ms": ... }`.
5. Credentials sai -> `{ "ok": false, "error": "..." }`.

## Layer 3 API

1. `GET /api/clusters` -> proxy dung.
2. `GET /api/findings?cluster_id=cluster_prod_1` -> chi tra findings cua cluster do.
3. `GET /api/findings` khong filter -> tra all findings, bao gom docs cu khong co `cluster_id`.
4. `GET /api/insights?cluster_id=cluster_prod_1` -> filter dung voi data moi.
5. `GET /api/analyses?cluster_id=cluster_prod_1` -> filter dung voi data moi.

## Layer 3 UI

1. Cluster dropdown xuat hien tren topbar.
2. Chon cluster -> findings/timeline/insights refetch theo `cluster_id`.
3. Vao `/settings` -> table hien thi.
4. Add cluster -> test -> save -> xuat hien trong table va dropdown.
5. Edit cluster khong doi password -> update thanh cong.
6. Disable cluster -> van hien thi trong settings, khong hien thi trong selector neu quyet dinh selector chi list enabled clusters.

---

## Recommended Implementation Order

## Phase 0: chot contract va migration rules

1. Chot API contract khong lo password.
2. Chot behavior startup khi khong co cluster.
3. Chot rule Layer 2 phase nay chi consume data, khong so huu cluster management.

## Phase 1: Layer 1 runtime

1. `models/cluster.py`
2. `cluster_repo.py`
3. `config.py` migration helpers
4. `mssql_connection.py`
5. `node_role_cache.py`
6. `query_executor.py`
7. `findings.py` / `metrics.py`
8. `topic_runner.py`
9. `indexes.py`
10. `scheduler.py`
11. test startup/seed/job refresh

Khuyen nghi xong Phase 1 moi sang layer khac, vi day la phan core.

## Phase 2: Layer 1 management API

1. `models/cluster.py` hoac `models/cluster_api.py`
2. `storage/repositories/cluster_repo.py`
3. `storage/indexes.py`
4. `api/routes/clusters.py`
5. `api/app.py`
6. `main.py`
7. test CRUD/test connection

## Phase 3: Layer 3 API filters and cluster proxy

1. `collections.ts`
2. `schemas/*`
3. `services/findings-service.ts`
4. `services/analyses-service.ts`
5. `services/insights-service.ts`
6. `routes/findings.ts`
7. `routes/analyses.ts`
8. `routes/insights.ts`
9. `routes/clusters.ts`
10. `server.ts`

## Phase 4: Layer 3 UI

1. `types/index.ts`
2. `dashboard.store.ts`
3. `useClusters.ts`
4. `ClusterSelector.tsx`
5. `Topbar.tsx`
6. `App.tsx`
7. `SettingsPage.tsx`
8. `useFindings.ts`
9. `useTimeline.ts`
10. `useInsights.ts`
11. `dashboard-query.ts`

---

## Risks

## 1. Scheduler complexity

Multi-cluster support khong phai chi la loop them 1 dimension.
Phan kho nhat la lifecycle:

- add cluster
- remove cluster
- cluster config changed
- role cache stale
- job ids va health tracking

Can implement diff logic ro rang, idempotent.

## 2. Secret exposure

Neu response model tra password ra UI, se thanh security issue ngay.
Day la blocking concern.

## 3. Partial multi-cluster o Layer 2

Neu UI cho filter insights theo cluster ma Layer 2/insight documents chua mang `cluster_id`, user co the nghi ket qua da chinh xac trong khi thuc te chua hoan toan.

Can ghi ro phase behavior.

## 4. Backward compatibility perception

Khi user chon 1 cluster, du lieu cu khong co `cluster_id` se "bien mat".
Do do can note ro tren docs/release note.

---

## Final Recommendation

Ban plan nay nen duoc implement theo huong:

1. Layer 1 multi-cluster runtime truoc
2. Layer 1 cluster CRUD/test API sau
3. Layer 3 API filters
4. Layer 3 UI settings + selector

Neu can giam risk, chia rollout thanh 2 release:

- Release 1: Layer 1 runtime + Layer 1 cluster management API + Layer 3 Settings page
- Release 2: cluster selector + cross-page filtering + Layer 2 cluster-aware insights/analyses

Huong nay giam kha nang vua thay doi scheduler core vua thay doi toan bo UX/filtering trong cung mot release.
