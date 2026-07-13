# presence-watcher — Cập nhật `/status/esp1Online` kể cả khi không ai mở web

## Vấn đề nó giải quyết

Web dashboard tự suy online/offline từ `/status/lastSeen` — nhưng logic đó chạy **trong trình
duyệt**, chỉ hoạt động khi có người đang mở web. Field `/status/esp1Online` (do chính ESP1 ghi) thì
**không ai sửa lại** khi ESP mất mạng/crash — mở Firebase Console lên vẫn thấy `esp1Online: true`
dù thiết bị đã chết từ lâu.

`presence-watcher` là 1 script Node nhỏ, chạy **ngoài trình duyệt**, để chính field đó trong
database cũng luôn đúng — không cần Cloud Functions, không cần gói trả phí (Blaze).

## Cách hoạt động

1. Đăng nhập bằng **tài khoản thiết bị** (cùng tài khoản ESP1 dùng — email/password đã seed UID
   vào `/devices/<UID> = true`).
2. Nghe realtime `/status/lastSeen` và `/webSettings/onlineTimeoutSec` (dùng **cùng ngưỡng** admin
   đặt trên web dashboard, đỡ phải cấu hình 2 nơi — path này tách khỏi `/config` vì chỉ web dùng).
3. Mỗi ~5s so `giờ hiện tại − lastSeen` với ngưỡng — nếu quá hạn, ghi `esp1Online: false`; khi ESP
   gửi lại dữ liệu (ESP tự ghi `esp1Online: true` mỗi lần đẩy), watcher tự phát hiện lại `true`.
4. Chỉ ghi khi giá trị **thực sự đổi** — không spam Firebase mỗi vòng lặp.

## ⚠️ Giới hạn — đây KHÔNG phải "chạy nền không cần máy nào"

Tool vẫn cần **một máy chạy nó liên tục** (laptop để mở, máy chủ nhỏ, Raspberry Pi, VPS...). Không
có cách nào để code "tự chạy" mà không có gì thực thi nó — đó là bản chất của mọi việc cần làm khi
không ai mở trình duyệt. Lựa chọn:
- Để chạy trên máy cá nhân lúc cần theo dõi/demo.
- Deploy lên 1 host free-tier luôn bật (Render, Railway, Fly.io...) nếu muốn 24/7 thật sự.
- Hoặc chấp nhận: `esp1Online` có thể trễ tới khi có ai mở web / chạy lại tool này — không sao,
  vì **web dashboard đã tự tính đúng online/offline theo `lastSeen` khi có người xem**, độc lập với
  tool này.

## Chạy

```bash
cd tools/presence-watcher
cp config.example.js config.js   # điền firebaseConfig + tài khoản thiết bị (CÙNG ESP1)
npm install
npm start
```

Nhấn `Ctrl+C` để dừng.
