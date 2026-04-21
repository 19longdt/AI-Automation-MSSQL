# Nhóm 3: Sản phẩm & Kho hàng

---

## Bảng: `product`
**Mô tả:** Danh mục sản phẩm / dịch vụ của công ty. Hỗ trợ nhiều loại hình: sản phẩm thông thường, combo, dịch vụ, thuốc (nhà thuốc/phòng khám), sản phẩm có quản lý IMEI/Serial.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty sở hữu sản phẩm |
| code | nvarchar(50) | NULL | — | Mã sản phẩm chính |
| code2 | nvarchar(100) | NULL | — | Mã sản phẩm phụ (mã thứ hai, dùng khi tích hợp hệ thống khác) |
| name | nvarchar(500) | NULL | — | Tên sản phẩm |
| normalized_name | nvarchar(512) | NULL | — | Tên đã chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| unit | nvarchar(255) | NULL | — | Tên đơn vị tính mặc định (denormalized) |
| unit_id | int | NULL | — | FK → product_unit.id — Đơn vị tính chính |
| in_price | decimal(21,6) | NULL | — | Giá nhập (giá vốn mua vào) |
| out_price | decimal(21,6) | NULL | — | Giá bán chưa bao gồm thuế |
| out_price_tax | decimal(21,6) | NULL | — | Giá bán đã bao gồm thuế |
| vat_rate | decimal(21,6) | NULL | — | Thuế suất VAT (%) |
| discount_vat_rate | int | NULL | — | Thuế suất VAT áp dụng khi có chiết khấu |
| excise_tax_rate | int | NULL | — | Thuế suất thuế tiêu thụ đặc biệt (%) |
| bar_code | varchar(50) | NULL | — | Mã vạch chính |
| bar_code_2 | varchar(50) | NULL | — | Mã vạch phụ |
| image | nvarchar(500) | NULL | — | Đường dẫn ảnh sản phẩm |
| description | nvarchar(max) | NULL | — | Mô tả chi tiết sản phẩm |
| active | bit | NULL | — | Đang kinh doanh hay không (1=active, 0=ngừng bán) |
| status | int | NULL | — | Trạng thái (0=nháp, 1=đang bán, 2=hết hàng...) |
| type | int | NULL | — | Loại sản phẩm (1=sản phẩm, 2=dịch vụ, 3=combo...) |
| feature | int | NULL | — | Đặc tính (sản phẩm thường, combo, topping...) |
| is_topping | bit | NULL | — | Có phải topping hay không |
| inventory_tracking | bit | NULL | — | Có theo dõi tồn kho hay không |
| inventory_id | int | NULL | — | ID tồn kho liên kết |
| inventory_count | decimal(21,6) | NULL | — | Số lượng tồn kho tổng (denormalized để hiển thị nhanh) |
| minimum_stock | decimal(21,6) | NULL | — | Mức tồn kho tối thiểu — cảnh báo khi tồn kho dưới mức này |
| eb_id | int | NULL | — | ID trong hệ thống EB (tích hợp ngoài) |
| has_batch | int | NULL | — | Có quản lý theo lô/hạn sử dụng không (0=không, 1=có) |
| is_medicine | bit | NOT NULL | 0 | Có phải thuốc không — kích hoạt nghiệp vụ nhà thuốc |
| id_medicine | varchar(100) | NULL | — | Mã thuốc quốc gia (mã trong danh mục thuốc của Bộ Y tế) |
| registration_number | nvarchar(100) | NULL | — | Số đăng ký thuốc |
| active_ingredient | nvarchar(512) | NULL | — | Hoạt chất / thành phần chính của thuốc |
| treatment_info | nvarchar(max) | NULL | — | Thông tin điều trị (JSON — chỉ định, chống chỉ định...) |
| is_imei_serial_management | bit | NOT NULL | 0 | Có quản lý theo IMEI/Serial number không (dùng cho điện tử, thiết bị) |
| platform | nvarchar(max) | NULL | — | Nền tảng bán hàng áp dụng (JSON — POS, online, app...) |
| extra | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_product_comId_code_active_included` | (com_id, code, active) | name, out_price, image, code2 | Tìm sản phẩm theo mã trong công ty |
| `idx_product_comId_name_included` | (com_id, name, active) | code, code2 | Tìm sản phẩm theo tên |
| `idx_product_comId_active` | (com_id, active) | — | Lọc sản phẩm đang bán |
| `idx_product_comId_active_status` | (com_id, active, status) | — | Lọc sản phẩm theo trạng thái |

---

## Bảng: `product_unit`
**Mô tả:** Danh mục đơn vị tính (cái, hộp, thùng, kg, lít...) dùng chung trong công ty.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `product_unit_pk`) |
| com_id | int | NULL | FK → company.id — Công ty sở hữu đơn vị tính này |
| name | nvarchar(255) | NULL | Tên đơn vị tính |
| description | nvarchar(512) | NULL | Mô tả đơn vị tính |
| eb_id | int | NULL | ID trong hệ thống EB (tích hợp ngoài) |
| active | bit | NULL | Còn sử dụng không (1=active, 0=inactive) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_productUnit_comId` | (com_id) | Lấy danh sách đơn vị tính của công ty |

