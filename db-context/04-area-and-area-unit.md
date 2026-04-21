# Nhóm 4: Khu vực & Bàn/Phòng

---

## Bảng: `area`
**Mô tả:** Khu vực trong nhà hàng/khách sạn (tầng, khu vực, phòng...). Mỗi khu vực có thể chứa nhiều bàn/phòng (`area_unit`). Hỗ trợ cấu hình sức chứa tiêu chuẩn và tối đa cho từng loại khách (người lớn/trẻ em).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| name | nvarchar(255) | NULL | — | Tên khu vực |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| ext_sale_price | nvarchar(max) | NULL | — | Giá bán mở rộng theo khung giờ/loại (JSON) |
| description | nvarchar(512) | NULL | — | Mô tả khu vực |
| adult_standard | int | NULL | — | Số người lớn tiêu chuẩn |
| child_standard | int | NULL | — | Số trẻ em tiêu chuẩn |
| adult_max | int | NULL | — | Số người lớn tối đa |
| child_max | int | NULL | — | Số trẻ em tối đa |
| data_info | nvarchar(max) | NULL | — | Thông tin bổ sung (JSON) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `area_com_id_index` | (com_id) | — | Lọc khu vực theo công ty |

---

## Bảng: `area_unit`
**Mô tả:** Đơn vị trong khu vực — bàn, phòng, ghế, cabin... Mỗi `area_unit` thuộc một `area`. Có thể liên kết với sản phẩm/dịch vụ (`product_product_unit_id`) để tính giá phòng theo giờ. Hỗ trợ liên kết thiết bị POS và cấu hình đầu đọc thẻ tại bàn.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| area_id | varchar(26) | NULL | — | FK → area.id — Khu vực chứa bàn/phòng này |
| name | nvarchar(255) | NULL | — | Tên bàn/phòng (VD: Bàn 01, Phòng VIP 1) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| normalized_name | varchar(512) | NULL | — | Tên chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id — Sản phẩm/dịch vụ liên kết (giá phòng, dịch vụ bàn) |
| ref_device_id | varchar(255) | NULL | — | ID thiết bị POS liên kết tại bàn/phòng này |
| print_config | nvarchar(512) | NULL | — | Cấu hình máy in cho bàn/phòng (JSON) |
| config_ext | nvarchar(512) | NULL | — | Cấu hình mở rộng (JSON) |
| reader_status | bit | NULL | — | Trạng thái đầu đọc thẻ tại bàn (1=hoạt động) |
| data_info | nvarchar(max) | NULL | — | Thông tin bổ sung (JSON) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_area_unit_comId_areaId` | (com_id, area_id) | — | Lấy danh sách bàn theo khu vực |
| `idx_area_unit_ppuId` | (product_product_unit_id) | (com_id, area_id, name, create_time, update_time, ref_device_id, config_ext, reader_status) | Covering index — tra cứu bàn theo sản phẩm/dịch vụ không cần lookup |

---

## Quan hệ giữa các bảng trong nhóm 4

```
company (1) ──── (N) area (1) ──── (N) area_unit
                                          │
                              ┌───────────┴──────────────┐
                              ▼                           ▼
                  product_product_unit           reservation_detail
                  (giá phòng/dịch vụ)            (đặt bàn)
```

**Luồng quản lý bàn/khu vực:**
1. Quản trị tạo `area` (tầng/khu) → thêm `area_unit` (bàn/phòng) vào từng khu
2. Khi khách đến, nhân viên chọn bàn từ sơ đồ → tạo `bill` liên kết `area_unit_id`
3. Bàn có thể liên kết `product_product_unit_id` để tính giá theo giờ (mô hình karaoke/billard)
4. Đặt bàn trước → tạo `reservation` + `reservation_detail` gán `area_unit_id`

---

# Nhóm 5: Đặt bàn

---

## Bảng: `reservation`
**Mô tả:** Phiếu đặt bàn trước của khách hàng. Lưu thông tin người đặt, ngày/giờ đến dự kiến, số lượng khách, và trạng thái xử lý. Liên kết với khách hàng trong hệ thống nếu đã có tài khoản.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| customer_phone | varchar(50) | NULL | — | Số điện thoại người đặt bàn |
| customer_name | nvarchar(255) | NULL | — | Tên người đặt bàn |
| order_date | varchar(10) | NULL | — | Ngày đặt (định dạng văn bản YYYY-MM-DD) |
| order_time | varchar(10) | NULL | — | Giờ đặt (định dạng văn bản HH:MM) |
| arrival_time | varchar(30) | NULL | — | Giờ đến dự kiến |
| people_count | nvarchar(max) | NULL | — | Số lượng khách (JSON — người lớn/trẻ em) |
| note | nvarchar(255) | NULL | — | Ghi chú yêu cầu đặc biệt của khách |
| status | int | NULL | — | Trạng thái (0=chờ xác nhận, 1=đã xác nhận, 2=đã đến, 3=hủy...) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng trong hệ thống (nếu có) |
| buyer_name | nvarchar(255) | NULL | — | Tên người thanh toán (có thể khác người đặt) |
| expand | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| code | nvarchar(50) | NULL | — | Mã đặt bàn (hiển thị cho khách) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_reservation_comId_status` | (com_id, status) | — | Lọc danh sách đặt bàn theo trạng thái |

