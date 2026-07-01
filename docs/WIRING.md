# WIRING — Sơ đồ nối chân & danh mục linh kiện (BOM)

> Sơ đồ đấu nối phần cứng cho **Smart Humidity IoT**, theo đúng **CONTRACT mục 8 (GPIO pin map)**.
> Mọi chân đều `#define` ở đầu file firmware nên có thể đổi — nhưng nếu đổi phải sửa cả CONTRACT.
>
> - **ESP2 (sensor):** SHT30 qua I²C (+ công tắc switch-role nâng cao).
> - **ESP1 (main):** relay máy phun sương (+ phao báo cạn & tiếp điểm bơm nâng cao).
>
> Board mặc định: **ESP32 DevKit (esp32dev)** — xem `firmware/platformio.ini`.

---

## 1. Bảng GPIO theo CONTRACT mục 8

### ESP2 — Sensor Node

| Chức năng | GPIO | Chế độ | Ghi chú |
|---|---|---|---|
| I²C **SDA** (SHT30) | **21** | I²C | địa chỉ cảm biến `0x44` |
| I²C **SCL** (SHT30) | **22** | I²C | |
| Công tắc switch-role *(nâng cao)* | **4** | `INPUT_PULLUP` | hở mạch = HIGH → (dự kiến) bật chế độ gateway |
| Nguồn cảm biến | **3V3** | — | SHT30 dùng 3.3V |
| GND chung | **GND** | — | |

### ESP1 — Main Node

| Chức năng | GPIO | Chế độ | Ghi chú |
|---|---|---|---|
| **Relay** máy phun sương | **26** | `OUTPUT` | mức kích cấu hình bằng `RELAY_ACTIVE_HIGH` (mặc định 1 = HIGH bật) |
| Phao báo cạn *(nâng cao)* | **34** | `INPUT` (chỉ đọc) | GPIO 34 **không có** pull nội → cần điện trở ngoài; HIGH = còn nước (tuỳ mạch) |
| Tiếp điểm bơm *(nâng cao)* | **35** | `INPUT` (chỉ đọc) | GPIO 35 **không có** pull nội; HIGH = bơm đang chạy |
| GND chung | **GND** | — | nối chung GND với module relay & nguồn |

> **Cảnh báo GPIO 34/35:** đây là chân **input-only** của ESP32, KHÔNG có điện trở kéo nội bộ. Phải
> dùng điện trở kéo lên/xuống ngoài (10kΩ) và đảm bảo mức điện áp ≤ 3.3V. Không dùng làm OUTPUT.

> **Lưu ý phần Basic:** trong firmware ESP1, `ENABLE_ADVANCED_WATER = 0` nên hai chân 34/35 **chưa**
> được đọc; `tank="full"`, `pump=false` cố định. Đặt `1` và `pinMode(...INPUT)` khi đã đấu nối thật.

---

## 2. Sơ đồ nối chân dạng text

### ESP2 ↔ SHT30 (I²C)

```
   SHT30 module                 ESP32 (ESP2 - Sensor)
   ┌───────────┐                ┌─────────────────────┐
   │   VIN/VCC ├────────────────┤ 3V3                  │
   │   GND     ├────────────────┤ GND                  │
   │   SDA     ├────────────────┤ GPIO 21 (SDA)        │
   │   SCL     ├────────────────┤ GPIO 22 (SCL)        │
   └───────────┘                │                      │
                                │ GPIO 4 ──[switch]──┐ │  (nâng cao, INPUT_PULLUP)
                                │                    │ │
                                │ GND ───────────────┘ │
                                └─────────────────────┘
   * Nhiều module SHT30 đã tích hợp điện trở kéo I²C 4.7kΩ. Nếu module "trần" thì thêm
     2 điện trở 4.7kΩ kéo SDA và SCL lên 3V3.
   * SHT30 dùng 3.3V — KHÔNG cấp 5V vào chân tín hiệu.
```

### ESP1 ↔ Relay → Máy phun sương

```
   ESP32 (ESP1 - Main)        Module Relay 1 kênh        Máy phun sương (tải AC/DC)
   ┌──────────────────┐       ┌───────────────┐          ┌────────────────────┐
   │ GPIO 26 ─────────┼───────┤ IN            │          │                    │
   │ 5V (VIN) ────────┼───────┤ VCC           │   COM ───┤ nguồn (L / +)      │
   │ GND ─────────────┼───────┤ GND           │   NO  ───┤ tới máy phun       │
   └──────────────────┘       └───────────────┘          └────────────────────┘
   * Relay mức kích: nếu module "active LOW" thì đặt RELAY_ACTIVE_HIGH = 0 trong firmware.
   * Máy phun sương 220V: ĐẤU QUA RELAY, KHÔNG nối trực tiếp vào ESP. Cẩn thận điện lưới!
   * Máy phun mini 5V/12V: vẫn nên qua relay (hoặc MOSFET) để cách ly dòng khỏi GPIO.
```

