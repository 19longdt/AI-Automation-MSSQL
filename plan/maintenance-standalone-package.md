# Plan: Tách `maintenance` thành standalone package

**Trạng thái:** Chờ implement  
**Ưu tiên:** Sau khi layer1/maintenance hiện tại ổn định  
**Mục tiêu:** `maintenance/` package độc lập — image riêng, deploy riêng, không import từ `layer1`

---

## Bối cảnh

Hiện tại `layer1/maintenance/` chạy như process riêng (container `layer1-maintenance`) nhưng dùng chung image với `layer1` và import nhiều module từ `layer1` qua `from ...xxx`. Mục tiêu là tách thành package độc lập với:
- Image Docker riêng (`19longdt/ai-automation-mssql-maintenance:vX`)
- Không phụ thuộc code `layer1` tại runtime
- Build/deploy độc lập

---

## Cấu trúc đích

```
project/
├── layer1/                        ← giữ nguyên, không đổi gì
├── maintenance/                   ← NEW — tách từ layer1/maintenance/
│   ├── __init__.py
│   ├── runner.py
│   ├── config.py                  ← MaintEnvSettings standalone (thêm MSSQL_*, MongoDB, Logstash)
│   ├── mongo.py                   ← get_maint_db() dùng local infra
│   ├── indexes.py                 ← inline _ensure_ttl_index, không import layer1
│   ├── infra/                     ← infrastructure tự chứa (copy/adapt từ layer1)
│   │   ├── __init__.py
│   │   ├── time_utils.py
│   │   ├── mongo_client.py
│   │   ├── mssql_connection.py
│   │   ├── query_config.py        ← QueryConfig model (tách từ layer1/models/topic.py)
│   │   ├── query_executor.py
│   │   ├── node_role_cache.py
│   │   ├── job_execution_repo.py  ← dùng get_maint_db() → db_maintenance
│   │   ├── job_runner.py
│   │   └── health_checker.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── job.py                 ← copy từ layer1/models/job.py
│   │   ├── policy.py
│   │   ├── work_item.py
│   │   ├── window.py
│   │   ├── history.py
│   │   ├── batch.py
│   │   └── scan_query.py
│   ├── scan/
│   ├── policy/
│   ├── window/
│   ├── safety/
│   ├── execute/
│   ├── notify/
│   ├── repositories/
│   └── seed/
├── Dockerfile.maintenance         ← NEW
├── requirements.maintenance.txt  ← NEW (subset của layer1)
├── build.ps1                      ← thêm maintenance layer
└── docker-compose.yml             ← update maintenance service
```

---

## Bước 1 — Tạo `maintenance/infra/`

Đây là phần cốt lõi. Mỗi file là copy/adapt từ `layer1/`, thay đổi chỗ import.

### 1.1 `maintenance/infra/time_utils.py`
**Nguồn:** `layer1/utils/time_utils.py`  
**Thay đổi:** Không — pure copy.

```python
# copy nguyên từ layer1/utils/time_utils.py
```

---

### 1.2 `maintenance/infra/mongo_client.py`
**Nguồn:** `layer1/storage/mongo_client.py`  
**Thay đổi:**
- `initialize(cfg)` → `_db = client[cfg.maint_mongodb_db]` (trỏ thẳng vào maintenance DB)
- Không cần `get_client()` riêng nữa nếu `get_db()` đã trả về maintenance DB

```python
class MongoConnection:
    @classmethod
    def initialize(cls, cfg) -> None:
        client = MongoClient(cfg.mongodb_uri, ...)
        client.admin.command("ping")
        cls._client = client
        cls._db = client[cfg.maint_mongodb_db]   # ← thay vì cfg.mongodb_db
```

---

### 1.3 `maintenance/infra/mssql_connection.py`
**Nguồn:** `layer1/executor/mssql_connection.py`  
**Thay đổi:** Import từ local config thay vì layer1.

```python
# Thay:
from ..config import settings
# Thành:
from ..config import maint_settings as settings
```

---

### 1.4 `maintenance/infra/query_config.py`
**Nguồn:** `layer1/models/topic.py` (chỉ lấy `QueryConfig`)  
**Thay đổi:** Tách ra model riêng, minimal.

```python
from pydantic import BaseModel, Field

class QueryConfig(BaseModel):
    query_id: str
    description: str = ""
    sql: str
    timeout_sec: int = Field(default=30, ge=1)
```

---

### 1.5 `maintenance/infra/query_executor.py`
**Nguồn:** `layer1/executor/query_executor.py`  
**Thay đổi:** Đổi import `QueryResult` và `QueryConfig`.

```python
# Thay:
from ..models.topic import QueryConfig
from ..models.metrics import QueryResult
# Thành (định nghĩa QueryResult inline hoặc import từ infra):
from .query_config import QueryConfig
# QueryResult define inline hoặc tạo models/metrics.py trong maintenance
```

