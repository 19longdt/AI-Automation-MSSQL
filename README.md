# AI-Automation-MSSQL

Hệ thống tự động giám sát và phân tích sự cố cho cụm **MSSQL Server 2019 Enterprise Always On Availability Groups**.

**Status:** ✅ Production-ready (Layer 1 monitoring + Layer 2 AI analysis)

---

## 📋 Overview

**Problem:** MSSQL Always On AG cluster với 3 nodes, dữ liệu lớn (~1TB), CDC capture, partitioned tables — cần giám sát liên tục và phân tích sự cố real-time.

**Solution:** 2-layer architecture:
- **Layer 1** — Python APScheduler service: monitoring + alerting (config-driven, thay đổi query/threshold không cần redeploy)
- **Layer 2** — FastAPI + Claude AI + Telegram bot: on-demand analysis khi user yêu cầu `/analyze`

---

## 🏗️ Architecture

```
                 ┌─────────────────────────┐
                 │   MSSQL Always On AG    │
                 │  (EASYPOS-DB1/2/3)      │
                 └────────────┬────────────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                             ▼
          ┌──────────────┐           ┌──────────────┐
          │   Layer 1    │           │   Layer 2    │
          │   Monitoring │───────────│   Analysis   │
          └──────────────┘           └──────────────┘
                │                           │
         ┌──────┴──────┐            ┌──────┴──────┐
         ▼             ▼            ▼             ▼
    MongoDB      Telegram bot  Claude API   FastAPI
                                  │
                          ┌───────┴────────┐
                          ▼                ▼
                      Findings         Notifications
```

### Layer 1 — Config-Driven Monitoring
- **APScheduler** jobs loaded từ MongoDB `monitor_topics`
- Parallel query execution per node
- Built-in detectors: threshold, baseline, blocking_chain, plan_analysis
- Auto role detection (PRIMARY/SECONDARY) + caching
- Telegram/Teams notifications

**Thay đổi query/threshold:** Edit MongoDB → không cần redeploy

### Layer 2 — AI Agent Analysis
- **FastAPI** REST API
- **Claude Sonnet** API for intelligent analysis
- **Telegram bot** webhook integration (`/analyze` command)
- Real-time findings explanation + recommendations

---

## 🚀 Quick Start

### Prerequisites
- Docker + Docker Compose
- MSSQL Server instance (3-node AG recommended, but single node OK for testing)
- MongoDB (local or remote)
- Telegram bot token (optional, for notifications)

### 1. Setup Environment

```bash
cd d:\GIT\AI-Automation-MSSQL

# Copy and edit .env
cp .env.example .env
```

Edit `.env`:
```env
# MSSQL nodes (comma-separated IPs)
MSSQL_NODES=10.x.x.1,10.x.x.2,10.x.x.3
MSSQL_DATABASE=easyposbackoffice
MSSQL_USERNAME=sa_monitor
MSSQL_PASSWORD=YourPassword

# MongoDB
MONGODB_URI=mongodb://mongodb:27017
MONGODB_DB=db_monitor

# Notifications (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TEAMS_WEBHOOK_URL=

# AI Analysis (Layer 2)
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

### 2. Build and Run

```bash
# Build images
docker build -t 19longdt/ai-automation-mssql:v1.0.0 .

# Start all services
docker compose up -d

# Verify health
docker compose ps
curl http://localhost:8000/health  # Layer 2
```

### 3. Test Layer 1 (Monitoring)

```bash
# View logs
docker compose logs -f layer1

# Monitoring runs automatically based on MongoDB config
```

### 4. Test Layer 2 (AI Analysis)

```bash
# Telegram bot: send /analyze command to bot
# Or curl:
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"finding_type": "high_cpu"}'

