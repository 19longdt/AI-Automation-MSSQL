# Configuration

He thong hien tai co 3 nhom cau hinh:

1. Bien moi truong trong `.env`
2. Monitoring config trong MongoDB `monitor_topics`
3. Skill va business context trong Layer 2

## 1. Bien moi truong dung chung

Mau tham khao nam o `.env.example`.

### MSSQL

```env
MSSQL_NODES=SQL-NODE-01,SQL-NODE-02,SQL-NODE-03
MSSQL_DATABASE=YourDatabase
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=change_me
MSSQL_PORT=1433
MSSQL_QUERY_TIMEOUT_SEC=30
```

`MSSQL_NODES` ho tro 2 format:

- comma-separated
- JSON array

### MongoDB

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=db_monitor
```

### Layer 1 operational

```env
NODE_ROLE_REFRESH_SEC=3600
DEDUP_SUPPRESS_MINUTES=30
TEAMS_WEBHOOK_URL=
SLACK_BOT_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ACTION_BOT_TOKEN=
CLAUDE_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6
HAIKU_MODEL=claude-haiku-4-5-20251001
LAYER2_URL=http://layer2:8000
```

Ghi chu:

- `CLAUDE_API_KEY` trong Layer 1 dung cho `/quick`
- `LAYER2_URL` dung de Layer 1 forward phan tich sau sang Layer 2
- `ACTION_BOT_TOKEN` duoc Layer 3 dung khi goi Layer 1 action API

### Layer 2

```env
L2_TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Layer 2 se doc `L2_TELEGRAM_BOT_TOKEN` va map vao `telegram_bot_token`.

Bien runtime bo sung:

- `AGENT_TIMEOUT_SEC` khong duoc doc truc tiep trong `.env.example`, nhung logic timeout hien tai nam trong code Layer 2
- `PEAK_HOURS_START`, `PEAK_HOURS_END` duoc map trong `layer2/config.py` voi default `8` va `18`

### Logging

```env
L1_LOG_LEVEL=INFO
L2_LOG_LEVEL=INFO
LOGSTASH_HOST=
LOGSTASH_PORT=5044
LOGSTASH_TRANSPORT=tcp
L1_LOGSTASH_APP_NAME=sds.ep.ai-automation-layer1
L2_LOGSTASH_APP_NAME=sds.ep.ai-automation-layer2
LOGSTASH_DATABASE_PATH=
```

## 2. Layer 3 config

Layer 3 API doc config tu `layer3/apps/api/src/config.ts`.

Bien chinh:

```env
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=db_monitor
L2_API_URL=http://127.0.0.1:8000
L1_API_URL=http://127.0.0.1:8001
ACTION_BOT_TOKEN=
API_PORT=3000
LOG_LEVEL=info
```

`L1_API_URL` chi co y nghia khi Layer 1 dang chay `layer1.main`.

Trong Docker Compose, Layer 3 duoc inject:

```env
MONGODB_URI=mongodb://mongodb:27017
L2_API_URL=http://layer2:8000
API_PORT=3000
```

## 3. MongoDB `monitor_topics`

`monitor_topics` la source of truth cho monitoring. Khong can sua code de doi query, threshold hay schedule cua topic da co.

### Truong quan trong

```json
{
  "topic_id": "slow_sessions",
  "display_name": "Slow Query / Active Sessions with Blocking",
  "enabled": true,
  "schedule_sec": 300,
  "nodes": ["all"],
  "queries": [],
  "detector_type": "threshold",
  "thresholds": {},
  "baseline_config": null,
  "capture_tools": [],
  "extra": {}
}
```

### `detector_type` hien tai

- `threshold`
- `baseline`
- `plan_analysis`
- `blocking_chain`
- `null`

## 4. Skills Layer 2

Source of truth:

- `layer2/skills/_base.yaml`
- `layer2/skills/*.yaml`

Skills hien co:

- `ag.yaml`
- `blocking.yaml`
- `cdc.yaml`
- `deadlock.yaml`
- `generic.yaml`
- `index.yaml`
- `maintenance.yaml`
- `memory.yaml`
- `plan_xml.yaml`
- `resource.yaml`
- `slow_query.yaml`
- `tempdb.yaml`
- `wait.yaml`

Moi skill quy dinh:

- `skill_id`
- `issue_types`
- `specialization`
- `required_tools`
- `optional_tools`
- `max_tool_rounds`
- `max_tokens`

## 5. Business context Layer 2

Hai nguon context:

- `layer2/db_business_context.yaml`
- collection `db_context`

Cap nhat `db_context` bang:

```bash
POST /admin/refresh-db-context
```

## 6. Them va sua topic

### Sua topic da ton tai

Chi can update MongoDB. Layer 1 se doc lai o lan chay tiep theo.

### Them topic moi

Co 2 truong hop:

- Topic da duoc seed san trong code -> chay lai `seed_topics.py`
- Topic moi hoan toan -> chen vao MongoDB va restart Layer 1 de APScheduler dang ky job moi

## 7. Quyen SQL toi thieu

Tai lieu cu ve quyen SQL van con gia tri o muc tong quat:

- `VIEW SERVER STATE`
- `VIEW DATABASE STATE`
- quyen doc `msdb` neu dung SQL Agent/backup queries

Nhung can review theo tung topic query cu the neu mo rong them monitoring.
