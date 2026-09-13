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
// =====================================================================

final class PhimController: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {

    @Published var loadFailed = false
    @Published var failMessage = ""
    let webView: WKWebView
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
        let configuration = WKWebViewConfiguration()
        // Data store persistent: localStorage của web app (bootstrap/
        // catalog cache) sống qua các lần mở app — giống DOM storage
        // Android.
        configuration.websiteDataStore = .default()
        // Autoplay (web app phát video ngay khi mở phim).
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // =================================================================
        // [FIX 2026-09-12 — ROOT CAUSE "Không thể phát nguồn phim này trên TV"]
        // allowsInlineMediaPlayback: mặc định FALSE trên iPhone (chỉ iPad
        // mặc định true). Khi false, thuộc tính HTML `playsinline` của thẻ
        // <video id="bintv-movie-html5-player"> BỊ WEBKIT BỎ QUA:
        //  - video.play() (app.js gọi SAU chuỗi resolve stream bất đồng bộ —
        //    không còn user-activation) → play() reject NotAllowedError,
        //    hoặc WebKit tự "bắt cóc" video sang player FULLSCREEN native;
        //  - player fullscreen native KHÔNG phát được nội dung MSE của
        //    hls.js (iOS 17.1+, ManagedMediaSource) → hls.js fatal error;
        //  - video.onerror / hls ERROR → handleMoviePlaybackError() → hết
        //    stream fallback → app.js hiện đúng lỗi "Không thể phát nguồn
        //    phim này trên TV" (app.js:5380);
        //  - fullscreen takeover cũng là thủ phạm XOAY MÀN HÌNH khỏi
        //    landscape khi mở player (nhiệm vụ Orientation).
        // PHẢI set TRƯỚC khi khởi tạo WKWebView (Apple docs: configuration
        // chỉ áp dụng lúc init). Đây là công tắc CHÍNH THỨC — không hack.
        // =================================================================
        configuration.allowsInlineMediaPlayback = true
        // Shim AndroidBridge — chạy TRƯỚC hls.min.js/tizen_shim.js/app.js.
        // [build 225] ÉP viewport chuẩn thiết bị TRƯỚC mọi script của web app.
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.viewportFixJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeShimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // =================================================================
        // [build 231 — 2026-09-13] CẦU NỐI NATIVE PLAYER (JS → Swift)
        // Tiêm ở DOCUMENT START để `window.__bintvPlayVideoNative` tồn tại
        // TRƯỚC khi app.js chạy: app.js gọi hàm này khi nguồn phim là thứ
        // WebKit không giải mã được (MKV / AC3/EAC3/DTS) hoặc khi <video>
        // báo lỗi — thay vì rơi vào nhánh fallback TV ("Không thể phát …
        // trên TV"). Kèm listener CAPTURE trên document bắt sự kiện người
        // dùng CLICK thẻ phim (ghi "ý định phát": id + tên phim).
        // =================================================================
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.nativeHandoffJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // Hook console.* của web app → phim_debug.log (xem consoleCaptureJS).
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.consoleCaptureJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // [PHIM_DEBUG] Observer THỤ ĐỘNG (không đụng logic app.js): log môi
        // trường phát (MSE/ManagedMediaSource/hls.js/native HLS/inline) +
        // mọi sự kiện media của thẻ <video> theo format chuẩn
        // `[PHIM_DEBUG] Step -> Action -> Status -> Payload/URL` (token đã
        // che). Chạy SAU DOMContentLoaded nên app.js/hls.js không bị ảnh
        // hưởng; mọi listener đặt ở capture phase và không preventDefault.
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.playerObserverJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        // [build 224] Player CHUẨN iOS (thay phim_player_ui.js đã xoá).
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.nativePlayerJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        // [build 228] CSS bố cục PHIM — TIÊM TỪ SWIFT (không phụ thuộc file).
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.layoutFixJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        webView = WKWebView(frame: .zero, configuration: configuration)
        #if DEBUG
        // Safari Web Inspector attach được vào webview (dev build).
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        webView.backgroundColor = .black
        super.init()
        // Đăng ký SAU super.init() (không dùng self trước super.init —
        // cùng bài học đã áp dụng cho MovieListView). Cùng 1
        // userContentController mà WKWebView đang dùng.
        configuration.userContentController.add(self, name: "phimBridge")
        configuration.userContentController.add(self, name: "phimConsole")
        // =================================================================
        // [build 231 — 2026-09-13] Message handler `playVideoNative`:
        // JS gửi { url: streamUrl, title, proxyUrl, referer, reason, session }
        // → userContentController(_:didReceive:) bên dưới → mở trình phát
        // GỐC (AVPlayerViewController) trong BinTV/Player/.
        // =================================================================
        configuration.userContentController.add(self, name: "playVideoNative")
        webView.navigationDelegate = self
        // Nối callback của native player về web app (evaluateJavaScript):
        // started / failed / closed — nhờ đó app.js thử nguồn kế tiếp,
        // hiện thông báo THẬT, hoặc dọn UI khi người dùng đóng player.
        configureNativePlayerCallbacks()
        // [build 224] Theo dõi app rời/vào lại foreground — phục hồi tab
        // PHIM khi WebContent process hoặc socket server bị hệ thống dừng.
        installLifecycleObservers()
        // Long-press (≥0.35s) = HIỆN MENU TAB — nhất quán 4 tab.
        // cancelsTouchesInView = false → tap / swipe / gesture video
        // HOÀN TOÀN không bị ảnh hưởng (cùng kỹ thuật long-press của TUBE).
        let menuGesture = UILongPressGestureRecognizer(
            target: self, action: #selector(handleMenuLongPress(_:))
        )
        menuGesture.minimumPressDuration = 0.35
        menuGesture.cancelsTouchesInView = false
        webView.addGestureRecognizer(menuGesture)
        // [2026-09-12] Đăng ký vào chuỗi Back toàn app (vuốt cạnh trái):
        // CHỈ xử lý khi webview thật sự còn lịch sử (canGoBack) — trả false
        // thì ContentView rơi tiếp xuống mức "root = không làm gì", không
        // bao giờ Back hụt hay thoát app. Không đụng logic tải/phát phim.
        BinTVBackRegistry.shared.register(tab: BinTVPage.phim.rawValue) { [weak self] in
            guard let wv = self?.webView, wv.canGoBack else { return false }
            wv.goBack()
            return true
        }
        PhimDebugLog.step("WEBVIEW", "controllerInit", "ok", "inline=true autoplay=all bridge=shimmed")
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