---

## Bảng: `reservation_detail`
**Mô tả:** Chi tiết bàn/phòng cụ thể trong một phiếu đặt bàn. Một phiếu đặt bàn có thể đặt nhiều bàn/phòng cùng lúc. Lưu giờ nhận/trả bàn và giá áp dụng.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| reservation_id | int | NULL | — | FK → reservation.id — Phiếu đặt bàn cha |
| area_unit_id | int | NULL | — | FK → area_unit.id — Bàn/phòng được đặt |
| check_in | datetime | NULL | — | Thời điểm nhận bàn/phòng thực tế |
| check_out | datetime | NULL | — | Thời điểm trả bàn/phòng thực tế |
| price_type | int | NULL | — | Loại giá áp dụng |
| amount | decimal | NULL | — | Giá trị thanh toán cho bàn/phòng này |
| status | int | NULL | — | Trạng thái dòng đặt (0=chờ, 1=đang dùng, 2=hoàn thành, 3=hủy) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `reservation_detail_pk` | PRIMARY KEY | (id) | — |

---

## Quan hệ giữa các bảng trong nhóm 5

```
customer (1) ──── (N) reservation (1) ──── (N) reservation_detail
                                                        │
                                                        ▼
                                                   area_unit
                                                        │
                                                        ▼
                                                      area
```

**Luồng đặt bàn:**
1. Khách gọi điện/đặt online → tạo `reservation` với `customer_phone`, `arrival_time`, `people_count`
2. Liên kết `customer_id` nếu số điện thoại trùng khách hàng trong hệ thống
3. Chọn bàn/phòng cụ thể → tạo `reservation_detail` với `area_unit_id` và thời gian dự kiến
4. Khi khách đến: cập nhật `status` reservation → `check_in` thực tế trong `reservation_detail`
5. Kết thúc sử dụng: cập nhật `check_out` → tính `amount` dựa trên thời gian và `price_type`
6. Tạo `bill` bán hàng liên kết với bàn để thanh toán

## Bảng: `processing_area`
**Mô tả:** Khu vực chế biến trong nhà hàng (bếp, bar, pha chế...). Mỗi khu vực có thể được cấu hình để nhận các loại sản phẩm cụ thể. Hỗ trợ chế độ kiểm tra tất cả sản phẩm (`param_check_all`).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| name | nvarchar(255) | NULL | — | Tên khu vực chế biến (VD: Bếp chính, Bar, Pha chế) |
| normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| setting | int | NULL | — | Cài đặt khu vực (bitmask) |
| active | int | NULL | — | Trạng thái hoạt động (1=đang hoạt động) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| param_check_all | bit | NULL | — | Khu vực nhận tất cả sản phẩm (không cần cấu hình từng món) |
| ids | nvarchar(max) | NULL | — | Danh sách ID liên quan (JSON) |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `processing_area_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `processing_area_com_id_index` | (com_id) | — | Lọc khu vực chế biến theo công ty |

---

## Bảng: `processing_area_product`
**Mô tả:** Gán sản phẩm/món ăn cho khu vực chế biến cụ thể. Xác định khi gọi món X thì phiếu chế biến gửi đến bếp nào. Bỏ qua nếu `processing_area.param_check_all = 1`.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| processing_area_id | int | NULL | — | FK → processing_area.id — Khu vực chế biến |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id — Sản phẩm được gán |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| com_id | int | NULL | — | FK → company.id — Công ty |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `processing_area_product_pk` | PRIMARY KEY | (id) | — |
| `processing_area_product_processing_area_id_fk` | FOREIGN KEY | (processing_area_id) → processing_area(id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_com_id_ppu_id` | (com_id, product_product_unit_id) | — | Tra cứu khu vực chế biến theo sản phẩm |
| `processing_area_product_product_product_unit_id_index` | (product_product_unit_id) | — | — |
| `processing_area_product_processing_area_id_index` | (processing_area_id DESC) | (product_product_unit_id) | Lấy danh sách sản phẩm của khu vực |

---

