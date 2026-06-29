export interface MaintGlossaryEntry {
  term: string;
  description: string;
}

export const MAINT_GLOSSARY: Record<string, MaintGlossaryEntry> = {
  page_catalog: {
    term: "Catalog",
    description:
      "Xem snapshot index, statistics, heap theo từng bảng; theo dõi xu hướng catalog theo thời gian; và cấu hình scope dữ liệu cho catalog job.",
  },
  page_campaign: {
    term: "Campaign",
    description:
      "Quản lý campaign bảo trì: tạo campaign, theo dõi pipeline Discovery đến Results, và kiểm soát queue cùng lịch sử thực thi.",
  },

  // ── Window & schedule ─────────────────────────────────────────────────────
  maintenance_window: {
    term: "Maintenance Window",
    description:
      "Khung giờ ban đêm được dành riêng để chạy bảo trì. Runner chỉ thực thi trong khoảng thời gian này nhằm tránh tác động đến workload ban ngày.",
  },
  kill_switch: {
    term: "Kill Switch",
    description:
      "Cơ chế dừng khẩn cấp. Khi bật, runner ngừng nhận item mới ngay lập tức. Catalog và discovery vẫn tiếp tục hoạt động bình thường.",
  },
  day_overrides: {
    term: "Day Overrides",
    description:
      "Ghi đè khung giờ mặc định cho nhóm ngày cụ thể (Weekday Mon–Fri, Weekend Sat–Sun). Khi một nhóm không được bật, runner dùng Default slot.",
  },
  time_budget: {
    term: "Budget",
    description:
      "Tổng số phút được phép dùng trong window hiện tại. Runner không nhận item mới khi budget cạn — đảm bảo bảo trì kết thúc đúng giờ.",
  },
  window_override: {
    term: "Window Override",
    description:
      "Ghi đè khung giờ mặc định của cluster cho riêng campaign này. Chỉ ảnh hưởng giờ bắt đầu/kết thúc và ngân sách phút; gate an toàn vẫn lấy từ cấu hình cluster.",
  },
  window_enabled: {
    term: "Window Enabled",
    description:
      "Bật/tắt toàn bộ execute cho cluster này. Khi tắt, runner bỏ qua mọi tick thực thi nhưng catalog và discovery vẫn chạy bình thường.",
  },

  // ── Safety gates ──────────────────────────────────────────────────────────
  gate_cpu: {
    term: "CPU Gate",
    description:
      "Ngưỡng CPU tối đa (%). Khi CPU server vượt ngưỡng này, runner tạm dừng nhận item mới cho tới khi CPU giảm xuống.",
  },
  gate_requests: {
    term: "Active Requests Gate",
    description:
      "Số concurrent request đang xử lý tối đa. Bảo vệ server khỏi quá tải khi lưu lượng tăng đột biến.",
  },
  gate_ag_send: {
    term: "AG Send Queue Gate",
    description:
      "Kích thước tối đa của hàng chờ gửi log tới Secondary (KB). Vượt ngưỡng nghĩa là Secondary đang bị trễ — dừng bảo trì để ưu tiên đồng bộ AG.",
  },
  gate_ag_redo: {
    term: "AG Redo Queue Gate",
    description:
      "Kích thước tối đa của hàng chờ redo log tại Secondary (KB). Vượt ngưỡng nghĩa là Secondary nhận log nhanh hơn tốc độ xử lý — nguy cơ Secondary lag.",
  },

  // ── Pipeline stages ───────────────────────────────────────────────────────
  stage_catalog: {
    term: "Catalog",
    description:
      "Bước 1: chụp trạng thái index/statistics/heap của tất cả bảng trong scope vào MongoDB. Đây là nguồn dữ liệu cho Discovery — snapshot càng mới, quyết định bảo trì càng chính xác.",
  },
  stage_approval: {
    term: "Approval",
    description:
      "Bước 2: Discovery tạo batch work item rồi gửi lên Telegram để DBA phê duyệt (✅/⛔). Chỉ item được approve mới được đưa vào queue thực thi.",
  },
  stage_queue: {
    term: "Queue",
    description:
      "Bước 3: danh sách work item đã được duyệt, chờ đến window đêm để thực thi theo thứ tự priority. Item PAUSED là REBUILD RESUMABLE đang tạm dừng, sẽ tự tiếp tục ở window tiếp theo.",
  },
  stage_results: {
    term: "Results",
    description:
      "Bước 4: tổng hợp kết quả thực thi — số item hoàn thành và thất bại. Item FAILED cần kiểm tra lỗi cụ thể trong tab History.",
  },

  // ── Campaign ──────────────────────────────────────────────────────────────
  campaign: {
    term: "Campaign",
    description:
      "Kế hoạch bảo trì do DBA tạo — định nghĩa bảng nào, loại bảo trì gì, ngưỡng ra sao, và lịch quét. Một campaign có thể chạy lặp lại hàng ngày trong suốt khoảng thời gian đã đặt.",
  },
  run_discovery: {
    term: "Run Discovery",
    description:
      "Kích hoạt Discovery ngay lập tức cho campaign đang chọn, bỏ qua lịch scan_times. Discovery so sánh snapshot catalog mới nhất với ngưỡng campaign để tạo work item mới cho window đêm.",
  },
  status_active: {
    term: "ACTIVE",
    description:
      "Campaign đang hoạt động — Discovery đã hoàn thành ít nhất một lần và các work item đã có trong queue. Execute tick sẽ xử lý các item trong window đêm.",
  },
  status_discovering: {
    term: "DISCOVERING",
    description:
      "Discovery đang chạy — runner đang quét snapshot catalog, so sánh với ngưỡng, và tạo work item. Trạng thái này thường kéo dài vài giây đến vài phút.",
  },
  status_discovery_failed: {
    term: "DISCOVERY FAILED",
    description:
      "Discovery gặp lỗi — xem thông báo bên dưới để biết chi tiết. Có thể retry bằng nút Run Discovery sau khi kiểm tra cấu hình catalog và scope.",
  },
  status_pending: {
    term: "PENDING",
    description:
      "Campaign vừa được tạo, chưa chạy Discovery lần nào. Chờ đến scan_times hoặc bấm Run Discovery để bắt đầu.",
  },
  status_completed: {
    term: "COMPLETED",
    description:
      "Campaign đã hoàn thành — tất cả work item đã được xử lý (done/skipped/failed). Không còn item mới nào được tạo.",
  },
  status_expired: {
    term: "EXPIRED",
    description:
      "Campaign đã quá ngày kết thúc (end_date). Các item chưa thực thi sẽ không được xử lý. Có thể cập nhật end_date để tiếp tục.",
  },
  status_cancelled: {
    term: "CANCELLED",
    description:
      "Campaign đã bị hủy thủ công. Các item pending và approved sẽ không được thực thi.",
  },
  metric_done: {
    term: "Done",
    description:
      "Số work item đã thực thi thành công trong campaign này (outcome = done).",
  },
  metric_total: {
    term: "Total Items",
    description:
      "Tổng số work item được Discovery tạo ra cho campaign này — mỗi partition index/stats/heap vượt ngưỡng tương ứng với một item.",
  },
  metric_remaining: {
    term: "Remaining",
    description:
      "Số work item còn lại chưa thực thi — bao gồm approved, awaiting approval, và paused (REBUILD RESUMABLE đang tạm dừng).",
  },
  scan_times: {
    term: "Discovery Time Slots",
    description:
      "Các khung giờ trong ngày mà Discovery được phép chạy. Mỗi lần Discovery so sánh snapshot catalog mới nhất với ngưỡng campaign để tạo work item mới.",
  },
  exec_type_index: {
    term: "Index Maintenance",
    description:
      "Bật bảo trì index: REORGANIZE khi phân mảnh vừa, REBUILD khi phân mảnh nặng. Với bảng partition, runner chỉ xử lý từng partition riêng lẻ vượt ngưỡng.",
  },
  exec_type_statistics: {
    term: "Statistics Update",
    description:
      "Bật cập nhật thống kê: UPDATE STATISTICS khi số lần thay đổi dữ liệu vượt ngưỡng. Statistics lỗi thời khiến Query Optimizer chọn sai execution plan, làm chậm query.",
  },
  exec_type_heap: {
    term: "Heap Rebuild",
    description:
      "Bật rebuild bảng Heap (không có clustered index). Heap nhiều Forwarded Record — bản ghi bị chuyển vị trí do UPDATE — cần được tổ chức lại để cải thiện hiệu suất đọc.",
  },

  // ── Thresholds ────────────────────────────────────────────────────────────
  threshold_reorganize: {
    term: "Reorganize ≥ (%)",
    description:
      "Ngưỡng fragmentation tối thiểu để thực hiện REORGANIZE — sắp xếp lại trang index tại chỗ, không block I/O, phù hợp khi phân mảnh vừa phải (thường 10–30%).",
  },
  threshold_rebuild: {
    term: "Rebuild ≥ (%)",
    description:
      "Ngưỡng fragmentation để nâng lên REBUILD — xây lại index hoàn toàn từ đầu. Hiệu quả hơn REORGANIZE nhưng cần nhiều tài nguyên hơn.",
  },
  threshold_min_pages: {
    term: "Min Pages",
    description:
      "Bỏ qua index có ít trang hơn ngưỡng này. Index nhỏ dù phân mảnh cao cũng không ảnh hưởng đáng kể đến hiệu suất — không cần bảo trì.",
  },
  threshold_max_pages: {
    term: "Max Pages",
    description:
      "Bỏ qua index lớn hơn ngưỡng này (nếu đặt). Dùng để loại trừ index cực lớn khỏi tầm kiểm soát của window đêm.",
  },
  threshold_modification: {
    term: "Modification ≥",
    description:
      "Số lần thay đổi dữ liệu (insert/update/delete) tích lũy từ lần cập nhật statistics trước. Vượt ngưỡng → UPDATE STATISTICS được lên lịch.",
  },
  threshold_forwarded: {
    term: "Forwarded Records ≥",
    description:
      "Số Forwarded Record trong bảng Heap. Forwarded Record xuất hiện khi UPDATE làm bản ghi phình ra và phải di chuyển sang trang khác — làm chậm đọc vì cần đọc thêm con trỏ.",
  },

  // ── Action types ──────────────────────────────────────────────────────────
  action_rebuild: {
    term: "REBUILD",
    description:
      "Xây lại index hoàn toàn từ đầu — loại bỏ toàn bộ phân mảnh. Chạy ONLINE RESUMABLE: không lock bảng, có thể tạm dừng và tiếp tục sau khi bị gián đoạn.",
  },
  action_rebuild_partition: {
    term: "REBUILD PARTITION",
    description:
      "Xây lại chỉ một partition cụ thể của index — áp dụng cho bảng partition theo ngày/tháng. Nhanh hơn REBUILD toàn bộ và ít tác động đến các partition đang dùng.",
  },
  action_reorganize: {
    term: "REORGANIZE",
    description:
      "Sắp xếp lại các trang index tại chỗ mà không cần lock. Nhẹ hơn REBUILD, phù hợp khi phân mảnh vừa phải. Không hỗ trợ resumable.",
  },
  action_update_stats: {
    term: "UPDATE STATISTICS",
    description:
      "Cập nhật thống kê phân phối dữ liệu để Query Optimizer chọn execution plan tốt hơn. Quan trọng khi dữ liệu thay đổi nhiều giữa các lần update stats tự động.",
  },
  action_heap_rebuild: {
    term: "HEAP REBUILD",
    description:
      "Tổ chức lại bảng Heap bằng cách tạm thêm rồi xóa clustered index. Giải quyết Forwarded Record tích lũy do nhiều lần UPDATE làm bản ghi di chuyển vị trí.",
  },

  // ── Queue metrics ─────────────────────────────────────────────────────────
  frag_pct: {
    term: "Frag %",
    description:
      "Mức độ phân mảnh của index (%). Cao nghĩa là các trang index không liên tục trên đĩa — làm chậm quét lớn. Dưới ~10% thường chấp nhận được.",
  },
  page_count: {
    term: "Pages",
    description:
      "Số trang 8KB của index. Là yếu tố chính ảnh hưởng đến thời gian REBUILD/REORGANIZE — index càng lớn càng lâu và tiêu tốn nhiều tài nguyên hơn.",
  },
  estimated_minutes: {
    term: "Estimate",
    description:
      "Ước tính thời gian thực thi dựa trên kích thước index. Runner dùng để kiểm soát budget window — không nhận item mới nếu ước tính vượt phần budget còn lại.",
  },
  priority: {
    term: "Priority",
    description:
      "Điểm ưu tiên thực thi: index lớn hơn và phân mảnh nặng hơn được ưu tiên cao hơn. Runner claim item theo thứ tự priority giảm dần trong mỗi window.",
  },

  // ── Queue / item status ───────────────────────────────────────────────────
  status_awaiting: {
    term: "Awaiting Approval",
    description:
      "Item vừa được Discovery tạo, đang chờ DBA phê duyệt qua Telegram (✅ để approve, ⛔ để từ chối). Item chưa được duyệt sẽ không bao giờ được thực thi.",
  },
  status_approved: {
    term: "Approved",
    description:
      "DBA đã phê duyệt. Item đang xếp hàng, chờ đến window đêm và có đủ budget để được thực thi.",
  },
  status_running: {
    term: "Running",
    description: "Đang thực thi T-SQL trên SQL Server tại thời điểm này.",
  },
  status_paused: {
    term: "Paused",
    description:
      "Tạm dừng giữa chừng — thường do hết window hoặc health check phát hiện vấn đề. REBUILD RESUMABLE sẽ tự tiếp tục từ điểm dừng ở window kế tiếp.",
  },
  status_superseded: {
    term: "Superseded",
    description:
      "Bị thay thế bởi Discovery lần tiếp theo khi có snapshot catalog mới hơn. Item này không còn phản ánh trạng thái hiện tại và sẽ không được thực thi.",
  },

  // ── History outcomes ──────────────────────────────────────────────────────
  outcome_done: {
    term: "Done",
    description: "Thực thi thành công. T-SQL đã chạy hoàn thành trên SQL Server.",
  },
  outcome_failed: {
    term: "Failed",
    description:
      "Thực thi thất bại. Xem cột Notes để biết lỗi cụ thể — thường do lock conflict, timeout, hoặc lỗi SQL Server.",
  },
  outcome_skipped: {
    term: "Skipped",
    description:
      "Bị bỏ qua — thường do gate fail tại thời điểm claim (CPU/request cao) hoặc item không còn phù hợp.",
  },
  outcome_aborted: {
    term: "Aborted",
    description:
      "Hủy bỏ giữa chừng do lỗi không thể khôi phục. Khác với PAUSED: ABORTED không tiếp tục ở lần sau.",
  },
  outcome_dry_run: {
    term: "Dry Run",
    description:
      "Chạy thử: T-SQL được sinh ra và ghi vào log nhưng KHÔNG thực thi trên SQL Server. Kích hoạt bằng biến môi trường MAINT_DRY_RUN=true để kiểm tra an toàn trước go-live.",
  },
  outcome_paused: {
    term: "Paused (Outcome)",
    description:
      "REBUILD RESUMABLE đã được tạm dừng có chủ đích — do hết window hoặc server báo quá tải. Tiến độ được lưu lại, item sẽ tiếp tục ở window kế tiếp.",
  },

  // ── Catalog ───────────────────────────────────────────────────────────────
  catalog_stale: {
    term: "Stale Stats",
    description:
      "Số statistics chưa được cập nhật lâu trên bảng này. Statistics cũ khiến Query Optimizer đánh giá sai cardinality và chọn execution plan kém hiệu quả.",
  },
  catalog_heap_issue: {
    term: "Heap Forwarded",
    description:
      "Bảng có nhiều Forwarded Record trong cấu trúc Heap. Forwarded Record xuất hiện khi UPDATE làm bản ghi phình ra và phải di chuyển sang trang khác — làm chậm đọc.",
  },
  catalog_frag: {
    term: "Fragmentation",
    description:
      "Mức phân mảnh tối đa (%) trong tất cả index của bảng, lấy từ snapshot gần nhất. Cao nghĩa là cần ưu tiên bảo trì.",
  },
};
