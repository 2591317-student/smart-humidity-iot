# CONTRACT — Hợp đồng giao tiếp giữa các thành phần

> File này là **nguồn sự thật duy nhất** cho mọi interface dùng chung giữa firmware ESP1/ESP2,
> web dashboard, app provisioning (PWA), và Firebase. Mọi component PHẢI tuân theo đúng các
> định nghĩa dưới đây để hệ thống khớp nhau. Khi thay đổi, sửa ở đây trước.

---

## 1. Vai trò thiết bị (roles)

| Role string | Thiết bị | Nhiệm vụ |
|---|---|---|
| `main`   | ESP1 | Nhận ESP-NOW từ ESP2 → WiFi/Firebase → thuật toán Deadband → relay phun sương |
| `sensor` | ESP2 | Đọc SHT30 (I²C) → gửi ESP-NOW sang ESP1 (nâng cao: switch-role thành gateway) |

---

## 2. Firebase Realtime Database — data model

Region khuyến nghị: **asia-southeast1** (Singapore). Mọi giá trị số lưu dạng number.

```jsonc
{
  "sensor": {                 // ESP1 (hoặc ESP2 ở chế độ gateway) GHI
    "temperature": 28.5,      // °C, number
    "humidity": 65.2,         // %RH, number
    "timestamp": 1719200000   // epoch giây (ESP dùng time(), hoặc 0 nếu chưa có NTP)
  },
  "config": {                 // ADMIN (web) GHI — ESP1 đọc qua stream
    "hset": 70,               // ngưỡng độ ẩm đặt (%RH)
    "deadband": 5,            // vùng chết (± quanh hset)
    "lastUpdate": "2026-06-24 10:00:00",  // string hiển thị
    "updatedBy": "admin@email"            // email người chỉnh
  },
  "status": {                 // ESP1 GHI
    "mist": false,            // bool — máy phun đang bật?
    "tank": "full",           // "full" | "empty"  (nâng cao)
    "pump": false,            // bool — bơm châm nước đang chạy? (nâng cao)
    "esp1Online": true,       // heartbeat
    "gateway": "esp1",        // "esp1" | "esp2"  (esp2 = đang chạy gateway dự phòng)
    "lastSeen": 1719200000    // epoch giây heartbeat cuối
  },
  "admins": {                 // seed thủ công trong console — ai được ghi /config
    "<ADMIN_UID>": true
  },
  "devices": {                // seed thủ công — UID tài khoản thiết bị được ghi /sensor,/status
    "<DEVICE_UID>": true
  }
}
```

**Thuật toán Deadband (ESP1)** — máy phun sương làm TĂNG độ ẩm:
- `humidity < hset - deadband`  → BẬT phun (relay ON)  → `status/mist = true`
- `humidity > hset + deadband`  → TẮT phun (relay OFF) → `status/mist = false`
- nằm giữa → giữ nguyên trạng thái (chống nhảy relay)

Map với giao diện cũ (tham khảo): `setHumidityMax = hset + deadband`, `setHumidityMin = hset - deadband`.
Web NÊN cho nhập `hset` + `deadband` và hiển thị Max/Min suy ra để người dùng dễ hiểu.

---

## 3. Mô hình xác thực (auth)

- **Admin (người dùng web):** đăng nhập **Google OAuth** (`signInWithPopup`). UID của admin
  được seed vào `/admins/<UID> = true`. Chỉ admin mới ghi được `/config`.
- **Thiết bị ESP:** đăng nhập bằng **tài khoản email/password riêng** (vd `device@<project>.iot`)
  tạo trong Firebase Auth. UID thiết bị seed vào `/devices/<UID> = true`. Chỉ thiết bị mới ghi
  `/sensor`, `/status`. Thông tin email/password thiết bị nạp vào ESP lúc provisioning (mục 5).
- **Chưa đăng nhập:** `.read = false` → bị chặn hoàn toàn (đúng use-case "người lạ" trong PDF).

Security rules: xem `firebase/database.rules.json`.

---

## 4. ESP-NOW packet (ESP2 → ESP1)

Struct C/C++ **giống hệt nhau** ở cả 2 firmware (đặt trong `firmware/lib/common/protocol.h`).
Phải `packed`, ≤ 250 bytes.

```cpp
#pragma once
#include <stdint.h>

// Loại bản tin
enum EspNowMsgType : uint8_t {
  MSG_SENSOR_DATA = 1
};

typedef struct __attribute__((packed)) {
  uint8_t  msgType;      // = MSG_SENSOR_DATA
  float    temperature;  // °C
  float    humidity;     // %RH
  uint32_t seq;          // số thứ tự gói (tăng dần)
  uint8_t  fromGateway;  // 0 = bình thường, 1 = ESP2 đang gateway (không dùng cho recv nhưng giữ chỗ)
} SensorPacket;          // 1 + 4 + 4 + 4 + 1 = 14 bytes
```

- Kênh WiFi ESP-NOW (**đồng bộ tự động**): ESP1 là STA nối router nên ESP-NOW của ESP1 nằm
  trên **kênh của router**. ESP2 KHÔNG nối WiFi mà **quét tìm SSID router** (đã provisioning)
  để biết kênh router rồi phát ESP-NOW trùng kênh đó → 2 board luôn cùng kênh dù router ở
  kênh bất kỳ. `ESPNOW_CHANNEL` chỉ còn là **kênh dự phòng** khi ESP2 không quét thấy SSID.
  ESP2 dò lại định kỳ (~2 phút) phòng router đổi kênh / boot trễ.