---

## Bảng: `product_product_unit` (PPU)
**Mô tả:** Bảng trung gian lưu các **đơn vị tính** của từng sản phẩm kèm giá và tỷ lệ quy đổi. Ví dụ: sản phẩm "Bia" có đơn vị "Lon" (đơn vị chính) và "Thùng 24 lon" (tỷ lệ 24:1). Đây là bảng trung tâm kết nối sản phẩm với hóa đơn, tồn kho, và bảng giá.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `product_product_unit_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| product_id | int | NULL | FK → product.id — Sản phẩm |
| product_unit_id | int | NULL | FK → product_unit.id — Đơn vị tính |
| unit_name | nvarchar(255) | NULL | Tên đơn vị (denormalized từ product_unit.name) |
| unit_normalized_name | nvarchar(512) | NULL | Tên đơn vị đã chuẩn hóa dùng tìm kiếm |
| product_name | nvarchar(512) | NULL | Tên sản phẩm (denormalized từ product.name) |
| normalized_name | varchar(800) | NULL | Tên sản phẩm + đơn vị đã chuẩn hóa dùng tìm kiếm |
| is_primary | bit | NULL | Có phải đơn vị chính không — đơn vị chính dùng để tính tồn kho |
| convert_rate | decimal(21,6) | NULL | Tỷ lệ quy đổi về đơn vị chính (VD: 1 thùng = 24 lon → convert_rate = 24) |
| formula | bit | NULL | Có dùng công thức quy đổi đặc biệt không |
| purchase_price | decimal(21,6) | NULL | Giá mua (nhập kho) theo đơn vị này |
| sale_price | decimal(21,6) | NULL | Giá bán theo đơn vị này |
| direct_sale | bit | NULL | Có cho phép bán trực tiếp theo đơn vị này không |
| on_hand | decimal(21,6) | NULL | Số lượng tồn kho theo đơn vị chính (denormalized để đọc nhanh) |
| bar_code | varchar(50) | NULL | Mã vạch riêng cho đơn vị này (VD: mã vạch thùng khác mã vạch lon) |
| other_prices | ntext | NULL | Bảng giá khác (JSON — giá sỉ, giá thành viên...) |
| ext_sale_price | nvarchar(max) | NULL | Giá bán mở rộng (JSON — theo thời điểm, theo khu vực...) |
| description | nvarchar(100) | NULL | Ghi chú về đơn vị tính này |
| parent_id | int | NULL | ID PPU cha — dùng cho variant (màu/size) của cùng một sản phẩm |
| min_quantity | decimal(21,6) | NULL | Số lượng tối thiểu phải mua theo đơn vị này |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | INCLUDE | WHERE | Ghi chú |
|-----------|-----|---------|-------|---------|
| `product_product_unit_com_id_index` | (com_id, is_primary) | id, parent_id | — | Lấy PPU chính của công ty |
| `product_product_unit_product_unit_id_index` | (product_unit_id) | — | — | Tra cứu theo đơn vị tính |
| `idx_com_id_product_id` | (com_id, product_id) | — | — | Lấy tất cả PPU của sản phẩm |
| `IX_product_product_unit_productId_isPrimary` | (product_id, is_primary) | product_unit_id, unit_name, min_quantity | — | Tra cứu đơn vị theo sản phẩm |
| `IX_ppu_primary_productid` | (product_id) | product_unit_id, unit_name | is_primary = 1 | **Filtered index** — chỉ index đơn vị chính |

---

## Bảng: `product_group`
**Mô tả:** Danh mục / nhóm sản phẩm, hỗ trợ cấu trúc cây phân cấp nhiều cấp (ví dụ: Đồ uống > Bia > Bia lon).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| name | nvarchar(512) | NULL | — | Tên nhóm sản phẩm |
| code | nvarchar(512) | NULL | — | Mã nhóm sản phẩm |
| normalized_name | nvarchar(512) | NULL | — | Tên đã chuẩn hóa dùng tìm kiếm |
| description | nvarchar(512) | NULL | — | Mô tả nhóm |
| parent_id | bigint | NULL | — | ID nhóm cha — NULL nếu là nhóm gốc |
| level | int | NULL | 1 | Cấp độ trong cây (1=gốc, 2=cấp 2...) |
| path | varchar(1024) | NULL | — | Đường dẫn đầy đủ trong cây (VD: /1/5/12/) — dùng để lấy toàn bộ cây con |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_productGroup_comId` | (com_id) | Lấy danh sách nhóm sản phẩm của công ty |

