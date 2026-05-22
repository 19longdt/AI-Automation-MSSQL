# Layer 2 — Framework: Bộ khung thiết kế Monitoring Analysis

Ngày: 2026-04-22
Tác giả: Long Do + Claude Opus 4.6

---

## 1. Tổng quan

Layer 1 phát hiện **20 issue_types** qua 14 monitoring topics.
Layer 2 phân tích on-demand khi DBA yêu cầu.

Mỗi issue_type thuộc 1 trong **4 category** — mỗi category có pattern phân tích, tools, pre-processing, và cost profile khác nhau.

---

## 2. Bốn Category phân tích

### Category A: Query-centric (cần query text + execution plan)

| Đặc điểm | Mô tả |
|-----------|-------|
| **Finding chứa** | query_hash, query_text, query_plan_xml, metrics (elapsed, reads, spills) |
| **Mục tiêu** | Tìm root cause tại sao query chậm/không ổn định, đề xuất fix cụ thể |
| **Pre-processing** | `get_plan_analysis` (parse XML), `get_query_structure` (parse SQL) |
| **Tools chính** | get_query_stats, get_query_store_history, get_statistics_info |
| **Tools phụ** | get_index_usage, get_missing_indexes, get_wait_stats, get_memory_grant |
| **Model** | Sonnet (cần reasoning phức tạp: correlate plan + stats + history) |
| **Rounds** | 4-6 (nhiều bước: parse → DMV → correlate → conclude) |
| **Budget** | $0.10-0.20 |

**Issue types trong category**:
- `slow_sessions`, `high_variation_query`
- `plan_regression`, `plan_instability`
- `non_optimal_index`, `partition_elimination_failure`

**Vì sao cần pre-processing**: XML plan 20KB = ~6000 tokens. Claude không cần đọc raw XML — chỉ cần structured summary (operators, warnings, partition info). Tiết kiệm 85% tokens.

**Pattern phân tích chung**:
```
1. get_plan_analysis(finding_id)       → hiểu plan structure
2. get_query_structure(finding_id)     → hiểu query structure  
3. get_table_context(tables liên quan) → schema + index context
4. get_query_stats / get_query_store_history → execution history
5. get_statistics_info → statistics freshness
6. (tuỳ data) get_wait_stats, get_memory_grant, get_index_usage
7. Kết luận + <insight>
```

---

### Category B: Infrastructure/State (DMV metrics, không cần query)

| Đặc điểm | Mô tả |
|-----------|-------|
| **Finding chứa** | node, metrics (PLE, queue_size, version_store_mb, cpu_pct, ...) |
| **Mục tiêu** | Đánh giá mức độ nghiêm trọng, tìm nguồn gốc, đề xuất action |
| **Pre-processing** | Không cần (metrics đã là structured data) |
| **Tools chính** | Tuỳ sub-type: get_memory_pressure, get_ag_status, get_cdc_status, get_resource_governor_stats, get_tempdb_usage |
| **Tools phụ** | get_wait_stats (luôn hữu ích), get_query_stats (tìm query gây áp lực) |
| **Model** | Haiku (pattern phân tích rõ ràng, ít ambiguity) |
| **Rounds** | 2-3 (thu thập DMV → correlate → conclude) |
| **Budget** | $0.02-0.05 |

**Issue types trong category**:
- `memory_pressure`
- `tempdb_pressure`
- `ag_lag`
- `cdc_failure`
- `resource_pool_spike`
- `wait_anomaly`

**Vì sao KHÔNG cần pre-processing**: Finding chỉ có metrics dạng `{"ple_sec": 80}` — đã là structured, nhỏ. Không có XML hay SQL text lớn.

**Pattern phân tích chung**:
```
1. Tool chuyên biệt (get_memory_pressure / get_ag_status / ...)  → snapshot hiện tại
2. get_wait_stats → correlate với wait types
3. (tuỳ data) get_query_stats → query nào gây áp lực?
4. get_analysis_history → recurring?
5. Kết luận + <insight>
```

**Sub-patterns cụ thể**:

| Issue type | Tool chính | Focus phân tích |
|------------|-----------|-----------------|
| memory_pressure | get_memory_pressure | PLE, buffer pool, grants pending → source: large scan? memory leak? RG cap? |
| tempdb_pressure | get_tempdb_usage | version_store vs internal vs user → source: CDC? spills? temp tables? |
| ag_lag | get_ag_status | send_queue vs redo_queue → source: network? Secondary I/O? DML spike? |
| cdc_failure | get_cdc_status | capture vs cleanup job → source: log scan error? retention lag? version store? |
| resource_pool_spike | get_resource_governor_stats | which pool? queued? → source: wrong classification? maintenance in peak? |
| wait_anomaly | get_wait_stats | which category? → route to appropriate analysis (I/O, lock, memory, CPU) |

