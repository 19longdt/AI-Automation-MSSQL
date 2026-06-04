# Plan chi tiết — Layer 3: Maintenance Dashboard (Web UI)

> Plan tổng quan: [index-statistics-maintenance.md](./index-statistics-maintenance.md)
> **Plan UI/UX chi tiết** (wireframe, component, màu sắc, interaction): [maintenance-layer3-uiux-detail.md](./maintenance-layer3-uiux-detail.md)
> Phạm vi: hiển thị queue/approval/history/window cho DBA trên web, bổ sung kênh quản trị ngoài Telegram. Triển khai SAU Layer 1 (đọc data là chính; 2 action ghi có kiểm soát).

---

## 1. Mục tiêu trang `/maintenance`

| Khu vực | Nội dung |
|---|---|
| **Tổng quan đêm qua** | done/skipped/failed count, tổng phút đã dùng / budget, top item theo duration |
| **Queue hiện tại** | bảng work items: short_id, object, action, frag%, pages, est, priority, status badge, decided_by |
| **Batch chờ approve** | batch summary + nút Approve ALL / Reject ALL (tương đương Telegram) |
| **History** | filter theo table/action/outcome, cột frag before→after, duration, sparkline frag trend per index |
| **Window & Kill-switch** | hiển thị window config theo ngày; toggle **kill-switch** (stop sau item hiện tại) |
| **Policies** | bảng policy overrides (read-only v1; edit = v2) |

## 2. Layer 3 API (Fastify) — `layer3/apps/api/src/`

Pattern hiện tại: route file mỏng (`routes/jobs.ts` ~10 dòng) + logic trong `services/*-service.ts`, guard `app.mongoReady`, đọc Mongo qua `app.getDb()`.

### Routes mới — `routes/maintenance.ts`
```
GET  /api/maintenance/live                 ← 1 call gộp cho polling 10-30s: {window_state, kill_switch,
                                              running_item, counts_by_status, latest_batch_awaiting}
GET  /api/maintenance/summary?date=        ← tổng kết 1 đêm (aggregate maintenance_history)
GET  /api/maintenance/queue?status=&limit= ← maintenance_queue, sort (status, priority DESC)
GET  /api/maintenance/batches?status=      ← maintenance_batches
GET  /api/maintenance/history?table=&action=&outcome=&from=&to=&limit=
GET  /api/maintenance/history/trend?table=&index=   ← frag_before/after theo thời gian (chart)
GET  /api/maintenance/window               ← maintenance_window doc
GET  /api/maintenance/policies
POST /api/maintenance/window/kill-switch   ← { enabled: boolean }  — ghi trực tiếp Mongo
POST /api/maintenance/batches/:batchId/decide  ← { decision: "all"|"reject", decidedBy }
POST /api/maintenance/items/:shortId/decide    ← { decision: "ok"|"no", decidedBy }
```

### Service mới — `services/maintenance-service.ts`
- Đọc 5 collections maintenance (cùng Mongo db với findings).
- `decideBatch`/`decideItem`: **logic Mongo update giống hệt `MaintenanceApprovalAdapter` Layer 1** (update_many status awaiting_approval → approved/rejected). Hai đường ghi (Telegram + Web) cùng schema, idempotent — item đã quyết thì decide lần 2 không đổi gì, trả về số lượng affected.
- Register trong app bootstrap cùng chỗ `registerJobRoutes`.

### Types — `layer3/packages/core/src/types/maintenance.ts`
Mirror Pydantic models Layer 1 (như `plan-analysis.ts` mirror Python models): `WorkItem`, `WorkItemStatus`, `MaintenanceBatch`, `MaintenanceHistoryEntry`, `MaintenanceWindow`, `MaintenancePolicy`, `NightlySummary`.

## 3. Frontend — `layer3/apps/web/`

Pattern hiện tại: vanilla TS + html page per view (`pages/dashboard.html`, `insights.html`, `query-plan.html` + `topbar.js`), component TS trong `dashboard/`, CSS vars trong `css/base.css`.

### Files mới
```
pages/maintenance.html              ← layout 5 khu vực (mục 1) + topbar entry
dashboard/maintenance.ts            ← page controller: fetch + render + polling 30s
dashboard/maintenance-queue-table.ts← bảng queue: status badge màu theo WorkItemStatus,
                                      sort/filter client-side, nút approve/reject per item
dashboard/maintenance-trend.ts      ← chart frag before/after theo thời gian (SVG thuần như
                                      các component hiện có — KHÔNG thêm chart library)
css/maintenance.css                 ← status badge palette: approved=blue, running=amber pulse,
                                      done=green, failed=red, paused=purple, skipped=gray
dashboard/api-client.ts             ← + các hàm fetchMaintenance*()
pages/topbar.js                     ← + link "Maintenance"
```

### UX chi tiết
- **Approve trên web**: confirm modal (reuse `modal.ts`) hiển thị số item + est tổng phút trước khi gửi decide. `decidedBy` lấy từ input tên (lưu localStorage) — không có auth layer, ghi nhận danh tính mức audit-trail.
- **Kill-switch**: toggle đỏ nổi bật + confirm modal "Maintenance sẽ dừng sau item hiện tại". Hiển thị trạng thái thật từ server (poll), không optimistic.
- **Queue row click** → modal chi tiết: full metrics, statement dự kiến (build phía hiển thị: gọi `GET history` nếu đã chạy), lịch sử attempts/last_error.
- **Trend chart**: chọn index → đường frag_before (đỏ) và frag_after (xanh) theo created_at → DBA thấy index nào phân mảnh lại nhanh → cân nhắc fillfactor (insight cho policy v2).
- **Dashboard chính (`dashboard.html`)**: thêm 1 card nhỏ "Maintenance đêm qua: ✅12 ⏭️3 ❌1 — 145/170p" link sang `/maintenance`.

## 4. Glossary

`dashboard/glossary.ts` (70+ entries hiện có) thêm: `fragmentation`, `reorganize`, `rebuild (online/resumable)`, `fill factor`, `forwarded record`, `statistics sampling`, `maintenance window`, `redo queue` (nếu chưa có) — tooltip tiếng Việt nhất quán với các entry hiện tại.

## 5. Thứ tự thực hiện

1. Types + `maintenance-service.ts` (read-only endpoints) + route register
2. `maintenance.html` + controller + queue table + summary (read-only UI hoàn chỉnh)
3. Decide endpoints + approve/reject UI + kill-switch
4. Trend chart + history filter + dashboard card + glossary
5. E2E với data giả seed vào Mongo

## 6. Definition of Done (Layer 3)

- [ ] DBA xem được queue/batch/history/window không cần mở MongoDB Compass
- [ ] Approve batch trên web có hiệu lực y hệt approve qua Telegram (cùng Mongo state)
- [ ] Kill-switch bật trên web → maintenance runner dừng ở tick kế tiếp (≤60s)
- [ ] Mongo chưa có collections maintenance → trang hiển thị empty-state, không crash các trang khác