---

## Bảng: `product_product_group`
**Mô tả:** Gán sản phẩm vào nhóm (quan hệ nhiều-nhiều — một sản phẩm có thể thuộc nhiều nhóm).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| product_id | int | NOT NULL | FK → product.id — Sản phẩm |
| product_group_id | int | NOT NULL | FK → product_group.id — Nhóm sản phẩm |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `product_product_group_product_id_fk` | product_id | product(id) |
| `product_product_group_product_group_id_fk_2` | product_group_id | product_group(id) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_product_product_group_product_id_index` | (product_id) | — | Lấy danh sách nhóm của sản phẩm |
| `idx_ProductProductGroup_productGroupId` | (product_group_id) | product_id | Lấy danh sách sản phẩm trong nhóm |

---

## Bảng: `attribute`
**Mô tả:** Định nghĩa thuộc tính biến thể sản phẩm (Màu sắc, Kích cỡ...). Mỗi thuộc tính có nhiều giá trị trong bảng `variant`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `attribute_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| name | nvarchar(400) | NULL | Tên thuộc tính (VD: Màu sắc, Kích cỡ) |
| normalized_name | varchar(400) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `attribute_com_id_index` | (com_id) | Lấy thuộc tính của công ty |
| `attribute_id_com_id_index` | (id, com_id) | Tra cứu nhanh thuộc tính theo id + công ty |

---

## Bảng: `variant`
**Mô tả:** Giá trị cụ thể của thuộc tính cho từng sản phẩm (VD: sản phẩm Áo thun → Màu sắc: Đỏ, Xanh, Trắng).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `variant_pk`) |
| product_id | int | NULL | FK → product.id — Sản phẩm chứa biến thể này |
| attribute_id | int | NULL | FK → attribute.id — Thuộc tính (Màu sắc, Kích cỡ...) |
| name | nvarchar(400) | NULL | Giá trị biến thể (VD: Đỏ, L, XL) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

---

## Bảng: `product_imei_serial`
**Mô tả:** Quản lý IMEI / Serial number của từng sản phẩm riêng lẻ. Dùng cho sản phẩm điện tử, thiết bị khi `product.is_imei_serial_management = 1`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | bigint IDENTITY | NOT NULL | Khóa chính, tự tăng |
| com_id | int | NULL | FK → company.id — Công ty |
| product_id | int | NULL | FK → product.id — Sản phẩm |
| product_product_unit_id | int | NULL | FK → product_product_unit.id — Đơn vị tính |
| code | nvarchar(100) | NULL | Mã IMEI hoặc Serial number |
| warehouse_id | int | NULL | FK → warehouse.id — Kho đang chứa |
| status | tinyint | NULL | Trạng thái (0=mới/tồn kho, 1=đã bán, 2=đã trả, ...) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `ux_pis_com_product_code` (UNIQUE) | (com_id, product_id, code) | Mỗi IMEI/Serial chỉ tồn tại một lần trong một công ty |

---

## Bảng: `product_material`
**Mô tả:** BOM (Bill of Materials) — công thức nguyên liệu để sản xuất/pha chế một sản phẩm. Dùng trong nghiệp vụ quản lý nguyên liệu cho nhà hàng, sản xuất.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `product_material_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| product | int | NULL | FK → product.id — Sản phẩm thành phẩm |
| product_material | int | NULL | FK → product.id — Sản phẩm nguyên liệu |
| quantity | decimal(21,6) | NULL | Số lượng nguyên liệu cần để tạo ra 1 đơn vị thành phẩm |
| status | varchar(20) | NULL | Trạng thái bản ghi (active/inactive) |
| integration_key_material | varchar(50) | NULL | Khóa tích hợp của nguyên liệu với hệ thống ngoài |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `product_material_com_id_product_index` | (com_id, product) | Lấy công thức nguyên liệu của sản phẩm |

---

## Bảng: `product_pairing_progress`
**Mô tả:** Theo dõi tiến trình ghép đôi (pairing) sản phẩm giữa hệ thống nội bộ và hệ thống ngoài (dược quốc gia, tích hợp sàn thương mại...). Mỗi công ty chỉ có một bản ghi (unique theo `com_id`).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | bigint IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NOT NULL | — | FK → company.id — Công ty (duy nhất) |
| total_products | int | NOT NULL | 0 | Tổng số sản phẩm cần xử lý |
| success_count | int | NOT NULL | 0 | Số sản phẩm ghép đôi thành công |
| failed_count | int | NOT NULL | 0 | Số sản phẩm ghép đôi thất bại |
| status | varchar(20) | NULL | 'PENDING' | Trạng thái tiến trình (PENDING / RUNNING / DONE / FAILED) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | getdate() | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | getdate() | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_product_pairing_comId` (UNIQUE) | (com_id) | Mỗi công ty chỉ có một bản ghi tiến trình |

