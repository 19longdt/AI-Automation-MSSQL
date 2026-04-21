# Nhóm 1: Quản lý Công ty & Người dùng

---

## Bảng: `company_owner`
**Mô tả:** Chủ sở hữu / tổ chức cấp trên quản lý nhiều công ty con. Mỗi `company_owner` có thể sở hữu nhiều `company`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| name | nvarchar(512) | NULL | Tên tổ chức / chủ sở hữu |
| address | nvarchar(512) | NULL | Địa chỉ |
| tax_code | nvarchar(14) | NULL | Mã số thuế |
| owner_name | nvarchar(255) | NULL | Tên người đại diện / chủ sở hữu |
| owner_id | int | NULL | ID người dùng (ep_user) là chủ sở hữu |
| ikey | varchar(100) | NULL | Khóa định danh tích hợp với cơ quan thuế |
| tax_machine_code | varchar(10) | NULL | Mã máy tính tiền đã đăng ký với cơ quan thuế |
| tax_register_time | datetime | NULL | Thời điểm đăng ký máy tính tiền với cơ quan thuế |
| tax_register_message | nvarchar(50) | NULL | Thông báo kết quả đăng ký thuế |
| tax_register_status | int | NULL | Trạng thái đăng ký thuế (0=chưa đăng ký, 1=thành công, ...) |
| is_select_business_type | bit | NULL | Đã chọn loại hình kinh doanh hay chưa |
| info_data | nvarchar(512) | NULL | Thông tin bổ sung dạng JSON |
| crm_ref | varchar(50) | NULL | Mã tham chiếu trong hệ thống CRM |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_companyOwner_taxcode_included` | (tax_code) | name, owner_name, tax_machine_code | Tìm kiếm theo MST |
| `idx_companyOwner_ownerName_included` | (owner_name) | name, tax_code, tax_machine_code | Tìm kiếm theo tên người đại diện |
| `idx_companyOwner_ownerId` | (owner_id) | — | Tìm công ty theo chủ sở hữu |

---

## Bảng: `company`
**Mô tả:** Thông tin từng công ty / chi nhánh trong hệ thống. Mỗi công ty thuộc một `company_owner`.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| com_owner_id | int | NULL | FK → company_owner.id — Chủ sở hữu của công ty |
| business_type | int | NULL | Loại hình kinh doanh (FK → business.id) |
| business_id | int | NULL | ID ngành nghề kinh doanh (FK → business.id) |
| name | nvarchar(255) | NULL | Tên công ty |
| normalized_name | nvarchar(512) | NULL | Tên đã chuẩn hóa (bỏ dấu, lowercase) dùng để tìm kiếm |
| phone | varchar(50) | NULL | Số điện thoại liên hệ |
| address | nvarchar(255) | NULL | Địa chỉ |
| description | nvarchar(255) | NULL | Mô tả công ty |
| email | nvarchar(400) | NULL | Email liên hệ |
| fax_number | varchar(100) | NULL | Số fax |
| bank_account | varchar(100) | NULL | Số tài khoản ngân hàng mặc định |
| account_name | nvarchar(255) | NULL | Tên chủ tài khoản ngân hàng |
| is_parent | bit | NULL | Có phải công ty cha (chuỗi/hệ thống) hay không |
| eb_id | int | NULL | ID trong hệ thống EB (tích hợp ngoài) |
| service | varchar(50) | NULL | Loại dịch vụ đang sử dụng (mặc định 'EI' sau mỗi lần update) |
| ref_center_unit_id | varchar(255) | NULL | ID đơn vị trung tâm tham chiếu (xăng dầu, gas...) |
| integration_type | nvarchar(100) | NULL | Loại tích hợp bên ngoài |
| id_pharmaceutical | nvarchar(100) | NULL | ID đơn vị dược — dùng cho hệ thống nhà thuốc |
| password_pharmaceutical | nvarchar(255) | NULL | Mật khẩu tích hợp hệ thống dược |
| acqId | int | NULL | ID ngân hàng thanh toán (acquirer) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_company_comOwnerId` | (com_owner_id) | Lấy danh sách công ty theo chủ sở hữu |

**Triggers:**
| Tên trigger | Sự kiện | Hành động |
|-------------|---------|-----------|
| `trg_SetDefaultServiceOnUpdate` | AFTER UPDATE | Tự động set `service = 'EI'` nếu `service IS NULL` sau khi update |

