// ============================================================================
//  Cài đặt thư viện PROVISIONING dùng chung cho ESP1/ESP2.
//  Xem provisioning.h và docs/CONTRACT.md (mục 5, 6, 7).
// ============================================================================
#include "provisioning.h"

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>   // bblanchon ArduinoJson v7

#include "protocol.h"      // FW_VERSION

// ----------------------------------------------------------------------------
//  Hằng số & trạng thái nội bộ (đặt trong anonymous namespace để giấu khỏi ngoài).
// ----------------------------------------------------------------------------
namespace {

const char* PREF_NS = "prov";          // namespace Preferences (CONTRACT mục 7)
const IPAddress AP_IP(192, 168, 4, 1); // IP cố định của SoftAP
const IPAddress AP_GW(192, 168, 4, 1);
const IPAddress AP_MASK(255, 255, 255, 0);

WebServer  server(80);     // HTTP server cổng 80
Preferences prefs;         // truy cập NVS

bool   g_apMode    = false;    // đang ở chế độ SoftAP provisioning?
bool   g_rebootReq = false;    // có yêu cầu reboot sau /provision không?
uint32_t g_rebootAt = 0;       // mốc millis() sẽ ESP.restart()

String g_role;             // "main" | "sensor"
String g_mac;              // MAC đầy đủ "A1:B2:C3:D4:E5:F6"
String g_mac6;            // 6 hex cuối, viết hoa "A1B2C3"
String g_id;               // định danh thiết bị "MAIN-A1B2C3"
String g_apSsid;           // SSID SoftAP "PROV-MAIN-A1B2C3"

// ---- Tiện ích chuỗi -------------------------------------------------------

// Đổi role -> chuỗi viết hoa ("main" -> "MAIN").
String roleUpper(const String& role) {
  String s = role;
  s.toUpperCase();
  return s;
}

// Lấy 6 hex cuối của MAC (bỏ dấu ':') viết hoa, vd "A1:B2:C3:D4:E5:F6" -> "D4E5F6".
String macTail6(const String& mac) {
  String hex = "";
  for (size_t i = 0; i < mac.length(); i++) {
    char c = mac[i];
    if (c != ':') hex += c;
  }
  hex.toUpperCase();
  if (hex.length() >= 6) return hex.substring(hex.length() - 6);
  return hex;
}

// Gắn header CORS cho MỌI response (CONTRACT mục 5) để PWA gọi được từ trình duyệt.
void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---- Các handler HTTP ------------------------------------------------------

// Xử lý preflight OPTIONS cho mọi route: chỉ trả CORS header + 204.
void handleOptions() {
  addCorsHeaders();
  server.send(204);  // No Content
}

// GET /info -> JSON định danh thiết bị (CONTRACT mục 5).
void handleInfo() {
  JsonDocument doc;
  doc["id"]          = g_id;
  doc["role"]        = g_role;
  doc["mac"]         = g_mac;
  doc["fw"]          = FW_VERSION;
  doc["provisioned"] = Provisioning::isProvisioned();

  String out;
  serializeJson(doc, out);
  addCorsHeaders();
  server.send(200, "application/json", out);
}

// POST /provision -> parse JSON body, lưu Preferences, hẹn reboot sau ~1s.
void handleProvision() {
  addCorsHeaders();

  // Body bắt buộc là JSON.
  if (!server.hasArg("plain")) {
    server.send(400, "application/json",
                "{\"ok\":false,\"message\":\"Thieu JSON body\"}");
    return;
  }

  JsonDocument req;
  DeserializationError err = deserializeJson(req, server.arg("plain"));
  if (err) {
    server.send(400, "application/json",
                "{\"ok\":false,\"message\":\"JSON khong hop le\"}");
    return;
  }

  // PARTIAL UPDATE (CONTRACT mục 5): chỉ ghi field CÓ trong JSON — khớp cơ chế
  // "tick mới gửi" trên app. Field vắng mặt giữ nguyên giá trị đã lưu, KHÔNG bị xoá.
  bool wrote = false;
  prefs.begin(PREF_NS, false);  // read-write

  // --- WiFi (ssid + password đi cùng nhau) ---
  if (!req["ssid"].isNull()) {
    String ssid = req["ssid"].as<String>();
    if (ssid.length() == 0) {
      prefs.end();
      server.send(400, "application/json",
                  "{\"ok\":false,\"message\":\"ssid rong\"}");
      return;
    }
    prefs.putString("ssid", ssid);
    prefs.putString("pass", req["password"] | "");  // mặc định rỗng (mạng mở)
    wrote = true;
  }

  // --- MAC ESP còn lại: chấp nhận cả "peerMac" lẫn "mac_gateway" ---
  if (!req["peerMac"].isNull() || !req["mac_gateway"].isNull()) {
    String mac = !req["peerMac"].isNull() ? req["peerMac"].as<String>()
                                          : req["mac_gateway"].as<String>();
    prefs.putString("peerMac", mac);
    wrote = true;
  }

  // --- (tương thích ngược) các field cũ nếu client vẫn gửi kèm ---
  if (!req["deviceEmail"].isNull())    { prefs.putString("devEmail", req["deviceEmail"].as<String>()); wrote = true; }
  if (!req["devicePassword"].isNull()) { prefs.putString("devPass",  req["devicePassword"].as<String>()); wrote = true; }
  if (!req["hset"].isNull())     { prefs.putInt("hset",     req["hset"]     | 70); wrote = true; }
  if (!req["deadband"].isNull()) { prefs.putInt("deadband", req["deadband"] | 5);  wrote = true; }

  if (!wrote) {
    prefs.end();
    server.send(400, "application/json",
                "{\"ok\":false,\"message\":\"Khong co truong nao de luu\"}");
    return;
  }

  prefs.putBool("provisioned", true);  // đã có cấu hình hợp lệ
  prefs.end();

  // Trả phản hồi thành công (CONTRACT mục 5).
  JsonDocument res;
  res["ok"]      = true;
  res["message"] = "Saved. Rebooting.";
  res["mac"]     = g_mac;

  String out;
  serializeJson(res, out);
  server.send(200, "application/json", out);

  // Đặt cờ để loop() (Provisioning::handle) tự reboot sau ~1s, nhằm kịp gửi xong response.
  g_rebootReq = true;
  g_rebootAt  = millis() + 1000;
}

// POST /reset -> xoá Preferences (quay về chưa cấu hình) để demo lại.
void handleReset() {
  Provisioning::clear();
  addCorsHeaders();
  server.send(200, "application/json",
              "{\"ok\":true,\"message\":\"Da xoa cau hinh\"}");
}

// GET / -> trang HTML form provisioning tối giản (same-origin fallback luôn chạy được).
void handleRoot() {
  // Form POST same-origin tới /provision bằng fetch JSON. UI tiếng Việt.
  String html;
  html.reserve(3200);
  html += F(
    "<!DOCTYPE html><html lang=\"vi\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>Cau hinh thiet bi</title>"
    "<style>"
    "body{font-family:system-ui,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}"
    ".wrap{max-width:420px;margin:0 auto;padding:20px}"
    "h1{font-size:20px;margin:8px 0 4px}.sub{color:#94a3b8;font-size:13px;margin:0 0 16px}"
    "label{display:block;font-size:13px;margin:12px 0 4px;color:#cbd5e1}"
    "input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #334155;"
    "background:#1e293b;color:#e2e8f0;font-size:14px}"
    "button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#2563eb;"
    "color:#fff;font-size:15px;font-weight:600;cursor:pointer}"
    "button:disabled{opacity:.6;cursor:not-allowed}"
    ".row{display:flex;gap:10px}.row>div{flex:1}"
    "#msg{margin-top:14px;font-size:14px;min-height:20px}"
    ".ok{color:#4ade80}.err{color:#f87171}"
    "</style></head><body><div class=\"wrap\">"
    "<h1>Cau hinh Smart Humidity</h1>"
    "<p class=\"sub\">Thiet bi: ");
  html += g_id;
  html += F(" &middot; vai tro: ");
  html += g_role;
  html += F("</p>"
    "<form id=\"f\">"
    "<label>WiFi SSID *</label><input id=\"ssid\" required placeholder=\"Ten WiFi nha\">"
    "<label>WiFi Password</label><input id=\"password\" type=\"password\" placeholder=\"Mat khau WiFi\">"
    "<label>MAC ESP con lai (peerMac)</label><input id=\"peerMac\" placeholder=\"11:22:33:44:55:66\">"
    "<button id=\"btn\" type=\"submit\">Luu &amp; khoi dong lai</button>"
    "</form><div id=\"msg\"></div></div>"
    "<script>"
    "const f=document.getElementById('f'),msg=document.getElementById('msg'),btn=document.getElementById('btn');"
    "f.addEventListener('submit',async(e)=>{e.preventDefault();"
    "const body={ssid:ssid.value,password:password.value,peerMac:peerMac.value};"
    "btn.disabled=true;msg.className='';msg.textContent='Dang luu...';"
    "try{const r=await fetch('/provision',{method:'POST',headers:{'Content-Type':'application/json'},"
    "body:JSON.stringify(body)});const j=await r.json();"
    "if(j.ok){msg.className='ok';msg.textContent='Da luu! Thiet bi dang khoi dong lai ('+j.mac+').';}"
    "else{msg.className='err';msg.textContent='Loi: '+(j.message||'khong xac dinh');btn.disabled=false;}"
    "}catch(err){msg.className='err';msg.textContent='Khong gui duoc: '+err;btn.disabled=false;}});"
    "</script></body></html>");

  addCorsHeaders();
  server.send(200, "text/html; charset=utf-8", html);
}

// 404 cho route không tồn tại (vẫn kèm CORS).
void handleNotFound() {
  // Trả CORS cho cả OPTIONS rơi vào đây.
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  addCorsHeaders();
  server.send(404, "application/json",
              "{\"ok\":false,\"message\":\"Not found\"}");
}

}  // namespace (anonymous)

