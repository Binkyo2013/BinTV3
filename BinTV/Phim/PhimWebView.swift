import SwiftUI
import WebKit
import UIKit
import AVFoundation

// =====================================================================
// [BinTV PHIM 2026-09] PhimWebView — host cho web app Phim (app.js +
// hls.js + css, giữ nguyên 100% từ project Phim Android). Port phần
// WebView của MainActivity.java sang iOS:
//
//  - WKWebView tải http://127.0.0.1:PORT/?android=phone (layout điện
//    thoại cảm ứng của web app — 2 cột, touch, HUD player).
//  - localStorage PERSISTENT (websiteDataStore .default) — cache
//    bootstrap/catalog của app.js (giống setDomStorageEnabled(true)).
//  - Autoplay không cần gesture (mediaTypesRequiringUserActionForPlayback
//    = [] — giống setMediaPlaybackRequiresUserGesture(false)).
//  - JS shim window.AndroidBridge (thay AndroidBridge.java) inject
//    TRƯỚC mọi script: các method trả string chạy đúng trong JS
//    (đồng bộ, kết quả giống buildProxyUrl); setPlayerLandscape/
//    exitApp/clearCookies gửi sang native qua message handler.
//  - setPlayerLandscape("1"/"0") từ phim_player_ui.js (player mở/đóng)
//    → player MỞ: buộc LANDSCAPE (cùng cơ chế requestGeometryUpdate
//      (iOS 16+) / KVC (iOS 15), DUYỆT cả khi đang khóa xoay);
//    → player ĐÓNG: KHÔNG xoay về PORTRAIT (app BinTV = chế độ TV,
//      giữ nguyên hướng landscape — bản cũ xoay về portrait ở đây).
//  - Lỗi tải (mất mạng/server) → overlay "Không thể tải Phim + Thử lại"
//    (port ErrorScreen.java) — không crash, không ảnh hưởng tab khác.
//
// PHIM là một TAB của BinTV nên 2 hành vi standalone-Android bị điều
// chỉnh có chủ đích (ghi rõ trong báo cáo):
//  - exitApp() (dialog "Thoát" của web app) = NO-OP — không đóng cả
//    app BinTV.
//  - clearCookies() = NO-OP — không xóa cookie cả app (phá phiên
//    YouTube của tab TUBE).
//
// [build 231 — 2026-09-13] THÊM CẦU NỐI NATIVE PLAYER (sửa lỗi
// "Không thể phát trên TV" khi bấm xem phim trên iPhone):
//  - WKScriptMessageHandler MỚI: `playVideoNative` — JS gửi
//    { url: streamUrl, title, proxyUrl, referer, reason, session }.
//  - User script MỚI `nativeHandoffJS` (document-start): cung cấp
//    window.__bintvPlayVideoNative / __bintvStopVideoNative và bắt sự kiện
//    người dùng CLICK thẻ phim (ghi "ý định phát" — id + tên phim).
//  - Nhận message → `PhimNativePlayerController` (BinTV/Player/) mở
//    AVPlayerViewController và phát bằng AVFoundation. Kết quả
//    (started/failed/closed) được trả về JS bằng evaluateJavaScript để
//    app.js thử nguồn kế tiếp hoặc dọn UI — KHÔNG bao giờ im lặng.
//  - `allowsInlineMediaPlayback = true` + `mediaTypesRequiringUserActionForPlayback = []`
//    (đã có từ build 226) là ĐIỀU KIỆN CẦN cho cả hai đường phát: web
//    (thẻ <video> inline, không bị WebKit bắt cóc sang fullscreen) và
//    native (không cần gesture khi AVPlayerViewController tự present).
//
// [build 233 — 2026-09-14] LUỒNG KẾT THÚC PHÁT (phim bộ / phim lẻ):
//  - Native phát HẾT → callback mới __bintvNativePlaybackEnded → app.js
//    tự chuyển tập (phim bộ còn tập) hoặc đóng player (hết tập / phim lẻ).
//  - Action MỚI "prepareNext" (helper __bintvPrepareNextNativeEpisode):
//    JS báo đang nạp tập kế → Swift giữ player mở (backstop 45s).
//  - JS im lặng → Swift TỰ ĐÓNG player (chống treo phải tắt app).
// =====================================================================

final class PhimController: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {

    @Published var loadFailed = false
    @Published var failMessage = ""
    /// The controller owns the active WKWebView.  It is deliberately mutable:
    /// a terminated WebContent process is rebuilt with a new configuration and
    /// reattached by PhimWebViewContainer instead of leaving a dead black layer
    /// in the SwiftUI hierarchy.
    @Published private(set) var webView: WKWebView
    private var webViewGeneration = 0
    private var server: PhimLocalServer?
    private var started = false

    // =================================================================
    // [build 231 — 2026-09-13] TRÌNH PHÁT GỐC iOS CHO TAB PHIM
    // Nhận `streamUrl` từ web app (message handler `playVideoNative`) rồi
    // mở AVPlayerViewController — xem BinTV/Player/PhimNativePlayerController.swift.
    // Lý do cần: WKWebView (WebKit/HTML5) KHÔNG giải mã được nhiều nguồn
    // Stremio addon (container MKV, audio AC3/EAC3/DTS) → app.js hết nguồn
    // dự phòng → hiện "Không thể phát nguồn phim này trên TV" và không phát
    // gì. AVFoundation của player native giải mã rộng hơn hẳn (HLS/MP4/MOV,
    // AC3/EAC3) nên đây là đường phát ĐÚNG cho các nguồn đó trên iPhone.
    // =================================================================
    private let nativePlayer = PhimNativePlayerController()

    /// Long-press trên webview (≥0.35s) → hiển thị menu tab
    /// (LIVE TV/TUBE/PHIM/SETTINGS) — nhất quán 4 tab. Gắn bởi PhimView.
    var onLongPress: (() -> Void)?

    override init() {
        PhimDebugLog.step("WEBVIEW", "controllerInit", "begin")
        let configuration = Self.makeWebViewConfiguration()
        webView = Self.makeWebView(configuration: configuration)
        super.init()

        configure(webView, configuration: configuration)
        configureNativePlayerCallbacks()
        installLifecycleObservers()
        registerBackHandler()
        PhimDebugLog.step("WEBVIEW", "controllerInit", "ok",
                          "inline=true autoplay=all lifecycle=guarded")
    }

    /// Every replacement must receive exactly the same supported WebKit
    /// configuration and user scripts as the first instance.  This is kept in
    /// one factory so a recovery cannot accidentally lose its bridge/delegates.
    private static func makeWebViewConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsInlineMediaPlayback = true

