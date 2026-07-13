/**
 * config.example.js — Mẫu cấu hình cho presence-watcher.
 *
 * CÁCH DÙNG:
 *   1. Copy file này thành config.js trong cùng thư mục:
 *        cp config.example.js config.js
 *   2. Điền firebaseConfig (giống web/js/firebase-config.js hoặc tools/data-injector/config.js).
 *   3. Điền tài khoản THIẾT BỊ (email/password) — CÙNG tài khoản mà ESP1 dùng (đã seed UID vào
 *      /devices/<UID> = true) — vì watcher chỉ ghi field "esp1Online" trong /status, dùng chung
 *      quyền ghi với ESP1 theo Security Rules, không cần tài khoản riêng.
 *
 * LƯU Ý: config.js KHÔNG nên commit (thêm vào .gitignore). File .example này là mẫu an toàn.
 */

// Cấu hình web app Firebase (giống web/js/firebase-config.js).
export const firebaseConfig = {
  apiKey: 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  authDomain: 'your-project.firebaseapp.com',
  // BẮT BUỘC có databaseURL cho Realtime Database (region asia-southeast1).
  databaseURL: 'https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:abcdef0123456789',
};

// Tài khoản THIẾT BỊ (email/password) — CÙNG tài khoản ESP1 đang dùng để đăng nhập.
export const deviceEmail = 'device@your-project.iot';
export const devicePassword = 'doi-mat-khau-nay';
