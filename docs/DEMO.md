# DEMO — Kịch bản trình diễn & nghiệm thu (Basic)

> Tài liệu hướng dẫn demo đồ án **Smart Humidity IoT** cho phần **Basic**, gồm:
> 1. Demo **KHÔNG cần phần cứng** bằng công cụ giả lập (`data-injector` + `mock-esp-server`).
> 2. Kịch bản demo **có phần cứng** (ESP1 + ESP2 + SHT30 + relay).
> 3. **Checklist nghiệm thu Basic** + ánh xạ tới use-case trong đề (PDF).
>
> Chuẩn bị trước: đã làm xong `docs/SETUP.md` (tạo Firebase, bật Auth, tạo RTDB, đẩy Rules, điền
> `web/js/firebase-config.js`, seed `/admins` & `/devices`).

---

## A. Demo KHÔNG cần phần cứng (khuyến nghị khi thuyết trình)

Toàn bộ luồng phần mềm (web realtime, biểu đồ, phân quyền, provisioning) đều demo được mà không có
ESP32, nhờ 2 công cụ trong `tools/`.

### A1. Bơm dữ liệu cảm biến giả → xem Web Dashboard

`data-injector` đóng vai **ESP1 giả**: đăng nhập bằng tài khoản thiết bị rồi ghi `/sensor` + `/status`
mỗi ~3s, có mô phỏng đúng thuật toán Deadband và thỉnh thoảng cho bồn "cạn nước" để bật cảnh báo.

```bash
cd tools/data-injector
cp config.example.js config.js     # rồi điền firebaseConfig + deviceEmail/devicePassword
npm install
npm start
```

Mở **Web Dashboard** (đã deploy hoặc chạy local) → đăng nhập Google (admin) → quan sát:
- Nhiệt độ/độ ẩm cập nhật realtime, **biểu đồ Chart.js** cuộn theo thời gian.
- Badge **Máy phun (mist)** bật/tắt theo Deadband.
- Khi injector cho `tank="empty"` → hộp **cảnh báo cạn nước** nhấp nháy + có tiếng bíp; badge bơm
  chuyển "Đang bơm".

### A2. Chỉnh cấu hình (admin) → injector phản ứng

Trên web, ở khung cấu hình, đổi **Hₛₑₜ** và **Deadband** → bấm **Lưu**:
- Web ghi `/config` (chỉ admin qua được Rules).
- `data-injector` đang `onValue("/config")` sẽ in `hset/deadband` mới ra console và đổi điểm BẬT/TẮT
  phun ngay vòng kế tiếp → minh hoạ đúng luồng **admin → cloud → "thiết bị"**.
- Web hiển thị **Max = hset+deadband**, **Min = hset−deadband** suy ra.

> Mẹo demo phân quyền: đăng nhập bằng **tài khoản Google chưa seed `/admins`** → khung cấu hình bị
> **khoá** (chỉ xem), bấm lưu sẽ bị Rules chặn (`permission-denied`).

### A3. Test PWA Provisioning với ESP giả lập

`mock-esp-server` giả lập REST SoftAP của ESP (CONTRACT mục 5) tại `http://localhost:8080`.

```bash
cd tools/mock-esp-server
npm install
npm start
```

Mở **PWA** qua HTTP local (vì mixed-content):
```bash
npx serve mobile        # rồi mở http://localhost:3000 (hoặc cổng được in ra)
```

Trên PWA:
1. Mở **Tuỳ chọn nâng cao** → bật **Chế độ Test** (POST sẽ trỏ tới `http://localhost:8080`).
2. Điền **SSID + mật khẩu WiFi + MAC ESP còn lại** (gõ tay, hoặc bấm **Quét QR** — dùng QR mẫu mock-server
   in ra log, JSON `{id,role,ap,ip,mac}` → app lấy field `mac` điền vào ô MAC).
3. Bấm **Gửi cấu hình** → thấy **response** `{ok:true, message:"Saved. Rebooting.", mac}` hiển thị
   trên màn hình; cửa sổ console mock-server log lại các field nhận được (`ssid`, `password`, `peerMac`).

---

## B. Demo CÓ phần cứng (ESP1 + ESP2)

### B1. Nạp firmware

```bash
cd firmware
pio run -e esp2-sensor -t upload     # nạp ESP2
pio run -e esp1-main   -t upload     # nạp ESP1
pio device monitor                    # 115200, xem Serial
```

### B2. Provisioning từng board (khi cần cấu hình mạng)

**Vào chế độ cấu hình:** GIỮ nút **BOOT (GPIO0)** rồi cấp nguồn/nhấn EN — ESP phát SoftAP
`PROV-SENSOR-xxxxxx` / `PROV-MAIN-xxxxxx` (IP `192.168.4.1`) và in **QR JSON** ra Serial. Nếu không
giữ nút, ESP chạy luôn bằng cấu hình đã lưu (hoặc hardcode fallback khi chưa provisioning).

1. **ESP2 (sensor):** giữ BOOT → nối AP `PROV-SENSOR-...` → **điện thoại tự bật trình duyệt lên trang
   cấu hình** (captive portal, xem CONTRACT mục 5) → POST **`ssid`** (+ mật khẩu; MAC để trống cũng
   được). Ghi lại **MAC ESP2** (có trong QR/Serial) để nạp cho ESP1.
2. **ESP1 (main):** giữ BOOT → nối AP `PROV-MAIN-...` → trình duyệt tự bật → POST **`ssid`, `password`,
   `peerMac` = MAC ESP2**. (Tài khoản Firebase đã hardcode trong firmware; `hset`/`deadband` dùng mặc
   định, chỉnh sau qua web.)
