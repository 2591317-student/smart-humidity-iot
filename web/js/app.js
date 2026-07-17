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
  listenSensor, listenStatus, listenConfig, listenWebSettings,
  writeConfig, /* writePumpManual, */ writeWebSettings, correctEsp1Online
} from "./db.js";
import { initChart, pushPoint, clearChart, setDeadbandBand } from "./chart.js";
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
  metricSection: $("metricSection"), // cả hàng metric — làm mờ khi mất kết nối
  tempValue: $("tempValue"),
  humValue: $("humValue"),
  humMeter: $("humMeter"), // thanh vị trí độ ẩm so với ngưỡng — xem renderHumContext
  humZone: $("humZone"),
  humDot: $("humDot"),
  humContext: $("humContext"), // dòng ngữ cảnh "đang ở đâu so với Min/Max"
  updatedAt: $("updatedAt"),
  onlineDot: $("onlineDot"),
  onlineText: $("onlineText"),
  hdrOnlineDot: $("hdrOnlineDot"), // chip online/offline trên header (luôn thấy khi cuộn)
  hdrOnlineText: $("hdrOnlineText"),
  // Status panel
  stMist: $("stMist"),
  stTank: $("stTank"),
  stTankFill: $("stTankFill"), // tank gauge SVG (bình chứa) — xem renderStatus
  stTankWave: $("stTankWave"), // dải sóng gợn trên mặt nước — xem renderStatus
  stTankPct: $("stTankPct"), // chữ % mức nước giữa bồn — xem renderStatus
  tankLegend: $("tankLegend"), // thang chú giải 4 mức cạnh bồn — xem renderStatus
  // Bơm châm nước — TẠM ẨN (2026-07-14, xem web/index.html + docs/TIEN-DO-2026-07-02.md).
  // stPump: $("stPump"),
  // Gateway — TẠM ẨN (2026-07-14, xem web/index.html + docs/TIEN-DO-2026-07-02.md).
  // stGateway: $("stGateway"),
  // Điều khiển bơm thủ công — TẠM ẨN cùng lý do trên.
  // pumpControlWrap: $("pumpControlWrap"),
  // btnTogglePump: $("btnTogglePump"),
  // Chart
  chartCanvas: $("sensorChart"),
  // Config form
  cfgForm: $("configForm"),
  cfgMode: $("inputMode"), // <select> ẩn — giữ giá trị thật, không hiện lên UI
  modeBtn: $("modeDropdownBtn"),
  modeLabel: $("modeDropdownLabel"),
  modeList: $("modeDropdownList"),
  cfgHset: $("inputHset"),
  cfgDeadband: $("inputDeadband"),
  cfgOnlineTimeout: $("inputOnlineTimeout"),
  cfgMax: $("derivedMax"),
  cfgMin: $("derivedMin"),
  cfgBtn: $("btnSaveConfig"),
  cfgMsg: $("configMsg"),
  cfgReadonlyNote: $("readonlyNote"),
  cfgLastUpdate: $("cfgLastUpdate"),
  cfgUpdatedBy: $("cfgUpdatedBy"),
  // Alarm
  alarmBox: $("alarmBox"),
  // Toast nổi góc phải dưới — xem showToast
  toastWrap: $("toastWrap")
};

