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
  "config": {                 // ADMIN (web) GHI — ESP1 ĐỌC (subscribe/poll) cho luồng 2 chiều
                              // với sensor node. CHỈ chứa field mà ESP thật sự cần biết — field
                              // thuần web-hiển-thị (vd onlineTimeoutSec) nằm ở /webSettings riêng,
                              // KHÔNG để ở đây (ESP không cần/không nên biết những field đó).
    "hset": 70,               // ngưỡng độ ẩm đặt (%RH)
    "deadband": 5,            // vùng chết (± quanh hset)
    "mode": "continuous",     // CHẾ ĐỘ PHUN SƯƠNG — "off" | "continuous" | "intermittent".
                              // "off": không phun (bỏ qua Deadband). "continuous": chạy đúng
                              // thuật toán Deadband hiện tại (mục 2 dưới). "intermittent": phun
                              // ngắt quãng — CHƯA hiện thực logic chi tiết phía firmware (chờ
                              // Embed quyết định chu kỳ bật/tắt cụ thể). Mặc định "continuous"
                              // nếu field thiếu (giữ hành vi hiện tại, không phá luồng cũ).
    "pumpControlEnabled": false, // CỜ ẨN — admin bật thẳng trong Firebase Console (không cần
                                 // deploy lại web). Nguyên bản: true -> web HIỆN khối "Điều khiển
                                 // bơm thủ công"; false (mặc định/thiếu) -> ẩn hoàn toàn.
                                 // ⚠️ 2026-07-14: khối UI này đang bị CMT hẳn trong web/js/app.js +
                                 // web/index.html (xem docs/TIEN-DO-2026-07-02.md) — bật cờ này lên
                                 // KHÔNG còn hiện gì nữa cho tới khi ai đó gỡ comment lại code.
    "pumpManualOn": false,       // Lệnh BẬT/TẮT bơm thủ công do admin gửi qua nút toggle trên web.
                                 // ESP1 (khi Embed đã đấu relay bơm) đọc field này qua subscribe/poll
                                 // /config, giống cách đọc hset/deadband, để điều khiển relay bơm.
                                 // CHƯA hiện thực phía firmware — chờ Embed xong mục giám sát/điều
                                 // khiển bơm rồi nối logic đọc field này vào relay tương ứng. UI web
                                 // ghi field này đang bị CMT (xem pumpControlEnabled ở trên).
    "lastUpdate": "2026-06-24 10:00:00",  // string hiển thị
    "updatedBy": "admin@email"            // email người chỉnh
  },
  "webSettings": {            // ADMIN (web) GHI — CHỈ WEB DÙNG, ESP KHÔNG ĐỌC/subscribe path này.
                              // Tách riêng khỏi /config vì ESP1 sẽ subscribe /config cho luồng
                              // tương tác 2 chiều với sensor node (nút vặn hset/deadband) — field
                              // thuần hiển-thị không nên lẫn vào đó.
    "onlineTimeoutSec": 15,   // NGƯỠNG WEB DÙNG để suy online/offline từ lastSeen (giây, 5..300).
                              // Nên đặt > chu kỳ ESP đẩy /status vài lần (vd đẩy mỗi ~60s thì đặt
                              // ~90-150s) để tránh báo offline giả dù ESP hoàn toàn khoẻ mạnh.
    "lastUpdate": "2026-06-24 10:00:00",
    "updatedBy": "admin@email"
  },
  "status": {                 // ESP1 GHI
    "mist": false,            // bool — máy phun đang bật?
    "tank": 3,                // SỐ 0-3 (nâng cao) — mức nước bồn chứa:
                              //   0 = rất thấp/cạn (kích hoạt hộp cảnh báo nhấp nháy trên web)
                              //   1 = thấp (chỉ hiện badge vàng, KHÔNG báo động)
                              //   2 = bình thường
                              //   3 = đầy nước (mặc định khi chưa đấu cảm biến — Basic)
                              // Ứng với mạch chỉ báo mức nước dùng 3 đầu dò (M2/M3/M4) + GND
                              // (M1), transistor BC547 — giá trị lý tưởng = SỐ đầu dò đang
                              // ngập nước (đếm 0..3). Board thật CHƯA đấu GPIO cho mạch này
                              // (Embed mới thiết kế phần cứng) — firmware hiện cố định = 3.
    "pump": false,            // bool — bơm châm nước đang chạy? (nâng cao)
    "esp1Online": true,       // heartbeat (tham khảo — web KHÔNG dựa vào cờ này)
    "gateway": "esp1",        // "esp1" | "esp2"  (esp2 = đang chạy gateway dự phòng)
    "lastSeen": 1719200000    // epoch giây heartbeat cuối — NGUỒN CHÍNH để suy online/offline
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

> ⚠️ **`config/mode` CHƯA được firmware đọc** — hiện tại ESP1 luôn chạy Deadband như trên bất kể
> `mode` là gì (web mới chỉ có UI + validate, chưa nối logic). Khi Embed sẵn sàng: `mode="off"` →
> bỏ qua Deadband, luôn giữ relay TẮT; `mode="continuous"` → chạy đúng Deadband ở trên (mặc định);
> `mode="intermittent"` → logic ngắt quãng do Embed tự định nghĩa (vd chu kỳ bật/tắt cố định).

Map với giao diện cũ (tham khảo): `setHumidityMax = hset + deadband`, `setHumidityMin = hset - deadband`.
Web NÊN cho nhập `hset` + `deadband` và hiển thị Max/Min suy ra để người dùng dễ hiểu.

**Phát hiện online/offline (presence):** thiết bị không thể tự báo "offline" khi mất mạng, nên web
**suy ra từ `lastSeen`**: `online = (giờ hiện tại − lastSeen) < webSettings.onlineTimeoutSec`. Ngưỡng
này đọc từ **`/webSettings/onlineTimeoutSec`** (KHÔNG phải `/config` — xem lý do tách ở mục 2, admin
chỉnh được trên web, mặc định 15s nếu chưa set) — để align với chu kỳ ESP đẩy dữ liệu (đổi chu kỳ
push firmware thì chỉ cần sửa số này trên web, khỏi sửa code). Web chạy timer client (mỗi 5s) tự
lật sang "Mất kết nối" khi `lastSeen` quá hạn — **không cần backend/Cloud Functions**. Cờ
`esp1Online` chỉ để tham khảo.
> ⚠️ Logic này chạy **trong trình duyệt người xem** — chỉ hoạt động khi có ai đó đang mở web dashboard.
> Không ai mở web thì không có gì tính toán/cảnh báo online-offline (dữ liệu `lastSeen` vẫn được ghi
> bình thường, chỉ là không ai suy ra trạng thái). Muốn cảnh báo dù không ai mở web (email/SMS...) thì
> cần Cloud Functions chạy trên server — ngoài phạm vi hiện tại.
>
> **Field `/status/esp1Online` tự sửa lại khi có admin đang mở web:** `app.js` (hàm
> `maybeCorrectEsp1Online`) so `online` tự tính ở trên với `status.esp1Online` hiện có — lệch thì
> gọi `db.js#correctEsp1Online()` ghi đè lại (rules cho phép **admin** ghi riêng field này, xem
> `firebase/database.rules.json`). Mục đích: ai xem trực tiếp Firebase Console (không qua web) cũng
> thấy đúng, KHÔNG phải nguồn sự thật cho label web (label luôn đúng nhờ tự tính từ `lastSeen`, kể cả
> khi field này đang lệch). Giống hạn chế ở trên: chỉ tự sửa khi có admin đang mở tab web; đội quyết
> định không cần chạy backend 24/7 cho việc này — chấp nhận field thô có thể trễ tới khi ai đó mở web.
> Thư viện Firebase mobizt trên ESP32 cũng **không hỗ trợ `onDisconnect()`** (đã kiểm tra: không có
> trong mã nguồn thư viện) nên ESP không thể tự báo offline được.
>
> `tools/presence-watcher` (script Node chạy độc lập, cùng cơ chế nhưng chạy 24/7 không cần mở web)
> vẫn còn trong repo nhưng **không bắt buộc dùng** — team đã chọn hướng đơn giản ở trên.

---

## 3. Mô hình xác thực (auth)

- **Admin (người dùng web):** đăng nhập **Google OAuth** (`signInWithPopup`). UID của admin
  được seed vào `/admins/<UID> = true`. Chỉ admin mới ghi được `/config`.
- **Thiết bị ESP:** đăng nhập bằng **tài khoản email/password riêng** (vd `device@<project>.iot`)
  tạo trong Firebase Auth. UID thiết bị seed vào `/devices/<UID> = true`. Chỉ thiết bị mới ghi
  `/sensor`, `/status`. Thông tin email/password thiết bị **hardcode trong firmware** (`HC_DEV_EMAIL`/
  `HC_DEV_PASS` ở `esp1_main/main.cpp`) — app provisioning không hỏi 2 trường này nữa.
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

**Khi nào vào SoftAP:** GIỮ nút **BOOT (GPIO0)** lúc cấp nguồn/khởi động (giống "bấm reset
mạng" của thiết bị smart home). Nếu KHÔNG giữ nút, ESP chạy bình thường bằng cấu hình đã lưu
(NVS) — hoặc **hardcode fallback** trong firmware nếu chưa từng provisioning (tiện cho DEV).
Chiến lược đọc cấu hình: **NVS-first, hardcode-fallback** (field nào trống trong NVS thì lấy
hằng số `HC_*` ở đầu `esp1_main/main.cpp` / `esp2_sensor/main.cpp`).

Khi vào chế độ **SoftAP**:
- SSID AP: `PROV-<ROLE>-<MAC6>` (vd `PROV-MAIN-A1B2C3`), không mật khẩu (hoặc pass mặc định `12345678`).
  **MAC6 = 6 ký tự hex CUỐI của MAC** (vd MAC `A0:B1:C2:A1:B2:C3` → MAC6 = `A1B2C3`).
- IP cố định: `192.168.4.1`. ESP chạy HTTP server (cổng 80).
- **Captive portal (DNSServer, mọi tên miền → IP ESP):** ngay sau khi điện thoại nối vào AP, hệ điều
  hành (Android/iOS/Windows) tự dò mạng bằng vài URL cố định (`/generate_204`, `/hotspot-detect.html`,
  `/ncsi.txt`...) — ESP redirect (302) TẤT CẢ về `http://192.168.4.1/`, khiến hệ điều hành hiểu là
  "mạng có captive portal" và **tự bật trình duyệt** trỏ vào trang cấu hình. Người dùng KHÔNG cần tự
  gõ IP hay mở app nào — và vì đây là HTTP thuần same-origin ngay từ đầu, **né hoàn toàn** vụ Local
  Network Access / mixed-content của PWA (xem mục 5 phía dưới + `mobile/README.md`). Đây là đường
  **khuyến nghị chính** cho demo; PWA (`mobile/`) vẫn giữ để quét QR lấy MAC cho tiện, không bắt buộc.

### Endpoints

`GET /info` → thông tin thiết bị (JSON):
```json
{ "id": "MAIN-A1B2C3", "role": "main", "mac": "A0:B1:C2:A1:B2:C3",
  "fw": "1.0.0", "provisioned": false }
```

`POST /provision` (Content-Type: application/json) → nạp cấu hình MẠNG (bản gọn):
```json
{
  "ssid": "TenWiFiNha",             // gửi khi cập nhật WiFi (nếu có thì không được rỗng)
  "password": "matkhauwifi",        // mật khẩu WiFi (rỗng nếu mạng mở) — đi kèm ssid
  "peerMac": "11:22:33:44:55:66"    // MAC của ESP còn lại (điền tay/QR); alias: "mac_gateway"
}
```
> **PARTIAL UPDATE:** ESP **chỉ ghi field CÓ trong JSON**; field vắng mặt giữ nguyên giá trị đã lưu.
> App có **2 checkbox (WiFi / MAC)** — tick cái nào thì mới gửi field đó → cho phép cập nhật riêng
> WiFi hoặc riêng MAC mà không xoá phần kia. Phải gửi **ít nhất 1 field**. Field MAC nhận cả tên
> `peerMac` lẫn `mac_gateway` (cùng ý nghĩa).
>
> App chỉ hỏi **WiFi + MAC** cho gọn (đúng chuẩn ngành, như cấu hình camera WiFi). Những thứ
> KHÔNG còn hỏi ở provisioning:
> - `deviceEmail`/`devicePassword` (tài khoản Firebase của thiết bị): **hardcode trong firmware**
>   (`HC_DEV_EMAIL`/`HC_DEV_PASS` ở `esp1_main/main.cpp`) — tạo sẵn trong Firebase Auth + seed
>   UID vào `/devices/<UID>`.
> - `hset`/`deadband`: dùng mặc định firmware (70/5), admin chỉnh sau qua web dashboard (`/config`).
>
> ESP vẫn **chấp nhận** các field cũ nếu client gửi kèm (tương thích ngược), nhưng không bắt buộc.

Phản hồi:
```json
{ "ok": true, "message": "Saved. Rebooting.", "mac": "A1:B2:C3:D4:E5:F6" }
```
Sau khi lưu Preferences thành công → trả response → `delay(1000)` → `ESP.restart()` vào chế độ chạy bình thường (STA).

> ⚠️ **PWA tin vào HTTP status (2xx), không bắt buộc body JSON đúng chuẩn:** đã gặp thực tế
> (2026-07-13 → 07-14) board chạy firmware khác/cũ hơn repo này trả `{"status":"ok", ...}` thay vì
> `{"ok":true, ...}` cho `/provision` VÀ `/reboot` — có lúc PWA còn vá theo từng định dạng cụ thể
> (`bodyJson.status === "ok"`), nhưng rồi phát hiện board có lúc trả **200 OK mà body còn không phải
> JSON hợp lệ** (rỗng/không parse được) khiến cách vá theo field vẫn báo "từ chối"/"lỗi" oan. Từ
> 2026-07-14, `mobile/js/app.js` (`onSubmitProvision`, `onClickReboot`) đổi hẳn sang **coi `resp.ok`
> (HTTP 2xx) là tín hiệu thành công duy nhất bắt buộc** — body JSON (`message`, `mac`...) chỉ dùng để
> hiển thị thêm thông tin nếu đọc được, không còn là điều kiện. Lý do tin được HTTP status: firmware
> trong repo dùng đúng quy ước mã lỗi chuẩn (400 khi thật sự sai — thiếu field, JSON hỏng...), nên
> 2xx luôn đồng nghĩa "đã xử lý được", bất kể board đang chạy bản nào (xem "code phân kỳ" trong
> `docs/TIEN-DO-2026-07-02.md`). Firmware trong repo vẫn PHẢI trả đúng `{"ok":true,...}` — đây chỉ là
> lớp phòng thủ phía client, không phải đổi chuẩn.

`GET /provision` → đọc lại thông tin **ĐÃ GHI** qua `POST /provision` (không cần xem Serial):
```json
{ "ssid": "TenWiFiNha", "hasPassword": true, "peerMac": "11:22:33:44:55:66", "provisioned": true }
```
Không trả mật khẩu WiFi thật (chỉ báo `hasPassword` có/không) để tránh lộ khi ai đó dò ra IP AP.

> ⚠️ **Cố tình giữ TÁCH RIÊNG `/info` và `/provision`** (2026-07-14): có lúc đã gộp 2 endpoint làm 1
> cho gọn, nhưng board thật ngoài hiện trường chạy firmware khác/cũ hơn repo (xem "code phân kỳ" ở
> `docs/TIEN-DO-2026-07-02.md`) nên không chắc board nào cũng hỗ trợ bản gộp cùng lúc. Tách riêng để
> PWA gọi từng endpoint độc lập — lỗi ở endpoint này không làm mất kết quả của endpoint kia.

`POST /reset` → xoá Preferences, quay về chưa cấu hình (tuỳ chọn, để demo lại).

`POST /reboot` → khởi động lại ESP theo yêu cầu tường minh. Body:
```json
{ "action": true }
```
Thiếu field hoặc `action` không phải `true` → trả lỗi `400 {"ok":false,"message":"..."}`, KHÔNG reboot.
`action: true` → trả `{"ok":true,"message":"Rebooting."}` rồi `ESP.restart()` sau ~1s (giống cơ chế
`/provision`). ⚠️ Chỉ dùng được khi ESP đang ở **chế độ SoftAP provisioning** (giữ nút BOOT lúc khởi
động) — server HTTP này KHÔNG chạy khi ESP đã vào chế độ STA bình thường (không có server nào lắng
nghe lúc đó, đây là quyết định có chủ đích để không tốn thêm RAM lúc chạy thật — xem mục "Vướng mắc"
trong `docs/TIEN-DO-2026-07-02.md`).

> **CORS:** ESP server thêm header `Access-Control-Allow-Origin: *` và xử lý preflight `OPTIONS`
> để PWA gọi được từ trình duyệt.
> **Mixed-content / Local Network Access:** PWA chạy HTTPS gọi ESP HTTP (`192.168.4.1`) có thể bị
> chặn theo **2 cơ chế khác nhau** tuỳ trình duyệt:
> - **Local Network Access (Chrome/Android mới)**: trình duyệt **hỏi quyền** ("truy cập thiết bị
>   khác trên mạng cục bộ") — bấm **Allow** thì request VẪN chạy được dù trang là HTTPS. Lỗi thực tế
>   gặp phải (2026-07-02, test bằng điện thoại thật): Android chặn hẳn hộp thoại xin quyền với thông
>   báo *"This site can't ask for your permission — Close any bubbles or overlays"* vì có app khác
>   (Messenger, launcher...) đang **vẽ đè lên màn hình** (`SYSTEM_ALERT_WINDOW`/"Hiển thị đè lên ứng
>   dụng khác"). Fix: tắt quyền đó cho app đang chạy nền rồi thử lại; kiểm tra đã cấp quyền ở
>   `Chrome Settings → Site settings → Local network`.
> - **Mixed-content (trình duyệt cũ hơn)**: chặn thẳng, không có prompt xin quyền, không override được.
>
> Cách dùng thật (áp dụng cho cả 2 trường hợp trên): mở PWA qua `http://` (server local) HOẶC dùng
> trang form do ESP tự phục vụ (`GET /`, same-origin — **không dính cả 2 lỗi trên**, khuyến nghị làm
> phương án demo dự phòng chắc ăn). Khi test không có phần cứng → PWA trỏ tới `tools/mock-esp-server`
> (HTTP localhost) → chạy tốt (localhost không bị 2 cơ chế trên chặn).
>
> **ĐÃ XÁC NHẬN qua test thật (2026-07-14):** bản PWA deploy HTTPS (`...-provision.web.app`) không gọi
> được `/info`, `/provision`, `/reboot` của ESP thật — `Failed to fetch` mọi lần, dù gọi trực tiếp
> `http://192.168.4.1/...` (Thunder Client, hoặc trang `GET /` của ESP) vẫn trả JSON đúng bình thường.
> Xác nhận đây là trình duyệt chặn (client), không phải lỗi ESP/API. **Kết luận: bản PWA HTTPS giờ chỉ
> dùng để quét QR lấy MAC** — gửi cấu hình thật bắt buộc qua `http://192.168.4.1/` (xem
> `mobile/README.md`).

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
**ESP1 (main):** Relay phun sương `GPIO 26` (mức kích cấu hình `RELAY_ACTIVE_HIGH`); phao/tiếp điểm cạn — mạch CŨ, nhị phân (nâng cao) `GPIO 34` (INPUT, chỉ đọc); tiếp điểm bơm (nâng cao) `GPIO 35` (INPUT). ⚠️ Mạch mức nước MỚI (3 đầu dò M2/M3/M4, xem mục 2 `tank`) CHƯA có GPIO cố định — Embed sẽ chọn 3 chân INPUT còn trống khi đấu nối thật.

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
