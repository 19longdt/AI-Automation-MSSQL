# Plan UI/UX chi tiết — Trang `/maintenance` (Layer 3)

> Plan kỹ thuật Layer 3: [maintenance-layer3-detail.md](./maintenance-layer3-detail.md)
> Nguyên tắc: **tái sử dụng 100% design system hiện có** (`css/base.css` CSS vars, `.panel`/`.card`/`.badge`/`.filters`/`modal.ts`/`loading-overlay.ts`/`glossary-tooltip.ts`) — trang mới nhìn đồng nhất với Dashboard/Insights, không thêm thư viện ngoài.

---

## 1. Tư duy thiết kế

DBA mở trang này để trả lời 4 câu hỏi, theo đúng thứ tự ưu tiên — layout xếp từ trên xuống theo thứ tự đó:

1. **"Đêm qua chạy được gì? Có lỗi không?"** → Night Summary (nhìn 3 giây là biết)
2. **"Có batch nào đang chờ tôi duyệt không?"** → Approval banner (nổi bật khi có, biến mất khi không)
3. **"Tiến trình xử lý backlog đến đâu rồi?"** → Pipeline + Queue (view quá trình)
4. **"Index X có lịch sử thế nào, maintenance có hiệu quả không?"** → History + Trend (drill-down)

**Nguyên tắc "view quá trình":** mọi work item có vòng đời nhiều ngày (scan → chờ duyệt → đã duyệt → chờ window → chạy → xong/lỗi/hoãn). UI phải cho thấy **vị trí của từng item trong vòng đời** và **dòng chảy tổng thể** — không chỉ là bảng dữ liệu phẳng.

---

## 2. Cấu trúc trang (wireframe tổng thể)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Dashboard] [Insights] [Query Plan] [Maintenance*]                  [🌙]      │ ← topbar.js (+1 tab)
├──────────────────────────────────────────────────────────────────────────────┤
│ ▌🔔 BATCH #a1b2c3 đang chờ duyệt — 42 items · ~185 phút                       │
│ ▌   REBUILD 8 · REORG 19 · STATS 13 · HEAP 2   [Xem chi tiết] [✅ Approve ALL] [⛔ Reject] │ ← (A) Approval banner
├──────────────────────────────────────────────────────────────────────────────┤
│ (B) NIGHT SUMMARY — Đêm 03/06  ◀ ▶                       (C) WINDOW & CONTROL │
│ ┌─────────┬─────────┬─────────┬─────────┐  ┌─────────────────────────────────┐│
│ │ ✅ DONE │ ⏭ SKIP │ ❌ FAIL │ ⏸ PAUSE │  │ 🪟 01:00–04:00 · budget 170p    ││
│ │   12    │    3    │    1    │    1    │  │ ▓▓▓▓▓▓▓▓▓░░░░░ 145/170p (85%)   ││
│ └─────────┴─────────┴─────────┴─────────┘  │ Trạng thái: ● ĐANG CHẠY          ││
│                                            │ [⛔ KILL-SWITCH]                 ││
│                                            └─────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────────────┤
│ (D) PIPELINE — dòng chảy backlog                                              │
│  Chờ duyệt ──▶ Đã duyệt ──▶ Đang chạy ──▶ Hoàn thành (7 đêm)                 │
│  [  42  ]     [  17  ]      [  1   ]      [  96  ]    · Paused 1 · Failed 2  │
├──────────────────────────────────────────────────────────────────────────────┤
│ (E) QUEUE                                                                     │
│ [All 60] [Chờ duyệt 42] [Đã duyệt 17] [Paused 1]      ← tab giống .topic-tab │
│ filters: [object...] [action ▾] [status ▾]            [Search] [Clear]        │
│ ┌──┬────────┬──────────────────────┬─────────┬──────┬──────┬────┬──────────┐ │
│ │No│ID      │Object                │Action   │Frag% │Est   │Pri │Status    │ │
│ │1 │a1b2c3d4│dbo.Bill.IX_Bill_Date │REBUILD  │ 67.2 │ 25p  │ 92 │⏳ chờ duyệt│ │
│ │  │        │ └ partition 202605   │         │      │      │    │[✅][⛔]   │ │
│ └──┴────────┴──────────────────────┴─────────┴──────┴──────┴────┴──────────┘ │
│                                              [Prev] Page 1 [Next]            │
├──────────────────────────────────────────────────────────────────────────────┤
│ (F) HISTORY & TREND                                                           │
│ filters: [table...] [action ▾] [outcome ▾] [from][to]  [Search]              │
│ ┌── bảng history ──────────────────────┐ ┌── trend chart (chọn từ row) ─────┐│
│ │ time│object│action│frag 67→4│dur│✅  │ │  frag%                            ││
│ │ ... │      │      │         │   │    │ │  70┤●╲      ●╲       ← before    ││
│ │     │      │      │         │   │    │ │  10┤  ●──────  ●──── ← after     ││
│ └──────────────────────────────────────┘ └──────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

