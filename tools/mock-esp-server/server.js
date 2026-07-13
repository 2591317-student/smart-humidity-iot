/**
 * mock-esp-server — Giả lập REST API của ESP (chế độ SoftAP provisioning).
 *
 * Mục đích: test app PWA provisioning KHÔNG cần phần cứng ESP32 thật.
 * PWA (chạy qua http://localhost) sẽ trỏ tới server này thay vì 192.168.4.1.
 *
 * Tuân theo CONTRACT.md mục 5 (REST provisioning) và mục 6 (QR payload).
 *
 * Endpoint mô phỏng:
 *   GET  /info       -> thông tin thiết bị (JSON)
 *   POST /provision  -> nhận cấu hình WiFi + tài khoản thiết bị, log ra console, trả {ok,message,mac}
 *   POST /reset      -> xoá cấu hình (mô phỏng), quay về chưa provisioned
 *   GET  /           -> trang HTML form provisioning same-origin (fallback luôn hoạt động)
 *
 * Chạy: npm install && npm start   (mặc định cổng 8080)
 */

const express = require('express');
const cors = require('cors');

// ---- Cấu hình mô phỏng thiết bị -------------------------------------------------
const PORT = process.env.PORT || 8080;

// Thông tin thiết bị giả lập (giống một ESP1 role "main").
// Đổi các giá trị này nếu muốn mô phỏng ESP2 (role "sensor").
const DEVICE = {
  role: 'main',                       // "main" (ESP1) | "sensor" (ESP2)
  macFull: 'A0:B1:C2:A1:B2:C3',       // MAC đầy đủ (giả lập)
  fw: '1.0.0',
};
// mac6 = 6 ký tự hex CUỐI của MAC (khớp firmware provisioning.cpp::macTail6),
// vd MAC ...A1:B2:C3 -> mac6 = A1B2C3. Suy ra để không bao giờ lệch với macFull.
DEVICE.mac6 = DEVICE.macFull.replace(/:/g, '').slice(-6).toUpperCase();

// id thiết bị theo CONTRACT: "<ROLE_HOA>-<MAC6>"  (vd MAIN-A1B2C3)
DEVICE.id = `${DEVICE.role.toUpperCase()}-${DEVICE.mac6}`;
// Tên SoftAP theo CONTRACT: "PROV-<ROLE_HOA>-<MAC6>"
DEVICE.ap = `PROV-${DEVICE.role.toUpperCase()}-${DEVICE.mac6}`;
DEVICE.ip = '192.168.4.1';

// Trạng thái provisioned (mô phỏng NVS Preferences). Reset lại khi gọi /reset.
let provisioned = false;
// Lưu cấu hình gần nhất đã nhận (chỉ để hiển thị/đối chiếu khi test).
let lastConfig = null;

// ---- Khởi tạo Express ----------------------------------------------------------
const app = express();

// Bật CORS cho mọi origin (CONTRACT mục 5: ESP trả Access-Control-Allow-Origin: *).
// Cho phép preflight OPTIONS để PWA gọi POST từ trình duyệt.
app.use(cors());
app.options('*', cors());

// Parse JSON body (Content-Type: application/json) cho /provision.
app.use(express.json());

// Log mỗi request để dễ debug khi test với PWA.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---- GET /info -----------------------------------------------------------------
// Trả thông tin thiết bị (CONTRACT mục 5).
app.get('/info', (_req, res) => {
  res.json({
    id: DEVICE.id,
    role: DEVICE.role,
    mac: DEVICE.macFull,
    fw: DEVICE.fw,
    provisioned: provisioned,
  });
});

