# SUMMARY — easyposbackoffice Database Context

Tổng hợp từ 10 file trong thư mục `db-context/`. Dùng làm tài liệu tham chiếu nhanh cho DBA và AI agent.

---

## 1. Kiến trúc tổng thể

### Always On AG

| Node | Mode | Current Role | Secondary Connections |
|------|------|-------------|----------------------|
| EASYPOS-DB1 | SYNCHRONOUS_COMMIT | PRIMARY | READ_ONLY |
| EASYPOS-DB2 | SYNCHRONOUS_COMMIT | SECONDARY | READ_ONLY |
| EASYPOS-DB3 | SYNCHRONOUS_COMMIT | SECONDARY | READ_ONLY |

- Cả 3 node đồng bộ synchronous — không mất data khi failover.
- Secondary **readable** — có thể route reporting queries sang DB2/DB3.

### Resource Governor

| Pool | min CPU | max CPU | Workload Group | Mục đích |
|------|---------|---------|---------------|----------|
| default | 50% | 60% | default | OLTP chính — application servers |
| PoolBackoffice | 5% | 10% | GroupBackoffice | Backoffice app |
| PoolReport | 0% | 20% | GroupReport | Reporting/analytics |
| PoolMonitor | 5% | 5% | GroupMonitor | Monitoring tool (Layer 1 + DMV queries) |
| internal | 0% | 100% | internal | SQL Server internal |

### CDC — Debezium

Capture trên Primary (EASYPOS-DB1), stream sang Kafka qua Debezium connector.

Các bảng đang capture: `customer`, `inventory`, `outbox_event`, `price_list`, `product`, `product_group`, `product_product_unit`, `product_unit`, `rs_inoutward`, `warehouse`

`debezium_heartbeat` — bảng heartbeat để monitor CDC lag.

---

## 2. Schemas

Database có **2 schemas** với bảng tên trùng — phải specify schema rõ ràng:

| Schema | Mục đích | Có partition? |
|--------|----------|--------------|
| `dbo` | POS bán lẻ + quản lý kho | Có (bill, invoice, rs_inoutward) |
| `ecommerce` | Đơn hàng sàn TMĐT (Shopee, Lazada...) | KHÔNG |

---

## 3. Row counts và kích thước (dbo schema)

| Bảng | Rows | Size (MB) | Partitions | Ghi chú |
|------|------|-----------|-----------|---------|
| `bill_product` | 364M | 89,373 | 10 | Lớn nhất theo dung lượng |
| `invoice_product` | 358M | 37,037 | 22 | Mirror từ bill_product cho HĐĐT |
| `bill` | 250M | 56,398 | 22 | Hóa đơn POS — bảng trung tâm |
| `invoice` | 247M | 46,350 | 22 | HĐĐT mới — 1-1 với bill |
| `payment_history` | 84M | 14,335 | 1 | KHÔNG partition |
| `mc_receipt` | 83M | 23,913 | 1 | KHÔNG partition |
| `rs_inoutward` | 39M | 15,350 | 10 | Phiếu nhập/xuất kho |
| `rs_inoutward_detail` | 36M | 21,921 | 10 | Chi tiết phiếu kho |
| `product_product_unit` | 32M | 2,948 | 1 | Hub table — KHÔNG partition |
| `product` | 32M | 4,966 | 1 | Catalog sản phẩm |
| `inventory` | 11M | 1,158 | 1 | Snapshot tồn kho |
| `customer` | 9.6M | 1,280 | 1 | Khách hàng |
| `product_unit` | 1.8M | 132 | 1 | Đơn vị tính |
| `mc_payment` | 723K | 253 | 1 | Phiếu chi |
| `debt` | 96K | 25 | 1 | Công nợ |
| `warehouse` | 49K | 7 | 1 | Kho hàng |

**ecommerce schema:**

