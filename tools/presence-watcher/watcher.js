/**
 * presence-watcher — Tự cập nhật /status/esp1Online = false khi ESP ngừng gửi lastSeen quá lâu.
 *
 * VÌ SAO CẦN TOOL NÀY:
 *   Web dashboard tự suy online/offline từ /status/lastSeen (xem docs/CONTRACT.md mục "Phát hiện
 *   online/offline") — NHƯNG logic đó chạy TRONG TRÌNH DUYỆT, chỉ hoạt động khi có người đang mở
 *   web. Field /status/esp1Online trong RTDB thì do chính ESP1 ghi mỗi lần đẩy dữ liệu (~mỗi
 *   4-10s) — nếu ESP1 mất mạng/crash, KHÔNG CÓ AI sửa lại field đó, nó đứng yên ở "true" mãi khi
 *   xem trực tiếp trong Firebase Console, dù thiết bị đã chết từ lâu.
 *
 *   Tool này chạy NGOÀI trình duyệt (Node, có thể để chạy 24/7 trên máy/server riêng) để chính
 *   FIELD /status/esp1Online trong database cũng phản ánh đúng, không phụ thuộc có ai mở web hay
 *   không. Đây là cách "backend" đơn giản, KHÔNG cần Cloud Functions (không cần gói trả phí Blaze)
 *   — chỉ là 1 script Node đăng nhập bằng tài khoản thiết bị, có quyền ghi /status như ESP.
 *
 * GIỚI HẠN (không có "phép màu"): tool này vẫn cần MỘT MÁY chạy nó liên tục (laptop để mở, máy
 * chủ nhỏ, Raspberry Pi...). Không có cách nào "chạy nền không cần máy nào cả" — đó là bản chất
 * của bất kỳ việc gì cần chạy khi không ai mở trình duyệt. Nếu không có máy nào rảnh để chạy 24/7,
 * cân nhắc dùng Cloud Functions (cần Blaze) hoặc chấp nhận /status/esp1Online có thể trễ tới khi
 * có ai mở web hoặc chạy lại tool này.
 *
 * CHẠY:
 *   cp config.example.js config.js   # rồi điền firebaseConfig + tài khoản thiết bị (CÙNG ESP1)
 *   npm install
 *   npm start
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, onValue, update } from 'firebase/database';

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

// ---- Tham số ------------------------------------------------------------------
const CHECK_INTERVAL_MS = 5000;      // chu kỳ kiểm tra lại (khớp timer bên web)
const ONLINE_TIMEOUT_DEFAULT_S = 15; // fallback khi /webSettings chưa có onlineTimeoutSec

// Trạng thái theo dõi (cập nhật realtime qua onValue, không cần poll network liên tục).
let lastSeen = 0;                            // /status/lastSeen mới nhất đã biết
let onlineTimeoutSec = ONLINE_TIMEOUT_DEFAULT_S; // đọc từ /webSettings/onlineTimeoutSec — CÙNG ngưỡng web dùng
let lastWrittenOnline = null;                // giá trị esp1Online watcher vừa ghi lần cuối (tránh ghi lặp)

// ---- Khởi tạo Firebase ---------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

async function main() {
  console.log('\n=====================================================');
  console.log(' PRESENCE WATCHER — tự cập nhật /status/esp1Online');
  console.log('=====================================================');
  console.log('  Đăng nhập tài khoản thiết bị:', deviceEmail);

  try {
    const cred = await signInWithEmailAndPassword(auth, deviceEmail, devicePassword);
    console.log('  Đăng nhập OK. UID =', cred.user.uid);
    console.log('  (UID này phải được seed vào /devices/<UID> = true để ghi được — dùng chung với ESP1)');
  } catch (e) {
    console.error('\n[LỖI] Đăng nhập thất bại:', e.code || e.message);
    console.error('  -> Kiểm tra deviceEmail/devicePassword và tài khoản đã tạo trong Firebase Auth.\n');
    process.exit(1);
  }

  // Nghe /status/lastSeen realtime — cập nhật ngay khi ESP đẩy dữ liệu mới.
  onValue(ref(db, 'status/lastSeen'), (snap) => {
    const v = Number(snap.val());
    if (Number.isFinite(v) && v > 0) lastSeen = v;
  });

  // Nghe /webSettings/onlineTimeoutSec — dùng CÙNG ngưỡng admin đặt trên web (align, đỡ lệch nhau).
  // Path này TÁCH khỏi /config vì chỉ web dùng, ESP không cần subscribe field này.
  onValue(ref(db, 'webSettings/onlineTimeoutSec'), (snap) => {
    const v = Number(snap.val());
    if (Number.isFinite(v) && v >= 5 && v <= 300) onlineTimeoutSec = v;
  });

  console.log(`  Kiểm tra mỗi ${CHECK_INTERVAL_MS / 1000}s. Nhấn Ctrl+C để dừng.`);
  console.log('-----------------------------------------------------\n');

  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

// ---- Một vòng kiểm tra + ghi (chỉ ghi khi giá trị THỰC SỰ cần đổi) --------------
async function checkOnce() {
  if (lastSeen <= 0) return; // chưa từng thấy heartbeat nào — chưa đủ dữ liệu để kết luận

  const nowSec = Math.floor(Date.now() / 1000);
  const isOnline = (nowSec - lastSeen) < onlineTimeoutSec;

  // Chỉ ghi khi khác với lần watcher ghi trước — tránh spam Firebase mỗi 5s.
  // (ESP tự ghi lại esp1Online=true mỗi lần nó đẩy dữ liệu — watcher chỉ cần SỬA LẠI lúc ESP im lặng.)
  if (isOnline === lastWrittenOnline) return;

  try {
    await update(ref(db, 'status'), { esp1Online: isOnline });
    lastWrittenOnline = isOnline;
    const ts = new Date().toLocaleTimeString('vi-VN');
    console.log(`[${ts}] esp1Online -> ${isOnline} (lastSeen cách đây ${nowSec - lastSeen}s)`);
  } catch (e) {
    console.error('[LỖI ghi /status/esp1Online]', e.code || e.message);
    console.error('  -> Kiểm tra security rules /devices/<UID> và databaseURL.');
  }
}

// ---- Dừng sạch khi Ctrl+C ------------------------------------------------------
process.on('SIGINT', () => {
  console.log('\nĐã dừng presence-watcher. Tạm biệt!');
  process.exit(0);
});

main();