## Bảng: `processing_request`
**Mô tả:** Phiếu yêu cầu chế biến — order gửi từ bàn lên bếp/bar. Liên kết với hóa đơn (`bill_id`) và bàn (`area_unit_id`). Theo dõi trạng thái xử lý từ khi gửi đến khi hoàn thành.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng liên quan |
| area_unit_id | int | NULL | — | FK → area_unit.id — Bàn/phòng gửi yêu cầu |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| code | varchar(30) | NULL | — | Mã phiếu chế biến (hiển thị trên màn hình bếp) |
| request_type | int | NULL | — | Loại yêu cầu (gọi món mới, hủy món, thêm món...) |
| status | int | NULL | — | Trạng thái (0=chờ, 1=đang làm, 2=hoàn thành, 3=hủy) |
| notes | nvarchar(512) | NULL | — | Ghi chú của nhân viên phục vụ |
| com_id | int | NULL | — | FK → company.id — Công ty |
| session_id | varchar(50) | NULL | — | ID phiên làm việc (session) |
| total_pre_tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế |
| customer_name | nvarchar(512) | NULL | — | Tên khách hàng (denormalized) |
| staff_note | nvarchar(512) | NULL | — | Ghi chú nội bộ của nhân viên bếp |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `processing_request_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_processing_request_comId_areaUnitId_status` | (com_id, area_unit_id, status) | — | Lọc phiếu theo bàn và trạng thái |
| `idx_processing_request_billId` | (bill_id) | — | Tra cứu phiếu theo hóa đơn |

---

## Bảng: `processing_request_detail`
**Mô tả:** Chi tiết từng món ăn/sản phẩm trong phiếu yêu cầu chế biến. Mỗi dòng là một món gửi lên bếp, bao gồm cả topping.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| processing_request_id | int | NULL | — | FK → processing_request.id — Phiếu chế biến cha |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn liên quan |
| area_unit_id | int | NULL | — | FK → area_unit.id — Bàn gọi món |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id — Sản phẩm/món ăn |
| product_name | nvarchar(500) | NULL | — | Tên sản phẩm (denormalized) |
| quantity | decimal(21,6) | NULL | — | Số lượng yêu cầu chế biến |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| position | int | NULL | — | Thứ tự hiển thị trên màn hình bếp |
| is_topping | bit | NULL | — | Có phải topping của món chính không |
| ref_id | int | NULL | — | ID tham chiếu (liên kết với món chính nếu là topping) |
| description | nvarchar(max) | NULL | — | Ghi chú yêu cầu đặc biệt cho món (VD: ít cay, không hành) |
| total_pre_tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế của dòng món |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `processing_request_detail_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_processing_request_detail_bill_id` | (bill_id) | — | Tra cứu chi tiết theo hóa đơn |
| `idx_processing_request_detail_processing_request_id` | (processing_request_id) | — | Tra cứu chi tiết theo phiếu chế biến |

---

## Bảng: `processing_product`
**Mô tả:** Theo dõi trạng thái chế biến thực tế từng sản phẩm trong hóa đơn. Phân tách số lượng theo trạng thái: đang chế biến, đã xong, đã phục vụ, đã hủy, đã thông báo. Liên kết trực tiếp với `bill_product`.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn |
| request_detail_id | int | NULL | — | FK → processing_request_detail.id — Dòng yêu cầu chế biến |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id — Sản phẩm |
| ref_id | int | NULL | — | ID tham chiếu (liên kết topping với món chính) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| bill_product_id | int | NULL | — | FK → bill_product.id — Dòng sản phẩm trong hóa đơn |
| processing_quantity | decimal(21,6) | NULL | — | Số lượng đang chế biến |
| processed_quantity | decimal(21,6) | NULL | — | Số lượng đã chế biến xong |
| delivered_quantity | decimal(21,6) | NULL | — | Số lượng đã phục vụ cho khách |
| canceled_quantity | decimal(21,6) | NULL | — | Số lượng đã hủy |
| is_topping | bit | NULL | — | Có phải topping không |
| notified_quantity | decimal(21,6) | NULL | — | Số lượng đã thông báo (ready) |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `processing_product_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_processing_product_request_detail_id` | (request_detail_id) | — | Tra cứu trạng thái theo dòng yêu cầu |
| `idx_processing_product_bill_id` | (bill_id) | — | Tra cứu trạng thái chế biến theo hóa đơn |

---

## Quan hệ giữa các bảng trong nhóm 12

```
processing_area (1) ──── (N) processing_area_product ──── (1) product_product_unit

bill (1) ──── (N) processing_request (1) ──── (N) processing_request_detail
                        │                               │
                        ▼                               ▼
                   area_unit                  product_product_unit

bill_product (1) ──── (1) processing_product
processing_request_detail (1) ──── (N) processing_product
```

**Luồng gọi món & chế biến:**
1. Nhân viên gọi món tại bàn → hệ thống xác định món thuộc `processing_area` nào (qua `processing_area_product`)
2. Tạo `processing_request` liên kết `bill_id` + `area_unit_id` → gửi lên màn hình bếp/bar
3. Thêm từng món vào `processing_request_detail` (kèm topping nếu có, `ref_id` trỏ về món chính)
4. Bếp nhận phiếu → cập nhật `processing_product.processing_quantity` (bắt đầu làm)
5. Hoàn thành → tăng `processed_quantity`, thông báo phục vụ → tăng `notified_quantity`
6. Nhân viên phục vụ mang ra → tăng `delivered_quantity`
7. Nếu khách hủy → tăng `canceled_quantity`, cập nhật lại `bill_product`