Tất cả section dùng `.panel` + `.panel-head` hiện có; khoảng cách `.page` grid gap 12px như dashboard.

---

## 3. Chi tiết từng khu vực

### (A) Approval Banner — chỉ render khi có batch `awaiting_approval`

- Markup: `.panel` với class mới `mnt-approval-banner` — viền trái 4px `var(--color-warning)`, nền `var(--color-warning-soft)` → đập vào mắt nhưng cùng ngôn ngữ màu badge-warning hiện tại.
- Nội dung 2 dòng: dòng 1 = batch id + tổng items + est phút; dòng 2 = breakdown theo action + 3 nút.
- `[Xem chi tiết]` → mở modal danh sách items của batch (bảng giống khu E, có nút ✅/⛔ từng item).
- `[✅ Approve ALL]` → `openActionConfirmModal()` (modal.ts có sẵn) với nội dung:
  ```
  Approve 42 items?
  ước tính 185 phút — vượt budget 1 đêm (170p), phần dư tự chuyển đêm sau
  REBUILD lớn nhất: dbo.Bill.IX_Bill_Date (25p)
  Người duyệt: [____tên____]   ← input, lưu localStorage "mnt-decided-by"
  ```
  Nút confirm dùng `.btn-danger` style có sẵn cho Reject, nút primary cho Approve.
- Sau decide → banner đổi thành dòng xác nhận xanh (`--color-success-soft`) trong 5 giây rồi ẩn, queue tự reload.
- Nhiều batch chờ → banner hiển thị cái mới nhất + dòng nhỏ "+1 batch cũ hơn" link mở modal.

### (B) Night Summary — `.stats-cards` pattern có sẵn

- 4 `.stats-card`: DONE (value màu `--color-success`), SKIPPED (`--color-muted`), FAILED (`--color-danger`), PAUSED (mới: `--color-mnt-paused: #7c3aed` light / `#a78bfa` dark — trùng tông `--group-color-context` đã có).
- FAILED > 0 → card viền `--color-danger`, click mở modal lọc sẵn history outcome=failed của đêm đó.
- Điều hướng `◀ ▶` xem các đêm trước (param `?date=`), label "Đêm 03/06 (T3)".
- Dưới cards: 1 dòng text nhỏ `--color-muted`: "Item lâu nhất: REBUILD dbo.Bill.IX_Bill_Date — 25p · frag 67.2% → 4.1%".

### (C) Window & Control card

- Hiển thị window hôm nay (đã resolve day_override): `01:00–04:00 · budget 170p`.
- **Progress bar budget** (div thuần, không cần lib):
  ```html
  <div class="mnt-budget-bar"><div class="mnt-budget-fill" style="width:85%"></div></div>
  ```
  `mnt-budget-fill` nền `--color-primary`; >90% chuyển `--color-warning`. Ngoài window → bar hiển thị đêm gần nhất, mờ (opacity .5) + label "window đóng, mở lại 01:00".
