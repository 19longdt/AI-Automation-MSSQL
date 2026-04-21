# Deployment — Linux + Docker Compose

---

## Tổng quan

```
┌─── Build Machine ──────────────────────────────────────────────────┐
│  docker build -f Dockerfile        → 19longdt/ai-automation-mssql-layer1  │
│  docker build -f Dockerfile.layer2 → 19longdt/ai-automation-mssql-layer2  │
│  docker push ...                                                   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                            Docker Hub
                                 │
┌─── Linux Server ────────────────────────────────────────────────────┐
│                                                                     │
│  docker compose pull && docker compose up -d                        │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │  layer1-monitor │   │  layer2-agent   │──▶│  mongodb        │   │
│  │  Python sched.  │──▶│  FastAPI + Bot  │   │  (mongo:7.0)    │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│       port 8000 ──────────────▶ :8000                               │
└─────────────────────────────────────────────────────────────────────┘
                    │ port 1433
                    ▼
         MSSQL AG Cluster (external)
```

**Server chỉ cần:** Docker Engine + `docker-compose.yml` + `.env`

---

## Images

| Image | Dockerfile | Nội dung |
|---|---|---|
| `19longdt/ai-automation-mssql-layer1` | `Dockerfile` | Layer 1 — Python monitoring scheduler |
| `19longdt/ai-automation-mssql-layer2` | `Dockerfile.layer2` | Layer 2 — FastAPI + Claude AI agent |
| `19longdt/ai-automation-mssql` | `Dockerfile.combined` | All-in-one — cả 2 layer trong 1 image |

---

## Yêu cầu hệ thống (server)

| Thành phần | Yêu cầu |
|---|---|
| **OS** | Linux — Ubuntu 20.04+ hoặc Debian 11+ |
| **Docker Engine** | 24.0+ |
| **Docker Compose** | Plugin v2 (`docker compose`) |
| **RAM** | 2 GB (cả 2 layer + MongoDB) |
| **Disk** | 10 GB (MongoDB data) |
| **Network** | Kết nối đến SQL Server nodes trên port 1433 |

---

## Phần 1 — Build & Push (trên build machine)

Chọn **một** trong 3 cách build:

### Cách A — Separate images (khuyến nghị)

Build và push riêng từng layer — deploy độc lập, update từng layer không ảnh hưởng layer kia.

```bash
docker login

VERSION=v1.0.0

# Layer 1
docker build -f Dockerfile -t 19longdt/ai-automation-mssql-layer1:${VERSION} \
                            -t 19longdt/ai-automation-mssql-layer1:latest .
docker push 19longdt/ai-automation-mssql-layer1:${VERSION}
docker push 19longdt/ai-automation-mssql-layer1:latest

# Layer 2
docker build -f Dockerfile.layer2 -t 19longdt/ai-automation-mssql-layer2:${VERSION} \
                                   -t 19longdt/ai-automation-mssql-layer2:latest .
docker push 19longdt/ai-automation-mssql-layer2:${VERSION}
docker push 19longdt/ai-automation-mssql-layer2:latest
```

### Cách B — All-in-one image

1 image dùng cho cả 2 layer — đơn giản hơn, nhưng update 1 layer phải build lại cả 2.

```bash
docker login

VERSION=v1.0.0

docker build -f Dockerfile.combined -t 19longdt/ai-automation-mssql:${VERSION} \
                                    -t 19longdt/ai-automation-mssql:latest .
docker push 19longdt/ai-automation-mssql:${VERSION}
docker push 19longdt/ai-automation-mssql:latest
```

### Cách C — Chỉ build Layer 1

Khi chưa dùng Layer 2:

```bash
VERSION=v1.0.0
docker build -f Dockerfile -t 19longdt/ai-automation-mssql-layer1:${VERSION} \
                            -t 19longdt/ai-automation-mssql-layer1:latest .
docker push 19longdt/ai-automation-mssql-layer1:${VERSION}
docker push 19longdt/ai-automation-mssql-layer1:latest
```

---

## Phần 2 — Deploy trên server

### Bước 1: Cài Docker Engine (lần đầu)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

### Bước 2: Tạo thư mục và copy file

```bash
mkdir -p /opt/ai-automation-mssql && cd /opt/ai-automation-mssql
```

Copy từ build machine:

```bash
scp docker-compose.yml .env user@server:/opt/ai-automation-mssql/
```

### Bước 3: Tạo file `.env`

```bash
nano .env
```

**Các biến bắt buộc cho Layer 1:**

