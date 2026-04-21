# Nhóm 2: Khách hàng

---

## Bảng: `customer`
**Mô tả:** Danh sách khách hàng của từng công ty. Khách hàng có thể là cá nhân hoặc doanh nghiệp. Bảng hỗ trợ cả nghiệp vụ bán lẻ thông thường lẫn y tế (bác sĩ, đơn thuốc).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty sở hữu khách hàng này |
| name | nvarchar(400) | NULL | — | Tên khách hàng |
| normalized_name | varchar(512) | NULL | — | Tên đã chuẩn hóa (bỏ dấu, lowercase) — dùng để tìm kiếm không dấu |
| code | nvarchar(400) | NULL | — | Mã khách hàng chính |
| code2 | nvarchar(100) | NULL | — | Mã khách hàng phụ (mã thứ hai, dùng khi tích hợp hệ thống khác) |
| address | nvarchar(400) | NULL | — | Địa chỉ |
| city | nvarchar(50) | NULL | — | Tỉnh/thành phố |
| district | nvarchar(100) | NULL | — | Quận/huyện |
| phone_number | varchar(20) | NULL | — | Số điện thoại |
| email | varchar(200) | NULL | — | Email |
| tax_code | varchar(14) | NULL | — | Mã số thuế (dùng khi xuất hóa đơn VAT) |
| id_number | varchar(12) | NULL | — | CMND / CCCD |
| passport_no | varchar(50) | NULL | — | Số hộ chiếu |
| description | nvarchar(255) | NULL | — | Ghi chú về khách hàng |
| active | bit | NULL | — | Trạng thái hoạt động (1=active, 0=inactive) |
| type | int | NULL | — | Loại khách hàng (cá nhân, doanh nghiệp, đại lý...) |
| gender | int | NULL | 3 | Giới tính (1=nam, 2=nữ, 3=không xác định) |
| birthday | date | NULL | — | Ngày sinh |
| buyer_name | nvarchar(100) | NULL | — | Tên người mua trên hóa đơn (có thể khác tên khách hàng) |
| bank_no | varchar(50) | NULL | — | Số tài khoản ngân hàng của khách |
| bank_name | nvarchar(400) | NULL | — | Tên ngân hàng của khách |
| budgetary_relationship_code | varchar(50) | NULL | — | Mã quan hệ ngân sách — dùng cho khách hàng là đơn vị hành chính nhà nước |
| status_doctor | tinyint | NOT NULL | 0 | Trạng thái bác sĩ: 0=không phải bác sĩ, 1=đang hoạt động, ... (nghiệp vụ y tế) |
| error_publish_doctor | nvarchar(max) | NULL | — | Thông báo lỗi khi đăng ký/đồng bộ thông tin bác sĩ với hệ thống y tế |
| doctor_login_info | nvarchar(max) | NULL | — | Thông tin đăng nhập của bác sĩ vào hệ thống y tế (JSON) |
| extra_info | nvarchar(max) | NULL | — | Thông tin mở rộng tùy chỉnh (JSON) — lưu các thuộc tính bổ sung theo từng loại hình kinh doanh |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_customer_comId_name_active_included` | (com_id, name, active) | code, phone_number, tax_code, code2 | Tìm kiếm khách hàng theo tên trong một công ty |
| `idx_customer_comId_taxcode_active_included` | (com_id, tax_code, active) | name, code, code2 | Tìm kiếm khách hàng theo mã số thuế (xuất hóa đơn VAT) |
| `idx_Customer_ComId_Active_Type` | (com_id, active, type) | tax_code, code2, normalized_name | Lọc khách hàng theo loại và trạng thái |

---

## Bảng: `customer_card`
**Mô tả:** Thẻ thành viên / tích điểm của khách hàng. Mỗi khách hàng chỉ có tối đa **một thẻ** tại mỗi công ty (unique theo `com_id + customer_id`). Thẻ này liên kết với một hạng thẻ trong bảng `loyalty_card`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `customer_card_pk`) |
| com_id | int | NULL | FK → company.id — Công ty phát hành thẻ |
| customer_id | int | NULL | FK → customer.id — Khách hàng sở hữu thẻ |
| card_id | int | NULL | FK → loyalty_card.id — Hạng thẻ (Bronze, Silver, Gold...) |
| code | int | NULL | Mã số thẻ vật lý (in trên thẻ) |
| amount | decimal(20,6) | NULL | Tổng số tiền tích lũy từ trước đến nay (dùng để tính điều kiện lên hạng) |
| point | int | NULL | Điểm tích lũy hiện tại của khách hàng |
| start_date | date | NULL | Ngày kích hoạt thẻ / bắt đầu hiệu lực |
| expired_date | date | NULL | Ngày hết hạn thẻ |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Mô tả |
|-----|------|-----|-------|
| `customer_card_pk` | PRIMARY KEY | (id) | Khóa chính |
| `uq_customer_card_com_id_customer_id` | UNIQUE | (com_id, customer_id) | Mỗi khách hàng chỉ có một thẻ tại mỗi công ty |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_customer_card_com_id_customer_id` | (com_id, customer_id) | card_id, code, amount, point | Tra cứu thẻ của khách hàng — covering index cho màn hình thông tin khách |
| `idx_customer_card_cardId` | (card_id) | — | Lấy danh sách khách hàng theo hạng thẻ |