> **Note:** `QueryResult` cũng cần tách. Có thể inline trong `query_executor.py` hoặc tạo `infra/metrics.py`.

---

### 1.6 `maintenance/infra/node_role_cache.py`
**Nguồn:** `layer1/executor/node_role_cache.py`  
**Thay đổi:**
- Import `maint_settings` thay `settings`
- Import local `mssql_connection` và `now_vn`
- `_persist_to_mongo` dùng `MongoConnection.get_db()` local (→ db_maintenance)

```python
# Thay:
from ..config import settings
from ..utils.time_utils import now_vn
from .mssql_connection import mssql_connection
# Thành:
from ..config import maint_settings as settings
from .time_utils import now_vn
from .mssql_connection import mssql_connection
```

---

### 1.7 `maintenance/infra/job_execution_repo.py`
**Nguồn:** `layer1/storage/repositories/job_execution_repo.py`  
**Thay đổi:**
- `MongoConnection.get_db()` → `get_maint_db()` từ `maintenance.mongo`
- Job executions vào `db_maintenance.job_executions` thay vì `db_monitor`

```python
# Thay:
from ..mongo_client import MongoConnection
# Thành:
from maintenance.mongo import get_maint_db
# ...
def collection(self): return get_maint_db()["job_executions"]
```

---

### 1.8 `maintenance/infra/job_runner.py`
**Nguồn:** `layer1/job_manager/job_runner.py`  
**Thay đổi:** Import models và repo từ local.

```python
# Thay:
from ..models.job import JobExecution, JobStatus
from ..storage.repositories.job_execution_repo import JobExecutionRepo
# Thành:
from ..models.job import JobExecution, JobStatus
from .job_execution_repo import JobExecutionRepo
```

---

### 1.9 `maintenance/infra/health_checker.py`
**Nguồn:** `layer1/job_manager/health_checker.py`  
**Thay đổi:** Import local `MongoConnection` và `JobExecutionRepo`.

```python
# Thay:
from ..storage.repositories.job_execution_repo import JobExecutionRepo
from ..storage.mongo_client import MongoConnection
# Thành:
from .job_execution_repo import JobExecutionRepo
from .mongo_client import MongoConnection
```

---

## Bước 2 — Cập nhật `maintenance/config.py`

`MaintEnvSettings` hiện dùng `extra="ignore"` để đọc `MSSQL_*` từ `.env` nhờ layer1's settings. Khi tách độc lập, phải tự khai báo các field này.

**Thêm vào `MaintEnvSettings`:**
```python
# MSSQL
mssql_nodes: list[str] = Field(...)          # parse giống layer1/config.py
mssql_database: str = Field(...)
mssql_username: str = Field(...)
mssql_password: str = Field(...)
mssql_port: int = Field(default=1433)
mssql_query_timeout_sec: int = Field(default=30)

# MongoDB
mongodb_uri: str = Field(default="mongodb://localhost:27017")

# Logging
log_level: str = Field(default="INFO", validation_alias=AliasChoices("MAINT_LOG_LEVEL", "LOG_LEVEL"))
logstash_host: str = Field(default="")
logstash_port: int = Field(default=5044)
logstash_app_name: str = Field(default="sds.ep.ai-automation-maintenance")
logstash_transport: str = Field(default="tcp")
logstash_database_path: str = Field(default="")

# Method
def get_connection_string(self, host: str) -> str:
    return (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={host},{self.mssql_port};"
        f"DATABASE={self.mssql_database};"
        f"UID={self.mssql_username};"
        f"PWD={self.mssql_password};"
        f"TrustServerCertificate=yes;"
    )
```

**Bỏ `extra="ignore"`** — thay bằng khai báo tường minh.

---

## Bước 3 — Cập nhật `maintenance/mongo.py`

```python
# Thay:
from ..storage.mongo_client import MongoConnection
# Thành:
from .infra.mongo_client import MongoConnection
```

`get_maint_db()` giờ đơn giản hơn vì `MongoConnection.get_db()` đã trả về `db_maintenance`:
```python
def get_maint_db():
    return MongoConnection.get_db()
```

---

## Bước 4 — Cập nhật `maintenance/indexes.py`

**Bỏ imports từ layer1:**
```python
# Xóa:
from ..storage.indexes import (
    TTL_MAINT_BATCHES_SEC,
    TTL_MAINT_HISTORY_SEC,
    TTL_MAINT_QUEUE_TERMINAL_SEC,
    _ensure_ttl_index,
)
```

**Inline TTL constants và `_ensure_ttl_index`:**
```python
TTL_MAINT_QUEUE_TERMINAL_SEC = 14 * 24 * 3600
TTL_MAINT_BATCHES_SEC = 14 * 24 * 3600
TTL_MAINT_HISTORY_SEC = 90 * 24 * 3600

def _ensure_ttl_index(col, keys, name: str, ttl_seconds: int) -> None:
    # copy nguyên từ layer1/storage/indexes.py
    ...
```