```env
# MSSQL
MSSQL_NODES=10.x.x.1,10.x.x.2,10.x.x.3
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=your_secure_password
MSSQL_PORT=1433
MSSQL_QUERY_TIMEOUT_SEC=30

# MongoDB — trỏ vào container, KHÔNG dùng localhost
MONGODB_URI=mongodb://mongodb:27017
MONGODB_DB=db_monitor

# Image (Cách A — separate)
LAYER1_IMAGE=19longdt/ai-automation-mssql-layer1:v1.0.0

# Telegram alerts + /quick command (tùy chọn)
TELEGRAM_BOT_TOKEN=<layer1-bot-token>
TELEGRAM_CHAT_ID=<chat-id>

# Claude API — tùy chọn, cần nếu muốn /quick command (Haiku analysis)
CLAUDE_API_KEY=sk-ant-...
HAIKU_MODEL=claude-haiku-4-5-20251001
```

**Bổ sung khi dùng Layer 2 (/analyze command):**

```env
# Image layer 2 (Cách A — separate)
LAYER2_IMAGE=19longdt/ai-automation-mssql-layer2:v1.0.0

# Layer 2 agent URL — để Layer 1 TelegramBot forward /analyze requests
LAYER2_URL=http://layer2:8000

# Bot Telegram riêng cho Layer 2 — KHÁC với Layer 1 để tránh polling conflict
L2_TELEGRAM_BOT_TOKEN=<layer2-bot-token>

# Claude API — bắt buộc cho Layer 2 agent
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

**Chú thích:**
- `LAYER2_URL` để Layer 1 forward `/analyze` requests → Layer 2 agent (Sonnet)
- Layer 1 có 2 lệnh:
  - `/quick` dùng Haiku model (nhanh, 5 giây, nếu `CLAUDE_API_KEY` set)
  - `/analyze` forward tới Layer 2 agent (30–90s, nếu `LAYER2_URL` set)

**Khi dùng all-in-one (Cách B):**

```env
# Cùng 1 image cho cả 2 layer
LAYER1_IMAGE=19longdt/ai-automation-mssql:v1.0.0
LAYER2_IMAGE=19longdt/ai-automation-mssql:v1.0.0
```

> File `.env` chứa credentials — **không commit vào git, không share**.

### Bước 4: Pull và start

**Chỉ Layer 1:**
```bash
docker compose pull layer1
docker compose up -d layer1
```

**Cả 2 layer:**
```bash
docker compose pull
docker compose up -d
```

**Thêm Layer 2 vào hệ thống đang chạy Layer 1:**
```bash
docker compose pull layer2
docker compose up -d layer2
```

Kiểm tra containers:

```bash
docker compose ps
```

```
NAME              IMAGE                                        STATUS
layer1-monitor    19longdt/ai-automation-mssql-layer1:v1.0.0  Up
layer2-agent      19longdt/ai-automation-mssql-layer2:v1.0.0  Up (healthy)
mongodb           mongo:7.0                                    Up (healthy)
```

### Bước 5: Seed monitor_topics vào MongoDB

```bash
docker compose run --rm layer1 python -m layer1.seed.seed_topics
```

Restart Layer 1 để load topics:

```bash
docker compose restart layer1
```

### Bước 6: Kiểm tra Layer 1

```bash
docker compose logs layer1 --tail=30
```

Output mong đợi:
```
layer1-monitor | INFO  layer1.scheduler — Layer 1 Monitoring Service starting...
layer1-monitor | INFO  layer1.executor.node_role_cache — Node roles initialized: primary=10.x.x.1
layer1-monitor | INFO  layer1.scheduler — Registered N topic jobs + 2 system jobs.
layer1-monitor | INFO  layer1.scheduler — Layer 1 Monitoring Service started — scheduler running.
```

```bash
# Kiểm tra node roles
docker compose exec mongodb mongosh db_monitor --eval "db.node_roles.find().pretty()"

# Kiểm tra raw_metrics có data (sau 5 phút)
docker compose exec mongodb mongosh db_monitor --eval "
db.raw_metrics.find().sort({collected_at:-1}).limit(3).pretty()"
```

### Bước 7: Kiểm tra Layer 2

```bash
docker compose logs layer2 --tail=30
```

Output mong đợi:
```
layer2-agent | INFO  layer2.main — Layer 2 started. skills=13 nodes=['10.x.x.1', '10.x.x.2', '10.x.x.3']
layer2-agent | INFO  layer2.main — TelegramBot started.
```

```bash
# Health endpoint — kiểm tra MongoDB + MSSQL
curl http://localhost:8000/health

# Danh sách skills đã load
curl http://localhost:8000/skills
```

---

## Vận hành thường ngày

### Xem log

```bash
docker compose logs -f layer1
docker compose logs -f layer2
docker compose logs -f layer1 | grep -E "ERROR|WARNING|CRITICAL"
```

### Restart / Stop

```bash
docker compose restart layer1          # restart chỉ Layer 1
docker compose restart layer2          # restart chỉ Layer 2
docker compose down                    # stop toàn bộ (data MongoDB giữ nguyên)
docker compose up -d                   # start lại tất cả
```

### Update lên version mới

**Chỉ update Layer 1** (trên build machine):
```bash
VERSION=v1.0.1
docker build -f Dockerfile -t 19longdt/ai-automation-mssql-layer1:${VERSION} \
                            -t 19longdt/ai-automation-mssql-layer1:latest .