## Bảng: `loyalty_card`
**Mô tả:** Định nghĩa các hạng thẻ thành viên của công ty (Bronze, Silver, Gold...). Mỗi hạng có thứ tự ưu tiên (`rank`) và một hạng được đánh dấu là mặc định khi khách hàng mới tham gia.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `loyalty_card_pk`) |
| com_id | int | NULL | FK → company.id — Công ty sở hữu hạng thẻ này |
| name | nvarchar(400) | NULL | Tên hạng thẻ (VD: Bronze, Silver, Gold) |
| normalized_name | nvarchar(400) | NULL | Tên đã chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| is_default | bit | NULL | Hạng thẻ mặc định khi khách hàng mới đăng ký (1=có, 0=không) |
| rank | int | NULL | Thứ hạng ưu tiên — số nhỏ hơn = hạng thấp hơn |
| status | int | NULL | Trạng thái (1=active, 0=inactive) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

---

## Bảng: `loyalty_card_usage`
**Mô tả:** Lịch sử từng giao dịch tích điểm hoặc tiêu điểm của khách hàng. Mỗi lần mua hàng hoặc đổi điểm sẽ tạo một bản ghi tại đây.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `loyalty_card_usage_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| customer_id | int | NULL | FK → customer.id — Khách hàng thực hiện giao dịch |
| card_id | int | NULL | FK → loyalty_card.id — Hạng thẻ tại thời điểm giao dịch |
| type | int | NULL | Loại giao dịch (1=tích điểm mua hàng, 2=tiêu điểm đổi quà, 3=điều chỉnh thủ công...) |
| usage_date | datetime | NULL | Ngày giờ thực hiện giao dịch |
| ref_id | int | NULL | ID chứng từ liên quan (bill.id khi tích điểm, hoặc ID phiếu đổi quà) |
| amount | decimal(20,6) | NULL | Số tiền phát sinh trong giao dịch (cơ sở tính điểm) |
| point | int | NULL | Số điểm cộng thêm (dương) hoặc trừ đi (âm) |
| description | nvarchar(500) | NULL | Ghi chú mô tả giao dịch |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_loyalty_card_usage_com_id_customer_id` | (com_id, customer_id) | Lấy lịch sử giao dịch của một khách hàng |
| `idx_loyaltyCardUsage_comId_type_refId` | (com_id, type, ref_id) | Tra cứu giao dịch theo loại và chứng từ (tránh tích điểm 2 lần cho 1 hóa đơn) |

