// ============================================================================
//  app.js — Điều phối chính Web Dashboard "Smart Humidity IoT".
//  - Init Firebase App (dùng config từ firebase-config.js — KHÔNG ghi đè).
//  - Đăng nhập Google → check admin → hiện Dashboard.
//  - Lắng nghe realtime /sensor, /status, /config → cập nhật UI + biểu đồ.
//  - Form cấu hình: nhập Hset + Deadband → ghi /config (chỉ admin).
//  - Cảnh báo cạn nước.
//  Tất cả interface tuân theo docs/CONTRACT.md (mục 2, 3, 9).
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { firebaseConfig, FIREBASE_SDK_VERSION } from "./firebase-config.js";
import { initAuth, loginWithGoogle, logout, watchAuth, describeAuthError } from "./auth.js";
import {
  initDb, checkIsAdmin,
  listenSensor, listenStatus, listenConfig,
  writeConfig
} from "./db.js";
import { initChart, pushPoint, clearChart } from "./chart.js";
import { initAlarm, armAudio, updateAlarm, disposeAlarm } from "./alarm.js";

console.log(`[app] Smart Humidity IoT — Firebase SDK v${FIREBASE_SDK_VERSION}`);

// ---- Khởi tạo Firebase (1 instance dùng chung cho auth + db) ----------------
const app = initializeApp(firebaseConfig);
initAuth(app);
initDb(app);

// ---- Tham chiếu phần tử DOM -------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
  // Màn hình
  welcome: $("welcomeScreen"),
  dashboard: $("dashboardScreen"),
  // Welcome
  btnLogin: $("btnLogin"),
  loginError: $("loginError"),
  // Header user
  userName: $("userName"),
  userEmail: $("userEmail"),
  userAvatar: $("userAvatar"),
  btnLogout: $("btnLogout"),
  adminBadge: $("adminBadge"),
  // Metric
  tempValue: $("tempValue"),
  humValue: $("humValue"),
  updatedAt: $("updatedAt"),
  onlineDot: $("onlineDot"),
  onlineText: $("onlineText"),
  // Status panel
  stMist: $("stMist"),
  stTank: $("stTank"),
  stPump: $("stPump"),
  stGateway: $("stGateway"),
  // Chart
  chartCanvas: $("sensorChart"),
  // Config form
  cfgForm: $("configForm"),
  cfgHset: $("inputHset"),
  cfgDeadband: $("inputDeadband"),
  cfgMax: $("derivedMax"),
  cfgMin: $("derivedMin"),
  cfgBtn: $("btnSaveConfig"),
  cfgMsg: $("configMsg"),
  cfgReadonlyNote: $("readonlyNote"),
  cfgLastUpdate: $("cfgLastUpdate"),
  cfgUpdatedBy: $("cfgUpdatedBy"),
  // Alarm
  alarmBox: $("alarmBox")
};

// ---- Trạng thái runtime -----------------------------------------------------
let isAdmin = false;
let currentUser = null;
let unsub = [];          // danh sách hàm huỷ listener để dọn khi logout
let chartReady = false;
let audioArmed = false;

// Mở khoá âm thanh ngay lần click đầu tiên bất kỳ trên trang (autoplay policy).
function armAudioOnce() {
  if (audioArmed) return;
  armAudio();
  audioArmed = true;
}
document.addEventListener("click", armAudioOnce, { once: false });

// ============================================================================
//  AUTH FLOW
// ============================================================================
els.btnLogin.addEventListener("click", async () => {
  els.loginError.hidden = true;
  setLoginLoading(true);
  try {
    await loginWithGoogle();
    // onAuthStateChanged sẽ tự lo phần còn lại.
  } catch (e) {
    els.loginError.textContent = describeAuthError(e);
    els.loginError.hidden = false;
  } finally {
    setLoginLoading(false);
  }
});

els.btnLogout.addEventListener("click", async () => {
  try {
    await logout();
  } catch (e) {
    console.error("[app] Đăng xuất lỗi:", e);
  }
});

function setLoginLoading(loading) {
  els.btnLogin.disabled = loading;
  els.btnLogin.innerHTML = loading
    ? '<span class="spinner"></span><span>Đang đăng nhập...</span>'
    : googleBtnLabel();
}
function googleBtnLabel() {
  return `
    <svg class="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.4 1.1 7.3 2.8l5.7-5.7C33.6 6.1 29 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c2.8 0 5.4 1.1 7.3 2.8l5.7-5.7C33.6 6.1 29 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C40.9 36.5 44 30.8 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
    <span>Đăng nhập với Google</span>`;
}
els.btnLogin.innerHTML = googleBtnLabel();