---

## Bảng: `combo_group`
**Mô tả:** Nhóm lựa chọn trong một sản phẩm combo (VD: combo "Gà + Nước" có nhóm "Chọn nước uống" gồm Pepsi/7UP/Sting). Mỗi combo có thể có nhiều nhóm.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| com_id | int | NULL | FK → company.id — Công ty |
| product_product_unit_id | int | NULL | FK → product_product_unit.id — PPU của sản phẩm combo chứa nhóm này |
| type | int | NOT NULL | Loại nhóm (1=chọn một, 2=chọn nhiều...) |
| is_require | bit | NULL | Bắt buộc phải chọn hay không |
| group_name | nvarchar(255) | NULL | Tên nhóm lựa chọn (VD: "Chọn nước uống") |
| maximum | decimal(21,6) | NULL | Số lượng tối đa được chọn trong nhóm |
| minimum | decimal(21,6) | NULL | Số lượng tối thiểu phải chọn trong nhóm |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `combo_group_com_id_product_product_unit_id_index` | (com_id, product_product_unit_id) | Lấy danh sách nhóm của một sản phẩm combo |

---

## Bảng: `combo_product_product_unit`
**Mô tả:** Danh sách sản phẩm (PPU) có thể chọn trong một combo group.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| com_id | int | NULL | FK → company.id — Công ty |
| combo_group_id | int | NULL | FK → combo_group.id — Nhóm lựa chọn thuộc về |
| product_product_unit_id | int | NULL | FK → product_product_unit.id — Sản phẩm có thể chọn |
| product_id | int | NULL | FK → product.id — Sản phẩm (denormalized) |
| quantity | int | NULL | Số lượng mặc định khi chọn sản phẩm này |
| warehouse_id | int | NULL | FK → warehouse.id — Kho xuất khi chọn sản phẩm này |
| extra_price | decimal(21,6) | NULL | Giá tăng thêm khi chọn sản phẩm này (nếu là option trả thêm) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `combo_product_product_unit_com_id_combo_group_id_product_product_unit_id_index` | (com_id, combo_group_id, product_product_unit_id) | Lấy sản phẩm trong nhóm combo |

---

## Bảng: `product_topping`
**Mô tả:** Gán topping cho sản phẩm — xác định sản phẩm nào được phép thêm topping nào.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `product_topping_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| product_id | int | NULL | FK → product.id — Sản phẩm chính (được gắn topping) |
| topping_id | int | NULL | FK → product.id — Sản phẩm topping |
| topping_group_id | int | NULL | FK → topping_group.id — Nhóm topping chứa topping này |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `product_topping_com_id_product_id_index` | (com_id, product_id) | Lấy danh sách topping của sản phẩm |

---

## Bảng: `topping_group`
**Mô tả:** Nhóm topping — gom các topping liên quan thành nhóm (VD: "Topping trà sữa" gồm trân châu, thạch, pudding...).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `topping_group_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| name | nvarchar(400) | NULL | Tên nhóm topping |
| normalized_name | nvarchar(400) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| required_optional | bit | NULL | Bắt buộc chọn (1) hay tùy chọn (0) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

---

## Bảng: `topping_topping_group`
**Mô tả:** Gán sản phẩm vào nhóm topping (quan hệ nhiều-nhiều giữa topping và nhóm).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `topping_topping_group_pk`) |
| topping_group_id | int | NULL | FK → topping_group.id — Nhóm topping |
| product_id | int | NULL | FK → product.id — Sản phẩm topping thuộc nhóm này |
| product_name | nvarchar(400) | NULL | Tên sản phẩm topping (denormalized) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `topping_topping_group_topping_group_id_fk` | topping_group_id | topping_group(id) |

---

