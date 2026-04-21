# Nhóm 5: Đơn hàng, Hóa đơn, Công nợ & Thanh toán

---

## Bảng: `debt`
**Mô tả:** Công nợ phát sinh từ các giao dịch bán hàng, nhập xuất kho. Ghi nhận số tiền còn nợ theo từng chứng từ gốc và khách hàng.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| ref_id | int | NULL | — | ID chứng từ gốc phát sinh công nợ |
| type_doc | nvarchar(50) | NULL | — | Loại chứng từ gốc (bill, rs_inoutward...) |
| type_debt | int | NULL | — | Loại công nợ (phải thu, phải trả...) |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng (denormalized) |
| customer_normalized_name | nvarchar(524) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| amount | decimal(21,6) | NULL | — | Số tiền công nợ |
| description | nvarchar(255) | NULL | — | Ghi chú |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NULL | — | Quý dạng YYYYQ |
| no | nvarchar(25) | NULL | — | Số công nợ |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_debt_comId_type_date_included` | (com_id, type_doc, norm_date) | (amount, customer_name) | Báo cáo công nợ theo loại |
| `idx_debt_com_customer` | (com_id, customer_id) | (ref_id, type_doc, type_debt, norm_date, amount) | Tra cứu công nợ theo khách hàng |

---

## Bảng: `debt_payment`
**Mô tả:** Chi tiết các lần thanh toán công nợ. Mỗi lần thanh toán một phần hay toàn bộ công nợ được ghi vào bảng này, liên kết với phiếu thu (`mc_receipt`).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| type_doc | int | NULL | — | Loại chứng từ |
| ref_id | int | NULL | — | ID chứng từ tham chiếu |
| receipt_id | int | NULL | — | FK → mc_receipt.id — Phiếu thu liên quan |
| debt_id | int | NULL | — | FK → debt.id — Công nợ được thanh toán |
| type_debt_payment | int | NULL | — | Loại thanh toán công nợ |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| amount | decimal(21,6) | NULL | — | Số tiền thanh toán |
| description | nvarchar(255) | NULL | — | Ghi chú |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NULL | — | Quý dạng YYYYQ |
| customer_name | nvarchar(255) | NULL | — | Tên khách hàng (denormalized) |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| no | nvarchar(25) | NULL | — | Số phiếu thanh toán công nợ |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_debt_payment_debtId_inc_amount` | (debt_id) | (amount) | Tổng hợp số tiền đã thanh toán theo công nợ |
| `idx_debt_payment_com_customer` | (com_id, customer_id, debt_id) | (ref_id, receipt_id, type_doc, type_debt_payment, norm_date, amount) | Tra cứu lịch sử thanh toán theo khách hàng |

---

## Bảng: `receivable`
**Mô tả:** Phải thu — công nợ khách hàng còn nợ doanh nghiệp. Phát sinh từ hóa đơn bán hàng chưa thanh toán đầy đủ.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn phát sinh công nợ |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| type | nvarchar(25) | NULL | — | Loại phải thu |
| date | datetime | NULL | — | Ngày phát sinh |
| no | nvarchar(25) | NULL | — | Số chứng từ phải thu |
| amount | decimal(21,6) | NULL | — | Số tiền phải thu |
| description | nvarchar(255) | NULL | — | Ghi chú |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng (denormalized) |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_receivable_comId_type_date_included` | (com_id, type, date) | (amount, customer_name) | Báo cáo phải thu theo loại và ngày |

---

## Bảng: `payable`
**Mô tả:** Phải trả — công nợ doanh nghiệp còn nợ nhà cung cấp/đối tác. Phát sinh từ phiếu nhập hàng chưa thanh toán.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| customer_id | int | NULL | — | FK → customer/supplier — Đối tượng phải trả |
| type | nvarchar(50) | NULL | — | Loại phải trả |
| date | datetime | NULL | — | Ngày phát sinh |
| no | nvarchar(25) | NULL | — | Số chứng từ phải trả |
| description | nvarchar(255) | NULL | — | Ghi chú |
| amount | decimal(21,6) | NULL | — | Số tiền phải trả |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| customer_name | nvarchar(500) | NULL | — | Tên nhà cung cấp/đối tượng (denormalized) |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn liên quan |

---

## Bảng: `mc_receipt`
**Mô tả:** Phiếu thu tiền — ghi nhận các khoản thu tiền mặt hoặc chuyển khoản. Liên kết với hóa đơn bán hàng hoặc phiếu nhập/xuất kho.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn liên quan |
| type_desc | nvarchar(50) | NULL | — | Loại phiếu thu (mô tả) |
| date | datetime | NULL | — | Ngày thu |
| no | nvarchar(25) | NULL | — | Số phiếu thu |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng (denormalized) |
| amount | decimal(21,6) | NULL | — | Số tiền thu |
| description | nvarchar(255) | NULL | — | Ghi chú |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| business_type_id | int | NULL | — | Loại nghiệp vụ |
| funds | int | NULL | — | Quỹ tiền áp dụng |
| payment_method | nvarchar(50) | NULL | — | Phương thức thu (tiền mặt, chuyển khoản...) |
| rs_inoutward_id | int | NULL | — | FK → rs_inoutward.id — Phiếu nhập/xuất kho liên quan |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| ref_id | int | NULL | — | ID tham chiếu |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý |
| type_doc | int | NULL | — | Loại chứng từ |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_mcReceipt_comId_type_date_included` | (com_id, type_desc, date) | (id, customer_name, amount) | Báo cáo phiếu thu theo loại và ngày |
| `idx_McReceipt_comId_rsInoutwardId` | (com_id, rs_inoutward_id) | (id, no) | Tra cứu nhanh phiếu thu theo phiếu kho |
| `idx_mc_receipt_com_id_rs_inoutward_id` | (com_id, rs_inoutward_id) | (bill_id, type_desc, date, no, customer_id, customer_name, amount, description, creator, updater, create_time, update_time, business_type_id, payment_method, customer_normalized_name) | Covering index đầy đủ cột |
| `idx_mc_receipt_refId` | (ref_id) | (id) | Tra cứu theo tham chiếu |

