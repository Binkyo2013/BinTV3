/* [BinTV iOS 2026-09] phim_ios_fallback.js - FALLBACK PHÁT TRỰC TIẾP CHO iOS.
 *
 * CHỈ HOẠT ĐỘNG TRÊN iOS WEBKIT: điều kiện bật = KHÔNG có MSE
 * (Hls.isSupported() === false — WebKit không hỗ trợ) + <video> native
 * hỗ trợ HLS (canPlayType('application/vnd.apple.mpegurl')).
 *
 * TRÊN ANDROID (Chromium: có MSE → Hls.isSupported() === true) script
 * này RETURN NGAY — KHÔNG ảnh hưởng gì đến bản Android đang chạy tốt.
 *
 * VÌ SAO CẦN:
 *   Trên iOS, hls.js không chạy (không có MSE) → .m3u8/.mp4 phát bằng
 *   <video> native WebKit, URL được bọc qua /proxy (proxy forward
 *   Referer/UA/DoH để nguồn chấp nhận). Nếu proxy/URLSession/DoH gặp
 *   trục trặc (mạng, TLS, source không tương thích cách fetch của
 *   URLSession) → video.onerror → không phát. Trong khi NHIỀU CDN cho
 *   phép phát TRỰC TIẾP (https, không validate khắt khe UA/Referer,
 *   media element không cần CORS) — WebKit fetch thẳng là OK.
 *
 * CƠ CHẾ (đúng quy tắc "không né nguồn, không đổi URL gốc"):
 *   1. Nghe event 'error' trên #bintv-movie-html5-player.
 *   2. Nếu src hiện tại là route /proxy?url=<enc> SAME-ORIGIN (127.0.0.1
 *      của server Phim) và CHƯA retry src này → decode URL GỐC.
 *   3. URL gốc là https → set video.src = URL GỐC (phát trực tiếp, bỏ
 *      proxy) + play(). (http:// gốc: KHÔNG thử direct — bị ATS chặn trừ
 *      exception host; ghi log để phân loại.)
 *   4. Log MỌI thứ ra console → phim_debug.log (console capture sẵn có):
 *      error code, src proxy, URL gốc, kết quả retry.
 *   5. Retry chỉ 1 lần trên MỖI src proxy; nếu direct cũng fail → để
 *      app.js xử lý (thử stream fallback kế tiếp / hiện lỗi) — không
 *      loop vô hạn, không giả mạo thành công.
 *   6. stopImmediatePropagation CHỈ khi thực sự swap sang direct (để
 *      app.js không stopMoviePlayback giữa chừng lần retry); mọi error
 *      khác propagation bình thường như bản gốc.
 *   7. [build 231 — 2026-09-13] LEO THANG CUỐI: src proxy fail + src direct
 *      cũng fail (cùng 1 src, lần error thứ 2) → gọi
 *      window.__bintvRequestNativePlayback("ios-fallback-error") — app.js
 *      gửi streamUrl sang Swift qua WKScriptMessageHandler `playVideoNative`
 *      để mở AVPlayerViewController (BinTV/Player/PhimNativePlayerController.swift).
 *      Đây là chỗ thay thế nhánh fallback "Không thể phát … trên TV" trên
 *      iPhone. Mỗi src chỉ handoff 1 lần (cờ __iosNativeTriedFor, reset khi
 *      'emptied'); khi đã handoff thì stopImmediatePropagation để app.js
 *      không đổi src giữa chừng. KHÔNG có handler (Android/Tizen/Windows)
 *      → trả về false → hành vi cũ giữ nguyên 100%.
 */