- ESP2 gửi **broadcast** (FF:FF:FF:FF:FF:FF) nên không cần cấu hình chéo MAC ở Basic; ESP1
  vẫn add peer từ `peerMac` (tuỳ chọn) để ổn định, đặt nền cho unicast sau này.

---

## 5. Provisioning REST API (chạy trên SoftAP của ESP)

Khi boot lần đầu (chưa có cấu hình trong Preferences) ESP vào chế độ **SoftAP**:
- SSID AP: `PROV-<ROLE>-<MAC6>` (vd `PROV-MAIN-A1B2C3`), không mật khẩu (hoặc pass mặc định `12345678`).
  **MAC6 = 6 ký tự hex CUỐI của MAC** (vd MAC `A0:B1:C2:A1:B2:C3` → MAC6 = `A1B2C3`).
- IP cố định: `192.168.4.1`. ESP chạy HTTP server (cổng 80).

### Endpoints

`GET /info` → thông tin thiết bị (JSON):
```json
{ "id": "MAIN-A1B2C3", "role": "main", "mac": "A0:B1:C2:A1:B2:C3",
  "fw": "1.0.0", "provisioned": false }
```

`POST /provision` (Content-Type: application/json) → nạp cấu hình:
```json
{
  "ssid": "TenWiFiNha",
  "password": "matkhauwifi",
  "deviceEmail": "device@project.iot",     // tài khoản thiết bị (cho ESP1)
  "devicePassword": "********",
  "peerMac": "11:22:33:44:55:66",          // MAC ESP2 (chỉ cần cho ESP1)
  "hset": 70,                               // tuỳ chọn, mặc định 70
  "deadband": 5                             // tuỳ chọn, mặc định 5
}
```
Phản hồi:
```json
{ "ok": true, "message": "Saved. Rebooting.", "mac": "A1:B2:C3:D4:E5:F6" }
```
Sau khi lưu Preferences thành công → trả response → `delay(1000)` → `ESP.restart()` vào chế độ chạy bình thường (STA).

`POST /reset` → xoá Preferences, quay về chưa cấu hình (tuỳ chọn, để demo lại).

> **CORS:** ESP server thêm header `Access-Control-Allow-Origin: *` và xử lý preflight `OPTIONS`
> để PWA gọi được từ trình duyệt.
> **Mixed-content:** PWA chạy HTTPS không POST thẳng được tới ESP HTTP. Cách dùng thật:
> mở PWA qua `http://` (server local) HOẶC ESP tự phục vụ 1 trang form same-origin (`GET /`).
> Khi test không có phần cứng → PWA trỏ tới `tools/mock-esp-server` (HTTP localhost) → chạy tốt.

`GET /` → trả 1 trang HTML form provisioning tối giản (same-origin fallback, luôn hoạt động).

---

## 6. QR payload (định danh thiết bị cho PWA)

QR in/dán trên thiết bị (hoặc hiển thị qua Serial khi dev) chứa **JSON 1 dòng**:
```json
{"id":"MAIN-A1B2C3","role":"main","ap":"PROV-MAIN-A1B2C3","ip":"192.168.4.1","mac":"A0:B1:C2:A1:B2:C3"}
```
(MAC6 trong `id`/`ap` = 6 hex cuối của `mac`.) PWA quét QR → biết AP cần kết nối + IP để POST +
MAC (điền sẵn `peerMac` cho ESP còn lại).

---

## 7. Preferences (NVS) keys trên ESP — namespace `"prov"`

| key | kiểu | ý nghĩa |
|---|---|---|
| `provisioned` | bool | đã cấu hình chưa |
| `ssid` | String | WiFi SSID |
| `pass` | String | WiFi password |
| `devEmail` | String | email tài khoản thiết bị (ESP1) |
| `devPass` | String | password tài khoản thiết bị (ESP1) |
| `peerMac` | String | MAC của ESP còn lại (ESP1 lưu MAC ESP2) |
| `hset` | int | ngưỡng độ ẩm mặc định |
| `deadband` | int | vùng chết mặc định |

---

## 8. GPIO pin map (mặc định — đổi được, ghi chú `#define` ở đầu file)

**ESP2 (sensor):** SHT30 `SDA=21`, `SCL=22` (I²C, địa chỉ 0x44); switch-role (nâng cao) `GPIO 4` (INPUT_PULLUP).
**ESP1 (main):** Relay phun sương `GPIO 26` (mức kích cấu hình `RELAY_ACTIVE_HIGH`); phao/tiếp điểm cạn (nâng cao) `GPIO 34` (INPUT, chỉ đọc); tiếp điểm bơm (nâng cao) `GPIO 35` (INPUT).

---

## 9. Firebase web SDK

- Web + PWA dùng **Firebase JS SDK v10 (modular, ESM qua CDN)**:
  `https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js`, `.../firebase-auth.js`, `.../firebase-database.js`.
- Config nằm ở `web/js/firebase-config.js` (export `firebaseConfig`) — điền từ Firebase Console.
- Auth: `GoogleAuthProvider` + `signInWithPopup`. Lắng nghe dữ liệu bằng `onValue()`.
- Chart: **Chart.js v4** (CDN). Buffer realtime phía client (vd 30–60 điểm gần nhất).

---

## 10. Quy ước chung

- Firmware: C++ Arduino/PlatformIO. Mỗi env một thư mục src riêng (`esp1_main/`, `esp2_sensor/`),
  code dùng chung ở `firmware/lib/common/`.
- Web/PWA: HTML5 + Tailwind (CDN) + JS ES module. Không build step.
- Đơn vị: nhiệt độ °C, độ ẩm %RH, thời gian epoch giây.
- Mọi giá trị mặc định an toàn: `hset=70`, `deadband=5`.