        let content = configuration.userContentController
        // Order matters: the host lifecycle guard and native bridge must exist
        // before app.js registers its pagehide/visibility listeners.
        content.addUserScript(WKUserScript(source: Self.viewportFixJS,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.bridgeShimJS,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.nativeHandoffJS,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.lifecycleBridgeJS,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.consoleCaptureJS,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.playerObserverJS,
                                           injectionTime: .atDocumentEnd,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.nativePlayerJS,
                                           injectionTime: .atDocumentEnd,
                                           forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.layoutFixJS,
                                           injectionTime: .atDocumentEnd,
                                           forMainFrameOnly: true))
        return configuration
    }

    private static func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.accessibilityIdentifier = "BinTV.Phim.WebView"
        #if DEBUG
        if #available(iOS 16.4, *) {
            view.isInspectable = true
        }
        #endif
        return view
    }

    /// Attach delegates, message handlers and recognizers after `super.init()`.
    /// This method is also used by a recovered web view.
    private func configure(_ view: WKWebView, configuration: WKWebViewConfiguration) {
        let content = configuration.userContentController
        content.add(self, name: "phimBridge")
        content.add(self, name: "phimConsole")
        content.add(self, name: "playVideoNative")
        content.add(self, name: "phimLifecycle")
        view.navigationDelegate = self
        view.uiDelegate = self

        let menuGesture = UILongPressGestureRecognizer(
            target: self, action: #selector(handleMenuLongPress(_:))
        )
        menuGesture.minimumPressDuration = 0.35
        menuGesture.cancelsTouchesInView = false
        menuGesture.delaysTouchesBegan = false
        view.addGestureRecognizer(menuGesture)
    }

    private func detach(_ view: WKWebView) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        let content = view.configuration.userContentController
        ["phimBridge", "phimConsole", "playVideoNative", "phimLifecycle"].forEach {
            content.removeScriptMessageHandler(forName: $0)
        }
    }

    private func registerBackHandler() {
        BinTVBackRegistry.shared.register(tab: BinTVPage.phim.rawValue) { [weak self] in
            guard let self = self, self.webView.canGoBack else { return false }
            self.webView.goBack()
            return true
        }
    }

    /// Long-press đủ 0.35s → hiện menu tab (LIVE TV/TUBE/PHIM/SETTINGS).
    @objc private func handleMenuLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onLongPress?()
    }

    /// Khơi server nội bộ + tải web app.
    /// Server là SINGLETON (sống trọn đời app, giống Android) — tạo/hủy
    /// server lặp lại là nguyên nhân EADDRINUSE + crash khi bấm Reload.
    func startAndLoadIfNeeded() {
        guard !started else { return }
        started = true
        PhimDebugLog.step("WEBVIEW", "startAndLoadIfNeeded", "begin")
        // Audio session .playback cho phim (không phụ thuộc tab TUBE đã
        // được mở trước hay chưa — xem cấu trúc hàm configureAudioSession).
        configureAudioSession()
        let server = PhimLocalServer.shared
        self.server = server
        if server.port > 0 {
            // Server đã sẵn sàng (lần mở tab trước) — tải ngay.
            PhimDebugLog.step("SERVER", "reuse", "ok", "port=\(server.port)")
            loadPage()
            return
        }
        server.onPortReady = { [weak self] port in
            PhimDebugLog.step("SERVER", "portReady", "ok", "port=\(port)")
            self?.loadPage()
        }
        server.onPortFailed = { [weak self] message in
            PhimDebugLog.step("SERVER", "portReady", "FAIL", message)
            self?.failMessage = message
            self?.loadFailed = true
        }
        if server.port > 0 {
            // Server vừa ready giữa chừng — tải luôn (tránh race).
            loadPage()
        } else {
            server.start()
            armServerTimeout()
        }
    }

    /// Server không sẵn sàng sau 4s → hiện lỗi RÕ (thay vì treo/blank).
    private func armServerTimeout() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self = self, !self.loadFailed, (self.server?.port ?? 0) <= 0 else { return }
            PhimDebugLog.step("SERVER", "startupTimeout", "FAIL", "4s — server chưa sẵn sàng")
            self.failMessage = "Server Phim chưa sẵn sàng sau 4 giây. Thử lại."
            self.loadFailed = true
        }
    }

    func stop() {
        // Server là SINGLETON — KHÔNG hủy khi rời tab. Lần mở sau dùng
        // lại ngay (port còn giữ) — không lo EADDRINUSE, không crash.
        server = nil
        started = false
    }

    deinit {
        stop()
        for observer in lifecycleObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func pageURL() -> URL? {
        guard let server = server, server.port > 0 else { return nil }
        // ?android=phone  → phone.css (kích thước chạm — giữ nguyên).
        // &ios=landscape  → index.html nạp THÊM landscape.css (SAU phone.css)
        //   cho bố cục ngang TV: lưới poster 6 cột, header compact, dialog
        //   chọn tập 8 cột/hàng, padding env(safe-area-inset) — app BinTV
        //   chạy chế độ TV landscape (14 Pro Max: viewport ~932×430).
        return URL(string: "http://127.0.0.1:\(server.port)/?android=phone&ios=landscape")
    }

    private func loadPage(cachePolicy: URLRequest.CachePolicy = .reloadIgnoringLocalCacheData) {
        guard let url = pageURL() else {
            PhimDebugLog.step("WEBVIEW", "loadPage", "FAIL", "không có port")
            failMessage = "Server Phim chưa có port."
            loadFailed = true
            return
        }
        PhimDebugLog.step("WEBVIEW", "loadPage", "begin", PhimDebugLog.sanitizeURL(url.absoluteString))
        loadFailed = false
        failMessage = ""
        webView.load(URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: 20))
    }

    func retryLoad() {
        PhimDebugLog.step("WEBVIEW", "retryLoad", "begin", "port=\(server?.port ?? 0)")
        loadFailed = false
        failMessage = ""
        let server = server ?? PhimLocalServer.shared
        self.server = server
        if server.port > 0 {
            loadPage()
        } else {
            // Server chưa sẵn sàng → (re)start idempotent + chờ.
            // KHÔNG tạo server mới (singleton) — tránh EADDRINUSE + crash.
            server.onPortReady = { [weak self] port in
                PhimDebugLog.step("SERVER", "portReady", "ok", "retry port=\(port)")
                self?.loadPage()
            }
            server.onPortFailed = { [weak self] message in
                self?.failMessage = message
                self?.loadFailed = true
            }
            server.start()
            armServerTimeout()
        }
    }

    // =====================================================================
    // Console capture — hook console.log/info/warn/error của web app →
    // postMessage("phimConsole") → PhimDebugLog (Documents/phim_debug.log,
    // xem qua Files → On My iPhone → BinTV).
    //
    // Chạy TRƯỚC mọi script (atDocumentStart) nên bắt được cả log của
    // hls.min.js/app.js. Giữ nguyên console gốc (web app không thay đổi
    // behavior); toàn bộ hook nằm trong try/catch (lỗi log không bao giờ
    // ảnh hưởng phát video).
    // =====================================================================

    private static let consoleCaptureJS = """
    (function () {
        try {
            if (window.__binTVConsoleHooked) { return; }
            window.__binTVConsoleHooked = true;
            function forward(level, args) {
                try {
                    var parts = [];
                    for (var i = 0; i < args.length && i < 8; i++) {
                        var a = args[i];
                        if (a === null) { parts.push("null"); }
                        else if (a === undefined) { parts.push("undefined"); }
                        else if (typeof a === "string") { parts.push(a); }
                        else if (a instanceof Error) {
                            parts.push(a.name + ": " + a.message + (a.stack ? " | " + String(a.stack).split("\\n").slice(0, 3).join(" / ") : ""));
                        }
                        else { try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); } }
                    }
                    var text = parts.join(" ");
                    if (text.length > 1500) { text = text.substring(0, 1500) + "…[truncated]"; }
                    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.phimConsole;
                    if (handler) { handler.postMessage({ level: level, msg: text }); }
                } catch (e) {}
            }
            ["log", "info", "warn", "error"].forEach(function (fn) {
                var original = console[fn];
                console[fn] = function () {
                    try { if (typeof original === "function") { original.apply(console, arguments); } } catch (e) {}
                    forward(fn, arguments);
                };
            });
            window.addEventListener("error", function (ev) {
                forward("error", ["WINDOW ERROR: ", ev.message, " @ ", ev.filename, ":", ev.lineno]);
            });
            window.addEventListener("unhandledrejection", function (ev) {
                forward("error", ["UNHANDLED REJECTION: ", ev.reason && (ev.reason.message || String(ev.reason))]);
            });
        } catch (e) {}
    })();
    """

    // =====================================================================
    // [PHIM_DEBUG] Player observer — log CÓ CẤU TRÚC luồng phát video:
    //   [PHIM_DEBUG] Step -> Action -> Status -> Payload/URL
    // THỤ ĐỘNG 100%: chỉ addEventListener (capture) + đọc state; KHÔNG
    // wrap/override hàm nào của app.js/hls.js, KHÔNG preventDefault →
    // không thể làm thay đổi hành vi phát. Log đi qua console.log →
    // consoleCaptureJS (đã có) → phimConsole handler → phim_debug.log.
    // Token nhạy cảm (pkey/token/sig/auth/key/session...) trong query
    // string bị che thành *** TRƯỚC khi log.
    // =====================================================================

    private static let playerObserverJS = """
    (function () {
        "use strict";
        try {
            if (window.__binTVPlayerObserver) { return; }
            window.__binTVPlayerObserver = true;

            var SENSITIVE = /^(pkey|token|tk|sig|signature|auth|authorization|session|sessionid|sid|hash|h|key|apikey|api_key|secret|pass|password|cred|md5|secure|st)$/i;
            function sanitize(value) {
                try {
                    var text = String(value == null ? "" : value);
                    var qIndex = text.indexOf("?");
                    if (qIndex < 0) { return text.length > 260 ? text.substring(0, 260) + "…" : text; }
                    var base = text.substring(0, qIndex);
                    var parts = text.substring(qIndex + 1).split("&").map(function (pair) {
                        var eq = pair.indexOf("=");
                        var name = eq >= 0 ? pair.substring(0, eq) : pair;
                        if (SENSITIVE.test(name)) { return name + "=***"; }
                        return pair;
                    });
                    var out = base + "?" + parts.join("&");
                    return out.length > 260 ? out.substring(0, 260) + "…" : out;
                } catch (e) { return "<sanitize-error>"; }
            }
            function step(st, action, status, payload) {
                try {
                    console.log("[PHIM_DEBUG] " + st + " -> " + action + " -> " + status
                        + (payload === undefined || payload === null || payload === "" ? "" : " -> " + payload));
                } catch (e) {}
            }
            window.__phimDebugStep = step;

            // (1) ENV — năng lực phát của WebKit tại thời điểm chạy: quyết định
            // app.js đi đường hls.js (MSE/ManagedMediaSource) hay <video> native.
            function logEnv() {
                var env = {};
                try { env.origin = window.location.origin; } catch (e) {}
                try { env.mse = !!window.MediaSource; } catch (e) { env.mse = false; }
                try { env.managedMse = !!window.ManagedMediaSource; } catch (e) { env.managedMse = false; }
                try { env.hlsJs = !!(window.Hls && window.Hls.version); env.hlsVer = window.Hls && window.Hls.version; } catch (e) { env.hlsJs = false; }
                try { env.hlsSupported = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported()); } catch (e) { env.hlsSupported = false; }
                try {
                    var probe = document.createElement("video");
                    env.nativeHls = !!probe.canPlayType("application/vnd.apple.mpegurl");
                    env.nativeMp4 = !!probe.canPlayType("video/mp4");
                } catch (e) {}
                try {
                    var v = document.getElementById("bintv-movie-html5-player");
                    env.playsinlineAttr = !!(v && v.hasAttribute("playsinline"));
                } catch (e) {}
                step("ENV", "capabilities", "ok", JSON.stringify(env));
            }

            // (2) PLAYER — mọi sự kiện media của thẻ <video> (capture, thụ động).
            function attachPlayer() {
                var video = document.getElementById("bintv-movie-html5-player");
                if (!video || video.__binTVObserved) { return; }
                video.__binTVObserved = true;
                function srcInfo() {
                    var s = "";
                    try { s = String(video.currentSrc || video.src || ""); } catch (e) {}
                    return sanitize(s);
                }
                function stateInfo() {
                    var err = null;
                    try { if (video.error) { err = { code: video.error.code, msg: sanitize(video.error.message || "") }; } } catch (e) {}
                    return JSON.stringify({
                        rs: video.readyState, ns: video.networkState,
                        paused: video.paused, t: Math.round((video.currentTime || 0) * 1000) / 1000,
                        dur: isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : null,
                        wh: (video.videoWidth || 0) + "x" + (video.videoHeight || 0),
                        err: err
                    });
                }
                var EVENTS = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
                              "play", "playing", "pause", "waiting", "stalled", "suspend", "abort",
                              "emptied", "ended", "error", "ratechange", "durationchange"];
                EVENTS.forEach(function (name) {
                    video.addEventListener(name, function () {
                        var status = (name === "error") ? "FAIL" : "ok";
                        step("PLAYER", name, status, srcInfo() + " " + stateInfo());
                    }, true);
                });
                step("PLAYER", "observer-attached", "ok", srcInfo());
            }

            function boot() { logEnv(); attachPlayer(); }
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", boot);
            } else { boot(); }
            // app.js có thể (re)create phần tử player — kiểm tra lại định kỳ
            // 2s trong 60s đầu (thụ động, chi phí không đáng kể).
            var ticks = 0;
            var timer = setInterval(function () {
                ticks++;
                attachPlayer();
                if (ticks >= 30) { clearInterval(timer); }
            }, 2000);
        } catch (e) {}
    })();
    """

    // =====================================================================
    // [build 228 — ROOT CAUSE "thẻ phim không dãn/toàn màn hình"]
    //
    // CSS trong bundle (landscape.css) CÓ THỂ không được nạp (file stale /
    // cache WKWebView / thứ tự nạp động) — đó là lý do các bản trước sửa CSS
    // mà máy thật không đổi gì. Cách dứt điểm: TIÊM CSS TỪ SWIFT (nằm trong
    // binary, chạy mỗi lần nạp trang, !important để thắng mọi luật cũ của
    // style.css / phone.css / landscape.css).
    //
    // Tính toán lại lưới (iPhone ngang, ví dụ 14 Pro Max: 932pt):
    //   • Bỏ padding ngang của .movie-content/.movie-grid; lề an toàn lấy tối
    //     đa 20px (min(env(...),20px)) thay vì 59px → lấy lại ~80px chiều
    //     ngang, vẫn né được Dynamic Island.
    //   • Sidebar danh mục 118px → 100px.
    //   • 4 thẻ/hàng, flex-grow để dãn kín phần thừa, gap 8px.
    //   • Poster: 16/9 + object-fit COVER (bản TV dùng `contain` + height cố
    //     định 165px → mỗi poster bị letterbox = ĐÚNG KHOẢNG TRỐNG ĐEN 2 BÊN
    //     TRONG THẺ). cover chỉ cắt ảnh, KHÔNG làm méo.
    //   • Tên phim + năm: nằm DƯỚI ảnh (static), 2 dòng, không che poster.
    // =====================================================================

    private static let layoutFixJS = """
    (function () {
        "use strict";
        var ID = "bintv-layout-228";
        function css() {
            return [
                ".movie-content {",
                "  padding: 24px 0 8px !important;",
                "  padding-left: min(env(safe-area-inset-left, 0px), 20px) !important;",
                "  padding-right: min(env(safe-area-inset-right, 0px), 20px) !important;",
                "}",
                ".movie-grid { padding: 4px 0 18px !important; }",
                ".movie-status { left: 8px !important; right: 8px !important; }",
                ".movie-catalogs { flex: 0 0 100px !important; width: 100px !important; }",
                ".movie-card {",
                "  flex: 1 1 calc(25% - 8px) !important;",
                "  max-width: calc(50% - 8px) !important;",
                "  margin: 0 4px 12px !important;",
                "  padding: 0 !important;",
                "}",
                ".movie-card-poster {",
                "  width: 100% !important; height: auto !important;",
                "  aspect-ratio: 16 / 9 !important;",
                "  object-fit: cover !important;",
                "  background: #111118 !important;",
                "}",
                ".movie-card::after { display: none !important; }",
                ".movie-card-name {",
                "  position: static !important; display: -webkit-box !important;",
                "  -webkit-box-orient: vertical !important; -webkit-line-clamp: 2 !important;",
                "  height: auto !important; max-height: 2.4em !important;",
                "  margin: 6px 5px 0 !important; font-size: 15px !important;",
                "  line-height: 1.2 !important; overflow: hidden !important;",
                "  text-shadow: none !important;",
                "}",
                ".movie-card-meta {",
                "  position: static !important; height: auto !important;",
                "  margin: 3px 5px 2px !important; font-size: 13px !important;",
                "  white-space: nowrap !important; overflow: hidden !important;",
                "  text-overflow: ellipsis !important; text-shadow: none !important;",
                "}",
                ".movie-skeleton-name { position: static !important; display: block !important;",
                "  height: 14px !important; margin: 6px 5px 0 !important; width: 70% !important; }",
                ".movie-skeleton-meta { position: static !important; display: block !important;",
                "  height: 11px !important; margin: 4px 5px 2px !important; width: 45% !important; }",
                ".movie-subtitle-text { bottom: 104px !important; }"
            ].join("\n");
        }
        function inject() {
            try {
                if (document.getElementById(ID)) { return true; }
                var style = document.createElement("style");
                style.id = ID;
                style.type = "text/css";
                style.appendChild(document.createTextNode(css()));
                (document.head || document.documentElement).appendChild(style);
                return true;
            } catch (e) { return false; }
        }
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", inject, { once: true });
        } else { inject(); }
    })();
    """

    // =====================================================================
    // [FIX 2026-09-13 build 225 — PHIM KHÔNG TOÀN MÀN HÌNH / CÓ VIỀN ĐEN
    //  2 BÊN]
    //
    // index.html khai báo <meta name="viewport" content="width=1920,height=1080">
    // (bố cục TV của bản Electron/Android TV) và chỉ đổi sang viewport thiết
    // bị bằng một đoạn script trong <head>. Khi WebKit đã chốt layout theo
    // 1920x1080, trang bị thu nhỏ vừa màn hình iPhone (932x430 → ảnh
    // ~764x430) => nội dung "nằm trong một vùng nhỏ" và LỘ RA ~84px ĐEN MỖI
    // BÊN — đúng triệu chứng máy thật (LIVE TV/TUBE không bị vì chúng không
    // dùng web app này).
    //
    // Cách sửa: script này chạy ở **document start** (TRƯỚC mọi script của
    // web app) và gắn viewport chuẩn điện thoại NGAY KHI thẻ meta xuất hiện
    // (hoặc tự tạo thẻ nếu chưa có). Có `viewport-fit=cover` để nội dung phủ
    // kín cả vùng Dynamic Island, và chặn zoom trang (`maximum-scale=1`) để
    // webview không tự phóng to/thu nhỏ sau khi app ở nền.
    // =====================================================================

    private static let viewportFixJS = """
    (function () {
        "use strict";
        var CONTENT = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
        function apply() {
            try {
                if (!document.head) { return false; }
                var meta = document.querySelector('meta[name="viewport"]');
                if (!meta) {
                    meta = document.createElement('meta');
                    meta.setAttribute('name', 'viewport');
                    document.head.appendChild(meta);
                }
                if (meta.getAttribute('content') !== CONTENT) {
                    meta.setAttribute('content', CONTENT);
                }
                return true;
            } catch (e) { return false; }
        }
        if (!apply()) {
            // <head> chưa tồn tại ở document-start → gắn NGAY khi nó xuất
            // hiện (vẫn trước khi body được dựng → WebKit tính đúng viewport).
            try {
                var observer = new MutationObserver(function () {
                    if (apply()) { observer.disconnect(); }
                });
                observer.observe(document, { childList: true, subtree: true });
            } catch (e) {}
        }
    })();
    """

    // =====================================================================
    // [BinTV 2026-09-13 build 224] PLAYER CHUẨN iOS CHO TAB PHIM
    //
    // ĐÃ XOÁ phim_player_ui.js — lớp HUD tự dựng: tự ẩn overlay sau 3.5s,
    // nút tạm dừng riêng, kéo timeline riêng, ép xoay ngang khi mở player.
    // Thay bằng ĐIỀU KHIỂN GỐC CỦA iOS trên thẻ <video> (controls = true):
    // phát/tạm dừng, tua, AirPlay, NÚT FULLSCREEN → đúng player native
    // (AVPlayerViewController) như LIVE TV và TUBE, pinch 2 ngón hoạt động.
    //
    // app.js GIỮ NGUYÊN hoàn toàn: phụ đề, đổi nguồn/dự phòng, tự chuyển
    // tập, nhớ vị trí xem, chọn chất lượng — không đụng vào logic đó.
    // =====================================================================

    private static let nativePlayerJS = """
    (function () {
        "use strict";
        if (window.__binTVNativePlayer) { return; }
        window.__binTVNativePlayer = true;

        var VIDEO_ID = "bintv-movie-html5-player";

        // Đặt TRUE nếu muốn TỰ ĐỘNG bật fullscreen ngay khi video bắt đầu
        // phát. MẶC ĐỊNH FALSE có chủ đích: player fullscreen native là lớp
        // phủ của HỆ THỐNG -> mọi nội dung DOM của app.js (PHỤ ĐỀ, danh
        // sách tập, chọn chất lượng) bị ẨN trong lúc fullscreen. Người dùng
        // vẫn vào fullscreen bằng 1 chạm vào nút CHUẨN của iOS khi muốn.
        var AUTO_FULLSCREEN = false;

        function video() { return document.getElementById(VIDEO_ID); }

        function srcOf(v) {
            var s = "";
            try { s = String(v.currentSrc || v.src || ""); } catch (e) {}
            return s;
        }

        // MSE (hls.js) cấp nguồn bằng blob: -> player fullscreen native KHÔNG
        // phát được (chỉ <video> inline render được MSE). iOS 16.5 không có
        // MSE nên thực tế luôn là HLS native (m3u8 qua proxy) -> fullscreen
        // dùng được; vẫn chặn blob: để an toàn trên iOS 17.1+ (ManagedMSE).
        function canGoNativeFullscreen(v) {
            if (!v) { return false; }
            try { if (srcOf(v).indexOf("blob:") === 0) { return false; } } catch (e) { return false; }
            return (typeof v.webkitEnterFullscreen === "function");
        }

        window.__bintvEnterNativeFullscreen = function () {
            var v = video();
            if (!canGoNativeFullscreen(v)) { return false; }
            try { v.webkitEnterFullscreen(); return true; } catch (e) { return false; }
        };

        function prepare(v) {
            if (!v || v.__binTVNativeReady) { return; }
            v.__binTVNativeReady = true;
            try {
                // app.js tạo lại <video> bằng innerHTML -> THUỘC TÍNH BIẾN
                // MẤT. Thiếu playsinline: iOS có thể từ chối play() (hết
                // user-activation) hoặc tự cướp sang fullscreen — GIỮ FIX CŨ.
                v.setAttribute("playsinline", "");
                v.setAttribute("webkit-playsinline", "");
            } catch (e) {}
            try {
                // Điều khiển CHUẨN iOS (app.js có chỗ set controls = false).
                v.controls = true;
            } catch (e) {}
            if (AUTO_FULLSCREEN) {
                v.addEventListener("playing", function () {
                    if (v.__binTVAutoFsDone || !canGoNativeFullscreen(v)) { return; }
                    v.__binTVAutoFsDone = true;
                    try { v.webkitEnterFullscreen(); } catch (e) {}
                }, true);
                v.addEventListener("emptied", function () { v.__binTVAutoFsDone = false; }, true);
            }
        }

        // app.js (re)create phần tử player -> bắt bằng listener CAPTURE trên
        // document (media event KHÔNG bubble, nhưng capture đi từ document).
        ["loadedmetadata", "play", "playing"].forEach(function (name) {
            document.addEventListener(name, function (event) {
                var v = (event.target && event.target.id === VIDEO_ID) ? event.target : video();
                prepare(v);
            }, true);
        });
        // Dự phòng: quét lại định kỳ (cùng cơ chế playerObserverJS).
        var ticks = 0;
        var timer = setInterval(function () {
            ticks++;
            prepare(video());
            if (ticks >= 60) { clearInterval(timer); }
        }, 2000);
        prepare(video());
    })();
    """

    // =====================================================================
    // JS bridge (thay AndroidBridge.java)
    // =====================================================================

    private static let bridgeShimJS = """
    (function () {
        "use strict";
        if (window.AndroidBridge) return;
        function enc(value) {
            try { return encodeURIComponent(String(value == null ? "" : value)); } catch (e) { return ""; }
        }
        function originBase() {
            try {
                var origin = window.location && window.location.origin;
                return origin ? String(origin).replace(/\\/+$/, "") : "";
            } catch (e) { return ""; }
        }
        function send(action, extra) {
            try {
                var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.phimBridge;
                if (!handler) return;
                var payload = { action: action };
                if (extra) { for (var key in extra) { payload[key] = extra[key]; } }
                handler.postMessage(payload);
            } catch (e) {}
        }
        // Cùng interface AndroidBridge.java. Các method trả string chạy
        // đúng trong JS (đồng bộ) — proxyMedia trả cùng kết quả với
        // buildProxyUrl() của MainActivity.
        window.AndroidBridge = {
            getMyAppId: function () { return "com.bintv.ios"; },
            getInstalledApps: function () { return "[]"; },
            launchApp: function (appId) { return "0"; },
            isAndroidTv: function () { return "0"; },
            appVersion: function () { return "1.2.1"; },
            clearCookies: function () { send("clearCookies"); },
            proxyMedia: function (url, referer) {
                var base = originBase();
                if (!url || !base) return "";
                return base + "/proxy?url=" + enc(url) + (referer ? "&__ref=" + enc(referer) : "");
            },
            exitApp: function () { send("exit"); },
            setPlayerLandscape: function (enabled) {
                send("landscape", { enabled: (enabled === "1" || enabled === true) });
            }
        };
    })();
    """

    // =====================================================================
    // [build 231 — 2026-09-13] CẦU NỐI NATIVE PLAYER (transport JS → Swift)
    //
    // Script này TIÊM TỪ SWIFT (document-start) nên chắc chắn tồn tại trước
    // khi app.js chạy, không phụ thuộc file trong bundle. Nó chỉ làm phần
    // VẬN CHUYỂN:
    //   • `window.__bintvPlayVideoNative(payload)` → postMessage sang handler
    //     `playVideoNative` (payload tối thiểu {url, title} — đúng chữ ký
    //     WKScriptMessageHandler; Swift đọc thêm proxyUrl/referer/reason/session).
    //   • `window.__bintvStopVideoNative()` → yêu cầu đóng AVPlayer.
    //   • Bắt sự kiện người dùng CLICK/ENTER trên thẻ phim (capture phase,
    //     chạy TRƯỚC listener của app.js) → ghi `window.__bintvLastPlayIntent`
    //     {id, name, type, at}: app.js dùng làm tiêu đề khi gửi streamUrl,
    //     đồng thời đây là bằng chứng user-activation của lần phát.
    // CHÍNH SÁCH (khi nào handoff) nằm trong app.js — xem các hàm
    // `iosNeedsNativePlayerFor` / `requestNativeMoviePlayback`.
    // =====================================================================

    private static let nativeHandoffJS = """
    (function () {
        "use strict";
        if (window.__binTVNativeHandoff) { return; }
        window.__binTVNativeHandoff = true;
        // Cờ để web app nhận biết đang chạy trong WKWebView iOS có cầu nối.
        window.__bintvIosNativeBridge = true;

        function handler() {
            try {
                return window.webkit && window.webkit.messageHandlers
                    && window.webkit.messageHandlers.playVideoNative;
            } catch (e) { return null; }
        }
        window.__bintvNativeBridgeAvailable = function () { return !!handler(); };

        function text(value) {
            try { return String(value === null || value === undefined ? "" : value); }
            catch (e) { return ""; }
        }
        function nonNegativeNumber(value) {
            var number = Number(value);
            return isFinite(number) && number >= 0 ? number : 0;
        }

        // Gửi streamUrl sang Swift native (AVPlayerViewController).
        window.__bintvPlayVideoNative = function (payload) {
            var bridge = handler();
            if (!bridge) { return false; }
            try {
                var body = payload || {};
                bridge.postMessage({
                    url: text(body.url),
                    title: text(body.title),
                    proxyUrl: text(body.proxyUrl),
                    referer: text(body.referer),
                    reason: text(body.reason),
                    session: text(body.session),
                    resumePositionMs: nonNegativeNumber(body.resumePositionMs),
                    resumePaused: body.resumePaused === true
                });
                return true;
            } catch (e) { return false; }
        };

        // Yêu cầu Swift đóng trình phát native (web app đóng player / Back).
        window.__bintvStopVideoNative = function () {
            var bridge = handler();
            if (!bridge) { return false; }
            try {
                bridge.postMessage({ action: "stop", url: "", title: "" });
                return true;
            } catch (e) { return false; }
        };

        // [build 233] Báo Swift GIỮ player mở trong lúc app.js nạp stream
        // của TẬP TIẾP THEO (phim bộ tự chuyển tập sau khi phát hết).
        window.__bintvPrepareNextNativeEpisode = function () {
            var bridge = handler();
            if (!bridge) { return false; }
            try {
                bridge.postMessage({ action: "prepareNext" });
                return true;
            } catch (e) { return false; }
        };

        // Gửi phụ đề (đã parse SRT/VTT) sang Swift để hiển thị trên trình
        // phát native — payload { action:"subtitles", label, cues:[{s,e,t}],
        // session }. `cues` rỗng = tắt phụ đề trong player native.
        window.__bintvSetNativeSubtitles = function (payload) {
            var bridge = handler();
            if (!bridge) { return false; }
            try {
                var body = payload || {};
                var cues = Array.isArray(body.cues) ? body.cues : [];
                bridge.postMessage({
                    action: "subtitles",
                    label: text(body.label),
                    cues: cues,
                    session: text(body.session)
                });
                return true;
            } catch (e) { return false; }
        };

        // -----------------------------------------------------------------
        // Bắt sự kiện người dùng CLICK (hoặc ENTER/SPACE) vào thẻ phim.
        // Capture phase trên document → chạy trước listener của app.js và
        // không preventDefault/stopPropagation (app.js mở phim như cũ).
        // -----------------------------------------------------------------
        window.__bintvLastPlayIntent = null;
        function recordIntent(node) {
            try {
                var element = node;
                var hops = 0;
                while (element && element !== document.body && hops < 12) {
                    hops++;
                    var classes = element.classList;
                    if (classes && (classes.contains("movie-card") || classes.contains("movie-card-poster"))) {
                        window.__bintvLastPlayIntent = {
                            id: (element.getAttribute && element.getAttribute("data-movie-id")) || "",
                            name: (element.getAttribute && element.getAttribute("data-movie-name")) || "",
                            type: (element.getAttribute && element.getAttribute("data-movie-type")) || "",
                            at: Date.now()
                        };
                        try {
                            console.log("[NATIVE] play intent: " + (window.__bintvLastPlayIntent.name || "?")
                                + " (" + (window.__bintvLastPlayIntent.id || "?") + ")");
                        } catch (e2) {}
                        return true;
                    }
                    element = element.parentNode;
                }
            } catch (e) {}
            return false;
        }
        document.addEventListener("click", function (event) {
            recordIntent(event && event.target);
        }, true);
        document.addEventListener("keydown", function (event) {
            var key = text(event && event.key);
            var code = (event && (event.keyCode || event.which)) || 0;
            if (key === "Enter" || key === " " || code === 13 || code === 32) {
                recordIntent(document.activeElement || (event && event.target));
            }
        }, true);
    })();
    """

    // =====================================================================
    // Host lifecycle bridge (document-start)
    //
    // The web app was originally written for a standalone TV shell.  Its
    // legacy visibility/pagehide handlers close the movie browser, which is
    // destructive when iOS temporarily backgrounds the WKWebView for Home or
    // Safari.  This bridge is injected only by the iOS host.  It snapshots the
    // state before suspension and prevents those legacy handlers from tearing
    // down the active PHIM screen.
    // =====================================================================
    private static let lifecycleBridgeJS = """
    (function () {
        "use strict";
        if (window.__bintvPhimHostLifecycle) { return; }

        function messageHandler() {
            try {
                return window.webkit && window.webkit.messageHandlers
                    && window.webkit.messageHandlers.phimLifecycle;
            } catch (e) { return null; }
        }

        // No message handler means this script is not running inside the
        // BinTV iOS host. Leave standalone Android/Windows behavior untouched.
        if (!messageHandler()) { return; }

        function fallbackState() {
            try {
                var browser = document.getElementById("bintv-movie-browser");
                var player = document.getElementById("bintv-movie-player");
                var video = document.getElementById("bintv-movie-html5-player");
                var card = document.querySelector(".movie-card.focus")
                    || document.querySelector(".movie-card[data-movie-id]");
                return {
                    version: 1,
                    browserOpen: !!(browser && browser.classList.contains("show")),
                    screen: player && player.classList.contains("show") ? "player" : "browser",
                    selectedMovie: card ? {
                        id: String(card.getAttribute("data-movie-id") || ""),
                        name: String(card.getAttribute("data-movie-name") || ""),
                        type: String(card.getAttribute("data-movie-type") || "")
                    } : {},
                    player: {
                        open: !!(player && player.classList.contains("show")),
                        paused: !!(video && video.paused),
                        positionMs: video && isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : 0
                    },
                    source: { url: video ? String(video.currentSrc || video.src || "") : "" }
                };
            } catch (e) { return { version: 1, screen: "unknown" }; }
        }

        function readState() {
            try {
                if (window.__bintvPhimLifecycle
                    && typeof window.__bintvPhimLifecycle.capture === "function") {
                    return window.__bintvPhimLifecycle.capture();
                }
            } catch (e) {}
            return fallbackState();
        }

        function capture(reason, suppliedState) {
            var state = suppliedState || readState();
            try { sessionStorage.setItem("__bintvPhimLifecycleState", JSON.stringify(state)); } catch (e) {}
            try {
                var bridge = messageHandler();
                if (bridge) bridge.postMessage({
                    action: "snapshot",
                    reason: String(reason || "unknown"),
                    state: state
                });
            } catch (e2) {}
            return state;
        }

        window.__bintvPhimHostLifecycle = {
            capture: capture,
            readStored: function () {
                try {
                    var raw = sessionStorage.getItem("__bintvPhimLifecycleState");
                    return raw ? JSON.parse(raw) : null;
                } catch (e) { return null; }
            }
        };

        // Capture-phase listeners are installed before app.js.  Stop the old
        // standalone cleanup listener only for this embedded iOS host; it
        // would otherwise call closeMovieBrowser() and leave a black surface.
        document.addEventListener("visibilitychange", function (event) {
            if (!document.hidden) { return; }
            capture("visibilitychange");
            try { event.stopImmediatePropagation(); } catch (e) {}
        }, true);
        window.addEventListener("pagehide", function (event) {
            capture("pagehide");
            try { event.stopImmediatePropagation(); } catch (e) {}
        }, true);
        window.addEventListener("pageshow", function () {
            try {
                var bridge = messageHandler();
                if (bridge) bridge.postMessage({ action: "pageshow" });
            } catch (e) {}
        }, true);
    })();
    """

    // =====================================================================
    // [build 231] Xử lý message `playVideoNative` → mở trình phát GỐC iOS
    // =====================================================================

    /// Nối callback của `PhimNativePlayerController` về web app (JS).
    /// app.js dùng `session` để bỏ qua callback cũ (người dùng đã chuyển phim).
    private func configureNativePlayerCallbacks() {
        nativePlayer.onStarted = { [weak self] request in
            PhimDebugLog.step("BRIDGE", "nativeStarted→JS", "ok",
                              "session=\(request.session) title=\(request.logTitle)")
            self?.notifyWebApp(function: "__bintvNativePlaybackStarted", payload: [
                "session": request.session,
                "title": request.title,
                "url": request.url
            ])
        }
        nativePlayer.onFailure = { [weak self] request, message in
            PhimDebugLog.step("BRIDGE", "nativeFailed→JS", "FAIL",
                              "session=\(request.session) title=\(request.logTitle) \(message)")
            self?.notifyWebApp(function: "__bintvNativePlaybackFailed", payload: [
                "session": request.session,
                "title": request.title,
                "url": request.url,
                "message": message
            ])
        }
        nativePlayer.onClosed = { [weak self] request in
            PhimDebugLog.step("BRIDGE", "nativeClosed→JS", "ok",
                              "session=\(request.session) title=\(request.logTitle)")
            self?.notifyWebApp(function: "__bintvNativePlaybackClosed", payload: [
                "session": request.session,
                "title": request.title
            ])
        }
        // [build 233] Native phát HẾT tập/phim → JS quyết định next-tập / đóng.
        nativePlayer.onEnded = { [weak self] request in
            PhimDebugLog.step("BRIDGE", "nativeEnded→JS", "ok",
                              "session=\(request.session) title=\(request.logTitle)")
            self?.notifyWebApp(function: "__bintvNativePlaybackEnded", payload: [
                "session": request.session,
                "title": request.title,
                "url": request.url
            ])
        }
        nativePlayer.onStateReconciled = { [weak self] request, position, paused in
            PhimDebugLog.step("PLAYER", "nativeReconcile→JS", "ok",
                              "session=\(request.session) positionMs=\(Int((position * 1000).rounded())) paused=\(paused)")
            self?.notifyWebApp(function: "__bintvNativePlaybackStarted", payload: [
                "session": request.session,
                "title": request.title,
                "url": request.url,
                "positionMs": Int((position * 1000).rounded()),
                "paused": paused,
                "reconciled": true
            ])
        }
    }

    /// Gọi hàm JS của web app với payload ĐÃ JSON-hoá (JSON là literal hợp lệ
    /// trong JS nên không cần escape thủ công — không có đường tiêm chuỗi).
    private func notifyWebApp(function name: String, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "try { if (typeof window.\(name) === 'function') { window.\(name)(\(json)); } } catch (e) {}"
        // [CI 2026-09-13] Ghi rõ loại () -> Void: thân closure trả Void?
        // (optional-chaining) -> suy ra () -> Void? -> async(execute:) không
        // khớp overload nào (error: cannot convert '() -> Void?' to
        // 'DispatchWorkItem'). Có annotation, Void? tự coerce về Void.
        let run: () -> Void = { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
        if Thread.isMainThread { run() } else { DispatchQueue.main.async(execute: run) }
    }

    /// Đọc message `playVideoNative`: {url, title, proxyUrl, referer, reason,
    /// session} (hoặc {action:"stop"}) → mở/đóng trình phát native.
    private func handlePlayVideoNative(_ body: Any?) {
        let dict = (body as? [String: Any]) ?? [:]
        func text(_ keys: String...) -> String {
            for key in keys {
                if let value = dict[key] as? String {
                    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { return trimmed }
                }
            }
            return ""
        }
        let action = text("action")
        let url = text("url", "streamUrl", "streamURL", "src")
        let proxyURL = text("proxyUrl", "proxyURL", "proxy")
        // [build 233] Phim bộ: JS báo "đang nạp tập tiếp theo — GIỮ player
        // mở" sau khi native phát hết tập (chống backstop tự đóng quá sớm).
        if action == "prepareNext" {
            PhimDebugLog.step("BRIDGE", "playVideoNative", "prepareNext",
                              "JS đang nạp tập tiếp theo của phim bộ")
            nativePlayer.prepareNextEpisode()
            return
        }
        // [build 232] Cập nhật phụ đề cho trình phát native đang chạy —
        // action = "subtitles", không có url (đừng nhầm với lệnh stop).
        if action == "subtitles" {
            handleNativeSubtitles(dict)
            return
        }
        // Không có URL (hoặc yêu cầu dừng tường minh) → đóng player native.
        if action == "stop" || action == "close" || (url.isEmpty && proxyURL.isEmpty) {
            PhimDebugLog.step("BRIDGE", "playVideoNative", "stop",
                              (url.isEmpty && proxyURL.isEmpty)
                                ? "payload không có url → dừng player native"
                                : "action=\(action)")
            let stop: () -> Void = { [weak self] in self?.nativePlayer.stop() }
            if Thread.isMainThread { stop() } else { DispatchQueue.main.async(execute: stop) }
            return
        }
        let request = PhimNativePlaybackRequest(
            url: url,
            proxyURL: proxyURL,
            title: text("title", "name"),
            referer: text("referer", "referrer", "__ref"),
            reason: text("reason", "source"),
            session: text("session"),
            resumePosition: Self.resumePosition(from: dict["resumePositionMs"] ?? dict["positionMs"]),
            resumePaused: Self.boolValue(dict["resumePaused"]) ?? false
        )
        PhimDebugLog.step("BRIDGE", "playVideoNative", "recv",
                          "title=\(request.logTitle) reason=\(request.reason.isEmpty ? "-" : request.reason) "
                          + "session=\(request.session.isEmpty ? "-" : request.session) "
                          + "url=\(PhimDebugLog.sanitizeURL(request.url)) "
                          + "proxy=\(PhimDebugLog.sanitizeURL(request.proxyURL))")
        let play: () -> Void = { [weak self] in self?.nativePlayer.play(request) }
        if Thread.isMainThread { play() } else { DispatchQueue.main.async(execute: play) }
    }

    /// Xử lý message `playVideoNative` dạng {action:"subtitles", label, cues,
    /// session} — app.js gửi khi bật/tắt Vietsub trong lúc trình phát native
    /// đang chạy. Cues là mảng {s,e,t} (giây) đã parse từ SRT/VTT phía JS.
    private func handleNativeSubtitles(_ dict: [String: Any]) {
        let session = (dict["session"] as? String) ?? ""
        let label = (dict["label"] as? String) ?? ""
        var cues: [NativeSubtitleCue] = []
        if let rawCues = dict["cues"] as? [[String: Any]] {
            for raw in rawCues {
                guard let start = Self.cueTime(raw["s"] ?? raw["start"]),
                      let end = Self.cueTime(raw["e"] ?? raw["end"]),
                      let text = Self.cueText(raw["t"] ?? raw["text"]) else { continue }
                cues.append(NativeSubtitleCue(start: start, end: end, text: text))
            }
        }
        PhimDebugLog.step("BRIDGE", "playVideoNative", "subtitles",
                          "label=\(label) count=\(cues.count) session=\(session.isEmpty ? "-" : session)")
        let update: () -> Void = { [weak self] in
            self?.nativePlayer.updateSubtitles(cues, label: label, session: session)
        }
        if Thread.isMainThread { update() } else { DispatchQueue.main.async(execute: update) }
    }

    /// Vị trí resume từ JavaScript theo milliseconds. Values không hợp lệ bị
    /// bỏ qua để một message lạ không thể làm AVPlayer seek sang NaN/vô cực.
    private static func resumePosition(from value: Any?) -> TimeInterval? {
        let milliseconds: Double?
        if let number = value as? NSNumber { milliseconds = number.doubleValue }
        else if let string = value as? String { milliseconds = Double(string) }
        else { milliseconds = nil }
        guard let milliseconds = milliseconds, milliseconds.isFinite, milliseconds > 0 else { return nil }
        return milliseconds / 1000
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let value = value as? Bool { return value }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String {
            switch text.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }

    /// Đọc số giây từ payload JSON (NSNumber từ JSONSerialization, hoặc chuỗi).
    private static func cueTime(_ value: Any?) -> TimeInterval? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return TimeInterval(string) }
        return nil
    }

    /// Đọc text cue (bỏ khoảng trắng 2 đầu; rỗng → nil).
    private static func cueText(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // [build 231] JS yêu cầu phát bằng TRÌNH PHÁT GỐC iOS (AVPlayer).
        if message.name == "playVideoNative" {
            handlePlayVideoNative(message.body)
            return
        }
        if message.name == "phimLifecycle" {
            handleLifecycleBridge(message.body)
            return
        }
        if message.name == "phimConsole" {
            // LOG CỦA WEB APP (app.js/hls.js: [STREAM], [HLS], [PLAYER],
            // [PHIM_DEBUG], video.onerror, hls.js fatal error...) →
            // phim_debug.log. WKWebView KHÔNG ghi console JS ra bất kỳ đâu
            // (Android thì có WebChromeClient → logcat) — không có hook này
            // thì toàn bộ log debug phát phim TRÊN MÁY THẬT đều vô hình →
            // không xác định được root-cause.
            if let body = message.body as? [String: Any] {
                let level = (body["level"] as? String) ?? "log"
                let text = (body["msg"] as? String) ?? ""
                PhimDebugLog.log("[JS:\(level)] \(text)")
            }
            return
        }
        guard message.name == "phimBridge" else { return }
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "landscape":
            // phim_player_ui.js: player mở → "1" (buộc landscape);
            // player đóng → "0" (GIỮ landscape — chế độ TV, không xoay dọc).
            let on = (body["enabled"] as? Bool) ?? false
            PhimDebugLog.step("BRIDGE", "setPlayerLandscape", "ok", on ? "on=1 (buộc landscape)" : "on=0 (giữ landscape)")
            setPlayerLandscape(on)
        case "exit":
            // PHIM trong BinTV là TAB — không đóng cả app (khác Android
            // standalone). Người dùng chuyển tab bình thường.
            PhimDebugLog.step("BRIDGE", "exitApp", "ignored", "PHIM là tab của BinTV")
            break
        case "clearCookies":
            // Không xóa cookie cả app (phá phiên YouTube của tab TUBE).
            PhimDebugLog.step("BRIDGE", "clearCookies", "ignored", "bảo vệ phiên tab TUBE")
            break
        default:
            PhimDebugLog.step("BRIDGE", action, "ignored", "action không xác định")
            break
        }
    }

    // =====================================================================
    // Orientation (cùng cơ chế với tab TUBE & LIVE TV)
    // =====================================================================

    private func setPlayerLandscape(_ on: Bool) {
        // Giữ màn hình sáng khi đang xem (giống FLAG_KEEP_SCREEN_ON).
        UIApplication.shared.isIdleTimerDisabled = on
        // App BinTV = chế độ TV LANDSCAPE:
        // - Player MỞ  → buộc landscape (phòng trường hợp người dùng tự
        //   xoay máy về dọc giữa chừng xem).
        // - Player ĐÓNG → KHÔNG xoay về portrait (bản cũ làm app "lọt" về
        //   layout dọc giữa chừng sử dụng) — giữ nguyên hướng hiện tại.
        // Lớp khóa cứng toàn app nằm ở AppDelegate
        // (application(_:supportedInterfaceOrientationsFor:) = .landscape)
        // + Info.plist landscape-only — request ở đây chỉ là lớp bổ trợ.
        guard on else { return }
        let orientations: UIInterfaceOrientationMask = [.landscapeLeft, .landscapeRight]
        if #available(iOS 16.0, *) {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            if let scene = scene {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations)) { error in
                    // [BUILD FIX 2026-09-12] Tham số của errorHandler là
                    // `any Error` KHÔNG Optional (handler chỉ được gọi khi
                    // lỗi) — bản trước dùng `if let error = error` → lỗi
                    // biên dịch Xcode 16.4 "initializer for conditional
                    // binding must have Optional type, not 'any Error'"
                    // (PhimWebView.swift:508, log CI 2026-09-12). Log "ok"
                    // chuyển ra sau lời gọi (ý nghĩa: request đã gửi).
                    PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "FAIL", error.localizedDescription)
                }
                PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "ok", "landscape (player mở)")
            } else {
                PhimDebugLog.step("ORIENTATION", "requestGeometryUpdate", "FAIL", "no foregroundActive scene")
            }
        } else {
            // iOS 15: KVC trên UIDevice phải dùng giá trị UIDeviceOrientation
            // (device landscapeLeft ↔ interface landscapeRight — cả hai đều
            // là LANDSCAPE, đúng yêu cầu khóa ngang).
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
            PhimDebugLog.step("ORIENTATION", "kvcDeviceOrientation", "ok", "landscape (iOS 15)")
        }
    }

    // =====================================================================
    // PHIM foreground recovery
    //
    // There are two separate failure modes that previously both looked like a
    // black PHIM screen:
    //   1. app.js treated iOS visibility/pagehide as a standalone-app exit and
    //      called closeMovieBrowser();
    //   2. WebKit may terminate its WebContent process while suspended.
    //
    // The document-start bridge prevents (1).  For (2), retain a small state
    // snapshot while the page is alive, wait for *didBecomeActive* (never
    // reload during willEnterForeground), probe the existing view, and create
    // a new WKWebView only when there is evidence that the old one is gone.
    // =====================================================================

    private var lifecycleObservers: [NSObjectProtocol] = []
    private var savedLifecycleStateJSON: String?
    private var savedLifecycleStateAt: Date?
    private var contentProcessTerminated = false
    private var foregroundRestoreNeeded = false
    private var foregroundRestoreScheduled = false
    private var foregroundRestoreInProgress = false
    private var queuedRestoreReason: String?
    private var lifecycleEpoch = 0
    private var recoveryAttempts = 0
    private var awaitingStateRestoreAfterLoad = false
    private static let maximumRecoveryAttempts = 2
    private static let foregroundProbeTimeout: TimeInterval = 1.5

    private final class FlagBox {
        var value = false
    }

    private func installLifecycleObservers() {
        let center = NotificationCenter.default
        lifecycleObservers.append(center.addObserver(
            forName: .binTVApplicationWillResignActive,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationWillResignActive()
        })
        lifecycleObservers.append(center.addObserver(
            forName: .binTVApplicationDidEnterBackground,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationDidEnterBackground()
        })
        lifecycleObservers.append(center.addObserver(
            forName: .binTVApplicationWillEnterForeground,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationWillEnterForeground()
        })
        lifecycleObservers.append(center.addObserver(
            forName: .binTVApplicationDidBecomeActive,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationDidBecomeActive()
        })
        lifecycleObservers.append(center.addObserver(
            forName: .binTVScenePhaseDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.scenePhaseDidChange(notification)
        })
    }

    private func applicationWillResignActive() {
        guard started else { return }
        lifecycleEpoch += 1
        // Any in-flight evaluateJavaScript callback belongs to the old active
        // epoch. It must not block the next didBecomeActive recovery.
        foregroundRestoreScheduled = false
        foregroundRestoreInProgress = false
        queuedRestoreReason = nil
        foregroundRestoreNeeded = true
        nativePlayer.applicationWillResignActive()
        PhimDebugLog.step("LIFECYCLE", "PHIM willResignActive", "snapshot")
        captureLifecycleState(reason: "willResignActive")
    }

    private func applicationDidEnterBackground() {
        guard started else { return }
        foregroundRestoreNeeded = true
        nativePlayer.applicationDidEnterBackground()
        PhimDebugLog.step("LIFECYCLE", "PHIM didEnterBackground", "snapshot")
        // This second request is deliberately best effort. The document-start
        // bridge has already sent a synchronous snapshot on visibilitychange.
        captureLifecycleState(reason: "didEnterBackground")
    }

    private func applicationWillEnterForeground() {
        guard started else { return }
        foregroundRestoreNeeded = true
        PhimDebugLog.step("LIFECYCLE", "PHIM willEnterForeground", "defer",
                          "waiting for didBecomeActive before touching WKWebView")
    }

    private func applicationDidBecomeActive() {
        guard started else { return }
        nativePlayer.applicationDidBecomeActive()
        scheduleForegroundRepair(reason: "didBecomeActive")
    }

    private func scenePhaseDidChange(_ notification: Notification) {
        guard started,
              let phase = notification.userInfo?["phase"] as? String else { return }
        switch phase {
        case "inactive":
            foregroundRestoreNeeded = true
            captureLifecycleState(reason: "sceneInactive")
        case "background":
            foregroundRestoreNeeded = true
        case "active":
            scheduleForegroundRepair(reason: "scenePhaseActive")
        default:
            break
        }
    }

    /// Save state before suspension without writing signed stream URLs to logs.
    /// The value is in-memory only; sessionStorage keeps the equivalent state
    /// inside a surviving page. This avoids persisting temporary source tokens.
    private func captureLifecycleState(reason: String) {
        guard started, !contentProcessTerminated else { return }
        let view = webView
        let generation = webViewGeneration
        let js = """
        (function () {
            try {
                var host = window.__bintvPhimHostLifecycle;
                var state = host && typeof host.capture === 'function'
                    ? host.capture('native-\(reason)') : null;
                return JSON.stringify(state || {});
            } catch (e) { return ''; }
        })()
        """
        view.evaluateJavaScript(js) { [weak self, weak view] value, error in
            guard let self = self, let view = view,
                  self.webView === view, self.webViewGeneration == generation else { return }
            guard error == nil, let text = value as? String, !text.isEmpty else {
                PhimDebugLog.step("LIFECYCLE", "snapshot", "skip",
                                  "reason=\(reason) evaluator unavailable")
                return
            }
            self.saveLifecycleState(text, reason: reason)
        }
    }

    /// Called by the document-start bridge on visibilitychange/pagehide. This
    /// is earlier and more reliable than an asynchronous evaluateJavaScript
    /// call when Safari backgrounds the app quickly.
    private func handleLifecycleBridge(_ body: Any?) {
        guard let dictionary = body as? [String: Any] else { return }
        let action = (dictionary["action"] as? String) ?? "unknown"
        switch action {
        case "snapshot":
            let reason = (dictionary["reason"] as? String) ?? "web"
            if let state = dictionary["state"] {
                saveLifecycleState(state, reason: "web-\(reason)")
            }
        case "pageshow":
            PhimDebugLog.step("LIFECYCLE", "web pageshow", "event")
        default:
            PhimDebugLog.step("LIFECYCLE", "web bridge", "ignored", action)
        }
    }

    private func saveLifecycleState(_ value: Any, reason: String) {
        let json: String?
        if let text = value as? String {
            json = text
        } else if JSONSerialization.isValidJSONObject(value),
                  let data = try? JSONSerialization.data(withJSONObject: value, options: []),
                  let text = String(data: data, encoding: .utf8) {
            json = text
        } else {
            json = nil
        }
        guard let json = json, !json.isEmpty else { return }
        savedLifecycleStateJSON = json
        savedLifecycleStateAt = Date()
        PhimDebugLog.step("LIFECYCLE", "snapshot", "saved",
                          "reason=\(reason) \(lifecycleStateSummary(json))")
    }

    private func lifecycleStateSummary(_ json: String) -> String {
        guard let data = json.data(using: .utf8),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return "state=unparseable"
        }
        let screen = (state["screen"] as? String) ?? "?"
        let selected = state["selectedMovie"] as? [String: Any]
        let movieID = (selected?["id"] as? String) ?? "-"
        let source = state["source"] as? [String: Any]
        let sourceURL = (source?["url"] as? String) ?? ""
        let sourceHost = URL(string: sourceURL)?.host ?? (sourceURL.isEmpty ? "-" : "local")
        let player = state["player"] as? [String: Any]
        let position = (player?["positionMs"] as? NSNumber)?.intValue ?? 0
        return "screen=\(screen) movie=\(movieID.prefix(48)) sourceHost=\(sourceHost) positionMs=\(position)"
    }

    /// Called by the UIViewRepresentable host after it attaches the current
    /// web view with real constraints. A missing window/superview is treated as
    /// a recovery signal only after the scene becomes active.
    func webViewDidAttachToContainer() {
        let size = webView.bounds.size
        PhimDebugLog.step("WEBVIEW", "hostAttach", "ok",
                          "generation=\(webViewGeneration) frame=\(Int(size.width))x\(Int(size.height)) hierarchy=\(webHierarchy())")
        if foregroundRestoreNeeded, isApplicationActive {
            scheduleForegroundRepair(reason: "webViewAttached")
        }
    }

    /// A normal PHIM ↔ LIVE TV tab switch keeps the same WKWebView mounted.
    /// Repaint the layer only; state restoration is reserved for a detected
    /// dead/empty view so a prior lifecycle snapshot cannot overwrite a newer
    /// movie selection made after returning to the tab.
    func noteTabDidAppear() {
        guard started else { return }
        repaintWebView()
        guard contentProcessTerminated || webView.url == nil else {
            PhimDebugLog.step("WEBVIEW", "tabDidAppear", "repaint",
                              "generation=\(webViewGeneration) retained=true")
            return
        }
        foregroundRestoreNeeded = true
        scheduleForegroundRepair(reason: "tabDidAppearInvalidView", delay: 0.05)
    }

    private var isApplicationActive: Bool {
        UIApplication.shared.applicationState == .active
    }

    private func scheduleForegroundRepair(reason: String, delay: TimeInterval = 0.25) {
        guard started else { return }
        guard isApplicationActive else {
            foregroundRestoreNeeded = true
            PhimDebugLog.step("LIFECYCLE", "foregroundRepair", "defer",
                              "reason=\(reason) appState=\(UIApplication.shared.applicationState.rawValue)")
            return
        }
        guard foregroundRestoreNeeded || contentProcessTerminated || awaitingStateRestoreAfterLoad else { return }
        if foregroundRestoreInProgress || foregroundRestoreScheduled {
            queuedRestoreReason = reason
            PhimDebugLog.step("LIFECYCLE", "foregroundRepair", "coalesced", reason)
            return
        }
        foregroundRestoreScheduled = true
        let epoch = lifecycleEpoch
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, self.lifecycleEpoch == epoch else { return }
            self.foregroundRestoreScheduled = false
            self.beginForegroundRepair(reason: reason, epoch: epoch)
        }
    }

    /// The decision tree intentionally starts with the least invasive action:
    /// repaint + probe a live page. It recreates only a terminated, detached,
    /// external-navigated, or non-responsive WKWebView.
    private func beginForegroundRepair(reason: String, epoch: Int) {
        guard started, isApplicationActive, lifecycleEpoch == epoch else { return }
        guard !foregroundRestoreInProgress else {
            queuedRestoreReason = reason
            return
        }
        foregroundRestoreInProgress = true
        recoveryAttempts = 0
        PhimDebugLog.step("LIFECYCLE", "foregroundRepair", "begin",
                          "reason=\(reason) processTerminated=\(contentProcessTerminated) generation=\(webViewGeneration)")

        if !hasUsableWebViewHierarchy() {
            waitForWebViewAttachment(reason: reason, epoch: epoch, attempt: 0)
            return
        }
        if contentProcessTerminated {
            rebuildWebView(reason: "WebContent process terminated")
            return
        }
        guard let url = webView.url, isLocalPhimPage(url) else {
            rebuildWebView(reason: webView.url == nil ? "WKWebView has no page URL" : "WKWebView left local PHIM page")
            return
        }
        probeLiveWebView(reason: reason, epoch: epoch)
    }

    private func waitForWebViewAttachment(reason: String, epoch: Int, attempt: Int) {
        guard lifecycleEpoch == epoch, isApplicationActive else {
            finishForegroundRepair(expectedEpoch: epoch)
            return
        }
        if hasUsableWebViewHierarchy() {
            beginForegroundRepairAfterAttachment(reason: reason, epoch: epoch)
            return
        }
        guard attempt < 3 else {
            PhimDebugLog.step("WEBVIEW", "hierarchy", "missing",
                              "superview/window unavailable after foreground; recreating")
            rebuildWebView(reason: "view hierarchy missing after foreground")
            return
        }
        PhimDebugLog.step("WEBVIEW", "hierarchy", "waiting",
                          "attempt=\(attempt + 1) hierarchy=\(webHierarchy())")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            self?.waitForWebViewAttachment(reason: reason, epoch: epoch, attempt: attempt + 1)
        }
    }

    private func beginForegroundRepairAfterAttachment(reason: String, epoch: Int) {
        guard lifecycleEpoch == epoch, isApplicationActive else {
            finishForegroundRepair(expectedEpoch: epoch)
            return
        }
        if contentProcessTerminated || webView.url == nil || !(webView.url.map { self.isLocalPhimPage($0) } ?? false) {
            rebuildWebView(reason: contentProcessTerminated ? "terminated while waiting for host" : "invalid page after host attach")
        } else {
            probeLiveWebView(reason: reason, epoch: epoch)
        }
    }

    private func probeLiveWebView(reason: String, epoch: Int) {
        let view = webView
        let generation = webViewGeneration
        let answered = FlagBox()
        repaintWebView()
        let js = """
        (function () {
            try {
                return JSON.stringify({
                    ready: document.readyState,
                    body: !!document.body,
                    api: !!(window.__bintvPhimLifecycle && window.__bintvPhimLifecycle.restore),
                    browserOpen: !!(document.getElementById('bintv-movie-browser')
                        && document.getElementById('bintv-movie-browser').classList.contains('show')),
                    playerOpen: !!(document.getElementById('bintv-movie-player')
                        && document.getElementById('bintv-movie-player').classList.contains('show')),
                    width: Math.round(window.innerWidth || 0),
                    height: Math.round(window.innerHeight || 0)
                });
            } catch (e) { return ''; }
        })()
        """
        view.evaluateJavaScript(js) { [weak self, weak view] value, error in
            guard let self = self, let view = view,
                  self.webView === view,
                  self.webViewGeneration == generation,
                  self.lifecycleEpoch == epoch else { return }
            answered.value = true
            guard self.isApplicationActive else {
                self.finishForegroundRepair(expectedEpoch: epoch)
                return
            }
            guard error == nil, let result = value as? String, !result.isEmpty else {
                self.rebuildWebView(reason: "live page probe returned an error")
                return
            }
            PhimDebugLog.step("WEBVIEW", "foregroundProbe", "ok",
                              "reason=\(reason) \(self.safeProbeSummary(result))")
            if self.livePageNeedsStateRestore(result) {
                if self.contentProcessTerminated {
                    self.rebuildWebView(reason: "live page state API unavailable")
                } else {
                    PhimDebugLog.step("WEBVIEW", "foregroundProbe", "restore",
                                      "live document lost PHIM screen state")
                    self.restorePageStateWhenReady(rebuilt: false, epoch: epoch, attempt: 0)
                }
            } else {
                // A responsive page still owns its player/browser state. Do
                // not replay a source or reload merely because it foregrounded.
                self.foregroundRestoreNeeded = false
                self.repaintWebView()
                self.finishForegroundRepair(expectedEpoch: epoch)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.foregroundProbeTimeout) { [weak self, weak view] in
            guard let self = self, let view = view,
                  self.webView === view,
                  self.webViewGeneration == generation,
                  self.lifecycleEpoch == epoch,
                  !answered.value,
                  self.isApplicationActive else { return }
            self.rebuildWebView(reason: "WKWebView did not answer foreground probe")
        }
    }

    private func safeProbeSummary(_ result: String) -> String {
        guard let data = result.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return "probe=unparseable"
        }
        let ready = (value["ready"] as? String) ?? "?"
        let body = (value["body"] as? Bool) ?? false
        let api = (value["api"] as? Bool) ?? false
        let browserOpen = (value["browserOpen"] as? Bool) ?? false
        let playerOpen = (value["playerOpen"] as? Bool) ?? false
        let width = (value["width"] as? NSNumber)?.intValue ?? 0
        let height = (value["height"] as? NSNumber)?.intValue ?? 0
        return "ready=\(ready) body=\(body) api=\(api) browser=\(browserOpen) player=\(playerOpen) viewport=\(width)x\(height)"
    }

    /// A live page is restored only if its DOM contradicts the snapshot that
    /// was captured before backgrounding. This catches an unexpected legacy
    /// cleanup without restarting a healthy HTML5/native player on every
    /// foreground event.
    private func livePageNeedsStateRestore(_ probe: String) -> Bool {
        guard let saved = savedLifecycleStateJSON,
              let savedData = saved.data(using: .utf8),
              let expected = try? JSONSerialization.jsonObject(with: savedData) as? [String: Any],
              let probeData = probe.data(using: .utf8),
              let actual = try? JSONSerialization.jsonObject(with: probeData) as? [String: Any] else {
            return false
        }
        let expectedBrowser = (expected["browserOpen"] as? Bool) ?? false
        let expectedPlayer = ((expected["player"] as? [String: Any])?["open"] as? Bool) ?? false
        let actualBrowser = (actual["browserOpen"] as? Bool) ?? false
        let actualPlayer = (actual["playerOpen"] as? Bool) ?? false
        let hasAPI = (actual["api"] as? Bool) ?? false
        if (expectedBrowser && !actualBrowser) || (expectedPlayer && !actualPlayer) {
            // If the page itself is alive but app.js did not initialise, force
            // a fresh host page rather than endlessly calling a missing API.
            if !hasAPI {
                PhimDebugLog.step("WEBVIEW", "foregroundProbe", "API_MISSING",
                                  "screen mismatch requires a fresh page")
                contentProcessTerminated = true
            }
            return true
        }
        return false
    }

    private func rebuildWebView(reason: String) {
        guard isApplicationActive else {
            foregroundRestoreNeeded = true
            finishForegroundRepair()
            return
        }
        guard recoveryAttempts < Self.maximumRecoveryAttempts else {
            foregroundRestoreNeeded = false
            finishForegroundRepair()
            failMessage = "Không thể khôi phục WebView Phim sau khi ứng dụng trở lại."
            loadFailed = true
            PhimDebugLog.step("WEBVIEW", "rebuild", "FAIL", "recovery limit reached: \(reason)")
            return
        }
        recoveryAttempts += 1
        let old = webView
        detach(old)
        old.removeFromSuperview()
        let configuration = Self.makeWebViewConfiguration()
        let replacement = Self.makeWebView(configuration: configuration)
        configure(replacement, configuration: configuration)
        webViewGeneration += 1
        webView = replacement
        contentProcessTerminated = false
        awaitingStateRestoreAfterLoad = true
        foregroundRestoreNeeded = true
        PhimDebugLog.step("WEBVIEW", "rebuild", "begin",
                          "attempt=\(recoveryAttempts) generation=\(webViewGeneration) reason=\(reason) state=\(savedLifecycleStateJSON == nil ? "none" : "saved")")
        loadFreshPageAfterRecovery()
        finishForegroundRepair()
    }

    private func loadFreshPageAfterRecovery() {
        let server = PhimLocalServer.shared
        self.server = server
        let loadWhenReady: (Int) -> Void = { [weak self] port in
            guard let self = self else { return }
            PhimDebugLog.step("SERVER", "foregroundRecovery", "ready", "port=\(port)")
            self.loadPage(cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        }
        let failWhenReady: (String) -> Void = { [weak self] message in
            guard let self = self else { return }
            PhimDebugLog.step("SERVER", "foregroundRecovery", "FAIL", message)
            self.awaitingStateRestoreAfterLoad = false
            self.failMessage = message
            self.loadFailed = true
        }
        server.onPortReady = loadWhenReady
        server.onPortFailed = failWhenReady
        guard server.port > 0 else {
            server.start()
            armServerTimeout()
            return
        }
        checkServerHealth { [weak self] healthy in
            guard let self = self else { return }
            if healthy {
                self.loadPage(cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
            } else {
                PhimDebugLog.step("SERVER", "foregroundRecovery", "restart",
                                  "health check failed")
                server.restartListener()
                self.armServerTimeout()
            }
        }
    }

    /// A recovered page has to finish loading before app.js exports its state
    /// API. Retry the *restore call* for a short period; do not reload again
    /// merely because bootstrap/catalog work is still in progress.
    private func restorePageStateWhenReady(rebuilt: Bool, epoch: Int, attempt: Int) {
        guard started, isApplicationActive, lifecycleEpoch == epoch else {
            finishForegroundRepair(expectedEpoch: epoch)
            return
        }
        let view = webView
        let generation = webViewGeneration
        let state = savedLifecycleStateJSON ?? "null"
        let rebuiltLiteral = rebuilt ? "true" : "false"
        let js = """
        (function () {
            try {
                var api = window.__bintvPhimLifecycle;
                if (!api || typeof api.restore !== 'function') return 'not-ready';
                var result = api.restore(\(state), { rebuilt: \(rebuiltLiteral) });
                return String(result || 'ok');
            } catch (e) { return 'error:' + String(e && e.message || e); }
        })()
        """
        view.evaluateJavaScript(js) { [weak self, weak view] value, error in
            guard let self = self, let view = view,
                  self.webView === view,
                  self.webViewGeneration == generation,
                  self.lifecycleEpoch == epoch else { return }
            let result = error == nil ? ((value as? String) ?? "") : "error"
            if result == "not-ready", attempt < 24 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    self?.restorePageStateWhenReady(rebuilt: rebuilt, epoch: epoch, attempt: attempt + 1)
                }
                return
            }
            self.awaitingStateRestoreAfterLoad = false
            self.foregroundRestoreNeeded = false
            if result.hasPrefix("error") || result.isEmpty {
                PhimDebugLog.step("WEBVIEW", "stateRestore", "warn",
                                  "result=\(String(result.prefix(160)))")
            } else {
                PhimDebugLog.step("WEBVIEW", "stateRestore", "ok",
                                  "rebuilt=\(rebuilt) result=\(String(result.prefix(160)))")
            }
            self.repaintWebView()
            // The page may have been replaced while AVKit stayed alive. Let
            // the native player reassert its UI state after app.js has applied
            // the restored shell; it does not issue a second playback request.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                self?.nativePlayer.reconcileWebAppState()
            }
            self.finishForegroundRepair(expectedEpoch: epoch)
        }
    }

    private func finishForegroundRepair(expectedEpoch: Int? = nil) {
        guard expectedEpoch == nil || expectedEpoch == lifecycleEpoch else { return }
        foregroundRestoreInProgress = false
        foregroundRestoreScheduled = false
        if let queued = queuedRestoreReason {
            queuedRestoreReason = nil
            DispatchQueue.main.async { [weak self] in
                self?.scheduleForegroundRepair(reason: queued, delay: 0.05)
            }
        }
    }

    private func hasUsableWebViewHierarchy() -> Bool {
        let size = webView.bounds.size
        return webView.superview != nil && webView.window != nil && size.width > 1 && size.height > 1
    }

    private func webHierarchy() -> String {
        var nodes: [String] = []
        var current: UIView? = webView
        var count = 0
        while let node = current, count < 6 {
            nodes.append(String(describing: type(of: node)))
            current = node.superview
            count += 1
        }
        return nodes.joined(separator: ">")
    }

    private func isLocalPhimPage(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        guard host == "127.0.0.1" || host == "localhost" else { return false }
        let expectedPort = server?.port ?? PhimLocalServer.shared.port
        return expectedPort <= 0 || url.port == expectedPort
    }

    /// Repaint only. Moving the scroll offset during lifecycle restoration can
    /// trigger an unwanted player/UI mutation, so no scroll "nudge" is used.
    private func repaintWebView() {
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        webView.scrollView.setNeedsLayout()
        webView.setNeedsDisplay()
    }

    /// Hỏi `/health` của server nội bộ trước a forced recreation. It is never
    /// used as a reason to reload an otherwise healthy, responsive web page.
    private func checkServerHealth(completion: @escaping (Bool) -> Void) {
        let server = PhimLocalServer.shared
        self.server = server
        guard server.port > 0,
              let url = URL(string: "http://127.0.0.1:\(server.port)/health") else {
            completion(false)
            return
        }
        var request = URLRequest(url: url,
                                 cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                                 timeoutInterval: 1.2)
        URLSession.shared.dataTask(with: request) { _, response, error in
            let ok = (error == nil) && ((response as? HTTPURLResponse)?.statusCode == 200)
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    // =====================================================================
    // Audio session (âm thanh phim — độc lập với tab TUBE)
    //
    // Tab TUBE tự set AVAudioSession .playback khi tab hiện, nhưng nếu
    // người dùng mở app → đi thẳng tab PHIM (chưa qua TUBE), session
    // còn .soloAmbient mặc định → audio phim bị ảnh hưởng bởi silent
    // switch. Set .playback ngay khi tab PHIM khởi server (cùng category
    // / mode với TUBE — không xung đột).
    // =====================================================================
    func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            // Không set được thì app vẫn chạy ở foreground; chỉ mất phát nền.
        }
    }

    // =====================================================================
    // SAFE AREA (top) — inject chiều cao status bar THẬT vào web app
    //
    // Trên LANDSCAPE, status bar iPhone (giờ / pin / sóng / Dynamic
    // Island) KHÔNG phải một phần của safe area (safeArea.top = 0), trong
    // khi PhimView full-bleed (.ignoresSafeArea()) → web content tràn lên
    // đè vào khu vực giờ/pin. Web app (landscape.css) giữ chỗ bằng biến
    // CSS --bintv-status-bar-h; giá trị do SYSTEM trả ở RUNTIME
    // (statusBarManager.statusBarFrame.height — đúng theo thiết bị +
    // orientation, KHÔNG hard-code số).
    // =====================================================================

    private func injectStatusBarInset() {
        // `statusBarManager` là OPTIONAL (UIStatusBarManager?) → phải chain
        // với `?.` (compile error nếu thiếu: "value of optional type
        // 'UIStatusBarManager?' must be unwrapped").
        let height: CGFloat = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.statusBarManager?.statusBarFrame.height ?? 0
        let js = "document.documentElement.style.setProperty('--bintv-status-bar-h', '\(Int(height.rounded()))px');"
        webView.evaluateJavaScript(js) { _, _ in }
    }

    /// Wrapper public cho PhimWebViewContainer.updateUIView (re-inject
    /// sau rotation/layout change).
    func injectStatusBarInsetPublic() {
        injectStatusBarInset()
    }

    // =====================================================================
    // WKNavigationDelegate / WKUIDelegate
    // =====================================================================

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        contentProcessTerminated = true
        foregroundRestoreNeeded = true
        lifecycleEpoch += 1
        foregroundRestoreScheduled = false
        foregroundRestoreInProgress = false
        queuedRestoreReason = nil
        PhimDebugLog.step("WEBVIEW", "webContentProcessDidTerminate", "detected",
                          "generation=\(webViewGeneration) appActive=\(isApplicationActive)")
        // Never reload this instance here. A reload issued while suspended can
        // finish against a dead rendering surface. The active lifecycle path
        // creates a correctly configured replacement and restores its state.
        if isApplicationActive {
            scheduleForegroundRepair(reason: "webContentProcessDidTerminate", delay: 0.05)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        PhimDebugLog.step("NAVIGATION", "didStart", "begin",
                          PhimDebugLog.sanitizeURL(webView.url?.absoluteString ?? ""))
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        PhimDebugLog.step("NAVIGATION", "didCommit", "ok",
                          PhimDebugLog.sanitizeURL(webView.url?.absoluteString ?? ""))
    }

    /// Page load completion is the only point at which a rebuilt page receives
    /// serialized state. A normal navigation does not get an unsolicited
    /// restore, preventing an old snapshot from overwriting new user actions.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        PhimDebugLog.step("NAVIGATION", "didFinish", "ok",
                          PhimDebugLog.sanitizeURL(webView.url?.absoluteString ?? ""))
        injectStatusBarInset()
        guard awaitingStateRestoreAfterLoad else { return }
        let epoch = lifecycleEpoch
        restorePageStateWhenReady(rebuilt: true, epoch: epoch, attempt: 0)
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        handleNavigationFailure(webView, error: error, phase: "didFail")
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        handleNavigationFailure(webView, error: error, phase: "didFailProvisional")
    }

    private func handleNavigationFailure(_ webView: WKWebView, error: Error, phase: String) {
        guard webView === self.webView else { return }
        let nsError = error as NSError
        // Cancelling an external user link is intentional: it opens Safari
        // while the local PHIM document remains in place. Do not turn that
        // normal hand-off into a misleading black/error overlay.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            PhimDebugLog.step("NAVIGATION", phase, "cancelled", "intentional")
            return
        }
        PhimDebugLog.step("NAVIGATION", phase, "FAIL", error.localizedDescription)
        awaitingStateRestoreAfterLoad = false
        DispatchQueue.main.async {
            self.failMessage = error.localizedDescription
            self.loadFailed = true
        }
    }

    /// Keep the bundled local PHIM application in this WKWebView. External
    /// user-activated links (help/login/etc.) continue to use the system
    /// browser, but stream/source URLs are never force-opened as a workaround.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === self.webView else {
            decisionHandler(.cancel)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if isLocalPhimPage(url) || url.scheme == "about" || url.scheme == "data" {
            decisionHandler(.allow)
            return
        }
        // A target=_blank navigation is handled once by WKUIDelegate below.
        // Cancelling it here and opening it as well would race/double-open
        // Safari on some WebKit versions.
        if navigationAction.targetFrame == nil {
            decisionHandler(.allow)
            return
        }

        let isUserActivatedLink = navigationAction.navigationType == .linkActivated
        if isUserActivatedLink, UIApplication.shared.canOpenURL(url) {
            captureLifecycleState(reason: "externalUserLink")
            PhimDebugLog.step("NAVIGATION", "externalUserLink", "open",
                              PhimDebugLog.sanitizeURL(url.absoluteString))
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        } else {
            PhimDebugLog.step("NAVIGATION", "externalNavigation", "cancel",
                              "type=\(navigationAction.navigationType.rawValue) "
                              + PhimDebugLog.sanitizeURL(url.absoluteString))
        }
        decisionHandler(.cancel)
    }

    /// target=_blank has no target frame, so WKWebView asks its UIDelegate.
    /// Preserve normal external-link behavior and snapshot before Safari causes
    /// applicationWillResignActive. This is deliberately restricted to a link
    /// activation, never an automatic media/source handoff.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard webView === self.webView,
              navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              !isLocalPhimPage(url),
              UIApplication.shared.canOpenURL(url) else { return nil }
        captureLifecycleState(reason: "externalBlankLink")
        PhimDebugLog.step("NAVIGATION", "targetBlank", "open",
                          PhimDebugLog.sanitizeURL(url.absoluteString))
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard webView === self.webView else {
            completionHandler()
            return
        }
        guard let presenter = topViewController(from: webView.window?.rootViewController) else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: "BinTV Phim", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    private func topViewController(from root: UIViewController?) -> UIViewController? {
        guard let root = root else { return nil }
        if let presented = root.presentedViewController { return topViewController(from: presented) }
        if let navigation = root as? UINavigationController { return topViewController(from: navigation.visibleViewController) }
        if let tab = root as? UITabBarController { return topViewController(from: tab.selectedViewController) }
        return root
    }

}