## Bảng: `warehouse`
**Mô tả:** Kho hàng của công ty. Một công ty có thể có nhiều kho (kho chính, kho chi nhánh, kho consignment...). Kho có `is_sellable = 1` cho phép bán hàng trực tiếp từ kho.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `warehouse_pk`) |
| com_id | int | NOT NULL | FK → company.id — Công ty sở hữu kho |
| name | nvarchar(500) | NOT NULL | Tên kho |
| normalized_name | varchar(200) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| code | varchar(20) | NULL | Mã kho |
| SKU | nvarchar(200) | NULL | SKU / mã định danh kho trong hệ thống logistics |
| phone | varchar(20) | NULL | Số điện thoại kho |
| address | nvarchar(500) | NULL | Địa chỉ kho |
| description | nvarchar(500) | NULL | Mô tả kho |
| is_sellable | bit | NULL | Có cho phép bán hàng trực tiếp từ kho này không |
| status | bit | NULL | Trạng thái hoạt động (1=active, 0=inactive) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_com_id` | (com_id) | Lấy danh sách kho của công ty |

---

## Bảng: `inventory`
**Mô tả:** Tồn kho hiện tại theo từng sản phẩm (PPU) / kho / lô. Đây là bảng snapshot tồn kho thực tế tại thời điểm hiện tại, được cập nhật sau mỗi giao dịch nhập/xuất.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `inventory_pk`) |
| com_id | int | NOT NULL | FK → company.id — Công ty |
| warehouse_id | int | NOT NULL | FK → warehouse.id — Kho chứa hàng |
| product_id | int | NULL | FK → product.id — Sản phẩm |
| ppu_id | int | NULL | FK → product_product_unit.id — Đơn vị tính sản phẩm |
| on_hand | decimal(21,6) | NULL | Số lượng tồn kho hiện tại |
| is_primary | bit | NULL | Đơn vị tính này có phải đơn vị chính không |
| batch_id | int | NULL | FK → batches.id — Lô hàng (nếu quản lý theo lô) |
| ref_id | int | NULL | ID tham chiếu giao dịch cuối cập nhật tồn kho |
| platform | varchar(30) | NULL | Nền tảng tạo bản ghi tồn kho |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `inventory_warehouse_id_fk` | warehouse_id | warehouse(id) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `inventory_com_id_ppu_id_index` | (com_id, ppu_id) | — | Tra cứu tồn kho theo sản phẩm |
| `inventory_com_id_warehouse_id_index` | (com_id, warehouse_id) | ppu_id, on_hand | Lấy tồn kho theo kho — covering index |

---

## Bảng: `inventory_log`
**Mô tả:** Nhật ký thay đổi tồn kho — ghi lại từng yêu cầu thay đổi tồn kho (chờ xử lý / đã xử lý). Dùng để xử lý bất đồng bộ cập nhật tồn kho khi có nhiều giao dịch đồng thời.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `inventory_log_pk`) |
| com_id | int | NOT NULL | FK → company.id — Công ty |
| log_time | datetime | NULL | Thời điểm phát sinh thay đổi tồn kho |
| product_id | int | NULL | FK → product.id — Sản phẩm |
| ppu_id | int | NULL | FK → product_product_unit.id — Đơn vị tính |
| quantity | decimal(21,6) | NULL | Số lượng thay đổi (dương=nhập, âm=xuất) |
| is_primary | bit | NULL | Số lượng tính theo đơn vị chính không |
| warehouse_id | int | NULL | FK → warehouse.id — Kho |
| status | int | NOT NULL | Trạng thái xử lý (0=chờ, 1=đã xử lý, 2=lỗi) |
| ref_bill_id | int | NULL | FK → bill.id — Hóa đơn gốc gây ra thay đổi |
| message | nvarchar(500) | NULL | Thông báo lỗi nếu xử lý thất bại |
| batch_id | int | NULL | FK → batches.id — Lô hàng liên quan |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `inventory_check_index` | (com_id, status, product_id, ppu_id, warehouse_id) | id, quantity | Tìm log chờ xử lý theo sản phẩm/kho |
| `idx_inventory_log_status` | (status DESC) | — | Lấy log chờ xử lý (status nhỏ trước) |

---

## Bảng: `batches`
**Mô tả:** Lô hàng / quản lý hạn sử dụng. Dùng cho sản phẩm có `product.has_batch = 1` (thực phẩm, thuốc, hóa chất...).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `batches_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| code | nvarchar(50) | NULL | Mã lô hàng |
| normalized_name | varchar(500) | NULL | Tên/mã lô đã chuẩn hóa dùng tìm kiếm |
| lot_no | nvarchar(50) | NULL | Số lô (lot number — in trên bao bì sản phẩm) |
| mfg_date | datetime | NULL | Ngày sản xuất |
| exp_date | datetime | NULL | Ngày hết hạn sử dụng |
| status | int | NULL | Trạng thái lô (0=đang dùng, 1=hết hạn, 2=thu hồi...) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `batches_id_com_id_index` | (id, com_id) | Tra cứu lô theo id + công ty |

