# Local Development

Tai lieu nay mo ta cach chay local theo repo hien tai cho ca 3 layer.

## 1. Yeu cau

### Python

- Python 3.x
- ODBC Driver 17 for SQL Server
- MongoDB local hoac remote

### Node.js

- Node.js >= 18 cho `layer3/`
- npm workspace support

## 2. Chuan bi `.env`

Bat dau tu:

```bash
cp .env.example .env
```

Toi thieu can sua:

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=change_me
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor
LAYER2_URL=http://127.0.0.1:8000
```

Neu chay Layer 3 local:

```env
L2_API_URL=http://127.0.0.1:8000
L1_API_URL=http://127.0.0.1:8001
API_PORT=3000
```

## 3. Cai Python dependencies

Lenh hien co trong repo:

```bash
pip install -r requirements.txt
pip install -r layer2/requirements.txt
```

Neu dang dung virtualenv:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r layer2/requirements.txt
```

## 4. Chuan bi MongoDB

Can MongoDB truoc khi chay Layer 1 va Layer 2.

### Seed du lieu can thiet

```bash
python -m layer1.seed.seed_capture_tools
python -m layer1.seed.seed_topics
```

## 5. Chay Layer 1

### Scheduler only

```bash
python -m layer1.scheduler
```

### Scheduler + HTTP API

```bash
python -m layer1.main
```

Mac dinh HTTP API:

- host `0.0.0.0`
- port `8001`

Co the override:

```env
L1_API_HOST=127.0.0.1
L1_API_PORT=8001
```

## 6. Chay Layer 2

```bash
python -m layer2.main
```

API local:

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/api/v1/skills`

## 7. Chay Layer 3

Trong thu muc `layer3/`:

```bash
npm install
npm run build
npm run start
```

Hoac dev mode:

```bash
npm install
npm run dev
```

Scripts workspace:

- `npm run build`
- `npm run start`
- `npm run dev`

## 8. Thu tu chay local de test end-to-end

1. MongoDB
2. Layer 1
3. Layer 2
4. Layer 3

## 9. Kiem tra nhanh

### Layer 1

```bash
curl http://127.0.0.1:8001/health
```

Luu y:

- Lenh tren chi hop le neu ban dang chay `python -m layer1.main`
- Neu chi chay `python -m layer1.scheduler` thi se khong co HTTP API

### Layer 2

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/v1/skills
```

### Layer 3

```bash
curl http://127.0.0.1:3000/health
```

Trang giao dien:

- `http://127.0.0.1:3000/dashboard`
- `http://127.0.0.1:3000/insights`
- `http://127.0.0.1:3000/query-plan`

## 10. Cac van de thuong gap

### Layer 1 khong start

Nguyen nhan thuong gap:

- thieu `MSSQL_NODES`
- MongoDB chua chay
- chua seed `capture_tool_defs`

### Layer 2 khong start

Nguyen nhan thuong gap:

- thieu `CLAUDE_API_KEY`
- khong ket noi duoc cum MSSQL de khoi tao `NodeRoleCache`
- YAML trong `layer2/skills/` loi

### Layer 3 start o degraded mode

Nguyen nhan thuong gap:

- `MONGODB_URI` hoac `MONGODB_DB` sai
- Layer 2 chua chay nen health tra `l2=false`

## 11. Ghi chu cho frontend

Layer 3 build output duoc serve tu:

- `layer3/dist/`

Static assets va pages duoc serve tu:

- `layer3/apps/web/pages`
- `layer3/apps/web/css`
- `layer3/assets`
- `layer3/images`
