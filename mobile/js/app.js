// ============================================================================
//  app.js — Logic chính của PWA Provisioning (bản GỌN).
//
//  Vai trò của app (đúng chuẩn ngành IoT — như cấu hình camera WiFi):
//    App chỉ làm 1 việc: gửi CẤU HÌNH MẠNG cho ESP đang phát SoftAP.
//    Người dùng chỉ cần nhập: WiFi SSID + password + MAC của ESP còn lại.
//
//  Luồng sử dụng:
//    1. Giữ nút BOOT trên ESP lúc cấp nguồn -> ESP phát AP "PROV-...".
//    2. Điện thoại kết nối vào AP đó (chung mạng với ESP).
//    3. Mở app -> nhập WiFi + MAC (bấm "Quét QR" để điền MAC nhanh, hoặc gõ tay).
//    4. POST JSON {ssid, password, peerMac} -> http://192.168.4.1/provision.
//    5. ESP lưu Preferences -> reboot -> nối WiFi nhà -> online.
//
//  Tài khoản Firebase của thiết bị và hset/deadband KHÔNG còn hỏi ở đây:
//    - devEmail/devPass: hardcode trong firmware (xem esp1_main/main.cpp).
//    - hset/deadband: dùng mặc định firmware, admin chỉnh sau qua web dashboard.
//
//  QR (CONTRACT mục 6) giờ chỉ là TIỆN ÍCH lấy MAC: quét QR in trên ESP kia để
//  điền sẵn ô "MAC của ESP còn lại". Nhập tay vẫn dùng được bình thường.
// ============================================================================

import { startQrScan, stopQrScan, isQrScanning } from "./qr.js";

// ---------------------------------------------------------------------------
// Hằng số cấu hình
// ---------------------------------------------------------------------------
const DEFAULT_IP = "192.168.4.1"; // IP SoftAP mặc định của ESP (CONTRACT mục 5)
const MOCK_BASE = "http://localhost:8080"; // mock-esp-server khi chạy "Chế độ Test"

// ---------------------------------------------------------------------------
// Tiện ích DOM
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

// ---------------------------------------------------------------------------
// Khởi tạo sau khi DOM sẵn sàng
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  updateTargetPreview();
  applySendToggles(); // bật/mờ nhóm WiFi/MAC theo checkbox
  updateNetStatus(); // trạng thái online/offline của trình duyệt
  detectMixedContentRisk(); // cảnh báo sớm nếu PWA đang chạy HTTPS
  registerServiceWorker();
});

function bindEvents() {
  // --- Quét QR để điền MAC ---
  $("#btn-scan").addEventListener("click", onClickScan);
  $("#btn-stop-scan").addEventListener("click", stopScanning);

  // --- Checkbox chọn phần cần gửi (WiFi / MAC) ---
  $("#send-wifi").addEventListener("change", applySendToggles);
  $("#send-mac").addEventListener("change", applySendToggles);

  // --- Nút chẩn đoán: gọi GET /provision của ESP ---
  $("#btn-test-info").addEventListener("click", testDeviceInfo);

  // --- Nút khởi động lại: gọi POST /reboot của ESP ---
  $("#btn-reboot").addEventListener("click", onClickReboot);

  // --- Toggle Chế độ Test (mock server) ---
  $("#test-mode").addEventListener("change", () => {
    updateTargetPreview();
    detectMixedContentRisk();
  });

  // --- Đồng bộ IP nhập tay vào preview ---
  $("#ip").addEventListener("input", updateTargetPreview);

  // --- Trạng thái online/offline của trình duyệt ---
  window.addEventListener("online", updateNetStatus);
  window.addEventListener("offline", updateNetStatus);

  // --- Hiển thị/ẩn mật khẩu WiFi ---
  $("#toggle-pass").addEventListener("click", () => {
    const inp = $("#wifi-pass");
    inp.type = inp.type === "password" ? "text" : "password";
    $("#toggle-pass").textContent = inp.type === "password" ? "Hiện" : "Ẩn";
  });

  // --- Submit form provisioning ---
  $("#prov-form").addEventListener("submit", onSubmitProvision);

  // --- Nút thử lại sau khi có kết quả ---
  $("#btn-reset-result").addEventListener("click", () => {
    hide($("#result-card"));
    show($("#form-card"));
  });
}