---

## Bảng: `batches_detail`
**Mô tả:** Chi tiết sản phẩm (PPU) thuộc lô hàng — xác định lô nào chứa sản phẩm nào.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `batches_detail_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| batch_id | int | NULL | FK → batches.id — Lô hàng |
| ppu_id | int | NULL | FK → product_product_unit.id — Sản phẩm/đơn vị thuộc lô |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `batches_detail_com_id_ppu_id_index2` | (com_id, ppu_id) | Tìm lô hàng chứa một sản phẩm cụ thể |

---

## Bảng: `price_list`
**Mô tả:** Bảng giá bán — cho phép định nghĩa nhiều bảng giá khác nhau (giá lẻ, giá sỉ, giá thành viên, giá theo mùa...) với thời gian áp dụng.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `price_list_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| name | nvarchar(400) | NULL | Tên bảng giá |
| normalized_name | nvarchar(400) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| start_date | datetime | NULL | Thời điểm bắt đầu áp dụng bảng giá |
| end_date | datetime | NULL | Thời điểm kết thúc áp dụng bảng giá (NULL = không giới hạn) |
| extra | nvarchar(max) | NULL | Cấu hình mở rộng (JSON — điều kiện áp dụng, khu vực, loại khách...) |
| active | bit | NULL | Bảng giá đang kích hoạt không |
| is_default | bit | NULL | Bảng giá mặc định (dùng khi không có bảng giá nào phù hợp) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `price_list_com_id_active_index` | (com_id, active) | Lấy bảng giá đang áp dụng của công ty |

---

## Bảng: `price_list_product`
**Mô tả:** Giá bán của từng sản phẩm (PPU) trong mỗi bảng giá. Khi bán hàng, hệ thống tra bảng này để lấy giá theo bảng giá đang áp dụng.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `price_list_product_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| price_list_id | int | NULL | FK → price_list.id — Bảng giá |
| product_product_unit_id | int | NULL | FK → product_product_unit.id — Sản phẩm/đơn vị |
| unit_price | decimal(21,6) | NULL | Giá bán theo bảng giá này |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Mô tả |
|-----|------|-----|-------|
| `price_list_product_pk2` | UNIQUE | (com_id, price_list_id, product_product_unit_id) | Mỗi sản phẩm chỉ có một giá trong mỗi bảng giá |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `price_list_product_com_id_price_list_id_product_product_unit_id_index` | (com_id, price_list_id, product_product_unit_id) | — | Tra cứu giá theo bảng giá |
| `idx_price_list_product_price_list_id_product_product_unit_id` | (product_product_unit_id, price_list_id) | unit_price | Covering index — lấy giá theo sản phẩm không cần lookup |

### Bảng `treatment_product`
Sản phẩm điều trị (phòng khám/spa).

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK |
| com_id | int | NOT NULL |
| product_id | int | NOT NULL |
| product_product_unit_id | int | FK → product_product_unit |
| product_parent_id | int | ID liệu trình cha |
| quantity | int | Số buổi/lần |
| warehouse_id | int | Kho áp dụng |
| create_time | datetime | DEFAULT getdate() |
---

### Bảng `business`
Danh mục ngành nghề.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK (`business_pk`) |
| type | int | Loại hình |
| name | nvarchar(255) | Tên ngành |

---

### Bảng `business_type`
Loại nghiệp vụ kế toán của công ty.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK |
| com_id | int | Công ty |
| business_type_code | nvarchar(400) | Mã loại nghiệp vụ |
| business_type_name | nvarchar(400) | Tên loại nghiệp vụ |
| type | nvarchar(50) | Loại (thu/chi) |

**Indexes:**
- `idx_businessType_comId` — (com_id)

## Quan hệ giữa các bảng trong nhóm

```
product (1) ──── (N) product_product_unit (PPU)  ←── trung tâm kết nối
                         │
              ┌──────────┼──────────────┬──────────────┐
              ▼          ▼              ▼              ▼
          inventory  bill_product  price_list_product  rs_inoutward_detail

