#pragma once
#include <stdint.h>

// ============================================================================
//  Giao thức ESP-NOW dùng CHUNG giữa ESP1 (main) và ESP2 (sensor).
//  Struct phải giống hệt 2 bên, packed, <= 250 bytes.  Xem docs/CONTRACT.md mục 4.
// ============================================================================

#define FW_VERSION "1.0.0"

// Loại bản tin ESP-NOW
enum EspNowMsgType : uint8_t {
  MSG_SENSOR_DATA = 1
};

// Gói dữ liệu cảm biến ESP2 -> ESP1
typedef struct __attribute__((packed)) {
  uint8_t  msgType;      // = MSG_SENSOR_DATA
  float    temperature;  // °C
  float    humidity;     // %RH
  uint32_t seq;          // số thứ tự gói (tăng dần)
  uint8_t  fromGateway;  // 0 = bình thường, 1 = ESP2 đang ở chế độ gateway dự phòng
} SensorPacket;          // 14 bytes

// Kênh ESP-NOW DỰ PHÒNG: chỉ dùng khi ESP2 không quét thấy SSID router để tự dò kênh.
// Thực tế ESP1 dùng kênh STA của router; ESP2 tự dò trùng kênh (xem esp2_sensor.cpp).
#define ESPNOW_CHANNEL 1