(function () {
    "use strict";

    function log(level) {
        try {
            var args = Array.prototype.slice.call(arguments, 1);
            var fn = (window.console && (console[level] || console.log)) || function () {};
            fn.apply(console, ["[IOS-FALLBACK]"].concat(args));
        } catch (e) {}
    }

    function isIosNativeHlsOnly() {
        try {
            var hasMse = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported());
            var canNativeHls = false;
            try { canNativeHls = !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"); } catch (e2) {}
            // iOS: KHÔNG MSE + native HLS hỗ trợ. Android: có MSE → false.
            return !hasMse && canNativeHls;
        } catch (e3) { return false; }
    }

    if (!isIosNativeHlsOnly()) return;

    function decodeProxyOriginal(src) {
        try {
            var m = String(src || "").match(/\/proxy\?url=([^&]+)/);
            if (!m || !m[1]) return "";
            return decodeURIComponent(m[1]);
        } catch (e) { return ""; }
    }

    function init() {
        var video = document.getElementById("bintv-movie-html5-player");
        if (!video) return;
        video.__iosFallbackTriedFor = "";
        video.__iosNativeTriedFor = "";

        // startMoviePlayback/stopMoviePlayback gọi load() → 'emptied'
        // → reset cờ retry (mở phim mới / episode mới được phép retry lại).
        video.addEventListener("emptied", function () {
            video.__iosFallbackTriedFor = "";
            video.__iosNativeTriedFor = "";
        });

        // Chẩn đoán trạng thái mạng của media element (proxy chậm/trở
        // nên stall sẽ hiện ở đây trong phim_debug.log).
        video.addEventListener("stalled", function () {
            log("stalled", { networkState: video.networkState, src: String(video.currentSrc || "").substring(0, 140) });
        });
        video.addEventListener("waiting", function () {
            log("waiting (buffering)", { networkState: video.networkState });
        });

        video.addEventListener("error", function (event) {
            try {
                var err = video.error;
                var src = String(video.currentSrc || video.src || "");
                log("error", { code: err && err.code, msg: err && err.message, src: src.substring(0, 200) });

                // Đã retry src này (trước đó) → không lặp lại.
                if (video.__iosFallbackTriedFor === src) {
                    // =====================================================
                    // [BinTV build 231 — 2026-09-13] LEO THANG CUỐI CÙNG:
                    // proxy fail → direct cũng fail = WebKit KHÔNG phát được
                    // nguồn này (thường do container MKV / audio AC3/EAC3/DTS).
                    // Trước đây app.js rơi vào nhánh fallback TV và hiện
                    // "Không thể phát nguồn phim này trên TV". Nay chuyển
                    // streamUrl sang Swift (WKScriptMessageHandler
                    // `playVideoNative`) để mở AVPlayerViewController —
                    // trình phát GỐC của iOS, engine AVFoundation giải mã
                    // rộng hơn HTML5 của WebKit.
                    // `window.__bintvRequestNativePlayback` do app.js expose;
                    // chỉ tồn tại trong WKWebView iOS → Android KHÔNG ảnh hưởng.
                    // =====================================================
                    if (video.__iosNativeTriedFor !== src) {
                        video.__iosNativeTriedFor = src;
                        var handedOff = false;
                        try {
                            handedOff = (typeof window.__bintvRequestNativePlayback === "function")
                                && window.__bintvRequestNativePlayback("ios-fallback-error") === true;
                        } catch (nativeError) { handedOff = false; }
                        log("src failed twice → native handoff:", handedOff ? "SENT" : "unavailable");
                        if (handedOff && event && typeof event.stopImmediatePropagation === "function") {
                            // Chặn app.js onerror cho event NÀY: tránh app.js
                            // chạy tiếp fallback web (đổi src) trong lúc
                            // AVPlayer native đang mở chính nguồn đó.
                            event.stopImmediatePropagation();
                        }
                    }
                    return;
                }
                var original = decodeProxyOriginal(src);
                if (!original) return; // không phải route proxy → app.js xử lý

                if (original.indexOf("http://") === 0) {
                    // http:// gốc: phát direct bị iOS ATS chặn (trừ exception
                    // host đã khai báo) — proxy (RawHttp) là đường duy nhất
                    // hợp lệ cho source http. Ghi log để phân loại rõ.
                    log("no direct fallback for http source (ATS) — proxy path only",
                        original.substring(0, 160));
                    video.__iosFallbackTriedFor = src;
                    return;
                }
                if (original.indexOf("https://") !== 0) return;

                // === RETRY TRỰC TIẾP (không proxy) — 1 lần cho src này ===
                log("retrying DIRECT (bypass proxy):", original.substring(0, 200));
                video.__iosFallbackTriedFor = src;
                // CHặn app.js onerror cho event error NÀY (tránh stopMoviePlayback
                // hủy lần retry); các error khác propagate bình thường.
                if (event && typeof event.stopImmediatePropagation === "function") {
                    event.stopImmediatePropagation();
                }
                try {
                    video.src = original;
                    video.load();
                    var p = video.play();
                    if (p && typeof p.catch === "function") {
                        p.catch(function (e) {
                            log("direct play() rejected:", e && e.name, e && e.message);
                        });
                    }
                } catch (e2) {
                    log("direct retry threw:", e2 && e2.message);
                }
            } catch (e3) {
                log("fallback handler error:", e3 && e3.message);
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
