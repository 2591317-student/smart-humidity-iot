// ============================================================================
//  app.js — Logic chính của PWA Provisioning.
//  Luồng (theo CONTRACT mục 5 & 6):
//    1. Quét QR (qr.js) → {id, role, ap, ip, mac}; hoặc nhập tay IP.
//    2. Hướng dẫn nối WiFi vào AP của ESP.
//    3. Điền form (SSID, password, deviceEmail/Password cho role main, peerMac, hset, deadband).
//    4. POST JSON → http://<ip>/provision  → hiển thị response.
//    5. Toggle "Chế độ Test" → POST tới http://localhost:8080 (mock-esp-server).
//    6. Bắt lỗi fetch/CORS + cảnh báo mixed-content.
//
//  Provisioning KHÔNG bắt buộc đăng nhập Firebase → không import firebase-config ở đây.
// ============================================================================

import { startQrScan, stopQrScan, isQrScanning } from "./qr.js";

// ---------------------------------------------------------------------------
// Hằng số cấu hình
// ---------------------------------------------------------------------------
const DEFAULT_IP = "192.168.4.1"; // IP SoftAP mặc định của ESP (CONTRACT mục 5)
const MOCK_BASE = "http://localhost:8080"; // mock-esp-server khi chạy "Chế độ Test"
const DEFAULT_HSET = 70; // mặc định an toàn (CONTRACT mục 10)
const DEFAULT_DEADBAND = 5;

// State quét được từ QR (nếu có). Mặc định coi như role main để hiện đủ field.
const state = {
  device: {
    id: "",
    role: "main",
    ap: "",
    ip: DEFAULT_IP,
    mac: "",
  },
  scannedByQr: false,
};

// ---------------------------------------------------------------------------
// Tiện ích DOM
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
}

// Kẹp số nguyên về [min,max]; nếu không hợp lệ trả về mặc định.
function clampInt(v, min, max, def) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

// ---------------------------------------------------------------------------
// Khởi tạo sau khi DOM sẵn sàng
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  applyDeviceToUI(); // áp state mặc định lên form
  detectMixedContentRisk(); // cảnh báo sớm nếu PWA đang chạy HTTPS
  registerServiceWorker();
});

