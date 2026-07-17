// ============================================================================
//  ESP1 — MAIN NODE (Smart Humidity IoT)
//
//  Vai trò (CONTRACT mục 1, role = "main"):
//    - Nhận gói cảm biến (SensorPacket) từ ESP2 qua ESP-NOW.
//    - Kết nối WiFi (STA) + đăng nhập Firebase bằng tài khoản THIẾT BỊ (email/pass).
//    - Đọc lại /config định kỳ ~10s (poll, KHÔNG stream — hset, deadband do admin web chỉnh).
//    - Chạy thuật toán DEADBAND -> điều khiển relay máy phun sương (GPIO 26).
//    - Đẩy /sensor (temperature, humidity, timestamp) và /status (mist, tank,
//      pump, esp1Online, gateway, lastSeen) lên Firebase định kỳ ~4s.
//
//  Tham chiếu:
//    - docs/CONTRACT.md  : mục 2 (data model + thuật toán Deadband), 4 (ESP-NOW),
//                          5 (provisioning), 7 (Preferences), 8 (GPIO).
//    - firmware/lib/common/protocol.h     : struct SensorPacket, ESPNOW_CHANNEL.
//    - firmware/lib/common/provisioning.h : Provisioning::* (SoftAP cấu hình).
//    - firebase/database.rules.json       : rules /sensor /status /config.
//
//  Thư viện Firebase: "Firebase Arduino Client Library for ESP8266 and ESP32"
//    của mobizt (Firebase_ESP_Client) v4.x — dùng FirebaseData / FirebaseAuth /
//    FirebaseConfig, Firebase.begin(&config,&auth), Firebase.RTDB.get/setJSON.
//    CHỈ 1 FirebaseData (fbdo) dùng chung cho cả đọc /config lẫn ghi /sensor,/status
//    (không dùng stream riêng nữa) để giảm số kết nối TLS đồng thời — chống tràn RAM.
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>          // esp_wifi_set_channel() — ép kênh ESP-NOW
#include <time.h>              // time(), configTime() cho NTP (timestamp epoch)

#include <Firebase_ESP_Client.h>
// Các addon hỗ trợ token/RTDB của thư viện mobizt (bắt buộc include theo doc v4).
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

#include "protocol.h"          // SensorPacket, MSG_SENSOR_DATA, ESPNOW_CHANNEL, FW_VERSION
#include "provisioning.h"      // Provisioning::*, ProvConfig
#include "control.h"           // deadbandDecide() — thuật toán Deadband (tách ra để unit-test)

// ============================================================================
//  TĂNG STACK CHO loopTask — CHỐNG STACK OVERFLOW KHI GỬI FIREBASE (TLS).
//  Firebase dùng HTTPS/TLS (mbedTLS) rất ngốn stack lúc bắt tay + mã hoá; stack
//  mặc định của loopTask (8KB) thường KHÔNG đủ -> "Stack canary watchpoint
//  triggered (loopTask)" / Guru Meditation. Nâng lên 16KB cho an toàn.
//  (Macro của arduino-esp32, PHẢI đặt ở global scope. arduino-esp32 v2.0+.)
// ============================================================================
SET_LOOP_TASK_STACK_SIZE(16 * 1024);   // 16KB

