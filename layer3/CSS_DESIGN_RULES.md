# CSS Design Rules (Project-wide)

## 1) Design Direction
- Ưu tiên phong cách `minimal enterprise UI`.
- Tập trung khả năng đọc và thao tác nhanh, giảm trang trí không cần thiết.
- Màu sắc trung tính, nhấn bằng một màu accent chính.

## 2) Token Cơ Bản
- Không hard-code màu rải rác; dùng biến CSS tại `:root`.
- Nhóm biến tối thiểu:
  - `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`
  - `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`
  - `--radius-sm`, `--radius-md`
  - `--space-1 ... --space-6`
- Chỉ dùng 1 hệ radius chính: `8px` cho panel/overlay, `4-6px` cho element nhỏ.

## 3) Typography
- Font mặc định: `Arial, sans-serif` (hoặc một font sans nhất quán toàn app).
- Cỡ chữ chuẩn:
  - Body: `13px-14px`
  - Label/meta: `12px`
  - Section title: `16px-18px`
- Line-height khuyến nghị: `1.4-1.6`.

## 4) Layout & Spacing
- Dùng hệ spacing nhất quán (4/8px scale).
- Khoảng cách giữa block lớn: `12px-16px`.
- Tránh margin/padding ngẫu nhiên; ưu tiên dùng token spacing.
- Ưu tiên `flex/grid`; hạn chế absolute nếu không cần.

## 5) Component Rules
- Button:
  - Có trạng thái `default/hover/disabled/loading`.
  - Disabled phải giảm tương phản và tắt pointer.
- Input/Select:
  - Cùng chiều cao, border, font-size.
  - Focus state rõ ràng (border hoặc ring).
- Table:
  - Header rõ ràng, font nhỏ hơn body một chút nếu cần.
  - Dòng clickable phải có hover-state.
- Modal/Overlay:
  - Overlay nền mờ, panel/surface rõ ràng, không dùng hiệu ứng nặng.
- Loading:
  - Dùng component chung (`loading-overlay.ts`), không viết lại mỗi màn.

## 6) Color & Contrast
- Đảm bảo contrast đủ đọc (ưu tiên mức gần WCAG AA).
- Không dùng quá 1 màu accent chính trên cùng 1 màn.
- Các màu trạng thái:
  - Success: xanh lá nhẹ
  - Warning: vàng/cam nhạt
  - Danger: đỏ nhạt
  - Info: xanh dương nhạt

## 7) Motion & Effects
- Animation ngắn, mục tiêu rõ (`<= 200ms` cho hover/focus; spinner riêng có thể dài hơn).
- Tránh animation gây phân tán (bounce, pulse mạnh).
- Shadow nhẹ, nhất quán, không chồng nhiều lớp.

## 8) Responsive
- Ưu tiên desktop-first cho dashboard, nhưng không vỡ ở màn nhỏ.
- Ở viewport nhỏ:
  - Filter và toolbar phải wrap hợp lý.
  - Không để text/button tràn container.
  - Table dài cần xử lý overflow hợp lý.

## 9) Naming & Structure
- Dùng tên class mô tả vai trò (`.panel-head`, `.topic-tab`, `.dashboard-loading-box`).
- Tránh selector quá sâu (`.a .b .c .d`) để giảm độ phụ thuộc cấu trúc DOM.
- Mỗi component có block style riêng, tránh side-effect toàn cục.

## 10) Reuse & Governance
- Style chung đặt trong file dùng chung; màn riêng chỉ override phần thực sự cần.
- Khi thêm component mới, kiểm tra:
  1. Đã có component tương đương để reuse chưa?
  2. Có phá vỡ token màu/spacing/radius không?
  3. Có đủ state `hover/focus/disabled/loading` chưa?

## 11) Things To Avoid
- Không dùng nhiều gradient/trang trí gây nhiễu ở màn nghiệp vụ.
- Không đổi font-size theo viewport width.
- Không tạo thêm palette mới nếu chưa có lý do rõ ràng.
- Không lặp lại logic UI loading/toast/modal ở nhiều nơi.