// ----------------------------------------------------------------------------
//  Hiện thực API công khai (namespace Provisioning).
// ----------------------------------------------------------------------------
namespace Provisioning {

bool isProvisioned() {
  prefs.begin(PREF_NS, true);  // read-only
  bool ok = prefs.getBool("provisioned", false);
  prefs.end();
  return ok;
}

ProvConfig load() {
  ProvConfig cfg;
  prefs.begin(PREF_NS, true);  // read-only
  cfg.ssid     = prefs.getString("ssid", "");
  cfg.pass     = prefs.getString("pass", "");
  cfg.devEmail = prefs.getString("devEmail", "");
  cfg.devPass  = prefs.getString("devPass", "");
  cfg.peerMac  = prefs.getString("peerMac", "");
  cfg.hset     = prefs.getInt("hset", 70);
  cfg.deadband = prefs.getInt("deadband", 5);
  prefs.end();
  return cfg;
}

void clear() {
  prefs.begin(PREF_NS, false);  // read-write
  prefs.clear();                // xoá toàn bộ key trong namespace
  prefs.end();
}

void beginAP(const char* role) {
  g_role = String(role);

  // --- Tính MAC, MAC6, id, SSID AP ---
  // Dùng MAC của STA interface cho ổn định (giống MAC ESP-NOW dùng để add peer).
  g_mac  = WiFi.macAddress();          // "A1:B2:C3:D4:E5:F6"
  g_mac6 = macTail6(g_mac);            // "D4E5F6"
  String roleUp = roleUpper(g_role);   // "MAIN" / "SENSOR"
  g_id     = roleUp + "-" + g_mac6;            // "MAIN-D4E5F6"
  g_apSsid = "PROV-" + roleUp + "-" + g_mac6;  // "PROV-MAIN-D4E5F6"

  // --- Bật SoftAP, IP cố định 192.168.4.1, không mật khẩu ---
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GW, AP_MASK);
  WiFi.softAP(g_apSsid.c_str());  // không truyền pass -> AP mở