// ============================================================================
//  CẤU HÌNH FIREBASE — ĐIỀN THEO PROJECT CỦA BẠN
//  CONTRACT hiện CHƯA lưu api_key/database_url trong Preferences (mục 7), nên ta
//  để dạng #define hằng số ở đây. Lấy từ Firebase Console:
//    - API_KEY      : Project settings -> General -> Web API Key.
//    - DATABASE_URL : Realtime Database -> URL (region asia-southeast1).
//  Còn email/password tài khoản thiết bị lấy từ provisioning (cfg.devEmail/devPass).
// ============================================================================
#define FB_API_KEY      "AIzaSyCu_UyCLAuQxJkFIas9KS_K1vcN6bliQvU"
#define FB_DATABASE_URL "https://smart-humidity-iot-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ============================================================================
//  HARDCODE FALLBACK — cấu hình mặc định khi CHƯA provisioning qua app.
//
//  Chiến lược "NVS-first, hardcode-fallback":
//    - Nếu đã cấu hình qua app (Preferences/NVS) -> DÙNG giá trị đó.
//    - Nếu field nào trống (chưa provisioning) -> rơi về hằng số dưới đây.
//  Nhờ vậy: giai đoạn DEV chỉ cần nạp firmware là chạy ngay (dùng hardcode),
//  KHÔNG bắt buộc phải qua bước provisioning. Khi DEMO thì giữ nút BOOT lúc khởi
//  động -> vào SoftAP -> app gửi WiFi/MAC -> lưu NVS -> ưu tiên dùng NVS.
//
//  * Tài khoản THIẾT BỊ Firebase (devEmail/devPass): app KHÔNG còn hỏi 2 trường
//    này nữa (cho gọn), nên PHẢI điền sẵn ở đây — tạo trong Firebase Auth và seed
//    UID vào /devices/<UID>=true (xem docs/SETUP.md).
// ============================================================================
#define HC_WIFI_SSID   "chipchip"                       // WiFi nhà (dev)
#define HC_WIFI_PASS   "244466666"                       // mật khẩu WiFi (dev)
#define HC_DEV_EMAIL   "device@smarthumidity.iot"        // tài khoản thiết bị (UID w3lYinUKv0NQo0w2PwhpbJ0U3c62)
#define HC_DEV_PASS    "123456"                           // mật khẩu thiết bị (thử — reset trong Console nếu login fail)
#define HC_PEER_MAC    ""                                 // MAC ESP2 (rỗng -> vẫn nhận broadcast)
#define HC_HSET        70                                 // ngưỡng độ ẩm mặc định
#define HC_DEADBAND    5                                  // vùng chết mặc định

// ============================================================================
//  CẤU HÌNH GPIO (CONTRACT mục 8) — đổi được tại đây.
// ============================================================================
#define PIN_RELAY          26   // Relay máy phun sương (OUTPUT)
#define RELAY_ACTIVE_HIGH  1    // 1 = relay kích mức CAO (HIGH bật); 0 = kích mức THẤP

// Nút kích hoạt lại provisioning: GIỮ nút này lúc KHỞI ĐỘNG -> vào SoftAP để
// cấu hình lại WiFi/MAC qua app (giống "bấm reset mạng" của thiết bị smart home).
// Mặc định GPIO0 = nút BOOT có sẵn trên hầu hết board ESP32 DevKit (không cần đấu thêm).
#define PIN_PROV_BUTTON       0    // GPIO0 (nút BOOT)
#define PROV_BUTTON_ACTIVE_LOW 1   // 1 = nhấn kéo xuống LOW (BOOT button)

// Nâng cao (Advanced): cảm biến mức nước / tiếp điểm bơm — chỉ ĐỌC.
//   GPIO 34/35 là chân chỉ-INPUT (không pull nội), nối qua mạch chia/điện trở ngoài.
//   ⚠️ 2026-07-14: Embed đang thiết kế mạch chỉ báo mức nước MỚI dùng 3 đầu dò (M2/M3/M4,
//   transistor BC547) cho 4 mức 0-3 thay vì phao nhị phân cũ (xem docs/CONTRACT.md mục 2) —
//   CHƯA đấu nối GPIO thật cho mạch này. PIN_TANK_FLOAT dưới đây vẫn là chân phao CŨ (1 mức,
//   nhị phân), giữ tạm để code biên dịch được; khi Embed đấu xong 3 chân cho mạch mới, thay
//   khối #if ENABLE_ADVANCED_WATER bên dưới bằng cách đếm số chân HIGH trong 3 chân đó.
#define PIN_TANK_FLOAT     34   // Phao báo cạn (mạch CŨ, nhị phân). HIGH = còn nước (tuỳ mạch).
#define PIN_PUMP_SENSE     35   // Tiếp điểm bơm châm nước đang chạy (nâng cao).
#define ENABLE_ADVANCED_WATER 0 // 0 = Basic (tank=3 "đầy" cố định, pump=false cố định).
                                //   Đặt 1 khi đã đấu nối phần cứng nâng cao.

