# PWA Provisioning — Cấu hình WiFi cho ESP (QR + REST)

App web cài được (PWA) để nạp cấu hình WiFi + tài khoản Firebase vào thiết bị ESP của hệ thống
**Smart Humidity IoT**. Hoạt động theo `docs/CONTRACT.md` mục 5 (REST provisioning) và mục 6 (QR payload).

> Provisioning **không bắt buộc đăng nhập** Firebase. App chỉ POST cấu hình tới ESP qua mạng cục bộ.

## Có gì trong thư mục

```
mobile/
├── index.html             # Giao diện mobile-first (Tailwind play CDN)
├── manifest.webmanifest   # PWA installable ("thêm vào màn hình chính")
├── sw.js                  # Service worker — cache vỏ ứng dụng, không cache POST
└── js/
    ├── app.js             # Luồng chính: state QR, form, POST, hiển thị response
    └── qr.js              # Quét QR bằng html5-qrcode + parse JSON {id,role,ap,ip,mac}
```

## Luồng sử dụng

1. **Quét QR** dán trên thiết bị → lấy `{id, role, ap, ip, mac}`. Không có QR thì bấm **Nhập tay**
   và điền IP (mặc định `192.168.4.1`).
2. **Kết nối WiFi**: trên điện thoại vào Cài đặt → WiFi, nối tới AP của ESP (vd `PROV-MAIN-A1B2C3`,
   mật khẩu mặc định `12345678` nếu có). Khi nối vào AP, điện thoại có thể tạm mất Internet — bình thường.
3. **Điền form**: SSID/mật khẩu WiFi nhà; với `role=main` (ESP1) cần thêm `deviceEmail`/`devicePassword`
   (tài khoản thiết bị tạo trong Firebase Auth) và `peerMac` (MAC của ESP2, tự điền từ QR); `hset`/`deadband`
   (mặc định 70 / 5).
4. **Gửi cấu hình** → POST JSON tới `http://<ip>/provision`. App hiển thị rõ kết quả + **response thô (raw JSON)** từ thiết bị.
5. **Chế độ Test**: bật toggle để POST tới `http://localhost:8080` (`tools/mock-esp-server`) — thử
   toàn bộ luồng mà không cần phần cứng.

### Schema POST `/provision` (theo CONTRACT mục 5)

```json
{
  "ssid": "TenWiFiNha",
  "password": "matkhauwifi",
  "deviceEmail": "device@project.iot",
  "devicePassword": "********",
  "peerMac": "11:22:33:44:55:66",
  "hset": 70,
  "deadband": 5
}
```
> `deviceEmail`/`devicePassword`/`peerMac` chỉ gửi khi `role = main` (ESP1).

Phản hồi mong đợi: `{ "ok": true, "message": "Saved. Rebooting.", "mac": "A1:B2:C3:D4:E5:F6" }`.

## Cách chạy

PWA cần **secure context** để bật service worker + camera. Hai cách:

### A. Chạy local qua HTTP (khuyến nghị để test thật với ESP)

ESP phục vụ HTTP, nên hãy mở PWA qua **`http://`** để tránh chặn mixed-content (xem dưới).

```bash
# Trong thư mục mobile/
python -m http.server 5500        # → http://localhost:5500
# hoặc:  npx serve -l 5500
```

- Mở trên máy tính: `http://localhost:5500` (service worker + camera hoạt động vì localhost là secure context).
- Mở trên điện thoại cùng WiFi: `http://<IP-máy-bạn>:5500`. Lưu ý: trên IP-LAN (không phải localhost),
  trình duyệt **không cấp quyền camera** vì không phải HTTPS → dùng nút **Nhập tay** rồi điền IP của ESP.

### B. Deploy HTTPS (vd Firebase Hosting) — chỉ để demo giao diện

App vẫn cài được và quét QR (camera chạy trên HTTPS), **nhưng** sẽ KHÔNG POST được tới ESP qua
`http://` do mixed-content (xem dưới). Phù hợp để demo UI hoặc dùng kèm trang form same-origin của ESP.

> `firebase.json` đã `ignore` thư mục `mobile/` khỏi Hosting (deploy là web dashboard). Nếu muốn host
> riêng PWA, tạo site Hosting khác hoặc serve tĩnh ở nơi khác.

## ⚠ Lưu ý Mixed-content (RẤT QUAN TRỌNG)

Trình duyệt **chặn** trang chạy `https://` gọi tới `http://` (active mixed content). ESP phục vụ HTTP,
nên:

- ✅ **Mở PWA qua `http://`** (server local như trên) → POST tới `http://192.168.4.1/provision` chạy tốt.
- ✅ **Dùng trang form do chính ESP phục vụ** (`GET http://192.168.4.1/`, xem CONTRACT mục 5) — same-origin
  nên luôn hoạt động, không dính mixed-content.
- ❌ Mở PWA qua `https://` rồi POST `http://<esp>` → bị chặn, fetch ném lỗi `Failed to fetch`.

App tự phát hiện khi đang chạy HTTPS và hiện **banner cảnh báo mixed-content** + gợi ý cách khắc phục.
Khi POST lỗi, phần kết quả cũng phân loại nguyên nhân (mixed-content vs chưa nối AP / sai IP / thiếu CORS).

## Yêu cầu phía ESP / mock

Để gọi được từ trình duyệt, ESP server (và `tools/mock-esp-server`) phải:

- Trả header `Access-Control-Allow-Origin: *` và xử lý preflight `OPTIONS` (CONTRACT mục 5).
- Lắng nghe `POST /provision`, nhận `Content-Type: application/json`, trả JSON `{ ok, message, mac }`.

## Phụ thuộc (CDN, không cần cài)

- **Tailwind** play CDN: `https://cdn.tailwindcss.com`
- **html5-qrcode**: `https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js`

Hai script này được cache động bởi service worker sau lần tải đầu. Cần Internet cho lần đầu mở app.