  // --- Đăng ký route HTTP ---
  server.on("/",          HTTP_GET,     handleRoot);
  server.on("/info",      HTTP_GET,     handleInfo);
  server.on("/provision", HTTP_POST,    handleProvision);
  server.on("/provision", HTTP_OPTIONS, handleOptions);  // preflight
  server.on("/reset",     HTTP_POST,    handleReset);
  server.on("/reset",     HTTP_OPTIONS, handleOptions);   // preflight
  server.on("/info",      HTTP_OPTIONS, handleOptions);   // preflight
  server.onNotFound(handleNotFound);
  server.begin();

  g_apMode    = true;
  g_rebootReq = false;

  // --- In chuỗi QR JSON 1 dòng ra Serial (CONTRACT mục 6) ---
  // {"id":...,"role":...,"ap":...,"ip":"192.168.4.1","mac":...}
  JsonDocument qr;
  qr["id"]   = g_id;
  qr["role"] = g_role;
  qr["ap"]   = g_apSsid;
  qr["ip"]   = "192.168.4.1";
  qr["mac"]  = g_mac;

  String qrLine;
  serializeJson(qr, qrLine);

  Serial.println();
  Serial.println(F("=== PROVISIONING MODE (SoftAP) ==="));
  Serial.print  (F("AP SSID : ")); Serial.println(g_apSsid);
  Serial.print  (F("AP IP   : ")); Serial.println(WiFi.softAPIP());
  Serial.println(F("QR JSON (quet bang PWA):"));
  Serial.println(qrLine);   // <- chuỗi QR 1 dòng
  Serial.println(F("=================================="));
}

void handle() {
  if (!g_apMode) return;

  // Phục vụ HTTP client.
  server.handleClient();

  // Nếu /provision đã yêu cầu reboot và đã tới hạn -> khởi động lại vào chế độ STA.
  if (g_rebootReq && (int32_t)(millis() - g_rebootAt) >= 0) {
    Serial.println(F("[prov] Da luu cau hinh, dang khoi dong lai..."));
    delay(50);          // cho Serial flush
    ESP.restart();
  }
}

bool inAPMode() {
  return g_apMode;
}

}  // namespace Provisioning
