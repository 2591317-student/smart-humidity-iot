# INDEX — Bản đồ tài liệu & trạng thái dự án

Điểm vào duy nhất để cả nhóm định hướng. Cập nhật 2026-07-02.

## Trạng thái (đã kiểm thử KHÔNG cần phần cứng)
- 🌐 **Live:** Dashboard `https://smart-humidity-iot.web.app` · App cấu hình PWA `https://smart-humidity-iot-provision.web.app`
- ✅ **Firmware**: `pio run` — cả 2 env `esp1-main`, `esp2-sensor` **SUCCESS**.
- ✅ **Web / PWA / tools**: chạy được offline (mock-esp-server + data-injector); luồng provisioning verify end-to-end qua trình duyệt.
- ✅ **Đã qua audit logic đa-agent** → sửa 8 lỗi (1 HIGH kênh ESP-NOW, 1 MEDIUM mất cảm biến, 6 low).
- ✅ **Kênh ESP-NOW tự đồng bộ** (ESP2 quét SSID router) — không còn phụ thuộc kênh cố định.
- 🟡 **Test rules** & **unit test Deadband**: đã viết đầy đủ; chạy cần **Java** (emulator) / **gcc host** (pio test) — xem bảng dưới.
- ⏳ **Còn chờ bạn/đồng đội**: tạo Firebase project (cloud) + lắp & chạy phần cứng.

### Cập nhật 2026-07-02 (đợt tinh chỉnh theo góp ý nhóm)
- ✅ **Firmware NVS-first, hardcode-fallback** + vào provisioning bằng **giữ nút BOOT** (thay vì "chưa cấu hình"): nạp là chạy ngay khi dev, vẫn cấu hình lại được qua app.
- ✅ **Tài khoản Firebase của thiết bị hardcode trong firmware** (`HC_DEV_EMAIL`/`HC_DEV_PASS`) — app không hỏi nữa.
- ✅ **App gọn**: chỉ WiFi + MAC, có **2 checkbox (WiFi/MAC) gửi từng phần** + nút **test `GET /provision`** (chẩn đoán, gộp cả danh tính lẫn cấu hình đã lưu) + trạng thái online. Firmware `POST /provision` hỗ trợ **partial update** (nhận cả `peerMac`/`mac_gateway`).
- ✅ **Web phát hiện online/offline theo `lastSeen`** (timer client), **không** dựa cờ `esp1Online`, **không cần backend**.
- ✅ **Gộp ghi Firebase**: `/sensor` + `/status` mỗi node 1 `setJSON` (2 request thay vì 9) → nhẹ tải ESP.
- 📌 **Chốt hướng provisioning:** giữ **PWA tự viết** (SoftAP + REST), KHÔNG dùng app Espressif chính chủ.
- ⏳ **Chưa nạp/deploy**: các thay đổi mới đang ở source — cần nạp firmware (qua USB, cần board) + `firebase deploy` (web+rules) + deploy lại PWA.

## Bản đồ thư mục
| Đường dẫn | Nội dung |
|---|---|
| `firmware/` | PlatformIO: `src/esp1_main`, `src/esp2_sensor`; `lib/common` (protocol, provisioning), `lib/control` (Deadband thuần) |
| `web/` | Dashboard (Google Auth, Chart.js, alarm) — Firebase Hosting |
| `mobile/` | PWA provisioning (QR + REST) |
| `firebase/` | `database.rules.json` (Security Rules) |
| `tools/` | `mock-esp-server` (giả lập ESP), `data-injector` (bơm dữ liệu giả), `presence-watcher` (tự cập nhật esp1Online kể cả khi không mở web) |
| `tests/rules/` | Test tự động Security Rules (Firebase emulator) |
| `firmware/test/` | Unit test Deadband (`pio test -e native`) |

## Tài liệu
| File | Dành cho |
|---|---|
| [TIEN-DO-2026-07-02.md](TIEN-DO-2026-07-02.md) | ⭐ **Mới** — tóm tắt đã làm / cần làm thêm / vướng mắc đợt tinh chỉnh |
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