---

## Bảng: `card_policy`
**Mô tả:** Chính sách thẻ thành viên — định nghĩa điều kiện để khách hàng được tự động nâng hạng thẻ (từ Silver lên Gold, ...).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `card_policy_pk`) |
| com_id | int | NULL | FK → company.id — Công ty áp dụng chính sách này |
| name | nvarchar(400) | NULL | Tên chính sách |
| normalized_name | nvarchar(400) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| note | nvarchar(max) | NULL | Ghi chú nội bộ về chính sách |
| gen_description | nvarchar(200) | NULL | Mô tả ngắn gọn hiển thị cho khách hàng |
| upgrade_type | int | NULL | Loại điều kiện nâng hạng (1=theo tổng tiền, 2=theo điểm, 3=theo số lần mua...) |
| conditions | nvarchar(max) | NULL | Chi tiết điều kiện nâng hạng dưới dạng JSON |
| start_time | datetime | NULL | Thời điểm bắt đầu áp dụng chính sách |
| status | int | NULL | Trạng thái (1=active, 0=inactive) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

---

## Bảng: `voucher`
**Mô tả:** Định nghĩa các chương trình voucher / mã khuyến mãi. Voucher được tạo ở cấp hệ thống (không gắn với công ty cụ thể) và phân phối tới công ty qua bảng `voucher_company`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `voucher_pk`) |
| name | nvarchar(400) | NULL | Tên chương trình voucher |
| normalized_name | nvarchar(400) | NULL | Tên đã chuẩn hóa dùng tìm kiếm |
| code | nvarchar(20) | NULL | Mã voucher khách hàng nhập (VD: SALE50) |
| note | nvarchar(200) | NULL | Ghi chú nội bộ |
| gen_description | nvarchar(200) | NULL | Mô tả hiển thị cho khách hàng |
| type | int | NULL | Loại voucher (1=giảm theo %, 2=giảm tiền cố định, 3=tặng sản phẩm...) |
| status | int | NULL | Trạng thái duyệt (0=nháp, 1=đã duyệt...) |
| active | bit | NULL | Đang kích hoạt hay không (1=có hiệu lực) |
| discount_conditions | nvarchar(max) | NULL | Điều kiện giảm giá chi tiết — JSON (giá trị đơn hàng tối thiểu, sản phẩm áp dụng...) |
| start_time | datetime | NULL | Thời điểm bắt đầu hiệu lực |
| end_time | datetime | NULL | Thời điểm hết hiệu lực |
| ext_time_conditions | varchar(max) | NULL | Điều kiện thời gian mở rộng (JSON — giờ trong ngày, ngày trong tuần...) |
| different_ext_conditions | varchar(max) | NULL | Điều kiện đặc biệt khác (JSON — không trùng với voucher khác, giới hạn số lần dùng...) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

---

## Bảng: `voucher_company`
**Mô tả:** Phân phối voucher đến công ty — xác định công ty nào được dùng voucher nào, và voucher có tự động áp dụng khi đủ điều kiện hay cần khách tự nhập mã.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `voucher_company_pk`) |
| com_id | int | NULL | FK → company.id — Công ty được phân phối voucher |
| company_name | nvarchar(200) | NULL | Tên công ty (denormalized — lưu nhanh để hiển thị) |
| voucher_id | int | NULL | FK → voucher.id — Voucher được phân phối |
| voucher_code | varchar(20) | NULL | Mã voucher (denormalized từ voucher.code) |
| auto_apply | bit | NULL | Tự động áp dụng khi đủ điều kiện (1=tự động, 0=khách tự nhập mã) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `voucher_company_com_id_index` | (com_id) | Lấy danh sách voucher của một công ty |

---

