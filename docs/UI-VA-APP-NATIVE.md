# UI & App cấu hình — tài liệu trả lời khi bảo vệ

Đây là phần em tự chuẩn bị để lỡ thầy/cô hỏi xoáy vào 1 nút, 1 con số cụ thể trên giao diện thì em
trả lời được luôn, không bị đứng hình. Em chỉ ghi những gì **đang thật sự hiển thị** trên màn hình
(Web Dashboard + App cấu hình Android) — mấy chỗ em đang ẩn/comment tạm (bơm châm nước, gateway dự
phòng, nút chẩn đoán `/info` trên PWA) em không đưa vào đây, vì nó chưa lên hình nên không ai hỏi
tới, đưa vào chỉ rối thêm.

---

## PHẦN 1 — Web Dashboard (`web/`)

Link em deploy: https://smart-humidity-iot.web.app — đây là trang em làm để giám sát realtime và
cho admin chỉnh ngưỡng, không dùng để cấu hình mạng cho thiết bị (phần đó nằm ở App native, PHẦN 2).

### 1.1. Màn hình đăng nhập

Em bắt buộc phải đăng nhập Google mới vào được, vì em muốn phân biệt rõ ai là Admin, ai chỉ xem —
nếu để tự do vào xem không cần đăng nhập thì em không biết ai đang thao tác để phân quyền.

- Em để logo 💧 + tên hệ thống + 1 nút to duy nhất **"Đăng nhập với Google"**, không làm nhiều lựa
  chọn đăng nhập gây rối.
- Bấm vào là em gọi `signInWithPopup` với `GoogleAuthProvider`, và em cố tình ép hiện lại màn hình
  chọn tài khoản mỗi lần (`prompt: "select_account"`) — vì máy tính dùng chung phòng lab/nhà có
  thể có sẵn nhiều tài khoản Google, em không muốn nó tự đăng nhập nhầm tài khoản trước đó.
- Nếu đăng nhập lỗi (đóng popup giữa chừng, popup bị trình duyệt chặn, mất mạng, domain chưa được
  Firebase cho phép...) em dịch sẵn sang tiếng Việt, hiện ngay trong khung đỏ dưới nút — để người
  dùng biết lỗi gì mà không phải mở Console debug.
- Điểm em muốn nhấn mạnh nếu bị hỏi "seo không đăng nhập mà không xem được gì hết vậy": em chặn
  thật ở **Security Rules** trên Firebase, không phải chỉ ẩn giao diện — tức là dù có ai cố tình
  gọi thẳng API bỏ qua giao diện thì Firebase vẫn từ chối, không phải kiểu "giấu nút" cho có.

### 1.2. Header

Em để cố định trên đầu trang (sticky) để cuộn xuống vẫn thấy: logo, tên hệ thống, 1 chip nhỏ báo
online/offline (em nói kỹ ở mục 1.5), tên/email/avatar Google của người đang đăng nhập, badge vai
trò (Admin/Khách), và nút "Đăng xuất". Avatar em lấy thẳng từ `photoURL` Google trả về, tài khoản
nào không có ảnh thì em ẩn luôn khung avatar cho gọn.

### 1.3. Phân quyền Admin / Khách

Đây là chỗ em hay bị hỏi kỹ nhất nên em giải thích rõ luôn cách em làm:

- Sau khi đăng nhập, em đọc đường dẫn **`/admins/{uid}`** trên Realtime Database. Nếu giá trị đó
  là `true` thì em coi là Admin, còn lại (không tồn tại hoặc khác `true`) em coi là Khách. Em
  **seed UID admin bằng tay** thẳng trong Firebase Console, em không viết danh sách email nào
  trong code cả — vì UID mới là thứ Firebase Auth đảm bảo duy nhất, email thì có thể trùng/giả
  được ở tầng client.
- Nếu lúc đọc bị lỗi mạng, em cho thử lại tối đa 2 lần (đợi 600ms rồi 1200ms) trước khi kết luận
  là Khách — lý do là em sợ mạng chập chờn 1 lần mà hạ nhầm 1 admin thật xuống Khách ngay giữa lúc
  đang thao tác.
