# Deployment

Tai lieu nay mo ta cach build va deploy theo repo hien tai, bao gom ca Layer 3.

## 1. Docker Compose hien tai

`docker-compose.yml` dinh nghia 4 services:

- `layer1`
- `layer2`
- `layer3`
- `mongodb`

### Image defaults

- `19longdt/ai-automation-mssql-layer1:latest`
- `19longdt/ai-automation-mssql-layer2:latest`
- `19longdt/ai-automation-mssql-layer3:latest`

### Port mapping

- `8000:8000` cho Layer 2
- `3000:3000` cho Layer 3
- `27017:27017` cho MongoDB

Layer 1 khong map port ra host, nhung van chay HTTP API noi bo trong network compose.

Cap nhat theo compose hien tai:

- Service `layer1` dang chay `python -m layer1.scheduler`
- Nghia la stack mac dinh KHONG mo Layer 1 HTTP API
- Neu can `POST /kill-session` tu Layer 3, phai doi command sang `python -m layer1.main` va truyen `L1_API_URL` phu hop cho Layer 3

## 2. Dockerfiles

- `Dockerfile`: Layer 1
- `Dockerfile.layer2`: Layer 2
- `layer3/Dockerfile`: Layer 3
- `Dockerfile.combined`: image ket hop cho Layer 1 + Layer 2

## 3. Build script hien tai

Root script:

- `build.ps1`
- `build.sh`

Scripts nay hien da ho tro:

- `layer1`
- `layer2`
- `layer3`

Version files:

- `.version.layer1`
- `.version.layer2`
- `.version.layer3`

### Vi du PowerShell

```powershell
.\build.ps1
.\build.ps1 -Layer layer1
.\build.ps1 -Layer layer2
.\build.ps1 -Layer layer3
.\build.ps1 -SetVersion layer3 -SetVersionValue 0.3.0 -Layer layer3
```

## 4. Bien image trong compose

Compose doc:

- `LAYER1_IMAGE`
- `LAYER2_IMAGE`
- `LAYER3_IMAGE`

Vi du:

```env
LAYER1_IMAGE=19longdt/ai-automation-mssql-layer1:v0.0.10
LAYER2_IMAGE=19longdt/ai-automation-mssql-layer2:v0.0.12
LAYER3_IMAGE=19longdt/ai-automation-mssql-layer3:v0.0.3
```

## 5. Deploy day du

### Buoc 1: chuan bi `.env`

Can it nhat:

```env
MSSQL_NODES=...
MSSQL_DATABASE=...
MSSQL_USERNAME=...
MSSQL_PASSWORD=...
MONGODB_DB=db_monitor
CLAUDE_API_KEY=...
L2_TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
LAYER2_URL=http://layer2:8000
```

Luu y:

- Trong compose, `MONGODB_URI` cua layer1/layer2/layer3 duoc override thanh `mongodb://mongodb:27017`
- Layer 2 su dung `L2_TELEGRAM_BOT_TOKEN`
- Layer 1 su dung `TELEGRAM_BOT_TOKEN`
- `L1_API_URL` khong duoc inject san cho Layer 3 trong compose mac dinh

### Buoc 2: pull va start

```bash
docker compose pull
docker compose up -d
```

Hoac tung layer:

```bash
docker compose pull layer1
docker compose up -d layer1

docker compose pull layer2
docker compose up -d layer2

docker compose pull layer3
docker compose up -d layer3
```

## 6. Seed sau deploy

### Seed monitoring topics

```bash
docker compose run --rm layer1 python -m layer1.seed.seed_topics
```

### Seed capture tools

```bash
docker compose run --rm layer1 python -m layer1.seed.seed_capture_tools
```

Sau do restart Layer 1:

```bash
docker compose restart layer1
```

## 7. Health checks

### Layer 2

Compose healthcheck:

- `curl -f http://localhost:8000/health`

### Layer 3

Compose healthcheck:

- `wget -q -O - http://localhost:3000/health`

### MongoDB

Compose healthcheck:

- `mongosh --eval "db.adminCommand('ping').ok" --quiet`

## 8. Kiem tra sau deploy

### Layer 1

- xem logs khong co startup error
- co topic jobs duoc register
- `capture_tool_defs` da duoc load
- neu can HTTP API thi phai chay `layer1.main`, khong phai `layer1.scheduler`

### Layer 2

- `GET /health` tra ve MongoDB ok va danh sach node MSSQL
- `GET /api/v1/skills` tra ve danh sach skill

### Layer 3

- mo `http://host:3000/dashboard`
- `GET /health` tra ve `mongodb` va `l2`
- `POST /api/actions/kill-session` se can cau hinh bo sung cho Layer 1 API

## 9. Update tung layer

### Update Layer 1

```bash
docker compose pull layer1
docker compose up -d layer1
```

### Update Layer 2

```bash
docker compose pull layer2
docker compose up -d layer2
```

### Update Layer 3

```bash
docker compose pull layer3
docker compose up -d layer3
```

## 10. Ghi chu thuc te

- Layer 3 da la service production trong compose, khong con la phan tuong lai
- Combined image chi bao phu Layer 1 va Layer 2; Layer 3 van co Dockerfile rieng
- Neu dung MongoDB external, can bo phan override `MONGODB_URI` trong compose hoac tao compose variant rieng
- Action flow Layer 3 -> Layer 1 chua bat san trong compose mac dinh vi `layer1` dang chay scheduler-only
