# Test Security Rules (Realtime Database)

Kiểm thử tự động `firebase/database.rules.json` bằng **Firebase Local Emulator** —
KHÔNG đụng tới dữ liệu thật, KHÔNG cần phần cứng.

## Yêu cầu
- **Node.js 18+** (dùng `node --test` có sẵn).
- **firebase-tools** (`npm i -g firebase-tools`).
- **Java JDK 11+** — *bắt buộc* vì Database emulator chạy trên JVM.
  (Kiểm tra: `java -version`. Nếu thiếu: cài Temurin/OpenJDK 11+.)

## Cài & chạy
```bash
cd tests/rules
npm install
npm test
```
`npm test` sẽ tự khởi động Database emulator (cổng 9000) rồi chạy toàn bộ test, tắt emulator khi xong:
```
firebase emulators:exec --only database --project demo-smart-humidity "node --test"
```

## Các ca kiểm thử (11)
| Nhóm | Kỳ vọng |
|---|---|
| Người lạ đọc `/sensor` | ❌ bị chặn (`.read=false` ở gốc) |
| Non-admin đọc `/sensor` | ✅ được |
| Non-admin ghi `/config` | ❌ |
| Admin ghi `/config` | ✅ |
| Admin ghi `/config` hset=150 | ❌ (validate 0–100) |
| Thiết bị ghi `/sensor` | ✅ |
| Non-device ghi `/sensor` | ❌ |
| Thiết bị ghi `/config` | ❌ |
| Non-admin liệt kê `/admins` | ❌ (chống lộ danh sách UID) |
| Đọc `/admins/<uid mình>` | ✅ |
| Đọc `/admins/<uid người khác>` | ❌ |

> Test này xác nhận đúng các use-case bảo mật trong đề bài (PDF mục 5.1) và bản vá audit
> (siết `/admins`,`/devices` chỉ đọc được UID của chính mình).