- Nếu là **Admin**: em cho hiện badge xanh "Quản trị viên", mở hết các ô trong form cấu hình, hiện
  nút "Lưu cấu hình".
- Nếu là **Khách**: em để badge xám "Khách (chỉ xem)", khoá hết (`disabled`) các ô nhập trong form
  cấu hình, ẩn hẳn nút Lưu, và hiện dòng "Chỉ xem — bạn không phải admin" để người ta hiểu ngay vì
  sao không bấm được.
- Nếu thầy hỏi "khoá kiểu này có chắc không, sửa code JS là qua được không" — em trả lời: khoá UI
  em làm chỉ là cho tiện, chốt chặn thật nằm ở **Security Rules** bên Firebase (chỉ UID nằm trong
  `/admins` mới được ghi `/config`, `/webSettings`). Ai có tìm cách gọi thẳng API bỏ qua giao diện
  thì Firebase vẫn trả lỗi `PERMISSION_DENIED`, em không dựa vào mỗi cái khoá trên màn hình.

### 1.4. Thẻ Nhiệt độ & Độ ẩm

- Em để 2 ô số to: **Nhiệt độ (°C)** 🌡️ và **Độ ẩm (%RH)** 💦. Em cho số chạy tăng/giảm mượt trong
  khoảng 0.5 giây mỗi lần có dữ liệu mới, thay vì nhảy số cứng — nhìn đỡ giật, giống app thời tiết
  thật.
- Dưới ô Độ ẩm em vẽ thêm 1 thanh mini thể hiện vùng Deadband (từ Min đến Max) và 1 chấm trắng là
  vị trí độ ẩm hiện tại, kèm 1 dòng chữ để người xem không phải tự tính:
  - Độ ẩm dưới Min → em ghi *"Dưới ngưỡng bật (h < min) → máy phun chạy"* (chữ xanh dương)
  - Độ ẩm trên Max → em ghi *"Trên ngưỡng tắt (h > max) → máy phun tắt"* (chữ vàng)
  - Ở giữa → em ghi *"Trong vùng ổn định min–max %RH"* (chữ xanh lá)
- Dữ liệu này em lấy từ đường dẫn **`/sensor`** (`temperature`, `humidity`, `timestamp`) — ESP đẩy
  lên mỗi ~4 giây, còn web em chỉ lắng nghe (`onValue`) chứ không tự polling — nên chart chạy mượt
  đúng lúc có dữ liệu mới, không tốn request thừa.

### 1.5. Trạng thái Online/Offline

Chỗ này em nghĩ hay bị hỏi vì nó không phải chuyện hiển nhiên — em xin giải thích kỹ:

- Em hiện dòng "Cập nhật: ..." (kiểu "X giây/phút/giờ trước") và 1 chấm tròn "Trực tuyến"/"Mất kết
  nối".
- Em **không tin trực tiếp** cờ `/status/esp1Online` do chính ESP tự ghi, vì theo em nghĩ thiết bị
  không thể tự báo đúng lúc **nó đang** mất kết nối được (nó đã mất kết nối thì làm sao còn ghi
  được gì lên Firebase nữa). Nên em tự tính lại bằng công thức của riêng em, dựa vào
  `/status/lastSeen` (epoch giây do ESP ghi mỗi lần còn sống) so với giờ hiện tại của máy đang mở
  web:
  ```js
  online = (now_seconds - lastSeen) < onlineTimeoutSec
  ```
- `onlineTimeoutSec` em để mặc định **15 giây**, nhưng cho phép đọc đè từ
  **`/webSettings/onlineTimeoutSec`** (admin tự chỉnh, em giới hạn 5–300 giây, xem mục 1.8). Em có
  thêm 1 timer chạy lại mỗi **5 giây** dù không có dữ liệu mới — vì em nhận ra nếu thiết bị chết
  hẳn thì Firebase sẽ không bắn sự kiện nào cả, mà em lại đang lắng nghe kiểu sự kiện (`onValue`),
  nên phải tự có đồng hồ riêng để "phát hiện im lặng" chứ không thể chỉ chờ sự kiện.