docker push 19longdt/ai-automation-mssql-layer1:${VERSION}
docker push 19longdt/ai-automation-mssql-layer1:latest
```

Trên server:
```bash
# Sửa LAYER1_IMAGE trong .env
nano .env   # LAYER1_IMAGE=19longdt/ai-automation-mssql-layer1:v1.0.1

docker compose pull layer1
docker compose up -d layer1
```

**Chỉ update Layer 2** (trên build machine):
```bash
VERSION=v1.0.1
docker build -f Dockerfile.layer2 -t 19longdt/ai-automation-mssql-layer2:${VERSION} \
                                   -t 19longdt/ai-automation-mssql-layer2:latest .
docker push 19longdt/ai-automation-mssql-layer2:${VERSION}
docker push 19longdt/ai-automation-mssql-layer2:latest
```

Trên server:
```bash
nano .env   # LAYER2_IMAGE=19longdt/ai-automation-mssql-layer2:v1.0.1

docker compose pull layer2
docker compose up -d layer2
```

**Update all-in-one** (trên build machine):
```bash
VERSION=v1.0.1
docker build -f Dockerfile.combined -t 19longdt/ai-automation-mssql:${VERSION} \
                                    -t 19longdt/ai-automation-mssql:latest .
docker push 19longdt/ai-automation-mssql:${VERSION}
docker push 19longdt/ai-automation-mssql:latest
```

Trên server:
```bash
nano .env   # LAYER1_IMAGE và LAYER2_IMAGE cùng = 19longdt/ai-automation-mssql:v1.0.1

docker compose pull
docker compose up -d
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
docker compose logs layer2 --tail=50
```
→ Kiểm tra `.env` — thiếu hoặc sai required vars.

**Layer 2 crash ngay khi start:**
```bash
docker compose logs layer2 --tail=20
```
Nguyên nhân thường gặp:
- `CLAUDE_API_KEY` chưa điền hoặc sai
- `L2_TELEGRAM_BOT_TOKEN` chưa set
- `_base.yaml` bị lỗi format

**Không kết nối được SQL Server:**
```bash
docker compose exec layer1 python -c "
import pyodbc
conn = pyodbc.connect(
  'DRIVER={ODBC Driver 17 for SQL Server};SERVER=10.x.x.1,1433;DATABASE=master;UID=sa_monitor;PWD=xxx;TrustServerCertificate=yes;'
)
print('OK')
"
```

**Layer 2 health degraded:**
```bash
curl http://localhost:8000/health
# Xem field "mssql_nodes" — node nào false là không reach được
```

**MongoDB không healthy:**
```bash
docker compose logs mongodb --tail=20
```

**Registered 0 topic jobs:**
```bash
docker compose exec mongodb mongosh db_monitor --eval "
db.monitor_topics.find({enabled: true}, {topic_id:1}).pretty()"
# Nếu rỗng → chạy lại seed (Bước 5)
```

---

## Checklist go-live

### Layer 1
- [ ] Docker Engine đã cài, `docker compose version` trả về v2.x
- [ ] `docker-compose.yml` và `.env` có trên server
- [ ] `.env` điền đủ: `MSSQL_NODES`, credentials, `MONGODB_URI=mongodb://mongodb:27017`, `LAYER1_IMAGE`
- [ ] `docker compose pull layer1 && docker compose up -d layer1` → containers `Up`
- [ ] Log startup không có `ERROR` hay `CRITICAL`
- [ ] `db.node_roles.find()` trả về đúng Primary/Secondary
- [ ] `db.raw_metrics.find()` có data sau vài phút

### Layer 1 + Layer 2 Integration (/quick + /analyze)
- [ ] Layer 1: `CLAUDE_API_KEY` + `HAIKU_MODEL` set → `/quick` enabled (Haiku analysis Layer 1)
- [ ] Layer 1: `LAYER2_URL=http://layer2:8000` set → `/analyze` enabled (forward to Layer 2)
- [ ] Layer 2: `CLAUDE_API_KEY` + `CLAUDE_MODEL` set (Sonnet for Layer 2 agent)
- [ ] Layer 2: `L2_TELEGRAM_BOT_TOKEN` set (bot khác với Layer 1)

### Layer 2 Setup (bổ sung)
- [ ] `LAYER2_IMAGE` set trong `.env`
- [ ] `docker compose pull layer2 && docker compose up -d layer2` → `Up (healthy)`
- [ ] `curl http://localhost:8000/health` trả về `{"status": "ok", ...}`
- [ ] `curl http://localhost:8000/skills` trả về danh sách skills
- [ ] Test `/quick` trong Telegram → Haiku trả lời trong 5 giây
- [ ] Test `/analyze` trong Telegram → Layer 2 agent trả lời sau 30–90s

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