---

## Bảng: `mc_payment`
**Mô tả:** Phiếu chi tiền — ghi nhận các khoản chi tiền mặt hoặc chuyển khoản cho nhà cung cấp. Liên kết với phiếu nhập kho (`rs_inoutward`).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| rs_inoutward_id | int | NULL | — | FK → rs_inoutward.id — Phiếu nhập kho liên quan |
| type_desc | nvarchar(50) | NULL | — | Loại phiếu chi |
| date | datetime | NULL | — | Ngày chi |
| no | nvarchar(25) | NULL | — | Số phiếu chi |
| customer_id | varchar(26) | NULL | — | FK → nhà cung cấp/đối tượng chi |
| customer_name | nvarchar(400) | NULL | — | Tên đối tượng (denormalized) |
| amount | decimal(21,6) | NULL | — | Số tiền chi |
| description | nvarchar(255) | NULL | — | Ghi chú |
| business_type_id | int | NULL | — | Loại nghiệp vụ |
| funds | int | NULL | — | Quỹ tiền |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| code | varchar(50) | NULL | — | Mã phiếu chi |
| payment_method | nvarchar(50) | NULL | — | Phương thức chi |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn liên quan |
| ref_id | int | NULL | — | ID tham chiếu |
| type_doc | int | NULL | — | Loại chứng từ |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_mcPayment_comId_date_included` | (com_id, date) | (customer_name, amount) | Báo cáo phiếu chi theo ngày |
| `idx_mcPayment_comId_code` | (com_id, code) | — | Tra cứu phiếu chi theo mã |

---

## Bảng: `payment_history`
**Mô tả:** Lịch sử các lần thanh toán cho từng hóa đơn. Ghi nhận chi tiết từng phương thức thanh toán, tiền thối, công nợ trong một lần thanh toán.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn được thanh toán |
| payment_method | nvarchar(50) | NULL | — | Phương thức thanh toán |
| refund | decimal(21,6) | NULL | — | Tiền thối lại cho khách |
| debt_type | int | NULL | — | Loại công nợ (nếu thanh toán qua công nợ) |
| debt | decimal(21,6) | NULL | — | Số tiền thanh toán qua công nợ |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| payment_time | datetime | NULL | — | Thời điểm thanh toán thực tế |
| total_bill | decimal(21,6) | NULL | — | Tổng tiền hóa đơn tại thời điểm thanh toán |
| ref_id | int | NULL | — | ID tham chiếu (giao dịch cổng thanh toán) |
| com_id | int | NULL | — | FK → company.id — Công ty |
| type_doc | int | NULL | — | Loại chứng từ |
| amount_received | decimal(21,6) | NULL | — | Số tiền khách đưa |
| norm_quarter | int | NULL | — | Quý dạng YYYYQ |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| amount | decimal(21,6) | NULL | — | Số tiền thanh toán trong lần này |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_payment_history_refId` | (ref_id) | — | Tra cứu lịch sử thanh toán theo giao dịch tham chiếu |

---

## Bảng: `payment_gateway`
**Mô tả:** Cấu hình cổng thanh toán điện tử của từng công ty (VNPay, Momo, QR tĩnh...). Lưu API key và thông tin kết nối với từng đối tác thanh toán.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính NONCLUSTERED |
| com_id | int | NULL | — | FK → company.id — Công ty |
| payment_gateway | nvarchar(50) | NULL | — | Tên cổng thanh toán (VNPay, Momo, ZaloPay...) |
| payment_gateway_key | nvarchar(500) | NULL | — | API Key chính |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| amount_min | int | NULL | — | Số tiền giao dịch tối thiểu |
| status | int | NULL | 0 | Trạng thái kích hoạt (0=tắt, 1=bật) |
| account_info | nvarchar(1024) | NULL | — | Thông tin tài khoản cổng thanh toán |
| type | varchar(50) | NULL | — | Loại cổng (QR, POS, online...) |
| trace_id | varchar(50) | NULL | — | Trace ID xác thực |
| expired_time | datetime | NULL | — | Thời điểm hết hạn token/key |
| payment_gateway_key2 | nvarchar(512) | NULL | — | API Key phụ thứ hai |
| payment_gateway_key3 | nvarchar(512) | NULL | — | API Key phụ thứ ba |
| static_qr | nvarchar(512) | NULL | — | Mã QR tĩnh dùng cho thanh toán nhanh |
| data_info | varchar(max) | NULL | — | Thông tin cấu hình mở rộng (JSON) |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `payment_gateway_primary_key` | PRIMARY KEY NONCLUSTERED | (id) | — |
| `df_payment_gateway_status` | DEFAULT | status = 0 | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `payment_gateway_id_index` | (id) | — | CLUSTERED index |
| `payment_gateway_com_id_index` | (com_id) | — | Lọc cổng thanh toán theo công ty |

---