- Mỗi lần trạng thái đổi (không tính lần hiện đầu tiên khi mới load trang) em bật 1 toast: "✓ Đã
  kết nối lại với thiết bị" hoặc "⚠ Mất kết nối với thiết bị" — để người đang xem màn hình biết
  ngay có chuyện gì vừa xảy ra chứ không phải tự để ý con số.
- Khi offline em làm mờ (opacity 50%) 2 ô số Nhiệt độ/Độ ẩm để báo đây là dữ liệu cũ, tránh người
  xem tưởng nhầm là số đang cập nhật thật.
- Nếu em đang đăng nhập Admin và thấy cờ `/status/esp1Online` (ESP tự ghi) không khớp với cái em
  vừa tính được, em cho web tự ghi đè lại nó cho khớp — nhưng em làm vậy chỉ để ai mở thẳng
  Firebase Console xem cũng thấy số đúng, chứ giao diện web không hề dựa vào cờ đó để quyết định
  online/offline (nguồn quyết định thật vẫn là công thức `lastSeen` em nói ở trên).

### 1.6. Trạng thái hệ thống

**Máy phun sương** — em để 1 badge "Đang phun" (xanh dương, có hiệu ứng nhấp nháy lan toả cho dễ
chú ý) khi `/status/mist === true`, còn lại em để "Tắt" (xám).

**Mực nước (bồn)** — em vẽ hẳn 1 cái bồn chứa bằng SVG cho trực quan (kiểu màn hình SCADA công
nghiệp), có sóng nước gợn động liên tục để trông "sống", chứ không chỉ là 1 con số khô khan:
- Em lấy dữ liệu từ `/status/tank` — số nguyên **0 đến 3**, tương ứng số trong 3 đầu dò phao
  (M2/M3/M4) đang ngập nước lúc đó.
- Em quy ước 4 mức, mỗi mức 1 màu riêng để nhìn màu là biết ngay tình trạng:

  | Mức | Em ghi | Màu em chọn | Chú thích |
  |---|---|---|---|
  | 3 | Đầy nước | xanh lá | Đầy — 3/3 đầu dò ngập |
  | 2 | Bình thường | xanh dương | Bình thường — 2/3 |
  | 1 | Thấp | vàng | Thấp — 1/3 |
  | 0 | Rất thấp — cần châm nước | đỏ | Rất thấp — cần châm nước |

- Em tính % nước đổ đầy hình vẽ bằng `mức / 3` (tức 0%, 33%, 67%, 100%).

**Cảnh báo cạn nước** — em cố tình làm to và khó bỏ qua: 1 khung đỏ ngay đầu trang *"⚠ CẢNH BÁO
CHỦ SỞ HỮU: BỒN CẠN NƯỚC ⚠"*, icon rung lắc, nền nhấp nháy, và em cho kêu **bíp lặp lại mỗi 0.9
giây** (em tự phát bằng Web Audio API, sóng vuông 880Hz, không cần file âm thanh nào). Em chỉ bật
cảnh báo to này khi **đúng `tank === 0`** — mức 1 "Thấp" em chỉ cho hiện badge vàng thôi, không cho
kêu, vì em không muốn báo động giả liên tục lúc nước còn tạm ổn. Do trình duyệt chặn tự phát âm
thanh khi trang vừa mở (chính sách autoplay), em phải đợi người dùng chạm vào trang 1 lần bất kỳ
trước thì mới "mở khoá" phát được tiếng bíp.

### 1.7. Biểu đồ realtime ("📈 Biểu đồ realtime (60 điểm gần nhất)")

- Em dùng Chart.js vẽ 2 đường: Nhiệt độ (cam, trục trái) và Độ ẩm (xanh dương, trục phải).
- Em chỉ giữ tối đa **60 điểm gần nhất** — điểm cũ tự rớt ra khi có điểm mới, để chart không phình
  to mãi và nhìn vẫn rõ xu hướng gần nhất. Em cập nhật ngay khi `/sensor` đổi, không hẹn giờ vẽ lại
  cố định.
