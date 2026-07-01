// ============================================================================
//  auth.js — Xác thực Google OAuth cho admin (theo CONTRACT mục 3 & 9)
//  - Dùng Firebase Auth modular (ESM CDN gstatic) v10.12.2.
//  - signInWithPopup + GoogleAuthProvider.
//  - Cung cấp helper đăng nhập / đăng xuất / lắng nghe trạng thái.
// ============================================================================

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// 'app' (FirebaseApp) được truyền vào từ app.js để dùng chung 1 instance.
let auth = null;

/**
 * Khởi tạo Auth từ FirebaseApp đã init ở app.js.
 * @param {import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js").FirebaseApp} app
 * @returns {import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").Auth}
 */
export function initAuth(app) {
  auth = getAuth(app);
  return auth;
}

/**
 * Đăng nhập bằng tài khoản Google (mở popup).
 * Trả về User khi thành công; ném lỗi để app.js bắt và hiển thị.
 */
export async function loginWithGoogle() {
  if (!auth) throw new Error("Auth chưa được khởi tạo (gọi initAuth trước).");
  const provider = new GoogleAuthProvider();
  // Luôn cho người dùng chọn tài khoản (tránh tự đăng nhập tài khoản cũ).
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

/** Đăng xuất tài khoản hiện tại. */
export async function logout() {
  if (!auth) return;
  await signOut(auth);
}

/**
 * Lắng nghe thay đổi trạng thái đăng nhập.
 * @param {(user: import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").User|null) => void} cb
 */
export function watchAuth(cb) {
  if (!auth) throw new Error("Auth chưa được khởi tạo (gọi initAuth trước).");
  return onAuthStateChanged(auth, cb);
}

/**
 * Dịch mã lỗi Firebase Auth sang thông báo tiếng Việt thân thiện.
 * @param {any} err
 * @returns {string}
 */
export function describeAuthError(err) {
  const code = err && err.code ? err.code : "";
  switch (code) {
    case "auth/popup-closed-by-user":
      return "Bạn đã đóng cửa sổ đăng nhập. Vui lòng thử lại.";
    case "auth/popup-blocked":
      return "Trình duyệt chặn popup. Hãy cho phép popup rồi thử lại.";
    case "auth/cancelled-popup-request":
      return "Yêu cầu đăng nhập bị huỷ. Thử lại nhé.";
    case "auth/network-request-failed":
      return "Lỗi mạng. Kiểm tra kết nối Internet.";
    case "auth/unauthorized-domain":
      return "Domain chưa được cấp phép trong Firebase Auth (Authorized domains).";
    default:
      return "Đăng nhập thất bại: " + (err && err.message ? err.message : "lỗi không xác định.");
  }
}