---

## Bảng: `ep_user`
**Mô tả:** Tài khoản người dùng hệ thống. Một người dùng có thể thuộc nhiều công ty (qua `company_user`).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| username | varchar(100) | NULL | Tên đăng nhập (unique kết hợp với status) |
| password | varchar(100) | NULL | Mật khẩu đã hash |
| full_name | nvarchar(100) | NULL | Họ tên đầy đủ |
| normalized_name | nvarchar(512) | NULL | Họ tên đã chuẩn hóa (bỏ dấu, lowercase) dùng tìm kiếm |
| email | varchar(100) | NULL | Email |
| phone_number | varchar(100) | NULL | Số điện thoại |
| address | nvarchar(512) | NULL | Địa chỉ |
| is_manager | bit | NULL | Có phải quản lý hay không |
| authority | varchar(20) | NULL | Cấp quyền hạn (ADMIN, USER...) |
| status | int | NULL | Trạng thái tài khoản (1=active, 0=inactive) |
| password_version | int | NULL | Phiên bản thuật toán hash mật khẩu — dùng để migrate khi đổi cơ chế hash |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Constraints:**
| Tên | Loại | Cột | Mô tả |
|-----|------|-----|-------|
| `unique_ep_user_username_status` | UNIQUE | (username, status) | Cho phép tồn tại username trùng nếu một trong số đó đã bị vô hiệu (status khác nhau) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_epUser_username_password_included` | (username, password) | full_name, phone_number, is_manager, authority | Hỗ trợ xác thực đăng nhập |

---

## Bảng: `company_user`
**Mô tả:** Bảng trung gian liên kết người dùng với công ty (quan hệ nhiều-nhiều). Xác định nhân viên nào làm việc tại công ty nào.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| company_id | int | NOT NULL | FK → company.id — Công ty |
| user_id | int | NOT NULL | FK → ep_user.id — Người dùng |
| ref_id | int | NULL | ID tham chiếu liên kết với hệ thống ngoài |
| shift_management | bit | NULL | Người dùng này có quản lý ca làm việc hay không |
| status | int | NOT NULL | Trạng thái (DEFAULT 1 = active, 0 = inactive) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `company_user_company_id_fk` | company_id | company(id) |
| `company_user_ep_user_id_fk` | user_id | ep_user(id) |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_companyUser_companyId` | (company_id) | Lấy danh sách nhân viên của một công ty |
| `idx_companyUser_userId` | (user_id) | Lấy danh sách công ty của một người dùng |

---

## Bảng: `role`
**Mô tả:** Vai trò / nhóm quyền trong một công ty. Mỗi role thuộc về một `company` cụ thể (trừ role hệ thống).

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| com_id | int | NULL | FK → company.id — Công ty sở hữu role này |
| code | nvarchar(50) | NULL | Mã định danh của role (duy nhất trong công ty) |
| name | nvarchar(150) | NULL | Tên hiển thị của role |
| normalized_name | varchar(200) | NULL | Tên đã chuẩn hóa dùng để tìm kiếm |
| type | int | NULL | Loại role (hệ thống / tùy chỉnh) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_role_name` | (name) | Tìm kiếm role theo tên |

---

## Bảng: `permission`
**Mô tả:** Danh sách các quyền hệ thống, tổ chức theo cấu trúc cây cha-con. Ví dụ: quyền cha "Quản lý kho" có các quyền con "Xem kho", "Tạo phiếu nhập", v.v.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| code | varchar(50) | NULL | Mã quyền (duy nhất trong toàn hệ thống) |
| parent_id | int | NULL | ID quyền cha — NULL nếu là quyền gốc |
| parent_code | varchar(50) | NULL | Mã quyền cha (denormalized để truy vấn nhanh) |
| name | nvarchar(255) | NULL | Tên quyền hiển thị |
| description | nvarchar(255) | NULL | Mô tả ý nghĩa của quyền |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_permission_parentId` | (parent_id) | Lấy danh sách quyền con của một quyền cha |

---

## Bảng: `role_permission`
**Mô tả:** Gán quyền (`permission`) cho role. Xác định role nào có những quyền gì.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| role_id | int | NULL | FK → role.id — Role được gán quyền |
| permission_id | int | NULL | FK → permission.id — Quyền được gán |
| role_code | varchar(50) | NULL | Mã role (denormalized để truy vấn nhanh) |
| permission_code | varchar(50) | NULL | Mã quyền (denormalized để truy vấn nhanh) |
| permission_parent_code | varchar(50) | NULL | Mã quyền cha (denormalized — hỗ trợ kiểm tra phân cấp) |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `role_permission_role_id_fk` | role_id | role(id) |
| `role_permission_permission_id_fk` | permission_id | permission(id) |