    private func loadPage() {
        guard let url = pageURL() else {
            PhimDebugLog.step("WEBVIEW", "loadPage", "FAIL", "không có port")
            failMessage = "Server Phim chưa có port."
            loadFailed = true
            return
        }
        PhimDebugLog.step("WEBVIEW", "loadPage", "begin", PhimDebugLog.sanitizeURL(url.absoluteString))
        loadFailed = false
        failMessage = ""
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
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
                    session: text(body.session)
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
            session: text("session")
        )
        PhimDebugLog.step("BRIDGE", "playVideoNative", "recv",
                          "title=\(request.logTitle) reason=\(request.reason.isEmpty ? "-" : request.reason) "
                          + "session=\(request.session.isEmpty ? "-" : request.session) "
                          + "url=\(PhimDebugLog.sanitizeURL(request.url)) "
                          + "proxy=\(PhimDebugLog.sanitizeURL(request.proxyURL))")
        let play = { [weak self] in self?.nativePlayer.play(request) }
        if Thread.isMainThread { play() } else { DispatchQueue.main.async(execute: play) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // [build 231] JS yêu cầu phát bằng TRÌNH PHÁT GỐC iOS (AVPlayer).
        if message.name == "playVideoNative" {
            handlePlayVideoNative(message.body)
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
    // [FIX 2026-09-13 — ROOT CAUSE "từ màn hình chính quay lại: tab PHIM
    //  ĐEN HOÀN TOÀN"]
    //
    // Ba cơ chế hệ thống xảy ra khi app ở nền, CÙNG cho kết quả "màn đen":
    //  (1) WebContent process của WKWebView bị kết thúc (jetsam / áp lực bộ
    //      nhớ). Delegate `webViewWebContentProcessDidTerminate` có reload,
    //      NHƯNG reload ngay LÚC ĐÓ thường KHÔNG hoàn tất vì app chưa active
    //      → quay lại chỉ còn layer đen, không tự phục hồi (đúng triệu chứng).
    //  (2) Socket của server nội bộ (127.0.0.1) bị ĐÓNG khi app ở nền → mọi
    //      reload/load sau đó thất bại (trang trắng/đen) dù webview còn sống.
    //  (3) Webview còn sống nhưng KHÔNG được vẽ lại sau khi app trở lại
    //      (render bị treo) → vẫn đen cho đến khi có một repaint.
    //
    // Sửa ĐÚNG NGUYÊN NHÂN theo từng cơ chế: hoãn reload tới khi app thật
    // sự active, đảm bảo server còn sống TRƯỚC khi reload, và ép vẽ lại +
    // kiểm tra DOM thật sự còn nội dung (không reload bừa nếu cache/trạng
    // thái vẫn dùng được).
    // =====================================================================

    private var lifecycleObservers: [NSObjectProtocol] = []

    /// Process bị kết thúc TRONG LÚC app ở nền → hoãn phục hồi tới foreground.
    private var pendingRestoreAfterBackground = false

    /// Watchdog: sau khi nạp lại, kiểm tra webview có THẬT SỰ vẽ không.
    private var recoveryWatchdog: DispatchWorkItem?
    /// Đã kết luận (đang vẽ) → không làm gì thêm.
    private var recoverySettled = false
    /// Đang trong một chu trình phục hồi (tránh chạy chồng: willEnterForeground
    /// + didBecomeActive + scenePhase đều có thể bắn cùng lúc).
    private var recoveryInProgress = false
    /// Số lần phục hồi trong một lượt foreground (chống lặp vô hạn).
    private var recoveryAttempts = 0
    /// Tối đa 3 lần: nạp lại → kiểm tra → nạp lại …
    private static let recoveryAttemptLimit = 3
    /// Chờ trang nạp xong trước khi kiểm tra có vẽ hay không.
    private static let paintCheckDelay: TimeInterval = 5

    /// Hộp cờ dùng chung cho các closure (tránh bắt biến var trong closure
    /// chạy trên nhiều hàng đợi).
    private final class FlagBox { var value = false }

    private func installLifecycleObservers() {
        let center = NotificationCenter.default
        let handler: (Notification) -> Void = { [weak self] _ in
            self?.handleAppDidReturnFromBackground()
        }
        lifecycleObservers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil, queue: .main, using: handler))
        lifecycleObservers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil, queue: .main, using: handler))
    }

    // ---------------------------------------------------------------------
    // App vừa trở lại foreground/active: PHẢI chứng minh webview còn sống và
    // đang VẼ, nếu không → nạp lại. Đây là điểm mấu chốt của bản 225:
    // ở bản 224, nếu `evaluateJavaScript` KHÔNG BAO GIỜ gọi về (process đã
    // chết / trang bị kẹt giữa chừng lúc ở nền) thì không có gì xảy ra cả →
    // màn hình đen vĩnh viễn đúng như máy thật. Nay mọi đường đều có hạn mức.
    // ---------------------------------------------------------------------
    /// [build 228] App vừa trở lại foreground — xử lý THEO ĐÚNG LIFECYCLE:
    /// không reload mù quáng. Quy trình: ép vẽ → **ĐO** trạng thái render
    /// thật của trang → chỉ can thiệp khi có bằng chứng (lưới trống / browser
    /// bị ẩn / webview không phản hồi), theo thứ tự từ nhẹ đến nặng:
    ///   1. gỡ class `player-active` (browser đang bị ẩn → nhìn như màn đen);
    ///   2. làm mới dữ liệu bằng CHÍNH luồng của web app (chọn lại danh mục)
    ///      — giữ nguyên mọi trạng thái, không reload;
    ///   3. nạp lại trang (bỏ cache) + kiểm tra server nội bộ;
    ///   4. bỏ cuộc → hiện overlay "Thử lại" thay vì để người dùng nhìn đen.
    private func handleAppDidReturnFromBackground() {
        guard started else { return }          // tab PHIM chưa từng mở → thôi
        guard !recoveryInProgress else { return }
        recoveryInProgress = true
        recoveryAttempts = 0
        // Khoá an toàn: luôn mở lại chu trình sau 40s (tránh kẹt).
        DispatchQueue.main.asyncAfter(deadline: .now() + 40) { [weak self] in
            self?.recoveryInProgress = false
        }
        // Bước 0: ép vẽ lại (rẻ, không mất trạng thái) rồi mới đo.
        repaintWebView()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.assessAndRecover()
        }
    }

    /// ĐỌC trạng thái render thật: số thẻ trong lưới · browser có bị ẩn
    /// (`player-active`) · browser có đang show · bề rộng lưới · dòng trạng
    /// thái. Đây là "bằng chứng" để quyết định bước xử lý tiếp theo.
    private func assessAndRecover() {
        let js = """
        (function(){
          try{
            var grid=document.getElementById('bintv-movie-grid');
            var cards=grid?grid.querySelectorAll('.movie-card').length:-1;
            var browser=document.getElementById('bintv-movie-browser');
            var shown=!!(browser&&browser.classList.contains('show'));
            var hidden=!!(browser&&browser.classList.contains('player-active'));
            var st=document.getElementById('bintv-movie-status');
            var status=(st&&st.textContent||'').slice(0,60);
            var w=grid?Math.round(grid.getBoundingClientRect().width):-1;
            return String(cards)+'|'+(shown?1:0)+'|'+(hidden?1:0)+'|'+String(w)+'|'+status;
          }catch(e){return 'ERR';}
        })()
        """
        let answered = FlagBox()
        webView.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            answered.value = true
            let text = (result as? String) ?? ""
            let parts = text.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            let cards = Int(parts.count > 0 ? parts[0] : "-1") ?? -1
            let shown = parts.count > 1 ? parts[1] == "1" : false
            let hidden = parts.count > 2 ? parts[2] == "1" : false
            let width = Int(parts.count > 3 ? parts[3] : "-1") ?? -1
            let status = parts.count > 4 ? parts[4] : ""
            PhimDebugLog.step("WEBVIEW", "assess", "ok",
                               "cards=\(cards) shown=\(shown) hidden=\(hidden) gridW=\(width) status=\(status)")
            if error != nil || text == "ERR" || cards < 0 {
                // Không đọc được trang = webview đã chết → nạp lại.
                self.reloadPage(reason: "không đọc được trạng thái trang (cards=\(cards))")
                return
            }
            if hidden {
                // (1) Browser đang bị ẨN bởi class player-active → gỡ lớp này
                // (đúng nguyên nhân, không cần nạp lại).
                self.webView.evaluateJavaScript(
                    "document.getElementById('bintv-movie-browser').classList.remove('player-active'); 'ok'"
                ) { _, _ in }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                    self?.reassessAfterFix()
                }
                return
            }
            if cards == 0 || !shown {
                // (2) LƯỚI TRỐNG / browser chưa show → đúng triệu chứng
                // "màn hình đen": làm mới bằng chính luồng của web app.
                self.softRefresh()
                return
            }
            // Có nội dung: chỉ cần chắc chắn nó đang được vẽ.
            self.verifyPainting()
        }
        // Webview chết thì evaluateJavaScript KHÔNG BAO GIỜ gọi về → hạn mức.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self, !answered.value else { return }
            self.reloadPage(reason: "webview không phản hồi khi đo trạng thái render")
        }
    }

    /// (2) Làm mới DỮ LIỆU bằng chính luồng của web app: bấm lại danh mục
    /// đang chọn → app.js render lại lưới. KHÔNG reload, KHÔNG mất trạng thái.
    private func softRefresh() {
        let js = """
        (function(){
          try{
            var row=document.querySelector('.movie-catalog-row.selected');
            if(row){ row.click(); return 'selected'; }
            var rows=document.querySelectorAll('.movie-catalog-row');
            if(rows.length){ rows[0].click(); return 'first'; }
            var btn=document.querySelector(".movie-filter-button[data-movie-filter='all']");
            if(btn){ btn.click(); return 'all'; }
            return 'no-target';
          }catch(e){return 'ERR';}
        })()
        """
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            PhimDebugLog.step("WEBVIEW", "softRefresh", "ok", (result as? String) ?? "?")
            // Chờ web app tải & render lại, rồi ĐO LẠI.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                self?.reassessAfterFix()
            }
        }
    }

    /// Đo lại SAU khi đã xử lý (gỡ player-active / làm mới danh mục):
    /// có thẻ phim → xong (không reload); vẫn trống → nạp lại trang.
    private func reassessAfterFix() {
        webView.evaluateJavaScript(
            "String(document.querySelectorAll('#bintv-movie-grid .movie-card').length)"
        ) { [weak self] value, _ in
            guard let self = self else { return }
            let cards = Int((value as? String) ?? "-1") ?? -1
            if cards > 0 {
                PhimDebugLog.step("WEBVIEW", "reassess", "ok", "đã render lại \(cards) thẻ — không cần nạp lại")
                self.repaintWebView()
                self.settleRecovery()
            } else {
                self.reloadPage(reason: "lưới vẫn trống sau khi làm mới (cards=\(cards))")
            }
        }
    }




    /// Bắt đầu một lượt kiểm tra có HẠN MỨC: watchdog 3s + thăm dò DOM +
    /// kiểm tra có thật sự vẽ khung hình hay không (requestAnimationFrame).


    /// Webview đã được chứng minh là sống & đang vẽ → huỷ watchdog.
    private func settleRecovery() {
        recoverySettled = true
        recoveryInProgress = false
        recoveryWatchdog?.cancel()
        recoveryWatchdog = nil
    }

    /// Socket nghe có thể bị hệ thống đóng lúc app ở nền → khởi lại nếu cần.
    private func ensureServerAlive() {
        let server = PhimLocalServer.shared
        self.server = server
        guard server.port <= 0 else { return }
        PhimDebugLog.step("SERVER", "restartOnForeground", "begin", "port=0 (socket bị đóng khi ở nền)")
        server.onPortReady = { [weak self] port in
            PhimDebugLog.step("SERVER", "restartOnForeground", "ok", "port=\(port)")
            self?.loadPage()
        }
        server.onPortFailed = { [weak self] message in
            PhimDebugLog.step("SERVER", "restartOnForeground", "FAIL", message)
            self?.failMessage = message
            self?.loadFailed = true
        }
        server.start()
        armServerTimeout()
    }

    /// Ép WKWebView vẽ lại (rẻ, không reload, không mất trạng thái).
    private func repaintWebView() {
        webView.setNeedsLayout()
        webView.setNeedsDisplay()
        // Nudge scroll 1px: kỹ thuật bắt WebKit vẽ lại khung hình khi webview
        // bị "treo" sau khi app ở nền (không đổi nội dung, không mất trạng thái).
        let offset = webView.scrollView.contentOffset
        webView.scrollView.setContentOffset(CGPoint(x: offset.x, y: offset.y + 1), animated: false)
        webView.scrollView.setContentOffset(offset, animated: false)
    }

    /// Hỏi thăm DOM: nếu webview trống/không phản hồi → nạp lại; nếu còn nội
    /// dung → kiểm tra tiếp xem có THẬT SỰ vẽ hay không.


    /// Chứng minh webview THẬT SỰ đang vẽ: đếm khung hình bằng
    /// `requestAnimationFrame` — rAF CHỈ chạy khi WebKit còn render, nên
    /// "DOM còn sống mà không vẽ" (= màn hình đen) mới bị phát hiện.
    ///
    /// Dùng 2 bước `evaluateJavaScript` (API có từ iOS 8, chắc chắn đúng chữ
    /// ký) thay vì `callAsyncJavaScript`: đặt bộ đếm → đọc lại sau 900ms.
    private func verifyPainting() {
        // Bước 1: gắn bộ đếm khung hình (tự dừng sau 5 khung).
        let install = """
        window.__bintvPaint = 0;
        (function tick() {
            window.__bintvPaint = (window.__bintvPaint || 0) + 1;
            if (window.__bintvPaint < 5) { requestAnimationFrame(tick); }
        })();
        """
        webView.evaluateJavaScript(install) { [weak self] _, _ in
            guard let self = self else { return }
            // Bước 2: đọc lại sau 900ms — nếu WebKit đang vẽ, bộ đếm đã tăng.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                guard let self = self else { return }
                guard !self.recoverySettled else { return }
                self.webView.evaluateJavaScript("String(window.__bintvPaint || 0)") { [weak self] value, error in
                    guard let self = self else { return }
                    guard !self.recoverySettled else { return }
                    let frames = Int((value as? String) ?? "") ?? 0
                    if error == nil && frames >= 2 {
                        // Đang vẽ bình thường → giữ nguyên, KHÔNG reload.
                        self.settleRecovery()
                    } else {
                        self.reloadPage(reason: "không có khung hình nào được vẽ (rAF không chạy, frames=\(frames)) sau khi ở nền")
                    }
                }
            }
        }
    }

    /// Nạp lại TRANG (không reload bừa): webview mất cả URL → load lại từ
    /// server; còn URL → reload (giữ localStorage, khôi phục nhanh).
    /// Nạp lại TRANG — BỎ QUA CACHE, có kiểm tra server và leo thang.
    private func reloadPage(reason: String) {
        guard recoveryAttempts < Self.recoveryAttemptLimit else {
            // Hết cách tự cứu: hiện overlay lỗi + nút "Thử lại" thay vì để
            // người dùng nhìn mãi màn hình đen.
            recoveryWatchdog?.cancel()
            recoveryWatchdog = nil
            recoveryInProgress = false
            PhimDebugLog.step("WEBVIEW", "foregroundRestore", "GIVEUP",
                               "đã thử \(recoveryAttempts) lần — hiện nút Thử lại")
            failMessage = "Không tự khôi phục được trang Phim sau khi ứng dụng ở nền."
            loadFailed = true
            return
        }
        recoveryAttempts += 1
        recoveryWatchdog?.cancel()
        PhimDebugLog.step("WEBVIEW", "foregroundRestore", "RELOAD", reason)
        // (1) Server nội bộ còn phục vụ không? (socket có thể bị đóng lúc ở nền)
        checkServerHealth { [weak self] healthy in
            guard let self = self else { return }
            if healthy {
                self.hardLoad()
            } else {
                // (2) Server im lặng → nối lại listener rồi nạp lại.
                PhimDebugLog.step("SERVER", "health", "FAIL", "server nội bộ không phản hồi → nối lại listener")
                PhimLocalServer.shared.relaunchListenerIfDead()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                    self?.hardLoad()
                }
            }
        }
    }

    /// Nạp lại THẬT SỰ: yêu cầu **bỏ qua toàn bộ cache** — index.html/CSS/JS
    /// cũ đang bị cache cũng là một nguyên nhân khiến giao diện không đổi.
    private func hardLoad() {
        guard let url = pageURL() else { ensureServerAlive(); return }
        var request = URLRequest(url: url,
                                 cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                                 timeoutInterval: 30)
        webView.load(request)
        // Sau khi trang kịp nạp (5s) → ĐO LẠI TRẠNG THÁI RENDER
        // (có thẻ phim? browser có bị ẩn?) — không chỉ đếm khung hình.
        let watchdog = DispatchWorkItem { [weak self] in
            self?.assessAndRecover()
        }
        recoveryWatchdog = watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.paintCheckDelay,
                                      execute: watchdog)
    }

    /// Hỏi `/health` của server nội bộ (nhanh, 1.2s) — quyết định có cần nối
    /// lại listener trước khi nạp lại trang hay không.
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
    // Navigation delegate — lỗi main frame → overlay "Thử lại"
    // =====================================================================

    // ---------------------------------------------------------------------
    // [FIX 2026-09-12 — ROOT CAUSE "tab PHIM màn hình đen khi quay lại"]
    // Khi người dùng rời tab PHIM, WKWebView bị tháo khỏi window; dưới áp
    // lực bộ nhớ hệ thống CÓ THỂ chấm dứt WebContent process của nó. Mặc
    // định WKWebView khi đó chỉ còn layer ĐEN TRỐNG và KHÔNG tự khôi phục
    // — bản trước không implement delegate này nên quay lại tab PHIM là
    // đen vĩnh viễn (đúng triệu chứng người dùng báo: mất trạng thái hiển
    // thị, màn hình đen hoàn toàn). Đây là cơ chế khôi phục CHÍNH THỨC của
    // Apple: reload khi process chết. localStorage (websiteDataStore
    // .default) vẫn còn nên bootstrap/catalog cache của app.js sống sót —
    // reload phục hồi nhanh, KHÔNG phải tải nguội.
    // Quan trọng: chỉ reload KHI process thật sự chết — mọi lần chuyển tab
    // bình thường KHÔNG hề reload (giữ nguyên trạng thái đang xem, đúng
    // yêu cầu "ưu tiên giữ lại trạng thái PHIM").
    // ---------------------------------------------------------------------
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        PhimDebugLog.step("WEBVIEW", "webContentProcessDidTerminate", "RELOAD",
                           "WebContent process bị hệ thống kết thúc — reload phục hồi")
        // [build 224] App đang Ở NỀN: reload lúc này thường KHÔNG hoàn tất
        // (và chính là nguyên nhân quay lại chỉ thấy màn đen) → đánh dấu và
        // phục hồi khi app thật sự trở lại foreground.
        if UIApplication.shared.applicationState == .active {
            webView.reload()
        } else {
            pendingRestoreAfterBackground = true
        }
    }

    /// [2026-09-12] Gọi khi tab PHIM hiện trở lại: yêu cầu WKWebView vẽ lại
    /// layer (setNeedsDisplay) để tránh khung hình stale/tối — hoàn toàn
    /// KHÔNG reload, không mất trạng thái (chỉ đánh dấu cần vẽ).
    /// Kèm theo safety-net `restoreIfEmpty()`: chỉ nạp lại trang khi
    /// webview thật sự trống (bị giải phóng/chưa có nội dung) — đúng yêu
    /// cầu "nếu view bị giải phóng thì phải khôi phục đúng cách", nhưng
    /// KHÔNG reload khi cache/trạng thái hiện tại vẫn dùng được.
    func noteTabDidAppear() {
        webView.setNeedsDisplay()
        restoreIfEmpty()
    }

    /// Số lần đã thử nạp lại trang trống (chống vòng lặp reload vô hạn).
    private var restoreAttempts = 0

    /// Safety net CHỈ KHI CẦN: webview không có nội dung (`url == nil`,
    /// không đang tải) mà server nội bộ đã sẵn sàng → nạp lại đúng trang.
    /// Tối đa 3 lần; reset khi một trang đã tải xong (`didFinish`) →
    /// chuyển tab bình thường KHÔNG BAO GIỜ reload (giữ nguyên trạng thái
    /// phim đang xem, đúng yêu cầu "ưu tiên giữ lại trạng thái PHIM").
    private func restoreIfEmpty() {
        guard restoreAttempts < 3 else { return }
        guard !webView.isLoading else { return }
        guard webView.url == nil else { return }
        let port = server?.port ?? PhimLocalServer.shared.port
        guard port > 0 else { return }
        restoreAttempts += 1
        PhimDebugLog.step("WEBVIEW", "restoreIfEmpty", "RELOAD",
                          "webview trống — nạp lại trang (lần \(restoreAttempts))")
        loadPage()
    }

    /// Page load xong → inject lại chiều cao status bar (rotation có thể
    /// đổi giá trị giữa các lần load).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        PhimDebugLog.step("WEBVIEW", "didFinishNavigation", "ok", PhimDebugLog.sanitizeURL(webView.url?.absoluteString ?? ""))
        // Trang đã tải xong → webview có nội dung thật: reset bộ đếm
        // khôi phục (không reload bừa ở những lần chuyển tab kế tiếp).
        restoreAttempts = 0
        injectStatusBarInset()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        PhimDebugLog.step("WEBVIEW", "didFailNavigation", "FAIL", error.localizedDescription)
        DispatchQueue.main.async {
            self.failMessage = error.localizedDescription
            self.loadFailed = true
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        PhimDebugLog.step("WEBVIEW", "didFailProvisionalNavigation", "FAIL", error.localizedDescription)
        DispatchQueue.main.async {
            self.failMessage = error.localizedDescription
            self.loadFailed = true
        }
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

private struct PhimWebViewContainer: UIViewRepresentable {
    let controller: PhimController
    let onLongPress: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        controller.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Webview do controller sở hữu trọn vẹn (1 instance duy nhất).
        // Cập nhật callback long-press (nội dung có thể thay đổi).
        controller.onLongPress = onLongPress
        // Re-inject chiều cao status bar thật sau mỗi layout pass (xoay
        // màn hình / thay đổi kích thước → giá trị an toàn mới).
        controller.injectStatusBarInsetPublic()
    }
}
