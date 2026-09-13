import SwiftUI
import WebKit
import AVFoundation
import UIKit

/// Tab MOVIE: YouTube trong WKWebView — giao diện app video mobile:
/// - KHÔNG header/tiêu đề app (ContentView ẩn nav bar ở tab này), không nút
///   trình duyệt, không URL bar.
/// - **Giữ màn hình (~0.35s) = HIỆN MENU TAB** (LIVE TV/TUBE/PHIM/SETTINGS)
///   — hành vi nhất quán 4 tab (ContentView sở hữu state ẩn/hiện + tự ẩn
///   sau ~4s). Long-press dùng UILongPressGestureRecognizer đặt TRÊN webview
///   với `cancelsTouchesInView = false` → tap / swipe / pinch / video
///   controls HOÀN TOÀN không bị ảnh hưởng.
/// - **Video tự động toàn màn hình**: khi video thực sự bắt đầu phát
///   (event `playing`, 1 lần mỗi trang) → tự vào theater mode + video lên
///   WebKit native fullscreen. Cơ chế fullscreen của WebKit là cơ chế
///   hệ thống: video NGANG → tự xoay landscape fullscreen, video DỌC →
///   letterbox, giữ đúng aspect ratio, tự xử lý safe area / notch.
///   Thoát video fullscreen: vuốt xuống (system UI). App GIỮ LANDSCAPE
///   (chế độ TV) cả khi video thoát fullscreen — không quay về portrait.
/// - Nút nổi trên trang video (góc phải dưới):
///   • **⟳ Loop** — phát lặp lại video hiện tại.
///   • **⏭ Next** — video tiếp theo.
///   • **⛶ Fullscreen** — ép video lên toàn màn hình ngay.
/// - **Vuốt rìa trái/phải** = back / next (lịch sử điều hướng webview).
/// - **Pinch 2 ngón tay** để zoom / fit màn hình.
/// - **Khóa màn hình / ẩn app → âm thanh tiếp tục** (audio session .playback
///   + visibility shim + keep-alive hook).
struct MovieListView: View {
    @StateObject private var browser: YouTubeBrowser
    /// [FIX UI 2026-09-12] Tỷ lệ thích ứng cho bộ nút nổi (40pt hard-code
    /// cũ → scale SE 32.8pt … Pro Max 44pt): hết cảnh nút quá cỡ trên màn
    /// nhỏ che video / khó bấm. WebView + toàn bộ logic browser GIỮ NGUYÊN.
    @Environment(\.uiProps) private var props
    /// Long-press trên webview → hiện menu tab (ContentView sở hữu state
    /// ẩn/hiện overlay — cơ chế gesture giữ nguyên từ bản cũ).
    var onLongPress: () -> Void = {}
    /// [2026-09-12, build 221] Tab TUBE có đang được chọn hay không —
    /// ContentView truyền vào. Trang TUBE GIỮ NGUYÊN trong hierarchy khi
    /// chuyển tab (webview không rời window); cờ này chỉ để biết lúc nào
    /// tab hiện trở lại (repaint + khôi phục nếu webview trống).
    var isActive: Bool = true

    init(onLongPress: @escaping () -> Void = {}, isActive: Bool = true) {
        self.onLongPress = onLongPress
        self.isActive = isActive
        _browser = StateObject(wrappedValue: YouTubeBrowser())
        browser.onLongPress = onLongPress
    }
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            // webView duy nhất (StateObject) — không tạo lại, không reload
            // vô cớ; giữ trạng thái playback khi chuyển app / quay lại.
            // Kéo webview xuống mép dưới (home indicator) để nội dung thực
            // sự điền đầy màn hình. Tab bar do ContentView ẩn theo mặc
            // định (menu tự ẩn khi không thao tác) — KHÔNG cần TabBarHider
            // riêng ở đây (tránh 2 nguồn điều khiển cùng 1 tabBar).
            YouTubeWebView(webView: browser.webView)
                .ignoresSafeArea(edges: .bottom)