**Indexes:**
| Tên index | Cột | INCLUDE | Ghi chú |
|-----------|-----|---------|---------|
| `idx_rolePermission_roleCode` | (role_code) | — | Lấy danh sách quyền theo mã role |
| `idx_rolePermission_roleId` | (role_id) | permission_code | Lấy quyền của role, kết hợp covering index |

---

## Bảng: `user_role`
**Mô tả:** Gán role cho người dùng trong phạm vi một công ty. Một người dùng có thể có nhiều role khác nhau tại các công ty khác nhau.

| Cột | Kiểu dữ liệu | Null | Mô tả |
|-----|-------------|------|-------|
| id | int IDENTITY | NOT NULL | Khóa chính, tự tăng |
| user_id | int | NULL | FK → ep_user.id — Người dùng được gán role |
| role_id | int | NULL | FK → role.id — Role được gán |
| com_id | int | NULL | FK → company.id — Công ty áp dụng role này |
| creator | int | NULL | ID người tạo (ep_user.id) |
| updater | int | NULL | ID người cập nhật cuối (ep_user.id) |
| create_time | datetime | NULL | Thời điểm tạo bản ghi |
| update_time | datetime | NULL | Thời điểm cập nhật cuối |

**Foreign Keys:**
| Tên constraint | Cột | Tham chiếu |
|----------------|-----|-----------|
| `user_role_ep_user_id_fk` | user_id | ep_user(id) |
| `user_role_role_id_fk` | role_id | role(id) |

**Indexes:**
| Tên index | Cột | Ghi chú |
|-----------|-----|---------|
| `idx_userRole_comId` | (com_id) | Lấy danh sách user-role trong một công ty |

---

### `otp`
Mã OTP xác thực.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK NONCLUSTERED (`PK_otp`) |
| username | varchar(100) | Tên đăng nhập |
| OTP | varchar(6) | Mã OTP 6 chữ số |
| expired_time | datetime | Thời điểm hết hạn |
| type | int | Loại OTP |
| send_type | int | Kênh gửi (SMS/Email) |
| status | int | Trạng thái |

**Indexes:**
- `otp_pk` (UNIQUE CLUSTERED) — (id)

---

### `owner_package`
Gói dịch vụ đã đăng ký của company_owner.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK (`owner_package_pk`) |
| owned_id | int | FK → company_owner |
| package_id | int | FK → package |
| status | int | Trạng thái |
| start_date / end_date | datetime | Thời hạn gói |
| pack_count | int | Số lượng gói |
| voucher_using | int | Số voucher đã dùng |

### `package`
Định nghĩa các gói dịch vụ.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK (`package_pk`) |
| package_code | nvarchar(50) | Mã gói |
| package_name | nvarchar(255) | Tên gói |
| limit_company | int | Giới hạn số công ty |
| limit_user | int | Giới hạn số người dùng |
| limit_voucher | int | Giới hạn số chứng từ |
| time | int | Thời hạn tháng (-1 = không giới hạn) |
| type | varchar(100) | Loại gói |
| status | int | Trạng thái gói |

---

### `owner_device`
Thiết bị in/POS của company_owner.

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | int | PK (`owner_device_pk`) |
| owner_id | int | FK → company_owner |
| name | nvarchar(512) | Tên thiết bị |
| device_code | varchar(3) | Mã thiết bị |

## Quan hệ giữa các bảng trong nhóm

```
company_owner (1) ──── (N) company
company       (1) ──── (N) company_user ──── (N) ep_user
company       (1) ──── (N) role
ep_user       (1) ──── (N) user_role    ──── (N) role
role          (1) ──── (N) role_permission ── (N) permission
permission    (1) ──── (N) permission (self-ref: parent_id)
```

**Luồng phân quyền:**
1. `ep_user` được liên kết với `company` qua `company_user`
2. `ep_user` được gán `role` trong từng `company` qua `user_role`
3. `role` được gán danh sách `permission` qua `role_permission`
4. Khi kiểm tra quyền: lấy `user_role` → lấy `role_permission` → kiểm tra `permission.code`