// ============================================================================
//  HẰNG SỐ THỜI GIAN / CHU KỲ.
// ============================================================================
static const uint32_t PUSH_INTERVAL_MS   = 4000;   // chu kỳ đẩy sensor/status (~4s)
static const uint32_t CONFIG_POLL_INTERVAL_MS = 10000; // chu kỳ đọc lại /config (~10s, xem lý do dưới)
static const uint32_t WIFI_RETRY_MS       = 5000;   // chu kỳ thử reconnect WiFi
static const uint32_t SENSOR_STALE_MS     = 15000;  // quá lâu không có gói ESP-NOW -> coi cảm biến mất
static const uint32_t NTP_RETRY_MS        = 20000;  // chưa sync NTP thì cứ ~20s thử configTime() lại

// ============================================================================
//  ĐỐI TƯỢNG FIREBASE.
//
//  CHỈ 1 FirebaseData (KHÔNG dùng fbStream riêng cho /config nữa — xem pollConfig()):
//  mỗi kết nối TLS (mbedTLS) tốn ~40-50KB RAM; giữ 2 kết nối đồng thời (1 stream lắng
//  nghe /config liên tục + 1 để ghi /sensor,/status) là nguyên nhân chính gây cạn/tràn
//  heap trên ESP32 khi chạy Firebase lâu dài. Đổi /config từ STREAM sang POLL định kỳ
//  (đọc lại mỗi ~10s bằng CHÍNH fbdo đang dùng để ghi) giúp CHỈ CÒN 1 kết nối TLS tại
//  1 thời điểm -> giảm ~nửa RAM cho phần Firebase. Đánh đổi: hset/deadband cập nhật
//  trễ tối đa ~10s thay vì tức thời — chấp nhận được vì đây không phải giá trị cần
//  phản ứng real-time (admin chỉnh ngưỡng độ ẩm, không phải lệnh khẩn cấp).
// ============================================================================
FirebaseData   fbdo;        // dùng chung cho ghi /sensor,/status VÀ đọc /config
FirebaseAuth   auth;
FirebaseConfig config;

// ============================================================================
//  TRẠNG THÁI TOÀN CỤC (chia sẻ giữa loop và các callback).
// ============================================================================
ProvConfig g_cfg;                 // cấu hình nạp từ Preferences

// --- Tham số điều khiển (khởi tạo từ provisioning, cập nhật live qua stream /config) ---
volatile float g_hset     = 70.0f;   // ngưỡng độ ẩm đặt (%RH)
volatile float g_deadband = 5.0f;    // vùng chết (±)

// --- Dữ liệu cảm biến mới nhất nhận từ ESP2 (ghi trong recv callback) ---
volatile float    g_latestTemp = NAN;   // °C
volatile float    g_latestHumi = NAN;   // %RH
volatile uint32_t g_latestSeq  = 0;     // seq gói gần nhất
volatile bool     g_hasNewData = false; // cờ có dữ liệu mới chưa xử lý
volatile uint32_t g_lastRecvMs = 0;     // millis() lúc nhận gói gần nhất

// --- Trạng thái relay/điều khiển ---
bool g_mist = false;              // máy phun đang bật? (status/mist)
bool g_sensorStale = false;       // true khi mất gói ESP2 quá lâu -> NGỪNG đẩy /sensor

// --- Mốc thời gian quản lý chu kỳ ---
uint32_t g_lastPushMs      = 0;
uint32_t g_lastWifiTryMs   = 0;
uint32_t g_lastNtpTryMs    = 0;   // mốc lần thử configTime() gần nhất khi chưa sync (xem loop())

// --- Cờ Firebase đã khởi tạo ---
bool g_fbInited      = false;
uint32_t g_lastConfigPollMs = 0;  // mốc lần đọc /config gần nhất (xem pollConfig())

// ============================================================================
//  TIỆN ÍCH.
// ============================================================================

// Áp mức điện cho relay theo cấu hình RELAY_ACTIVE_HIGH.
//   on=true  -> bật phun sương; on=false -> tắt.
void applyRelay(bool on) {
#if RELAY_ACTIVE_HIGH
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
#else
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);
#endif
}

// Lấy epoch giây hiện tại nếu đã đồng bộ NTP, ngược lại 0 (CONTRACT mục 2 cho phép 0).
uint32_t nowEpoch() {
  time_t t = time(nullptr);
  // Trước khi NTP đồng bộ, time() trả giá trị rất nhỏ (gần 1970) -> coi như chưa có.
  if (t < 1700000000) return 0;   // ~2023-11 trở đi mới coi là hợp lệ
  return (uint32_t)t;
}

