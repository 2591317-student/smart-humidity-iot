// ============================================================================
//  ESP2 — SENSOR NODE (firmware)
//  Vai trò "sensor" (xem docs/CONTRACT.md mục 1):
//    Đọc cảm biến SHT30 (I²C) -> đóng gói SensorPacket -> gửi ESP-NOW sang ESP1.
//
//  Luồng hoạt động:
//    - Boot lần đầu (chưa provisioning) -> bật SoftAP + HTTP server để nạp cấu
//      hình (WiFi/tài khoản thiết bị/...). Xem firmware/lib/common/provisioning.h.
//    - Đã provisioning -> WIFI_STA + ESP-NOW + đọc SHT30 mỗi ~5s -> broadcast.
//
//  Struct ESP-NOW + hằng số kênh: firmware/lib/common/protocol.h (PHẢI khớp ESP1).
//  Build env: esp2-sensor (xem platformio.ini) — dùng lib Adafruit SHT31.
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>           // WiFi.h built-in của ESP32 core
#include <esp_now.h>        // ESP-NOW built-in
#include <esp_wifi.h>       // esp_wifi_set_channel() để ép kênh ESP-NOW
#include <Wire.h>           // I²C cho SHT30
#include <Adafruit_SHT31.h> // Driver SHT3x (dùng cho SHT30, addr 0x44)

#include "protocol.h"       // SensorPacket, MSG_SENSOR_DATA, ESPNOW_CHANNEL, FW_VERSION
#include "provisioning.h"   // Provisioning::* (SoftAP + Preferences)

// ----------------------------------------------------------------------------
//  GPIO / cấu hình phần cứng (xem CONTRACT mục 8). Đổi được, ghi chú ở đây.
// ----------------------------------------------------------------------------
#define PIN_SDA          21   // I²C SDA cho SHT30
#define PIN_SCL          22   // I²C SCL cho SHT30
#define SHT30_I2C_ADDR   0x44 // Địa chỉ I²C mặc định của SHT30
#define PIN_SWITCH_ROLE  4    // (Nâng cao) công tắc chuyển ESP2 -> gateway, INPUT_PULLUP

// Nút kích hoạt lại provisioning: GIỮ lúc KHỞI ĐỘNG -> vào SoftAP cấu hình lại
// (giống "bấm reset mạng"). Mặc định GPIO0 = nút BOOT có sẵn trên board ESP32.
#define PIN_PROV_BUTTON        0    // GPIO0 (nút BOOT)
#define PROV_BUTTON_ACTIVE_LOW 1    // 1 = nhấn kéo xuống LOW

// ----------------------------------------------------------------------------
//  HARDCODE FALLBACK — SSID router mặc định khi CHƯA provisioning qua app.
//  ESP2 KHÔNG nối WiFi, nhưng cần SSID router để DÒ KÊNH ESP-NOW trùng với ESP1.
//  NVS-first: nếu app đã cấu hình thì dùng NVS; trống -> rơi về hằng số dưới.
//  (Để đúng cùng WiFi với ESP1, HC_WIFI_SSID nên khớp bên esp1_main/main.cpp.)
// ----------------------------------------------------------------------------
#define HC_WIFI_SSID   "chipchip"    // SSID router (dev) — khớp ESP1
#define HC_WIFI_PASS   "244466666"   // (ESP2 không nối, giữ cho đồng nhất)

// Chu kỳ đọc + gửi cảm biến (~5 giây theo yêu cầu Basic).
#define SENSOR_INTERVAL_MS  5000UL

// ----------------------------------------------------------------------------
//  Biến trạng thái toàn cục
// ----------------------------------------------------------------------------
Adafruit_SHT31 sht30 = Adafruit_SHT31();   // Đối tượng cảm biến SHT30

bool     sensorReady = false;              // SHT30 init thành công?
uint32_t txSeq       = 0;                  // Số thứ tự gói (tăng dần), nạp vào SensorPacket.seq
unsigned long lastSendMs = 0;              // Mốc thời gian gửi gói gần nhất