## Bảng: `payment_gateway_transaction`
**Mô tả:** Giao dịch qua cổng thanh toán điện tử. Theo dõi từng lần tạo QR, nhận thanh toán và trạng thái giao dịch. Có filtered unique index chống trùng QR đang hoạt động.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính NONCLUSTERED |
| com_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn thanh toán |
| transaction_code | varchar(50) | NULL | — | Mã giao dịch nội bộ |
| status | int | NULL | — | Trạng thái giao dịch (0=chờ, 1=thành công, 2=hủy...) |
| request_payload | nvarchar(max) | NULL | — | Dữ liệu gửi đến cổng thanh toán (JSON log) |
| response_payload | nvarchar(max) | NULL | — | Dữ liệu phản hồi từ cổng thanh toán (JSON log) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| type | varchar(50) | NULL | — | Loại thao tác (CREATE_QR, PAYMENT, CANCEL...) |
| bill_gateway_id | varchar(50) | NULL | — | ID hóa đơn phía cổng thanh toán |
| amount | decimal(21,6) | NULL | — | Số tiền giao dịch |
| payment_method | varchar(50) | NULL | — | Phương thức thanh toán cụ thể |
| normalized_name | varchar(256) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| trans_id | varchar(225) | NULL | — | ID giao dịch phía đối tác thanh toán |
| payment_history_id | bigint | NULL | — | FK → payment_history.id — Lịch sử thanh toán liên kết |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `payment_gateway_transaction_primary_key` | PRIMARY KEY NONCLUSTERED | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `payment_gateway_transaction_id_index` | (id) | — | CLUSTERED index |
| `payment_gateway_transaction_com_id_bill_id_index` | (com_id, bill_id) | — | Tra cứu giao dịch theo hóa đơn |
| `UQ_com_id_payment_transaction_code` | (com_id, transaction_code) | — | UNIQUE filtered WHERE transaction_code IS NOT NULL AND status = 1 AND type = 'CREATE_QR' — chống trùng QR đang hoạt động |
| `payment_gateway_transaction_norm_date_index` | (norm_date DESC) | — | Tra cứu giao dịch theo ngày |
| `PAYMENTT_GATEWAY_TRANSACTION_UQ_BILLID_BILLGATEWAYID_TYPEQR` | (bill_id, bill_gateway_id) | — | UNIQUE filtered WHERE type = 'CREATE_QR' — mỗi hóa đơn chỉ có một QR |

---

## Bảng: `bank_account`
**Mô tả:** Tài khoản ngân hàng của công ty hoặc người dùng, dùng để nhận thanh toán chuyển khoản. Lưu mã QR tĩnh của tài khoản.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| account_number | varchar(100) | NULL | — | Số tài khoản ngân hàng |
| bank_name | nvarchar(100) | NULL | — | Tên ngân hàng |
| account_name | nvarchar(100) | NULL | — | Tên chủ tài khoản |
| user_id | int | NULL | — | FK → ep_user.id — Người dùng sở hữu tài khoản |
| com_id | int | NULL | — | FK → company.id — Công ty |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| qr_code | varchar(512) | NULL | — | Mã QR tĩnh của tài khoản ngân hàng |

---

## Quan hệ giữa các bảng trong nhóm 9

```
bill (1) ──── (N) payment_history ──── (1) payment_gateway_transaction
                                                  │
                                                  ▼
                                          payment_gateway

bill (1) ──── (N) mc_receipt (1) ──── (N) debt_payment ──── (N) debt
rs_inoutward (1) ──── (N) mc_receipt
rs_inoutward (1) ──── (N) mc_payment

bill (1) ──── (N) receivable   (phải thu từ hóa đơn)
bill (1) ──── (N) payable      (phải trả từ hóa đơn)

ep_user (1) ──── (N) bank_account
company (1) ──── (N) payment_gateway
```

**Luồng thanh toán hóa đơn:**
1. Khi khách thanh toán hóa đơn → tạo `payment_history` ghi nhận phương thức và số tiền
2. Nếu thanh toán qua cổng điện tử → tạo `payment_gateway_transaction` (type=CREATE_QR) → nhận kết quả callback → cập nhật status
3. Nếu thanh toán thiếu → tạo `debt` (type_debt=phải thu) và `receivable`
4. Khi khách trả nợ sau → tạo `mc_receipt` → tạo `debt_payment` liên kết với `debt`

---

# Nhóm 6: Hóa đơn bán hàng

> Partition theo quý: PK composite **(norm_quarter, id)**, partition scheme **psBillQuarter** (bảng `bill`) và **psBillProductQuarter** (bảng `bill_product`).

---