// ---------------------------------------------------------------------------
// QR — quét để điền MAC của ESP còn lại
// ---------------------------------------------------------------------------
function onClickScan() {
  if (isQrScanning()) return;
  show($("#qr-reader"));
  hide($("#btn-scan"));
  show($("#btn-stop-scan"));
  setScanStatus("Đang mở camera… hướng vào mã QR in trên ESP kia.", "muted");

  startQrScan(
    (data) => {
      // Quét thành công: chỉ lấy MAC điền vào ô peerMac (bỏ qua các field khác của QR).
      const mac = (data.mac || "").toUpperCase();
      resetScanButtons();
      if (mac) {
        $("#peer-mac").value = mac;
        setScanStatus("Đã điền MAC: " + mac, "ok");
      } else {
        setScanStatus("QR không chứa MAC — vui lòng nhập tay.", "err");
      }
    },
    (errMsg) => {
      setScanStatus(errMsg, "err");
      stopQrScan(); // nhả camera + đồng bộ state scanner
      resetScanButtons();
    }
  );
}

function stopScanning() {
  stopQrScan();
  resetScanButtons();
  setScanStatus("Đã dừng quét.", "muted");
}

function resetScanButtons() {
  hide($("#qr-reader"));
  hide($("#btn-stop-scan"));
  show($("#btn-scan"));
}

function setScanStatus(msg, kind) {
  const el = $("#scan-status");
  el.textContent = msg;
  el.className =
    "text-sm mt-2 " +
    (kind === "ok"
      ? "text-emerald-600"
      : kind === "err"
      ? "text-red-600"
      : "text-slate-500");
  show(el);
}

// ---------------------------------------------------------------------------
// Tính URL đích + preview cho người dùng
// ---------------------------------------------------------------------------
function getTargetBase() {
  if ($("#test-mode").checked) return MOCK_BASE;
  const ip = ($("#ip").value || DEFAULT_IP).trim();
  return "http://" + ip;
}

function updateTargetPreview() {
  $("#target-url").textContent = getTargetBase() + "/provision";
}

// ---------------------------------------------------------------------------
// Checkbox chọn phần cần gửi: làm mờ + khoá nhóm khi bỏ tick (chỉ để rõ ràng;
// việc gửi hay không do onSubmitProvision quyết theo trạng thái checkbox).
// ---------------------------------------------------------------------------
function applySendToggles() {
  const wifiOn = $("#send-wifi").checked;
  const macOn = $("#send-mac").checked;
  toggleGroup($("#wifi-fields"), wifiOn);
  toggleGroup($("#mac-fields"), macOn);
}

function toggleGroup(group, enabled) {
  if (!group) return;
  group.classList.toggle("opacity-40", !enabled);
  group.classList.toggle("pointer-events-none", !enabled);
  group.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !enabled;
  });
}

// ---------------------------------------------------------------------------
// Trạng thái mạng của trình duyệt (online/offline). Trình duyệt KHÔNG cho biết
// tên WiFi hay IP nội bộ của điện thoại — chỉ có online/offline.
// ---------------------------------------------------------------------------
function updateNetStatus() {
  const el = $("#net-status");
  if (!el) return;
  const online = navigator.onLine;
  el.textContent = online ? "Trình duyệt: online" : "Trình duyệt: offline";
  el.className =
    "text-xs px-2 py-0.5 rounded-full " +
    (online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600");
}

// ---------------------------------------------------------------------------
// Chẩn đoán: gọi GET /provision (danh tính + cấu hình ĐÃ LƯU — id/role/mac/fw, SSID,
// peerMac, có mật khẩu chưa) của ESP → xác nhận tới được thiết bị + xem lại đã lưu đúng
// chưa mà không cần xem Serial (CONTRACT mục 5). Trước đây tách /info + /provision, gộp
// lại thành 1 endpoint duy nhất cho gọn (đỡ nhầm lẫn khi trao đổi với nhóm).
// ---------------------------------------------------------------------------
async function fetchJsonSafe(url) {
  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: resp.ok, json, text };
}