// --- Đồng bộ kênh ESP-NOW theo router (xem discoverRouterChannel) ---
String        g_homeSsid;                      // SSID router (provisioning) dùng để dò kênh
int           g_channel      = ESPNOW_CHANNEL; // kênh ESP-NOW đang dùng (dò từ router; mặc định = dự phòng)
unsigned long lastChanScanMs = 0;              // mốc lần dò kênh gần nhất
#define CHANNEL_RESCAN_MS  120000UL            // dò lại kênh mỗi ~2 phút (phòng router đổi kênh/boot trễ)

// Địa chỉ MAC broadcast (FF:FF:FF:FF:FF:FF).
// Giai đoạn Basic ta GỬI BROADCAST để ESP1 nhận được mà KHÔNG cần cấu hình chéo
// MAC giữa 2 board (tránh phải nạp MAC ESP2 vào ESP1 và ngược lại). ESP1 lắng nghe
// ESP-NOW trên kênh router; ESP2 tự DÒ đúng kênh đó (discoverRouterChannel) nên 2
// board luôn cùng kênh. Khi muốn unicast bảo mật hơn thì add peer theo MAC cụ thể.
static const uint8_t BROADCAST_MAC[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// ----------------------------------------------------------------------------
//  Callback báo kết quả gửi ESP-NOW (chỉ để log, không bắt buộc xử lý lại).
// ----------------------------------------------------------------------------
void onEspNowSent(const uint8_t* mac_addr, esp_now_send_status_t status) {
  // Với broadcast, "success" chỉ nghĩa là gói đã rời khỏi MAC layer (không có ACK
  // từ peer như unicast). Vẫn in ra để tiện debug.
  Serial.printf("[ESP-NOW] Trạng thái gửi: %s\n",
                status == ESP_NOW_SEND_SUCCESS ? "OK" : "THẤT BẠI");
}

// ----------------------------------------------------------------------------
//  Dò KÊNH WiFi của router theo SSID đã provisioning, để ESP-NOW phát TRÙNG kênh
//  với ESP1 (ESP1 là STA nên ESP-NOW của nó nằm trên kênh router). Trả về kênh
//  1..13 nếu quét thấy SSID, hoặc 0 nếu không thấy.
// ----------------------------------------------------------------------------
// Đọc cấu hình theo NVS-first, hardcode-fallback: field trống -> điền hằng số HC_*.
ProvConfig loadConfigWithFallback() {
  ProvConfig cfg = Provisioning::isProvisioned() ? Provisioning::load() : ProvConfig();
  if (cfg.ssid.length() == 0) cfg.ssid = HC_WIFI_SSID;
  if (cfg.pass.length() == 0) cfg.pass = HC_WIFI_PASS;
  return cfg;
}

// true nếu người dùng GIỮ nút provisioning lúc khởi động -> muốn cấu hình lại.
bool provisioningRequested() {
  pinMode(PIN_PROV_BUTTON, PROV_BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
  delay(30);  // ổn định mức logic
  return digitalRead(PIN_PROV_BUTTON) == (PROV_BUTTON_ACTIVE_LOW ? LOW : HIGH);
}

int discoverRouterChannel(const String& ssid) {
  if (ssid.length() == 0) return 0;          // chưa có SSID -> không dò được
  int n = WiFi.scanNetworks(false, false);   // quét đồng bộ, bỏ qua mạng ẩn
  int ch = 0;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == ssid) { ch = WiFi.channel(i); break; }
  }
  WiFi.scanDelete();                          // giải phóng kết quả quét
  return ch;
}

// Áp kênh cho ESP-NOW (ép kênh giao diện STA). peer.channel=0 nên chỉ cần đổi ở đây.
void applyEspNowChannel(int ch) {
  g_channel = (ch >= 1 && ch <= 13) ? ch : ESPNOW_CHANNEL;
  esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
}