// =====================================================================
// PhimView — TAB PHIM trong BinTV (web app full-bleed + error overlay)
// =====================================================================

struct PhimView: View {
    @StateObject private var controller = PhimController()
    /// Long-press → hiện menu tab (gắn bởi ContentView, nhất quán 4 tab).
    var onLongPress: () -> Void = {}
    /// [2026-09-12, build 221] Tab PHIM có đang được chọn hay không —
    /// ContentView truyền vào. Trang PHIM GIỮ NGUYÊN trong hierarchy khi
    /// chuyển tab (không bị gỡ → webview không bao giờ rời window); cờ
    /// này chỉ để biết lúc nào tab hiện trở lại.
    var isActive: Bool = true

    var body: some View {
        ZStack {
            PhimWebViewContainer(controller: controller, onLongPress: onLongPress)
            if controller.loadFailed {
                errorOverlay
            }
        }
        .ignoresSafeArea()
        .onAppear {
            // Lần đầu tab PHIM được mở: khởi server + tải web app
            // (idempotent — `started` guard).
            controller.startAndLoadIfNeeded()
        }
        .onChange(of: isActive) { active in
            // MỖI LẦN QUAY LẠI TAB PHIM (kể cả sau nhiều lần chuyển
            // qua lại): repaint layer + khôi phục nếu webview trống.
            // KHÔNG reload khi trạng thái hiện tại vẫn dùng được.
            guard active else { return }
            controller.startAndLoadIfNeeded()
            controller.noteTabDidAppear()
        }
    }