## Bảng: `bill`
**Mô tả:** Hóa đơn bán hàng — bảng trung tâm của toàn bộ nghiệp vụ POS. Ghi nhận mọi giao dịch bán hàng, liên kết với bàn, khách hàng, nhân viên, hóa đơn điện tử. Partition theo quý để tối ưu hiệu năng.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| code | varchar(50) | NULL | — | Mã hóa đơn chính |
| code2 | varchar(50) | NULL | — | Mã hóa đơn phụ |
| com_id | int | NULL | — | FK → company.id — Công ty |
| area_unit_id | int | NULL | — | FK → area_unit.id — Bàn/phòng bán hàng |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng (denormalized) |
| tax_authority_code | varchar(200) | NULL | — | Mã cơ quan thuế cấp (từ HĐĐT) |
| bill_date | datetime | NULL | — | Ngày lập hóa đơn |
| delivery_type | int | NULL | — | Loại giao hàng |
| discount_amount | decimal(21,6) | NULL | — | Tổng số tiền giảm giá |
| total_pre_tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Tổng tiền thanh toán |
| status | int | NULL | — | Trạng thái hóa đơn (0=nháp, 1=hoàn thành, 2=hủy...) |
| status_invoice | int | NULL | — | Trạng thái hóa đơn điện tử |
| invoice_error_message | nvarchar(512) | NULL | — | Thông báo lỗi khi phát hành HĐĐT |
| type_inv | int | NULL | — | Loại hóa đơn (thường, xuất khẩu...) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| reservation_id | int | NULL | — | FK → reservation.id — Đặt bàn liên kết |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng (trước chiết khấu) |
| quantity | decimal(21,6) | NULL | — | Tổng số lượng sản phẩm |
| product_discount_amount | decimal(21,6) | NULL | — | Tổng giảm giá tại từng dòng sản phẩm |
| area_name | nvarchar(255) | NULL | — | Tên khu vực (denormalized) |
| area_unit_name | nvarchar(255) | NULL | — | Tên bàn/phòng (denormalized) |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên khách hàng chuẩn hóa (tìm kiếm) |
| description | nvarchar(512) | NULL | — | Ghi chú hóa đơn |
| discount_vat_rate | int | NULL | — | Thuế suất VAT trên chiết khấu |
| discount_vat_amount | decimal(21,6) | NULL | — | Số tiền VAT trên chiết khấu |
| bill_id_returns | varchar(50) | NULL | — | Danh sách ID hóa đơn trả hàng liên quan |
| buyer_name | nvarchar(400) | NULL | — | Tên người mua (trên hóa đơn, có thể khác tên khách) |
| voucher_amount | decimal(21,6) | NULL | — | Tổng giá trị voucher áp dụng |
| reservation_code | varchar(100) | NULL | — | Mã đặt bàn (denormalized) |
| fkey | varchar(50) | NULL | — | Foreign key tích hợp hóa đơn điện tử |
| extra | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| platform | nvarchar(max) | NULL | — | Nền tảng bán hàng (POS, online, app — JSON) |
| owner_id | int | NULL | — | FK → company_owner.id — Chủ sở hữu |
| customer_address | nvarchar(400) | NULL | — | Địa chỉ khách hàng (denormalized) |
| customer_tax_code | varchar(14) | NULL | — | Mã số thuế khách hàng |
| unique_key | varchar(100) | NULL | — | Khóa duy nhất chống trùng đơn |
| payment_method | nvarchar(100) | NULL | — | Phương thức thanh toán chính |
| total_surcharge | decimal(21,6) | NULL | — | Tổng phụ phí (service charge...) |
| check_in | datetime | NULL | — | Thời điểm khách nhận bàn/check-in |
| check_out | datetime | NULL | — | Thời điểm khách trả bàn/check-out |
| type_price | int | NULL | — | Loại bảng giá áp dụng |
| discount_rate | int | NULL | — | Tỉ lệ chiết khấu hóa đơn (%) |
| is_customer_update | int | NULL | — | Đã cập nhật thông tin khách hàng chưa |
| info_customer_old | nvarchar(max) | NULL | — | Thông tin khách hàng cũ trước khi cập nhật (JSON) |
| prescription_id | varchar(100) | NULL | — | Mã đơn thuốc (nhà thuốc/phòng khám) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) — dùng trong index |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| shipping_status | nvarchar(300) | NULL | — | Trạng thái giao hàng |
| shipping_info | nvarchar(max) | NULL | — | Thông tin giao hàng (JSON) |
| shipping_type | nvarchar(200) | NULL | — | Loại vận chuyển |
| extra_info | nvarchar(max) | NULL | — | Thông tin bổ sung (JSON) |
| excise_tax_rate | varchar(50) | NULL | — | Thuế suất thuế tiêu thụ đặc biệt |
| excise_tax_amount | decimal(20,6) | NULL | — | Số tiền thuế tiêu thụ đặc biệt |
| payment_status | int | NULL | — | Trạng thái thanh toán |
| sale_person_id | int | NULL | — | FK → ep_user.id — Nhân viên bán hàng |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_bill` | PRIMARY KEY | (norm_quarter, id) | Partition ON psBillQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_id` | (norm_quarter ASC, id DESC) | — | ON psBillQuarter |
| `idx_bill_comId_normDate` | (norm_quarter, com_id, norm_date) | (id) | ON psBillQuarter |
| `idx_com_id_norm_quarter_norm_date` | (com_id, norm_quarter, norm_date) | — | ON psBillQuarter |
| `idx_norm_quarter_com_id_norm_date` | (norm_quarter, com_id, norm_date) | (id) | ON psBillQuarter |
| `idx_bill_comId_code_included` | (norm_quarter, com_id, code, status) | (customer_name, bill_date, total_amount, tax_authority_code) | Tra cứu hóa đơn theo mã — ON psBillQuarter |
| `idx_bill_customerId` | (norm_quarter, customer_id) | — | Lịch sử mua hàng theo khách — ON psBillQuarter |

---

