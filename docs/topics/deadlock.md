# Topic: Deadlock Monitor

**topic_id**: `deadlock` | **Schedule**: 300s (5 phút) | **Nodes**: `all` | **Detector**: `blocking_chain`

**Related topics**:
- [`blocking`](blocking.md) — blocking chain real-time, head-blocker-centric (60s)
- [`slow_sessions`](slow_sessions.md) — slow query với blocking context inline (300s)

---

## 1. Bối cảnh

Deadlock xảy ra khi session A chờ lock mà B đang giữ, đồng thời B chờ lock mà A đang giữ — vòng tròn phụ thuộc không tự giải quyết được. SQL Server phát hiện vòng tròn, chọn victim (thường session cost thấp hơn), rollback transaction của victim và trả lỗi `1205: Transaction was deadlocked`.

**Deadlock khác blocking:**
- Blocking: chờ đơn chiều, giải quyết khi head blocker release
- Deadlock: chờ vòng tròn, SQL Server phải can thiệp — transaction đã bị rollback trước khi detect

**Nguồn data:** `sys.dm_xe_session_targets` của session `system_health` — XEvent ring buffer (~4MB) tự động capture mọi deadlock, lưu 24h gần nhất. Không cần setup XEvent session thủ công.

**Tại sao không dùng real-time 60s?**
Deadlock đã xảy ra rồi khi detect — không có giá trị check nhanh. `CAST(ring_buffer AS XML)` + XQuery parse nặng, 300s là hợp lý.

---

## 2. Mục tiêu phát hiện

| # | Mục tiêu | Điều kiện |
|---|---|---|
| D1 | **Mỗi deadlock event mới** → 1 CRITICAL finding | `deadlock_time` trong lookback window (mặc định 10 phút) |
| D2 | **Không bỏ sót event giữa 2 lần check** | Lookback = `max(schedule_sec × 2, 600s)` = 600s |

Không có thresholds — deadlock đã xảy ra (transaction rolled back) nên luôn là CRITICAL.

---

## 3. Query `deadlock_events`

Đọc từ XEvent ring buffer của session `system_health`, extract deadlock events 24h gần nhất bằng XQuery:

```sql
SELECT TOP 20
    xdr.value('@timestamp', 'datetime2')    AS deadlock_time,
    xdr.value('(//deadlock/process-list/process/@id)[1]', ...)  AS victim_id,
    xdr.value('(//deadlock/process-list/process/inputbuf)[1]', ...) AS victim_query
FROM ...
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xr(xdr)
WHERE xdr.value('@timestamp', 'datetime2') > DATEADD(HOUR, -24, GETUTCDATE())
ORDER BY deadlock_time DESC
```

| Field | Ý nghĩa |
|---|---|
| `deadlock_time` | Thời điểm deadlock xảy ra (UTC) |
| `victim_id` | Process ID của victim trong deadlock graph |
| `victim_query` | SQL của victim (full text — không truncate để AI phân tích chính xác) |

> **Lưu ý:** Query chỉ extract victim đầu tiên trong graph. Deadlock phức tạp (3+ participants) cần xem full XML qua diagnostics.

---

## 4. Dedup per Event

Mỗi lần chạy query trả toàn bộ 24h → sẽ thấy lại events cũ. Detector chỉ tạo finding cho event **mới** (trong lookback window):

```
lookback_sec = max(schedule_sec × 2, 600)  # 600s
cutoff = utc_now() - lookback_sec
→ Chỉ xử lý row có deadlock_time > cutoff
```

`query_hash` = `MD5(deadlock_time.isoformat() + "|" + victim_query)` — dedup per-event, không suppress event mới cùng query.

**Trade-off chấp nhận:** Nếu service down > 10 phút → miss alert cho event cũ. Deadlock đã resolved nên miss alert là acceptable.

---

## 5. Metrics trong Finding

| Metric | Ý nghĩa |
|---|---|
| `deadlock_time` | ISO string (UTC) |
| `victim_id` | Process ID từ deadlock graph XML |
| `victim_query` | SQL của victim — full text, không truncate |