// ---- Trạng thái runtime -----------------------------------------------------
let isAdmin = false;
let currentUser = null;
// let g_pumpManualOn = false; // TẠM ẨN cùng tính năng điều khiển bơm thủ công (xem ở trên)
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

  // Dừng timer online/updatedAt + reset state — tránh toast "kết nối lại" oan
  // và đếm giờ sai khi đăng nhập lại phiên sau.
  if (g_onlineTimer) { clearInterval(g_onlineTimer); g_onlineTimer = null; }
  g_prevOnline = null;
  g_lastStatus = null;
  g_lastSensorTs = 0;
  g_hasSensorData = false;
  g_lastSensorClientMs = 0;

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

    // Dữ liệu thật đã về — gỡ skeleton loading (đặt sẵn trong HTML).
    els.tempValue.classList.remove("skeleton");
    els.humValue.classList.remove("skeleton");

    setMetric(els.tempValue, t); // số trượt mượt sang giá trị mới (count-up)
    setMetric(els.humValue, h);

    g_lastHum = h;
    renderHumContext(); // vị trí độ ẩm so với ngưỡng Deadband

    // Dòng "Cập nhật": lưu mốc rồi hiển thị dạng tương đối ("vừa xong", "X giây trước")
    // — timer 5s trong attachListeners tự đếm tiếp khi không có dữ liệu mới.
    g_hasSensorData = t !== null || h !== null;
    g_lastSensorTs = s.timestamp && s.timestamp > 0 ? s.timestamp : 0;

    // Mốc thời gian THEO ĐỒNG HỒ TRÌNH DUYỆT lúc nhận /sensor — dùng làm tín hiệu
    // online dự phòng trong isDeviceOnline(), KHÔNG phụ thuộc lastSeen/timestamp do
    // ESP tự tính (những field đó = 0 nếu ESP chưa đồng bộ NTP được, xem ghi chú ở
    // isDeviceOnline()). /sensor chỉ được ESP đẩy khi nó đang thật sự sống nên bản
    // thân việc listener này bắn là đủ để coi là "còn kết nối", bất kể NTP.
    g_lastSensorClientMs = Date.now();

    renderUpdatedAt();

    // Đẩy vào biểu đồ (chỉ khi có ít nhất 1 giá trị hợp lệ), kèm trạng thái máy phun
    // TẠI THỜI ĐIỂM NÀY (từ /status gần nhất) để tô dải "đang phun" trên nền biểu đồ.
    if (t !== null || h !== null) {
      const mistNow = g_lastStatus ? g_lastStatus.mist === true : null;
      pushPoint(t !== null ? t : NaN, h !== null ? h : NaN, s.timestamp, mistNow);
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

  // /webSettings — CHỈ web dùng (onlineTimeoutSec), tách khỏi /config vì ESP không cần biết.
  unsub.push(listenWebSettings((ws) => {
    renderWebSettings(ws);
  }));

  // Timer 5s: tự lật offline khi ESP ngừng cập nhật (onValue chỉ bắn khi dữ liệu ĐỔI)
  // + tự đếm tiếp dòng "Cập nhật: X giây trước". Dọn trong leaveDashboard.
  if (!g_onlineTimer) {
    g_onlineTimer = setInterval(() => {
      renderOnline();
      renderUpdatedAt();
    }, 5000);
  }
}

// ============================================================================
//  PHÁT HIỆN ONLINE/OFFLINE — 2 TÍN HIỆU ĐỘC LẬP, chỉ cần 1 cái mới là coi online
//
//  Bài toán presence: thiết bị KHÔNG thể tự báo "tôi offline" (mất mạng thì báo
//  sao được). Vì vậy VIEWER (web) tự suy: nếu lastSeen quá cũ so với giờ hiện tại
//  -> coi như mất kết nối. Không cần backend/service chạy ngầm.
//
//  ESP đẩy /status (kèm lastSeen mới) mỗi ~4s -> quá ONLINE_TIMEOUT_S không thấy
//  cập nhật thì lật sang offline. Vì onValue chỉ bắn khi dữ liệu ĐỔI (ESP chết thì
//  ngừng bắn), ta chạy thêm 1 timer client tự đánh giá lại định kỳ.
//
//  Tín hiệu 1 — lastSeen: dựa vào lastSeen (epoch giây từ NTP của ESP) so với đồng
//  hồ trình duyệt. Vấn đề: lastSeen = 0 vĩnh viễn nếu ESP CHƯA/KHÔNG đồng bộ được
//  SNTP (xem esp1_main/main.cpp, nowEpoch()) — lúc đó tín hiệu này luôn báo offline
//  dù thiết bị vẫn đang chạy/đẩy dữ liệu bình thường.
//
//  Tín hiệu 2 — đã nhận /sensor mới gần đây, đo bằng ĐỒNG HỒ TRÌNH DUYỆT (không
//  dùng field timestamp trong payload vì nó cũng lấy từ nowEpoch(), dính lỗi y hệt
//  tín hiệu 1). ESP chỉ đẩy /sensor khi đang thật sự sống nên đây là tín hiệu dự
//  phòng đáng tin cậy, không phụ thuộc NTP của ESP.
//
//  isDeviceOnline() coi là online nếu MỘT TRONG HAI tín hiệu còn mới.
// ============================================================================
const ONLINE_TIMEOUT_DEFAULT_S = 15;  // fallback khi /webSettings chưa có onlineTimeoutSec
let g_onlineTimeoutSec = ONLINE_TIMEOUT_DEFAULT_S; // lấy từ /webSettings — align với chu kỳ push firmware
let g_lastStatus = null;       // /status gần nhất (để timer re-check)
let g_lastSensorClientMs = 0;  // Date.now() lúc nhận /sensor gần nhất (tín hiệu 2, xem trên)
let g_onlineTimer = null;      // timer tự lật offline khi lastSeen quá hạn
let g_correctingOnline = false; // chặn ghi chồng khi đang chờ round-trip ghi /status/esp1Online