- **Trạng thái runner** — dot màu + chữ:
  - `● ĐANG CHẠY` (xanh `--color-success`, kèm tên item đang running, animation pulse nhẹ)
  - `○ CHỜ WINDOW` (muted)
  - `⛔ KILL-SWITCH BẬT` (đỏ `--color-danger`)
  - Suy ra từ: kill_switch flag + window state + có item status=running không.
- **Nút KILL-SWITCH**: nằm cuối card, style `.btn-danger`. Confirm modal: "Maintenance sẽ dừng sau item hiện tại. Item REBUILD resumable sẽ PAUSE." Khi đang bật → nút đổi thành `[▶ Bật lại maintenance]` (style thường). Trạng thái luôn lấy từ server sau khi POST — **không optimistic update** (đây là control an toàn, phải phản ánh sự thật).

### (D) Pipeline — view quá trình (component mới duy nhất cần CSS riêng đáng kể)

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│ CHỜ DUYỆT  │ ─▶ │  ĐÃ DUYỆT  │ ─▶ │ ĐANG CHẠY  │ ─▶ │ HOÀN THÀNH │
│     42     │    │     17     │    │     1      │    │  96 / 7đêm │
│  ~185 phút │    │  ~88 phút  │    │ IX_Bill... │    │ ✅94 ❌2    │
└────────────┘    └────────────┘    └────────────┘    └────────────┘
        nhánh phụ:  Paused 1 · Skipped(7đ) 12 · Expired(7đ) 5
