# INDEX — Bản đồ tài liệu & trạng thái dự án

Điểm vào duy nhất để cả nhóm định hướng. Cập nhật 2026-06-25.

## Trạng thái (đã kiểm thử KHÔNG cần phần cứng)
- 🌐 **Live:** Dashboard `https://smart-humidity-iot.web.app` · App cấu hình PWA `https://smart-humidity-iot-provision.web.app`
- ✅ **Firmware**: `pio run` — cả 2 env `esp1-main`, `esp2-sensor` **SUCCESS**.
- ✅ **Web / PWA / tools**: chạy được offline (mock-esp-server + data-injector); luồng provisioning verify end-to-end qua trình duyệt.
- ✅ **Đã qua audit logic đa-agent** → sửa 8 lỗi (1 HIGH kênh ESP-NOW, 1 MEDIUM mất cảm biến, 6 low).
- ✅ **Kênh ESP-NOW tự đồng bộ** (ESP2 quét SSID router) — không còn phụ thuộc kênh cố định.
- 🟡 **Test rules** & **unit test Deadband**: đã viết đầy đủ; chạy cần **Java** (emulator) / **gcc host** (pio test) — xem bảng dưới.
- ⏳ **Còn chờ bạn/đồng đội**: tạo Firebase project (cloud) + lắp & chạy phần cứng.

## Bản đồ thư mục
| Đường dẫn | Nội dung |
|---|---|
| `firmware/` | PlatformIO: `src/esp1_main`, `src/esp2_sensor`; `lib/common` (protocol, provisioning), `lib/control` (Deadband thuần) |
| `web/` | Dashboard (Google Auth, Chart.js, alarm) — Firebase Hosting |
| `mobile/` | PWA provisioning (QR + REST) |
| `firebase/` | `database.rules.json` (Security Rules) |
| `tools/` | `mock-esp-server` (giả lập ESP), `data-injector` (bơm dữ liệu giả) |
| `tests/rules/` | Test tự động Security Rules (Firebase emulator) |
| `firmware/test/` | Unit test Deadband (`pio test -e native`) |

## Tài liệu
| File | Dành cho |
|---|---|
| [NGHIEM-THU.md](NGHIEM-THU.md) | ⭐ Đối chiếu yêu cầu + kịch bản demo **chứng minh đã làm đúng** |
| [CONTRACT.md](CONTRACT.md) | ⭐ Hợp đồng interface dùng chung — đọc trước khi sửa code |
| [SETUP.md](SETUP.md) | Tạo Firebase project + deploy + seed UID (tóm tắt) |
| [FIREBASE-GUIDE.md](FIREBASE-GUIDE.md) | ⭐ Hướng dẫn Firebase **chi tiết** click-by-click + chỗ điền code |
| [HANDOFF-HARDWARE.md](HANDOFF-HARDWARE.md) | Người lắp & chạy thiết bị |
| [WIRING.md](WIRING.md) | Sơ đồ nối chân + BOM |
| [DEMO.md](DEMO.md) | Kịch bản demo (kể cả không phần cứng) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc + luồng + phân tích giao thức |
| architecture-diagram.svg / .png | Sơ đồ kiến trúc (chèn báo cáo/slide) |

## Lệnh chạy nhanh
| Việc | Lệnh | Cần |
|---|---|---|
| Biên dịch firmware | `cd firmware && pio run` | PlatformIO |
| Nạp firmware | `pio run -e esp1-main -t upload` | + ESP32 |
| Deploy rules + web | `firebase deploy --only database,hosting` | firebase-tools + project cloud |
| Chạy web local | mở qua HTTP server (vd `firebase serve`) | config Firebase thật |
| Bơm dữ liệu giả | `cd tools/data-injector && npm i && npm start` | Node + tài khoản thiết bị |
| Giả lập ESP (test PWA) | `cd tools/mock-esp-server && npm i && npm start` | Node |
| **Test Security Rules** | `cd tests/rules && npm i && npm test` | Node + firebase-tools + **Java JDK 11+** |
| **Unit test Deadband** | `cd firmware && pio test -e native` | PlatformIO + **gcc/g++ host** |

> Lưu ý: trong môi trường phát triển hiện tại **chưa có Java và trình biên dịch host**, nên 2 dòng
> *Test* ở trên đã được **viết + kiểm cú pháp/biên dịch firmware** nhưng phần chạy assertion sẽ thực
> hiện trên máy có đủ toolchain (rất phổ biến — chỉ cần cài JDK / MinGW).