async function testDeviceInfo() {
  const btn = $("#btn-test-info");
  const out = $("#info-result");
  const base = getTargetBase();
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang kiểm tra…";
  try {
    const prov = await fetchJsonSafe(base + "/provision");
    const pretty = "Danh tính + cấu hình đã lưu (GET /provision):\n" +
      (prov.json ? JSON.stringify(prov.json, null, 2) : prov.text);

    out.textContent = "✓ Tới được " + base + "\n\n" + pretty;
    out.className =
      "bg-slate-900 text-emerald-300 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words";
    show(out);
  } catch (err) {
    const isHttps = location.protocol === "https:";
    out.textContent =
      "✕ Không tới được " + base + "\nLỗi: " + (err && err.message ? err.message : err) +
      (isHttps
        ? "\n\nCó thể do mixed-content (trang HTTPS gọi http://). Mở app qua http://."
        : "\n\nKiểm tra: điện thoại đã nối AP của ESP chưa? IP đúng chưa? (mặc định 192.168.4.1)");
    out.className =
      "bg-slate-900 text-red-300 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words";
    show(out);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

// ---------------------------------------------------------------------------
// Khởi động lại: gọi POST /reboot {action:true} của ESP (CONTRACT mục 5).
// Chỉ hoạt động khi ESP đang ở chế độ SoftAP — hỏi xác nhận trước khi gửi vì
// đây là hành động không hoàn tác (ESP mất kết nối AP vài giây rồi khởi động lại).
// ---------------------------------------------------------------------------
async function onClickReboot() {
  if (!confirm("Khởi động lại thiết bị ngay bây giờ?")) return;

  const btn = $("#btn-reboot");
  const out = $("#reboot-status");
  const url = getTargetBase() + "/reboot";
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang gửi lệnh…";

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: true }),
    });
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(await resp.text());
    } catch (_) {}

    // Khoan dung response lệch chuẩn (board chạy firmware khác/cũ hơn repo trả {"status":"ok"}
    // thay vì {"ok":true,...} — xem CONTRACT.md, đã gặp thực tế với /provision, giờ áp dụng luôn
    // cho /reboot để tránh báo lỗi oan khi lệnh thực ra đã thành công).
    const success = resp.ok && bodyJson && (bodyJson.ok === true || bodyJson.status === "ok");
    if (success) {
      out.textContent = "✓ " + (bodyJson.message || "Đang khởi động lại…");
      out.className = "text-sm text-emerald-600";
    } else {
      const detail = (bodyJson && bodyJson.message) || "HTTP " + resp.status + " " + resp.statusText;
      out.textContent = "✕ " + detail;
      out.className = "text-sm text-red-600";
      btn.disabled = false;
    }
  } catch (err) {
    out.textContent = "✕ Không gửi được lệnh: " + (err && err.message ? err.message : err);
    out.className = "text-sm text-red-600";
    btn.disabled = false;
  } finally {
    show(out);
    if (btn.textContent === "Đang gửi lệnh…") btn.textContent = oldLabel;
  }
}

// ---------------------------------------------------------------------------
// Cảnh báo Mixed-content (CONTRACT mục 5)
//  PWA chạy HTTPS → fetch tới http://<esp> bị trình duyệt chặn.
// ---------------------------------------------------------------------------
function detectMixedContentRisk() {
  const banner = $("#mixed-content-warning");
  const isHttps = location.protocol === "https:";

  if (isHttps) {
    banner.innerHTML =
      "<strong>Lưu ý khi chạy qua https://</strong> — gửi cấu hình tới ESP (<code>http://" +
      DEFAULT_IP +
      "</code>) có thể bị chặn theo 1 trong 2 cách: <br>" +
      "1. <b>Local Network Access (Android/Chrome mới)</b>: trình duyệt sẽ HỎI quyền " +
      "\"truy cập thiết bị khác trên mạng cục bộ\" — nhớ bấm <b>Allow</b>. Nếu Android báo " +
      "\"This site can't ask for your permission\" (do app khác đang vẽ đè màn hình) → vào " +
      "Cài đặt → Ứng dụng, tắt quyền \"Hiển thị đè lên ứng dụng khác\" của app đang chạy nền " +
      "(Messenger, launcher, v.v.) rồi thử lại. <br>" +
      "2. <b>Mixed-content (trình duyệt cũ hơn)</b>: bị chặn thẳng, không có prompt xin quyền. <br>" +
      "Chắc ăn nhất khi demo: mở thẳng <code>http://" +
      DEFAULT_IP +
      "/</code> (trang do chính ESP phục vụ, same-origin, không dính cả 2 lỗi trên).";
    show(banner);
  } else {
    hide(banner);
  }
}