# Check DB context
curl http://localhost:8000/admin/db-context
```

---

## 📁 Project Structure

```
AI-Automation-MSSQL/
├── layer1/                           # Python monitoring service
│   ├── __main__.py                  # Entry: python -m layer1
│   ├── scheduler.py                 # APScheduler + topic runner
│   ├── config.py                    # EnvSettings
│   ├── executor/                    # SQL executor + node role cache
│   ├── detectors/                   # Detector registry
│   ├── storage/                     # MongoDB repositories
│   ├── notifications/               # Telegram/Teams channels
│   ├── ai/                          # Claude API integration
│   └── CLAUDE.md
│
├── layer2/                           # FastAPI + Claude AI
│   ├── main.py                      # FastAPI app
│   ├── routers/                     # API endpoints
│   ├── service/                     # Business logic
│   ├── db_business_context.yaml     # Database schema reference
│   ├── AGENT_MECHANISM.md           # AI agent architecture
│   ├── CLAUDE.md
│   └── requirements.txt
│
├── db-context/                       # Database schema docs
│   ├── SUMMARY.md                   # Quick reference
│   ├── ag-typology.md
│   ├── cdc-table.md
│   ├── index.md
│   ├── resource-governer.md
│   └── row-count.md
│
├── docs/                             # Documentation
│   ├── 01-overview.md
│   ├── 02-architecture.md
│   ├── 03-project-structure.md
│   ├── 04-data-flow.md
│   ├── 05-database.md
│   ├── 06-configuration.md
│   ├── 07-deployment.md
│   └── 08-local-development.md
│
├── plan/                             # Roadmap
│   ├── bubbly-snuggling-brooks.md
│   └── layer2-agent.md
│
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── CLAUDE.md
```

---

## 🔧 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MSSQL_NODES` | Comma-separated SQL Server IPs | `10.10.1.1,10.10.1.2,10.10.1.3` |
| `MSSQL_DATABASE` | Database name | `easyposbackoffice` |
| `MSSQL_USERNAME` | SQL login | `sa_monitor` |
| `MSSQL_PASSWORD` | SQL password | `YourPassword` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://mongodb:27017` |
| `MONGODB_DB` | MongoDB database name | `db_monitor` |
| `NODE_ROLE_REFRESH_SEC` | AG role cache refresh interval (sec) | `3600` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (optional) | `123456:ABC...` |
| `TELEGRAM_CHAT_ID` | Telegram chat ID (optional) | `1234567890` |
| `TEAMS_WEBHOOK_URL` | Teams webhook (optional) | `https://outlook.webhook...` |
| `CLAUDE_API_KEY` | Claude API key (for Layer 2) | `sk-ant-...` |
| `CLAUDE_MODEL` | Claude model (for Layer 2) | `claude-sonnet-4-6` |

---

## 📊 Monitoring Checks (Layer 1)

Configured in MongoDB `monitor_topics` (queries + detectors):
- CPU utilization per pool (Resource Governor)
- Memory usage + TempDB version store
- Disk I/O latency
- Blocking/deadlock chains
- Replication lag (AG secondary)
- CDC lag (Debezium heartbeat)
- Missing indexes (from plan cache)
- SQL Agent job health

Each check runs on configurable schedule per node (PRIMARY/SECONDARY/ALL).

---

## 🤖 AI Analysis (Layer 2)

Send raw metrics + findings → Claude analyzes:
- Root cause detection
- Performance impact estimation
- Remediation steps
- Risk assessment

Response format:
```json
{
  "finding_id": "blocking_20260421_001",
  "severity": "critical",
  "analysis": "Blocking chain detected: tx#5 waiting on tx#3. Root cause: missing index on batch_id...",
  "recommendations": [
    "Create index idx_batch_id on table X",
    "Review query plan Y"
  ]
}
```

---

## 📚 Documentation

- [01-overview.md](docs/01-overview.md) — System overview
- [02-architecture.md](docs/02-architecture.md) — Detailed architecture
- [03-project-structure.md](docs/03-project-structure.md) — File structure
- [04-data-flow.md](docs/04-data-flow.md) — Message flow + events
- [05-database.md](docs/05-database.md) — Database schema + partition design
- [06-configuration.md](docs/06-configuration.md) — Configuration guide
- [07-deployment.md](docs/07-deployment.md) — Docker deployment
- [08-local-development.md](docs/08-local-development.md) — Dev setup

---

## 🔐 Security

- SQL login (`sa_monitor`) created with minimal permissions (SELECT on DMVs only)
- MongoDB credentials in `.env` (not in image)
- Claude API key stored securely (GitHub Actions secrets)
- No sensitive data in logs

---

## 📝 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Config-driven** (MongoDB) | Thêm/sửa query không cần redeploy Layer 1 |
| **Node role auto-detect** | AG failover transparent, không hardcode |
| **Standalone single instance** | Đơn giản, không cần leader election |
| **Day-of-week baseline** | Workload pattern khác nhau theo ngày |
| **Detector registry** | Plugin architecture — thêm detector = 1 class |
| **AVOID `OPTION(OPTIMIZE FOR UNKNOWN)`** | Gây CPU overload (documented in detectors) |

---

## 🐛 Troubleshooting

### Layer 1 not connecting to MSSQL
```bash
# Check connection string
docker compose exec layer1 python -c "from config import settings; print(settings.mssql_connection_string())"

# Test connection
docker compose logs layer1 | grep -i connection
```

### Layer 2 API returns 500
```bash
docker compose logs layer2
# Check Claude API key
docker compose exec layer2 echo $CLAUDE_API_KEY
```

### Telegram bot not receiving alerts
```bash
# Verify webhook is configured
curl http://localhost:8000/admin/webhook-status
# Check logs
docker compose logs layer2
```

---

## 📞 Support & Contribution

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn

Questions? Check `/docs` folder or contact author.

---

## 📄 License

Internal project — Soft Dreams company.
