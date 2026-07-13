// ============================================================================
//  db.js — Realtime Database: lắng nghe (onValue) + ghi /config (theo CONTRACT
//          mục 2 & 3). Dùng Firebase Database modular ESM CDN v10.12.2.
//
//  Cây dữ liệu (xem CONTRACT mục 2):
//    /sensor  { temperature, humidity, timestamp }     ← thiết bị GHI, web ĐỌC
//    /config  { hset, deadband, mode, onlineTimeoutSec, pumpControlEnabled, pumpManualOn,
//               lastUpdate, updatedBy } ← admin GHI.
//               mode: "off"|"continuous"|"intermittent" (chế độ phun sương).
//               pumpControlEnabled/pumpManualOn chỉ hiện trên web khi admin bật cờ
//               pumpControlEnabled thẳng trong Firebase Console — xem CONTRACT.md.
//    /status  { mist, tank, pump, esp1Online, gateway, lastSeen } ← thiết bị GHI
//    /admins/<uid> = true                               ← seed thủ công
// ============================================================================

import {
  getDatabase,
  ref,
  onValue,
  get,
  update,
  child
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let db = null;

/**
 * Khởi tạo Database từ FirebaseApp.
 * @param {import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js").FirebaseApp} app
 */
export function initDb(app) {
  db = getDatabase(app);
  return db;
}

/* --------------------------------------------------------------------------
 *  Kiểm tra quyền admin: đọc /admins/<uid>.
 *  Trả về true nếu giá trị === true. Nếu lỗi đọc → coi như không phải admin.
 * ------------------------------------------------------------------------ */
export async function checkIsAdmin(uid, retries = 2) {
  if (!db || !uid) return false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const snap = await get(child(ref(db), `admins/${uid}`));
      return snap.exists() && snap.val() === true;
    } catch (e) {
      console.warn(`[db] Đọc /admins lỗi (lần ${attempt + 1}/${retries + 1}):`, e);
      // Lỗi mạng tạm thời → chờ rồi thử lại, tránh hạ nhầm admin xuống chế độ chỉ-xem.
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  console.warn("[db] Không xác định được quyền admin sau khi thử lại → tạm coi là khách (chỉ xem).");
  return false;
}

/* --------------------------------------------------------------------------
 *  Lắng nghe realtime — mỗi hàm trả về hàm unsubscribe để dọn dẹp khi logout.
 * ------------------------------------------------------------------------ */

/** Lắng nghe /sensor → cb({temperature, humidity, timestamp}) */
export function listenSensor(cb) {
  return onValue(ref(db, "sensor"), (snap) => {
    cb(snap.val() || {});
  }, (err) => console.error("[db] listen /sensor lỗi:", err));
}

/** Lắng nghe /status → cb({mist, tank, pump, esp1Online, gateway, lastSeen}) */
export function listenStatus(cb) {
  return onValue(ref(db, "status"), (snap) => {
    cb(snap.val() || {});
  }, (err) => console.error("[db] listen /status lỗi:", err));
}

/** Lắng nghe /config → cb({hset, deadband, lastUpdate, updatedBy}) */
export function listenConfig(cb) {
  return onValue(ref(db, "config"), (snap) => {
    cb(snap.val() || {});
  }, (err) => console.error("[db] listen /config lỗi:", err));
}

/* --------------------------------------------------------------------------
 *  Ghi /config — CHỈ admin (rules chặn người khác → permission-denied).
 *  app.js đã chặn UI cho non-admin, nhưng vẫn try/catch để báo lỗi rõ ràng.
 * ------------------------------------------------------------------------ */

const VALID_MODES = ["off", "continuous", "intermittent"];

/**
 * Ghi cấu hình mới lên /config.
 * @param {{hset:number, deadband:number, onlineTimeoutSec?:number, mode?:string}} cfg
 * @param {string} email  email người chỉnh (đưa vào updatedBy)
 */
export async function writeConfig(cfg, email) {
  if (!db) throw new Error("DB chưa khởi tạo.");

  // Validate phía client (rules cũng validate lại phía server).
  const hset = Number(cfg.hset);
  const deadband = Number(cfg.deadband);
  const onlineTimeoutSec = Number.isFinite(Number(cfg.onlineTimeoutSec)) ? Number(cfg.onlineTimeoutSec) : 15;
  const mode = VALID_MODES.includes(cfg.mode) ? cfg.mode : "continuous";
  if (!Number.isFinite(hset) || hset < 0 || hset > 100) {
    throw new Error("Hset phải nằm trong khoảng 0–100 %RH.");
  }
  if (!Number.isFinite(deadband) || deadband < 0 || deadband > 50) {
    throw new Error("Deadband phải nằm trong khoảng 0–50 %RH.");
  }
  if (onlineTimeoutSec < 5 || onlineTimeoutSec > 300) {
    throw new Error("Ngưỡng offline (onlineTimeoutSec) phải nằm trong khoảng 5–300 giây.");
  }
  if (!VALID_MODES.includes(mode)) {
    throw new Error("Chế độ phun sương phải là off, continuous hoặc intermittent.");
  }

  const payload = {
    hset,
    deadband,
    onlineTimeoutSec,
    mode,
    lastUpdate: formatLocalTime(new Date()), // chuỗi giờ địa phương để hiển thị
    updatedBy: email || "unknown"
  };

  try {
    // update() (KHÔNG dùng set()): chỉ ghi đè các field trong payload, GIỮ NGUYÊN các field
    // khác đang có ở /config (vd pumpControlEnabled/pumpManualOn) — set() sẽ XOÁ SẠCH chúng.
    await update(ref(db, "config"), payload);
    return payload;
  } catch (e) {
    // Bắt riêng permission-denied để báo người dùng dễ hiểu.
    if (e && (e.code === "PERMISSION_DENIED" || /permission_denied|permission denied/i.test(String(e.message)))) {
      const err = new Error("Bạn không có quyền ghi cấu hình (chỉ admin được phép). UID của bạn cần được seed vào /admins.");
      err.code = "permission-denied";
      throw err;
    }
    throw e;
  }
}

/**
 * Ghi/lật trạng thái điều khiển bơm thủ công lên /config/pumpManualOn (partial update).
 * Chỉ dùng khi admin đã bật /config/pumpControlEnabled = true (xem CONTRACT).
 * @param {boolean} on
 * @param {string} email  email người chỉnh (đưa vào updatedBy)
 */
export async function writePumpManual(on, email) {
  if (!db) throw new Error("DB chưa khởi tạo.");

  const payload = {
    pumpManualOn: !!on,
    lastUpdate: formatLocalTime(new Date()),
    updatedBy: email || "unknown"
  };

  try {
    await update(ref(db, "config"), payload);
    return payload;
  } catch (e) {
    if (e && (e.code === "PERMISSION_DENIED" || /permission_denied|permission denied/i.test(String(e.message)))) {
      const err = new Error("Bạn không có quyền điều khiển bơm (chỉ admin được phép).");
      err.code = "permission-denied";
      throw err;
    }
    throw e;
  }
}

/**
 * Định dạng thời gian địa phương "YYYY-MM-DD HH:MM:SS" (khớp ví dụ trong CONTRACT).
 * @param {Date} d
 */
export function formatLocalTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