## Bảng: `voucher_apply`
**Mô tả:** Quy tắc áp dụng voucher — xác định voucher được áp dụng cho đối tượng nào (khách hàng cụ thể, nhóm sản phẩm, khu vực...).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `voucher_apply_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| voucher_id | int | NULL | FK → voucher.id — Voucher áp dụng quy tắc này |
| customer_id | int | NULL | FK → customer.id — Giới hạn chỉ áp dụng cho khách hàng này (NULL = áp dụng mọi khách) |
| product_product_id | int | NULL | FK → product_product_unit.id — Giới hạn áp dụng cho sản phẩm này |
| apply_id | int | NULL | ID đối tượng áp dụng (khách hàng, nhóm sản phẩm, khu vực...) |
| apply_type | int | NULL | Loại đối tượng áp dụng (1=khách hàng, 2=nhóm sản phẩm, 3=khu vực...) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `voucher_apply_com_id_index` | (com_id) | Lấy danh sách quy tắc áp dụng của công ty |

---

## Bảng: `voucher_usage`
**Mô tả:** Lịch sử sử dụng voucher trong các hóa đơn. Mỗi lần voucher được áp dụng vào một hóa đơn tạo một bản ghi tại đây.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng (constraint: `voucher_usage_pk`) |
| com_id | int | NULL | FK → company.id — Công ty |
| company_name | nvarchar(200) | NULL | Tên công ty (denormalized) |
| voucher_id | int | NULL | FK → voucher.id — Voucher đã sử dụng |
| voucher_code | nvarchar(20) | NULL | Mã voucher đã dùng (denormalized) |
| bill_id | int | NULL | FK → bill.id — Hóa đơn áp dụng voucher |
| bill_code | varchar(20) | NULL | Mã hóa đơn (denormalized) |
| bill_value | decimal(21,6) | NULL | Tổng giá trị hóa đơn tại thời điểm áp dụng |
| customer_id | int | NULL | FK → customer.id — Khách hàng sử dụng voucher |
| customer_name | nvarchar(400) | NULL | Tên khách hàng (denormalized) |
| voucher_value | decimal(21,6) | NULL | Giá trị giảm giá thực tế được áp dụng |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `voucher_usage_com_id_index` | (com_id) | Lấy lịch sử dùng voucher của công ty |
| `idx_voucher_usage_bill_id_customer_id` | (bill_id, customer_id) | Kiểm tra khách hàng đã dùng voucher trong hóa đơn chưa |

---

## Quan hệ giữa các bảng trong nhóm

```
company      (1) ──── (N) customer
customer     (1) ──── (0..1) customer_card ──── (N) loyalty_card
customer_card ←── ghi lịch sử qua ──→ loyalty_card_usage

voucher      (1) ──── (N) voucher_company  (phân phối tới công ty)
voucher      (1) ──── (N) voucher_apply    (quy tắc đối tượng áp dụng)
voucher      (1) ──── (N) voucher_usage    (lịch sử sử dụng trong hóa đơn)
loyalty_card (1) ──── (N) card_policy      (chính sách nâng hạng)
```

**Luồng tích điểm & nâng hạng thẻ:**
1. Khi khách hàng mua hàng (`bill`), hệ thống ghi một bản ghi vào `loyalty_card_usage` (type=tích điểm)
2. `customer_card.point` và `customer_card.amount` được cộng dồn
3. Hệ thống so sánh `customer_card.amount` / `customer_card.point` với `card_policy.conditions` để quyết định nâng hạng thẻ (`customer_card.card_id`)

**Luồng áp dụng voucher:**
1. Khi tạo hóa đơn, hệ thống tra `voucher_company` để tìm voucher hợp lệ của công ty
2. Kiểm tra `voucher_apply` xem voucher có áp dụng cho khách hàng / sản phẩm trong đơn không
3. Kiểm tra `voucher.discount_conditions` và `voucher.ext_time_conditions` để xác nhận đủ điều kiện
4. Sau khi áp dụng, ghi lịch sử vào `voucher_usage`

 