// ----------------------------------------------------------------------------
//  Khởi tạo ESP-NOW + đăng ký peer broadcast. Kênh đã được áp trước bằng
//  applyEspNowChannel() theo kênh router dò được. Trả về true nếu thành công.
// ----------------------------------------------------------------------------
bool initEspNow() {
  // ESP-NOW yêu cầu WiFi ở chế độ STA (đã set trước khi gọi hàm này) và kênh đã
  // được áp theo router (xem setup()). peer.channel=0 => dùng kênh hiện tại.
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] LỖI: esp_now_init() thất bại!");
    return false;
  }

  // Đăng ký callback báo trạng thái gửi.
  esp_now_register_send_cb(onEspNowSent);

  // Đăng ký PEER BROADCAST: gửi tới FF:FF:FF:FF:FF:FF trên kênh hiện tại.
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = 0;                // 0 = dùng kênh hiện tại của STA (đã áp theo router)
  peer.encrypt = false;            // Broadcast không mã hoá
  peer.ifidx   = WIFI_IF_STA;      // Gửi qua giao diện STA

  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[ESP-NOW] LỖI: không thêm được peer broadcast!");
    return false;
  }

  Serial.printf("[ESP-NOW] Sẵn sàng. Kênh=%d (theo router), peer=broadcast.\n", g_channel);
  return true;
}

// ----------------------------------------------------------------------------
//  Khởi tạo cảm biến SHT30 qua I²C. Trả về true nếu tìm thấy cảm biến.
// ----------------------------------------------------------------------------
bool initSensor() {
  Wire.begin(PIN_SDA, PIN_SCL);   // Khởi tạo bus I²C với chân SDA=21, SCL=22

  if (!sht30.begin(SHT30_I2C_ADDR)) {
    Serial.printf("[SHT30] LỖI: không tìm thấy cảm biến tại I²C 0x%02X (SDA=%d, SCL=%d).\n",
                  SHT30_I2C_ADDR, PIN_SDA, PIN_SCL);
    return false;
  }

  // Tắt heater (chỉ bật khi cần khử ẩm/đo điều kiện đặc biệt).
  sht30.heater(false);

  Serial.printf("[SHT30] OK tại I²C 0x%02X.\n", SHT30_I2C_ADDR);
  return true;
}

// ----------------------------------------------------------------------------
//  Đọc SHT30 + đóng gói + gửi ESP-NOW. Có bắt lỗi đọc cảm biến (NaN).
// ----------------------------------------------------------------------------
void readAndSend() {
  if (!sensorReady) {
    // Cảm biến chưa init được — thử init lại (có thể do dây I²C lỏng lúc boot).
    Serial.println("[SHT30] Cảm biến chưa sẵn sàng, thử khởi tạo lại...");
    sensorReady = initSensor();
    if (!sensorReady) return;
  }

  // Đọc nhiệt độ (°C) và độ ẩm (%RH). Lỗi đọc -> trả về NaN.
  float temperature = sht30.readTemperature();
  float humidity    = sht30.readHumidity();

  // BẮT LỖI: nếu một trong hai giá trị NaN thì bỏ qua chu kỳ này (không gửi rác).
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[SHT30] LỖI đọc cảm biến (NaN) — bỏ qua chu kỳ này.");
    sensorReady = false;  // Đánh dấu để chu kỳ sau init lại
    return;
  }

  // Đóng gói SensorPacket KHỚP CHÍNH XÁC struct ở protocol.h (CONTRACT mục 4).
  SensorPacket pkt;
  pkt.msgType     = MSG_SENSOR_DATA;  // = 1
  pkt.temperature = temperature;      // °C
  pkt.humidity    = humidity;         // %RH
  pkt.seq         = ++txSeq;          // tăng dần theo từng gói gửi
  pkt.fromGateway = 0;                // 0 = bình thường (không phải gateway dự phòng)

  // Gửi broadcast tới ESP1.
  esp_err_t rc = esp_now_send(BROADCAST_MAC, (const uint8_t*)&pkt, sizeof(pkt));

  if (rc == ESP_OK) {
    Serial.printf("[TX seq=%lu] Nhiet do=%.2f C, Do am=%.2f %%RH (gui broadcast)\n",
                  (unsigned long)pkt.seq, pkt.temperature, pkt.humidity);
  } else {
    Serial.printf("[ESP-NOW] LỖI esp_now_send(): mã %d\n", (int)rc);
  }
}