// Đọc cấu hình theo chiến lược NVS-first, hardcode-fallback: lấy giá trị đã
// provisioning (nếu có), field nào trống thì điền bằng hằng số HC_* ở đầu file.
ProvConfig loadConfigWithFallback() {
  ProvConfig cfg = Provisioning::isProvisioned() ? Provisioning::load() : ProvConfig();
  if (cfg.ssid.length()     == 0) cfg.ssid     = HC_WIFI_SSID;
  if (cfg.pass.length()     == 0) cfg.pass     = HC_WIFI_PASS;
  if (cfg.devEmail.length() == 0) cfg.devEmail = HC_DEV_EMAIL;
  if (cfg.devPass.length()  == 0) cfg.devPass  = HC_DEV_PASS;
  if (cfg.peerMac.length()  == 0) cfg.peerMac  = HC_PEER_MAC;
  // hset/deadband: ProvConfig/load() đã mặc định 70/5, nhưng ép lại HC_* cho rõ ý.
  if (!Provisioning::isProvisioned()) { cfg.hset = HC_HSET; cfg.deadband = HC_DEADBAND; }
  return cfg;
}

// true nếu người dùng GIỮ nút provisioning lúc khởi động -> muốn cấu hình lại.
bool provisioningRequested() {
  pinMode(PIN_PROV_BUTTON, PROV_BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
  delay(30);  // ổn định mức logic
  bool pressed = (digitalRead(PIN_PROV_BUTTON) == (PROV_BUTTON_ACTIVE_LOW ? LOW : HIGH));
  return pressed;
}

// Chuyển chuỗi MAC "11:22:33:44:55:66" -> 6 byte. Trả false nếu sai định dạng.
bool parseMac(const String& macStr, uint8_t out[6]) {
  if (macStr.length() < 17) return false;       // "xx:xx:xx:xx:xx:xx"
  int values[6];
  int n = sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x",
                 &values[0], &values[1], &values[2],
                 &values[3], &values[4], &values[5]);
  if (n != 6) return false;
  for (int i = 0; i < 6; i++) out[i] = (uint8_t)values[i];
  return true;
}

// ============================================================================
//  ESP-NOW — nhận SensorPacket từ ESP2.
//
//  KÊNH ESP-NOW (CONTRACT mục 4) — chiến lược đồng bộ kênh tự động:
//    ESP-NOW chạy trên KÊNH của giao diện WiFi. ESP1 là STA nối router nên BẮT BUỘC
//    ở đúng kênh của router => ESP1 KHÔNG tự ép kênh. ESP2 (không nối WiFi) sẽ QUÉT
//    tìm SSID router (đã provisioning) để biết kênh router rồi phát ESP-NOW trùng
//    kênh đó. Nhờ vậy 2 board luôn cùng kênh dù router ở kênh BẤT KỲ — không còn phụ
//    thuộc kênh cố định. (Xem firmware/src/esp2_sensor/main.cpp::discoverRouterChannel.)
// ============================================================================

// Chữ ký callback recv khác nhau giữa các phiên bản ESP32 Arduino core:
//   - Core <= 2.x : void cb(const uint8_t* mac, const uint8_t* data, int len)
//   - Core >= 3.x : void cb(const esp_now_recv_info_t* info, const uint8_t* data, int len)
// Dùng macro để biên dịch đúng theo phiên bản đang có.
#if defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
  #define ESPNOW_RECV_SIGNATURE const esp_now_recv_info_t *info, const uint8_t *data, int len
#else
  #define ESPNOW_RECV_SIGNATURE const uint8_t *mac, const uint8_t *data, int len
#endif