## Bảng: `bill_product`
**Mô tả:** Chi tiết từng dòng sản phẩm trong hóa đơn bán hàng. Partition theo quý. Lưu đầy đủ thông tin sản phẩm, giá, thuế, topping, combo, voucher, lô hàng, kho xuất.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn cha |
| product_id | int | NULL | — | FK → product.id — Sản phẩm |
| product_name | nvarchar(500) | NULL | — | Tên sản phẩm (denormalized) |
| quantity | decimal(21,6) | NULL | — | Số lượng bán |
| unit | nvarchar(50) | NULL | — | Tên đơn vị tính (denormalized) |
| unit_price | decimal(21,6) | NULL | — | Đơn giá bán |
| discount_amount | decimal(21,6) | NULL | — | Số tiền giảm giá dòng hàng |
| total_pre_tax | decimal(21,6) | NULL | — | Thành tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Thành tiền sau thuế |
| feature | int | NULL | — | Đặc tính dòng (sản phẩm thường, combo item, topping...) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng (trước chiết khấu) |
| product_code | varchar(50) | NULL | — | Mã sản phẩm (denormalized) |
| position | int | NULL | — | Thứ tự dòng trong hóa đơn |
| unit_id | int | NULL | — | FK → product_unit.id — Đơn vị tính |
| product_normalized_name | nvarchar(512) | NULL | — | Tên sản phẩm chuẩn hóa (tìm kiếm) |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id |
| is_topping | bit | NULL | — | Có phải topping không |
| parent_id | int | NULL | — | ID dòng cha (nếu là topping hoặc combo item) |
| extra | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| voucher_id | int | NULL | — | FK → voucher.id — Voucher áp dụng cho dòng |
| product_extra | nvarchar(max) | NULL | — | Thông tin thêm về sản phẩm (JSON) |
| total_amount_product | decimal(21,6) | NULL | — | Tổng tiền sản phẩm (không tính topping) |
| description | nvarchar(max) | NULL | — | Ghi chú dòng hàng |
| out_price_tax | decimal(21,6) | NULL | — | Giá bán đã bao gồm thuế |
| area_unit_id | int | NULL | — | FK → area_unit.id — Bàn áp dụng dòng này |
| warehouse_id | int | NULL | — | FK → warehouse.id — Kho xuất hàng |
| product_code2 | nvarchar(50) | NULL | — | Mã sản phẩm phụ (denormalized) |
| discount_rate | int | NULL | — | Tỉ lệ chiết khấu dòng hàng (%) |
| user_id | int | NULL | — | FK → ep_user.id — Nhân viên gọi món |
| full_name | nvarchar(512) | NULL | — | Họ tên nhân viên (denormalized) |
| batch_id | int | NULL | — | FK → batches.id — Lô hàng xuất |
| group_batch | varchar(100) | NULL | — | Nhóm lô hàng |
| info_data | nvarchar(max) | NULL | — | Dữ liệu thông tin bổ sung (JSON) |
| id_medicine | varchar(100) | NULL | — | Mã thuốc (nhà thuốc) |
| id_medicine_sale | varchar(100) | NULL | — | Mã thuốc bán (nhà thuốc) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| purchase_price | decimal(21,6) | NULL | — | Giá vốn tại thời điểm bán |
| parent_combo_id | int | NULL | — | ID combo cha (nếu là thành phần trong combo) |
| checkin | datetime | NULL | — | Thời điểm check-in dòng hàng (tính giờ) |
| checkout | datetime | NULL | — | Thời điểm check-out dòng hàng |
| amount_discount_from_bill | decimal(21,6) | NULL | — | Phần chiết khấu từ hóa đơn phân bổ xuống dòng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| discount_allocated | decimal(21,6) | NULL | — | Tổng chiết khấu được phân bổ |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_bill_product` | PRIMARY KEY | (norm_quarter, id) | Partition ON psBillProductQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_id` | (norm_quarter ASC, id DESC) | — | ON psBillProductQuarter |
| `idx_bill_id` | (norm_quarter, bill_id) | (total_pre_tax, feature, product_code, com_id) | Lấy dòng hàng của hóa đơn — ON psBillProductQuarter |
| `idx_billProduct_billId_productCode_included` | (norm_quarter, bill_id, product_code) | (quantity, discount_amount, vat_amount, total_amount, amount, position) | Covering index in hóa đơn — ON psBillProductQuarter |
| `idx_billProduct_productId` | (norm_quarter, product_id) | — | Thống kê bán hàng theo sản phẩm — ON psBillProductQuarter |
| `idx_bill_product_ppuId` | (norm_quarter, product_product_unit_id) | — | ON psBillProductQuarter |

---

## Bảng: `bill_config`
**Mô tả:** Cấu hình mở rộng đính kèm hóa đơn, lưu dưới dạng JSON. Dùng để lưu các thông tin đặc thù theo từng loại hình kinh doanh không có trong cấu trúc cố định của `bill`.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn liên kết |
| extra | varchar(max) | NULL | — | Dữ liệu cấu hình mở rộng (JSON) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `bill_config_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `bill_config_com_id_index` | (com_id) | — | Lọc config theo công ty |

---

## Bảng: `bill_return`
**Mô tả:** Liên kết hóa đơn trả hàng với hóa đơn gốc. Khi khách trả hàng, tạo hóa đơn mới (bill_id_return) và ghi nhận quan hệ với hóa đơn gốc (bill_id).

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn gốc |
| bill_id_return | int | NULL | — | FK → bill.id — Hóa đơn trả hàng |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `bill_return_pk` | PRIMARY KEY | (id) | — |

---

## Bảng: `merge_split`
**Mô tả:** Lịch sử gộp bàn / tách bàn liên quan đến hóa đơn. Ghi lại quan hệ giữa hóa đơn trước và sau khi thực hiện thao tác gộp/tách.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| com_id | int | NULL | — | FK → company.id — Công ty |
| type | varchar(50) | NULL | — | Loại thao tác (merge=gộp bàn, split=tách bàn) |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn kết quả sau thao tác |
| ref_id | int | NULL | — | FK → bill.id — Hóa đơn tham chiếu (trước khi gộp/tách) |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `merge_split_pk` | PRIMARY KEY | (id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `merge_split_com_id_bill_id_index` | (com_id, bill_id) | — | Tra cứu lịch sử gộp/tách theo hóa đơn kết quả |
| `merge_split_com_id_ref_id_index` | (com_id, ref_id) | — | Tra cứu theo hóa đơn gốc |

---

## Quan hệ giữa các bảng trong nhóm 6

```
area_unit (1) ──── (N) bill (1) ──── (N) bill_product
                         │                    │
              ┌──────────┼──────────┐         ├── product
              ▼          ▼          ▼         ├── product_product_unit
         bill_config  bill_return  merge_split ├── voucher
              │                               ├── batches
              ▼                               └── warehouse
           (JSON ext)

