# Deployment — Linux + Docker Compose

---

## Tổng quan

```
┌─── Build Machine ───────────────────────────────┐
│  docker compose build                           │
│  docker push longdt/ai-automation-mssql:v0.0.1 │
└────────────────────────┬────────────────────────┘
                         │
                    Docker Hub
                         │
┌─── Linux Server ────────────────────────────────┐
│                                                 │
│  docker compose pull                            │
│  docker compose up -d                           │
│                                                 │
│  ┌──────────────────┐   ┌──────────────────┐   │
│  │  layer1-monitor  │──▶│  mongodb         │   │
│  │  (Python app)    │   │  (mongo:7.0)     │   │
│  └──────────────────┘   └──────────────────┘   │
└─────────────────────────────────────────────────┘
                    │ port 1433
                    ▼
         MSSQL AG Cluster (external)
```

**Server chỉ cần:** Docker Engine + `docker-compose.yml` + `.env`

---

## Yêu cầu hệ thống (server)

| Thành phần | Yêu cầu |
|---|---|
| **OS** | Linux — Ubuntu 20.04+ hoặc Debian 11+ |
| **Docker Engine** | 24.0+ |
| **Docker Compose** | Plugin v2 (`docker compose`) |
| **RAM** | 1 GB |
| **Disk** | 10 GB (MongoDB data) |
| **Network** | Kết nối đến SQL Server nodes trên port 1433 |

---

## Phần 1 — Build & Push (trên build machine)

### Bước 1: Build image

```bash
docker compose build
```

### Bước 2: Tag và push lên Docker Hub

```bash
# Login Docker Hub (1 lần)
docker login

# Tag — phải tag cả version lẫn latest
VERSION=v0.0.1

docker tag ai-automation-mssql/layer1:latest longdt/ai-automation-mssql:${VERSION}
docker tag ai-automation-mssql/layer1:latest longdt/ai-automation-mssql:latest

# Push cả 2 tag
docker push longdt/ai-automation-mssql:${VERSION}
docker push longdt/ai-automation-mssql:latest
```

---

## Phần 2 — Deploy trên server

### Bước 1: Cài Docker Engine

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Kiểm tra
docker --version
docker compose version
```

### Bước 2: Tạo thư mục và copy file

```bash
mkdir -p /opt/ai-automation-mssql && cd /opt/ai-automation-mssql
```

Copy 2 file lên server:

```bash
# Chạy lệnh này trên build machine
scp docker-compose.yml .env.example user@server:/opt/ai-automation-mssql/
```

### Bước 3: Tạo file `.env`

```bash
cp .env.example .env
nano .env
```

Điền các giá trị:

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=your_secure_password

# Trỏ vào container mongodb — KHÔNG dùng localhost
MONGODB_URI=mongodb://mongodb:27017

# Image pull từ Docker Hub
LAYER1_IMAGE=longdt/ai-automation-mssql:v0.0.1

TEAMS_WEBHOOK_URL=
```

> File `.env` chứa credentials — **không commit vào git, không share**.

### Bước 4: Pull image và start

```bash
docker compose pull
docker compose up -d
```

Kiểm tra containers đang chạy:

```bash
docker compose ps
```

```
NAME              IMAGE                                STATUS
layer1-monitor    longdt/ai-automation-mssql:v0.0.1   Up
mongodb           mongo:7.0                            Up (healthy)
```

### Bước 5: Seed monitor_topics vào MongoDB

```bash
# Chạy seed script
docker compose run --rm layer1 python -m layer1.seed.seed_topics

# Hoặc insert thủ công
docker compose exec mongodb mongosh db_monitor --eval "
db.monitor_topics.insertOne({
  topic_id: 'test_connectivity',
  display_name: 'Connectivity Test',
  enabled: true,
  schedule_sec: 300,
  nodes: ['primary'],
  queries: [{
    query_id: 'server_version',
    sql: 'SELECT TOP 1 @@VERSION AS version, GETUTCDATE() AS server_time',
    timeout_sec: 10
  }],
  detector_type: null
})
"
```