| Bảng | Rows | Size (MB) |
|------|------|-----------|
| `ecommerce.bill_product` | 30M | 8,233 |
| `ecommerce.bill` | 22M | 10,179 |
| `ecommerce.invoice` | 9.5M | 1,414 |
| `ecommerce.invoice_product` | 6.4M | 2,806 |

---

## 4. Partition design

**Partition key:** `norm_quarter` kiểu INT, định dạng YYYYQ (VD: 20261 = Q1 2026).

| Bảng | Partition Scheme | PK Clustered | Lưu ý |
|------|-----------------|-------------|-------|
| `bill` | psBillQuarter | **(norm_quarter, id)** | norm_quarter đứng trước ✓ |
| `bill_product` | psBillProductQuarter | **(id, norm_quarter)** | id đứng trước — cần WHERE norm_quarter |
| `invoice` | psInvoiceQuarter | **(id, norm_quarter)** | id đứng trước |
| `invoice_product` | psInvoiceProductQuarter | **(id, norm_quarter)** | id đứng trước |
| `rs_inoutward` | psRsInOutWardQuarter | **(norm_quarter, id)** | norm_quarter đứng trước ✓ |
| `rs_inoutward_detail` | psRsInOutWardDetailQuarter | **(id, norm_quarter)** | id đứng trước |

**Quy tắc bắt buộc:** Luôn kèm `norm_quarter` trong WHERE để partition elimination hoạt động. Thiếu norm_quarter → full scan tất cả partitions.

---

## 5. Bảng quan trọng theo nhóm nghiệp vụ

### 5.1 Quản lý công ty & người dùng (file 01)

| Bảng | Rows | Mô tả |
|------|------|-------|
| `company_owner` | nhỏ | Tổ chức sở hữu nhiều công ty |
| `company` | nhỏ | Công ty/chi nhánh (com_id) |
| `ep_user` | nhỏ | Tài khoản người dùng |
| `company_user` | nhỏ | Gán người dùng vào công ty |
| `role`, `permission`, `role_permission` | nhỏ | Phân quyền |

### 5.2 Khách hàng & Loyalty (file 02)

| Bảng | Mô tả |
|------|-------|
| `customer` | 9.6M rows — multi-tenant by com_id |
| `customer_card` | Thẻ thành viên tích điểm — UNIQUE (com_id, customer_id) |
| `loyalty_card` | Hạng thẻ (Bronze, Silver, Gold) |
| `loyalty_card_usage` | Lịch sử tích/tiêu điểm |
| `voucher`, `voucher_company`, `voucher_apply`, `voucher_usage` | Hệ thống voucher/khuyến mãi |

**Key indexes customer:**
- `idx_customer_comId_name_active_included` (com_id, name, active) — tìm theo tên
- `idx_customer_comId_taxcode_active_included` (com_id, tax_code, active) — tìm theo MST

### 5.3 Sản phẩm & Kho (file 03)

| Bảng | Rows | Mô tả |
|------|------|-------|
| `product` | 32M | Catalog sản phẩm |
| `product_product_unit` (PPU) | 32M | **Hub table** — junction trung tâm |
| `inventory` | 11M | Snapshot tồn kho |
| `inventory_log` | — | Queue async cập nhật tồn kho |
| `rs_inoutward` | 39M | Phiếu nhập/xuất kho (partitioned) |
| `rs_inoutward_detail` | 36M | Chi tiết phiếu kho (partitioned) |
| `warehouse` | 49K | Kho hàng |
| `batches` | — | Lô hàng/hạn sử dụng |
| `price_list`, `price_list_product` | — | Bảng giá |

**Key indexes PPU:**
- `IX_ppu_primary_productid` FILTERED (is_primary=1) — chỉ dùng khi cần đơn vị chính
- `IX_product_product_unit_productId_isPrimary` (product_id, is_primary) — non-filtered
- `idx_com_id_product_id` (product_id, com_id) — lấy tất cả PPU của sản phẩm