- Nhãn trục X em lấy giờ:phút:giây từ chính `timestamp` mà cảm biến gửi lên, chứ không lấy giờ của
  máy đang mở web — để tránh lệch nếu máy xem web bị sai giờ.
- Chart.js bản em dùng không có sẵn plugin vẽ đường ngưỡng, nên em tự viết thêm 2 lớp vẽ:
  - Em tô nhạt vùng thời gian máy đang phun sương (dải xanh dương mờ) để đối chiếu trực quan với
    đường độ ẩm.
  - Em vẽ 2 đường đứt nét **Max** (= Hset + Deadband, "tắt phun") và **Min** (= Hset − Deadband,
    "bật phun") ngay trên trục Độ ẩm — lấy đúng giá trị `/config` hiện tại, tự cập nhật ngay khi
    admin lưu cấu hình mới.

### 1.8. Form cấu hình ("🎛️ Cấu hình Deadband") — chỉ Admin sửa được

- **Chế độ phun sương** — em tự vẽ dropdown thay vì dùng `<select>` gốc, vì em thấy `<select>` mỗi
  hệ điều hành hiển thị 1 kiểu khác nhau, em muốn kiểm soát giao diện cho đồng nhất. Em cho 3 lựa
  chọn: *Tắt (off)* · *Liên tục (continuous)* · *Ngắt quãng (intermittent)*, và ghi chú thêm ngay
  dưới cho rõ: "off: luôn tắt · continuous: chạy theo Deadband bên dưới · intermittent: phun ngắt
  quãng (chi tiết do firmware quyết định)".
- **Hset (ngưỡng độ ẩm đặt)** — em cho nhập số, giới hạn hợp lệ **0–100 %RH**, em để mặc định 70.
- **Deadband ±** — em cho nhập số, giới hạn hợp lệ **0–50 %RH**, em để mặc định 5.
- **Ngưỡng báo mất kết nối** — em cho nhập số, giới hạn **5–300 giây**, mặc định 15; em ghi chú
  khuyên đặt lớn hơn chu kỳ đẩy dữ liệu thật của ESP (ví dụ ESP đẩy mỗi ~60 giây thì em khuyên đặt
  khoảng 90–150 giây), không thì sẽ báo offline giả mỗi lần ESP chỉ hơi trễ 1 nhịp thôi.
- Em cho hiện luôn 2 dòng tính sẵn ngay khi đang gõ (không cần bấm Lưu mới thấy): **"Ngưỡng TẮT
  phun (Max = Hset + Deadband)"** và **"Ngưỡng BẬT phun (Min = Hset − Deadband)"** — để admin hình
  dung ngay hệ quả trước khi lưu, đỡ phải tự cộng trừ.
- Khi bấm **"Lưu cấu hình"**, em làm theo đúng thứ tự:
  1. Em validate lại đúng các khoảng ở trên ngay phía client (khớp với Security Rules bên Firebase)
     — sai thì em báo lỗi tại chỗ luôn, không gửi lên Firebase làm gì cho tốn.
  2. Em ghi **song song** 2 đường dẫn khác nhau: `/config` (`hset`, `deadband`, `mode`,
     `lastUpdate`, `updatedBy`) và `/webSettings` (`onlineTimeoutSec`, `lastUpdate`, `updatedBy`)
     — em tách riêng 2 chỗ này vì ESP chỉ cần đọc `/config` thôi, còn `onlineTimeoutSec` chỉ web
     em dùng để tính online/offline, ESP không cần biết tới giá trị này.
  3. Thành công em bật toast xanh "✓ Đã lưu cấu hình". Nếu Firebase Rules từ chối (không phải
     admin thật, hoặc token hết hạn) em báo ngay tại form, không dùng toast — vì lỗi này em muốn
     người dùng đọc kỹ hơn, không để nó tự biến mất sau vài giây.
