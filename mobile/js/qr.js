// ============================================================================
//  qr.js — Quét QR thiết bị bằng html5-qrcode và parse payload JSON.
//  Payload QR theo CONTRACT mục 6 (JSON 1 dòng):
//    {"id":"MAIN-A1B2C3","role":"main","ap":"PROV-MAIN-A1B2C3",
//     "ip":"192.168.4.1","mac":"A1:B2:C3:D4:E5:F6"}
//
//  Module này chỉ lo phần quét + parse, KHÔNG đụng tới DOM của form.
//  app.js sẽ gọi startQrScan()/stopQrScan() và nhận callback khi quét xong.
// ============================================================================

// Thư viện html5-qrcode nạp qua CDN (xem index.html) → biến toàn cục Html5Qrcode.
// Giữ tham chiếu instance đang chạy để có thể dừng/giải phóng camera.
let scannerInstance = null;
let isScanning = false;

// ID phần tử <div> chứa khung camera (định nghĩa trong index.html).
const QR_REGION_ID = "qr-reader";

/**
 * Phân tích chuỗi text quét được từ QR thành object cấu hình thiết bị.
 * Trả về { ok, data?, error? } để app.js dễ xử lý.
 *
 * Quy tắc:
 *  - Bắt buộc là JSON hợp lệ có ít nhất "id" hoặc "role".
 *  - "ip" thiếu → mặc định "192.168.4.1" (CONTRACT mục 5).
 *  - Chuẩn hoá role về chữ thường ("main"/"sensor").
 */
export function parseQrPayload(text) {
  if (!text || typeof text !== "string") {
    return { ok: false, error: "QR rỗng hoặc không đọc được." };
  }

  let obj;
  try {
    obj = JSON.parse(text.trim());
  } catch (e) {
    return {
      ok: false,
      error: "Nội dung QR không phải JSON hợp lệ. Hãy chắc chắn quét đúng mã QR của thiết bị.",
    };
  }

  if (typeof obj !== "object" || obj === null) {
    return { ok: false, error: "QR không chứa đối tượng cấu hình hợp lệ." };
  }

  // Kiểm tra tối thiểu: cần biết đây là thiết bị nào.
  if (!obj.id && !obj.role) {
    return {
      ok: false,
      error: 'QR thiếu thông tin thiết bị (cần "id" hoặc "role").',
    };
  }

  const role = (obj.role || "").toString().toLowerCase();
  const data = {
    id: (obj.id || "").toString(),
    role: role === "main" || role === "sensor" ? role : (role || "main"),
    ap: (obj.ap || "").toString(),
    ip: (obj.ip || "192.168.4.1").toString(),
    mac: (obj.mac || "").toString().toUpperCase(),
  };

  return { ok: true, data };
}

/**
 * Bắt đầu quét QR bằng camera sau (environment).
 * @param {(data:object)=>void} onSuccess  gọi khi parse QR thành công.
 * @param {(msg:string)=>void}  onError    gọi khi lỗi (camera/parse), không bắt buộc.
 */
export async function startQrScan(onSuccess, onError) {
  if (typeof Html5Qrcode === "undefined") {
    onError && onError("Thư viện quét QR (html5-qrcode) chưa nạp được. Kiểm tra kết nối mạng/CDN.");
    return;
  }

  if (isScanning) {
    // Đang quét rồi thì bỏ qua, tránh mở 2 camera.
    return;
  }

  try {
    scannerInstance = new Html5Qrcode(QR_REGION_ID, /* verbose= */ false);
  } catch (e) {
    onError && onError("Không khởi tạo được vùng quét QR: " + e.message);
    return;
  }

  // Cấu hình khung quét: 10 khung/giây, ô quét vuông co theo kích thước khung hình.
  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const size = Math.floor(minEdge * 0.7);
      return { width: size, height: size };
    },
    aspectRatio: 1.0,
  };

  try {
    await scannerInstance.start(
      { facingMode: "environment" }, // ưu tiên camera sau trên điện thoại
      config,
      (decodedText) => {
        // Quét được 1 mã → parse rồi báo lên app.js. Dừng quét ngay để nhả camera.
        const result = parseQrPayload(decodedText);
        if (result.ok) {
          stopQrScan().finally(() => onSuccess && onSuccess(result.data));
        } else {
          onError && onError(result.error);
        }
      },
      () => {
        // Callback mỗi khung không đọc được mã — bỏ qua để không spam log.
      }
    );
    isScanning = true;
  } catch (err) {
    isScanning = false;
    let msg = "Không mở được camera: " + (err && err.message ? err.message : err);
    // Lỗi quyền camera thường gặp khi trang chạy qua http:// (không phải localhost/https).
    if (String(err).toLowerCase().includes("permission") || String(err).toLowerCase().includes("notallowed")) {
      msg =
        "Trình duyệt từ chối quyền camera. Lưu ý: camera chỉ hoạt động trên HTTPS hoặc http://localhost. " +
        "Nếu không quét được, hãy gõ MAC của ESP còn lại bằng tay vào ô MAC.";
    }
    onError && onError(msg);
  }
}

/** Dừng quét và giải phóng camera. An toàn khi gọi nhiều lần. */
export async function stopQrScan() {
  if (!scannerInstance) {
    isScanning = false;
    return;
  }
  try {
    if (isScanning) {
      await scannerInstance.stop();
    }
    await scannerInstance.clear();
  } catch (e) {
    // Bỏ qua lỗi khi dừng (camera có thể đã tắt) — không cần báo người dùng.
  } finally {
    scannerInstance = null;
    isScanning = false;
  }
}

/** Cho biết hiện đang quét hay không (app.js dùng để toggle nút). */
export function isQrScanning() {
  return isScanning;
}