product (1) ──── (N) product_product_group ──── (N) product_group (cây)
product (1) ──── (N) product_material (BOM)
product (1) ──── (N) product_topping ──── (N) topping_group
product (1) ──── (N) variant ──── (N) attribute
product_product_unit (1) ──── (N) product_imei_serial
product_product_unit (1) ──── (N) batches_detail ──── (N) batches
product_product_unit (1) ──── (N) combo_group ──── (N) combo_product_product_unit
warehouse (1) ──── (N) inventory
```

**Luồng định giá:**
1. Khi tạo hóa đơn, hệ thống xác định `price_list` đang áp dụng cho công ty/khách hàng
2. Tra `price_list_product` để lấy `unit_price` theo PPU và bảng giá
3. Nếu không có trong bảng giá → lấy `product_product_unit.sale_price` mặc định

**Luồng tồn kho:**
1. Giao dịch bán hàng / nhập xuất ghi vào `inventory_log` (status=chờ xử lý)
2. Job background xử lý `inventory_log` → cập nhật `inventory.on_hand`
3. `product_product_unit.on_hand` được đồng bộ từ `inventory` (denormalized)

## Bảng: `rs_inoutward`
**Mô tả:** Phiếu nhập/xuất/chuyển kho. Partition theo quý (`norm_quarter`). Liên kết với hóa đơn bán hàng (`bill_id`), khách hàng, nhà cung cấp.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| com_id | int | NULL | — | FK → company.id — Công ty |
| type | int | NULL | — | Loại phiếu (1=nhập, 2=xuất, 3=chuyển kho...) |
| date | datetime | NULL | — | Ngày lập phiếu |
| no | nvarchar(25) | NULL | — | Số phiếu nhập/xuất |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng liên quan |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng (denormalized) |
| quantity | decimal(21,6) | NULL | — | Tổng số lượng |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng (trước giảm giá) |
| discount_amount | decimal(21,6) | NULL | — | Số tiền chiết khấu |
| cost_amount | decimal(21,6) | NULL | — | Tổng giá vốn |
| total_amount | decimal(21,6) | NULL | — | Tổng tiền thanh toán |
| business_type_id | int | NULL | — | Loại nghiệp vụ kho |
| payment_method | nvarchar(50) | NULL | — | Phương thức thanh toán |
| description | nvarchar(1024) | NULL | — | Ghi chú phiếu |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng liên kết |
| type_desc | nvarchar(50) | NULL | — | Mô tả loại phiếu (denormalized) |
| supplier_id | int | NULL | — | FK → (nhà cung cấp) |
| supplier_name | nvarchar(400) | NULL | — | Tên nhà cung cấp (denormalized) |
| eb_id | int | NULL | — | ID trong hệ thống EB (tích hợp ngoài) |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên khách hàng chuẩn hóa (tìm kiếm) |
| no2 | nvarchar(25) | NULL | — | Số chứng từ gốc / số tham chiếu thứ hai |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) — dùng trong index |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| status | bit | NULL | 1 | Trạng thái phiếu (1=hợp lệ, 0=hủy) |
| currency_unit | varchar(10) | NULL | — | Đơn vị tiền tệ |
| total_Pre_Tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế |
| vat_amount | decimal(21,6) | NULL | — | Tổng tiền VAT |
| payment_status | int | NULL | — | Trạng thái thanh toán |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_RsInOutWard` | PRIMARY KEY | (norm_quarter, id) | Partition ON psRsInOutWardQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_id` | (norm_quarter ASC, id DESC) | — | ON psRsInOutWardQuarter |
| `idx_norm_quarter_com_id_norm_date` | (norm_quarter, com_id, norm_date) | (id) | ON psRsInOutWardQuarter |
| `idx_RSInoutward_comId_type_date_billId` | (norm_quarter, com_id, type, date, bill_id) | (type_desc, quantity, total_amount, status) | ON psRsInOutWardQuarter |
| `idx_rs_inoutward_com_id_type_date` | (norm_quarter, com_id, type, date, business_type_id) | (no, customer_id, customer_name, quantity, total_amount, payment_method, supplier_id, supplier_name, no2) | Covering index tra cứu phiếu — ON psRsInOutWardQuarter |
| `idx_rs_inoutward_bill_id_nc` | (norm_quarter, bill_id) | — | ON psRsInOutWardQuarter |

---

## Bảng: `rs_inoutward_detail`
**Mô tả:** Chi tiết từng dòng sản phẩm trong phiếu nhập/xuất kho. Partition theo quý (`norm_quarter`). Lưu đầy đủ thông tin đơn vị, lô hàng, kho nguồn/đích cho phép chuyển kho.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| rs_inoutward_id | int | NULL | — | FK → rs_inoutward.id — Phiếu nhập/xuất kho cha |
| product_id | int | NULL | — | FK → product.id — Sản phẩm |
| product_name | nvarchar(400) | NULL | — | Tên sản phẩm (denormalized) |
| quantity | decimal(21,6) | NULL | — | Số lượng |
| unit_price | decimal(21,6) | NULL | — | Đơn giá |
| amount | decimal(21,6) | NULL | — | Thành tiền (quantity × unit_price) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| position | int | NULL | — | Thứ tự dòng trong phiếu |
| lot_no | nvarchar(50) | NULL | — | Số lô hàng |
| product_code | varchar(50) | NULL | — | Mã sản phẩm (denormalized) |
| unit_name | nvarchar(50) | NULL | — | Tên đơn vị tính (denormalized) |
| discount_amount | decimal(21,6) | NULL | — | Số tiền chiết khấu dòng hàng |
| total_amount | decimal(21,6) | NULL | — | Tổng tiền sau chiết khấu |
| product_normalized_name | nvarchar(512) | NULL | — | Tên sản phẩm chuẩn hóa (tìm kiếm) |
| unit_id | int | NULL | — | FK → product_unit.id — Đơn vị tính |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id — Liên kết sản phẩm-đơn vị |
| main_unit_id | int | NULL | — | ID đơn vị tính chính |
| main_unit_name | nvarchar(100) | NULL | — | Tên đơn vị tính chính (denormalized) |
| convert_rate | decimal(21,6) | NULL | — | Tỉ lệ quy đổi sang đơn vị chính |
| main_quantity | decimal(21,6) | NULL | — | Số lượng quy đổi về đơn vị chính |
| from_warehouse_id | int | NULL | — | FK → warehouse.id — Kho xuất (chuyển kho) |
| to_warehouse_id | int | NULL | — | FK → warehouse.id — Kho nhập (chuyển kho) |
| batch_id | int | NULL | — | FK → batches.id — Lô hàng liên kết |
| cost_amount | decimal(21,6) | NULL | — | Giá vốn dòng hàng |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| discount | decimal(21,6) | NULL | — | Tỉ lệ chiết khấu (%) |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| com_id | int | NULL | — | FK → company.id — Công ty |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_rs_inoutward_detail` | PRIMARY KEY | (norm_quarter, id) | Partition ON psRsInOutWardDetailQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_id` | (norm_quarter ASC, id DESC) | — | ON psRsInOutWardDetailQuarter |
| `idx_rs_inoutward_id` | (norm_quarter, rs_inoutward_id) | (from_warehouse_id, to_warehouse_id, batch_id) | Tra cứu chi tiết theo phiếu — ON psRsInOutWardDetailQuarter |
| `idx_rs_inoutward_detail_ppuId_rsInoutwardId` | (norm_quarter, product_product_unit_id, rs_inoutward_id) | — | ON psRsInOutWardDetailQuarter |
| `idx_rs_inoutward_detail_fromWarehouseId` | (norm_quarter, from_warehouse_id) | — | ON psRsInOutWardDetailQuarter |
| `idx_rs_inoutward_detail_toWarehouseId` | (norm_quarter, to_warehouse_id) | — | ON psRsInOutWardDetailQuarter |

---

## Bảng: `adjust_inv`
**Mô tả:** Phiếu điều chỉnh tồn kho thủ công. Ghi lại các lần điều chỉnh số lượng tồn kho ngoài các giao dịch nhập/xuất thông thường.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| inv_id | int | NULL | — | FK → inventory.id — Bản ghi tồn kho được điều chỉnh |
| adjust_inv | int | NULL | — | Số lượng điều chỉnh (dương=tăng, âm=giảm) |
| description | nvarchar(500) | NULL | — | Lý do/ghi chú điều chỉnh |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| type | int | NULL | — | Loại điều chỉnh |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `adjust_inv_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_adjust_inv_adjustInv` | (adjust_inv) | — | Tra cứu theo số lượng điều chỉnh |

---

## Quan hệ giữa các bảng trong nhóm 8

```
rs_inoutward (1) ──── (N) rs_inoutward_detail
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
          product     product_product_unit   batches
              │               │
              ▼               ▼
          warehouse      from/to_warehouse_id

bill (1) ──── (N) rs_inoutward  (nhập/xuất từ hóa đơn)
inventory (1) ──── (N) adjust_inv  (điều chỉnh tồn kho)
```

**Luồng nhập/xuất kho:**
1. Tạo phiếu `rs_inoutward` (type=nhập/xuất/chuyển) liên kết `bill_id` nếu từ hóa đơn bán hàng
2. Thêm từng dòng sản phẩm vào `rs_inoutward_detail` — ghi `from_warehouse_id`/`to_warehouse_id` khi chuyển kho
3. Số lượng quy đổi về đơn vị chính qua `convert_rate` → lưu vào `main_quantity`
4. Sau khi xác nhận phiếu → cập nhật `inventory.on_hand` và `inventory_log`
5. Điều chỉnh thủ công ngoài luồng → dùng `adjust_inv` ghi nhận thay đổi vào `inventory`

 