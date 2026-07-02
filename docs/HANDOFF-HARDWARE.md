# HANDOFF — Bàn giao cho người lắp & chạy thiết bị

> Tài liệu cho **người phụ trách phần cứng** (lắp ráp, nạp firmware, chạy thật). Phần **code đã
> hoàn tất, biên dịch sạch** (PlatformIO, cả 2 env SUCCESS) và đã qua audit logic. Việc của bạn:
> đấu nối → điền vài thông số → nạp → provisioning → nghiệm thu.
>
> Tài liệu liên quan: [WIRING.md](WIRING.md) (chân & BOM) · [SETUP.md](SETUP.md) (Firebase) ·
> [DEMO.md](DEMO.md) (kịch bản demo) · [CONTRACT.md](CONTRACT.md) (interface).

---

## 0. Bạn cần có
- Repo này (đã có sẵn firmware trong `firmware/`).
- **2× ESP32 DevKit** + linh kiện theo **BOM** ([WIRING.md mục 4](WIRING.md)): SHT30, module relay, máy phun, dây, nguồn…
- Thông tin **Firebase** từ người làm cloud: `API_KEY`, `DATABASE_URL`, và 1 **tài khoản thiết bị** (email + mật khẩu) đã tạo + seed UID vào `/devices` (xem [SETUP.md](SETUP.md) mục 2,5).
- WiFi nhà (SSID + mật khẩu) để cấu hình cho ESP.

## 1. Cài công cụ (một lần)
- **PlatformIO**: cài extension *PlatformIO IDE* trong VS Code (hoặc `pip install platformio`).
- **Driver USB** của ESP32: CP210x hoặc CH340 (tuỳ board) để máy nhận cổng COM.

## 2. Điền cấu hình TRƯỚC khi nạp (chỉ ESP1)
Mở `firmware/src/esp1_main/main.cpp`, điền:

**(a) Firebase** (khối `FB_*`):
```cpp
#define FB_API_KEY      "..."   // Web API Key (Firebase Console → Project settings)
#define FB_DATABASE_URL "https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app/"
```

**(b) Tài khoản THIẾT BỊ Firebase** (khối `HC_*` — hardcode vì app không còn hỏi 2 trường này):
```cpp
#define HC_DEV_EMAIL   "device@<project>.iot"   // tài khoản thiết bị đã tạo trong Firebase Auth
#define HC_DEV_PASS    "<mật khẩu thiết bị>"     // + seed UID vào /devices/<UID> (xem SETUP.md)
```

**(c) WiFi mặc định (tuỳ chọn)** — khối `HC_WIFI_SSID`/`HC_WIFI_PASS` ở cả `esp1_main` và
`esp2_sensor`. Đây là WiFi dùng khi **chưa provisioning** (tiện test nhanh): nạp là chạy ngay.
Nếu sẽ cấu hình WiFi qua app thì để nguyên cũng được (app sẽ ghi đè).
```cpp
#define HC_WIFI_SSID   "chipchip"      // đổi thành WiFi của bạn nếu muốn chạy ngay không cần app
#define HC_WIFI_PASS   "244466666"
```
> **Chiến lược NVS-first, hardcode-fallback:** ESP ưu tiên cấu hình do app nạp (Preferences/NVS);
> field nào trống thì dùng hằng số `HC_*` ở trên. Nhờ vậy nạp firmware là chạy được ngay, và app
> vẫn cấu hình lại được khi cần.
> ESP2 chỉ cần khớp `HC_WIFI_SSID` với ESP1 (để dò kênh ESP-NOW), không cần tài khoản Firebase.

## 3. Đấu nối
Theo [WIRING.md](WIRING.md). Tóm tắt:
- **ESP2 (sensor):** SHT30 → `SDA=GPIO21`, `SCL=GPIO22`, `3V3`, `GND` (I²C 0x44).
- **ESP1 (main):** Relay máy phun → `IN=GPIO26`, relay `VCC=5V`, `GND` chung. Máy phun 220V **đấu qua tiếp điểm relay (COM/NO)**, không qua GPIO.
- (Nâng cao) phao `GPIO34`, bơm `GPIO35` — qua điện trở 10kΩ, ≤3.3V.

## 4. Nạp firmware
```bash
cd firmware
pio run -e esp2-sensor -t upload    # nạp ESP2 (cắm board ESP2)
pio run -e esp1-main   -t upload    # nạp ESP1 (cắm board ESP1)
pio device monitor -b 115200        # xem Serial để theo dõi
```
> Nếu báo lỗi cổng COM: chọn đúng cổng (`pio device list`), hoặc giữ nút BOOT khi nạp.

## 5. Provisioning cấu hình mạng (khi cần đổi WiFi/MAC)
Nếu WiFi đã hardcode ở bước 2 khớp mạng thật thì ESP chạy luôn — **có thể bỏ qua bước này**. Khi muốn
cấu hình mạng qua app (giống thiết bị smart home):
1. **GIỮ nút BOOT** rồi cấp nguồn/nhấn EN → ESP2 phát `PROV-SENSOR-xxxxxx`, ESP1 phát `PROV-MAIN-xxxxxx`
   (IP `192.168.4.1`). (Không giữ nút → ESP chạy bằng cấu hình đã lưu / hardcode.)
