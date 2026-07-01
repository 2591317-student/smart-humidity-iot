/**
 * data-injector — Bơm dữ liệu cảm biến GIẢ lên Firebase Realtime Database.
 *
 * Mục đích: test web dashboard + biểu đồ realtime (Chart.js) mà KHÔNG cần phần cứng ESP.
 * Tool đóng vai trò "ESP1" giả: đăng nhập bằng tài khoản thiết bị, rồi cứ ~3s ghi:
 *   - /sensor : { temperature, humidity, timestamp }
 *   - /status : { mist, tank, pump, esp1Online, gateway, lastSeen }
 *
 * Thuật toán mist mô phỏng đúng Deadband trong CONTRACT mục 2 (đọc /config nếu có,
 * không thì dùng mặc định hset=70, deadband=5).
 *
 * Tuân theo CONTRACT.md:
 *   - Mục 2 — data model (/sensor, /config, /status), thuật toán Deadband
 *   - Mục 3 — auth: đăng nhập bằng tài khoản thiết bị (email/password)
 *   - Mục 9 — Firebase JS SDK v10 (modular)
 *
 * Chạy:
 *   cp config.example.js config.js   # rồi điền firebaseConfig + tài khoản thiết bị
 *   npm install
 *   npm start
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set, onValue } from 'firebase/database';

// Đọc config người dùng (config.js — copy từ config.example.js).
let firebaseConfig, deviceEmail, devicePassword;
try {
  const cfg = await import('./config.js');
  firebaseConfig = cfg.firebaseConfig;
  deviceEmail = cfg.deviceEmail;
  devicePassword = cfg.devicePassword;
} catch (e) {
  console.error('\n[LỖI] Không nạp được ./config.js.');
  console.error('  -> Hãy copy config.example.js thành config.js rồi điền thông tin Firebase + tài khoản thiết bị.');
  console.error('  Chi tiết:', e.message, '\n');
  process.exit(1);
}

// ---- Tham số mô phỏng ----------------------------------------------------------
const INTERVAL_MS = 3000;          // chu kỳ ghi (~3s, theo yêu cầu)
const HSET_DEFAULT = 70;           // mặc định an toàn (CONTRACT mục 10)
const DEADBAND_DEFAULT = 5;

// Trạng thái mô phỏng (giữ giữa các vòng lặp để dao động "thực tế").
let humidity = 62;                 // %RH khởi điểm
let temperature = 28.0;            // °C khởi điểm
let mist = false;                  // trạng thái máy phun (giữ nguyên trong vùng deadband)
let tank = 'full';                 // "full" | "empty"
let pump = false;                  // bơm châm nước
let tick = 0;                      // đếm vòng lặp

// Cấu hình hiện hành (sẽ được cập nhật realtime khi admin sửa /config trên web).
let hset = HSET_DEFAULT;
let deadband = DEADBAND_DEFAULT;

// ---- Khởi tạo Firebase ---------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

async function main() {
  console.log('\n=====================================================');
  console.log(' DATA INJECTOR — bơm dữ liệu cảm biến giả lên Firebase');
  console.log('=====================================================');
  console.log('  Đăng nhập tài khoản thiết bị:', deviceEmail);

  // Đăng nhập bằng tài khoản thiết bị (CONTRACT mục 3) để có quyền ghi /sensor, /status.
  try {
    const cred = await signInWithEmailAndPassword(auth, deviceEmail, devicePassword);
    console.log('  Đăng nhập OK. UID =', cred.user.uid);
    console.log('  (UID này phải được seed vào /devices/<UID> = true để ghi được)');
  } catch (e) {
    console.error('\n[LỖI] Đăng nhập thất bại:', e.code || e.message);
    console.error('  -> Kiểm tra deviceEmail/devicePassword và tài khoản đã tạo trong Firebase Auth.\n');
    process.exit(1);
  }

  // Lắng nghe /config realtime: nếu admin sửa hset/deadband trên web, mô phỏng cập nhật theo.
  onValue(ref(db, 'config'), (snap) => {
    const c = snap.val();
    if (c && typeof c === 'object') {
      if (Number.isFinite(Number(c.hset))) hset = Number(c.hset);
      if (Number.isFinite(Number(c.deadband))) deadband = Number(c.deadband);
      console.log(`  [config] đọc từ Firebase: hset=${hset}, deadband=${deadband}`);
    }
  });

  console.log(`  Bắt đầu bơm dữ liệu mỗi ${INTERVAL_MS / 1000}s. Nhấn Ctrl+C để dừng.`);
  console.log('-----------------------------------------------------\n');

  // Vòng lặp ghi định kỳ.
  await injectOnce();                 // ghi ngay 1 lần đầu
  setInterval(injectOnce, INTERVAL_MS);
}

// ---- Một vòng bơm dữ liệu ------------------------------------------------------
async function injectOnce() {
  tick++;

  // 1) Dao động cảm biến "thực tế": nhiễu ngẫu nhiên nhẹ + ảnh hưởng của máy phun.
  //    Máy phun bật -> độ ẩm tăng dần; tắt -> độ ẩm giảm dần (mô phỏng môi trường).
  const noiseH = (Math.random() - 0.5) * 1.5;   // ±0.75 %RH
  const drift = mist ? +1.2 : -0.9;             // phun thì ẩm lên, không phun thì xuống
  humidity = clamp(humidity + drift + noiseH, 30, 95);

  // Nhiệt độ dao động nhẹ quanh ~28°C (phun sương làm hơi mát hơn một chút).
  const noiseT = (Math.random() - 0.5) * 0.4;   // ±0.2 °C
  temperature = clamp(temperature + noiseT + (mist ? -0.05 : 0.03), 22, 38);

  // 2) Thuật toán Deadband (CONTRACT mục 2) — máy phun làm TĂNG độ ẩm.
  const lowEdge = hset - deadband;   // < ngưỡng này -> BẬT
  const highEdge = hset + deadband;  // > ngưỡng này -> TẮT
  if (humidity < lowEdge) {
    mist = true;                     // độ ẩm thấp -> bật phun
  } else if (humidity > highEdge) {
    mist = false;                    // độ ẩm cao -> tắt phun
  }
  // nằm trong [lowEdge, highEdge] -> giữ nguyên mist (chống nhảy relay)

  // 3) Mô phỏng bồn nước: thỉnh thoảng đặt "empty" để test cảnh báo cạn nước.
  //    Cứ ~20 vòng (~1 phút) cho bồn cạn vài vòng rồi đầy lại; bơm chạy khi đang cạn.
  const phase = tick % 20;
  if (phase >= 16 && phase <= 18) {
    tank = 'empty';                  // 3 vòng cạn nước -> dashboard hiện cảnh báo
    pump = true;                     // bơm châm nước đang chạy
  } else {
    tank = 'full';
    pump = false;
  }

  // 4) Thời gian epoch GIÂY (CONTRACT mục 10: thời gian epoch giây).
  const nowSec = Math.floor(Date.now() / 1000);

  // 5) Làm tròn để dữ liệu gọn (number theo CONTRACT).
  const tOut = round1(temperature);
  const hOut = round1(humidity);

  // 6) Ghi /sensor và /status lên Firebase (CONTRACT mục 2 — đúng path & key).
  const sensorData = {
    temperature: tOut,
    humidity: hOut,
    timestamp: nowSec,
  };
  const statusData = {
    mist: mist,
    tank: tank,
    pump: pump,
    esp1Online: true,
    gateway: 'esp1',
    lastSeen: nowSec,
  };

  try {
    await Promise.all([
      set(ref(db, 'sensor'), sensorData),
      set(ref(db, 'status'), statusData),
    ]);
    // In ra console để theo dõi.
    console.log(
      `[#${String(tick).padStart(4, '0')}] ` +
      `T=${tOut.toFixed(1)}°C  RH=${hOut.toFixed(1)}%  ` +
      `mist=${mist ? 'ON ' : 'OFF'}  tank=${tank}  pump=${pump ? 'ON ' : 'OFF'}  ` +
      `(hset=${hset}±${deadband} → min=${hset - deadband} max=${hset + deadband})` +
      (tank === 'empty' ? '  ⚠ CẢNH BÁO CẠN NƯỚC' : '')
    );
  } catch (e) {
    console.error('[LỖI ghi Firebase]', e.code || e.message);
    console.error('  -> Kiểm tra security rules /devices/<UID> và databaseURL.');
  }
}

// ---- Hàm tiện ích --------------------------------------------------------------
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---- Dừng sạch khi Ctrl+C ------------------------------------------------------
process.on('SIGINT', () => {
  console.log('\nĐã dừng data-injector. Tạm biệt!');
  process.exit(0);
});

main();
