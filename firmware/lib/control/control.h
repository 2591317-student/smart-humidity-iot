#pragma once
// ============================================================================
//  control.h — Thuật toán điều khiển Deadband (THUẦN, không phụ thuộc Arduino).
//  Tách riêng để: (1) ESP1 dùng, (2) unit-test chạy trên PC (pio test -e native).
//  Xem docs/CONTRACT.md mục 2.
//
//  Máy phun sương LÀM TĂNG độ ẩm:
//    humidity < hset - deadband  -> BẬT  (true)
//    humidity > hset + deadband  -> TẮT  (false)
//    ở giữa (vùng chết)           -> GIỮ NGUYÊN trạng thái hiện tại (hysteresis)
//  Trả về trạng thái mist MỚI dựa trên trạng thái hiện tại.
//  Lưu ý: nếu humidity là NaN, mọi so sánh đều false -> trả currentMist (an toàn).
// ============================================================================

inline bool deadbandDecide(float humidity, float hset, float deadband, bool currentMist) {
  const float lower = hset - deadband;  // ngưỡng BẬT
  const float upper = hset + deadband;  // ngưỡng TẮT
  if (humidity < lower) return true;    // quá khô -> bật phun
  if (humidity > upper) return false;   // đủ ẩm -> tắt phun
  return currentMist;                   // trong vùng chết -> giữ nguyên
}