Restart app để load topics mới:

```bash
docker compose restart layer1
```

### Bước 6: Kiểm tra hoạt động

```bash
# Log startup
docker compose logs layer1
```

Output mong đợi:
```
layer1-monitor | INFO  layer1.scheduler — Layer 1 Monitoring Service starting...
layer1-monitor | INFO  layer1.executor.node_role_cache — Node roles initialized: primary=SQL-NODE-01
layer1-monitor | INFO  layer1.scheduler — Registered 1 topic jobs + 2 system jobs.
layer1-monitor | INFO  layer1.scheduler — Layer 1 Monitoring Service started — scheduler running.
```

```bash
# Kiểm tra node roles
docker compose exec mongodb mongosh db_monitor --eval "db.node_roles.find().pretty()"

# Kiểm tra raw_metrics có data (sau 5 phút)
docker compose exec mongodb mongosh db_monitor --eval "
db.raw_metrics.find().sort({collected_at:-1}).limit(3).pretty()
"
```

---

## Vận hành thường ngày

### Xem log

```bash
docker compose logs -f layer1
docker compose logs -f layer1 | grep -E "ERROR|WARNING|CRITICAL"
```

### Restart / Stop

```bash
docker compose restart layer1        # restart chỉ app
docker compose down                  # stop toàn bộ (data MongoDB giữ nguyên)
docker compose up -d                 # start lại
```

### Update lên version mới

Trên **build machine**:
```bash
VERSION=v0.0.2
docker compose build
docker tag ai-automation-mssql/layer1:latest longdt/ai-automation-mssql:${VERSION}
docker tag ai-automation-mssql/layer1:latest longdt/ai-automation-mssql:latest
docker push longdt/ai-automation-mssql:${VERSION}
docker push longdt/ai-automation-mssql:latest
```

Trên **server**:
```bash
nano .env   # sửa LAYER1_IMAGE=longdt/ai-automation-mssql:v0.0.2
docker compose pull layer1
docker compose up -d layer1
```

### Backup MongoDB

```bash
# Backup
docker compose exec mongodb mongodump \
  --db db_monitor \
  --out /tmp/backup_$(date +%Y%m%d)
docker cp mongodb:/tmp/backup_$(date +%Y%m%d) ./backup/

# Restore
docker cp ./backup/backup_20260419 mongodb:/tmp/restore/
docker compose exec mongodb mongorestore /tmp/restore/
```

---

## Xử lý lỗi thường gặp

**Container restart liên tục:**
```bash
docker compose logs layer1 --tail=50
```
→ Kiểm tra `.env` — thiếu hoặc sai `MSSQL_NODES`, credentials.

**Không kết nối được SQL Server:**
```bash
docker compose exec layer1 python -c "
import pyodbc
conn = pyodbc.connect(
  'DRIVER={ODBC Driver 17 for SQL Server};SERVER=SQL-NODE-01,1433;DATABASE=master;UID=sa_monitor;PWD=xxx;TrustServerCertificate=yes;'
)
print('OK')
"
```

**MongoDB không healthy:**
```bash
docker compose logs mongodb --tail=20
```

**Registered 0 topic jobs:**
```bash
docker compose exec mongodb mongosh db_monitor --eval "
db.monitor_topics.find({enabled: true}, {topic_id:1}).pretty()
"
# Nếu rỗng → chạy lại seed (Bước 5)
```

---

## Checklist go-live

- [ ] Docker Engine đã cài, `docker compose version` trả về v2.x
- [ ] `docker-compose.yml` và `.env` có trên server
- [ ] `.env` điền đủ: `MSSQL_NODES`, credentials, `MONGODB_URI=mongodb://mongodb:27017`, `LAYER1_IMAGE`
- [ ] `docker compose pull && docker compose up -d` → cả 2 containers `Up`
- [ ] Log startup không có `ERROR` hay `CRITICAL`
- [ ] `db.node_roles.find()` trả về đúng Primary/Secondary
- [ ] `db.raw_metrics.find()` có data sau vài phút