            // Nút nổi CHỈ hiện trên trang video thường (KHÔNG hiện ở
            // SHORT FEED — giữ giao diện feed sạch để vuốt chuyển video).
            if browser.isOnVideoPage && !browser.isShortsPage {
                HStack(spacing: props.s(10)) {
                    // LOOP: phát lặp đi lặp lại video hiện tại
                    Button(action: { browser.toggleLoop() }) {
                        Image(systemName: "repeat")
                            .font(.system(size: props.controlIconFont, weight: .semibold))
                            .foregroundColor(browser.isLoopEnabled ? .blue : .white)
                            .frame(width: props.controlButtonSide, height: props.controlButtonSide)
                            .background(Circle().fill(Color.black.opacity(0.55)))
                    }
                    // NEXT: video tiếp theo
                    Button(action: { browser.goNext() }) {
                        Image(systemName: "forward.end")
                            .font(.system(size: props.controlIconFont, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: props.controlButtonSide, height: props.controlButtonSide)
                            .background(Circle().fill(Color.black.opacity(0.55)))
                    }
                    // FULLSCREEN LANDSCAPE: CHỈ hiện cho video NGANG
                    // (16:9, 4:3...). Video dọc/Short → không hiện.
                    // Nhấn = xoay landscape + video fullscreen, không cần
                    // bật/tắt rotation lock, không cần tự xoay máy.
                    if browser.isLandscapeVideo {
                        Button(action: { browser.goLandscapeFullscreen() }) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: props.controlIconFont, weight: .semibold))
                                .foregroundColor(.cyan)
                                .frame(width: props.controlButtonSide, height: props.controlButtonSide)
                                .background(Circle().fill(Color.black.opacity(0.55)))
                        }
                    }
                }
                .padding(.trailing, props.controlPadding)
                .padding(.bottom, props.controlPadding)
            }
        }
        .onAppear {
            // Audio session để âm thanh tiếp tục khi app ẩn / khóa màn hình
            // (kết hợp UIBackgroundModes: audio đã có sẵn trong Info.plist).
            browser.configureAudioSession()
        }
        .onChange(of: isActive) { active in
            // MỖI LẦN QUAY LẠI TAB TUBE: xác nhận audio session + repaint
            // layer (khôi phục nếu webview trống). KHÔNG reload khi trạng
            // thái hiện tại vẫn dùng được.
            guard active else { return }
            browser.configureAudioSession()
            browser.noteTabDidAppear()
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                // Quay foreground: KHÔNG reload, KHÔNG tạo webview mới.
                browser.configureAudioSession()
            case .inactive, .background:
                // Khoảnh khắc vào background: xác nhận lại audio session
                // đang active (không reload, không stop) — điều kiện để
                // WebKit giữ web content + âm thanh chạy tiếp ở nền.
                browser.configureAudioSession()
            @unknown default:
                break
            }
        }
    }
}