// Độ ẩm gần nhất + ngưỡng Min/Max từ /config — để renderHumContext() ghép 2 nguồn
// (/sensor và /config về không cùng lúc, bên nào về sau thì gọi lại là đủ).
let g_lastHum = null;
let g_cfgMin = null;
let g_cfgMax = null;

let g_prevOnline = null;   // trạng thái online lần render trước — bắn toast khi ĐỔI (null = chưa biết)
let g_lastSensorTs = 0;    // timestamp /sensor gần nhất (epoch giây) — cho dòng "Cập nhật: X trước"
let g_hasSensorData = false; // đã từng nhận số đo (dù thiết bị chưa gửi timestamp)
let g_serverCfg = null;    // {mode,hset,deadband} MỚI NHẤT từ /config — dùng dirty-check khi Lưu cấu hình
let g_serverOnlineTimeoutSec = null; // onlineTimeoutSec MỚI NHẤT từ /webSettings — dirty-check tương tự

function isDeviceOnline(st) {
  const nowMs = Date.now();

  // Tín hiệu 1: /status/lastSeen (epoch giây do ESP tự tính qua NTP).
  let onlineByStatus = false;
  if (st) {
    const lastSeen = Number(st.lastSeen) || 0;
    if (lastSeen > 0) {                         // 0 = chưa có NTP / chưa từng thấy heartbeat
      const nowSec = Math.floor(nowMs / 1000);
      onlineByStatus = (nowSec - lastSeen) < g_onlineTimeoutSec;
    }
  }

  // Tín hiệu 2: mới nhận /sensor gần đây (đồng hồ trình duyệt) — vẫn đúng dù ESP
  // chưa đồng bộ NTP được (xem ghi chú khối trên).
  const onlineBySensor =
    g_lastSensorClientMs > 0 && (nowMs - g_lastSensorClientMs) < g_onlineTimeoutSec * 1000;

  return onlineByStatus || onlineBySensor;
}

// Đổi số giây thành chuỗi "X giây/phút/giờ trước" cho label mất kết nối.
function formatAgo(sec) {
  if (sec < 60) return sec + " giây trước";
  const m = Math.floor(sec / 60);
  if (m < 60) return m + " phút trước";
  return Math.floor(m / 60) + " giờ trước";
}

function renderOnline() {
  const online = isDeviceOnline(g_lastStatus);
  els.onlineDot.className = "dot " + (online ? "dot-online" : "dot-offline");

  // Khi offline: nói rõ dữ liệu cũ bao lâu (tính từ lastSeen) thay vì chỉ "Mất kết nối".
  let offText = "Mất kết nối";
  const lastSeen = g_lastStatus ? Number(g_lastStatus.lastSeen) || 0 : 0;
  if (!online && lastSeen > 0) {
    const age = Math.floor(Date.now() / 1000) - lastSeen;
    if (age > 0) offText += " — dữ liệu cũ " + formatAgo(age);
  }
  els.onlineText.textContent = online ? "Trực tuyến" : offText;
  els.onlineText.className = online ? "text-green-400 font-medium" : "text-gray-400 font-medium";

  // Chip trên header — cùng nội dung, nhưng LUÔN nhìn thấy vì header dính khi cuộn.
  if (els.hdrOnlineDot) {
    els.hdrOnlineDot.className = "dot " + (online ? "dot-online" : "dot-offline");
    els.hdrOnlineText.textContent = online ? "Trực tuyến" : "Mất kết nối";
    els.hdrOnlineText.className = "text-xs font-medium " + (online ? "text-green-400" : "text-slate-400");
  }

  // Làm mờ hàng metric khi offline — số đang xem là số CŨ, tránh tưởng là dữ liệu sống.
  if (els.metricSection) {
    els.metricSection.classList.toggle("opacity-50", !online);
    els.metricSection.classList.toggle("saturate-50", !online);
  }

  // Toast khi trạng thái ĐỔI (không bắn ở lần render đầu — g_prevOnline còn null,
  // tránh toast "kết nối lại" oan mỗi lần mở trang).
  if (g_prevOnline !== null && g_prevOnline !== online) {
    if (online) showToast("✓ Đã kết nối lại với thiết bị", "ok");
    else showToast("⚠ Mất kết nối với thiết bị", "error");
  }
  g_prevOnline = online;

  maybeCorrectEsp1Online(online);
}

