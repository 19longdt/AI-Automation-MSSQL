# Data Flow

Tai lieu nay mo ta luong du lieu thuc te giua 3 layer theo ma nguon hien tai.

## 1. Monitoring -> Finding -> Alert

```text
APScheduler trigger
    -> TopicRunner.run(topic_id)
    -> TopicRepo.find_by_id(topic_id)
    -> NodeRoleCache.resolve(nodes)
    -> QueryExecutor.execute(...) tren tung node
    -> RawMetricsRepo.insert_many(...)
    -> DetectorRegistry.get(detector_type)
    -> FindingsRepo.insert(...)
    -> DedupRepo.check_and_set(...)
    -> NotificationDispatcher.dispatch(...)
```

### Dien giai

1. Scheduler kich hoat mot topic
2. Layer 1 reload topic config tu MongoDB
3. Resolve node targets theo role hien tai
4. Query MSSQL song song tren cac node
5. Luu ket qua vao `raw_metrics`
6. Detector sinh `findings`
7. Neu finding du dieu kien thi gui alert

## 2. Critical Finding -> Diagnostic Capture

Neu finding co `severity == CRITICAL` va topic co `capture_tools`, Layer 1 chay them `DiagnosticCapture`.

```text
Finding critical
    -> Phase 1: SQL capture tools
    -> Phase 2: static analysis tools
    -> Phase 3: table-specific SQL tools
    -> Phase 4: MongoDB context tools
    -> save finding_diagnostics
```

### 4 phase hien tai

- Phase 1: SQL snapshot, vi du `get_wait_stats`, `get_blocking_chain`, `get_query_stats`
- Phase 2: static analysis, vi du `get_plan_analysis`, `get_query_structure`
- Phase 3: table-specific tools, vi du `get_index_usage`, `get_statistics_info`
- Phase 4: Mongo tools, vi du `get_table_context`, `get_recent_findings`, `get_analysis_history`

## 3. Telegram alert -> Layer 1 actions

Layer 1 co Telegram bot cho operational command nhanh.

### Cac nhanh chinh

- Reply `/quick` vao alert
  - Layer 1 dung model Haiku de phan tich nhanh
- Reply action command duoc registry ho tro
  - vi du `kill-session`
- Reply text thuong vao alert
  - Layer 1 forward sang Layer 2 de phan tich sau

## 4. Layer 1 -> Layer 2 AI analysis

```text
Layer 1 / user
    -> POST /api/v1/analyze
    -> AgentOrchestrator.run(...)
    -> load finding + diagnostics + db_context
    -> chon skill theo issue_type
    -> tool loop neu can
    -> save ai_analyses
    -> upsert issue_insights
```

### Request chinh

```json
{
  "finding_id": "....",
  "channel": "telegram",
  "telegram_chat_id": "123456",
  "requested_by": "user"
}
```

## 4b. Multi-turn Telegram session (Layer 2)

Sau khi Layer 2 gui ket qua analysis, DBA co the reply tiep de hoi them.

```text
Layer 2 gui analysis document -> Telegram
    -> luu sent_msg_id + session (analysis_sessions, TTL 8h)

DBA reply vao document
    -> Layer 2 bot phat hien replied_to_id
    -> SessionRepo.find(chat_id + ":" + replied_to_id)
    |
    |-- Session ton tai:
    |       append user turn -> AgentOrchestrator.run(is_follow_up=True)
    |           -> skip required_tools enforcement (Q&A mode)
    |           -> Claude co the dung them tools neu can
    |       -> gui response, update session turns
    |
    `-- Session het han / khong tim thay:
            fallback: parse finding_id tu Layer 1 alert text
            neu tim duoc -> fresh analysis moi
            neu khong -> reply "Session expired"
```

Ghi chu:
- Session TTL 8 gio tinh tu `last_activity_at`
- `is_follow_up=True` bao gom toan bo conversation history
- Orchestrator khong tao/update session, chi TelegramBot quan ly

## 5. Plan XML flow

### Layer 3 -> Layer 2

```text
Browser
    -> POST /api/plan/analyze (Layer 3)
    -> proxy toi POST /api/v1/plan/analyze (Layer 2)
    -> PlanAnalysisPipeline
    -> ket qua tra ve UI
```

### Layer 1 -> Layer 2

Layer 1 cung co the dung plan analysis engine de luu ket qua compact vao `finding_diagnostics`.

```text
Layer 1
    -> POST /api/v1/plan/analyze { source: "layer1" }
    -> Layer 2 tra ve ToolSnapshot
```

### Statement text truncation enrichment

SQL Server gioi han `StatementText` attribute trong XML plan ~4000 ky tu.
Layer 2 tu dong enrich sau khi parse neu phat hien bi cat:

```text
Parse XML xong
    -> phat hien statement_text_truncated=True va co query_hash
    -> query primary node (NodeRoleCache.get_primary_host())
    -> thu Query Store: sys.query_store_query_text (khong bi 4000 char limit)
    -> fallback: sys.dm_exec_query_stats + dm_exec_sql_text (statement_start/end_offset)
    -> cap nhat statement_text + truncated=False
    (silent fail neu DB khong co san, timeout 5s)
```

## 6. Dashboard flow

### Findings dashboard

```text
Browser
    -> GET /api/findings
    -> GET /api/topics
    -> GET /api/jobs/health
    -> GET /api/analyses
    -> render dashboard
```

### Insights page

```text
Browser
    -> GET /api/insights
    -> GET /api/insights/summary
    -> render insights
```

### Finding diagnostics view

Layer 3 co route:

- `GET /api/findings/:id/diagnostics`

Route nay doc tu collection `finding_diagnostics`.

## 7. Kill session flow

```text
Browser
    -> POST /api/actions/kill-session (Layer 3)
    -> forward toi Layer 1 /kill-session
    -> SessionService.kill_session(...)
    -> tra ket qua lai cho UI
```

Luu y:

- Luong nay can Layer 1 dang chay HTTP API qua `python -m layer1.main`
- Compose mac dinh hien tai chi chay `layer1.scheduler`, nen action flow chua san sang neu khong co override runtime

### Payload Layer 3 gui sang Layer 1

```json
{
  "type": "action",
  "action_name": "kill-session",
  "session_id": 123,
  "node": "SQL-NODE-01"
}
```

## 8. Health flow

### Layer 1

- `GET /health`
- Tra ve `scheduler_alive` va `scheduler_error`

### Layer 2

- `GET /health`
- Ping MongoDB va test ket noi tung MSSQL node

### Layer 3

- `GET /health`
- Kiem tra MongoDB readiness va Layer 2 reachability
