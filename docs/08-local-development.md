# Chạy project ở local

---

## Yêu cầu

| Thành phần | Yêu cầu |
|---|---|
| **Python** | 3.11+ |
| **MongoDB** | Đang chạy ở `localhost:27017` |
| **ODBC Driver 17** | Microsoft ODBC Driver 17 for SQL Server |
| **Network** | Kết nối đến SQL Server nodes trên port 1433 |

---

## Bước 1: Cài ODBC Driver 17

### Windows

Tải và cài **ODBC Driver 17 for SQL Server** từ Microsoft, chọn đúng kiến trúc (x64).

Kiểm tra sau khi cài:
```cmd
odbcad32.exe
# Tab "System DSN" → "Drivers" → thấy "ODBC Driver 17 for SQL Server"
```

### Linux (Ubuntu/Debian)

```bash
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/debian/11/prod.list \
  | sudo tee /etc/apt/sources.list.d/mssql-release.list

sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y msodbcsql17 unixodbc-dev
```

---

## Bước 2: Tạo virtual environment và cài dependencies

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

---

## Bước 3: Tạo file `.env`

```bash
cp .env.example .env
```

Chỉnh sửa `.env` cho môi trường local:

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=your_password

# MongoDB local — dùng localhost
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor

NODE_ROLE_REFRESH_SEC=3600

TEAMS_WEBHOOK_URL=
```

---

## Bước 4: Seed monitor_topics vào MongoDB

```bash
python -m layer1.seed.seed_topics
```

Hoặc insert thủ công qua `mongosh`:

```javascript
use db_monitor

db.monitor_topics.insertOne({
  topic_id: "test_connectivity",
  display_name: "Connectivity Test",
  enabled: true,
  schedule_sec: 300,
  nodes: ["primary"],
  queries: [{
    query_id: "server_version",
    sql: "SELECT TOP 1 @@VERSION AS version, GETUTCDATE() AS server_time",
    timeout_sec: 10
  }],
  detector_type: null
})
```

---

## Bước 5: Chạy service

```bash
python -m layer1.scheduler
```

Output mong đợi:

```
2026-04-19T10:00:00 INFO  layer1.scheduler — Layer 1 Monitoring Service starting (config-driven)...
2026-04-19T10:00:00 INFO  layer1.scheduler — Connecting to MongoDB: mongodb://localhost:27017
2026-04-19T10:00:01 INFO  layer1.executor.node_role_cache — Node roles initialized: primary=SQL-NODE-01 secondaries=['SQL-NODE-02', 'SQL-NODE-03']
2026-04-19T10:00:01 INFO  layer1.scheduler — Registered 1 topic jobs + 2 system jobs.
2026-04-19T10:00:01 INFO  layer1.scheduler — Layer 1 Monitoring Service started — scheduler running.
```

Dừng service: `Ctrl+C`

---

## Kiểm tra nhanh

```bash
# Node roles detect đúng chưa
mongosh db_monitor --eval "db.node_roles.find().pretty()"

# Raw metrics sau vài phút
mongosh db_monitor --eval "db.raw_metrics.find().sort({collected_at:-1}).limit(3).pretty()"

# Job executions
mongosh db_monitor --eval "db.job_executions.find().sort({started_at:-1}).limit(5).pretty()"
```

---

## Lỗi thường gặp

**`No module named 'layer1'`**
```bash
# Phải chạy từ thư mục gốc của project, không phải trong layer1/
cd AI-Automation-MSSQL
python -m layer1.scheduler
```

**`pyodbc.Error: ('01000', "...ODBC Driver 17...")`**
→ ODBC Driver 17 chưa cài hoặc tên driver không đúng. Kiểm tra:
```python
import pyodbc
print(pyodbc.drivers())
# Phải có 'ODBC Driver 17 for SQL Server' trong list
```

**`ConnectionError: MongoConnection chưa được initialize`**
→ MongoDB chưa chạy. Kiểm tra: `mongosh --eval "db.adminCommand('ping')"`

**`RuntimeError: Không thể detect AG node roles`**
→ Không kết nối được SQL Server. Kiểm tra `MSSQL_NODES` và port 1433.

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