private struct YouTubeWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class YouTubeBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    /// Long-press trên webview → hiện menu tab (gắn bởi MovieListView).
    var onLongPress: (() -> Void)?

    @Published var isOnVideoPage = false
    @Published var isLoopEnabled = false
    /// Theater mode (toàn màn hình): ẩn tab bar + webview fill màn hình.
    @Published var isImmersive = false
    /// Đúng trang SHORT FEED (youtube.com/shorts/...) — ở đây KHÔNG auto
    /// fullscreen, không hiện nút nổi: ưu tiên gesture vuốt chuyển video.
    @Published var isShortsPage = false
    /// Video hiện tại là video NGANG (16:9, 4:3...) — quyết định việc hiện
    /// nút fullscreen landscape. Video dọc/Short → false → không hiện nút.
    @Published var isLandscapeVideo = false

    private var hookRetry: DispatchWorkItem?
    private var fullscreenRetry: DispatchWorkItem?
    private var orientationRetry: DispatchWorkItem?
    /// Mỗi trang video chỉ tự động fullscreen 1 lần (tránh tự bật lại sau
    /// khi người dùng đã thoát bằng vuốt xuống).
    private var theaterArmed = true
    /// [2026-09-12, build 221] Số lần đã thử nạp lại trang khi webview thật
    /// sự trống (chống vòng lặp reload vô hạn). PHẢI nằm trong thân class —
    /// extension KHÔNG được chứa stored property (lỗi biên dịch Xcode:
    /// "extensions must not contain stored properties"). Reset ở didFinish.
    private var restoreAttempts = 0
    /// App đã bị xoay sang landscape DÙ VÌ video ngang fullscreen — khi video
    /// ra khỏi fullscreen phải xoay về portrait (khôi phục layout ban đầu).
    private var isLandscapeSessionActive = false

    /// Host quảng cáo / theo dõi bên thứ ba — bị chặn. KHÔNG bao giờ chặn
    /// youtube.com / googlevideo.com / ggpht.com (video + thumbnail).
    private let blockedHosts: [String] = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "adservice.google.com", "amazon-adsystem.com", "taboola.com",
        "outbrain.com", "adsrvr.org", "pubmatic.com", "openx.net",
        "criteo.com", "criteo.net", "rubiconproject.com", "indexww.com",
        "smartadserver.com", "casalemedia.com", "media.net", "adnxs.com",
        "moatads.com", "scorecardresearch.com", "quantserve.com",
        "google-analytics.com", "analytics.google.com", "ads.youtube.com"
    ]

    // MARK: - JavaScript (chỉ dùng DOM/WebKit chuẩn — không private API,
    // không can thiệp DRM, không giả mạo client, không bypass bảo mật)

    /// User script (chạy TRƯỚC mọi script của YouTube, at document-start):
    /// - Giữ `document.hidden === false` / `visibilityState === 'visible'`
    ///   kể cả khi app về background → player YouTube không tự pause.
    /// - Ăn event `visibilitychange`/`pagehide` (capture phase, đăng ký sớm
    ///   nhất) để handler của YouTube không nhận được.
    /// - Lưu trạng thái thật vào `document.__bintvRealHidden` cho keep-alive
    ///   hook kiểm tra (chỉ resume khi app THỰC SỰ ở background).
    /// - Tắt text selection để long-press không bị popup chọn chữ chen vào.
    private static let jsKeepVisible = """
    (function () {
      try {
        var hDesc = Object.getOwnPropertyDescriptor(document, 'hidden');
        if (hDesc && hDesc.get) {
          Object.defineProperty(document, '__bintvRealHidden', {
            get: function () { return hDesc.get.call(document); },
            configurable: true
          });
        }
        Object.defineProperty(document, 'hidden', {
          get: function () { return false; },
          configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
          get: function () { return 'visible'; },
          configurable: true
        });
        window.addEventListener('visibilitychange', function (e) {
          e.stopImmediatePropagation();
        }, true);
        window.addEventListener('pagehide', function (e) {
          e.stopImmediatePropagation();
        }, true);
        var st = document.createElement('style');
        st.textContent = '* { -webkit-user-select: none !important; user-select: none !important; }';
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    })()
    """

    /// Gắn hooks lên element <video> của player (gọi lại mỗi lần mở trang
    /// video mới). `__LOOP__` được thay bằng true/false từ Swift.
    private static let jsVideoHooks = """
    (function () {
      var v = document.querySelector('video');
      if (!v) { return false; }
      // KEEP-ALIVE: video bị pause MÀ app thực sự ở background
      // (__bintvRealHidden) → tự play lại để tiếp tục phát ẩn.
      if (!v.__bintvAlive) {
        v.__bintvAlive = function () {
          var hidden = (document.__bintvRealHidden !== undefined)
            ? document.__bintvRealHidden : document.hidden;
          if (hidden === true) {
            try {
              var p = v.play();
              if (p && p.catch) { p.catch(function () {}); }
            } catch (e) {}
          }
        };
        v.addEventListener('pause', v.__bintvAlive);
      }
      // LOOP: video kết thúc → quay về đầu + play (chỉ khi bật).
      if (__LOOP__ && !v.__bintvLoop) {
        v.__bintvLoop = function () {
          try {
            v.currentTime = 0;
            var p2 = v.play();
            if (p2 && p2.catch) { p2.catch(function () {}); }
          } catch (e) {}
        };
        v.addEventListener('ended', v.__bintvLoop);
      }
      // AUTO-FULLSCREEN: khi video THỰC SỰ bắt đầu phát (event 'playing' —
      // video đã sẵn sàng + đang chạy, 1 lần mỗi trang) → báo về Swift qua
      // message handler 'bintv' kèm orientation của video (landscape/portrait).
      // `__AUTO__` = false cho SHORT FEED: Short dọc KHÔNG BAO GIỜ bị ép
      // fullscreen — giữ nguyên feed để người dùng vuốt chuyển video thoải mái.
      if (__AUTO__ && !v.__bintvAuto) {
        v.__bintvAuto = function () {
          v.removeEventListener('playing', v.__bintvAuto);
          try {
            var o = 'portrait';
            if (v.videoWidth && v.videoWidth > v.videoHeight) { o = 'landscape'; }
            window.webkit.messageHandlers.bintv.postMessage('firstPlay:' + o);
          } catch (e) {}
        };
        v.addEventListener('playing', v.__bintvAuto);
      }
      // FULLSCREEN CHANGE: báo Swift khi video vào/ra native fullscreen
      // (Swift tự xoay app sang landscape nếu video NGANG đang fullscreen,
      // và xoay về portrait khi thoát — không phụ thuộc rotation lock).
      if (!v.__bintvFS) {
        v.__bintvFS = function () {
          try {
            var inFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
            window.webkit.messageHandlers.bintv.postMessage(inFS ? 'videoFS:on' : 'videoFS:off');
          } catch (e) {}
        };
        document.addEventListener('fullscreenchange', v.__bintvFS);
        document.addEventListener('webkitfullscreenchange', v.__bintvFS);
      }
      return true;
    })()
    """

    /// Bỏ listener loop (tắt nút Loop).
    private static let jsLoopDisable = """
    (function () {
      var v = document.querySelector('video');
      if (v && v.__bintvLoop) {
        v.removeEventListener('ended', v.__bintvLoop);
        v.__bintvLoop = null;
      }
      return true;
    })()
    """

    /// CSS layout LANDSCAPE cho YouTube (CHỈ CSS — không đổi DOM/logic/DRM):
    /// YouTube mobile ở viewport rộng (app chạy landscape) vẫn tự căn giữa
    /// player trong container max-width hẹp → nhìn như "khung dọc nhỏ giữa
    /// màn hình". Ép các container player + nội dung watch rộng 100% để video
    /// và feed tận dụng TOÀN BỘ chiều ngang màn hình.
    /// Inject at document-end mỗi lần load trang main frame.
    private static let jsLandscapeLayout = """
    (function () {
      try {
        var st = document.createElement('style');
        st.id = '__bintv_landscape_css';
        st.textContent = [
          'ytd-player, #movie-player, .html5-video-player, .video-stream { max-width: 100% !important; width: 100% !important; margin: 0 !important; }',
          '#movie-end-screen { width: 100% !important; }',
          'ytd-watch-flexy, .watch-flexy-primary, #primary, #contents { width: 100% !important; max-width: 100% !important; margin: 0 !important; }'
        ].join('\\n');
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    })()
    """

    /// Đưa video lên WebKit native fullscreen — cơ chế hệ thống: tự xoay
    /// theo nội dung (ngang → landscape, dọc → portrait), giữ aspect ratio,
    /// tự xử lý notch/safe area; thoát bằng vuốt xuống (system UI).
    private static let jsFullscreen = """
    (function () {
      var v = document.querySelector('video');
      if (!v) { return false; }
      if (v.webkitEnterFullscreen) { v.webkitEnterFullscreen(); return true; }
      if (v.webkitRequestFullscreen) { v.webkitRequestFullscreen(); return true; }
      if (v.requestFullscreen) { v.requestFullscreen(); return true; }
      return false;
    })()
    """

    /// Kiểm tra video đang ở chế độ fullscreen native hay chưa.
    private static let jsIsFullscreen = """
    (function () {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    })()
    """

    /// Orientation của video hiện tại: 1 = ngang (landscape), -2 = dọc
    /// (portrait), 0 = vuông, -1 = chưa có metadata (chưa biết).
    private static let jsVideoOrientation = """
    (function () {
      var v = document.querySelector('video');
      if (!v || !v.videoWidth) { return -1; }
      if (v.videoWidth > v.videoHeight) { return 1; }
      if (v.videoWidth < v.videoHeight) { return -2; }
      return 0;
    })()
    """

    /// Click nút "video tiếp theo" trên trang (best-effort theo UI YouTube).
    private static let jsClickNext = """
    (function () {
      var sels = ['#next', '#up-next a', '#auto-on-next a',
                  '.ytd-compact-video-renderer a#video-title', 'a#next-video'];
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el) { el.click(); return true; }
      }
      return false;
    })()
    """

    // MARK: - Init

    override init() {
        let configuration = WKWebViewConfiguration()
        // Visibility shim — phải inject TRƯỚC khi YouTube chạy JS của nó.
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.jsKeepVisible,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )
        // Layout LANDSCAPE (chế độ TV): player + nội dung watch rộng 100%
        // chiều ngang màn hình — không còn "khung dọc nhỏ giữa màn hình".
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.jsLandscapeLayout,
                         injectionTime: .atDocumentEnd,
                         forMainFrameOnly: true)
        )
        // Data store persistent (giữ cookie / consent YouTube).
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        // Nhận tín hiệu "video đã bắt đầu phát" từ JS (auto-fullscreen).
        // PHẢI đăng ký SAU super.init() (Swift: không được dùng self trước
        // super.init). Cùng 1 userContentController mà WKWebView đang dùng
        // → handler có hiệu lực bình thường (JS chỉ postMessage khi video
        // đã phát, tức rất lâu sau init).
        configuration.userContentController.add(self, name: "bintv")
        webView.navigationDelegate = self
        // [2026-09-12] Chuỗi Back toàn app (vuốt cạnh trái): TUBE chỉ xử lý
        // khi webview YouTube còn lịch sử (canGoBack) — trả false thì
        // ContentView coi như đã ở root và KHÔNG làm gì (không thoát app).
        BinTVBackRegistry.shared.register(tab: BinTVPage.tube.rawValue) { [weak self] in
            guard let wv = self?.webView, wv.canGoBack else { return false }
            wv.goBack()
            return true
        }
        webView.uiDelegate = self
        // Vuốt rìa màn hình = back / next (thay thế nút trình duyệt).
        webView.allowsBackForwardNavigationGestures = true
        // Pinch 2 ngón tay để zoom / fit màn hình.
        enablePinchZoom()
        // GIỮ MÀN HÌNH (~0.4s) → toggle theater mode.
        // Recognizer đặt TRÊN chính webview, cancelsTouchesInView = false +
        // delaysTouchesBegan = false: tap, swipe, pinch, video controls
        // nhận touch bình thường, không bị trễ hay chặn; recognizer chỉ
        // kích hoạt khi ngón tay giữ yên đủ 0.4s.
        let immersiveGesture = UILongPressGestureRecognizer(
            target: self,
            action: #selector(handleImmersiveLongPress(_:))
        )
        immersiveGesture.minimumPressDuration = 0.4
        immersiveGesture.cancelsTouchesInView = false
        immersiveGesture.delaysTouchesBegan = false
        webView.addGestureRecognizer(immersiveGesture)
        webView.load(URLRequest(url: URL(string: "https://www.youtube.com")!))
    }

    deinit {
        hookRetry?.cancel()
        fullscreenRetry?.cancel()
        orientationRetry?.cancel()
    }

    // MARK: - Theater mode (toàn màn hình)

    /// Long-press trên webview → ẩn/hiện tab bar + mở rộng/thu nhỏ nội dung.
    /// (state .began của UILongPressGestureRecognizer = đã giữ đủ 0.35s.)
    @objc private func handleImmersiveLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        // HIỆN MENU TAB (LIVE TV/TUBE/PHIM/SETTINGS) — nhất quán 4 tab.
        // (Hành vi cũ = toggle theater mode — thay thế: tab bar giờ ẩn
        //  theo mặc định bởi ContentView, long-press dùng để gọi menu.)
        onLongPress?()
    }

    /// Video thực sự bắt đầu phát (1 lần mỗi trang) → theater mode +
    /// video lên fullscreen native.
    /// - Short feed: KHÔNG gọi (JS đã chặn, đây là lớp an toàn thứ hai).
    /// - Video NGANG: khi fullscreen thực sự bật (videoFS:on) app sẽ tự xoay
    ///   landscape; video DỌC: giữ portrait (không ép landscape).
    private func startTheaterMode() {
        guard theaterArmed, !isShortsPage else { return }
        theaterArmed = false
        isImmersive = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        enterVideoFullscreen(attempt: 0)
    }

    /// Nút FULLSCREEN LANDSCAPE (chỉ hiện cho video ngang): xoay app sang
    /// landscape bằng cơ chế hệ thống (ĐỘC LẬP với rotation lock của
    /// iPhone — người dùng không cần vào Control Center) + đưa video lên
    /// native fullscreen nếu chưa.
    func goLandscapeFullscreen() {
        setInterfaceLandscape(true)
        webView.evaluateJavaScript(Self.jsIsFullscreen) { [weak self] res, _ in
            guard let self = self else { return }
            if (res as? Bool) != true {
                self.webView.evaluateJavaScript(Self.jsFullscreen) { _, _ in }
            }
        }
    }

    /// Xoay giao diện app sang LANDSCAPE bằng cơ chế chính thức:
    /// - iOS 16+: `UIWindowScene.requestGeometryUpdate` (API hệ thống,
    ///   hiệu lực cả khi rotation lock đang BẬT).
    /// - iOS 15: programmatic rotation qua `UIDevice` KVC (giá trị
    ///   UIDeviceOrientation — cơ chế khả dụng duy nhất trên 15.x).
    ///
    /// [FIX 2026-09-12 — KHÓA CỨNG LANDSCAPE]:
    /// - `landscape == false` = NO-OP — BinTV là app TV, KHÔNG BAO GIỜ
    ///   request portrait (bản cũ còn nhánh `.portrait` — landmine phá
    ///   khóa ngang; call-site hiện tại không truyền false nhưng xóa
    ///   hẳn cửa sau cho mọi thay đổi tương lai).
    /// - Mask đổi từ `.landscapeLeft` (1 hướng) thành
    ///   `[.landscapeLeft, .landscapeRight]`: bản cũ Ép MỘT chiều khiến
    ///   máy đang ở landscapeRight bị LẬT 180° khi bấm nút ⛶ — nay hệ
    ///   thống tự giữ chiều ngang gần với tư thế cầm máy hiện tại.
    private func setInterfaceLandscape(_ landscape: Bool) {
        guard landscape else { return }
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        if #available(iOS 16.0, *) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: [.landscapeLeft, .landscapeRight])) { _ in }
        } else {
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
        }
    }

    /// Video vào/ra native fullscreen:
    /// - Video NGANG + FS BẬT  → xoay app sang landscape (video fill ngang).
    /// - FS TẮT (sau khi đã xoay) → xoay về portrait, khôi phục layout.
    /// - Video DỌC + FS bật → giữ portrait (không ép landscape).
    private func handleVideoFullscreenChange(_ active: Bool) {
        if active {
            if isLandscapeVideo, !isLandscapeSessionActive {
                isLandscapeSessionActive = true
                setInterfaceLandscape(true)
            }
        }
        // Video RA KHỎI fullscreen: KHÔNG xoay về portrait — BinTV là app
        // TV LANDSCAPE, webview YouTube luôn hiển thị ngang. (Bản cũ gọi
        // setInterfaceLandscape(false) ở đây → app "lọt" về layout dọc
        // giữa chừng sử dụng — đã loại bỏ.)
    }

    /// Poll orientation của video (videoWidth/Height xuất hiện sau khi
    /// metadata load) — quyết định hiện/ẩn nút fullscreen landscape.
    private func pollVideoOrientation(attempt: Int) {
        guard attempt < 12 else { return }
        webView.evaluateJavaScript(Self.jsVideoOrientation) { [weak self] res, _ in
            guard let self = self else { return }
            if let n = res as? Int {
                switch n {
                case 1:  self.isLandscapeVideo = true
                case -2, 0: self.isLandscapeVideo = false
                default:
                    let item = DispatchWorkItem { self.pollVideoOrientation(attempt: attempt + 1) }
                    self.orientationRetry = item
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
                }
            }
        }
    }

    /// Gọi webkitEnterFullscreen + verify (document.fullscreenElement).
    /// Retry tới 6 lần (mỗi lần cách 0.6s) trong trường hợp WebKit chưa sẵn
    /// sàng (ví dụ yêu cầu user-activation); nếu không thành công thì thôi —
    /// người dùng vẫn có nút ⛶ để bật thủ công.
    private func enterVideoFullscreen(attempt: Int) {
        guard attempt <= 5 else { return }
        webView.evaluateJavaScript(Self.jsFullscreen) { [weak self] _, _ in
            guard let self = self else { return }
            let check = DispatchWorkItem {
                self.webView.evaluateJavaScript(Self.jsIsFullscreen) { res, _ in
                    if (res as? Bool) != true {
                        self.enterVideoFullscreen(attempt: attempt + 1)
                    }
                }
            }
            self.fullscreenRetry = check
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: check)
        }
    }

    /// Bật pinch-zoom cho webview (zoom 1x–3x).
    ///
    /// Dùng KVC (API chuẩn của NSObject) thay vì gán trực tiếp
    /// `webView.scrollView.isZoomEnabled = true`: trên runner GitHub Actions
    /// (Xcode 16.4 / SDK iPhoneOS 18.5) dòng gán trực tiếp bị lỗi resolve
    /// "value of type 'UIScrollView' has no member 'isZoomEnabled'" dù API
    /// này chuẩn trên mọi iOS. KVC luôn compile được và luôn hiệu lực trên
    /// runtime iOS (property chuẩn của UIKit từ iOS 4).
    private func enablePinchZoom() {
        let scroll = webView.scrollView
        if scroll.responds(to: Selector(("setIsZoomEnabled:"))) {
            scroll.setValue(true, forKey: "isZoomEnabled")
            scroll.setValue(1.0, forKey: "minimumZoomScale")
            scroll.setValue(3.0, forKey: "maximumZoomScale")
        }
    }

    // MARK: - Audio session (background playback)

    func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            // Không set được thì app vẫn chạy ở foreground; chỉ mất phát nền.
        }
    }

    // MARK: - Hooks (loop + keep-alive + auto-fullscreen) trên <video>

    func toggleLoop() {
        isLoopEnabled.toggle()
        if isLoopEnabled {
            applyVideoHooks()
        } else {
            webView.evaluateJavaScript(Self.jsLoopDisable) { _, _ in }
        }
    }

    /// Gắn keep-alive + auto-fullscreen (+ loop nếu bật) lên <video>. Retry
    /// mỗi 0.5s (tối đa ~8s) vì player YouTube init bất đồng bộ — <video>
    /// xuất hiện sau load.
    private func applyVideoHooks() {
        hookRetry?.cancel()
        applyVideoHooksAttempt(attempt: 0)
    }

    private func applyVideoHooksAttempt(attempt: Int) {
        let js = Self.jsVideoHooks
            .replacingOccurrences(of: "__LOOP__", with: isLoopEnabled ? "true" : "false")
            // Short feed: KHÔNG gắn auto-fullscreen (giữ vuốt chuyển video).
            .replacingOccurrences(of: "__AUTO__", with: isShortsPage ? "false" : "true")
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            let done = (result as? Bool) ?? false
            guard !done, attempt < 15 else { return }
            let item = DispatchWorkItem { self.applyVideoHooksAttempt(attempt: attempt + 1) }
            self.hookRetry = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
        }
    }

    // MARK: - Fullscreen (nút ⛶)

    func goFullscreen() {
        // WKFullscreen native: video hiện ngay toàn màn hình, tự xoay theo
        // nội dung video; thoát bằng vuốt xuống (system UI).
        webView.evaluateJavaScript(Self.jsFullscreen) { _, _ in }
    }

    // MARK: - Next

    func goNext() {
        if webView.canGoForward {
            // "next" theo lịch sử điều hướng (video đã mở tiếp trong phiên)
            webView.goForward()
            return
        }
        // Không có forward → thử click nút next trên trang YouTube
        webView.evaluateJavaScript(Self.jsClickNext) { _, _ in }
    }
}

