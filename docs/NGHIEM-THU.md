# NGHIỆM THU — Đối chiếu yêu cầu & kịch bản chứng minh

Tài liệu để chứng minh phần đã làm **đúng đề bài**. Gồm: (A) bảng đối chiếu yêu cầu → bằng chứng,
(B) kịch bản demo không cần phần cứng, (C) bằng chứng có sẵn.

Link live: **Dashboard** https://smart-humidity-iot.web.app · **App cấu hình** https://smart-humidity-iot-provision.web.app

---

## A. Đối chiếu yêu cầu (đề bài) → đã làm → bằng chứng

| # | Yêu cầu (Basic) | Đã làm | Bằng chứng / cách kiểm |
|---|---|---|---|
| 1 | **ESP2 (Sensor):** đọc SHT30 (I²C) → gửi ESP-NOW sang ESP1 | ✅ code đầy đủ, biên dịch OK | `firmware/src/esp2_sensor/main.cpp`; `pio run -e esp2-sensor` → SUCCESS |
| 2 | **ESP1 (Main):** nhận ESP-NOW → WiFi sync `config` (Hₛₑₜ/Deadband) từ Firebase → thuật toán Deadband → relay | ✅ code đầy đủ, biên dịch OK, Deadband có unit-test | `firmware/src/esp1_main/main.cpp`; `pio run -e esp1-main` → SUCCESS; `pio test -e native` |
| 3 | **Provisioning:** cả 2 ESP boot lần đầu cấu hình qua **Mobile App (REST/HTTP POST)**, lưu **MAC + WiFi** vào **Flash (Preferences)**, **không hardcode** | ✅ SoftAP + REST + Preferences | `firmware/lib/common/provisioning.cpp` (dòng 125–132 lưu ssid/pass/peerMac…); demo mục B4 |
| 4 | **Web Dashboard** trên Firebase Hosting | ✅ đã deploy | Mở https://smart-humidity-iot.web.app |
| 5 | **Google Authentication (OAuth2)** — bắt buộc đăng nhập | ✅ | Trang bắt đăng nhập Google mới vào được |
| 6 | **Security Rules** — chỉ Admin ghi `config`, người khác chỉ xem/bị chặn | ✅ + có test tự động | `firebase/database.rules.json`; `tests/rules/` (11 ca); demo mục B2 |
| 7 | **Chart.js** vẽ nhiệt độ/độ ẩm realtime | ✅ | Dashboard có biểu đồ cập nhật liên tục (demo B1) |
| 8 | **Responsive (Tailwind)** PC/mobile | ✅ | Mở dashboard trên điện thoại / thu nhỏ cửa sổ |
| 9 | *(Nâng cao)* Cảnh báo cạn nước | ✅ (phần web) | demo B5 |

> Ghi chú trung thực: các hành vi **trên phần cứng thật** (ESP-NOW truyền, relay đóng/mở, SHT30 đọc) do
> người lắp thiết bị nghiệm thu. Phần code đã **biên dịch thành công** + **logic Deadband có unit-test**,
> nên khi nạp lên board là chạy.

---

## B. Kịch bản DEMO (không cần phần cứng) — chạy trước nhóm/giám khảo

Chuẩn bị: chạy `data-injector` để có dữ liệu như ESP thật đang gửi.
```bash
cd tools/data-injector && npm install && node injector.js
```

**B1 — Dashboard realtime:** mở https://smart-humidity-iot.web.app → đăng nhập Google →
cho thấy **nhiệt độ/độ ẩm nhảy số + biểu đồ chạy**. (Chứng minh #4,#5,#7,#8)

**B2 — Bảo mật (Security Rules):**
- Đăng nhập tài khoản **thường** → badge "Khách (chỉ xem)", **không sửa được** Hₛₑₜ.
- Đăng nhập **admin** → badge "Quản trị viên", sửa được.
- (Nâng cao) chạy test tự động: `cd tests/rules && npm install && npm test` (cần Java) → 11 ca PASS. (Chứng minh #6)

**B3 — Vòng điều khiển Web→Firebase:** ở tài khoản admin, đổi **Hₛₑₜ** → Lưu → mở **Firebase Console →
Realtime Database → `config`** cho thấy giá trị vừa ghi lên cloud (ESP1 sẽ nhận qua stream). (Chứng minh #2)

**B4 — App cấu hình (provisioning) không cần phần cứng:**
```bash
cd tools/mock-esp-server && npm install && npm start      # "ESP giả" ở http://localhost:8080
# terminal khác:
cd mobile && python -m http.server 5173                   # mở http://localhost:5173
```
Trên trang PWA → "Nhập tay" → bật **Chế độ Test** → điền WiFi + peerMac → **Gửi** →
hiện **"✓ Saved. Rebooting."** và terminal mock **in ra cấu hình vừa nhận**. (Chứng minh #3: REST POST + no hardcode)

**B5 — Cảnh báo cạn nước:** injector định kỳ đặt `tank="empty"` → dashboard hiện **hộp đỏ nhấp nháy + bíp**. (Chứng minh #9)

**B6 — Firmware biên dịch:** `cd firmware && pio run` → **2 SUCCESS** (esp1-main, esp2-sensor). (Chứng minh #1,#2)

---

## C. Bằng chứng có sẵn (chụp màn hình/đính kèm báo cáo)

- 🌐 2 web live (dashboard + app cấu hình) — mở là thấy.
- 🔥 Firebase Console: **Realtime Database** (`sensor`/`config`/`status`), **Authentication** (users), **Rules** đã deploy.
- 🧩 `pio run` log: 2 env SUCCESS.
- 🧪 `tests/rules/` (test Security Rules) + `firmware/test/` (unit test Deadband).
- 📄 Tài liệu: `docs/ARCHITECTURE.md`, `CONTRACT.md`, `WIRING.md`, `HANDOFF-HARDWARE.md`, sơ đồ `architecture-diagram.png`.
- 💻 Source: (repo GitHub nếu đã push).

---

## D. 3 kênh giao tiếp (để giải thích hệ thống — hay bị hỏi)

| Kênh | Giữa | Vai trò |
|---|---|---|
| **ESP-NOW** | ESP2 ↔ ESP1 | truyền số đo cảm biến, không cần WiFi |
| **REST/HTTP (LAN)** | 📱 App cấu hình ↔ ESP | nạp WiFi/MAC cho ESP lúc provisioning (nối AP `PROV-…`, POST) |
| **Firebase RTDB (Cloud)** | ESP1 ↔ Web Dashboard | ESP đẩy dữ liệu lên; admin chỉnh ngưỡng xuống |

→ **App cấu hình** lo kênh REST/LAN. **Firebase** lo kênh Cloud. Hai cái độc lập — đều nằm trong đề bài.