// Dòng "Cập nhật": thời gian TƯƠNG ĐỐI tự đếm (timer 5s gọi lại), hover hiện giờ đầy đủ.
function renderUpdatedAt() {
  if (g_lastSensorTs > 0) {
    const age = Math.floor(Date.now() / 1000) - g_lastSensorTs;
    // age < 5 (kể cả âm nhẹ do lệch đồng hồ ESP/máy client) -> "vừa xong"
    els.updatedAt.textContent = "Cập nhật: " + (age < 5 ? "vừa xong" : formatAgo(age));
    els.updatedAt.title = new Date(g_lastSensorTs * 1000).toLocaleString("vi-VN");
  } else if (g_hasSensorData) {
    // Có số đo nhưng thiết bị chưa gửi mốc thời gian (chưa đồng bộ NTP) — KHÔNG hiển thị
    // giờ máy client để tránh tưởng nhầm dữ liệu luôn "mới".
    els.updatedAt.textContent = "Cập nhật: — (thiết bị chưa gửi mốc thời gian)";
    els.updatedAt.title = "";
  } else {
    els.updatedAt.textContent = "Cập nhật: —";
    els.updatedAt.title = "";
  }
}

// Số metric trượt mượt sang giá trị mới (count-up ~0.5s) thay vì nhảy đột ngột.
// Giá trị đích lưu ở data-val: nếu giá trị MỚI HƠN đến giữa chừng, vòng rAF cũ tự
// dừng (data-val không còn khớp) — không bao giờ có 2 animation giành nhau 1 phần tử.
function setMetric(el, val) {
  if (val === null) {
    el.textContent = "--";
    delete el.dataset.val;
    return;
  }
  const from = Number(el.dataset.val);
  el.dataset.val = String(val);
  // Chưa có giá trị cũ (lần đầu) hoặc thay đổi quá nhỏ -> đặt thẳng.
  if (!Number.isFinite(from) || Math.abs(from - val) < 0.05) {
    el.textContent = val.toFixed(1);
    return;
  }
  const t0 = performance.now();
  const DUR = 500;
  const step = (now) => {
    if (el.dataset.val !== String(val)) return; // có giá trị mới hơn — nhường
    const k = Math.min(1, (now - t0) / DUR);
    const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
    el.textContent = (from + (val - from) * eased).toFixed(1);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ============================================================================
//  VỊ TRÍ ĐỘ ẨM SO VỚI NGƯỠNG DEADBAND (card Độ ẩm)
//  Ghép /sensor (g_lastHum) + /config (g_cfgMin/g_cfgMax): thanh mini có vùng
//  ổn định tô nhạt + chấm trắng ở vị trí hiện tại, kèm 1 dòng chữ nói thẳng
//  "đang ở đâu -> máy phun làm gì" (logic Deadband, CONTRACT mục 3).
// ============================================================================
function renderHumContext() {
  if (!els.humContext) return;
  const h = g_lastHum, min = g_cfgMin, max = g_cfgMax;

  if (h === null || min === null || max === null) {
    if (els.humMeter) els.humMeter.hidden = true;
    els.humContext.textContent = "—";
    els.humContext.className = "text-xs text-slate-500 mt-1.5";
    return;
  }

  // Thanh mini: vùng ổn định Min..Max + chấm ở vị trí độ ẩm (thang 0-100 %RH).
  if (els.humMeter) {
    els.humMeter.hidden = false;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    els.humZone.style.left = clamp(min) + "%";
    els.humZone.style.width = Math.max(0, clamp(max) - clamp(min)) + "%";
    els.humDot.style.left = clamp(h) + "%";
  }

  // Dòng ngữ cảnh: dưới Min -> đang cần phun; trên Max -> ngưng phun; giữa -> ổn định.
  const hTxt = h.toFixed(1);
  if (h < min) {
    els.humContext.textContent = `Dưới ngưỡng bật (${hTxt} < ${min}) → máy phun chạy`;
    els.humContext.className = "text-xs text-sky-300 mt-1.5";
  } else if (h > max) {
    els.humContext.textContent = `Trên ngưỡng tắt (${hTxt} > ${max}) → máy phun tắt`;
    els.humContext.className = "text-xs text-amber-300 mt-1.5";
  } else {
    els.humContext.textContent = `Trong vùng ổn định ${min}–${max} %RH`;
    els.humContext.className = "text-xs text-emerald-300 mt-1.5";
  }
}

// Field /status/esp1Online do ESP tự ghi, không tự sửa khi mất mạng (xem CONTRACT.md).
// Khi có admin đang mở web, tiện tay sửa lại field thô này cho khớp — CHỈ để ai xem trực
// tiếp Firebase Console cũng thấy đúng, KHÔNG phải nguồn sự thật cho label trên (label luôn
// tự tính từ lastSeen ở renderOnline(), đúng ngay cả khi field này đang lệch).
function maybeCorrectEsp1Online(online) {
  if (!isAdmin || g_correctingOnline || !g_lastStatus) return;
  if (typeof g_lastStatus.esp1Online !== "boolean" || g_lastStatus.esp1Online === online) return;
  g_correctingOnline = true;
  correctEsp1Online(online).finally(() => { g_correctingOnline = false; });
}

// ============================================================================
//  RENDER TRẠNG THÁI THIẾT BỊ
// ============================================================================
function renderStatus(st) {
  // Online: suy từ lastSeen (xem khối trên) thay vì tin cờ esp1Online.
  g_lastStatus = st;
  renderOnline(); // (timer 5s re-check tạo trong attachListeners)

  // Máy phun (mist).
  setBadge(els.stMist, st.mist === true,
    { on: "Đang phun", off: "Tắt", onClass: "bg-sky-500/20 text-sky-300 mist-on", offClass: "bg-gray-600/30 text-gray-300" });

  // Mức nước (tank): SỐ 0-3, ứng với số đầu dò (trong 3 đầu dò M2/M3/M4) đang ngập nước
  // (CONTRACT mục 2). 0 = rất thấp/cạn, 1 = thấp, 2 = bình thường, 3 = đầy.
  const TANK_LEVELS = {
    0: { text: "Rất thấp — cần châm nước", cls: "bg-red-500/25 text-red-300", fill: "#ef4444" },
    1: { text: "Thấp", cls: "bg-amber-500/20 text-amber-300", fill: "#f59e0b" },
    2: { text: "Bình thường", cls: "bg-sky-500/20 text-sky-300", fill: "#38bdf8" },
    3: { text: "Đầy nước", cls: "bg-green-500/20 text-green-300", fill: "#22c55e" },
  };
  const tankInfo = TANK_LEVELS[st.tank] || { text: "—", cls: "bg-gray-600/30 text-gray-300", fill: "#475569" };
  els.stTank.textContent = tankInfo.text;
  els.stTank.className = "px-3 py-1 rounded-full text-sm font-semibold " + tankInfo.cls;

  // Gauge SCADA: mực nước dâng trong bình theo % (0/1/2/3 -> 0/33/67/100%).
  // Dùng CSS transform: scaleY() (neo đáy qua transform-origin trong index.html) thay vì
  // set attribute height/y trực tiếp — SVG height/y là presentation attribute, bị class
  // CSS transition-* đè lên không ổn định (đã verify bằng browser: computed style "kẹt"
  // ở giá trị cũ). transform là thuộc tính CSS chuẩn, animate mượt và đúng.
  if (els.stTankFill) {
    const level = typeof st.tank === "number" && TANK_LEVELS[st.tank] ? st.tank : 0;
    const pct = level / 3;
    els.stTankFill.style.transform = "scaleY(" + pct + ")";
    els.stTankFill.setAttribute("fill", tankInfo.fill);

    // Dải sóng gợn: cùng toạ độ đáy (y=152) và chiều cao lòng bồn (134) với stTankFill —
    // translateY (KHÔNG phải attribute y, tránh đúng lỗi CSS-transition-đè-attribute đã gặp)
    // để mặt sóng luôn nằm ngay đỉnh mực nước hiện tại. Cuộn ngang liên tục do styles.css.
    if (els.stTankWave) {
      els.stTankWave.style.transform = "translateY(" + (152 - 134 * pct) + "px)";
    }

    // % mức nước giữa bồn (0/1/2/3 -> 0/33/67/100%)
    if (els.stTankPct) {
      els.stTankPct.textContent = Math.round(pct * 100) + "%";
    }

    // Thang chú giải 4 mức: dòng đang active sáng + đậm, các dòng khác mờ đi
    if (els.tankLegend) {
      els.tankLegend.querySelectorAll("[data-tank-level]").forEach((row) => {
        const active = Number(row.dataset.tankLevel) === level;
        row.classList.toggle("opacity-40", !active);
        row.classList.toggle("text-slate-200", active);
        row.classList.toggle("font-semibold", active);
      });
    }
  }

  // Bơm châm (pump) — TẠM ẨN (2026-07-14, xem web/index.html).
  // setBadge(els.stPump, st.pump === true,
  //   { on: "Đang bơm", off: "Tắt", onClass: "bg-amber-500/20 text-amber-300", offClass: "bg-gray-600/30 text-gray-300" });

  // Gateway — TẠM ẨN (2026-07-14, xem web/index.html).
  // const gw = st.gateway || "—";
  // els.stGateway.textContent = gw === "esp2" ? "ESP2 (dự phòng)" : (gw === "esp1" ? "ESP1 (chính)" : "—");
  // els.stGateway.className = "px-3 py-1 rounded-full text-sm font-semibold " +
  //   (gw === "esp2" ? "bg-purple-500/20 text-purple-300" : "bg-indigo-500/20 text-indigo-300");
}

function setBadge(el, on, opt) {
  el.textContent = on ? opt.on : opt.off;
  el.className = "px-3 py-1 rounded-full text-sm font-semibold " + (on ? opt.onClass : opt.offClass);
}

// ============================================================================
//  RENDER CẤU HÌNH (/config)
// ============================================================================
const VALID_MODES = ["off", "continuous", "intermittent"];
const MODE_LABELS = {
  off: "Tắt (off)",
  continuous: "Liên tục (continuous)",
  intermittent: "Ngắt quãng (intermittent)"
};

// Đặt giá trị mode + đồng bộ label hiển thị trên nút dropdown tự dựng.
function setModeValue(mode) {
  els.cfgMode.value = mode;
  els.modeLabel.textContent = MODE_LABELS[mode] || mode;
}

function renderConfig(cfg) {
  const hset = typeof cfg.hset === "number" ? cfg.hset : 70;
  const deadband = typeof cfg.deadband === "number" ? cfg.deadband : 5;
  const mode = VALID_MODES.includes(cfg.mode) ? cfg.mode : "continuous";
  g_serverCfg = { mode, hset, deadband };

  // Ngưỡng Min/Max suy từ GIÁ TRỊ SERVER (không phải giá trị đang gõ trong form):
  // đẩy sang biểu đồ (vùng Deadband) + card Độ ẩm (thanh vị trí + dòng ngữ cảnh).
  // Cập nhật kể cả khi admin đang gõ form — 2 chỗ này hiển thị cấu hình ĐANG chạy.
  g_cfgMin = hset - deadband;
  g_cfgMax = hset + deadband;
  setDeadbandBand(g_cfgMin, g_cfgMax);
  renderHumContext();

  // Nếu admin đang chỉnh BẤT KỲ field nào trong form thì KHÔNG ghi đè (tránh mất giá
  // trị đang gõ ở field còn lại khi /config cập nhật từ server). Chỉ cập nhật phần text.
  const editing = els.cfgForm.contains(document.activeElement);
  if (!editing) {
    setModeValue(mode);
    els.cfgHset.value = hset;
    els.cfgDeadband.value = deadband;
    updateDerived();
  }

  els.cfgLastUpdate.textContent = cfg.lastUpdate || "—";
  els.cfgUpdatedBy.textContent = cfg.updatedBy || "—";

  // Điều khiển bơm thủ công — TẠM ẨN (2026-07-14, xem web/index.html + docs/TIEN-DO-2026-07-02.md).
  // g_pumpManualOn = cfg.pumpManualOn === true;
  // const pumpFeatureOn = cfg.pumpControlEnabled === true;
  // els.pumpControlWrap.hidden = !pumpFeatureOn;
  // if (pumpFeatureOn) {
  //   els.btnTogglePump.textContent = g_pumpManualOn ? "Đang BẬT — bấm để tắt" : "Đang TẮT — bấm để bật";
  //   els.btnTogglePump.disabled = !isAdmin;
  // }
}

// /webSettings — CHỈ web dùng (ngưỡng online), KHÔNG liên quan tới ESP nên tách khỏi /config
// (ESP1 sẽ subscribe /config cho luồng 2 chiều với sensor node, không cần biết field này).
function renderWebSettings(ws) {
  const onlineTimeout = typeof ws.onlineTimeoutSec === "number" ? ws.onlineTimeoutSec : ONLINE_TIMEOUT_DEFAULT_S;
  g_serverOnlineTimeoutSec = onlineTimeout;

  // Dùng ngay (không chờ "editing") — đây là giá trị isDeviceOnline() đọc mỗi lần timer
  // re-check, cần cập nhật kể cả khi admin đang gõ dở field khác trong form.
  g_onlineTimeoutSec = onlineTimeout;

  const editing = els.cfgForm.contains(document.activeElement);
  if (!editing) {
    els.cfgOnlineTimeout.value = onlineTimeout;
  }
}

// ============================================================================
//  DROPDOWN "Chế độ phun sương" — tự dựng bằng div (xem ghi chú trong index.html
//  vì <select> gốc trên nhiều máy Windows/Chrome vẫn ra nền trắng dù đã style CSS).
// ============================================================================
els.modeBtn.addEventListener("click", () => {
  if (els.modeBtn.disabled) return;
  els.modeList.hidden = !els.modeList.hidden;
});

els.modeList.querySelectorAll("li").forEach((li) => {
  li.addEventListener("click", () => {
    setModeValue(li.dataset.value);
    els.modeList.hidden = true;
  });
});

// Đóng dropdown khi click ra ngoài.
document.addEventListener("click", (e) => {
  if (!els.modeBtn.contains(e.target) && !els.modeList.contains(e.target)) {
    els.modeList.hidden = true;
  }
});

// Hiển thị Max = hset + deadband, Min = hset - deadband (suy ra).
// KHÔNG toFixed(0): deadband lẻ (vd 1.5) mà làm tròn thì ô hiển thị lệch ±0.5 so với
// ngưỡng THẬT firmware dùng (vd 41.5 hiện thành "42") — gây hiểu nhầm đã gặp thực tế.
function fmtRH(v) {
  return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + " %RH";
}
function updateDerived() {
  const hset = Number(els.cfgHset.value);
  const deadband = Number(els.cfgDeadband.value);
  if (Number.isFinite(hset) && Number.isFinite(deadband)) {
    els.cfgMax.textContent = fmtRH(hset + deadband);
    els.cfgMin.textContent = fmtRH(hset - deadband);
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
    els.cfgMode.disabled = false;
    els.modeBtn.disabled = false;
    els.cfgHset.disabled = false;
    els.cfgDeadband.disabled = false;
    els.cfgOnlineTimeout.disabled = false;
    els.cfgBtn.disabled = false;
    els.cfgBtn.hidden = false;
    els.cfgReadonlyNote.hidden = true;
    // els.btnTogglePump.disabled = false; // TẠM ẨN cùng tính năng điều khiển bơm thủ công
  } else {
    els.adminBadge.textContent = "Khách (chỉ xem)";
    els.adminBadge.className = "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-500/20 text-gray-300";
    els.cfgMode.disabled = true;
    els.modeBtn.disabled = true;
    els.modeList.hidden = true; // đóng dropdown nếu đang mở lúc bị hạ quyền
    els.cfgHset.disabled = true;
    els.cfgDeadband.disabled = true;
    els.cfgOnlineTimeout.disabled = true;
    els.cfgBtn.disabled = true;
    // els.btnTogglePump.disabled = true; // TẠM ẨN cùng tính năng điều khiển bơm thủ công
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

  const mode = els.cfgMode.value;
  const hset = Number(els.cfgHset.value);
  const deadband = Number(els.cfgDeadband.value);
  const onlineTimeoutSec = Number(els.cfgOnlineTimeout.value);

  // Validate (0<=hset<=100, 0<=deadband<=50, 5<=onlineTimeoutSec<=300, mode hợp lệ — khớp rules).
  if (!VALID_MODES.includes(mode)) {
    return showCfgMsg("Chế độ phun sương không hợp lệ.", "error");
  }
  if (!Number.isFinite(hset) || hset < 0 || hset > 100) {
    return showCfgMsg("Hset phải nằm trong khoảng 0–100 %RH.", "error");
  }
  if (!Number.isFinite(deadband) || deadband < 0 || deadband > 50) {
    return showCfgMsg("Deadband phải nằm trong khoảng 0–50 %RH.", "error");
  }
  if (!Number.isFinite(onlineTimeoutSec) || onlineTimeoutSec < 5 || onlineTimeoutSec > 300) {
    return showCfgMsg("Ngưỡng offline phải nằm trong khoảng 5–300 giây.", "error");
  }

  // Dirty-check: /config (mode/hset/deadband, ESP1 đọc) và /webSettings (onlineTimeoutSec,
  // chỉ web dùng) là 2 nguồn sự thật riêng. Chỉ ghi path nào THỰC SỰ đổi so với giá trị
  // server gần nhất — tránh sửa mỗi ngưỡng offline cũng làm /config đổi lastUpdate (và ngược lại).
  const cfgChanged = !g_serverCfg ||
    g_serverCfg.mode !== mode || g_serverCfg.hset !== hset || g_serverCfg.deadband !== deadband;
  const webSettingsChanged = g_serverOnlineTimeoutSec === null || g_serverOnlineTimeoutSec !== onlineTimeoutSec;

  if (!cfgChanged && !webSettingsChanged) {
    return showCfgMsg("Không có gì thay đổi để lưu.", "ok");
  }

  els.cfgBtn.disabled = true;
  const oldLabel = els.cfgBtn.textContent;
  els.cfgBtn.textContent = "Đang lưu...";

  try {
    const email = currentUser ? currentUser.email : "";
    const writes = [];
    if (cfgChanged) writes.push(writeConfig({ mode, hset, deadband }, email));
    if (webSettingsChanged) writes.push(writeWebSettings(onlineTimeoutSec, email));
    await Promise.all(writes);
    els.cfgMsg.hidden = true; // dọn thông báo lỗi cũ (nếu có) — thành công báo bằng toast
    showToast("✓ Đã lưu cấu hình", "ok");
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

// ============================================================================
//  TOGGLE BƠM THỦ CÔNG — TẠM ẨN (2026-07-14): chưa có phần cứng bơm thật, nút bấm
//  không phản ánh được vào badge trạng thái (ESP1 chưa đọc /config/pumpManualOn) nên
//  gây hiểu nhầm. Gỡ comment khối này + els.pumpControlWrap/btnTogglePump/g_pumpManualOn
//  ở trên + khối HTML trong web/index.html khi Embed xong phần cứng bơm.
// ============================================================================
// els.btnTogglePump.addEventListener("click", async () => {
//   if (!isAdmin) return; // chốt chặn an toàn (nút đã disabled cho non-admin).
//
//   const nextOn = !g_pumpManualOn;
//   els.btnTogglePump.disabled = true;
//   const oldLabel = els.btnTogglePump.textContent;
//   els.btnTogglePump.textContent = "Đang gửi...";
//
//   try {
//     await writePumpManual(nextOn, currentUser ? currentUser.email : "");
//     // Không tự set g_pumpManualOn ở đây — chờ renderConfig() nhận lại từ onValue("/config")
//     // để đảm bảo UI luôn khớp giá trị THẬT trên Firebase (nguồn sự thật duy nhất).
//   } catch (err) {
//     console.error("[app] writePumpManual lỗi:", err);
//     alert("Lỗi điều khiển bơm: " + (err && err.message ? err.message : "không xác định."));
//   } finally {
//     els.btnTogglePump.disabled = !isAdmin;
//     if (els.btnTogglePump.textContent === "Đang gửi...") els.btnTogglePump.textContent = oldLabel;
//   }
// });

// ============================================================================
//  TOAST NỔI (2026-07-14) — thông báo trượt lên góc phải dưới rồi tự biến mất.
//  Dùng cho thông báo THÀNH CÔNG (nổi bật, không bị bỏ qua như dòng text dưới
//  form); lỗi vẫn dùng showCfgMsg inline cạnh form để đọc được lâu.
// ============================================================================
function showToast(text, type = "ok") {
  if (!els.toastWrap) return;
  const t = document.createElement("div");
  t.className = "toast-item px-4 py-3 rounded-xl text-sm font-semibold shadow-2xl border " +
    (type === "ok"
      ? "bg-emerald-600/95 border-emerald-400/40 text-white"
      : "bg-red-600/95 border-red-400/40 text-white");
  t.textContent = text;
  els.toastWrap.appendChild(t);

  // Sau 3.2s: mờ dần (.toast-out có transition) rồi gỡ khỏi DOM.
  setTimeout(() => {
    t.classList.add("toast-out");
    setTimeout(() => t.remove(), 400);
  }, 3200);
}

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