// ============================================================================
//  THEO DÕI TRẠNG THÁI ĐĂNG NHẬP
// ============================================================================
watchAuth(async (user) => {
  if (user) {
    currentUser = user;
    // In UID ra console để tiện seed /admins/<uid> = true (theo yêu cầu).
    console.log("%c[app] Đã đăng nhập. UID = " + user.uid,
      "color:#22c55e;font-weight:bold");
    console.log("[app] Để cấp quyền admin: seed /admins/" + user.uid + " = true trong Firebase Console.");

    await enterDashboard(user);
  } else {
    currentUser = null;
    leaveDashboard();
  }
});

// ============================================================================
//  VÀO DASHBOARD
// ============================================================================
async function enterDashboard(user) {
  // Hiển thị thông tin người dùng.
  els.userName.textContent = user.displayName || "Người dùng";
  els.userEmail.textContent = user.email || "";
  if (user.photoURL) {
    els.userAvatar.src = user.photoURL;
    els.userAvatar.hidden = false;
  } else {
    els.userAvatar.hidden = true;
  }

  // Kiểm tra quyền admin.
  isAdmin = await checkIsAdmin(user.uid);

  // Guard chống race: nếu đã đăng xuất / đổi user trong lúc await thì DỪNG — không
  // hiện dashboard hay gắn listener (tránh "logout giữa chừng vẫn vào dashboard").
  if (currentUser !== user) return;

  applyAdminMode(isAdmin);

  // Đổi màn hình.
  els.welcome.hidden = true;
  els.dashboard.hidden = false;

  // Khởi tạo biểu đồ (1 lần).
  if (!chartReady) {
    initChart(els.chartCanvas);
    chartReady = true;
  }
  // Khởi tạo alarm box.
  initAlarm(els.alarmBox);

  // Gắn các listener realtime.
  attachListeners();
}

// ============================================================================
//  RỜI DASHBOARD (đăng xuất)
// ============================================================================
function leaveDashboard() {
  // Huỷ listener.
  unsub.forEach((fn) => { try { fn(); } catch (_) {} });
  unsub = [];

  disposeAlarm();
  clearChart();
  isAdmin = false;

  // Reset form/UI.
  els.cfgMsg.hidden = true;

  els.dashboard.hidden = true;
  els.welcome.hidden = false;
}

// ============================================================================
//  GẮN LISTENER REALTIME
// ============================================================================
function attachListeners() {
  // /sensor
  unsub.push(listenSensor((s) => {
    const t = typeof s.temperature === "number" ? s.temperature : null;
    const h = typeof s.humidity === "number" ? s.humidity : null;

    els.tempValue.textContent = t !== null ? t.toFixed(1) : "--";
    els.humValue.textContent = h !== null ? h.toFixed(1) : "--";

    if (s.timestamp && s.timestamp > 0) {
      els.updatedAt.textContent = "Cập nhật: " + new Date(s.timestamp * 1000).toLocaleString("vi-VN");
    } else if (t !== null || h !== null) {
      // Có số đo nhưng thiết bị chưa gửi mốc thời gian (chưa đồng bộ NTP) — KHÔNG hiển thị
      // giờ máy client để tránh tưởng nhầm dữ liệu luôn "mới".
      els.updatedAt.textContent = "Cập nhật: — (thiết bị chưa gửi mốc thời gian)";
    } else {
      els.updatedAt.textContent = "Cập nhật: —";
    }

    // Đẩy vào biểu đồ (chỉ khi có ít nhất 1 giá trị hợp lệ).
    if (t !== null || h !== null) {
      pushPoint(t !== null ? t : NaN, h !== null ? h : NaN, s.timestamp);
    }
  }));

  // /status
  unsub.push(listenStatus((st) => {
    renderStatus(st);
    updateAlarm(st.tank); // cảnh báo cạn nước
  }));

  // /config
  unsub.push(listenConfig((cfg) => {
    renderConfig(cfg);
  }));
}

