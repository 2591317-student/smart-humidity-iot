# FIREBASE-GUIDE — Hướng dẫn làm Firebase từ A→Z (chi tiết)

Hướng dẫn tạo & cấu hình Firebase cho dự án **Smart Humidity IoT**, kèm **chỗ điền vào file nào**.
Làm theo đúng thứ tự. (Bản tóm tắt ngắn ở [SETUP.md](SETUP.md); file này là bản chi tiết click-by-click.)

> Ký hiệu: `<PROJECT_ID>` = ID project bạn tạo · `ADMIN_UID` = UID tài khoản Google admin ·
> `DEVICE_UID` = UID tài khoản thiết bị (email/password cho ESP1).

---

## Phần 1 — Tạo project & bật dịch vụ (trên Console)

### B1. Tạo project
1. Vào https://console.firebase.google.com → đăng nhập bằng **`2591317@student.hcmute.edu.vn`** (để tài khoản này là chủ project, tiện làm admin).
2. **Add project** → tên `smart-humidity-iot` → Continue → (tắt Google Analytics cho gọn) → **Create project**.
3. Vào **⚙ Project settings → General**, ghi lại **Project ID** (dạng `smart-humidity-iot-xxxxx`).

### B2. Bật Authentication
1. Mở Authentication: dùng ô **Search for products** (sidebar) gõ `Authentication` → **Get started**.
   *(Console bản mới bỏ menu "Build"; Authentication nằm trong nhóm **Security**.)*
2. Tab **Sign-in method → Add new provider**:
   - **Google** → **Enable** → chọn *support email* = email của bạn → **Save**.
   - **Email/Password** → **Enable** (chỉ ô đầu) → **Save**.

### B3. Tạo tài khoản thiết bị (cho ESP1 đăng nhập Firebase)
1. Authentication → tab **Users → Add user**:
   - Email: `device@smarthumidity.iot` (gì cũng được, miễn dạng email)
   - Password: đặt mật khẩu mạnh — **GHI LẠI** (sẽ nạp vào ESP1 lúc provisioning).
2. Sau khi tạo, dòng user hiện **User UID** → **copy** (đây là `DEVICE_UID`).

### B4. Tạo Realtime Database
1. Mở **Search for products** gõ `Realtime Database` → **Create Database** (nhóm **Databases and storage**).
2. **Location: Singapore (asia-southeast1)**.
3. Chọn **Start in locked mode** → **Enable**. *(Đừng chọn test mode — rules riêng sẽ đẩy ở Phần 3.)*
4. Ghi lại **URL**: `https://<PROJECT_ID>-default-rtdb.asia-southeast1.firebasedatabase.app`

### B5. Lấy cấu hình Web (firebaseConfig)
1. **⚙ Project settings → General → Your apps →** bấm icon **Web `</>`**.
2. Nickname `web` → **Register app** (không cần bật Hosting ở đây) → Continue to console.
3. Copy đoạn `firebaseConfig`:
```js
const firebaseConfig = {
  apiKey: "AIza....",
  authDomain: "<PROJECT_ID>.firebaseapp.com",
  databaseURL: "https://<PROJECT_ID>-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "<PROJECT_ID>",
  storageBucket: "<PROJECT_ID>.appspot.com",
  messagingSenderId: "....",
  appId: "1:....:web:...."
};
```
> Nếu đoạn copy **thiếu `databaseURL`** → tự thêm theo URL ở B4.

---

## Phần 2 — Điền cấu hình vào code

### B6. Web — `web/js/firebase-config.js`
Thay các placeholder bằng giá trị thật:
```js
export const firebaseConfig = {
  apiKey: "AIza....",                 // ← từ B5
  authDomain: "<PROJECT_ID>.firebaseapp.com",
  databaseURL: "https://<PROJECT_ID>-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "<PROJECT_ID>",
  storageBucket: "<PROJECT_ID>.appspot.com",
  messagingSenderId: "....",
  appId: "1:....:web:...."
};
```

### B7. Project ID — `.firebaserc`
```json
{ "projects": { "default": "<PROJECT_ID>" } }
```

