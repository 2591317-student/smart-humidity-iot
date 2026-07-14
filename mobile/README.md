# PWA Provisioning — Cấu hình mạng cho ESP (WiFi + MAC)

App web cài được (PWA) để nạp **cấu hình mạng** vào thiết bị ESP của hệ thống **Smart Humidity IoT**
— đúng chuẩn ngành IoT (giống cấu hình một camera WiFi). App chỉ hỏi **WiFi + MAC của ESP còn lại**.
Hoạt động theo `docs/CONTRACT.md` mục 5 (REST provisioning) và mục 6 (QR payload).

> Provisioning **không bắt buộc đăng nhập** Firebase. App chỉ POST cấu hình tới ESP qua mạng cục bộ.
> Tài khoản Firebase của thiết bị được **hardcode trong firmware**, còn `hset`/`deadband` chỉnh sau
> qua web dashboard — nên app KHÔNG hỏi mấy thứ này (cho gọn).

## Có gì trong thư mục

```
mobile/
├── index.html             # Giao diện mobile-first (Tailwind play CDN)
├── manifest.webmanifest   # PWA installable ("thêm vào màn hình chính")
├── sw.js                  # Service worker — cache vỏ ứng dụng, không cache POST
└── js/
    ├── app.js             # Luồng chính: form, quét QR điền MAC, POST, hiển thị response
    └── qr.js              # Quét QR bằng html5-qrcode (chỉ dùng field `mac`)
```

## ⭐ Cách DỄ NHẤT — captive portal (khuyến nghị cho demo)

ESP giờ chạy **captive portal** (như WiFi khách sạn/quán cà phê): giữ nút **BOOT** rồi cấp nguồn →
ESP phát AP → **điện thoại nối vào AP đó là trình duyệt TỰ BẬT LÊN** ngay trang cấu hình, khỏi cần
mở app/gõ IP gì cả. Vì đây là trang HTTP do chính ESP phục vụ (same-origin), **không dính** mixed-
content hay Local Network Access của Chrome (xem mục dưới) — chắc ăn nhất cho hôm demo.

Trang đó chỉ có form đơn giản (SSID, mật khẩu, MAC — không quét QR được). Muốn quét QR cho tiện thì
dùng PWA đầy đủ bên dưới.

## Luồng sử dụng (PWA đầy đủ — có quét QR)

1. **Bật chế độ cấu hình trên ESP**: GIỮ nút **BOOT** rồi cấp nguồn → ESP phát WiFi tên
   `PROV-MAIN-A1B2C3` / `PROV-SENSOR-…`.
2. **Kết nối WiFi**: trên điện thoại vào Cài đặt → WiFi, nối tới AP đó (mật khẩu mặc định `12345678`
   nếu có). Khi nối vào AP, điện thoại có thể tạm mất Internet — bình thường. (Nếu trình duyệt tự bật
   lên trang cấu hình lúc này — đó là captive portal ở trên, có thể dùng luôn thay vì mở PWA.)
3. **Điền form** — có **2 checkbox: WiFi và MAC**, tick cái nào thì **chỉ gửi cái đó** (cho phép cập
   nhật riêng WiFi hoặc riêng MAC mà không đụng phần kia — ESP làm *partial update*):
   - **WiFi**: tên WiFi nhà (SSID) + mật khẩu.
   - **MAC của ESP còn lại**: **gõ tay** hoặc bấm **Quét QR** in trên ESP kia để điền nhanh. (Để trống
     cũng được — ESP-NOW vẫn nhận broadcast.)
4. (Tuỳ chọn) **Kiểm tra kết nối** — nút gọi `GET /provision` để xác nhận điện thoại tới được ESP + xem
   ESP báo về danh tính (role, MAC, đã cấu hình chưa) và cấu hình đã lưu (SSID, peerMac). Lưu ý: trình
   duyệt **không** đọc được tên WiFi / IP của điện thoại (giới hạn bảo mật web), nên phần chẩn đoán dựa
   vào `/provision` của ESP.
5. **Gửi cấu hình** → POST JSON tới `http://<ip>/provision`. App hiển thị rõ kết quả + **response thô
   (raw JSON)** từ thiết bị. ESP tự khởi động lại và vào mạng nhà.
5. **Chế độ Test** (trong "Tuỳ chọn nâng cao"): POST tới `http://localhost:8080` (`tools/mock-esp-server`)
   — thử toàn bộ luồng mà không cần phần cứng.

### Schema POST `/provision` (theo CONTRACT mục 5)