---

### Category C: Session/Lock (cần real-time blocking/deadlock data)

| Đặc điểm | Mô tả |
|-----------|-------|
| **Finding chứa** | metrics (blocking_chain_depth, wait_time, session_ids), có thể có deadlock_graph XML |
| **Mục tiêu** | Xác định head blocker, victim, lock type, đề xuất giải quyết |
| **Pre-processing** | Deadlock: parse deadlock_graph XML (tương tự get_plan_analysis). Blocking: không cần |
| **Tools chính** | get_blocking_chain, get_wait_stats |
| **Tools phụ** | get_query_stats (query của head blocker), get_recent_findings (recurring?) |
| **Model** | Sonnet (blocking chain reasoning phức tạp, deadlock graph analysis) |
| **Rounds** | 3-4 |
| **Budget** | $0.08-0.15 |

**Issue types trong category**:
- `blocking_chain`
- `blocked_query_snapshot`, `blocked_query_trend`
- `deadlock`

**Pattern phân tích chung**:
```
1. get_blocking_chain → real-time blocking state
2. get_wait_stats → LCK_M_* wait types confirm blocking
3. get_query_stats(head_blocker_query) → context of blocking query
4. get_analysis_history → recurring pattern?
5. Kết luận + <insight>
```

**Pre-processing cho deadlock** (Phase 2+):
- `get_deadlock_analysis(finding_id)` — parse deadlock_graph XML
- Extract: processes, resources, lock modes, victim, cycle
- Tương tự get_plan_analysis nhưng cho deadlock XML schema

---

### Category D: Maintenance (job/backup/DBCC status)

| Đặc điểm | Mô tả |
|-----------|-------|
| **Finding chứa** | metrics (job_name, error_message, last_backup_age, dbcc_last_run) |
| **Mục tiêu** | Đánh giá rủi ro, đề xuất remediation, check schedule |
| **Pre-processing** | Không cần |
| **Tools chính** | Không có tool bắt buộc — thông tin đủ trong finding |
| **Tools phụ** | get_recent_findings (recurring failures?) |
| **Model** | Haiku (pattern-based, straightforward) |
| **Rounds** | 1-2 (metrics đủ thông tin, ít cần query thêm) |
| **Budget** | $0.01-0.03 |

**Issue types trong category**:
- `job_failure`
- `backup_gap`
- `dbcc_overdue`
- `index_fragmentation` (borderline Category B, nhưng action-oriented hơn analysis)
- `missing_index` (borderline Category A, nhưng DMV recommendation đã có sẵn)

**Pattern phân tích chung**:
```
1. Đọc metrics trong finding → đánh giá severity
2. (optional) get_recent_findings → recurring?
3. Kết luận dựa trên maintenance schedule + best practices
4. <insight>
```

---

## 3. Mapping đầy đủ: Issue Type → Category → Skill

| Issue Type | Category | Skill YAML | Status |
|------------|----------|------------|--------|
| slow_sessions | A: Query | slow_sessions.yaml | ✅ Implemented |
| high_variation_query | A: Query | slow_sessions.yaml | ✅ Implemented |
| plan_regression | A: Query | plan_xml.yaml | ✅ Implemented |
| plan_instability | A: Query | plan_xml.yaml | ✅ Implemented |
| non_optimal_index | A: Query | plan_xml.yaml | ✅ Implemented |
| partition_elimination_failure | A: Query | plan_xml.yaml | ✅ Implemented |
| memory_pressure | B: Infra | memory.yaml | TODO |
| tempdb_pressure | B: Infra | tempdb.yaml | TODO |
| ag_lag | B: Infra | ag.yaml | ✅ Implemented |
| cdc_failure | B: Infra | cdc.yaml | TODO |
| resource_pool_spike | B: Infra | resource.yaml | TODO |
| wait_anomaly | B: Infra | wait.yaml | TODO |
| blocking_chain | C: Lock | blocking.yaml | ✅ Implemented |
| blocked_query_snapshot | C: Lock | blocking.yaml | ✅ Implemented |
| blocked_query_trend | C: Lock | blocking.yaml | ✅ Implemented |
| deadlock | C: Lock | deadlock.yaml | ✅ Implemented |
| job_failure | D: Maint | maintenance.yaml | TODO |
| backup_gap | D: Maint | maintenance.yaml | TODO |
| dbcc_overdue | D: Maint | maintenance.yaml | TODO |
| index_fragmentation | A/D | index.yaml | ✅ Implemented |
| missing_index | A/D | index.yaml | ✅ Implemented |