### B8. Firmware ESP1 — đầu `firmware/src/esp1_main/main.cpp`
```cpp
#define FB_API_KEY      "AIza...."     // ← chính apiKey ở B5
#define FB_DATABASE_URL "https://<PROJECT_ID>-default-rtdb.asia-southeast1.firebasedatabase.app/"
```
> WiFi + email/pass thiết bị KHÔNG hardcode — nạp qua provisioning. ESP2 không cần sửa gì.

---

## Phần 3 — Deploy Rules + Hosting (terminal)

Tại thư mục `smart-humidity-iot`:
```bash
firebase login                  # đăng nhập bằng 2591317@student.hcmute.edu.vn (chủ project)
firebase use <PROJECT_ID>        # trỏ tới project
firebase deploy --only database  # đẩy firebase/database.rules.json
firebase deploy --only hosting   # deploy web/ → https://<PROJECT_ID>.web.app
```

---

## Phần 4 — Phân quyền (seed UID) — BẮT BUỘC

Không seed thì sẽ **không ghi được** `/config` (admin) và `/sensor`,`/status` (thiết bị).

### B9. Lấy `ADMIN_UID`
1. Mở web đã deploy → **Đăng nhập với Google** bằng `2591317@student.hcmute.edu.vn`.
2. F12 → **Console**: đọc dòng `[app] Đã đăng nhập. UID = xxxx` → copy (`ADMIN_UID`).
   *(Hoặc xem Authentication → Users.)*

### B10. Ghi quyền vào Realtime Database
**Realtime Database → Data** → bấm **+** ở node gốc, tạo cấu trúc (`true` kiểu **boolean**):
```json
{
  "admins":  { "<ADMIN_UID>":  true },
  "devices": { "<DEVICE_UID>": true }
}
```
- `ADMIN_UID` (B9) → quyền ghi `/config` (Hₛₑₜ/Deadband).
- `DEVICE_UID` (B3) → quyền ghi `/sensor`,`/status` (ESP/injector).

> Kết quả: người lạ bị chặn đọc · chỉ admin ghi cấu hình · chỉ thiết bị ghi số đo.
> (Có test tự động ở `tests/rules/` kiểm chứng đúng các luật này.)

---

## Phần 5 — Kiểm tra ngay (KHÔNG cần phần cứng)

```bash
cd tools/data-injector
cp config.example.js config.js     # điền firebaseConfig (nhất là databaseURL)
                                   # + deviceEmail / devicePassword (tài khoản B3)
npm install
npm start                          # mỗi ~3s ghi /sensor + /status
```
→ Mở web → đăng nhập admin → thấy **nhiệt độ/độ ẩm + biểu đồ realtime**, badge **Quản trị viên**,
chỉnh được Hₛₑₜ/Deadband; injector thỉnh thoảng đặt `tank="empty"` để thử **cảnh báo cạn nước**.

---

## ⚠️ Lỗi hay gặp
| Triệu chứng | Cách xử lý |
|---|---|
| Đăng nhập Google báo `auth/unauthorized-domain` | Authentication → **Settings → Authorized domains → Add domain**: thêm `localhost` (+ domain hosting nếu cần). |
| Web trắng / `Permission denied` khi đọc | Chưa đăng nhập, hoặc `databaseURL` sai/thiếu trong `firebase-config.js`. |
| Không chỉnh được Hₛₑₜ (`permission-denied`) | `ADMIN_UID` chưa seed vào `/admins` (B10) — kiểm tra đúng UID. |
| Injector/ESP ghi `/sensor` lỗi | `DEVICE_UID` chưa seed `/devices`, hoặc sai email/pass thiết bị. |
| `firebase deploy` sai project | Chạy lại `firebase use <PROJECT_ID>` hoặc sửa `.firebaserc`. |
| Mở web bằng `file://` lỗi module/auth | Phải chạy qua HTTP: đã `deploy hosting`, hoặc `firebase serve`. |

---

## Tóm tắt: 4 chỗ cần điền
1. `web/js/firebase-config.js` — firebaseConfig (B6)
2. `.firebaserc` — `<PROJECT_ID>` (B7)
3. `firmware/src/esp1_main/main.cpp` — `FB_API_KEY` + `FB_DATABASE_URL` (B8)
4. RTDB `/admins/<ADMIN_UID>=true` + `/devices/<DEVICE_UID>=true` (B10)