---

## Bước 5 — Cập nhật models

**Tạo mới `maintenance/models/job.py`** — copy từ `layer1/models/job.py`:
```python
# Thay:
from ..utils.time_utils import now_vn
# Thành:
from ..infra.time_utils import now_vn
```

**Cập nhật 5 model files** (policy, work_item, window, history, approval):
```python
# Thay (trong mỗi file):
from ...utils.time_utils import now_vn
# Thành:
from ..infra.time_utils import now_vn
```

---

## Bước 6 — Cập nhật scan/, execute/, safety/

### `scan/scan_service.py`
```python
# Thay:
from ...executor.node_role_cache import NodeRoleCache
from ...executor.query_executor import QueryExecutor
from ...models.topic import QueryConfig
from ...utils.time_utils import now_vn
# Thành:
from ..infra.node_role_cache import NodeRoleCache
from ..infra.query_executor import QueryExecutor
from ..infra.query_config import QueryConfig
from ..infra.time_utils import now_vn
```

### `execute/execute_service.py`
```python
# Thay:
from ...executor.mssql_connection import mssql_connection
from ...executor.node_role_cache import NodeRoleCache
from ...utils.time_utils import now_vn
# Thành:
from ..infra.mssql_connection import mssql_connection
from ..infra.node_role_cache import NodeRoleCache
from ..infra.time_utils import now_vn
```

### `safety/gate_service.py`
```python
# Thay:
from ...executor.mssql_connection import mssql_connection
# Thành:
from ..infra.mssql_connection import mssql_connection
```

---

## Bước 7 — Cập nhật notify/ và repositories/

### `notify/maintenance_notifier.py`
```python
# Thay:
from ...utils.time_utils import now_vn
# Thành:
from ..infra.time_utils import now_vn
```

### `repositories/window_repo.py`
```python
# Thay:
from ...utils.time_utils import now_vn
# Thành:
from ..infra.time_utils import now_vn
```

> **Note:** `queue_repo.py` và `batch_repo.py` đã được cập nhật sang `get_maint_db()` trong sprint trước — chỉ cần đổi `from ...utils.time_utils` → `from ..infra.time_utils`.

---

## Bước 8 — Cập nhật `maintenance/seed/seed_maintenance.py`

```python
# Thay:
from ...config import settings
from ...storage.mongo_client import MongoConnection
# Thành:
from ..config import maint_settings as settings
from ..infra.mongo_client import MongoConnection
```

---

## Bước 9 — Cập nhật `maintenance/runner.py`

Đây là file thay đổi lớn nhất.

**Bỏ hoàn toàn:**
```python
# XÓA — tạo monitoring indexes không phải việc của maintenance
from ..storage.indexes import create_all_indexes
create_all_indexes(MongoConnection.get_db())

# XÓA — dùng config của layer1
from ..config import settings

# XÓA — dùng infra của layer1
from ..storage.mongo_client import MongoConnection
from ..executor.node_role_cache import NodeRoleCache
from ..executor.query_executor import QueryExecutor
from ..job_manager.health_checker import HealthChecker
from ..job_manager.job_runner import JobRunner
from ..storage.repositories.job_execution_repo import JobExecutionRepo
from ..utils.time_utils import now_vn
```

**Thay bằng:**
```python
from .config import maint_settings        # standalone config
from .infra.mongo_client import MongoConnection
from .infra.node_role_cache import NodeRoleCache
from .infra.query_executor import QueryExecutor
from .infra.health_checker import HealthChecker
from .infra.job_runner import JobRunner
from .infra.job_execution_repo import JobExecutionRepo
from .infra.time_utils import now_vn
```

**Cập nhật `_setup_infrastructure()`:**
```python
# Thay:
MongoConnection.initialize(settings)          # settings của layer1
create_all_indexes(MongoConnection.get_db())  # ← XÓA DÒNG NÀY
# Thành:
MongoConnection.initialize(maint_settings)
create_maint_indexes(MongoConnection.get_db())   # chỉ maintenance indexes
```

**Cập nhật logstash setup** — dùng `maint_settings` thay `settings`.

---

## Bước 10 — Tạo `Dockerfile.maintenance`

```dockerfile
FROM python:3.11-slim-bullseye

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl gnupg2 apt-transport-https unixodbc-dev \
    && curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
    && curl https://packages.microsoft.com/config/debian/11/prod.list \
        > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql17 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.maintenance.txt .
RUN pip install --no-cache-dir -r requirements.maintenance.txt

COPY maintenance/ ./maintenance/

RUN useradd -m -u 1000 monitor \
    && mkdir -p /var/lib/maintenance/logstash \
    && chown -R monitor:monitor /app /var/lib/maintenance
USER monitor

CMD ["python", "-m", "maintenance.runner"]
```

