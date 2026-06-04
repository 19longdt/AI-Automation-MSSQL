# Plan chi tiết — Layer 2: Maintenance History làm AI Context

> Plan tổng quan: [index-statistics-maintenance.md](./index-statistics-maintenance.md)
> Phạm vi: cho phép AI Agent (Layer 2) đọc dữ liệu maintenance làm context khi phân tích sự cố. Triển khai SAU khi Layer 1 chạy ổn định và `maintenance_history` đã có dữ liệu thật (ít nhất 1-2 tuần).

---

## 1. Mục tiêu

Khi DBA `/analyze` một finding (vd `index_fragmentation`, `slow_sessions`, `non_optimal_index`), agent cần trả lời được:
- "Index này lần cuối rebuild/reorganize khi nào? Kết quả frag before/after?"
- "Lần rebuild trước có giúp giảm fragmentation lâu dài không hay phân mảnh lại nhanh?" (recurrence pattern)
- "Item này có đang nằm trong queue chờ approve/chờ window không?" → tránh đề xuất trùng việc đã lên lịch
- "Stats của bảng này được update lần cuối khi nào, fullscan hay sample?"

## 2. Tool mới trong `layer2/agent/tool_registry.py`

Pattern hiện tại: `ToolDefinition(name, description, input_schema, block_in_peak_hours)` trong dict `TOOL_REGISTRY`, mô tả tiếng Việt không dấu, schema helper `_schema()`. Handler là method **cùng tên** trên `DiagnosticExecutor`.

### 2.1 `get_maintenance_history`
```python
"get_maintenance_history": ToolDefinition(
    name="get_maintenance_history",
    description=(
        "Lay lich su maintenance (REORGANIZE/REBUILD/UPDATE STATISTICS) tu maintenance_history MongoDB. "
        "Tra ve action, frag truoc/sau, duration, outcome cho tung object. "
        "Dung de biet index/stats da duoc xu ly khi nao va hieu qua ra sao."
    ),
    input_schema=_schema(
        {
            "table_name": _TABLE,                                   # optional
            "index_name": {"type": "string", "description": "Ten index de loc (optional)"},
            "action_type": {"type": "string", "description": "reorganize|rebuild|rebuild_partition|update_statistics|heap_rebuild (optional)"},
            "top_n": _TOP_N,
        },
        required=[],
    ),
),
```
**Mongo-only** → `block_in_peak_hours=False` (không chạm MSSQL, an toàn mọi giờ).

### 2.2 `get_maintenance_queue_status`
```python
"get_maintenance_queue_status": ToolDefinition(
    name="get_maintenance_queue_status",
    description=(
        "Kiem tra maintenance_queue: object co dang nam trong hang doi maintenance khong "
        "(awaiting_approval/approved/paused), uoc tinh khi nao chay. "
        "Dung de tranh de xuat rebuild/update stats cho object da duoc len lich."
    ),
    input_schema=_schema(
        {"table_name": _TABLE, "index_name": {"type": "string", "description": "Optional"}},
        required=["table_name"],
    ),
),
```

## 3. Handlers trong `layer2/executor/diagnostic_executor.py`

Pattern hiện tại: method cùng tên tool, trả `list[dict]`/`dict`, sanitize datetime bằng `_sanitize_datetimes_in_place`. Hai handler mới **chỉ đọc MongoDB** (như `get_recent_findings`, `get_analysis_history`):

```python
def get_maintenance_history(self, table_name: str | None = None, index_name: str | None = None,
                            action_type: str | None = None, top_n: int = 20) -> list[dict[str, Any]]:
    q: dict[str, Any] = {}
    if table_name:  q["table_name"] = table_name
    if index_name:  q["index_name"] = index_name
    if action_type: q["action_type"] = action_type
    docs = list(db["maintenance_history"].find(q, _PROJECTION)
                .sort("created_at", -1).limit(min(top_n, 50)))
    # projection: bỏ statement nếu quá dài? KHÔNG — statement là audit có giá trị, giữ nguyên
    ...

def get_maintenance_queue_status(self, table_name: str, index_name: str | None = None) -> dict[str, Any]:
    # find open items (status not in terminal) cho object + window config hiện tại
    # → {queued_items: [...], window: {start, end}, kill_switch: bool}
```

Lưu ý: collection name dùng chung constant với Layer 1 — hardcode string `"maintenance_history"`/`"maintenance_queue"` giống cách Layer 2 hiện đọc `findings` (2 codebase Python riêng biệt, không share import).

## 4. ContextBuilder — `layer2/agent/context_builder.py`

Bổ sung **tự động attach** maintenance context (không cần agent gọi tool) khi issue_type liên quan:

| issue_type của finding | Context attach |
|---|---|
| `index_fragmentation` | 5 history record gần nhất của các table trong finding + queue status |
| `non_optimal_index`, `missing_index` | history rebuild/reorganize gần nhất của table liên quan |
| `slow_sessions`, `plan_regression` | last `update_statistics` của các bảng trong query (estimate sai do stats cũ là nghi phạm số 1) |

Implement: thêm hàm `_get_maintenance_note(affected_tables) -> str | None` — compact text (~10 dòng max) như `_get_compact_infrastructure_note()` hiện có. Nếu collection chưa tồn tại/rỗng → return None, không lỗi.

## 5. Skill YAML — `layer2/skills/`

- `index_fragmentation.yaml` (đã có trong 13 skill): thêm vào `required_tools`/hướng dẫn: gọi `get_maintenance_history` trước khi đề xuất rebuild; nếu object đã queued → trả lời "đã được lên lịch, chờ window + approval" thay vì đề xuất chạy tay.
- `_base.yaml`: thêm 1 dòng mô tả 2 tool mới vào danh sách tool khả dụng.

## 6. Capture tools (Layer 1 DiagnosticCapture — optional, mở rộng)

`capture_tool_defs` (MongoDB, seed qua `layer1/seed/seed_capture_tools.py`) có thể thêm tool `mongo` type `get_maintenance_history` cho Phase 4 capture → `finding_diagnostics` của finding CRITICAL tự chứa maintenance history → Layer 2 phân tích offline không cần query thêm. Cần 1 MongoToolHandler mới trong `layer1/capture/handlers/` (`mongo_get_maintenance_history.py`) + register vào `mongo_registry.py`.

## 7. Thứ tự thực hiện

1. Handlers Mongo-only + ToolDefinition (2 tool) + unit test với mongomock
2. ContextBuilder `_get_maintenance_note` + test
3. Skill YAML updates
4. (Optional) capture tool handler Layer 1 + seed
5. E2E: tạo history giả → `/analyze` finding index_fragmentation → kiểm tra agent gọi tool và trích dẫn đúng frag before/after

## 8. Definition of Done (Layer 2)

- [ ] Agent trả lời được "lần rebuild gần nhất của bảng X" với số liệu thật từ `maintenance_history`
- [ ] Agent KHÔNG đề xuất rebuild thủ công cho object đang `approved` trong queue
- [ ] Khi collection maintenance rỗng/chưa seed → mọi flow `/analyze` hiện tại hoạt động như cũ (backward-compatible)
