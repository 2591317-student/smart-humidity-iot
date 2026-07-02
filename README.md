# Smart Humidity IoT — Hệ thống giám sát & điều khiển độ ẩm tự động

Đồ án IoT: giám sát nhiệt độ/độ ẩm bằng cảm biến SHT30, điều khiển máy phun sương theo thuật
toán **Deadband**, đồng bộ cấu hình & dữ liệu qua **Firebase**, dashboard web có **Google Auth**,
và **app provisioning (PWA + QR)** để cấu hình WiFi cho ESP. Phần nâng cao: quản lý nước an toàn
tầng kép và gateway dự phòng.

> 📄 Đề bài gốc: `../IOT Basic & Adv.pdf` · 🔗 Bản tiền nhiệm: https://final-iot-4aa60.web.app/
>
> 🌐 **Live:** Dashboard **https://smart-humidity-iot.web.app** · App cấu hình (PWA) **https://smart-humidity-iot-provision.web.app**

## Kiến trúc

```
 ESP2 (SHT30) ──ESP-NOW──► ESP1 (Deadband→Relay) ──WiFi/RTDB──► Firebase ──► Web Dashboard
      ▲ provisioning (SoftAP+REST)        ▲ provisioning                 ▲ Google Auth + Chart.js
      └───────────── 📱 PWA Provisioning (QR + REST POST) ───────────────┘
```

- **ESP2 (Sensor Node):** đọc SHT30 qua I²C, gửi nhiệt độ/độ ẩm sang ESP1 bằng ESP-NOW.
- **ESP1 (Main Node):** nhận ESP-NOW, kết nối WiFi, đăng nhập Firebase (tài khoản thiết bị),
  lắng nghe `config` (Hₛₑₜ/Deadband) qua stream, chạy thuật toán Deadband điều khiển relay phun
  sương, đẩy `sensor`/`status` lên Firebase.
- **Firebase:** Realtime Database + Auth (Google cho admin, email/pass cho thiết bị) +
  Security Rules + Hosting.
- **Web Dashboard:** đăng nhập Google, biểu đồ realtime (Chart.js), chỉnh Hₛₑₜ/Deadband
  (chỉ admin), trạng thái bồn/bơm, cảnh báo cạn nước. Responsive bằng TailwindCSS.
- **PWA Provisioning:** giữ nút BOOT trên ESP → nối SoftAP của ESP → POST **WiFi + MAC** qua REST
  (2 checkbox gửi từng phần; QR chỉ để điền nhanh MAC — nhập tay vẫn được).

## Cấu trúc thư mục

```
smart-humidity-iot/
├── firmware/            # PlatformIO: env esp1-main, esp2-sensor (+ native cho test)
│   ├── src/esp1_main/   #   ESP1: ESP-NOW recv + WiFi + Firebase + Deadband + relay
│   ├── src/esp2_sensor/ #   ESP2: SHT30 + ESP-NOW send (tự dò kênh router)
│   ├── lib/common/      #   protocol.h (struct ESP-NOW) + provisioning (SoftAP/REST)
│   ├── lib/control/     #   control.h — thuật toán Deadband thuần (để unit-test)
│   ├── test/            #   unit test Deadband (pio test -e native)
│   └── platformio.ini
├── web/                 # Firebase Hosting: dashboard (Google Auth + Chart.js + alarm)
│   └── js/firebase-config.js   # ⚠ điền config Firebase của bạn
├── mobile/              # PWA provisioning (QR + REST) — "add to home screen"
├── firebase/database.rules.json   # Security Rules
├── firebase.json        # cấu hình Hosting + Database
├── tools/
│   ├── mock-esp-server/ # giả lập REST của ESP → test provisioning (không cần phần cứng)
│   └── data-injector/   # bơm dữ liệu giả lên Firebase → test web/chart
├── tests/rules/         # test tự động Security Rules (Firebase emulator)
└── docs/
    ├── INDEX.md         # ⭐ bản đồ tài liệu + trạng thái + lệnh chạy
    ├── CONTRACT.md      # hợp đồng interface dùng chung (đọc trước khi sửa code)
    ├── SETUP.md         # tạo Firebase project + deploy
    ├── HANDOFF-HARDWARE.md  # hướng dẫn cho người lắp & chạy thiết bị
    ├── WIRING.md · DEMO.md · ARCHITECTURE.md
    └── architecture-diagram.svg / .png
```

## Bắt đầu nhanh

1. Đọc **`docs/SETUP.md`** để tạo Firebase project mới, bật Google Auth, tạo RTDB, đẩy rules,
   tạo tài khoản thiết bị và điền `web/js/firebase-config.js`.
2. Web: `firebase deploy` (hoặc chạy local) → đăng nhập bằng Google.
3. Test không cần phần cứng: chạy `tools/data-injector` (bơm dữ liệu giả) + `tools/mock-esp-server`
   (giả lập ESP cho PWA).
4. Firmware: `cd firmware && pio run` để biên dịch; nạp khi có ESP32.

## Trạng thái (roadmap)

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0–1 | Scaffold + contract + Firebase rules | ✅ |
| 2 | Web Dashboard (Auth + Chart + responsive + cảnh báo) | ✅ |
| 3–4 | Firmware ESP2 + ESP1 (ESP-NOW, SHT30, Deadband, relay) | ✅ build OK |
| 5 | PWA Provisioning (QR + REST) | ✅ verify OK |
| 6 | Tích hợp + audit logic + sửa 8 lỗi + test (rules, unit Deadband) | ✅ |
| 7 | Cảnh báo cạn nước ✅ · nước tầng kép · switch-role gateway | 🟡 Advanced |
| — | Tạo Firebase cloud + lắp & chạy phần cứng thật | ⏳ chờ |

> 🧭 Xem [docs/INDEX.md](docs/INDEX.md) để có bản đồ tài liệu đầy đủ + lệnh chạy từng phần.

## Nhóm thực hiện

- Phạm Trung Kiên — 2591310
- Nguyễn Minh Tuấn — 2591325
- Lê Phú Nhân — 2591317
- Nguyễn Tuấn Nguyễn — 2591316

> 🔑 Tài khoản **Admin** (quyền ghi `config` Hₛₑₜ/Deadband): `2591317@student.hcmute.edu.vn`.
> UID của tài khoản này phải được seed vào `/admins` — xem [docs/SETUP.md](docs/SETUP.md) mục 5.