```

- 4 stage box dùng `.card` + class màu: chờ duyệt = warning, đã duyệt = info, đang chạy = success + pulse, hoàn thành = muted/success.
- Mũi tên = pseudo-element `::after` ký tự `→` to, màu `--color-border-strong` (đơn giản, không SVG).
- **Click mỗi stage = filter khu E theo status tương ứng** (đồng bộ với tab) — pipeline vừa là tổng quan vừa là bộ lọc.
- Stage "ĐANG CHẠY" hiện tên object đang chạy + thời gian đã chạy (từ `updated_at`); rỗng → "—".
- Dòng nhánh phụ nhỏ bên dưới cho trạng thái ít gặp (paused/skipped/expired), click cũng filter được.

### (E) Queue table

- **Status tabs** dùng `.topic-tab` pattern có sẵn (active = `--color-primary-soft`), count cập nhật theo data.
- Filter bar `.filters` chuẩn: input object (search schema/table/index), select action, select status (đầy đủ hơn tab), Search/Clear.
- **Cột**: No (`.no-cell`) · ID (`short_id`, click-to-copy như `finding-id-copy` hiện có) · Object · Action · Frag%/Metric · Pages · Est · Pri · Status · Quyết định.
- **Object cell 2 dòng**: dòng 1 `schema.table.index` đậm; dòng 2 phụ chú nhỏ muted: `└ partition 202605` / `└ stats: ST_Bill_Date` / `└ heap`. Tránh cột partition/stats riêng làm bảng rộng.
- **Action badge** (class mới, tông màu từ palette có sẵn):

  | Action | Màu chữ/nền |
  |---|---|
  | REBUILD / REBUILD_PARTITION | `--color-danger` / `--color-danger-soft` (nặng nhất) |
  | REORGANIZE | `--color-warning` / `--color-warning-soft` |
  | UPDATE_STATISTICS | `--color-info` / `--color-info-soft` |
  | HEAP_REBUILD | `--color-mnt-paused` (tím) / soft |

- **Status badge** mapping (dùng `.badge` base):

  | Status | Hiển thị |
  |---|---|
  | awaiting_approval | `⏳ chờ duyệt` badge-warning |
  | approved | `✔ đã duyệt` badge-info |
  | running | `● đang chạy` badge-success + `mnt-pulse` animation |
  | paused | `⏸ paused` tím |
  | done | `✅ done` badge-success |
  | failed | `❌ failed` badge-critical |
  | skipped | `⏭ skipped` muted |
  | rejected / expired | muted, gạch chân chấm + tooltip lý do |

- Cột **Quyết định**: item `awaiting_approval` → 2 nút icon nhỏ `[✅][⛔]` (confirm modal); item đã quyết → text muted `bởi LongDT · 21:05`.
- Metric cell theo kind: frag → `67.2%` (đỏ nếu ≥30, vàng nếu ≥10 — ngưỡng đọc từ policy default); stats → `mod: 1.2M rows`; heap → `fwd: 5,400`.
- **Row click** → modal chi tiết item:
  ```
  ┌ Item a1b2c3d4 — dbo.Bill.IX_Bill_Date ─────────────────┐
  │ Vòng đời:  scan 03/06 20:00 → duyệt 03/06 21:05 (LongDT)│
  │            → chạy 04/06 01:12 → ⏸ paused 01:37 (SIGTERM)│  ← timeline dọc, dot màu theo status
  │ Metrics: frag 67.2% · 1.2M pages · est 25p · attempts 1 │
  │ Statement dự kiến:                                       │
  │ ┌────────────────────────────────────────────────┐      │
  │ │ ALTER INDEX [IX_Bill_Date] ON [dbo].[Bill]     │      │  ← .code-block style có sẵn
  │ │ REBUILD PARTITION = 5 WITH (ONLINE=ON, ...)    │      │
  │ └────────────────────────────────────────────────┘      │
  │ Skip log: 04/06 01:05 gate fail — CPU 72% ≥ 60%         │  ← từ history outcome=skipped
  │ [📜 Xem history của index này]                           │  ← scroll + filter khu F
  └──────────────────────────────────────────────────────────┘
  ```
  Timeline dựng từ `created_at`/`approval.decided_at`/history records của item — đây là "view quá trình" mức item.
- Pagination Prev/Next pattern hiện có.

### (F) History & Trend

- Layout 2 cột grid (desktop ≥1100px): bảng trái (60%), chart phải (40%); mobile xếp dọc.
- Bảng: Time · Object · Action badge · **Frag `67.2 → 4.1`** (cell đặc trưng: số trước muted đỏ nhạt, mũi tên, số sau đậm xanh — nhìn 1 cell biết ngay hiệu quả) · Duration · Outcome badge · nút `📈` (vẽ trend).
- Row outcome=failed/skipped → click hiện error/skip_reason trong modal.
- **Trend chart — SVG thuần** (codebase chưa có chart lib, không thêm):
  - 2 đường: frag_before (đỏ `--color-danger`, nét đứt) và frag_after (xanh `--color-success`, nét liền) theo `created_at`; dot tại mỗi lần maintenance, hover → tooltip ngày + giá trị (reuse `gl-tooltip` style).
  - Đường ngang mờ tại reorganize/rebuild threshold (10%/30%) — DBA thấy ngay index "phân mảnh lại nhanh" (before tăng dốc giữa các lần) → insight chỉnh fillfactor/policy.
  - Empty state: "Chọn 1 index từ bảng (nút 📈) để xem trend".
  - ~80 dòng TS: scale tuyến tính, `<polyline>` + `<circle>`, viewBox responsive.

---

## 4. Realtime / polling

Dashboard hiện tại **không** auto-refresh; trang maintenance thì cần "view quá trình" — chọn polling có điều kiện, nhẹ:

- 1 endpoint gộp `GET /api/maintenance/live` → `{window_state, kill_switch, running_item, counts_by_status, latest_batch_awaiting}` (1 query nhẹ, đủ cho khu A/B/C/D).
- Poll **30s** khi tab visible (`document.visibilityState`), dừng khi hidden. Trong window + có item running → **10s**.
- Khu E/F chỉ reload khi user bấm Search / đổi tab / sau khi decide — giữ đúng triết lý "load khi user hành động" của dashboard, tránh bảng nhảy khi đang đọc.
- Có data mới ở queue trong lúc user đang filter → không tự render lại, hiện chip nhỏ cạnh tab: `↻ có thay đổi — bấm để tải lại`.

---

## 5. File & CSS mới

```
pages/maintenance.html              ← skeleton 6 section theo mục 2 (theme bootstrap script + css links như dashboard.html)
pages/topbar.js                     ← + tab "Maintenance" (data-active-tab)
dashboard/maintenance.ts            ← controller: init → bindEvents → loadLive + loadQueue + loadHistory; poll live
dashboard/maintenance-pipeline.ts   ← render khu D từ counts (pure function render(counts) → html)
dashboard/maintenance-trend.ts      ← SVG chart (render(el, points, thresholds))
dashboard/api-client.ts             ← + fetchMaintenanceLive/Queue/History/Trend, postDecide, postKillSwitch
css/maintenance.css                 ← CHỈ phần mới: .mnt-approval-banner, .mnt-budget-bar/fill,
                                       .mnt-pipeline (stage box + arrow), .badge-mnt-* (action/status),
                                       .mnt-frag-delta, .mnt-pulse keyframes, .mnt-timeline (modal item)
