// ============================================================================
//  Unit test cho thuật toán Deadband (firmware/lib/control/control.h).
//  Chạy trên PC, KHÔNG cần ESP32:   pio test -e native
//  (yêu cầu có trình biên dịch host: gcc/g++ hoặc clang.)
// ============================================================================
#include <unity.h>
#include <math.h>
#include "control.h"

void setUp(void) {}
void tearDown(void) {}

// Dưới ngưỡng BẬT (hset - deadband) -> phải BẬT.
void test_below_lower_turns_on(void) {
  TEST_ASSERT_TRUE(deadbandDecide(60.0f, 70.0f, 5.0f, false)); // 60 < 65
}

// Trên ngưỡng TẮT (hset + deadband) -> phải TẮT.
void test_above_upper_turns_off(void) {
  TEST_ASSERT_FALSE(deadbandDecide(80.0f, 70.0f, 5.0f, true)); // 80 > 75
}

// Trong vùng chết -> GIỮ NGUYÊN trạng thái (cả khi đang bật và đang tắt).
void test_within_deadband_keeps_state(void) {
  TEST_ASSERT_TRUE(deadbandDecide(70.0f, 70.0f, 5.0f, true));   // giữ bật
  TEST_ASSERT_FALSE(deadbandDecide(70.0f, 70.0f, 5.0f, false)); // giữ tắt
}

// Biên: đúng tại lower/upper KHÔNG thoả "<" hay ">" -> vẫn là vùng chết -> giữ nguyên.
void test_boundaries_keep_state(void) {
  TEST_ASSERT_FALSE(deadbandDecide(65.0f, 70.0f, 5.0f, false)); // == lower -> giữ tắt
  TEST_ASSERT_TRUE(deadbandDecide(75.0f, 70.0f, 5.0f, true));   // == upper -> giữ bật
}

// Hysteresis: cùng độ ẩm trong vùng chết cho 2 kết quả khác nhau tuỳ trạng thái trước.
void test_hysteresis(void) {
  TEST_ASSERT_TRUE(deadbandDecide(72.0f, 70.0f, 5.0f, true));
  TEST_ASSERT_FALSE(deadbandDecide(72.0f, 70.0f, 5.0f, false));
}

// NaN (lỗi đọc cảm biến) -> giữ nguyên trạng thái (an toàn, không nhảy relay).
void test_nan_keeps_state(void) {
  TEST_ASSERT_TRUE(deadbandDecide(NAN, 70.0f, 5.0f, true));
  TEST_ASSERT_FALSE(deadbandDecide(NAN, 70.0f, 5.0f, false));
}

int main(int argc, char** argv) {
  (void)argc; (void)argv;
  UNITY_BEGIN();
  RUN_TEST(test_below_lower_turns_on);
  RUN_TEST(test_above_upper_turns_off);
  RUN_TEST(test_within_deadband_keeps_state);
  RUN_TEST(test_boundaries_keep_state);
  RUN_TEST(test_hysteresis);
  RUN_TEST(test_nan_keeps_state);
  return UNITY_END();
}