Không có chain metrics (`chain_depth`, `blocked_sessions`) — deadlock không phải blocking chain.

---

## 6. Flow 3 Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Auto monitoring (mỗi 300s)                            │
│                                                                  │
│  1. Resolve nodes: ["all"] → [PRIMARY, SEC-1, SEC-2]            │
│                                                                  │
│  2. Execute: deadlock_events (24h window, CAST ring_buffer XML)  │
│                                                                  │
│  3. BlockingChainDetector._detect_deadlocks()                   │
│     ├── Filter: deadlock_time > (now - 600s)                    │
│     ├── 1 Finding(CRITICAL) per new event                       │
│     └── query_hash = MD5(time + query) → dedup per-event        │
│                                                                  │
│  4. Severity = CRITICAL → capture_tools:                        │
│     ├── get_recent_findings  (recurrence: cùng query deadlock?) │
│     └── get_analysis_history (AI context từ lần trước)          │
│                                                                  │
│  5. Dedup (30 phút) → Telegram alert CRITICAL                   │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ DBA reply alert hoặc /analyze
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — On-demand AI analysis                                 │
│                                                                  │
│  issue_type: deadlock                                           │
│  Phân tích victim_query → đề xuất:                              │
│  ├── Consistent access order (tránh vòng tròn)                  │
│  ├── Index để giảm lock scope                                   │
│  └── READ COMMITTED SNAPSHOT / optimistic locking              │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼ GET /api/findings?topic=deadlock
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Dashboard                                             │
│                                                                  │
│  Layout key: "default"                                          │
│  (không có layout riêng — deadlock findings ít, default đủ)    │
│                                                                  │
│  Row click → JSON detail modal (renderTabbedFindingModal):      │
│  ├── finding fields + metrics (deadlock_time, victim_query)     │
│  └── Diagnostics tab nếu captured                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Quyết định thiết kế & Constraints

| Quyết định | Lý do |
|---|---|
| **Tách khỏi topic `blocking`** | Data source khác (XEvent vs DMV real-time), schedule khác (300s vs 60s), parse nặng hơn |
| **Detector = `blocking_chain`** | Dùng chung class `BlockingChainDetector`, route theo `query_id = "deadlock_events"`. Không tạo class riêng |
| **Luôn CRITICAL, không có threshold** | Deadlock là sự cố đã xảy ra — transaction victim đã bị rollback. Không có mức "warning deadlock" |
| **Lookback = max(schedule×2, 600s)** | schedule × 2 để an toàn khi job bị delay. Floor 600s đảm bảo không miss nếu APScheduler jitter hoặc service restart |
| **`victim_query` full text, không truncate** | AI cần query đầy đủ để phân tích access order và đề xuất fix chính xác |
| **Layout "default"** | Deadlock findings ít và thường CRITICAL — default modal đủ context. Không đáng tạo layout riêng |
| **`get_recent_findings` trong capture_tools** | Quan trọng nhất cho deadlock: "query này đã deadlock lần nào chưa?" → phân loại recurrent vs one-off |

**Constraints không được vi phạm:**
- `OPTION(OPTIMIZE FOR UNKNOWN)` — không bao giờ gợi ý
- Không dùng `deadlock_time` raw làm dedup key — nhiều deadlock cùng giây sẽ collide

---

## 8. Files liên quan

| Layer | File | Vai trò |
|---|---|---|
| L1 Config | `layer1/seed/seed_topics.py` → `_deadlock()` | Topic config: query XEvent, capture_tools |
| L1 Detector | `layer1/detectors/blocking_detector.py` → `_detect_deadlocks()` | Lookback filter + 1 finding per new event |
| L1 Constants | `layer1/models/topic_constants.py` → `TOPIC_DEADLOCK` | topic_id constant |
| L3 Routing | `layer3/apps/web/dashboard/dashboard.ts` → `layoutKeyForTopic()` | Map `"deadlock"` → layout `"default"` |