// ============================================================================
//  PHÁT HIỆN ONLINE/OFFLINE — theo lastSeen (KHÔNG tin cờ esp1Online)
//
//  Bài toán presence: thiết bị KHÔNG thể tự báo "tôi offline" (mất mạng thì báo
//  sao được). Vì vậy VIEWER (web) tự suy: nếu lastSeen quá cũ so với giờ hiện tại
//  -> coi như mất kết nối. Không cần backend/service chạy ngầm.
//
//  ESP đẩy /status (kèm lastSeen mới) mỗi ~4s -> quá ONLINE_TIMEOUT_S không thấy
//  cập nhật thì lật sang offline. Vì onValue chỉ bắn khi dữ liệu ĐỔI (ESP chết thì
//  ngừng bắn), ta chạy thêm 1 timer client tự đánh giá lại định kỳ.
//
//  Lưu ý: dựa vào lastSeen (epoch giây từ NTP của ESP) so với đồng hồ trình duyệt.
//  Cả hai thường đã đồng bộ NTP nên lệch không đáng kể; để ngưỡng rộng cho an toàn.
// ============================================================================
const ONLINE_TIMEOUT_S = 15;   // > chu kỳ đẩy (~4s); quá 15s coi như mất kết nối
let g_lastStatus = null;       // /status gần nhất (để timer re-check)
let g_onlineTimer = null;      // timer tự lật offline khi lastSeen quá hạn

function isDeviceOnline(st) {
  if (!st) return false;
  const lastSeen = Number(st.lastSeen) || 0;
  if (lastSeen <= 0) return false;              // chưa có NTP / chưa từng thấy heartbeat
  const nowSec = Math.floor(Date.now() / 1000);
  return (nowSec - lastSeen) < ONLINE_TIMEOUT_S;
}

function renderOnline() {
  const online = isDeviceOnline(g_lastStatus);
  els.onlineDot.className = "dot " + (online ? "dot-online" : "dot-offline");
  els.onlineText.textContent = online ? "Trực tuyến" : "Mất kết nối";
  els.onlineText.className = online ? "text-green-400 font-medium" : "text-gray-400 font-medium";
}

// ============================================================================
//  RENDER TRẠNG THÁI THIẾT BỊ
// ============================================================================
function renderStatus(st) {
  // Online: suy từ lastSeen (xem khối trên) thay vì tin cờ esp1Online.
  g_lastStatus = st;
  renderOnline();
  // Bật timer tự lật offline khi ESP ngừng cập nhật (chỉ tạo 1 lần).
  if (!g_onlineTimer) g_onlineTimer = setInterval(renderOnline, 5000);

  // Máy phun (mist).
  setBadge(els.stMist, st.mist === true,
    { on: "Đang phun", off: "Tắt", onClass: "bg-sky-500/20 text-sky-300 mist-on", offClass: "bg-gray-600/30 text-gray-300" });

  // Bồn nước (tank): full/empty.
  const tankEmpty = st.tank === "empty";
  els.stTank.textContent = tankEmpty ? "Cạn nước" : (st.tank === "full" ? "Đầy nước" : "—");
  els.stTank.className = "px-3 py-1 rounded-full text-sm font-semibold " +
    (tankEmpty ? "bg-red-500/25 text-red-300" : "bg-green-500/20 text-green-300");

  // Bơm châm (pump).
  setBadge(els.stPump, st.pump === true,
    { on: "Đang bơm", off: "Tắt", onClass: "bg-amber-500/20 text-amber-300", offClass: "bg-gray-600/30 text-gray-300" });

  // Gateway: esp1 (bình thường) / esp2 (gateway dự phòng).
  const gw = st.gateway || "—";
  els.stGateway.textContent = gw === "esp2" ? "ESP2 (dự phòng)" : (gw === "esp1" ? "ESP1 (chính)" : "—");
  els.stGateway.className = "px-3 py-1 rounded-full text-sm font-semibold " +
    (gw === "esp2" ? "bg-purple-500/20 text-purple-300" : "bg-indigo-500/20 text-indigo-300");
}

function setBadge(el, on, opt) {
  el.textContent = on ? opt.on : opt.off;
  el.className = "px-3 py-1 rounded-full text-sm font-semibold " + (on ? opt.onClass : opt.offClass);
}

