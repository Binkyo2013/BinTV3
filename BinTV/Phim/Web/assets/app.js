(function () {
    "use strict";
    // [Phim DEBUG 2026-09] Version marker - log NGAY khi file nay duoc load
    // de xac nhan user dang chay phien ban moi nhat.
    try { console.log("[Phim APP.JS] Version 2026-09-03p loaded, __BINTV_PHIM_STANDALONE__=", window.__BINTV_PHIM_STANDALONE__); } catch (e) {}
    // [Phim LAN14-fix 2026-09] Debug helper. KHONG override __phimDebug tu
    // preload (preload exposeInMainWorld da setup san IPC forward). Chi tao
    // fallback neu preload chua expose (vd chay ngoai Electron).
    if (!window.__phimDebug) {
        try {
            window.__phimDebug = {
                log: function () { try { console.log.apply(console, ["[Phim]"].concat(Array.prototype.slice.call(arguments))); } catch (e) {} },
                warn: function () { try { console.warn.apply(console, ["[Phim]"].concat(Array.prototype.slice.call(arguments))); } catch (e) {} },
                error: function () { try { console.error.apply(console, ["[Phim]"].concat(Array.prototype.slice.call(arguments))); } catch (e) {} }
            };
        } catch (e) {}
    }
    // [Phim LAN14-fix 2026-09] Phim-debug helper: prefix [PHIM] cho moi log
    // lien quan den load danh sach phim (de grep trong phim-debug.log).
    function phimLog() {
        try {
            var msg = "[PHIM] " + Array.prototype.slice.call(arguments).map(function (a) {
                if (typeof a === "string") return a;
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(" ");
            if (window.__phimDebug && window.__phimDebug.log) window.__phimDebug.log(msg);
            else console.log(msg);
        } catch (e) {}
    }
    window.__phimLog = phimLog;

    /* =====================================================
       BinTV - APP.JS
       - Cập nhật bố cục thời tiết: Icon + Nhiệt độ (ngang), Mô tả (dưới).
       ===================================================== */

    // [BinTV JVHD-STANDALONE 2026-08] Khi index.html khai báo
    // window.__BINTV_JVHD_STANDALONE__ = true (bản APK JVHD độc lập), ứng dụng
    // khởi động thẳng vào JVHD thay vì màn launcher. Mọi nhánh dưới đây đều
    // khóa bằng flag này - khi flag không được set (APK BinTV gốc), toàn bộ
    // hành vi của BinTV giữ nguyên 100%.
    var BINTV_JVHD_STANDALONE = !!window.__BINTV_JVHD_STANDALONE__;

    var apps = [];
    var installedApps = [];
    var buttons = [];
    var index = 0;

    var appsContainer = document.getElementById("apps");
    var backgroundLayer = document.getElementById("bg");

    var TEST_MODE = !(window.tizen && tizen.application);

    var APP_ORDER_KEY = "bintv_app_order";
    var HIDDEN_APPS_KEY = "bintv_hidden_apps";
    var FAVORITE_APPS_KEY = "bintv_favorite_apps";
    var AUTO_FAVORITE_DISABLED_KEY = "bintv_auto_favorite_disabled";
    var SORT_MODE_KEY = "bintv_sort_mode";

    var BUILTIN_MOVIE_APP_ID = "bintv.movie";
    var MOVIE_CONFIG_URL = "https://api.jsonbin.io/v3/b/6a81965cda38895dfeeb049e";

    // [BinTV] JVHD - ứng dụng nguồn web thứ hai (cạnh Phim), có màn hình riêng.
    var BUILTIN_JVHD_APP_ID = "bintv.jvhd";
    var JVHD_CONFIG_URL = "https://api.jsonbin.io/v3/b/6a8ae66cf5f4af5e29385160";
    var JVHD_REQUEST_TIMEOUT = 12000;
    var JVHD_RESOLVE_TIMEOUT = 32000;
    var JVHD_MAX_RESOLVE_PAGES = 8;
    var JVHD_DEFAULT_PIN = "1994";
    var jvhdLaunchInProgress = false;
    var jvhdPinOpen = false;
    var jvhdPinValue = "";
    var jvhdPinFocusIndex = 0;
    var jvhdPinAttemptToken = 0;
    var jvhdPinAuthorized = false;
    var jvhdPinConfigPending = false;
    var jvhdPinSources = [];
    var jvhdPinConfigError = null;
    // [BinTV USER-AUTH 2026-08] Xac thuc Username sau PIN dung (bao mat lai):
    // hash SHA-256(username + SALT) chi duoc tinh trong native lib qua
    // AndroidBridge; danh sach hash tai tu JSONBin; 3 lan sai lien tiep ->
    // khoa 3 phut theo thoi gian thuc (localStorage, reload khong reset).
    var jvhdUserGateOpen = false;
    var jvhdUserChecking = false;
    var jvhdUserCountdownTimer = null;
    var JVHD_USER_HASH_URL = "https://api.jsonbin.io/v3/b/6a9245b5f5f4af5e29504b20";
    var JVHD_USER_FAIL_LIMIT = 3;
    var JVHD_USER_LOCK_MS = 180000;
    var jvhdScreenOpen = false;
    var jvhdSources = [];
    var jvhdActiveSource = 0;
    var jvhdAllItems = [];
    var jvhdGridIndex = 0;
    var jvhdFocusArea = "sidebar";   // "sidebar" | "grid"
    var jvhdLoading = false;
    var jvhdSourceLoadToken = 0;
    var jvhdResolveToken = 0;
    var jvhdResolveInProgress = false;
    var jvhdResolveRequest = null;
    var jvhdPlayerSession = false;
    var jvhdPlaybackQueue = [];
    // [BinTV FIX 2026-08] LIVE (stripchat): phiên phát dùng URL master m3u8 đã kèm
    // pkey hợp lệ của CDN -> phát trực tiếp bằng hls.js (CORS *), không bọc proxy.
    var jvhdPlaybackUseDirectUrl = false;
    var jvhdPlaybackFallbacks = [];
    var jvhdPlaybackQualities = {};
    var jvhdCurrentQuality = "720";
    var jvhdQualitySelectorOpen = false;
    var jvhdQualitySelectorIndex = 0;
    var jvhdQualitySwitching = false;
    var jvhdQualitySwitchSerial = 0;
    var jvhdQualitySwitchCleanup = null;
    // [BinTV QUALITY 2026-08] Tu dong phat hien TAT CA cac muc chat luong that
    // cua nguon video/live (HLS master playlist, hls.js levels...) thay vi chi
    // hard-code 720/1080 nhu truoc.
    var jvhdQualityMasterUrl = "";      // URL master (che do Auto) dang phat duoc
    var jvhdQualityHlsLevels = null;    // [{height, index}] lay tu hls.js levels (LIVE)
    var jvhdQualityProbeSerial = 0;     // huy ket qua doc manifest cu khi doi video
    var jvhdQualityRenderedKey = "";    // cache danh sach option da render trong UI
    var jvhdPlaybackIndex = -1;
    var jvhdPlaybackTransitioning = false;
    var jvhdReturnScrollTop = 0;
    var jvhdSelectedItem = null;

    var MOVIE_REQUEST_TIMEOUT = 10000;
    var MOVIE_SCRUB_HOLD_DELAY = 280;
    var MOVIE_SCRUB_TICK_INTERVAL = 250;
    var MOVIE_SCRUB_RELEASE_FALLBACK = 450;
    var MOVIE_CLASSIFICATION_TIMEOUT = 6000;
    var MOVIE_CLASSIFICATION_CONCURRENCY = 8;
    var MOVIE_CATALOG_SCAN_CONCURRENCY = 6;
    var MOVIE_MERGED_CATALOG_CONCURRENCY = 4;
    var MOVIE_CATALOG_CACHE_TTL = 20 * 60 * 1000;
    var MOVIE_CATALOG_BACKGROUND_REFRESH_AGE = 5 * 60 * 1000;
    var MOVIE_CATALOG_CACHE_STALE_MAX = 7 * 24 * 60 * 60 * 1000;
    var MOVIE_PREFETCH_DELAY = 1600;
    var MOVIE_PREFETCH_CONCURRENCY = 4;
    var MOVIE_PREFETCH_PRIORITY_PER_TYPE = 4;
    var MOVIE_CACHE_VERSION = "v4";
    var MOVIE_SEARCH_CONCURRENCY = 6;
    var MOVIE_SEARCH_MAX_RESULTS = 72;
    var MOVIE_BRAND_FILTER_CONCURRENCY = 6;
    var MOVIE_BRAND_FILTER_MAX_CANDIDATES = 240;
    var MOVIE_TV_VALIDATION_CONCURRENCY = 5;
    var MOVIE_TV_VALIDATION_TIMEOUT = 4500;
    var MOVIE_TV_VALIDATION_TTL = 2 * 60 * 1000;
    var MOVIE_SUBTITLE_SOURCES = [
        { name: "OpenSubtitles", manifestUrl: "https://opensubtitles-v3.strem.io/manifest.json", maxAttempts: 1, acceptAllLanguages: false }
    ];
    var MOVIE_SUBTITLE_TIMEOUT = 8000;
    var MOVIE_SUBTITLE_MENU_TIMEOUT = 8000;
    var MOVIE_FILTER_MENU_OPTIONS = [
        { mode: "all", label: "Tất cả" },
        { mode: "vietnam", label: "Việt Nam" },
        { mode: "narrated", label: "Thuyết Minh" },
        { mode: "china", label: "Trung Quốc" },
        { mode: "korea", label: "Hàn Quốc" },
        { mode: "western", label: "Âu Mỹ" },
        { mode: "marvel", label: "Mavel" }
    ];
    var MOVIE_CINEMETA_URL = "https://v3-cinemeta.strem.io";

    var isMovingApp = false;
    var isMultiSelectMode = false;
    var selectedAppIds = {};
    var actionMenuOpen = false;
    var movieLaunchInProgress = false;
    var movieBrowserOpen = false;
    var moviePlayerOpen = false;
    var movieEpisodeOpen = false;
    var moviePlayerPaused = false;
    var moviePlayerUsingAVPlay = false;
    var movieScrubHoldTimer = null;
    var movieScrubTickTimer = null;
    var movieScrubReleaseTimer = null;
    var movieScrubKeyDown = false;
    var movieScrubDirection = 0;
    var movieScrubRepeatSeen = false;
    var movieScrubPressStartedAt = 0;
    var movieScrubOriginMilliseconds = -1;
    var movieScrubTargetMilliseconds = -1;
    var movieScrubDurationMilliseconds = 0;
    var movieScrubMoved = false;
    var movieLastKnownPlaybackMilliseconds = 0;
    var moviePlaybackClockMilliseconds = 0;
    var moviePlaybackClockStartedAt = 0;
    var moviePlaybackClockRunning = false;
    var moviePlaybackReportedTimeScale = 0;
    var moviePlaybackLastRawTime = -1;
    var moviePlaybackLastRawAt = 0;
    var movieSeekTimelineHideTimer = null;
    var movieSeekTimelineVisible = false;
    var movieSeekInProgress = false;
    var movieSeekActiveTargetMilliseconds = -1;
    var moviePendingSeekTargetMilliseconds = -1;
    var movieSeekOperationSerial = 0;
    var movieSeekFailureHandler = null;
    var movieSeekCancelOperation = null;
    var movieSeekErrorGraceUntil = 0;
    var moviePlayerEpisodeMenuOpen = false;
    var moviePlayerEpisodeIndex = 0;
    var movieCurrentEpisodeIndex = -1;
    var moviePlayerEpisodeSwitchInProgress = false;
    var movieManifestUrl = "";
    var movieBaseUrl = "";
    // [build 229] DANH SÁCH ADDON STREMIO ĐANG DÙNG (từ JSONBin:
    // target_urls / target_url). Mỗi phần tử: {baseUrl, manifest, name, id}.
    // movieBaseUrl vẫn giữ = addon đầu tiên (tương thích ngược toàn bộ code cũ).
    var movieAddons = [];
    var movieManifest = null;
    var movieCatalogs = [];
    var movieAllCatalogs = [];
    var movieCatalogDataCache = {};
    var movieProcessedCatalogCache = {};
    var movieFilterResultCache = {};
    var movieCatalogRequestInFlight = {};
    var movieMetaRequestInFlight = {};
    var movieStreamRequestInFlight = {};
    var movieTvStreamValidationCache = {};
    var movieTvPlaybackFallback = null;
    // [Phim standalone 2026-09] Fallback cho phim thuong (khong phai TV):
    // mot so nguon (sc.k-20.xyz) tra ve key/hash co TTL ngan, neu user click
    // phim qua nhieu phut, key het han -> playback fail. Khi do, tu dong
    // thu stream tiep theo trong danh sach streams[] (thuong co 3-5 nguon).
    var movieStreamFallback = null;
    // =================================================================
    // [BinTV iOS build 231 — 2026-09-13] NATIVE HANDOFF CHO iOS WKWEBVIEW
    //
    // Trên iPhone, thẻ <video> HTML5 của WebKit KHÔNG giải mã được nhiều
    // nguồn Stremio addon (vnstream/viptorrent/vimo/sc.k-20…) khi chúng là
    // container MKV hoặc audio AC3/EAC3/DTS → video.onerror → app.js hết
    // nguồn dự phòng → rơi vào nhánh fallback dành cho TV và hiện
    // "Không thể phát nguồn phim này trên TV" (trong khi Android/Windows/
    // Tizen phát bình thường cùng nguồn đó).
    //
    // Sửa ĐÚNG NGUYÊN NHÂN, KHÔNG phá bản Android/Tizen/Windows:
    //   • Khi chạy TRONG WKWebView của BinTV iOS (phát hiện bằng
    //     `window.webkit.messageHandlers.playVideoNative` — chỉ tồn tại
    //     trên iOS), app.js gửi `streamUrl` sang Swift qua message handler
    //     `playVideoNative`; Swift mở AVPlayerViewController (trình phát
    //     GỐC của iOS, engine AVFoundation giải mã rộng hơn HTML5) —
    //     xem BinTV/Player/PhimNativePlayerController.swift.
    //   • NHÁNH TV/EXTERNAL PLAYER (webapis.avplay của Tizen, mở app ngoài)
    //     bị VÔ HIỆU HOÁ khi chạy trên iOS WKWebView.
    //   • Trên Android/Tizen/Windows: KHÔNG có handler đó → mọi hàm dưới
    //     đây trả false → hành vi cũ GIỮ NGUYÊN 100%.
    // =================================================================
    // Id phiên phát — tăng mỗi lần startMoviePlayback. Native echo lại để
    // JS bỏ qua callback cũ (người dùng đã chuyển phim/tập khác).
    var movieNativePlaybackSession = 0;
    // Đã gửi nguồn hiện tại sang native và đang chờ kết quả.
    var movieNativeHandoffActive = false;
    // Các URL đã thử bằng native trong phiên (chống gửi lặp cùng 1 nguồn).
    var movieNativeHandoffUrls = {};
    // Số lần handoff của phiên hiện tại (chống loop JS ↔ native vô hạn).
    var movieNativeHandoffCount = 0;
    // Trần handoff cho MỘT phiên phát (mỗi nguồn chỉ thử native 1 lần).
    var MOVIE_NATIVE_HANDOFF_MAX = 3;
    // Nguồn đang phát: URL GỐC (addon trả về) + URL đã bọc /proxy + Referer.
    var movieCurrentStreamUrl = "";
    var movieCurrentStreamProxyUrl = "";
    var movieCurrentStreamReferer = "";
    var movieCurrentStreamTitle = "";
    var movieCurrentStreamInfo = null;
    // Nguồn XẾP HẠNG CAO NHẤT của phiên phát hiện tại (validStreams[0]) —
    // khi mọi nguồn web đều lỗi thì native thử nguồn tốt nhất này.
    var movieNativeSessionPrimaryUrl = "";
    // =================================================================
    // [BinTV iOS build 233 — 2026-09-14] LUỒNG KẾT THÚC PHÁT (phim bộ/lẻ)
    //   • Phim BỘ: tập phát hết → tự động chuyển sang tập tiếp theo; người
    //     dùng đóng trình phát → quay về giao diện CHỌN TẬP.
    //   • Phim LẺ: phát hết hoặc đóng trình phát → quay về giao diện PHIM.
    //   • Trình phát native (AVPlayerViewController) KHÔNG được treo: hết
    //     tập là phải chuyển hoặc đóng (Swift có backstop tự đóng khi JS
    //     im lặng — xem PhimNativePlayerController.swift).
    // moviePreferNativePlayer: [build 234] chỉ còn là CỜ CHẨN ĐOÁN "trình
    // phát iOS đang là player hiển thị" (được đặt khi handoff thành công, hạ
    // khi player đóng/fail). TỪ build 234 cờ này KHÔNG còn quyền quyết định
    // đường phát: mọi lần phát đều bắt đầu bằng TRÌNH PHÁT TÍCH HỢP (thẻ
    // <video>) — xem khối chính sách MOVIE_INTEGRATED_PLAYER_FIRST.
    var moviePreferNativePlayer = false;
    // Serial của lần CHUYỂN TẬP trong player (đổi tập tay / tự next-tập).
    // Lần chuyển tập đang nạp nguồn bị VÔ HIỆU khi: (a) người dùng đóng hẳn
    // player, (b) người dùng chọn phim / tập khác — chống player (kể cả
    // native) tự BẬT LẠI sau khi người dùng đã đóng (race mạng chậm).
    var movieEpisodeSwitchSerial = 0;
    // =================================================================
    // [build 234 — 2026-09-15] HẾT TẬP → TRÌNH PHÁT TỰ ĐÓNG → TỰ PHÁT TẬP KẾ
    //
    // Yêu cầu: phim BỘ nhiều tập — tập phát hết thì trình phát TỰ ĐÓNG (như
    // hiện tại), sau đó TỰ ĐỘNG phát tập tiếp theo; KHÔNG dừng lại ở màn
    // hình chọn tập. Phim LẺ giữ nguyên: hết → đóng → về giao diện PHIM.
    //
    // Cơ chế (một luồng duy nhất cho CẢ HAI đường phát):
    //   1. hết tập → nếu còn tập kế: ĐÓNG hẳn trình phát (native: action
    //      "stop"; web: gỡ overlay player);
    //   2. nạp nguồn của tập kế (loadMovieStreams với guard serial riêng);
    //   3. có nguồn → startMoviePlayback mở lại trình phát với tập kế.
    // Mọi thao tác người dùng (Return / chọn tập-phim khác / rời màn hình
    // PHIM) đều VÔ HIỆU lần tự chuyển tập đang chờ ⇒ không bao giờ "tự bật
    // lại" ngoài ý muốn (race mạng chậm).
    // =================================================================
    var movieAutoAdvanceActive = false;
    var movieAutoAdvanceSerial = 0;
    var movieAutoAdvanceOrigin = "";
    // Trạng thái UI PHIM mirror về Swift — gesture điều hướng (Return / tua)
    // phải trả lời NGAY, không thể chờ evaluateJavaScript.
    var movieIosUiStateLastSignature = "";
    // =================================================================
    // [build 243 — 2026-09-17] CHÍNH SÁCH TRÌNH PHÁT: NGƯỜI DÙNG CHỌN MỘT
    //
    // Module PHIM có HAI trình phát:
    //   • TRÌNH PHÁT TÍCH HỢP — thẻ <video> trong web app này (app.js/hls.js);
    //   • TRÌNH PHÁT iOS — AVPlayerViewController (PhimNativePlayerController).
    //
    // Bản 234–242: MỌI lần phát đều bắt đầu bằng trình phát tích hợp rồi
    // "leo thang" sang trình phát iOS khi nguồn lỗi — và khi leo thang thẻ
    // <video> VẪN GIỮ `src`, nên HAI player cùng tải MỘT URL (tốn băng
    // thông, load lâu, tốn CPU/RAM, dễ xung đột).
    //
    // Bản 243: người dùng CHỌN MỘT trình phát trong SETTING → "Trình phát
    // PHIM" (lưu ở UserDefaults của app, giữ qua các lần đóng/mở app).
    //   • ĐÃ chọn "integrated" → chỉ thẻ <video> được nạp nguồn; KHÔNG mở
    //     trình phát iOS kể cả khi nguồn lỗi (báo lỗi THẬT + gợi ý đổi trong
    //     SETTING).
    //   • ĐÃ chọn "native"     → chỉ trình phát iOS được nạp nguồn; thẻ
    //     <video> KHÔNG BAO GIỜ nhận `src`.
    //   • CHƯA chọn            → KHÔNG nạp player nào, chuyển sang SETTING
    //     để chọn; chọn xong tự quay lại PHIM và phát tiếp ĐÚNG phim/tập
    //     vừa chọn (`moviePendingPlayerChoicePlayback`).
    // Giá trị lựa chọn do Swift tiêm (script `playerChoiceJS` của
    // PhimWebView.swift) — đọc bằng `movieChosenPlayer()`.
    // Ngoài WKWebView iOS (Android/Tizen/Windows): không có cầu nối → mọi
    // nhánh dưới đây KHÔNG đổi hành vi cũ (vẫn phát bằng thẻ <video>).
    //
    // `MOVIE_INTEGRATED_PLAYER_FIRST` chỉ còn là MẶC ĐỊNH AN TOÀN cho
    // trường hợp không đọc được lựa chọn (vd cầu nối lỗi) — KHÔNG còn là
    // chính sách "thử tích hợp rồi fallback sang iOS".
    // `iosNeedsNativePlayerFor` giữ lại làm CHẨN ĐOÁN (log) — không quyết
    // định đường phát.
    // =================================================================
    var MOVIE_INTEGRATED_PLAYER_FIRST = true;
    // [build 243] Phim/tập đang CHỜ người dùng chọn trình phát trong SETTING
    // ({url, title, subtitleContext}) — phát tiếp ngay khi lựa chọn được lưu.
    var moviePendingPlayerChoicePlayback = null;
    var movieBootstrapRequestInFlight = null;
    var movieBootstrapCache = null;
    var moviePrefetchTimer = null;
    var moviePrefetchStarted = false;
    var movieMergedRefreshTimer = null;
    var movieMergedRefreshPending = false;
    var movieActiveCatalogIdentity = "";
    var movieCatalogScanToken = 0;
    var movieCatalogLoadToken = 0;
    var movieCatalogIndex = 0;
    var movieItems = [];
    var movieAllItems = [];
    var movieItemIndex = 0;
    var movieBrowserFocusArea = "catalogs";
    var movieCatalogRowElements = [];
    var movieCardElements = [];
    var movieFilterButtonElements = [];
    var movieLastFocusArea = "";
    var movieLastCatalogFocusIndex = -1;
    var movieLastSelectedCatalogIndex = -1;
    var movieLastItemFocusIndex = -1;
    var movieFilterMode = "all";
    var movieFilterIndex = 0;
    var movieFilterToken = 0;
    var movieFilterInProgress = false;
    var movieFilterMenuOpen = false;
    var movieFilterMenuIndex = 0;
    var movieClassificationCache = {};
    var movieReclassifiedSeriesBySource = {};
    var movieSearchOpen = false;
    var movieSearchFocusIndex = 1;
    var movieSearchEditing = false;
    var movieSearchRecognition = null;
    var movieSearchVoiceClient = null;
    var movieSearchVoiceListenerId = null;
    var movieVoiceRemoteKeyCodes = { "10225": true };
    var movieSearchToken = 0;
    var movieSearchQuery = "";
    var movieSearchResultsActive = false;
    var movieSearchReturnCatalogIndex = 0;
    var movieEpisodes = [];
    var movieEpisodeIndex = 0;
    var movieEpisodeType = "series";
    var movieEpisodeTitle = "";
    var movieEpisodeMeta = null;
    var movieCurrentSubtitleContext = null;
    var movieSubtitleOptions = [];
    var movieSubtitleMenuOpen = false;
    var movieSubtitleMenuIndex = 0;
    var movieSubtitleMenuTimer = null;
    var movieSubtitleActiveIndex = -1;
    var movieSubtitleCues = [];
    var movieSubtitleTimer = null;
    var movieSubtitleRequestToken = 0;
    var movieSubtitleUserDisabled = true;
    var movieSubtitleEnableRequested = false;
    var movieSubtitleLoadState = "idle";
    var movieSubtitleCueCursor = 0;
    var movieSubtitleActiveSource = "";

    var okPressTimer = null;
    var okKeyDown = false;
    var longPressTriggered = false;
    var suppressNextOkUp = false;

    var launchedAppIds = [];
    var exitModalOpen = false;
    var exitModalOkDown = false;
    var exitModalReturnIndex = 0;
    var wallpaperWasPausedForHidden = false;
    var cleanupInProgress = false;
    var exitRequestFallbackTimer = null;
    var lastBackSignalAt = 0;

    var backgrounds = [];
    var backgroundIndex = 0;
    var activeBgLayer = 0;
    var wallpaperTimer = null;
    var dateTimeTimer = null;
    var weatherTimer = null;

    var WEATHER_LOCATION_KEY = "bintv_weather_location";
    var WEATHER_LOCATION_TTL = 7 * 24 * 60 * 60 * 1000;
    var IP_LOCATION_URL = "https://ipapi.co/json/";
    var WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
    var weatherRequestInProgress = false;

    function readJson(key, fallback) {
        try {
            var value = localStorage.getItem(key);
            if (!value) return fallback;
            var parsed = JSON.parse(value);
            return parsed == null ? fallback : parsed;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {}
    }

    function createBuiltinMovieApp() {
        return {
            id: BUILTIN_MOVIE_APP_ID,
            name: "Phim",
            iconPath: "Phim.png",
            categories: [],
            isBuiltinMovie: true,
            isPermanentFavorite: true
        };
    }

    function isBuiltinMovieApp(item) {
        return !!(item && (item.isBuiltinMovie === true || item.id === BUILTIN_MOVIE_APP_ID));
    }

    function isBuiltinMovieAppId(appId) {
        return appId === BUILTIN_MOVIE_APP_ID;
    }

    function createBuiltinJvhdApp() {
        return { id: BUILTIN_JVHD_APP_ID, name: "JVHD", iconPath: "JVHD.png", categories: [], isBuiltinMovie: true, isBuiltinJvhd: true, isPermanentFavorite: true };
    }
    function isBuiltinJvhdApp(item) {
        return !!(item && (item.isBuiltinJvhd === true || item.id === BUILTIN_JVHD_APP_ID));
    }
    function isBuiltinJvhdAppId(appId) {
        return appId === BUILTIN_JVHD_APP_ID;
    }

    function putBuiltinMovieFirst() {
        for (var i = 0; i < apps.length; i++) {
            if (isBuiltinMovieApp(apps[i])) {
                if (i > 0) apps.unshift(apps.splice(i, 1)[0]);
                return;
            }
        }
        apps.unshift(createBuiltinMovieApp());
    }

    function getSavedAppOrder() {
        var value = readJson(APP_ORDER_KEY, []);
        return Array.isArray(value) ? value : [];
    }

    function saveAppOrder() {
        var order = [];
        for (var i = 0; i < apps.length; i++) {
            if (apps[i] && apps[i].id && !isBuiltinMovieApp(apps[i])) order.push(apps[i].id);
        }
        writeJson(APP_ORDER_KEY, order);
    }

    function getHiddenApps() {
        var value = readJson(HIDDEN_APPS_KEY, []);
        return Array.isArray(value) ? value : [];
    }

    function saveHiddenApps(hidden) {
        writeJson(HIDDEN_APPS_KEY, hidden);
    }

    function addToHidden(ids) {
        var hidden = getHiddenApps();
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] && !isBuiltinMovieAppId(ids[i]) && hidden.indexOf(ids[i]) === -1) hidden.push(ids[i]);
        }
        saveHiddenApps(hidden);
    }

    /* =====================================================
       AUTO FAVORITE - APP MẪU
       ===================================================== */
    var AUTO_FAVORITE_PATTERNS = [
        ["Netflix", ["netflix"]],
        ["YouTube", ["youtube"]],
        ["Amazon Prime Video", ["amazon prime video", "prime video", "amazon video"]],
        ["Disney+", ["disney+", "disney plus", "disney"]],
        ["Apple TV+", ["apple tv+", "apple tv", "appletv"]],
        ["VieON", ["vieon", "vie on"]],
        ["FPT Play", ["fpt play", "fptplay"]],
        ["VTV Go", ["vtv go", "vtvgo"]],
        ["Spotify", ["spotify"]],
        ["NhacCuaTui", ["nhaccuatui", "nhac cua tui", "nct"]],
        ["Samsung TV Plus", ["samsung tv plus", "samsung tv+", "tv plus"]],
        ["SmartThings", ["smartthings", "smart things"]],
        ["AccuWeather", ["accuweather", "accu weather"]],
        ["Stremio", ["stremio"]],
        ["Tizenbrew nexgerenal", ["tizenbrew", "nexgerenal"]]
    ];

    function normalizeAppNameForMatching(name) {
        var value = String(name || "").toLowerCase();
        try {
            value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        } catch (e) {}
        return value.replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
    }

    function isSampleFavoriteAppName(name) {
        var normalized = normalizeAppNameForMatching(name);
        if (!normalized) return false;

        for (var i = 0; i < AUTO_FAVORITE_PATTERNS.length; i++) {
            var patterns = AUTO_FAVORITE_PATTERNS[i][1];
            for (var j = 0; j < patterns.length; j++) {
                var pattern = normalizeAppNameForMatching(patterns[j]);
                if (pattern && normalized.indexOf(pattern) !== -1) return true;
            }
        }
        return false;
    }

    function getAutoFavoriteDisabledApps() {
        var value = readJson(AUTO_FAVORITE_DISABLED_KEY, []);
        return Array.isArray(value) ? value : [];
    }

    function saveAutoFavoriteDisabledApps(ids) {
        writeJson(AUTO_FAVORITE_DISABLED_KEY, ids);
    }

    function isAutoFavoriteDisabled(appId) {
        return getAutoFavoriteDisabledApps().indexOf(appId) !== -1;
    }

    function disableAutoFavorite(appId) {
        if (!appId) return;
        var ids = getAutoFavoriteDisabledApps();
        if (ids.indexOf(appId) === -1) ids.push(appId);
        saveAutoFavoriteDisabledApps(ids);
    }

    function enableAutoFavorite(appId) {
        if (!appId) return;
        var ids = getAutoFavoriteDisabledApps();
        var result = [];
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] !== appId) result.push(ids[i]);
        }
        saveAutoFavoriteDisabledApps(result);
    }

    function findInstalledAppById(appId) {
        if (!appId) return null;
        for (var i = 0; i < installedApps.length; i++) {
            if (installedApps[i] && installedApps[i].id === appId) return installedApps[i];
        }
        return null;
    }

    function syncAutoFavoritesFromInstalledApps() {
        var favorites = getFavoriteApps();
        var disabled = getAutoFavoriteDisabledApps();
        var changedFavorites = false;

        for (var i = 0; i < installedApps.length; i++) {
            var info = installedApps[i];
            if (!info || !info.id) continue;

            var id = info.id;
            if (!isSampleFavoriteAppName(info.name)) continue;
            if (disabled.indexOf(id) !== -1) continue;

            if (favorites.indexOf(id) === -1) {
                favorites.push(id);
                changedFavorites = true;
            }
        }

        if (changedFavorites) saveFavoriteApps(favorites);
    }

    function getFavoriteApps() {
        var value = readJson(FAVORITE_APPS_KEY, []);
        return Array.isArray(value) ? value : [];
    }

    function saveFavoriteApps(favorites) {
        writeJson(FAVORITE_APPS_KEY, favorites);
    }

    function isFavorite(appId) {
        if (isBuiltinMovieAppId(appId) || isBuiltinJvhdAppId(appId)) return true;
        var favs = getFavoriteApps();
        return favs.indexOf(appId) !== -1;
    }

    function toggleFavorite(appId) {
        if (!appId || isBuiltinMovieAppId(appId) || isBuiltinJvhdAppId(appId)) return;
        var favs = getFavoriteApps();
        var idx = favs.indexOf(appId);
        var installed = findInstalledAppById(appId);
        var sampleMatched = installed ? isSampleFavoriteAppName(installed.name) : false;

        if (idx !== -1) {
            favs.splice(idx, 1);
            if (sampleMatched) disableAutoFavorite(appId);
        } else {
            favs.push(appId);
            if (sampleMatched) enableAutoFavorite(appId);
        }
        saveFavoriteApps(favs);
    }

    function pruneStorageAgainstInstalledApps() {
        var installedIds = {};
        var i;
        for (i = 0; i < installedApps.length; i++) {
            if (installedApps[i] && installedApps[i].id) installedIds[installedApps[i].id] = true;
        }

        var hidden = getHiddenApps();
        var cleanHidden = [];
        for (i = 0; i < hidden.length; i++) { if (installedIds[hidden[i]]) cleanHidden.push(hidden[i]); }
        saveHiddenApps(cleanHidden);

        var order = getSavedAppOrder();
        var cleanOrder = [];
        for (i = 0; i < order.length; i++) { if (installedIds[order[i]]) cleanOrder.push(order[i]); }
        writeJson(APP_ORDER_KEY, cleanOrder);

        var favs = getFavoriteApps();
        var cleanFavs = [];
        for (i = 0; i < favs.length; i++) { if (installedIds[favs[i]]) cleanFavs.push(favs[i]); }
        saveFavoriteApps(cleanFavs);

        var disabledAutoFavs = getAutoFavoriteDisabledApps();
        var cleanDisabledAutoFavs = [];
        for (i = 0; i < disabledAutoFavs.length; i++) { if (installedIds[disabledAutoFavs[i]]) cleanDisabledAutoFavs.push(disabledAutoFavs[i]); }
        saveAutoFavoriteDisabledApps(cleanDisabledAutoFavs);
    }

    /* =====================================================
       WEATHER MODULE
       ===================================================== */
    var WEATHER_LATITUDE = 21.181088;
    var WEATHER_LONGITUDE = 105.660672;
    var WEATHER_LOCATION_NAME = "Địa điểm tại 21.181088, 105.660672";
    var WEATHER_CACHE_KEY = "bintv_weather_cache_21_181088_105_660672";
    var WEATHER_CACHE_TTL = 20 * 60 * 1000;
    var WEATHER_FALLBACK_URL = "https://wttr.in/21.181088,105.660672?format=j1&lang=vi";

    function requestJson(url, timeout, success, failure) {
        var xhr = new XMLHttpRequest();
        var finished = false;
        var timer = null;

        function finishOk(data) {
            if (finished) return; finished = true;
            if (timer) clearTimeout(timer); success(data);
        }

        function finishFail(error) {
            if (finished) return; finished = true;
            if (timer) clearTimeout(timer); failure(error || new Error("Network request failed"));
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) { finishFail(new Error("HTTP " + xhr.status)); return; }
            try { finishOk(JSON.parse(xhr.responseText)); } catch (e) { finishFail(e); }
        };

        xhr.onerror = function () { finishFail(new Error("Network error")); };
        xhr.ontimeout = function () { finishFail(new Error("Request timeout")); };

        try {
            xhr.open("GET", url, true); xhr.timeout = timeout || 8000;
            timer = setTimeout(function () { try { xhr.abort(); } catch (e) {} finishFail(new Error("Request timeout")); }, (timeout || 8000) + 500);
            xhr.send();
        } catch (e) { finishFail(e); }
    }

    function ensureWeatherElement() {
        var weather = document.getElementById("weather");
        if (!weather) {
            var datetime = document.querySelector(".datetime");
            if (!datetime) return null;
            
            weather = document.createElement("div");
            weather.id = "weather";
            weather.className = "weather";
            datetime.appendChild(weather);
        }

        weather.setAttribute("aria-label", "Thời tiết hiện tại tại " + WEATHER_LOCATION_NAME);

        // THAY ĐỔI CẤU TRÚC Ở ĐÂY: Áp dụng bố cục dọc (column) căng phải.
        // Cụm 1 (Icon + Nhiệt độ) xếp ngang hàng
        // Cụm 2 (Mô tả) nằm dưới cùng.
        if (!document.getElementById("weather-icon") || 
            !document.getElementById("weather-description") || 
            !document.getElementById("weather-temp")) {
            weather.innerHTML =
                '<div style="display: flex; flex-direction: column; align-items: flex-end;">' +
                    '<div style="display: flex; align-items: center; gap: 8px;">' +
                        '<span id="weather-icon" class="weather-icon" aria-hidden="true"></span>' +
                        '<span id="weather-temp" class="weather-temp"></span>' +
                    '</div>' +
                    '<span id="weather-description" class="weather-description" style="margin-top: 4px; text-align: right; display: block; opacity: 0.9;"></span>' +
                '</div>';
        }

        return weather;
    }

    function getWeatherIconMarkup(code, isDay) {
        code = parseInt(code, 10);
        if (code === 0) return isDay ? '<svg viewBox="0 0 64 64" class="weather-svg weather-sun" role="img"><circle cx="32" cy="32" r="13"></circle><g class="sun-rays"><line x1="32" y1="5" x2="32" y2="13"></line><line x1="32" y1="51" x2="32" y2="59"></line><line x1="5" y1="32" x2="13" y2="32"></line><line x1="51" y1="32" x2="59" y2="32"></line><line x1="13" y1="13" x2="19" y2="19"></line><line x1="45" y1="45" x2="51" y2="51"></line><line x1="51" y1="13" x2="45" y2="19"></line><line x1="19" y1="45" x2="13" y2="51"></line></g></svg>' : '<svg viewBox="0 0 64 64" class="weather-svg weather-moon" role="img"><path d="M43 10c-9 3-15 12-15 22 0 12 9 22 21 22 2 0 5 0 7-1-4 6-11 10-19 10-13 0-24-11-24-24S22 15 35 11c3-1 5-1 8-1z"></path></svg>';
        if (code === 1) return isDay ? '<svg viewBox="0 0 64 64" class="weather-svg weather-partly" role="img"><circle class="weather-sun-small" cx="23" cy="23" r="9"></circle><g class="sun-rays-small"><line x1="23" y1="7" x2="23" y2="12"></line><line x1="7" y1="23" x2="12" y2="23"></line><line x1="12" y1="12" x2="16" y2="16"></line><line x1="34" y1="12" x2="30" y2="16"></line></g><path class="cloud-shape" d="M18 46h28c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 10 6z"></path></svg>' : '<svg viewBox="0 0 64 64" class="weather-svg weather-partly weather-night-partly" role="img"><path d="M31 7c-7 3-11 10-11 17 0 9 7 16 16 16 2 0 4 0 6-1-3 5-8 8-14 8-10 0-18-8-18-18 0-9 6-17 15-20 2-1 4-2 6-2z" fill="#fff"></path><path class="cloud-shape" d="M22 52h27c5 0 9-4 9-8s-4-8-9-8c-1-6-6-10-12-10-7 0-12 5-12 12v1c-5 0-9 3-9 7s3 6 6 6z"></path></svg>';
        if (code === 2) return isDay ? '<svg viewBox="0 0 64 64" class="weather-svg weather-cloud weather-cloud-moving" role="img"><circle cx="22" cy="18" r="8" class="weather-sun-small"></circle><path class="cloud-shape" d="M17 47h29c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path></svg>' : '<svg viewBox="0 0 64 64" class="weather-svg weather-cloud weather-cloud-moving weather-night-partly" role="img"><path d="M29 6c-7 3-11 9-11 16 0 9 7 16 16 16 2 0 4 0 6-1-3 5-8 8-14 8-10 0-18-8-18-18 0-9 6-17 15-20 2-1 4-1 6-1z" fill="#fff"></path><path class="cloud-shape" d="M17 49h29c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path></svg>';
        if (code === 3) return '<svg viewBox="0 0 64 64" class="weather-svg weather-cloud weather-cloud-moving" role="img"><path class="cloud-shape cloud-back" d="M11 33h28c5 0 9-3 9-8s-4-8-9-8c-1-6-6-10-12-10-7 0-12 5-12 12v1c-5 0-8 3-8 7s3 6 8 6z"></path><path class="cloud-shape" d="M19 50h29c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path></svg>';
        if ((code >= 51 && code <= 67) || code === 80 || code === 81 || code === 82) return '<svg viewBox="0 0 64 64" class="weather-svg weather-rain" role="img"><path class="cloud-shape" d="M17 37h30c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path><g class="rain-drops"><line x1="19" y1="44" x2="16" y2="53"></line><line x1="32" y1="44" x2="29" y2="53"></line><line x1="45" y1="44" x2="42" y2="53"></line></g></svg>';
        if (code === 95 || code === 96 || code === 99) return '<svg viewBox="0 0 64 64" class="weather-svg weather-storm" role="img"><path class="cloud-shape" d="M14 34h32c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 10 6z"></path><path class="lightning" d="M34 37L25 51h8l-4 10 12-16h-8z"></path></svg>';
        if (code >= 45 && code <= 48) return '<svg viewBox="0 0 64 64" class="weather-svg weather-fog" role="img"><g class="fog-lines"><line x1="12" y1="22" x2="52" y2="22"></line><line x1="7" y1="32" x2="57" y2="32"></line><line x1="13" y1="42" x2="51" y2="42"></line></g></svg>';
        if (code >= 71 && code <= 77 || code === 85 || code === 86) return '<svg viewBox="0 0 64 64" class="weather-svg weather-snow" role="img"><path class="cloud-shape" d="M17 38h30c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path><g class="snow-flakes"><circle cx="20" cy="49" r="2"></circle><circle cx="32" cy="53" r="2"></circle><circle cx="44" cy="49" r="2"></circle></g></svg>';
        return '<svg viewBox="0 0 64 64" class="weather-svg weather-cloud" role="img"><path class="cloud-shape" d="M17 45h30c6 0 10-4 10-9s-4-9-10-9c-1-7-7-12-14-12-8 0-14 6-14 14v1c-6 0-10 4-10 9s4 6 9 6z"></path></svg>';
    }

    function getWeatherDescription(code, isDay) {
        code = parseInt(code, 10);
        if (code === 0) return { text: isDay ? "Trời nắng" : "Trời quang" };
        if (code === 1) return { text: isDay ? "Ít mây" : "Đêm ít mây" };
        if (code === 2) return { text: isDay ? "Mây rải rác" : "Đêm có mây" };
        if (code === 3) return { text: "Nhiều mây" };
        if (code === 45 || code === 48) return { text: "Sương mù" };
        if (code >= 51 && code <= 67) return { text: "Mưa" };
        if (code >= 71 && code <= 77) return { text: "Tuyết" };
        if (code === 80 || code === 81 || code === 82) return { text: "Mưa rào" };
        if (code === 85 || code === 86) return { text: "Mưa tuyết" };
        if (code === 95 || code === 96 || code === 99) return { text: "Dông bão" };
        return { text: "Thời tiết hiện tại" };
    }

    function buildWeatherUrl() {
        return WEATHER_API_URL + "?latitude=" + encodeURIComponent(WEATHER_LATITUDE) + "&longitude=" + encodeURIComponent(WEATHER_LONGITUDE) + "&current=temperature_2m,weather_code,is_day&temperature_unit=celsius&timezone=auto";
    }

    function readWeatherCache() {
        var cached = readJson(WEATHER_CACHE_KEY, null);
        if (!cached || !cached.data || typeof cached.savedAt !== "number") return null;
        return cached;
    }

    function saveWeatherCache(data) {
        if (!data || !data.current) return;
        writeJson(WEATHER_CACHE_KEY, { data: data, savedAt: Date.now() });
    }

    function isWeatherCacheFresh(cached) {
        return !!(cached && typeof cached.savedAt === "number" && (Date.now() - cached.savedAt) <= WEATHER_CACHE_TTL);
    }

    function setWeatherState(state, message) {
        var weather = ensureWeatherElement();
        if (!weather) return;

        var icon = document.getElementById("weather-icon");
        var temp = document.getElementById("weather-temp");
        var description = document.getElementById("weather-description");

        weather.className = "weather weather-" + state;

        if (state === "loading") {
            if (icon) icon.innerHTML = '<svg viewBox="0 0 64 64" class="weather-svg weather-loader" aria-hidden="true"><circle cx="32" cy="32" r="18" fill="none"></circle></svg>';
            if (temp) temp.textContent = "";
            if (description) description.textContent = message || "Đang cập nhật…";
            weather.style.display = "flex";
            return;
        }

        if (state === "error") {
            if (icon) icon.innerHTML = getWeatherIconMarkup(3, true);
            if (temp) temp.textContent = "";
            if (description) description.textContent = message || "Không có dữ liệu";
            weather.style.display = "flex";
            return;
        }

        weather.style.display = "flex";
    }

    function renderWeather(data, fromCache) {
        if (!data || !data.current) { setWeatherState("error", "Không có dữ liệu"); return; }
        var current = data.current;
        var temperature = Number(current.temperature_2m);
        var weatherCode = Number(current.weather_code);
        var isDay = Number(current.is_day) !== 0;

        if (!isFinite(temperature) || !isFinite(weatherCode)) { setWeatherState("error", "Không có dữ liệu"); return; }
        var description = getWeatherDescription(weatherCode, isDay);
        var weather = ensureWeatherElement(); if (!weather) return;

        var icon = document.getElementById("weather-icon");
        var temp = document.getElementById("weather-temp");
        var descriptionElement = document.getElementById("weather-description");

        if (icon) icon.innerHTML = getWeatherIconMarkup(weatherCode, isDay);
        if (temp) { temp.textContent = Math.round(temperature) + "°C"; temp.title = WEATHER_LOCATION_NAME + (fromCache ? " · dữ liệu đã lưu" : ""); }
        if (descriptionElement) { descriptionElement.textContent = description.text; descriptionElement.title = WEATHER_LOCATION_NAME + (fromCache ? " · dữ liệu đã lưu" : ""); }

        weather.className = "weather weather-ready";
        weather.setAttribute("aria-label", "Thời tiết " + Math.round(temperature) + " độ C - " + description.text + " tại " + WEATHER_LOCATION_NAME);
        weather.style.display = "flex";
    }

    function mapWttrCodeToOpenMeteo(code) {
        code = parseInt(code, 10);
        if (code === 113) return 0;
        if (code === 116) return 2;
        if (code === 119 || code === 122) return 3;
        if (code === 143 || code === 149 || code === 248 || code === 260) return 45;
        if (code === 200 || code === 386 || code === 389) return 95;
        if (code === 176 || code === 263 || code === 266 || code === 293 || code === 296 || code === 299 || code === 302 || code === 305 || code === 308 || code === 353 || code === 356 || code === 359) return 61;
        if (code === 317 || code === 320 || code === 350 || code === 362 || code === 365 || code === 368 || code === 371 || code === 374 || code === 377 || code === 392 || code === 395) return 71;
        return 3;
    }

    function parseWttrClock(value) {
        var match = String(value || "").toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (!match) return -1;
        var hour = parseInt(match[1], 10);
        var minute = parseInt(match[2], 10);
        if (hour === 12) hour = 0;
        if (match[3] === "PM") hour += 12;
        return hour * 60 + minute;
    }

    function getWttrDayState(data, condition) {
        var dayValue = String((condition && condition.isdaytime) || "").toLowerCase();
        if (dayValue === "yes") return true;
        if (dayValue === "no") return false;

        try {
            var astronomy = data && data.weather && data.weather[0] && data.weather[0].astronomy && data.weather[0].astronomy[0];
            var sunrise = parseWttrClock(astronomy && astronomy.sunrise);
            var sunset = parseWttrClock(astronomy && astronomy.sunset);
            var now = new Date();
            var currentMinutes = now.getHours() * 60 + now.getMinutes();
            if (sunrise >= 0 && sunset >= 0) return currentMinutes >= sunrise && currentMinutes < sunset;
        } catch (e) {}

        var currentHour = new Date().getHours();
        return currentHour >= 6 && currentHour < 18;
    }

    function normalizeWttrResponse(data) {
        try {
            var condition = data && data.current_condition && data.current_condition[0];
            if (!condition) return null;
            var temp = Number(condition.temp_C);
            var code = Number(condition.weatherCode);
            if (!isFinite(temp) || !isFinite(code)) return null;
            var isDay = getWttrDayState(data, condition);
            return { current: { temperature_2m: temp, weather_code: mapWttrCodeToOpenMeteo(code), is_day: isDay ? 1 : 0 } };
        } catch (e) { return null; }
    }

    function requestWeatherFallback() {
        requestJson(WEATHER_FALLBACK_URL, 8000, function (data) {
            var normalized = normalizeWttrResponse(data);
            if (normalized) { saveWeatherCache(normalized); renderWeather(normalized, false); }
            else { setWeatherState("error", "Không đọc được dữ liệu"); }
            weatherRequestInProgress = false;
        }, function () {
            weatherRequestInProgress = false;
            var cached = readWeatherCache();
            if (cached) renderWeather(cached.data, true);
            else setWeatherState("error", "Không thể cập nhật");
        });
    }

    function requestWeather() {
        requestJson(buildWeatherUrl(), 8000, function (data) {
            try { saveWeatherCache(data); renderWeather(data, false); weatherRequestInProgress = false; }
            catch (e) { requestWeatherFallback(); }
        }, function () { requestWeatherFallback(); });
    }

    function updateWeather(force) {
        if (weatherRequestInProgress) return;
        var cached = readWeatherCache();
        if (!force && isWeatherCacheFresh(cached)) { renderWeather(cached.data, true); return; }
        weatherRequestInProgress = true;
        setWeatherState("loading", "Đang cập nhật…");
        requestWeather();
    }

    /* =====================================================
       ICON & APP DATA & SORTING
       ===================================================== */
    function createFallbackIcon(name) {
        var canvas = document.createElement("canvas");
        canvas.width = 128; canvas.height = 128;
        var ctx = canvas.getContext("2d"); if (!ctx) return "";
        ctx.fillStyle = "#202020"; ctx.fillRect(0, 0, 128, 128);
        var firstLetter = String(name || "?").replace(/[^a-zA-Z0-9À-ỹ]/g, "").charAt(0).toUpperCase();
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 60px Arial";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(firstLetter || "?", 64, 64);
        return canvas.toDataURL("image/png");
    }

    function normalizeIconPath(path) {
        if (!path) return "";
        if (path.indexOf("://") !== -1 || path.indexOf("data:") === 0) return path;
        if (path.charAt(0) === "/") return "file://" + path;
        return path;
    }

    function getCurrentAppId() {
        try { if (window.tizen && tizen.application && tizen.application.getCurrentApplication) return tizen.application.getCurrentApplication().appInfo.id || ""; } catch (e) {}
        return "";
    }

    function sortInstalledApps() {
        var order = getSavedAppOrder();
        var position = {};
        for (var i = 0; i < order.length; i++) position[order[i]] = i;

        apps.sort(function (a, b) {
            if (isBuiltinMovieApp(a)) return isBuiltinMovieApp(b) ? 0 : -1;
            if (isBuiltinMovieApp(b)) return 1;
            var aHas = Object.prototype.hasOwnProperty.call(position, a.id);
            var bHas = Object.prototype.hasOwnProperty.call(position, b.id);
            if (aHas && bHas) return position[a.id] - position[b.id];
            if (aHas) return -1;
            if (bHas) return 1;
            return 0;
        });

        var permanentFavorites = [], favorites = [], nonFavorites = [];
        for (var j = 0; j < apps.length; j++) {
            if (isBuiltinMovieApp(apps[j])) permanentFavorites.push(apps[j]);
            else if (isFavorite(apps[j].id)) favorites.push(apps[j]);
            else nonFavorites.push(apps[j]);
        }
        apps = permanentFavorites.concat(favorites, nonFavorites);
    }

    function buildVisibleApps() {
        var currentAppId = getCurrentAppId();
        var hidden = getHiddenApps();
        var visible = [createBuiltinMovieApp(), createBuiltinJvhdApp()];
        for (var i = 0; i < installedApps.length; i++) {
            var info = installedApps[i];
            if (!info || !info.id || isBuiltinMovieAppId(info.id) || isBuiltinJvhdAppId(info.id) || (currentAppId && info.id === currentAppId) || hidden.indexOf(info.id) !== -1) continue;
            visible.push({ name: info.name || "App", id: info.id || "", iconPath: info.iconPath || "", categories: info.categories || [] });
        }
        apps = visible;
        syncAutoFavoritesFromInstalledApps();
        sortInstalledApps();
    }

    function loadTestApps() {
        installedApps = [
            { name: "YouTube", id: "111299001912", iconPath: "", categories: ["http://tizen.org/category/downloaded"] },
            { name: "Netflix", id: "11101200001", iconPath: "", categories: [] },
            { name: "Spotify", id: "spotify.app", iconPath: "", categories: ["http://tizen.org/category/store"] },
            { name: "System Settings", id: "org.tizen.settings", iconPath: ["http://tizen.org/category/system"] }
        ];
        buildVisibleApps();
    }

    function loadInstalledApps(callback) {
        if (TEST_MODE) { loadTestApps(); if (callback) callback(true); return; }
        if (!tizen.application || !tizen.application.getAppsInfo) { installedApps = []; apps = [createBuiltinMovieApp()]; if (callback) callback(false); return; }
        try {
            tizen.application.getAppsInfo(function (list) {
                installedApps = list || []; pruneStorageAgainstInstalledApps(); buildVisibleApps();
                if (callback) callback(true);
            }, function () { putBuiltinMovieFirst(); if (callback) callback(false); });
        } catch (e) { putBuiltinMovieFirst(); if (callback) callback(false); }
    }

    /* =====================================================
       WALLPAPER ROTATION - DISABLED (Phim standalone)
       ===================================================== */
    function initBackgroundLayers() {
        // [BinTV-PHIM-STANDALONE 2026-09] Khong load bg1..bg5.jpg - Phim chi giu module Phim
        activeBgLayer = 0; backgroundIndex = 0;
    }

    function rotateBackground() {
        // [BinTV-PHIM-STANDALONE 2026-09] No-op: khong xoay wallpaper
    }

    function startWallpaperRotation() {
        // [BinTV-PHIM-STANDALONE 2026-09] No-op: khong bat timer wallpaper
        if (wallpaperTimer) { clearInterval(wallpaperTimer); wallpaperTimer = null; }
    }

    /* =====================================================
       UI - APP LIST
       ===================================================== */
    function scrollToSelected() {
        if (!appsContainer || !buttons[index]) return;
        var containerRect = appsContainer.getBoundingClientRect();
        var buttonRect = buttons[index].getBoundingClientRect();
        if (buttonRect.left < containerRect.left) appsContainer.scrollLeft -= (containerRect.left - buttonRect.left) + 20;
        else if (buttonRect.right > containerRect.right) appsContainer.scrollLeft += (buttonRect.right - containerRect.right) + 20;
    }

    function focusApp() {
        if (apps.length === 0) { index = 0; return; }
        if (index < 0) index = 0; if (index >= apps.length) index = apps.length - 1;
        for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle("focus", i === index);
        if (buttons[index]) { try { buttons[index].focus(); } catch (e) {} scrollToSelected(); }
    }

    function updateSelectedVisuals() {
        for (var i = 0; i < buttons.length; i++) {
            var id = apps[i] && apps[i].id, selected = !!(id && selectedAppIds[id]);
            buttons[i].classList.toggle("selected", selected);
            var mark = buttons[i].querySelector(".multi-check");
            if (mark) mark.textContent = selected ? "✓" : "";
        }
    }

    function createApps() {
        if (!appsContainer) return; appsContainer.innerHTML = ""; buttons = [];
        for (var i = 0; i < apps.length; i++) {
            (function (buttonIndex) {
                var item = apps[buttonIndex];
                var button = document.createElement("button"); button.className = "app";
                if (isBuiltinMovieApp(item)) button.classList.add("builtin-movie");
                var fav = isFavorite(item.id); if (fav) button.classList.add("favorite");

                var icon = document.createElement("img"); icon.className = "app-icon"; icon.alt = item.name;
                var fallback = isBuiltinMovieApp(item) ? "" : createFallbackIcon(item.name);
                if (fallback) icon.setAttribute("data-fallback-src", fallback);
                icon.src = item.iconPath ? normalizeIconPath(item.iconPath) : fallback;
                icon.onerror = function () {
                    if (isBuiltinMovieApp(item)) {
                        this.style.visibility = "hidden";
                        showToast("Không tìm thấy icon Phim.png");
                        return;
                    }
                    if (this.getAttribute("data-fallback") === "1") return;
                    this.setAttribute("data-fallback", "1"); this.src = this.getAttribute("data-fallback-src") || fallback;
                };

                var name = document.createElement("b"); name.textContent = item.name;
                var check = document.createElement("span"); check.className = "multi-check";
                var favBadge = document.createElement("span"); favBadge.className = "favorite-badge"; favBadge.textContent = "❤️";
                if (!fav) favBadge.style.display = "none";

                button.appendChild(icon); button.appendChild(name);
                button.appendChild(check); button.appendChild(favBadge);
                appsContainer.appendChild(button); buttons.push(button);

                button.addEventListener("click", function (e) {
                    e.preventDefault(); if (isMovingApp || actionMenuOpen) return;
                    index = buttonIndex; focusApp();
                    if (isMultiSelectMode) toggleSelectedCurrentApp(); else launch();
                });
            })(i);
        }
        updateSelectedVisuals(); focusApp();
        if (isMovingApp && buttons[index]) buttons[index].classList.add("moving");
    }

    /* =====================================================
       MODES & ACTIONS
       ===================================================== */
    function enterMoveMode() { closeActionMenu(); dropMultiSelectMode(); isMovingApp = true; if (appsContainer) appsContainer.classList.add("move-mode"); createApps(); if (buttons[index]) buttons[index].classList.add("moving"); }
    function dropMoveMode() { if (!isMovingApp) return; isMovingApp = false; if (appsContainer) appsContainer.classList.remove("move-mode"); if (buttons[index]) buttons[index].classList.remove("moving"); saveAppOrder(); suppressNextOkUp = true; focusApp(); }
    function enterMultiSelectMode() { closeActionMenu(); isMovingApp = false; isMultiSelectMode = true; selectedAppIds = {}; if (appsContainer) appsContainer.classList.add("multi-select-mode"); if (apps[index] && apps[index].id && !isBuiltinMovieApp(apps[index])) selectedAppIds[apps[index].id] = true; createApps(); updateSelectedVisuals(); showMultiSelectBar(); }
    function dropMultiSelectMode() { isMultiSelectMode = false; if (appsContainer) appsContainer.classList.remove("multi-select-mode"); closeMultiSelectBar(); }
    function toggleSelectedCurrentApp() { if (!isMultiSelectMode || !apps[index] || isBuiltinMovieApp(apps[index])) return; var id = apps[index].id; if (selectedAppIds[id]) delete selectedAppIds[id]; else selectedAppIds[id] = true; updateSelectedVisuals(); }
    function deleteSelectedApps() {
        var ids = Object.keys(selectedAppIds).filter(function(id) { return selectedAppIds[id] && !isBuiltinMovieAppId(id); });
        if (ids.length === 0) { showToast("Chưa chọn ứng dụng nào"); return; }
        addToHidden(ids);
        var nextApps = []; for (var i = 0; i < apps.length; i++) { if (ids.indexOf(apps[i].id) === -1) nextApps.push(apps[i]); }
        apps = nextApps; saveAppOrder(); selectedAppIds = {}; dropMultiSelectMode(); closeActionMenu();
        if (index >= apps.length) index = Math.max(0, apps.length - 1); createApps(); focusApp();
    }

    /* =====================================================
       ACTION MENU
       ===================================================== */
    function ensureActionMenu() {
        var menu = document.getElementById("bintv-app-menu"); if (menu) return menu;
        menu = document.createElement("div"); menu.id = "bintv-app-menu"; document.body.appendChild(menu); return menu;
    }

    function showActionMenu() {
        var menu = ensureActionMenu(); menu.innerHTML = "";
        var currentItem = apps[index];
        var currentIsMovie = isBuiltinMovieApp(currentItem);
        var favLabel = currentIsMovie ? "Favorite cố định" : ((currentItem && isFavorite(currentItem.id)) ? "Bỏ Favorite" : "Favorite");
        var favoriteAction = currentIsMovie ? handlePermanentFavoriteAction : handleToggleFavoriteAction;
        var currentSortMode = readJson(SORT_MODE_KEY, "name");
        var sortLabel = currentSortMode === "name" ? "Sắp xếp theo tên" : "Sắp xếp theo định dạng";
        var sortAction = currentSortMode === "name" ? handleAutoSortByName : handleAutoSortByFormat;
        var items = [
            { label: "Di chuyển", action: enterMoveMode }, { label: "Chọn nhiều", action: enterMultiSelectMode },
            { label: favLabel, action: favoriteAction }, { label: "Xóa", action: deleteCurrentApp },
            { label: "Update list", action: updateList }, { label: sortLabel, action: sortAction },
            { label: "Hủy", action: closeActionMenu }
        ];

        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var row = document.createElement("div"); row.className = "bintv-menu-item"; row.textContent = item.label;
                row.addEventListener("click", function () { item.action(); }); menu.appendChild(row);
            })(items[i]);
        }
        actionMenuOpen = true; menu.setAttribute("data-menu-index", "0"); updateMenuFocus(); positionActionMenu();
    }

    function handlePermanentFavoriteAction() {
        closeActionMenu();
        showToast("Phim luôn là Favorite");
        focusApp();
    }

    function handleToggleFavoriteAction() {
        var item = apps[index]; if (!item || !item.id || isBuiltinMovieApp(item)) return;
        toggleFavorite(item.id); var currentAppId = item.id; sortInstalledApps();
        var newIndex = 0; for (var i = 0; i < apps.length; i++) { if (apps[i].id === currentAppId) { newIndex = i; break; } }
        index = newIndex; saveAppOrder(); closeActionMenu(); createApps(); focusApp();
        showToast(isFavorite(currentAppId) ? "Đã thêm vào Favorite ❤️" : "Đã gỡ khỏi Favorite");
    }

    function handleAutoSortByName() {
        var currentAppId = apps[index] && apps[index].id ? apps[index].id : null;
        var favorites = [], nonFavorites = [];
        for (var i = 0; i < apps.length; i++) { if (isFavorite(apps[i].id)) favorites.push(apps[i]); else nonFavorites.push(apps[i]); }
        nonFavorites.sort(function(a, b) {
            var nameA = String(a.name || "").toLowerCase(), nameB = String(b.name || "").toLowerCase();
            if (typeof nameA.localeCompare === 'function') return nameA.localeCompare(nameB);
            return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
        });
        apps = favorites.concat(nonFavorites); putBuiltinMovieFirst(); saveAppOrder(); writeJson(SORT_MODE_KEY, "format");
        if (currentAppId) { for (var j = 0; j < apps.length; j++) { if (apps[j].id === currentAppId) { index = j; break; } } } else { index = 0; }
        closeActionMenu(); createApps(); focusApp(); showToast("Đã sắp xếp ứng dụng theo tên");
    }

    function isVerifiedAppStoreApp(appId) {
        var info = null;
        for (var i = 0; i < installedApps.length; i++) { if (installedApps[i].id === appId) { info = installedApps[i]; break; } }
        if (!info || !info.categories || !Array.isArray(info.categories)) return false;
        for (var k = 0; k < info.categories.length; k++) {
            var cat = String(info.categories[k]).toLowerCase();
            if (cat.indexOf("downloaded") !== -1 || cat.indexOf("store") !== -1) return true;
        }
        return false;
    }

    function handleAutoSortByFormat() {
        var currentAppId = apps[index] && apps[index].id ? apps[index].id : null;
        var favorites = [], appStoreApps = [], otherApps = [];
        for (var i = 0; i < apps.length; i++) {
            if (isFavorite(apps[i].id)) favorites.push(apps[i]);
            else if (isVerifiedAppStoreApp(apps[i].id)) appStoreApps.push(apps[i]);
            else otherApps.push(apps[i]);
        }
        apps = favorites.concat(appStoreApps, otherApps); putBuiltinMovieFirst(); saveAppOrder(); writeJson(SORT_MODE_KEY, "name");
        if (currentAppId) { for (var j = 0; j < apps.length; j++) { if (apps[j].id === currentAppId) { index = j; break; } } } else { index = 0; }
        closeActionMenu(); createApps(); focusApp(); showToast("Đã sắp xếp theo định dạng");
    }

    function positionActionMenu() {
        var menu = document.getElementById("bintv-app-menu"); var button = buttons[index]; if (!menu || !button) return;
        var rect = button.getBoundingClientRect();
        var left = rect.left, top = rect.top - menu.offsetHeight - 12;
        if (top < 20) top = rect.bottom + 12;
        if (left + menu.offsetWidth > window.innerWidth - 20) left = window.innerWidth - menu.offsetWidth - 20;
        if (left < 20) left = 20;
        menu.style.left = Math.round(left) + "px"; menu.style.top = Math.round(top) + "px";
    }

    function updateMenuFocus() {
        var menu = document.getElementById("bintv-app-menu"); if (!menu) return;
        var rows = menu.querySelectorAll(".bintv-menu-item");
        var selected = parseInt(menu.getAttribute("data-menu-index") || "0", 10);
        if (selected < 0) selected = rows.length - 1; if (selected >= rows.length) selected = 0;
        menu.setAttribute("data-menu-index", String(selected));
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("focus", i === selected);
    }

    function activateMenuItem() {
        var menu = document.getElementById("bintv-app-menu"); if (!menu) return;
        var rows = menu.querySelectorAll(".bintv-menu-item");
        var selected = parseInt(menu.getAttribute("data-menu-index") || "0", 10);
        if (rows[selected]) rows[selected].click();
    }

    function closeActionMenu() {
        var menu = document.getElementById("bintv-app-menu");
        if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
        actionMenuOpen = false;
    }

    function deleteCurrentApp() {
        var item = apps[index]; if (!item || !item.id) return;
        if (isBuiltinMovieApp(item)) { closeActionMenu(); showToast("Không thể xóa ứng dụng Phim"); focusApp(); return; }
        addToHidden([item.id]); apps.splice(index, 1); saveAppOrder();
        closeActionMenu(); if (index >= apps.length) index = Math.max(0, apps.length - 1);
        createApps(); focusApp();
    }

    function updateList() {
        closeActionMenu(); dropMultiSelectMode(); isMovingApp = false; selectedAppIds = {};
        loadInstalledApps(function (ok) {
            if (!ok) { showToast("Không thể cập nhật danh sách"); return; }
            if (index >= apps.length) index = Math.max(0, apps.length - 1);
            createApps(); focusApp(); showToast("Đã quét và đồng bộ lại danh sách từ TV");
        });
    }

    function showMultiSelectBar() {
        var bar = document.getElementById("bintv-multi-bar");
        if (!bar) { bar = document.createElement("div"); bar.id = "bintv-multi-bar"; document.body.appendChild(bar); }
        bar.innerHTML = '<span class="multi-title">Đã chọn: 0</span><span class="multi-help">OK: Chọn/Bỏ chọn</span><button class="multi-action" data-action="delete">Xóa đã chọn</button><button class="multi-action" data-action="cancel">Hủy</button>';
        var controls = bar.querySelectorAll(".multi-action");
        for (var i = 0; i < controls.length; i++) {
            controls[i].addEventListener("click", function () {
                if (this.getAttribute("data-action") === "delete") deleteSelectedApps();
                else { selectedAppIds = {}; dropMultiSelectMode(); createApps(); focusApp(); }
            });
        }
        updateMultiSelectBar();
    }

    function updateMultiSelectBar() {
        var bar = document.getElementById("bintv-multi-bar"); if (!bar) return;
        var count = Object.keys(selectedAppIds).filter(function(id) { return selectedAppIds[id]; }).length;
        var title = bar.querySelector(".multi-title"); if (title) title.textContent = "Đã chọn: " + count;
    }

    function closeMultiSelectBar() { var bar = document.getElementById("bintv-multi-bar"); if (bar && bar.parentNode) bar.parentNode.removeChild(bar); }

    function showMultiSelectMenu() {
        var menu = ensureActionMenu(); menu.innerHTML = "";
        var items = [
            { label: "Xóa đã chọn", action: deleteSelectedApps },
            { label: "Hủy", action: function() { selectedAppIds = {}; dropMultiSelectMode(); createApps(); focusApp(); closeActionMenu(); } }
        ];
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var row = document.createElement("div"); row.className = "bintv-menu-item"; row.textContent = item.label;
                row.addEventListener("click", function () { item.action(); }); menu.appendChild(row);
            })(items[i]);
        }
        actionMenuOpen = true; menu.setAttribute("data-menu-index", "0"); updateMenuFocus(); positionActionMenu();
    }

    function showToast(message) {
        var toast = document.getElementById("bintv-toast");
        if (!toast) { toast = document.createElement("div"); toast.id = "bintv-toast"; document.body.appendChild(toast); }
        toast.textContent = message; toast.classList.add("show");
        if (toast._timer) clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { toast.classList.remove("show"); }, 3500);
    }

    /* =====================================================
       EXIT / KILL PROCESSES
       ===================================================== */
    function trackLaunchedApp(appId) {
        if (!appId || appId === getCurrentAppId()) return;
        if (launchedAppIds.indexOf(appId) === -1) launchedAppIds.push(appId);
    }

    function clearSessionReferences() {
        if (okPressTimer) { clearTimeout(okPressTimer); okPressTimer = null; }
        okKeyDown = false; longPressTriggered = false; suppressNextOkUp = false; selectedAppIds = {};
        if (movieBrowserOpen || moviePlayerOpen) closeMovieBrowser();
        closeActionMenu(); closeExitModal();
        if (wallpaperTimer) { clearInterval(wallpaperTimer); wallpaperTimer = null; wallpaperWasPausedForHidden = true; }
    }

    function resumeSessionResources() {
        if (wallpaperWasPausedForHidden && !wallpaperTimer) { startWallpaperRotation(); wallpaperWasPausedForHidden = false; }
        if (!cleanupInProgress) updateWeather(true);
        focusApp();
    }

    function killLaunchedApps(done) {
        var pendingIds = [];
        var finished = false;
        var operationTimer = null;

        function finishKillLaunchedApps() {
            if (finished) return;
            finished = true;
            if (operationTimer) { clearTimeout(operationTimer); operationTimer = null; }
            launchedAppIds = [];
            if (done) done();
        }

        for (var i = 0; i < launchedAppIds.length; i++) {
            if (launchedAppIds[i] && launchedAppIds[i] !== getCurrentAppId()) {
                if (pendingIds.indexOf(launchedAppIds[i]) === -1) pendingIds.push(launchedAppIds[i]);
            }
        }
        if (pendingIds.length === 0 || TEST_MODE || !tizen.application || !tizen.application.getAppsContext || !tizen.application.kill) { finishKillLaunchedApps(); return; }

        operationTimer = setTimeout(finishKillLaunchedApps, 4500);
        try {
            tizen.application.getAppsContext(function (contexts) {
                if (finished) return;
                var contextIds = [];
                for (var i = 0; i < contexts.length; i++) {
                    var ctx = contexts[i]; if (!ctx || !ctx.appId || !ctx.id || pendingIds.indexOf(ctx.appId) === -1 || ctx.appId === getCurrentAppId()) continue;
                    if (contextIds.indexOf(ctx.id) === -1) contextIds.push(ctx.id);
                }
                function killNext(pos) {
                    if (finished) return;
                    if (pos >= contextIds.length) { finishKillLaunchedApps(); return; }
                    var killFinished = false;
                    var killTimer = setTimeout(continueKill, 1000);
                    function continueKill() {
                        if (killFinished || finished) return;
                        killFinished = true;
                        if (killTimer) { clearTimeout(killTimer); killTimer = null; }
                        killNext(pos + 1);
                    }
                    try { tizen.application.kill(contextIds[pos], continueKill, continueKill); } catch (e) { continueKill(); }
                }
                killNext(0);
            }, finishKillLaunchedApps);
        } catch (e) { finishKillLaunchedApps(); }
    }

    function stopCleanupResources() {
        cancelLongPressTimer();
        if (wallpaperTimer) { clearInterval(wallpaperTimer); wallpaperTimer = null; }
        wallpaperWasPausedForHidden = false;
        if (dateTimeTimer) { clearInterval(dateTimeTimer); dateTimeTimer = null; }
        if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
        var toast = document.getElementById("bintv-toast");
        if (toast && toast._timer) { clearTimeout(toast._timer); toast._timer = null; }
        try { if (window.performance && window.performance.clearResourceTimings) window.performance.clearResourceTimings(); } catch (e) {}
    }

    function clearBinTVManagedCache(done) {
        var finished = false;
        var remaining = 2;
        var cleanupTimer = setTimeout(finishCleanup, 2500);

        function finishCleanup() {
            if (finished) return;
            finished = true;
            if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
            if (done) done();
        }

        function finishPart() {
            if (finished) return;
            remaining--;
            if (remaining <= 0) finishCleanup();
        }

        try { if (window.sessionStorage) window.sessionStorage.clear(); } catch (e) {}
        try { localStorage.removeItem(WEATHER_CACHE_KEY); } catch (e) {}

        (function clearWebViewCookies() {
            var partFinished = false;
            function partDone() { if (partFinished) return; partFinished = true; finishPart(); }
            try {
                if (window.tizen && tizen.websetting && tizen.websetting.removeAllCookies) {
                    tizen.websetting.removeAllCookies(partDone, partDone);
                } else {
                    partDone();
                }
            } catch (e) { partDone(); }
        })();

        (function clearOriginCacheStorage() {
            var partFinished = false;
            function partDone() { if (partFinished) return; partFinished = true; finishPart(); }
            try {
                if (!window.caches || typeof window.caches.keys !== "function" || typeof window.caches.delete !== "function") { partDone(); return; }
                var keysRequest = window.caches.keys();
                if (!keysRequest || typeof keysRequest.then !== "function") { partDone(); return; }
                keysRequest.then(function (cacheNames) {
                    cacheNames = cacheNames || [];
                    if (cacheNames.length === 0) { partDone(); return; }
                    var pending = cacheNames.length;
                    function cacheDone() { pending--; if (pending <= 0) partDone(); }
                    for (var i = 0; i < cacheNames.length; i++) {
                        try {
                            var deleteRequest = window.caches.delete(cacheNames[i]);
                            if (deleteRequest && typeof deleteRequest.then === "function") deleteRequest.then(cacheDone, cacheDone);
                            else cacheDone();
                        } catch (e) { cacheDone(); }
                    }
                }, partDone);
            } catch (e) { partDone(); }
        })();
    }

    function closeBinTVApplication() {
        var exitRequested = false;
        try {
            if (window.tizen && tizen.application) {
                exitRequested = true;
                tizen.application.getCurrentApplication().exit();
            }
        } catch (e) { exitRequested = false; }

        // [Phim LAN14q 2026-09] Don gian hoa force quit:
        // (1) IPC __phimDebug.exit() -> main.js -> app.quit() -> before-quit kill server
        // (2) window.close() (fallback neu IPC fail)
        // (3) Hien thi overlay neu ca 2 fail
        try { phimLog && phimLog("closeBinTVApplication: tizen=" + exitRequested + " hasPhimDebug=" + !!(window.__phimDebug && window.__phimDebug.exit)); } catch (e) {}

        if (!exitRequested) {
            try {
                if (window.__phimDebug && typeof window.__phimDebug.exit === "function") {
                    try { phimLog && phimLog("closeBinTVApplication: calling __phimDebug.exit()"); } catch (e) {}
                    window.__phimDebug.exit();
                    exitRequested = true;
                } else {
                    try { phimLog && phimLog("closeBinTVApplication: __phimDebug.exit NOT available, trying window.close()"); } catch (e) {}
                    try { window.close(); exitRequested = true; } catch (closeErr) {
                        try { phimLog && phimLog("closeBinTVApplication: window.close() failed " + closeErr.message); } catch (e) {}
                    }
                }
            } catch (ipcErr) {
                try { phimLog && phimLog("closeBinTVApplication: __phimDebug.exit threw " + ipcErr.message); } catch (e) {}
            }
        }

        if (!exitRequested) {
            try { phimLog && phimLog("closeBinTVApplication: all methods failed, showing overlay"); } catch (e) {}
            try {
                var body = document.body;
                if (body) {
                    var overlay = document.createElement("div");
                    overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.92);color:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;flex-direction:column;font-family:Arial,sans-serif;";
                    overlay.innerHTML = '<div style="font-size:48px;margin-bottom:24px;">✓</div><div style="font-size:32px;">Đã nhận lệnh thoát</div><div style="font-size:20px;margin-top:16px;opacity:0.7;">Vui lòng đóng cửa sổ thủ công</div>';
                    body.appendChild(overlay);
                }
            } catch (e) {}
        }

        if (exitRequestFallbackTimer) clearTimeout(exitRequestFallbackTimer);
        exitRequestFallbackTimer = setTimeout(function () {
            exitRequestFallbackTimer = null;
            cleanupInProgress = false;
        }, 1500);
    }

    function scanAndExitBinTV() {
        if (cleanupInProgress) return;
        try { phimLog && phimLog("scanAndExitBinTV: Quét button clicked"); } catch (e) {}
        cleanupInProgress = true;
        closeActionMenu(); closeExitModal(); clearSessionReferences(); stopCleanupResources();
        clearBinTVManagedCache(function () {
            killLaunchedApps(function () { closeBinTVApplication(); });
        });
    }

    function exitBinTV() {
        if (cleanupInProgress) return;
        try { phimLog && phimLog("exitBinTV: Thoát button clicked"); } catch (e) {}
        cleanupInProgress = true;
        closeExitModal(); cancelLongPressTimer();
        closeBinTVApplication();
    }

    function ensureExitModal() {
        var modal = document.getElementById("bintv-exit-modal");
        if (modal) return modal;
        modal = document.createElement("div"); modal.id = "bintv-exit-modal";
        // [Phim LAN14n 2026-09] Phim standalone: chi giu 2 nut (Thoat + Huy).
        // Nut "Quet" (scanAndExit) da bi xoa vi khong co Tizen de quet that.
        var exitBrand = BINTV_JVHD_STANDALONE ? "JVHD" : "BinTV";
        modal.innerHTML = '<div class="bintv-exit-backdrop"></div><div class="bintv-exit-dialog" role="dialog" aria-modal="true"><div class="bintv-exit-title">Thoát ' + exitBrand + '?</div><div class="bintv-exit-message">Đóng hoàn toàn ứng dụng và tắt các tiến trình đang chạy.</div><div class="bintv-exit-actions"><button type="button" class="bintv-exit-button" data-exit-action="exit">Thoát</button><button type="button" class="bintv-exit-button" data-exit-action="cancel">Hủy</button></div></div>';
        document.body.appendChild(modal);
        var controls = modal.querySelectorAll(".bintv-exit-button");
        for (var i = 0; i < controls.length; i++) {
            controls[i].addEventListener("click", function () {
                var action = this.getAttribute("data-exit-action");
                try { phimLog && phimLog("exit-modal: button clicked action=" + action); } catch (e) {}
                if (action === "exit") exitBinTV();
                else closeExitModal();
            });
        }
        return modal;
    }

    function updateExitModalFocus() {
        var modal = document.getElementById("bintv-exit-modal"); if (!modal) return;
        var buttonsModal = modal.querySelectorAll(".bintv-exit-button");
        var selected = parseInt(modal.getAttribute("data-focus-index") || "0", 10);
        if (selected < 0) selected = buttonsModal.length - 1; if (selected >= buttonsModal.length) selected = 0;
        modal.setAttribute("data-focus-index", String(selected));
        for (var i = 0; i < buttonsModal.length; i++) buttonsModal[i].classList.toggle("focus", i === selected);
        if (buttonsModal[selected]) try { buttonsModal[selected].focus(); } catch (e) {}
    }

    function showExitModal() {
        if (exitModalOpen || cleanupInProgress) return; closeActionMenu();
        if (isMultiSelectMode) { selectedAppIds = {}; dropMultiSelectMode(); }
        if (isMovingApp) { isMovingApp = false; if (appsContainer) appsContainer.classList.remove("move-mode"); }
        exitModalReturnIndex = index;
        var modal = ensureExitModal(); exitModalOpen = true; exitModalOkDown = false;
        modal.setAttribute("data-focus-index", "0"); modal.classList.add("show"); updateExitModalFocus();
    }

    function closeExitModal() {
        var modal = document.getElementById("bintv-exit-modal");
        var wasOpen = exitModalOpen;
        exitModalOpen = false; exitModalOkDown = false;
        if (modal) modal.classList.remove("show");
        if (wasOpen && !cleanupInProgress && apps.length > 0) {
            index = exitModalReturnIndex;
            if (index < 0) index = 0;
            if (index >= apps.length) index = apps.length - 1;
        }
        focusApp();
        // [BinTV JVHD-STANDALONE 2026-08] Bản độc lập: "Hủy" thoát dialog nhưng
        // không có launcher để quay về -> mở lại cổng PIN JVHD (không deadlock).
        if (BINTV_JVHD_STANDALONE && wasOpen && !jvhdScreenOpen && !jvhdPinOpen && !moviePlayerOpen && !jvhdPlayerSession) setTimeout(launchBuiltinJvhd, 0);
        // [Phim LAN14r 2026-09] Phim standalone: "Hủy" chi can dong dialog.
        // Browser Phim da mo san (handleMovieBackAction return false de browser
        // khong bi dong), nen khong can goi launchBuiltinMovie() (gay thong bao
        // "Dang mo Phim tu cache" va man hinh den tam thoi).
        if (window.__BINTV_PHIM_STANDALONE__ && wasOpen && !cleanupInProgress) {
            // Dam bao browser Phim dang hien thi (co the da bi hide boi CSS)
            try {
                var phimBrowserEl = document.getElementById("bintv-movie-browser");
                if (phimBrowserEl) phimBrowserEl.classList.add("show");
            } catch (e) {}
        }
    }

    function handleBackKey() {
        if (jvhdUserGateOpen) return true; // [BinTV USER-AUTH] Back khong bo qua xac thuc username
        if (jvhdPinOpen) { cancelJvhdPinGate(false); if (BINTV_JVHD_STANDALONE) showExitModal(); return true; }
        if (jvhdResolveInProgress) { cancelJvhdResolution(true); return true; }
        if (jvhdScreenOpen) { closeJvhdScreen(); if (BINTV_JVHD_STANDALONE) showExitModal(); return true; }
        if (exitModalOpen) { closeExitModal(); return true; }
        if (actionMenuOpen) { closeActionMenu(); return true; }
        if (isMultiSelectMode) { selectedAppIds = {}; dropMultiSelectMode(); createApps(); focusApp(); return true; }
        if (isMovingApp) { isMovingApp = false; if (appsContainer) appsContainer.classList.remove("move-mode"); createApps(); focusApp(); return true; }
        showExitModal(); return true;
    }

    function getRemoteKeyCode(e) {
        if (!e) return 0;
        return e.keyCode || e.which || 0;
    }

    function getRemoteKeyName(e) {
        if (!e) return "";
        return String(e.key || e.keyName || "").toLowerCase();
    }

    function isRemoteBackEvent(e) {
        var keyCode = getRemoteKeyCode(e);
        var keyName = getRemoteKeyName(e);
        return keyCode === 10009 || keyCode === 27 || keyCode === 8 ||
            keyName === "escape" || keyName === "back" || keyName === "browserback" ||
            keyName === "goback" || keyName === "xf86back";
    }

    function isRemoteExitEvent(e) {
        var keyCode = getRemoteKeyCode(e);
        var keyName = getRemoteKeyName(e);
        return keyCode === 10182 || keyName === "exit" || keyName === "xf86exit";
    }

    function preventRemoteDefault(e) {
        try { if (e && e.preventDefault) e.preventDefault(); } catch (error) {}
        try { if (e && e.stopPropagation) e.stopPropagation(); } catch (error) {}
    }

    function handleRemoteBackOrExit(e) {
        if (!isRemoteBackEvent(e) && !isRemoteExitEvent(e)) return;

        var now = Date.now();
        if ((e && e.__bintvBackHandled) || now - lastBackSignalAt < 300) {
            preventRemoteDefault(e);
            return;
        }
        try { if (e) e.__bintvBackHandled = true; } catch (markError) {}
        lastBackSignalAt = now;

        if (handleMovieBackAction()) {
            preventRemoteDefault(e);
            return;
        }

        if (!cleanupInProgress) handleBackKey();
        preventRemoteDefault(e);
    }

    function registerRemoteExitKey() {
        try {
            if (window.tizen && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
                tizen.tvinputdevice.registerKey("Exit");
                try { tizen.tvinputdevice.registerKey("MediaRewind"); } catch (rewindError) {}
                try { tizen.tvinputdevice.registerKey("MediaFastForward"); } catch (forwardError) {}
            }
        } catch (e) {}
    }

    function getMovieRequestErrorMessage(prefix, error) {
        var detail = String((error && error.message) || "");
        var errorName = String((error && error.name) || "");
        if (detail.toLowerCase().indexOf("timeout") !== -1) return prefix + ": yêu cầu quá thời gian";
        if (detail.indexOf("HTTP ") === 0) return prefix + ": lỗi " + detail;
        if (errorName === "SyntaxError" || detail.toLowerCase().indexOf("json") !== -1) return prefix + ": JSON không hợp lệ";
        return prefix + ": không thể kết nối";
    }

    function extractMovieTargetUrl(data) {
        var payload = data;
        if (data && data.record && typeof data.record === "object") payload = data.record;
        if (!payload || typeof payload.target_url !== "string") return "";
        return payload.target_url.replace(/^\s+|\s+$/g, "");
    }

    // [build 229] Base URL của addon SỞ HỮU catalog (hỗ trợ nhiều addon).
    // Catalog được gắn `_addon` lúc bootstrap; nếu thiếu → dùng addon đầu.
    function catalogAddonBase(catalog) {
        var base = catalog && (catalog._addon || catalog._bintvAddonBase);
        if (typeof base === "string" && base) return base;
        if (catalog && catalog._bintvMemberCatalogs && catalog._bintvMemberCatalogs.length) {
            var first = catalog._bintvMemberCatalogs[0];
            var firstBase = first && (first._addon || first._bintvAddonBase);
            if (typeof firstBase === "string" && firstBase) return firstBase;
        }
        return movieBaseUrl;
    }

    // [build 229] Gộp catalog/meta của NHIỀU addon thành 1 manifest thống
    // nhất. Mỗi catalog giữ nguyên cấu trúc chuẩn Stremio + thêm `_addon`
    // (base URL của addon sở hữu) để mọi truy vấn sau dùng đúng nguồn.
    function mergeMovieAddonManifests(addons) {
        var merged = { id: "", version: "", name: "", description: "",
                       resources: [], types: [], catalogs: [], idPrefixes: [] };
        var seenCatalog = {};
        for (var i = 0; i < addons.length; i++) {
            var addon = addons[i];
            var manifest = addon && addon.manifest ? addon.manifest : {};
            if (!merged.name && manifest.name) merged.name = manifest.name;
            if (!merged.id && manifest.id) merged.id = manifest.id;
            if (Array.isArray(manifest.resources)) merged.resources = merged.resources.concat(manifest.resources);
            if (Array.isArray(manifest.types)) merged.types = merged.types.concat(manifest.types);
            if (Array.isArray(manifest.idPrefixes)) merged.idPrefixes = merged.idPrefixes.concat(manifest.idPrefixes);
            var catalogs = Array.isArray(manifest.catalogs) ? manifest.catalogs : [];
            for (var j = 0; j < catalogs.length; j++) {
                var catalog = catalogs[j];
                if (!catalog || !catalog.id) continue;
                var key = String(addon.baseUrl) + "|" + String(catalog.type || "") + "|" + String(catalog.id);
                if (seenCatalog[key]) continue;
                seenCatalog[key] = true;
                var copy = {};
                for (var k in catalog) if (Object.prototype.hasOwnProperty.call(catalog, k)) copy[k] = catalog[k];
                copy._addon = addon.baseUrl;
                copy._addonName = manifest.name || "";
                merged.catalogs.push(copy);
            }
        }
        return merged;
    }

    function isValidMovieTargetUrl(url) {
        if (!url) return false;
        try {
            var link = document.createElement("a");
            link.href = url;
            return (link.protocol === "http:" || link.protocol === "https:") && !!link.hostname;
        } catch (e) { return false; }
    }

    function normalizeMovieManifestUrl(url) {
        var normalized = String(url || "").replace(/^\s+|\s+$/g, "");
        return normalized.replace(/\/+$/, "");
    }

    function getMovieBaseUrl(manifestUrl) {
        return String(manifestUrl || "").replace(/\/manifest\.json$/i, "");
    }

    function applyVietnameseMovieImeHints(input) {
        try { document.documentElement.setAttribute("lang", "vi-VN"); } catch (rootLanguageError) {}
        try { if (document.body) document.body.setAttribute("lang", "vi-VN"); } catch (bodyLanguageError) {}
        if (!input) return;
        try {
            input.setAttribute("lang", "vi-VN");
            input.setAttribute("xml:lang", "vi-VN");
            input.setAttribute("inputmode", "text");
            input.setAttribute("enterkeyhint", "search");
            input.setAttribute("spellcheck", "true");
            input.setAttribute("aria-label", "Tên phim cần tìm bằng tiếng Việt");
        } catch (inputLanguageError) {}
    }

    function refreshVietnameseMovieImeLanguage(input) {
        applyVietnameseMovieImeHints(input);
        if (!input) return;
        setTimeout(function () {
            if (!movieSearchOpen || document.activeElement !== input) return;
            try {
                input.setAttribute("lang", "vi");
                input.setAttribute("xml:lang", "vi");
                setTimeout(function () {
                    if (!movieSearchOpen || document.activeElement !== input) return;
                    applyVietnameseMovieImeHints(input);
                }, 0);
            } catch (imeLanguageRefreshError) {}
        }, 120);
    }

    // [BinTV TOUCH 2026-08] Điều khiển bằng cảm ứng cho trình phát video: trên máy
    // tính bảng/điện thoại Android không có remote hay bàn phím vật lý, người dùng
    // không thể mở timeline để tua hay chọn chất lượng. Giải pháp: mọi cú chạm
    // được bơm thành SỰ KIỆN PHÍM ẢO đi qua đúng trình xử lý keydown/keyup hiện
    // có của app nên hành vi 100% giống bấm remote:
    //   - GIỮ ~1s NỬA TRÁI màn hình  -> giữ phím <-  (tua lùi, timeline tăng dần)
    //   - GIỮ ~1s NỬA PHẢI màn hình  -> giữ phím ->  (tua tiến)
    //   - GIỮ ~1s GIỮA-TRÊN          -> phím ^     (mở danh sách chất lượng/phụ đề)
    //   - GIỮ ~1s GIỮA-DƯỚI          -> phím v     (danh sách tập)
    //   - CHẠM NHANH (nhỏ hơn 1s)    -> phím OK    (tạm dừng/tiếp tục, chọn menu)
    // Giữ trái/phải còn tự lặp phím (auto-repeat) như remote thật: giữ càng lâu
    // bước tua càng lớn; THẢ TAY = keyup -> thực hiện tua đúng vị trí đã xem.
    // Chạm lên các nút/menu (chất lượng, tập, phụ đề) vẫn để trình duyệt xử lý
    // click như thường nên không phá giao diện chuỗi hiện có.
    var MOVIE_TOUCH_HOLD_DELAY = 1000;
    var MOVIE_TOUCH_REPEAT_INTERVAL = 260;
    var MOVIE_TOUCH_MOVE_SLOP = 30;
    var MOVIE_TOUCH_KEY_CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13 };
    // [build 242] `.movie-player-episodes-btn` đã bị gỡ khỏi DOM (nút TẬP chỉ
    // còn trong menu long-press) → bỏ khỏi selector, các class khác giữ nguyên.
    var MOVIE_TOUCH_INTERACTIVE_SELECTOR = ".jvhd-quality-option, .movie-subtitle-option, .movie-player-episode-option, button, a, input, select, textarea";
    var movieTouchTracker = null;
    var movieTouchHintShown = false;

    function dispatchMovieTouchKey(eventType, keyName) {
        try {
            var event;
            try {
                event = new KeyboardEvent(eventType, { key: keyName, code: keyName, bubbles: true, cancelable: true });
            } catch (constructorError) {
                event = document.createEvent("KeyboardEvent");
                event.initKeyboardEvent(eventType, true, true, window, keyName, 0, false, false, false, false);
            }
            var code = MOVIE_TOUCH_KEY_CODES[keyName] || 0;
            try {
                Object.defineProperty(event, "keyCode", { get: function () { return code; } });
                Object.defineProperty(event, "which", { get: function () { return code; } });
            } catch (defineError) {}
            window.dispatchEvent(event);
        } catch (dispatchError) {}
    }

    function movieTouchZoneKey(x, y) {
        var width = window.innerWidth || 1, height = window.innerHeight || 1;
        var column = x / width;
        if (column < 0.34) return "ArrowLeft";
        if (column > 0.66) return "ArrowRight";
        return (y / height) < 0.5 ? "ArrowUp" : "ArrowDown";
    }

    function cancelMovieTouchTracker(sendRelease) {
        var tracker = movieTouchTracker;
        if (!tracker) return;
        movieTouchTracker = null;
        if (tracker.holdTimer) { clearTimeout(tracker.holdTimer); tracker.holdTimer = null; }
        if (tracker.repeatTimer) { clearInterval(tracker.repeatTimer); tracker.repeatTimer = null; }
        if (sendRelease && tracker.fired && (tracker.key === "ArrowLeft" || tracker.key === "ArrowRight")) {
            dispatchMovieTouchKey("keyup", tracker.key);
        }
    }

    function setupMoviePlayerTouchControls(playerElement) {
        if (!playerElement || playerElement.__bintvTouchControls) return;
        playerElement.__bintvTouchControls = true;
        try { playerElement.style.touchAction = "manipulation"; } catch (styleError) {}

        function trackerTouch(event, listName) {
            var tracker = movieTouchTracker;
            if (!tracker || !event[listName]) return null;
            for (var i = 0; i < event[listName].length; i++) {
                if (event[listName][i].identifier === tracker.id) return event[listName][i];
            }
            return null;
        }

        playerElement.addEventListener("touchstart", function (event) {
            if (movieTouchTracker || !moviePlayerOpen || !event.touches || !event.touches.length) return;
            var touch = event.touches[0];
            var target = touch.target || event.target;
            var interactive = false;
            try { interactive = !!(target && target.closest && target.closest(MOVIE_TOUCH_INTERACTIVE_SELECTOR)); } catch (selectorError) {}
            if (!movieTouchHintShown) {
                movieTouchHintShown = true;
                showToast("Cảm ứng: giữ trái/phải để tua · giữ giữa-trên: chất lượng · chạm nhanh: tạm dừng/tiếp tục");
            }
            var tracker = {
                id: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                key: movieTouchZoneKey(touch.clientX, touch.clientY),
                fired: false,
                interactive: interactive,
                holdTimer: null,
                repeatTimer: null
            };
            movieTouchTracker = tracker;
            if (tracker.interactive) return; // chạm lên nút/menu: để click tự xử lý
            tracker.holdTimer = setTimeout(function () {
                if (movieTouchTracker !== tracker || tracker.interactive) return;
                tracker.fired = true;
                dispatchMovieTouchKey("keydown", tracker.key);
                if (tracker.key === "ArrowLeft" || tracker.key === "ArrowRight") {
                    tracker.repeatTimer = setInterval(function () {
                        if (movieTouchTracker !== tracker) return;
                        dispatchMovieTouchKey("keydown", tracker.key);
                    }, MOVIE_TOUCH_REPEAT_INTERVAL);
                }
            }, MOVIE_TOUCH_HOLD_DELAY);
        }, { passive: true });

        playerElement.addEventListener("touchmove", function (event) {
            var tracker = movieTouchTracker;
            if (!tracker) return;
            var touch = trackerTouch(event, "touches");
            if (!touch) return;
            if (tracker.fired) return; // đang giữ ->/-> để tua: giữ nguyên đến khi thả
            var deltaX = touch.clientX - tracker.startX, deltaY = touch.clientY - tracker.startY;
            if (Math.sqrt(deltaX * deltaX + deltaY * deltaY) > MOVIE_TOUCH_MOVE_SLOP) cancelMovieTouchTracker(false);
        }, { passive: true });

        playerElement.addEventListener("touchend", function (event) {
            var tracker = movieTouchTracker;
            if (!tracker) return;
            var touch = trackerTouch(event, "changedTouches");
            if (!touch) return;
            var wasFired = tracker.fired;
            var interactive = tracker.interactive;
            var key = tracker.key;
            cancelMovieTouchTracker(wasFired); // thả tay -> keyup -> thực hiện tua
            if (wasFired || interactive || !key) return;
            // Đang mở menu (chất lượng/phụ đề/tập): chạm ra vùng trống không tự
            // "OK" để tránh vô tình chọn nhầm; người dùng chạm thẳng vào lựa chọn.
            if (jvhdQualitySelectorOpen || movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen) return;
            dispatchMovieTouchKey("keydown", "Enter"); // chạm nhanh = phím OK
            dispatchMovieTouchKey("keyup", "Enter");
        });

        playerElement.addEventListener("touchcancel", function () {
            cancelMovieTouchTracker(true);
        });
    }

    function ensureMovieExperienceUI() {
        applyVietnameseMovieImeHints(null);
        var browser = document.getElementById("bintv-movie-browser");
        if (!browser) {
            browser = document.createElement("div");
            browser.id = "bintv-movie-browser";
            browser.innerHTML = '<div class="movie-browser-header"><div class="movie-browser-title">Phim</div><div id="bintv-movie-filters" class="movie-filter-bar"><button type="button" class="movie-filter-button" data-movie-filter="all">Tất cả</button><button id="bintv-movie-search-button" type="button" class="movie-search-button" aria-label="Tìm kiếm phim"><span class="movie-search-button-mic">🔍</span><span>Tìm kiếm</span></button><button id="bintv-movie-filter-menu-button" type="button" class="movie-filter-button" data-movie-filter="filter-menu">Lọc Phim</button></div><div id="bintv-movie-catalog-title" class="movie-browser-catalog-title"></div></div><div class="movie-browser-body"><div id="bintv-movie-catalogs" class="movie-catalogs"></div><div class="movie-content"><div id="bintv-movie-status" class="movie-status"></div><div id="bintv-movie-grid" class="movie-grid"></div></div></div><div id="bintv-movie-search" class="movie-search-overlay"><div class="movie-search-dialog"><div class="movie-search-title">Tìm kiếm phim</div><div id="bintv-movie-search-status" class="movie-search-status">Nhập tên phim bằng bàn phím TV</div><input id="bintv-movie-search-input" class="movie-search-input" type="text" inputmode="text" lang="vi-VN" xml:lang="vi-VN" enterkeyhint="search" autocomplete="off" autocapitalize="none" spellcheck="true" placeholder="Nhập tên phim..." aria-label="Tên phim cần tìm bằng tiếng Việt"><div class="movie-search-actions"><button id="bintv-movie-search-keyboard" type="button" class="movie-search-action movie-search-keyboard" data-search-index="1"><span class="movie-search-keyboard-icon">⌨</span> Bàn Phím</button><button id="bintv-movie-search-submit" type="button" class="movie-search-action" data-search-index="2">Tìm kiếm</button></div><div class="movie-search-help">←/→: Chọn · OK: Xác nhận · Back: Đóng</div></div></div><div id="bintv-movie-filter-menu" class="movie-filter-menu"><div class="movie-filter-menu-dialog"><div class="movie-filter-menu-title">Lọc Phim</div><div id="bintv-movie-filter-menu-list" class="movie-filter-menu-list"></div><div class="movie-filter-menu-help">↑/↓: Chọn · OK: Áp dụng · Back: Đóng</div></div></div><div id="bintv-movie-episodes" class="movie-episodes"><div class="movie-episodes-dialog"><div id="bintv-movie-episodes-title" class="movie-episodes-title">Chọn tập</div><div id="bintv-movie-episodes-list" class="movie-episodes-list"></div><div class="movie-episodes-help">←/→/↑/↓: Chọn tập · OK: Phát · Back: Quay lại</div></div></div>';
            document.body.appendChild(browser);
        }

        // [Phim ANDROID 2026-09] Gan listener dieu khien o CA HAI nhanh:
        // index.html chua DOM tinh cho #bintv-movie-browser nen nhanh tao DOM
        // o tren KHONG chay tren ban Windows, lam cac nut header (Tat ca /
        // Tim kiem / Loc Phim / Ban Phim / nut Tim kiem / o nhap) khong co
        // click-listener - ban Windows chi dung D-pad nen khong lo. Tren Android
        // can thao tac cham nen phai gan listener: dung NGUYEN VAN cac handler
        // cua nhanh tao DOM (copy nguyen doi code), co guard chong gan 2 lan.
        if (!browser.__bintvMovieControlsWired) {
            browser.__bintvMovieControlsWired = true;

            var filterButtons = browser.querySelectorAll(".movie-filter-button");
            movieFilterButtonElements = filterButtons;
            for (var filterIndex = 0; filterIndex < filterButtons.length; filterIndex++) {
                (function (buttonIndex) {
                    filterButtons[buttonIndex].addEventListener("click", function () {
                        movieFilterIndex = buttonIndex;
                        movieBrowserFocusArea = "filters";
                        var selectedMode = this.getAttribute("data-movie-filter") || "all";
                        if (selectedMode === "filter-menu") { openMovieFilterMenu(); return; }
                        movieFilterMode = "all";
                        applyCurrentMovieFilter();
                    });
                })(filterIndex);
            }
            var searchButton = document.getElementById("bintv-movie-search-button");
            var searchInput = document.getElementById("bintv-movie-search-input");
            var keyboardButton = document.getElementById("bintv-movie-search-keyboard");
            var submitButton = document.getElementById("bintv-movie-search-submit");
            applyVietnameseMovieImeHints(searchInput);
            if (searchButton) searchButton.addEventListener("click", function () { openMovieSearch(); });
            if (searchInput) {
                searchInput.addEventListener("focus", function () { movieSearchEditing = true; movieSearchFocusIndex = 0; updateMovieSearchFocus(); });
                searchInput.addEventListener("blur", function () { finishMovieSearchKeyboardInput(); });
                searchInput.addEventListener("input", function () { movieSearchQuery = this.value || ""; });
                searchInput.addEventListener("change", function () { movieSearchQuery = this.value || ""; });
                searchInput.addEventListener("compositionend", function () { movieSearchQuery = this.value || ""; });
                searchInput.addEventListener("keyup", function () { movieSearchQuery = this.value || ""; });
                searchInput.addEventListener("keydown", function (event) {
                    var code = event && (event.keyCode || event.which);
                    if (code === 65376 || (event && event.key === "Done")) setTimeout(function () {
                        try { searchInput.blur(); } catch (e) {}
                        finishMovieSearchKeyboardInput();
                    }, 0);
                });
            }
            if (keyboardButton) keyboardButton.addEventListener("click", function () { focusMovieSearchKeyboard(false); });
            if (submitButton) submitButton.addEventListener("click", function () { submitMovieSearch(); });
        }

        var player = document.getElementById("bintv-movie-player");
        if (!player) {
            player = document.createElement("div");
            player.id = "bintv-movie-player";
            player.innerHTML = '<object id="bintv-movie-avplayer" type="application/avplayer"></object><video id="bintv-movie-html5-player"></video><div id="bintv-movie-subtitle-text" class="movie-subtitle-text"></div><div class="movie-player-overlay"><div id="bintv-movie-player-status" class="movie-player-status">Đang chuẩn bị phát…</div></div><div id="bintv-movie-seek-timeline" class="movie-seek-timeline" aria-hidden="true"><div class="movie-seek-timeline-times"><span id="bintv-movie-seek-current">00:00</span><span id="bintv-movie-seek-target">00:00</span><span id="bintv-movie-seek-duration">00:00</span></div><div class="movie-seek-timeline-track"><div id="bintv-movie-seek-progress" class="movie-seek-timeline-progress"></div><div id="bintv-movie-seek-thumb" class="movie-seek-timeline-thumb"></div></div></div><div id="bintv-movie-subtitle-menu" class="movie-subtitle-menu"><div class="movie-subtitle-dialog"><div class="movie-subtitle-title">Vietsub</div><div id="bintv-movie-subtitle-status" class="movie-subtitle-status">Đang tìm phụ đề…</div><div id="bintv-movie-subtitle-list" class="movie-subtitle-list"></div></div></div><div id="bintv-movie-player-episodes" class="movie-player-episodes"><div class="movie-player-episodes-dialog"><div class="movie-player-episodes-title">Danh sách tập</div><div id="bintv-movie-player-episodes-list" class="movie-player-episodes-list"></div></div></div>';
            document.body.appendChild(player);
        }
        // [BinTV TOUCH 2026-08] gắn điều khiển cảm ứng cho player (chạy 1 lần).
        setupMoviePlayerTouchControls(player);
        // [build 242 — 2026-09-15] KHÔNG còn nút "Tập" render trên player nên
        // không cần wire nút; chỉ đăng ký ĐIỂM VÀO hàm mở danh sách tập cho
        // menu long-press của Swift (window.__bintvOpenPlayerEpisodes).
        registerMoviePlayerEpisodeMenuEntry();
    }

    function hasInPlayerEpisodeList() {
        return !!(movieEpisodes && movieEpisodes.length > 1 && movieEpisodeType === "series" && !jvhdPlayerSession);
    }

    // =================================================================
    // [build 242 — 2026-09-15] ĐIỂM VÀO DUY NHẤT MỞ DANH SÁCH TẬP TRONG PLAYER
    // -----------------------------------------------------------------
    // Trước đây app.js render một nút "Tập" (#bintv-movie-player-episodes-btn)
    // ngay trên màn hình video và Swift (nút TẬP của menu long-press) phải
    // `.click()` vào nút đó. Nút đã bị LOẠI BỎ hoàn toàn khỏi DOM/CSS nên
    // menu long-press gọi thẳng hàm này:
    //   • player chưa mở            → false (không làm gì);
    //   • phim lẻ / không có ds tập → false (menu cũng không hiện nút TẬP);
    //   • phim bộ nhiều tập         → mở `#bintv-movie-player-episodes`.
    // Hành vi mở danh sách tập GIỮ NGUYÊN như khi bấm nút cũ (cùng một hàm
    // `openMoviePlayerEpisodeMenu`).
    // =================================================================
    function registerMoviePlayerEpisodeMenuEntry() {
        window.__bintvOpenPlayerEpisodes = function () {
            if (!moviePlayerOpen) return false;
            if (!hasInPlayerEpisodeList()) return false;
            openMoviePlayerEpisodeMenu();
            return true;
        };
    }
    registerMoviePlayerEpisodeMenuEntry();

    function syncNativeEpisodeList(showPicker) {
        try {
            var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.playVideoNative;
            if (!bridge) return;
            if (!hasInPlayerEpisodeList()) {
                bridge.postMessage({ action: "episodes", items: [] });
                return;
            }
            var items = [];
            for (var i = 0; i < movieEpisodes.length; i++) {
                var ep = movieEpisodes[i] || {};
                items.push({
                    id: String(ep.id || ""),
                    title: String(ep.title || ("Tập " + (ep.episode || i + 1))),
                    episode: ep.episode,
                    season: ep.season
                });
            }
            bridge.postMessage({
                action: "episodes",
                current: movieCurrentEpisodeIndex,
                show: !!showPicker,
                items: items
            });
        } catch (e) {}
    }

    function showMovieStatus(message, isError) {
        var status = document.getElementById("bintv-movie-status");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("error", !!isError);
    }

    function getMovieCatalogTypeLabel(catalog) {
        if (catalog && catalog.type === "series") return "Phim bộ";
        if (catalog && catalog.type === "tv") return "Truyền hình";
        return "Phim lẻ";
    }

    function getMovieCatalogSourceNumber(catalogIndex) {
        var catalog = movieCatalogs[catalogIndex];
        var type = catalog && catalog.type;
        var count = 0;
        for (var i = 0; i <= catalogIndex; i++) {
            if (movieCatalogs[i] && movieCatalogs[i].type === type) count++;
        }
        return count;
    }

    function getMovieCatalogDisplayName(catalogIndex) {
        var catalog = movieCatalogs[catalogIndex];
        if (catalog && catalog._bintvMergedCatalog) return catalog.name || getMovieCatalogTypeLabel(catalog);
        return getMovieCatalogTypeLabel(catalog) + " · Nguồn " + getMovieCatalogSourceNumber(catalogIndex);
    }

    function groupMovieCatalogsByType(catalogs) {
        var movies = [], series = [], others = [];
        for (var i = 0; i < catalogs.length; i++) {
            if (catalogs[i] && catalogs[i].type === "movie") movies.push(catalogs[i]);
            else if (catalogs[i] && catalogs[i].type === "series") series.push(catalogs[i]);
            else others.push(catalogs[i]);
        }
        return movies.concat(series, others);
    }

    function buildMergedMovieCatalogs(catalogs) {
        var grouped = groupMovieCatalogsByType(Array.isArray(catalogs) ? catalogs : []);
        var movies = [];
        var series = [];
        var others = [];
        for (var i = 0; i < grouped.length; i++) {
            if (grouped[i] && grouped[i].type === "movie") movies.push(grouped[i]);
            else if (grouped[i] && grouped[i].type === "series") series.push(grouped[i]);
            else if (grouped[i]) others.push(grouped[i]);
        }
        var merged = [];
        if (movies.length) merged.push({ type: "movie", id: "bintv-merged-movie", name: "Phim Lẻ", _bintvMergedCatalog: true, _bintvMemberCatalogs: movies });
        if (series.length) merged.push({ type: "series", id: "bintv-merged-series", name: "Phim Bộ", _bintvMergedCatalog: true, _bintvMemberCatalogs: series });
        return merged.concat(others);
    }

    function isMergedMovieCatalog(catalog) {
        return !!(catalog && catalog._bintvMergedCatalog && Array.isArray(catalog._bintvMemberCatalogs));
    }

    function getMergedMovieCatalogSignature(catalog) {
        if (!isMergedMovieCatalog(catalog)) return "";
        var identities = [];
        for (var i = 0; i < catalog._bintvMemberCatalogs.length; i++) identities.push(getMovieCatalogIdentity(catalog._bintvMemberCatalogs[i], movieBaseUrl));
        return identities.join("||");
    }

    function expandMergedMovieCatalogs(catalogs) {
        var expanded = [];
        var seen = {};
        var list = Array.isArray(catalogs) ? catalogs : [];
        for (var i = 0; i < list.length; i++) {
            var members = isMergedMovieCatalog(list[i]) ? list[i]._bintvMemberCatalogs : [list[i]];
            for (var memberIndex = 0; memberIndex < members.length; memberIndex++) {
                var member = members[memberIndex];
                var identity = getMovieCatalogIdentity(member, catalogAddonBase(member));
                if (!member || seen[identity]) continue;
                seen[identity] = true;
                expanded.push(member);
            }
        }
        return expanded;
    }

    function scheduleActiveMergedMovieCatalogRefresh() {
        if (!movieBrowserOpen) return;
        var activeCatalog = movieCatalogs[movieCatalogIndex];
        if (!isMergedMovieCatalog(activeCatalog)) return;
        if (moviePlayerOpen) { movieMergedRefreshPending = true; return; }
        if (movieMergedRefreshTimer) clearTimeout(movieMergedRefreshTimer);
        movieMergedRefreshTimer = setTimeout(function () {
            movieMergedRefreshTimer = null;
            if (!movieBrowserOpen || moviePlayerOpen || !isMergedMovieCatalog(movieCatalogs[movieCatalogIndex])) return;
            movieMergedRefreshPending = false;
            loadMovieCatalog(movieCatalogIndex, 0);
        }, 400);
    }

    function getMovieCatalogIdentity(catalog, baseUrl) {
        if (!catalog) return "";
        return String(baseUrl == null ? movieBaseUrl : baseUrl) + "|" + String(catalog.type || "") + "|" + String(catalog.id || "");
    }

    function hashMovieCacheIdentity(value) {
        var text = String(value || "");
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(36);
    }

    function getMoviePersistentCacheKey(kind, identity) {
        return "bintv_movie_" + kind + "_" + MOVIE_CACHE_VERSION + "_" + hashMovieCacheIdentity(identity);
    }

    function readMoviePersistentCache(kind, identity) {
        try {
            var raw = localStorage.getItem(getMoviePersistentCacheKey(kind, identity));
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || parsed.identity !== identity || !parsed.updatedAt || Date.now() - parsed.updatedAt > MOVIE_CATALOG_CACHE_STALE_MAX) return null;
            return parsed;
        } catch (e) { return null; }
    }

    function writeMoviePersistentCache(kind, identity, payload) {
        try {
            payload.identity = identity;
            localStorage.setItem(getMoviePersistentCacheKey(kind, identity), JSON.stringify(payload));
        } catch (e) {}
    }

    function removeMoviePersistentCache(kind, identity) {
        try { localStorage.removeItem(getMoviePersistentCacheKey(kind, identity)); } catch (e) {}
    }

    function buildMovieCatalogSignature(metas) {
        var list = Array.isArray(metas) ? metas : [];
        var parts = [String(list.length)];
        for (var i = 0; i < list.length; i++) {
            var item = list[i] || {};
            parts.push([item.id || "", item.type || "", item.name || "", item.releaseInfo || "", item.poster || ""].join(":"));
        }
        return hashMovieCacheIdentity(parts.join("|"));
    }

    function getMovieCatalogCacheEntry(catalog, baseUrl) {
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        if (!identity) return null;
        var entry = movieCatalogDataCache[identity];
        if (!entry) {
            var stored = readMoviePersistentCache("catalog", identity);
            if (stored && Array.isArray(stored.metas)) {
                entry = { identity: identity, updatedAt: stored.updatedAt, signature: stored.signature || buildMovieCatalogSignature(stored.metas), metas: stored.metas };
                movieCatalogDataCache[identity] = entry;
            }
        }
        if (!entry || Date.now() - entry.updatedAt > MOVIE_CATALOG_CACHE_STALE_MAX) return null;
        entry.isFresh = Date.now() - entry.updatedAt <= MOVIE_CATALOG_CACHE_TTL;
        return entry;
    }

    function hasCachedMovieCatalog(catalog, baseUrl) {
        return !!getMovieCatalogCacheEntry(catalog, baseUrl);
    }

    function getCachedMovieCatalogMetas(catalog, baseUrl) {
        var entry = getMovieCatalogCacheEntry(catalog, baseUrl);
        return entry ? entry.metas.slice(0) : null;
    }

    function invalidateMovieProcessedCatalogsForSource(catalog, baseUrl) {
        var sourceKey = getMovieCatalogSourceKey(catalog);
        var pools = movieAllCatalogs.length ? movieAllCatalogs : [catalog];
        for (var i = 0; i < pools.length; i++) {
            var candidate = pools[i];
            if (!candidate || (sourceKey && getMovieCatalogSourceKey(candidate) !== sourceKey)) continue;
            var identity = getMovieCatalogIdentity(candidate, baseUrl);
            delete movieProcessedCatalogCache[identity];
            removeMoviePersistentCache("processed", identity);
            delete movieFilterResultCache[identity + "|narrated"];
            delete movieFilterResultCache[identity + "|vietsub"];
            delete movieFilterResultCache[identity + "|vietnam"];
            delete movieFilterResultCache[identity + "|korea"];
            delete movieFilterResultCache[identity + "|western"];
            delete movieFilterResultCache[identity + "|cinema"];
            delete movieFilterResultCache[identity + "|china"];
            delete movieFilterResultCache[identity + "|brands"];
            delete movieFilterResultCache[identity + "|marvel"];
            removeMoviePersistentCache("filter_narrated", identity);
            removeMoviePersistentCache("filter_vietsub", identity);
            removeMoviePersistentCache("filter_vietnam", identity);
            removeMoviePersistentCache("filter_korea", identity);
            removeMoviePersistentCache("filter_western", identity);
            removeMoviePersistentCache("filter_cinema", identity);
            removeMoviePersistentCache("filter_china", identity);
            removeMoviePersistentCache("filter_brands", identity);
            removeMoviePersistentCache("filter_marvel", identity);
        }
        var mergedModes = ["narrated", "vietsub", "vietnam", "korea", "western", "cinema", "china", "brands", "marvel"];
        var mergedIdentities = [
            getMovieCatalogIdentity({ type: "movie", id: "bintv-merged-movie" }, baseUrl),
            getMovieCatalogIdentity({ type: "series", id: "bintv-merged-series" }, baseUrl)
        ];
        for (var mergedIndex = 0; mergedIndex < mergedIdentities.length; mergedIndex++) {
            for (var modeIndex = 0; modeIndex < mergedModes.length; modeIndex++) {
                delete movieFilterResultCache[mergedIdentities[mergedIndex] + "|" + mergedModes[modeIndex]];
                removeMoviePersistentCache("filter_" + mergedModes[modeIndex], mergedIdentities[mergedIndex]);
            }
        }
    }

    function cacheMovieCatalogMetas(catalog, metas, baseUrl) {
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        if (!identity) return null;
        var list = Array.isArray(metas) ? metas.slice(0) : [];
        var signature = buildMovieCatalogSignature(list);
        var previous = getMovieCatalogCacheEntry(catalog, baseUrl);
        var changed = !!(previous && previous.signature !== signature);
        var entry = { identity: identity, updatedAt: Date.now(), signature: signature, metas: list, isFresh: true };
        movieCatalogDataCache[identity] = entry;
        writeMoviePersistentCache("catalog", identity, { updatedAt: entry.updatedAt, signature: signature, metas: list });
        if (changed) {
            invalidateMovieProcessedCatalogsForSource(catalog, baseUrl);
            scheduleActiveMergedMovieCatalogRefresh();
        }
        return entry;
    }

    function copyMovieCatalogCacheItem(item) {
        var result = {};
        for (var key in item) {
            if (!Object.prototype.hasOwnProperty.call(item, key) || key === "videos") continue;
            result[key] = item[key];
        }
        return result;
    }

    function getMovieCatalogProcessingSignature(catalog, baseUrl) {
        var own = getMovieCatalogCacheEntry(catalog, baseUrl);
        var pairedType = catalog && catalog.type === "series" ? "movie" : "series";
        var pairedCatalog = catalog && (catalog.type === "movie" || catalog.type === "series") ? findPairedMovieCatalog(catalog, pairedType) : null;
        var paired = pairedCatalog ? getMovieCatalogCacheEntry(pairedCatalog, baseUrl) : null;
        return String(own ? own.signature : "") + "|" + String(paired ? paired.signature : "");
    }

    function getProcessedMovieCatalogEntry(catalog, baseUrl) {
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        if (!identity) return null;
        var entry = movieProcessedCatalogCache[identity];
        if (!entry) {
            var stored = readMoviePersistentCache("processed", identity);
            if (stored && Array.isArray(stored.items)) {
                entry = { identity: identity, updatedAt: stored.updatedAt, dependencySignature: stored.dependencySignature || "", items: stored.items };
                movieProcessedCatalogCache[identity] = entry;
            }
        }
        if (!entry || Date.now() - entry.updatedAt > MOVIE_CATALOG_CACHE_STALE_MAX) return null;
        var currentDependencySignature = getMovieCatalogProcessingSignature(catalog, baseUrl);
        if (entry.dependencySignature && currentDependencySignature && entry.dependencySignature !== currentDependencySignature) {
            delete movieProcessedCatalogCache[identity];
            removeMoviePersistentCache("processed", identity);
            return null;
        }
        entry.isFresh = Date.now() - entry.updatedAt <= MOVIE_CATALOG_CACHE_TTL;
        return entry;
    }

    function cacheProcessedMovieCatalog(catalog, items, baseUrl) {
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        if (!identity) return;
        var compact = [];
        var source = Array.isArray(items) ? items : [];
        for (var i = 0; i < source.length; i++) compact.push(copyMovieCatalogCacheItem(source[i]));
        var dependencySignature = getMovieCatalogProcessingSignature(catalog, baseUrl);
        var entry = { identity: identity, updatedAt: Date.now(), dependencySignature: dependencySignature, items: compact };
        movieProcessedCatalogCache[identity] = entry;
        writeMoviePersistentCache("processed", identity, { updatedAt: entry.updatedAt, dependencySignature: dependencySignature, items: compact });
    }

    function isMovieGenreFilterMode(mode) {
        return mode === "vietnam" || mode === "korea" || mode === "western" || mode === "cinema" || mode === "china" || mode === "brands" || mode === "marvel";
    }

    function getMovieFilterCacheEntry(catalog, mode, baseUrl) {
        if (!catalog || mode === "all") return null;
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        var key = identity + "|" + mode;
        var entry = movieFilterResultCache[key];
        if (!entry) {
            var stored = readMoviePersistentCache("filter_" + mode, identity);
            if (stored && isMovieGenreFilterMode(mode) && Array.isArray(stored.items)) {
                entry = { updatedAt: stored.updatedAt, items: stored.items };
                movieFilterResultCache[key] = entry;
            } else if (stored && Array.isArray(stored.itemIds)) {
                entry = { updatedAt: stored.updatedAt, itemIds: stored.itemIds };
                movieFilterResultCache[key] = entry;
            }
        }
        if (!entry || Date.now() - entry.updatedAt > MOVIE_CATALOG_CACHE_TTL) return null;
        if (isMovieGenreFilterMode(mode) && Array.isArray(entry.items)) {
            return { updatedAt: entry.updatedAt, items: sortMovieItemsByProductionYear(entry.items.slice(0)) };
        }
        var includedIds = {};
        for (var i = 0; i < entry.itemIds.length; i++) includedIds[entry.itemIds[i]] = true;
        var items = [];
        for (var j = 0; j < movieAllItems.length; j++) if (movieAllItems[j] && includedIds[movieAllItems[j].id]) items.push(movieAllItems[j]);
        return { updatedAt: entry.updatedAt, items: items };
    }

    function cacheMovieFilterResult(catalog, mode, items, baseUrl) {
        if (!catalog || mode === "all") return;
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        var list = Array.isArray(items) ? items : [];
        if (isMovieGenreFilterMode(mode)) {
            var compact = [];
            for (var compactIndex = 0; compactIndex < list.length; compactIndex++) compact.push(copyMovieCatalogCacheItem(list[compactIndex]));
            var vietnamEntry = { updatedAt: Date.now(), items: compact };
            movieFilterResultCache[identity + "|" + mode] = vietnamEntry;
            writeMoviePersistentCache("filter_" + mode, identity, { updatedAt: vietnamEntry.updatedAt, items: compact });
            return;
        }
        var ids = [];
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) ids.push(list[i].id);
        var entry = { updatedAt: Date.now(), itemIds: ids };
        movieFilterResultCache[identity + "|" + mode] = entry;
        writeMoviePersistentCache("filter_" + mode, identity, { updatedAt: entry.updatedAt, itemIds: ids });
    }

    function fetchMovieCatalogShared(catalog, baseUrl, success, failure) {
        var identity = getMovieCatalogIdentity(catalog, baseUrl);
        if (!identity) { failure(new Error("Invalid catalog")); return; }
        if (movieCatalogRequestInFlight[identity]) {
            movieCatalogRequestInFlight[identity].push({ success: success, failure: failure });
            return;
        }
        movieCatalogRequestInFlight[identity] = [{ success: success, failure: failure }];
        requestJson(buildMovieResourceUrlForBase(baseUrl, "catalog", catalog.type, catalog.id), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
            var metas = data && Array.isArray(data.metas) ? data.metas : [];
            cacheMovieCatalogMetas(catalog, metas, baseUrl);
            var listeners = movieCatalogRequestInFlight[identity] || [];
            delete movieCatalogRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].success(metas.slice(0)); } catch (callbackError) {}
        }, function (error) {
            var listeners = movieCatalogRequestInFlight[identity] || [];
            delete movieCatalogRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].failure(error); } catch (callbackError) {}
        });
    }

    function scanMovieCatalogAvailability(catalogs, scanToken, done, progress) {
        var list = Array.isArray(catalogs) ? catalogs : [];
        if (list.length === 0) { done([]); return; }
        var results = new Array(list.length);
        var nextIndex = 0;
        var completed = 0;
        var active = 0;

        function finishOne(index, catalog, metas, keepOnError) {
            active--;
            completed++;
            if (scanToken !== movieCatalogScanToken) return;
            if (keepOnError || (Array.isArray(metas) && metas.length > 0)) results[index] = catalog;
            if (progress) {
                var partial = [];
                for (var progressIndex = 0; progressIndex < results.length; progressIndex++) if (results[progressIndex]) partial.push(results[progressIndex]);
                (function (partialSnapshot, completedCatalog, isAvailable) {
                    setTimeout(function () {
                        if (scanToken !== movieCatalogScanToken) return;
                        try { progress(partialSnapshot, completedCatalog, isAvailable); } catch (progressError) {}
                    }, 0);
                })(partial, catalog, !!results[index]);
            }
            if (completed >= list.length) {
                var available = [];
                for (var i = 0; i < results.length; i++) if (results[i]) available.push(results[i]);
                done(available);
                return;
            }
            launchNext();
        }

        function launchNext() {
            if (scanToken !== movieCatalogScanToken) return;
            while (active < MOVIE_CATALOG_SCAN_CONCURRENCY && nextIndex < list.length) {
                (function (catalogIndex) {
                    var catalog = list[catalogIndex];
                    var cachedEntry = getMovieCatalogCacheEntry(catalog, movieBaseUrl);
                    active++;
                    if (cachedEntry) {
                        finishOne(catalogIndex, catalog, cachedEntry.metas, false);
                        if (Date.now() - cachedEntry.updatedAt > MOVIE_CATALOG_BACKGROUND_REFRESH_AGE) {
                            fetchMovieCatalogShared(catalog, catalogAddonBase(catalog), function () {}, function () {});
                        }
                        return;
                    }
                    fetchMovieCatalogShared(catalog, catalogAddonBase(catalog), function (metas) {
                        finishOne(catalogIndex, catalog, metas, false);
                    }, function () { finishOne(catalogIndex, catalog, null, true); });
                })(nextIndex++);
            }
        }
        launchNext();
    }

    function getMovieCatalogSourceKey(catalog) {
        if (!catalog) return "";
        var id = String(catalog.id || "").toLowerCase();
        var normalizedId = id.replace(/(?:[-_.])(movie|series)$/i, "");
        if (normalizedId && normalizedId !== id) return normalizedId;
        var name = String(catalog.name || "").toLowerCase().split("•")[0];
        return name.replace(/phim\s*(lẻ|le|bộ|bo)|hoạt\s*hình|series|movie/g, "").replace(/[^a-z0-9]+/g, "");
    }

    function findPairedMovieCatalog(catalog, pairedType) {
        var sourceKey = getMovieCatalogSourceKey(catalog);
        if (!sourceKey) return null;
        var pools = [movieAllCatalogs, movieCatalogs];
        for (var poolIndex = 0; poolIndex < pools.length; poolIndex++) {
            var pool = pools[poolIndex] || [];
            for (var i = 0; i < pool.length; i++) {
                var candidate = pool[i];
                if (candidate && candidate !== catalog && candidate.type === pairedType && getMovieCatalogSourceKey(candidate) === sourceKey) return candidate;
            }
        }
        return null;
    }

    function hasSeriesEpisodeHint(item) {
        if (!item) return false;
        var text = [item.name, item.description, item.releaseInfo].join(" ").toLowerCase();
        if (/\b(phim\s*bộ|tv\s*series|television\s*series|mini\s*series|miniseries)\b/i.test(text)) return true;
        if (/\bs\d{1,2}e\d{1,3}\b/i.test(text)) return true;
        var range = /(?:tập|tap|episode|ep\.?)[^0-9]{0,4}\d{1,4}\s*[-~–—]\s*(\d{1,4})/ig;
        var match;
        while ((match = range.exec(text))) if (parseInt(match[1], 10) > 1) return true;
        var episode = /(?:tập|tap|episode|ep\.?)[^0-9]{0,4}(\d{1,4})/ig;
        while ((match = episode.exec(text))) if (parseInt(match[1], 10) > 1) return true;
        var count = /(\d{1,4})\s*(?:tập|tap|episodes?)/ig;
        while ((match = count.exec(text))) if (parseInt(match[1], 10) > 1) return true;
        return false;
    }

    function countDistinctMovieEpisodes(videos) {
        if (!Array.isArray(videos) || videos.length === 0) return 0;
        var keys = {};
        var structured = false;
        var count = 0;
        for (var i = 0; i < videos.length; i++) {
            var video = videos[i] || {};
            var key = "";
            if (video.episode != null && !isNaN(parseInt(video.episode, 10))) {
                structured = true;
                key = String(video.season == null ? 1 : video.season) + ":" + String(parseInt(video.episode, 10));
            } else {
                var title = String(video.title || video.name || "").toLowerCase().replace(/^\s+|\s+$/g, "");
                if (title && title !== "full" && title !== "trọn bộ" && title !== "tron bo") key = title;
            }
            if (key && !keys[key]) { keys[key] = true; count++; }
        }
        if (structured) return count;
        return count || videos.length;
    }

    function getEffectiveMovieItemType(item, meta, fallbackType) {
        var details = meta || item || {};
        var declaredType = String(details.type || (item && item.type) || fallbackType || "movie").toLowerCase();
        var videos = details && Array.isArray(details.videos) ? details.videos : [];
        if (declaredType === "series") return "series";
        if (countDistinctMovieEpisodes(videos) > 1) return "series";
        if (meta && declaredType === "movie") return "movie";
        if (hasSeriesEpisodeHint(details) || hasSeriesEpisodeHint(item)) return "series";
        if (declaredType === "movie") return "movie";
        return String(fallbackType || declaredType || "movie").toLowerCase();
    }

    function mergeClassifiedMovieItem(item, meta, effectiveType) {
        var result = {};
        var key;
        for (key in item) if (Object.prototype.hasOwnProperty.call(item, key)) result[key] = item[key];
        if (meta) for (key in meta) if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] != null) result[key] = meta[key];
        result.type = effectiveType;
        return result;
    }

    function fetchMovieMetaShared(requestType, itemId, baseUrl, success, failure) {
        var identity = String(baseUrl || "") + "|meta|" + String(requestType || "") + "|" + String(itemId || "");
        if (movieMetaRequestInFlight[identity]) {
            movieMetaRequestInFlight[identity].push({ success: success, failure: failure });
            return;
        }
        movieMetaRequestInFlight[identity] = [{ success: success, failure: failure }];
        requestJson(buildMovieResourceUrlForBase(baseUrl, "meta", requestType, itemId), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
            var listeners = movieMetaRequestInFlight[identity] || [];
            delete movieMetaRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].success(data); } catch (callbackError) {}
        }, function (error) {
            var listeners = movieMetaRequestInFlight[identity] || [];
            delete movieMetaRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].failure(error); } catch (callbackError) {}
        });
    }

    function fetchMovieStreamsShared(type, itemId, success, failure) {
        var identity = String(movieBaseUrl || "") + "|stream|" + String(type || "") + "|" + String(itemId || "");
        if (movieStreamRequestInFlight[identity]) {
            movieStreamRequestInFlight[identity].push({ success: success, failure: failure });
            return;
        }
        movieStreamRequestInFlight[identity] = [{ success: success, failure: failure }];

        function notify(streams) {
            var listeners = movieStreamRequestInFlight[identity] || [];
            delete movieStreamRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].success(streams.slice(0)); } catch (callbackError) {}
        }
        function notifyFailure(error) {
            var listeners = movieStreamRequestInFlight[identity] || [];
            delete movieStreamRequestInFlight[identity];
            for (var i = 0; i < listeners.length; i++) try { listeners[i].failure(error); } catch (callbackError) {}
        }

        // [build 229] HỎI TẤT CẢ ADDON phù hợp (idPrefixes + resources), gộp
        // kết quả, phân loại theo chuẩn Stremio và gỡ trùng theo URL.
        // Thứ tự do Stremio.rankStreams sắp: phát được trước (HLS/MP4...).
        if (window.Stremio && typeof window.Stremio.resolveStreams === "function" && movieAddons.length) {
            var requestTypes = [String(type || "movie")];
            if (type === "tv") requestTypes = ["tv", "movie"];        // addon IPTV gán type movie
            else if (type === "movie") requestTypes = ["movie", "tv"];
            window.Stremio.resolveStreams(movieAddons, { type: type, types: requestTypes, id: itemId },
                function (url, ok, fail) { requestJson(url, MOVIE_REQUEST_TIMEOUT, ok, fail); },
                function (classified) {
                    var seen = {};
                    var streams = [];
                    for (var i = 0; i < classified.length; i++) {
                        var item = classified[i] || {};
                        var key = item.url || item.magnet || (item.youtubeId ? "yt:" + item.youtubeId : "") || ("#" + i);
                        if (!key || seen[key]) continue;
                        seen[key] = true;
                        streams.push(item.raw || item);
                    }
                    try { phimLog("fetchMovieStreamsShared: " + classified.length + " classified → " + streams.length + " unique", { type: type, id: itemId }); } catch (e) {}
                    notify(streams);
                });
            return;
        }

        requestJson(buildMovieResourceUrl("stream", type, itemId), MOVIE_REQUEST_TIMEOUT, function (data) {
            notify(data && Array.isArray(data.streams) ? data.streams : []);
        }, notifyFailure);
    }

    function classifyMovieItem(item, fallbackType, done) {
        if (!item || !item.id) { done(null); return; }
        var requestType = String(item.type || fallbackType || "movie").toLowerCase();
        if (requestType !== "movie" && requestType !== "series") requestType = fallbackType === "series" ? "series" : "movie";
        var cacheKey = String(movieBaseUrl || "") + "|" + requestType + "|" + String(item.id);
        if (movieClassificationCache[cacheKey]) { done(mergeClassifiedMovieItem(item, movieClassificationCache[cacheKey], movieClassificationCache[cacheKey].type)); return; }
        var stored = readMoviePersistentCache("meta", cacheKey);
        if (stored && stored.classified && Date.now() - stored.updatedAt <= MOVIE_CATALOG_CACHE_TTL) {
            movieClassificationCache[cacheKey] = stored.classified;
            done(mergeClassifiedMovieItem(item, stored.classified, stored.classified.type));
            return;
        }

        fetchMovieMetaShared(requestType, item.id, movieBaseUrl, function (data) {
            var meta = data && data.meta ? data.meta : null;
            var effectiveType = getEffectiveMovieItemType(item, meta, fallbackType);
            var classified = mergeClassifiedMovieItem(item, meta, effectiveType);
            movieClassificationCache[cacheKey] = classified;
            writeMoviePersistentCache("meta", cacheKey, { updatedAt: Date.now(), classified: copyMovieCatalogCacheItem(classified) });
            done(classified);
        }, function () {
            var effectiveType = getEffectiveMovieItemType(item, null, fallbackType);
            var classified = mergeClassifiedMovieItem(item, null, effectiveType);
            movieClassificationCache[cacheKey] = classified;
            done(classified);
        });
    }

    function classifyMovieItems(items, fallbackType, token, done, onProgress) {
        var list = Array.isArray(items) ? items : [];
        if (list.length === 0) { done([]); return; }
        var results = new Array(list.length);
        var nextIndex = 0;
        var completed = 0;
        var active = 0;

        function launchNext() {
            if (token !== movieCatalogLoadToken) return;
            while (active < MOVIE_CLASSIFICATION_CONCURRENCY && nextIndex < list.length) {
                (function (itemIndex) {
                    active++;
                    classifyMovieItem(list[itemIndex], fallbackType, function (classified) {
                        active--;
                        completed++;
                        results[itemIndex] = classified;
                        if (token !== movieCatalogLoadToken) return;
                        if (completed >= list.length) { done(results); return; }
                        if (onProgress) { try { onProgress(results, completed, list.length); } catch (progressError) {} }
                        launchNext();
                    });
                })(nextIndex++);
            }
        }
        launchNext();
    }

    function dedupeMovieItems(items) {
        var result = [];
        var seen = {};
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.id || seen[item.id]) continue;
            seen[item.id] = true;
            result.push(item);
        }
        return result;
    }

    function dedupeMergedMovieItems(items) {
        var byId = {};
        var byContent = {};
        var result = [];
        var list = Array.isArray(items) ? items : [];
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!item || !item.id) continue;
            var idKey = String(item.type || "") + "|" + String(item.id);
            if (byId[idKey]) continue;
            byId[idKey] = true;
            var imdbMatch = [item.imdb_id, item.imdbId, item.id].join(" ").match(/tt\d{5,12}/i);
            var contentKey = imdbMatch ? String(item.type || "") + "|imdb|" + imdbMatch[0].toLowerCase() : "";
            if (!contentKey) {
                var normalizedTitle = normalizeMovieSearchText(item.name || item.title || "");
                var productionYear = getMovieProductionYear(item);
                if (normalizedTitle && productionYear) contentKey = String(item.type || "") + "|title|" + normalizedTitle + "|" + productionYear;
            }
            if (contentKey && byContent[contentKey]) continue;
            if (contentKey) byContent[contentKey] = true;
            result.push(item);
        }
        return result;
    }

    function parseMovieYearFromValue(value) {
        var match = String(value == null ? "" : value).match(/(?:19|20)\d{2}/);
        if (!match) return 0;
        var year = parseInt(match[0], 10);
        return year >= 1900 && year <= 2099 ? year : 0;
    }

    function getMovieProductionYear(item) {
        if (!item) return 0;
        var explicitYear = parseMovieYearFromValue(item.year || item.productionYear);
        if (explicitYear) return explicitYear;

        var description = String(item.description || "");
        var labeled = description.match(/(?:năm\s*(?:sản\s*xuất|phát\s*hành|khởi\s*chiếu)|release\s*year)[^0-9]{0,24}((?:19|20)\d{2})/i);
        if (labeled) return parseInt(labeled[1], 10);
        var originalTitle = description.match(/(?:tựa\s*gốc|original\s*title)[\s\S]{0,150}?\(((?:19|20)\d{2})\)/i);
        if (originalTitle) return parseInt(originalTitle[1], 10);
        var titleYear = String(item.name || item.title || "").match(/\(((?:19|20)\d{2})\)/);
        if (titleYear) return parseInt(titleYear[1], 10);

        var fields = [item.releaseInfo, item.releaseDate, item.released, item.premiered, item.firstAired];
        for (var i = 0; i < fields.length; i++) {
            var year = parseMovieYearFromValue(fields[i]);
            if (year) return year;
        }
        return 0;
    }

    function sortMovieItemsByProductionYear(items) {
        var source = Array.isArray(items) ? items : [];
        var decorated = [];
        for (var i = 0; i < source.length; i++) decorated.push({ item: source[i], year: getMovieProductionYear(source[i]), index: i });
        decorated.sort(function (a, b) {
            if (a.year !== b.year) return b.year - a.year;
            return a.index - b.index;
        });
        var result = [];
        for (var j = 0; j < decorated.length; j++) result.push(decorated[j].item);
        return result;
    }

    function isPrimaryMovieTvCatalog(catalog) {
        if (!catalog || catalog.type !== "tv") return false;
        var tvNumber = 0;
        for (var i = 0; i < movieCatalogs.length; i++) {
            if (movieCatalogs[i] && movieCatalogs[i].type === "tv") tvNumber++;
            if (movieCatalogs[i] === catalog || (movieCatalogs[i] && movieCatalogs[i].id === catalog.id && movieCatalogs[i].type === catalog.type)) return tvNumber === 1;
        }
        return false;
    }

    function getMovieTvValidationKey(item) {
        return String(movieBaseUrl || "") + "|tv|" + String((item && item.id) || "");
    }

    function probeMovieLiveStreamUrl(url, done) {
        if (!isValidMovieTargetUrl(url)) { done(false); return; }
        if (movieBaseUrl && url.indexOf(movieBaseUrl + "/tv-live/") === 0) { done(true); return; }
        var xhr = new XMLHttpRequest();
        var finished = false;
        var timer = null;
        var isHls = /\.m3u8(?:\?|$)/i.test(url);
        // [build 229] ĐI QUA /proxy: XHR trực tiếp tới host KHÁC ORIGIN bị
        // CORS chặn → mọi kênh bị kết luận "chết" oan (và bị lọc khỏi danh
        // sách). /proxy nằm cùng origin (http://127.0.0.1:PORT) nên XHR luôn
        // hợp lệ; server fetch hộ rồi trả nguyên nội dung.
        var requestUrl = url;
        try {
            var currentOrigin = (window.location && window.location.origin) ? window.location.origin : "";
            var probeAnchor = document.createElement("a");
            probeAnchor.href = url;
            var urlOrigin = probeAnchor.origin || "";
            if (currentOrigin && urlOrigin && urlOrigin !== currentOrigin && url.indexOf("/proxy?url=") === -1) {
                requestUrl = currentOrigin.replace(/\/+$/, "") + "/proxy?url=" + encodeURIComponent(url);
            }
        } catch (originError) { requestUrl = url; }
        function finish(ok) {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            done(!!ok);
        }
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) { finish(false); return; }
            if (!isHls) { finish(true); return; }
            finish(String(xhr.responseText || "").indexOf("#EXTM3U") !== -1);
        };
        xhr.onerror = function () { finish(false); };
        xhr.ontimeout = function () { finish(false); };
        try {
            xhr.open(isHls ? "GET" : "HEAD", requestUrl, true);
            xhr.timeout = MOVIE_TV_VALIDATION_TIMEOUT;
            timer = setTimeout(function () { try { xhr.abort(); } catch (e) {} finish(false); }, MOVIE_TV_VALIDATION_TIMEOUT + 300);
            xhr.send();
        } catch (e) { finish(false); }
    }

    function validateMovieTvItem(item, done) {
        if (!item || !item.id) { done(false, []); return; }
        var cacheKey = getMovieTvValidationKey(item);
        var cached = movieTvStreamValidationCache[cacheKey];
        if (cached && Date.now() - cached.updatedAt <= MOVIE_TV_VALIDATION_TTL) { done(cached.active, cached.streams || []); return; }
        fetchMovieStreamsShared("tv", item.id, function (streams) {
            var validStreams = [];
            for (var i = 0; i < streams.length; i++) if (streams[i] && typeof streams[i].url === "string" && isValidMovieTargetUrl(streams[i].url)) validStreams.push(streams[i]);
            if (!validStreams.length) {
                movieTvStreamValidationCache[cacheKey] = { updatedAt: Date.now(), active: false, streams: [] };
                done(false, []);
                return;
            }
            var probeLimit = Math.min(validStreams.length, 4);
            function probeNext(index) {
                if (index >= probeLimit) {
                    movieTvStreamValidationCache[cacheKey] = { updatedAt: Date.now(), active: false, streams: validStreams };
                    done(false, validStreams);
                    return;
                }
                probeMovieLiveStreamUrl(validStreams[index].url, function (active) {
                    if (!active) { probeNext(index + 1); return; }
                    var ordered = [validStreams[index]];
                    for (var streamIndex = 0; streamIndex < validStreams.length; streamIndex++) if (streamIndex !== index) ordered.push(validStreams[streamIndex]);
                    movieTvStreamValidationCache[cacheKey] = { updatedAt: Date.now(), active: true, streams: ordered };
                    done(true, ordered);
                });
            }
            probeNext(0);
        }, function () {
            movieTvStreamValidationCache[cacheKey] = { updatedAt: Date.now(), active: false, streams: [] };
            done(false, []);
        });
    }

    function validateMovieTvCatalogItems(items, token, done) {
        var list = Array.isArray(items) ? items : [];
        if (!list.length) { done([]); return; }
        var results = new Array(list.length);
        var nextIndex = 0;
        var active = 0;
        var completed = 0;
        var lastProgressUpdateAt = 0;
        function launchMore() {
            if (token !== movieCatalogLoadToken) return;
            while (active < MOVIE_TV_VALIDATION_CONCURRENCY && nextIndex < list.length) {
                (function (itemIndex) {
                    active++;
                    validateMovieTvItem(list[itemIndex], function (available, streams) {
                        active--;
                        completed++;
                        if (available) {
                            list[itemIndex]._bintvTvValidatedStreams = streams;
                            results[itemIndex] = list[itemIndex];
                        }
                        if (token !== movieCatalogLoadToken) return;
                        var progressNow = Date.now();
                        if (completed >= list.length || progressNow - lastProgressUpdateAt >= 120) {
                            lastProgressUpdateAt = progressNow;
                            showMovieStatus("Đang kiểm tra link truyền hình " + completed + "/" + list.length + "…", false);
                        }
                        if (completed >= list.length) {
                            var availableItems = [];
                            for (var i = 0; i < results.length; i++) if (results[i]) availableItems.push(results[i]);
                            done(availableItems);
                            return;
                        }
                        launchMore();
                    });
                })(nextIndex++);
            }
        }
        launchMore();
    }

    function prepareClassifiedMovieCatalog(catalog, metas, token, done, onProgress) {
        var sourceKey = getMovieCatalogSourceKey(catalog);
        var candidates = Array.isArray(metas) ? metas.slice(0) : [];
        if (!catalog || (catalog.type !== "movie" && catalog.type !== "series")) { done(candidates); return; }

        function classifyCandidates() {
            classifyMovieItems(candidates, catalog.type, token, function (classified) {
                if (token !== movieCatalogLoadToken) return;
                var visible = [];
                var reclassifiedSeries = [];
                for (var i = 0; i < classified.length; i++) {
                    var item = classified[i];
                    if (!item) continue;
                    if (item.type === catalog.type) visible.push(item);
                    if (item.type === "series") reclassifiedSeries.push(item);
                }
                if (sourceKey) movieReclassifiedSeriesBySource[sourceKey] = dedupeMovieItems(reclassifiedSeries);
                if (catalog.type === "series" && sourceKey && movieReclassifiedSeriesBySource[sourceKey]) {
                    visible = visible.concat(movieReclassifiedSeriesBySource[sourceKey]);
                }
                visible = sortMovieItemsByProductionYear(dedupeMovieItems(visible));
                cacheProcessedMovieCatalog(catalog, visible, movieBaseUrl);
                done(visible);
            }, function (results) {
                // Tiến độ: báo danh mục phim đã xác minh (đúng loại) để hiển thị dần
                if (!onProgress) return;
                var partial = [];
                for (var partialIndex = 0; partialIndex < results.length; partialIndex++) {
                    var partialItem = results[partialIndex];
                    if (!partialItem) continue;
                    if (partialItem.type === catalog.type) partial.push(partialItem);
                }
                onProgress(partial);
            });
        }

        if (catalog.type !== "movie" && catalog.type !== "series") { classifyCandidates(); return; }
        var pairedType = catalog.type === "series" ? "movie" : "series";
        var pairedCatalog = findPairedMovieCatalog(catalog, pairedType);
        if (!pairedCatalog) { classifyCandidates(); return; }
        var cachedPairedMetas = getCachedMovieCatalogMetas(pairedCatalog);
        if (cachedPairedMetas !== null) {
            candidates = candidates.concat(cachedPairedMetas);
            classifyCandidates();
            return;
        }
        fetchMovieCatalogShared(pairedCatalog, catalogAddonBase(pairedCatalog), function (pairedMetas) {
            if (token !== movieCatalogLoadToken) return;
            candidates = candidates.concat(pairedMetas);
            classifyCandidates();
        }, function () { if (token === movieCatalogLoadToken) classifyCandidates(); });
    }

    function renderMovieCatalogs() {
        var container = document.getElementById("bintv-movie-catalogs");
        movieCatalogRowElements = [];
        movieLastCatalogFocusIndex = -1;
        movieLastSelectedCatalogIndex = -1;
        if (movieLastFocusArea === "catalogs") movieLastFocusArea = "";
        if (!container) return;
        container.innerHTML = "";
        var lastType = "";
        for (var i = 0; i < movieCatalogs.length; i++) {
            var currentType = movieCatalogs[i] && movieCatalogs[i].type;
            if (!isMergedMovieCatalog(movieCatalogs[i]) && currentType !== lastType) {
                var heading = document.createElement("div");
                heading.className = "movie-catalog-group-title";
                heading.textContent = getMovieCatalogTypeLabel(movieCatalogs[i]);
                container.appendChild(heading);
            }
            lastType = currentType;
            (function (catalogIndex) {
                var catalog = movieCatalogs[catalogIndex];
                var row = document.createElement("div");
                row.className = "movie-catalog-row";
                row.textContent = isMergedMovieCatalog(catalog) ? (catalog.name || getMovieCatalogTypeLabel(catalog)) : "Nguồn " + getMovieCatalogSourceNumber(catalogIndex);
                row.addEventListener("click", function () {
                    movieBrowserFocusArea = "catalogs";
                    movieCatalogIndex = catalogIndex;
                    loadMovieCatalog(catalogIndex, 0);
                });
                movieCatalogRowElements[catalogIndex] = row;
                container.appendChild(row);
            })(i);
        }
        updateMovieBrowserFocus();
    }

    function renderMovieFilters() {
        var buttons = movieFilterButtonElements;
        if (!buttons || !buttons.length) {
            buttons = document.querySelectorAll("#bintv-movie-filters .movie-filter-button");
            movieFilterButtonElements = buttons;
        }
        for (var i = 0; i < buttons.length; i++) {
            var mode = buttons[i].getAttribute("data-movie-filter") || "all";
            var isActive = mode === "filter-menu" ? movieFilterMode !== "all" : mode === movieFilterMode;
            buttons[i].classList.toggle("active", isActive);
            buttons[i].classList.toggle("focus", movieBrowserFocusArea === "filters" && i === movieFilterIndex);
        }
        // Nút "Lọc Phim" hiển thị tên bộ lọc đang bật (VD: đang lọc Mavel thì hiện "Mavel")
        var filterMenuButton = document.getElementById("bintv-movie-filter-menu-button");
        if (filterMenuButton) {
            var activeFilterLabel = "";
            for (var optionIndex = 0; optionIndex < MOVIE_FILTER_MENU_OPTIONS.length; optionIndex++) {
                if (MOVIE_FILTER_MENU_OPTIONS[optionIndex].mode === movieFilterMode) { activeFilterLabel = MOVIE_FILTER_MENU_OPTIONS[optionIndex].label; break; }
            }
            filterMenuButton.textContent = (movieFilterMode !== "all" && activeFilterLabel) ? activeFilterLabel : "Lọc Phim";
        }
        var searchButton = document.getElementById("bintv-movie-search-button");
        if (searchButton) searchButton.classList.toggle("focus", movieBrowserFocusArea === "search");
    }

    function getMovieFilterMenuIndex(mode) {
        for (var i = 0; i < MOVIE_FILTER_MENU_OPTIONS.length; i++) if (MOVIE_FILTER_MENU_OPTIONS[i].mode === mode) return i;
        return 0;
    }

    function renderMovieFilterMenu() {
        var list = document.getElementById("bintv-movie-filter-menu-list");
        if (!list) return;
        list.innerHTML = "";
        for (var i = 0; i < MOVIE_FILTER_MENU_OPTIONS.length; i++) {
            (function (optionIndex) {
                var option = MOVIE_FILTER_MENU_OPTIONS[optionIndex];
                var row = document.createElement("div");
                row.className = "movie-filter-menu-option";
                row.textContent = option.label;
                row.classList.toggle("active", option.mode === movieFilterMode);
                row.classList.toggle("focus", optionIndex === movieFilterMenuIndex);
                row.addEventListener("click", function () { movieFilterMenuIndex = optionIndex; selectMovieFilterMenuItem(); });
                list.appendChild(row);
            })(i);
        }
    }

    function openMovieFilterMenu() {
        if (!movieBrowserOpen || moviePlayerOpen || movieSearchOpen || movieEpisodeOpen) return;
        movieFilterMenuOpen = true;
        movieFilterMenuIndex = getMovieFilterMenuIndex(movieFilterMode);
        var menu = document.getElementById("bintv-movie-filter-menu");
        if (menu) menu.classList.add("show");
        renderMovieFilterMenu();
    }

    function closeMovieFilterMenu() {
        movieFilterMenuOpen = false;
        var menu = document.getElementById("bintv-movie-filter-menu");
        if (menu) menu.classList.remove("show");
        renderMovieFilters();
    }

    function selectMovieFilterMenuItem() {
        var option = MOVIE_FILTER_MENU_OPTIONS[movieFilterMenuIndex] || MOVIE_FILTER_MENU_OPTIONS[0];
        movieFilterMode = option.mode;
        movieFilterIndex = movieFilterMode === "all" ? 0 : 1;
        movieBrowserFocusArea = "filters";
        closeMovieFilterMenu();
        applyCurrentMovieFilter();
    }

    function setMovieSearchStatus(message, isError) {
        var status = document.getElementById("bintv-movie-search-status");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("error", !!isError);
    }

    function syncMovieSearchInputValue() {
        var input = document.getElementById("bintv-movie-search-input");
        if (input) movieSearchQuery = input.value || "";
        return movieSearchQuery;
    }

    function finishMovieSearchKeyboardInput() {
        var value = String(syncMovieSearchInputValue() || "").replace(/^\s+|\s+$/g, "");
        movieSearchEditing = false;
        if (!movieSearchOpen) return;
        movieSearchFocusIndex = value ? 2 : 1;
        updateMovieSearchFocus();
        if (value) setMovieSearchStatus('Đã nhập: "' + value + '". Chọn Tìm kiếm và nhấn OK', false);
        else setMovieSearchStatus("Chưa có nội dung tìm kiếm. Hãy chọn Bàn Phím để nhập lại", true);
    }

    function isMovieSearchKeyboardEditing() {
        if (!movieSearchOpen || !movieSearchEditing) return false;
        var input = document.getElementById("bintv-movie-search-input");
        if (!input) return false;
        return !document.activeElement || document.activeElement === input || document.activeElement === document.body;
    }

    function setMovieRecognizedSearchText(text) {
        text = String(text || "").replace(/^\s+|\s+$/g, "");
        if (!text || !movieSearchOpen) return false;
        movieSearchQuery = text;
        movieSearchEditing = false;
        movieSearchFocusIndex = 2;
        var input = document.getElementById("bintv-movie-search-input");
        if (input) input.value = text;
        updateMovieSearchFocus();
        setMovieSearchStatus('Đã nhận dạng: "' + text + '". Chọn Tìm kiếm và nhấn OK', false);
        return true;
    }

    function updateMovieSearchFocus() {
        var controls = [
            document.getElementById("bintv-movie-search-input"),
            document.getElementById("bintv-movie-search-keyboard"),
            document.getElementById("bintv-movie-search-submit")
        ];
        for (var i = 0; i < controls.length; i++) if (controls[i]) controls[i].classList.toggle("focus", i === movieSearchFocusIndex);
    }

    function stopMovieVoiceSearch() {
        if (movieSearchRecognition) {
            try { movieSearchRecognition.abort(); } catch (e) {}
            movieSearchRecognition = null;
        }
        if (movieSearchVoiceClient) {
            try {
                if (movieSearchVoiceListenerId != null) movieSearchVoiceClient.removeResultListener(movieSearchVoiceListenerId);
            } catch (removeError) {}
            try { movieSearchVoiceClient.unsetCommandList("FOREGROUND"); } catch (unsetError) {}
        }
        movieSearchVoiceClient = null;
        movieSearchVoiceListenerId = null;
    }

    function openMovieSearch() {
        if (!movieBrowserOpen || moviePlayerOpen || movieEpisodeOpen) return;
        ensureMovieExperienceUI();
        movieSearchOpen = true;
        movieSearchEditing = false;
        movieSearchFocusIndex = 1;
        var overlay = document.getElementById("bintv-movie-search");
        var input = document.getElementById("bintv-movie-search-input");
        applyVietnameseMovieImeHints(input);
        if (overlay) overlay.classList.add("show");
        if (input) input.value = movieSearchQuery || "";
        setMovieSearchStatus("Chọn Bàn Phím để nhập tên phim, sau đó chọn Tìm kiếm", false);
        updateMovieSearchFocus();
    }

    function closeMovieSearch() {
        movieSearchOpen = false;
        movieSearchEditing = false;
        stopMovieVoiceSearch();
        var overlay = document.getElementById("bintv-movie-search");
        var input = document.getElementById("bintv-movie-search-input");
        if (overlay) overlay.classList.remove("show");
        if (input) try { input.blur(); } catch (e) {}
        updateMovieBrowserFocus();
    }

    function buildMovieCatalogSearchUrl(catalog, query) {
        // [build 229] Dùng base của addon SỞ HỮU catalog → tìm trên mọi nguồn.
        return catalogAddonBase(catalog) + "/catalog/" + encodeURIComponent(catalog.type) + "/" + encodeURIComponent(catalog.id) + "/search=" + encodeURIComponent(query) + ".json";
    }

    function movieCatalogSupportsSearch(catalog) {
        if (!catalog || (catalog.type !== "movie" && catalog.type !== "series")) return false;
        if (!Array.isArray(catalog.extra) || catalog.extra.length === 0) return true;
        for (var i = 0; i < catalog.extra.length; i++) if (catalog.extra[i] && catalog.extra[i].name === "search") return true;
        return false;
    }

    function normalizeMovieSearchText(value) {
        var text = String(value || "").toLowerCase();
        try { if (text.normalize) text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
        return text.replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ");
    }

    function buildMovieSearchQueryVariants(query) {
        var original = String(query || "").replace(/^\s+|\s+$/g, "");
        var normalized = normalizeMovieSearchText(original);
        var variants = [];
        var seen = {};
        function addVariant(value) {
            value = String(value || "").replace(/^\s+|\s+$/g, "");
            if (!value || seen[value.toLowerCase()]) return;
            seen[value.toLowerCase()] = true;
            variants.push(value);
        }
        addVariant(original);
        addVariant(normalized);
        if (normalized.indexOf("phim ") === 0) addVariant(normalized.substring(5));
        return variants;
    }

    function rankMovieSearchResults(items, query) {
        var normalizedQuery = normalizeMovieSearchText(query);
        var queryWords = normalizedQuery ? normalizedQuery.split(" ") : [];
        var ranked = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.id) continue;
            var title = normalizeMovieSearchText(item.name || item.title || "");
            var allWords = queryWords.length > 0;
            for (var wordIndex = 0; wordIndex < queryWords.length; wordIndex++) if (title.indexOf(queryWords[wordIndex]) === -1) { allWords = false; break; }
            var score = 20;
            if (title === normalizedQuery) score = 0;
            else if (title.indexOf(normalizedQuery) === 0) score = 1;
            else if (normalizedQuery && title.indexOf(normalizedQuery) !== -1) score = 2;
            else if (allWords) score = 3;
            ranked.push({ item: item, score: score, order: i });
        }
        ranked.sort(function (a, b) { return a.score === b.score ? a.order - b.order : a.score - b.score; });
        var matched = [];
        var fallback = [];
        for (var j = 0; j < ranked.length; j++) {
            if (ranked[j].score < 20) matched.push(ranked[j].item);
            else fallback.push(ranked[j].item);
        }
        var result = matched.length ? matched : fallback;
        return result.slice(0, MOVIE_SEARCH_MAX_RESULTS);
    }

    function dedupeMovieSearchResults(items) {
        var result = [];
        var positions = {};
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.id) continue;
            var key = String(item.id);
            if (positions[key] == null) {
                positions[key] = result.length;
                result.push(item);
            } else if (item.type === "series" && result[positions[key]].type !== "series") {
                result[positions[key]] = item;
            }
        }
        return result;
    }

    function showMovieSearchResults(query, items, token) {
        if (token !== movieSearchToken || !movieBrowserOpen) return;
        var results = rankMovieSearchResults(dedupeMergedMovieItems(dedupeMovieSearchResults(items)), query);
        movieSearchResultsActive = true;
        movieSearchQuery = query;
        movieFilterToken++;
        movieFilterInProgress = false;
        movieFilterMode = "all";
        movieFilterIndex = 0;
        movieAllItems = results;
        movieItems = results;
        movieItemIndex = 0;
        movieBrowserFocusArea = results.length ? "items" : "search";
        var title = document.getElementById("bintv-movie-catalog-title");
        if (title) title.textContent = 'Kết quả: "' + query + '"';
        closeMovieSearch();
        renderMovieItems();
        updateMovieBrowserFocus();
        showMovieStatus(results.length ? results.length + " kết quả tìm kiếm" : "Không tìm thấy phim phù hợp", results.length === 0);
    }

    function executeMovieSearch(query) {
        query = String(query || "").replace(/^\s+|\s+$/g, "");
        if (!query) { setMovieSearchStatus("Hãy nói hoặc nhập tên phim cần tìm", true); return; }
        if (!movieCatalogs.length) { setMovieSearchStatus("Các nguồn phim đang được tải, vui lòng thử lại", true); return; }
        movieSearchQuery = query;
        movieSearchReturnCatalogIndex = movieCatalogIndex;
        var token = ++movieSearchToken;
        var catalogs = [];
        var searchableCatalogs = expandMergedMovieCatalogs(movieCatalogs);
        for (var i = 0; i < searchableCatalogs.length; i++) if (movieCatalogSupportsSearch(searchableCatalogs[i])) catalogs.push(searchableCatalogs[i]);
        if (catalogs.length === 0) { setMovieSearchStatus("Nguồn phim hiện tại không hỗ trợ tìm kiếm", true); return; }
        var queryVariants = buildMovieSearchQueryVariants(query);
        setMovieSearchStatus('Đang tìm "' + query + '" trên ' + catalogs.length + " nguồn…", false);
        var results = [];
        var tasks = [];
        for (var catalogIndex = 0; catalogIndex < catalogs.length; catalogIndex++) {
            var cachedCatalog = getProcessedMovieCatalogEntry(catalogs[catalogIndex], movieBaseUrl);
            if (cachedCatalog && Array.isArray(cachedCatalog.items)) results = results.concat(cachedCatalog.items);
            for (var variantIndex = 0; variantIndex < queryVariants.length; variantIndex++) tasks.push({ catalog: catalogs[catalogIndex], query: queryVariants[variantIndex] });
        }
        var nextIndex = 0;
        var active = 0;
        var completed = 0;

        function finishTask() {
            active--;
            completed++;
            if (token !== movieSearchToken) return;
            if (completed >= tasks.length) { showMovieSearchResults(query, results, token); return; }
            launchNext();
        }

        function launchNext() {
            if (token !== movieSearchToken) return;
            while (active < MOVIE_SEARCH_CONCURRENCY && nextIndex < tasks.length) {
                (function (task) {
                    active++;
                    requestJson(buildMovieCatalogSearchUrl(task.catalog, task.query), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
                        var metas = data && Array.isArray(data.metas) ? data.metas : [];
                        for (var resultIndex = 0; resultIndex < metas.length; resultIndex++) {
                            if (!metas[resultIndex].type) metas[resultIndex].type = task.catalog.type;
                            results.push(metas[resultIndex]);
                        }
                        finishTask();
                    }, function () { finishTask(); });
                })(tasks[nextIndex++]);
            }
        }
        if (tasks.length) launchNext();
        else showMovieSearchResults(query, results, token);
    }

    function submitMovieSearch() {
        var input = document.getElementById("bintv-movie-search-input");
        executeMovieSearch(input ? input.value : movieSearchQuery);
    }

    function clearMovieSearchResults() {
        if (!movieSearchResultsActive) return false;
        movieSearchToken++;
        movieSearchResultsActive = false;
        movieSearchQuery = "";
        movieBrowserFocusArea = "catalogs";
        if (movieCatalogs.length) {
            movieCatalogIndex = Math.max(0, Math.min(movieSearchReturnCatalogIndex, movieCatalogs.length - 1));
            loadMovieCatalog(movieCatalogIndex, 0);
        } else {
            movieItems = [];
            movieAllItems = [];
            renderMovieItems();
        }
        return true;
    }

    function hasTizenVoiceCapability(capability) {
        try {
            if (window.tizen && tizen.systeminfo && tizen.systeminfo.getCapability) return tizen.systeminfo.getCapability(capability) !== false;
        } catch (e) {}
        return true;
    }

    function startSamsungMovieVoiceInteraction() {
        if (!(window.webapis && webapis.voiceinteraction && webapis.voiceinteraction.setCallback && webapis.voiceinteraction.listen)) return false;
        if (!hasTizenVoiceCapability("http://tizen.org/feature/speech.control") || !hasTizenVoiceCapability("http://tizen.org/feature/microphone")) return false;
        try {
            var manager = webapis.voiceinteraction;
            manager.setCallback({
                onupdatestate: function () { return moviePlayerOpen ? "Player" : (movieSearchOpen ? "Search" : (movieBrowserOpen ? "List" : "None")); },
                onsearch: function (searchTerm) {
                    if (!movieBrowserOpen || moviePlayerOpen) return false;
                    var title = "";
                    try { if (manager.getDataFromSearchTerm) title = manager.getDataFromSearchTerm(searchTerm, "search_term_title") || ""; } catch (parseError) {}
                    if (!title && typeof searchTerm === "string") title = searchTerm;
                    if (!title && searchTerm && typeof searchTerm === "object") title = searchTerm.title || searchTerm.searchTerm || searchTerm.query || searchTerm.to || "";
                    return title ? setMovieRecognizedSearchText(title) : false;
                },
                ontitleselection: function (title) {
                    if (!title || !movieBrowserOpen || !movieSearchOpen) return false;
                    return setMovieRecognizedSearchText(title);
                },
                onrequestcontentcontext: function () {
                    try {
                        var contexts = [];
                        for (var i = 0; i < movieItems.length && i < 50; i++) {
                            contexts.push(manager.buildVoiceInteractionContentContextItem(i % 5, Math.floor(i / 5), movieItems[i].name || "Phim", [], i === movieItemIndex));
                        }
                        return manager.buildVoiceInteractionContentContextResponse(contexts);
                    } catch (contextError) { return "[]"; }
                }
            });
            manager.listen();
            setMovieSearchStatus("Đang chờ giọng nói — Nhấn giữ nút Micro trên remote Samsung và nói tên phim", false);
            return true;
        } catch (e) { return false; }
    }

    function startTizenMovieVoiceControl() {
        if (!(window.tizen && tizen.voicecontrol && tizen.VoiceControlCommand)) return false;
        try {
            var client = tizen.voicecontrol.getVoiceControlClient();
            var commands = [];
            var seen = {};
            for (var i = 0; i < movieItems.length && commands.length < 100; i++) {
                var title = String(movieItems[i].name || "").replace(/^\s+|\s+$/g, "");
                if (title && !seen[title]) { seen[title] = true; commands.push(new tizen.VoiceControlCommand(title, "FOREGROUND")); }
            }
            if (!commands.length) return false;
            client.setCommandList(commands, "FOREGROUND");
            movieSearchVoiceClient = client;
            movieSearchVoiceListenerId = client.addResultListener(function (event, list, result) {
                if (event !== "SUCCESS" || !result || !movieSearchOpen) return;
                setMovieRecognizedSearchText(result);
            });
            var language = "";
            try { language = String(client.getCurrentLanguage() || ""); } catch (languageError) {}
            setMovieSearchStatus(language.toLowerCase().indexOf("vi") === 0 ? "Giữ nút micro trên điều khiển và nói tên phim" : "Giữ nút micro và nói. Nên đặt ngôn ngữ nhận diện của TV là Tiếng Việt", false);
            return true;
        } catch (e) { return false; }
    }

    function focusMovieSearchKeyboard(isFallback) {
        movieSearchFocusIndex = 0;
        updateMovieSearchFocus();
        var input = document.getElementById("bintv-movie-search-input");
        if (input) {
            applyVietnameseMovieImeHints(input);
            try { input.focus(); input.click(); } catch (e) {}
            refreshVietnameseMovieImeLanguage(input);
        }
        if (isFallback) setMovieSearchStatus("Không tìm thấy nhận diện giọng nói tương thích. Hãy nhập tên phim bằng bàn phím TV", true);
        else setMovieSearchStatus("Đã yêu cầu bàn phím Samsung dùng Tiếng Việt. Nhập tên phim rồi chọn Tìm kiếm", false);
    }

    function startMovieVoiceSearch() {
        if (!movieSearchOpen) return;
        stopMovieVoiceSearch();
        if (startSamsungMovieVoiceInteraction()) return;
        if (startTizenMovieVoiceControl()) return;
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            try {
                var recognition = new SpeechRecognition();
                movieSearchRecognition = recognition;
                recognition.lang = "vi-VN";
                recognition.continuous = false;
                recognition.interimResults = true;
                recognition.maxAlternatives = 3;
                var finalTranscript = "";
                recognition.onstart = function () { setMovieSearchStatus("Đang nghe… Hãy nói tên phim bằng tiếng Việt", false); };
                recognition.onresult = function (event) {
                    var transcript = "";
                    for (var i = event.resultIndex || 0; i < event.results.length; i++) {
                        var value = event.results[i][0] ? event.results[i][0].transcript : "";
                        transcript += value;
                        if (event.results[i].isFinal) finalTranscript += value;
                    }
                    if (finalTranscript.replace(/^\s+|\s+$/g, "")) setMovieRecognizedSearchText(finalTranscript);
                    else {
                        var input = document.getElementById("bintv-movie-search-input");
                        if (input) input.value = transcript;
                        setMovieSearchStatus('Đang nghe: "' + transcript + '"', false);
                    }
                };
                recognition.onerror = function (event) {
                    if (!movieSearchOpen) return;
                    var error = String((event && event.error) || "");
                    setMovieSearchStatus(error === "not-allowed" ? "TV chưa cấp quyền sử dụng micro" : "Không nhận được giọng nói. Hãy thử lại hoặc nhập tên phim", true);
                };
                recognition.onend = function () {
                    if (movieSearchRecognition === recognition) movieSearchRecognition = null;
                    if (!movieSearchOpen) return;
                    if (finalTranscript.replace(/^\s+|\s+$/g, "")) setMovieRecognizedSearchText(finalTranscript);
                    else setMovieSearchStatus("Không nghe rõ tên phim. Hãy nhấn nút Micro để thử lại", true);
                };
                recognition.start();
                return;
            } catch (speechError) { movieSearchRecognition = null; }
        }
        focusMovieSearchKeyboard(true);
    }

    function activateMovieSearchControl() {
        if (movieSearchFocusIndex === 0 || movieSearchFocusIndex === 1) {
            focusMovieSearchKeyboard(false);
            return;
        }
        submitMovieSearch();
    }

    function resolveMovieFilterContext(item, done) {
        if (!item || !item.id || !item.type) { done(null); return; }
        if (item.type !== "series") {
            done({ id: item.id, videoId: item.id, type: item.type, name: item.name, releaseInfo: item.releaseInfo, imdb_id: item.imdb_id || item.imdbId });
            return;
        }
        requestJson(buildMovieResourceUrl("meta", item.type, item.id), MOVIE_REQUEST_TIMEOUT, function (data) {
            var meta = data && data.meta ? data.meta : item;
            var videos = meta && Array.isArray(meta.videos) ? meta.videos : [];
            var episode = videos.length ? videos[0] : null;
            done({
                id: meta.id || item.id,
                videoId: episode && episode.id ? episode.id : item.id,
                type: "series",
                name: meta.name || item.name,
                releaseInfo: meta.releaseInfo || item.releaseInfo,
                imdb_id: meta.imdb_id || meta.imdbId || item.imdb_id || item.imdbId,
                season: episode && episode.season,
                episode: episode && episode.episode
            });
        }, function () { done(null); });
    }

    function isNarratedMovieStream(stream) {
        if (!stream) return false;
        var hints = stream.behaviorHints || {};
        var values = [stream.audioLanguage, stream.audioLanguages, stream.language, stream.languages, hints.audioLanguage, hints.audioLanguages, hints.language, hints.languages, stream.title, stream.name];
        var text = values.join(" ").toLowerCase();
        return text.indexOf("thuyết minh") !== -1 || text.indexOf("thuyet minh") !== -1 ||
            text.indexOf("lồng tiếng") !== -1 || text.indexOf("long tieng") !== -1 ||
            text.indexOf("vietnamese audio") !== -1 || text.indexOf("audio vi") !== -1 ||
            text.indexOf("dubbed vi") !== -1;
    }

    function probeNarratedMovieItem(item, done) {
        resolveMovieFilterContext(item, function (context) {
            if (!context || !context.videoId) { done(false); return; }
            requestJson(buildMovieResourceUrl("stream", context.type, context.videoId), MOVIE_REQUEST_TIMEOUT, function (data) {
                var streams = data && Array.isArray(data.streams) ? data.streams : [];
                for (var i = 0; i < streams.length; i++) {
                    if (isNarratedMovieStream(streams[i])) { done(true); return; }
                }
                done(false);
            }, function () { done(false); });
        });
    }

    function collectAvailableFilterSubtitleSources(token, done) {
        var available = [];
        function checkSource(sourceIndex, attempt) {
            if (token !== movieFilterToken) return;
            if (sourceIndex >= MOVIE_SUBTITLE_SOURCES.length) { done(available); return; }
            var source = MOVIE_SUBTITLE_SOURCES[sourceIndex];
            var maxAttempts = source.maxAttempts || 1;
            var url = source.manifestUrl + (source.manifestUrl.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
            requestJson(url, MOVIE_SUBTITLE_TIMEOUT, function (manifest) {
                if (token !== movieFilterToken) return;
                if (manifest && manifest.resources) available.push(source);
                checkSource(sourceIndex + 1, 1);
            }, function () {
                if (token !== movieFilterToken) return;
                if (attempt < maxAttempts) checkSource(sourceIndex, attempt + 1);
                else checkSource(sourceIndex + 1, 1);
            });
        }
        checkSource(0, 1);
    }

    function probeVietsubMovieItem(item, availableSources, done) {
        resolveMovieFilterContext(item, function (context) {
            if (!context) { done(false); return; }
            resolveMovieSubtitleId(context, function (resolvedSubtitleId) {
                var requestId = resolvedSubtitleId || getSubtitleContextId(context);
                if (!requestId) { done(false); return; }
                function checkSource(sourceIndex) {
                    if (sourceIndex >= availableSources.length) { done(false); return; }
                    var source = availableSources[sourceIndex];
                    requestJson(buildSubtitleSourceRequestUrl(source, requestId, context), MOVIE_SUBTITLE_TIMEOUT, function (data) {
                        if (getVietnameseSubtitleOptions(source, data).length > 0) done(true);
                        else checkSource(sourceIndex + 1);
                    }, function () { checkSource(sourceIndex + 1); });
                }
                checkSource(0);
            });
        });
    }

    function getMovieCatalogGenreOptions(catalog, mode) {
        if (!catalog || !Array.isArray(catalog.extra)) return [];
        var options = [];
        for (var i = 0; i < catalog.extra.length; i++) {
            var extra = catalog.extra[i];
            if (!extra || extra.name !== "genre" || !Array.isArray(extra.options)) continue;
            for (var optionIndex = 0; optionIndex < extra.options.length; optionIndex++) {
                var option = String(extra.options[optionIndex] || "");
                var normalized = normalizeMovieSearchText(option);
                if (mode === "vietnam" && normalized === "quoc gia viet nam") options.push(option);
                else if (mode === "china" && (normalized === "quoc gia trung quoc" || normalized === "the loai trung quoc")) options.push(option);
                else if (mode === "korea" && normalized === "quoc gia han quoc") options.push(option);
                else if (mode === "western" && (normalized === "quoc gia au my" || normalized === "quoc gia my")) options.push(option);
                else if (mode === "cinema" && (normalized === "danh muc phim chieu rap" || normalized.indexOf("the loai dien anh ") === 0)) options.push(option);
            }
        }
        if (options.length || mode !== "cinema") return options.length > 1 && mode !== "cinema" ? [options[0]] : options;
        for (var extraIndex = 0; extraIndex < catalog.extra.length; extraIndex++) {
            var fallbackExtra = catalog.extra[extraIndex];
            if (!fallbackExtra || fallbackExtra.name !== "genre" || !Array.isArray(fallbackExtra.options)) continue;
            for (var fallbackIndex = 0; fallbackIndex < fallbackExtra.options.length; fallbackIndex++) {
                var fallbackOption = String(fallbackExtra.options[fallbackIndex] || "");
                if (normalizeMovieSearchText(fallbackOption) === "danh muc phim le") return [fallbackOption];
            }
        }
        return [];
    }

    function getVietnamCountryGenreOption(catalog) {
        var options = getMovieCatalogGenreOptions(catalog, "vietnam");
        return options.length ? options[0] : "";
    }

    function buildMovieCatalogGenreUrl(catalog, genre) {
        return movieBaseUrl + "/catalog/" + encodeURIComponent(catalog.type) + "/" + encodeURIComponent(catalog.id) + "/genre=" + encodeURIComponent(genre) + ".json";
    }

    function getMovieProductionCountryValues(item) {
        if (!item) return [];
        var fields = [item.country, item.countries, item.productionCountry, item.productionCountries, item.production_countries, item.originCountry, item.origin_country, item.countryOfOrigin];
        var values = [];
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            if (Array.isArray(field)) {
                for (var arrayIndex = 0; arrayIndex < field.length; arrayIndex++) {
                    var value = field[arrayIndex];
                    if (value && typeof value === "object") values.push(value.name || value.iso_3166_1 || value.code || "");
                    else values.push(value);
                }
            } else if (field && typeof field === "object") values.push(field.name || field.iso_3166_1 || field.code || "");
            else values.push(field);
        }
        return values;
    }

    function isMovieItemFromCountryMode(item, mode) {
        var values = getMovieProductionCountryValues(item);
        var westernNames = { us: true, usa: true, gb: true, gbr: true, uk: true, ca: true, can: true, au: true, aus: true, fr: true, fra: true, de: true, deu: true, es: true, esp: true, it: true, ita: true };
        for (var valueIndex = 0; valueIndex < values.length; valueIndex++) {
            var normalized = normalizeMovieSearchText(String(values[valueIndex] || ""));
            if (mode === "vietnam" && (normalized === "vn" || normalized === "vnm" || normalized === "viet nam" || normalized === "vietnam" || /(^| )viet nam( |$)/.test(normalized) || /(^| )vietnam( |$)/.test(normalized))) return true;
            if (mode === "china" && (normalized === "cn" || normalized === "chn" || normalized === "prc" || normalized === "trung quoc" || normalized === "china" || normalized === "mainland china" || normalized === "peoples republic of china" || normalized === "chinese")) return true;
            if (mode === "korea" && (normalized === "kr" || normalized === "kor" || normalized === "han quoc" || normalized === "south korea" || normalized === "korea" || normalized === "republic of korea")) return true;
            if (mode === "western" && (westernNames[normalized] || normalized === "au my" || normalized === "chau au" || normalized === "europe" || normalized === "my" || normalized === "hoa ky" || normalized === "united states" || normalized === "united kingdom" || normalized === "england" || normalized === "canada" || normalized === "australia" || normalized === "france" || normalized === "germany" || normalized === "spain" || normalized === "italy")) return true;
        }
        return false;
    }

    function isVietnamProducedMovieItem(item) {
        return isMovieItemFromCountryMode(item, "vietnam");
    }

    function appendMovieMetadataText(value, output, depth) {
        if (value == null || depth > 2) return;
        if (typeof value === "string" || typeof value === "number") { output.push(String(value)); return; }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) appendMovieMetadataText(value[i], output, depth + 1);
            return;
        }
        if (typeof value === "object") {
            var preferredKeys = ["name", "title", "description", "overview", "label", "keyword"];
            for (var keyIndex = 0; keyIndex < preferredKeys.length; keyIndex++) if (value[preferredKeys[keyIndex]] != null) appendMovieMetadataText(value[preferredKeys[keyIndex]], output, depth + 1);
        }
    }

    function getMovieMetadataFilterText(item) {
        if (!item) return "";
        var values = [];
        var fields = [item.name, item.title, item.originalTitle, item.original_title, item.description, item.overview, item.genres, item.genre, item.tags, item.keywords, item.studio, item.studios, item.network, item.networks, item.productionCompanies, item.production_companies, item.links, item.country, item.countries, item.productionCountries, item.production_countries, item.originCountry, item.origin_country];
        for (var i = 0; i < fields.length; i++) appendMovieMetadataText(fields[i], values, 0);
        return normalizeMovieSearchText(values.join(" "));
    }

    /* =====================================================
       QUY TẮC LỌC NÚT "MAVEL" (mode: marvel) - BẢN MỚI
       Lọc các phim thuộc 5 thương hiệu:
       Marvel, DC, Disney, Sony, Star Wars
       ===================================================== */

    // Từ khóa khớp ở BẤT KỲ trường metadata nào (tên phim, mô tả, hãng
    // sản xuất, từ khóa...): tên thương hiệu, studio và các cụm tên phim
    // đặc thù không bị nhầm với phim khác.
    var MOVIE_BRAND_STRONG_KEYWORDS = [
        // Marvel
        "marvel", "marvels", "mavel", "mcu", "marvel studios", "marvel comics", "marvel films",
        "avengers", "iron man", "captain america", "black panther", "black widow", "spider man", "spiderman",
        "guardians of the galaxy", "ve binh dai ngan ha", "doctor strange", "deadpool", "wolverine",
        "x men", "xmen", "fantastic four", "bo tu sieu dang", "daredevil", "loki", "wandavision",
        "hawkeye", "moon knight", "she hulk", "thor", "hulk", "ant man", "eternals",
        "nguoi sat", "nguoi nhen", "bao den", "phu thuy toi thuong", "nguoi kien", "di nhan", "ms marvel", "dai uy marvel",
        // DC
        "dc comics", "dc universe", "dcu", "dc extended universe",
        "batman", "batgirl", "dark knight", "superman", "man of steel", "wonder woman",
        "aquaman", "green lantern", "justice league", "joker", "shazam", "suicide squad", "harley quinn", "gotham",
        // Disney
        "disney", "disney studios", "pixar",
        "lion king", "moana", "zootopia", "aladdin", "mulan", "tarzan", "pinocchio", "cinderella",
        "snow white", "little mermaid", "beauty and the beast", "jungle book", "hercules", "bambi",
        "dumbo", "pocahontas", "toy story", "finding nemo", "incredibles", "ratatouille", "wall e",
        "inside out", "monsters inc", "monsters university", "buzz lightyear", "tinker bell",
        "pirates of the caribbean", "mary poppins", "hocus pocus", "croods", "encanto", "turning red",
        "lilo and stitch", "winnie the pooh", "muppets", "high school musical", "hannah montana",
        "101 dalmatians", "hunchback of notre dame", "lady and the tramp", "emperor new groove", "alice in wonderland",
        // Sony
        "sony", "sony pictures", "jumanji", "men in black", "venom", "bad boys", "ghostbusters", "jack reacher",
        // Star Wars
        "star wars", "star war", "skywalker", "jedi", "darth vader", "darth sith", "chewbacca",
        "c3po", "bb8", "r2d2", "a new hope", "empire strikes back", "return of the jedi",
        "force awakens", "last jedi", "rise of skywalker", "phantom menace", "clone wars",
        "rogue one", "mandalorian", "obi wan", "ahsoka", "boba fett", "bad batch",
        "chien tranh gia cac vi sao"
    ];

    // Từ khóa chỉ khớp trong TÊN PHIM (không khớp ở mô tả): các từ đơn
    // có thể xuất hiện trong mô tả của phim khác nên giới hạn ở tên để
    // tránh lọc nhầm.
    var MOVIE_BRAND_TITLE_KEYWORDS = [
        "frozen", "cars", "brave", "flash", "stitch", "pooh", "olaf", "dc"
    ];

    function buildBrandKeywordRegExp(keywords) {
        var terms = [];
        for (var i = 0; i < keywords.length; i++) {
            var term = String(keywords[i] || "").replace(/\s+/g, " ");
            if (term) terms.push(term);
        }
        return new RegExp("(^| )(" + terms.join("|") + ")( |$)");
    }

    var MOVIE_BRAND_STRONG_PATTERN = buildBrandKeywordRegExp(MOVIE_BRAND_STRONG_KEYWORDS);
    var MOVIE_BRAND_TITLE_PATTERN = buildBrandKeywordRegExp(MOVIE_BRAND_TITLE_KEYWORDS);

    function getMovieTitleFilterText(item) {
        if (!item) return "";
        var values = [];
        var fields = [item.name, item.title, item.originalTitle, item.original_title];
        for (var i = 0; i < fields.length; i++) appendMovieMetadataText(fields[i], values, 0);
        return normalizeMovieSearchText(values.join(" "));
    }

    function isMovieBrandItem(item) {
        var text = getMovieMetadataFilterText(item);
        if (!text) return false;
        if (MOVIE_BRAND_STRONG_PATTERN.test(text)) return true;
        var title = getMovieTitleFilterText(item);
        return !!title && MOVIE_BRAND_TITLE_PATTERN.test(title);
    }

    function classifyMovieFilterItems(items, fallbackType, token, done, onProgress) {
        var list = Array.isArray(items) ? items : [];
        if (list.length === 0) { done([]); return; }
        var results = new Array(list.length);
        var nextIndex = 0;
        var completed = 0;
        var active = 0;

        function launchMore() {
            if (token !== movieFilterToken) return;
            while (active < MOVIE_CLASSIFICATION_CONCURRENCY && nextIndex < list.length) {
                (function (itemIndex) {
                    active++;
                    classifyMovieItem(list[itemIndex], fallbackType, function (classified) {
                        active--;
                        completed++;
                        results[itemIndex] = classified;
                        if (token !== movieFilterToken) return;
                        if (completed >= list.length) { done(results); return; }
                        if (onProgress) { try { onProgress(results, completed, list.length); } catch (progressError) {} }
                        launchMore();
                    });
                })(nextIndex++);
            }
        }
        launchMore();
    }

    function runMovieGenreFilter(mode, token) {
        var catalog = movieCatalogs[movieCatalogIndex];
        if (!catalog) return;
        var catalogIdentity = getMovieCatalogIdentity(catalog, movieBaseUrl);
        var labels = {
            vietnam: { title: "Việt Nam", loading: "Đang lọc phim sản xuất tại Việt Nam…", unsupported: "Nguồn này không cung cấp thông tin quốc gia Việt Nam" },
            china: { title: "Trung Quốc", loading: "Đang lọc phim Trung Quốc và cốt truyện Trung Hoa…", unsupported: "Nguồn này không cung cấp thông tin phim Trung Quốc" },
            korea: { title: "Hàn Quốc", loading: "Đang lọc phim Hàn Quốc…", unsupported: "Nguồn này không cung cấp thông tin phim Hàn Quốc" },
            western: { title: "Âu Mỹ", loading: "Đang lọc phim Âu Mỹ…", unsupported: "Nguồn này không cung cấp thông tin phim Âu Mỹ" },
            cinema: { title: "Điện Ảnh", loading: "Đang lọc phim Điện Ảnh…", unsupported: "Nguồn này không cung cấp danh mục Điện Ảnh" }
        };
        var label = labels[mode] || labels.vietnam;

        function finishGenreFilter(items, sourceUnavailable) {
            if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
            movieItems = sortMovieItemsByProductionYear(isMergedMovieCatalog(catalog) ? dedupeMergedMovieItems(items || []) : dedupeMovieItems(items || []));
            movieItemIndex = 0;
            movieFilterInProgress = false;
            cacheMovieFilterResult(catalog, mode, movieItems, movieBaseUrl);
            renderMovieItems();
            if (movieItems.length) showMovieStatus(movieItems.length + " phim " + label.title, false);
            else showMovieStatus(sourceUnavailable ? label.unsupported : "Không tìm thấy phim " + label.title, true);
        }

        function useLocalMetadata(sourceUnavailable) {
            var localMatches = [];
            for (var i = 0; i < movieAllItems.length; i++) {
                var item = movieAllItems[i];
                if (mode === "cinema" ? item && item.type === "movie" : mode === "china" ? isMovieItemFromCountryMode(item, "china") : isMovieItemFromCountryMode(item, mode)) localMatches.push(item);
            }
            finishGenreFilter(localMatches, sourceUnavailable && localMatches.length === 0);
        }

        if (isMergedMovieCatalog(catalog)) {
            if (mode === "cinema") { useLocalMetadata(false); return; }
            var mergedLocalMatches = [];
            for (var localIndex = 0; localIndex < movieAllItems.length; localIndex++) {
                var localItem = movieAllItems[localIndex];
                if (mode === "china" ? isMovieItemFromCountryMode(localItem, "china") : isMovieItemFromCountryMode(localItem, mode)) mergedLocalMatches.push(localItem);
            }
            var memberTasks = [];
            for (var memberIndex = 0; memberIndex < catalog._bintvMemberCatalogs.length; memberIndex++) {
                var memberCatalog = catalog._bintvMemberCatalogs[memberIndex];
                var memberOptions = getMovieCatalogGenreOptions(memberCatalog, mode);
                for (var memberOptionIndex = 0; memberOptionIndex < memberOptions.length; memberOptionIndex++) memberTasks.push({ catalog: memberCatalog, option: memberOptions[memberOptionIndex] });
            }
            if (!memberTasks.length) { finishGenreFilter(mergedLocalMatches, mergedLocalMatches.length === 0); return; }
            showMovieStatus(label.loading, false);
            var mergedPending = memberTasks.length;
            var mergedSuccessfulResponses = 0;
            var mergedMetas = [];
            var mergedMetasIds = {};
            var mergedDisplayQueued = false;
            var mergedTaskIndex = 0;
            var mergedActive = 0;

            // Hiển thị ngay khi có nguồn trả về phim (gộp với phim khớp trong danh mục đang mở)
            function queueMergedGenreDisplay() {
                if (mergedDisplayQueued) return;
                mergedDisplayQueued = true;
                setTimeout(function () {
                    mergedDisplayQueued = false;
                    if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                    var items = mergedLocalMatches.concat(mergedMetas);
                    if (!items.length) return;
                    movieItems = sortMovieItemsByProductionYear(dedupeMergedMovieItems(items));
                    movieItemIndex = 0;
                    renderMovieItems();
                    showMovieStatus(movieItems.length + " phim " + label.title + " · đang tìm tiếp…", false);
                }, 300);
            }
            function finishMergedGenreRequest() {
                mergedActive--;
                mergedPending--;
                if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                if (mergedPending <= 0) {
                    if (!mergedSuccessfulResponses) { finishGenreFilter(mergedLocalMatches, mergedLocalMatches.length === 0); return; }
                    classifyMovieFilterItems(dedupeMovieItems(mergedMetas), catalog.type, token, function (classified) {
                        if (token !== movieFilterToken) return;
                        var matching = mergedLocalMatches.slice(0);
                        for (var classifiedIndex = 0; classifiedIndex < classified.length; classifiedIndex++) if (classified[classifiedIndex] && classified[classifiedIndex].type === catalog.type) matching.push(classified[classifiedIndex]);
                        finishGenreFilter(matching, false);
                    });
                    return;
                }
                launchMergedGenreRequests();
            }
            function launchMergedGenreRequests() {
                if (token !== movieFilterToken) return;
                while (mergedActive < MOVIE_MERGED_CATALOG_CONCURRENCY && mergedTaskIndex < memberTasks.length) {
                    (function (task) {
                        mergedActive++;
                        requestJson(buildMovieCatalogGenreUrl(task.catalog, task.option), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
                            if (token !== movieFilterToken) return;
                            mergedSuccessfulResponses++;
                            var metas = data && Array.isArray(data.metas) ? data.metas : [];
                            var added = false;
                            for (var metaIndex = 0; metaIndex < metas.length; metaIndex++) {
                                var meta = metas[metaIndex];
                                if (!meta || !meta.id) continue;
                                if (!meta.type) meta.type = task.catalog.type;
                                if (!mergedMetasIds[String(meta.id)]) { mergedMetasIds[String(meta.id)] = true; mergedMetas.push(meta); added = true; }
                            }
                            if (added) queueMergedGenreDisplay();
                            finishMergedGenreRequest();
                        }, function () { finishMergedGenreRequest(); });
                    })(memberTasks[mergedTaskIndex++]);
                }
            }
            launchMergedGenreRequests();
            return;
        }

        var genreOptions = getMovieCatalogGenreOptions(catalog, mode);
        if (!genreOptions.length) { useLocalMetadata(true); return; }
        showMovieStatus(label.loading, false);
        var pending = genreOptions.length;
        var collected = [];
        var collectedIds = {};
        var successfulResponses = 0;
        var genreDisplayQueued = false;

        // Hiển thị ngay khi nguồn trả về phim, không chờ hết các nguồn
        function queueGenreDisplay() {
            if (genreDisplayQueued) return;
            genreDisplayQueued = true;
            setTimeout(function () {
                genreDisplayQueued = false;
                if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                if (!collected.length) return;
                var items = dedupeMovieItems(collected);
                movieItems = sortMovieItemsByProductionYear(isMergedMovieCatalog(catalog) ? dedupeMergedMovieItems(items) : items);
                movieItemIndex = 0;
                renderMovieItems();
                showMovieStatus(movieItems.length + " phim " + label.title + " · đang tìm tiếp…", false);
            }, 300);
        }

        function pushCollectedMetas(metas, fallbackType) {
            var added = false;
            for (var metaIndex = 0; metaIndex < metas.length; metaIndex++) {
                var meta = metas[metaIndex];
                if (!meta || !meta.id) continue;
                if (!meta.type) meta.type = fallbackType;
                if (!collectedIds[String(meta.id)]) { collectedIds[String(meta.id)] = true; collected.push(meta); added = true; }
            }
            if (added) queueGenreDisplay();
        }

        function finishRequest() {
            pending--;
            if (pending > 0 || token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
            if (!successfulResponses) { useLocalMetadata(true); return; }
            classifyMovieFilterItems(dedupeMovieItems(collected), catalog.type, token, function (classified) {
                if (token !== movieFilterToken) return;
                var matchingType = [];
                for (var i = 0; i < classified.length; i++) {
                    if (!classified[i]) continue;
                    if (mode === "cinema" ? classified[i].type === "movie" : classified[i].type === catalog.type) matchingType.push(classified[i]);
                }
                if (mode === "china") for (var localChinaIndex = 0; localChinaIndex < movieAllItems.length; localChinaIndex++) if (isMovieItemFromCountryMode(movieAllItems[localChinaIndex], "china")) matchingType.push(movieAllItems[localChinaIndex]);
                finishGenreFilter(matchingType, false);
            });
        }
        for (var optionIndex = 0; optionIndex < genreOptions.length; optionIndex++) {
            requestJson(buildMovieCatalogGenreUrl(catalog, genreOptions[optionIndex]), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
                if (token !== movieFilterToken) return;
                successfulResponses++;
                var metas = data && Array.isArray(data.metas) ? data.metas : [];
                pushCollectedMetas(metas, catalog.type);
                finishRequest();
            }, function () { finishRequest(); });
        }
    }

    function runVietnamMovieFilter(token) {
        runMovieGenreFilter("vietnam", token);
    }

    function runMovieBrandFilter(token) {
        var catalog = movieCatalogs[movieCatalogIndex];
        if (!catalog) return;
        var catalogIdentity = getMovieCatalogIdentity(catalog, movieBaseUrl);
        var localMatches = [];
        for (var localIndex = 0; localIndex < movieAllItems.length; localIndex++) if (isMovieBrandItem(movieAllItems[localIndex])) localMatches.push(movieAllItems[localIndex]);
        localMatches = sortMovieItemsByProductionYear(dedupeMergedMovieItems(localMatches));

        function finishBrandFilter(extraItems) {
            if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
            var combined = localMatches.concat(extraItems || []);
            movieItems = sortMovieItemsByProductionYear(dedupeMergedMovieItems(combined));
            movieItemIndex = 0;
            movieFilterInProgress = false;
            cacheMovieFilterResult(catalog, "marvel", movieItems, movieBaseUrl);
            renderMovieItems();
            showMovieStatus(movieItems.length ? movieItems.length + " phim Mavel/Marvel" : "Không tìm thấy phim Mavel/Marvel", movieItems.length === 0);
        }

        var members = expandMergedMovieCatalogs([catalog]);
        var searchableMembers = [];
        for (var memberIndex = 0; memberIndex < members.length; memberIndex++) if (members[memberIndex] && members[memberIndex].type === catalog.type && movieCatalogSupportsSearch(members[memberIndex])) searchableMembers.push(members[memberIndex]);
        var brandTerms = [
            "Marvel", "Mavel", "Avengers", "Spider Man", "Guardians of the Galaxy",
            "DC", "Batman", "Superman", "Wonder Woman", "Aquaman", "Flash", "Justice League", "Joker",
            "Disney", "Pixar", "Lion King", "Frozen", "Toy Story", "Aladdin", "Incredibles", "Pirates of the Caribbean", "Encanto",
            "Sony", "Jumanji", "Men in Black", "Venom", "Ghostbusters",
            "Star Wars", "Skywalker", "Mandalorian", "Rogue One"
        ];
        // Xếp vòng tròn: mỗi từ khóa quét qua TẤT CẢ nguồn trong một lượt,
        // để kết quả từ từng nguồn sớm có thay vì chờ cạn nguồn thứ nhất
        var tasks = [];
        for (var termIndex = 0; termIndex < brandTerms.length; termIndex++) for (var sourceIndex = 0; sourceIndex < searchableMembers.length; sourceIndex++) tasks.push({ catalog: searchableMembers[sourceIndex], term: brandTerms[termIndex] });
        if (!tasks.length) { finishBrandFilter([]); return; }

        if (localMatches.length) {
            movieItems = localMatches.slice(0);
            movieItemIndex = 0;
            renderMovieItems();
        }
        showMovieStatus("Đang tìm phim Mavel/Marvel trên " + searchableMembers.length + " nguồn…", false);
        var candidates = [];
        var candidateIds = {};
        var displayItems = [];
        var displayIds = {};
        var displayQueued = false;
        var nextTask = 0;
        var active = 0;
        var completed = 0;
        var lastProgressAt = 0;

        function brandDisplayKey(item) {
            return String((item && item.type) || catalog.type) + "|" + String((item && item.id) || "");
        }

        // Hiển thị ngay lập tức khi tìm thấy phim đạt điều kiện lọc (không chờ hết các nguồn)
        function queueBrandDisplay() {
            if (displayQueued) return;
            displayQueued = true;
            setTimeout(function () {
                displayQueued = false;
                if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                if (!displayItems.length) return;
                movieItems = displayItems.slice(0);
                movieItemIndex = 0;
                renderMovieItems();
                showMovieStatus(movieItems.length + " phim Mavel/Marvel · đang tìm tiếp…", false);
            }, 250);
        }

        function finishTask() {
            active--;
            completed++;
            if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
            var now = Date.now();
            if (now - lastProgressAt >= 180 && completed < tasks.length) {
                lastProgressAt = now;
                showMovieStatus("Đang lọc thương hiệu " + completed + "/" + tasks.length + " · đã có " + displayItems.length + " phim…", false);
            }
            if (completed >= tasks.length) {
                if (!candidates.length) { finishBrandFilter([]); return; }
                var verifyQueued = false;
                classifyMovieFilterItems(dedupeMovieItems(candidates), catalog.type, token, function (classified) {
                    if (token !== movieFilterToken) return;
                    var matched = [];
                    for (var classifiedIndex = 0; classifiedIndex < classified.length; classifiedIndex++) {
                        var item = classified[classifiedIndex];
                        if (item && item.type === catalog.type && isMovieBrandItem(item)) matched.push(item);
                    }
                    finishBrandFilter(matched);
                }, function (results) {
                    // Xác minh xong từng phim là cập nhật lưới ngay (loại phim sai loại, giữ phim đúng)
                    if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                    if (verifyQueued) return;
                    verifyQueued = true;
                    setTimeout(function () {
                        verifyQueued = false;
                        if (token !== movieFilterToken || catalogIdentity !== movieActiveCatalogIdentity) return;
                        var verified = localMatches.slice(0);
                        var verifiedIds = {};
                        for (var localKeyIndex = 0; localKeyIndex < localMatches.length; localKeyIndex++) verifiedIds[brandDisplayKey(localMatches[localKeyIndex])] = true;
                        for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
                            var item = results[resultIndex];
                            if (!item) continue;
                            if (item.type === catalog.type && isMovieBrandItem(item)) {
                                var verifiedKey = brandDisplayKey(item);
                                if (!verifiedIds[verifiedKey]) { verifiedIds[verifiedKey] = true; verified.push(item); }
                            }
                        }
                        movieItems = sortMovieItemsByProductionYear(verified);
                        movieItemIndex = 0;
                        renderMovieItems();
                        showMovieStatus(movieItems.length + " phim Mavel/Marvel · đang xác minh…", false);
                    }, 500);
                });
                return;
            }
            launchTasks();
        }

        function launchTasks() {
            if (token !== movieFilterToken) return;
            while (active < MOVIE_BRAND_FILTER_CONCURRENCY && nextTask < tasks.length) {
                (function (task) {
                    active++;
                    requestJson(buildMovieCatalogSearchUrl(task.catalog, task.term), MOVIE_CLASSIFICATION_TIMEOUT, function (data) {
                        if (token !== movieFilterToken) return;
                        var metas = data && Array.isArray(data.metas) ? data.metas : [];
                        var addedForDisplay = false;
                        for (var metaIndex = 0; metaIndex < metas.length && candidates.length < MOVIE_BRAND_FILTER_MAX_CANDIDATES; metaIndex++) {
                            var meta = metas[metaIndex];
                            if (!meta || !meta.id) continue;
                            if (!meta.type) meta.type = task.catalog.type;
                            if (!isMovieBrandItem(meta)) continue;
                            if (!candidateIds[String(meta.id)]) { candidateIds[String(meta.id)] = true; candidates.push(meta); }
                            var displayKey = brandDisplayKey(meta);
                            if (!displayIds[displayKey]) { displayIds[displayKey] = true; displayItems.push(meta); addedForDisplay = true; }
                        }
                        if (addedForDisplay) queueBrandDisplay();
                        finishTask();
                    }, function () { finishTask(); });
                })(tasks[nextTask++]);
            }
        }
        launchTasks();
    }

    function runMovieItemFilter(mode, availableSources, token) {
        var sourceItems = movieAllItems.slice(0);
        var results = [];
        var nextIndex = 0;
        var pending = 0;
        var completed = 0;
        var concurrency = 3;
        var matchedItems = [];
        var matchedQueued = false;

        // Hiển thị ngay khi kiểm tra thấy phim đạt điều kiện, không chờ hết danh sách
        function queueMatchedDisplay() {
            if (matchedQueued) return;
            matchedQueued = true;
            setTimeout(function () {
                matchedQueued = false;
                if (token !== movieFilterToken) return;
                if (!matchedItems.length) return;
                movieItems = sortMovieItemsByProductionYear(matchedItems.slice(0));
                movieItemIndex = 0;
                renderMovieItems();
            }, 300);
        }

        function finishOne(itemIndex, matched) {
            if (token !== movieFilterToken) return;
            pending--;
            completed++;
            if (matched) { results.push({ index: itemIndex, item: sourceItems[itemIndex] }); matchedItems.push(sourceItems[itemIndex]); queueMatchedDisplay(); }
            showMovieStatus("Đang kiểm tra " + completed + "/" + sourceItems.length + "…", false);
            if (completed >= sourceItems.length) {
                results.sort(function (a, b) { return a.index - b.index; });
                movieItems = [];
                for (var i = 0; i < results.length; i++) movieItems.push(results[i].item);
                movieItems = sortMovieItemsByProductionYear(movieItems);
                movieItemIndex = 0;
                movieFilterInProgress = false;
                if (movieCatalogs[movieCatalogIndex] && getMovieCatalogIdentity(movieCatalogs[movieCatalogIndex], movieBaseUrl) === movieActiveCatalogIdentity) {
                    cacheMovieFilterResult(movieCatalogs[movieCatalogIndex], mode, movieItems, movieBaseUrl);
                }
                renderMovieItems();
                showMovieStatus(movieItems.length ? movieItems.length + " phim phù hợp" : "Không tìm thấy phim phù hợp", movieItems.length === 0);
                return;
            }
            launchMore();
        }

        function launchMore() {
            if (token !== movieFilterToken) return;
            while (pending < concurrency && nextIndex < sourceItems.length) {
                (function (itemIndex) {
                    pending++;
                    nextIndex++;
                    if (mode === "narrated") probeNarratedMovieItem(sourceItems[itemIndex], function (matched) { finishOne(itemIndex, matched); });
                    else probeVietsubMovieItem(sourceItems[itemIndex], availableSources, function (matched) { finishOne(itemIndex, matched); });
                })(nextIndex);
            }
        }

        if (sourceItems.length === 0) {
            movieFilterInProgress = false;
            movieItems = [];
            renderMovieItems();
            showMovieStatus("Danh mục này chưa có nội dung", true);
            return;
        }
        launchMore();
    }

    function applyCurrentMovieFilter() {
        movieFilterToken++;
        var token = movieFilterToken;
        movieItemIndex = 0;
        renderMovieFilters();

        if (movieFilterMode === "all") {
            movieFilterInProgress = false;
            movieItems = sortMovieItemsByProductionYear(movieAllItems.slice(0));
            renderMovieItems();
            showMovieStatus(movieItems.length ? movieItems.length + " nội dung" : "Danh mục này chưa có nội dung", movieItems.length === 0);
            return;
        }

        var activeCatalog = movieCatalogs[movieCatalogIndex];
        var cachedFilter = activeCatalog ? getMovieFilterCacheEntry(activeCatalog, movieFilterMode, movieBaseUrl) : null;
        if (cachedFilter) {
            movieFilterInProgress = false;
            movieItems = sortMovieItemsByProductionYear(cachedFilter.items);
            renderMovieItems();
            var cachedFilterLabels = { vietnam: "Việt Nam", china: "Trung Quốc", korea: "Hàn Quốc", western: "Âu Mỹ", marvel: "Mavel/Marvel" };
            var cachedFilterLabel = cachedFilterLabels[movieFilterMode];
            if (cachedFilterLabel) showMovieStatus(movieItems.length ? movieItems.length + " phim " + cachedFilterLabel : "Không tìm thấy phim " + cachedFilterLabel, movieItems.length === 0);
            else showMovieStatus(movieItems.length ? movieItems.length + " phim phù hợp" : "Không tìm thấy phim phù hợp", movieItems.length === 0);
            return;
        }

        movieFilterInProgress = true;
        movieItems = [];
        renderMovieLoadingSkeleton();
        if (movieFilterMode === "vietnam" || movieFilterMode === "china" || movieFilterMode === "korea" || movieFilterMode === "western") {
            runMovieGenreFilter(movieFilterMode, token);
            return;
        }
        if (movieFilterMode === "marvel") {
            runMovieBrandFilter(token);
            return;
        }
        if (movieFilterMode === "narrated") {
            showMovieStatus("Đang kiểm tra audio Thuyết Minh…", false);
            runMovieItemFilter("narrated", [], token);
            return;
        }

        showMovieStatus("Đang kiểm tra VietSub thực tế…", false);
        collectAvailableFilterSubtitleSources(token, function (sources) {
            if (token !== movieFilterToken) return;
            if (sources.length === 0) {
                movieFilterInProgress = false;
                renderMovieItems();
                showMovieStatus("Không có nguồn VietSub hoạt động", true);
                return;
            }
            runMovieItemFilter("vietsub", sources, token);
        });
    }

    function isMovieTvCardLayoutActive() {
        var catalog = movieCatalogs[movieCatalogIndex];
        return !!(catalog && catalog.type === "tv");
    }

    function updateMovieGridCardLayout(grid) {
        if (grid) grid.classList.toggle("movie-grid-tv", isMovieTvCardLayoutActive());
    }

    function renderMovieLoadingSkeleton() {
        var grid = document.getElementById("bintv-movie-grid");
        updateMovieGridCardLayout(grid);
        movieCardElements = [];
        movieLastItemFocusIndex = -1;
        if (movieLastFocusArea === "items") movieLastFocusArea = "";
        if (!grid) return;
        grid.innerHTML = "";
        for (var i = 0; i < 12; i++) {
            var card = document.createElement("div");
            card.className = "movie-card movie-card-skeleton";
            var poster = document.createElement("div");
            poster.className = "movie-card-poster movie-skeleton-block";
            var name = document.createElement("div");
            name.className = "movie-skeleton-name movie-skeleton-block";
            var meta = document.createElement("div");
            meta.className = "movie-skeleton-meta movie-skeleton-block";
            card.appendChild(poster);
            card.appendChild(name);
            card.appendChild(meta);
            grid.appendChild(card);
        }
    }

    function renderMovieItems() {
        var grid = document.getElementById("bintv-movie-grid");
        updateMovieGridCardLayout(grid);
        movieCardElements = [];
        movieLastItemFocusIndex = -1;
        if (movieLastFocusArea === "items") movieLastFocusArea = "";
        if (!grid) return;
        grid.innerHTML = "";
        for (var i = 0; i < movieItems.length; i++) {
            (function (itemIndex) {
                var item = movieItems[itemIndex];
                var card = document.createElement("div");
                card.className = "movie-card";
                // [Phim LAN14 2026-09] data-* attributes cho debug capture + tabindex
                // để focus bằng phím mũi tên trên Electron. Không ảnh hưởng app.js gốc
                // (BinTV APK click chuột vẫn dùng addEventListener bên dưới).
                card.setAttribute("data-movie-id", String(item.id || ""));
                card.setAttribute("data-movie-name", String(item.name || ""));
                card.setAttribute("data-movie-type", String(item.type || ""));
                card.setAttribute("tabindex", "0");

                var poster = document.createElement("img");
                poster.className = "movie-card-poster";
                poster.alt = item.name || "Phim";
                poster.setAttribute("loading", "lazy");
                poster.setAttribute("decoding", "async");
                poster.src = item.poster || item.background || "Phim.png";
                poster.onerror = function () { this.onerror = null; this.src = "Phim.png"; };

                var name = document.createElement("div");
                name.className = "movie-card-name";
                name.textContent = item.name || "Phim";

                var meta = document.createElement("div");
                meta.className = "movie-card-meta";
                meta.textContent = item.releaseInfo || item.description || "";

                card.appendChild(poster);
                card.appendChild(name);
                card.appendChild(meta);
                card.addEventListener("click", function () {
                    movieBrowserFocusArea = "items";
                    movieItemIndex = itemIndex;
                    if (window.__phimDebug) window.__phimDebug.log("[PLAYER] card click", { id: item.id, name: item.name, type: item.type });
                    openMovieItem(movieItems[itemIndex]);
                });
                // [Phim LAN14 2026-09] Enter/Space trên card cũng mở phim (hỗ trợ
                // khi user focus bằng tabindex thay vì chuột).
                card.addEventListener("keydown", function (e) {
                    var keyCode = e && (e.keyCode || e.which || e.charCode);
                    if (keyCode === 13 || keyCode === 32 || (e && (e.key === "Enter" || e.key === " "))) {
                        e.preventDefault();
                        movieBrowserFocusArea = "items";
                        movieItemIndex = itemIndex;
                        openMovieItem(movieItems[itemIndex]);
                    }
                });
                movieCardElements[itemIndex] = card;
                grid.appendChild(card);
            })(i);
        }
        updateMovieBrowserFocus();
    }

    function updateMovieBrowserFocus() {
        renderMovieFilters();
        var previousArea = movieLastFocusArea;
        var previousCatalogIndex = movieLastCatalogFocusIndex;
        var previousItemIndex = movieLastItemFocusIndex;
        var areaChanged = previousArea !== movieBrowserFocusArea;

        if (previousArea === "catalogs" && (areaChanged || previousCatalogIndex !== movieCatalogIndex)) {
            if (movieCatalogRowElements[previousCatalogIndex]) movieCatalogRowElements[previousCatalogIndex].classList.remove("focus");
        }
        if (previousArea === "items" && (areaChanged || previousItemIndex !== movieItemIndex)) {
            if (movieCardElements[previousItemIndex]) movieCardElements[previousItemIndex].classList.remove("focus");
        }

        if (movieLastSelectedCatalogIndex !== movieCatalogIndex) {
            if (movieCatalogRowElements[movieLastSelectedCatalogIndex]) movieCatalogRowElements[movieLastSelectedCatalogIndex].classList.remove("selected");
            if (movieCatalogRowElements[movieCatalogIndex]) movieCatalogRowElements[movieCatalogIndex].classList.add("selected");
            movieLastSelectedCatalogIndex = movieCatalogIndex;
        }

        if (movieBrowserFocusArea === "catalogs" && (areaChanged || previousCatalogIndex !== movieCatalogIndex)) {
            if (movieCatalogRowElements[movieCatalogIndex]) movieCatalogRowElements[movieCatalogIndex].classList.add("focus");
        }
        if (movieBrowserFocusArea === "items" && (areaChanged || previousItemIndex !== movieItemIndex)) {
            if (movieCardElements[movieItemIndex]) movieCardElements[movieItemIndex].classList.add("focus");
        }

        if (movieBrowserFocusArea === "catalogs" && (areaChanged || previousCatalogIndex !== movieCatalogIndex) && movieCatalogRowElements[movieCatalogIndex]) {
            try { movieCatalogRowElements[movieCatalogIndex].scrollIntoView(false); } catch (catalogScrollError) {}
        }
        if (movieBrowserFocusArea === "items" && (areaChanged || Math.floor(previousItemIndex / 5) !== Math.floor(movieItemIndex / 5)) && movieCardElements[movieItemIndex]) {
            try { movieCardElements[movieItemIndex].scrollIntoView(false); } catch (itemScrollError) {}
        }

        movieLastFocusArea = movieBrowserFocusArea;
        if (movieBrowserFocusArea === "catalogs") movieLastCatalogFocusIndex = movieCatalogIndex;
        if (movieBrowserFocusArea === "items") movieLastItemFocusIndex = movieItemIndex;
    }

    function buildMovieResourceUrlForBase(baseUrl, resource, type, id) {
        return String(baseUrl || "") + "/" + resource + "/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + ".json";
    }

    function buildMovieResourceUrl(resource, type, id) {
        return buildMovieResourceUrlForBase(movieBaseUrl, resource, type, id);
    }

    function removeEmptyMovieCatalog(catalogIndex, autoRemaining) {
        if (catalogIndex < 0 || catalogIndex >= movieCatalogs.length) return;
        movieCatalogs.splice(catalogIndex, 1);
        if (movieCatalogs.length === 0) {
            movieCatalogIndex = 0;
            movieItems = [];
            movieAllItems = [];
            renderMovieCatalogs();
            renderMovieItems();
            showMovieStatus("Không còn nguồn nào có nội dung", true);
            return;
        }
        var nextIndex = Math.min(catalogIndex, movieCatalogs.length - 1);
        movieCatalogIndex = nextIndex;
        renderMovieCatalogs();
        loadMovieCatalog(nextIndex, Math.max(1, (autoRemaining || 1) - 1));
    }

    function loadMovieCatalog(catalogIndex, autoRemaining) {
        if (!movieBrowserOpen || !movieCatalogs[catalogIndex]) return;
        movieSearchResultsActive = false;
        movieSearchQuery = "";
        movieFilterToken++;
        movieFilterInProgress = false;
        movieCatalogIndex = catalogIndex;
        movieItemIndex = 0;
        var catalog = movieCatalogs[catalogIndex];
        var catalogIdentity = getMovieCatalogIdentity(catalog, movieBaseUrl);
        movieActiveCatalogIdentity = catalogIdentity;
        var loadToken = ++movieCatalogLoadToken;
        renderMovieCatalogs();

        var title = document.getElementById("bintv-movie-catalog-title");
        if (title) title.textContent = getMovieCatalogDisplayName(catalogIndex);

        function isStillActive() {
            return movieBrowserOpen && movieActiveCatalogIdentity === catalogIdentity && loadToken === movieCatalogLoadToken;
        }

        function applyClassifiedItems(classifiedItems, backgroundUpdate) {
            if (!isStillActive()) return;
            if (classifiedItems.length === 0) {
                if (!backgroundUpdate) {
                    var currentCatalogIndex = -1;
                    for (var emptyIndex = 0; emptyIndex < movieCatalogs.length; emptyIndex++) if (getMovieCatalogIdentity(movieCatalogs[emptyIndex], movieBaseUrl) === catalogIdentity) { currentCatalogIndex = emptyIndex; break; }
                    if (currentCatalogIndex >= 0) removeEmptyMovieCatalog(currentCatalogIndex, autoRemaining);
                }
                return;
            }
            function commitItems(items) {
                if (!isStillActive()) return;
                movieAllItems = items;
                movieItemIndex = 0;
                applyCurrentMovieFilter();
            }
            if (isPrimaryMovieTvCatalog(catalog)) {
                if (!backgroundUpdate) {
                    renderMovieLoadingSkeleton();
                    showMovieStatus("Đang kiểm tra các link truyền hình đang hoạt động…", false);
                }
                validateMovieTvCatalogItems(classifiedItems, loadToken, function (availableItems) {
                    if (!isStillActive()) return;
                    if (!availableItems.length) {
                        movieItems = [];
                        movieAllItems = [];
                        renderMovieItems();
                        showMovieStatus("Không có link truyền hình đang hoạt động", true);
                        return;
                    }
                    commitItems(availableItems);
                });
                return;
            }
            commitItems(classifiedItems);
        }

        var lastPartialCommitAt = 0;

        function processCatalogMetas(metas, backgroundUpdate) {
            if (!isStillActive()) return;
            if (!backgroundUpdate) showMovieStatus("Đang xác minh phim lẻ và phim bộ…", false);
            prepareClassifiedMovieCatalog(catalog, metas, loadToken, function (classifiedItems) {
                applyClassifiedItems(classifiedItems, backgroundUpdate);
            }, function (partialItems) {
                // Hiển thị dần: phim nào xác minh xong là cho xem ngay, không chờ đủ danh sách
                if (backgroundUpdate || isPrimaryMovieTvCatalog(catalog) || !partialItems.length) return;
                var now = Date.now();
                if (now - lastPartialCommitAt < 400) return;
                lastPartialCommitAt = now;
                movieAllItems = partialItems.slice(0);
                movieItemIndex = 0;
                if (movieFilterMode === "all") applyCurrentMovieFilter();
                // Đang bật bộ lọc: chỉ cập nhật kho phim, lần commit cuối sẽ chạy lọc lại
            });
        }

        function processMergedCatalog() {
            var members = catalog._bintvMemberCatalogs || [];
            var memberResults = new Array(members.length);
            var tasks = [];
            var cachedMemberCount = 0;
            var lastMergedCommitAt = 0;
            for (var memberIndex = 0; memberIndex < members.length; memberIndex++) {
                var memberProcessed = getProcessedMovieCatalogEntry(members[memberIndex], movieBaseUrl);
                if (memberProcessed && Array.isArray(memberProcessed.items)) {
                    memberResults[memberIndex] = memberProcessed.items.slice(0);
                    cachedMemberCount++;
                    continue;
                }
                var memberRaw = getMovieCatalogCacheEntry(members[memberIndex], movieBaseUrl);
                tasks.push({ index: memberIndex, catalog: members[memberIndex], metas: memberRaw ? memberRaw.metas.slice(0) : null });
            }

            function collectMergedItems() {
                var mergedItems = [];
                for (var resultIndex = 0; resultIndex < memberResults.length; resultIndex++) if (Array.isArray(memberResults[resultIndex])) mergedItems = mergedItems.concat(memberResults[resultIndex]);
                var matchingType = [];
                for (var itemIndex = 0; itemIndex < mergedItems.length; itemIndex++) if (mergedItems[itemIndex] && mergedItems[itemIndex].type === catalog.type) matchingType.push(mergedItems[itemIndex]);
                return sortMovieItemsByProductionYear(dedupeMergedMovieItems(matchingType));
            }

            function commitMergedItems(isFinal, completedCount) {
                if (!isStillActive()) return;
                var mergedItems = collectMergedItems();
                if (!mergedItems.length) {
                    if (isFinal) {
                        movieAllItems = [];
                        movieItems = [];
                        renderMovieItems();
                        showMovieStatus("Không thể tải nội dung từ các nguồn " + getMovieCatalogTypeLabel(catalog), true);
                    }
                    return;
                }
                movieAllItems = mergedItems;
                movieItemIndex = 0;
                lastMergedCommitAt = Date.now();
                if (movieFilterMode === "all" || isFinal) applyCurrentMovieFilter();
                if (!isFinal) showMovieStatus(mergedItems.length + " nội dung · đang gộp nguồn " + completedCount + "/" + members.length + "…", false);
            }

            if (cachedMemberCount > 0) commitMergedItems(tasks.length === 0, cachedMemberCount);
            if (!tasks.length) return;
            if (!cachedMemberCount) {
                movieItems = [];
                movieAllItems = [];
                renderMovieLoadingSkeleton();
            }
            showMovieStatus("Đang gộp " + members.length + " nguồn " + getMovieCatalogTypeLabel(catalog) + "…", false);
            var nextTaskIndex = 0;
            var activeTasks = 0;
            var completedTasks = 0;

            function finishMergedTask(task, items) {
                activeTasks--;
                completedTasks++;
                if (!isStillActive()) return;
                if (Array.isArray(items)) memberResults[task.index] = items;
                var totalReady = cachedMemberCount + completedTasks;
                if (completedTasks >= tasks.length) commitMergedItems(true, totalReady);
                else if (movieFilterMode === "all" && (lastMergedCommitAt === 0 || Date.now() - lastMergedCommitAt >= 250)) commitMergedItems(false, totalReady);
                launchMergedTasks();
            }

            function classifyMergedTask(task, metas) {
                prepareClassifiedMovieCatalog(task.catalog, metas || [], loadToken, function (classifiedItems) {
                    if (!isStillActive()) return;
                    finishMergedTask(task, classifiedItems || []);
                });
            }

            function launchMergedTasks() {
                if (!isStillActive()) return;
                while (activeTasks < MOVIE_MERGED_CATALOG_CONCURRENCY && nextTaskIndex < tasks.length) {
                    (function (task) {
                        activeTasks++;
                        if (task.metas) { classifyMergedTask(task, task.metas); return; }
                        fetchMovieCatalogShared(task.catalog, catalogAddonBase(task.catalog), function (metas) { classifyMergedTask(task, metas); }, function () { finishMergedTask(task, []); });
                    })(tasks[nextTaskIndex++]);
                }
            }
            launchMergedTasks();
        }

        function refreshInBackground(previousSignature) {
            fetchMovieCatalogShared(catalog, movieBaseUrl, function (metas) {
                var refreshed = getMovieCatalogCacheEntry(catalog, movieBaseUrl);
                if (!isStillActive() || (refreshed && refreshed.signature === previousSignature)) return;
                loadToken = ++movieCatalogLoadToken;
                processCatalogMetas(metas, true);
            }, function () {
                if (isStillActive() && !movieItems.length) showMovieStatus("Không thể cập nhật nguồn, đang dùng dữ liệu Cache", false);
            });
        }

        if (isMergedMovieCatalog(catalog)) {
            processMergedCatalog();
            return;
        }

        var processedEntry = isPrimaryMovieTvCatalog(catalog) ? null : getProcessedMovieCatalogEntry(catalog, movieBaseUrl);
        var rawEntry = getMovieCatalogCacheEntry(catalog, movieBaseUrl);
        if (processedEntry) {
            movieAllItems = sortMovieItemsByProductionYear(processedEntry.items);
            movieItems = movieAllItems.slice(0);
            applyCurrentMovieFilter();
            if (!rawEntry || Date.now() - rawEntry.updatedAt > MOVIE_CATALOG_BACKGROUND_REFRESH_AGE) {
                refreshInBackground(rawEntry ? rawEntry.signature : "");
            }
            return;
        }

        movieItems = [];
        movieAllItems = [];
        renderMovieLoadingSkeleton();
        showMovieStatus("Đang tải danh mục…", false);

        if (rawEntry) {
            processCatalogMetas(rawEntry.metas.slice(0), false);
            if (Date.now() - rawEntry.updatedAt > MOVIE_CATALOG_BACKGROUND_REFRESH_AGE) refreshInBackground(rawEntry.signature);
            return;
        }

        fetchMovieCatalogShared(catalog, movieBaseUrl, function (metas) {
            if (!isStillActive()) return;
            processCatalogMetas(metas, false);
        }, function (error) {
            if (!isStillActive()) return;
            var staleEntry = getMovieCatalogCacheEntry(catalog, movieBaseUrl);
            if (staleEntry) { processCatalogMetas(staleEntry.metas.slice(0), false); return; }
            if (autoRemaining > 1) {
                loadMovieCatalog((catalogIndex + 1) % movieCatalogs.length, autoRemaining - 1);
                return;
            }
            movieItems = [];
            renderMovieItems();
            showMovieStatus(getMovieRequestErrorMessage("Không thể tải danh mục", error), true);
        });
    }

    function openMovieBrowser(manifestUrl, manifest) {
        try { phimLog("openMovieBrowser: start", { manifestUrl: manifestUrl, catalogCount: manifest && Array.isArray(manifest.catalogs) ? manifest.catalogs.length : "invalid" }); } catch (e) {}
        ensureMovieExperienceUI();
        movieManifestUrl = manifestUrl;
        movieBaseUrl = getMovieBaseUrl(manifestUrl);
        movieManifest = manifest;
        movieAllCatalogs = manifest && Array.isArray(manifest.catalogs) ? groupMovieCatalogsByType(manifest.catalogs) : [];
        movieCatalogs = [];
        movieCatalogScanToken++;
        movieCatalogLoadToken++;
        var catalogScanToken = movieCatalogScanToken;
        movieCatalogIndex = 0;
        movieActiveCatalogIdentity = "";
        movieItemIndex = 0;
        movieItems = [];
        movieAllItems = [];
        movieReclassifiedSeriesBySource = {};
        movieSearchToken++;
        movieSearchOpen = false;
        movieSearchEditing = false;
        movieSearchQuery = "";
        movieSearchResultsActive = false;
        movieSearchReturnCatalogIndex = 0;
        movieEpisodes = [];
        movieCurrentEpisodeIndex = -1;
        moviePlayerEpisodeMenuOpen = false;
        movieFilterMode = "all";
        movieFilterIndex = 0;
        movieFilterMenuOpen = false;
        movieFilterMenuIndex = 0;
        movieFilterToken++;
        movieFilterInProgress = false;
        movieBrowserFocusArea = "catalogs";
        movieBrowserOpen = true;
        try { if (document.body) document.body.classList.add("bintv-movie-mode"); } catch (movieModeClassError) {}
        movieEpisodeOpen = false;
        movieLaunchInProgress = false;

        var browser = document.getElementById("bintv-movie-browser");
        if (browser) browser.classList.add("show");
        renderMovieCatalogs();
        renderMovieLoadingSkeleton();

        if (movieAllCatalogs.length === 0) {
            try { phimLog("openMovieBrowser: no catalogs in manifest"); } catch (e) {}
            renderMovieItems();
            showMovieStatus("Nguồn Phim không có danh mục", true);
            return;
        }
        showMovieStatus("Đang kiểm tra và loại bỏ nguồn trống…", false);
        var cachedAvailableCatalogs = [];
        for (var cachedIndex = 0; cachedIndex < movieAllCatalogs.length; cachedIndex++) {
            var cachedCatalogEntry = getMovieCatalogCacheEntry(movieAllCatalogs[cachedIndex], movieBaseUrl);
            if (cachedCatalogEntry && cachedCatalogEntry.metas.length > 0) cachedAvailableCatalogs.push(movieAllCatalogs[cachedIndex]);
        }

        function applyAvailableCatalogs(availableCatalogs, isFinal) {
            try { phimLog("applyAvailableCatalogs", { available: availableCatalogs.length, isFinal: isFinal }); } catch (e) {}
            if (!movieBrowserOpen || catalogScanToken !== movieCatalogScanToken) return;
            var activeIdentity = movieActiveCatalogIdentity;
            var previousActiveCatalog = movieCatalogs[movieCatalogIndex] || null;
            var previousMergedSignature = getMergedMovieCatalogSignature(previousActiveCatalog);
            movieCatalogs = buildMergedMovieCatalogs(availableCatalogs);
            var activeIndex = -1;
            for (var i = 0; i < movieCatalogs.length; i++) if (getMovieCatalogIdentity(movieCatalogs[i], movieBaseUrl) === activeIdentity) { activeIndex = i; break; }
            if (activeIndex >= 0) movieCatalogIndex = activeIndex;
            else movieCatalogIndex = 0;
            renderMovieCatalogs();
            if (movieCatalogs.length === 0) {
                if (isFinal) {
                    try { phimLog("applyAvailableCatalogs: no available catalogs (final)"); } catch (e) {}
                    renderMovieItems();
                    showMovieStatus("Không có nguồn nào có nội dung", true);
                }
                return;
            }
            try { phimLog("applyAvailableCatalogs: loading catalog", { activeIndex: activeIndex, total: movieCatalogs.length }); } catch (e) {}
            if (activeIndex < 0) loadMovieCatalog(0, movieCatalogs.length);
            else {
                var activeCatalog = movieCatalogs[activeIndex];
                var mergedChanged = isMergedMovieCatalog(activeCatalog) && previousMergedSignature !== getMergedMovieCatalogSignature(activeCatalog);
                if (!moviePlayerOpen && mergedChanged) loadMovieCatalog(activeIndex, 0);
            }
        }

        function containsMovieOrSeriesCatalog(catalogs) {
            for (var catalogIndex = 0; catalogIndex < catalogs.length; catalogIndex++) if (catalogs[catalogIndex] && (catalogs[catalogIndex].type === "movie" || catalogs[catalogIndex].type === "series")) return true;
            return false;
        }
        if (cachedAvailableCatalogs.length > 0 && containsMovieOrSeriesCatalog(cachedAvailableCatalogs)) applyAvailableCatalogs(cachedAvailableCatalogs, false);
        try { phimLog("openMovieBrowser: scanning catalogs", { total: movieAllCatalogs.length, cached: cachedAvailableCatalogs.length }); } catch (e) {}
        // [Phim LAN14-fix 2026-09] Safety timeout: neu scan qua lau (>15s),
        // force goi done voi ket qua hien tai de UI khong bi "Đang tải..." vo han.
        var scanDoneCalled = false;
        var scanTimeoutTimer = setTimeout(function () {
            if (scanDoneCalled) return;
            scanDoneCalled = true;
            try { phimLog("openMovieBrowser: scan TIMEOUT (15s) - force done with partial"); } catch (e) {}
            // Tang catalogScanToken de huy cac request con dang chay
            movieCatalogScanToken++;
            catalogScanToken = movieCatalogScanToken;
            // Lay cac catalog da scan duoc (neu co cache)
            var currentCached = [];
            for (var ci = 0; ci < movieAllCatalogs.length; ci++) {
                var ent = getMovieCatalogCacheEntry(movieAllCatalogs[ci], movieBaseUrl);
                if (ent && ent.metas && ent.metas.length > 0) currentCached.push(movieAllCatalogs[ci]);
            }
            if (currentCached.length > 0) {
                applyAvailableCatalogs(currentCached, true);
            } else {
                renderMovieItems();
                showMovieStatus("Quá thời gian tải nguồn Phim (15s). Kiểm tra kết nối mạng hoặc thử lại.", true);
            }
        }, 15000);
        scanMovieCatalogAvailability(movieAllCatalogs, catalogScanToken, function (availableCatalogs) {
            if (scanDoneCalled) return;
            scanDoneCalled = true;
            clearTimeout(scanTimeoutTimer);
            try { phimLog("openMovieBrowser: scan done", { available: availableCatalogs.length, of: movieAllCatalogs.length }); } catch (e) {}
            applyAvailableCatalogs(availableCatalogs, true);
        }, function (partialCatalogs) {
            if (!movieActiveCatalogIdentity && containsMovieOrSeriesCatalog(partialCatalogs)) applyAvailableCatalogs(partialCatalogs, false);
        });
    }

    function closeMovieBrowser() {
        movieFilterToken++;
        movieCatalogScanToken++;
        movieCatalogLoadToken++;
        movieSearchToken++;
        cancelMovieAutoAdvance();   // [build 234] rời màn hình PHIM → huỷ tự chuyển tập
        movieSearchOpen = false;
        movieSearchResultsActive = false;
        movieFilterMenuOpen = false;
        if (movieMergedRefreshTimer) { clearTimeout(movieMergedRefreshTimer); movieMergedRefreshTimer = null; }
        movieMergedRefreshPending = false;
        stopMovieVoiceSearch();
        movieFilterInProgress = false;
        if (moviePlayerOpen) stopMoviePlayback();
        movieBrowserOpen = false;
        try { if (document.body) document.body.classList.remove("bintv-movie-mode"); } catch (movieModeClassError) {}
        movieEpisodeOpen = false;
        movieLaunchInProgress = false;
        var browser = document.getElementById("bintv-movie-browser");
        var episodes = document.getElementById("bintv-movie-episodes");
        var searchOverlay = document.getElementById("bintv-movie-search");
        var filterMenu = document.getElementById("bintv-movie-filter-menu");
        if (browser) browser.classList.remove("show");
        if (episodes) episodes.classList.remove("show");
        if (searchOverlay) searchOverlay.classList.remove("show");
        if (filterMenu) filterMenu.classList.remove("show");
        focusApp();
        scheduleMovieBackgroundPrefetch();
    }

    function openMovieItem(item) {
        if (!item || !item.id || !item.type) return;
        movieEpisodeSwitchSerial += 1;   // [build 233] ý định phát MỚI → vô hiệu mọi chuyển tập đang chờ
        cancelMovieAutoAdvance();        // [build 234] người dùng mở phim khác → huỷ tự chuyển tập
        if (item.type === "tv") {
            movieEpisodes = [];
            movieCurrentEpisodeIndex = -1;
            loadMovieStreams("tv", item.id, item.name || "Truyền hình", item);
            return;
        }
        showMovieStatus("Đang xác minh thông tin phim…", false);
        classifyMovieItem(item, item.type, function (classifiedItem) {
            if (!classifiedItem || !movieBrowserOpen) return;
            var videos = Array.isArray(classifiedItem.videos) ? classifiedItem.videos : [];
            if (classifiedItem.type === "series") {
                if (videos.length > 0) {
                    showMovieEpisodes(videos, "series", classifiedItem.name || "Phim", classifiedItem);
                    return;
                }
                requestJson(buildMovieResourceUrl("meta", "series", classifiedItem.id), MOVIE_REQUEST_TIMEOUT, function (data) {
                    var meta = data && data.meta ? data.meta : classifiedItem;
                    var metaVideos = meta && Array.isArray(meta.videos) ? meta.videos : [];
                    if (metaVideos.length > 0) showMovieEpisodes(metaVideos, "series", meta.name || classifiedItem.name || "Phim", meta);
                    else loadMovieStreams("series", classifiedItem.id, classifiedItem.name || "Phim", meta || classifiedItem);
                }, function () {
                    loadMovieStreams("series", classifiedItem.id, classifiedItem.name || "Phim", classifiedItem);
                });
                return;
            }
            movieEpisodes = [];
            movieCurrentEpisodeIndex = -1;
            loadMovieStreams(classifiedItem.type || "movie", classifiedItem.id, classifiedItem.name || "Phim", classifiedItem);
        });
    }

    function showMovieEpisodes(videos, type, title, meta) {
        ensureMovieExperienceUI();
        movieEpisodes = videos;
        movieEpisodeIndex = 0;
        movieEpisodeType = type || "series";
        movieEpisodeTitle = title || "Phim";
        movieEpisodeMeta = meta || null;
        movieCurrentEpisodeIndex = -1;
        movieEpisodeOpen = true;
        pushMovieIosUiState(true);   // [build 234] gesture: có thể Return (đóng chọn tập)

        var overlay = document.getElementById("bintv-movie-episodes");
        var titleElement = document.getElementById("bintv-movie-episodes-title");
        var list = document.getElementById("bintv-movie-episodes-list");
        if (titleElement) titleElement.textContent = movieEpisodeTitle + " · Chọn tập";
        if (list) {
            list.innerHTML = "";
            for (var i = 0; i < videos.length; i++) {
                (function (episodeIndex) {
                    var episode = videos[episodeIndex];
                    var button = document.createElement("div");
                    button.className = "movie-episode-button";
                    button.textContent = episode.title || ("Tập " + (episode.episode || episodeIndex + 1));
                    button.addEventListener("click", function () {
                        movieEpisodeIndex = episodeIndex;
                        updateMovieEpisodeFocus();
                        selectMovieEpisode();
                    });
                    list.appendChild(button);
                })(i);
            }
        }
        if (overlay) overlay.classList.add("show");
        updateMovieEpisodeFocus();
    }

    function updateMovieEpisodeFocus() {
        var rows = document.querySelectorAll("#bintv-movie-episodes-list .movie-episode-button");
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("focus", i === movieEpisodeIndex);
        if (rows[movieEpisodeIndex]) try { rows[movieEpisodeIndex].scrollIntoView(false); } catch (e) {}
    }

    function closeMovieEpisodes() {
        movieEpisodeOpen = false;
        pushMovieIosUiState(true);   // [build 234] gesture: mirror trạng thái UI PHIM
        var overlay = document.getElementById("bintv-movie-episodes");
        if (overlay) overlay.classList.remove("show");
        updateMovieBrowserFocus();
    }

    function selectMovieEpisode() {
        var episode = movieEpisodes[movieEpisodeIndex];
        if (!episode || !episode.id) return;
        cancelMovieAutoAdvance();        // [build 234] người dùng chọn tập tay → huỷ tự chuyển tập
        movieCurrentEpisodeIndex = movieEpisodeIndex;
        movieEpisodeSwitchSerial += 1;   // [build 233] chọn tập mới từ picker → vô hiệu chuyển tập đang chờ
        closeMovieEpisodes();
        var subtitleContext = {
            id: movieEpisodeMeta && movieEpisodeMeta.id ? movieEpisodeMeta.id : episode.id,
            videoId: episode.id,
            type: movieEpisodeType,
            name: movieEpisodeTitle,
            releaseInfo: movieEpisodeMeta && movieEpisodeMeta.releaseInfo,
            imdb_id: movieEpisodeMeta && (movieEpisodeMeta.imdb_id || movieEpisodeMeta.imdbId),
            season: episode.season,
            episode: episode.episode
        };
        loadMovieStreams(movieEpisodeType, episode.id, movieEpisodeTitle + " · " + (episode.title || "Tập phim"), subtitleContext);
    }

    function clearMovieTvPlaybackFallback() {
        movieTvPlaybackFallback = null;
    }

    function playMovieTvFallbackStream() {
        var fallback = movieTvPlaybackFallback;
        if (!fallback || fallback.index >= fallback.streams.length) return false;
        var stream = fallback.streams[fallback.index];
        if (!stream || !stream.url) return false;
        updateMoviePlayerStatus("Đang mở luồng truyền hình " + (fallback.index + 1) + "/" + fallback.streams.length + "…");
        startMoviePlayback(stream.url, fallback.title, fallback.subtitleContext);
        return true;
    }

    function startMovieTvPlaybackWithFallback(streams, title, subtitleContext) {
        var validStreams = [];
        for (var i = 0; i < streams.length; i++) if (streams[i] && streams[i].url && isValidMovieTargetUrl(streams[i].url)) validStreams.push(streams[i]);
        if (!validStreams.length) return false;
        movieTvPlaybackFallback = { streams: validStreams, index: 0, title: title || "Truyền hình", subtitleContext: subtitleContext || null };
        return playMovieTvFallbackStream();
    }

    function tryNextMovieTvFallbackStream() {
        if (!movieTvPlaybackFallback) return false;
        movieTvPlaybackFallback.index++;
        if (movieTvPlaybackFallback.index >= movieTvPlaybackFallback.streams.length) { clearMovieTvPlaybackFallback(); return false; }
        stopMoviePlayback(true, true);
        return playMovieTvFallbackStream();
    }

    // [Phim standalone 2026-09] Fallback cho phim thuong (movie/series).
    // Tuong tu playMovieTvFallbackStream nhung cho streams[] cua movie.
    // Khi stream hien tai loi (key sc.k-20.xyz het han, v.v.) -> thu stream tiep.
    function playMovieStreamFallback() {
        var fallback = movieStreamFallback;
        if (!fallback || fallback.index >= fallback.streams.length) return false;
        var stream = fallback.streams[fallback.index];
        if (!stream || !stream.url) return false;
        fallback.subtitleContext = fallback.subtitleContext || {};
        fallback.subtitleContext.stream = stream;
        updateMoviePlayerStatus("Đang thử nguồn " + (fallback.index + 1) + "/" + fallback.streams.length + "…");
        startMoviePlayback(stream.url, fallback.title, fallback.subtitleContext);
        return true;
    }

    function tryNextMovieStreamFallback() {
        if (!movieStreamFallback) return false;
        movieStreamFallback.index++;
        if (movieStreamFallback.index >= movieStreamFallback.streams.length) {
            clearMovieStreamFallback();
            return false;
        }
        stopMoviePlayback(true, true);
        return playMovieStreamFallback();
    }

    function clearMovieStreamFallback() {
        movieStreamFallback = null;
    }

    // =================================================================
    // [BinTV iOS build 231] CẦU NỐI sang TRÌNH PHÁT GỐC (Swift/AVPlayer)
    // Chỉ hoạt động khi web app đang chạy TRONG WKWebView của BinTV iOS
    // (có message handler `playVideoNative`). Trên Android/Tizen/Windows/
    // trình duyệt thường: mọi hàm trả false → luồng cũ không đổi.
    // =================================================================

    // Đang chạy trong WKWebView iOS có cầu nối native?
    function isIosNativePlaybackBridge() {
        try {
            return !!(window.webkit && window.webkit.messageHandlers
                      && window.webkit.messageHandlers.playVideoNative);
        } catch (e) { return false; }
    }
    // Alias rõ nghĩa dùng ở các nhánh cần "tắt luồng TV/external".
    function isIosWebViewRuntime() {
        return isIosNativePlaybackBridge();
    }

    // Đọc Referer mà app.js đã gắn vào query (`referer=`) — addon khai báo
    // trong behaviorHints.headers.Referer; loadMovieStreams nối vào URL.
    function extractStreamReferer(url) {
        try {
            var text = String(url || "");
            var qIndex = text.indexOf("?");
            if (qIndex < 0) return "";
            var match = text.substring(qIndex + 1).match(/(?:^|&)referer=([^&]+)/i);
            if (!match || !match[1]) return "";
            return decodeURIComponent(match[1]);
        } catch (e) { return ""; }
    }

    // Bọc URL qua /proxy của server nội bộ (127.0.0.1) — ĐÚNG công thức mà
    // startMoviePlayback đang dùng: proxy forward Referer/User-Agent, resolve
    // DoH, rewrite playlist m3u8 và đi RawHttp cho http:// (không bị ATS chặn).
    function buildProxiedStreamUrl(url, referer) {
        var target = String(url || "");
        if (!target) return "";
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.proxyMedia === "function") {
                var bridged = window.AndroidBridge.proxyMedia(target, referer || "");
                if (bridged) return String(bridged);
            }
        } catch (e) {}
        try {
            if (/^https?:\/\//i.test(target) === false) return "";
            var parsed = (function () { var a = document.createElement("a"); a.href = target; return a; })();
            var origin = (window.location && window.location.origin) ? String(window.location.origin) : "";
            if (!origin || parsed.origin === origin) return "";
            return origin.replace(/\/+$/, "") + "/proxy?url=" + encodeURIComponent(target)
                + (referer ? "&__ref=" + encodeURIComponent(referer) : "");
        } catch (e2) { return ""; }
    }

    // Container/codec mà WebKit KHÔNG giải mã được → chuyển THẲNG sang
    // AVPlayer native, không mất thời gian chờ <video> fail rồi mới chữa.
    // HLS (.m3u8) KHÔNG nằm trong danh sách này: WebKit phát HLS native rất
    // tốt (kể cả AC3/EAC3 trong HLS) nên cứ để web thử trước — chỉ handoff
    // khi nó thật sự báo lỗi.
    function iosNeedsNativePlayerFor(url, streamInfo) {
        if (!isIosNativePlaybackBridge()) return false;
        var target = String(url || "");
        if (!target) return false;
        // (1) Container WebKit không mở được (Matroska/AVI/FLV/WMV/RM/MPEG-PS).
        //     SOI THEO ĐƯỜNG DẪN (trước ? và #) TRƯỚC — nếu soi cả URL thì
        //     "movie.mp4?next=https://x/y.mkv" bị nhận nhầm là MKV (false
        //     positive → bỏ qua nguồn MP4 mà WebKit phát được).
        var cut = target.search(/[?#]/);
        var pathPart = cut >= 0 ? target.substring(0, cut) : target;
        var UNSUPPORTED_CONTAINER = /\.(mkv|avi|flv|wmv|rmvb|rm|divx|mpg|mpeg)$/i;
        var ANY_MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|avi|flv|ts|wmv|rmvb|divx|mpg|mpeg)$/i;
        if (UNSUPPORTED_CONTAINER.test(pathPart)) return true;
        // Đường dẫn KHÔNG có đuôi media nào (vd /player.php, /stream/abc) mà
        // tham số lại trỏ tới file MKV/AVI… → vẫn là nguồn WebKit không mở
        // được, cho sang native. (Có đuôi media rồi → KHÔNG soi query.)
        if (!ANY_MEDIA_EXT.test(pathPart)
            && /\.(mkv|avi|flv|wmv|rmvb|divx)(?:[?#&=%]|$)/i.test(target)) return true;
        // (2) File progressive (không phải HLS) mà addon quảng cáo audio
        //     AC3/EAC3/DTS/TrueHD — <video> của WebKit từ chối (canPlayType "").
        var isHls = /m3u8/i.test(target);
        if (!isHls) {
            var meta = "";
            try {
                meta = [streamInfo && streamInfo.name, streamInfo && streamInfo.title,
                        streamInfo && streamInfo.filename,
                        streamInfo && streamInfo.raw && streamInfo.raw.behaviorHints
                            && streamInfo.raw.behaviorHints.filename]
                    .filter(function (v) { return typeof v === "string" && v; }).join(" ");
            } catch (e) { meta = ""; }
            // Ranh giới 2 bên bắt buộc (không phải chữ/số) để KHÔNG dính
            // false-positive với tên phim/tập có chứa chuỗi tương tự.
            if (/(?:^|[^a-z0-9])(ac[-_ ]?3|e[-_ ]?ac[-_ ]?3|dts(?:[-_ ]?hd)?(?:[-_ ]?ma)?|truehd|atmos)(?:[^a-z0-9]|$)/i.test(meta)) return true;
        }
        return false;
    }

    // Ghi lại nguồn đang phát (để nhánh lỗi còn biết URL nào cần handoff).
    function rememberMovieStreamSource(url, title, streamInfo) {
        movieCurrentStreamUrl = String(url || "");
        movieCurrentStreamTitle = String(title || "");
        movieCurrentStreamInfo = streamInfo || null;
        movieCurrentStreamReferer = extractStreamReferer(movieCurrentStreamUrl);
        movieCurrentStreamProxyUrl = buildProxiedStreamUrl(movieCurrentStreamUrl, movieCurrentStreamReferer);
    }

    // Reset trạng thái handoff khi bắt đầu một phiên phát MỚI (phim/tập khác).
    function resetMovieNativeHandoff(fullReset) {
        movieNativeHandoffActive = false;
        if (fullReset) {
            movieNativeHandoffUrls = {};
            movieNativeHandoffCount = 0;
        }
    }

    // =================================================================
    // [build 243 — 2026-09-17] CHỌN TRÌNH PHÁT CHO MODULE PHIM
    //
    // Người dùng chọn MỘT trong hai trình phát ở SETTING → "Trình phát PHIM";
    // Swift lưu vào UserDefaults và TIÊM giá trị sang web app (script
    // `playerChoiceJS` của PhimWebView.swift → `window.__bintvPhimPlayerChoice`).
    // Ở đây chỉ ĐỌC giá trị đó và áp dụng: KHÔNG BAO GIỜ nạp cả hai player.
    // =================================================================

    /// Trình phát người dùng đã chọn: "integrated" | "native" | "" (chưa chọn).
    function movieChosenPlayer() {
        try {
            if (typeof window.__bintvPhimPlayerChoice === "function") {
                var value = String(window.__bintvPhimPlayerChoice() || "");
                if (value === "integrated" || value === "native") return value;
            }
        } catch (e) {}
        return "";
    }

    /// Người dùng ĐÃ chủ động chọn trình phát tích hợp? (chặn mọi đường mở
    /// trình phát iOS — kể cả fallback khi nguồn lỗi).
    function movieUserChoseIntegratedPlayer() {
        return movieChosenPlayer() === "integrated";
    }

    /// Người dùng ĐÃ chủ động chọn trình phát iOS?
    function movieUserChoseNativePlayer() {
        return movieChosenPlayer() === "native";
    }

    /// Báo Swift "chưa có trình phát được chọn" → Swift chuyển người dùng
    /// sang module SETTING (mục "Trình phát PHIM"). KHÔNG nạp player nào.
    /// Trả false khi không có cầu nối (Android/Tizen/Windows) → giữ hành vi cũ.
    function requestMoviePlayerChoiceFromUser(title) {
        try {
            var handler = window.webkit && window.webkit.messageHandlers
                && window.webkit.messageHandlers.phimBridge;
            if (!handler) return false;
            handler.postMessage({
                action: "needPlayerChoice",
                title: String(title || currentMoviePlaybackTitle() || "Phim")
            });
            return true;
        } catch (e) { return false; }
    }

    /// Swift gọi SAU KHI người dùng chọn trình phát trong SETTING.
    /// `info` = { choice: "integrated"|"native", resume: bool } (hoặc chuỗi).
    /// Có phim/tập đang chờ (`moviePendingPlayerChoicePlayback`) → phát tiếp
    /// ĐÚNG phim/tập đó bằng trình phát vừa chọn — không bắt người dùng tìm
    /// lại phim từ đầu.
    window.__bintvPhimPlayerChoiceSelected = function (info) {
        var choice = "";
        if (typeof info === "string") choice = info;
        else if (info && info.choice) choice = String(info.choice);
        if (choice !== "integrated" && choice !== "native") choice = "";
        // `resume` = true CHỈ khi Swift còn giữ yêu cầu đang chờ (người dùng
        // được PHIM chuyển sang SETTING và chưa rời đi). Mọi lần đẩy giá trị
        // khác (trang nạp xong / đổi trình phát lúc đang duyệt SETTINGS) chỉ
        // cập nhật lựa chọn, KHÔNG tự phát lại phim cũ.
        var shouldResume = !!(info && info.resume === true);
        try {
            if (typeof window.__bintvSetPhimPlayerChoice === "function") {
                window.__bintvSetPhimPlayerChoice(choice);
            }
        } catch (e) {}
        var pending = moviePendingPlayerChoicePlayback;
        moviePendingPlayerChoicePlayback = null;
        try {
            window.__phimDebug && window.__phimDebug.log("[PLAYER] trình phát đã chọn:",
                choice || "(chưa rõ)", "| resume:", shouldResume,
                "| phim chờ:", pending ? pending.title : "(không)");
        } catch (e2) {}
        if (!choice || !pending || !shouldResume) return false;
        // Đúng phim/tập người dùng đã chọn trước khi bị chuyển sang SETTING.
        startMoviePlayback(pending.url, pending.title, pending.subtitleContext);
        return true;
    };

    /// TRẢ LẠI TÀI NGUYÊN của TRÌNH PHÁT TÍCH HỢP: gỡ `src` + `load()` để
    /// WebKit DỪNG hẳn việc tải nguồn. Trước build 243, sau khi handoff sang
    /// trình phát iOS thẻ <video> VẪN GIỮ src → HAI player cùng tải MỘT URL.
    function releaseMovieIntegratedPlayerSource() {
        try {
            var htmlVideo = document.getElementById("bintv-movie-html5-player");
            if (!htmlVideo) return;
            try { detachJvhdHls(); } catch (e0) {}
            try { htmlVideo.pause(); } catch (e1) {}
            var hadSource = !!(htmlVideo.getAttribute("src") || htmlVideo.src);
            if (hadSource) {
                try { htmlVideo.removeAttribute("src"); htmlVideo.load(); } catch (e2) {}
            }
        } catch (e3) {}
    }

    /// Phát bằng TRÌNH PHÁT iOS khi người dùng đã chọn nó: dựng đúng trạng
    /// thái phiên/UI như nhánh handoff cũ nhưng TUYỆT ĐỐI KHÔNG gán `src`
    /// cho thẻ <video> → trình phát tích hợp không được khởi tạo/nạp nguồn.
    /// Trả false nếu cầu nối native không nhận (không có url / hết trần
    /// handoff) — người gọi báo lỗi THẬT, KHÔNG mở player còn lại.
    function startMoviePlaybackOnChosenNativePlayer(url, title, subtitleContext) {
        if (!isIosNativePlaybackBridge()) return false;
        movieNativePlaybackSession += 1;
        movieNativeHandoffActive = false;
        ensureMovieExperienceUI();
        moviePlayerOpen = true;
        pushMovieIosUiState(true);
        moviePlayerPaused = false;
        moviePlayerUsingAVPlay = false;
        cancelMovieScrubInteraction(true);
        resetMovieSeekOperationState();
        moviePlaybackReportedTimeScale = 0;
        moviePlaybackLastRawTime = -1;
        moviePlaybackLastRawAt = 0;
        syncMoviePlaybackClock(0, false);
        hideMovieSeekTimelineImmediately();
        moviePlayerEpisodeSwitchInProgress = false;
        syncNativeEpisodeList(false);
        var browser = document.getElementById("bintv-movie-browser");
        var player = document.getElementById("bintv-movie-player");
        if (browser) browser.classList.add("player-active");
        if (player) {
            player.classList.add("show");
            player.setAttribute("tabindex", "-1");
            try { player.focus(); } catch (focusError) {}
        }
        // Phụ đề: phiên mới (giống hệt nhánh phát bằng thẻ <video>).
        movieSubtitleRequestToken++;
        movieCurrentSubtitleContext = subtitleContext || { name: title || "Phim", type: "movie" };
        movieSubtitleUserDisabled = true;
        movieSubtitleEnableRequested = false;
        movieSubtitleLoadState = "idle";
        movieSubtitleOptions = [];
        movieSubtitleActiveIndex = -1;
        movieSubtitleActiveSource = "";
        clearMovieSubtitleRendering();
        updateMovieSubtitleButton("CC Vietsub: Tắt", false);
        updateMoviePlayerStatus("Đang mở trình phát iOS…");
        // Trình phát tích hợp KHÔNG được giữ nguồn nào (chống 2 player cùng load).
        releaseMovieIntegratedPlayerSource();
        rememberMovieStreamSource(url, title, subtitleContext && subtitleContext.stream);
        movieAutoAdvanceActive = false;
        try {
            window.__phimDebug && window.__phimDebug.log(
                "[PLAYER] người dùng đã chọn TRÌNH PHÁT iOS → chỉ nạp AVPlayer:",
                String(url).substring(0, 140));
        } catch (logError) {}
        return requestNativeMoviePlayback("user-chosen-native-player", url) === true;
    }

    // Tiêu đề phim: ưu tiên tiêu đề app.js đang giữ, kế đến là "ý định phát"
    // do cầu nối iOS ghi lại khi người dùng CLICK thẻ phim.
    function currentMoviePlaybackTitle(fallbackTitle) {
        var text = String(fallbackTitle || movieCurrentStreamTitle || "");
        if (text) return text;
        try {
            var intent = window.__bintvLastPlayIntent;
            if (intent && intent.name) return String(intent.name);
        } catch (e) {}
        try {
            if (movieEpisodeTitle) return String(movieEpisodeTitle);
        } catch (e2) {}
        return "Phim";
    }

    // GỬI streamUrl SANG SWIFT NATIVE (WKScriptMessageHandler `playVideoNative`).
    // Trả về true khi đã gửi thành công (app.js KHÔNG hiện lỗi "trên TV" nữa).
    function requestNativeMoviePlayback(reason, explicitUrl) {
        if (!isIosNativePlaybackBridge()) return false;
        // =================================================================
        // [build 243] NGƯỜI DÙNG ĐÃ CHỌN TRÌNH PHÁT TÍCH HỢP → KHÔNG được mở
        // trình phát còn lại (trình phát iOS), kể cả khi nguồn web lỗi. Trả
        // false để nhánh lỗi hiện thông báo THẬT + gợi ý đổi trình phát trong
        // SETTING (xem describeMoviePlaybackUnavailable).
        // =================================================================
        if (movieUserChoseIntegratedPlayer()) {
            try {
                window.__phimDebug && window.__phimDebug.log(
                    "[PLAYER] bỏ qua mở trình phát iOS: người dùng đã chọn trình phát tích hợp");
            } catch (e) {}
            return false;
        }
        var url = String(explicitUrl || movieCurrentStreamUrl || "");
        // Referer đọc được từ chính URL đang gán cho <video> (tham số __ref
        // của route /proxy) — dùng khi app.js chưa kịp ghi movieCurrentStreamReferer.
        var proxyReferer = "";
        // Cầu nối iOS (script tiêm từ Swift) ghi sẵn URL đang gán cho <video>
        // khi app.js chưa kịp ghi (vd lỗi xảy ra rất sớm).
        if (!url) {
            try {
                var video = document.getElementById("bintv-movie-html5-player");
                var src = String((video && (video.currentSrc || video.src)) || "");
                if (src.indexOf("/proxy?url=") !== -1) {
                    var m = src.match(/\/proxy\?url=([^&]+)/);
                    if (m && m[1]) { try { url = decodeURIComponent(m[1]); } catch (e) { url = m[1]; } }
                    var refMatch = src.match(/[?&]__ref=([^&]+)/i);
                    if (refMatch && refMatch[1]) {
                        try { proxyReferer = decodeURIComponent(refMatch[1]); } catch (e5) { proxyReferer = refMatch[1]; }
                    }
                } else if (/^https?:\/\//i.test(src)) { url = src; }
            } catch (e2) {}
        }
        if (!url) {
            try { window.__phimDebug && window.__phimDebug.warn("[NATIVE] handoff bỏ qua: không có streamUrl"); } catch (e3) {}
            return false;
        }
        // Không gửi lại cùng một nguồn (native đã thử và đã báo fail).
        if (movieNativeHandoffUrls[url]) return false;
        if (movieNativeHandoffCount >= MOVIE_NATIVE_HANDOFF_MAX) {
            try { window.__phimDebug && window.__phimDebug.warn("[NATIVE] đạt trần handoff (" + MOVIE_NATIVE_HANDOFF_MAX + ")"); } catch (e4) {}
            return false;
        }

        movieNativePlaybackSession += 1;
        var session = String(movieNativePlaybackSession);
        var referer = movieCurrentStreamReferer || proxyReferer || extractStreamReferer(url);
        var proxyUrl = (url === movieCurrentStreamUrl && movieCurrentStreamProxyUrl)
            ? movieCurrentStreamProxyUrl
            : buildProxiedStreamUrl(url, referer);
        var title = currentMoviePlaybackTitle();
        var payload = {
            url: url,                       // streamUrl GỐC của addon
            title: title,
            proxyUrl: proxyUrl,             // đường /proxy (Referer/UA/DoH/ATS)
            referer: referer,
            reason: String(reason || ""),
            session: session,
            resumePositionMs: 0,
            resumePaused: false
        };

        var sent = false;
        try {
            // Helper do Swift tiêm (document-start) — JSON hoá + postMessage.
            if (typeof window.__bintvPlayVideoNative === "function") {
                sent = window.__bintvPlayVideoNative(payload) === true;
            }
        } catch (e5) { sent = false; }
        if (!sent) {
            try {
                // Đường dự phòng: gọi thẳng handler (đúng chữ ký WKScriptMessageHandler).
                window.webkit.messageHandlers.playVideoNative.postMessage({
                    url: payload.url,
                    title: payload.title
                });
                sent = true;
            } catch (e6) { sent = false; }
        }
        if (!sent) return false;

        movieNativeHandoffUrls[url] = true;
        movieNativeHandoffCount += 1;
        movieNativeHandoffActive = true;
        // =================================================================
        // [build 243] TRÌNH PHÁT iOS SẮP TẢI NGUỒN NÀY → gỡ src của thẻ
        // <video> NGAY để WebKit dừng tải. Trước đây thẻ <video> vẫn giữ src
        // trong lúc AVPlayerViewController tải CÙNG MỘT URL → hai player, hai
        // luồng mạng, một nội dung (chậm + tốn băng thông + dễ xung đột).
        // =================================================================
        releaseMovieIntegratedPlayerSource();
        // [build 233] Native giờ là player ĐANG HIỂN THỊ → các lần phát kế
        // tiếp của cùng phim (tự chuyển tập / đổi tập / nguồn dự phòng) phải
        // tiếp tục đi qua native (đóng hẳn player mới hạ cờ này).
        moviePreferNativePlayer = true;
        movieCurrentStreamUrl = url;
        movieCurrentStreamProxyUrl = proxyUrl;
        movieCurrentStreamReferer = referer;
        try {
            window.__phimDebug && window.__phimDebug.log("[NATIVE] handoff →", {
                reason: payload.reason, session: session, title: title,
                url: url.substring(0, 140), proxy: String(proxyUrl).substring(0, 140)
            });
        } catch (e7) {}
        if (moviePlayerOpen) updateMoviePlayerStatus("Đang mở trình phát gốc iOS…");
        return true;
    }
    // Alias public (phim_ios_fallback.js và script tiêm từ Swift có thể gọi).
    window.__bintvRequestNativePlayback = function (reason) {
        return requestNativeMoviePlayback(reason || "external");
    };

    // -----------------------------------------------------------------
    // [BinTV iOS build 232] PHỤ ĐỀ TRONG TRÌNH PHÁT NATIVE
    // app.js đã parse SRT/VTT thành movieSubtitleCues. Khi trình phát
    // native đang chạy (movieNativeHandoffActive), phụ đề DOM không hiển
    // thị (AVPlayerViewController là lớp phủ của hệ thống) — nên đẩy danh
    // sách cue sang Swift để hiển thị đồng bộ trên chính player native.
    // Trả false trên Android/Tizen/Windows (không có cầu nối) = hành vi cũ.
    // -----------------------------------------------------------------
    function pushMovieSubtitlesToNative(cues, label) {
        if (!isIosNativePlaybackBridge() || !movieNativeHandoffActive) return false;
        try {
            if (typeof window.__bintvSetNativeSubtitles !== "function") return false;
        } catch (e) { return false; }
        var compact = [];
        var list = Array.isArray(cues) ? cues : [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c || typeof c.start !== "number" || typeof c.end !== "number" || !c.text) continue;
            compact.push({ s: c.start, e: c.end, t: String(c.text) });
        }
        try {
            window.__bintvSetNativeSubtitles({
                label: String(label || ""),
                cues: compact,
                session: String(movieNativePlaybackSession)
            });
            return true;
        } catch (e2) { return false; }
    }
    // Hook cho test jsdom (tests/ios-native-handoff) kiểm tra luồng phụ đề.
    window.__bintvPushNativeSubtitles = pushMovieSubtitlesToNative;

    // -----------------------------------------------------------------
    // CALLBACK TỪ SWIFT (PhimWebView.evaluateJavaScript) — kèm `session`
    // để loại bỏ callback cũ của phiên phát trước.
    // -----------------------------------------------------------------

    function isStaleNativeCallback(info) {
        try {
            var session = String((info && (info.session || "")) || "");
            return !!session && session !== String(movieNativePlaybackSession);
        } catch (e) { return false; }
    }

    // Native ĐÃ phát được → cập nhật trạng thái player web (đang nằm sau
    // AVPlayerViewController) để khi người dùng đóng thì UI nhất quán.
    window.__bintvNativePlaybackStarted = function (info) {
        if (isStaleNativeCallback(info)) return;
        movieNativeHandoffActive = true;
        // A state-only callback after WKWebView recreation carries native
        // position/paused intent. Do not start a second stream in JavaScript.
        if (info && info.reconciled) {
            var restoredMs = Number(info.positionMs);
            if (isFinite(restoredMs) && restoredMs >= 0) syncMoviePlaybackClock(restoredMs, !info.paused);
            if (typeof info.paused === "boolean") moviePlayerPaused = info.paused;
        }
        // [build 232] Đang bật Vietsub từ trước → đẩy cue sang player native.
        if (movieSubtitleActiveIndex >= 0 && movieSubtitleCues.length > 0) {
            var opt = movieSubtitleOptions[movieSubtitleActiveIndex];
            pushMovieSubtitlesToNative(movieSubtitleCues,
                (opt && opt._bintvSourceName) || movieSubtitleActiveSource);
        }
        try { window.__phimDebug && window.__phimDebug.log("[NATIVE] phát thành công", info && info.title); } catch (e) {}
        if (moviePlayerOpen) updateMoviePlayerStatus("Đang phát (trình phát gốc iOS)");
    };

    // Native KHÔNG phát được (đã thử cả direct lẫn proxy) → thử nguồn addon
    // kế tiếp trong web; hết nguồn → thông báo THẬT (không còn chữ "trên TV").
    window.__bintvNativePlaybackFailed = function (info) {
        if (isStaleNativeCallback(info)) return;
        movieNativeHandoffActive = false;
        moviePreferNativePlayer = false;   // [build 233] native đã tự đóng
        var detail = String((info && info.message) || "");
        try { window.__phimDebug && window.__phimDebug.warn("[NATIVE] fail:", detail); } catch (e) {}
        if (moviePlayerOpen) updateMoviePlayerStatus("Trình phát gốc iOS không mở được nguồn này — đang thử nguồn khác…");
        // Phiên JVHD (live) → đóng đúng luồng JVHD, không dùng stopMoviePlayback thô.
        if (jvhdPlayerSession) {
            closeJvhdPlayback(true, describeMoviePlaybackUnavailable(detail));
            return;
        }
        // Thử nguồn kế tiếp (web) — đúng thứ tự fallback sẵn có của app.js.
        if (tryNextMovieStreamFallback()) return;
        if (tryNextMovieTvFallbackStream()) return;
        stopMoviePlayback();
        showMovieStatus(describeMoviePlaybackUnavailable(detail), true);
    };

    // Người dùng ĐÓNG trình phát native (nút Done / vuốt) → dọn player web,
    // quay lại lưới phim. KHÔNG tự phát lại bằng <video> (người dùng đã
    // chủ động đóng).
    window.__bintvNativePlaybackClosed = function (info) {
        if (isStaleNativeCallback(info)) return;
        movieNativeHandoffActive = false;
        moviePreferNativePlayer = false;   // [build 233]
        try { window.__phimDebug && window.__phimDebug.log("[NATIVE] người dùng đóng player"); } catch (e) {}
        // [build 234] ĐANG tự chuyển tập: trình phát native vừa đóng CHÍNH LÀ
        // bước 1 của luồng tự chuyển tập (startMovieAutoAdvance gửi "stop") →
        // KHÔNG mở lại màn hình chọn tập, để tập kế tiếp được nạp và phát.
        if (movieAutoAdvanceActive) {
            try { window.__phimDebug && window.__phimDebug.log("[NATIVE] player đóng trong lúc tự chuyển tập — giữ nguyên luồng"); } catch (e) {}
            return;
        }
        // Người dùng ĐÃ chủ động đóng trình phát native → KHÔNG tự phát lại
        // bằng <video>. Dọn UI player web kể cả khi cờ moviePlayerOpen lệch
        // (overlay còn class "show" / browser còn bị ẩn bởi "player-active").
        var player = document.getElementById("bintv-movie-player");
        var browser = document.getElementById("bintv-movie-browser");
        var overlayShown = !!(player && player.classList.contains("show"));
        if (moviePlayerOpen || overlayShown) { stopMoviePlayback(); }
        else if (browser) browser.classList.remove("player-active");
        // [build 233] PHIM BỘ: đóng trình phát → quay về giao diện CHỌN TẬP
        // (phim lẻ: reopenMovieEpisodePicker tự no-op → về lưới PHIM như cũ).
        reopenMovieEpisodePicker();
    };

    // -----------------------------------------------------------------
    // [BinTV iOS build 234 — 2026-09-15] Native phát HẾT tập/phim
    // (DidPlayToEndTime) → JS quyết định: phim BỘ còn tập → ĐÓNG trình phát
    // iOS rồi TỰ ĐỘNG phát tập tiếp theo (không dừng ở màn hình chọn tập);
    // hết tập cuối / phim LẺ → đóng NGAY (stopMoviePlayback gửi action
    // "stop") và quay về đúng giao diện. Swift có backstop tự đóng nếu JS
    // im lặng — không bao giờ treo player.
    // -----------------------------------------------------------------
    window.__bintvNativePlaybackEnded = function (info) {
        if (isStaleNativeCallback(info)) return;
        try { window.__phimDebug && window.__phimDebug.log("[NATIVE] phát hết tập/phim"); } catch (e) {}
        // JVHD (live/quảng cáo) có luồng kết thúc riêng — đóng native theo
        // đúng nghiệp vụ JVHD (closeJvhdPlayback → stopMoviePlayback gửi stop).
        if (jvhdPlayerSession) { handleJvhdPlaybackCompleted(); return; }
        // [build 236] Hết tập: KHÔNG tự phát tập tiếp. Phim bộ → giữ player
        // native + mở danh sách tập; phim lẻ / hết danh sách → đóng như cũ.
        if (presentInPlayerEpisodeListAfterEnd("native-ended")) return;
        stopMoviePlayback();
        if (movieEpisodes && movieEpisodes.length > 0 && movieEpisodeType === "series") reopenMovieEpisodePicker();
    };

    // Thông báo cuối cùng khi MỌI đường đều thất bại. Trên iOS KHÔNG dùng
    // chữ "trên TV" (iPhone không phải TV; trước đây app rơi vào nhánh
    // fallback TV nên hiện câu đó — chính là lỗi người dùng báo cáo).
    function describeMoviePlaybackUnavailable(detail) {
        if (isIosNativePlaybackBridge()) {
            // [build 243] Chỉ MỘT trình phát được dùng (theo lựa chọn của
            // người dùng) → nói rõ trình phát nào đã thử và CHỈ RÕ nơi đổi
            // trình phát, thay vì âm thầm mở player còn lại.
            var base = movieUserChoseNativePlayer()
                ? "Không phát được nguồn phim này trên iPhone bằng trình phát iOS (đã thử các nguồn dự phòng)"
                : "Không phát được nguồn phim này trên iPhone bằng trình phát tích hợp (đã thử các nguồn dự phòng)";
            var hint = "Có thể đổi trình phát trong SETTING → Trình phát PHIM.";
            return (detail ? base + " — " + detail : base) + " " + hint;
        }
        return "Không thể phát nguồn phim này trên TV";
    }

    // [build 229] Thông báo RÕ NGUYÊN NHÂN khi không có nguồn phát được
    // (trước đây chỉ hiện chung chung "Không tìm thấy nguồn phát tương thích").
    function describeUnplayableStreams(classified) {
        var list = Array.isArray(classified) ? classified : [];
        if (!list.length) return "Không tìm thấy nguồn phát tương thích";
        var torrent = 0, external = 0, youtube = 0;
        for (var i = 0; i < list.length; i++) {
            var kind = list[i] && list[i].kind;
            if (kind === "torrent") torrent++;
            else if (kind === "external") external++;
            else if (kind === "youtube") youtube++;
        }
        if (torrent) return "Nguồn hiện chỉ có torrent (P2P) — iPhone không thể phát trực tiếp; hãy cấu hình debrid (vd. TorBox) cho addon này";
        if (external) return "Nguồn yêu cầu mở bằng ứng dụng/trình duyệt ngoài";
        if (youtube) return "Nguồn YouTube — hãy mở bằng tab TUBE";
        return "Không tìm thấy nguồn phát tương thích (" + list.length + " nguồn, không nguồn nào phát được trên iPhone)";
    }

    // =================================================================
    // [build 230] CẤU HÌNH ADDON THEO CHUẨN STREMIO (debrid / TorBox...)
    // Addon Stremio nhận cấu hình QUA transport URL (manifest.config khai
    // báo các khoá). Ví dụ VipTorrent khai `torbox` (mật khẩu, không bắt
    // buộc): khi có khoá, addon trả THÊM các stream có `url` (link phát
    // trực tiếp) thay vì chỉ torrent. Toàn bộ đi theo chuẩn → không
    // hard-code tên khoá/addon nào.
    // =================================================================
    var MOVIE_ADDON_CONFIG_KEY = "bintvAddonConfigV1";

    function readMovieAddonConfig() {
        try {
            var raw = window.localStorage ? window.localStorage.getItem(MOVIE_ADDON_CONFIG_KEY) : null;
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (e) { return {}; }
    }

    function writeMovieAddonConfig(all) {
        try { if (window.localStorage) window.localStorage.setItem(MOVIE_ADDON_CONFIG_KEY, JSON.stringify(all || {})); } catch (e) {}
    }

    function movieAddonConfigKey(addon) {
        return String((addon && (addon.id || addon.baseUrl)) || "addon");
    }

    function getMovieAddonConfigValues(addon) {
        var all = readMovieAddonConfig();
        var values = all[movieAddonConfigKey(addon)];
        return values && typeof values === "object" ? values : null;
    }

    /// Áp dụng cấu hình đã lưu cho từng addon (nạp lại manifest đã cấu hình).
    function applyMovieAddonConfigurations(index) {
        if (!window.Stremio) return;
        var list = movieAddons || [];
        if (index >= list.length) return;
        var addon = list[index];
        var next = function () { applyMovieAddonConfigurations(index + 1); };
        var values = getMovieAddonConfigValues(addon);
        if (!values || !Object.keys(values).length) { next(); return; }
        configureMovieAddon(addon, values, next);
    }

    /// Dựng lại addon từ transport URL ĐÃ CẤU HÌNH (gộp config vào URL).
    function configureMovieAddon(addon, values, done) {
        var finish = function () { if (done) done(); };
        if (!window.Stremio || !addon) { finish(); return; }
        var manifestUrl = window.Stremio.buildConfiguredUrl(addon.baseUrl, values);
        requestJson(manifestUrl, MOVIE_REQUEST_TIMEOUT, function (manifest) {
            if (window.Stremio.isManifest(manifest)) {
                var configured = window.Stremio.createAddon(
                    window.Stremio.baseUrlFromManifestUrl(manifestUrl), manifest);
                var oldBase = addon.baseUrl;
                for (var i = 0; i < movieAddons.length; i++) {
                    if (movieAddons[i] === addon || movieAddons[i].baseUrl === oldBase) { movieAddons[i] = configured; break; }
                }
                if (movieBaseUrl === oldBase) movieBaseUrl = configured.baseUrl;
                for (var c = 0; c < movieCatalogs.length; c++) {
                    if (movieCatalogs[c] && movieCatalogs[c]._addon === oldBase) movieCatalogs[c]._addon = configured.baseUrl;
                }
                try { phimLog("addon đã áp dụng cấu hình: " + (configured.name || oldBase)); } catch (e) {}
            }
            finish();
        }, finish);
    }

    /// Khi nguồn CHỈ có torrent: nếu addon có trường cấu hình chưa nhập →
    /// mời người dùng nhập (hiện 1 lần, không chặn luồng khác).
    function offerMovieAddonConfigForTorrent(classified, type, id, title, subtitleContext) {
        if (!window.Stremio || !movieAddons.length) return false;
        var hasTorrent = false;
        for (var i = 0; i < classified.length; i++) if (classified[i] && classified[i].kind === "torrent") { hasTorrent = true; break; }
        if (!hasTorrent) return false;
        for (var a = 0; a < movieAddons.length; a++) {
            var addon = movieAddons[a];
            var fields = window.Stremio.getConfigFields(addon.manifest);
            if (!fields.length) continue;
            var saved = getMovieAddonConfigValues(addon) || {};
            var missing = null;
            for (var f = 0; f < fields.length; f++) {
                if (fields[f] && fields[f].key && !saved[fields[f].key]) { missing = fields[f]; break; }
            }
            if (!missing) continue;
            return openMovieAddonConfigDialog(addon, missing, function () {
                loadMovieStreams(type, id, title, subtitleContext);
            });
        }
        return false;
    }

    /// Hộp nhập khoá cấu hình (tự tạo DOM, không phụ thuộc CSS/file nào).
    function openMovieAddonConfigDialog(addon, field, onSaved) {
        try {
            var old = document.getElementById("bintv-movie-addon-config");
            if (old && old.parentNode) old.parentNode.removeChild(old);
            var wrap = document.createElement("div");
            wrap.id = "bintv-movie-addon-config";
            wrap.style.cssText = "position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72)";
            var box = document.createElement("div");
            box.style.cssText = "width:min(560px,86vw);background:#15151c;border:1px solid #2c2c38;border-radius:14px;padding:18px;color:#f2f2f7;font-family:-apple-system,system-ui,sans-serif";
            var heading = document.createElement("div");
            heading.style.cssText = "font-size:17px;font-weight:600;margin-bottom:6px";
            heading.textContent = (addon && addon.name ? addon.name : "Nguồn phim") + " cần cấu hình";
            var desc = document.createElement("div");
            desc.style.cssText = "font-size:13px;line-height:1.45;color:#b9b9c6;margin-bottom:12px";
            desc.textContent = "Nguồn này hiện CHỈ có torrent (P2P) — iPhone không thể phát trực tiếp. " +
                (field && field.description ? String(field.description) + " " : "") +
                "Nhập " + String((field && (field.title || field.key)) || "khoá API") + " để nhận link phát trực tiếp (HLS/MP4).";
            var input = document.createElement("input");
            input.type = "text";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.placeholder = String((field && (field.title || field.key)) || "API key");
            input.style.cssText = "width:100%;box-sizing:border-box;background:#0e0e14;border:1px solid #343442;border-radius:9px;color:#fff;padding:11px 12px;font-size:15px;outline:none";
            var actions = document.createElement("div");
            actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:14px";
            var cancel = document.createElement("button");
            cancel.textContent = "Để sau";
            cancel.style.cssText = "background:#2a2a36;border:0;border-radius:9px;color:#e7e7ef;padding:10px 16px;font-size:14px";
            var save = document.createElement("button");
            save.textContent = "Lưu & thử lại";
            save.style.cssText = "background:#ff7a1a;border:0;border-radius:9px;color:#14141a;font-weight:600;padding:10px 16px;font-size:14px";
            actions.appendChild(cancel);
            actions.appendChild(save);
            box.appendChild(heading);
            box.appendChild(desc);
            box.appendChild(input);
            box.appendChild(actions);
            wrap.appendChild(box);
            (document.body || document.documentElement).appendChild(wrap);
            function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
            cancel.addEventListener("click", close);
            save.addEventListener("click", function () {
                var value = String(input.value || "").replace(/^\s+|\s+$/g, "");
                if (!value) { close(); return; }
                var values = getMovieAddonConfigValues(addon) || {};
                var key = (field && field.key) || "apiKey";
                values[key] = value;
                var all = readMovieAddonConfig();
                all[movieAddonConfigKey(addon)] = values;
                writeMovieAddonConfig(all);
                close();
                showMovieStatus("Đang áp dụng cấu hình nguồn…", false);
                configureMovieAddon(addon, values, function () { if (onSaved) onSaved(); });
            });
            try { input.focus(); } catch (focusError) {}
            return true;
        } catch (e) {
            return false;
        }
    }

    // [build 233] `abortGuard` (tuỳ chọn): hàm trả false → lần nạp này đã bị
    // VÔ HIỆU (người dùng đóng player / chọn phim khác trong lúc chờ addon) →
    // BỎ QUA kết quả, không mở player. Chỉ dùng cho chuyển tập trong player.
    function loadMovieStreams(type, id, title, subtitleContext, abortGuard) {
        showMovieStatus("Đang tìm nguồn phát…", false);
        fetchMovieStreamsShared(type, id, function (streams) {
            if (abortGuard && !abortGuard()) {
                moviePlayerEpisodeSwitchInProgress = false;
                try { window.__phimDebug && window.__phimDebug.log("[PLAYER] bỏ qua nguồn: lần chuyển tập đã bị huỷ (người dùng đã đóng/chọn khác)"); } catch (e) {}
                return;
            }
            if (!subtitleContext) subtitleContext = { id: id, videoId: id, type: type, name: title || "Phim" };
            // [build 229] PHÂN LOẠI theo chuẩn Stremio: url (HLS/MP4) · ytId ·
            // infoHash (torrent) · externalUrl + headers (Referer…). Chỉ những
            // stream PHÁT ĐƯỢC trên iOS mới được đưa vào danh sách thử.
            var classified = [];
            var playable = [];
            if (window.Stremio && typeof window.Stremio.classifyStream === "function") {
                for (var ci = 0; ci < streams.length; ci++) {
                    var cInfo = window.Stremio.classifyStream(streams[ci]);
                    if (!cInfo) continue;
                    classified.push(cInfo);
                    if (cInfo.playable && cInfo.url) playable.push(cInfo);
                }
            } else {
                for (var cj = 0; cj < streams.length; cj++) {
                    if (streams[cj] && typeof streams[cj].url === "string" && isValidMovieTargetUrl(streams[cj].url)) {
                        playable.push({ url: streams[cj].url, headers: {}, raw: streams[cj] });
                    }
                }
            }
            // Gắn Referer (behaviorHints.headers) vào URL: app đã có sẵn cơ
            // chế đọc `referer=` trong query để forward qua /proxy.
            var validStreams = [];
            for (var pi = 0; pi < playable.length; pi++) {
                var chosen = playable[pi];
                var chosenUrl = chosen.url;
                var chosenRef = chosen.headers && (chosen.headers.Referer || chosen.headers.referer);
                if (chosenRef && String(chosenUrl).indexOf("referer=") === -1) {
                    chosenUrl = String(chosenUrl) + (String(chosenUrl).indexOf("?") === -1 ? "?" : "&") + "referer=" + encodeURIComponent(chosenRef);
                }
                validStreams.push({ url: chosenUrl, name: chosen.name || "", title: chosen.title || "", raw: chosen.raw || null });
            }
            // [BinTV iOS build 231] Phiên phát MỚI (phim/tập khác) → reset trần
            // handoff và nhớ nguồn XẾP HẠNG CAO NHẤT: khi mọi nguồn web đều lỗi
            // thì native sẽ thử đúng nguồn tốt nhất này (không phải nguồn cuối).
            resetMovieNativeHandoff(true);
            movieNativeSessionPrimaryUrl = validStreams.length ? String(validStreams[0].url || "") : "";
            if (type === "tv") {
                var tvStreams = validStreams;
                if (!tvStreams.length && subtitleContext && Array.isArray(subtitleContext._bintvTvValidatedStreams)) tvStreams = subtitleContext._bintvTvValidatedStreams;
                if (!tvStreams.length) tvStreams = streams;
                if (!movieNativeSessionPrimaryUrl && tvStreams.length) {
                    movieNativeSessionPrimaryUrl = String((tvStreams[0] && tvStreams[0].url) || "");
                }
                if (startMovieTvPlaybackWithFallback(tvStreams, title || "Truyền hình", subtitleContext)) return;
                moviePlayerEpisodeSwitchInProgress = false;
                showMovieStatus(!validStreams.length ? describeUnplayableStreams(classified) : "Link truyền hình hiện không hoạt động", true);
                return;
            }
            clearMovieTvPlaybackFallback();
            if (!validStreams.length) {
                // [build 230] Chỉ có torrent + addon hỗ trợ cấu hình debrid
                // → mời nhập khoá (chuẩn Stremio), rồi thử lại tự động.
                if (offerMovieAddonConfigForTorrent(classified, type, id, title, subtitleContext)) return;
                moviePlayerEpisodeSwitchInProgress = false;
                var reason = describeUnplayableStreams(classified);
                if (moviePlayerOpen) updateMoviePlayerStatus(reason);
                else showMovieStatus(reason, true);
                return;
            }
            // Luu state de fallback khi stream hien tai loi
            movieStreamFallback = {
                streams: validStreams,
                index: 0,
                title: title || "Phim",
                subtitleContext: subtitleContext
            };
            var selected = validStreams[0];
            if (validStreams.length > 1 && window.__phimDebug) {
                window.__phimDebug.log("loadMovieStreams: " + validStreams.length + " streams available, will fallback on error");
            }
            subtitleContext.stream = selected;
            // [build 234] Ưu tiên TRÌNH PHÁT TÍCH HỢP: nếu trình phát iOS của
            // phiên TRƯỚC còn đang phủ màn hình (mở phim/tập mới khi native
            // chưa kịp đóng) thì đóng nó TRƯỚC — thẻ <video> nằm SAU
            // AVPlayerViewController nên để native mở là không thấy hình.
            if (movieNativeHandoffActive) {
                movieNativeHandoffActive = false;
                try { if (typeof window.__bintvStopVideoNative === "function") window.__bintvStopVideoNative(); } catch (e) {}
            }
            startMoviePlayback(selected.url, title || selected.title || selected.name || "Phim", subtitleContext);
        }, function (error) {
            moviePlayerEpisodeSwitchInProgress = false;
            if (abortGuard && !abortGuard()) return;   // [build 233] đã bị huỷ
            var message = getMovieRequestErrorMessage("Không thể tải nguồn phát", error);
            // [build 233] Đang xem bằng player NATIVE → kéo nó xuống ngay để
            // người dùng thấy thông báo lỗi trong UI web (thay vì nhìn khung
            // hình cuối vô định cho tới khi backstop 45s của Swift tự đóng).
            if (movieNativeHandoffActive) {
                movieNativeHandoffActive = false;
                try { if (typeof window.__bintvStopVideoNative === "function") window.__bintvStopVideoNative(); } catch (stopNativeError) {}
            }
            if (moviePlayerOpen) updateMoviePlayerStatus(message);
            else showMovieStatus(message, true);
        });
    }

    function requestText(url, timeout, success, failure) {
        var xhr = new XMLHttpRequest();
        var finished = false;
        var timer = null;
        function finishOk(text) {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            success(text || "");
        }
        function finishFail(error) {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            failure(error || new Error("Network request failed"));
        }
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) { finishFail(new Error("HTTP " + xhr.status)); return; }
            finishOk(xhr.responseText);
        };
        xhr.onerror = function () { finishFail(new Error("Network error")); };
        xhr.ontimeout = function () { finishFail(new Error("Request timeout")); };
        try {
            xhr.open("GET", url, true);
            xhr.timeout = timeout || 10000;
            timer = setTimeout(function () { try { xhr.abort(); } catch (e) {} finishFail(new Error("Request timeout")); }, (timeout || 10000) + 500);
            xhr.send();
        } catch (e) { finishFail(e); }
    }

    function updateMovieSubtitleButton(text, active) {
        var status = document.getElementById("bintv-movie-subtitle-status");
        if (!status) return;
        status.textContent = text || "Vietsub";
        status.classList.toggle("active", !!active);
        if (movieSubtitleMenuOpen) renderMovieSubtitleMenu();
    }

    function getDirectMovieImdbId(context) {
        if (!context) return "";
        var candidates = [context.imdb_id, context.imdbId, context.videoId, context.id];
        for (var i = 0; i < candidates.length; i++) {
            var match = String(candidates[i] || "").match(/tt\d{5,12}/i);
            if (match) return match[0].toLowerCase();
        }
        return "";
    }

    function buildSubtitleVideoId(imdbId, context) {
        if (!imdbId) return "";
        if (context && context.type === "series" && context.season != null && context.episode != null) {
            return imdbId + ":" + context.season + ":" + context.episode;
        }
        return imdbId;
    }

    function resolveMovieSubtitleId(context, done) {
        var directId = getDirectMovieImdbId(context);
        if (directId) { done(buildSubtitleVideoId(directId, context)); return; }
        var title = String((context && context.name) || "").replace(/^\s+|\s+$/g, "");
        if (!title) { done(""); return; }
        var type = context && context.type === "series" ? "series" : "movie";
        var searchUrl = MOVIE_CINEMETA_URL + "/catalog/" + type + "/top/search=" + encodeURIComponent(title) + ".json";
        requestJson(searchUrl, MOVIE_REQUEST_TIMEOUT, function (data) {
            var metas = data && Array.isArray(data.metas) ? data.metas : [];
            if (metas.length === 0) { done(""); return; }
            var selected = metas[0];
            var imdbId = getDirectMovieImdbId(selected);
            done(buildSubtitleVideoId(imdbId, context));
        }, function () { done(""); });
    }

    function getSubtitleSourceBase(manifestUrl) {
        return String(manifestUrl || "").replace(/\/manifest\.json(?:\?.*)?$/i, "");
    }

    function getSubtitleContextId(context) {
        if (!context) return "";
        return String(context.videoId || context.id || "").replace(/^\s+|\s+$/g, "");
    }

    function buildSubtitleSourceRequestUrl(source, subtitleVideoId, context) {
        var type = context && context.type === "series" ? "series" : "movie";
        var base = getSubtitleSourceBase(source.manifestUrl);
        var url = base + "/subtitles/" + type + "/" + encodeURIComponent(subtitleVideoId) + ".json";
        var query = [];
        var streamUrl = context && context.stream && context.stream.url;
        var fileName = context && context.stream && context.stream.behaviorHints && context.stream.behaviorHints.filename;
        if (streamUrl) {
            query.push("videoUrl=" + encodeURIComponent(streamUrl));
            query.push("streamUrl=" + encodeURIComponent(streamUrl));
        }
        if (fileName) query.push("filename=" + encodeURIComponent(fileName));
        if (context && context.name) query.push("title=" + encodeURIComponent(context.name));
        query.push("targetLanguage=vi");
        return url + (query.length ? "?" + query.join("&") : "");
    }

    function getVietnameseSubtitleOptions(source, data) {
        var subtitles = data && Array.isArray(data.subtitles) ? data.subtitles : [];
        var vietnamese = [];
        var allValid = [];
        for (var i = 0; i < subtitles.length; i++) {
            if (!subtitles[i] || !subtitles[i].url) continue;
            allValid.push(subtitles[i]);
            var lang = String(subtitles[i].lang || subtitles[i].language || "").toLowerCase();
            if (lang === "vie" || lang === "vi" || lang === "vietnamese" || lang === "vietnam") vietnamese.push(subtitles[i]);
        }
        if (vietnamese.length > 0) return vietnamese;
        return source.acceptAllLanguages ? allValid : [];
    }

    function finishMovieSubtitleSearchWithoutResult(token) {
        if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
        movieSubtitleOptions = [];
        movieSubtitleActiveSource = "";
        movieSubtitleLoadState = "error";
        movieSubtitleEnableRequested = false;
        movieSubtitleUserDisabled = true;
        updateMovieSubtitleButton("CC Vietsub: Không có trên OpenSubtitles", false);
    }

    function tryMovieSubtitleSource(sourceIndex, attempt, resolvedSubtitleId, context, token) {
        if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
        if (sourceIndex >= MOVIE_SUBTITLE_SOURCES.length) { finishMovieSubtitleSearchWithoutResult(token); return; }

        var source = MOVIE_SUBTITLE_SOURCES[sourceIndex];
        var maxAttempts = source.maxAttempts || 1;
        updateMovieSubtitleButton("CC Vietsub: " + source.name + " " + attempt + "/" + maxAttempts, false);

        function retryOrNextSource() {
            if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
            if (attempt < maxAttempts) tryMovieSubtitleSource(sourceIndex, attempt + 1, resolvedSubtitleId, context, token);
            else tryMovieSubtitleSource(sourceIndex + 1, 1, resolvedSubtitleId, context, token);
        }

        var manifestRequestUrl = source.manifestUrl + (source.manifestUrl.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
        requestJson(manifestRequestUrl, MOVIE_SUBTITLE_TIMEOUT, function (manifest) {
            if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
            if (!manifest || !manifest.resources) { retryOrNextSource(); return; }

            var requestId = resolvedSubtitleId || getSubtitleContextId(context);
            if (!requestId) { retryOrNextSource(); return; }
            var subtitleRequestUrl = buildSubtitleSourceRequestUrl(source, requestId, context);
            requestJson(subtitleRequestUrl, MOVIE_SUBTITLE_TIMEOUT, function (data) {
                if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
                var options = getVietnameseSubtitleOptions(source, data);
                if (options.length === 0) {
                    tryMovieSubtitleSource(sourceIndex + 1, 1, resolvedSubtitleId, context, token);
                    return;
                }
                for (var i = 0; i < options.length; i++) options[i]._bintvSourceName = source.name;
                movieSubtitleOptions = options;
                movieSubtitleActiveSource = source.name;
                movieSubtitleLoadState = "loaded";
                updateMovieSubtitleButton("CC Vietsub: " + options.length + " bản OpenSubtitles", false);
                if (movieSubtitleEnableRequested && !movieSubtitleUserDisabled) applyMovieSubtitle(0, true);
                else updateMovieSubtitleButton("CC Vietsub: Tắt", false);
            }, retryOrNextSource);
        }, retryOrNextSource);
    }

    function loadVietnameseSubtitles(context) {
        movieSubtitleRequestToken++;
        var token = movieSubtitleRequestToken;
        context = context || movieCurrentSubtitleContext || null;
        movieCurrentSubtitleContext = context;
        movieSubtitleOptions = [];
        movieSubtitleActiveIndex = -1;
        movieSubtitleActiveSource = "";
        movieSubtitleLoadState = "loading";
        clearMovieSubtitleRendering();
        updateMovieSubtitleButton("CC Vietsub: Đang tải OpenSubtitles…", false);

        resolveMovieSubtitleId(context, function (resolvedSubtitleId) {
            if (token !== movieSubtitleRequestToken || !moviePlayerOpen) return;
            tryMovieSubtitleSource(0, 1, resolvedSubtitleId, context, token);
        });
    }

    function parseSubtitleTime(value) {
        var match = String(value || "").match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
        if (!match) return -1;
        return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10) + parseInt(match[4], 10) / 1000;
    }

    function parseSrtSubtitles(text) {
        var normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var blocks = normalized.split(/\n\s*\n/);
        var cues = [];
        for (var i = 0; i < blocks.length; i++) {
            var lines = blocks[i].split("\n");
            var timingIndex = -1;
            for (var j = 0; j < lines.length; j++) { if (lines[j].indexOf("-->") !== -1) { timingIndex = j; break; } }
            if (timingIndex === -1) continue;
            var times = lines[timingIndex].split("-->");
            var start = parseSubtitleTime(times[0]);
            var end = parseSubtitleTime(times[1]);
            if (start < 0 || end <= start) continue;
            var cueText = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/^\s+|\s+$/g, "");
            if (cueText) cues.push({ start: start, end: end, text: cueText });
        }
        cues.sort(function (a, b) { return a.start - b.start; });
        return cues;
    }

    function getMoviePlaybackSeconds() {
        if (moviePlayerUsingAVPlay && window.webapis && webapis.avplay) {
            try { return webapis.avplay.getCurrentTime() / 1000; } catch (e) { return 0; }
        }
        var video = document.getElementById("bintv-movie-html5-player");
        return video && isFinite(video.currentTime) ? video.currentTime : 0;
    }

    function renderCurrentMovieSubtitle() {
        var element = document.getElementById("bintv-movie-subtitle-text");
        if (!element) return;
        if (movieSubtitleActiveIndex < 0 || movieSubtitleCues.length === 0) { element.textContent = ""; return; }
        var time = getMoviePlaybackSeconds();
        var activeCue = movieSubtitleCues[movieSubtitleCueCursor];
        if (activeCue && time >= activeCue.start && time <= activeCue.end) {
            if (element.textContent !== activeCue.text) element.textContent = activeCue.text;
            return;
        }
        var low = 0;
        var high = movieSubtitleCues.length - 1;
        var candidateIndex = -1;
        while (low <= high) {
            var middle = Math.floor((low + high) / 2);
            if (movieSubtitleCues[middle].start <= time) { candidateIndex = middle; low = middle + 1; }
            else high = middle - 1;
        }
        movieSubtitleCueCursor = candidateIndex >= 0 ? candidateIndex : 0;
        var candidate = candidateIndex >= 0 ? movieSubtitleCues[candidateIndex] : null;
        var text = candidate && time <= candidate.end ? candidate.text : "";
        if (element.textContent !== text) element.textContent = text;
    }

    function clearMovieSubtitleRendering() {
        if (movieSubtitleTimer) { clearInterval(movieSubtitleTimer); movieSubtitleTimer = null; }
        movieSubtitleCues = [];
        movieSubtitleCueCursor = 0;
        var element = document.getElementById("bintv-movie-subtitle-text");
        if (element) element.textContent = "";
    }

    function disableMovieSubtitle(userInitiated) {
        if (userInitiated) {
            movieSubtitleUserDisabled = true;
            movieSubtitleEnableRequested = false;
            if (movieSubtitleLoadState === "loading") {
                movieSubtitleRequestToken++;
                movieSubtitleLoadState = "idle";
                movieSubtitleOptions = [];
                movieSubtitleActiveSource = "";
            }
        }
        movieSubtitleActiveIndex = -1;
        clearMovieSubtitleRendering();
        // [build 232] Tắt Vietsub → gỡ phụ đề khỏi player native (cues rỗng).
        if (movieNativeHandoffActive) pushMovieSubtitlesToNative([], "");
        updateMovieSubtitleButton("CC Vietsub: Tắt", false);
    }

    function enableMovieSubtitleOnDemand() {
        if (!moviePlayerOpen) return;
        movieSubtitleUserDisabled = false;
        movieSubtitleEnableRequested = true;
        if (movieSubtitleOptions.length && movieSubtitleLoadState === "loaded") {
            applyMovieSubtitle(0, false);
            return;
        }
        if (movieSubtitleLoadState === "loading") return;
        loadVietnameseSubtitles(movieCurrentSubtitleContext);
    }

    function applyMovieSubtitle(optionIndex, automatic) {
        if (!automatic) {
            movieSubtitleUserDisabled = false;
            movieSubtitleEnableRequested = true;
        }
        if (movieSubtitleUserDisabled || !movieSubtitleEnableRequested) return;
        var option = movieSubtitleOptions[optionIndex];
        if (!option || !option.url) { disableMovieSubtitle(false); return; }
        updateMovieSubtitleButton("CC Vietsub: Đang tải…", false);
        requestText(option.url, MOVIE_SUBTITLE_TIMEOUT, function (text) {
            if (!moviePlayerOpen || movieSubtitleUserDisabled || !movieSubtitleEnableRequested) return;
            var cues = parseSrtSubtitles(text);
            if (cues.length === 0) { updateMovieSubtitleButton("CC Vietsub: Không đọc được", false); return; }
            clearMovieSubtitleRendering();
            movieSubtitleCues = cues;
            movieSubtitleCueCursor = 0;
            movieSubtitleActiveIndex = optionIndex;
            movieSubtitleTimer = setInterval(renderCurrentMovieSubtitle, 250);
            renderCurrentMovieSubtitle();
            updateMovieSubtitleButton("CC Vietsub: Bật · " + (option._bintvSourceName || movieSubtitleActiveSource), true);
            // [build 232] Nếu đang phát bằng trình phát native → đẩy cue sang
            // Swift (phụ đề DOM bị AVPlayerViewController che khuất).
            if (movieNativeHandoffActive) {
                pushMovieSubtitlesToNative(movieSubtitleCues,
                    (option._bintvSourceName || movieSubtitleActiveSource));
            }
        }, function () { if (moviePlayerOpen && !movieSubtitleUserDisabled && movieSubtitleEnableRequested) updateMovieSubtitleButton("CC Vietsub: Lỗi tải", false); });
    }

    function renderMovieSubtitleMenu() {
        var list = document.getElementById("bintv-movie-subtitle-list");
        if (!list) return;
        list.innerHTML = "";
        var labels = ["Tắt Vietsub"];
        if (movieSubtitleOptions.length) {
            for (var i = 0; i < movieSubtitleOptions.length; i++) labels.push("Vietsub " + (i + 1) + " · " + (movieSubtitleOptions[i]._bintvSourceName || movieSubtitleActiveSource));
        } else if (movieSubtitleLoadState === "loading") labels.push("Đang tải OpenSubtitles…");
        else labels.push(movieSubtitleLoadState === "error" ? "Thử bật Vietsub" : "Bật Vietsub");
        for (var j = 0; j < labels.length; j++) {
            (function (menuIndex) {
                var row = document.createElement("div");
                row.className = "movie-subtitle-option";
                row.textContent = labels[menuIndex];
                row.addEventListener("click", function () { movieSubtitleMenuIndex = menuIndex; selectMovieSubtitleMenuItem(); });
                list.appendChild(row);
            })(j);
        }
        updateMovieSubtitleMenuFocus();
    }

    function updateMovieSubtitleMenuFocus() {
        var rows = document.querySelectorAll("#bintv-movie-subtitle-list .movie-subtitle-option");
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("focus", i === movieSubtitleMenuIndex);
    }

    function getMovieSubtitleMenuItemCount() {
        return movieSubtitleOptions.length ? movieSubtitleOptions.length + 1 : 2;
    }

    function resetMovieSubtitleMenuTimer() {
        if (movieSubtitleMenuTimer) { clearTimeout(movieSubtitleMenuTimer); movieSubtitleMenuTimer = null; }
        if (!movieSubtitleMenuOpen) return;
        movieSubtitleMenuTimer = setTimeout(function () { closeMovieSubtitleMenu(); }, MOVIE_SUBTITLE_MENU_TIMEOUT);
    }

    function openMovieSubtitleMenu() {
        if (!moviePlayerOpen) return;
        cancelMovieScrubInteraction(true);
        hideMovieSeekTimelineImmediately();
        movieSubtitleMenuOpen = true;
        movieSubtitleMenuIndex = movieSubtitleActiveIndex >= 0 ? movieSubtitleActiveIndex + 1 : 0;
        var menu = document.getElementById("bintv-movie-subtitle-menu");
        if (menu) menu.classList.add("show");
        renderMovieSubtitleMenu();
        resetMovieSubtitleMenuTimer();
    }

    function closeMovieSubtitleMenu() {
        movieSubtitleMenuOpen = false;
        if (movieSubtitleMenuTimer) { clearTimeout(movieSubtitleMenuTimer); movieSubtitleMenuTimer = null; }
        var menu = document.getElementById("bintv-movie-subtitle-menu");
        if (menu) menu.classList.remove("show");
    }

    function selectMovieSubtitleMenuItem() {
        if (movieSubtitleMenuIndex === 0) disableMovieSubtitle(true);
        else if (movieSubtitleOptions.length) applyMovieSubtitle(movieSubtitleMenuIndex - 1, false);
        else if (movieSubtitleLoadState !== "loading") enableMovieSubtitleOnDemand();
        closeMovieSubtitleMenu();
    }

    function formatMovieSeekTime(milliseconds) {
        var totalSeconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        return (hours > 0 ? (hours < 10 ? "0" : "") + hours + ":" : "") + (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    function updateMovieSeekTimeline(current, target, duration) {
        var timeline = document.getElementById("bintv-movie-seek-timeline");
        if (!timeline) return;
        if (movieSeekTimelineHideTimer) { clearTimeout(movieSeekTimelineHideTimer); movieSeekTimelineHideTimer = null; }
        var safeCurrent = Math.max(0, Number(current) || 0);
        var safeTarget = Math.max(0, Number(target) || 0);
        var safeDuration = Math.max(0, Number(duration) || 0);
        var percentage = safeDuration > 0 ? Math.max(0, Math.min(100, safeTarget * 100 / safeDuration)) : 0;
        var currentLabel = document.getElementById("bintv-movie-seek-current");
        var targetLabel = document.getElementById("bintv-movie-seek-target");
        var durationLabel = document.getElementById("bintv-movie-seek-duration");
        var progress = document.getElementById("bintv-movie-seek-progress");
        var thumb = document.getElementById("bintv-movie-seek-thumb");
        if (currentLabel) currentLabel.textContent = "Bắt đầu " + formatMovieSeekTime(safeCurrent);
        if (targetLabel) targetLabel.textContent = formatMovieSeekTime(safeTarget) + " / " + (safeDuration > 0 ? formatMovieSeekTime(safeDuration) : "--:--");
        if (durationLabel) durationLabel.textContent = safeTarget > safeCurrent ? "Tua tiến" : (safeTarget < safeCurrent ? "Tua lùi" : "Chọn vị trí");
        if (progress) progress.style.width = percentage + "%";
        if (thumb) thumb.style.left = percentage + "%";
        timeline.classList.add("show");
        timeline.setAttribute("aria-hidden", "false");
        movieSeekTimelineVisible = true;
        if (jvhdPlayerSession) updateJvhdQualitySelector();
    }

    function scheduleMovieSeekTimelineHide(delay) {
        if (jvhdQualitySelectorOpen) return;
        if (movieSeekTimelineHideTimer) clearTimeout(movieSeekTimelineHideTimer);
        var hideDelay = Math.max(0, Number(delay) || 450);
        if (canSelectJvhd1080Quality()) hideDelay = Math.max(4000, hideDelay);
        movieSeekTimelineHideTimer = setTimeout(function () {
            movieSeekTimelineHideTimer = null;
            var timeline = document.getElementById("bintv-movie-seek-timeline");
            if (timeline) {
                timeline.classList.remove("show");
                timeline.setAttribute("aria-hidden", "true");
            }
            movieSeekTimelineVisible = false;
            hideJvhdQualitySelector();
        }, hideDelay);
    }

    function hideMovieSeekTimelineImmediately() {
        if (movieSeekTimelineHideTimer) { clearTimeout(movieSeekTimelineHideTimer); movieSeekTimelineHideTimer = null; }
        var timeline = document.getElementById("bintv-movie-seek-timeline");
        if (timeline) {
            timeline.classList.remove("show");
            timeline.setAttribute("aria-hidden", "true");
        }
        movieSeekTimelineVisible = false;
        hideJvhdQualitySelector();
    }

    function getMoviePlaybackClockMilliseconds() {
        var position = Math.max(0, Number(moviePlaybackClockMilliseconds) || 0);
        if (moviePlaybackClockRunning && moviePlaybackClockStartedAt > 0) position += Math.max(0, Date.now() - moviePlaybackClockStartedAt);
        return position;
    }

    function syncMoviePlaybackClock(position, running) {
        var safePosition = Math.max(0, Number(position) || 0);
        moviePlaybackClockMilliseconds = safePosition;
        moviePlaybackClockStartedAt = running ? Date.now() : 0;
        moviePlaybackClockRunning = !!running;
        movieLastKnownPlaybackMilliseconds = safePosition;
    }

    function freezeMoviePlaybackClock() {
        syncMoviePlaybackClock(getMoviePlaybackClockMilliseconds(), false);
    }

    function resumeMoviePlaybackClock() {
        syncMoviePlaybackClock(getMoviePlaybackClockMilliseconds(), true);
    }

    function normalizeMovieReportedTimeMilliseconds(value) {
        var raw = Number(value);
        if (!isFinite(raw) || raw < 0) return 0;
        var now = Date.now();
        if (!moviePlaybackReportedTimeScale && moviePlaybackLastRawTime >= 0 && moviePlaybackLastRawAt > 0) {
            var rawDelta = raw - moviePlaybackLastRawTime;
            var wallDelta = now - moviePlaybackLastRawAt;
            if (rawDelta >= 0 && wallDelta >= 50) {
                var millisecondDeltaDifference = Math.abs(rawDelta - wallDelta);
                var secondDeltaDifference = Math.abs(rawDelta * 1000 - wallDelta);
                if (secondDeltaDifference + 50 < millisecondDeltaDifference) moviePlaybackReportedTimeScale = 1000;
                else if (millisecondDeltaDifference + 50 < secondDeltaDifference) moviePlaybackReportedTimeScale = 1;
            }
        }
        if (!moviePlaybackReportedTimeScale) {
            var estimated = getMoviePlaybackClockMilliseconds();
            if (raw > 0 && estimated >= 750) {
                var millisecondDifference = Math.abs(raw - estimated);
                var secondDifference = Math.abs(raw * 1000 - estimated);
                if (secondDifference + 250 < millisecondDifference) moviePlaybackReportedTimeScale = 1000;
                else if (millisecondDifference + 250 < secondDifference) moviePlaybackReportedTimeScale = 1;
            }
        }
        moviePlaybackLastRawTime = raw;
        moviePlaybackLastRawAt = now;
        return raw * (moviePlaybackReportedTimeScale || 1);
    }

    function normalizeMovieReportedDurationMilliseconds(value) {
        var duration = Math.max(0, Number(value) || 0);
        if (moviePlaybackReportedTimeScale === 1000 && duration > 0 && duration < 10000) duration *= 1000;
        return duration;
    }

    function getMovieSeekBounds() {
        if (moviePlayerUsingAVPlay && window.webapis && webapis.avplay) {
            var estimatedCurrent = getMoviePlaybackClockMilliseconds();
            try {
                var avCurrent = normalizeMovieReportedTimeMilliseconds(webapis.avplay.getCurrentTime());
                var avDuration = normalizeMovieReportedDurationMilliseconds(webapis.avplay.getDuration());
                if (!isFinite(avCurrent) || avCurrent < 0) avCurrent = 0;
                if (avCurrent > 0) {
                    syncMoviePlaybackClock(avCurrent, !moviePlayerPaused);
                    estimatedCurrent = avCurrent;
                } else {
                    estimatedCurrent = Math.max(estimatedCurrent, movieLastKnownPlaybackMilliseconds);
                }
                return { current: Math.max(0, estimatedCurrent || 0), duration: avDuration };
            } catch (e) {
                estimatedCurrent = Math.max(estimatedCurrent, movieLastKnownPlaybackMilliseconds);
                return { current: Math.max(0, estimatedCurrent), duration: 0 };
            }
        }
        var video = document.getElementById("bintv-movie-html5-player");
        if (!video) return null;
        var htmlCurrent = Math.max(0, (Number(video.currentTime) || 0) * 1000);
        if (htmlCurrent > 0) syncMoviePlaybackClock(htmlCurrent, !moviePlayerPaused);
        return { current: htmlCurrent, duration: isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0 };
    }

    function clampMovieSeekTarget(target, duration) {
        var clamped = Math.max(0, Number(target) || 0);
        if (duration > 0 && clamped > duration) clamped = duration;
        return clamped;
    }

    function cancelMovieScrubInteraction(hideTimeline) {
        if (movieScrubHoldTimer) { clearTimeout(movieScrubHoldTimer); movieScrubHoldTimer = null; }
        if (movieScrubTickTimer) { clearTimeout(movieScrubTickTimer); movieScrubTickTimer = null; }
        if (movieScrubReleaseTimer) { clearTimeout(movieScrubReleaseTimer); movieScrubReleaseTimer = null; }
        movieScrubKeyDown = false;
        movieScrubDirection = 0;
        movieScrubRepeatSeen = false;
        movieScrubPressStartedAt = 0;
        movieScrubOriginMilliseconds = -1;
        movieScrubTargetMilliseconds = -1;
        movieScrubDurationMilliseconds = 0;
        movieScrubMoved = false;
        if (hideTimeline) hideMovieSeekTimelineImmediately();
    }

    function getMovieScrubStepMilliseconds() {
        var elapsed = Math.max(0, Date.now() - movieScrubPressStartedAt);
        if (jvhdPlayerSession) {
            if (elapsed < 2000) return 5000;
            if (elapsed < 4000) return 20000;
            if (elapsed < 6000) return 40000;
            return 60000;
        }
        if (elapsed < 2500) return 5000;
        if (elapsed < 5000) return 10000;
        if (elapsed < 7500) return 20000;
        if (elapsed < 10000) return 30000;
        if (elapsed < 13000) return 45000;
        return 60000;
    }

    function updateMovieScrubPreview() {
        if (!movieScrubKeyDown || !moviePlayerOpen || movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen) return;
        var previousTarget = movieScrubTargetMilliseconds;
        var nextTarget = clampMovieSeekTarget(previousTarget + movieScrubDirection * getMovieScrubStepMilliseconds(), movieScrubDurationMilliseconds);
        if (nextTarget !== previousTarget) {
            movieScrubTargetMilliseconds = nextTarget;
            movieScrubMoved = true;
            updateMovieSeekTimeline(movieScrubOriginMilliseconds, nextTarget, movieScrubDurationMilliseconds);
        }
    }

    function scheduleNextMovieScrubTick() {
        if (movieScrubTickTimer || !movieScrubKeyDown || !movieScrubRepeatSeen) return;
        movieScrubTickTimer = setTimeout(function () {
            movieScrubTickTimer = null;
            if (!movieScrubKeyDown || !movieScrubRepeatSeen) return;
            updateMovieScrubPreview();
            scheduleNextMovieScrubTick();
        }, MOVIE_SCRUB_TICK_INTERVAL);
    }

    function startMovieScrubTicker() {
        if (movieScrubTickTimer || !movieScrubKeyDown || !movieScrubRepeatSeen) return;
        updateMovieScrubPreview();
        scheduleNextMovieScrubTick();
    }

    function finishMovieScrubInteraction() {
        if (!movieScrubKeyDown) return false;
        var origin = movieScrubOriginMilliseconds;
        var target = movieScrubTargetMilliseconds;
        var duration = movieScrubDurationMilliseconds;
        var moved = movieScrubMoved && target >= 0 && Math.abs(target - origin) >= 1;
        cancelMovieScrubInteraction(false);
        if (!moved) {
            updateMovieSeekTimeline(origin, origin, duration);
            scheduleMovieSeekTimelineHide(450);
            return true;
        }
        updateMovieSeekTimeline(origin, target, duration);
        performMovieScrubSeek(target);
        return true;
    }

    function armMovieScrubReleaseFallback(delay) {
        if (movieScrubReleaseTimer) clearTimeout(movieScrubReleaseTimer);
        movieScrubReleaseTimer = setTimeout(function () {
            movieScrubReleaseTimer = null;
            if (movieScrubKeyDown) finishMovieScrubInteraction();
        }, Math.max(MOVIE_SCRUB_RELEASE_FALLBACK, Number(delay) || 0));
    }

    function startMovieScrub(direction) {
        if (!moviePlayerOpen || !direction || movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen) return;
        if (movieScrubKeyDown) {
            if (movieScrubDirection === direction) {
                movieScrubRepeatSeen = true;
                if (Date.now() - movieScrubPressStartedAt >= MOVIE_SCRUB_HOLD_DELAY) startMovieScrubTicker();
                armMovieScrubReleaseFallback(MOVIE_SCRUB_RELEASE_FALLBACK);
                return;
            }
            cancelMovieScrubInteraction(false);
        }

        var bounds = getMovieSeekBounds();
        if (!bounds) { updateMoviePlayerStatus("Không đọc được vị trí video để tua"); return; }
        var base = bounds.current;
        movieScrubKeyDown = true;
        movieScrubDirection = direction;
        movieScrubRepeatSeen = false;
        movieScrubPressStartedAt = Date.now();
        movieScrubOriginMilliseconds = clampMovieSeekTarget(base, bounds.duration);
        movieScrubTargetMilliseconds = movieScrubOriginMilliseconds;
        movieScrubDurationMilliseconds = bounds.duration;
        movieScrubMoved = false;
        updateMovieSeekTimeline(movieScrubOriginMilliseconds, movieScrubTargetMilliseconds, movieScrubDurationMilliseconds);
        movieScrubHoldTimer = setTimeout(function () {
            movieScrubHoldTimer = null;
            if (movieScrubKeyDown && movieScrubRepeatSeen) startMovieScrubTicker();
        }, MOVIE_SCRUB_HOLD_DELAY);
        armMovieScrubReleaseFallback(MOVIE_SCRUB_HOLD_DELAY + MOVIE_SCRUB_RELEASE_FALLBACK);
    }

    function handleMovieScrubKeyUp(e) {
        var direction = (isKey(e || {}, 37, "ArrowLeft") || isKey(e || {}, 412, "MediaRewind")) ? -1 :
            ((isKey(e || {}, 39, "ArrowRight") || isKey(e || {}, 417, "MediaFastForward")) ? 1 : 0);
        if (!direction || !movieScrubKeyDown || direction !== movieScrubDirection) return false;
        return finishMovieScrubInteraction();
    }

    function renderMoviePlayerEpisodeMenu() {
        var list = document.getElementById("bintv-movie-player-episodes-list");
        if (!list) return;
        list.innerHTML = "";
        for (var i = 0; i < movieEpisodes.length; i++) {
            (function (episodeIndex) {
                var episode = movieEpisodes[episodeIndex];
                var row = document.createElement("div");
                row.className = "movie-player-episode-option";
                row.textContent = episode.title || ("Tập " + (episode.episode || episodeIndex + 1));
                row.addEventListener("click", function () {
                    moviePlayerEpisodeIndex = episodeIndex;
                    selectMoviePlayerEpisode();
                });
                list.appendChild(row);
            })(i);
        }
        updateMoviePlayerEpisodeFocus();
    }

    function updateMoviePlayerEpisodeFocus() {
        var rows = document.querySelectorAll("#bintv-movie-player-episodes-list .movie-player-episode-option");
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.toggle("focus", i === moviePlayerEpisodeIndex);
            rows[i].classList.toggle("current", i === movieCurrentEpisodeIndex);
        }
        if (rows[moviePlayerEpisodeIndex]) try { rows[moviePlayerEpisodeIndex].scrollIntoView(false); } catch (e) {}
    }

    function openMoviePlayerEpisodeMenu() {
        if (!moviePlayerOpen) return;
        cancelMovieScrubInteraction(true);
        hideMovieSeekTimelineImmediately();
        if (!hasInPlayerEpisodeList()) {
            updateMoviePlayerStatus("Phim này không có danh sách tập");
            return;
        }
        moviePlayerEpisodeMenuOpen = true;
        moviePlayerEpisodeIndex = movieCurrentEpisodeIndex >= 0 && movieCurrentEpisodeIndex < movieEpisodes.length ? movieCurrentEpisodeIndex : 0;
        var menu = document.getElementById("bintv-movie-player-episodes");
        if (menu) menu.classList.add("show");
        renderMoviePlayerEpisodeMenu();
        syncNativeEpisodeList(true);
    }

    function closeMoviePlayerEpisodeMenu() {
        moviePlayerEpisodeMenuOpen = false;
        var menu = document.getElementById("bintv-movie-player-episodes");
        if (menu) menu.classList.remove("show");
        try {
            var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.playVideoNative;
            if (bridge) bridge.postMessage({ action: "hideEpisodes" });
        } catch (e) {}
    }

    function selectMoviePlayerEpisode() {
        var episode = movieEpisodes[moviePlayerEpisodeIndex];
        if (!episode || !episode.id || moviePlayerEpisodeSwitchInProgress) return;
        cancelMovieAutoAdvance();   // [build 234] chọn tập tay → huỷ luồng tự chuyển tập
        movieCurrentEpisodeIndex = moviePlayerEpisodeIndex;
        moviePlayerEpisodeSwitchInProgress = true;
        closeMoviePlayerEpisodeMenu();

        var subtitleContext = {
            id: movieEpisodeMeta && movieEpisodeMeta.id ? movieEpisodeMeta.id : episode.id,
            videoId: episode.id,
            type: movieEpisodeType || "series",
            name: movieEpisodeTitle || "Phim",
            releaseInfo: movieEpisodeMeta && movieEpisodeMeta.releaseInfo,
            imdb_id: movieEpisodeMeta && (movieEpisodeMeta.imdb_id || movieEpisodeMeta.imdbId),
            season: episode.season,
            episode: episode.episode
        };
        // [build 233] Khoá lần chuyển tập này bằng serial: người dùng đóng
        // hẳn player (hoặc chọn phim/tập khác) TRONG LÚC đang nạp nguồn →
        // kết quả nạp bị bỏ qua, player (kể cả native) KHÔNG tự bật lại.
        movieEpisodeSwitchSerial += 1;
        var switchSerial = movieEpisodeSwitchSerial;
        stopMoviePlayback(true);
        updateMoviePlayerStatus("Đang chuyển sang " + (episode.title || "tập đã chọn") + "…");
        loadMovieStreams(movieEpisodeType || "series", episode.id, (movieEpisodeTitle || "Phim") + " · " + (episode.title || "Tập phim"), subtitleContext,
            function () { return switchSerial === movieEpisodeSwitchSerial && moviePlayerOpen; });
    }

    // =================================================================
    // [BinTV iOS build 233] LUỒNG KẾT THÚC PHÁT — phim BỘ / phim LẺ
    //  • Phim BỘ: phát hết tập → TỰ CHUYỂN sang tập tiếp theo; người dùng
    //    đóng trình phát (hoặc đã phát tập cuối) → quay về CHỌN TẬP.
    //  • Phim LẺ: phát hết hoặc đóng trình phát → quay về giao diện PHIM.
    // =================================================================

    // Phim bộ hiện tại còn TẬP TIẾP THEO hợp lệ không?
    function canPlayNextMovieEpisode() {
        if (!movieEpisodes || movieEpisodes.length === 0) return false;
        if (movieEpisodeType !== "series") return false;
        if (movieCurrentEpisodeIndex < 0) return false;
        var nextIndex = movieCurrentEpisodeIndex + 1;
        if (nextIndex >= movieEpisodes.length) return false;
        var next = movieEpisodes[nextIndex];
        return !!(next && next.id);
    }

    // Tự động chuyển sang TẬP TIẾP THEO (giữ nguyên trình phát — đi qua
    // đúng đường selectMoviePlayerEpisode: khoá serial chống race, giữ cờ
    // ưu tiên native để native tiếp tục phát nếu nó đang hiển thị).
    // Trả về true khi lần chuyển tập đã được bắt đầu.
    function playNextMovieEpisode(origin) {
        if (!canPlayNextMovieEpisode() || moviePlayerEpisodeSwitchInProgress) return false;
        var nextIndex = movieCurrentEpisodeIndex + 1;
        var next = movieEpisodes[nextIndex];
        try {
            window.__phimDebug && window.__phimDebug.log("[PLAYER] tự chuyển sang tập tiếp theo (" + (origin || "auto") + "): "
                + (next.title || ("Tập " + (next.episode || nextIndex + 1))));
        } catch (e) {}
        moviePlayerEpisodeIndex = nextIndex;
        movieEpisodeIndex = nextIndex;      // đồng bộ focus của overlay chọn tập
        selectMoviePlayerEpisode();
        return true;
    }

    // =================================================================
    // [build 234 — 2026-09-15] TỰ CHUYỂN TẬP SAU KHI TRÌNH PHÁT ĐÓNG
    //
    //   hết tập (còn tập kế) → ĐÓNG trình phát → TỰ phát tập tiếp theo.
    //
    // Trình phát được đóng HẲN trước (native: action "stop" → AVPlayer đóng;
    // web: overlay player gỡ khỏi màn hình) rồi mới nạp nguồn tập kế — đúng
    // yêu cầu "phát xong một tập, trình phát tự đóng như hiện tại; sau khi
    // đóng tự động phát tập tiếp theo, không dừng ở màn hình chọn tập".
    // Nhờ vậy phiên phát mới luôn SẠCH (item/nguồn cũ đã được thu hồi hoàn
    // toàn) và KHÔNG phụ thuộc player nào đang hiển thị.
    //
    // Trả về true khi luồng tự chuyển tập đã bắt đầu.
    // =================================================================
    function startMovieAutoAdvance(origin) {
        // [build 236] Tắt tự phát tập kế — hết tập chỉ mở danh sách tập.
        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] auto-advance bị tắt (" + (origin || "") + ")"); } catch (e) {}
        return false;
        if (movieAutoAdvanceActive) return false;
        if (!canPlayNextMovieEpisode()) return false;
        var nextIndex = movieCurrentEpisodeIndex + 1;
        var next = movieEpisodes[nextIndex];
        if (!next || !next.id) return false;

        movieAutoAdvanceActive = true;
        movieAutoAdvanceSerial += 1;
        movieAutoAdvanceOrigin = String(origin || "auto");
        var serial = movieAutoAdvanceSerial;

        // Con trỏ tập trỏ NGAY sang tập kế (UI chọn tập, resume, Return… đều
        // nhất quán với tập sắp phát).
        moviePlayerEpisodeIndex = nextIndex;
        movieEpisodeIndex = nextIndex;
        movieCurrentEpisodeIndex = nextIndex;
        closeMoviePlayerEpisodeMenu();

        var subtitleContext = {
            id: movieEpisodeMeta && movieEpisodeMeta.id ? movieEpisodeMeta.id : next.id,
            videoId: next.id,
            type: movieEpisodeType || "series",
            name: movieEpisodeTitle || "Phim",
            releaseInfo: movieEpisodeMeta && movieEpisodeMeta.releaseInfo,
            imdb_id: movieEpisodeMeta && (movieEpisodeMeta.imdb_id || movieEpisodeMeta.imdbId),
            season: next.season,
            episode: next.episode
        };
        var title = (movieEpisodeTitle || "Phim") + " · "
            + (next.title || ("Tập " + (next.episode || nextIndex + 1)));

        try {
            window.__phimDebug && window.__phimDebug.log("[PLAYER] tự chuyển tập tiếp theo ("
                + movieAutoAdvanceOrigin + "): " + title);
        } catch (e) {}

        // (1) ĐÓNG TRÌNH PHÁT NGAY — không đợi nạp nguồn (nguồn có thể chậm).
        stopMoviePlayback();
        moviePlayerEpisodeSwitchInProgress = true;   // đang chuyển tập (khoá race)
        // (2) Báo tiến trình cho người dùng thấy (player đã đóng → status nằm
        //     trên thanh trạng thái của lưới PHIM).
        showMovieStatus("Đang chuẩn bị tập tiếp theo…", false);
        // (3) Nạp nguồn tập kế; guard = lần tự chuyển tập này còn hiệu lực?
        //     (người dùng Return / chọn tập khác / rời màn hình PHIM → huỷ)
        loadMovieStreams(movieEpisodeType || "series", next.id, title, subtitleContext,
            function () { return isMovieAutoAdvanceValid(serial); });
        return true;
    }

    function isMovieAutoAdvanceValid(serial) {
        return movieAutoAdvanceActive && movieAutoAdvanceSerial === serial && movieBrowserOpen;
    }

    // Vô hiệu lần tự chuyển tập đang chờ (Return / chọn tập-phim khác / rời
    // màn hình PHIM). Không đụng tới trình phát đang mở.
    function cancelMovieAutoAdvance() {
        if (!movieAutoAdvanceActive) return;
        movieAutoAdvanceActive = false;
        movieAutoAdvanceSerial += 1;
        moviePlayerEpisodeSwitchInProgress = false;
        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] huỷ tự chuyển tập đang chờ"); } catch (e) {}
    }

    // Mở lại overlay "Chọn tập" của PHIM BỘ sau khi trình phát đóng —
    // yêu cầu: đóng trình phát phim bộ → về giao diện CHỌN TẬP (không phải
    // lưới phim). Focus đặt ở tập vừa xem để chọn tiếp cho nhanh.
    function reopenMovieEpisodePicker() {
        if (!movieBrowserOpen || moviePlayerOpen) return;
        if (movieEpisodeOpen) return;
        if (!movieEpisodes || movieEpisodes.length === 0 || movieEpisodeType !== "series") return;
        var focusIndex = movieCurrentEpisodeIndex >= 0 ? movieCurrentEpisodeIndex : 0;
        showMovieEpisodes(movieEpisodes, movieEpisodeType, movieEpisodeTitle, movieEpisodeMeta);
        if (focusIndex >= 0 && focusIndex < movieEpisodes.length) {
            movieEpisodeIndex = focusIndex;
            updateMovieEpisodeFocus();
        }
    }

    // Video phát HẾT (đường <video> HTML5 — iOS WKWebView / Electron).
    // JVHD (live) giữ nguyên luồng riêng; TV-fallback giữ nguyên luồng cũ.
    function handleMoviePlaybackCompleted(origin) {
        if (jvhdPlayerSession) { handleJvhdPlaybackCompleted(); return; }
        if (movieTvPlaybackFallback) { handleMoviePlaybackError(); return; }
        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] phát hết (" + (origin || "ended") + ")"); } catch (e) {}
        if (presentInPlayerEpisodeListAfterEnd(origin || "ended")) return;
        stopMoviePlayback();
        if (movieEpisodes && movieEpisodes.length > 0 && movieEpisodeType === "series") reopenMovieEpisodePicker();
    }

    // [build 236] Hết tập: KHÔNG tự phát tập kế. Giữ player, mở danh sách tập.
    function presentInPlayerEpisodeListAfterEnd(origin) {
        if (!hasInPlayerEpisodeList()) return false;
        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] hết tập — mở danh sách tập (" + (origin || "") + ")"); } catch (e) {}
        cancelMovieAutoAdvance();
        moviePlayerPaused = true;
        try {
            var video = document.getElementById("bintv-movie-html5-player");
            if (video && !video.paused) video.pause();
        } catch (e) {}
        if (movieNativeHandoffActive) {
            try { window.__bintvPrepareNextNativeEpisode && window.__bintvPrepareNextNativeEpisode(); } catch (e2) {}
        }
        updateMoviePlayerStatus("Đã phát xong tập này · chọn tập tiếp theo");
        openMoviePlayerEpisodeMenu();
        return true;
    }

    // Hook cho test jsdom (tests/ios-native-handoff) kiểm tra luồng kết thúc
    // phát mà không cần iPhone/Xcode — cùng tinh thần __bintvPushNativeSubtitles.
    window.__bintvMoviePlaybackHooks = {
        setEpisodes: function (videos, type, title, currentIndex, meta) {
            movieEpisodes = Array.isArray(videos) ? videos : [];
            movieEpisodeType = type || "series";
            movieEpisodeTitle = title || "Phim";
            movieEpisodeMeta = meta || null;
            movieCurrentEpisodeIndex = (typeof currentIndex === "number") ? currentIndex : -1;
        },
        getState: function () {
            return {
                episodes: movieEpisodes.length,
                type: movieEpisodeType,
                current: movieCurrentEpisodeIndex,
                switchInProgress: moviePlayerEpisodeSwitchInProgress,
                autoAdvance: movieAutoAdvanceActive,
                preferNative: moviePreferNativePlayer,
                handoffActive: movieNativeHandoffActive,
                pickerOpen: movieEpisodeOpen,
                playerOpen: moviePlayerOpen,
                browserOpen: movieBrowserOpen
            };
        },
        setBrowserOpen: function (open) { movieBrowserOpen = !!open; },
        setPlayerOpen: function (open) { moviePlayerOpen = !!open; },
        setPreferNative: function (on) { moviePreferNativePlayer = !!on; },
        setHandoffActive: function (on) { movieNativeHandoffActive = !!on; },
        canNext: canPlayNextMovieEpisode,
        playNext: playNextMovieEpisode,
        reopenPicker: reopenMovieEpisodePicker,
        completed: handleMoviePlaybackCompleted,
        // [build 234] Seam cho test kiểm tra CHÍNH SÁCH ƯU TIÊN TRÌNH PHÁT:
        //   startPlayback(...)  → phát bằng trình phát TÍCH HỢP (không handoff
        //                          sớm, dù nguồn là MKV/AC3 — xem SUITE F);
        //   playbackError()     → mô phỏng trình phát tích hợp thất bại → chỉ
        //                          lúc này mới được fallback sang trình phát iOS.
        startPlayback: function (url, title, context) { startMoviePlayback(url, title, context); },
        playbackError: handleMoviePlaybackError,
        autoAdvance: startMovieAutoAdvance,
        openPlayerEpisodes: openMoviePlayerEpisodeMenu,
        hasEpisodeList: hasInPlayerEpisodeList,
        pushUiState: function () { pushMovieIosUiState(true); },
        // [build 243] Seam cho test kiểm tra CHÍNH SÁCH MỘT TRÌNH PHÁT
        // (SUITE I của tests/ios-native-handoff): đọc trình phát đã chọn,
        // phim/tập đang chờ chọn, và tự gỡ nguồn của trình phát tích hợp.
        chosenPlayer: movieChosenPlayer,
        pendingPlayerChoice: function () {
            if (!moviePendingPlayerChoicePlayback) return null;
            return {
                url: moviePendingPlayerChoicePlayback.url,
                title: moviePendingPlayerChoicePlayback.title
            };
        },
        releaseIntegratedSource: releaseMovieIntegratedPlayerSource
    };

    window.__bintvNativeSelectEpisode = function (info) {
        var index = -1;
        if (info && typeof info.index === "number") index = info.index;
        else if (info && info.id) {
            for (var i = 0; i < movieEpisodes.length; i++) {
                if (movieEpisodes[i] && String(movieEpisodes[i].id) === String(info.id)) { index = i; break; }
            }
        }
        if (index < 0 || index >= movieEpisodes.length) return;
        moviePlayerEpisodeIndex = index;
        selectMoviePlayerEpisode();
    };

    // =================================================================
    // [build 234 — 2026-09-15] CẦU NỐI GESTURE ĐIỀU HƯỚNG (Swift ↔ JS)
    //
    // Gesture điều hướng nằm ở SWIFT (window-level recognizer) nhưng phải
    // hành xử theo NGỮ CẢNH của module PHIM:
    //   • KHÔNG ở trong video player: vuốt từ cạnh trái = RETURN của chính
    //     app PHIM (đóng menu con/phụ đề/chọn tập/player…) — nếu UI PHIM
    //     đang ở màn hình gốc thì trả false để Swift lùi về màn hình trước.
    //   • ĐANG ở trong video player: vuốt ngang cạnh trái/phải = TUA (giống
    //     kéo thanh tiến trình); vuốt từ trên xuống = Return (đóng player,
    //     quay về màn hình trước khi phát).
    // Swift không thể chờ evaluateJavaScript cho mỗi cú vuốt → trạng thái
    // được MIRROR về (chỉ gửi khi ĐỔI, kèm poll nhẹ 300ms phòng trường hợp
    // UI đổi ở nhánh khác).
    // =================================================================

    // UI PHIM hiện có gì để Return không? (màn hình gốc → false)
    function movieHasReturnTarget() {
        if (moviePlayerOpen) return true;
        if (movieEpisodeOpen) return true;
        if (movieSearchResultsActive) return true;
        if (movieFilterMenuOpen || movieSearchOpen) return true;
        if (movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen) return true;
        if (jvhdQualitySelectorOpen) return true;
        if (jvhdPlayerSession) return true;
        return false;
    }

    function pushMovieIosUiState(force) {
        try {
            var handler = window.webkit && window.webkit.messageHandlers
                && window.webkit.messageHandlers.phimBridge;
            if (!handler) return;
            var canReturn = movieHasReturnTarget();
            var playerOpen = !!moviePlayerOpen;
            // Vị trí/thời lượng để Swift TUA bằng gesture ngang: gốc tính đích
            // tua tuyệt đối, giống hệt lúc người dùng kéo thanh tiến trình.
            var positionMs = 0;
            var durationMs = 0;
            if (playerOpen) {
                var bounds = getMovieSeekBounds();
                if (bounds) {
                    if (isFinite(bounds.current) && bounds.current > 0) positionMs = Math.round(bounds.current);
                    if (isFinite(bounds.duration) && bounds.duration > 0) durationMs = Math.round(bounds.duration);
                }
            }
            // Chữ ký gồm cả vị trí (giây) khi player mở → mirror tự cập nhật
            // ~1 lần/giây lúc đang phát + NGAY khi UI đổi; lúc duyệt phim chỉ
            // gửi khi trạng thái đổi → gần như không tốn gì.
            var signature = (canReturn ? "1" : "0") + (playerOpen ? "1" : "0")
                + (moviePlayerPaused ? "1" : "0")
                + (playerOpen ? ":" + Math.round(positionMs / 1000) : "");
            if (!force && signature === movieIosUiStateLastSignature) return;
            movieIosUiStateLastSignature = signature;
            handler.postMessage({
                action: "uiState",
                canReturn: canReturn,
                playerOpen: playerOpen,
                playerPaused: !!moviePlayerPaused,
                positionMs: positionMs,
                durationMs: durationMs
            });
        } catch (e) {}
    }
    // Poll nhẹ: trạng thái UI PHIM đổi ở rất nhiều nhánh (menu, chọn tập,
    // player, filter…) — mirror chỉ gửi khi CÓ THAY ĐỔI nên chi phí ~0.
    setInterval(function () { pushMovieIosUiState(false); }, 300);

    // RETURN của chính UI PHIM — Swift gọi khi người dùng vuốt cạnh trái.
    // Trả về true nếu đã xử lý (đóng player/menu/chọn tập…), false nếu đang ở
    // màn hình gốc (Swift lùi về màn hình trước đó).
    window.__bintvPhimReturn = function () {
        cancelMovieAutoAdvance();
        var handled = false;
        try { handled = !!handleMovieBackAction(); } catch (e) { handled = false; }
        pushMovieIosUiState(true);
        return handled;
    };

    // ---- TUA BẰNG GESTURE (kéo ngang ở cạnh màn hình trong player) ----
    // Swift gửi vị trí TUYỆT ĐỐI (giây) tính từ vị trí lúc bắt đầu vuốt →
    // không bị trôi (drift) dù seek trước đó chưa hoàn tất.
    window.__bintvPlayerBeginSeek = function () {
        if (!moviePlayerOpen) return null;
        var bounds = getMovieSeekBounds();
        if (!bounds) return null;
        var duration = (isFinite(bounds.duration) && bounds.duration > 0) ? bounds.duration / 1000 : 0;
        return { position: Math.max(0, bounds.current / 1000), duration: duration };
    };
    window.__bintvPlayerSeekTo = function (seconds) {
        if (!moviePlayerOpen) return false;
        var value = Number(seconds);
        if (!isFinite(value) || value < 0) return false;
        performMovieScrubSeek(value * 1000);
        return true;
    };
    window.__bintvPlayerEndSeek = function () {
        scheduleMovieSeekTimelineHide(450);
        return true;
    };

    function updateMoviePlayerStatus(message) {
        var msg = String(message || "");
        var hideJvhdPlayingStatus = jvhdPlayerSession && msg.indexOf("Đang phát") === 0;
        var status = document.getElementById("bintv-movie-player-status");
        if (status) {
            status.textContent = msg;
            status.style.display = hideJvhdPlayingStatus ? "none" : "";
        }
        var overlay = document.querySelector("#bintv-movie-player .movie-player-overlay");
        if (overlay) {
            if (hideJvhdPlayingStatus) {
                overlay.style.display = "none";
            } else if (movieTvPlaybackFallback) {
                var idle = msg === "Đang phát" || msg === "Tạm dừng" || msg.indexOf("Đang phát") === 0;
                overlay.style.display = idle ? "none" : "";
            } else {
                overlay.style.display = "";
            }
        }
    }

    function resetMovieSeekOperationState() {
        movieSeekOperationSerial++;
        if (movieSeekCancelOperation) try { movieSeekCancelOperation(); } catch (e) {}
        movieSeekCancelOperation = null;
        movieSeekFailureHandler = null;
        movieSeekInProgress = false;
        movieSeekActiveTargetMilliseconds = -1;
        moviePendingSeekTargetMilliseconds = -1;
        movieSeekErrorGraceUntil = 0;
    }

    function handleMovieAvPlaySeekError() {
        if (movieSeekInProgress) {
            if (movieSeekFailureHandler) {
                try { movieSeekFailureHandler(); } catch (e) { resetMovieSeekOperationState(); updateMoviePlayerStatus("Tua không thành công, vẫn giữ trình phát"); scheduleMovieSeekTimelineHide(450); }
            } else { resetMovieSeekOperationState(); updateMoviePlayerStatus("Tua không thành công, vẫn giữ trình phát"); scheduleMovieSeekTimelineHide(450); }
            return true;
        }
        if (Date.now() < movieSeekErrorGraceUntil) return true;
        return false;
    }

    function handleMoviePlaybackError() {
        if (window.__phimDebug) window.__phimDebug.warn("handleMoviePlaybackError called, jvhdPlayerSession=", jvhdPlayerSession);
        if (jvhdPlayerSession) { handleJvhdPlaybackFailure(); return; }
        if (handleMovieAvPlaySeekError()) return;
        if (tryNextMovieTvFallbackStream()) return;
        // [Phim standalone 2026-09] Fallback sang stream tiep theo neu co
        if (tryNextMovieStreamFallback()) {
            if (window.__phimDebug) window.__phimDebug.log("Trying next movie stream fallback");
            return;
        }
        // =================================================================
        // [BinTV iOS build 231] HẾT nguồn web → CHUYỂN SANG TRÌNH PHÁT GỐC
        // CỦA iOS (AVPlayer) thay vì hiện lỗi "Không thể phát … trên TV".
        // Nguồn thử = nguồn xếp hạng cao nhất của phiên (validStreams[0]).
        // requestNativeMoviePlayback trả false trên Android/Tizen/Windows
        // (không có message handler playVideoNative) → hành vi cũ giữ nguyên.
        // Nếu native cũng fail, Swift gọi lại window.__bintvNativePlaybackFailed
        // → thông báo THẬT ở dưới (không bao giờ im lặng giả vờ đang phát).
        // =================================================================
        if (requestNativeMoviePlayback("web-streams-exhausted",
                                       movieNativeSessionPrimaryUrl || movieCurrentStreamUrl)) {
            return;
        }
        stopMoviePlayback();
        // [Phim standalone 2026-09] Hien thi thong bao ro rang hon neu da thu
        // tat ca cac stream nguon (thuong do key nguon sc.k-20.xyz het han).
        if (movieStreamFallback) {
            clearMovieStreamFallback();
            showMovieStatus("Nguồn phim tạm thời không khả dụng, vui lòng thử lại sau", true);
        } else {
            // [iOS build 231] iPhone KHÔNG phải TV: dùng thông báo đúng thiết bị
            // (nội dung cũ "…trên TV" chỉ còn áp dụng cho Android/Tizen TV).
            showMovieStatus(describeMoviePlaybackUnavailable(""), true);
        }
    }

    function startMoviePlayback(url, title, subtitleContext) {
        if (window.__phimDebug) window.__phimDebug.log("startMoviePlayback", { url: url, title: title, hasWebapis: !!(window.webapis && webapis.avplay) });
        // =================================================================
        // [build 243 — 2026-09-17] MỘT TRÌNH PHÁT DUY NHẤT (THEO LỰA CHỌN)
        //
        // Kiểm tra NGAY TRƯỚC KHI nạp bất kỳ nguồn nào:
        //   • CHƯA chọn trình phát  → KHÔNG nạp player nào (không <video>,
        //     không AVPlayer) → báo Swift chuyển sang SETTING; nhớ đúng
        //     phim/tập để phát tiếp khi người dùng chọn xong.
        //   • chọn "native"         → chỉ trình phát iOS nạp URL; thẻ <video>
        //     không nhận src (không preload, không tạo instance chờ sẵn).
        //   • chọn "integrated"     → đi tiếp nhánh <video> bên dưới (như cũ).
        // Phiên JVHD (live) có luồng + HUD chất lượng riêng của web app nên
        // giữ nguyên đường phát cũ. Ngoài WKWebView iOS: không có cầu nối →
        // bỏ qua toàn bộ khối này (hành vi Android/Tizen/Windows không đổi).
        // =================================================================
        if (isIosNativePlaybackBridge() && !jvhdPlayerSession) {
            var chosenPlayer = movieChosenPlayer();
            if (!chosenPlayer) {
                moviePendingPlayerChoicePlayback = {
                    url: String(url || ""),
                    title: String(title || "Phim"),
                    subtitleContext: subtitleContext || null
                };
                moviePlayerEpisodeSwitchInProgress = false;
                if (requestMoviePlayerChoiceFromUser(title)) {
                    try {
                        window.__phimDebug && window.__phimDebug.log(
                            "[PLAYER] chưa chọn trình phát → KHÔNG nạp player nào, chuyển sang SETTING:",
                            String(title || ""));
                    } catch (logError) {}
                    showMovieStatus("Chưa chọn trình phát PHIM — mở SETTING để chọn…", false);
                    return;
                }
                // Không gửi được (không có handler phimBridge) → phát như cũ.
                moviePendingPlayerChoicePlayback = null;
            } else if (chosenPlayer === "native") {
                if (startMoviePlaybackOnChosenNativePlayer(url, title, subtitleContext)) return;
                // Trình phát iOS không nhận nguồn (URL đã thử / hết trần
                // handoff) → KHÔNG mở trình phát còn lại, báo lỗi THẬT.
                if (moviePlayerOpen) {
                    updateMoviePlayerStatus(describeMoviePlaybackUnavailable(
                        "trình phát iOS không nhận nguồn này"));
                } else {
                    showMovieStatus(describeMoviePlaybackUnavailable(
                        "trình phát iOS không nhận nguồn này"), true);
                }
                return;
            }
        }
        // [BinTV iOS build 231] MỖI lần phát = MỘT phiên mới: tăng session id
        // để mọi callback từ trình phát native của LẦN PHÁT TRƯỚC (nếu còn
        // bay về muộn) bị isStaleNativeCallback() loại bỏ — không bao giờ
        // dọn UI hay đổi nguồn oan của lần phát hiện tại.
        movieNativePlaybackSession += 1;
        movieNativeHandoffActive = false;
        ensureMovieExperienceUI();
        moviePlayerOpen = true;
        // [build 234] Trình phát TÍCH HỢP đang là player hiển thị → mirror
        // trạng thái về Swift NGAY (gesture: vuốt ngang cạnh = tua, vuốt từ
        // trên xuống = Return/đóng player).
        pushMovieIosUiState(true);
        moviePlayerPaused = false;
        moviePlayerUsingAVPlay = false;
        cancelMovieScrubInteraction(true);
        resetMovieSeekOperationState();
        moviePlaybackReportedTimeScale = 0;
        moviePlaybackLastRawTime = -1;
        moviePlaybackLastRawAt = 0;
        syncMoviePlaybackClock(0, false);
        hideMovieSeekTimelineImmediately();
        moviePlayerEpisodeSwitchInProgress = false;
        syncNativeEpisodeList(false);

        var browser = document.getElementById("bintv-movie-browser");
        var player = document.getElementById("bintv-movie-player");
        // [build 242] TÊN PHIM không còn hiển thị trong trình phát → không
        // tìm/ghi #bintv-movie-player-title (phần tử đã bị gỡ khỏi DOM).
        var avObject = document.getElementById("bintv-movie-avplayer");
        var htmlVideo = document.getElementById("bintv-movie-html5-player");
        if (browser) browser.classList.add("player-active");
        if (player) {
            player.classList.add("show");
            player.setAttribute("tabindex", "-1");
            try { player.focus(); } catch (focusError) {}
        }
        if (avObject) avObject.setAttribute("tabindex", "-1");
        updateMoviePlayerStatus("Đang chuẩn bị phát…");
        movieSubtitleRequestToken++;
        movieCurrentSubtitleContext = subtitleContext || { name: title || "Phim", type: "movie" };
        movieSubtitleUserDisabled = true;
        movieSubtitleEnableRequested = false;
        movieSubtitleLoadState = "idle";
        movieSubtitleOptions = [];
        movieSubtitleActiveIndex = -1;
        movieSubtitleActiveSource = "";
        clearMovieSubtitleRendering();
        updateMovieSubtitleButton("CC Vietsub: Tắt", false);

        // =================================================================
        // [BinTV iOS build 231] GHI NHỚ NGUỒN + PRE-FLIGHT HANDOFF
        //  (1) Ghi lại streamUrl GỐC / URL đã bọc proxy / Referer / tiêu đề —
        //      nhánh lỗi (handleMoviePlaybackError) cần đúng các giá trị này
        //      để gửi sang Swift.
        //  (2) Nếu nguồn là thứ WebKit KHÔNG giải mã được (container MKV/AVI/
        //      FLV/WMV/RM/MPEG-PS, hoặc file progressive quảng cáo audio
        //      AC3/EAC3/DTS/TrueHD) → chuyển THẲNG sang AVPlayer native,
        //      không đốt thời gian chờ <video> fail rồi mới chữa. HLS vẫn để
        //      web phát trước (WebKit phát HLS native rất tốt).
        //  Trên Android/Tizen/Windows cả 2 hàm đều trả false → không đổi gì.
        // =================================================================
        rememberMovieStreamSource(url, title, subtitleContext && subtitleContext.stream);
        // =================================================================
        // [build 234 — 2026-09-15] ƯU TIÊN TRÌNH PHÁT TÍCH HỢP (xem khối
        // chính sách MOVIE_INTEGRATED_PLAYER_FIRST ở đầu file).
        //
        // KHÔNG pre-flight handoff nữa: dù nguồn là MKV/AVI/AC3… (thứ WebKit
        // thường không giải mã được) thì vẫn để TRÌNH PHÁT TÍCH HỢP thử trước.
        // Chỉ khi nó THẬT SỰ không phát được (video.onerror / hết nguồn dự
        // phòng) mới đi các nhánh fallback sang trình phát iOS:
        //   • phim_ios_fallback.js: proxy fail → direct fail → native;
        //   • handleMoviePlaybackError(): hết mọi nguồn web → native.
        // `iosNeedsNativePlayerFor` chỉ còn dùng để LOG chẩn đoán (biết trước
        // nguồn nào có khả năng phải fallback) — không quyết định phát.
        // =================================================================
        var nativePlaybackHint = iosNeedsNativePlayerFor(url, subtitleContext && subtitleContext.stream);
        try {
            window.__phimDebug && window.__phimDebug.log(
                "[PLAYER] ưu tiên trình phát tích hợp (thẻ <video>)"
                + (nativePlaybackHint ? " — nguồn có dấu hiệu WebKit không giải mã được, sẽ fallback nếu lỗi" : "")
                + ":", String(url).substring(0, 140));
        } catch (e) {}
        // Tập kế đã có nguồn → lần tự chuyển tập (build 234) hoàn tất.
        movieAutoAdvanceActive = false;

        // [BinTV iOS build 231] VÔ HIỆU HOÁ nhánh TV/EXTERNAL PLAYER (Tizen
        // webapis.avplay — "phát trên TV") khi chạy trong WKWebView iOS:
        // iPhone không có avplay, và nếu shim nào đó khai báo nhầm thì nhánh
        // này sẽ cướp luồng phát rồi báo "Không thể phát trên TV".
        if (window.webapis && webapis.avplay && !isIosWebViewRuntime()) {
            moviePlayerUsingAVPlay = true;
            try {
                try { webapis.avplay.close(); } catch (closeError) {}
                if (avObject) avObject.style.display = "block";
                if (htmlVideo) htmlVideo.style.display = "none";
                webapis.avplay.open(url);
                webapis.avplay.setListener({
                    onbufferingstart: function () { freezeMoviePlaybackClock(); updateMoviePlayerStatus("Đang tải dữ liệu…"); },
                    onbufferingprogress: function (percent) { updateMoviePlayerStatus("Đang tải " + percent + "%"); },
                    onbufferingcomplete: function () { if (!moviePlayerPaused) resumeMoviePlaybackClock(); updateMoviePlayerStatus("Đang phát"); },
                    oncurrentplaytime: function (currentTime) {
                        var reportedTime = normalizeMovieReportedTimeMilliseconds(currentTime);
                        if (isFinite(reportedTime) && reportedTime >= 0) {
                            syncMoviePlaybackClock(reportedTime, !moviePlayerPaused);
                            if (jvhdPlayerSession) handleJvhdPlaybackProgress(reportedTime);
                        }
                    },
                    onstreamcompleted: function () {
                        if (jvhdPlayerSession) { handleJvhdPlaybackCompleted(); return; }
                        if (movieTvPlaybackFallback) { handleMoviePlaybackError(); return; }
                        stopMoviePlayback(); showMovieStatus("Đã phát xong", false);
                    },
                    onevent: function () {},
                    onerror: function () { handleMoviePlaybackError(); },
                    onsubtitlechange: function () {},
                    ondrmevent: function () {}
                });
                webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
                try { webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX"); } catch (displayError) {}
                webapis.avplay.prepareAsync(function () {
                    try {
                        webapis.avplay.play();
                        resumeMoviePlaybackClock();
                        if (player) player.focus();
                        updateMoviePlayerStatus("Đang phát");
                    } catch (e) { handleMoviePlaybackError(); }
                }, function () { handleMoviePlaybackError(); });
                return;
            } catch (e) {
                moviePlayerUsingAVPlay = false;
            }
        }

        try {
            if (avObject) avObject.style.display = "none";
            if (htmlVideo) {
                htmlVideo.style.display = "block";
                // [Phim standalone 2026-09] Routing qua proxy native (server.js)
                // de tranh CORS tren Electron: server dang host chinh trang nay
                // (window.location.origin = http://localhost:PORT), nen ta co the
                // dung relative path. Neu URL la absolute https ngoai, bao qua
                // /proxy?url=... de server fetch + CORS *. Neu URL la relative
                // hoac da di qua proxy thi dung nguyen.
                var phimStreamUrl = url;
                // [Phim standalone 2026-09] Mot so stream URL (vi du
                // sc.k-20.xyz/proxy-playlist.m3u8?referer=...) can Referer header
                // de server validate. Extract referer (neu co) de forward qua
                // proxy. URL co dang ...?url=<inner>&referer=<ref-url>...
                var phimExtraRef = "";
                if (typeof phimStreamUrl === "string" && /^https?:\/\//i.test(phimStreamUrl)) {
                    try {
                        // Lay referer tu query string neu co
                        var phimQIdx = phimStreamUrl.indexOf("?");
                        if (phimQIdx > 0) {
                            var phimQs = phimStreamUrl.substring(phimQIdx + 1);
                            var phimRefMatch = phimQs.match(/(?:^|&)referer=([^&]+)/i);
                            if (phimRefMatch) {
                                try { phimExtraRef = decodeURIComponent(phimRefMatch[1]); } catch (phimRefDecodeError) { phimExtraRef = phimRefMatch[1]; }
                            }
                        }
                        var phimParsed = (function () { var a = document.createElement("a"); a.href = phimStreamUrl; return a; })();
                        if (phimParsed.protocol === "https:" || phimParsed.protocol === "http:") {
                            var phimCurrentOrigin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
                            if (phimCurrentOrigin && phimParsed.origin !== phimCurrentOrigin && phimStreamUrl.indexOf("/proxy?url=") === -1) {
                                phimStreamUrl = phimCurrentOrigin.replace(/\/+$/, "") + "/proxy?url=" + encodeURIComponent(phimStreamUrl) + (phimExtraRef ? "&__ref=" + encodeURIComponent(phimExtraRef) : "");
                                if (window.__phimDebug) window.__phimDebug.log("URL wrapped via proxy:", phimStreamUrl, "extraRef=", phimExtraRef);
                            }
                        }
                    } catch (phimProxyWrapError) {
                        if (window.__phimDebug) window.__phimDebug.error("proxy wrap error:", phimProxyWrapError);
                    }
                }
                // [Phim LAN14g 2026-09] Phat hien HLS robust hon:
                // - Match truc tiep .m3u8 o cuoi URL hoac truoc ?
                // - Match khi URL chua encoded .m3u8 (vi du /proxy?url=...%2Fplaylist.m3u8%3F...&__ref=...)
                // - Match khi URL tham chieu den m3u8 qua query string
                var phimHlsUrl = (function () {
                    if (typeof phimStreamUrl !== "string") return false;
                    // Match truc tiep
                    if (/\.m3u8(?:\?|$)/i.test(phimStreamUrl)) return true;
                    // Match trong query string (URL da encode)
                    if (/\.m3u8/i.test(phimStreamUrl)) return true;
                    return false;
                })();
                try { window.__phimDebug && window.__phimDebug.log("[STREAM] source detected", { isHls: phimHlsUrl, url: phimStreamUrl, hasHls: jvhdCanUseHls() }); } catch (e) {}
                try { phimLog("startMoviePlayback: source", { isHls: phimHlsUrl, hasHls: jvhdCanUseHls(), url: phimStreamUrl.substring(0, 100) }); } catch (e) {}
                if (phimHlsUrl && jvhdCanUseHls()) {
                    try { window.__phimDebug && window.__phimDebug.log("[HLS] using hls.js for", phimStreamUrl.substring(0, 100)); } catch (e) {}
                    try { phimLog("startMoviePlayback: using hls.js"); } catch (e) {}
                    attachJvhdHls(htmlVideo, phimStreamUrl);
                } else {
                    try { window.__phimDebug && window.__phimDebug.log("[HLS] using native HTMLVideo (NOT HLS.js) - isHls=", phimHlsUrl); } catch (e) {}
                    try { phimLog("startMoviePlayback: using native HTMLVideo (HLS NOT detected)"); } catch (e) {}
                    detachJvhdHls();
                    htmlVideo.src = phimStreamUrl;
                    try { window.__phimDebug && window.__phimDebug.log("[PLAYER] source assigned (native)", { src: htmlVideo.src.substring(0, 100) }); } catch (e) {}
                }
                htmlVideo.autoplay = true;
                htmlVideo.controls = false;
                // [Phim LAN14g 2026-09] Log cac su kien media de debug
                htmlVideo.onloadstart = function () {
                    try { window.__phimDebug && window.__phimDebug.log("[PLAYER] load started", { src: htmlVideo.src.substring(0, 100) }); } catch (e) {}
                };
                htmlVideo.onloadedmetadata = function () {
                    try { window.__phimDebug && window.__phimDebug.log("[PLAYER] loadedmetadata", { src: htmlVideo.src.substring(0, 100), duration: htmlVideo.duration, videoWidth: htmlVideo.videoWidth, videoHeight: htmlVideo.videoHeight }); } catch (e) {}
                };
                htmlVideo.oncanplay = function () {
                    try { window.__phimDebug && window.__phimDebug.log("[PLAYER] canplay", { src: htmlVideo.src.substring(0, 100) }); } catch (e) {}
                };
                htmlVideo.onplaying = function () { if (window.__phimDebug) window.__phimDebug.log("onplaying", phimStreamUrl); moviePlayerPaused = false; resumeMoviePlaybackClock(); updateMoviePlayerStatus("Đang phát"); };
                htmlVideo.ontimeupdate = function () {
                    var htmlTime = Number(htmlVideo.currentTime);
                    if (isFinite(htmlTime) && htmlTime >= 0) {
                        syncMoviePlaybackClock(htmlTime * 1000, !moviePlayerPaused);
                        if (jvhdPlayerSession) handleJvhdPlaybackProgress(htmlTime * 1000);
                    }
                };
                htmlVideo.onended = function () {
                    if (jvhdPlayerSession) { handleJvhdPlaybackCompleted(); return; }
                    // [build 233] Phim BỘ: hết tập → tự phát tập tiếp theo
                    // (hết tập thì về giao diện chọn tập); phim LẺ → về giao
                    // diện PHIM. Trước đây video hết là player đứng im.
                    handleMoviePlaybackCompleted("html5-ended");
                };
                htmlVideo.onerror = function (err) {
                    var errInfo = { src: htmlVideo.src, networkState: htmlVideo.networkState, readyState: htmlVideo.readyState, error: htmlVideo.error && { code: htmlVideo.error.code, message: htmlVideo.error.message } };
                    if (window.__phimDebug) window.__phimDebug.error("htmlVideo.onerror", errInfo);
                    if (errInfo && errInfo.error && errInfo.error.code === 4) {
                        if (window.__phimDebug) window.__phimDebug.warn("Stream URL tra ve content khong phai video. Co the key/hash da het han (sc.k-20.xyz), hoac URL khong hop le.");
                    }
                    // [build 234] BỎ QUA lỗi "ma" đến muộn của nguồn CŨ sau khi
                    // trình phát đã đóng (stopMoviePlayback gỡ src → load(),
                    // hoặc đang giữa lúc tự chuyển tập). Nếu không chặn, lỗi
                    // này sẽ kéo luồng sang TRÌNH PHÁT iOS dù người dùng không
                    // hề yêu cầu — trái chính sách ưu tiên trình phát tích hợp.
                    if (!moviePlayerOpen) {
                        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] bỏ qua htmlVideo.onerror khi trình phát đã đóng"); } catch (e) {}
                        return;
                    }
                    handleMoviePlaybackError();
                };
                try { window.__phimDebug && window.__phimDebug.log("[PLAYER] play() called"); } catch (e) {}
                var playResult = htmlVideo.play();
                if (playResult && typeof playResult.catch === "function") playResult.catch(function (playErr) {
                    // [Phim LAN14g 2026-09] Phan biet AbortError (do fallback cleanup
                    // goi stopMoviePlayback truoc khi play() hoan thanh) vs loi that.
                    var errName = playErr && playErr.name;
                    if (errName === "AbortError") {
                        try { window.__phimDebug && window.__phimDebug.log("[PLAYER] play() AbortError (expected, fallback in progress)", playErr && playErr.message); } catch (e) {}
                        try { phimLog("startMoviePlayback: play() AbortError (expected)"); } catch (e) {}
                        // KHONG goi handleMoviePlaybackError vi day la abort binh thuong
                        return;
                    }
                    try { window.__phimDebug && window.__phimDebug.error("htmlVideo.play() rejected", errName, playErr && playErr.message); } catch (e) {}
                    try { phimLog("startMoviePlayback: play() rejected", { name: errName, msg: playErr && playErr.message }); } catch (e) {}
                    // [build 234] Trình phát đã đóng (người dùng Return / đang
                    // tự chuyển tập) → lời hứa play() cũ bị từ chối không còn
                    // nghĩa: KHÔNG được kéo sang trình phát iOS.
                    if (!moviePlayerOpen) return;
                    handleMoviePlaybackError();
                });
            }
        } catch (e) { handleMoviePlaybackError(); }
    }

    function stopMoviePlayback(keepPlayerVisible, preserveTvFallback) {
        cancelMovieScrubInteraction(true);
        // [BinTV iOS build 231] Player web bị ĐÓNG trong lúc trình phát native
        // đang mở (vd người dùng bấm Back) → yêu cầu Swift đóng AVPlayer,
        // không để player native "mồ côi" phủ trên UI. Cờ movieNativeHandoffActive
        // được hạ TRƯỚC khi gọi nên callback onClosed từ Swift không gây vòng lặp.
        if (!keepPlayerVisible && movieNativeHandoffActive) {
            movieNativeHandoffActive = false;
            try {
                if (typeof window.__bintvStopVideoNative === "function") window.__bintvStopVideoNative();
            } catch (e) {}
        }
        // [build 233] ĐÓNG HẲN player (không phải dừng-tạm để đổi tập/nguồn):
        //  (1) hạ cờ ưu tiên native — lần phát sau bắt đầu như phiên mới;
        //  (2) VÔ HIỆU mọi lần chuyển tập còn đang nạp nguồn → startMoviePlayback
        //      của lần nạp đó bị chặn, player (kể cả native) không tự bật lại
        //      sau khi người dùng đã đóng.
        if (!keepPlayerVisible) {
            moviePreferNativePlayer = false;
            movieEpisodeSwitchSerial += 1;
        }
        if (!preserveTvFallback) clearMovieTvPlaybackFallback();
        movieSubtitleRequestToken++;
        closeMovieSubtitleMenu();
        closeMoviePlayerEpisodeMenu();
        clearMovieSubtitleRendering();
        movieSubtitleOptions = [];
        movieSubtitleActiveIndex = -1;
        movieCurrentSubtitleContext = null;
        movieSubtitleUserDisabled = true;
        movieSubtitleEnableRequested = false;
        movieSubtitleLoadState = "idle";
        movieSubtitleActiveSource = "";
        if (moviePlayerUsingAVPlay && window.webapis && webapis.avplay) {
            try { webapis.avplay.stop(); } catch (stopError) {}
            try { webapis.avplay.close(); } catch (closeError) {}
        }
        var htmlVideo = document.getElementById("bintv-movie-html5-player");
        if (htmlVideo) {
            detachJvhdHls();
            try { htmlVideo.pause(); } catch (e) {}
            try { htmlVideo.removeAttribute("src"); htmlVideo.load(); } catch (e) {}
        }
        var player = document.getElementById("bintv-movie-player");
        var browser = document.getElementById("bintv-movie-browser");
        if (!keepPlayerVisible) {
            if (player) player.classList.remove("show");
            if (browser) browser.classList.remove("player-active");
            moviePlayerOpen = false;
            moviePlayerEpisodeSwitchInProgress = false;
            pushMovieIosUiState(true);   // [build 234] gesture: player đã đóng NGAY
            updateMovieBrowserFocus();
            if (movieMergedRefreshPending) {
                movieMergedRefreshPending = false;
                setTimeout(function () {
                    if (movieBrowserOpen && !moviePlayerOpen && isMergedMovieCatalog(movieCatalogs[movieCatalogIndex])) loadMovieCatalog(movieCatalogIndex, 0);
                }, 0);
            }
        } else {
            if (player) player.classList.add("show");
            if (browser) browser.classList.add("player-active");
            moviePlayerOpen = true;
        }
        moviePlayerPaused = false;
        moviePlayerUsingAVPlay = false;
        cancelMovieScrubInteraction(true);
        resetMovieSeekOperationState();
        moviePlaybackReportedTimeScale = 0;
        moviePlaybackLastRawTime = -1;
        moviePlaybackLastRawAt = 0;
        syncMoviePlaybackClock(0, false);
        hideMovieSeekTimelineImmediately();
    }

    function toggleMoviePlayback() {
        if (!moviePlayerOpen) return;
        if (moviePlayerUsingAVPlay && window.webapis && webapis.avplay) {
            try {
                if (moviePlayerPaused) { webapis.avplay.play(); moviePlayerPaused = false; resumeMoviePlaybackClock(); updateMoviePlayerStatus("Đang phát"); }
                else { freezeMoviePlaybackClock(); webapis.avplay.pause(); moviePlayerPaused = true; updateMoviePlayerStatus("Tạm dừng"); }
            } catch (e) {}
            return;
        }
        var video = document.getElementById("bintv-movie-html5-player");
        if (!video) return;
        try {
            if (video.paused) { video.play(); moviePlayerPaused = false; resumeMoviePlaybackClock(); updateMoviePlayerStatus("Đang phát"); }
            else { freezeMoviePlaybackClock(); video.pause(); moviePlayerPaused = true; updateMoviePlayerStatus("Tạm dừng"); }
        } catch (e) {}
    }

    function performMovieScrubSeek(requestedTarget) {
        if (!moviePlayerOpen || movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen) return;
        var bounds = getMovieSeekBounds();
        if (!bounds) { updateMoviePlayerStatus("Không đọc được vị trí video để tua"); scheduleMovieSeekTimelineHide(450); return; }
        var target = clampMovieSeekTarget(requestedTarget, bounds.duration);
        updateMovieSeekTimeline(bounds.current, target, bounds.duration);

        if (movieSeekInProgress) {
            moviePendingSeekTargetMilliseconds = target;
            updateMoviePlayerStatus("Đã chọn " + formatMovieSeekTime(target) + ", đang chờ seek hiện tại");
            return;
        }

        if (Math.abs(target - bounds.current) < 1) {
            scheduleMovieSeekTimelineHide(450);
            return;
        }

        if (moviePlayerUsingAVPlay && window.webapis && webapis.avplay) {
            var state = "";
            try { if (webapis.avplay.getState) state = String(webapis.avplay.getState() || "").toUpperCase(); } catch (stateError) {}
            if (state && state !== "READY" && state !== "PLAYING" && state !== "PAUSED") {
                updateMoviePlayerStatus("Video chưa sẵn sàng để tua");
                scheduleMovieSeekTimelineHide(450);
                return;
            }
            if (!webapis.avplay.seekTo) {
                updateMoviePlayerStatus("Nguồn phim này không hỗ trợ tua");
                scheduleMovieSeekTimelineHide(450);
                return;
            }

            var current = bounds.current;
            var operationId = ++movieSeekOperationSerial;
            var operationFinished = false;
            var operationWatchdog = null;
            movieSeekInProgress = true;
            movieSeekActiveTargetMilliseconds = target;
            moviePendingSeekTargetMilliseconds = -1;
            updateMoviePlayerStatus("Đang chuyển đến " + formatMovieSeekTime(target) + "…");

            function clearOperationWatchdog() {
                if (operationWatchdog) { clearTimeout(operationWatchdog); operationWatchdog = null; }
            }

            function continuePlaybackAfterSeek() {
                try {
                    var currentState = webapis.avplay.getState ? String(webapis.avplay.getState() || "").toUpperCase() : "";
                    if (currentState === "READY" || currentState === "PAUSED") webapis.avplay.play();
                    moviePlayerPaused = false;
                } catch (playError) {}
            }

            function finishSeek(success) {
                if (operationFinished || operationId !== movieSeekOperationSerial) return;
                operationFinished = true;
                clearOperationWatchdog();
                movieSeekFailureHandler = null;
                movieSeekCancelOperation = null;
                movieSeekInProgress = false;
                movieSeekActiveTargetMilliseconds = -1;
                movieSeekErrorGraceUntil = Date.now() + 1500;
                if (success) {
                    syncMoviePlaybackClock(target, true);
                    continuePlaybackAfterSeek();
                    updateMovieSeekTimeline(target, target, bounds.duration);
                    updateMoviePlayerStatus("Đang phát · " + formatMovieSeekTime(target));
                } else updateMoviePlayerStatus("Tua không thành công, vẫn giữ trình phát");
                var pendingTarget = moviePendingSeekTargetMilliseconds;
                moviePendingSeekTargetMilliseconds = -1;
                if (pendingTarget >= 0 && Math.abs(pendingTarget - target) >= 1 && moviePlayerOpen) {
                    setTimeout(function () { performMovieScrubSeek(pendingTarget); }, 0);
                } else scheduleMovieSeekTimelineHide(450);
            }

            function verifySeekAfterTimeout() {
                if (operationFinished || operationId !== movieSeekOperationSerial) return;
                var observed = current;
                try { observed = Number(webapis.avplay.getCurrentTime()) || current; } catch (observeError) {}
                finishSeek(Math.abs(observed - target) < 2000 || Math.abs(observed - current) >= 1000);
            }

            movieSeekCancelOperation = function () {
                if (operationFinished) return;
                operationFinished = true;
                clearOperationWatchdog();
            };
            movieSeekFailureHandler = function () { finishSeek(false); };

            try {
                webapis.avplay.seekTo(target, function () { finishSeek(true); }, function () { finishSeek(false); });
                if (!operationFinished) operationWatchdog = setTimeout(verifySeekAfterTimeout, 4000);
            } catch (seekError) { finishSeek(false); }
            return;
        }

        var video = document.getElementById("bintv-movie-html5-player");
        if (video) {
            try {
                video.currentTime = target / 1000;
                var playResult = video.play();
                if (playResult && typeof playResult.catch === "function") playResult.catch(function () {});
                moviePlayerPaused = false;
                syncMoviePlaybackClock(target, true);
                updateMovieSeekTimeline(target, target, bounds.duration);
                updateMoviePlayerStatus("Đang phát · " + formatMovieSeekTime(target));
            } catch (htmlSeekError) {
                updateMoviePlayerStatus("Nguồn phim này không hỗ trợ tua tại vị trí hiện tại");
            }
            scheduleMovieSeekTimelineHide(450);
        }
    }

    function handleMovieBackAction() {
        // [build 234] Return của người dùng = ý chí chủ động → huỷ lần tự
        // chuyển tập đang chờ (không tự bật lại sau khi người dùng đã Return).
        cancelMovieAutoAdvance();
        if (jvhdQualitySelectorOpen) { closeJvhdQualitySelector(true); return true; }
        if (jvhdPlayerSession && moviePlayerOpen) { closeJvhdPlayback(true); return true; }
        if (movieBrowserOpen || moviePlayerOpen || movieSubtitleMenuOpen || moviePlayerEpisodeMenuOpen || movieSearchOpen || movieFilterMenuOpen) cancelMovieScrubInteraction(true);
        if (movieFilterMenuOpen) { closeMovieFilterMenu(); return true; }
        if (movieSearchOpen) { movieSearchToken++; closeMovieSearch(); return true; }
        if (movieSubtitleMenuOpen) { closeMovieSubtitleMenu(); return true; }
        if (moviePlayerEpisodeMenuOpen) { closeMoviePlayerEpisodeMenu(); return true; }
        // [build 233] Phim BỘ: đóng trình phát → quay về giao diện CHỌN TẬP
        // (reopenMovieEpisodePicker tự no-op với phim lẻ → hành vi cũ: lưới).
        if (moviePlayerOpen) { stopMoviePlayback(); reopenMovieEpisodePicker(); return true; }
        if (movieEpisodeOpen) { closeMovieEpisodes(); return true; }
        if (movieSearchResultsActive) { clearMovieSearchResults(); return true; }
        // [Phim LAN14r 2026-09] Khi dang o man hinh Phim (movieBrowserOpen=true),
        // KHONG dong browser ma de handleBackKey() -> showExitModal() hien dialog
        // Thoat/Huy NGAY. Neu user chon Huy thi dialog dong, browser van mo
        // (khong can phai mo lai). Neu chon Thoat thi quit app.
        // Truoc day dong browser o day lam man hinh den, phai Backspace 2 lan.
        if (movieBrowserOpen) {
            // Return false de handleBackKey xu ly tiep (hien dialog Thoat/Huy)
            return false;
        }
        return false;
    }

    function handleMovieInterfaceKey(left, right, up, down, ok, e) {
        if (jvhdQualitySelectorOpen) return handleJvhdQualitySelectorKey(left, right, up, down, ok);
        if (movieFilterMenuOpen) {
            if (up || left) movieFilterMenuIndex--;
            else if (down || right) movieFilterMenuIndex++;
            else if (ok) { selectMovieFilterMenuItem(); return true; }
            if (movieFilterMenuIndex < 0) movieFilterMenuIndex = MOVIE_FILTER_MENU_OPTIONS.length - 1;
            if (movieFilterMenuIndex >= MOVIE_FILTER_MENU_OPTIONS.length) movieFilterMenuIndex = 0;
            renderMovieFilterMenu();
            return true;
        }
        if (movieSearchOpen) {
            if (movieSearchEditing) {
                if (ok) { movieSearchEditing = false; submitMovieSearch(); return true; }
                if (left || right || up || down) {
                    movieSearchEditing = false;
                    var editingInput = document.getElementById("bintv-movie-search-input");
                    if (editingInput) try { editingInput.blur(); } catch (blurError) {}
                }
            }
            if (left || up) movieSearchFocusIndex--;
            else if (right || down) movieSearchFocusIndex++;
            else if (ok) { activateMovieSearchControl(); return true; }
            if (movieSearchFocusIndex < 0) movieSearchFocusIndex = 2;
            if (movieSearchFocusIndex > 2) movieSearchFocusIndex = 0;
            updateMovieSearchFocus();
            return true;
        }

        if (movieSubtitleMenuOpen) {
            resetMovieSubtitleMenuTimer();
            if (up) movieSubtitleMenuIndex--;
            else if (down) movieSubtitleMenuIndex++;
            else if (ok) { selectMovieSubtitleMenuItem(); return true; }
            var subtitleMenuLength = getMovieSubtitleMenuItemCount();
            if (movieSubtitleMenuIndex < 0) movieSubtitleMenuIndex = subtitleMenuLength - 1;
            if (movieSubtitleMenuIndex >= subtitleMenuLength) movieSubtitleMenuIndex = 0;
            updateMovieSubtitleMenuFocus();
            return true;
        }

        if (moviePlayerEpisodeMenuOpen) {
            if (left) moviePlayerEpisodeIndex--;
            else if (right) moviePlayerEpisodeIndex++;
            else if (up || down) { closeMoviePlayerEpisodeMenu(); return true; }
            else if (ok) { selectMoviePlayerEpisode(); return true; }
            if (moviePlayerEpisodeIndex < 0) moviePlayerEpisodeIndex = movieEpisodes.length - 1;
            if (moviePlayerEpisodeIndex >= movieEpisodes.length) moviePlayerEpisodeIndex = 0;
            updateMoviePlayerEpisodeFocus();
            return true;
        }

        if (moviePlayerOpen) {
            if (left || right) {
                startMovieScrub(left ? -1 : 1);
            } else if (up) {
                if (!movieScrubKeyDown && openJvhdQualitySelector()) return true;
                cancelMovieScrubInteraction(true);
                openMovieSubtitleMenu();
            } else if (down) {
                cancelMovieScrubInteraction(true);
                openMoviePlayerEpisodeMenu();
            } else if (ok) toggleMoviePlayback();
            return true;
        }

        if (movieEpisodeOpen) {
            if (left || up) movieEpisodeIndex--;
            else if (right || down) movieEpisodeIndex++;
            else if (ok) { selectMovieEpisode(); return true; }
            if (movieEpisodeIndex < 0) movieEpisodeIndex = movieEpisodes.length - 1;
            if (movieEpisodeIndex >= movieEpisodes.length) movieEpisodeIndex = 0;
            updateMovieEpisodeFocus();
            return true;
        }

        if (!movieBrowserOpen) return false;
        if (movieBrowserFocusArea === "filters") {
            if (left && movieFilterIndex === 1) movieBrowserFocusArea = "search";
            else if (right && movieFilterIndex === 0) movieBrowserFocusArea = "search";
            else if (down) movieBrowserFocusArea = movieItems.length > 0 ? "items" : "catalogs";
            else if (ok) {
                if (movieFilterIndex === 1) { openMovieFilterMenu(); return true; }
                movieFilterMode = "all";
                applyCurrentMovieFilter();
                return true;
            }
            if (movieFilterIndex < 0) movieFilterIndex = 0;
            if (movieFilterIndex > 1) movieFilterIndex = 1;
        } else if (movieBrowserFocusArea === "search") {
            if (left) { movieBrowserFocusArea = "filters"; movieFilterIndex = 0; }
            else if (right) { movieBrowserFocusArea = "filters"; movieFilterIndex = 1; }
            else if (down) movieBrowserFocusArea = movieItems.length > 0 ? "items" : "catalogs";
            else if (ok) { openMovieSearch(); return true; }
        } else if (movieBrowserFocusArea === "catalogs") {
            if (up && movieCatalogIndex === 0) movieBrowserFocusArea = "filters";
            else if (up) movieCatalogIndex--;
            else if (down) movieCatalogIndex++;
            else if (right && movieItems.length > 0) movieBrowserFocusArea = "items";
            else if (ok) { loadMovieCatalog(movieCatalogIndex, 0); return true; }
            if (movieCatalogIndex < 0) movieCatalogIndex = 0;
            if (movieCatalogIndex >= movieCatalogs.length) movieCatalogIndex = movieCatalogs.length - 1;
        } else {
            var columns = 5;
            if (left) {
                if (movieItemIndex % columns === 0) movieBrowserFocusArea = "catalogs";
                else movieItemIndex--;
            } else if (right && movieItemIndex < movieItems.length - 1) movieItemIndex++;
            else if (up) {
                if (movieItemIndex - columns < 0) movieBrowserFocusArea = "filters";
                else movieItemIndex -= columns;
            } else if (down && movieItemIndex + columns < movieItems.length) movieItemIndex += columns;
            else if (ok && movieItems[movieItemIndex] && !movieFilterInProgress) { openMovieItem(movieItems[movieItemIndex]); return true; }
        }
        updateMovieBrowserFocus();
        return true;
    }

    function getMovieBootstrapCache() {
        if (movieBootstrapCache && Date.now() - movieBootstrapCache.updatedAt <= MOVIE_CATALOG_CACHE_STALE_MAX) return movieBootstrapCache;
        var stored = readMoviePersistentCache("bootstrap", MOVIE_CONFIG_URL);
        if (stored && stored.manifestUrl && stored.manifest && Array.isArray(stored.manifest.catalogs)) {
            movieBootstrapCache = { manifestUrl: stored.manifestUrl, manifest: stored.manifest, updatedAt: stored.updatedAt };
            return movieBootstrapCache;
        }
        return null;
    }

    function cacheMovieBootstrap(manifestUrl, manifest) {
        movieBootstrapCache = { manifestUrl: manifestUrl, manifest: manifest, updatedAt: Date.now() };
        writeMoviePersistentCache("bootstrap", MOVIE_CONFIG_URL, movieBootstrapCache);
        return movieBootstrapCache;
    }

    function fetchMovieBootstrapShared(success, failure) {
        try { phimLog("fetchMovieBootstrapShared: start", { configUrl: MOVIE_CONFIG_URL }); } catch (e) {}
        if (movieBootstrapRequestInFlight) {
            movieBootstrapRequestInFlight.push({ success: success, failure: failure });
            return;
        }
        movieBootstrapRequestInFlight = [{ success: success, failure: failure }];

        function finishSuccess(payload) {
            try { phimLog("fetchMovieBootstrapShared: success", { manifestUrl: payload && payload.manifestUrl, catalogCount: payload && payload.manifest && payload.manifest.catalogs && payload.manifest.catalogs.length }); } catch (e) {}
            var listeners = movieBootstrapRequestInFlight || [];
            movieBootstrapRequestInFlight = null;
            for (var i = 0; i < listeners.length; i++) try { listeners[i].success(payload); } catch (callbackError) {}
        }

        function finishFailure(error) {
            try { phimLog("fetchMovieBootstrapShared: failure", { error: error && error.message }); } catch (e) {}
            var listeners = movieBootstrapRequestInFlight || [];
            movieBootstrapRequestInFlight = null;
            for (var i = 0; i < listeners.length; i++) try { listeners[i].failure(error); } catch (callbackError) {}
        }

        var requestUrl = MOVIE_CONFIG_URL + (MOVIE_CONFIG_URL.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
        try { phimLog("fetchMovieBootstrapShared: config request start", requestUrl.substring(0, 100)); } catch (e) {}
        requestJson(requestUrl, MOVIE_REQUEST_TIMEOUT, function (data) {
            try { phimLog("fetchMovieBootstrapShared: config response received"); } catch (e) {}
            var targetUrl = normalizeMovieManifestUrl(extractMovieTargetUrl(data));
            try { phimLog("fetchMovieBootstrapShared: targetUrl extracted", { targetUrl: targetUrl }); } catch (e) {}
            // [build 229] ĐỌC TOÀN BỘ NGUỒN: ưu tiên `target_urls` (mảng),
            // fallback `target_url` (tương thích cấu hình cũ). Lớp Stremio tự
            // nhận diện mọi dạng lồng nhau → KHÔNG hard-code URL nào.
            var manifestUrls = [];
            if (window.Stremio && typeof window.Stremio.extractManifestUrls === "function") {
                try { manifestUrls = window.Stremio.extractManifestUrls(data) || []; } catch (extractError) { manifestUrls = []; }
            }
            if (!manifestUrls.length && targetUrl) manifestUrls = [targetUrl];
            if (targetUrl && manifestUrls.indexOf(targetUrl) === -1) manifestUrls.unshift(targetUrl);
            if (!manifestUrls.length) { finishFailure(new Error("Cấu hình Phim không có target_url/target_urls")); return; }
            try { phimLog("fetchMovieBootstrapShared: " + manifestUrls.length + " addon url(s)", manifestUrls); } catch (e) {}
            if (!window.Stremio || typeof window.Stremio.loadAddons !== "function") {
                // Không có lớp Stremio → giữ nguyên hành vi cũ (1 addon).
                if (!isValidMovieTargetUrl(targetUrl)) { finishFailure(new Error("target_url của Phim không hợp lệ")); return; }
                requestJson(targetUrl, MOVIE_REQUEST_TIMEOUT, function (manifest) {
                    if (!manifest || !Array.isArray(manifest.catalogs)) { finishFailure(new Error("Manifest Phim không hợp lệ")); return; }
                    finishSuccess(cacheMovieBootstrap(targetUrl, manifest));
                }, function (err) { try { phimLog("fetchMovieBootstrapShared: manifest request failed", err && err.message); } catch (e) {} finishFailure(err); });
                return;
            }
            // Nạp TẤT CẢ addon song song. Addon lỗi/timeout chỉ bị BỎ QUA,
            // không ảnh hưởng các addon còn lại.
            window.Stremio.loadAddons(manifestUrls, function (url, ok, fail) {
                requestJson(url, MOVIE_REQUEST_TIMEOUT, ok, fail);
            }, function (addons) {
                try { phimLog("fetchMovieBootstrapShared: loaded " + addons.length + " addon(s)"); } catch (e) {}
                if (!addons.length) { finishFailure(new Error("Không nạp được addon Phim nào")); return; }
                movieAddons = addons.slice();
                movieBaseUrl = addons[0].baseUrl;                 // tương thích ngược
                applyMovieAddonConfigurations(0);                 // debrid/config đã lưu
                var merged = mergeMovieAddonManifests(addons);    // gộp catalog mọi nguồn
                if (!merged.catalogs || !merged.catalogs.length) { finishFailure(new Error("Manifest Phim không hợp lệ")); return; }
                try { phimLog("fetchMovieBootstrapShared: merged catalogs", { count: merged.catalogs.length }); } catch (e) {}
                finishSuccess(cacheMovieBootstrap(addons[0].baseUrl, merged));
            });
        }, function (err) { try { phimLog("fetchMovieBootstrapShared: config request failed", err && err.message); } catch (e) {} finishFailure(err); });
    }

    function buildMoviePrefetchCatalogQueue(manifest) {
        var grouped = groupMovieCatalogsByType(manifest && Array.isArray(manifest.catalogs) ? manifest.catalogs : []);
        var priority = [];
        var remaining = [];
        var counts = { movie: 0, series: 0 };
        for (var i = 0; i < grouped.length; i++) {
            var catalog = grouped[i];
            if (!catalog || (catalog.type !== "movie" && catalog.type !== "series")) continue;
            if (counts[catalog.type] < MOVIE_PREFETCH_PRIORITY_PER_TYPE) { priority.push(catalog); counts[catalog.type]++; }
            else remaining.push(catalog);
        }
        return priority.concat(remaining);
    }

    function prefetchMovieCatalogQueue(payload) {
        if (!payload || !payload.manifestUrl || !payload.manifest) return;
        var baseUrl = getMovieBaseUrl(payload.manifestUrl);
        var queue = buildMoviePrefetchCatalogQueue(payload.manifest);
        var nextIndex = 0;
        var active = 0;
        var resumeTimer = null;

        function launchMore() {
            if (movieBrowserOpen || movieLaunchInProgress) {
                if (!resumeTimer) resumeTimer = setTimeout(function () { resumeTimer = null; launchMore(); }, 750);
                return;
            }
            while (active < MOVIE_PREFETCH_CONCURRENCY && nextIndex < queue.length) {
                (function (catalog) {
                    var cached = getMovieCatalogCacheEntry(catalog, baseUrl);
                    if (cached && Date.now() - cached.updatedAt <= MOVIE_CATALOG_BACKGROUND_REFRESH_AGE) { launchMore(); return; }
                    active++;
                    fetchMovieCatalogShared(catalog, baseUrl, function () { active--; launchMore(); }, function () { active--; launchMore(); });
                })(queue[nextIndex++]);
            }
        }
        launchMore();
    }

    function startMovieBackgroundPrefetch() {
        if (moviePrefetchStarted || movieBrowserOpen || movieLaunchInProgress) return;
        moviePrefetchStarted = true;
        var cached = getMovieBootstrapCache();
        if (cached) prefetchMovieCatalogQueue(cached);
        fetchMovieBootstrapShared(function (payload) { prefetchMovieCatalogQueue(payload); }, function () {});
    }

    function scheduleMovieBackgroundPrefetch() {
        if (moviePrefetchTimer || moviePrefetchStarted) return;
        moviePrefetchTimer = setTimeout(function () {
            moviePrefetchTimer = null;
            startMovieBackgroundPrefetch();
        }, MOVIE_PREFETCH_DELAY);
    }

    /* =====================================================
       JVHD - màn hình native (Header + Sidebar + Grid + Player dùng chung)
       Website nguồn chỉ được tải bằng XHR để trích xuất media. Redirect khác
       origin, popunder và landing page không bao giờ được đưa lên giao diện.
       ===================================================== */
    function extractJvhdSources(data) {
        var payload = data;
        if (data && data.record && typeof data.record === "object") payload = data.record;
        if (!payload || typeof payload !== "object") return [];
        var sources = [];
        var keys = Object.keys(payload);
        keys.sort(function (a, b) {
            var an = parseInt(String(a).replace(/\D+/g, ""), 10);
            var bn = parseInt(String(b).replace(/\D+/g, ""), 10);
            if (isFinite(an) && isFinite(bn) && an !== bn) return an - bn;
            return String(a).localeCompare(String(b));
        });
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (!/^source/i.test(key)) continue;
            var entry = payload[key];
            if (entry && typeof entry === "object" && typeof entry.url === "string" && isValidMovieTargetUrl(entry.url)) {
                // [BinTV] Giữ lại parse_mode/extractor: LIVE và NEW LIVE là nguồn
                // livestream (extract_stream), cần luồng xử lý riêng thay vì scrape card.
                var jvhdSourceEntry = { name: String(entry.name || ("Nguồn " + (sources.length + 1))), url: entry.url };
                if (typeof entry.parse_mode === "string" && entry.parse_mode) jvhdSourceEntry.parseMode = entry.parse_mode.toLowerCase();
                if (typeof entry.extractor === "string" && entry.extractor) jvhdSourceEntry.extractor = entry.extractor.toLowerCase();
                sources.push(jvhdSourceEntry);
            } else if (typeof entry === "string" && isValidMovieTargetUrl(entry)) {
                sources.push({ name: key, url: entry });
            }
        }
        return sources;
    }

    function requestJvhdText(url, timeout, callback) {
        var xhr = new XMLHttpRequest();
        var finished = false;
        var timer = null;
        function finish(error) {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            var result = null;
            if (!error) {
                var contentType = "";
                try { contentType = xhr.getResponseHeader("Content-Type") || ""; } catch (headerError) {}
                result = {
                    text: xhr.responseText || "",
                    url: xhr.responseURL || url,
                    contentType: contentType,
                    status: xhr.status || 0
                };
            }
            try { callback(error || null, result); } catch (callbackError) {}
        }
        try {
            xhr.open("GET", url, true);
            xhr.timeout = timeout || JVHD_REQUEST_TIMEOUT;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if ((xhr.status >= 200 && xhr.status < 400) || (xhr.status === 0 && xhr.responseText)) finish(null);
                else finish(new Error("HTTP " + xhr.status));
            };
            xhr.onerror = function () { finish(new Error("Network error")); };
            xhr.ontimeout = function () { finish(new Error("Request timeout")); };
            timer = setTimeout(function () { try { xhr.abort(); } catch (abortError) {} finish(new Error("Request timeout")); }, (timeout || JVHD_REQUEST_TIMEOUT) + 500);
            xhr.send();
        } catch (error) { finish(error); }
        return xhr;
    }

    // [BinTV ISP-BYPASS 2026-08] Tải text nguồn CÓ dự phòng qua proxy native:
    // một số nhà mạng (Viettel/Vinaphone/...) chặn truy cập trực tiếp từ
    // WebView tới tên miền người长大 (DNS bị định hướng sai -> request lỗi/
    // rỗng). Thử thẳng trước; nếu lỗi hoặc rỗng và có proxy native thì tải lại
    // qua proxy (MediaProxyServer tự giải quyết DNS an toàn qua DoH + đúng
    // Referer/UA). response.url luôn là URL GỐC để logic origin/relative của
    // caller giữ nguyên 100%.
    function jvhdFetchTextSmart(url, timeout, referer, callback) {
        var active = requestJvhdText(url, timeout, function (error, response) {
            if (!error && response && response.text) { callback(null, response); return; }
            var proxied = jvhdProxiedFetchUrl(url, referer || "");
            if (!proxied) { callback(error || new Error("fetch-failed"), response); return; }
            active = requestJvhdText(proxied, timeout, function (proxyError, proxyResponse) {
                if (proxyError || !proxyResponse || !proxyResponse.text) {
                    callback(proxyError || error || new Error("fetch-failed"), null);
                    return;
                }
                proxyResponse.url = url; // giữ URL gốc cho origin-check + relative
                callback(null, proxyResponse);
            });
        });
        return {
            abort: function () {
                try { if (active && active.abort) active.abort(); } catch (abortError) {}
            }
        };
    }

    function absoluteUrl(base, src) {
        if (!src) return "";
        src = String(src).replace(/^\s+|\s+$/g, "");
        if (!src || /^(?:javascript|data|blob|about):/i.test(src)) return "";
        if (/^https?:\/\//i.test(src)) return src;
        if (src.indexOf("//") === 0) {
            try { var protocolLink = document.createElement("a"); protocolLink.href = base; return (protocolLink.protocol === "http:" ? "http:" : "https:") + src; }
            catch (protocolError) { return "https:" + src; }
        }
        try {
            var a = document.createElement("a");
            a.href = base;
            if (src.charAt(0) === "/") return a.protocol + "//" + a.host + src;
            return a.protocol + "//" + a.host + a.pathname.replace(/[^/]*$/, "") + src;
        } catch (e) { return ""; }
    }

    function jvhdUrlInfo(raw, base) {
        var resolved = absoluteUrl(base || "file:///android_asset/index.html", raw);
        if (!resolved) return null;
        try {
            var a = document.createElement("a");
            a.href = resolved;
            if ((a.protocol !== "http:" && a.protocol !== "https:") || !a.hostname) return null;
            return {
                url: a.href || resolved,
                protocol: String(a.protocol || "").toLowerCase(),
                host: String(a.host || "").toLowerCase(),
                hostname: String(a.hostname || "").toLowerCase(),
                port: String(a.port || ""),
                origin: String(a.protocol || "").toLowerCase() + "//" + String(a.host || "").toLowerCase(),
                pathname: String(a.pathname || "/"),
                search: String(a.search || "")
            };
        } catch (e) { return null; }
    }

    function jvhdNormalizeHostname(hostname) {
        return String(hostname || "").toLowerCase().replace(/^www\./, "");
    }

    function isSameJvhdOrigin(first, second) {
        var a = typeof first === "string" ? jvhdUrlInfo(first, first) : first;
        var b = typeof second === "string" ? jvhdUrlInfo(second, second) : second;
        if (!a || !b) return false;
        return a.protocol === b.protocol && a.port === b.port && jvhdNormalizeHostname(a.hostname) === jvhdNormalizeHostname(b.hostname);
    }

    function decodeJvhdHtml(value) {
        var text = String(value == null ? "" : value);
        try { var area = document.createElement("textarea"); area.innerHTML = text; text = area.value; } catch (e) {}
        return text.replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/\\\//g, "/").replace(/^\s+|\s+$/g, "");
    }

    function decodeJvhdUrlValue(value, base) {
        var decoded = decodeJvhdHtml(value).replace(/^['\"]|['\"]$/g, "");
        if (/^https?%3a/i.test(decoded)) {
            try { decoded = decodeURIComponent(decoded); } catch (decodeError) {}
        }
        return absoluteUrl(base, decoded);
    }

    function isJvhdDirectMediaUrl(url) {
        var info = jvhdUrlInfo(url, url);
        if (!info) return false;
        var target = (info.pathname + info.search).toLowerCase();
        return /\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|ts)(?:$|[/?&#])/.test(target);
    }

    function isJvhdPreviewMediaUrl(url) {
        var lower = String(url || "").toLowerCase();
        return /(?:thumb|thumbnail|sprite|preview|trailer|teaser|flipbook|_fb\.mp4|\/thumbs?[_/.-])/.test(lower);
    }

    function isJvhdAdLikeUrl(url, context) {
        if (isJvhdDirectMediaUrl(url)) return false;
        var text = (String(url || "") + " " + String(context || "")).toLowerCase();
        return /(?:^|[\s._\-\/?&=])(ads?|advert|banner|popunder|popup|clickthrough|promo|campaign|affiliate|landing|interstitial|redirect|tracker|tracking|idzone|zoneid)(?:$|[\s._\-\/?&=])/.test(text) || /[?&]utm_(?:source|medium|campaign|term|content)=/.test(text);
    }

    function collectJvhdCardMeta(anchor, title) {
        var selectors = ".duration,.time,.ribbon,.quality,.video-quality,.views,.view-count,.preview-date,.status,.online,.location";
        var node = anchor;
        var values = [];
        var seen = {};
        for (var depth = 0; node && depth < 5 && values.length < 2; depth++, node = node.parentNode) {
            if (!node.querySelectorAll) continue;
            var parts = node.querySelectorAll(selectors);
            for (var i = 0; i < parts.length && values.length < 2; i++) {
                var value = String(parts[i].textContent || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
                if (!value || value === title || value.length > 80 || seen[value]) continue;
                seen[value] = true;
                values.push(value);
            }
            if (!values.length && node.children) {
                for (var childIndex = 0; childIndex < node.children.length && values.length < 2; childIndex++) {
                    var childText = String(node.children[childIndex].textContent || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
                    if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(childText) && !seen[childText]) { seen[childText] = true; values.push(childText); }
                }
            }
        }
        return values.join(" · ");
    }

    function scrapeJvhdItems(url, html, sourceName) {
        var doc = new DOMParser().parseFromString(html || "", "text/html");
        var sourceInfo = jvhdUrlInfo(url, url);
        var isPrnHubSource = String(sourceName || "").toUpperCase() === "PRN HUB";
        var itemLimit = isPrnHubSource ? 240 : 96;
        var seen = {};
        var items = [];
        var anchors = doc.querySelectorAll("a");
        for (var i = 0; i < anchors.length && items.length < itemLimit; i++) {
            var a = anchors[i];
            var img = a.querySelector("img");
            if (!img) continue;
            // [BinTV PRN-THUMB 2026-08] Thu thập ĐA ứng viên ảnh cho một thẻ (thay
            // vì chỉ lấy 1 URL duy nhất): data-thumb_url/data-image (PRN HUB đặt
            // bản gốc ở đây), data-src/src, và mọi cỡ trong srcset (to trước).
            // Nếu URL đầu bị CDN chặn hotlink (403 không Referer) hoặc hết hạn
            // chữ ký, trình hiển thị sẽ lần lượt thử các bản còn lại, sau đó qua
            // proxy native. Loại bỏ URL video (mediabook .webm/.mp4) và svg/logo.
            var posterCandidates = [];
            var pushJvhdPosterCandidate = function (rawValue) {
                var value = String(rawValue || "").replace(/&amp;/g, "&").replace(/^\s+|\s+$/g, "");
                if (!value || /^data:/i.test(value)) return;
                var absolute = absoluteUrl(url, value);
                if (!absolute) return;
                if (/\.(?:svg)(?:$|[?#])/i.test(absolute)) return;
                if (/\.(?:webm|mp4|m3u8|mpd|ts)(?:$|[?#])/i.test(absolute)) return;
                if (/logo|icon|sprite|blank|placeholder|loading|\/ads?\//i.test(absolute)) return;
                if (posterCandidates.indexOf(absolute) === -1) posterCandidates.push(absolute);
            };
            var posterAttrs = ["data-thumb_url", "data-image", "data-src", "data-original", "data-lazy-src", "data-poster", "src"];
            for (var pa = 0; pa < posterAttrs.length; pa++) pushJvhdPosterCandidate(img.getAttribute(posterAttrs[pa]));
            var srcsetRaw = img.getAttribute("data-srcset") || img.getAttribute("srcset") || "";
            if (srcsetRaw) {
                var srcsetParts = String(srcsetRaw).split(",");
                var srcsetList = [];
                for (var ss = 0; ss < srcsetParts.length; ss++) {
                    var bits = srcsetParts[ss].replace(/^\s+|\s+$/g, "").split(/\s+/);
                    if (bits[0]) srcsetList.push({ url: bits[0], w: parseInt((bits[1] || "").replace(/[wx]$/i, ""), 10) || 0 });
                }
                srcsetList.sort(function (a, b) { return b.w - a.w; });
                for (var sq = 0; sq < srcsetList.length; sq++) pushJvhdPosterCandidate(srcsetList[sq].url);
            }
            var poster = posterCandidates[0] || "";
            if (!poster) continue;
            var link = absoluteUrl(url, a.getAttribute("href") || "");
            var linkInfo = jvhdUrlInfo(link, url);
            if (!linkInfo || !sourceInfo || !isSameJvhdOrigin(linkInfo, sourceInfo)) continue;
            // PRN HUB gắn class popunder lên chính link phim hợp lệ. Chúng ta không
            // thực thi onclick của website, nên chỉ lọc theo URL; nếu lọc theo class
            // sẽ làm mất phần lớn card dù href vẫn thuộc đúng origin nguồn.
            var cardAdContext = isPrnHubSource ? "" : ((a.className || "") + " " + (a.getAttribute("rel") || ""));
            if (isJvhdAdLikeUrl(link, cardAdContext)) continue;
            var title = (img.getAttribute("alt") || a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
            if (!title || title.length < 2) continue;
            if ((linkInfo.pathname === "/" || linkInfo.pathname === sourceInfo.pathname) && /logo|home|trang chủ/i.test(title + " " + (a.className || ""))) continue;
            var key = linkInfo.url;
            if (seen[key]) continue;
            seen[key] = true;
            items.push({
                title: title,
                meta: collectJvhdCardMeta(a, title),
                poster: poster,
                posterFallbacks: posterCandidates.slice(1, 5),
                url: linkInfo.url,
                sourceUrl: sourceInfo.url,
                sourceOrigin: sourceInfo.origin
            });
        }
        return items;
    }

    function ensureJvhdScreen() {
        var screen = document.getElementById("bintv-jvhd-screen");
        if (screen) return screen;
        screen = document.createElement("div");
        screen.id = "bintv-jvhd-screen";
        screen.innerHTML =
            '<div class="jvhd-header"><div class="jvhd-logo">JVHD</div></div>' +
            '<div class="jvhd-body">' +
                '<div id="bintv-jvhd-sidebar" class="jvhd-sidebar"></div>' +
                '<div class="jvhd-content"><div id="bintv-jvhd-grid" class="jvhd-grid"></div></div>' +
            '</div>';
        document.body.appendChild(screen);
        return screen;
    }

    function buildJvhdSidebar() {
        var sb = document.getElementById("bintv-jvhd-sidebar");
        if (!sb) return;
        sb.innerHTML = "";
        for (var i = 0; i < jvhdSources.length; i++) {
            (function (idx) {
                var row = document.createElement("div");
                row.className = "jvhd-source" + (idx === jvhdActiveSource ? " active" : "");
                row.setAttribute("data-s", String(idx));
                row.setAttribute("tabindex", "-1");
                row.textContent = jvhdSources[idx].name;
                row.addEventListener("click", function (e) { e.preventDefault(); jvhdFocusArea = "sidebar"; selectJvhdSource(idx); });
                sb.appendChild(row);
            })(i);
        }
    }

    function currentJvhdItems() { return jvhdAllItems; }

    // [BinTV LIVE-PREVIEW v2 2026-08] Tự làm mới ảnh thẻ LIVE: định kỳ lấy frame
    // MỚI NHẤT chụp từ luồng live. Giống trình duyệt: img.doppiocdn.net/snapshot/
    // {modelId}/{ts} - ts ở quá khứ -> CDN trả frame mới nhất của luồng (ts tương
    // lai sẽ 404 nên luôn dùng now-60). Chỉ đổi src của các <img> đang HIỂN THỊ -
    // không render lại grid, không đụng focus/điều hướng/luồng phát.
    var jvhdLivePosterRefreshTimer = null;

    function stopJvhdLivePosterRefresh() {
        if (jvhdLivePosterRefreshTimer) { clearInterval(jvhdLivePosterRefreshTimer); jvhdLivePosterRefreshTimer = null; }
    }

    function refreshJvhdLivePosters() {
        if (!jvhdScreenOpen || jvhdLoading || moviePlayerOpen || jvhdPlayerSession || jvhdResolveInProgress) return;
        var grid = document.getElementById("bintv-jvhd-grid");
        if (!grid) return;
        var content = document.querySelector("#bintv-jvhd-screen .jvhd-content");
        var viewTop = content ? content.getBoundingClientRect().top : 0;
        var viewBottom = content ? (viewTop + content.clientHeight) : 1000000000;
        var bust = Math.floor(Date.now() / 1000) - 60;
        var imgs = grid.querySelectorAll("img[data-live-refresh]");
        for (var i = 0; i < imgs.length; i++) {
            var posterImg = imgs[i];
            var refreshBase = posterImg.getAttribute("data-live-refresh");
            if (!refreshBase) continue;
            var rect = posterImg.getBoundingClientRect();
            if (rect.bottom < viewTop - 240 || rect.top > viewBottom + 240) continue; // ngoài màn hình -> bỏ qua
            var refreshUrl = /\/$/.test(refreshBase)
                ? (refreshBase + bust)                                           // doppiocdn path: {base}{ts}
                : (refreshBase + (refreshBase.indexOf("?") >= 0 ? "&" : "?") + "v=" + bust); // query buster
            if (posterImg.src === refreshUrl) continue;
            (function (targetImg, nextUrl) {
                var preloader = new Image();
                preloader.onload = function () { targetImg.src = nextUrl; };
                preloader.src = nextUrl;
            })(posterImg, refreshUrl);
        }
    }

    function startJvhdLivePosterRefresh() {
        stopJvhdLivePosterRefresh();
        if (!document.querySelector("#bintv-jvhd-grid img[data-live-refresh]")) return;
        jvhdLivePosterRefreshTimer = setInterval(refreshJvhdLivePosters, 45000);
    }

    function renderJvhdGrid() {
        var grid = document.getElementById("bintv-jvhd-grid");
        if (!grid) return;
        stopJvhdLivePosterRefresh();
        grid.innerHTML = "";
        if (jvhdLoading) {
            grid.innerHTML = '<div class="jvhd-status">Đang tải nội dung ' + (jvhdSources[jvhdActiveSource] ? jvhdSources[jvhdActiveSource].name : "") + '…</div>';
            return;
        }
        var list = currentJvhdItems();
        if (!list.length) {
            grid.innerHTML = '<div class="jvhd-status">Không lấy được nội dung từ nguồn này.<br>Thử nguồn khác (▲▼ ở sidebar).</div>';
            return;
        }
        for (var i = 0; i < list.length; i++) {
            (function (idx) {
                var item = list[idx];
                var card = document.createElement("div");
                card.className = "jvhd-card";
                card.setAttribute("tabindex", "-1");
                card.innerHTML = '<div class="jvhd-card-poster"><img alt="" loading="lazy" /></div><div class="jvhd-card-info"><div class="jvhd-card-name"></div><div class="jvhd-card-meta"></div></div>';
                var img = card.querySelector("img");
                // [BinTV LIVE-PREVIEW 2026-08] Lỗi ảnh -> thử chuỗi dự phòng (thumb nhỏ
                // -> avatar) trước khi mờ ảnh như hành vi cũ.
                // [BinTV PRN-THUMB 2026-08] Bổ sung bước cuối: một số CDN thumbnail
                // (phncdn của PRN HUB) trả 403 khi request không kèm Referer - WebView
                // tải trang từ file:// nên không gửi Referer -> ảnh đen. Khi chuỗi dự
                // phòng cạn, tải lại ảnh QUA PROXY NATIVE (MediaProxyServer tự gắn
                // Referer + UA trình duyệt). Không có bridge (TV/trình duyệt) thì giữ
                // hành vi mờ ảnh như cũ.
                if (item.posterRefreshBase) img.setAttribute("data-live-refresh", item.posterRefreshBase);
                if (item.posterFallbacks && item.posterFallbacks.length) img.setAttribute("data-poster-fallbacks", JSON.stringify(item.posterFallbacks));
                if (item.sourceOrigin) img.setAttribute("data-poster-origin", item.sourceOrigin);
                img.addEventListener("error", function () {
                    var chain = this.getAttribute("data-poster-fallbacks");
                    if (chain) {
                        try {
                            var nextPosters = JSON.parse(chain);
                            if (nextPosters.length) {
                                this.setAttribute("data-poster-fallbacks", JSON.stringify(nextPosters.slice(1)));
                                this.src = nextPosters[0];
                                return;
                            }
                        } catch (posterChainError) {}
                    }
                    if (this.getAttribute("data-poster-proxied") !== "1") {
                        var origin = this.getAttribute("data-poster-origin") || "";
                        var proxied = jvhdProxiedFetchUrl(item.poster, origin);
                        if (proxied) {
                            this.setAttribute("data-poster-proxied", "1");
                            this.src = proxied;
                            return;
                        }
                    }
                    this.style.opacity = "0.25";
                });
                img.src = item.poster;
                card.querySelector(".jvhd-card-name").textContent = item.title;
                var meta = card.querySelector(".jvhd-card-meta");
                if (item.meta) meta.textContent = item.meta; else meta.style.display = "none";
                card.addEventListener("click", function (e) { e.preventDefault(); jvhdGridIndex = idx; jvhdFocusArea = "grid"; openJvhdItem(item); });
                grid.appendChild(card);
            })(i);
        }
        if (jvhdGridIndex >= list.length) jvhdGridIndex = Math.max(0, list.length - 1);
        startJvhdLivePosterRefresh();
    }

    /* =====================================================
       [BinTV] JVHD LIVE - nguồn livestream (parse_mode: extract_stream).
       LIVE (stripchat) và NEW LIVE (chaturbate) khai báo trong cấu hình JVHD
       dạng extract_stream: nội dung là danh sách phòng live + stream HLS nhúng,
       không phải lưới card HTML như VIDEO HD/PRN HUB. Grid, focus, điều hướng
       remote, player và phím BACK dùng lại đúng luồng JVHD hiện có.
       ===================================================== */

    function jvhdIsLiveSource(src) {
        if (!src) return false;
        if (String(src.parseMode || "").toLowerCase() === "extract_stream") return true;
        var liveInfo = jvhdUrlInfo(src.url, src.url);
        var liveHost = liveInfo ? jvhdNormalizeHostname(liveInfo.hostname) : "";
        return liveHost === "stripchat.com" || liveHost.indexOf(".stripchat.com") !== -1 ||
            liveHost === "stripchats.io" || liveHost.indexOf(".stripchats.io") !== -1 ||
            liveHost === "chaturbate.com" || liveHost.indexOf(".chaturbate.com") !== -1;
    }

    /* [BinTV] JVHD LIVE - phát qua hls.js (assets/hls.min.js) khi có thể:
       livestream là LL-HLS/fMP4 (chaturbate dùng EXT-X-PART, stripchat dùng
       master + variant fMP4) mà <video> thuần của WebView không giải mã nổi.
       Chỉ áp dụng cho item live của JVHD; VIDEO HD/PRN HUB/Phim giữ nguyên
       đường phát gốc. Mọi request vẫn đi qua MediaProxyServer (proxy đã
       rewrite URI con, kể cả EXT-X-PART/PREFETCH/MAP). */
    var jvhdHls = null;

    function jvhdCanUseHls() {
        try {
            return !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported());
        } catch (hlsCheckError) { return false; }
    }

    function shouldUseJvhdHls() {
        // [Phim LAN14g 2026-09] Phim thuong: LUON su dung hls.js neu .m3u8
        // (vi Chromium native HLS thuong thieu CORS hoac khong play duoc).
        // - JVHD LIVE: phai dang trong jvhdPlayerSession va item isLive
        // - Phim thuong: chi can jvhdCanUseHls() (hls.js da load)
        if (jvhdPlayerSession) {
            return jvhdCanUseHls() && !!(jvhdSelectedItem && jvhdSelectedItem.isLive);
        }
        // Phim thuong (goi qua startMoviePlayback)
        return jvhdCanUseHls();
    }

    function detachJvhdHls() {
        if (jvhdHls) {
            try { jvhdHls.destroy(); } catch (destroyError) {}
            jvhdHls = null;
        }
    }

    function attachJvhdHls(video, url) {
        detachJvhdHls();
        try { window.__phimDebug && window.__phimDebug.log("[HLS] attachJvhdHls: creating hls.js instance for", String(url).substring(0, 100)); } catch (e) {}
        try { phimLog("attachJvhdHls: start", { url: String(url).substring(0, 100) }); } catch (e) {}
        var hls = new window.Hls({
            enableWorker: false,          // WebView file:// không luôn cho phép Worker
            lowLatencyMode: false,        // Phim thuong khong can low-latency
            backBufferLength: 30,
            maxBufferLength: 60,
            manifestLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 20000,
            fragLoadingTimeOut: 30000,
            fragLoadingMaxRetry: 6
        });
        jvhdHls = hls;
        var recoveredMediaError = false;
        hls.on(window.Hls.Events.ERROR, function (event, data) {
            try { window.__phimDebug && window.__phimDebug.log("[HLS] error", { fatal: data && data.fatal, type: data && data.type, details: data && data.details, error: data && data.error && data.error.message }); } catch (e) {}
            try { phimLog("attachJvhdHls: ERROR", { fatal: data && data.fatal, type: data && data.type, details: data && data.details }); } catch (e) {}
            if (!data || !data.fatal) return;
            var errorType = String(data.type || "");
            if (errorType === String(window.Hls.ErrorTypes.MEDIA_ERROR) && !recoveredMediaError) {
                recoveredMediaError = true;
                try { hls.recoverMediaError(); return; } catch (recoverError) {}
            }
            // Loi nang: xu ly loi playback (se fallback neu co streams khac).
            // Phan biet jvhdPlayerSession (JVHD LIVE) vs phim thuong.
            setTimeout(function () {
                try {
                    if (typeof handleMoviePlaybackError === "function") handleMoviePlaybackError();
                } catch (e) {}
            }, 0);
        });
        hls.on(window.Hls.Events.MANIFEST_PARSED, function (manifestEvent, manifestData) {
            try { window.__phimDebug && window.__phimDebug.log("[HLS] manifest parsed", { levels: manifestData && manifestData.levels && manifestData.levels.length }); } catch (e) {}
            try { phimLog("attachJvhdHls: manifest parsed", { levels: manifestData && manifestData.levels && manifestData.levels.length }); } catch (e) {}
            // Chi xu ly quality levels neu dang la JVHD LIVE session
            if (jvhdPlayerSession && jvhdHls === hls) {
                var levels = (manifestData && manifestData.levels) || hls.levels || [];
                applyJvhdHlsManifestLevels(levels);
            }
        });
        hls.on(window.Hls.Events.LEVEL_LOADED, function (event, data) {
            try { window.__phimDebug && window.__phimDebug.log("[HLS] level loaded", { details: data && data.details, level: data && data.level }); } catch (e) {}
        });
        hls.on(window.Hls.Events.FRAG_LOADED, function (event, data) {
            try { window.__phimDebug && window.__phimDebug.log("[HLS] fragment loaded", { sn: data && data.frag && data.frag.sn, level: data && data.frag && data.frag.level }); } catch (e) {}
        });
        try { hls.loadSource(url); } catch (loadSourceError) {
            try { window.__phimDebug && window.__phimDebug.error("[HLS] loadSource threw", loadSourceError && loadSourceError.message); } catch (e) {}
        }
        try { hls.attachMedia(video); } catch (attachError) {
            try { window.__phimDebug && window.__phimDebug.error("[HLS] attachMedia threw", attachError && attachError.message); } catch (e) {}
        }
    }

    function jvhdLiveExtractor(src) {
        var declared = String((src && src.extractor) || "").toLowerCase();
        if (declared) return declared;
        var info = jvhdUrlInfo(src && src.url, src && src.url);
        var host = info ? jvhdNormalizeHostname(info.hostname) : "";
        if (host.indexOf("chaturbate") !== -1) return "chaturbate";
        if (host.indexOf("stripchat") !== -1) return "stripchat";
        return "";
    }

    // Fetch qua proxy native (MediaProxyServer) - cần cho nguồn có WAF chặn
    // UA TV/Android (stripchat trả 406 khi thấy Accept */* hoặc UA Android/TV).
    function jvhdProxiedFetchUrl(url, referer) {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.proxyMedia === "function") {
                var proxied = String(window.AndroidBridge.proxyMedia(url, referer || "") || "");
                if (/^http:\/\/127\.0\.0\.1:\d+\/jvhd-media\//i.test(proxied)) return proxied;
            }
        } catch (proxyError) {}
        return "";
    }

    // Tải text nguồn live: thử theo thứ tự ưu tiên (proxy hoặc trực tiếp),
    // tự động chuyển cách còn lại nếu cách trước lỗi (406/timeout/mạng).
    // [BinTV FIX 2026-08] Trả về request đang chạy để caller abort được (cancelJvhdResolution).
    // [BinTV LIVE-SPEED 2026-08] Thêm timeoutMs (mặc định giữ nguyên JVHD_REQUEST_TIMEOUT):
    // manifest HLS rất nhỏ -> timeout ngắn giúp failover nhanh thay vì chờ 12s.
    function jvhdLoadLiveText(url, preferProxy, callback, timeoutMs) {
        var attempts = preferProxy ? [true, false] : [false, true];
        var attemptIndex = 0;
        var info = jvhdUrlInfo(url, url);
        var referer = info ? info.origin + "/" : "";
        function nextAttempt() {
            if (attemptIndex >= attempts.length) { callback(new Error("live-load-failed")); return null; }
            var useProxy = attempts[attemptIndex++];
            var fetchUrl = useProxy ? jvhdProxiedFetchUrl(url, referer) : "";
            if (useProxy && !fetchUrl) { return nextAttempt(); }
            return requestJvhdText(fetchUrl || url, timeoutMs || JVHD_REQUEST_TIMEOUT, function (error, response) {
                if (!error && response && response.text) callback(null, response.text);
                else nextAttempt();
            });
        }
        return nextAttempt();
    }

    // Quét JSON cân bằng ngoặc (bỏ qua ngoặc nằm trong chuỗi "..." ).
    function jvhdExtractBalancedJson(text, startIndex) {
        var depth = 0, inString = false, escaped = false;
        for (var i = startIndex; i < text.length; i++) {
            var ch = text.charAt(i);
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === "\"") inString = false;
                continue;
            }
            if (ch === "\"") { inString = true; continue; }
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) return text.substring(startIndex, i + 1);
            }
        }
        return "";
    }

    function jvhdNormalizeStripchatUrl(url) {
        // Miền mirror *.stripchats.io đã bị WAF chặn (406), đổi về *.stripchat.com.
        return String(url || "").replace(/^(https?:\/\/)([^./]+\.)?stripchats\.io\//i, function (all, protocol, sub) {
            return protocol + (sub || "vi.") + "stripchat.com/";
        });
    }

    // Giải mã URL chứa escape kiểu \\u002F / \\/ (trang có thể nhúng JSON 2 lần).
    function jvhdDecodeEscapedUrlValue(value) {
        var text = String(value == null ? "" : value);
        if (text.indexOf("\\") === -1) return text;
        return text.replace(/\\u([0-9a-fA-F]{4})/g, function (all, code) {
            return String.fromCharCode(parseInt(code, 16));
        }).replace(/\\\//g, "/");
    }

    function jvhdExtractStripchatItems(html, pageUrl) {
        var items = [];
        var seen = {};
        var originInfo = jvhdUrlInfo(pageUrl, pageUrl);
        if (!originInfo) return items;
        var text = String(html || "");

        function pushModel(model) {
            if (!model || items.length >= 96) return;
            var username = String(model.username || "").replace(/^\s+|\s+$/g, "");
            var playlist = jvhdDecodeEscapedUrlValue(model.hlsPlaylist);
            if (!username || seen[username] || !/^https?:\/\//.test(playlist)) return;
            if (model.isLive === false || model.isOnline === false) return;
            seen[username] = true;
            // [BinTV LIVE-PREVIEW v2 2026-08] Dùng ĐÚNG hệ thống thumbnail mà
            // trang web dùng khi duyệt bằng trình duyệt: ảnh frame thật chụp từ
            // luồng live tại img.doppiocdn.net/snapshot/{modelId}/{snapshotTimestamp}
            // (modelId + snapshotTimestamp có sẵn trong dữ liệu nguồn; đã kiểm证
            // trên trang thật). Các URL static-proxy.strpst.com/previews... chỉ
            // còn là phương án dự phòng khi snapshot không có.
            var previewSmallUrl = String(model.previewUrlThumbSmall || "");
            var liveAvatarUrl = String(model.avatarUrl || "");
            var liveStamp = String(model.snapshotTimestamp || Math.floor(Date.now() / 1000));
            var modelId = "";
            if (typeof model.id === "number" && model.id > 0) modelId = String(model.id);
            else if (typeof model.streamName !== "undefined" && /^\d+$/.test(String(model.streamName))) modelId = String(model.streamName);
            if (!modelId) modelId = jvhdStripchatModelIdFromUrl(streamUrl || playlist);
            // Base refresh dạng path: {base}{ts}. ts quá khứ -> CDN luôn trả frame
            // MỚI NHẤT của luồng (ts tương lai sẽ 404 nên refresh luôn dùng now-60).
            var doppiocdnSnapshotBase = modelId ? "https://img.doppiocdn.net/snapshot/" + modelId + "/" : "";
            var poster = doppiocdnSnapshotBase ? (doppiocdnSnapshotBase + liveStamp) : (previewSmallUrl || liveAvatarUrl);
            var posterRefreshBase = doppiocdnSnapshotBase;
            var posterFallbacks = [];
            if (previewSmallUrl) posterFallbacks.push(previewSmallUrl);
            if (liveAvatarUrl) posterFallbacks.push(liveAvatarUrl);
            var metaParts = [];
            if (model.isHd) metaParts.push("HD");
            if (typeof model.viewersCount === "number" && model.viewersCount >= 0) metaParts.push(model.viewersCount + " người xem");
            // Playlist gốc thường là <id>_240p.m3u8; đổi sang _auto.m3u8 (adaptive).
            // [BinTV FIX] Giữ nguyên query (psch/pkey - token xác thực của CDN).
            // Trước đây regex nuốt mất query -> request không token, CDN trả về
            // video promo/quảng cáo thay vì luồng live thật.
            var streamUrl = playlist.replace(/_(?:auto|\d+p(?:_blurred)?)(\.m3u8(?:\?[^\s]*)?)$/i, "_auto$1");
            if (!/\.m3u8(?:\?|$)/i.test(streamUrl)) streamUrl = playlist;
            // Fallback theo preset chất lượng mà trang khai báo cho từng model.
            var fallbackUrls = [];
            var presets = Array.isArray(model.presets) ? model.presets : [];
            var qualityPresets = [];
            for (var p = 0; p < presets.length; p++) {
                var preset = String(presets[p] || "");
                if (/^\d+p$/.test(preset) && qualityPresets.indexOf(preset) === -1) qualityPresets.push(preset);
            }
            qualityPresets.sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
            for (var q = 0; q < qualityPresets.length && fallbackUrls.length < 2; q++) {
                var variant = playlist.replace(/_(?:auto|\d+p(?:_blurred)?)(\.m3u8(?:\?[^\s]*)?)$/i, "_" + qualityPresets[q] + "$1");
                if (variant !== streamUrl && fallbackUrls.indexOf(variant) === -1) fallbackUrls.push(variant);
            }
            if (playlist !== streamUrl && fallbackUrls.indexOf(playlist) === -1 && fallbackUrls.length < 3) fallbackUrls.push(playlist);
            var streamFallbacks = [];
            for (var f = 0; f < fallbackUrls.length; f++) streamFallbacks.push({ url: fallbackUrls[f], score: 100 });
            // [BinTV FIX 2026-08] modelId đã tính ở trên (dùng cho cả poster
            // snapshot doppiocdn lẫn dựng master m3u8 theo pkey khi click thẻ).
            items.push({
                title: username,
                meta: metaParts.join(" · "),
                poster: absoluteUrl(pageUrl, String(poster)),
                // [BinTV LIVE-PREVIEW 2026-08] nền tảng làm mới ảnh định kỳ (xem refreshJvhdLivePosters).
                posterRefreshBase: posterRefreshBase ? absoluteUrl(pageUrl, posterRefreshBase) : "",
                posterFallbacks: posterFallbacks.map(function (fallbackUrl) { return absoluteUrl(pageUrl, fallbackUrl); }),
                url: originInfo.origin + "/" + username,
                sourceUrl: pageUrl,
                sourceOrigin: originInfo.origin,
                streamUrl: streamUrl,
                streamFallbacks: streamFallbacks,
                modelId: modelId,
                liveProvider: "stripchat",
                isLive: true
            });
        }

        function walk(node) {
            if (!node || typeof node !== "object" || items.length >= 96) return;
            if (Array.isArray(node)) {
                for (var i = 0; i < node.length; i++) walk(node[i]);
                return;
            }
            if (typeof node.username === "string" && typeof node.hlsPlaylist === "string") pushModel(node);
            var keys = Object.keys(node);
            for (var k = 0; k < keys.length; k++) walk(node[keys[k]]);
        }

        var statePattern = /__PRELOADED_STATE__\s*=\s*\{/g;
        var stateMatch;
        while ((stateMatch = statePattern.exec(text)) && !items.length) {
            var braceAt = stateMatch.index + stateMatch[0].length - 1;
            var blob = jvhdExtractBalancedJson(text, braceAt);
            if (blob) {
                try { walk(JSON.parse(blob)); } catch (parseError) {}
            }
        }
        if (!items.length) {
            // Dự phòng: quét thô cặp username/hlsPlaylist nếu đổi cấu trúc JSON.
            var pattern = /\"username\"\s*:\s*\"([^\"]+)\"[\s\S]{0,2500}?\"hlsPlaylist\"\s*:\s*\"(https?:[^\"]+)\"/g;
            var match;
            while ((match = pattern.exec(text)) && items.length < 96) {
                pushModel({ username: match[1], hlsPlaylist: decodeJvhdUrlValue(match[2], pageUrl), isLive: true });
            }
        }
        return items;
    }

    function jvhdChaturbateApiUrl(src) {
        var info = jvhdUrlInfo(src.url, src.url);
        if (!info) return "";
        var genderMap = { female: "f", male: "m", couple: "c", trans: "t", shemale: "t" };
        var segments = info.pathname.split("/");
        var params = ["limit=90"];
        var keywords = "";
        var genders = "";
        for (var i = 0; i < segments.length; i++) {
            var rawSegment = segments[i];
            if (!rawSegment || rawSegment === "tag") continue;
            var segment = "";
            try { segment = decodeURIComponent(rawSegment).toLowerCase(); } catch (decodeError) { segment = rawSegment.toLowerCase(); }
            if (genderMap[segment]) { genders = genderMap[segment]; continue; }
            if (segment.slice(-5) === "-cams") {
                var keyword = segment.slice(0, -5);
                if (keyword && keyword !== "all" && keyword !== "featured") keywords = keyword;
                continue;
            }
            if (segment === "cams" || segment === "all" || segment === "featured") continue;
            if (!keywords) keywords = segment;
        }
        if (keywords) params.push("keywords=" + encodeURIComponent(keywords));
        if (genders) params.push("genders=" + genders);
        return info.origin + "/api/ts/roomlist/room-list/?" + params.join("&");
    }

    function jvhdExtractChaturbateItems(jsonText, pageUrl) {
        var items = [];
        var originInfo = jvhdUrlInfo(pageUrl, pageUrl);
        if (!originInfo) return items;
        var data = null;
        try { data = JSON.parse(String(jsonText || "")); } catch (parseError) { return items; }
        var rooms = data && Array.isArray(data.rooms) ? data.rooms : null;
        for (var i = 0; rooms && i < rooms.length && items.length < 96; i++) {
            var room = rooms[i];
            if (!room || typeof room.username !== "string" || !room.username) continue;
            if (room.has_password === true) continue;
            var metaParts = [];
            if (typeof room.display_age === "number" && room.display_age > 0) metaParts.push(room.display_age + " tuổi");
            if (typeof room.num_users === "number" && room.num_users >= 0) metaParts.push(room.num_users + " người xem");
            // [BinTV LIVE-PREVIEW 2026-08] roomimg của chaturbate là snapshot từ
            // luồng live, CDN làm mới liên tục -> thêm stamp chống cache + refresh
            // định kỳ cho thẻ (giống LIVE stripchat), không đổi gì khác.
            var cbPosterBase = absoluteUrl(pageUrl, String(room.img || ""));
            var cbRefreshable = /roomimg\.stream\.highwebmedia\.com/i.test(cbPosterBase);
            var cbPoster = cbRefreshable ? (cbPosterBase + (cbPosterBase.indexOf("?") >= 0 ? "&" : "?") + "v=" + Math.floor(Date.now() / 1000)) : cbPosterBase;
            items.push({
                title: room.username,
                meta: metaParts.join(" · "),
                poster: cbPoster,
                posterRefreshBase: cbRefreshable ? cbPosterBase : "",
                posterFallbacks: [],
                url: originInfo.origin + "/" + room.username + "/",
                sourceUrl: pageUrl,
                sourceOrigin: originInfo.origin,
                isLive: true
            });
        }
        return items;
    }

    // Lấy stream HLS trực tiếp từ trang phòng chaturbate (initialRoomDossier).
    function jvhdExtractChaturbateStream(html) {
        var text = String(html || "");
        var dossierMatch = text.match(/window\.initialRoomDossier\s*=\s*("(?:[^"\\]|\\.)*")/);
        if (dossierMatch) {
            try {
                var dossier = JSON.parse(JSON.parse(dossierMatch[1]));
                var stream = dossier ? (dossier.hls_source || dossier.hls_url || dossier.hls) : null;
                if (stream && /^https?:\/\//.test(String(stream))) return String(stream);
            } catch (dossierError) {}
            var decodedDossier = String(dossierMatch[1]).replace(/\\u([0-9a-fA-F]{4})/g, function (all, code) {
                return String.fromCharCode(parseInt(code, 16));
            });
            var streamMatch = decodedDossier.match(/"(?:hls_source|hls_url|hls)"\s*:\s*\\?"([^"\\]+)/);
            if (streamMatch) {
                var manualUrl = streamMatch[1].replace(/\\\//g, "/");
                if (/^https?:\/\//.test(manualUrl)) return manualUrl;
            }
        }
        var direct = text.match(/https?:(?:\\\/\\\/|\/\/)[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/);
        if (direct) {
            var candidate = decodeJvhdUrlValue(direct[0], "https://chaturbate.com/");
            if (candidate && candidate.indexOf(".m3u8") !== -1) return candidate;
        }
        return "";
    }

    /* =====================================================
       [BinTV FIX 2026-08] LIVE (stripchat) - cơ chế bảo vệ mới của CDN "Mouflon"
       (áp dụng từ khoảng 08/2025, khiến mọi bản phát cũ chỉ chạy video promo):

       1. Trang danh sách vẫn nhúng hlsPlaylist nhưng CHỈ LÀ master m3u8 KHÔNG
          token: https://edge-hls.doppiocdn.X/hls/{id}/master/{id}_NNNp.m3u8
       2. Trang phòng (vi.stripchat.com/{username}) KHÔNG còn nhúng hlsPlaylist
          trong __PRELOADED_STATE__ nữa -> cách "resolve token từ trang phòng"
          của bản cũ luôn thất bại và rơi về playlist danh sách đã lỗi thời.
       3. Master luôn trả 200, nhưng các playlist con (media-hls.../{id}_NNNp.m3u8)
          nếu KHÔNG kèm pkey hợp lệ sẽ bị 302 sang /cpa/v2/stream.m3u8 -
          playlist đánh dấu #EXT-X-MOUFLON-ADVERT (video quảng cáo/promo).
          Đây chính là "video giới thiệu" người dùng thấy khi bấm thẻ LIVE.
       4. pkey là khóa công khai nhúng trong player MMP của stripchat
          (img.doppiocdn.com/player/mmp/v{ver}/main.js, hàm
          searchParams.set("pkey","...")). Gọi master kèm ?pkey=... thì CDN tự
          nhúng pkey vào từng variant -> media playlist trả về sạch (không còn
          tag MOUFLON), phát được bằng hls.js chuẩn (HLS fMP4, CORS *).

       Luồng sửa lỗi: click thẻ -> dựng master ?pkey= -> kiểm tra master còn
       "sống" + variant sạch -> phát trực tiếp bằng hls.js. Nếu pkey cũ bị từ
       chối -> tải trang phòng lấy mmpVersion -> tải main.js của player lấy
       pkey mới -> thử lại (cache localStorage 7 ngày).
       ===================================================== */

    var JVHD_STRIPCHAT_PKEY_FALLBACK = "B0p93vi8Uj6AYyZb"; // pkey player MMP v2.12.0 (2026-08)
    var JVHD_STRIPCHAT_PKEY_CACHE_KEY = "bintv_jvhd_sc_pkey_v1";
    var jvhdStripchatPkey = null;

    function jvhdStripchatCachedPkey() {
        if (jvhdStripchatPkey) return jvhdStripchatPkey;
        try {
            var raw = window.localStorage.getItem(JVHD_STRIPCHAT_PKEY_CACHE_KEY);
            if (raw) {
                var entry = JSON.parse(raw);
                if (entry && /^[A-Za-z0-9]{6,64}$/.test(String(entry.pkey || "")) &&
                    Date.now() - (Number(entry.at) || 0) < 604800000) {
                    jvhdStripchatPkey = String(entry.pkey);
                }
            }
        } catch (cacheError) {}
        return jvhdStripchatPkey || JVHD_STRIPCHAT_PKEY_FALLBACK;
    }

    function jvhdStripchatSavePkey(pkey) {
        jvhdStripchatPkey = String(pkey || "");
        if (!jvhdStripchatPkey) return;
        try {
            window.localStorage.setItem(JVHD_STRIPCHAT_PKEY_CACHE_KEY,
                JSON.stringify({ pkey: jvhdStripchatPkey, at: Date.now() }));
        } catch (saveError) {}
    }

    // /hls/{modelId}/master/{modelId}_auto.m3u8 -> modelId
    function jvhdStripchatModelIdFromUrl(url) {
        var match = String(url || "").match(/\/hls\/(\d{4,})\/master\//);
        return match ? match[1] : "";
    }

    function jvhdStripchatEdgeHost(url) {
        var info = jvhdUrlInfo(url, url);
        if (info && /^edge-hls\./.test(info.host)) return info.host;
        return "";
    }

    // Host master ưu tiên theo playlist của trang danh sách + các CDN dự phòng.
    function jvhdStripchatHostList(primary) {
        var hosts = [];
        var candidates = [primary, "edge-hls.doppiocdn.com", "edge-hls.doppiocdn.net", "edge-hls.doppiocdn.org"];
        for (var i = 0; i < candidates.length; i++) {
            var host = String(candidates[i] || "").replace(/\/+$/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
            if (host && hosts.indexOf(host) === -1) hosts.push(host);
        }
        return hosts;
    }

    function jvhdStripchatMasterUrl(host, modelId, pkey) {
        return "https://" + host + "/hls/" + modelId + "/master/" + modelId + "_auto.m3u8?pkey=" + encodeURIComponent(pkey);
    }

    // Master "sống": có biến thể (EXT-X-STREAM-INF) và không phải playlist quảng cáo.
    function jvhdStripchatMasterIsLive(text) {
        var body = String(text || "");
        return body.indexOf("#EXT-X-STREAM-INF") !== -1 &&
            body.indexOf("MOUFLON-ADVERT") === -1 && body.indexOf("/cpa/") === -1;
    }

    // Media playlist sạch = pkey được CDN chấp nhận (không còn tag MOUFLON/ADVERT).
    function jvhdStripchatMediaIsClean(text) {
        var body = String(text || "");
        return body.indexOf("#EXTINF") !== -1 &&
            body.indexOf("MOUFLON") === -1 && body.indexOf("/cpa/") === -1;
    }

    function jvhdStripchatVariantUrls(masterText) {
        var lines = String(masterText || "").split("\n");
        var urls = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^[\s\r\n]+|[\s\r\n]+$/g, "");
            if (/^https?:\/\//i.test(line) && /\.m3u8/i.test(line) && urls.indexOf(line) === -1) urls.push(line);
        }
        return urls;
    }

    // Thông tin player MMP (lấy pkey) từ HTML trang stripchat bất kỳ.
    function jvhdStripchatPlayerInfoFromHtml(html) {
        var text = String(html || "");
        var versionMatch = text.match(/\"mmpVersion\"\s*:\s*\"([^\"]{1,24})\"/);
        var originMatch = text.match(/\"MMPExternalSourceOrigin\"\s*:\s*\"([^\"]{1,160})\"/);
        return {
            version: versionMatch ? versionMatch[1] : "",
            origin: originMatch ? originMatch[1].replace(/\\u002[Ff]/g, "/") : ""
        };
    }

    // id phòng live từ __PRELOADED_STATE__ -> viewCam.model (id | streamName).
    function jvhdStripchatModelIdFromHtml(html) {
        var text = String(html || "");
        var found = "";
        var statePattern = /__PRELOADED_STATE__\s*=\s*\{/g;
        var stateMatch = null;
        var match;
        while ((match = statePattern.exec(text)) && !found) {
            stateMatch = match;
            var braceAt = match.index + match[0].length - 1;
            var blob = jvhdExtractBalancedJson(text, braceAt);
            if (!blob) continue;
            try {
                var data = JSON.parse(blob);
                var viewCam = data && typeof data.viewCam === "object" && data.viewCam ? data.viewCam : null;
                var model = viewCam && typeof viewCam.model === "object" && viewCam.model ? viewCam.model : null;
                if (model) {
                    if (typeof model.id === "number" && model.id > 0) found = String(model.id);
                    else if (typeof model.streamName === "string" && /^\d+$/.test(model.streamName)) found = model.streamName;
                }
            } catch (parseError) {}
        }
        if (!found && stateMatch) {
            var quick = text.substr(stateMatch.index, 40000).match(/\"viewCam\"[\s\S]{0,20000}?\"id\"\s*:\s*(\d{4,})/);
            if (quick) found = quick[1];
        }
        return found;
    }

    // Tải main.js của player MMP và nhổ pkey mới nhất (searchParams.set("pkey","...")).
    function jvhdStripchatFetchPkey(playerInfo, callback) {
        var origin = playerInfo && playerInfo.origin ? playerInfo.origin : "https://img.doppiocdn.com/player/mmp";
        var version = playerInfo && playerInfo.version ? String(playerInfo.version) : "";
        var base = origin.replace(/\/+$/, "") + (version ? "/" + (/^v/i.test(version) ? version : "v" + version) : "");
        jvhdLoadLiveText(base + "/main.js", false, function (error, jsText) {
            if (error || !jsText) { callback(""); return; }
            var match = jsText.match(/searchParams\.set\(\s*[\"']pkey[\"']\s*,\s*[\"']([A-Za-z0-9]{6,64})[\"']\s*\)/);
            if (!match) match = jsText.match(/[\"']pkey[\"']\s*[,=:]\s*[\"']([A-Za-z0-9]{6,64})[\"']/);
            callback(match ? match[1] : "");
        });
    }

    // Resolve livestream stripchat: master?pkey= -> xác nhận variant sạch -> playback.
    // [BinTV LIVE-SPEED 2026-08] Tăng tốc phản hồi khi click thẻ LIVE (logic kiểm
    // tra giữ nguyên 100%: master "sống" + variant sạch + refresh pkey như cũ):
    //  1. Cache master ĐÃ XÁC THỰC theo modelId (TTL 60s) -> click lại phát ngay.
    //  2. Chạy SONG SONG 4 host CDN (host nào trả lời trước dùng host đó) thay vì
    //     thử tuần tự mỗi host 12s -> hết cảnh chờ hàng chục giây khi host đầu chậm.
    //  3. Timeout manifest ngắn (7s) -> failover nhanh.
    //  4. Warm-up nền: ngay khi grid LIVE hiển thị, resolve trước thẻ đầu tiên
    //     (kể cả refresh pkey nếu cần) để tới lúc người dùng click là có sẵn kết quả.
    var JVHD_LIVE_MANIFEST_TIMEOUT = 7000;
    var JVHD_LIVE_MASTER_TTL = 60000;
    var jvhdLiveVerifiedMasters = {};

    function jvhdVerifiedStripchatMaster(modelId) {
        var entry = jvhdLiveVerifiedMasters[modelId];
        if (entry && Date.now() - entry.at < JVHD_LIVE_MASTER_TTL) return entry;
        if (entry) delete jvhdLiveVerifiedMasters[modelId];
        return null;
    }

    function jvhdSaveStripchatVerifiedMaster(modelId, url, alternates) {
        if (!modelId || !url) return;
        jvhdLiveVerifiedMasters[modelId] = { url: url, alternates: Array.isArray(alternates) ? alternates : [], at: Date.now() };
    }

    function jvhdResolveStripchatLive(item, roomHtml, token, onDone, aliveFn) {
        var modelId = String(item && item.modelId ? item.modelId : "") ||
            jvhdStripchatModelIdFromUrl(item ? item.streamUrl : "") ||
            jvhdStripchatModelIdFromHtml(roomHtml);
        if (!modelId) { onDone(null); return; }
        // [BinTV LIVE-SPEED] Đã verify trong 60s qua -> trả ngay không fetch lại.
        var verifiedMaster = jvhdVerifiedStripchatMaster(modelId);
        if (verifiedMaster) {
            onDone({
                main: { url: verifiedMaster.url },
                alternates: verifiedMaster.alternates.slice(0),
                qualities: {},
                isLive: true,
                stripchatDirect: true
            });
            return;
        }
        var hosts = jvhdStripchatHostList(jvhdStripchatEdgeHost(item ? item.streamUrl : ""));
        var triedPkeys = {};

        var alive = aliveFn || function () { return token === jvhdResolveToken && jvhdResolveInProgress; };

        function attemptPkey(pkey, refreshed) {
            if (!alive()) return;
            // [BinTV LIVE-SPEED] Đua song song tất cả host: host trả lời master
            // "sống" trước sẽ được probe variant; các request còn lại bị bỏ qua.
            var finished = 0;
            var won = false;
            var requests = [];
            var tracker = { abort: function () { for (var r = 0; r < requests.length; r++) { try { requests[r].abort(); } catch (abortError) {} } } };
            jvhdResolveRequest = tracker;
            function allFailed() {
                if (!alive()) return;
                if (!refreshed) refreshPkey(pkey);
                else onDone(null);
            }
            for (var hostIndex = 0; hostIndex < hosts.length; hostIndex++) {
                (function (host, index) {
                    var masterUrl = jvhdStripchatMasterUrl(host, modelId, pkey);
                    var req = jvhdLoadLiveText(masterUrl, false, function (error, text) {
                        var pos = requests.indexOf(req);
                        if (pos >= 0) requests.splice(pos, 1);
                        if (!alive() || won) return;
                        finished++;
                        if (!error && jvhdStripchatMasterIsLive(text)) {
                            won = true;
                            // [BinTV LIVE-SPEED] Host này thắng: hủy nốt các request
                            // thua còn đang treo (chúng đã bị bỏ qua bởi cờ `won`).
                            try { tracker.abort(); } catch (killLosersError) {}
                            probeVariant(masterUrl, text, index, pkey, refreshed);
                        } else if (finished >= hosts.length && !won) {
                            allFailed();
                        }
                    }, JVHD_LIVE_MANIFEST_TIMEOUT);
                    if (req) requests.push(req);
                })(hosts[hostIndex], hostIndex);
            }
            if (!requests.length) allFailed();
        }

        function probeVariant(masterUrl, masterText, hostIndex, pkey, refreshed) {
            if (!alive()) return;
            var variants = jvhdStripchatVariantUrls(masterText);
            if (!variants.length) {
                // Master này không có variant dùng được -> pkey có thể hỏng.
                if (!refreshed) refreshPkey(pkey);
                else onDone(null);
                return;
            }
            // Variant cuối = chất lượng thấp nhất (probe rẻ nhất); URL đã tự chứa pkey.
            jvhdResolveRequest = jvhdLoadLiveText(variants[variants.length - 1], false, function (error, text) {
                jvhdResolveRequest = null;
                if (!alive()) return;
                if (!error && jvhdStripchatMediaIsClean(text)) {
                    var alternates = [];
                    for (var h = 0; h < hosts.length && alternates.length < 3; h++) {
                        if (h === hostIndex) continue;
                        alternates.push({ url: jvhdStripchatMasterUrl(hosts[h], modelId, pkey), score: 100 });
                    }
                    // [BinTV LIVE-SPEED] Lưu lại master đã verify (TTL ngắn) cho lần click sau.
                    jvhdSaveStripchatVerifiedMaster(modelId, masterUrl, alternates);
                    onDone({
                        main: { url: masterUrl },
                        alternates: alternates,
                        qualities: {},
                        isLive: true,
                        stripchatDirect: true
                    });
                } else if (!refreshed) {
                    // Playlist bị mã hoá MOUFLON/ADVERT -> pkey không còn hợp lệ.
                    refreshPkey(pkey);
                } else {
                    onDone(null);
                }
            }, JVHD_LIVE_MANIFEST_TIMEOUT);
        }

        function refreshPkey(oldPkey) {
            if (!alive()) return;
            triedPkeys[oldPkey] = true;
            var playerInfo = jvhdStripchatPlayerInfoFromHtml(roomHtml);
            if (playerInfo.version) { fetchPkeyFromPlayer(playerInfo); return; }
            // Chưa có mmpVersion: tải trang phòng (proxy trước, trực tiếp sau).
            var info = jvhdUrlInfo(item.url, item.url);
            var referer = info ? info.origin + "/" : "";
            var proxied = jvhdProxiedFetchUrl(item.url, referer);
            var fetchRoom = function (url) {
                jvhdResolveRequest = requestJvhdText(url, JVHD_REQUEST_TIMEOUT, function (error, response) {
                    jvhdResolveRequest = null;
                    if (!alive()) return;
                    var html = !error && response && response.text ? response.text : "";
                    if (html) {
                        roomHtml = html;
                        var playerInfoFromHtml = {};
                        // Gần như không thể lỗi, nhưng bọc try để một exception parse không
                        // làm chết ngầm chuỗi resolve (callback bị requestJvhdText nuốt).
                        try {
                            var idFromHtml = jvhdStripchatModelIdFromHtml(html);
                            if (idFromHtml && !String(item.modelId || "")) modelId = idFromHtml;
                            playerInfoFromHtml = jvhdStripchatPlayerInfoFromHtml(html);
                        } catch (parseGuardError) {}
                        fetchPkeyFromPlayer(playerInfoFromHtml);
                    } else {
                        onDone(null);
                    }
                });
            };
            if (proxied) fetchRoom(proxied);
            else fetchRoom(item.url);
        }

        function fetchPkeyFromPlayer(playerInfo) {
            if (!alive()) return;
            jvhdStripchatFetchPkey(playerInfo, function (freshPkey) {
                if (!alive()) return;
                if (freshPkey && !triedPkeys[freshPkey]) {
                    jvhdStripchatSavePkey(freshPkey);
                    attemptPkey(freshPkey, true);
                } else {
                    onDone(null);
                }
            });
        }

        attemptPkey(jvhdStripchatCachedPkey(), false);
    }

    // [BinTV LIVE-SPEED 2026-08] Warm-up nền: resolve trước thẻ LIVE đầu tiên ngay
    // khi grid hiển thị (kể cả chuỗi refresh pkey nếu pkey cũ hết hạn) để tới lúc
    // người dùng click, master đã sẵn sàng trong cache -> phát gần như tức thì.
    // Chạy ngầm bằng guard riêng, tự vô hiệu khi người dùng click (không cản trở
    // luồng resolve chính) và khi màn hình JVHD đóng.
    var jvhdLiveWarmSerial = 0;
    var jvhdLiveWarmRunning = false;

    function jvhdWarmStripchatLive(items) {
        if (jvhdLiveWarmRunning || jvhdResolveInProgress || jvhdPlayerSession) return;
        var warmItem = null;
        for (var i = 0; i < (items || []).length; i++) {
            var candidate = items[i];
            if (candidate && candidate.modelId && candidate.streamUrl) { warmItem = candidate; break; }
        }
        if (!warmItem) return;
        jvhdLiveWarmRunning = true;
        var serial = ++jvhdLiveWarmSerial;
        jvhdResolveStripchatLive(warmItem, "", "warm" + serial, function () {
            if (serial === jvhdLiveWarmSerial) jvhdLiveWarmRunning = false;
        }, function () {
            return serial === jvhdLiveWarmSerial && !jvhdResolveInProgress && !jvhdPlayerSession;
        });
        setTimeout(function () { if (serial === jvhdLiveWarmSerial) jvhdLiveWarmRunning = false; }, 25000);
    }

    function resolveJvhdLiveStream(item, token, callback) {
        var info = jvhdUrlInfo(item.url, item.url);
        var referer = info ? info.origin + "/" : "";
        var liveHost = info ? jvhdNormalizeHostname(info.hostname) : "";
        var isStripchatRoom = liveHost.indexOf("stripchat") !== -1;
        // [BinTV FIX 2026-08] LIVE (stripchat): trang phòng không còn nhúng hlsPlaylist;
        // dựng master m3u8 kèm pkey của CDN Mouflon và xác nhận playlist sạch
        // trước khi phát (xem khối [BinTV FIX 2026-08] phía trên để biết chi tiết).
        if (isStripchatRoom) {
            jvhdResolveStripchatLive(item, "", token, function (playback) {
                if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
                if (playback && playback.main && playback.main.url) callback(null, playback);
                else callback(new Error("live-no-stream"), null);
            });
            return;
        }
        function buildPlayback(text) {
            var streamUrl = jvhdExtractChaturbateStream(text);
            return streamUrl ? { main: { url: streamUrl }, alternates: [], qualities: {}, isLive: true } : null;
        }
        function attempt(useProxy) {
            var fetchUrl = useProxy ? jvhdProxiedFetchUrl(item.url, referer) : "";
            if (useProxy && !fetchUrl) { callback(new Error("live-resolve-failed")); return; }
            jvhdResolveRequest = requestJvhdText(fetchUrl || item.url, JVHD_REQUEST_TIMEOUT, function (error, response) {
                jvhdResolveRequest = null;
                if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
                if (error || !response) {
                    if (!useProxy) { attempt(true); return; }
                    callback(new Error("live-resolve-failed"));
                    return;
                }
                var playback = buildPlayback(response.text || "");
                if (playback) callback(null, playback);
                else if (!useProxy) attempt(true);
                else callback(new Error("live-no-stream"));
            });
        }
        attempt(false);
    }

    // [BinTV LIVE-MORE 2026-08] Trang danh sách LIVE (stripchat) chỉ nhúng ~37
    // model đầu trong __PRELOADED_STATE__ trong khi trang web còn nhiều hơn
    // (filteredCount tới hàng trăm). Sau khi grid đầu tiên hiển thị, gọi nền
    // đúng API mà trang web dùng (/api/front/v2/models?primaryTag=girls&
    // requestPath=<danh sách>&limit=60) rồi GỘP các model còn thiếu vào grid:
    // - model API không có hlsPlaylist nhưng có id/streamName -> dựng master
    //   URL đúng như resolver vẫn làm (pkey được gắn khi click), nên phát bình
    //   thường; poster vẫn dùng đúng cơ chế snapshot doppiocdn của trang web.
    // - Bỏ qua mọi lỗi (404/JSON đổi dạng...) một cách im lặng: grid SSR gốc
    //   đã hiển thị, đây chỉ là "thêm nội dung" không bắt buộc.
    function jvhdBoostStripchatList(src, fetchUrl, loadToken, index) {
        if (!jvhdAllItems.length || jvhdAllItems.length >= 96) return;
        var info = jvhdUrlInfo(fetchUrl, fetchUrl);
        if (!info) return;
        var requestPath = (info.pathname || "/").replace(/\/+$/, "") || "/";
        var apiUrl = info.origin + "/api/front/v2/models?primaryTag=girls&requestPath=" +
            encodeURIComponent(requestPath) + "&limit=60&offset=0";
        jvhdLoadLiveText(apiUrl, true, function (error, text) {
            if (loadToken !== jvhdSourceLoadToken || index !== jvhdActiveSource) return;
            if (error || !text) return;
            var data;
            try { data = JSON.parse(text); } catch (boostParseError) { return; }
            var blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
            var blockUrl = requestPath.replace(/^\//, "");
            var block = null;
            for (var b = 0; b < blocks.length; b++) {
                if (String(blocks[b].url || "").replace(/^\//, "") === blockUrl) { block = blocks[b]; break; }
            }
            var models = block && Array.isArray(block.models) ? block.models : [];
            if (!models.length) return;
            var known = {};
            for (var k = 0; k < jvhdAllItems.length; k++) known[String(jvhdAllItems[k].title || "").toLowerCase()] = true;
            var added = 0;
            for (var m = 0; m < models.length && jvhdAllItems.length < 96; m++) {
                var model = models[m];
                if (!model || typeof model.username !== "string") continue;
                if (model.isLive === false || model.isOnline === false || String(model.status || "").toLowerCase() === "off") continue;
                var username = model.username.replace(/^\s+|\s+$/g, "");
                if (!username || known[username.toLowerCase()]) continue;
                known[username.toLowerCase()] = true;
                var modelId = "";
                if (typeof model.id === "number" && model.id > 0) modelId = String(model.id);
                else if (typeof model.streamName !== "undefined" && /^\d+$/.test(String(model.streamName))) modelId = String(model.streamName);
                if (!modelId) continue;
                var liveStamp = String(model.snapshotTimestamp || Math.floor(Date.now() / 1000));
                var snapshotBase = "https://img.doppiocdn.net/snapshot/" + modelId + "/";
                var previewSmall = String(model.previewUrlThumbSmall || "");
                var avatarUrl = String(model.avatarUrl || "");
                var posterFallbacks = [];
                if (previewSmall) posterFallbacks.push(absoluteUrl(fetchUrl, previewSmall));
                if (avatarUrl) posterFallbacks.push(absoluteUrl(fetchUrl, avatarUrl));
                var metaParts = [];
                if (model.isHd) metaParts.push("HD");
                if (typeof model.viewersCount === "number" && model.viewersCount >= 0) metaParts.push(model.viewersCount + " người xem");
                jvhdAllItems.push({
                    title: username,
                    meta: metaParts.join(" · "),
                    poster: absoluteUrl(fetchUrl, snapshotBase + liveStamp),
                    posterRefreshBase: absoluteUrl(fetchUrl, snapshotBase),
                    posterFallbacks: posterFallbacks,
                    url: info.origin + "/" + username,
                    sourceUrl: fetchUrl,
                    sourceOrigin: info.origin,
                    streamUrl: "https://edge-hls.doppiocdn.media/hls/" + modelId + "/master/" + modelId + "_auto.m3u8",
                    streamFallbacks: [],
                    modelId: modelId,
                    liveProvider: "stripchat",
                    isLive: true
                });
                added++;
            }
            if (added && jvhdScreenOpen && !jvhdLoading) { renderJvhdGrid(); updateJvhdFocus(); }
        });
    }

    function loadJvhdLiveSource(src, loadToken, index) {
        var extractor = jvhdLiveExtractor(src);
        var fetchUrl = src.url;
        if (extractor === "stripchat") fetchUrl = jvhdNormalizeStripchatUrl(src.url);
        else if (extractor === "chaturbate") fetchUrl = jvhdChaturbateApiUrl(src) || src.url;
        jvhdLoadLiveText(fetchUrl, extractor === "stripchat", function (error, text) {
            if (loadToken !== jvhdSourceLoadToken || index !== jvhdActiveSource) return;
            jvhdAllItems = [];
            if (!error && text) {
                src.effectiveUrl = fetchUrl;
                if (extractor === "chaturbate") jvhdAllItems = jvhdExtractChaturbateItems(text, fetchUrl);
                else if (extractor === "stripchat") jvhdAllItems = jvhdExtractStripchatItems(text, fetchUrl);
            }
            jvhdLoading = false;
            if (jvhdScreenOpen) { renderJvhdGrid(); updateJvhdFocus(); }
            // [BinTV LIVE-SPEED 2026-08] LIVE (stripchat): warm-up ngầm thẻ đầu
            // tiên ngay khi grid hiện - pkey/master/probe sẵn sàng trước khi click.
            if (extractor === "stripchat" && jvhdAllItems.length) jvhdWarmStripchatLive(jvhdAllItems);
            // [BinTV LIVE-MORE 2026-08] Gộp thêm model từ API phân trang của
            // trang web (grid đã hiển thị sẵn, việc này chạy nền và im lặng).
            if (extractor === "stripchat" && jvhdAllItems.length) jvhdBoostStripchatList(src, fetchUrl, loadToken, index);
        });
    }

    function selectJvhdSource(index) {
        if (index < 0 || index >= jvhdSources.length) return;
        cancelJvhdResolution(false);
        jvhdActiveSource = index;
        jvhdGridIndex = 0;
        var rows = document.querySelectorAll("#bintv-jvhd-sidebar .jvhd-source");
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("active", i === index);
        jvhdLoading = true;
        renderJvhdGrid();
        updateJvhdFocus();
        var src = jvhdSources[index];
        var loadToken = ++jvhdSourceLoadToken;
        // [BinTV] LIVE / NEW LIVE (extract_stream): dùng luồng tải livestream riêng,
        // các nguồn card HTML (VIDEO HD, PRN HUB, NEW VIDEO) giữ nguyên luồng cũ.
        if (jvhdIsLiveSource(src)) {
            loadJvhdLiveSource(src, loadToken, index);
            return;
        }
        // [BinTV ISP-BYPASS 2026-08] Nguồn card HTML (VIDEO HD, PRN HUB, NEW
        // VIDEO): tải có dự phòng qua proxy native khi nhà mạng chặn truy cập
        // trực tiếp (Viettel/Vina...). Logic scrape/origin giữ nguyên.
        var sourceFetchInfo = jvhdUrlInfo(src.url, src.url);
        var sourceReferer = sourceFetchInfo ? sourceFetchInfo.origin + "/" : "";
        jvhdFetchTextSmart(src.url, JVHD_REQUEST_TIMEOUT, sourceReferer, function (error, response) {
            if (loadToken !== jvhdSourceLoadToken || index !== jvhdActiveSource) return;
            jvhdAllItems = [];
            if (!error && response) {
                var requestedInfo = jvhdUrlInfo(src.url, src.url);
                var finalInfo = jvhdUrlInfo(response.url, src.url);
                if (requestedInfo && finalInfo && isSameJvhdOrigin(requestedInfo, finalInfo)) {
                    src.effectiveUrl = finalInfo.url;
                    jvhdAllItems = scrapeJvhdItems(finalInfo.url, response.text, src.name);
                }
            }
            jvhdLoading = false;
            if (jvhdScreenOpen) { renderJvhdGrid(); updateJvhdFocus(); }
        });
    }

    function jvhdGridColumns() {
        var grid = document.getElementById("bintv-jvhd-grid");
        if (!grid) return 5;
        var card = grid.querySelector(".jvhd-card");
        if (!card) return 5;
        var cw = card.getBoundingClientRect().width || 260;
        var gap = 16;
        return Math.max(1, Math.floor((grid.clientWidth + gap) / (cw + gap)));
    }

    function updateJvhdFocus() {
        var sb = document.getElementById("bintv-jvhd-sidebar");
        if (sb) {
            var srows = sb.querySelectorAll(".jvhd-source");
            for (var i = 0; i < srows.length; i++) srows[i].classList.toggle("focus", jvhdFocusArea === "sidebar" && i === jvhdActiveSource);
            if (jvhdFocusArea === "sidebar" && srows[jvhdActiveSource] && !moviePlayerOpen) try { srows[jvhdActiveSource].focus(); } catch (sidebarFocusError) {}
        }
        var grid = document.getElementById("bintv-jvhd-grid");
        if (grid) {
            var cards = grid.querySelectorAll(".jvhd-card");
            for (var k = 0; k < cards.length; k++) cards[k].classList.toggle("focus", jvhdFocusArea === "grid" && k === jvhdGridIndex);
            var focusedCard = cards[jvhdGridIndex];
            if (focusedCard && jvhdFocusArea === "grid" && !moviePlayerOpen) {
                try { focusedCard.focus(); } catch (cardFocusError) {}
                try { focusedCard.scrollIntoView({ block: "nearest" }); } catch (scrollError) { try { focusedCard.scrollIntoView(false); } catch (ignoredScrollError) {} }
            }
        }
    }

    function addJvhdMediaCandidate(result, value, base, score, context) {
        var url = decodeJvhdUrlValue(value, base);
        if (!url || !isJvhdDirectMediaUrl(url)) return;
        var explicit = score >= 130;
        if (!explicit && isJvhdPreviewMediaUrl(url)) return;
        var lower = String(url).toLowerCase();
        var adjusted = score || 0;
        if (/\.mp4(?:$|[?&#])/.test(lower)) adjusted += 8;
        if (/\.m3u8(?:$|[?&#])/.test(lower)) adjusted += 6;
        if (/(?:^|[^0-9])720p?(?:[^0-9]|$)/.test(lower + " " + context)) adjusted += 24;
        else if (/(?:^|[^0-9])1080p?(?:[^0-9]|$)/.test(lower + " " + context)) adjusted += 20;
        else if (/(?:^|[^0-9])480p?(?:[^0-9]|$)/.test(lower + " " + context)) adjusted += 12;
        else if (/(?:^|[^0-9])240p?(?:[^0-9]|$)/.test(lower + " " + context)) adjusted -= 8;
        if (isJvhdPreviewMediaUrl(url)) adjusted -= 70;
        for (var i = 0; i < result.media.length; i++) {
            if (result.media[i].url === url) { if (adjusted > result.media[i].score) result.media[i].score = adjusted; return; }
        }
        result.media.push({ url: url, score: adjusted, order: result.media.length });
    }

    function addJvhdPageCandidate(result, value, base, sourceOrigin, context) {
        var url = decodeJvhdUrlValue(value, base);
        var info = jvhdUrlInfo(url, base);
        if (!info || isJvhdDirectMediaUrl(info.url) || isJvhdAdLikeUrl(info.url, context)) return;
        var sameOrigin = isSameJvhdOrigin(info, sourceOrigin);
        var playerContext = /player|embed|video|stream|watch|playback/i.test(String(context || "") + " " + info.pathname);
        if (!sameOrigin && !playerContext) return;
        for (var i = 0; i < result.pages.length; i++) if (result.pages[i].url === info.url) return;
        result.pages.push({ url: info.url, expectedOrigin: info.origin, trustedPlayer: !sameOrigin });
    }

    function addJvhdVastCandidate(result, value, base) {
        var url = decodeJvhdUrlValue(value, base);
        var info = jvhdUrlInfo(url, base);
        if (!info || !/\.xml(?:$|[?&#])/i.test(info.pathname + info.search)) return;
        for (var i = 0; i < result.vast.length; i++) if (result.vast[i] === info.url) return;
        result.vast.push(info.url);
    }

    function extractJvhdPageData(base, html, sourceOrigin) {
        var result = { media: [], pages: [], vast: [] };
        var text = String(html || "");
        var normalized = decodeJvhdHtml(text);
        var doc = new DOMParser().parseFromString(text, "text/html");
        var mediaNodes = doc.querySelectorAll("video[src],audio[src],source[src]");
        for (var i = 0; i < mediaNodes.length; i++) addJvhdMediaCandidate(result, mediaNodes[i].getAttribute("src"), base, 165, mediaNodes[i].outerHTML || "");
        var dataMediaNodes = doc.querySelectorAll("[data-video-url],[data-video-src],[data-stream-url],[data-hls],[data-file]");
        var dataAttrs = ["data-video-url", "data-video-src", "data-stream-url", "data-hls", "data-file"];
        for (var d = 0; d < dataMediaNodes.length; d++) {
            for (var da = 0; da < dataAttrs.length; da++) {
                var dataValue = dataMediaNodes[d].getAttribute(dataAttrs[da]);
                if (dataValue) addJvhdMediaCandidate(result, dataValue, base, 155, dataAttrs[da]);
            }
        }
        var metas = doc.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"],link[rel="preload"][as="video"]');
        for (var m = 0; m < metas.length; m++) addJvhdMediaCandidate(result, metas[m].getAttribute("content") || metas[m].getAttribute("href"), base, 158, metas[m].outerHTML || "");

        var atobPattern = /(?:window\.)?atob\(\s*["']([A-Za-z0-9+/_=-]{12,})["']\s*\)/gi;
        var atobMatch;
        while ((atobMatch = atobPattern.exec(normalized))) {
            try { addJvhdMediaCandidate(result, window.atob(atobMatch[1]), base, 160, "atob source"); } catch (atobError) {}
        }
        var namedPattern = /(?:videoUrl|video_url|streamUrl|stream_url|hlsUrl|hls_url|file|source)\s*["']?\s*[:=]\s*["']([^"']+)["']/gi;
        var namedMatch;
        while ((namedMatch = namedPattern.exec(normalized))) addJvhdMediaCandidate(result, namedMatch[1], base, 145, namedMatch[0]);
        var absoluteMediaPattern = /((?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|ts)(?:\?[^\s"'<>\\]*)?)/gi;
        var absoluteMatch;
        while ((absoluteMatch = absoluteMediaPattern.exec(normalized))) addJvhdMediaCandidate(result, absoluteMatch[1], base, 95, normalized.slice(Math.max(0, absoluteMatch.index - 80), absoluteMatch.index + absoluteMatch[0].length + 80));
        var relativeMediaPattern = /["']((?:\.\.\/|\.\/|\/)[^"']+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|ts)(?:\?[^"']*)?)["']/gi;
        var relativeMatch;
        while ((relativeMatch = relativeMediaPattern.exec(normalized))) addJvhdMediaCandidate(result, relativeMatch[1], base, 110, relativeMatch[0]);

        var frames = doc.querySelectorAll("iframe");
        var frameAttrs = ["src", "data-src", "data-litespeed-src", "data-original-src"];
        for (var f = 0; f < frames.length; f++) {
            var context = (frames[f].getAttribute("title") || "") + " " + (frames[f].id || "") + " " + (frames[f].className || "");
            if (frames[f].parentNode) context += " " + (frames[f].parentNode.className || "");
            for (var fa = 0; fa < frameAttrs.length; fa++) {
                var frameValue = frames[f].getAttribute(frameAttrs[fa]);
                if (frameValue && !/^about:blank$/i.test(frameValue)) addJvhdPageCandidate(result, frameValue, base, sourceOrigin, context);
            }
        }

        var vastPattern = /(?:vast(?:Tag)?(?:Url)?|adTag|tag)\s*["']?\s*[:=]\s*["']([^"']+\.xml(?:\?[^"']*)?)["']/gi;
        var vastMatch;
        while ((vastMatch = vastPattern.exec(normalized))) addJvhdVastCandidate(result, vastMatch[1], base);
        result.media.sort(function (a, b) { return (b.score - a.score) || ((a.order || 0) - (b.order || 0)); });
        return result;
    }

    function parseJvhdClock(value) {
        var text = String(value || "").replace(/^\s+|\s+$/g, "");
        var parts = text.split(":");
        if (parts.length !== 3) return 0;
        var seconds = (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
        return Math.max(0, Math.round(seconds * 1000));
    }

    function parseJvhdVast(xmlText, base) {
        var doc;
        try { doc = new DOMParser().parseFromString(xmlText || "", "application/xml"); } catch (e) { return null; }
        if (!doc || !doc.querySelector || !doc.querySelector("VAST, vast")) return null;
        var linear = doc.querySelector("Linear, linear");
        var durationMs = parseJvhdClock(linear ? (linear.querySelector("Duration, duration") || {}).textContent : "");
        var skipMs = 0;
        if (linear) {
            var skip = linear.getAttribute("skipoffset") || "";
            if (/%$/.test(skip) && durationMs > 0) skipMs = Math.round(durationMs * (parseFloat(skip) || 0) / 100);
            else skipMs = parseJvhdClock(skip);
        }
        var mediaResult = { media: [] };
        var mediaFiles = doc.querySelectorAll("MediaFile, mediafile");
        for (var i = 0; i < mediaFiles.length; i++) {
            var mediaText = String(mediaFiles[i].textContent || "").replace(/^\s+|\s+$/g, "");
            var width = parseInt(mediaFiles[i].getAttribute("width") || "0", 10) || 0;
            var score = 120 + (width >= 1280 && width <= 1920 ? 20 : 0);
            addJvhdMediaCandidate(mediaResult, mediaText, base, score, mediaFiles[i].getAttribute("type") || "");
        }
        mediaResult.media.sort(function (a, b) { return b.score - a.score; });
        var wrapper = doc.querySelector("VASTAdTagURI, vastadtaguri");
        return {
            mediaUrl: mediaResult.media.length ? mediaResult.media[0].url : "",
            wrapperUrl: wrapper ? decodeJvhdUrlValue(wrapper.textContent || "", base) : "",
            maxDurationMs: skipMs > 0 ? skipMs : (durationMs > 0 ? durationMs : 30000)
        };
    }

    function resolveJvhdVast(vastUrls, token, deadline, callback) {
        var queue = vastUrls.slice(0, 4);
        var visited = {};
        function next() {
            if (token !== jvhdResolveToken || !jvhdResolveInProgress || Date.now() >= deadline || !queue.length) { callback(null); return; }
            var url = queue.shift();
            if (!url || visited[url]) { next(); return; }
            visited[url] = true;
            var remaining = Math.max(1000, Math.min(7000, deadline - Date.now()));
            jvhdResolveRequest = requestJvhdText(url, remaining, function (error, response) {
                jvhdResolveRequest = null;
                if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
                if (error || !response || !/<\s*VAST\b/i.test(response.text)) { next(); return; }
                var parsed = parseJvhdVast(response.text, response.url || url);
                if (!parsed) { next(); return; }
                if (parsed.mediaUrl) { callback({ url: parsed.mediaUrl, isAd: true, maxDurationMs: parsed.maxDurationMs }); return; }
                if (parsed.wrapperUrl && !visited[parsed.wrapperUrl]) queue.unshift(parsed.wrapperUrl);
                next();
            });
        }
        next();
    }

    function getJvhdMediaFamilyKey(url) {
        var value = String(url || "");
        var match = value.match(/\/videos\/(?:\d{6}\/\d{2}\/)?(\d{6,})\//i);
        if (!match) match = value.match(/_(\d{6,})\.(?:mp4|m3u8)(?:$|[/?&#])/i);
        return match ? match[1] : "";
    }

    // [BinTV QUALITY 2026-08] Nhan dien chieu cao (height) thuc te duoc ghi trong
    // URL/text nguon, vi du "-720.m3u8", "/1080p/", "_480.m3u8"... Tra ve 0 neu
    // khong tim thay height hop le. Khong tao quality moi - chi nhan dien cac
    // gia tri chuuan ma nguon tu ghi (240/360/480/576/720/1080/1440/2160 hoac
    // bat ky <so>p nao do).
    var jvhdKnownHeightValues = { 144: 1, 240: 1, 360: 1, 480: 1, 576: 1, 720: 1, 1080: 1, 1440: 1, 2160: 1 };
    function jvhdHeightTokenFromText(value) {
        var pathOnly = String(value || "").split("#")[0].split("?")[0];
        var re = /\d{3,4}/g;
        var match = null;
        var best = 0;
        while ((match = re.exec(pathOnly))) {
            var before = match.index > 0 ? pathOnly.charAt(match.index - 1) : "";
            var after = pathOnly.charAt(match.index + match[0].length);
            if (/\d/.test(before) || /\d/.test(after)) continue; // nam giua chuoi so dai -> bo qua
            var height = parseInt(match[0], 10);
            var pSuffix = after === "p" || after === "P";
            if (height < 144 || height > 2160) continue;
            if (!pSuffix && !jvhdKnownHeightValues[height]) continue;
            if (height > best) best = height;
        }
        return best;
    }

    // [BinTV QUALITY 2026-08] Du doan height tu bitrate khi manifest khong ghi
    // RESOLUTION (chi dung khi khong co RESOLUTION va khong co token trong URL).
    function jvhdEstimateHeightFromBitrate(bitrate) {
        var bits = Number(bitrate) || 0;
        if (bits <= 0) return 0;
        if (bits >= 8000000) return 2160;
        if (bits >= 4000000) return 1440;
        if (bits >= 1900000) return 1080;
        if (bits >= 900000) return 720;
        if (bits >= 550000) return 480;
        if (bits >= 320000) return 360;
        return 240;
    }

    function selectJvhdMediaOptions(media, source) {
        var list = Array.isArray(media) ? media : [];
        if (!list.length) return { main: null, alternates: [], qualities: {} };
        var primary = list[0];
        var alternates = [];
        var qualities = {};
        var sourceName = String(source && source.name || "").toUpperCase();

        function addAlternate(candidate) {
            if (!candidate || candidate.url === primary.url) return;
            for (var a = 0; a < alternates.length; a++) if (alternates[a].url === candidate.url) return;
            alternates.push(candidate);
        }

        if (sourceName === "VIDEO HD") {
            var videoHdMaster = primary;
            var preferredVideoHd720 = null;
            var preferredVideoHd1080 = null;
            // [BinTV QUALITY 2026-08] Nhan dien moi variant m3u8 that cua nguon
            // (240/360/480/720/1080/1440/2160...) de hien day du cac muc chat luong.
            for (var videoHdIndex = 0; videoHdIndex < list.length; videoHdIndex++) {
                var videoHdUrl = list[videoHdIndex].url;
                if (!/\.m3u8(?:$|[?&#])/i.test(videoHdUrl)) continue;
                var videoHdHeight = jvhdHeightTokenFromText(videoHdUrl);
                if (videoHdHeight && !qualities[String(videoHdHeight)]) qualities[String(videoHdHeight)] = videoHdUrl;
                if (!preferredVideoHd720 && videoHdHeight === 720) preferredVideoHd720 = list[videoHdIndex];
                if (!preferredVideoHd1080 && videoHdHeight === 1080) preferredVideoHd1080 = list[videoHdIndex];
            }
            if (/-playlist\.m3u8(?:$|[?&#])/i.test(videoHdMaster.url)) {
                // [BinTV QUALITY 2026-08] Van giu fallback gon -720/-1080 nhu phien
                // ban truoc (chi dung khi scrape khong thay URL that; manifest that
                // se ghi de danh sach nay qua refreshJvhdStreamQualitiesFromManifest).
                if (!qualities["720"]) qualities["720"] = videoHdMaster.url.replace(/-playlist(\.m3u8(?:[?&#].*)?)$/i, "-720$1");
                if (!qualities["1080"]) qualities["1080"] = videoHdMaster.url.replace(/-playlist(\.m3u8(?:[?&#].*)?)$/i, "-1080$1");
            }
            if (!preferredVideoHd720 && qualities["720"]) preferredVideoHd720 = { url: qualities["720"], score: videoHdMaster.score + 1, order: videoHdMaster.order };
            if (!preferredVideoHd1080 && qualities["1080"]) preferredVideoHd1080 = { url: qualities["1080"], score: videoHdMaster.score + 1, order: videoHdMaster.order };
            if (preferredVideoHd720) {
                primary = preferredVideoHd720;
            }
            return { main: primary, alternates: alternates, qualities: qualities };
        }

        if (sourceName !== "PRN HUB") return { main: primary, alternates: alternates, qualities: qualities };

        var family = getJvhdMediaFamilyKey(primary.url);
        var preferred720 = null;
        var preferred1080 = null;
        for (var i = 0; i < list.length; i++) {
            var candidate = list[i];
            var candidateFamily = getJvhdMediaFamilyKey(candidate.url);
            var sameFamily = !family || !candidateFamily || candidateFamily === family;
            if (!sameFamily || !/\.m3u8(?:$|[?&#])/i.test(candidate.url)) continue;
            // [BinTV QUALITY 2026-08] Nhan moi height that trong cung family video
            // (khong gioi han 720/1080 nhu truoc).
            var candidateHeight = jvhdHeightTokenFromText(candidate.url);
            if (candidateHeight && !qualities[String(candidateHeight)]) qualities[String(candidateHeight)] = candidate.url;
            if (!preferred720 && candidateHeight === 720) preferred720 = candidate;
            if (!preferred1080 && candidateHeight === 1080) preferred1080 = candidate;
        }
        if (preferred720) {
            primary = preferred720;
        }

        // Fallback vẫn chỉ lấy URL 720p của đúng video. 1080p là lựa chọn
        // chủ động của người dùng từ timeline, không phải fallback tự động.
        for (var j = 0; j < list.length && alternates.length < 3; j++) {
            var option = list[j];
            var optionFamily = getJvhdMediaFamilyKey(option.url);
            if (family && optionFamily && optionFamily !== family) continue;
            if (/(?:^|[^0-9])720p?(?:[^0-9]|$)/i.test(option.url) && /\.m3u8(?:$|[?&#])/i.test(option.url)) addAlternate(option);
        }
        return { main: primary, alternates: alternates, qualities: qualities };
    }

    function resolveJvhdPlayback(item, source, token, callback) {
        var sourceUrl = source && (source.effectiveUrl || source.url) ? (source.effectiveUrl || source.url) : item.sourceUrl;
        var sourceInfo = jvhdUrlInfo(sourceUrl, sourceUrl);
        var itemInfo = jvhdUrlInfo(item.url, sourceUrl);
        if (!sourceInfo || !itemInfo || !isSameJvhdOrigin(sourceInfo, itemInfo)) { callback(new Error("Blocked target origin")); return; }
        var deadline = Date.now() + JVHD_RESOLVE_TIMEOUT;
        var state = {
            queue: [{ url: itemInfo.url, expectedOrigin: itemInfo.origin, trustedPlayer: false }],
            visited: {},
            pages: 0,
            vast: []
        };
        function failOrContinue() {
            if (state.queue.length && state.pages < JVHD_MAX_RESOLVE_PAGES && Date.now() < deadline) processNext();
            else callback(new Error("No playable media"));
        }
        function finishWithMedia(media, alternates, qualities) {
            var fallbackList = Array.isArray(alternates) ? alternates : [];
            var qualityMap = qualities && typeof qualities === "object" ? qualities : {};
            if (!state.vast.length) { callback(null, { main: media, alternates: fallbackList, qualities: qualityMap, ad: null }); return; }
            resolveJvhdVast(state.vast, token, deadline, function (ad) {
                if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
                callback(null, { main: media, alternates: fallbackList, qualities: qualityMap, ad: ad || null });
            });
        }
        function processNext() {
            if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
            if (Date.now() >= deadline || state.pages >= JVHD_MAX_RESOLVE_PAGES || !state.queue.length) { callback(new Error("Resolve timeout")); return; }
            var entry = state.queue.shift();
            if (!entry || state.visited[entry.url]) { failOrContinue(); return; }
            state.visited[entry.url] = true;
            state.pages++;
            var remaining = Math.max(1000, Math.min(JVHD_REQUEST_TIMEOUT, deadline - Date.now()));
            // [BinTV ISP-BYPASS 2026-08] Tải trang có dự phòng proxy native khi
            // nhà mạng chặn trực tiếp (thứ tự: thẳng -> proxy; URL gốc được giữ).
            jvhdResolveRequest = jvhdFetchTextSmart(entry.url, remaining, sourceInfo ? sourceInfo.origin + "/" : "", function (error, response) {
                jvhdResolveRequest = null;
                if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
                if (error || !response) { failOrContinue(); return; }
                var finalInfo = jvhdUrlInfo(response.url || entry.url, entry.url);
                var expectedInfo = jvhdUrlInfo(entry.expectedOrigin || entry.url, entry.url);
                var contentType = String(response.contentType || "").toLowerCase();
                var directResponse = isJvhdDirectMediaUrl(response.url || entry.url) || /^(?:video|audio)\//.test(contentType) || /mpegurl|dash\+xml/.test(contentType);
                if (!finalInfo || (!directResponse && expectedInfo && !isSameJvhdOrigin(finalInfo, expectedInfo))) {
                    // HTTP redirect sang origin khác: coi là popunder/landing và bỏ qua.
                    failOrContinue();
                    return;
                }
                if (directResponse) { finishWithMedia({ url: finalInfo.url, score: 200 }); return; }
                var extracted = extractJvhdPageData(finalInfo.url, response.text, sourceInfo);
                for (var v = 0; v < extracted.vast.length; v++) if (state.vast.indexOf(extracted.vast[v]) === -1) state.vast.push(extracted.vast[v]);
                if (extracted.media.length) {
                    var mediaOptions = selectJvhdMediaOptions(extracted.media, source);
                    finishWithMedia(mediaOptions.main, mediaOptions.alternates, mediaOptions.qualities);
                    return;
                }
                for (var p = 0; p < extracted.pages.length && state.queue.length < JVHD_MAX_RESOLVE_PAGES; p++) {
                    if (!state.visited[extracted.pages[p].url]) state.queue.push(extracted.pages[p]);
                }
                failOrContinue();
            });
        }
        processNext();
    }

    function cancelJvhdResolution(notify) {
        if (!jvhdResolveInProgress && !jvhdResolveRequest) return;
        jvhdResolveToken++;
        jvhdResolveInProgress = false;
        if (jvhdResolveRequest) { try { jvhdResolveRequest.abort(); } catch (abortError) {} jvhdResolveRequest = null; }
        if (notify) showToast("Đã hủy mở video");
        if (jvhdScreenOpen && !moviePlayerOpen) updateJvhdFocus();
    }

    // Khởi động phiên phát JVHD dùng chung cho cả luồng resolve card (VIDEO HD,
    // PRN HUB...) và luồng livestream (LIVE, NEW LIVE) - giữ nguyên hành vi cũ.
    function startJvhdPlaybackSession(playback) {
        if (!playback || !playback.main || !playback.main.url) return;
        jvhdPlaybackQueue = [];
        // [BinTV FIX 2026-08] LIVE (stripchat): master m3u8 đã kèm pkey hợp lệ ->
        // phát trực tiếp bằng hls.js (CDN cho CORS *), không bọc qua proxy native
        // để tránh mất query pkey (mất pkey -> CDN trả video quảng cáo).
        jvhdPlaybackUseDirectUrl = playback.stripchatDirect === true;
        jvhdPlaybackFallbacks = Array.isArray(playback.alternates) ? playback.alternates.slice(0) : [];
        jvhdPlaybackQualities = playback.qualities && typeof playback.qualities === "object" ? playback.qualities : {};
        // [BinTV QUALITY 2026-08] Phien moi: reset trang thai phat hien chat luong.
        // Chat luong hien tai duoc dan nhan tu URL that dang phay (variant 720 ->
        // "720", master playlist -> "auto"/ABR).
        jvhdQualityMasterUrl = "";
        jvhdQualityHlsLevels = null;
        jvhdQualityRenderedKey = "";
        jvhdQualityProbeSerial++;
        var initialQualityHeight = jvhdHeightTokenFromText(playback.main.url);
        if (initialQualityHeight) jvhdCurrentQuality = String(initialQualityHeight);
        else jvhdCurrentQuality = jvhdPlaybackQualities["720"] ? "720" : "auto";
        jvhdQualitySelectorOpen = false;
        jvhdQualitySelectorIndex = 0;
        if (playback.ad && playback.ad.url) jvhdPlaybackQueue.push(playback.ad);
        jvhdPlaybackQueue.push({ url: playback.main.url, isAd: false, maxDurationMs: 0, isLive: playback.isLive === true });
        jvhdPlaybackIndex = -1;
        jvhdPlaybackTransitioning = false;
        jvhdPlayerSession = true;
        playNextJvhdQueueEntry();
    }

    function openJvhdItem(item) {
        if (!item || !item.url || jvhdResolveInProgress || jvhdPlayerSession) return;
        var source = jvhdSources[jvhdActiveSource];
        var sourceUrl = source && (source.effectiveUrl || source.url);
        if (!sourceUrl || !isSameJvhdOrigin(item.url, sourceUrl)) { showToast("Đã chặn liên kết ngoài nguồn JVHD"); return; }
        var content = document.querySelector("#bintv-jvhd-screen .jvhd-content");
        jvhdReturnScrollTop = content ? content.scrollTop : 0;
        jvhdSelectedItem = item;
        // [BinTV] LIVE / NEW LIVE: phát qua đúng player/luồng JVHD hiện có.
        // LIVE (stripchat) resolve master m3u8 kèm pkey của CDN Mouflon (xem khối
        // [BinTV FIX 2026-08]); NEW LIVE (chaturbate) mở trang phòng lấy stream
        // từ initialRoomDossier như cũ.
        if (jvhdIsLiveSource(source)) {
            // [BinTV FIX 2026-08] LIVE (stripchat): luôn resolve luồng HLS hợp lệ
            // tại thời điểm click. Playlist nhúng trong trang danh sách không còn
            // dùng được (CDN chỉ trả video quảng cáo khi thiếu pkey) nên đã bỏ hẳn
            // phương án dự phòng cũ dựa trên playlist ấy.
            jvhdResolveInProgress = true;
            jvhdLiveWarmSerial++;        // [BinTV LIVE-SPEED] resolve thật -> warm-up ngầm dừng ngay
            jvhdLiveWarmRunning = false;
            var liveToken = ++jvhdResolveToken;
            showToast("Đang lấy livestream, website nguồn được xử lý ngầm…");
            resolveJvhdLiveStream(item, liveToken, function (error, playback) {
                if (liveToken !== jvhdResolveToken || !jvhdResolveInProgress) return;
                jvhdResolveInProgress = false;
                jvhdResolveRequest = null;
                if (error || !playback || !playback.main || !playback.main.url) {
                    // [BinTV FIX 2026-08] Không phát lại playlist cũ từ trang danh sách:
                    // sau khi Stripchat bật bảo vệ Mouflon, playlist không pkey chỉ trả
                    // về video quảng cáo (302 -> /cpa/v2/stream.m3u8) -> báo lỗi rõ ràng.
                    showToast("Không tìm thấy livestream từ nguồn này");
                    updateJvhdFocus();
                    return;
                }
                startJvhdPlaybackSession(playback);
            });
            return;
        }
        jvhdResolveInProgress = true;
        jvhdLiveWarmSerial++;            // [BinTV LIVE-SPEED] resolve thật -> warm-up ngầm dừng ngay
        jvhdLiveWarmRunning = false;
        var token = ++jvhdResolveToken;
        showToast("Đang lấy video, website nguồn được xử lý ngầm…");
        resolveJvhdPlayback(item, source, token, function (error, playback) {
            if (token !== jvhdResolveToken || !jvhdResolveInProgress) return;
            jvhdResolveInProgress = false;
            jvhdResolveRequest = null;
            if (error || !playback || !playback.main || !playback.main.url) {
                showToast("Không tìm thấy video tương thích từ nguồn này");
                updateJvhdFocus();
                return;
            }
            startJvhdPlaybackSession(playback);
        });
    }

    function currentJvhdPlaybackEntry() {
        return jvhdPlaybackIndex >= 0 && jvhdPlaybackIndex < jvhdPlaybackQueue.length ? jvhdPlaybackQueue[jvhdPlaybackIndex] : null;
    }

    function canSelectJvhd1080Quality() {
        // [BinTV QUALITY 2026-08] Hien bo chon chat luong khi nguon that su co
        // tu 2 lua chon tro len (khong con buoc phai co du 720 VA 1080 nhu cu).
        var entry = currentJvhdPlaybackEntry();
        if (!(jvhdPlayerSession && moviePlayerOpen && entry && !entry.isAd)) return false;
        return getJvhdQualityOptionCount() >= 2;
    }

    // ============ [BinTV QUALITY 2026-08] Phat hien chat luong that tu nguon ============
    // Danh sach height (so) co the chon: gop tu qualities (URL variant - VIDEO HD/
    // PRN HUB) va hls.js levels (LIVE), sap xep CAO xuong THAP (2160p -> 1440p ->
    // 1080p -> 720p -> 480p -> 360p -> 240p).
    function getJvhdQualityHeights() {
        var seen = {};
        var heights = [];
        var key = null;
        var height = 0;
        for (key in jvhdPlaybackQualities) {
            if (!Object.prototype.hasOwnProperty.call(jvhdPlaybackQualities, key)) continue;
            height = parseInt(key, 10);
            if (height > 0 && !seen[height]) { seen[height] = true; heights.push(height); }
        }
        var levels = jvhdQualityHlsLevels || [];
        for (var i = 0; i < levels.length; i++) {
            height = parseInt(levels[i] && levels[i].height, 10);
            if (height > 0 && !seen[height]) { seen[height] = true; heights.push(height); }
        }
        heights.sort(function (a, b) { return b - a; });
        return heights;
    }

    // LIVE/hls.js: height nay co level tuong ung khong.
    function jvhdHlsHeightAvailable(quality) {
        var wanted = parseInt(quality, 10);
        var levels = jvhdQualityHlsLevels || [];
        if (!wanted) return false;
        for (var i = 0; i < levels.length; i++) if (levels[i] && levels[i].height === wanted) return true;
        return false;
    }

    function jvhdQualityAutoAvailable() {
        return !!((jvhdQualityHlsLevels && jvhdQualityHlsLevels.length) || jvhdQualityMasterUrl);
    }

    function getJvhdQualityOptionCount() {
        return getJvhdQualityHeights().length + (jvhdQualityAutoAvailable() ? 1 : 0);
    }

    // Thu tu hien thi trong UI: Auto (neu co) -> cac height cao xuong thap.
    function getJvhdQualityOrder() {
        var order = [];
        if (jvhdQualityAutoAvailable()) order.push("auto");
        var heights = getJvhdQualityHeights();
        for (var i = 0; i < heights.length; i++) order.push(String(heights[i]));
        return order;
    }

    function jvhdQualityStatusLabel(quality) {
        if (String(quality) === "auto") return "Auto";
        var height = parseInt(quality, 10);
        return height > 0 ? (height + "p") : "Auto";
    }

    // Phan tich HLS master playlist (#EXT-X-STREAM-INF) -> danh sach variant
    // {height, bandwidth, uri} that su cua nguon. uri da duoc resolve tuyet doi
    // (proxy MediaProxyServer rewrite URI con thanh URL proxy san dung duoc).
    function parseJvhdHlsMasterVariants(text, baseUrl) {
        var variants = [];
        var lines = String(text || "").split(/\r?\n/);
        var pending = null;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\s+|\s+$/g, "");
            if (!line) continue;
            if (/^#EXT-X-STREAM-INF\b/i.test(line)) {
                var attrs = line.replace(/^#EXT-X-STREAM-INF:?\s*/i, "");
                var resolution = attrs.match(/RESOLUTION\s*=\s*(\d{2,4})[xX](\d{2,5})/i);
                var bandwidth = attrs.match(/BANDWIDTH\s*=\s*(\d+)/i);
                pending = {
                    width: resolution ? parseInt(resolution[1], 10) : 0,
                    height: resolution ? parseInt(resolution[2], 10) : 0,
                    bandwidth: bandwidth ? parseInt(bandwidth[1], 10) : 0,
                    uri: ""
                };
            } else if (line.charAt(0) !== "#") {
                if (pending) {
                    pending.uri = /^(?:https?:)?\/\//i.test(line) ? line : absoluteUrl(baseUrl, line);
                    variants.push(pending);
                }
                pending = null;
            }
        }
        return variants;
    }

    // Bien danh sach variant thanh map qualities {height: url}. Chi dung height
    // that (RESOLUTION > token URL > uoc luong bitrate); khong tao quality gia.
    function buildJvhdQualitiesFromVariants(variants) {
        var qualities = {};
        var heights = [];
        for (var i = 0; i < variants.length; i++) {
            var variant = variants[i];
            if (!variant || !variant.uri) continue;
            var height = variant.height;
            if (!height || height < 120 || height > 4320) height = jvhdHeightTokenFromText(variant.uri);
            // Bien chi co am thanh (khong RESOLUTION, bandwidth rat thap) -> bo qua.
            if (!height && variant.bandwidth > 0 && variant.bandwidth < 120000) continue;
            if (!height) height = jvhdEstimateHeightFromBitrate(variant.bandwidth);
            if (!height || height < 120 || height > 4320) continue;
            var key = String(height);
            if (qualities[key]) continue; // moi height giu variant cao nhat (dau tien trong master)
            qualities[key] = variant.uri;
            heights.push(height);
        }
        heights.sort(function (a, b) { return b - a; });
        return { qualities: qualities, heights: heights };
    }

    // Doc HLS master playlist that (qua proxy/native giong luong phat) de biet
    // chinh xac nguon co nhung muc chat luong nao. Chay sau khi video chinh bat
    // dau phat; ket qua ghi de danh sach qualities tu scrape. Neu khong doc duoc
    // manifest thi van giu nguyen danh sach hien co (hanh vi cu van hoat dong).
    function refreshJvhdStreamQualitiesFromManifest(entry) {
        if (!jvhdPlayerSession || !entry || entry.isAd || entry.isLive) return; // LIVE dung hls.js levels
        var originalUrl = String(entry.url || "");
        if (!/\.m3u8(?:$|[?#])/i.test(originalUrl)) return;
        var serial = ++jvhdQualityProbeSerial;
        var candidates = [originalUrl];
        // Neu dang phat mot variant (vi du ...-720.m3u8 / ..._720p.m3u8) thi thu
        // cac dang URL master thong dung cua cung video (chi ap dung neu fetch ve
        // dung master that co >=2 variant).
        var dashForm = originalUrl.replace(/-(\d{3,4})(\.m3u8(?:[?#].*)?)$/i, "-playlist$2");
        var plainForm = originalUrl.replace(/\/([^\/\/]*?)(?:-)?(\d{3,4})p?(\.m3u8(?:[?#].*)?)$/i, "/playlist$3");
        var autoForm = originalUrl.replace(/[-_](\d{3,4})p?(\.m3u8(?:[?#].*)?)$/i, "_auto$2");
        if (dashForm !== originalUrl && candidates.indexOf(dashForm) < 0) candidates.push(dashForm);
        if (plainForm !== originalUrl && plainForm !== dashForm && candidates.indexOf(plainForm) < 0) candidates.push(plainForm);
        if (autoForm !== originalUrl && autoForm !== dashForm && autoForm !== plainForm && candidates.indexOf(autoForm) < 0) candidates.push(autoForm);
        var candidateIndex = 0;
        function stillCurrent() {
            return serial === jvhdQualityProbeSerial && jvhdPlayerSession && currentJvhdPlaybackEntry() === entry;
        }
        function nextCandidate() {
            if (!stillCurrent() || candidateIndex >= candidates.length) return;
            var candidateUrl = candidates[candidateIndex++];
            var fetchUrl = getJvhdPlayerUrl(candidateUrl);
            if (!fetchUrl) { nextCandidate(); return; }
            requestJvhdText(fetchUrl, 8000, function (error, response) {
                if (!stillCurrent()) return;
                var text = (!error && response && response.text) ? String(response.text) : "";
                if (!/#EXT-X-STREAM-INF/i.test(text)) { nextCandidate(); return; } // khong phai master -> thu ung vien khac
                var built = buildJvhdQualitiesFromVariants(parseJvhdHlsMasterVariants(text, response.url || fetchUrl));
                if (built.heights.length < 2) { nextCandidate(); return; } // master 1 variant -> khong co gi de chon
                jvhdPlaybackQualities = built.qualities;
                jvhdQualityMasterUrl = fetchUrl;
                jvhdQualityHlsLevels = null;
                var currentKey = String(jvhdCurrentQuality || "");
                if (!built.qualities[currentKey]) {
                    var tokenKey = String(jvhdHeightTokenFromText(originalUrl) || "");
                    jvhdCurrentQuality = built.qualities[tokenKey] ? tokenKey : "auto";
                }
                jvhdQualityRenderedKey = "";
                updateJvhdQualitySelector();
            });
        }
        nextCandidate();
    }

    // LIVE / hls.js: lay danh sach chat luong that tu levels cua manifest ma
    // hls.js da phan tich (height/bitrate that, sap xep cao xuong thap).
    function applyJvhdHlsManifestLevels(levels) {
        var list = levels || [];
        var seen = {};
        var picked = [];
        for (var i = 0; i < list.length; i++) {
            var level = list[i] || null;
            var height = 0;
            try { height = parseInt(level && level.height, 10) || 0; } catch (heightError) { height = 0; }
            var levelBitrate = 0;
            try { levelBitrate = Number(level && level.bitrate) || 0; } catch (bitrateError) { levelBitrate = 0; }
            if (!height) {
                var levelUrl = "";
                try { levelUrl = level && level.url ? String(level.url.join ? level.url.join("") : level.url) : ""; } catch (urlError) { levelUrl = ""; }
                height = jvhdHeightTokenFromText(levelUrl);
            }
            // Bien chi co am thanh (khong RESOLUTION, bitrate rat thap) khong phai
            // chat luong video -> bo qua, khong tao label gia.
            if (!height && levelBitrate > 0 && levelBitrate < 120000) continue;
            if (!height) height = jvhdEstimateHeightFromBitrate(levelBitrate);
            if (!height || height < 120 || height > 4320) continue;
            if (seen[height]) continue;
            seen[height] = true;
            picked.push({ height: height, index: i });
        }
        picked.sort(function (a, b) { return b.height - a.height; });
        if (picked.length < 2) {
            jvhdQualityHlsLevels = null;
            jvhdQualityRenderedKey = "";
            updateJvhdQualitySelector();
            return;
        }
        jvhdQualityHlsLevels = picked;
        var currentHeight = parseInt(jvhdCurrentQuality, 10);
        if (String(jvhdCurrentQuality) !== "auto" && (!currentHeight || !seen[currentHeight])) jvhdCurrentQuality = "auto";
        jvhdQualityRenderedKey = "";
        updateJvhdQualitySelector();
    }

    // LIVE / hls.js: chuyen that su sang variant tuong ung bang API cua hls.js
    // (khong reload manifest, khong mat live edge). -1 = Auto (ABR).
    function applyJvhdHlsQualityLevel(targetQuality) {
        var hls = jvhdHls;
        if (!hls || !jvhdQualityHlsLevels || !jvhdQualityHlsLevels.length) return false;
        var targetLevel = -1;
        if (String(targetQuality) !== "auto") {
            var wanted = parseInt(targetQuality, 10);
            if (!wanted) return false;
            for (var i = 0; i < jvhdQualityHlsLevels.length; i++) {
                if (jvhdQualityHlsLevels[i].height === wanted) { targetLevel = jvhdQualityHlsLevels[i].index; break; }
            }
            if (targetLevel < 0) return false;
        }
        try {
            hls.nextLevel = targetLevel;
        } catch (levelError) {
            try { hls.currentLevel = targetLevel; } catch (fallbackError) { return false; }
        }
        try {
            hls.once(window.Hls.Events.LEVEL_SWITCHED, function () {
                if (jvhdHls !== hls || !jvhdPlayerSession) return;
                updateMoviePlayerStatus("Đang phát");
            });
        } catch (onceError) {}
        return true;
    }
    // ======== het khoi [BinTV QUALITY 2026-08] ========

    function ensureJvhdQualitySelector() {
        var selector = document.getElementById("bintv-jvhd-quality-selector");
        if (selector) { renderJvhdQualitySelectorOptions(); return selector; }
        var player = document.getElementById("bintv-movie-player");
        if (!player) return null;
        selector = document.createElement("div");
        selector.id = "bintv-jvhd-quality-selector";
        selector.className = "jvhd-quality-selector";
        selector.setAttribute("aria-hidden", "true");
        // [BinTV QUALITY 2026-08] Khong con hard-code 720/1080: cac option duoc
        // render dong theo chat luong that cua nguon (xem render...Options).
        selector.innerHTML =
            '<div class="jvhd-quality-title">Chất lượng video</div>' +
            '<div class="jvhd-quality-options"></div>' +
            '<div id="bintv-jvhd-quality-help" class="jvhd-quality-help">↑ Chọn chất lượng</div>';
        player.appendChild(selector);
        renderJvhdQualitySelectorOptions();
        return selector;
    }

    // [BinTV QUALITY 2026-08] Render lai cac option (Auto + danh sach height cao
    // xuong thap) chi khi danh sach chat luong thay doi.
    function renderJvhdQualitySelectorOptions() {
        var selector = document.getElementById("bintv-jvhd-quality-selector");
        if (!selector) return;
        var container = selector.querySelector(".jvhd-quality-options");
        if (!container) return;
        var order = getJvhdQualityOrder();
        var renderKey = order.join("|");
        if (renderKey === jvhdQualityRenderedKey) return;
        jvhdQualityRenderedKey = renderKey;
        var html = "";
        for (var i = 0; i < order.length; i++) {
            var label = String(order[i]) === "auto" ? "Auto" : (parseInt(order[i], 10) + "p");
            html += '<div class="jvhd-quality-option" data-quality="' + order[i] + '">' + label + '</div>';
        }
        container.innerHTML = html;
        var options = container.querySelectorAll(".jvhd-quality-option");
        for (var j = 0; j < options.length; j++) {
            options[j].setAttribute("data-quality-index", String(j));
            options[j].addEventListener("click", function (event) {
                event.preventDefault();
                if (!canSelectJvhd1080Quality()) return;
                jvhdQualitySelectorIndex = parseInt(this.getAttribute("data-quality-index") || "0", 10) || 0;
                jvhdQualitySelectorOpen = true;
                switchJvhdPlaybackQuality(this.getAttribute("data-quality") || "auto");
            });
        }
        if (jvhdQualitySelectorIndex >= order.length) jvhdQualitySelectorIndex = Math.max(0, order.length - 1);
    }

    function updateJvhdQualitySelector() {
        var selector = ensureJvhdQualitySelector();
        if (!selector) return;
        var visible = canSelectJvhd1080Quality() && movieSeekTimelineVisible;
        selector.classList.toggle("show", visible);
        selector.classList.toggle("selecting", visible && jvhdQualitySelectorOpen);
        selector.setAttribute("aria-hidden", visible ? "false" : "true");
        var options = selector.querySelectorAll(".jvhd-quality-option");
        var currentKey = String(jvhdCurrentQuality || "auto");
        for (var i = 0; i < options.length; i++) {
            var quality = options[i].getAttribute("data-quality") || "auto";
            options[i].classList.toggle("active", quality === currentKey);
            options[i].classList.toggle("focus", jvhdQualitySelectorOpen && i === jvhdQualitySelectorIndex);
        }
        var help = document.getElementById("bintv-jvhd-quality-help");
        if (help) help.textContent = jvhdQualitySelectorOpen ? "←/→: Chọn · OK: Xác nhận · ↓/BACK: Đóng" : "↑ Chọn chất lượng";
    }

    function hideJvhdQualitySelector() {
        jvhdQualitySelectorOpen = false;
        var selector = document.getElementById("bintv-jvhd-quality-selector");
        if (selector) {
            selector.classList.remove("show");
            selector.classList.remove("selecting");
            selector.setAttribute("aria-hidden", "true");
        }
    }

    function openJvhdQualitySelector() {
        if (!canSelectJvhd1080Quality() || !movieSeekTimelineVisible) return false;
        if (movieSeekTimelineHideTimer) { clearTimeout(movieSeekTimelineHideTimer); movieSeekTimelineHideTimer = null; }
        jvhdQualitySelectorOpen = true;
        // [BinTV QUALITY 2026-08] Con tro bat dau tai muc chat luong dang phat.
        var order = getJvhdQualityOrder();
        var currentIndex = order.indexOf(String(jvhdCurrentQuality || "auto"));
        jvhdQualitySelectorIndex = currentIndex >= 0 ? currentIndex : 0;
        updateJvhdQualitySelector();
        return true;
    }

    function closeJvhdQualitySelector(keepPrompt) {
        jvhdQualitySelectorOpen = false;
        if (keepPrompt && canSelectJvhd1080Quality() && movieSeekTimelineVisible) {
            updateJvhdQualitySelector();
            scheduleMovieSeekTimelineHide(4000);
        } else hideJvhdQualitySelector();
    }

    function handleJvhdQualitySelectorKey(left, right, up, down, ok) {
        if (!jvhdQualitySelectorOpen) return false;
        // [BinTV QUALITY 2026-08] Di chuyen giua TAT CA cac option (Auto, 2160p,
        // 1080p, 720p, 480p...) thay vi chi 2 vi tri 720/1080 nhu truoc.
        var order = getJvhdQualityOrder();
        if (!order.length) return false;
        if (left) jvhdQualitySelectorIndex = Math.max(0, jvhdQualitySelectorIndex - 1);
        else if (right) jvhdQualitySelectorIndex = Math.min(order.length - 1, jvhdQualitySelectorIndex + 1);
        else if (down) { closeJvhdQualitySelector(true); return true; }
        else if (ok) {
            switchJvhdPlaybackQuality(order[jvhdQualitySelectorIndex] || "auto");
            return true;
        }
        updateJvhdQualitySelector();
        return true;
    }

    function cleanupJvhdQualityResume() {
        jvhdQualitySwitchSerial++;
        if (jvhdQualitySwitchCleanup) try { jvhdQualitySwitchCleanup(); } catch (cleanupError) {}
        jvhdQualitySwitchCleanup = null;
        jvhdQualitySwitching = false;
    }

    function installJvhdQualityResume(video, resumeMilliseconds, serial) {
        if (!video) { jvhdQualitySwitching = false; return; }
        var targetSeconds = Math.max(0, Number(resumeMilliseconds) || 0) / 1000;
        var applied = false;
        var finished = false;
        var timers = [];
        function clearListeners() {
            try { video.removeEventListener("loadedmetadata", tryResume); } catch (e) {}
            try { video.removeEventListener("canplay", tryResume); } catch (e2) {}
            try { video.removeEventListener("seeked", finishResume); } catch (e3) {}
            try { video.removeEventListener("timeupdate", checkResume); } catch (e4) {}
            for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
            timers = [];
        }
        function finishResume() {
            if (finished || serial !== jvhdQualitySwitchSerial) return;
            finished = true;
            clearListeners();
            if (jvhdQualitySwitchCleanup === clearListeners) jvhdQualitySwitchCleanup = null;
            jvhdQualitySwitching = false;
            syncMoviePlaybackClock(Math.max(0, Number(resumeMilliseconds) || 0), true);
            updateMoviePlayerStatus("Đang phát");
        }
        function tryResume() {
            if (finished || serial !== jvhdQualitySwitchSerial) return;
            if (targetSeconds <= 0.5) { finishResume(); return; }
            try {
                if (video.readyState > 0) {
                    video.currentTime = targetSeconds;
                    applied = true;
                }
            } catch (seekError) {}
        }
        function checkResume() {
            if (finished || serial !== jvhdQualitySwitchSerial) return;
            if (!applied) { tryResume(); return; }
            var current = Number(video.currentTime) || 0;
            if (Math.abs(current - targetSeconds) <= 3 || current >= targetSeconds) finishResume();
        }
        video.addEventListener("loadedmetadata", tryResume);
        video.addEventListener("canplay", tryResume);
        video.addEventListener("seeked", finishResume);
        video.addEventListener("timeupdate", checkResume);
        timers.push(setTimeout(tryResume, 0));
        timers.push(setTimeout(tryResume, 600));
        timers.push(setTimeout(function () { if (!finished) { tryResume(); if (applied) finishResume(); } }, 2500));
        jvhdQualitySwitchCleanup = clearListeners;
    }

    function switchJvhdPlaybackQuality(quality) {
        var targetQuality = String(quality || "auto");
        var entry = currentJvhdPlaybackEntry();
        if (!canSelectJvhd1080Quality() || !entry || entry.isAd) return;
        if (targetQuality !== "auto" && !jvhdPlaybackQualities[targetQuality] && !jvhdHlsHeightAvailable(targetQuality)) return;
        if (targetQuality === String(jvhdCurrentQuality)) { closeJvhdQualitySelector(true); return; }

        // [BinTV QUALITY 2026-08] LIVE / trinh phat hls.js: chuyen THAT SU sang
        // variant tuong ung tren cung manifest (hls.nextLevel) - khong restart,
        // khong mat vi tri phat/live edge.
        if (jvhdHls && jvhdQualityHlsLevels && jvhdQualityHlsLevels.length) {
            if (!applyJvhdHlsQualityLevel(targetQuality)) return;
            jvhdCurrentQuality = targetQuality;
            jvhdQualitySelectorOpen = false;
            updateJvhdQualitySelector();
            updateMoviePlayerStatus("Đang chuyển sang " + jvhdQualityStatusLabel(targetQuality) + "…");
            scheduleMovieSeekTimelineHide(4000);
            return;
        }

        // [BinTV QUALITY 2026-08] VIDEO HD / PRN HUB: chuyen sang URL variant
        // (hoac master neu chon Auto) tuong ung - player tai dung stream that
        // su va resume dung vi tri dang xem.
        var targetUrl = targetQuality === "auto" ? jvhdQualityMasterUrl : jvhdPlaybackQualities[targetQuality];
        if (!targetUrl) return;
        var bounds = getMovieSeekBounds();
        var resumeMilliseconds = bounds ? bounds.current : getMoviePlaybackClockMilliseconds();
        cleanupJvhdQualityResume();
        var serial = jvhdQualitySwitchSerial;
        jvhdCurrentQuality = targetQuality;
        entry.url = targetUrl;
        jvhdQualitySelectorOpen = false;
        hideJvhdQualitySelector();
        jvhdQualitySwitching = true;
        jvhdPlaybackTransitioning = true;
        if (moviePlayerOpen) stopMoviePlayback(true);
        jvhdPlaybackTransitioning = false;
        var title = (jvhdSelectedItem && jvhdSelectedItem.title) || "JVHD";
        startMoviePlayback(getJvhdPlayerUrl(targetUrl), title, { name: title, type: "movie", jvhd: true, sourceUrl: jvhdSelectedItem && jvhdSelectedItem.url });
        updateMoviePlayerStatus("Đang chuyển sang " + jvhdQualityStatusLabel(targetQuality) + "…");
        installJvhdQualityResume(document.getElementById("bintv-movie-html5-player"), resumeMilliseconds, serial);
    }

    function getJvhdPlayerUrl(url) {
        var original = String(url || "");
        if (!original) return "";
        // [BinTV QUALITY 2026-08] URL da la URL proxy (doc tu manifest da rewrite
        // boi MediaProxyServer) -> dung nguyen, khong bao proxy lan hai.
        if (/^http:\/\/127\.0\.0\.1:\d+\/jvhd-media\//i.test(original)) return original;
        // [BinTV FIX 2026-08] LIVE (stripchat): giữ nguyên URL master+pkey. Proxy
        // native có thể làm mất/sửa query pkey -> CDN từ chối và trả về video
        // quảng cáo; CDN chấp nhận CORS * nên phát trực tiếp là an toàn.
        if (jvhdPlaybackUseDirectUrl) return original;
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.proxyMedia === "function") {
                var referer = (jvhdSelectedItem && jvhdSelectedItem.url) || (jvhdSources[jvhdActiveSource] && (jvhdSources[jvhdActiveSource].effectiveUrl || jvhdSources[jvhdActiveSource].url)) || "";
                var proxied = String(window.AndroidBridge.proxyMedia(original, referer) || "");
                if (isValidMovieTargetUrl(proxied)) return proxied;
            }
        } catch (proxyError) {}
        return original;
    }

    function playNextJvhdQueueEntry() {
        if (!jvhdPlayerSession || jvhdPlaybackTransitioning) return;
        jvhdPlaybackIndex++;
        var entry = currentJvhdPlaybackEntry();
        if (!entry) { closeJvhdPlayback(true, "Đã phát xong"); return; }
        jvhdPlaybackTransitioning = true;
        if (moviePlayerOpen) stopMoviePlayback(true);
        jvhdPlaybackTransitioning = false;
        var title = entry.isAd ? "Quảng cáo" : ((jvhdSelectedItem && jvhdSelectedItem.title) || "JVHD");
        var playerUrl = getJvhdPlayerUrl(entry.url);
        startMoviePlayback(playerUrl, title, { name: title, type: "movie", jvhd: true, sourceUrl: jvhdSelectedItem && jvhdSelectedItem.url });
        // [BinTV QUALITY 2026-08] Video chinh: doc HLS master playlist that de
        // lap day du danh sach chat luong (240p...2160p + Auto neu co nhieu
        // variant). LIVE khong can probe - hls.js MANIFEST_PARSED da lo.
        if (!entry.isAd) refreshJvhdStreamQualitiesFromManifest(entry);
        if (entry.isAd) {
            var seconds = entry.maxDurationMs > 0 ? Math.max(1, Math.ceil(entry.maxDurationMs / 1000)) : 0;
            updateMoviePlayerStatus(seconds ? ("Quảng cáo · tự chuyển video chính sau " + seconds + " giây") : "Quảng cáo");
        }
    }

    function handleJvhdPlaybackProgress(milliseconds) {
        var entry = currentJvhdPlaybackEntry();
        if (!jvhdPlayerSession || jvhdPlaybackTransitioning || !entry || !entry.isAd || !entry.maxDurationMs) return;
        if (milliseconds + 120 >= entry.maxDurationMs) {
            jvhdPlaybackTransitioning = true;
            setTimeout(function () {
                if (!jvhdPlayerSession) return;
                jvhdPlaybackTransitioning = false;
                playNextJvhdQueueEntry();
            }, 0);
        }
    }

    function handleJvhdPlaybackCompleted() {
        if (!jvhdPlayerSession || jvhdPlaybackTransitioning) return;
        var entry = currentJvhdPlaybackEntry();
        if (entry && entry.isAd) { playNextJvhdQueueEntry(); return; }
        // Livestream kết thúc đột ngột (hoặc CDN chỉ trả về pre-roll ngắn):
        // thử phát lại 1 lần với master mới rồi mới đóng.
        if (entry && entry.isLive && !entry.liveRetried) {
            entry.liveRetried = true;
            jvhdPlaybackTransitioning = true;
            setTimeout(function () {
                if (!jvhdPlayerSession) return;
                jvhdPlaybackTransitioning = false;
                jvhdPlaybackIndex--;
                playNextJvhdQueueEntry();
            }, 800);
            return;
        }
        closeJvhdPlayback(true, "Đã phát xong");
    }

    function playNextJvhdFallback() {
        if (!jvhdPlaybackFallbacks.length || !jvhdPlayerSession) return false;
        var fallback = jvhdPlaybackFallbacks.shift();
        var entry = currentJvhdPlaybackEntry();
        if (!fallback || !fallback.url || !entry || entry.isAd) return false;
        entry.url = fallback.url;
        jvhdPlaybackTransitioning = true;
        if (moviePlayerOpen) stopMoviePlayback(true);
        jvhdPlaybackTransitioning = false;
        var title = (jvhdSelectedItem && jvhdSelectedItem.title) || "JVHD";
        updateMoviePlayerStatus("Đang thử nguồn phát dự phòng…");
        startMoviePlayback(getJvhdPlayerUrl(entry.url), title, { name: title, type: "movie", jvhd: true, sourceUrl: jvhdSelectedItem && jvhdSelectedItem.url });
        return true;
    }

    function handleJvhdPlaybackFailure() {
        if (!jvhdPlayerSession || jvhdPlaybackTransitioning) return;
        var entry = currentJvhdPlaybackEntry();
        if (entry && entry.isAd) {
            showToast("Bỏ qua quảng cáo không phát được");
            playNextJvhdQueueEntry();
            return;
        }
        if (playNextJvhdFallback()) return;
        // [BinTV iOS build 231] iPhone KHÔNG phải TV: thử TRÌNH PHÁT GỐC iOS
        // (AVPlayer) trước khi đóng và báo lỗi. Trên Android/Tizen/Windows
        // requestNativeMoviePlayback trả false → giữ nguyên hành vi cũ.
        if (requestNativeMoviePlayback("jvhd-playback-error")) return;
        // iOS: thông báo đúng thiết bị (đã thử trình phát gốc). Nền tảng khác:
        // GIỮ NGUYÊN câu chữ cũ của bản Android/Tizen.
        closeJvhdPlayback(true, isIosNativePlaybackBridge()
            ? describeMoviePlaybackUnavailable("")
            : "Không thể phát video này trên TV");
    }

    function restoreJvhdFocusAfterPlayer() {
        if (!jvhdScreenOpen) return;
        jvhdFocusArea = "grid";
        var content = document.querySelector("#bintv-jvhd-screen .jvhd-content");
        if (content) content.scrollTop = jvhdReturnScrollTop;
        updateJvhdFocus();
        setTimeout(function () {
            if (!jvhdScreenOpen || moviePlayerOpen) return;
            if (content) content.scrollTop = jvhdReturnScrollTop;
            updateJvhdFocus();
        }, 0);
    }

    function closeJvhdPlayback(restoreFocus, message) {
        var hadSession = jvhdPlayerSession;
        cleanupJvhdQualityResume();
        hideJvhdQualitySelector();
        jvhdPlayerSession = false;
        jvhdPlaybackTransitioning = false;
        jvhdPlaybackQueue = [];
        jvhdPlaybackUseDirectUrl = false;
        jvhdPlaybackFallbacks = [];
        jvhdPlaybackQualities = {};
        // [BinTV QUALITY 2026-08] Don dep trang thai phat hien chat luong.
        jvhdQualityMasterUrl = "";
        jvhdQualityHlsLevels = null;
        jvhdQualityRenderedKey = "";
        jvhdQualityProbeSerial++;
        jvhdCurrentQuality = "auto";
        jvhdPlaybackIndex = -1;
        if (moviePlayerOpen) stopMoviePlayback();
        if (restoreFocus && hadSession) restoreJvhdFocusAfterPlayer();
        if (message) showToast(message);
    }

    function ensureJvhdPinGate() {
        var gate = document.getElementById("bintv-jvhd-pin-gate");
        if (gate) return gate;
        gate = document.createElement("div");
        gate.id = "bintv-jvhd-pin-gate";
        gate.innerHTML =
            '<div class="jvhd-pin-backdrop"></div>' +
            '<div class="jvhd-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="bintv-jvhd-pin-title">' +
                '<div class="jvhd-pin-logo">JVHD</div>' +
                '<div id="bintv-jvhd-pin-title" class="jvhd-pin-title">Khóa trẻ em</div>' +
                '<div class="jvhd-pin-description">Nhập mã PIN gồm 4 số để tiếp tục</div>' +
                '<input id="bintv-jvhd-pin-input" class="jvhd-pin-input" type="password" inputmode="numeric" maxlength="4" readonly tabindex="-1" aria-label="Mã PIN 4 số" placeholder="••••" />' +
                '<div id="bintv-jvhd-pin-status" class="jvhd-pin-status">Dùng phím điều hướng và OK để nhập mã PIN</div>' +
                '<div class="jvhd-pin-keypad">' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="1">1</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="2">2</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="3">3</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="4">4</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="5">5</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="6">6</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="7">7</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="8">8</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="9">9</button>' +
                    '<button type="button" class="jvhd-pin-key jvhd-pin-delete" data-pin-action="delete" aria-label="Xóa số cuối">⌫</button>' +
                    '<button type="button" class="jvhd-pin-key" data-pin-value="0">0</button>' +
                    '<button type="button" class="jvhd-pin-key jvhd-pin-cancel" data-pin-action="cancel">Hủy</button>' +
                '</div>' +
                '<div class="jvhd-pin-help">←/→/↑/↓: Chọn · OK: Nhập · BACK: Hủy</div>' +
            '</div>';
        document.body.appendChild(gate);
        var buttons = gate.querySelectorAll(".jvhd-pin-key");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute("data-pin-index", String(i));
            buttons[i].addEventListener("click", function (event) {
                event.preventDefault();
                if (!jvhdPinOpen || jvhdPinAuthorized) return;
                jvhdPinFocusIndex = parseInt(this.getAttribute("data-pin-index") || "0", 10) || 0;
                activateJvhdPinControl(this);
            });
        }
        return gate;
    }

    function updateJvhdPinGate() {
        var gate = document.getElementById("bintv-jvhd-pin-gate");
        if (!gate) return;
        gate.classList.toggle("busy", jvhdPinAuthorized);
        var input = document.getElementById("bintv-jvhd-pin-input");
        if (input) input.value = jvhdPinValue;
        var status = document.getElementById("bintv-jvhd-pin-status");
        if (status) status.textContent = jvhdPinAuthorized ? "Đang mở JVHD…" : "Dùng phím điều hướng và OK để nhập mã PIN";
        var buttons = gate.querySelectorAll(".jvhd-pin-key");
        if (jvhdPinFocusIndex < 0) jvhdPinFocusIndex = 0;
        if (jvhdPinFocusIndex >= buttons.length) jvhdPinFocusIndex = buttons.length - 1;
        for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle("focus", jvhdPinOpen && !jvhdPinAuthorized && i === jvhdPinFocusIndex);
        if (jvhdPinOpen && !jvhdPinAuthorized && buttons[jvhdPinFocusIndex]) try { buttons[jvhdPinFocusIndex].focus(); } catch (focusError) {}
    }

    function closeJvhdPinGateView() {
        var gate = document.getElementById("bintv-jvhd-pin-gate");
        if (gate) { gate.classList.remove("show"); gate.classList.remove("busy"); }
    }

    function cancelJvhdPinGate(showMessage) {
        if (jvhdUserGateOpen) closeJvhdUserGate(false); // [BinTV USER-AUTH] dong man username theo cua PIN
        if (!jvhdPinOpen && !jvhdLaunchInProgress) return;
        jvhdPinAttemptToken++;
        jvhdPinOpen = false;
        jvhdPinAuthorized = false;
        jvhdPinConfigPending = false;
        jvhdPinSources = [];
        jvhdPinConfigError = null;
        jvhdPinValue = "";
        jvhdLaunchInProgress = false;
        closeJvhdPinGateView();
        focusApp();
        if (showMessage) showToast(showMessage);
    }

    function finishJvhdPinAuthorization() {
        if (jvhdUserGateOpen) return; // [BinTV USER-AUTH] dang trong man username -> mo JVHD sau khi qua xac thuc
        if (!jvhdPinOpen || !jvhdPinAuthorized || jvhdPinConfigPending) return;
        if (jvhdPinConfigError || !jvhdPinSources.length) {
            var error = jvhdPinConfigError;
            cancelJvhdPinGate(false);
            showToast(getMovieRequestErrorMessage("Không thể tải JVHD", error));
            return;
        }
        var sources = jvhdPinSources.slice(0);
        jvhdPinAttemptToken++;
        jvhdPinOpen = false;
        jvhdPinAuthorized = false;
        jvhdPinSources = [];
        jvhdPinConfigError = null;
        jvhdPinValue = "";
        jvhdLaunchInProgress = false;
        closeJvhdPinGateView();
        openJvhdScreen(sources);
    }

    function verifyJvhdPin() {
        if (!jvhdPinOpen || jvhdPinAuthorized || jvhdPinValue.length !== 4) return;
        if (jvhdPinValue !== JVHD_DEFAULT_PIN) {
            cancelJvhdPinGate(false);
            showToast("Mã PIN không đúng");
            // [BinTV JVHD-STANDALONE 2026-08] Bản độc lập: sai PIN vẫn ở lại
            // cổng PIN (không có launcher để quay về) -> mở lại sau câu thông báo.
            if (BINTV_JVHD_STANDALONE) setTimeout(launchBuiltinJvhd, 400);
            return;
        }
        jvhdPinAuthorized = true;
        updateJvhdPinGate();
        // [BinTV USER-AUTH 2026-08] PIN dung -> BAT BUOC qua man Xac thuc Username.
        openJvhdUserGate();
    }

    function appendJvhdPinDigit(digit) {
        if (!jvhdPinOpen || jvhdPinAuthorized || !/^[0-9]$/.test(String(digit || "")) || jvhdPinValue.length >= 4) return;
        jvhdPinValue += String(digit);
        updateJvhdPinGate();
        if (jvhdPinValue.length === 4) verifyJvhdPin();
    }

    function deleteJvhdPinDigit() {
        if (!jvhdPinOpen || jvhdPinAuthorized || !jvhdPinValue.length) return;
        jvhdPinValue = jvhdPinValue.substring(0, jvhdPinValue.length - 1);
        updateJvhdPinGate();
    }

    function activateJvhdPinControl(control) {
        if (!control || !jvhdPinOpen || jvhdPinAuthorized) return;
        var action = control.getAttribute("data-pin-action") || "";
        if (action === "cancel") { cancelJvhdPinGate(false); return; }
        if (action === "delete") { deleteJvhdPinDigit(); return; }
        appendJvhdPinDigit(control.getAttribute("data-pin-value") || "");
    }

    function getJvhdPinDigitFromEvent(event) {
        var key = String((event && event.key) || "");
        if (/^[0-9]$/.test(key)) return key;
        var code = Number((event && (event.keyCode || event.which || event.charCode)) || 0);
        if (code >= 48 && code <= 57) return String(code - 48);
        if (code >= 96 && code <= 105) return String(code - 96);
        return "";
    }

    function handleJvhdPinKey(left, right, up, down, ok, event) {
        if (!jvhdPinOpen) return false;
        var digit = getJvhdPinDigitFromEvent(event);
        if (digit) { appendJvhdPinDigit(digit); return true; }
        if (isKey(event || {}, 46, "Delete")) { deleteJvhdPinDigit(); return true; }
        var buttons = document.querySelectorAll("#bintv-jvhd-pin-gate .jvhd-pin-key");
        if (!buttons.length || jvhdPinAuthorized) return true;
        var column = jvhdPinFocusIndex % 3;
        if (left && column > 0) jvhdPinFocusIndex--;
        else if (right && column < 2) jvhdPinFocusIndex++;
        else if (up && jvhdPinFocusIndex >= 3) jvhdPinFocusIndex -= 3;
        else if (down && jvhdPinFocusIndex + 3 < buttons.length) jvhdPinFocusIndex += 3;
        else if (ok && !okKeyDown) {
            okKeyDown = true;
            suppressNextOkUp = true;
            activateJvhdPinControl(buttons[jvhdPinFocusIndex]);
            return true;
        }
        updateJvhdPinGate();
        return true;
    }

    function openJvhdPinGate() {
        jvhdLaunchInProgress = true;
        jvhdPinOpen = true;
        jvhdPinValue = "";
        jvhdPinFocusIndex = 0;
        jvhdPinAuthorized = false;
        jvhdPinConfigPending = true;
        jvhdPinSources = [];
        jvhdPinConfigError = null;
        var token = ++jvhdPinAttemptToken;
        var gate = ensureJvhdPinGate();
        gate.classList.add("show");
        updateJvhdPinGate();
        requestJson(JVHD_CONFIG_URL, JVHD_REQUEST_TIMEOUT, function (data) {
            if (token !== jvhdPinAttemptToken || !jvhdPinOpen) return;
            jvhdPinConfigPending = false;
            jvhdPinSources = extractJvhdSources(data);
            if (!jvhdPinSources.length) jvhdPinConfigError = new Error("Không có nguồn JVHD");
            if (jvhdPinAuthorized) finishJvhdPinAuthorization();
        }, function (error) {
            if (token !== jvhdPinAttemptToken || !jvhdPinOpen) return;
            jvhdPinConfigPending = false;
            jvhdPinConfigError = error || new Error("Không thể tải cấu hình JVHD");
            if (jvhdPinAuthorized) finishJvhdPinAuthorization();
        });
    }

    // ===== [BinTV USER-AUTH 2026-08] Man Xac thuc Username (hien sau khi PIN dung) =====
    // Chi THEM man chan moi; khong doi UI/logic/duong dan nao khac cua JVHD.
    // Bao mat: khong console.log username/hash; SALT chi nam trong native lib;
    // JS chi nhan chuoi hash 64 ky tu hex va so voi JSONBin.
    function jvhdUserLs() {
        try { return window.localStorage || null; } catch (lsError) { return null; }
    }
    function jvhdUserReadNum(key) {
        var store = jvhdUserLs();
        if (!store) return 0;
        try { var value = parseFloat(store.getItem(key)); return isFinite(value) ? value : 0; } catch (e) { return 0; }
    }
    function jvhdUserWriteNum(key, value) {
        var store = jvhdUserLs();
        if (!store) return;
        try { store.setItem(key, String(value)); } catch (e) {}
    }
    function jvhdUserRemove(key) {
        var store = jvhdUserLs();
        if (!store) return;
        try { store.removeItem(key); } catch (e) {}
    }
    function jvhdUserLockRemaining() {
        var until = jvhdUserReadNum("jvhdUserLockUntil");
        if (!until) return 0;
        return Math.max(0, until - Date.now());
    }
    function jvhdUserLockFormat(ms) {
        var total = Math.ceil(ms / 1000);
        var mm = Math.floor(total / 60), ss = total % 60;
        return mm + ":" + (ss < 10 ? "0" : "") + ss;
    }
    function jvhdUserNativeHash(name) {
        try {
            var bridge = window.AndroidBridge;
            if (!bridge || typeof bridge.c0 !== "function") return null;
            var digest = bridge.c0(String(name));
            if (typeof digest !== "string") return null;
            return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
        } catch (e) { return null; }
    }
    function ensureJvhdUserGate() {
        var gate = document.getElementById("bintv-jvhd-user-gate");
        if (gate) return gate;
        gate = document.createElement("div");
        gate.id = "bintv-jvhd-user-gate";
        gate.innerHTML =
            '<div class="jvhd-user-backdrop"></div>' +
            '<div class="jvhd-user-dialog" role="dialog" aria-modal="true" aria-labelledby="bintv-jvhd-user-title">' +
                '<div class="jvhd-user-logo">JVHD</div>' +
                '<div id="bintv-jvhd-user-title" class="jvhd-user-title">Xác thực người dùng</div>' +
                '<div class="jvhd-user-description">Nhập tên người dùng để tiếp tục vào JVHD</div>' +
                '<input id="bintv-jvhd-user-input" class="jvhd-user-input" type="text" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Tên người dùng" aria-label="Tên người dùng" />' +
                '<div id="bintv-jvhd-user-status" class="jvhd-user-status">Nhập tên người dùng rồi chọn Xác nhận</div>' +
                '<div class="jvhd-user-actions">' +
                    '<button type="button" id="bintv-jvhd-user-confirm" class="jvhd-user-confirm">Xác nhận</button>' +
                '</div>' +
                '<div class="jvhd-user-help">OK: Xác nhận · Dùng bàn phím hoặc remote để nhập tên</div>' +
            '</div>';
        document.body.appendChild(gate);
        var confirmButton = gate.querySelector("#bintv-jvhd-user-confirm");
        if (confirmButton) confirmButton.addEventListener("click", function (event) {
            event.preventDefault();
            submitJvhdUserGate();
        });
        var gateInput = gate.querySelector("#bintv-jvhd-user-input");
        if (gateInput) gateInput.addEventListener("keydown", function (event) {
            // Enter truc tiep trong o input (ke ca remote QWERTY) -> Xac nhan.
            if (event.keyCode === 13 || (event.key === "Enter")) {
                event.preventDefault();
                event.stopPropagation();
                submitJvhdUserGate();
            }
        });
        return gate;
    }
    function updateJvhdUserGate() {
        var gate = document.getElementById("bintv-jvhd-user-gate");
        if (!gate) return;
        var locked = jvhdUserLockRemaining() > 0;
        var status = document.getElementById("bintv-jvhd-user-status");
        var help = gate.querySelector(".jvhd-user-help");
        gate.classList.toggle("locked", locked);
        if (locked) {
            if (status) status.textContent = "Nhập sai " + JVHD_USER_FAIL_LIMIT + " lần liên tiếp. Thử lại sau " + jvhdUserLockFormat(jvhdUserLockRemaining());
            if (help) help.textContent = "Màn hình sẽ mở lại khi hết thời gian khóa";
        } else if (help) {
            help.textContent = "OK: Xác nhận · Dùng bàn phím hoặc remote để nhập tên";
        }
    }
    function startJvhdUserCountdown() {
        if (jvhdUserCountdownTimer) { updateJvhdUserGate(); return; }
        updateJvhdUserGate();
        jvhdUserCountdownTimer = setInterval(function () {
            if (jvhdUserLockRemaining() <= 0) {
                clearInterval(jvhdUserCountdownTimer);
                jvhdUserCountdownTimer = null;
                // Het khoa: cho thu lai, dat lai bo dem sai (da tra gia bang 3 phut cho).
                jvhdUserWriteNum("jvhdUserFails", 0);
                jvhdUserRemove("jvhdUserLockUntil");
                updateJvhdUserGate();
                var unlockStatus = document.getElementById("bintv-jvhd-user-status");
                if (unlockStatus) unlockStatus.textContent = "Đã hết thời gian khóa, vui lòng thử lại";
                var input = document.getElementById("bintv-jvhd-user-input");
                if (input && jvhdUserGateOpen) try { input.focus(); } catch (focusError) {}
                return;
            }
            updateJvhdUserGate();
        }, 500);
    }
    function closeJvhdUserGate(passed) {
        jvhdUserGateOpen = false;
        jvhdUserChecking = false;
        if (jvhdUserCountdownTimer) { clearInterval(jvhdUserCountdownTimer); jvhdUserCountdownTimer = null; }
        var gate = document.getElementById("bintv-jvhd-user-gate");
        if (gate) { gate.classList.remove("show"); gate.classList.remove("busy"); gate.classList.remove("locked"); }
        focusApp();
        if (passed) finishJvhdPinAuthorization();
    }
    function openJvhdUserGate() {
        jvhdUserGateOpen = true;
        jvhdUserChecking = false;
        var gate = ensureJvhdUserGate();
        gate.classList.add("show");
        updateJvhdUserGate();
        if (jvhdUserLockRemaining() > 0) startJvhdUserCountdown();
        else {
            var input = document.getElementById("bintv-jvhd-user-input");
            if (input) try { input.focus(); } catch (focusError) {}
        }
    }
    function submitJvhdUserGate() {
        if (!jvhdUserGateOpen || jvhdUserChecking) return;
        if (jvhdUserLockRemaining() > 0) { updateJvhdUserGate(); return; }
        var input = document.getElementById("bintv-jvhd-user-input");
        var status = document.getElementById("bintv-jvhd-user-status");
        var name = input ? String(input.value || "").trim().toLowerCase() : "";
        if (!name) {
            if (status) status.textContent = "Vui lòng nhập tên người dùng";
            return;
        }
        var digest = jvhdUserNativeHash(name);
        if (!digest) {
            // Fail-closed: thiet bi khong co native hash -> khong cho qua.
            if (status) status.textContent = "Thiết bị không hỗ trợ xác thực, không thể tiếp tục";
            return;
        }
        jvhdUserChecking = true;
        var gate = document.getElementById("bintv-jvhd-user-gate");
        if (gate) gate.classList.add("busy");
        if (status) status.textContent = "Đang kiểm tra…";
        requestJson(JVHD_USER_HASH_URL + "?ts=" + Date.now(), 15000, function (data) {
            jvhdUserChecking = false;
            var busyGate = document.getElementById("bintv-jvhd-user-gate");
            if (busyGate) busyGate.classList.remove("busy");
            if (!jvhdUserGateOpen) return;
            var record = data && data.record;
            var allowed = false;
            if (Object.prototype.toString.call(record) === "[object Array]") {
                for (var i = 0; i < record.length; i++) if (typeof record[i] === "string" && record[i] === digest) { allowed = true; break; }
            }
            if (allowed) {
                jvhdUserWriteNum("jvhdUserFails", 0);
                jvhdUserRemove("jvhdUserLockUntil");
                closeJvhdUserGate(true);
                return;
            }
            var fails = jvhdUserReadNum("jvhdUserFails") + 1;
            var failStatus = document.getElementById("bintv-jvhd-user-status");
            if (fails >= JVHD_USER_FAIL_LIMIT) {
                jvhdUserWriteNum("jvhdUserFails", JVHD_USER_FAIL_LIMIT);
                jvhdUserWriteNum("jvhdUserLockUntil", Date.now() + JVHD_USER_LOCK_MS);
                var lockedInput = document.getElementById("bintv-jvhd-user-input");
                if (lockedInput) lockedInput.value = "";
                startJvhdUserCountdown();
            } else {
                jvhdUserWriteNum("jvhdUserFails", fails);
                if (failStatus) failStatus.textContent = "Tên người dùng không đúng (còn " + (JVHD_USER_FAIL_LIMIT - fails) + " lần)";
            }
        }, function () {
            jvhdUserChecking = false;
            var errGate = document.getElementById("bintv-jvhd-user-gate");
            if (errGate) errGate.classList.remove("busy");
            if (!jvhdUserGateOpen) return;
            var errStatus = document.getElementById("bintv-jvhd-user-status");
            if (errStatus) errStatus.textContent = "Không tải được danh sách xác thực, thử lại";
        });
    }
    function handleJvhdUserGateKey(left, right, up, down, ok, event) {
        if (!jvhdUserGateOpen) return false;
        var input = document.getElementById("bintv-jvhd-user-input");
        var confirmButton = document.getElementById("bintv-jvhd-user-confirm");
        if (jvhdUserLockRemaining() > 0) { if (event) event.preventDefault(); return true; }
        if (ok) {
            if (event) event.preventDefault();
            submitJvhdUserGate();
            return true;
        }
        var fromInput = !!(event && event.target && event.target === input);
        if (fromInput) {
            if (up && confirmButton) { confirmButton.focus(); if (event) event.preventDefault(); }
            return true; // ky tu/Backspace/<- ->: giu mac dinh de go duoc chu vao input
        }
        if (down && input) input.focus();
        if (event) event.preventDefault();
        return true;
    }

    function openJvhdScreen(sources) {
        jvhdSources = sources || [];
        if (!jvhdSources.length) { showToast("Không có nguồn JVHD"); return; }
        jvhdActiveSource = 0;
        jvhdGridIndex = 0;
        jvhdFocusArea = "sidebar";
        var screen = ensureJvhdScreen();
        buildJvhdSidebar();
        try { if (document.body) document.body.classList.add("bintv-jvhd-mode"); } catch (jvhdModeError) {}
        screen.classList.add("show");
        jvhdScreenOpen = true;
        renderJvhdGrid();
        updateJvhdFocus();
        selectJvhdSource(0);
    }

    function closeJvhdScreen() {
        if (jvhdPinOpen) cancelJvhdPinGate(false);
        stopJvhdLivePosterRefresh(); // [BinTV LIVE-PREVIEW 2026-08]
        jvhdLiveWarmSerial++;        // [BinTV LIVE-SPEED] hủy warm-up ngầm khi đóng màn hình
        try { if (document.body) document.body.classList.remove("bintv-jvhd-mode"); } catch (jvhdModeError) {}
        if (!jvhdScreenOpen && !document.getElementById("bintv-jvhd-screen")) return;
        cancelJvhdResolution(false);
        if (jvhdPlayerSession) closeJvhdPlayback(false);
        jvhdSourceLoadToken++;
        jvhdScreenOpen = false;
        var screen = document.getElementById("bintv-jvhd-screen");
        if (screen) screen.classList.remove("show");
        focusApp();
    }

    function launchBuiltinJvhd() {
        if (jvhdLaunchInProgress || jvhdPinOpen || jvhdScreenOpen) return;
        openJvhdPinGate();
    }

    // Điều hướng remote riêng cho JVHD. Header chỉ là logo nên không nhận focus.
    function handleJvhdScreenKey(left, right, up, down, ok) {
        if (!jvhdScreenOpen) return false;
        if (jvhdResolveInProgress) return true;
        if (jvhdFocusArea === "sidebar") {
            if (up && jvhdActiveSource > 0) selectJvhdSource(jvhdActiveSource - 1);
            else if (down && jvhdActiveSource < jvhdSources.length - 1) selectJvhdSource(jvhdActiveSource + 1);
            else if (right && currentJvhdItems().length) { jvhdFocusArea = "grid"; jvhdGridIndex = Math.min(jvhdGridIndex, currentJvhdItems().length - 1); updateJvhdFocus(); }
            else if (ok && !okKeyDown) { okKeyDown = true; suppressNextOkUp = true; selectJvhdSource(jvhdActiveSource); }
            return true;
        }
        var cols = jvhdGridColumns();
        var total = currentJvhdItems().length;
        if (ok && total) {
            if (!okKeyDown) { okKeyDown = true; suppressNextOkUp = true; var item = currentJvhdItems()[jvhdGridIndex]; if (item) openJvhdItem(item); }
            return true;
        }
        if (up) {
            if (jvhdGridIndex - cols >= 0) jvhdGridIndex -= cols;
            else { jvhdFocusArea = "sidebar"; }
            updateJvhdFocus();
            return true;
        }
        if (down && jvhdGridIndex + cols < total) { jvhdGridIndex += cols; updateJvhdFocus(); return true; }
        if (left) {
            if (jvhdGridIndex % cols === 0) jvhdFocusArea = "sidebar";
            else if (jvhdGridIndex > 0) jvhdGridIndex--;
            updateJvhdFocus();
            return true;
        }
        if (right && jvhdGridIndex < total - 1) { jvhdGridIndex++; updateJvhdFocus(); return true; }
        return true;
    }

    function launchBuiltinMovie() {
        try { phimLog("launchBuiltinMovie: start", { inProgress: movieLaunchInProgress, browserOpen: movieBrowserOpen }); } catch (e) {}
        if (movieLaunchInProgress || movieBrowserOpen) return;
        movieLaunchInProgress = true;
        var cachedBootstrap = getMovieBootstrapCache();
        var openedFromCache = false;
        if (cachedBootstrap) {
            try { phimLog("launchBuiltinMovie: using cache", { manifestUrl: cachedBootstrap.manifestUrl }); } catch (e) {}
            openedFromCache = true;
            showToast("Đang mở Phim từ Cache…");
            openMovieBrowser(cachedBootstrap.manifestUrl, cachedBootstrap.manifest);
        } else {
            try { phimLog("launchBuiltinMovie: no cache, fetching from network"); } catch (e) {}
            showToast("Đang tải cấu hình Phim…");
        }

        fetchMovieBootstrapShared(function (payload) {
            try { phimLog("launchBuiltinMovie: bootstrap success", { openedFromCache: openedFromCache }); } catch (e) {}
            if (openedFromCache) {
                if (!movieBrowserOpen) return;
                if (payload.manifestUrl !== movieManifestUrl) {
                    closeMovieBrowser();
                    openMovieBrowser(payload.manifestUrl, payload.manifest);
                }
                return;
            }
            movieLaunchInProgress = false;
            openMovieBrowser(payload.manifestUrl, payload.manifest);
        }, function (error) {
            try { phimLog("launchBuiltinMovie: bootstrap failed", { error: error && error.message, openedFromCache: openedFromCache }); } catch (e) {}
            if (openedFromCache) {
                if (movieBrowserOpen) showToast("Không thể cập nhật nguồn, đang dùng Cache");
                return;
            }
            movieLaunchInProgress = false;
            // [Phim LAN14-fix] Hien thi status truc tiep, khong de loading vo han
            showMovieStatus("Không thể tải cấu hình Phim: " + (error && error.message || "Lỗi không xác định"), true);
            var directMessage = String((error && error.message) || "");
            if (directMessage.indexOf("target_url") !== -1 || directMessage.indexOf("Manifest Phim") !== -1) showToast(directMessage);
            else showToast(getMovieRequestErrorMessage("Không thể tải cấu hình Phim", error));
        });
    }

    function launch() {
        if (isMovingApp || isMultiSelectMode || actionMenuOpen || exitModalOpen || jvhdPinOpen) return;
        var item = apps[index]; if (!item || !item.id) return;
        if (isBuiltinJvhdApp(item)) { launchBuiltinJvhd(); return; }
        if (isBuiltinMovieApp(item)) { launchBuiltinMovie(); return; }
        if (TEST_MODE) return;
        try { tizen.application.launch(item.id, function () { trackLaunchedApp(item.id); }, function () {}); } catch (e) {}
    }

    /* =====================================================
       REMOTE CONTROLLER
       ===================================================== */
    function isKey(e, code, name) {
        if (!e) return false;
        var eventCode = Number(e.keyCode || e.which || e.charCode || 0);
        if (eventCode === code) return true;
        var expected = String(name || "").toLowerCase();
        var shortExpected = expected.indexOf("arrow") === 0 ? expected.substring(5) : expected;
        var names = [e.key, e.code, e.keyIdentifier];
        for (var i = 0; i < names.length; i++) {
            var actual = String(names[i] || "").toLowerCase();
            if (actual === expected || actual === shortExpected) return true;
        }
        return false;
    }

    function isMovieVoiceRemoteEvent(e) {
        if (!e) return false;
        var keyCode = String(e.keyCode || e.which || e.charCode || "");
        if (keyCode && movieVoiceRemoteKeyCodes[keyCode]) return true;
        var names = [e.key, e.code, e.keyIdentifier, e.keyName];
        for (var i = 0; i < names.length; i++) if (/(voice|mic|search)/i.test(String(names[i] || ""))) return true;
        return false;
    }

    function startLongPressTimer() {
        if (okPressTimer || longPressTriggered) return;
        okPressTimer = setTimeout(function () {
            okPressTimer = null; longPressTriggered = true;
            if (!isMovingApp && !isMultiSelectMode && !actionMenuOpen) showActionMenu();
        }, 700);
    }

    function cancelLongPressTimer() { if (okPressTimer) { clearTimeout(okPressTimer); okPressTimer = null; } }

    window.addEventListener("keydown", function (e) {
        if (isMovieSearchKeyboardEditing()) return;
        if (isRemoteBackEvent(e) || isRemoteExitEvent(e)) { handleRemoteBackOrExit(e); return; }
        if (cleanupInProgress) { e.preventDefault(); return; }
        var left = isKey(e, 37, "ArrowLeft") || isKey(e, 412, "MediaRewind");
        var right = isKey(e, 39, "ArrowRight") || isKey(e, 417, "MediaFastForward");
        var up = isKey(e, 38, "ArrowUp"), down = isKey(e, 40, "ArrowDown");
        var ok = isKey(e, 13, "Enter") || (movieSearchOpen && isKey(e, 65376, "Done"));

        // [BinTV USER-AUTH 2026-08] Man username: tu xu ly phim, khong preventDefault
        // khi dang go chu vao o input de ban phim/remote van nhap duoc.
        if (jvhdUserGateOpen) { handleJvhdUserGateKey(left, right, up, down, ok, e); return; }

        if (jvhdPinOpen) { handleJvhdPinKey(left, right, up, down, ok, e); e.preventDefault(); return; }

        if (handleMovieInterfaceKey(left, right, up, down, ok, e)) { e.preventDefault(); return; }

        if (jvhdScreenOpen) { handleJvhdScreenKey(left, right, up, down, ok); e.preventDefault(); return; }

        if (exitModalOpen) {
            if (left || right) {
                var exitModal = document.getElementById("bintv-exit-modal");
                if (exitModal) {
                    var exitIndex = parseInt(exitModal.getAttribute("data-focus-index") || "0", 10);
                    var exitButtons = exitModal.querySelectorAll(".bintv-exit-button");
                    exitIndex += right ? 1 : -1;
                    if (exitIndex < 0) exitIndex = exitButtons.length - 1;
                    if (exitIndex >= exitButtons.length) exitIndex = 0;
                    exitModal.setAttribute("data-focus-index", String(exitIndex)); updateExitModalFocus();
                }
                e.preventDefault(); return;
            }
            if (up || down) { e.preventDefault(); return; }
            if (ok) {
                if (exitModalOkDown) { e.preventDefault(); return; }
                exitModalOkDown = true; suppressNextOkUp = true;
                var exitModalCurrent = document.getElementById("bintv-exit-modal");
                if (exitModalCurrent) {
                    var exitRows = exitModalCurrent.querySelectorAll(".bintv-exit-button");
                    var exitSelected = parseInt(exitModalCurrent.getAttribute("data-focus-index") || "0", 10);
                    if (exitRows[exitSelected]) exitRows[exitSelected].click();
                }
                e.preventDefault(); return;
            }
            e.preventDefault(); return;
        }

        if (actionMenuOpen) {
            if (up) { var menu = document.getElementById("bintv-app-menu"); var selected = parseInt(menu.getAttribute("data-menu-index")||"0",10)-1; menu.setAttribute("data-menu-index", String(selected)); updateMenuFocus(); e.preventDefault(); return; }
            if (down) { var m = document.getElementById("bintv-app-menu"); var sel = parseInt(m.getAttribute("data-menu-index")||"0",10)+1; m.setAttribute("data-menu-index", String(sel)); updateMenuFocus(); e.preventDefault(); return; }
            if (left || right) { e.preventDefault(); return; }
            if (ok) { if (okKeyDown) { e.preventDefault(); return; } okKeyDown = true; suppressNextOkUp = true; activateMenuItem(); e.preventDefault(); return; }
            if (e.key === "Escape" || (e.keyCode || e.which) === 10009) { closeActionMenu(); e.preventDefault(); return; }
            return;
        }

        if (isMultiSelectMode) {
            if (left && index > 0) { index--; focusApp(); e.preventDefault(); return; }
            if (right && index < apps.length - 1) { index++; focusApp(); e.preventDefault(); return; }
            if (up) { showMultiSelectMenu(); e.preventDefault(); return; }
            if (down) { e.preventDefault(); return; }
            if (ok) { if (okKeyDown) { e.preventDefault(); return; } okKeyDown = true; toggleSelectedCurrentApp(); updateMultiSelectBar(); e.preventDefault(); return; }
            return;
        }

        if (isMovingApp) {
            if (left && index > 0) {
                if (isBuiltinMovieApp(apps[index]) || isBuiltinMovieApp(apps[index - 1])) { showToast("Phim luôn nằm đầu danh sách Favorite"); e.preventDefault(); return; }
                var tApp = apps[index]; apps[index] = apps[index-1]; apps[index-1] = tApp;
                var tBtn = buttons[index]; buttons[index] = buttons[index-1]; buttons[index-1] = tBtn;
                appsContainer.insertBefore(buttons[index-1], buttons[index]); index--; focusApp(); e.preventDefault(); return;
            }
            if (right && index < apps.length - 1) {
                if (isBuiltinMovieApp(apps[index]) || isBuiltinMovieApp(apps[index + 1])) { showToast("Phim luôn nằm đầu danh sách Favorite"); e.preventDefault(); return; }
                var trApp = apps[index]; apps[index] = apps[index+1]; apps[index+1] = trApp;
                var trBtn = buttons[index]; buttons[index] = buttons[index+1]; buttons[index+1] = trBtn;
                appsContainer.insertBefore(buttons[index+1], buttons[index].nextSibling); index++; focusApp(); e.preventDefault(); return;
            }
            if (ok) { if (okKeyDown) { e.preventDefault(); return; } okKeyDown = true; dropMoveMode(); e.preventDefault(); return; }
            e.preventDefault(); return;
        }

        if (left) { cancelLongPressTimer(); if (index > 0) { index--; focusApp(); } e.preventDefault(); return; }
        if (right) { cancelLongPressTimer(); if (index < apps.length - 1) { index++; focusApp(); } e.preventDefault(); return; }
        if (up || down) { cancelLongPressTimer(); e.preventDefault(); return; }
        if (ok) { if (okKeyDown) { e.preventDefault(); return; } okKeyDown = true; longPressTriggered = false; startLongPressTimer(); e.preventDefault(); }
    }, true);

    window.addEventListener("keyup", function (e) {
        if (isMovieSearchKeyboardEditing()) return;
        if (handleMovieScrubKeyUp(e)) { e.preventDefault(); return; }
        if (cleanupInProgress) { e.preventDefault(); return; }
        if (!isKey(e, 13, "Enter")) return;
        cancelLongPressTimer();
        if (movieBrowserOpen || moviePlayerOpen || movieEpisodeOpen) { longPressTriggered = false; okKeyDown = false; e.preventDefault(); return; }
        if (suppressNextOkUp) { suppressNextOkUp = false; longPressTriggered = false; okKeyDown = false; exitModalOkDown = false; e.preventDefault(); return; }
        if (actionMenuOpen || isMovingApp || isMultiSelectMode) { longPressTriggered = false; okKeyDown = false; e.preventDefault(); return; }
        if (longPressTriggered) { longPressTriggered = false; okKeyDown = false; e.preventDefault(); return; }
        okKeyDown = false; launch(); e.preventDefault();
    }, true);

    window.addEventListener("tizenhwkey", function (e) {
        if (isMovieSearchKeyboardEditing()) return;
        var keyName = String((e && e.keyName) || "").toLowerCase();
        if (keyName === "back" || keyName === "exit") handleRemoteBackOrExit(e);
    }, true);


    // =================================================================
    // [BinTV iOS lifecycle] STATE CONTRACT FOR WKWEBVIEW RECOVERY
    //
    // This app is also shipped to Android/Tizen/Windows, where pagehide is a
    // real standalone-app teardown.  The contract below is inert until the
    // iOS host injects __bintvPhimHostLifecycle.  It captures only app-owned
    // PHIM state, lets Swift retain it across a WebContent replacement, and
    // restores the current browser/player rather than merely reloading a
    // blank page.
    // =================================================================
    var movieLifecycleRestoreToken = 0;

    function movieLifecycleCopy(value, fallback) {
        try { return JSON.parse(JSON.stringify(value)); } catch (e) { return fallback; }
    }

    function movieLifecycleNumber(value, fallback) {
        var number = Number(value);
        return isFinite(number) && number >= 0 ? number : fallback;
    }

    function movieLifecycleCurrentItem() {
        var item = null;
        try { item = movieCurrentSubtitleContext || null; } catch (e) {}
        if (!item || !item.id) {
            try { item = movieItems && movieItems[movieItemIndex] ? movieItems[movieItemIndex] : null; } catch (e2) {}
        }
        if (!item || !item.id) {
            try { item = movieAllItems && movieAllItems[movieItemIndex] ? movieAllItems[movieItemIndex] : null; } catch (e3) {}
        }
        if (!item) return {};
        return {
            id: String(item.id || ""),
            type: String(item.type || movieEpisodeType || "movie"),
            name: String(item.name || item.title || movieCurrentStreamTitle || movieEpisodeTitle || "Phim"),
            item: movieLifecycleCopy(item, null)
        };
    }

    function movieLifecyclePlaybackPosition() {
        var position = movieLifecycleNumber(movieLastKnownPlaybackMilliseconds, 0);
        try {
            var video = document.getElementById("bintv-movie-html5-player");
            var seconds = Number(video && video.currentTime);
            if (isFinite(seconds) && seconds >= 0) position = Math.max(position, Math.round(seconds * 1000));
        } catch (e) {}
        return position;
    }

    function isMovieHtmlVideoFullscreen() {
        try {
            var v = document.getElementById("bintv-movie-html5-player");
            if (!v) return false;
            if (v.webkitDisplayingFullscreen) return true;
            if (v.webkitPresentationMode === "fullscreen") return true;
            if (document.webkitFullscreenElement === v || document.fullscreenElement === v) return true;
        } catch (e) {}
        return false;
    }

    function captureMovieLifecycleState() {
        var selected = movieLifecycleCurrentItem();
        var htmlPaused = false;
        try {
            var video = document.getElementById("bintv-movie-html5-player");
            htmlPaused = !!(video && video.paused);
        } catch (e) {}
        return {
            version: 2,
            capturedAt: Date.now(),
            browserOpen: !!movieBrowserOpen,
            screen: moviePlayerOpen ? "player" : (movieEpisodeOpen ? "episodes" : (movieSearchOpen ? "search" : "browser")),
            catalog: {
                index: movieCatalogIndex,
                identity: String(movieActiveCatalogIdentity || ""),
                filterMode: String(movieFilterMode || "all"),
                filterIndex: movieFilterIndex,
                focusArea: String(movieBrowserFocusArea || "catalogs"),
                itemIndex: movieItemIndex,
                searchOpen: !!movieSearchOpen,
                searchQuery: String(movieSearchQuery || "")
            },
            selectedMovie: selected,
            episode: {
                open: !!movieEpisodeOpen,
                index: movieEpisodeIndex,
                currentIndex: movieCurrentEpisodeIndex,
                type: String(movieEpisodeType || "series"),
                title: String(movieEpisodeTitle || ""),
                meta: movieLifecycleCopy(movieEpisodeMeta, null),
                videos: movieLifecycleCopy(movieEpisodes, [])
            },
            player: {
                open: !!moviePlayerOpen,
                paused: !!(moviePlayerPaused || (!movieNativeHandoffActive && htmlPaused)),
                positionMs: movieLifecyclePlaybackPosition(),
                native: !!movieNativeHandoffActive,
                fullscreen: !!(window.__binTVVideoFullscreen || (movieNativeHandoffActive && moviePlayerOpen) || isMovieHtmlVideoFullscreen())
            },
            source: {
                url: String(movieCurrentStreamUrl || ""),
                proxyUrl: String(movieCurrentStreamProxyUrl || ""),
                referer: String(movieCurrentStreamReferer || ""),
                title: String(movieCurrentStreamTitle || ""),
                streamInfo: movieLifecycleCopy(movieCurrentStreamInfo, null),
                subtitleContext: movieLifecycleCopy(movieCurrentSubtitleContext, null),
                nativeSession: String(movieNativePlaybackSession || "")
            }
        };
    }

    function movieLifecycleRestoreCatalog(state, token, attempt) {
        if (token !== movieLifecycleRestoreToken || !state || !state.browserOpen) return;
        var catalog = state.catalog || {};
        if (!movieBrowserOpen) {
            if (attempt < 20) setTimeout(function () { movieLifecycleRestoreCatalog(state, token, attempt + 1); }, 180);
            return;
        }
        movieFilterMode = String(catalog.filterMode || "all");
        movieFilterIndex = movieLifecycleNumber(catalog.filterIndex, 0);
        movieBrowserFocusArea = String(catalog.focusArea || "catalogs");
        var desiredIdentity = String(catalog.identity || "");
        var desiredIndex = movieLifecycleNumber(catalog.index, 0);
        var found = -1;
        for (var i = 0; i < movieCatalogs.length; i++) {
            if (desiredIdentity && getMovieCatalogIdentity(movieCatalogs[i], movieBaseUrl) === desiredIdentity) { found = i; break; }
        }
        if (found >= 0) desiredIndex = found;
        if (movieCatalogs.length) {
            desiredIndex = Math.max(0, Math.min(movieCatalogs.length - 1, desiredIndex));
            movieCatalogIndex = desiredIndex;
            movieActiveCatalogIdentity = desiredIdentity || getMovieCatalogIdentity(movieCatalogs[desiredIndex], movieBaseUrl);
            renderMovieCatalogs();
            // Load once; later passes only recover focus after catalog data
            // reaches the DOM, avoiding duplicate network/catalog work.
            if (attempt === 0) loadMovieCatalog(desiredIndex, 0);
        } else if (attempt < 20) {
            setTimeout(function () { movieLifecycleRestoreCatalog(state, token, attempt + 1); }, 180);
            return;
        }
        var selectedId = String(state.selectedMovie && state.selectedMovie.id || "");
        var targetIndex = movieLifecycleNumber(catalog.itemIndex, 0);
        for (var j = 0; j < movieItems.length; j++) {
            if (selectedId && movieItems[j] && String(movieItems[j].id || "") === selectedId) { targetIndex = j; break; }
        }
        if (movieItems.length) movieItemIndex = Math.max(0, Math.min(movieItems.length - 1, targetIndex));
        try { updateMovieBrowserFocus(); } catch (focusError) {}
        // Catalog caches can populate asynchronously after the page rebuild.
        // Retry focus only (not the load) for a bounded period.
        if (attempt < 6) setTimeout(function () { movieLifecycleRestoreCatalog(state, token, attempt + 1); }, 250);
    }

    function movieLifecycleOpenBrowser(state, token) {
        if (!state || !state.browserOpen) return;
        if (movieBrowserOpen) {
            movieLifecycleRestoreCatalog(state, token, 0);
            return;
        }
        var cache = null;
        try { cache = getMovieBootstrapCache(); } catch (e) {}
        if (cache && cache.manifestUrl && cache.manifest) {
            openMovieBrowser(cache.manifestUrl, cache.manifest);
        } else {
            // Bootstrap remains the authoritative configuration path; this
            // does not alter a movie JSON source or invent a direct URL.
            launchBuiltinMovie();
        }
        movieLifecycleRestoreCatalog(state, token, 0);
    }

    function movieLifecycleShowNativePlayerShell(state) {
        var source = state.source || {};
        var playerState = state.player || {};
        ensureMovieExperienceUI();
        try { if (document.body) document.body.classList.add("bintv-movie-mode"); } catch (e) {}
        movieBrowserOpen = true;
        moviePlayerOpen = true;
        moviePlayerPaused = !!playerState.paused;
        movieNativeHandoffActive = true;
        movieCurrentStreamUrl = String(source.url || "");
        movieCurrentStreamProxyUrl = String(source.proxyUrl || "");
        movieCurrentStreamReferer = String(source.referer || "");
        movieCurrentStreamTitle = String(source.title || (state.selectedMovie && state.selectedMovie.name) || "Phim");
        movieCurrentStreamInfo = source.streamInfo || null;
        movieCurrentSubtitleContext = source.subtitleContext || (state.selectedMovie && state.selectedMovie.item) || null;
        var sessionNumber = Number(source.nativeSession);
        if (isFinite(sessionNumber) && sessionNumber >= 0) movieNativePlaybackSession = sessionNumber;
        var browser = document.getElementById("bintv-movie-browser");
        var player = document.getElementById("bintv-movie-player");
        if (browser) browser.classList.add("show", "player-active");
        if (player) player.classList.add("show");
        // [build 242] không ghi tên phim lên player (phần tử title đã bị gỡ);
        // movieCurrentStreamTitle vẫn được giữ cho log/lifecycle như cũ.
        updateMoviePlayerStatus(moviePlayerPaused ? "Tạm dừng (trình phát gốc iOS)" : "Đang phát (trình phát gốc iOS)");
    }

    function movieLifecycleResumeWebPlayer(state) {
        var source = state.source || {};
        var playerState = state.player || {};
        var sourceUrl = String(source.url || "");
        if (!sourceUrl) return;
        // Go back through the normal player path so proxy/header/fallback
        // behavior stays identical to a user-selected movie.
        startMoviePlayback(sourceUrl,
            String(source.title || (state.selectedMovie && state.selectedMovie.name) || "Phim"),
            source.subtitleContext || (state.selectedMovie && state.selectedMovie.item) || null);
        var desiredMs = movieLifecycleNumber(playerState.positionMs, 0);
        var shouldPause = !!playerState.paused;
        var shouldFullscreen = !!playerState.fullscreen;
        var tries = 0;
        function seekWhenReady() {
            var video = document.getElementById("bintv-movie-html5-player");
            if (!video) return;
            if (video.readyState < 1 && tries++ < 24) { setTimeout(seekWhenReady, 200); return; }
            if (desiredMs > 0) {
                try { video.currentTime = desiredMs / 1000; } catch (e) {}
                syncMoviePlaybackClock(desiredMs, !shouldPause);
            }
            moviePlayerPaused = shouldPause;
            if (shouldPause) {
                try { video.pause(); } catch (pauseError) {}
                updateMoviePlayerStatus("Tạm dừng");
            }
            if (shouldFullscreen && typeof window.__bintvRestoreFullscreenIfNeeded === "function") {
                try { window.__bintvRestoreFullscreenIfNeeded({ paused: shouldPause }); } catch (fsErr) {}
            }
        }
        setTimeout(seekWhenReady, 0);
    }

    function restoreMovieLifecycleState(state, options) {
        var snapshot = state && typeof state === "object" ? state : null;
        if (!snapshot || Number(snapshot.version || 0) < 1) return "no-state";
        var token = ++movieLifecycleRestoreToken;
        movieLifecycleOpenBrowser(snapshot, token);
        if (snapshot.screen === "episodes" && snapshot.episode && Array.isArray(snapshot.episode.videos)) {
            setTimeout(function () {
                if (token !== movieLifecycleRestoreToken) return;
                showMovieEpisodes(snapshot.episode.videos,
                    snapshot.episode.type || "series",
                    snapshot.episode.title || "Phim",
                    snapshot.episode.meta || null);
                movieEpisodeIndex = movieLifecycleNumber(snapshot.episode.index, 0);
                movieCurrentEpisodeIndex = movieLifecycleNumber(snapshot.episode.currentIndex, -1);
                updateMovieEpisodeFocus();
            }, 0);
        }
        if (snapshot.player && snapshot.player.open) {
            setTimeout(function () {
                if (token !== movieLifecycleRestoreToken) return;
                if (snapshot.player.native) movieLifecycleShowNativePlayerShell(snapshot);
                else movieLifecycleResumeWebPlayer(snapshot);
            }, 0);
        }
        return options && options.rebuilt ? "restored-rebuilt" : "restored-live";
    }

    window.__bintvPhimLifecycle = {
        capture: captureMovieLifecycleState,
        restore: restoreMovieLifecycleState
    };

    function isBintvIosLifecycleHost() {
        try {
            return !!(window.__bintvIosNativeBridge
                && window.__bintvPhimHostLifecycle
                && window.webkit && window.webkit.messageHandlers
                && window.webkit.messageHandlers.phimLifecycle);
        }
        catch (e) { return false; }
    }

    function captureBintvIosLifecycle(reason) {
        try {
            if (window.__bintvPhimHostLifecycle && typeof window.__bintvPhimHostLifecycle.capture === "function") {
                window.__bintvPhimHostLifecycle.capture(reason);
            }
        } catch (e) {}
    }

    document.addEventListener("visibilitychange", function () {
        if (isBintvIosLifecycleHost()) {
            if (document.hidden) captureBintvIosLifecycle("app-js-visibilitychange");
            return;
        }
        if (document.hidden) clearSessionReferences(); else resumeSessionResources();
    }, false);
    window.addEventListener("pagehide", function () {
        if (isBintvIosLifecycleHost()) {
            captureBintvIosLifecycle("app-js-pagehide");
            return;
        }
        if (wallpaperTimer) { clearInterval(wallpaperTimer); wallpaperTimer = null; }
        if (movieBrowserOpen || moviePlayerOpen) closeMovieBrowser();
        cancelLongPressTimer();
        closeActionMenu();
        closeJvhdScreen();
    }, false);

    function updateDateTime() {
        var now = new Date();
        var dElement = document.getElementById("date"), cElement = document.getElementById("clock");
        if(dElement && cElement) {
            dElement.textContent = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"][now.getDay()] + ", " +
                (now.getDate()<10?"0":"")+now.getDate() + "/" + (now.getMonth()+1<10?"0":"")+(now.getMonth() + 1) + "/" + now.getFullYear();
            cElement.textContent = (now.getHours()<10?"0":"")+now.getHours() + ":" + (now.getMinutes()<10?"0":"")+now.getMinutes();
        }
    }

    function init() {
        registerRemoteExitKey();
        // [BinTV JVHD-STANDALONE 2026-08] Bản JVHD độc lập: khởi động thẳng vào
        // cổng PIN, KHÔNG tạo wallpaper/đồng hồ/thời tiết/danh sách app của
        // BinTV (không request mạng nào cho thời tiết, không timer nền) ->
        // ứng dụng nhẹ và mượt hơn. Bản BinTV gốc không set flag -> giữ nguyên
        // toàn bộ quá trình khởi động như cũ.
        if (BINTV_JVHD_STANDALONE) { setTimeout(launchBuiltinJvhd, 0); return; }
        // [BinTV-PHIM-STANDALONE 2026-09] Phim standalone: KHONG load bg1..bg5.jpg,
        // KHONG xoay wallpaper, KHONG goi weather/datetime. Chi goi
        // scheduleMovieBackgroundPrefetch de Phim chay nen.
        if (window.__BINTV_PHIM_STANDALONE__) {
            scheduleMovieBackgroundPrefetch();
            return;
        }
        initBackgroundLayers(); startWallpaperRotation();
        ensureWeatherElement();
        updateDateTime(); dateTimeTimer = setInterval(updateDateTime, 1000);
        updateWeather(true); weatherTimer = setInterval(function () { updateWeather(true); }, WEATHER_CACHE_TTL);
        loadInstalledApps(function () { createApps(); focusApp(); scheduleMovieBackgroundPrefetch(); });
    }

    window.addEventListener("DOMContentLoaded", init);

    // [BinTV-PHIM-STANDALONE 2026-09] Patch de tu dong mo Phim khi load
    // (thay vi hien thi launcher BinTV goc). Khi window.__BINTV_PHIM_STANDALONE__ = true
    // (duoc khai bao trong index.html), se:
    //   1. An launcher (header, main)
    //   2. Tu dong goi launchBuiltinMovie() khi script nay da thuc thi xong
    if (window.__BINTV_PHIM_STANDALONE__) {
        // An launcher BinTV (header, main) neu co - lam ngay khi IIFE chay xong
        try {
            var phimHeader = document.querySelector("header");
            if (phimHeader) phimHeader.style.display = "none";
            var phimMain = document.querySelector("main");
            if (phimMain) phimMain.style.display = "none";
        } catch (e) {}
        // Dam bao browser Phim hien thi
        var phimBrowserEl = document.getElementById("bintv-movie-browser");
        if (phimBrowserEl) phimBrowserEl.classList.add("show");

        // Ham nay co the goi nhieu lan - moi lan chi that bai neu launchBuiltinMovie chua san sang
        function phimStandaloneTryLaunch() {
            if (typeof launchBuiltinMovie !== "function") return false;
            if (window.__phimStandaloneLaunched) return true;
            window.__phimStandaloneLaunched = true;
            try {
                if (typeof showMovieStatus === "function") showMovieStatus("Dang mo Phim...", false);
                launchBuiltinMovie();
            } catch (e) {
                console.error("[Phim] Launch error:", e);
                if (typeof showMovieStatus === "function") showMovieStatus("Khong the khoi dong Phim: " + (e.message || e), true);
            }
            return true;
        }

        // Retry khi app.js IIFE dang khoi tao - launchBuiltinMovie duoc khai bao trong IIFE
        // nen co the chua ready khi IIFE vua chay xong
        var phimAttempts = 0;
        (function phimStandaloneBootstrap() {
            if (phimStandaloneTryLaunch()) return;
            if (phimAttempts++ < 200) setTimeout(phimStandaloneBootstrap, 50);
            else if (typeof showMovieStatus === "function") showMovieStatus("Khong the khoi dong Phim (app.js chua san sang)", true);
        })();
    }
})();
