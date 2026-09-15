# BinTV iOS — TrollStore Build (FIXED)

> **Bản mới nhất: 2.5.8 (build 242)** — **GỠ nút "TẬP" + TÊN PHIM khỏi màn
> hình trình phát**: player iOS giữ nguyên giao diện mặc định, player web chỉ
> còn dòng trạng thái; **TẬP chỉ còn trong MENU LONG-PRESS** (giữ màn hình
> khi đang phát → LIVE TV · TUBE · SETTING · TẬP · BACK; phim lẻ 1 tập không
> có TẬP). Chi tiết: mục `### Build 242 (2.5.8)` ở cuối file · Cách lấy file:
> artifact `BinTV-trollstore-unsigned` (chứa `BinTV.ipa`) của workflow
> "Build unsigned IPA (TrollStore)".

## Build by GitHub Actions

1. Upload this repository to GitHub
2. Go to **Actions** → **"Build unsigned IPA (TrollStore)"**
3. Click **Run workflow** (defaults: Xcode mặc định, Release, mode `archive`)
4. Wait for the job to finish
5. Download artifact **`BinTV-trollstore-unsigned`** — bên trong là **`BinTV.ipa`**

Nếu build thất bại:
- Mở trang **Job summary** — 15 dòng `error:` gần nhất được in sẵn ở đó.
- Tải artifact **`BinTV-build-log`** để xem `xcodebuild.log` đầy đủ.
- Buoc **Preflight** chặn sớm các lỗi phổ biến: file Swift thiếu trong
  Compile Sources, UUID rác trong pbxproj, scheme chỉ đến target sai,
  Info.plist/bundle ID không đọc được.

## What was fixed (ban FIXED)

- `BinTV.xcscheme`: `BlueprintIdentifier` trỏ sai UUID target →
  `xcodebuild -scheme BinTV` lỗi ngay bước đầu. Đã trỏ đúng target `BinTV`.
- `project.pbxproj`: kiểm tra lại đầy đủ — 12 file Swift trong Compile
  Sources, không UUID treo, `AppDelegate.swift` cố ý KHÔNG build (trùng
  khai báo với `App.swift`, đánh dấu `ci-skip`).
- `StreamService.swift`: bỏ `@MainActor` (gây lỗi khởi tạo ở một số
  phiên bản Swift), các cập nhật `@Published` chuyển về MainActor bằng
  `MainActor.run` — giữ nguyên hành vi UI.
- `import Combine` bổ sung cho `StreamService`, `NetworkService`,
  `AVPlayerManager` (cần cho `ObservableObject`/`@Published`).
- `Info.plist`: thêm `UILaunchScreen`, bỏ 2 key rác
  (`UITabBarController`, `UIViewControllerBasedStatusBarAppearance`).
- `Assets.xcassets`: thêm `Contents.json` gốc; resize 8 icon AppIcon về
  đúng kích thước chuẩn (40/60/58/87/80/120/120/180) — actool không nhận
  icon 1024 cho tất cả các slot.
