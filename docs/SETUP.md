# SETUP — Tạo Firebase project mới & chạy thử

Hướng dẫn từ số 0: tạo project Firebase **mới**, cấu hình Auth/Database/Hosting/Rules, và chạy
thử web + provisioning **không cần phần cứng**.

---

## 0. Cài công cụ (một lần)

```bash
npm install -g firebase-tools     # Firebase CLI
firebase login                    # đăng nhập Google (chủ project)
# (firmware) cài PlatformIO: https://platformio.org  (hoặc extension PlatformIO trong VS Code)
node -v                           # cần Node.js cho tools/
```

---

## 1. Tạo Firebase project mới

1. Vào https://console.firebase.google.com → **Add project** → đặt tên (vd `smart-humidity-iot`).
   Ghi lại **Project ID** (vd `smart-humidity-iot-xxxxx`).
2. Mở `.firebaserc`, thay `YOUR_NEW_PROJECT_ID` bằng Project ID vừa tạo.

## 2. Bật Authentication

- Console → **Search for products** gõ `Authentication` → **Get started** (nhóm *Security*; console mới bỏ menu *Build*).
- Tab **Sign-in method** → bật **Google** (chọn email hỗ trợ) → Save.
- Bật **Email/Password** (cho tài khoản thiết bị ESP) → Save.

### Tạo tài khoản thiết bị (cho ESP1 đăng nhập Firebase)
- Tab **Users → Add user**:
  - Email: `device@smarthumidity.iot` (hoặc tuỳ ý)
  - Password: đặt 1 mật khẩu mạnh, **ghi lại** (điền vào `HC_DEV_EMAIL`/`HC_DEV_PASS` trong `firmware/src/esp1_main/main.cpp`).
- Sau khi tạo, copy **User UID** của tài khoản này → sẽ seed vào `/devices` (mục 5).

## 3. Tạo Realtime Database

- Console → **Search for products** gõ `Realtime Database` → **Create Database** (nhóm *Databases and storage*).
- Chọn location **Singapore (asia-southeast1)**.
- Bắt đầu ở **locked mode** (ta sẽ đẩy rules riêng ở mục 4).

## 4. Lấy web config & đẩy Rules + Hosting

1. Console → **Project settings (⚙) → General → Your apps → Web (\</>)** → đăng ký app →
   copy đoạn `firebaseConfig`.
2. Dán các giá trị vào **`web/js/firebase-config.js`** (apiKey, projectId, appId, senderId, …).
   Kiểm tra `databaseURL` đúng dạng `https://<projectId>-default-rtdb.asia-southeast1.firebasedatabase.app`.
3. Khởi tạo & deploy:
   ```bash
   firebase use YOUR_NEW_PROJECT_ID
   firebase deploy --only database     # đẩy security rules
   firebase deploy --only hosting      # deploy web dashboard
   ```

## 5. Seed admin & device UID

Cần UID của **admin** (tài khoản Google `2591317@student.hcmute.edu.vn`) và **device**:

- **Lấy UID admin:** mở web dashboard đã deploy → đăng nhập bằng `2591317@student.hcmute.edu.vn`.
  Trang sẽ in UID ra console trình duyệt (hoặc xem ở Authentication → Users sau lần đăng nhập đầu).
- **Lấy UID device:** Authentication → Users → tài khoản `device@...` (đã tạo ở mục 2).

Vào **Realtime Database → Data**, thêm thủ công:
```json
{
  "admins":  { "<ADMIN_UID>":  true },
  "devices": { "<DEVICE_UID>": true }
}
```
(Có thể import file JSON, hoặc gõ tay node `admins` và `devices`.)

> Sau bước này: chỉ `2591317@student.hcmute.edu.vn` ghi được `/config`; chỉ tài khoản thiết bị ghi được
> `/sensor` và `/status`; người chưa đăng nhập bị chặn đọc.

---

## 6. Chạy thử KHÔNG cần phần cứng

### a) Bơm dữ liệu cảm biến giả → xem web/chart
```bash
cd tools/data-injector
npm install
# Sửa config: project + email/password tài khoản thiết bị
npm start            # liên tục ghi nhiệt độ/độ ẩm giả lên /sensor và /status
```
Mở web dashboard → đăng nhập admin → thấy số liệu & biểu đồ chạy realtime.

### b) Test PWA provisioning với ESP giả lập
```bash
cd tools/mock-esp-server
npm install
npm start            # giả lập REST /info, /provision của ESP tại http://localhost:8080
```
Mở PWA (`mobile/`) qua HTTP local (vd `npx serve mobile` rồi mở `http://localhost:3000`) →
quét QR mẫu (in trong log của mock-server, hoặc file `docs/`) → nhập WiFi → POST → thấy response.

---

## 7. Firmware (khi có ESP32)

```bash
cd firmware
pio run                      # biên dịch cả 2 env
pio run -e esp2-sensor -t upload   # nạp ESP2
pio run -e esp1-main   -t upload   # nạp ESP1
pio device monitor                  # 115200
```
ESP chạy ngay bằng WiFi hardcode (`HC_WIFI_*`) nếu chưa provisioning. Muốn cấu hình mạng: **giữ nút
BOOT lúc khởi động** → ESP phát WiFi `PROV-MAIN-xxxx` / `PROV-SENSOR-xxxx` → nối vào là **trình duyệt
tự bật lên trang cấu hình** (captive portal) để nạp WiFi + MAC, khỏi cần mở PWA (xem `docs/CONTRACT.md`
mục 5).

---

## Lưu ý bảo mật & mixed-content

- `apiKey` của Firebase **không phải bí mật** (an toàn để public); bảo mật thật nằm ở **Security Rules**.
- KHÔNG commit `serviceAccountKey.json` hay mật khẩu thiết bị thật.
- PWA chạy HTTPS không POST thẳng được tới ESP HTTP (mixed-content). Khi provisioning thật:
  mở PWA qua `http://` (server local) hoặc dùng trang `GET /` mà ESP tự phục vụ (same-origin).
  Lúc test với `mock-esp-server` (HTTP localhost) thì không gặp vấn đề này.