// ---- POST /provision -----------------------------------------------------------
// Nhận cấu hình từ PWA, log ra console, đánh dấu provisioned, trả phản hồi chuẩn.
app.post('/provision', (req, res) => {
  const body = req.body || {};

  // Các trường theo CONTRACT mục 5. ssid là bắt buộc tối thiểu.
  const {
    ssid,
    password,
    deviceEmail,
    devicePassword,
    peerMac,
    hset,
    deadband,
  } = body;

  console.log('\n========== POST /provision — nhận cấu hình ==========');
  console.log('  ssid           :', ssid);
  // Che password khi log để giống thực tế (vẫn cho biết có nhận được hay không).
  console.log('  password       :', maskSecret(password));
  console.log('  deviceEmail    :', deviceEmail);
  console.log('  devicePassword :', maskSecret(devicePassword));
  console.log('  peerMac        :', peerMac);
  console.log('  hset           :', hset !== undefined ? hset : '(mặc định 70)');
  console.log('  deadband       :', deadband !== undefined ? deadband : '(mặc định 5)');
  console.log('=====================================================\n');

  // Validate tối thiểu: phải có SSID.
  if (!ssid || typeof ssid !== 'string') {
    return res.status(400).json({
      ok: false,
      message: 'Thiếu hoặc sai trường "ssid".',
      mac: DEVICE.macFull,
    });
  }

  // Lưu lại cấu hình (mô phỏng ghi Preferences) — áp giá trị mặc định an toàn.
  lastConfig = {
    ssid,
    password: password || '',
    deviceEmail: deviceEmail || '',
    devicePassword: devicePassword || '',
    peerMac: peerMac || '',
    hset: Number.isFinite(Number(hset)) ? Number(hset) : 70,
    deadband: Number.isFinite(Number(deadband)) ? Number(deadband) : 5,
  };
  provisioned = true;

  console.log('>> Đã lưu cấu hình (mô phỏng). Thiết bị thật sẽ reboot vào chế độ STA.\n');

  // Phản hồi đúng format CONTRACT mục 5.
  res.json({
    ok: true,
    message: 'Saved. Rebooting.',
    mac: DEVICE.macFull,
  });
});

// ---- GET /provision --------------------------------------------------------------
// Đọc lại thông tin ĐÃ GHI qua POST /provision (mô phỏng đọc lại NVS). Không trả mật
// khẩu WiFi thật, chỉ báo có/không (khớp firmware provisioning.cpp::handleGetProvision).
app.get('/provision', (_req, res) => {
  res.json({
    ssid: (lastConfig && lastConfig.ssid) || '',
    hasPassword: !!(lastConfig && lastConfig.password),
    peerMac: (lastConfig && lastConfig.peerMac) || '',
    provisioned,
  });
});

// ---- POST /reboot --------------------------------------------------------------
// Mô phỏng lệnh khởi động lại (CONTRACT mục 5). Không thật sự "reboot" gì (đây là
// mock), chỉ log ra console + trả đúng response format để test luồng PWA.
app.post('/reboot', (req, res) => {
  const action = req.body && req.body.action;
  if (action !== true) {
    return res.status(400).json({
      ok: false,
      message: 'Thieu hoac sai truong action (can true)',
      mac: DEVICE.macFull,
    });
  }
  console.log('>> POST /reboot — (mo phong) thiet bi se khoi dong lai.\n');
  res.json({ ok: true, message: 'Rebooting.', mac: DEVICE.macFull });
});

// ---- POST /reset ---------------------------------------------------------------
// Xoá cấu hình, quay về trạng thái chưa provisioned (để demo lại).
app.post('/reset', (_req, res) => {
  provisioned = false;
  lastConfig = null;
  console.log('>> POST /reset — đã xoá cấu hình, quay về chưa provisioned.\n');
  res.json({
    ok: true,
    message: 'Reset done. Back to unprovisioned.',
    mac: DEVICE.macFull,
  });
});

// ---- GET / ---------------------------------------------------------------------
// Trang form provisioning tối giản (same-origin fallback) — giống ESP tự phục vụ.
app.get('/', (_req, res) => {
  res.type('html').send(renderFormPage());
});

// ---- Khởi động server ----------------------------------------------------------
app.listen(PORT, () => {
  console.log('\n=====================================================');
  console.log(' MOCK ESP SERVER — giả lập REST provisioning của ESP');
  console.log('=====================================================');
  console.log(`  Đang chạy tại : http://localhost:${PORT}`);
  console.log(`  Thiết bị mô phỏng:`);
  console.log(`    id    : ${DEVICE.id}`);
  console.log(`    role  : ${DEVICE.role}`);
  console.log(`    ap    : ${DEVICE.ap}`);
  console.log(`    mac   : ${DEVICE.macFull}`);
  console.log('  Endpoint:');
  console.log(`    GET  http://localhost:${PORT}/info`);
  console.log(`    POST http://localhost:${PORT}/provision`);
  console.log(`    POST http://localhost:${PORT}/reset`);
  console.log(`    POST http://localhost:${PORT}/reboot`);
  console.log(`    GET  http://localhost:${PORT}/   (form HTML)`);
  console.log('-----------------------------------------------------');

  // In chuỗi QR JSON mẫu theo CONTRACT mục 6 để dán vào PWA test (quét tay/giả lập).
  const qrPayload = {
    id: DEVICE.id,
    role: DEVICE.role,
    ap: DEVICE.ap,
    ip: DEVICE.ip,
    mac: DEVICE.macFull,
  };
  console.log('  QR payload mẫu (CONTRACT mục 6) — JSON 1 dòng để test PWA:');
  console.log('  ' + JSON.stringify(qrPayload));
  console.log('  (Ghi chú: khi test với mock này, PWA gọi REST tới');
  console.log(`   http://localhost:${PORT} thay vì http://${DEVICE.ip})`);
  console.log('=====================================================\n');
});

