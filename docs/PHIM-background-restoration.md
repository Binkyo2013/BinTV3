# PHIM: giữ player khi Home → foreground (2.5.12 / 246)

## Chẩn đoán từ code

1. `PhimController.beginForegroundRepair` trước đây đòi hỏi WebView còn
   `superview`, `window` và bounds hợp lệ. Sau ~0,54 giây không đạt thì tạo
   WebView mới. UIKit có thể tháo view của presenter khi trình bày `.fullScreen`;
   vì vậy mất window không chứng minh WebContent đã chết. Tạo lại WebView làm
   mất phần tử video cùng presentation/controls của WebKit. Nhánh restore web
   còn gọi `startMoviePlayback`, nạp lại nguồn rồi seek. Đây là đường code có
   thể gây mất fullscreen dù app vẫn có mask landscape đúng.
2. SwiftUI `scenePhase` trước đây chỉ snapshot web/schedule repair, không chuyển
   inactive/active đến native player như các callback UIApplication. App dùng
   SwiftUI scene, không có SceneDelegate riêng; phải xử lý được cả scene-only
   lẫn tín hiệu app/scene trùng nhau.
3. Native resume trước đây dùng delayed work rồi seek completion gọi `play()`.
   Completion thiếu kiểm tra app active, có thể phát sau lần Home tiếp theo.
   Fullscreen transition completion cũng có thể gọi `play()` sau suspension.

Đây là các lỗi xác định được trong code. Không có iPhone hoặc log runtime của
lần lỗi người dùng để khẳng định nhánh nào đã chạy trên thiết bị đó.

## Thay đổi

- Probe trang đang giữ ngay cả khi presenter tạm rời window. Không tái tạo view
  vì thiếu hierarchy, timeout JS hay evaluator tạm không trả lời. Chờ sự kiện
  active/reattach tiếp theo để thử lại. WebContent termination, URL mất/sai và
  trạng thái trang thực sự mất vẫn có đường recovery.
- Nếu DOM player còn mở, không phát lại nguồn chỉ để sửa browser shell ẩn.
- Gộp app/scene lifecycle cho PHIM, snapshot native đúng một lần mỗi chu kỳ.
  `willEnterForeground` không đụng player; chỉ resume khi app active.
- Giữ AVPlayer, item, controller và presentation hiện có; không seek, present,
  dismiss, gán gravity/controls trong resume. Pause tiếp tục pause (không gọi
  thêm thao tác player). Đang phát thì resume rate đã giữ.
- Chặn completion fullscreen cũ và ready callback phát trong lúc suspended.
- Không sửa App.swift, mask landscape, navigation, LIVE TV, TUBE, SETTING,
  app.js hay lưu/chọn trình phát. Chỉ cập nhật metadata bản build ngoài PHIM.

## Kiểm tra tự động

- `npm install --prefix tests/ios-native-handoff --no-audit --no-fund`
- `npm test --prefix tests/ios-native-handoff`: 304 assertions, gồm regressions
  lựa chọn player, bridge, navigation wiring, gesture, menu, phụ đề, danh sách
  tập; thêm 10 chu kỳ event Home cho video paused/playing với cùng DOM node.
- `python3 tests/ios-native-handoff/lifecycle_native.py` trên máy có Swift:
  trích trực tiếp methods Swift đang dùng vào test doubles, kiểm tra pause,
  playback rate, callback trùng, scene-only, premature active, 10 chu kỳ,
  completion AVKit cũ, không seek/recreate, recovery policy.
- Workflow IPA chạy cả hai bộ test trước khi archive iOS và verify IPA.

Test doubles/DOM assertions KHÔNG mô phỏng UIKit/WebKit rendering hoặc chứng
minh iPhone giữ fullscreen. Cần thực hiện ma trận thiết bị bên dưới.

## Kiểm tra bắt buộc trên iPhone — CHƯA THỰC HIỆN trong sandbox

Lặp cho cả lựa chọn **Tích hợp** và **iOS native**, không đổi lựa chọn giữa lúc
đang test. Thử cả landscape trái/phải và khóa xoay bật/tắt.

| Ca | Kỳ vọng | Trạng thái thiết bị |
|---|---|---|
| PHIM → Home → quay lại | Vẫn landscape, không reload trang | Chờ kiểm tra |
| Mở phim fullscreen, đang phát → Home → quay lại | Cùng fullscreen, không chạy từ đầu | Chờ kiểm tra |
| Fullscreen → pause → Home → quay lại | Cùng fullscreen, vẫn pause, cùng mốc thời gian/controls/gravity | Chờ kiểm tra |
| Lặp Home nhanh 10 lần, cả playing và pause | Không autoplay sai, không mất fullscreen | Chờ kiểm tra |
| LIVE TV, TUBE, SETTING + quay lại PHIM | Playback, navigation, lưu lựa chọn player không đổi | Chờ kiểm tra |

Kiểm tra thêm danh sách tập/subtitle khi mở, đóng fullscreen chủ động, Safari
handoff, buffer khi Home và tiến trình WebContent bị terminate thực sự. Không
cam kết giữ nguyên system controls nếu iOS đã hủy tiến trình/presentation; đây
không phải cùng trường hợp background thông thường với player còn sống.

Log mong đợi cho Home bình thường: native `retained`/`held`, WebView probe `ok`
hoặc `defer`; `webViewGeneration` không tăng, không `rebuild`, `play begin`,
`loadCandidate` hoặc native close do lifecycle. Nếu vẫn lỗi, cần log cùng lựa
chọn player/iOS version để phân biệt WebKit tự kết thúc fullscreen với recovery
của ứng dụng.