void onEspNowRecv(ESPNOW_RECV_SIGNATURE) {
  // Chỉ chấp nhận gói đúng kích thước và đúng loại bản tin.
  if (len != (int)sizeof(SensorPacket)) return;

  SensorPacket pkt;
  memcpy(&pkt, data, sizeof(SensorPacket));
  if (pkt.msgType != MSG_SENSOR_DATA) return;

  // Lưu dữ liệu mới nhất + dựng cờ để loop() xử lý Deadband + đẩy Firebase.
  g_latestTemp = pkt.temperature;
  g_latestHumi = pkt.humidity;
  g_latestSeq  = pkt.seq;
  g_lastRecvMs = millis();
  g_hasNewData = true;
  g_sensorStale = false;   // có gói mới -> dữ liệu cảm biến lại hợp lệ

  // Log gọn (tránh in trong ngắt quá dài; ESP-NOW recv chạy ở task riêng nên OK).
  Serial.printf("[ESP-NOW] seq=%lu  T=%.1f C  H=%.1f %%RH\n",
                (unsigned long)pkt.seq, pkt.temperature, pkt.humidity);
}

// Khởi tạo ESP-NOW: init, ép kênh, đăng ký recv callback, add peer ESP2 (nếu có MAC).
void setupEspNow() {
  // KHÔNG ép kênh ở ESP1: ESP1 là STA đã nối router nên phải giữ đúng kênh router.
  // ESP-NOW chạy ngay trên kênh STA này; ESP2 sẽ tự dò để phát trùng kênh.
  Serial.printf("[ESP-NOW] Dung kenh STA hien tai = %d (theo router)\n", WiFi.channel());

  if (esp_now_init() != ESP_OK) {
    Serial.println(F("[ESP-NOW] init THAT BAI!"));
    return;
  }

  // Đăng ký callback nhận.
  esp_now_register_recv_cb(onEspNowRecv);

  // Add peer ESP2 (MAC nạp lúc provisioning -> cfg.peerMac). Nếu để trống thì
  // vẫn nhận được gói broadcast/unicast nhờ recv callback, nhưng add peer giúp
  // ổn định và là tiền đề cho gửi ACK 2 chiều sau này.
  uint8_t peer[6];
  if (parseMac(g_cfg.peerMac, peer)) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, peer, 6);
    peerInfo.channel = 0;                // 0 = dùng kênh hiện tại của STA (kênh router)
    peerInfo.encrypt = false;
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
      Serial.printf("[ESP-NOW] Da add peer ESP2: %s (kenh %d)\n",
                    g_cfg.peerMac.c_str(), WiFi.channel());
    } else {
      Serial.println(F("[ESP-NOW] add peer that bai (van nhan duoc goi)."));
    }
  } else {
    Serial.println(F("[ESP-NOW] Chua co peerMac hop le -> chi lang nghe."));
  }

  Serial.printf("[ESP-NOW] San sang, MAC ESP1 (STA) = %s, kenh = %d\n",
                WiFi.macAddress().c_str(), WiFi.channel());
}

// ============================================================================
//  POLL /config — admin web chỉnh hset/deadband, ESP1 đọc lại định kỳ (~10s).
//  (Đổi từ stream sang poll để chỉ dùng 1 kết nối TLS — xem giải thích ở khai báo
//  FirebaseData phía trên, phần chống tràn RAM.)
// ============================================================================
void pollConfig() {
  if (!Firebase.RTDB.getJSON(&fbdo, "/config")) {
    Serial.printf("[CONFIG] Doc /config loi: %s\n", fbdo.errorReason().c_str());
    return;
  }

  // fbdo.to<FirebaseJson*>() — CÙNG API mà lib dùng cho FirebaseStream trước đây
  // (data.to<FirebaseJson*>()), xác nhận qua addons/RTDBHelper.h của thư viện mobizt.
  FirebaseJson* json = fbdo.to<FirebaseJson*>();
  FirebaseJsonData res;
  if (json->get(res, "hset"))     g_hset     = res.to<float>();
  if (json->get(res, "deadband")) g_deadband = res.to<float>();

  Serial.printf("[CONFIG] Da doc: hset=%.1f  deadband=%.1f\n", (float)g_hset, (float)g_deadband);
}