// ---- Hàm tiện ích --------------------------------------------------------------

// Che một phần secret khi log (để xác nhận có nhận được mà không lộ toàn bộ).
function maskSecret(value) {
  if (value === undefined || value === null || value === '') return '(trống)';
  const s = String(value);
  if (s.length <= 2) return '*'.repeat(s.length);
  return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
}

// Trang HTML form provisioning tối giản (gửi POST /provision same-origin).
function renderFormPage() {
  const sampleQr = JSON.stringify({
    id: DEVICE.id,
    role: DEVICE.role,
    ap: DEVICE.ap,
    ip: DEVICE.ip,
    mac: DEVICE.macFull,
  });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mock ESP — Provisioning</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 460px; margin: 24px auto; padding: 0 16px; color: #1f2937; }
    h1 { font-size: 1.2rem; }
    label { display:block; margin-top: 12px; font-weight: 600; font-size: .9rem; }
    input { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; border:1px solid #cbd5e1; border-radius:6px; }
    button { margin-top: 16px; padding: 10px 16px; background:#2563eb; color:#fff; border:0; border-radius:6px; cursor:pointer; font-size:1rem; }
    button:hover { background:#1d4ed8; }
    pre { background:#f1f5f9; padding:10px; border-radius:6px; overflow:auto; font-size:.8rem; }
    .ok { color:#16a34a; } .err { color:#dc2626; }
    small { color:#64748b; }
  </style>
</head>
<body>
  <h1>Mock ESP Provisioning (giả lập)</h1>
  <p><small>Thiết bị mô phỏng: <b>${DEVICE.id}</b> (role ${DEVICE.role}, mac ${DEVICE.macFull})</small></p>
  <p><small>QR payload mẫu (CONTRACT mục 6):</small></p>
  <pre>${sampleQr}</pre>

  <form id="f">
    <label>WiFi SSID *<input name="ssid" value="TenWiFiNha" required /></label>
    <label>WiFi Password<input name="password" type="text" value="matkhauwifi" /></label>
    <label>Device Email (ESP1)<input name="deviceEmail" value="device@project.iot" /></label>
    <label>Device Password (ESP1)<input name="devicePassword" type="text" value="123456" /></label>
    <label>Peer MAC (MAC ESP2, chỉ cần cho ESP1)<input name="peerMac" value="11:22:33:44:55:66" /></label>
    <label>hset (ngưỡng độ ẩm %RH)<input name="hset" type="number" value="70" /></label>
    <label>deadband (vùng chết %RH)<input name="deadband" type="number" value="5" /></label>
    <button type="submit">Gửi cấu hình (POST /provision)</button>
  </form>

  <h3>Kết quả</h3>
  <pre id="out">(chưa gửi)</pre>

  <script>
    const form = document.getElementById('f');
    const out = document.getElementById('out');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        ssid: fd.get('ssid'),
        password: fd.get('password'),
        deviceEmail: fd.get('deviceEmail'),
        devicePassword: fd.get('devicePassword'),
        peerMac: fd.get('peerMac'),
        hset: Number(fd.get('hset')),
        deadband: Number(fd.get('deadband')),
      };
      out.textContent = 'Đang gửi...';
      try {
        const r = await fetch('/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await r.json();
        out.textContent = JSON.stringify(json, null, 2);
        out.className = json.ok ? 'ok' : 'err';
      } catch (err) {
        out.textContent = 'Lỗi: ' + err.message;
        out.className = 'err';
      }
    });
  </script>
</body>
</html>`;
}
