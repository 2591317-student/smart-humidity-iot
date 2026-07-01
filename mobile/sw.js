// ============================================================================
//  sw.js — Service Worker cơ bản cho PWA Provisioning.
//  Mục tiêu: PWA cài được ("thêm vào màn hình chính") + cache vỏ ứng dụng (app
//  shell) để mở lại offline. KHÔNG cache các request provisioning (POST tới ESP).
//
//  Lưu ý quan trọng:
//   - Chỉ cache request GET cùng phạm vi (same-origin). Mọi POST/quét QR/CDN
//     đều cho đi thẳng ra mạng để tránh trả dữ liệu cũ sai.
//   - Service worker chỉ đăng ký được trên HTTPS hoặc http://localhost
//     (secure context). Mở qua file:// sẽ không đăng ký được — vẫn dùng app bình thường.
// ============================================================================

const CACHE_NAME = "shi-prov-v1";

// Vỏ ứng dụng tối thiểu (same-origin). CDN (Tailwind, html5-qrcode) không liệt kê
// ở đây để tránh fail toàn bộ install nếu mạng chậm; sẽ được cache động khi fetch.
const APP_SHELL = [
  "./",
  "./index.html",
  "./js/app.js",
  "./js/qr.js",
  "./manifest.webmanifest",
];

// --- Cài đặt: nạp trước app shell ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((e) => {
        // Nếu một file lỗi (vd chạy từ đường dẫn khác) thì vẫn cài SW, chỉ là không có cache.
        console.warn("[SW] Bỏ qua lỗi precache:", e);
      })
      .then(() => self.skipWaiting())
  );
});

// --- Kích hoạt: dọn cache phiên bản cũ ---
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// --- Fetch: chiến lược "network-first cho HTML, cache-first cho tài nguyên tĩnh" ---
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Chỉ xử lý GET. POST provisioning đi thẳng ra mạng (không can thiệp).
  if (req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);

  // Không can thiệp request tới ESP/mock (http khác origin) hay request POST —
  // để app tự xử lý lỗi mạng/CORS/mixed-content và hiển thị cho người dùng.
  const isSameOrigin = url.origin === self.location.origin;

  // HTML/điều hướng → network-first (luôn lấy bản mới, fallback cache khi offline).
  if (req.mode === "navigate" || (isSameOrigin && url.pathname.endsWith(".html"))) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          cachePut(req, resp.clone());
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // Tài nguyên tĩnh (JS same-origin + CDN script/css) → cache-first, cập nhật nền.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          // Chỉ cache phản hồi hợp lệ (basic = same-origin, cors = CDN cho phép).
          if (resp && (resp.type === "basic" || resp.type === "cors") && resp.status === 200) {
            cachePut(req, resp.clone());
          }
          return resp;
        })
        .catch(() => cached); // offline → dùng cache nếu có
      return cached || network;
    })
  );
});

// Ghi vào cache an toàn (bỏ qua lỗi quota/scheme không hỗ trợ).
function cachePut(req, resp) {
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(req, resp))
    .catch(() => {
      /* bỏ qua */
    });
}