```json
{
  "ssid": "TenWiFiNha",
  "password": "matkhauwifi",
  "peerMac": "11:22:33:44:55:66"
}
```
> **Partial update:** app chỉ gửi field ứng với checkbox được tick — ESP chỉ ghi field có trong JSON,
> field vắng mặt giữ nguyên. Nếu tick WiFi thì `ssid` không được rỗng. Field MAC nhận cả `peerMac` lẫn
> `mac_gateway`. ESP vẫn chấp nhận field cũ (`deviceEmail`…) nếu gửi kèm, nhưng app không còn gửi nữa.

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
  trình duyệt **không cấp quyền camera** vì không phải HTTPS → cứ **gõ MAC bằng tay** vào ô MAC
  (nút Quét QR sẽ không mở được camera trong trường hợp này).

### B. Deploy HTTPS (vd Firebase Hosting) — chỉ để demo giao diện

App vẫn cài được và quét QR (camera chạy trên HTTPS), **nhưng** sẽ KHÔNG POST được tới ESP qua
`http://` do mixed-content (xem dưới). Phù hợp để demo UI hoặc dùng kèm trang form same-origin của ESP.

> `firebase.json` đã `ignore` thư mục `mobile/` khỏi Hosting (deploy là web dashboard). Nếu muốn host
> riêng PWA, tạo site Hosting khác hoặc serve tĩnh ở nơi khác.

## ⚠ Lưu ý Mixed-content & Local Network Access (RẤT QUAN TRỌNG)

ESP phục vụ HTTP (`192.168.4.1`), còn PWA deploy ở `https://`. Gọi HTTPS→HTTP như vậy có thể bị
chặn theo **2 cơ chế khác nhau**:

### 1. Local Network Access — LNA (Chrome/Android mới)
Trình duyệt **hỏi quyền** ("trang này muốn truy cập thiết bị khác trên mạng cục bộ của bạn") — bấm
**Allow** thì request **vẫn chạy được** dù trang là HTTPS (khác mixed-content cũ, cái này CÓ đường
để hoạt động).

**Lỗi thực tế đã gặp (test bằng điện thoại thật, 2026-07-02):** Android chặn hẳn hộp thoại xin quyền
với thông báo *"This site can't ask for your permission — Close any bubbles or overlays from other
apps"*. Nguyên nhân: có app khác (Messenger, launcher, tiện ích màn hình...) đang **vẽ đè lên màn
hình** (quyền "Hiển thị đè lên ứng dụng khác" / `SYSTEM_ALERT_WINDOW`) — Android chặn prompt nhạy
cảm này để chống tapjacking.

**Cách fix:**
1. Vào **Cài đặt → Ứng dụng**, tìm app đang bật quyền "Hiển thị đè lên ứng dụng khác" (thường là
   app chat/launcher/tiện ích chạy nền) → tắt quyền đó.
2. Mở lại PWA, thử gửi cấu hình lại (hoặc bấm nút "Kiểm tra kết nối") — prompt "Allow/Block" phải
   hiện ra được lúc này → bấm **Allow**.
3. Xác nhận đã cấp quyền: **Chrome → chấm 3 chấm → Settings → Site settings → Local network** —
   origin của PWA phải nằm trong danh sách **Allowed** (không phải "Not Allowed").

### 2. Mixed-content (trình duyệt cũ hơn)
Bị **chặn thẳng**, không có prompt xin quyền, không có cách override — phải đổi đường vào.

### Cách dùng thật (né được cả 2 lỗi trên)
- ✅ **Mở PWA qua `http://`** (server local như trên) → POST tới `http://192.168.4.1/provision` chạy tốt.
- ✅ **Dùng trang form do chính ESP phục vụ** (`GET http://192.168.4.1/`, xem CONTRACT mục 5) — same-origin
  nên luôn hoạt động, **không dính cả 2 lỗi trên**. Khuyến nghị dùng cái này làm phương án demo dự
  phòng chắc ăn (không phụ thuộc quyền LNA hay app nào khác đang chạy nền trên máy demo).
- ❌ Mở PWA qua `https://` mà quyền LNA chưa cấp được (do overlay chặn) hoặc trình duyệt không hỗ
  trợ LNA → bị chặn, fetch ném lỗi `Failed to fetch`.

App tự phát hiện khi đang chạy HTTPS và hiện **banner cảnh báo** (giải thích cả 2 cơ chế) + gợi ý
cách khắc phục. Khi POST lỗi, phần kết quả cũng phân loại nguyên nhân tương tự.

## Yêu cầu phía ESP / mock

Để gọi được từ trình duyệt, ESP server (và `tools/mock-esp-server`) phải:

- Trả header `Access-Control-Allow-Origin: *` và xử lý preflight `OPTIONS` (CONTRACT mục 5).
- Lắng nghe `POST /provision`, nhận `Content-Type: application/json`, trả JSON `{ ok, message, mac }`.

## Phụ thuộc (CDN, không cần cài)

- **Tailwind** play CDN: `https://cdn.tailwindcss.com`
- **html5-qrcode**: `https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js`

Hai script này được cache động bởi service worker sau lần tải đầu. Cần Internet cho lần đầu mở app.