// ============================================================================
//  FIREBASE — khởi tạo (đăng nhập tài khoản thiết bị + cấu hình buffer).
// ============================================================================
void setupFirebase() {
  Serial.print(F("[FB] Firebase Client v"));
  Serial.println(FIREBASE_CLIENT_VERSION);

  // Cấu hình API key + database URL.
  config.api_key      = FB_API_KEY;
  config.database_url = FB_DATABASE_URL;

  // Đăng nhập bằng TÀI KHOẢN THIẾT BỊ (email/password) nạp lúc provisioning.
  //   UID tài khoản này phải được seed vào /devices/<UID>=true để qua security rules.
  auth.user.email    = g_cfg.devEmail.c_str();
  auth.user.password = g_cfg.devPass.c_str();

  // Callback theo dõi trạng thái token (in chi tiết để dễ debug đăng nhập).
  config.token_status_callback = tokenStatusCallback;  // từ addons/TokenHelper.h

  // Tự thử lại khi token lỗi.
  config.max_token_generation_retry = 5;

  // Cho phép tự reconnect WiFi do thư viện quản lý (kèm reconnect của ta trong loop).
  Firebase.reconnectWiFi(true);

  // Bắt đầu Firebase.
  Firebase.begin(&config, &auth);

  // Buffer/timeout cho fbdo (giá trị an toàn cho ESP32).
  fbdo.setBSSLBufferSize(2048, 512);
  fbdo.setResponseSize(2048);

  g_fbInited = true;
  Serial.println(F("[FB] Da khoi tao Firebase (dang lay token...)."));
}

// ============================================================================
//  WIFI — kết nối + reconnect đơn giản.
// ============================================================================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(g_cfg.ssid.c_str(), g_cfg.pass.c_str());
  Serial.printf("[WiFi] Dang ket noi toi \"%s\" ...\n", g_cfg.ssid.c_str());

  // Chờ tối đa ~15s ở setup; nếu chưa được, loop() sẽ tiếp tục thử lại.
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Da ket noi. IP=%s, kenh STA=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel());
    // Cấu hình NTP để có timestamp epoch (GMT+7 = 25200s; chỉ ảnh hưởng hiển thị
    // local, ta vẫn lưu epoch UTC qua time()).
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  } else {
    Serial.println(F("[WiFi] Chua ket noi duoc — se thu lai trong loop()."));
  }
}

// ============================================================================
//  THUẬT TOÁN DEADBAND (CONTRACT mục 2).
//  Máy phun sương LÀM TĂNG độ ẩm:
//    humidity < hset - deadband  -> BẬT  (mist=true)
//    humidity > hset + deadband  -> TẮT  (mist=false)
//    nằm giữa                     -> giữ nguyên (chống nhảy relay)
// ============================================================================
void runDeadband(float humidity) {
  if (isnan(humidity)) return;   // chưa có dữ liệu hợp lệ

  // Dùng hàm thuần deadbandDecide() (control.h) — cùng logic đã được unit-test.
  bool newMist = deadbandDecide(humidity, (float)g_hset, (float)g_deadband, g_mist);
  if (newMist != g_mist) {
    g_mist = newMist;
    applyRelay(newMist);
    Serial.printf("[DEADBAND] H=%.1f hset=%.1f db=%.1f -> %s phun suong\n",
                  humidity, (float)g_hset, (float)g_deadband, newMist ? "BAT" : "TAT");
  }
  // Trong vùng chết -> newMist == g_mist -> không đổi, không log.
}