// MARK: - Delegates

extension YouTubeBrowser {
    /// Chặn request quảng cáo / báo cáo bên thứ ba.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, let host = url.host?.lowercased() {
            let blocked = blockedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
            if blocked {
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    /// Page load xong: xác định loại trang:
    /// - /watch, /embed → trang video thường (auto-fullscreen + nút ⛶).
    /// - /shorts/...    → SHORT FEED: không auto-fullscreen, không nút nổi
    ///   — giữ nguyên layout feed để vuốt lên/xuống chuyển video thoải mái.
    /// <video> mới → gắn lại hooks và cho phép auto-fullscreen lại.
    // [FIX 2026-09-12 — cùng lớp lỗi "màn hình đen khi quay lại tab" của
    // PHIM] WebContent process bị hệ thống kết thúc (áp lực bộ nhớ khi tab
    // ẩn) → WKWebView chỉ còn layer đen và không tự hồi. Cơ chế CHÍNH THỨC
    // của Apple: reload trong delegate này. Chỉ chạy KHI process chết —
    // chuyển tab bình thường không reload, giữ nguyên trạng thái xem.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    /// [2026-09-12] Repaint layer khi tab hiện lại — không reload, không
    /// mất trạng thái (chống khung hình stale/tối sau khi gắn lại window).
    /// Kèm safety net CHỈ KHI CẦN: webview thật sự trống (`url == nil`,
    /// không đang tải) → nạp lại trang chủ YouTube (tối đa 3 lần).
    func noteTabDidAppear() {
        webView.setNeedsDisplay()
        guard restoreAttempts < 3 else { return }
        guard !webView.isLoading, webView.url == nil else { return }
        restoreAttempts += 1
        webView.load(URLRequest(url: URL(string: "https://www.youtube.com")!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Trang đã tải xong → reset bộ đếm khôi phục (không reload bừa).
        restoreAttempts = 0
        let url = webView.url
        let isWatch = (url?.path.hasPrefix("/watch") ?? false)
            || (url?.path.hasPrefix("/embed/") ?? false)
        let isShorts = url?.path.hasPrefix("/shorts/") ?? false
        isShortsPage = isShorts
        isLandscapeVideo = false
        isOnVideoPage = isWatch
        theaterArmed = true
        if isWatch {
            applyVideoHooks()
            if !isShorts {
                pollVideoOrientation(attempt: 0)
            }
        }
    }

    /// Link target=_blank: mở trong chính webview hiện tại.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            webView.load(navigationAction.request)
        }
        return nil
    }

    /// JS → Swift:
    /// - "firstPlay:landscape|portrait" — video bắt đầu phát (1 lần/trang,
    ///   KHÔNG có ở short feed) → theater mode + auto fullscreen.
    /// - "videoFS:on|off" — video vào/ra native fullscreen → xoay app theo
    ///   orientation của video (ngang → landscape, thoát → về portrait).
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "bintv", let body = message.body as? String else { return }
        switch body {
        case "firstPlay:landscape":
            isLandscapeVideo = true
            startTheaterMode()
        case "firstPlay:portrait", "firstPlay:unknown":
            startTheaterMode()
        case "videoFS:on":
            handleVideoFullscreenChange(true)
        case "videoFS:off":
            handleVideoFullscreenChange(false)
        default:
            break
        }
    }
}