reservation (1) ──── (N) bill
customer (1) ──── (N) bill
```

**Luồng bán hàng:**
1. Nhân viên chọn bàn (`area_unit`) → tạo `bill` (status=nháp)
2. Gọi món → tạo `bill_product` từng dòng, liên kết `product_product_unit_id`, `warehouse_id`, `batch_id`
3. Áp dụng voucher/chiết khấu → cập nhật `discount_amount`, `voucher_amount`
4. Thanh toán → cập nhật `bill.status`=hoàn thành → tạo `payment_history`
5. Nếu gộp/tách bàn → tạo bản ghi `merge_split`
6. Trả hàng → tạo `bill` mới (status=trả hàng) + `bill_return` liên kết hóa đơn gốc

---

# Nhóm 7: Hóa đơn điện tử

> Hệ thống hỗ trợ hai loại hóa đơn điện tử song song: **`invoice`** (partition theo quý, dùng cho hệ thống mới) và **`invoice_ei`** (không partition, dùng cho hệ thống EI cũ). Cả hai đều liên kết với `bill` qua `bill_id`.

---

## Bảng: `invoice`
**Mô tả:** Hóa đơn điện tử (VAT invoice) theo chuẩn mới, partition theo quý. Liên kết 1-1 với `bill`. Lưu thông tin phát hành HĐĐT: mẫu số, số hóa đơn, ngày phát hành, mã cơ quan thuế, trạng thái kiểm tra thuế.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng liên kết (UNIQUE per company) |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng trên HĐĐT |
| id_number | varchar(20) | NULL | — | Số CMND/CCCD khách hàng |
| customer_phone | varchar(20) | NULL | — | Số điện thoại khách hàng |
| pattern | varchar(50) | NULL | — | Mẫu số hóa đơn (VD: 01GTKT0/001) |
| no | int | NULL | — | Số thứ tự hóa đơn |
| arising_date | datetime | NULL | — | Ngày phát sinh giao dịch |
| publish_date | datetime | NULL | — | Ngày phát hành hóa đơn |
| payment_method | nvarchar(50) | NULL | — | Phương thức thanh toán trên HĐĐT |
| discount_amount | decimal(21,6) | NULL | — | Số tiền chiết khấu |
| total_pre_tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Tổng tiền thanh toán |
| type | int | NULL | 0 | Loại hóa đơn |
| status | int | NULL | 0 | Trạng thái (0=chưa phát hành, 1=đã phát hành, 2=hủy...) |
| tax_check_status | int | NULL | — | Trạng thái kiểm tra thuế (0=chờ, 1=hợp lệ, 2=lỗi) |
| tax_authority_code | varchar(200) | NULL | — | Mã cơ quan thuế cấp |
| tax_error_message | nvarchar(512) | NULL | — | Thông báo lỗi từ cơ quan thuế |
| ikey | varchar(100) | NULL | — | Key tích hợp HĐĐT (duy nhất) |
| refikey | varchar(100) | NULL | — | Key hóa đơn tham chiếu (hóa đơn thay thế/điều chỉnh) |
| extra | ntext | NULL | — | Dữ liệu XML/JSON HĐĐT đầy đủ |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| company_id | int | NULL | — | FK → company.id — Công ty phát hành |
| customer_code | nvarchar(50) | NULL | — | Mã khách hàng trên HĐĐT |
| customer_address | nvarchar(400) | NULL | — | Địa chỉ khách hàng |
| customer_taxcode | nvarchar(14) | NULL | — | Mã số thuế khách hàng |
| exchange_rate | int | NULL | 1 | Tỷ giá (mặc định 1 cho VND) |
| currency_unit | varchar(10) | NULL | 'VND' | Đơn vị tiền tệ |
| update_user_id | int | NULL | — | ID người cập nhật (khác updater — dùng cho audit) |
| user_id | int | NULL | — | ID người dùng phát hành |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng |
| error_publish | nvarchar(max) | NULL | — | Log lỗi chi tiết khi phát hành |
| customer_email | varchar(300) | NULL | — | Email khách hàng (gửi HĐĐT) |
| customer_emailcc | varchar(300) | NULL | — | Email CC |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên khách chuẩn hóa (tìm kiếm) |
| discount_vat_rate | int | NULL | — | Thuế suất VAT trên chiết khấu |
| discount_vat_amount | decimal(21,6) | NULL | — | Số tiền VAT trên chiết khấu |
| buyer_name | nvarchar(400) | NULL | — | Tên người mua hàng |
| fkey | varchar(100) | NULL | — | Foreign key tích hợp |
| platform | nvarchar(max) | NULL | — | Nền tảng phát hành (JSON) |
| pattern_id | varchar(100) | NULL | — | ID mẫu hóa đơn |
| product_discount_amount | decimal(21,6) | NULL | — | Tổng giảm giá dòng hàng |
| discount_rate | int | NULL | — | Tỉ lệ chiết khấu (%) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| extra_info | nvarchar(max) | NULL | — | Thông tin bổ sung (JSON) |
| excise_tax_rate | varchar(50) | NULL | — | Thuế suất thuế tiêu thụ đặc biệt |
| excise_tax_amount | decimal(20,6) | NULL | — | Số tiền thuế tiêu thụ đặc biệt |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_invoice` | PRIMARY KEY | (norm_quarter, id) | Partition ON psInvoiceQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_id` | (norm_quarter ASC, id DESC) | — | ON psInvoiceQuarter |
| `idx_com_id_norm_date` | (norm_quarter, company_id, norm_date) | — | ON psInvoiceQuarter |
| `idx_invoice_company_id_bill_id` | (norm_quarter, company_id) | (bill_id, id) | ON psInvoiceQuarter |
| `idx_invoice_billId_companyId_taxCheckStatus_included` | (norm_quarter, bill_id, company_id, tax_check_status) | (customer_name, no, arising_date, publish_date, vat_amount, total_amount, customer_taxcode) | Covering index tra cứu trạng thái HĐĐT — ON psInvoiceQuarter |
| `idx_invoice_billId` | (company_id, bill_id, norm_quarter) | — | UNIQUE — mỗi bill chỉ có một HĐĐT — ON psInvoiceQuarter |
| `idx_invoice_companyId_customerName` | (norm_quarter, company_id, customer_name) | (pattern, no, arising_date, publish_date, total_amount, tax_check_status, tax_authority_code) | ON psInvoiceQuarter |
| `idx_invoice_companyId_customerTaxcode` | (norm_quarter, company_id, customer_taxcode) | (customer_name, pattern, no, arising_date, publish_date, total_amount, tax_check_status) | ON psInvoiceQuarter |
| `idx_invoice_company_id` | (norm_quarter, company_id) | (tax_authority_code, ikey) | ON psInvoiceQuarter |
| `idx_invoice_company_id_ikey_update_time` | (norm_quarter, company_id, ikey, update_time) | (no, tax_check_status, tax_authority_code) | Đồng bộ trạng thái HĐĐT — ON psInvoiceQuarter |
| `idx_invoice_companyId_arisingDate` | (norm_quarter, arising_date, company_id) | (tax_check_status, tax_authority_code, customer_normalized_name) | ON psInvoiceQuarter |

---

## Bảng: `invoice_product`
**Mô tả:** Chi tiết sản phẩm trong hóa đơn điện tử (hệ thống mới). Partition theo quý. Mirror dữ liệu từ `bill_product` nhưng theo chuẩn định dạng HĐĐT.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính (composite với norm_quarter) |
| invoice_id | int | NULL | — | FK → invoice.id — HĐĐT cha |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng |
| product_id | int | NULL | — | FK → product.id — Sản phẩm |
| code | nvarchar(50) | NULL | — | Mã sản phẩm trên HĐĐT |
| position | int | NULL | — | Thứ tự dòng |
| feature | int | NULL | — | Đặc tính dòng |
| name | nvarchar(500) | NULL | — | Tên sản phẩm trên HĐĐT |
| quantity | decimal(21,6) | NULL | — | Số lượng |
| unit | nvarchar(50) | NULL | — | Đơn vị tính |
| unit_price | decimal(21,6) | NULL | — | Đơn giá |
| discount_amount | decimal(21,6) | NULL | — | Chiết khấu |
| total_pre_tax | decimal(21,6) | NULL | — | Thành tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Thành tiền sau thuế |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| extra | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng |
| product_product_unit_id | int | NULL | — | FK → product_product_unit.id |
| product_code2 | nvarchar(50) | NULL | — | Mã sản phẩm phụ |
| discount_rate | int | NULL | — | Tỉ lệ chiết khấu (%) |
| info_data | nvarchar(max) | NULL | — | Thông tin bổ sung (JSON) |
| norm_date | int | NULL | — | Ngày dạng số (YYYYMMDD) |
| norm_quarter | int | NOT NULL | 20234 | Partition key — quý theo định dạng YYYYQ |
| purchase_price | decimal(21,6) | NULL | — | Giá vốn |
| amount_discount_from_bill | decimal(21,6) | NULL | — | Phần chiết khấu từ hóa đơn phân bổ |
| com_id | int | NULL | — | FK → company.id — Công ty |
| discount_allocated | decimal(21,6) | NULL | — | Tổng chiết khấu phân bổ |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `PK_invoice_product` | PRIMARY KEY | (norm_quarter, id) | Partition ON psInvoiceProductQuarter |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_invoice_product_id` | (norm_quarter ASC, id DESC) | — | ON psInvoiceProductQuarter |
| `idx_invoiceProduct_invoiceId_billId` | (norm_quarter, invoice_id, bill_id) | — | ON psInvoiceProductQuarter |
| `idx_invoiceProduct_productId` | (norm_quarter, product_id) | — | ON psInvoiceProductQuarter |