**Key indexes inventory_log:**
- `inventory_check_index` (com_id, status, product_id, ppu_id, warehouse_id) — phải include status trong WHERE

### 5.4 Khu vực & Bàn (file 04)

| Bảng | Mô tả |
|------|-------|
| `area` | Khu vực (tầng, khu...) |
| `area_unit` | Bàn/phòng trong khu vực |
| `reservation`, `reservation_detail` | Đặt bàn trước |
| `processing_request`, `processing_request_detail` | Phiếu yêu cầu chế biến gửi bếp |
| `processing_product` | Tracking trạng thái chế biến từng món |

### 5.5 Hóa đơn & Thanh toán (file 05)

| Bảng | Rows | Mô tả |
|------|------|-------|
| `bill` | 250M | Hóa đơn POS — bảng trung tâm (partitioned) |
| `bill_product` | 364M | Dòng sản phẩm (partitioned) |
| `invoice` | 247M | HĐĐT mới (partitioned) |
| `invoice_ei` | — | HĐĐT chuẩn EI cũ — **KHÔNG partition** |
| `payment_history` | 84M | Lịch sử thanh toán — **KHÔNG partition** |
| `mc_receipt` | 83M | Phiếu thu — **KHÔNG partition** |
| `mc_payment` | 723K | Phiếu chi |
| `debt` | 96K | Công nợ |

**Key indexes bill:**
- `idx_bill_comId_normDate` (norm_quarter, com_id, norm_date) — báo cáo doanh thu
- `idx_com_id_norm_quarter_norm_date` (com_id, norm_quarter, norm_date) — variant khác
- `idx_bill_customerId` (customer_id, norm_quarter) — lịch sử mua hàng

**⚠️ payment_history không có index theo bill_id** — query JOIN bill→payment_history sẽ scan 84M rows nếu không có filter phụ.

---

## 6. Relation diagram (tóm tắt)

```
company_owner → company → ep_user
                    │
                    ├── customer → customer_card → loyalty_card
                    │
                    ├── product → product_product_unit (PPU) ←─── HUB
                    │                    │
                    │        ┌───────────┼───────────────┐
                    │        ▼           ▼               ▼
                    │  inventory  bill_product    price_list_product
                    │                             rs_inoutward_detail
                    │
                    ├── warehouse → inventory
                    │
                    ├── area → area_unit
                    │               │
                    ▼               ▼
                  bill ──────────────────
                    │
                    ├── bill_product
                    ├── invoice (1-1)
                    ├── invoice_ei (1-1, no partition)
                    ├── payment_history
                    ├── mc_receipt
                    └── rs_inoutward → rs_inoutward_detail
```

---

## 7. Known Performance Patterns

| # | Pattern | Tác động | Fix |
|---|---------|----------|-----|
| 1 | Thiếu `norm_quarter` trong WHERE | Full scan tất cả partitions | Thêm norm_quarter vào WHERE |
| 2 | Function trên `norm_quarter` hoặc `norm_date` | Partition elimination bị bypass | Dùng range sargable |
| 3 | `invoice_ei` không có WHERE thời gian | Full table scan | Luôn filter theo arising_date hoặc publish_date |
| 4 | JOIN `bill` → `payment_history` không filter | Scan 84M rows (không có index bill_id) | Thêm filter norm_date/norm_quarter trên payment_history |
| 5 | Cross-schema query không specify schema | Query nhầm `ecommerce.bill` vs `dbo.bill` | Luôn dùng schema prefix |
| 6 | `inventory_log` không include `status` trong WHERE | Không dùng filtered/status index | WHERE status = 0 hoặc dùng index hint |
| 7 | CDC Debezium + high DML giờ cao điểm | TempDB version store tăng, I/O tăng | Monitor CDC lag và version store |
| 8 | `product_product_unit` join không filter is_primary | Không dùng IX_ppu_primary_productid FILTERED | Thêm WHERE is_primary = 1 nếu chỉ cần đơn vị chính |