// ============================================================================
//  ĐẨY DỮ LIỆU LÊN FIREBASE (/sensor + /status).
// ============================================================================
void pushToFirebase() {
  uint32_t ts = nowEpoch();

  // ---- /sensor (GỘP: 1 request thay vì 3) ----
  // Chỉ đẩy khi có dữ liệu hợp lệ VÀ không bị stale. Khi stale (mất gói ESP2 quá lâu)
  // ta NGỪNG ghi /sensor để timestamp không tăng giả -> web thấy số đo "đứng" đúng thực tế.
  // Dùng setJSON: ghi cả node /sensor trong MỘT lần (1 kết nối TLS thay vì 3) -> nhẹ tải,
  // ít bắt tay TLS -> đỡ tốn CPU/sóng/nhiệt cho ESP.
  if (!g_sensorStale && !isnan(g_latestTemp) && !isnan(g_latestHumi)) {
    FirebaseJson jsSensor;
    jsSensor.set("temperature", g_latestTemp);
    jsSensor.set("humidity",    g_latestHumi);
    jsSensor.set("timestamp",   (int)ts);
    if (!Firebase.RTDB.setJSON(&fbdo, "/sensor", &jsSensor)) {
      Serial.printf("[FB] Ghi /sensor loi: %s\n", fbdo.errorReason().c_str());
    }
  }

  // ---- Trạng thái nước (nâng cao) ----
  // tank: SỐ 0-3 (CONTRACT mục 2) — 0=rất thấp/cạn, 1=thấp, 2=bình thường, 3=đầy.
  // Ứng với mạch 3 đầu dò M2/M3/M4 MỚI (xem ghi chú ở PIN_TANK_FLOAT phía trên): giá trị
  // lý tưởng = số đầu dò đang ngập nước. Basic (chưa đấu cảm biến): mặc định đầy (3).
  int  tank = 3;          // Basic: mặc định đầy nước
  bool pump = false;      // Basic: mặc định bơm không chạy
#if ENABLE_ADVANCED_WATER
  // TODO: mạch MỚI dùng 3 đầu dò cho 4 mức — hiện đoạn dưới vẫn đọc phao NHỊ PHÂN CŨ
  // (1 chân) làm tạm, quy ước HIGH=còn nước -> 3 (đầy), LOW=cạn -> 0 (rất thấp). Khi Embed
  // đấu xong 3 chân của mạch mới, thay bằng: tank = digitalRead(pinM2)+digitalRead(pinM3)+digitalRead(pinM4).
  tank = (digitalRead(PIN_TANK_FLOAT) == HIGH) ? 3 : 0;
  // Tiếp điểm bơm: HIGH -> bơm đang chạy.
  pump = (digitalRead(PIN_PUMP_SENSE) == HIGH);
#endif

  // ---- /status (GỘP: 1 request thay vì 6) ----
  FirebaseJson jsStatus;
  jsStatus.set("mist",       g_mist);
  jsStatus.set("tank",       tank);
  jsStatus.set("pump",       pump);
  jsStatus.set("esp1Online", true);
  jsStatus.set("gateway",    "esp1");
  jsStatus.set("lastSeen",   (int)ts);
  if (!Firebase.RTDB.setJSON(&fbdo, "/status", &jsStatus)) {
    Serial.printf("[FB] Ghi /status loi: %s\n", fbdo.errorReason().c_str());
  } else {
    // Kèm RAM còn trống để chẩn đoán: heap tụt dần/gần 0 -> cạn/vỡ heap (không phải tràn stack).
    Serial.printf("[FB] Da day (2 request): T=%.1f H=%.1f mist=%d tank=%d pump=%d ts=%lu | freeHeap=%u\n",
                  g_latestTemp, g_latestHumi, g_mist, tank, pump,
                  (unsigned long)ts, (unsigned)ESP.getFreeHeap());
  }
}

// ============================================================================
//  SETUP.
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("=== ESP1 MAIN NODE — Smart Humidity IoT ==="));
  Serial.print  (F("Firmware version: ")); Serial.println(FW_VERSION);

  // --- GIỮ nút BOOT lúc khởi động -> vào chế độ provisioning (SoftAP) rồi DỪNG setup.
  //     (Giống "bấm reset mạng" của thiết bị smart home: phát AP để app cấu hình lại.) ---
  if (provisioningRequested()) {
    Serial.println(F("[BOOT] Giu nut BOOT -> bat SoftAP provisioning."));
    Provisioning::beginAP("main");   // role "main" (CONTRACT mục 1)
    return;                          // loop() se goi Provisioning::handle()
  }

  // --- Nạp cấu hình: NVS-first, hardcode-fallback (chạy được ngay cả khi chưa provisioning) ---
  g_cfg = loadConfigWithFallback();
  g_hset     = (float)g_cfg.hset;       // khởi tạo tham số điều khiển
  g_deadband = (float)g_cfg.deadband;
  Serial.printf("[BOOT] Cau hinh (%s). SSID=%s, devEmail=%s, peerMac=%s, hset=%d, deadband=%d\n",
                Provisioning::isProvisioned() ? "NVS/app" : "hardcode fallback",
                g_cfg.ssid.c_str(), g_cfg.devEmail.c_str(), g_cfg.peerMac.c_str(),
                g_cfg.hset, g_cfg.deadband);

  // --- Cấu hình chân relay: OUTPUT, mặc định TẮT (an toàn) ---
  pinMode(PIN_RELAY, OUTPUT);
  g_mist = false;
  applyRelay(false);                 // bảo đảm relay TẮT khi khởi động