---

## Bước 11 — Tạo `requirements.maintenance.txt`

Subset của `requirements.txt` layer1 — chỉ những gì maintenance thực sự dùng:

```
pymongo>=4.0
pydantic>=2.0
pydantic-settings>=2.0
apscheduler>=3.10
pyodbc>=4.0
tenacity>=8.0
python-dotenv>=1.0
# Optional — chỉ cần nếu LOGSTASH_HOST được set
python-logstash-async>=2.5
```

**Không cần:** `lxml`, `anthropic`, `pymsteams`, `requests`, `fastapi`, `uvicorn`

---

## Bước 12 — Cập nhật `build.ps1`

Thêm `maintenance` vào `$LAYER_CONFIG`:

```powershell
$LAYER_CONFIG = @{
    layer1 = @{
        VersionFile = ".version.layer1"
        Dockerfile  = "Dockerfile"
        Context     = "."
    }
    layer2 = @{
        VersionFile = ".version.layer2"
        Dockerfile  = "Dockerfile.layer2"
        Context     = "."
    }
    layer3 = @{
        VersionFile = ".version.layer3"
        Dockerfile  = "layer3/Dockerfile"
        Context     = "layer3"
    }
    maintenance = @{           # ← THÊM
        VersionFile = ".version.maintenance"
        Dockerfile  = "Dockerfile.maintenance"
        Context     = "."
    }
}
```

Cập nhật `[ValidateSet]`:
```powershell
[ValidateSet("", "layer1", "layer2", "layer3", "maintenance")]
```

---

## Bước 13 — Cập nhật `docker-compose.yml`

```yaml
maintenance:
  image: ${MAINTENANCE_IMAGE:-19longdt/ai-automation-mssql-maintenance:latest}
  container_name: layer1-maintenance
  restart: unless-stopped
  command: ["python", "-m", "maintenance.runner"]   # ← đổi từ layer1.maintenance.runner

  env_file: .env
  environment:
    MONGODB_URI: mongodb://mongodb:27017

  stop_grace_period: 30s
  depends_on:
    mongodb:
      condition: service_healthy
```

**Bỏ `build:` section** — maintenance image build riêng, không build inline trong compose.

---

## Bước 14 — Sau khi verify

Sau khi image maintenance chạy ổn định:

```bash
# Xóa layer1/maintenance/ (không còn dùng)
# layer1 không còn import gì từ maintenance
```

Kiểm tra không còn import nào từ `layer1` vào `maintenance`:
```bash
grep -r "from layer1\|from \.\.\." maintenance/
# → Không có kết quả = OK
```

---

## Thứ tự thực hiện khuyến nghị

```
Bước 1  → Tạo maintenance/infra/ (9 files)
Bước 2  → Cập nhật maintenance/config.py
Bước 3  → Cập nhật maintenance/mongo.py
Bước 4  → Cập nhật maintenance/indexes.py
Bước 5  → Cập nhật maintenance/models/ (6 files)
Bước 6  → Cập nhật scan/, execute/, safety/ (3 files)
Bước 7  → Cập nhật notify/, repositories/ (4 files)
Bước 8  → Cập nhật seed/seed_maintenance.py
Bước 9  → Cập nhật maintenance/runner.py
Bước 10 → Tạo Dockerfile.maintenance
Bước 11 → Tạo requirements.maintenance.txt
Bước 12 → Cập nhật build.ps1
Bước 13 → Cập nhật docker-compose.yml
Bước 14 → Verify syntax toàn bộ package
Bước 15 → Build & test image locally
Bước 16 → Xóa layer1/maintenance/ (sau khi confirm)
```

---

## Rủi ro và lưu ý

| Rủi ro | Mitigation |
|---|---|
| `QueryResult` model dùng chung giữa `query_executor` và `scan_service` | Tạo `maintenance/infra/metrics.py` chứa `QueryResult` hoặc inline trong `query_executor.py` |
| `node_role_cache._persist_to_mongo` — collection `node_roles` vào `db_maintenance` thay vì `db_monitor` | Chấp nhận — maintenance có node_roles riêng trong db_maintenance |
| `job_executions` vào `db_maintenance` — không xem chung với monitoring jobs trên Layer 3 dashboard | Chấp nhận — maintenance dashboard nếu cần sẽ đọc từ db_maintenance |
| `maint_settings.mssql_nodes` parse format — cần copy validator từ layer1/config.py | Copy field validator `parse_mssql_nodes` vào MaintEnvSettings |
| seed_maintenance.py gọi `MongoConnection.initialize(maint_settings)` — `maint_settings` phải có `maint_mongodb_db` | Đã có sẵn trong config, không vấn đề |
