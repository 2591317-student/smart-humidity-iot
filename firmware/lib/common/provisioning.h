#pragma once
#include <Arduino.h>

// ============================================================================
//  Thư viện PROVISIONING dùng CHUNG cho ESP1 (main) và ESP2 (sensor).
//
//  Khi boot mà chưa có cấu hình trong Preferences -> ESP bật SoftAP + HTTP
//  server (cổng 80) để PWA/trình duyệt nạp WiFi + tài khoản thiết bị + cấu hình.
//  Sau khi nạp xong -> lưu Preferences -> ESP.restart() vào chế độ chạy thật (STA).
//
//  Tham chiếu: docs/CONTRACT.md mục 5 (REST), 6 (QR), 7 (Preferences keys).
//  Phụ thuộc: WebServer.h, Preferences.h, WiFi.h (ESP32 core) + ArduinoJson v7.
// ============================================================================

// Cấu hình thiết bị đọc/ghi qua Preferences (namespace "prov", xem CONTRACT mục 7).
struct ProvConfig {
  String ssid;       // WiFi SSID
  String pass;       // WiFi password
  String devEmail;   // email tài khoản thiết bị Firebase (chủ yếu cho ESP1)
  String devPass;    // password tài khoản thiết bị Firebase
  String peerMac;    // MAC của ESP còn lại (ESP1 lưu MAC ESP2)
  int hset = 70;     // ngưỡng độ ẩm đặt (%RH) — mặc định an toàn
  int deadband = 5;  // vùng chết (± quanh hset)
};

namespace Provisioning {

// Trả về true nếu thiết bị ĐÃ được cấu hình (Preferences "prov"/"provisioned").
bool isProvisioned();

// Nạp toàn bộ cấu hình từ Preferences. Nếu chưa cấu hình thì các field rỗng/mặc định.
ProvConfig load();

// Xoá sạch Preferences namespace "prov" (dùng cho POST /reset để demo lại).
void clear();

// Bật chế độ provisioning: SoftAP + HTTP server cổng 80 + in chuỗi QR JSON ra Serial.
//   role: "main" (ESP1) hoặc "sensor" (ESP2).
void beginAP(const char* role);

// Gọi liên tục trong loop() khi đang ở chế độ AP để phục vụ HTTP client.
// Đồng thời tự động ESP.restart() ~1s sau khi /provision lưu thành công.
void handle();

// Trả về true nếu đang chạy SoftAP provisioning (sau khi beginAP() đã được gọi).
bool inAPMode();

}  // namespace Provisioning
