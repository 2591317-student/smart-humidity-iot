/**
 * config.example.js — Mẫu cấu hình cho data-injector.
 *
 * CÁCH DÙNG:
 *   1. Copy file này thành config.js trong cùng thư mục:
 *        cp config.example.js config.js
 *   2. Điền firebaseConfig (lấy từ Firebase Console > Project settings > Web app).
 *   3. Điền tài khoản THIẾT BỊ (email/password) đã tạo trong Firebase Auth và đã seed
 *      UID vào /devices/<UID> = true (xem CONTRACT mục 3). Chỉ tài khoản thiết bị mới
 *      được ghi /sensor và /status theo security rules.
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

// Tài khoản THIẾT BỊ (email/password) — dùng để đăng nhập và ghi /sensor, /status.
export const deviceEmail = 'device@your-project.iot';
export const devicePassword = 'doi-mat-khau-nay';