---

## 4. Pre-processing Tools theo Category

| Tool | Category | Input | Output | Khi nào cần |
|------|----------|-------|--------|-------------|
| `get_plan_analysis` | A | query_plan_xml từ finding | Structured operators, warnings, partition info | Mọi query-centric issue có plan XML |
| `get_query_structure` | A | query_text từ finding | Tables, joins, predicates, function-on-partition-key | Mọi query-centric issue có query text |
| `get_deadlock_analysis` | C | deadlock_graph XML từ finding | Processes, resources, lock modes, victim, cycle | Deadlock issues |
| `get_table_context` | A, B, C | table_name | db_context filtered cho 1 table | Khi cần hiểu schema/index của table cụ thể |
| `get_analysis_history` | A, B, C, D | finding_id / issue_type+node | Recurrence, previous root causes, resolved actions | Mọi issue — để biết recurring hay first-time |

**Category B + D: KHÔNG cần pre-processing đặc biệt** — finding metrics đã đủ structured.

---

## 5. Hướng dẫn thiết kế Skill YAML mới

### Bước 1: Xác định Category

Hỏi: Finding này chứa gì?
- Có query_plan_xml + query_text → **Category A**
- Chỉ có DMV metrics (PLE, queue_size, cpu_pct) → **Category B**
- Có blocking/deadlock data → **Category C**
- Là maintenance status → **Category D**

### Bước 2: Chọn Config mặc định theo Category

```yaml
# Category A: Query-centric
model: claude-sonnet-4-6
max_tool_rounds: 5
max_tokens: 4096
max_cost_usd: 0.15

# Category B: Infrastructure
model: claude-haiku-4-5-20251001
max_tool_rounds: 3
max_tokens: 2048
max_cost_usd: 0.05

# Category C: Session/Lock
model: claude-sonnet-4-6
max_tool_rounds: 4
max_tokens: 3000
max_cost_usd: 0.10

# Category D: Maintenance
model: claude-haiku-4-5-20251001
max_tool_rounds: 2
max_tokens: 1500
max_cost_usd: 0.03
```

### Bước 3: Viết Skill YAML

Template:
```yaml
skill_id: <name>_v1

issue_types:
  - <issue_type_1>
  - <issue_type_2>  # optional: nhóm issues có chung analysis pattern

specialization: |
  Focus: <1 câu mô tả vấn đề>.
  
  Phân tích theo thứ tự:
  1. <step 1> (<tool_name>)
     - <điều cần kiểm tra>
     - <phân biệt trường hợp A vs B>
  
  2. <step 2> (<tool_name>)
     - <correlate với data từ step 1>
  
  3. <step 3> (nếu cần)
     - <additional context>
  
  Hành động theo tình huống:
  - <scenario A> → <action>
  - <scenario B> → <action>

user_prompt_template: |
  Phân tích finding sau:
  
  Issue: {issue_type} | Severity: {severity}
  Node: {node} ({role}) | Detected: {detected_at}
  Finding ID: {finding_id}
  Metrics: {metrics_json}
  
  # Category A thêm:
  Query Hash: {query_hash}
  Dùng get_plan_analysis và get_query_structure để phân tích.
  
  # Category B/C/D:
  # (không cần thêm gì — metrics đủ)

required_tools:
  - <tool chính cho category này>

optional_tools:
  - get_table_context        # hầu như mọi skill nên có
  - get_analysis_history     # kiểm tra recurring
  - <tool phụ>

model: <theo category>
max_tool_rounds: <theo category>
max_tokens: <theo category>
max_cost_usd: <theo category>
include_fields: []           # Phase 2+: không inject raw data vào prompt
```

### Bước 4: Viết Specialization

**Quy tắc**:
- Liệt kê **thứ tự** tools cần gọi — Claude follow tốt hơn khi có sequence
- Mỗi tool step: nêu **điều cần kiểm tra** + **phân biệt scenario**
- Kết thúc bằng **decision matrix**: "Nếu X → action Y"
- Bao gồm **context hệ thống** relevant: peak hours, AG topology, CDC, RG pools
- Ngắn gọn — mỗi step 2-3 dòng, không viết essay