#if ENABLE_ADVANCED_WATER
  // Chân nâng cao chỉ-INPUT (GPIO 34/35 không có pull nội).
  pinMode(PIN_TANK_FLOAT, INPUT);
  pinMode(PIN_PUMP_SENSE, INPUT);
#endif

  // --- WiFi STA + kết nối router ---
  connectWiFi();

  // --- ESP-NOW (sau khi WiFi.mode(STA) đã set trong connectWiFi) ---
  setupEspNow();

  // --- Firebase (api_key/database_url hằng + email/pass từ provisioning) ---
  setupFirebase();

  Serial.println(F("[BOOT] Setup hoan tat -> vao loop()."));
}

// ============================================================================
//  LOOP.
// ============================================================================
void loop() {
  // --- Chế độ provisioning: chỉ phục vụ HTTP rồi thoát ---
  if (Provisioning::inAPMode()) {
    Provisioning::handle();          // tự ESP.restart() ~1s sau khi /provision OK
    return;
  }

  uint32_t now = millis();

  // --- Reconnect WiFi đơn giản nếu rớt ---
  if (WiFi.status() != WL_CONNECTED) {
    if (now - g_lastWifiTryMs >= WIFI_RETRY_MS) {
      g_lastWifiTryMs = now;
      Serial.println(F("[WiFi] Mat ket noi -> thu reconnect..."));
      WiFi.disconnect();
      WiFi.begin(g_cfg.ssid.c_str(), g_cfg.pass.c_str());
    }
    // Vẫn tiếp tục chạy Deadband bên dưới (điều khiển relay không phụ thuộc mạng).
  }

  // --- SNTP: configTime() ở connectWiFi() chỉ bắn 1 lần lúc boot, không tự retry.
  // Nếu gói NTP đầu tiên bị rớt/mạng chập chờn đúng lúc đó, nowEpoch() sẽ trả 0 vĩnh
  // viễn cả phiên chạy -> /sensor & /status luôn ghi timestamp/lastSeen = 0, khiến
  // web tưởng thiết bị offline dù vẫn đang đẩy dữ liệu bình thường. Nên cứ mỗi
  // NTP_RETRY_MS mà vẫn chưa sync được thì gọi lại configTime() tới khi thành công.
  if (WiFi.status() == WL_CONNECTED && nowEpoch() == 0) {
    if (now - g_lastNtpTryMs >= NTP_RETRY_MS) {
      g_lastNtpTryMs = now;
      Serial.println(F("[NTP] Chua dong bo -> thu configTime() lai..."));
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    }
  }

  // --- Xử lý dữ liệu cảm biến mới -> chạy Deadband ngay khi có gói ---
  if (g_hasNewData) {
    g_hasNewData = false;
    runDeadband(g_latestHumi);
  }

  // --- An toàn: nếu lâu không có gói cảm biến -> giữ relay TẮT (tránh phun mù) ---
  if (g_lastRecvMs != 0 && (now - g_lastRecvMs > SENSOR_STALE_MS)) {
    if (!g_sensorStale) {
      g_sensorStale = true;
      Serial.println(F("[SAFETY] Mat du lieu cam bien qua lau -> NGUNG day /sensor + TAT phun."));
    }
    if (g_mist) { g_mist = false; applyRelay(false); }
  }

  // --- Khi Firebase sẵn sàng: đọc lại /config định kỳ + đẩy dữ liệu định kỳ ---
  if (g_fbInited && Firebase.ready()) {
    // Đọc lại /config mỗi ~10s (poll, không phải stream — xem lý do ở khai báo fbdo).
    if (now - g_lastConfigPollMs >= CONFIG_POLL_INTERVAL_MS) {
      g_lastConfigPollMs = now;
      pollConfig();
    }

    // Đẩy /sensor + /status mỗi ~4s.
    if (now - g_lastPushMs >= PUSH_INTERVAL_MS) {
      g_lastPushMs = now;
      pushToFirebase();
    }
  }
}