- Nếu em đang gõ dở 1 ô nào đó mà đúng lúc có người khác vừa lưu cấu hình mới, em **không cho** dữ
  liệu server đè lên ô em đang gõ — sợ mất nội dung đang nhập dở. Nhưng 2 đường Min/Max trên biểu
  đồ và dòng trạng thái độ ẩm (mục 1.4) thì em luôn cập nhật ngay theo giá trị server, vì đó là
  cấu hình đang thật sự chạy trên thiết bị lúc đó, không phải bản nháp em đang gõ thử.
- Em để chân form hiện "Cập nhật lần cuối: ..." và "Bởi: ..." lấy thẳng từ `/config` — để biết ai
  vừa chỉnh gần nhất mà không cần hỏi nhau.

### 1.9. Thông báo dạng toast

Em để góc dưới-phải, tự biến mất sau khoảng 3.2 giây. Em dùng cho: lưu cấu hình thành công, mất
hoặc khôi phục kết nối thiết bị. Riêng lưu cấu hình **thất bại** em cố tình báo ngay tại form thay
vì toast — vì em muốn người dùng có đủ thời gian đọc kỹ lỗi, chứ toast tự tắt nhanh quá dễ bỏ lỡ.

---

## PHẦN 2 — App cấu hình Android (native, `mobile-app/`)

Đây là app em build bằng Expo/React Native, cài qua file APK (em build trên EAS Build), gọi thẳng
HTTP tới ESP — không qua trình duyệt nên không bị chặn mixed-content như PWA. Em dùng đúng 1 "hợp
đồng" REST với ESP mà em nói ở PHẦN 3 bên dưới, không có API riêng gì khác.

### 2.1. Header
Em để "Smart Humidity IoT" / "Cấu hình thiết bị · App native".

### 2.2. Thẻ WiFi
- Em để switch **"Gửi WiFi"** (em để mặc định bật).
- Bật lên em cho hiện ô **"Tên WiFi (SSID) *"** (em bắt buộc nếu switch đang bật) và ô **"Mật khẩu
  WiFi"** kèm nút Hiện/Ẩn để người dùng xem lại mật khẩu vừa gõ có đúng không trước khi gửi.
- Tắt switch em chỉ làm mờ nhóm này chứ không disable cứng — logic thật nằm ở chỗ em không đưa
  field này vào payload khi bấm Gửi, chứ không phải ẩn input đi.

### 2.3. Thẻ MAC
- Em để switch **"Gửi MAC (ESP còn lại)"** (mặc định bật).
- Em cho ô nhập MAC (`11:22:33:44:55:66`) và nút **"Quét QR"** mở camera toàn màn hình quét mã QR
  in trên ESP kia (em dùng thư viện `expo-camera`, chỉ nhận loại mã "qr" cho gọn). Quét được em
  parse JSON, chỉ lấy đúng field `mac`, tự viết hoa rồi điền vào ô, và hiện Alert "Đã quét QR — đã
  điền MAC: ...". Nếu QR sai định dạng/JSON hỏng em báo "QR không hợp lệ — vui lòng nhập tay".
- Em ghi chú thêm: để trống ô này cũng được, vì ESP-NOW vẫn nhận broadcast bình thường không cần
  biết trước MAC.

### 2.4. Thẻ Đích gửi
- Em để switch **"Chế độ Test (mock-esp-server)"**.
- Tắt (mặc định, dùng cho thiết bị thật): em cho ô **"IP của ESP (SoftAP)"**, mặc định
  `192.168.4.1`.
- Bật (em dùng để test không cần phần cứng thật): em đổi sang ô **"URL mock server"**, em để mặc
  định `http://172.16.6.153:8080` — đúng IP LAN máy em chạy `tools/mock-esp-server` lúc test.
- Em cho hiện dòng xem trước "Đích: {url}/provision" cập nhật ngay khi đang gõ, để người dùng biết
  chắc app sắp gửi tới đâu trước khi bấm.

### 2.5. Nút "Kiểm tra kết nối (GET /provision)"
Đây chính là lý do em phải làm hẳn app native này: bên PWA chạy HTTPS em không gọi được API này
(bị trình duyệt chặn mixed-content), còn app native em gọi thẳng được bình thường. Bấm vào em gọi
`GET /provision`:
- Gọi được em báo "Kết nối OK — ESP đã phản hồi" (thêm "(đã có cấu hình)." nếu `provisioned:
  true`).