3. Mỗi board sau khi nhận `{ok:true}` sẽ **reboot** vào chế độ chạy thật.

> ⭐ **Không cần mở PWA/gõ IP nữa** — ESP chạy captive portal (giống WiFi khách sạn): nối AP xong là
> trình duyệt tự bật đúng trang. Nếu máy nào không tự bật (hiếm, tuỳ hệ điều hành), mở thẳng
> `http://192.168.4.1/` — same-origin, không dính mixed-content/Local Network Access. PWA (`mobile/`)
> chỉ còn cần khi muốn quét QR lấy MAC cho tiện.

### B3. Vận hành

- ESP2 đọc SHT30 mỗi ~5s, broadcast `SensorPacket` qua ESP-NOW (tự dò kênh router để trùng ESP1).
- ESP1 nhận → chạy **Deadband** → điều khiển relay (GPIO 26) → đẩy `/sensor` + `/status` mỗi ~4s.
- Web Dashboard hiển thị realtime; admin chỉnh `/config` → ESP1 đọc lại trong vòng ~10s (poll) và áp.
- **Mô phỏng kích hoạt phun:** hà hơi/đặt khăn ẩm lên cảm biến để độ ẩm thay đổi vượt ngưỡng → quan
  sát relay đóng/mở và badge mist trên web đổi theo.

---

## C. Checklist nghiệm thu Basic

| # | Hạng mục nghiệm thu | Cách kiểm tra | Đạt |
|---|---|---|---|
| 1 | Đọc được nhiệt độ & độ ẩm | Serial ESP2 in T/H; web hiện số liệu (hoặc injector) | ☐ |
| 2 | Truyền ESP-NOW ESP2→ESP1 | Serial ESP1 in `[ESP-NOW] seq=… T=… H=…` | ☐ |
| 3 | Thuật toán Deadband điều khiển relay | Serial ESP1 in `[DEADBAND] … BAT/TAT`; relay kêu | ☐ |
| 4 | Đẩy dữ liệu lên Firebase | RTDB có `/sensor`, `/status` cập nhật | ☐ |
| 5 | Web realtime + biểu đồ | Số liệu & Chart.js cuộn theo thời gian | ☐ |
| 6 | Đăng nhập Google (admin) | Login → vào dashboard, badge "Quản trị viên" | ☐ |
| 7 | Phân quyền chỉnh `/config` | Admin lưu được; khách bị khoá/`permission-denied` | ☐ |
| 8 | Cấu hình về tới thiết bị | Đổi hset/deadband trên web → ESP1/injector đổi ngưỡng | ☐ |
| 9 | Người chưa đăng nhập bị chặn | Mở web khi chưa login → không đọc được dữ liệu | ☐ |
| 10 | Provisioning qua REST + QR | PWA/mock POST `/provision` → `{ok:true}` + thiết bị lưu cấu hình | ☐ |
| **Nâng cao (bonus)** | | | |
| 11 | Cảnh báo cạn nước | `tank="empty"` → hộp đỏ nhấp nháy + bíp trên web | ☐ |
| 12 | Bơm châm nước | `pump=true` → badge "Đang bơm" | ☐ |
| 13 | Gateway dự phòng | `status/gateway="esp2"` → web hiện "ESP2 (dự phòng)" | ☐ |

---

## D. Ánh xạ use-case trong đề (PDF)

| Use-case trong PDF | Thành phần hiện thực | Mục nghiệm thu |
|---|---|---|
| Giám sát nhiệt độ/độ ẩm realtime | SHT30 → ESP-NOW → ESP1 → Firebase → Web | 1, 2, 4, 5 |
| Điều khiển tự động (phun sương theo ngưỡng) | Thuật toán Deadband trên ESP1 → relay | 3, 8 |
| Cấu hình ngưỡng từ xa | Web ghi `/config` → ESP1 poll lại (~10s) | 7, 8 |
| Phân quyền người dùng (admin / khách / người lạ) | Google Auth + Email Auth + Security Rules | 6, 7, 9 |
| Cấu hình thiết bị tiện lợi (không hardcode WiFi) | PWA Provisioning (QR + REST SoftAP) | 10 |
| Cảnh báo & an toàn nước *(nâng cao)* | `/status/tank`, `/status/pump` + alarm web | 11, 12 |
| Dự phòng/độ tin cậy *(nâng cao)* | switch-role gateway ESP2 (`gateway="esp2"`) | 13 |

---

## E. Xử lý sự cố nhanh khi demo

| Hiện tượng | Nguyên nhân thường gặp | Khắc phục |
|---|---|---|
| Web không thấy dữ liệu | Chưa seed `/devices/<UID>`; sai `databaseURL` | Kiểm tra Rules + config; xem console injector/ESP |
| Lưu `/config` báo `permission-denied` | UID admin chưa seed `/admins` | Seed `/admins/<UID> = true` |
| PWA "Failed to fetch" khi POST | Mixed-content (HTTPS→HTTP) | Mở PWA qua `http://localhost`, hoặc dùng `http://192.168.4.1/` |
| ESP1 không nhận ESP-NOW | Khác kênh WiFi giữa 2 board | Đảm bảo cùng `ESPNOW_CHANNEL`; xem CAVEAT trong `esp1_main/main.cpp` |
| SHT30 đọc NaN | Lỏng dây I²C / sai địa chỉ | Kiểm tra SDA=21, SCL=22, addr 0x44, điện trở kéo |
| Relay không đóng | Sai mức kích | Đổi `RELAY_ACTIVE_HIGH` (1↔0) |