// ---------------------------------------------------------------------------
// Gửi provisioning
// ---------------------------------------------------------------------------
async function onSubmitProvision(ev) {
  ev.preventDefault();

  const sendWifi = $("#send-wifi").checked;
  const sendMac = $("#send-mac").checked;
  const ssid = $("#wifi-ssid").value.trim();
  const password = $("#wifi-pass").value; // không trim — mật khẩu có thể có khoảng trắng
  const peerMac = $("#peer-mac").value.trim();

  // --- Kiểm tra đầu vào ---
  if (!sendWifi && !sendMac) {
    return showResult(false, "Chưa chọn mục nào", "Hãy tick ít nhất một mục (WiFi hoặc MAC) để gửi.");
  }
  if (sendWifi && !ssid) {
    return showResult(false, "Thiếu thông tin", "Đã tick gửi WiFi — vui lòng nhập tên WiFi (SSID).");
  }

  // --- Dựng payload theo tick: chỉ gửi mục được chọn (partial update) ---
  const payload = {};
  if (sendWifi) {
    payload.ssid = ssid;
    payload.password = password;
  }
  if (sendMac && peerMac) payload.peerMac = peerMac;

  const url = getTargetBase() + "/provision";

  // --- UI loading ---
  const btn = $("#btn-submit");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang gửi…";
  hide($("#mixed-content-warning")); // ẩn tạm khi đang gửi

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // mode mặc định "cors" — ESP/mock phải trả Access-Control-Allow-Origin: * (CONTRACT mục 5).
    });

    // Cố đọc JSON; nếu không phải JSON thì đọc text để hiển thị thô.
    let bodyText = "";
    let bodyJson = null;
    try {
      bodyText = await resp.text();
      bodyJson = JSON.parse(bodyText);
    } catch (_) {
      // body không phải JSON — giữ bodyText
    }

    // Chuẩn CONTRACT là {ok:true,...}, nhưng một số firmware/board thực tế (bản cũ hơn,
    // "code phân kỳ" — xem docs/TIEN-DO-2026-07-02.md) chỉ trả {status:"ok"}. Chấp nhận
    // cả 2 kiểu để không báo "từ chối" oan khi thiết bị thật ra đã lưu thành công.
    const isSuccess =
      resp.ok && bodyJson && (bodyJson.ok === true || bodyJson.status === "ok");

    if (isSuccess) {
      const msg = bodyJson.message || "Đã lưu cấu hình. Thiết bị sẽ khởi động lại.";
      const macInfo = bodyJson.mac ? "\nMAC thiết bị: " + bodyJson.mac : "";
      showResult(true, "Cấu hình thành công!", msg + macInfo, bodyJson);
    } else {
      // HTTP lỗi hoặc ok=false
      const detail =
        (bodyJson && (bodyJson.message || bodyJson.error)) ||
        bodyText ||
        ("HTTP " + resp.status + " " + resp.statusText);
      showResult(false, "Thiết bị từ chối cấu hình", detail, bodyJson || { httpStatus: resp.status });
    }
  } catch (err) {
    // Lỗi mạng / CORS / mixed-content thường rơi vào đây ("Failed to fetch").
    handleFetchError(err, url);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
    detectMixedContentRisk();
  }
}

// Phân loại lỗi fetch để đưa gợi ý đúng cho người dùng.
function handleFetchError(err, url) {
  const isHttps = location.protocol === "https:";
  const msg = String(err && err.message ? err.message : err);

  const lines = ["Lỗi: " + msg, "Đích: " + url];

  if (isHttps) {
    lines.push(
      "\nNguyên nhân nhiều khả năng (trang đang chạy https://):\n" +
        "1. Local Network Access: trình duyệt cần xin quyền truy cập " + DEFAULT_IP +
        " — kiểm tra có prompt \"Allow\" hiện ra không (trên Android có thể bị 1 app khác " +
        "đang vẽ đè màn hình chặn mất prompt này — tắt app đó rồi thử lại).\n" +
        "2. Mixed-content (trình duyệt cũ hơn): bị chặn thẳng, không xin quyền.\n" +
        "Cách chắc ăn nhất: mở thẳng http://" + DEFAULT_IP + "/ (trang do ESP tự phục vụ, same-origin)."
    );
  } else {
    lines.push(
      "\nKiểm tra: \n• Điện thoại đã kết nối WiFi của ESP (AP) chưa? \n" +
        "• IP có đúng không (mặc định " +
        DEFAULT_IP +
        ")? \n• ESP có bật CORS (Access-Control-Allow-Origin: *) không? \n" +
        "• Nếu đang test: mock-esp-server đã chạy ở http://localhost:8080 chưa?"
    );
  }

  showResult(false, "Không gửi được tới thiết bị", lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Hiển thị kết quả
// ---------------------------------------------------------------------------
function showResult(ok, title, message, rawJson) {
  hide($("#form-card"));
  const card = $("#result-card");
  show(card);

  const icon = $("#result-icon");
  const titleEl = $("#result-title");
  const msgEl = $("#result-message");
  const rawWrap = $("#result-raw-wrap");
  const rawEl = $("#result-raw");

  if (ok) {
    icon.textContent = "✓";
    icon.className =
      "w-14 h-14 rounded-full flex items-center justify-center text-3xl bg-emerald-100 text-emerald-600 mx-auto";
    titleEl.className = "text-xl font-semibold text-emerald-700 text-center mt-3";
  } else {
    icon.textContent = "✕";
    icon.className =
      "w-14 h-14 rounded-full flex items-center justify-center text-3xl bg-red-100 text-red-600 mx-auto";
    titleEl.className = "text-xl font-semibold text-red-700 text-center mt-3";
  }

  titleEl.textContent = title;
  msgEl.textContent = message;

  // Hiển thị response thô (JSON) — "có response cho mobile".
  if (rawJson) {
    rawEl.textContent = JSON.stringify(rawJson, null, 2);
    show(rawWrap);
  } else {
    hide(rawWrap);
  }

  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Service worker (PWA installable)
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    // Đăng ký sau khi load để không cản trở khởi động.
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch((e) => console.warn("Đăng ký service worker thất bại:", e));
    });
  }
}
