 2. Lệch / Thiếu so với plan

  2a. CLAUDE.md maintenance/ chưa cập nhật

  CLAUDE.md vẫn mô tả scan/scan_service.py và job maint_scan_{cid}, trong khi code thực tế đã đổi thành discovery/discovery_service.py và job maint_discovery_{cid}. File CLAUDE.md bị outdated —
  không ảnh hưởng runtime nhưng gây nhầm cho dev đọc doc.

  2b. MaintenanceNotifier chưa implement MaintenanceEventPublisher interface

  Plan-03 định nghĩa MaintenanceEventPublisher ABC với on_item_started(), on_item_done(), v.v. Nhưng trong runner.py:
  notifier = MaintenanceNotifier(token, chat_id, cluster_id)
  # → truyền trực tiếp vào publisher=notifier
  Nếu MaintenanceNotifier chưa kế thừa MaintenanceEventPublisher, type contract bị vi phạm — cần kiểm tra file notify/maintenance_notifier.py.

  2c. CampaignForm chưa có scope selector + window override UI

  Plan-02 section 6 mô tả CampaignForm multi-step (chọn db/schema/table từ catalog, execution_types, window override). Code thực tế có CampaignForm.tsx nhưng chưa rõ có implement đủ các bước này
  chưa — cần review file này riêng.

  ---
  3. Vấn đề chính: Không có trigger mechanism ⚠️

  Hiện trạng:
  - Layer 3 API (Fastify) và maintenance runner là 2 process riêng biệt
  - Giao tiếp duy nhất: MongoDB polling
  - Runner không có HTTP server
  - Layer 3 không có endpoint nào trigger job runner

  Những nút UI trong plan cần trigger:

  ┌─────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┐
  │                     Nút UI                      │                   Cần làm gì ở runner                   │
  ├─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ "Retry Discovery" khi campaign DISCOVERY_FAILED │ Runner tự retry sau ≤60s — đã hoạt động tự động         │
  ├─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ "Force Run Catalog Now" trong CatalogView       │ Cần trigger maint_catalog_{cid} ngay — chưa có cơ chế   │
  ├─────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ "Run Discovery Now" (nếu có trong UI)           │ Cần trigger maint_discovery_{cid} ngay — chưa có cơ chế │
  └─────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┘

  Retry DISCOVERY_FAILED: thực ra đã ổn — discovery_job chạy mỗi 60s và tự phát hiện DISCOVERY_FAILED → retry. Không cần trigger.

  Force catalog job là gap thật. Catalog cron mặc định 20:00 — nếu DBA vừa config scope mới và muốn chạy ngay, không có cách nào ngoài chờ đến 20:00 hoặc restart process.

  ---
  4. Giải pháp đề xuất cho trigger gap

  Phù hợp nhất với kiến trúc hiện tại (MongoDB-only IPC, không thêm port mới):

  Thêm collection maintenance_commands:

  # Layer 3 API POST /api/maintenance/commands
  { type: "run_catalog", cluster_id: "prod", requested_at: ISODate(), status: "pending" }

  Runner thêm 1 job poll maintenance_commands mỗi 30s:
  def _poll_commands(self) -> None:
      cmd = self._command_repo.claim_pending()
      if cmd and cmd.type == "run_catalog":
          catalog_service = self._catalog_services.get(cmd.cluster_id)
          if catalog_service:
              catalog_service.run()
          self._command_repo.mark_done(cmd.command_id)

  - Không thêm HTTP server vào runner
  - Runner tự quyết định có chạy không (có thể check gate trước)
  - Layer 3 API chỉ write document — fire-and-forget
  - TTL 1 ngày trên collection để tự cleanup

  ---
  5. Ưu tiên fix

  ┌─────┬────────────────────────────────────────────────────────────────────────────────────────┬────────────┐
  │  #  │                                          Item                                          │   Mức độ   │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────┼────────────┤
  │ 1   │ Kiểm tra MaintenanceNotifier có implement MaintenanceEventPublisher không              │ Cao        │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────┼────────────┤
  │ 2   │ Review CampaignForm.tsx — scope selector, execution_types, window override có đủ không │ Cao        │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────┼────────────┤
  │ 3   │ Trigger mechanism cho catalog job (command collection hoặc chấp nhận chờ cron)         │ Trung bình │
  ├─────┼────────────────────────────────────────────────────────────────────────────────────────┼────────────┤
  │ 4   │ Cập nhật maintenance/CLAUDE.md cho đúng tên file/job hiện tại                          │ Thấp       │