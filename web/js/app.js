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
  stTankFill: $("stTankFill"), // tank gauge SVG (bình chứa) — xem renderStatus
  stTankWave: $("stTankWave"), // dải sóng gợn trên mặt nước — xem renderStatus
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
  alarmBox: $("alarmBox")
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

  // /webSettings — CHỈ web dùng (onlineTimeoutSec), tách khỏi /config vì ESP không cần biết.
  unsub.push(listenWebSettings((ws) => {
    renderWebSettings(ws);
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
const ONLINE_TIMEOUT_DEFAULT_S = 15;  // fallback khi /webSettings chưa có onlineTimeoutSec
let g_onlineTimeoutSec = ONLINE_TIMEOUT_DEFAULT_S; // lấy từ /webSettings — align với chu kỳ push firmware
let g_lastStatus = null;       // /status gần nhất (để timer re-check)
let g_onlineTimer = null;      // timer tự lật offline khi lastSeen quá hạn
let g_correctingOnline = false; // chặn ghi chồng khi đang chờ round-trip ghi /status/esp1Online

function isDeviceOnline(st) {
  if (!st) return false;
  const lastSeen = Number(st.lastSeen) || 0;
  if (lastSeen <= 0) return false;              // chưa có NTP / chưa từng thấy heartbeat
  const nowSec = Math.floor(Date.now() / 1000);
  return (nowSec - lastSeen) < g_onlineTimeoutSec;
}

function renderOnline() {
  const online = isDeviceOnline(g_lastStatus);
  els.onlineDot.className = "dot " + (online ? "dot-online" : "dot-offline");
  els.onlineText.textContent = online ? "Trực tuyến" : "Mất kết nối";
  els.onlineText.className = online ? "text-green-400 font-medium" : "text-gray-400 font-medium";
  maybeCorrectEsp1Online(online);
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
  renderOnline();
  // Bật timer tự lật offline khi ESP ngừng cập nhật (chỉ tạo 1 lần).
  if (!g_onlineTimer) g_onlineTimer = setInterval(renderOnline, 5000);

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

    // Dải sóng gợn: cùng toạ độ đáy (62) và tỉ lệ với stTankFill — translateY (KHÔNG phải
    // attribute y, tránh đúng lỗi CSS-transition-đè-attribute đã gặp) để mặt sóng luôn nằm
    // ngay đỉnh mực nước hiện tại. Cuộn ngang liên tục do class .tank-wave-path (styles.css).
    if (els.stTankWave) {
      els.stTankWave.style.transform = "translateY(" + (62 - 60 * pct) + "px)";
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

  els.cfgBtn.disabled = true;
  const oldLabel = els.cfgBtn.textContent;
  els.cfgBtn.textContent = "Đang lưu...";

  try {
    // Ghi 2 path RIÊNG: /config (mode/hset/deadband — ESP1 đọc) và /webSettings
    // (onlineTimeoutSec — chỉ web dùng). Cùng 1 form nhưng khác nguồn sự thật.
    const email = currentUser ? currentUser.email : "";
    await Promise.all([
      writeConfig({ mode, hset, deadband }, email),
      writeWebSettings(onlineTimeoutSec, email)
    ]);
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