- `PlayerView.swift`: keypath `\.self` chuẩn hóa.
- Workflow: `archive` mặc định (tạo `.xcarchive`), `set -o pipefail` +
  `PIPESTATUS` (tee không còn che exit code), kiểm tra `.xcarchive`,
  tìm `.app` thật bằng `find`, tạo `BinTV.ipa`, kiểm tra IPA sâu
  (Payload/*.app, Info.plist, executable +x, Mach-O arm64/arm64e iOS,
  không có file `._`), upload IPA + build log artifact.

## Install with TrollStore

1. Transfer `BinTV.ipa` to your iPhone
2. Open TrollStore
3. Tap `BinTV.ipa`
4. Install → Done
5. Open BinTV from home screen

## Project Structure

- `BinTV/App/` — App entry and delegate
- `BinTV/Views/` — SwiftUI screens (Live TV, Player, Settings, Movies)
- `BinTV/Models/` — Channel / Stream data models
- `BinTV/Services/` — Network and stream loading
- `BinTV/Player/` — AVPlayer management (`AVPlayerManager.swift` cho LIVE TV,
  `PhimNativePlayerController.swift` = trình phát gốc iOS của tab PHIM, nhận
  `streamUrl` từ web app qua message handler `playVideoNative`)
- `BinTV/Subtitle/` — WebVTT subtitle loader
- `BinTV/Storage/` — UserDefaults preferences
- `BinTV/Assets.xcassets/` — App icons from BinTV.png
- `tests/ios-native-handoff/` — test jsdom cho luồng JS(WKWebView) → Swift(AVPlayer)
  của tab PHIM (`npm install && node run.js`, không cần Xcode/iPhone)
- `.github/workflows/build-ipa.yml` — CI pipeline

## Note

This port maintains the original BinTV functionality for iOS: live TV streams, multi-server selection, video playback, subtitle support, and no-login access. Exact stream endpoints should be verified from the original APK API responses if needed; default network layer uses configurable base URL.

---

## Fix 2026-09-12 (build 217) — Landscape lock + PHIM playback restored

Two targeted fixes on top of the existing port (no rewrite, no new dependencies,
web assets untouched byte-for-byte):

1. **Playback (root cause):** `WKWebViewConfiguration.allowsInlineMediaPlayback = true`
   was missing (default `false` on iPhone) — WebKit ignored the `playsinline`
   attribute and hijacked `<video>` into a native fullscreen player that cannot
   render hls.js/MSE content, producing "Không thể phát nguồn phim này trên TV".
   Set before `WKWebView(frame:configuration:)` init in `BinTV/Phim/PhimWebView.swift`,
   plus a passive `[PHIM_DEBUG]` media-event observer for on-device verification.
2. **Orientation (3 layers):** Info.plist landscape-only for iPhone **and iPad**,
   new per-window `application(_:supportedInterfaceOrientationsFor:) -> .landscape`
   in `AppDelegate` (clamps WebKit/AVKit fullscreen windows, sheets, alerts), and
   hardened geometry requests (never portrait, both landscape directions, correct
   `UIDeviceOrientation` KVC domain on iOS 15). Independent of Rotation Lock by design.

Also: structured `[PHIM_DEBUG] Step -> Action -> Status -> Payload` logging with
token sanitization across `PhimLocalServer`/`PhimWebView`; build number 216 → 217.

- Full technical report (Vietnamese): `BAOCAO-KYTHUAT-FIX-2026-09-12.md`
- Mock E2E test suite (Node ≥18 / Python ≥3.9, no extra deps): `cd tests/mock-e2e && node run_all.js` — 244/244 assertions pass (T1 real app.js slices, T2 m3u8 rewrite port, T3 live-HTTP proxy chain with Referer-gated mock CDN, T4 project consistency).

## Fix UI 2026-09-12 (build 218) — Tabbed Browser UI + Adaptive Scaling

- Browser-style tab strip on top (open/close/select tabs, "+" → New Tab
  Page speed-dial icon grid); closing a tab only detaches it from the
  strip — the 4 underlying pages stay alive in the same TabView (tags
  0…3), so playback/state is never destroyed.
- Long-press ≥0.35s (unchanged gesture plumbing) now toggles the tab
  strip for immersive video; a small top grabber restores it.
- All app-drawn chrome scales via `UIProportions` (env `\.uiProps`):
  scale = clamp(landscapeHeight/390, 0.82, 1.15) — iPhone SE … Pro Max …
  iPad. Removed hard-coded 230pt Settings column, 40×40 TUBE buttons,
  140pt grid minimum.
- New files: `Views/{UIProportions,BrowserTabs,BrowserTabBar,NewTabPageView}.swift`
  (registered in pbxproj). Orientation lock & playback fix untouched.
- Version 217 → 218, MARKETING_VERSION 2.1.6 → 2.2.0. Test suite now
  310/310 (see `tests/mock-e2e/`).

## Fix UI 2026-09-12 (build 219) — Fullscreen + Long-press Overlay Menu

- Removed the top browser tab strip (build 218) and kept the system bottom
  tab bar permanently hidden: content now fills the screen edge-to-edge
  (no nav bar, 0 spacing top/bottom).
- Navigation: long-press ≥0.35s anywhere → blurred fullscreen overlay
  (`.ultraThinMaterial` + dim) with 4 ICON-ONLY buttons (tv / film /
  popcorn / gear — no text labels, VoiceOver labels only). Tap an icon →
  switches page instantly and dismisses; tap backdrop → dismiss only.
- Gesture plumbing unchanged (proven UIKit recognizers: global on
  UITabBarController + per-webview on TUBE/PHIM; no SwiftUI
  onLongPressGesture → no scroll/tap/video-control conflicts).
- Removed files: `Views/BrowserTabs.swift`, `Views/BrowserTabBar.swift`,
  `Views/NewTabPageView.swift` (also de-registered from pbxproj).
  Added: `Views/GestureOverlayMenuView.swift`.
- Adaptive scaling (build 218) retained; overlay metrics scale SE…iPad.
- Version 218 → 219, MARKETING_VERSION 2.2.0 → 2.3.0. Tests: 302/302.

## Preflight CI fix 2026-09-12 (no app version change — still 219/2.3.0)

- Root cause of the GitHub Actions failure at step `Preflight (pbxproj +
  scheme vs source files)`: repo still contained the three deprecated
  build-218 files (`BrowserTabs/BrowserTabBar/NewTabPageView.swift`)
  while the new pbxproj no longer registers them → preflight error
  "3 file .swift/.m KHONG nam trong Compile Sources". Fix = DELETE those
  three files on GitHub (zip patches cannot express deletions — see
  `PREFLIGHT-FIX-INSTRUCTIONS.txt` inside the preflight patch zip).
- Preflight hardened (workflow): new two-way check 2.1b — every
  Compile Sources entry must exist on disk (catches the mirrored case
  "Build input file cannot be found" BEFORE xcodebuild wastes minutes);
  actionable fix hints printed for both failure directions; still
  `sys.exit(rc)` — no error masking.
- Tests: new T4.9 guards the CI gate itself. Suite now 314/314.

## xbuild.log 2026-09-12 (workflow only — still 219/2.3.0)

- Every run now produces ONE consolidated log: `build/Output/xbuild.log`,
  uploaded as artifact **`xbuild-log`** (`if: always()`) — including runs
  that fail early at Detect/Preflight (the old `xcodebuild.log` was only
  created at the Build step, so early failures had no downloadable log).
- New `Init xbuild.log` step right after checkout writes a header (UTC
  time, run URL, ref/sha, inputs, runner). Each script step is wrapped:
  `{ ... } 2>&1 | tee -a "$XLOG"` + `exit "${PIPESTATUS[0]}"` with a
  `[STEP END] <name> exit=N` marker — real exit codes preserved (bash
  3.2-safe, no error masking).
- Build step runs xcodebuild directly (`RC=$?`); its full output flows
  into xbuild.log through the wrapper. Job summary + failure printer now
  read xbuild.log. Tests: 318/318 (T4.9 guards the logging pipeline).

## IPA build fix 2026-09-12 (from real xbuild.log, run 34690803983)

- Root cause of the failed run: repo still carried the three deprecated
  build-218 files while pbxproj 219 no longer registers them → Preflight
  correctly failed (`3 file ... KHONG nam trong Compile Sources`).
- Fix without manual deletion: the three files are replaced by TOMBSTONES
  (comment-only, zero code) whose first line is `// ci-skip: DEPRECATED
  build 219 ...` — the workflow's own documented intentional-exclusion
  mechanism, printed transparently in every log. Delete them for real
  whenever convenient; the build does not change.
- Workflow wrapper fix found via the real log: GitHub runs `shell: bash`
  as `bash -eo pipefail`, which aborted failing steps BEFORE the
  `[STEP END]` marker; added `set +e` around the tee pipelines (real
  exit codes still returned) and around `xcodebuild` (RC capture).
- Tests: 326/326. xcodebuild/archive/IPA on a real runner: NOT VERIFIED
  from this sandbox — the next Actions run is the gate.

## Nav gestures + PHIM black-screen fix 2026-09-12 (build 220 / 2.4.0)

- Menu stays hidden by default (fullscreen); second reveal gesture added:
  swipe in from the RIGHT screen edge (parallel to long-press). Menu can
  no longer open invisibly under the player sheet.
- Swipe in from the LEFT edge = Back exactly one step, in navigation
  order: overlay menu -> player sheet -> webview history (canGoBack) ->
  no-op at root (never quits the app).
- PHIM black screen after tab switching: root cause = missing
  `webViewWebContentProcessDidTerminate` (terminated WebContent process
  leaves a permanently black WKWebView). Fixed with the official delegate
  (reload ONLY on process death; localStorage cache survives) plus a
  `setNeedsDisplay()` repaint on tab re-appear (no needless reload, state
  preserved). Same lifecycle fix applied to TUBE's webview.
- New gestures use cancelsTouchesInView=false / delaysTouchesBegan=false:
  video controls, scrolling and web taps unaffected. Tests: 338/338.

## Menu bar thật sự biến mất + Back cạnh trái + PHIM giữ trạng thái (build 221 / 2.4.1)

Root cause của "menu bar vẫn hiện" ở bản 219/220: `TabChromeController`
(UIViewControllerRepresentable gắn ở `.background()` NGOÀI `NavigationView`)
đi NGƯỢC lên `vc.parent` để tìm `UITabBarController`, trong khi
UITabBarController là HẬU DUỆ của root hosting controller → không bao giờ
tìm thấy → `tabBar.isHidden` không chạy (bar vẫn hiện) và cả long-press
global lẫn 2 edge-pan cũng không bao giờ được gắn.

- **Bỏ hẳn `TabView`**: 4 trang xếp trong `ZStack` do `ContentView` điều
  khiển → không có UITabBarController → không có menu bar nào để ẩn, và
  nội dung chiếm TOÀN BỘ màn hình (lấy lại đúng vùng bar cũ).
- **Giữ trang trong hierarchy**: `mountedTabs` — trang đã mở thì không bao
  giờ bị gỡ (webview PHIM/TUBE không rời window) → hết màn hình đen, giữ
  nguyên trạng thái đang xem, không reload.
- **Gesture gắn thẳng trên `UIWindow`** (tổ tiên của mọi view, phủ cả
  sheet): giữ ≥0.35s = menu; vuốt cạnh phải = menu; vuốt cạnh trái = Back
  1 bước (menu → sheet player → lịch sử webview → lùi tab trước đó → root
  no-op, không bao giờ thoát app).
- **Delegate `shouldReceive`** nhường vùng có gesture riêng: WKWebView
  (long-press riêng của webview; swipe back/forward nội bộ của TUBE),
  UIControl/ô nhập liệu (chọn/paste), menu đang mở, player sheet → không
  xung đột với thao tác vuốt/điều khiển video hiện có.
- PHIM: thêm `restoreIfEmpty()` (chỉ nạp lại khi webview thật sự trống,
  tối đa 3 lần, reset khi tải xong) bên cạnh
  `webViewWebContentProcessDidTerminate` đã có ở bản 220.
- Tests: **430/430 PASS** (T1 40 + T2 55 + T3 53 + T4 211 + **T5 71** —
  mirror state-machine của luồng menu/Back/PHIM). Swift parse-check toàn
  bộ file bằng toolchain Swift thật: PASS (không có macOS/UIKit → chưa
  compile/link; cổng xác nhận = GitHub Actions build 221).

## Back cạnh trái: vuốt mép TỰ PHÁT HIỆN (build 222 / 2.4.2)

`UIScreenEdgePanGestureRecognizer` gắn trên `UIWindow` bị hệ thống "gate"
mất quyền ưu tiên ở vùng mép màn hình → triệu chứng thực tế: giữ màn hình
hiện menu được, nhưng vuốt cạnh trái không Back. Thay bằng
`BinTVEdgeSwipeRecognizer` (`UIPanGestureRecognizer` + tự tính vùng mép):
bắt đầu trong dải `min(max(width×0.09, 30), 70)` pt sát mép, vuốt NGANG
≥45pt (`|x| > |y|·1.5`) → Back (trái) / hiện menu (phải), **đúng 1 lần cho
mỗi lần vuốt**. Vẫn gắn trên window (phủ cả sheet player), chỉ gắn trên
window thật của app, gắn lại khi app trở lại foreground. Root Back: rung
xác nhận, không thoát app. Tests: **462/462 PASS** (có T5.5 mô phỏng nhận
diện vuốt).

## LIVE TV: sửa nút fullscreen (đen màn hình + dừng phát) — build 223 / 2.4.3

Đang phát LIVE TV, bấm nút fullscreen (mũi tên 2 chiều) → video dừng và
player đen. Hai nguyên nhân gốc, sửa cả hai:

1. **Thiếu view-controller containment.** `GravityVideoPlayer` cũ là
   `UIViewRepresentable` trả `coordinator.view` — lấy **view** của
   `AVPlayerViewController` mà không bao giờ `addChild`. Nút fullscreen của
   AVKit kích hoạt **full screen presentation** (thao tác cấp view
   controller) ⇒ thiếu VC cha = vùng chứa không hiển thị ⇒ **đen**. Đổi sang
   **`UIViewControllerRepresentable`** (SwiftUI tự lo containment).
2. **AVKit pause player khi chuyển chế độ trình bày** (hành vi đã biết).
   Coordinator nay làm `AVPlayerViewControllerDelegate`: nhớ trạng thái phát
   (`rate > 0`) và gọi lại `play()` **sau** khi transition kết thúc (bỏ qua
   khi `isCancelled`) — cả khi vào lẫn khi thoát fullscreen; PiP không tự
   đóng player inline.

Không tự gây gián đoạn: `update` chỉ gán lại player/gravity khi thật sự đổi
(so bằng `rawValue`), và `dismantle` **không** tháo player. FIT/FILL, chế độ
TV khóa ngang và việc dọn player khi đóng sheet giữ nguyên. Tests:
**480/480 PASS** (T4.12 có 18 assertion mới).

## Đồng bộ player chuẩn iOS + giao diện lưới PHIM + fix PHIM đen khi ở nền — build 224 / 2.4.4

**1. Một player chuẩn iOS dùng chung.** `BinTVNativePlayer` =
`UIViewControllerRepresentable` bọc `AVPlayerViewController` (đúng view
controller nằm sau SwiftUI `VideoPlayer`, containment đầy đủ) → điều khiển
gốc của iOS: phát/tạm dừng, tua, AirPlay, PiP, fullscreen. **Pinch 2 ngón**
đổi chế độ xem: PHÓNG TO = **FIT → FILL → FULL** (mỗi bước 18% tỉ lệ, reset
sau mỗi bước; FULL = `fullScreenCover` dùng CHUNG một `AVPlayer` nên không
tải lại, không gián đoạn); THU NHỎ đi ngược lại. Pinch chạy đồng thời với
gesture của AVKit (không cướp thao tác).
- **Đã loại bỏ logic tự dựng:** xoá `phim_player_ui.js` (HUD player của
  PHIM) và xoá thanh điều khiển tự dựng của LIVE TV — trùng chức năng với
  điều khiển gốc + pinch. TUBE giữ nguyên WebKit native fullscreen (đã là
  player chuẩn iOS; không cướp quyền YouTube sang AVPlayer vì URL có chữ ký,
  dễ hỏng phát).
- PHIM **không tự** bật fullscreen (`AUTO_FULLSCREEN = false`): player
  fullscreen là lớp phủ của hệ thống → phụ đề/danh sách tập dạng DOM sẽ bị
  ẩn. Vào player native bằng 1 chạm vào nút fullscreen chuẩn của iOS.

**2. Giao diện tab PHIM:** 4 thẻ/hàng (từ 6), lưới tràn sát 2 viền màn hình
(chỉ chừa safe-area), poster giữ đúng 16:9, **tên phim + năm sản xuất
xuống dưới ảnh** (bỏ gradient phủ lên poster) → thẻ cao ≈160px (gấp ≈2,3
lần), chữ to hơn.

**3. Tab PHIM đen sau khi ra màn hình chính:** xử lý đúng 3 cơ chế gốc —
(1) WebContent process chết lúc ở nền → **hoãn** reload tới khi app active
(reload lúc nền không hoàn tất = đen); (2) socket server nội bộ bị đóng →
đảm bảo server sống **trước** khi reload; (3) webview không vẽ lại → ép
`setNeedsLayout/setNeedsDisplay` + đọc layout/`resize`. Reload chỉ khi thăm
dò DOM xác nhận webview thật sự trống; còn nội dung thì chỉ vẽ lại, không
reload (giữ nguyên phim đang xem).

Tests: **515/515 PASS** (T4.13–T4.16 mới). JS inject kiểm bằng `node --check`.

## PHIM: toàn màn hình (viewport) + thẻ phim dãn kín + sửa màn hình đen khi ở nền — build 225 / 2.4.5

**A. PHIM không toàn màn hình / còn viền đen 2 bên — root cause là viewport.**
`index.html` khai báo `width=1920,height=1080` (bố cục TV) nên trang bị thu nhỏ
vừa màn hình iPhone (~764px trong 932px) → nội dung nhỏ + lộ ~84px đen mỗi
bên. Script `viewportFixJS` chạy ở **document start** ép đúng
`width=device-width, initial-scale=1, viewport-fit=cover` (và chặn zoom trang).

**B. Thẻ phim:** `flex: 1 1 calc(25% - 10px)` — có `flex-grow` nên thẻ tự dãn
lấp kín chiều ngang (cả hàng cuối), `max-width: calc(50% - 10px)` để không
bao giờ phình quá nửa hàng; bỏ hẳn padding ngang; poster vẫn **16/9** (không
méo, không crop); chữ tên 15px / năm 13px.

**C. Màn hình đen khi ra Home rồi mở lại — mọi đường đều có hạn mức:**
- **Watchdog 3s**: không chứng minh được webview sống **và đang vẽ** → nạp lại.
- **Kiểm tra thật sự đang vẽ** bằng `callAsyncJavaScript` +
  **`requestAnimationFrame`** (DOM sống nhưng không vẽ vẫn là đen — trường hợp
  build 224 bỏ sót vì `evaluateJavaScript` có thể không bao giờ gọi về).
- Ép vẽ lại: `setNeedsLayout/setNeedsDisplay` + **nudge scroll 1px**.
- Tối đa 2 lần nạp lại mỗi lượt foreground; chứng minh được còn sống thì
  **không reload** (giữ nguyên phim đang xem).

Tests: **517/517 PASS** (T4.17–T4.18 mới). JS inject kiểm bằng `node --check`.

## Sửa lỗi biên dịch CI của build 225 + guard chống lặp lại — build 226 / 2.4.6

Run CI của 225 lỗi `exit 65` vì **2 nguyên nhân**:
1. Patch thay thế theo vùng đã **xoá nhầm 3 hàm** (`configureAudioSession`,
   `injectStatusBarInset`, `injectStatusBarInsetPublic`) → "cannot find … in
   scope". Đã khôi phục nguyên vẹn từ bản 224 (đối chiếu byte) và rà lại toàn
   bộ danh sách khai báo.
2. Gọi sai chữ ký `callAsyncJavaScript` (thiếu nhãn `in` thứ hai của
   `contentWorld`) → "extra trailing closure passed in call". Đã bỏ hẳn API
   này, kiểm tra "đang vẽ" bằng **2 bước `evaluateJavaScript`**: gắn bộ đếm
   `requestAnimationFrame` → đọc lại sau 900 ms (≥2 khung = đang vẽ).

**Guard mới T4.19:** `baseline_symbols.json` lưu 640 khai báo của 20 file
Swift (tạo bằng `tests/mock-e2e/make_baseline.py`); test soi từng khai báo và
**fail ngay** nếu có cái biến mất khỏi mã nguồn (kể cả khi bị đẩy vào
comment). Guard tự kiểm chứng bằng cách giả lập xoá 1 hàm.

### Build 228 (2.4.8) — PHIM toàn màn hình + lưới phim + hết màn hình đen

- **Toàn màn hình PHIM (root cause):** `PhimLocalServer` **viết lại
  `<meta name="viewport">` ngay trong HTML trả về** (`width=device-width,
  viewport-fit=cover`) — không dùng script chạy sau, không phụ thuộc cache.
- **Lưới phim (root cause):** CSS được **tiêm từ mã Swift** (`layoutFixJS` mỗi
  lần nạp trang, `!important`) vì file CSS trong bundle có thể stale/cache:
  4 thẻ/hàng + `flex-grow` dãn kín, bỏ padding ngang, sidebar 100px, lề an toàn
  ghỉm tối đa 20px, poster **16/9 + `object-fit:cover`** (hết letterbox, không
  méo), tên + năm nằm dưới ảnh.
  → iPhone 14 Pro Max ngang: thẻ **116pt → 190pt** (+64%).
- **Hết màn hình đen (root cause):** lưới render 0 thẻ trong khi DOM vẫn sống
  nên mọi kiểm tra "còn sống" cũ đều vô tác dụng. Cơ chế mới **đo trạng thái
  render thật** (số thẻ / `player-active` / bề rộng lưới) rồi xử lý theo
  nguyên nhân: gỡ class ẩn → làm mới bằng chính luồng web app (click lại danh
  mục, giữ trạng thái) → nạp lại bỏ cache (+ kiểm tra `/health`, nối lại
  listener nếu socket chết) → tối đa 3 lần → overlay "Thử lại".

### Build 229 (2.4.9) — Module PHIM theo chuẩn Stremio addon (đa nguồn)

- **File mới `BinTV/Phim/Web/assets/stremio.js`**: client Stremio thuần giao thức —
  không chứa URL nào (đã có assertion kiểm chứng). Nhận diện manifest/catalog/meta/stream
  theo chuẩn, phân loại mọi loại stream (`url` HLS/mp4 · `ytId` · `infoHash`/torrent →
  magnet · `externalUrl` · `behaviorHints.headers`), dùng `idPrefixes`/`resources` để
  biết addon nào phục vụ id nào.
- **JSONBin**: ưu tiên `target_urls` (mảng), fallback `target_url` (tương thích cấu hình
  cũ), quét đệ quy mọi dạng lồng nhau → sửa `target_urls` là app tự nhận nguồn mới,
  không cần build lại.
- **Nạp song song + chịu lỗi**: một addon lỗi/timeout bị bỏ qua, không ảnh hưởng các addon khác.
- **Gộp**: catalog của mọi addon thành **một danh sách PHIM** (mỗi catalog nhớ `_addon`);
  **tìm kiếm** chạy trên tất cả addon (`/catalog/<type>/<id>/search=<q>.json`);
  danh sách kết quả được **khử trùng** rồi **sắp xếp theo năm sản xuất** bằng đúng
  logic cũ (`sortMovieItemsByProductionYear` — không đổi).
- **Stream**: hỏi TẤT CẢ addon phù hợp, gộp + gỡ trùng + ưu tiên nguồn phát được,
  tự gắn `Referer` từ `behaviorHints.headers` vào proxy. Khi không phát được sẽ báo
  **đúng nguyên nhân** (torrent cần debrid / YouTube / mở ngoài) thay vì chung chung.
- Kiểm chứng: `node tests/mock-e2e/run_all.js` → T1–T5 **579/579**;
  `node tests/stremio-e2e/run.js` (dữ liệu thật) → **44/44** (có trong T6 của run_all).

### Build 231 (2.5.1) — iPhone hết lỗi "Không thể phát trên TV": phim đi qua TRÌNH PHÁT GỐC iOS

**Triệu chứng (máy thật):** mở tab PHIM thì lưới thẻ phim hiển thị bình thường, nhưng
bấm vào thẻ để xem → hiện **"Không thể phát nguồn phim này trên TV"** và video không
khởi chạy. Cùng nguồn đó, bản Android/Windows/Tizen TV phát bình thường.

**Root cause:** tab PHIM phát bằng thẻ `<video>` HTML5 trong WKWebView. Nhiều nguồn
Stremio addon (vnstream, viptorrent, vimo, sc.k-20…) trả về **container MKV** hoặc
**audio AC3/EAC3/DTS** — WebKit KHÔNG giải mã được → `video.onerror` → app.js thử hết
mọi nguồn dự phòng (cũng cùng loại) → rơi vào **nhánh fallback dành cho TV/player
ngoài** của bản Android/Tizen và in ra câu "…trên TV". Trên iPhone không tồn tại
`webapis.avplay` nên nhánh đó KHÔNG phát gì cả: chỉ có thông báo lỗi.

**Cách sửa (4 lớp, không né nguồn, không đổi URL gốc, không phá bản Android/Tizen):**

1. **`BinTV/Player/PhimNativePlayerController.swift` (MỚI)** — trình phát GỐC của iOS
   cho tab PHIM: nhận `streamUrl`, mở `AVPlayerViewController` (cùng loại player với
   LIVE TV/TUBE, có điều khiển chuẩn, AirPlay, PiP, fullscreen). Mỗi nguồn có **2 ứng
   viên** thử lần lượt trên cùng một player (không nhấp nháy): `direct` (URL gốc —
   AVPlayer tự gửi Range) và `proxy` (qua `PhimLocalServer` — forward Referer/UA, DoH,
   RawHttp cho `http://`). HLS → thử proxy trước (playlist đã được rewrite); file
   progressive → thử direct trước (proxy phải tải hết file mới trả lời). Hết ứng viên
   → báo JS + tự đóng, KHÔNG giả vờ đang phát.
2. **`BinTV/Phim/PhimWebView.swift`** — đăng ký `WKScriptMessageHandler`
   **`playVideoNative`**; user script mới `nativeHandoffJS` (document-start) cung cấp
   `window.__bintvPlayVideoNative/…StopVideoNative` và **bắt sự kiện người dùng CLICK
   thẻ phim** (ghi id + tên phim làm tiêu đề); kết quả phát (started/failed/closed)
   trả về JS bằng `evaluateJavaScript` (payload JSON-hoá, kèm `session` chống race).
   `allowsInlineMediaPlayback = true` + `mediaTypesRequiringUserActionForPlayback = []`
   giữ nguyên (điều kiện cần cho cả đường web lẫn native).
3. **`BinTV/Phim/Web/assets/app.js`** — **vô hiệu hoá nhánh TV/external player khi chạy
   trên iOS WKWebView** (`webapis.avplay` bị chặn có chủ đích), và thay nhánh
   "Không thể phát … trên TV" bằng **handoff sang native**:
   • *pre-flight*: nguồn là MKV/AVI/FLV/WMV/RMVB/DIVX/MPG, hoặc file progressive quảng
   cáo AC3/EAC3/DTS/TrueHD/Atmos → chuyển thẳng sang AVPlayer, không đốt thời gian chờ
   `<video>` fail (HLS vẫn để web phát trước vì WebKit phát HLS rất tốt);
   • *error path*: `<video>` lỗi → thử hết nguồn dự phòng web → đưa **nguồn xếp hạng
   cao nhất** sang native → native fail thì thử tiếp nguồn web kế tiếp → chỉ khi MỌI
   đường đều thua mới hiện thông báo **đúng thiết bị** ("…không phát được trên iPhone…",
   không còn chữ "trên TV").
   Trần 3 lần handoff/phiên + mỗi URL chỉ gửi 1 lần → không có vòng lặp JS ↔ native.
4. **`BinTV/Phim/Web/assets/phim_ios_fallback.js`** — thêm bậc leo thang cuối: src
   `/proxy` fail + src direct cũng fail (lần lỗi thứ 2 trên cùng src) → gọi
   `window.__bintvRequestNativePlayback("ios-fallback-error")` và chặn propagation để
   app.js không đổi src giữa chừng. **`BinTV/Info.plist`** — thêm
   `NSAppTransportSecurity → NSAllowsArbitraryLoads = true` để `PhimLocalServer`
   (URLSession/RawHttp) và AVPlayer tải được link `http://` (rất phổ biến ở CDN VN);
   giữ nguyên `NSAllowsLocalNetworking` + 2 `NSExceptionDomains` cũ.

**Không ảnh hưởng nền tảng khác:** mọi nhánh mới đều khoá bằng
`window.webkit.messageHandlers.playVideoNative` (chỉ tồn tại trong WKWebView iOS).
Android/Tizen/Windows không có handler → các hàm trả `false` → hành vi cũ nguyên vẹn
(có test khẳng định điều này).

**Kiểm chứng (không cần Xcode/iPhone):** `cd tests/ios-native-handoff && npm install && node run.js`
→ **72/72 PASS**. Test nạp `index.html` + toàn bộ assets + **đúng các user script trích
từ `PhimWebView.swift`** trong jsdom, stub `playVideoNative`, rồi kiểm: payload
`{url,title,proxyUrl,referer,reason,session}`, trích URL gốc từ src `/proxy`, bắt click
thẻ phim, chống gửi lặp, callback lệch session bị loại, thông báo hết chữ "trên TV",
dọn UI khi đóng player, bảng phân loại container/codec (trích hàm THẬT từ app.js) và
hành vi khi không có cầu nối.

**Giới hạn ghi rõ (không hứa suông):** AVFoundation giải mã rộng hơn WebKit (HLS/MP4/MOV,
AC3/EAC3) nhưng **vẫn không mở được Matroska** — nếu addon CHỈ có `.mkv` progressive thì
native cũng báo lỗi thật và app.js thử nguồn kế tiếp; đường đúng cho trường hợp đó là
addon trả HLS/MP4 (hoặc debrid). Phụ đề (Vietsub/OpenSubtitles) đã được xử lý ở build
232 — xem `### Build 232 (2.5.2)`.

### Build 234 (2.5.3) — Phim bộ tự đóng rồi phát tập kế · ưu tiên trình phát tích hợp · gesture điều hướng trong trình phát

**Vấn đề (ROOT CAUSE) của bản 2.5.2:**

1. **Phim bộ dừng ở màn hình chọn tập.** Build 233 chỉ *chuyển tập trên cùng
   trình phát đang mở* (`playNextMovieEpisode`). Khi trình phát đóng trước khi
   tập kế tiếp kịp nạp (nguồn chậm, backstop 10s của Swift, hoặc native đóng),
   luồng bị dừng và UI rơi về màn hình CHỌN TẬP — đúng triệu chứng "hết tập là
   đứng ở danh sách tập".
2. **Trình phát iOS mở NGAY TỪ ĐẦU.** `startMoviePlayback` có **pre-flight
   handoff**: chỉ cần `iosNeedsNativePlayerFor()` báo nguồn là MKV/AVI/AC3… hoặc
   cờ latching `moviePreferNativePlayer` còn bật (native từng phát thành công
   trong phiên) là `requestNativeMoviePlayback()` chạy **trước khi** thẻ `<video>`
   được thử → phần lớn nguồn Stremio mở AVPlayerViewController ngay, mất HUD/phụ
   đề/chọn tập của app. Trái yêu cầu "ưu tiên trình phát tích hợp".
3. **Không có Return/tua bằng gesture trong trình phát.** PHIM là SPA nên
   `webView.canGoBack` luôn `false` → vuốt cạnh trái không làm gì; trong trình
   phát lại càng không có gesture tua/đóng.

**Hành vi mới (tab PHIM — không đụng LIVE TV / TUBE / SETTING):**

1. **Phim BỘ hết tập:** trình phát **TỰ ĐÓNG** (native nhận action `stop`,
   web gỡ overlay) → nạp nguồn tập kế → **TỰ ĐỘNG mở lại trình phát và phát tập
   tiếp theo**. Không dừng ở màn hình chọn tập. Hết **tập cuối** → đóng + về
   CHỌN TẬP (như cũ). **Phim LẺ** giữ nguyên: hết/đóng → về lưới PHIM.
2. **Ưu tiên trình phát:** mọi lần phát đều bắt đầu bằng **trình phát TÍCH HỢP**
   (thẻ `<video>` của app). Chỉ khi nó **không phát được** — `video.onerror` cả
   proxy lẫn direct (`phim_ios_fallback.js`), hết mọi nguồn web dự phòng
   (`handleMoviePlaybackError`) — mới handoff sang **trình phát iOS**
   (`AVPlayerViewController`). Lỗi "ma" đến muộn sau khi trình phát đã đóng bị
   chặn (không còn mở iOS ngoài ý muốn).
3. **Gesture điều hướng (ngữ cảnh trình phát):**
   - **Không ở trong trình phát:** vuốt từ **cạnh trái** = **RETURN** về màn hình
     trước (Return của chính PHIM → tab trước; recognizer tự phát hiện mép, KHÔNG
     dùng gesture Back mặc định của iOS). Vuốt cạnh phải = mở menu tab (như cũ).
   - **Đang ở trong trình phát:** vuốt **NGANG** từ cạnh trái/phải = **TUA**
     (tương đương giữ & kéo thanh tiến trình; ~1/3 thời lượng cho hết chiều ngang,
     kẹp 120–600s, throttle 12 lệnh/giây) — **không** Return. Vuốt từ **TRÊN
     xuống** = **RETURN**: đóng trình phát, quay về màn hình trước khi phát.
   - Gesture không xung đột: recognizer mới chỉ được **nhận touch khi có trình
     phát đang mở**; long-press mở menu bị chặn khi trình phát iOS đang phủ.

**Cách làm (file nào sửa gì):**

- `BinTV/Phim/Web/assets/app.js`
  - Bỏ hẳn pre-flight handoff trong `startMoviePlayback` (giữ
    `iosNeedsNativePlayerFor` làm chẩn đoán/log); thêm khối chính sách
    `MOVIE_INTEGRATED_PLAYER_FIRST`.
  - `startMovieAutoAdvance()` / `isMovieAutoAdvanceValid(serial)` /
    `cancelMovieAutoAdvance()`: hết tập → đóng trình phát → nạp nguồn tập kế
    (guard serial chống race) → `startMoviePlayback` mở lại. Dùng chung cho cả
    đường `<video>` (`handleMoviePlaybackCompleted`) và đường native
    (`__bintvNativePlaybackEnded`). Mọi thao tác người dùng (Return, chọn
    tập/phim khác, rời màn hình PHIM) huỷ luồng đang chờ.
  - `__bintvNativePlaybackClosed` không mở lại màn hình chọn tập khi luồng tự
    chuyển tập đang chạy; `onerror`/`play().catch` bỏ qua lỗi khi trình phát đã đóng.
  - Cầu nối gesture: `__bintvPhimReturn()`, `__bintvPlayerBeginSeek()`,
    `__bintvPlayerSeekTo(giây)`, `__bintvPlayerEndSeek()`, `movieHasReturnTarget()`
    + mirror `uiState` (`canReturn`, `playerOpen`, `positionMs`, `durationMs`)
    qua message `phimBridge` (gửi khi đổi, ~1 giây/lần khi đang phát).
- `BinTV/Views/ContentView.swift` — `BinTVPlayerGestureHub` +
  `BinTVPlayerGestureContext` (sổ đăng ký trình phát đang mở);
  `BinTVEdgeSwipeRecognizer` thêm cạnh `.top` + phiên TUA (`SeekSession`) +
  `applySeek` (đích tua tuyệt đối, throttle); recognizer `.top` chỉ nhận khi có
  trình phát; long-press bị chặn khi trình phát iOS đang phủ.
- `BinTV/Phim/PhimWebView.swift` — mirror `uiState` từ web app; đăng ký ngữ cảnh
  trình phát cho gesture; `registerBackHandler` nay gọi **Return của web app**
  (`__bintvPhimReturn`) thay vì `goBack()` của WebKit (SPA không có history);
  `setTabActive()` để trình phát ẩn của tab khác không nhận gesture.
- `BinTV/Player/PhimNativePlayerController.swift` — đăng ký ngữ cảnh trình phát
  iOS (vị trí/thời lượng đọc trực tiếp từ `AVPlayer`); `closeByUserGesture()`
  (vuốt trên-xuống = Done: đóng + báo JS quay về màn hình trước); `seekTo` giữ
  nguyên trạng thái phát/tạm dừng.
- `BinTV/Phim/Web/assets/phim_ios_fallback.js` — chặn lỗi muộn khi nguồn rỗng/
  trình phát đã đóng (không leo thang sang trình phát iOS ngoài ý muốn).
- `tests/ios-native-handoff/run.js` — SUITE E cập nhật theo luồng mới (E1/E7/E9)
  + **SUITE F mới** (ưu tiên trình phát, Return, tua, mirror uiState, lỗi muộn,
  wiring Swift): **174/174 PASS**.
- `BinTV/Info.plist` + `BinTV.xcodeproj/project.pbxproj` — build 234 / 2.5.3.

**Giới hạn nói rõ:** AVFoundation vẫn không mở Matroska — nếu addon CHỈ có `.mkv`
progressive thì trình phát tích hợp lỗi (1 lần thử proxy + 1 lần direct) rồi
handoff sang trình phát iOS; nếu cả hai đều lỗi thì app.js thử nguồn kế tiếp của
addon và cuối cùng mới báo lỗi thật (không bao giờ "giả vờ đang phát").

### Build 233 (2.5.2) — Phim bộ tự chuyển tập · đóng/hết phim quay về đúng giao diện · chống treo trình phát

**Vấn đề:** phim bộ đang xem hết tập thì trình phát đứng yên (không next); đóng
trình phát luôn về lưới phim (mỗi lần đổi tập phải bấm lại phim từ đầu); trường
hợp xấu (AVPlayer dừng ở cuối phim / kẹt nguồn) trình phát "treo" tới mức phải
tắt cả app.

**Hành vi mới (tab PHIM, cả đường web `<video>` lẫn trình phát gốc iOS):**

1. **Phim BỘ (series):**
   - Tập phát hết → **tự động chuyển sang tập tiếp theo** (giữ nguyên trình phát;
     trình phát native thay nguồn ngay trên cùng `AVPlayerViewController` đang mở,
     không nhấp nháy). Phát hết tập cuối → đóng trình phát, về **giao diện CHỌN TẬP**.
   - NgườI dùng đóng trình phát (Done/vuốt/Back) → về **giao diện CHỌN TẬP**
     (focus sẵn ở tập vừa xem) thay vì lưới phim như trước.
2. **Phim LẺ (movie):**
   - Phát hết hoặc đóng trình phát → về **giao diện PHIM** (lưới phim).
   - **Chống treo:** mọi nhánh kết thúc đều tự thu player về; trình phát native
     có thêm backstop tự đóng nếu phía web không trả lời trong 10s (45s khi đang
     nạp tập mới) — không bao giờ cần tắt cả BinTV để thoát.

**Cách làm (additive, không phá luồng cũ; Android/Tizen/Electron giữ nguyên hành vi
khi không có cầu nối iOS):**

- `BinTV/Player/PhimNativePlayerController.swift` — observer
  `AVPlayerItemDidPlayToEndTime` → callback `onEnded` mới → JS; 2 backstop
  (`endedGraceTimeout` 10s / `prepareNextTimeout` 45s) hết hạn → `autoCloseAfterEnded`
  tự đóng + bắn `onClosed` (chống double-callback bằng `dismissingByFailure`);
  API `prepareNextEpisode()` để JS giữ player trong lúc nạp tập mới.
- `BinTV/Phim/PhimWebView.swift` — nối `onEnded` → `__bintvNativePlaybackEnded`;
  action mới `prepareNext` (helper JS `__bintvPrepareNextNativeEpisode`).
- `BinTV/Phim/Web/assets/app.js` —
  - `__bintvNativePlaybackEnded`: series còn tập → báo prepareNext rồi
    `playNextMovieEpisode`; hết tập/phim lẻ → `stopMoviePlayback()` (gửi stop cho
    native) rồi về chọn tập / lưới PHIM. JVHD giữ luồng riêng.
  - `htmlVideo.onended` (đường web) đi qua `handleMoviePlaybackCompleted` dùng
    chung — trước đây video hết là player đứng im.
  - `moviePreferNativePlayer`: native đang hiển thị thì mọi lần phát kế tiếp
    (next-tập/đổi tập/nguồn dự phòng) tiếp tục đi qua native — `<video>` nằm SAU
    lớp native nên không được nhận phát.
  - `movieEpisodeSwitchSerial` + `abortGuard` trong `loadMovieStreams` (chỉ nhánh
    chuyển tập): đóng player giữa chừng nạp tập → kết quả bị huỷ, player KHÔNG tự
    bật lại (chống race mạng chậm).
  - `reopenMovieEpisodePicker()` dùng chung cho: người dùng đóng player web
    (`handleMovieBackAction`), đóng player native (`__bintvNativePlaybackClosed`),
    hết tập cuối — phim lẻ no-op.
- `tests/ios-native-handoff/run.js` — SUITE E (29 test mới) trên jsdom: toàn bộ
  kịch bản trên + stale-session + race; **138/138 PASS**.

### Build 232 (2.5.2) — Phụ đề hiển thị NGAY TRONG trình phát native

**Giới hạn còn lại của build 231:** khi phim phải chuyển sang TRÌNH PHÁT GỐC iOS
(`AVPlayerViewController` — lớp phủ của HỆ THỐNG), phụ đề do app.js render bằng DOM
(`#bintv-movie-subtitle-text`) bị che khuất → xem phim native thì **mất Vietsub**, dù
đã bật CC.

**Cách sửa (không chép lại logic phụ đề, không đụng bản Android/Tizen):** app.js vốn
đã tải + parse SRT/VTT thành `movieSubtitleCues`; bây giờ danh sách cue đó được **đẩy
sang Swift** để vẽ lại đúng nhịp trên chính player native:

1. **`BinTV/Phim/Web/assets/app.js`** — hàm mới `pushMovieSubtitlesToNative(cues, label)`
   nén cue thành `{s,e,t}` (giây) và gửi qua cầu nối **chỉ khi** trình phát native đang
   chạy (`movieNativeHandoffActive`). Được gọi ở 3 thời điểm: (a) native vừa báo
   `__bintvNativePlaybackStarted` mà Vietsub đang bật; (b) `applyMovieSubtitle` tải xong
   phụ đề trong lúc native đang phát; (c) `disableMovieSubtitle` (tắt Vietsub → gửi
   `cues = []` để gỡ). Không có cầu nối (Android/Tizen/Windows) → trả `false`, hành vi
   cũ nguyên vẹn.
2. **`BinTV/Phim/PhimWebView.swift`** — cầu nối `nativeHandoffJS` thêm
   `window.__bintvSetNativeSubtitles(payload)` → postMessage `{action:"subtitles", label,
   cues, session}`; message handler `playVideoNative` nhận `action == "subtitles"` (đặt
   TRƯỚC nhánh `stop` để không bị nhầm là lệnh đóng) → parse cue thành
   `[NativeSubtitleCue]` → gọi `nativePlayer.updateSubtitles(...)` trên main thread.
3. **`BinTV/Player/PhimNativePlayerController.swift`** — struct mới `NativeSubtitleCue`
   `{start, end, text}`; `updateSubtitles` **khoá theo `session`** (phụ đề tải xong muộn
   sau khi người dùng đã chuyển phim → bị bỏ qua, không đè phụ đề phim mới). Hiển thị
   bằng `UILabel` treo trên `contentOverlayView` của AVPlayerViewController (vẽ trên cả
   khi fullscreen), đồng bộ bằng `addPeriodicTimeObserver` 250ms + tìm câu đang chiếu
   bằng **binary search** (cùng thuật toán `renderCurrentMovieSubtitle` của app.js).
   Dọn sạch (label + observer) khi đổi nguồn / đóng player / báo lỗi (`teardownCurrentItem`).

**Không ảnh hưởng nền tảng khác:** mọi nhánh mới đều khoá bằng
`isIosNativePlaybackBridge()` / `window.__bintvSetNativeSubtitles` (chỉ tồn tại trong
WKWebView iOS). Android/Tizen/Windows không có cầu nối → hàm trả `false` → phụ đề DOM
cũ chạy nguyên vẹn (có test khẳng định).

**Kiểm chứng (không cần Xcode/iPhone):** `cd tests/ios-native-handoff && npm install &&
node run.js` → **91/91 PASS** (72 cũ + 19 mới — SUITE C: cầu nối `__bintvSetNativeSubtitles`,
nén cue `{s,e,t}`, khớp `session`, tắt phụ đề → `cues=[]`, không đẩy khi chưa handoff/đã
đóng, hành vi khi không có cầu nối, và wiring Swift `action == "subtitles"` /
`updateSubtitles` / `contentOverlayView`). Swift compile/link vẫn do GitHub Actions xác nhận.

### Build 241 (2.5.7) — Mở app vào thẳng PHIM · menu LONG-PRESS trong video player

**1. Module mặc định khi khởi động = PHIM** (trước đây là LIVE TV):
`selectedTab` / `mountedTabs` / `tabHistory` trong `ContentView` đều khởi tạo từ
`BinTVPage.phim`; các tab còn lại vẫn mount lazy và giữ nguyên trạng thái như cũ.

**2. Giữ màn hình (long-press ≥0.35s) KHI ĐANG PHÁT VIDEO → MENU NGỮ CẢNH**, KHÔNG
còn tự động back/thoát về danh sách phim:
- Module **PHIM, phim bộ nhiều tập**: 5 nút **LIVE TV · TUBE · SETTING · TẬP · BACK**.
- Module **PHIM, phim lẻ 1 tập** và mọi player khác (**LIVE TV, TUBE**): 4 nút
  **LIVE TV · TUBE · SETTING · BACK** (không có TẬP).
- **TẬP**: player iOS mở lại panel danh sách tập sẵn có (`requestEpisodePicker`);
  player web kích hoạt đúng nút "Tập" của app.js
  (`#bintv-movie-player-episodes-btn`) → chọn tập của đúng phim đang phát.
- **BACK**: lùi ĐÚNG MỘT lớp (panel tập → player; player native PHIM → chọn tập/
  lưới; player web → `__bintvPhimReturn`; LIVE TV mức FULL pinch → player inline →
  lưới kênh; TUBE fullscreen → trang watch → goBack 1 bước). Không thoát app,
  không về Home, không back nhiều lớp.
- LIVE TV/TUBE/SETTING trong menu: gỡ lớp player phủ toàn màn hình (sheet/modal/
  fullscreen WebKit) rồi chuyển trang; player inline ẩn theo lớp trang.

**3. Kỹ thuật:** `BinTVPlayerMenuCenter` (singleton) + overlay UIKit vẽ thẳng lên
KEY WINDOW (phủ được AVPlayerViewController modal, sheet LIVE TV và WINDOW
RIÊNG của video fullscreen WebKit/TUBE — long-press được gắn trên MỌI `UIWindow`
qua `didBecomeVisible/didBecomeKey`). Bốn trình phát đăng ký ngữ cảnh theo ưu
tiên: phim-native (100) > livetv (80) > tube (60) > phim-web (50). Long-press
ngoài player giữ NGUYÊN hành vi BACK 1 lớp (build 235); các gesture vuốt cạnh
(vuốt ngang tua, cạnh trái back, cạnh phải menu 4 tab, trên-xuống đóng player),
LIVE TV/TUBE/SETTING và nguồn `.json` của PHIM không thay đổi.

**Kiểm chứng:** `cd tests/ios-native-handoff && npm test` → **202/202 PASS**
(170 cũ + SUITE G mới: mặc định PHIM, menu 4/5 nút theo ngữ cảnh, TẬP chỉ cho
phim bộ, BACK một lớp, mọi recognizer đi qua menu center; runtime app.js khẳng
định nút TẬP mở danh sách cho phim bộ 3 tập và bị bỏ qua với phim lẻ).

### Build 242 (2.5.8) — Gỡ nút "TẬP" + tên phim khỏi trình phát (TẬP chỉ còn trong menu long-press)

**Yêu cầu:** khi đang xem phim, KHÔNG được có nút TẬP (và tên phim) hiển thị
trực tiếp trên màn hình video; giao diện trình phát mặc định của iOS giữ
nguyên; chức năng TẬP chỉ nằm trong MENU hiện ra khi **GIỮ (long press)** màn
hình trình phát.

**1. Trình phát GỐC iOS — `BinTV/Player/PhimNativePlayerController.swift`**
- XOÁ `refreshEpisodesButton()` / `toggleEpisodePicker()` / `removeEpisodesButton()`
  và thuộc tính `episodesButton`: trước đây controller tự vẽ một `UIButton`
  "Tập" (nền hồng, góc phải trên) lên `contentOverlayView` của
  `AVPlayerViewController` → nút TẬP đè cố định lên UI mặc định của iOS.
- `AVPlayerViewController` giờ **100% mặc định** (chỉ còn `UILabel` phụ đề của
  build 232 và panel danh sách tập khi được MỞ chủ động).
- GIỮ NGUYÊN: `episodeItems` / `currentEpisodeIndex` (menu cần biết phim có
  ≥2 tập để hiện nút TẬP), `requestEpisodePicker()` (điểm vào từ menu
  long-press), `showEpisodePicker()` / `hideEpisodePicker()` / `pickEpisode()`,
  `updateEpisodes(...)` + `onSelectEpisode` (đổi tập không thoát player),
  gesture tua/đóng, phụ đề, luồng hết tập của build 233–236.
- `updateEpisodes` thêm guard `episodeItems.count < 2 → hideEpisodePicker()`
  (thay cho nhánh ẩn-nút cũ) để panel không bao giờ mở sót với phim lẻ.

**2. Trình phát TÍCH HỢP (web) — `BinTV/Phim/Web/index.html` + `assets/app.js` + CSS**
- Gỡ khỏi overlay player: `<div id="bintv-movie-player-title">` (TÊN PHIM) và
  `<button id="bintv-movie-player-episodes-btn">Tập</button>` — cả trong
  `index.html` lẫn template `player.innerHTML` mà `ensureMovieExperienceUI()`
  tự dựng (nên KHÔNG còn "instance" nào khác sinh ra nút TẬP).
- app.js: bỏ `wireMoviePlayerEpisodeButton()` / `refreshMoviePlayerEpisodeButton()`
  và mọi chỗ ghi tên phim lên player (`startMoviePlayback`,
  `movieLifecycleShowNativePlayerShell`); bỏ `.movie-player-episodes-btn` khỏi
  `MOVIE_TOUCH_INTERACTIVE_SELECTOR`.
- CSS: xoá rule `.movie-player-title` (style/landscape/phone) và
  `.movie-player-episodes-btn` + `:active` (style) và rule `pointer-events`
  (phim_ui). `.movie-player-overlay` / `.movie-player-status` / timeline /
  phụ đề / double-tap GIỮ NGUYÊN.
- GIỮ NGUYÊN `#bintv-movie-player-episodes` (dialog "Danh sách tập"),
  `openMoviePlayerEpisodeMenu()`, `renderMoviePlayerEpisodeMenu()`,
  `selectMoviePlayerEpisode()`, `syncNativeEpisodeList()` → chọn tập/chuyển tập
  không đổi.

**3. Điểm vào mới cho nút TẬP của menu long-press**
- app.js export `window.__bintvOpenPlayerEpisodes()`: `false` khi player chưa
  mở hoặc phim không có danh sách tập; `true` + mở dialog tập khi phim bộ
  nhiều tập (gọi đúng `openMoviePlayerEpisodeMenu()` như nút cũ).
- `PhimWebView.jsOpenEpisodeList` (Swift, dùng bởi `BinTVPlayerMenuContext`
  `id: "phim-web"`) chuyển từ `.click()` nút DOM đã gỡ sang gọi
  `window.__bintvOpenPlayerEpisodes()` (fallback `__bintvMoviePlaybackHooks.openPlayerEpisodes`).
- Menu long-press (`GestureOverlayMenuView` / `BinTVPlayerMenuCenter`) KHÔNG đổi:
  PHIM bộ → LIVE TV · TUBE · SETTING · TẬP · BACK; PHIM lẻ / LIVE TV / TUBE →
  không có TẬP. Đóng menu KHÔNG tạo lại nút TẬP nổi nào (không còn code nào
  vẽ nút).

**Không đổi:** nguồn JSON phim, logic tải danh sách phim/tập, cơ chế phát
video (ưu tiên trình phát tích hợp → fallback AVPlayer), double-tap, timeline,
LIVE TV, TUBE, SETTING.

**Kiểm chứng:** `cd tests/ios-native-handoff && npm test` → **237/237 PASS**
(202 cũ, 2 check của SUITE G cập nhật theo điểm vào mới + **SUITE H** mới:
index.html/app.js/CSS/Swift không còn nút TẬP & tên phim, native không
`addSubview` nút cố định, menu vẫn có TẬP, runtime jsdom khẳng định overlay
player không có `<button>` nào / không hiện tên phim (kể cả khi player được
dựng lại), và gọi điểm vào TẬP vẫn mở đúng danh sách 3 tập — phim lẻ trả
`false`). Compile Swift do GitHub Actions xác nhận.