### ESP1 ↔ cảm biến nước (nâng cao)

```
   3V3 ──[10kΩ]──┬── GPIO 34   (phao báo cạn: phao đóng → kéo về mức tương ứng)
                 │
              [Phao/float switch]
                 │
                GND

   3V3 ──[10kΩ]──┬── GPIO 35   (tiếp điểm báo bơm đang chạy)
                 │
              [tiếp điểm/relay phụ của bơm]
                 │
                GND
   * GPIO 34/35 chỉ INPUT — luôn dùng điện trở ngoài, không vượt 3.3V.
```

---

## 3. Sơ đồ khối toàn hệ thống (phần cứng)

```
   ┌──────────────┐ ESP-NOW (broadcast, tự đồng bộ kênh) ┌──────────────┐ WiFi/HTTPS ┌──────────┐
   │   ESP2       │ ───────────────────────────────►│   ESP1       │ ──────────────►│ Firebase │
   │  (Sensor)    │       SensorPacket {T,H,seq}     │   (Main)     │   /sensor      │  RTDB    │
   │              │                                  │              │   /status      └────┬─────┘
   │  SHT30 (I²C) │                                  │  Deadband    │◄── stream /config ──┘
   └──────────────┘                                  │              │
                                                     │  GPIO26→Relay│──► Máy phun sương
                                                     │  GPIO34 phao │
                                                     │  GPIO35 bơm  │
                                                     └──────────────┘
```

---

## 4. Danh mục linh kiện gợi ý (BOM)

| # | Linh kiện | SL | Ghi chú |
|---|---|---|---|
| 1 | **ESP32 DevKit** (38 chân) | 2 | 1 cho ESP1 (main), 1 cho ESP2 (sensor) |
| 2 | **Cảm biến SHT30** (module I²C, 0x44) | 1 | đo nhiệt độ + độ ẩm cho ESP2 |
| 3 | **Module relay 1 kênh** (5V, có opto) | 1 | đóng/cắt máy phun sương từ GPIO 26 |
| 4 | **Máy phun sương** (siêu âm 5V/12V hoặc 220V) | 1 | tải điều khiển; 220V phải qua relay |
| 5 | Nguồn 5V/2A (hoặc adapter) | 1–2 | cấp cho ESP + relay |
| 6 | Cáp Micro-USB / USB-C | 2 | nạp & cấp nguồn ESP32 |
| 7 | Dây Dupont (đực-cái, cái-cái) | 1 bộ | đấu nối breadboard |
| 8 | Breadboard | 1–2 | lắp thử |
| **Nâng cao** | | | |
| 9 | Phao báo mức nước (float switch) | 1 | nối GPIO 34 (báo cạn) |
| 10 | Bơm châm nước mini (5V/12V) + relay/MOSFET | 1 | tự châm nước, tín hiệu báo về GPIO 35 |
| 11 | Điện trở 10kΩ | 2–4 | kéo cho GPIO 34/35 (input-only) |
| 12 | Điện trở 4.7kΩ | 2 | kéo I²C nếu module SHT30 chưa có |
| 13 | Công tắc gạt | 1 | switch-role gateway (GPIO 4) |

---

## 5. Checklist an toàn & lắp ráp

- [ ] Nối **GND chung** giữa ESP, relay, nguồn và cảm biến (rất quan trọng để tín hiệu đúng).
- [ ] SHT30 cấp **3.3V**, KHÔNG 5V vào chân tín hiệu.
- [ ] Máy phun **220V đấu qua tiếp điểm relay** (COM/NO), tuyệt đối không qua GPIO.
- [ ] Kiểm tra mức kích relay (HIGH/LOW) → đặt đúng `RELAY_ACTIVE_HIGH`.
- [ ] GPIO 34/35 chỉ đọc, có điện trở ngoài, điện áp ≤ 3.3V.
- [ ] Sau khi đấu nối nâng cao: đặt `ENABLE_ADVANCED_WATER = 1` trong `esp1_main/main.cpp`.
- [ ] **Kênh ESP-NOW tự đồng bộ**: ESP1 dùng kênh của router; ESP2 quét SSID router (đã provisioning)
      để phát trùng kênh — không cần ép kênh cố định. Chỉ cần provisioning ESP2 **đúng SSID router**.