webpack.config.js                   ← + entry maintenance
```

CSS var mới duy nhất (thêm vào `base.css` cả 2 theme):
```css
--color-mnt-paused: #7c3aed;        /* dark: #a78bfa */
--color-mnt-paused-soft: #f3e8ff;   /* dark: rgba(167,139,250,.16) */
```
Mọi màu khác dùng var sẵn có — đảm bảo dark mode tự hoạt động.

## 6. Glossary entries mới (`dashboard/glossary.ts` + `data-glossary` tại header/label)

`fragmentation`, `reorganize`, `rebuild_online`, `resumable_rebuild`, `forwarded_record`, `statistics_sampling`, `maintenance_window`, `time_budget`, `kill_switch`, `safety_gate`, `fill_factor` — định nghĩa tiếng Việt, format `GlossaryEntry{term, definition, threshold, impact}` như 70 entry hiện có. Gắn `?` tooltip tại: header cột Frag%, label budget bar, nút kill-switch, stage pipeline.

## 7. Empty states & lỗi

| Tình huống | Hiển thị |
|---|---|
| Chưa seed collections | Toàn trang: panel hướng dẫn "Maintenance module chưa được bật — chạy seed_maintenance + start container" (không crash) |
| Không có batch chờ | Khu A ẩn hoàn toàn |
| Queue rỗng | "🎉 Không có backlog — hệ thống index/stats trong ngưỡng" |
| Ngoài window, không running | Khu C: "window đóng, mở lại 01:00"; khu D stage running = "—" |
| API lỗi | Pattern hiện có: text đỏ trong panel + giữ data cũ, không xoá bảng |

## 8. Thứ tự build UI

1. `maintenance.html` + topbar + controller skeleton + khu B/C/E read-only (giá trị nhất, đủ dùng sớm)
2. Khu A + decide flow + kill-switch (cần endpoints POST)
3. Khu D pipeline + polling live + modal item timeline
4. Khu F history + trend SVG + glossary + dashboard card link
5. Polish: dark mode soát lại, empty states, responsive <1100px

## 9. Definition of Done (UI/UX)

- [ ] Nhìn 3 giây biết: đêm qua kết quả + có gì cần duyệt + runner đang làm gì
- [ ] Mọi trạng thái item trace được vòng đời đầy đủ (modal timeline)
- [ ] Approve/kill-switch luôn có confirm + phản ánh state thật từ server
- [ ] Dark mode + light mode đều đạt (chỉ dùng CSS vars)
- [ ] Không thêm dependency JS/CSS mới; bundle `maintenance.js` build qua webpack entry như dashboard/insights