function bindEvents() {
  // --- Quét QR ---
  $("#btn-scan").addEventListener("click", onClickScan);
  $("#btn-stop-scan").addEventListener("click", () => {
    stopQrScan();
    hide($("#qr-reader"));
    hide($("#btn-stop-scan"));
    show($("#btn-scan"));
    setScanStatus("Đã dừng quét.", "muted");
  });

  // --- Nhập tay (bỏ qua QR) ---
  $("#btn-manual").addEventListener("click", () => {
    state.scannedByQr = false;
    // Giữ nguyên giá trị đang có; mở phần form và cho sửa role.
    revealForm();
    setDeviceInfoText("Chế độ nhập tay — hãy điền IP của ESP (mặc định 192.168.4.1).");
  });

  // --- Đổi role thủ công (hiện/ẩn field tài khoản thiết bị) ---
  $("#role").addEventListener("change", (e) => {
    state.device.role = e.target.value;
    toggleRoleFields();
  });

  // --- Đồng bộ ip nhập tay vào state ---
  $("#ip").addEventListener("input", (e) => {
    state.device.ip = e.target.value.trim() || DEFAULT_IP;
  });

  // --- Toggle Chế độ Test (mock server) ---
  $("#test-mode").addEventListener("change", () => {
    updateTargetPreview();
    detectMixedContentRisk();
  });

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
// QR
// ---------------------------------------------------------------------------
function onClickScan() {
  if (isQrScanning()) return;
  show($("#qr-reader"));
  hide($("#btn-scan"));
  show($("#btn-stop-scan"));
  setScanStatus("Đang mở camera… hướng vào mã QR trên thiết bị.", "muted");

  startQrScan(
    (data) => {
      // Quét thành công → lưu state, đóng UI camera, mở form.
      state.device = {
        id: data.id || "",
        role: data.role || "main",
        ap: data.ap || "",
        ip: data.ip || DEFAULT_IP,
        mac: data.mac || "",
      };
      state.scannedByQr = true;

      hide($("#qr-reader"));
      hide($("#btn-stop-scan"));
      show($("#btn-scan"));

      applyDeviceToUI();
      revealForm();
      setScanStatus("Quét QR thành công.", "ok");
      setDeviceInfoText(buildDeviceInfoText(state.device));
    },
    (errMsg) => {
      setScanStatus(errMsg, "err");
      stopQrScan();   // nhả camera + đặt isScanning=false (đồng bộ state scanner)
      // Mở lại nút quét để thử lại; nếu là lỗi camera, gợi ý nhập tay.
      hide($("#qr-reader"));
      hide($("#btn-stop-scan"));
      show($("#btn-scan"));
    }
  );
}

function buildDeviceInfoText(d) {
  const parts = [];
  if (d.id) parts.push("ID: " + d.id);
  parts.push("Vai trò: " + (d.role === "main" ? "main (ESP1)" : "sensor (ESP2)"));
  if (d.ap) parts.push("AP: " + d.ap);
  parts.push("IP: " + d.ip);
  if (d.mac) parts.push("MAC: " + d.mac);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Áp state lên các field của form
// ---------------------------------------------------------------------------
function applyDeviceToUI() {
  $("#role").value = state.device.role;
  $("#ip").value = state.device.ip || DEFAULT_IP;
  // peerMac = MAC của ESP CÒN LẠI (ESP1 cần MAC của ESP2). KHÔNG tự điền bằng MAC quét
  // được, vì QR quét chính là thiết bị đang cấu hình (MAC của chính nó, không phải peer).
  // Để trống cho người dùng nhập MAC ESP2 (xem docs/DEMO.md); state.device.mac chỉ dùng
  // để HIỂN THỊ thông tin thiết bị, không auto-fill vào peerMac.
  // AP gợi ý ở phần hướng dẫn kết nối.
  const apName = state.device.ap || "PROV-… (xem nhãn trên thiết bị)";
  $("#ap-name").textContent = apName;

  // Mặc định hset/deadband nếu trống.
  if (!$("#hset").value) $("#hset").value = DEFAULT_HSET;
  if (!$("#deadband").value) $("#deadband").value = DEFAULT_DEADBAND;

  toggleRoleFields();
  updateTargetPreview();
}

// Field tài khoản thiết bị (deviceEmail/devicePassword) chỉ cần cho role main (ESP1).
function toggleRoleFields() {
  const isMain = $("#role").value === "main";
  const deviceFields = $("#device-account-fields");
  const peerWrap = $("#peer-mac-wrap");
  if (isMain) {
    show(deviceFields);
    show(peerWrap); // ESP1 cần MAC của ESP2 để add peer
    $("#device-email").required = true;
    $("#device-pass").required = true;
  } else {
    hide(deviceFields);
    hide(peerWrap);
    $("#device-email").required = false;
    $("#device-pass").required = false;
  }
}

// ---------------------------------------------------------------------------
// Mở phần hướng dẫn + form
// ---------------------------------------------------------------------------
function revealForm() {
  show($("#connect-card"));
  show($("#form-card"));
  applyDeviceToUI();
  // Cuộn xuống form cho dễ thao tác trên mobile.
  $("#connect-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setDeviceInfoText(text) {
  $("#device-info").textContent = text;
  show($("#device-info"));
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
  const base = getTargetBase();
  $("#target-url").textContent = base + "/provision";
}

// ---------------------------------------------------------------------------
// Cảnh báo Mixed-content (CONTRACT mục 5)
//  PWA chạy HTTPS → fetch tới http://<esp> bị trình duyệt chặn.
// ---------------------------------------------------------------------------
function detectMixedContentRisk() {
  const banner = $("#mixed-content-warning");
  const isHttps = location.protocol === "https:";
  const testMode = $("#test-mode").checked;

  // Nếu trang đang HTTPS mà POST sang http:// (kể cả localhost mock) → cảnh báo.
  // Lưu ý: localhost được nhiều trình duyệt coi là "secure context" nhưng nội dung
  // vẫn là http → vẫn có thể bị chặn mixed-content active. Cảnh báo cho chắc.
  if (isHttps) {
    banner.innerHTML =
      "<strong>Cảnh báo Mixed-content:</strong> Trang này đang chạy qua <code>https://</code> " +
      "nên trình duyệt sẽ CHẶN gửi dữ liệu tới ESP qua <code>http://</code>. " +
      "Cách khắc phục: <br>• Mở trang này qua <code>http://</code> (server local, ví dụ " +
      "<code>http://localhost:5500</code> hoặc IP máy bạn), HOẶC <br>" +
      "• Dùng trang form do chính ESP phục vụ (<code>GET http://" +
      DEFAULT_IP +
      "/</code>) — same-origin nên luôn chạy." +
      (testMode
        ? "<br>• (Chế độ Test cũng cần mở trang qua http:// để gọi được localhost:8080.)"
        : "");
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

  const role = $("#role").value;
  const ssid = $("#wifi-ssid").value.trim();
  const password = $("#wifi-pass").value; // không trim — mật khẩu có thể có khoảng trắng
  const deviceEmail = $("#device-email").value.trim();
  const devicePassword = $("#device-pass").value;
  const peerMac = $("#peer-mac").value.trim();
  const hset = parseInt($("#hset").value, 10);
  const deadband = parseInt($("#deadband").value, 10);

  // --- Kiểm tra đầu vào ---
  if (!ssid) {
    return showResult(false, "Thiếu thông tin", "Vui lòng nhập tên WiFi (SSID).");
  }
  if (role === "main" && (!deviceEmail || !devicePassword)) {
    return showResult(
      false,
      "Thiếu thông tin",
      "Thiết bị main (ESP1) cần tài khoản thiết bị (email + mật khẩu) để đăng nhập Firebase."
    );
  }

  // --- Dựng payload đúng schema CONTRACT mục 5 ---
  const payload = {
    ssid: ssid,
    password: password,
    hset: clampInt(hset, 0, 100, DEFAULT_HSET),
    deadband: clampInt(deadband, 0, 50, DEFAULT_DEADBAND),
  };
  // Tài khoản thiết bị + peerMac chỉ gửi cho role main (ESP1).
  if (role === "main") {
    payload.deviceEmail = deviceEmail;
    payload.devicePassword = devicePassword;
    if (peerMac) payload.peerMac = peerMac;
  }

  const base = getTargetBase();
  const url = base + "/provision";

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

    if (resp.ok && bodyJson && bodyJson.ok === true) {
      const msg = bodyJson.message || "Đã lưu cấu hình. Thiết bị sẽ khởi động lại.";
      const macInfo = bodyJson.mac ? "\nMAC thiết bị: " + bodyJson.mac : "";
      showResult(
        true,
        "Cấu hình thành công!",
        msg + macInfo,
        bodyJson
      );
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

  let title = "Không gửi được tới thiết bị";
  let lines = [];

  lines.push("Lỗi: " + msg);
  lines.push("Đích: " + url);

  if (isHttps) {
    lines.push(
      "\nNguyên nhân nhiều khả năng: MIXED-CONTENT — trang HTTPS không gọi được http://. " +
        "Hãy mở PWA qua http:// (server local) hoặc dùng trang form do ESP phục vụ (http://" +
        DEFAULT_IP +
        "/)."
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

  showResult(false, title, lines.join("\n"));
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