2. Trên điện thoại: nối WiFi vào AP đó → mở **PWA provisioning** (hoặc mở thẳng `http://192.168.4.1/`).
3. Nhập (cho cả hai ESP giống nhau): **SSID + mật khẩu WiFi nhà + MAC của ESP còn lại** (gõ tay hoặc
   quét QR). Tài khoản Firebase và hset/deadband **không phải nhập** (đã hardcode / dùng mặc định).
4. Bấm gửi → ESP lưu vào Flash (NVS) và tự khởi động lại vào chế độ chạy.

> **Lấy MAC của ESP2:** xem Serial của ESP2 (dòng `MAC STA của ESP2: ...`) khi nó chạy.
> **Xoá cấu hình đã nạp:** gửi `POST /reset` (ESP quay về dùng hardcode fallback). Để cấu hình lại
> qua app thì giữ nút BOOT lúc khởi động như bước 1.

## 6. Checklist nghiệm thu (đọc Serial 115200)
| Bước | Dấu hiệu đúng |
|---|---|
| ESP2 đọc cảm biến + gửi | Serial ESP2: `[TX seq=..] Nhiet do=.. Do am=..` |
| ESP2 dò kênh router | Serial ESP2: `Da do thay router "<SSID>" o kenh N` |
| ESP1 nhận ESP-NOW | Serial ESP1: `[ESP-NOW] seq=.. T=.. H=..` |
| Thuật toán Deadband chạy | Serial ESP1: `[DEADBAND] ... BAT/TAT phun` + relay kêu “tách” |
| ESP1 đẩy Firebase | Serial ESP1: `[FB] Da day: T=.. H=.. mist=..` |
| Web dashboard | Số liệu + biểu đồ cập nhật realtime sau khi đăng nhập Google |

## 7. Xử lý sự cố thường gặp
| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| ESP1 **không nhận** gói ESP-NOW | Kênh lệch. Kiểm Serial ESP2 có dòng `Da do thay router ... o kenh N` không; đảm bảo ESP2 được provisioning **đúng SSID router** mà ESP1 đang nối. Để 2 board gần nhau khi test. |
| SHT30 `khong tim thay cam bien` | Sai dây I²C / địa chỉ (phải `0x44`) / cấp nhầm 5V. Kiểm SDA21–SCL22, nguồn 3V3, GND chung. |
| Firebase `Ghi /sensor loi` / permission | Tài khoản thiết bị **chưa seed** vào `/devices/<UID>=true`, hoặc sai `HC_DEV_EMAIL`/`HC_DEV_PASS` (bước 2b) — kiểm lại và nạp lại (xem [SETUP.md](SETUP.md) mục 5). |
| Relay **ngược** (bật khi đáng tắt) | Module relay active-LOW → đặt `#define RELAY_ACTIVE_HIGH 0` trong `esp1_main/main.cpp` rồi nạp lại. |
| WiFi không nối được | Sai SSID/mật khẩu → sửa `HC_WIFI_*` rồi nạp lại, **hoặc** giữ BOOT lúc khởi động để provisioning lại qua app (bước 5). |
| Web báo **“Mất kết nối”** | Web suy từ `lastSeen`: quá ~15s không cập nhật → offline. Nghĩa là ESP1 ngừng đẩy (chưa nối WiFi/Firebase, hoặc treo/crash); xem Serial ESP1. Nếu ESP chưa đồng bộ NTP (`lastSeen=0`) cũng bị coi là offline. |
| Số đo trên web **đứng yên** | Đúng hành vi khi mất gói cảm biến >15s (ESP1 ngừng đẩy `/sensor`). Kiểm lại ESP2/ESP-NOW. |

## 8. Bật tính năng nâng cao (khi có phần cứng nước)
- Đấu phao `GPIO34` + tiếp điểm bơm `GPIO35` (qua điện trở ngoài).
- Đặt `#define ENABLE_ADVANCED_WATER 1` trong `esp1_main/main.cpp`, hiệu chỉnh cực tính HIGH/LOW theo mạch, nạp lại.

## 9. Ranh giới phần mềm / phần cứng
- **Đã làm (phần code):** toàn bộ firmware ESP1/ESP2, web dashboard, PWA provisioning, tools, Firebase rules — biên dịch & verify (không phần cứng) OK.
- **Việc phần cứng (bạn):** đấu nối, nạp, điền `FB_API_KEY/FB_DATABASE_URL` + tài khoản thiết bị `HC_DEV_EMAIL/HC_DEV_PASS` (bước 2), chỉnh `#define` chân/mức relay nếu khác, provisioning (nếu cần), nghiệm thu.
- Cần đổi **logic** (không phải thông số/chân) → liên hệ người phụ trách code.
