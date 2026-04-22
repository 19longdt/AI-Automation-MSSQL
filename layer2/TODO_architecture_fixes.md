# Layer 2 — Architecture Fixes TODO

Ngày review: 2026-04-22
Reviewer: Claude Opus 4.6 + Long Do

---

## [ ] Fix B: Cost calculation dùng sai model (Bug)

**File**: `layer2/agent/orchestrator.py:148`

**Problem**: `calculate_cost(settings.claude_model, ...)` luôn dùng global model. Nhưng skill có thể override model (vd: `index.yaml` dùng `claude-haiku-4-5-20251001`). Line 119 đã set `result.model = skill.model or settings.claude_model` đúng, nhưng cost calculation không dùng `result.model`.

**Fix**: Thay `settings.claude_model` → `result.model` tại line 148:
```python
result.cost_usd = calculate_cost(
    result.model,  # ← dùng actual model, không phải global default
    result.input_tokens,
    result.output_tokens,
    result.cache_read_tokens,
    result.cache_creation_tokens,
)
```

**Severity**: Bug — cost sai khi skill dùng model khác (Haiku bị tính giá Sonnet)
**Effort**: 1 line change

---

## [ ] Fix H: ThreadPoolExecutor tạo mới mỗi request (Performance)

**File**: `layer2/api/routes/analysis.py:26`

**Problem**: Mỗi POST /analyze tạo `ThreadPoolExecutor(max_workers=1)` rồi destroy. Overhead không cần thiết.

**Fix**: Dùng `None` để dùng default asyncio executor:
```python
# Trước:
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    result = await loop.run_in_executor(pool, orch.run, body)

# Sau:
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(None, orch.run, body)
```

Bỏ `import concurrent.futures` nếu không dùng ở nơi khác.

**Severity**: Performance — thread pool creation overhead mỗi request
**Effort**: ~3 line change

---

## [ ] Fix I: Remove dead code `_format_analysis()` (Cleanup)

**File**: `layer2/notifications/telegram_bot.py:416-449`

**Problem**: Function `_format_analysis()` không được gọi ở đâu trong codebase. Bot hiện dùng `_format_analysis_caption()` + `_send_document()`.

**Fix**: Xóa toàn bộ function `_format_analysis()`.

**Verify trước khi xóa**: `grep -r "_format_analysis" layer2/` — confirm chỉ có definition, không có caller.

**Severity**: Dead code
**Effort**: Delete function

---

## Các concern khác (thảo luận sau)

| ID | Concern | Severity | Effort | Note |
|----|---------|----------|--------|------|
| A | Blocking API endpoint (POST /analyze giữ 30-90s) | Medium | High | Chấp nhận nếu traffic thấp |
| C | Không dedup concurrent analyses cùng finding_id | Low | Medium | Nice-to-have |
| D | Multi-turn session không rebuild db_context | Design | N/A | Intentional trade-off |
| E | Telegram dùng raw urllib thay vì python-telegram-bot | Low | Medium | urllib = simple, nhưng multipart fragile |
| F | Health check không kiểm tra Claude API | Low | Low | Nice-to-have |
| G | Không có auth/rate limiting trên API | Depends | Medium | Cần nếu expose public |