// ============================================================================
//  RENDER CẤU HÌNH (/config)
// ============================================================================
function renderConfig(cfg) {
  const hset = typeof cfg.hset === "number" ? cfg.hset : 70;
  const deadband = typeof cfg.deadband === "number" ? cfg.deadband : 5;

  // Nếu admin đang chỉnh BẤT KỲ field nào trong form thì KHÔNG ghi đè (tránh mất giá
  // trị đang gõ ở field còn lại khi /config cập nhật từ server). Chỉ cập nhật phần text.
  const editing = els.cfgForm.contains(document.activeElement);
  if (!editing) {
    els.cfgHset.value = hset;
    els.cfgDeadband.value = deadband;
    updateDerived();
  }

  els.cfgLastUpdate.textContent = cfg.lastUpdate || "—";
  els.cfgUpdatedBy.textContent = cfg.updatedBy || "—";
}

// Hiển thị Max = hset + deadband, Min = hset - deadband (suy ra).
function updateDerived() {
  const hset = Number(els.cfgHset.value);
  const deadband = Number(els.cfgDeadband.value);
  if (Number.isFinite(hset) && Number.isFinite(deadband)) {
    els.cfgMax.textContent = (hset + deadband).toFixed(0) + " %RH";
    els.cfgMin.textContent = (hset - deadband).toFixed(0) + " %RH";
  } else {
    els.cfgMax.textContent = "— %RH";
    els.cfgMin.textContent = "— %RH";
  }
}
els.cfgHset.addEventListener("input", updateDerived);
els.cfgDeadband.addEventListener("input", updateDerived);

// ============================================================================
//  CHẾ ĐỘ ADMIN / CHỈ-XEM
// ============================================================================
function applyAdminMode(admin) {
  if (admin) {
    els.adminBadge.textContent = "Quản trị viên";
    els.adminBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-500/20 text-green-300";
    els.cfgHset.disabled = false;
    els.cfgDeadband.disabled = false;
    els.cfgBtn.disabled = false;
    els.cfgBtn.hidden = false;
    els.cfgReadonlyNote.hidden = true;
  } else {
    els.adminBadge.textContent = "Khách (chỉ xem)";
    els.adminBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-500/20 text-gray-300";
    els.cfgHset.disabled = true;
    els.cfgDeadband.disabled = true;
    els.cfgBtn.disabled = true;
    els.cfgBtn.hidden = true;
    els.cfgReadonlyNote.hidden = false;
  }
}

// ============================================================================
//  SUBMIT CẤU HÌNH (chỉ admin)
// ============================================================================
els.cfgForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return; // chốt chặn an toàn (UI đã disable).

  const hset = Number(els.cfgHset.value);
  const deadband = Number(els.cfgDeadband.value);

  // Validate (0<=hset<=100, 0<=deadband<=50).
  if (!Number.isFinite(hset) || hset < 0 || hset > 100) {
    return showCfgMsg("Hset phải nằm trong khoảng 0–100 %RH.", "error");
  }
  if (!Number.isFinite(deadband) || deadband < 0 || deadband > 50) {
    return showCfgMsg("Deadband phải nằm trong khoảng 0–50 %RH.", "error");
  }

  els.cfgBtn.disabled = true;
  const oldLabel = els.cfgBtn.textContent;
  els.cfgBtn.textContent = "Đang lưu...";

  try {
    await writeConfig({ hset, deadband }, currentUser ? currentUser.email : "");
    showCfgMsg("Đã lưu cấu hình thành công.", "ok");
  } catch (err) {
    if (err && err.code === "permission-denied") {
      showCfgMsg(err.message, "error");
    } else {
      showCfgMsg("Lưu thất bại: " + (err && err.message ? err.message : "lỗi không xác định."), "error");
    }
    console.error("[app] writeConfig lỗi:", err);
  } finally {
    els.cfgBtn.disabled = false;
    els.cfgBtn.textContent = oldLabel;
  }
});

function showCfgMsg(text, type) {
  els.cfgMsg.textContent = text;
  els.cfgMsg.hidden = false;
  els.cfgMsg.className = "mt-3 text-sm rounded-lg px-3 py-2 " +
    (type === "ok"
      ? "bg-green-500/15 text-green-300 border border-green-500/30"
      : "bg-red-500/15 text-red-300 border border-red-500/30");
  // Tự ẩn thông báo thành công sau 4s.
  if (type === "ok") {
    setTimeout(() => { els.cfgMsg.hidden = true; }, 4000);
  }
}
