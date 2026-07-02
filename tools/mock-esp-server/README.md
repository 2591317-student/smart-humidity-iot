# mock-esp-server — Giả lập REST API của ESP

Tool Node.js giả lập máy chủ HTTP provisioning của ESP32 (chế độ SoftAP) để **test app PWA
provisioning mà KHÔNG cần phần cứng ESP thật**.

Tuân theo `docs/CONTRACT.md`:
- Mục 5 — Provisioning REST API
- Mục 6 — QR payload

## Cài đặt & chạy

```bash
cd tools/mock-esp-server
npm install        # cài express + cors
npm start          # chạy trên cổng 8080 (đổi bằng biến môi trường PORT)
```

Server in ra console địa chỉ, thông tin thiết bị mô phỏng, và **chuỗi QR JSON mẫu** (CONTRACT
mục 6) để dán vào PWA khi test.

> Đổi cổng: `PORT=9000 npm start`

## Endpoint (CONTRACT mục 5)

| Method | Path | Mô tả |
|---|---|---|
| `GET`  | `/info`      | Thông tin thiết bị: `{ id, role, mac, fw, provisioned }` |
| `POST` | `/provision` | Nhận cấu hình WiFi + tài khoản thiết bị (JSON), **log ra console**, trả `{ ok, message, mac }` |
| `POST` | `/reset`     | Xoá cấu hình mô phỏng, quay về `provisioned: false` |
| `GET`  | `/`          | Trang HTML form provisioning same-origin (fallback luôn hoạt động) |

**CORS** đã bật cho mọi origin (`Access-Control-Allow-Origin: *`) và xử lý preflight `OPTIONS`,
giống ghi chú trong CONTRACT để PWA gọi POST được từ trình duyệt.

## Body POST /provision (ví dụ)

```json
{
  "ssid": "TenWiFiNha",
  "password": "matkhauwifi",
  "deviceEmail": "device@project.iot",
  "devicePassword": "******",
  "peerMac": "11:22:33:44:55:66",
  "hset": 70,
  "deadband": 5
}
```

Phản hồi:

```json
{ "ok": true, "message": "Saved. Rebooting.", "mac": "A1:B2:C3:D4:E5:F6" }
```

Chỉ `ssid` là bắt buộc; thiếu sẽ trả HTTP 400. Các secret (password) được che một phần khi log.

## Thử nhanh bằng curl

```bash
curl http://localhost:8080/info

curl -X POST http://localhost:8080/provision \
  -H "Content-Type: application/json" \
  -d '{"ssid":"TenWiFiNha","password":"matkhauwifi","peerMac":"11:22:33:44:55:66"}'
  # (mock vẫn chấp nhận field cũ deviceEmail/devicePassword/hset/deadband nếu gửi kèm — tương thích ngược)

curl -X POST http://localhost:8080/reset
```

Hoặc mở trình duyệt tại `http://localhost:8080/` để dùng form HTML.

## Dùng với PWA

Vì PWA chạy HTTPS không POST thẳng được tới ESP HTTP (mixed-content), khi test không có phần cứng:
mở PWA qua `http://localhost` rồi cho PWA trỏ REST tới `http://localhost:8080` (server này) thay
vì `http://192.168.4.1`. Chuỗi QR mẫu in ở console giúp mô phỏng bước "quét QR".

## Mô phỏng thiết bị khác

Mặc định giả lập một ESP1 (role `main`). Để giả lập ESP2 (role `sensor`), sửa object `DEVICE`
trong `server.js` (đổi `role`, `mac6`, `macFull`).