- ESP trả lỗi HTTP em báo "ESP phản hồi lỗi (HTTP xxx)."
- Không tới được thiết bị (mất mạng, sai IP, chưa nối đúng WiFi ESP) em báo lỗi kèm gợi ý kiểm tra
  WiFi/IP/mock-server luôn, đỡ người dùng phải đoán.
- Em cho kết quả hiện ngay dưới nút dạng banner (icon tròn ✓/✕ kèm tóm tắt), có nút "▼ Xem chi
  tiết kỹ thuật" để ai cần thì xổ ra xem đúng JSON thô ESP trả về.

### 2.6. Nút "Gửi cấu hình" (POST /provision)
- Em bắt buộc phải bật ít nhất 1 trong 2 switch (WiFi/MAC), không thì em báo "Chưa chọn mục nào".
- Bật WiFi mà bỏ trống SSID em báo "Thiếu thông tin".
- Em chỉ gửi field của mục đang bật (partial update) — cố tình làm vậy để không đụng tới field ESP
  đã lưu trước đó của mục đang tắt, tránh gửi thiếu mà xoá nhầm dữ liệu cũ.
- Em **tin theo mã HTTP (2xx) là tín hiệu thành công chính**, không bắt buộc body phải đúng chuẩn
  JSON — vì thực tế em từng gặp board ngoài hiện trường trả JSON lệch chuẩn dù đã xử lý thành công.
