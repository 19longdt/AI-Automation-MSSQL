# Tổng quan dự án

## Đây là gì?

Hệ thống **tự động giám sát và phân tích sự cố** cho cụm cơ sở dữ liệu Microsoft SQL Server đang chạy trong môi trường sản xuất (production).

Thay vì DBA (Database Administrator) phải ngồi theo dõi màn hình 24/7 để phát hiện khi nào server chậm, khi nào có query bị chặn, khi nào ổ đĩa gần đầy — hệ thống này tự làm việc đó và gửi thông báo khi phát hiện vấn đề.

---

## Bối cảnh: Cụm SQL Server là gì?

Hệ thống này giám sát một **cụm Always On Availability Groups (AG)** gồm 3 máy chủ:

```
┌─────────────────────────────────────────────────────┐
│                    AG Cluster                        │
│                                                      │
│  ┌──────────────┐        ┌──────────────┐           │
│  │  PRIMARY     │──sync──│  SECONDARY 1 │           │
│  │  SQL-NODE-01 │        │  SQL-NODE-02 │           │
│  │              │──sync──│  SECONDARY 3 │           │
│  │  (đọc+ghi)   │        │  SQL-NODE-03 │           │
│  └──────────────┘        │  (chỉ đọc)   │           │
│                           └──────────────┘           │
└─────────────────────────────────────────────────────┘
```

**Primary node**: Nhận tất cả lệnh ghi (INSERT/UPDATE/DELETE). Đây là node quan trọng nhất.

**Secondary nodes**: Nhận bản sao dữ liệu từ Primary theo thời gian thực. Có thể dùng để đọc dữ liệu (giảm tải cho Primary).

**Failover**: Nếu Primary hỏng, hệ thống tự động "bầu" một Secondary lên làm Primary mới. **Đây là lý do hệ thống giám sát KHÔNG được hardcode (ghi cứng) tên máy nào là Primary** — vì nó có thể thay đổi bất kỳ lúc nào.

---

## Vấn đề cần giải quyết

Trong môi trường production với SQL Server 2019 Enterprise, các vấn đề phổ biến là:

| Vấn đề | Triệu chứng | Tác động |
|--------|-------------|----------|
| **Slow query** | Query đột ngột chạy lâu hơn bình thường | Ứng dụng chậm, timeout |
| **Blocking** | Query A đang chờ Query B giải phóng lock | Hàng nghìn user bị treo |
| **AG lag** | Secondary bị tụt hậu, dữ liệu không đồng bộ | Đọc dữ liệu cũ từ Secondary |
| **TempDB đầy** | Bộ nhớ tạm hết chỗ | Query thất bại hàng loạt |
| **Index xấu** | Optimizer dùng sai chỉ mục | Tốn gấp 100× tài nguyên |

Phát hiện những vấn đề này sớm (trong vài phút thay vì vài giờ) giúp ngăn ngừa sự cố lớn.

---

## Giải pháp: Kiến trúc 2 lớp

```
MSSQL AG Cluster (3 nodes)
        │
        │  Thu thập dữ liệu mỗi 1-5 phút
        ▼
┌──────────────────────┐
│  LAYER 1             │  ← Python service chạy liên tục
│  Python Monitoring   │     Phát hiện vấn đề tự động
│                      │     Lưu vào MongoDB
│  Chạy 24/7           │     Gửi alert Teams/Slack
└──────────┬───────────┘
           │  Khi phát hiện vấn đề nghiêm trọng
           ▼
┌──────────────────────┐
│  LAYER 2             │  ← AI Agent (FastAPI + Claude API) ✅
│  Claude AI Agent     │     Phân tích nguyên nhân sâu
│                      │     Đề xuất cách sửa
│  Khi cần thiết       │     Admin xem xét và duyệt
└──────────────────────┘
```

### Layer 1 làm gì?
- **Thu thập** dữ liệu từ SQL Server DMV (Dynamic Management Views — các view hệ thống cung cấp thông tin về hiệu suất)
- **Phân tích** dữ liệu theo các ngưỡng (threshold) hoặc so với lịch sử (baseline)
- **Lưu** kết quả vào MongoDB
- **Gửi thông báo** qua Teams/Slack/Telegram khi phát hiện vấn đề

### Layer 2 làm gì?
- Nhận output từ Layer 1
- Gọi Claude API để phân tích sâu hơn
- Đề xuất cách sửa (index mới, rewrite query, update statistics...)
- **Yêu cầu admin duyệt** trước khi thực thi bất kỳ thay đổi nào

---

## Điểm đặc biệt: Config-driven

**Vấn đề thông thường**: Mỗi lần muốn thêm một query giám sát mới hoặc thay đổi ngưỡng cảnh báo, phải sửa code Python → build lại → deploy lại → downtime.

**Giải pháp**: Tất cả SQL queries, ngưỡng cảnh báo, và tần suất chạy được lưu trong **MongoDB** thay vì trong code.

```
Muốn thêm query mới?
  → Thêm document vào MongoDB collection "monitor_topics"
  → Lần chạy kế tiếp (sau vài phút) tự động pick up
  → KHÔNG cần restart service

Muốn thay đổi ngưỡng cảnh báo?
  → Sửa document trong MongoDB
  → Có hiệu lực ngay lần chạy tiếp theo
```

Đây là lý do code Python chỉ là "generic executor" — nó không biết gì về business logic, chỉ đọc config từ MongoDB và thực thi.

---

## Tính năng giám sát

| Tên | Tần suất | Mục đích |
|-----|----------|----------|
| Slow Query / Baseline | 5 phút | Phát hiện query đột ngột chậm hơn bình thường |
| Plan Regression | 5 phút | Phát hiện execution plan thay đổi xấu hơn |
| Blocking & Deadlock | 1 phút | Phát hiện query bị chặn, deadlock |
| TempDB & Memory | 5 phút | Giám sát áp lực bộ nhớ và TempDB |
| Wait Statistics | 5 phút | Phân tích loại chờ đang tăng bất thường |
| AG Health & CDC | 2 phút | Kiểm tra đồng bộ cluster và CDC |
| Index Fragmentation | Hàng ngày 3AM | Phát hiện index phân mảnh |
| Missing Index | 1 giờ | SQL Server gợi ý index còn thiếu |
| Resource Governor | 5 phút | Giám sát resource pools |
| SQL Agent Jobs | 10 phút | Phát hiện job thất bại, backup thiếu |

---

## Stack công nghệ

| Thành phần | Công nghệ | Lý do chọn |
|-----------|-----------|------------|
| Language | Python 3.11+ | Dễ đọc, ecosystem phong phú |
| MSSQL driver | pyodbc | Kết nối SQL Server qua ODBC |
| Scheduler | APScheduler | Chạy jobs theo interval, cron |
| Config/Storage | MongoDB | Linh hoạt, không cần schema cứng |
| Data models | Pydantic | Validate và serialize dữ liệu |
| Plan XML parser | lxml | Parse execution plan XML từ SQL Server |
| Notifications | pymsteams, slack-sdk | Gửi alert đa kênh |
| AI (Layer 2) | Anthropic Claude API | Phân tích và đề xuất fix |

---

**Author:** Long Do | Backend Engineering | longdt@softdreams.vn