    // Port ErrorScreen.java — chỉ hiện khi server/webview lỗi.
    private var errorOverlay: some View {
        ZStack {
            Color.black
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.largeTitle)
                    .foregroundColor(.orange)
                Text("Không thể tải Phim")
                    .font(.headline)
                    .foregroundColor(Color(red: 1.0, green: 0.545, blue: 0.545))
                Text(controller.failMessage.isEmpty
                     ? "Kiểm tra kết nối mạng rồi thử lại."
                     : controller.failMessage)
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("Thử lại") {
                    controller.retryLoad()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}

private final class PhimWebViewHost: UIView {
    private weak var controller: PhimController?
    private var installedWebView: WKWebView?
    private var lastReportedSize: CGSize = .zero

    init(controller: PhimController) {
        self.controller = controller
        super.init(frame: .zero)
        backgroundColor = .black
        accessibilityIdentifier = "BinTV.Phim.WebViewHost"
        install(controller.webView)
    }

    required init?(coder: NSCoder) {
        nil
    }

    func install(_ webView: WKWebView) {
        guard installedWebView !== webView else {
            controller?.webViewDidAttachToContainer()
            return
        }
        installedWebView?.removeFromSuperview()
        installedWebView = webView
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        setNeedsLayout()
        controller?.webViewDidAttachToContainer()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != lastReportedSize else { return }
        lastReportedSize = bounds.size
        controller?.webViewDidAttachToContainer()
    }
}

private struct PhimWebViewContainer: UIViewRepresentable {
    @ObservedObject var controller: PhimController
    let onLongPress: () -> Void

    func makeUIView(context: Context) -> PhimWebViewHost {
        PhimWebViewHost(controller: controller)
    }

    func updateUIView(_ uiView: PhimWebViewHost, context: Context) {
        // The host owns the constraints and can atomically swap a terminated
        // WKWebView for the controller's replacement without rebuilding the
        // surrounding SwiftUI tab hierarchy.
        uiView.install(controller.webView)
        controller.onLongPress = onLongPress
        controller.injectStatusBarInsetPublic()
    }
}