- Gửi thành công em chuyển hẳn sang màn hình kết quả riêng (icon ✓ to, tiêu đề "Cấu hình thành
  công!", kèm MAC thiết bị nếu ESP có trả về), nút dưới cùng em đổi thành **"OK"**.
- Thất bại em vẫn dùng màn hình kết quả đó nhưng icon ✕, tiêu đề "Thiết bị từ chối cấu hình" hoặc
  "Không gửi được tới thiết bị" (kèm gợi ý kiểm tra WiFi/IP/mock-server), nút dưới em đổi thành
  **"Thử lại"** — để phân biệt rõ với trường hợp thành công, người dùng không cần đọc kỹ chữ vẫn
  biết cần làm gì tiếp.
- Cả 2 trường hợp em đều cho xem khối JSON thô (xem mục 2.8) nếu ESP có trả dữ liệu về.

### 2.7. Nút "Khởi động lại (POST /reboot)"
- Em cho hiện hộp thoại xác nhận trước khi gửi thật, vì đây là hành động không hoàn tác — chọn
  "Khởi động lại" mới thực sự gửi lệnh, "Huỷ" thì thôi không làm gì cả.
- Em gửi `POST /reboot {action:true}`. Kết quả em cho hiện **ngay tại chỗ** (banner dưới nút),
  không dùng Alert popup — đây là theo đúng yêu cầu UX em đã chốt lại trước đó cho gọn hơn.

### 2.8. Hộp JSON chi tiết (dùng chung cho mọi kết quả — kiểm tra kết nối / gửi cấu hình / reboot)
- Em cho toàn bộ chữ trong hộp này là **`selectable`** — long-press vào bất kỳ đâu sẽ hiện popup
  chọn/copy gốc của Android (bôi đen đoạn muốn lấy, có nút Copy/Share/Select all của hệ điều hành),
  không chỉ copy được nguyên khối như trước.
- Nếu nội dung là 1 JSON object hợp lệ, em tách từng field (`id`, `mac`, `ssid`...) ra 1 dòng
  riêng, kèm 1 nút "⧉" để copy **riêng đúng giá trị field đó** (em đổi thành "✓" khoảng 1.6 giây
  sau khi bấm để người dùng biết đã copy xong).
- Em vẫn giữ thêm 1 nút **"⧉ Sao chép tất cả"** ở trên để ai cần copy nguyên văn cả khối trong 1
  chạm cũng được.
- Nếu nội dung không phải JSON hợp lệ (ví dụ 1 thông báo lỗi mạng bình thường), em cho hiện nguyên
  khối text (vẫn selectable) chứ không cố tách field.

### 2.9. Quét QR (modal riêng)
Em mở toàn màn hình, dùng camera sau. Nếu chưa cấp quyền camera em hiện nút "Cấp quyền camera" để
xin ngay tại chỗ. Em có thêm nút "Đóng" để thoát ra không cần quét, phòng khi người dùng đổi ý
muốn gõ tay MAC.

---

## PHẦN 3 — Nền tảng chung: hợp đồng REST giữa App ↔ ESP

Cả app native lẫn PWA em đều gọi đúng 1 bộ API này trên ESP (chạy khi ESP đang ở chế độ SoftAP, em
quy ước giữ nút BOOT lúc cấp nguồn mới vào chế độ này) — em ghi rõ ra đây để lỡ thầy hỏi "app gửi
gì, ESP xử lý sao" thì em trả lời chính xác từng field:

- **`GET /info`** → em thiết kế trả về danh tính thiết bị: `{id, role, mac, fw, provisioned}`.
- **`POST /provision`** (JSON) → em nhận `{ssid?, password?, peerMac?}` — em cố tình làm
  **partial update**: field nào có mặt trong JSON thì ESP mới ghi đè, field nào vắng mặt thì ESP
  giữ nguyên giá trị cũ đã lưu. Em bắt buộc phải gửi ít nhất 1 field. ESP lưu vào Preferences (bộ
  nhớ flash NVS) rồi em cho tự `ESP.restart()` sau khoảng 1 giây.
- **`GET /provision`** → em cho đọc lại đúng những gì vừa ghi: `{ssid, hasPassword, peerMac,
  provisioned}` — em cố tình **không bao giờ trả mật khẩu WiFi thật** ra ngoài, chỉ báo có/không
  (`hasPassword`) để tránh lộ mật khẩu nếu ai đó dò ra được IP của AP.
- **`POST /reboot`** `{action: true}` → ESP khởi động lại ngay theo em yêu cầu tường minh; thiếu
  field hoặc `action` khác `true` em cho trả lỗi 400, không reboot (tránh reboot nhầm do gọi API
  sai). Endpoint này chỉ hoạt động khi ESP đang ở chế độ SoftAP, em không cho chạy khi ESP đã vào
  WiFi nhà bình thường (đỡ tốn thêm RAM lúc chạy thật).
- **Vì sao em chọn tin theo mã HTTP (2xx) thay vì đọc đúng field JSON**: em từng gặp thực tế board
  ngoài hiện trường chạy firmware khác bản, có lúc trả JSON lệch chuẩn hoặc thậm chí rỗng dù đã xử
  lý thành công thật — nên em quyết định cả app native lẫn PWA đều coi **HTTP 2xx là tín hiệu
  thành công duy nhất bắt buộc**, còn JSON trả về em chỉ dùng để hiển thị thêm thông tin nếu đọc
  được, không bắt buộc phải đúng chuẩn.

### 3.3. Vì sao em phải làm thêm App native (câu hỏi em nghĩ hay bị hỏi nhất)
Em gọi cấu hình qua trình duyệt (HTTPS) tới ESP ở `http://192.168.4.1` thì bị chặn theo 1 trong 2
cơ chế bảo mật của trình duyệt (Local Network Access cần xin quyền, hoặc mixed-content chặn thẳng
luôn) — em đã xác nhận bằng test thật, gọi trực tiếp cùng API đó bằng công cụ khác thì ESP vẫn trả
JSON đúng bình thường, nên em chắc chắn đây là trình duyệt chặn chứ không phải lỗi phía ESP. Vì
vậy em làm app native, không phải trang web nên không dính 2 cơ chế chặn này — em gọi thẳng HTTP
tới ESP bình thường, không cần lách gì cả.

> Em ghi chú thêm: em vẫn còn giữ 1 bản PWA (`mobile/`, chạy trình duyệt) trong repo để dùng nội bộ
> lúc test/quét QR nhanh không cần cài APK, nhưng đó không phải phương án em trình bày chính.
