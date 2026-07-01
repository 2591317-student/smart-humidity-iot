# data-injector — Bơm dữ liệu cảm biến giả lên Firebase

Tool Node.js đóng vai "ESP1 giả": đăng nhập Firebase bằng **tài khoản thiết bị**, rồi cứ ~3s
ghi dữ liệu nhiệt độ/độ ẩm giả lên Realtime Database để **test web dashboard và biểu đồ realtime
(Chart.js) mà KHÔNG cần phần cứng ESP**.

Tuân theo `docs/CONTRACT.md`:
- Mục 2 — data model `/sensor`, `/config`, `/status` + thuật toán Deadband
- Mục 3 — auth: đăng nhập bằng tài khoản thiết bị (email/password)
- Mục 9 — Firebase JS SDK v10 (modular)

## Cài đặt

```bash
cd tools/data-injector
cp config.example.js config.js     # rồi mở config.js điền thông tin
npm install                        # cài firebase v10
```

Trong `config.js` điền:
- `firebaseConfig` — lấy từ Firebase Console > Project settings > Web app (nhớ có `databaseURL`).
- `deviceEmail` / `devicePassword` — tài khoản **thiết bị** đã tạo trong Firebase Auth, và UID
  đã được seed vào `/devices/<UID> = true` (xem CONTRACT mục 3). Chỉ tài khoản thiết bị mới ghi
  được `/sensor` và `/status` theo security rules.

## Chạy

```bash
npm start
```

Mỗi ~3 giây tool sẽ:
- Ghi `/sensor`: `{ temperature, humidity, timestamp }` (timestamp = epoch **giây**).
- Ghi `/status`: `{ mist, tank, pump, esp1Online: true, gateway: "esp1", lastSeen }`.
- In giá trị ra console.

Ví dụ console:

```
[#0007] T=27.9°C  RH=63.4%  mist=ON   tank=full  pump=OFF  (hset=70±5 → min=65 max=75)
[#0017] T=28.1°C  RH=71.2%  mist=OFF  tank=empty pump=ON   (hset=70±5 → min=65 max=75)  ⚠ CẢNH BÁO CẠN NƯỚC
```

## Hành vi mô phỏng

- **Deadband** đúng CONTRACT mục 2: `humidity < hset-deadband` → bật phun (`mist=true`);
  `humidity > hset+deadband` → tắt; ở giữa → giữ nguyên (chống nhảy relay). Máy phun bật làm độ
  ẩm tăng dần, tắt thì giảm dần — tạo dao động lên/xuống quanh ngưỡng giống thực tế.
- **Cấu hình realtime:** tool lắng nghe `/config` trên Firebase; nếu admin sửa `hset`/`deadband`
  trên web, mô phỏng cập nhật theo ngay (không cần khởi động lại). Nếu chưa có `/config`, dùng
  mặc định `hset=70`, `deadband=5`.
- **Cảnh báo cạn nước:** định kỳ (~mỗi phút) đặt `tank="empty"` vài vòng và bật `pump=true` để
  test phần cảnh báo trên dashboard, sau đó trả về `full`.

## Dừng

Nhấn `Ctrl+C`.

## Lưu ý bảo mật

- `config.js` chứa thông tin nhạy cảm — **không commit** (nên thêm vào `.gitignore`). Chỉ commit
  `config.example.js`.
- Nếu đăng nhập báo lỗi quyền ghi, kiểm tra lại UID thiết bị đã seed vào `/devices/<UID>` và
  `databaseURL` trong `firebaseConfig`.