---

## Bảng: `invoice_ei`
**Mô tả:** Hóa đơn điện tử theo chuẩn EI (hệ thống cũ, không partition). Cấu trúc tương tự `invoice` nhưng dùng riêng cho nhà cung cấp HĐĐT theo chuẩn EI. Tồn tại song song với `invoice`.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| company_id | int | NULL | — | FK → company.id — Công ty phát hành |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng liên kết |
| customer_id | int | NULL | — | FK → customer.id — Khách hàng |
| customer_name | nvarchar(400) | NULL | — | Tên khách hàng trên HĐĐT |
| id_number | varchar(20) | NULL | — | Số CMND/CCCD |
| customer_phone | varchar(20) | NULL | — | Số điện thoại |
| pattern | varchar(50) | NULL | — | Mẫu số hóa đơn |
| no | int | NULL | — | Số thứ tự hóa đơn |
| arising_date | datetime | NULL | — | Ngày phát sinh |
| publish_date | datetime | NULL | — | Ngày phát hành |
| payment_method | nvarchar(50) | NULL | — | Phương thức thanh toán |
| discount_amount | decimal(21,6) | NULL | — | Số tiền chiết khấu |
| total_pre_tax | decimal(21,6) | NULL | — | Tổng tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Tổng tiền thanh toán |
| type | int | NULL | 0 | Loại hóa đơn |
| status | int | NULL | 0 | Trạng thái |
| tax_check_status | int | NULL | — | Trạng thái kiểm tra thuế |
| tax_authority_code | varchar(23) | NULL | — | Mã cơ quan thuế cấp |
| tax_error_message | nvarchar(255) | NULL | — | Thông báo lỗi từ cơ quan thuế |
| ikey | varchar(100) | NULL | — | Key tích hợp EI |
| refikey | varchar(100) | NULL | — | Key hóa đơn tham chiếu |
| extra | ntext | NULL | — | Dữ liệu XML/JSON HĐĐT |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| customer_code | nvarchar(50) | NULL | — | Mã khách hàng |
| customer_address | nvarchar(400) | NULL | — | Địa chỉ khách hàng |
| customer_taxcode | nvarchar(14) | NULL | — | Mã số thuế khách hàng |
| exchange_rate | int | NULL | 1 | Tỷ giá |
| currency_unit | varchar(10) | NULL | 'VND' | Đơn vị tiền tệ |
| update_user_id | int | NULL | — | ID người cập nhật |
| user_id | int | NULL | — | ID người dùng phát hành |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng |
| error_publish | nvarchar(255) | NULL | — | Log lỗi phát hành |
| customer_email | varchar(50) | NULL | — | Email khách hàng |
| customer_emailcc | varchar(100) | NULL | — | Email CC |
| customer_normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| discount_vat_rate | int | NULL | — | Thuế suất VAT trên chiết khấu |
| discount_vat_amount | decimal(21,6) | NULL | — | Số tiền VAT trên chiết khấu |
| buyer_name | nvarchar(400) | NULL | — | Tên người mua |
| fkey | varchar(100) | NULL | — | Foreign key tích hợp |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_invoice_ei_billId_companyId_taxCheckStatus_included` | (bill_id, company_id, tax_check_status) | (customer_name, no, arising_date, publish_date, vat_amount, total_amount, customer_taxcode) | Covering index tra cứu trạng thái HĐĐT EI |
| `idx_invoice_ei_billId` | (bill_id) | — | Tra cứu HĐĐT EI theo hóa đơn |
| `idx_invoice_ei_companyId_taxCheckStatus` | (company_id, tax_check_status) | (customer_name, no, arising_date, publish_date, total_amount, tax_authority_code) | Lọc HĐĐT theo trạng thái kiểm tra thuế |
| `idx_invoice_ei_companyId_customerName` | (company_id, customer_name) | (pattern, no, arising_date, publish_date, total_amount, tax_check_status, tax_authority_code) | Tìm kiếm HĐĐT theo tên khách |
| `idx_invoice_ei_companyId_customerTaxcode` | (company_id, customer_taxcode) | (customer_name, pattern, no, arising_date, publish_date, total_amount, tax_check_status) | Tìm kiếm HĐĐT theo MST |

---

## Bảng: `invoice_product_ei`
**Mô tả:** Chi tiết sản phẩm trong hóa đơn điện tử EI (hệ thống cũ). Liên kết với `invoice_ei` qua FK constraint.

| Cột | Kiểu dữ liệu | Null | Default | Mô tả |
|-----|-------------|------|---------|-------|
| id | int IDENTITY | NOT NULL | — | Khóa chính, tự tăng |
| invoice_ei_id | int | NULL | — | FK → invoice_ei.id — HĐĐT EI cha |
| company_id | int | NULL | — | FK → company.id — Công ty |
| bill_id | int | NULL | — | FK → bill.id — Hóa đơn bán hàng |
| product_id | int | NULL | — | FK → product.id — Sản phẩm |
| code | nvarchar(50) | NULL | — | Mã sản phẩm trên HĐĐT |
| position | int | NULL | — | Thứ tự dòng |
| feature | int | NULL | — | Đặc tính dòng |
| name | nvarchar(max) | NULL | — | Tên sản phẩm trên HĐĐT |
| quantity | decimal(21,6) | NULL | — | Số lượng |
| unit | nvarchar(50) | NULL | — | Đơn vị tính |
| unit_price | decimal(21,6) | NULL | — | Đơn giá |
| discount_amount | decimal(21,6) | NULL | — | Chiết khấu |
| total_pre_tax | decimal(21,6) | NULL | — | Thành tiền trước thuế |
| vat_rate | int | NULL | — | Thuế suất VAT (%) |
| vat_amount | decimal(21,6) | NULL | — | Số tiền VAT |
| total_amount | decimal(21,6) | NULL | — | Thành tiền sau thuế |
| creator | int | NULL | — | ID người tạo (ep_user.id) |
| updater | int | NULL | — | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | — | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | — | Thời điểm cập nhật cuối |
| normalized_name | nvarchar(512) | NULL | — | Tên chuẩn hóa dùng tìm kiếm |
| extra | nvarchar(max) | NULL | — | Dữ liệu mở rộng (JSON) |
| amount | decimal(21,6) | NULL | — | Tổng tiền hàng |

**Constraints:**
| Tên | Loại | Cột | Ghi chú |
|-----|------|-----|---------|
| `invoice_product_ei_invoice_ei_id_fk` | FOREIGN KEY | (invoice_ei_id) → invoice_ei(id) | — |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_invoice_eiProduct_invoice_eiId_billId` | (invoice_ei_id, bill_id) | — | Lấy dòng hàng theo HĐĐT EI |
| `idx_invoice_eiProduct_productId` | (product_id) | — | Thống kê theo sản phẩm |

---

## Quan hệ giữa các bảng trong nhóm 7

```
bill (1) ──── (1) invoice (partition)  (1) ──── (N) invoice_product
     │
     └──── (1) invoice_ei              (1) ──── (N) invoice_product_ei
                    │
                    ▼
       invoice_product_ei_invoice_ei_id_fk (FK constraint)
```

**Luồng phát hành hóa đơn điện tử:**
1. Sau khi thanh toán `bill` → hệ thống tự động tạo `invoice` (hoặc `invoice_ei` tùy cấu hình)
2. Sao chép dòng sản phẩm từ `bill_product` → `invoice_product` / `invoice_product_ei`
3. Gửi dữ liệu lên cổng HĐĐT (Viettel, VNPT, MISA...) → nhận lại `ikey`, `tax_authority_code`
4. Cập nhật `tax_check_status` và `no` (số thứ tự hóa đơn) sau khi CQT xác nhận
5. Gửi email HĐĐT đến `customer_email` / `customer_emailcc`
6. Hóa đơn điều chỉnh/thay thế → dùng `refikey` trỏ về hóa đơn gốc

 