// ----------------------------------------------------------------------------
//  (NÂNG CAO — STUB) Chuyển ESP2 sang chế độ GATEWAY khi công tắc GPIO4 = HIGH.
//
//  Ý tưởng: nếu ESP1 (main) hỏng, gạt công tắc để ESP2 tự nối WiFi + Firebase,
//  trực tiếp đọc SHT30 và GHI thẳng lên /sensor (đặt status/gateway = "esp2").
//  Phần này KHÔNG nằm trong phạm vi Basic và CHƯA được hiện thực để không làm
//  hỏng luồng chính. Để lại scaffold + comment cho giai đoạn nâng cao.
//
//  Khi làm thật cần:
//    - WiFi.begin(cfg.ssid, cfg.pass) tới khi WL_CONNECTED.
//    - Đăng nhập Firebase bằng cfg.devEmail / cfg.devPass (tài khoản thiết bị).
//    - Vòng lặp: đọc SHT30 -> ghi /sensor {temperature,humidity,timestamp}
//      + /status {gateway:"esp2", lastSeen:...}. SensorPacket.fromGateway = 1.
//    - Lưu ý: ở chế độ này KHÔNG dùng ESP-NOW broadcast nữa (đã ghi trực tiếp).
// ----------------------------------------------------------------------------
bool isGatewaySwitchOn() {
  // INPUT_PULLUP: hở mạch = HIGH. Theo yêu cầu, HIGH => bật chế độ gateway.
  // (Tùy đấu nối thực tế có thể cần đảo logic; ghi chú để chỉnh khi lắp phần cứng.)
  return digitalRead(PIN_SWITCH_ROLE) == HIGH;
}

void enterGatewayModeStub() {
  // STUB: chỉ cảnh báo, CHƯA hiện thực để không phá vỡ phần Basic.
  Serial.println("[GATEWAY] (STUB) Công tắc GPIO4 đang HIGH — chế độ gateway CHƯA hiện thực.");
  // TODO (nâng cao): nối WiFi + Firebase rồi ghi /sensor & /status như mô tả trên.
}

