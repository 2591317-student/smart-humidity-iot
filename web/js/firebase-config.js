// ============================================================================
//  Firebase config — ĐIỀN TỪ FIREBASE CONSOLE (Project settings > Your apps > Web)
//  Xem docs/SETUP.md để biết cách tạo project mới và lấy các giá trị này.
//  Dùng cho web Dashboard (và bất kỳ client nào cần Firebase). PWA provisioning
//  KHÔNG bắt buộc đăng nhập nên hiện không import file này.
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCu_UyCLAuQxJkFIas9KS_K1vcN6bliQvU",
  authDomain: "smart-humidity-iot.firebaseapp.com",
  databaseURL: "https://smart-humidity-iot-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-humidity-iot",
  storageBucket: "smart-humidity-iot.firebasestorage.app",
  messagingSenderId: "986085857723",
  appId: "1:986085857723:web:e32429227d57b118a70c9e",
  measurementId: "G-FWSRS1XGEY"
};

// Phiên bản Firebase JS SDK (modular, ESM qua CDN) dùng thống nhất toàn dự án.
export const FIREBASE_SDK_VERSION = "10.12.2";
