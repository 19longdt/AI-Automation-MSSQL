# Database

Tat ca du lieu runtime duoc luu tren MongoDB. Tai lieu nay da dong bo theo ten collection, index va TTL thuc te trong ma nguon.

## 1. Collections hien tai

### Layer 1

- `monitor_topics`
- `node_roles`
- `raw_metrics`
- `findings`
- `finding_diagnostics`
- `capture_tool_defs`
- `baselines`
- `dedup_cache`
- `job_executions`

### Layer 2

- `ai_analyses`
- `issue_insights`
- `db_context`
- `analysis_sessions`

### Layer 3

Layer 3 khong tao collection rieng. No doc:

- `findings`
- `finding_diagnostics`
- `ai_analyses`
- `issue_insights`
- `monitor_topics`
- `job_executions`

## 2. TTL thuc te

TTL duoc lay tu `layer1/storage/indexes.py` va `layer2/storage/indexes.py`.

| Collection | TTL thuc te |
|---|---|
| `raw_metrics` | 3 ngay |
| `findings` | 9 ngay |
| `finding_diagnostics` | 9 ngay |
| `dedup_cache` | 7 ngay |
| `job_executions` | 3 ngay |
| `ai_analyses` | 90 ngay |
| `analysis_sessions` | 8 gio |
| `monitor_topics` | khong TTL |
| `node_roles` | khong TTL |
| `capture_tool_defs` | khong TTL |
| `baselines` | khong TTL |
| `issue_insights` | khong TTL |
| `db_context` | khong TTL |

Luu y: bo docs cu mo ta TTL 30/90 ngay cho Layer 1 la khong con dung voi ma nguon hien tai.

## 3. Collection chi tiet

### `monitor_topics`

Source of truth cho monitoring config.

Noi dung chinh:

- `topic_id`
- `display_name`
- `enabled`
- `schedule_sec`
- `nodes`
- `queries`
- `detector_type`
- `thresholds`
- `baseline_config`
- `capture_tools`
- `extra`

Index:

- unique `topic_id`
- index `enabled`

### `raw_metrics`

Chua raw result cua cac query monitoring.

Truong chinh:

- `topic_id`
- `query_id`
- `node`
- `role`
- `collected_at`
- `rows`
- `row_count`
- `duration_ms`

Index:

- `(topic_id, query_id, collected_at desc)`
- `(node, collected_at desc)`
- TTL tren `collected_at`

### `findings`

Ket qua detector sau khi phan tich raw metrics.

Truong thuong gap:

- `finding_id`
- `detected_at`
- `topic_id`
- `issue_type`
- `severity`
- `node`
- `role`
- `metrics`
- `query_hash`
- `finding_hash`
- `status`
- `alert_status`

Index:

- `(issue_type, detected_at desc)`
- `(topic_id, detected_at desc)`
- `(status, severity)`
- `(query_hash, detected_at desc)` sparse
- `(finding_hash, detected_at desc)` sparse
- `(alert_status, detected_at desc)`
- TTL tren `detected_at`

### `finding_diagnostics`

Snapshot diagnostic cho finding critical.

Truong chinh:

- `finding_id`
- `topic_id`
- `captured_at`
- `duration_ms`
- `tools_captured`
- `tools_failed`
- `results`

Index:

- unique `finding_id`
- `(topic_id, captured_at desc)`
- TTL tren `captured_at`

### `capture_tool_defs`

Danh sach tool capture duoc seed boi `python -m layer1.seed.seed_capture_tools`.

Loai execution hien tai:

- `sql`
- `static`
- `mongo`

Index:

- unique `tool_id`
- `enabled`
- `phase`

### `baselines`

Du lieu baseline theo `metric_type`, `day_of_week`, `hour`, `node`, `query_hash`.

Index:

- unique compound `(metric_type, day_of_week, hour, node, query_hash)` sparse

### `dedup_cache`

Dung de suppress alert lap lai.

Truong chinh:

- `finding_hash`
- `last_alerted_at`

Index:

- unique `finding_hash`
- TTL tren `last_alerted_at`

### `job_executions`

Tracking moi lan job chay.

Truong chinh:

- `job_name`
- `started_at`
- `finished_at`
- `duration_ms`
- `status`
- `records_processed`
- `findings_created`
- `error_message`

Index:

- `(job_name, started_at desc)`
- `(status, started_at)`
- TTL tren `started_at`

### `ai_analyses`

Ket qua AI analysis cua Layer 2.

Truong chinh:

- `analysis_id`
- `finding_id`
- `skill_id`
- `status`
- `analysis_text`
- `tool_calls`
- `input_tokens`
- `output_tokens`
- `cost_usd`
- `started_at`
- `total_duration_ms`

Index:

- `(finding_id, started_at desc)`
- `(skill_id, started_at desc)`
- `(status, started_at desc)`
- TTL tren `started_at`

### `issue_insights`

Structured insight rut trich tu ket qua AI.

Index:

- `(root_cause_category, detected_at desc)`
- `(affected_tables, detected_at desc)`
- `(systemic, detected_at desc)`
- `(actions.resolved, actions.priority)`
- `(recurrence_count desc)`
- `(issue_type, detected_at desc)`

### `db_context`

Context nghiep vu va schema tong hop cho Layer 2.

Index:

- unique `context_id`

### `analysis_sessions`

Trang thai hoi dap Telegram multi-turn.

Index:

- `telegram_message_id` sparse
- `finding_id`
- `(status, last_activity_at desc)`
- TTL tren `last_activity_at`

## 4. Seed du lieu

### Topic seed

Lenh:

```bash
python -m layer1.seed.seed_topics
```

Seed hien tai tao 14 topic:

- `ag_health`
- `blocking`
- `blocked_query`
- `slow_sessions`
- `plan_regression`
- `plan_instability`
- `index_usage`
- `high_variation`
- `tempdb_memory`
- `wait_stats`
- `agent_maintenance`
- `missing_index`
- `resource_governor`
- `index_fragmentation`

### Capture tool seed

Lenh:

```bash
python -m layer1.seed.seed_capture_tools
```

Seed hien tai tao 18 capture tools.

## 5. Luu y cho dashboard

Layer 3 services dang map collection nhu sau:

- `findings` -> findings list
- `finding_diagnostics` -> diagnostics
- `ai_analyses` -> analyses
- `issue_insights` -> insights
- `monitor_topics` -> topics
- `job_executions` -> jobs health