// ============================================================================
//  setup()
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.printf("=== ESP2 SENSOR NODE — FW %s ===\n", FW_VERSION);

  // Đọc trạng thái công tắc switch-role sớm (chỉ để log ở giai đoạn này).
  pinMode(PIN_SWITCH_ROLE, INPUT_PULLUP);

  // --- GIỮ nút BOOT lúc khởi động -> vào SoftAP để cấu hình lại rồi return. ---
  if (provisioningRequested()) {
    Serial.println("[PROV] Giữ nút BOOT -> bật SoftAP provisioning (role=sensor).");
    Provisioning::beginAP("sensor");
    // loop() sẽ gọi Provisioning::handle() để phục vụ HTTP + tự restart sau khi nạp.
    return;
  }

  // --- Nạp cấu hình: NVS-first, hardcode-fallback (chạy được ngay cả khi chưa provisioning). ---
  ProvConfig cfg = loadConfigWithFallback();
  Serial.printf("[PROV] Cấu hình (%s). SSID=\"%s\", hset=%d, deadband=%d\n",
                Provisioning::isProvisioned() ? "NVS/app" : "hardcode fallback",
                cfg.ssid.c_str(), cfg.hset, cfg.deadband);
  // Ghi chú: ESP2 KHÔNG nối WiFi/Firebase ở Basic, nhưng cfg.ssid VẪN được dùng để
  // DÒ KÊNH router (cho ESP-NOW trùng kênh ESP1). devEmail/devPass chỉ dùng khi bật
  // chế độ gateway (nâng cao).

  // ESP-NOW yêu cầu WiFi ở chế độ STA. Không gọi WiFi.begin() để khỏi nối AP.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();   // không nối AP — chỉ dùng STA cho ESP-NOW + quét kênh

  g_homeSsid = cfg.ssid;   // SSID router dùng để dò kênh ESP-NOW
  Serial.printf("[WiFi] MAC STA của ESP2: %s\n", WiFi.macAddress().c_str());

  // Dò kênh router (theo SSID provisioning) để ESP-NOW trùng kênh với ESP1.
  int ch = discoverRouterChannel(g_homeSsid);
  if (ch > 0) Serial.printf("[ESP-NOW] Da do thay router \"%s\" o kenh %d.\n", g_homeSsid.c_str(), ch);
  else        Serial.printf("[ESP-NOW] Khong thay SSID \"%s\" -> dung kenh du phong %d.\n", g_homeSsid.c_str(), ESPNOW_CHANNEL);
  applyEspNowChannel(ch);
  lastChanScanMs = millis();

  // Khởi tạo ESP-NOW + peer broadcast.
  if (!initEspNow()) {
    Serial.println("[ESP-NOW] Khởi tạo thất bại — sẽ thử lại trong loop().");
  }

  // Khởi tạo cảm biến SHT30.
  sensorReady = initSensor();

  Serial.println("[SETUP] Hoàn tất. Bắt đầu đọc & gửi mỗi ~5s.");
}

// ============================================================================
//  loop()
// ============================================================================
void loop() {
  // --- Nếu đang ở chế độ provisioning (SoftAP) -> chỉ phục vụ HTTP rồi thoát. ---
  if (Provisioning::inAPMode()) {
    Provisioning::handle();   // Tự ESP.restart() ~1s sau khi /provision lưu xong
    return;
  }

  // --- (NÂNG CAO — STUB) Kiểm tra công tắc switch-role GPIO4. ---
  // Không làm gì ngoài log để KHÔNG ảnh hưởng phần Basic.
  if (isGatewaySwitchOn()) {
    static unsigned long lastGwLog = 0;
    if (millis() - lastGwLog > 10000UL) {  // log tối đa 10s/lần cho đỡ spam
      enterGatewayModeStub();
      lastGwLog = millis();
    }
    // Lưu ý: chưa return — vẫn tiếp tục gửi ESP-NOW bình thường ở giai đoạn Basic.
  }

  unsigned long now = millis();

  // --- Định kỳ dò lại kênh router (phòng router đổi kênh / boot trễ hơn ESP2). ---
  if (g_homeSsid.length() > 0 && now - lastChanScanMs >= CHANNEL_RESCAN_MS) {
    lastChanScanMs = now;
    int prev = g_channel;
    int ch = discoverRouterChannel(g_homeSsid);   // LƯU Ý: quét làm đổi kênh radio tạm thời
    // LUÔN áp lại kênh sau khi quét: scan để radio ở kênh bất kỳ nên phải khôi phục.
    // (Nếu router KHÔNG đổi kênh mà ta bỏ qua re-apply -> radio kẹt ở kênh scan -> ESP-NOW chết.)
    applyEspNowChannel(ch > 0 ? ch : prev);
    if (ch > 0 && ch != prev)
      Serial.printf("[ESP-NOW] Router doi kenh %d -> %d, cap nhat.\n", prev, ch);
  }

  // --- Chế độ sensor bình thường: đọc + gửi mỗi SENSOR_INTERVAL_MS. ---
  if (now - lastSendMs >= SENSOR_INTERVAL_MS) {
    lastSendMs = now;
    readAndSend();
  }
}
