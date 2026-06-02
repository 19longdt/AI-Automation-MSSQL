# Cau truc du an

Tai lieu nay mo ta cau truc repo hien tai. Noi dung da duoc cap nhat theo ma nguon thuc te, khong con theo cau truc cu 2-layer.

## 1. Thu muc goc

```text
AI-Automation-MSSQL/
|-- ARCHITECTURE.md
|-- README.md
|-- docker-compose.yml
|-- Dockerfile
|-- Dockerfile.layer2
|-- Dockerfile.combined
|-- build.ps1
|-- build.sh
|-- docs/
|-- db-context/
|-- layer1/
|-- layer2/
|-- layer3/
|-- sql-monitor/
|-- plan/
```

## 2. Layer 1

```text
layer1/
|-- main.py
|-- scheduler.py
|-- config.py
|-- ARCHITECTURE.md
|-- api/
|   |-- app.py
|   |-- http.py
|   `-- routes/
|-- executor/
|-- detectors/
|-- capture/
|   |-- diagnostic_capture.py
|   |-- capture_tool_loader.py
|   `-- handlers/
|-- notifications/
|-- services/
|-- storage/
|   |-- mongo_client.py
|   |-- indexes.py
|   `-- repositories/
|-- models/
|-- job_manager/
|-- ai/
`-- seed/
    |-- seed_topics.py
    `-- seed_capture_tools.py
```

### Diem can luu y

- `main.py` la runtime co HTTP API
- `scheduler.py` la entrypoint duoc dung trong Docker Compose
- `capture/` la phan moi quan trong cho `finding_diagnostics`
- `seed_capture_tools.py` seed collection `capture_tool_defs`

## 3. Layer 2

```text
layer2/
|-- main.py
|-- config.py
|-- ARCHITECTURE.md
|-- AGENT_MECHANISM.md
|-- db_business_context.yaml
|-- api/
|   `-- routes/
|-- agent/
|-- analysis/
|   `-- plan/
|-- plan/
|   |-- analyzers/
|   |-- models/
|   `-- parser/
|-- executor/
|-- notifications/
|-- storage/
|   |-- mongo_client.py
|   |-- indexes.py
|   `-- repositories/
|-- models/
|-- skills/
`-- utils/
```

### Diem can luu y

- `skills/` la source of truth cho specialization cua AI
- `plan/` va `analysis/plan/` phuc vu execution plan analysis
- `api/routes/admin.py` quan ly `db_context`

## 4. Layer 3

```text
layer3/
|-- Dockerfile
|-- package.json
|-- package-lock.json
|-- tsconfig*.json
|-- webpack.config.js
|-- ARCHITECTURE.md
|-- apps/
|   |-- api/
|   |   |-- package.json
|   |   `-- src/
|   |       |-- main.ts
|   |       |-- server.ts
|   |       |-- config.ts
|   |       |-- db/
|   |       |-- proxy/
|   |       |-- routes/
|   |       `-- services/
|   `-- web/
|       |-- package.json
|       |-- pages/
|       |-- css/
|       `-- dashboard/
|-- packages/
|   `-- core/
|       `-- src/
|           |-- types/
|           `-- plan/
|-- assets/
|-- css/
|-- dist/
|-- examples/
`-- images/
```

### Diem can luu y

- `apps/api` la Fastify backend
- `apps/web` la frontend pages va dashboard scripts
- `packages/core` chua shared types cho Layer 3
- `dist/` la output build duoc serve boi Fastify

## 5. Thu muc docs khac

### `db-context/`

Tai lieu nghiep vu/phu tro cho database, dung de cung cap context bo sung khi can.

### `docs/`

Tai lieu tong hop cho toan bo he thong. File nay va cac file cung thu muc da duoc cap nhat theo repo hien tai.

### `plan/`

Chua cac implementation plan, roadmap hoac ghi chu ky thuat. Khong phai source of truth cho runtime.

## 6. Build va workspace

### Python

- Layer 1 va Layer 2 su dung root-level Python environment
- Dependencies chia giua `requirements.txt` va `layer2/requirements.txt`

### Node.js

- `layer3/package.json` khai bao workspace:
  - `apps/*`
  - `packages/*`

Scripts chinh:

- `npm run dev`
- `npm run build`
- `npm run start`

## 7. File source of truth nen uu tien doc

- Kien truc: `ARCHITECTURE.md`, `layer1/ARCHITECTURE.md`, `layer2/ARCHITECTURE.md`, `layer3/ARCHITECTURE.md`
- Config env: `.env.example`, `layer1/config.py`, `layer2/config.py`, `layer3/apps/api/src/config.ts`
- Deployment: `docker-compose.yml`, `Dockerfile*`, `layer3/Dockerfile`
- API:
  - Layer 1: `layer1/api/routes/`
  - Layer 2: `layer2/api/routes/`
  - Layer 3: `layer3/apps/api/src/routes/`
