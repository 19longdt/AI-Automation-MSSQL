# README_CUSTOM

- Author: `Custom by LongDo + Codex assistant`
- Last updated: `2026-04-29`

## 1) Mục đích dự án
`html-query-plan` là thư viện hiển thị SQL Server Execution Plan (ShowPlan XML) trên web (HTML + JavaScript).

Bản custom hiện tại tập trung vào trải nghiệm đọc plan lớn và thao tác nhanh:
- Tách riêng khung query và khung diagram.
- Scroll riêng từng khung.
- Zoom/pan cho diagram.
- Tab query: `Real Query` / `Resolved Query`.
- Nút `Show Plan XML` và `AI Assist` đặt trong khối query (cùng ngữ cảnh).
- Popup XML dạng cây (tree view), có `Expand all` / `Collapse all`.
- Loading overlay giữa màn hình cho các action nặng.
- Error banner hiển thị lỗi XML/file/render ngay trên màn hình.

## 2) Yêu cầu môi trường
- Node.js (khuyến nghị Node 18+; máy hiện tại đang dùng Node 22).
- npm (trên PowerShell nên dùng `npm.cmd`).

Lưu ý với webpack 4 cũ:
```powershell
$env:NODE_OPTIONS="--openssl-legacy-provider"
```

## 3) Cách chạy local
```powershell
cd C:\GIT\html-query-plan
npm.cmd install
$env:NODE_OPTIONS="--openssl-legacy-provider"
npm.cmd run webpack
```

Mở demo:
- `examples/index.html`

Routing UI:
- `/` -> trang chủ (mặc định tab `Lịch sử`)
- `/history` -> tab `Lịch sử`
- `/extract-query-plan` -> tab `Truy xuất Plan XML`

## 4) Tính năng đã custom

### 4.1 Input và render XML
- Upload file `.sqlplan`.
- Nút `Paste XML` mở modal để dán XML.
- Auto render sau 2 giây khi ngừng gõ.
- Nút `Render now` để render ngay.

### 4.2 Query hiển thị theo tab
- `Real Query`: query gốc từ `StatementText`.
- `Resolved Query`: query thay tham số từ plan (`ParameterRuntimeValue` ưu tiên, fallback `ParameterCompiledValue`).
- Tự động bỏ prefix params đầu câu nếu có dạng:
  - `(xxx int, yyy int, ...)SELECT ...`

### 4.3 XML popup
- `Show Plan XML` mở popup riêng.
- Chỉ hiển thị `Raw ShowPlan XML` dạng tree.
- Có thể mở rộng/thu gọn từng thẻ XML.
- Có mũi tên trực quan:
  - `▶` khi đóng
  - `▼` khi mở
- Có nút `Expand all` / `Collapse all`.

### 4.4 Diagram UX
- Toolbar trong khung diagram:
  - `-` (zoom out)
  - `+` (zoom in)
  - `100%` (reset)
- Kéo chuột trái để pan.
- Scroll riêng cho diagram.

### 4.5 Loading và lỗi
- Loading overlay ở giữa màn hình cho action nặng:
  - Parse/render plan
  - Mở popup ShowPlan
  - Chuyển tab query
- Error banner trên màn hình khi:
  - XML lỗi parse
  - Render lỗi
  - Đọc file lỗi

### 4.6 Layout và scroll (1 viewport)
- Trang chính hiển thị vừa đúng 1 khung hình (viewport), không scroll toàn trang.
- `body` và khung ngoài không cuộn.
- Scroll chỉ xuất hiện ở vùng nội dung bên trong khi dữ liệu dài:
  - Tab `Lịch sử`: cuộn trong panel lịch sử.
  - Tab `Truy xuất Plan XML`: cuộn trong vùng render/diagram (container bên trong `upload.html`).

## 5) Dynamic layout
Tỷ lệ theo chiều dọc trong mỗi statement:
- Mặc định: `20% (query) - 10% (missing index) - 70% (diagram)`.
- Nếu không có missing index:
  - Ẩn panel missing index.
  - Tự co/giãn lại phần query + diagram.

## 6) Mapping icon
- Đã tải bộ icon từ Microsoft Learn (`ver17`) vào:
  - `assets/ssms-icons-ver17`
- Đã map lại class icon trong:
  - `css/qp.css`

## 7) File chính đã chỉnh sửa
- `examples/index.html`
  - Thanh tab điều hướng (`Lịch sử` / `Truy xuất Plan XML`).
  - Đồng bộ tab theo URL (`/history`, `/extract-query-plan`).
  - Layout full-height, không scroll toàn trang.
- `src/qp.xslt`
  - Tách cấu trúc statement block.
  - Thêm tab query và action buttons (`Show Plan XML`, `AI Assist`).
- `src/index.ts`
  - Query tab logic.
  - Resolve tham số.
  - Dynamic layout theo missing index.
  - Zoom/pan cho diagram.
- `src/lines.ts`
  - Vẽ line theo từng `qp-diagram-canvas`.
- `css/qp.css`
  - Layout/scroll.
  - Toolbar zoom.
  - Style query tabs/actions.
  - Mapping icon mới.
- `examples/upload.html`
  - Modal paste XML.
  - Auto render 2 giây.
  - Loading overlay giữa màn hình.
  - Error banner.
  - Popup tree view cho ShowPlan XML.
  - Layout full-height và chỉ cuộn ở vùng nội dung render.
- `nginx.conf`
  - Route `/`, `/history`, `/extract-query-plan` cùng serve `examples/index.html`.
  - Static assets phục vụ qua `try_files`.

## 8) Deployment (Docker)

Phần này mô tả luồng deploy theo kiểu build image, push lên registry, và chạy bằng `docker compose`.

### 8.1 Build image
Ví dụ:
```powershell
docker build -t 19longdt/ai-automation-mssql-layer3:latest .
```

### 8.2 Push image
```powershell
docker push 19longdt/ai-automation-mssql-layer3:latest
```

### 8.3 Chạy bằng docker compose
Ví dụ `docker-compose.yml`:
```yaml
services:
  layer3:
    image: 19longdt/ai-automation-mssql-layer3:latest
    container_name: layer3-dashboard
    ports:
      - "3000:3000"
    restart: unless-stopped
```

Chạy:
```powershell
docker compose up -d
```

Kiểm tra:
```powershell
docker compose ps
docker compose logs -f html-query-plan
```

Lưu ý:
- Nếu dùng private registry, cần `docker login` trước khi pull/run.
- Nếu image dùng tag theo version (ví dụ `v1.0.0`), đổi `latest` thành tag tương ứng.

## 9) Ghi chú
- Dự án đang dùng webpack 4 + TypeScript cũ, cần giữ tương thích khi sửa code.
- Với Node phiên bản mới, ưu tiên set `NODE_OPTIONS=--openssl-legacy-provider` trước khi build.