### Bước 5: Test

1. Trigger `/analyze <finding_id>` với finding của issue_type mới
2. Kiểm tra: Claude có gọi đúng tools không? Có gọi tool ngoài danh sách không?
3. Kiểm tra: Analysis text có chất lượng không? Có actionable recommendations?
4. Kiểm tra: `<insight>` block có xuất hiện không? JSON valid?
5. Kiểm tra: cost_usd có trong budget không?
6. Test edge case: finding có metrics rỗng, finding trên Secondary node

---

## 6. Checklist: Thêm 1 Monitor Type mới

### Layer 1 (Phát hiện)

- [ ] Thêm IssueType enum nếu chưa có (`models/common.py`)
- [ ] Tạo monitor_topic trong MongoDB (`seed/seed_topics.py`)
  - SQL query để detect vấn đề
  - Detector type (threshold / baseline / custom)
  - Thresholds (warning / critical)
  - Schedule interval
  - Node targets (primary / secondary / all)
- [ ] Implement detector nếu cần custom logic (`detectors/`)
- [ ] Test: topic chạy đúng schedule, finding được tạo, alert gửi đi

### Layer 2 (Phân tích)

- [ ] Xác định Category (A/B/C/D)
- [ ] Tạo skill YAML trong `skills/` — follow template theo category
- [ ] Nếu Category A: đảm bảo get_plan_analysis + get_query_structure hoạt động cho issue type này
- [ ] Nếu cần pre-processing mới: implement trong `executor/` + đăng ký tool
- [ ] Thêm tool mới vào `tool_registry.py` + `tool_executor.py` dispatch nếu cần
- [ ] Test `/analyze` end-to-end với finding thật
- [ ] Verify: tools được gọi đúng, insight xuất hiện, cost trong budget
- [ ] Deploy: build image mới, docker compose up

### Verification matrix

| Check | Method |
|-------|--------|
| Skill YAML valid | Service startup (fail-fast) |
| Tools đúng | Log: "Tool 'X' OK" trong analysis |
| Insight xuất hiện | GET /analyses/{id} → root_cause_summary có value |
| Cost trong budget | GET /analyses/{id} → cost_usd < max_cost_usd |
| Recurrence tracking | GET /insights → pattern match correct |
| Telegram output | Check chat — document + caption đúng format |

---

## 7. Cost Profile tổng hợp

| Category | Model | Avg Rounds | Avg Input Tokens | Avg Cost | % of total analyses |
|----------|-------|-----------|-----------------|----------|-------------------|
| A: Query | Sonnet | 4-5 | ~20K (sau optimization) | $0.09-0.15 | ~40% |
| B: Infra | Haiku | 2-3 | ~3K | $0.01-0.03 | ~30% |
| C: Lock | Sonnet | 3-4 | ~8K | $0.05-0.10 | ~15% |
| D: Maint | Haiku | 1-2 | ~2K | $0.005-0.02 | ~15% |

**Weighted average cost: ~$0.04-0.08 per analysis** (sau optimization Phase 1+2)

---

## 8. Tổng hợp: Plan kỹ thuật vs Framework này

| Aspect | PLAN_architecture_improvements.md | FRAMEWORK này |
|--------|----------------------------------|---------------|
| **Mục đích** | Cải tiến kỹ thuật: tool filtering, cost budget, pre-processing | Hướng dẫn thiết kế: khi thêm monitor mới, làm gì? |
| **Scope** | Phase 1-3 implementation cụ thể | Khái quát cho mọi issue type |
| **Audience** | Developer implement | DBA + Developer thiết kế monitor |
| **Dùng khi** | Implement cải tiến architecture | Thêm monitoring type mới |
| **Liên quan** | Plan dùng framework này làm nền | Framework tham chiếu plan cho chi tiết kỹ thuật |

**Thứ tự thực hiện**:
1. Implement Plan Phase 1 (quick wins) — áp dụng cho skills hiện tại
2. Implement Plan Phase 2 (pre-processing tools) — chủ yếu cho Category A
3. Dùng Framework này để implement TODO skills (memory, tempdb, cdc, resource, wait, maintenance)
4. Plan Phase 3 (tiered config) — enhance sau khi skills đã hoạt động

---

**Author:** Long Do + Claude Opus 4.6 | 2026-04-22
