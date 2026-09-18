/* =====================================================================
 * BinTV iOS — TEST LUỒNG NATIVE HANDOFF CỦA TAB PHIM (build 231)
 *
 * Chạy:  cd tests/ios-native-handoff && npm install && node run.js
 * (chỉ cần `jsdom`; KHÔNG đụng Xcode, KHÔNG cần iPhone)
 *
 * Test gì (đúng lỗi đã sửa: bấm xem phim trên iPhone → "Không thể phát
 * trên TV"):
 *   SUITE A — CẦU NỐI JS ↔ Swift trong WKWebView:
 *     • script tiêm từ Swift (nativeHandoffJS) có tồn tại + postMessage
 *       đúng chữ ký { url: streamUrl, title: … } của WKScriptMessageHandler
 *       `playVideoNative`;
 *     • bắt sự kiện người dùng CLICK thẻ phim (ghi id + tên phim);
 *     • app.js trích đúng URL GỐC từ src dạng /proxy?url=… (kèm Referer
 *       __ref), gửi kèm proxyUrl + reason + session;
 *     • chống gửi lặp cùng một nguồn; callback cũ (lệch session) bị loại;
 *     • native báo FAIL → thông báo KHÔNG còn chữ "trên TV";
 *     • native đóng (Done) → dọn overlay player web, về lưới phim;
 *     • KHÔNG có window.webkit (Android/Tizen/Windows) → mọi hàm trả false
 *       = hành vi cũ giữ nguyên 100%.
 *   SUITE B — PHÂN LOẠI NGUỒN (container/codec) quyết định handoff sớm:
 *     MKV/AVI/FLV/WMV/RMVB/DIVX/MPG → native; MP4 + AC3/EAC3/DTS/TrueHD/
 *     Atmos → native; HLS → để web thử trước; không dính false-positive
 *     (đuôi nằm trong query, "dtsxtra", …).
 *   SUITE E (build 236) — KẾT THÚC PHÁT, PHIM BỘ / PHIM LẺ:
 *     BỘ còn tập: hết tập → KHÔNG tự phát tập kế; giữ player + mở danh sách
 *     tập trong player; BỘ hết tập cuối → về CHỌN TẬP; LẺ hết → về lưới PHIM.
 *   SUITE H (build 242) — GỠ NÚT "TẬP" + TÊN PHIM KHỎI TRÌNH PHÁT:
 *     player web (index.html/app.js/CSS) và player native iOS KHÔNG còn nút
 *     TẬP/tiêu đề vẽ đè lên video; TẬP chỉ mở từ menu long-press qua điểm vào
 *     window.__bintvOpenPlayerEpisodes (web) / requestEpisodePicker (native).
 *   SUITE F (build 234) — ƯU TIÊN TRÌNH PHÁT + GESTURE ĐIỀU HƯỚNG:
 *     Ưu tiên 1 = trình phát TÍCH HỢP của app (thẻ <video>): nguồn MKV/AC3
 *     cũng KHÔNG được handoff sớm sang trình phát iOS; chỉ khi trình phát
 *     tích hợp THẤT BẠI mới fallback (reason "web-streams-exhausted").
 *     Kèm cầu nối gesture: __bintvPhimReturn (Return trong web app) + tua
 *     __bintvPlayerBeginSeek/SeekTo/EndSeek + mirror uiState về Swift.
 *     [build 243] Bỏ "leo thang" sang trình phát iOS khi người dùng ĐÃ CHỌN
 *     trình phát tích hợp → F2 nay kiểm tra "một player duy nhất".
 *   SUITE I (build 243) — MỘT TRÌNH PHÁT DUY NHẤT CHO MODULE PHIM:
 *     Chưa chọn trình phát → KHÔNG nạp player nào + chuyển sang SETTING;
 *     chọn xong → phát tiếp ĐÚNG phim/tập vừa chọn; đã chọn "native" → chỉ
 *     AVPlayer nhận URL (thẻ <video> không bao giờ có src); đã chọn
 *     "integrated" → chỉ <video> nhận URL; ngoài WKWebView iOS → hành vi cũ.
 *   SUITE J (build 245) — DANH SÁCH TẬP = LỚP TRÊN CÙNG CỦA TRÌNH PHÁT:
 *     panel danh sách tập treo trên VIEW GỐC của AVPlayerViewController
 *     (KHÔNG phải contentOverlayView — lớp đó nằm DƯỚI progress/seek bar),
 *     bringSubviewToFront + zPosition cao; danh sách DỌC cuộn LÊN/XUỐNG;
 *     gesture hub nhường vuốt cạnh khi danh sách mở; teardown/đóng picker gỡ
 *     panel sạch (seek bar hoạt động lại); luồng TẬP (menu long-press →
 *     pickEpisode → JS) giữ nguyên 100%.
 *
 * Các hàm của SUITE B được TRÍCH TRỰC TIẾP từ app.js (không chép tay) nên
 * test luôn bám theo code thật.
 * ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO = path.resolve(__dirname, "..", "..");
const WEB = path.join(REPO, "BinTV", "Phim", "Web");
const ASSETS = path.join(WEB, "assets");
const SWIFT_WEBVIEW = path.join(REPO, "BinTV", "Phim", "PhimWebView.swift");

let pass = 0;
let fail = 0;
const failures = [];

function check(suite, name, cond, extra) {
    if (cond) {
        pass++;
        console.log("  PASS  " + name);
    } else {
        fail++;
        failures.push(suite + " / " + name + (extra !== undefined ? "  → " + extra : ""));
        console.log("  FAIL  " + name + (extra !== undefined ? "  → " + extra : ""));
    }
}

// ---------------------------------------------------------------------
// Trích các user script JS được TIÊM TỪ SWIFT (private static let X = """…""")
// — test chạy đúng chuỗi Swift sẽ tiêm vào WKWebView, sau khi bỏ escape.
// ---------------------------------------------------------------------
function extractSwiftUserScripts() {
    const src = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const pattern = /private static let (\w+) = """\n([\s\S]*?)\n(\s*)"""/g;
    const out = {};
    let m;
    while ((m = pattern.exec(src)) !== null) {
        const name = m[1];
        const closingIndent = m[3];
        const body = m[2].split("\n").map(function (line) {
            return line.startsWith(closingIndent) ? line.slice(closingIndent.length) : line;
        }).join("\n");
        // Swift: \(…) là interpolation (không có trong các script JS này —
        // nếu xuất hiện thì thay bằng placeholder để node parse được),
        // và \\ → \ (escape của Swift).
        out[name] = body
            .replace(/\\\((?:[^()]|\([^()]*\))*\)/g, "SWIFT_INTERP")
            .replace(/\\\\/g, "\\");
    }
    return out;
}

const swiftScripts = extractSwiftUserScripts();

function makeWindow(url, withBridge, playerChoice) {
    const dom = new JSDOM(fs.readFileSync(path.join(WEB, "index.html"), "utf8"), {
        url: url,
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole: new VirtualConsole()     // ẩn log của web app
    });
    const win = dom.window;
    if (withBridge) {
        win.__posted = [];
        win.__lifecyclePosted = [];
        win.__bridgePosted = [];
        win.webkit = {
            messageHandlers: {
                playVideoNative: {
                    postMessage: function (payload) {
                        win.__posted.push(JSON.parse(JSON.stringify(payload)));
                    }
                },
                phimBridge: {
                    postMessage: function (payload) {
                        win.__bridgePosted.push(JSON.parse(JSON.stringify(payload)));
                    }
                },
                phimConsole: { postMessage: function () {} },
                phimLifecycle: {
                    postMessage: function (payload) {
                        win.__lifecyclePosted = win.__lifecyclePosted || [];
                        win.__lifecyclePosted.push(JSON.parse(JSON.stringify(payload)));
                    }
                }
            }
        };
    }
    // [build 243] Lựa chọn trình phát của module PHIM do Swift đẩy sang web
    // app (`__bintvSetPhimPlayerChoice`) sau khi trang nạp xong / khi người
    // dùng lưu trong SETTING. Mặc định "integrated" để các suite cũ vẫn mô tả
    // đúng trường hợp "người dùng đã chọn trình phát tích hợp".
    win.__bintvInitialPlayerChoice = (playerChoice === undefined) ? "integrated" : playerChoice;
    return win;
}

function bootWebApp(win, scripts) {
    const ok = [];
    const bad = [];
    scripts.forEach(function (item) {
        try {
            win.eval(item.code);
            ok.push(item.label);
        } catch (e) {
            bad.push(item.label + ": " + e.message);
        }
    });
    // [build 243] Swift đẩy trình phát ĐÃ LƯU sang web app ngay sau didFinish.
    if (win.__bintvInitialPlayerChoice !== undefined) {
        try {
            win.eval("window.__bintvSetPhimPlayerChoice && window.__bintvSetPhimPlayerChoice("
                + JSON.stringify(win.__bintvInitialPlayerChoice) + ");");
        } catch (e) {
            bad.push("playerChoice: " + e.message);
        }
    }
    return { ok: ok, bad: bad };
}

function scriptList(withHls) {
    // ĐÚNG thứ tự WKWebView thật: user script document-start (Swift tiêm)
    // → assets trong index.html → user script document-end.
    const list = [
        { label: "swift:viewportFixJS", code: swiftScripts.viewportFixJS },
        { label: "swift:bridgeShimJS", code: swiftScripts.bridgeShimJS },
        { label: "swift:nativeHandoffJS", code: swiftScripts.nativeHandoffJS },
        { label: "swift:playerChoiceJS", code: swiftScripts.playerChoiceJS },
        { label: "swift:lifecycleBridgeJS", code: swiftScripts.lifecycleBridgeJS },
        { label: "swift:consoleCaptureJS", code: swiftScripts.consoleCaptureJS }
    ];
    if (withHls) {
        list.push({ label: "assets/hls.min.js", code: fs.readFileSync(path.join(ASSETS, "hls.min.js"), "utf8") });
    }
    ["tizen_shim.js", "phim_android.js", "stremio.js", "app.js", "phim_ios_fallback.js"].forEach(function (f) {
        list.push({ label: "assets/" + f, code: fs.readFileSync(path.join(ASSETS, f), "utf8") });
    });
    ["playerObserverJS", "nativePlayerJS", "layoutFixJS"].forEach(function (n) {
        list.push({ label: "swift:" + n, code: swiftScripts[n] });
    });
    return list;
}

// =====================================================================
// SUITE A — CẦU NỐI JS ↔ SWIFT (WKWebView iOS)
// =====================================================================
function suiteA() {
    console.log("\n=== SUITE A: cầu nối playVideoNative trong WKWebView iOS ===");
    // [build 243] Suite này kiểm tra cầu nối sang trình phát iOS → người dùng đã chọn "native".
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "native");
    const boot = bootWebApp(win, scriptList(false));
    check("A", "mọi script nạp không lỗi (" + boot.ok.length + ")", boot.bad.length === 0, boot.bad.join(" | "));

    check("A", "nativeHandoffJS có trong PhimWebView.swift", typeof swiftScripts.nativeHandoffJS === "string");
    check("A", "lifecycleBridgeJS có trong PhimWebView.swift", typeof swiftScripts.lifecycleBridgeJS === "string");
    check("A", "window.__bintvPhimHostLifecycle được cài trước app.js",
          !!win.__bintvPhimHostLifecycle && typeof win.__bintvPhimHostLifecycle.capture === "function");
    check("A", "window.__bintvIosNativeBridge = true", win.__bintvIosNativeBridge === true);
    check("A", "__bintvNativeBridgeAvailable() = true", win.__bintvNativeBridgeAvailable() === true);
    check("A", "__bintvPlayVideoNative là hàm", typeof win.__bintvPlayVideoNative === "function");
    check("A", "__bintvStopVideoNative là hàm", typeof win.__bintvStopVideoNative === "function");
    ["__bintvRequestNativePlayback", "__bintvNativePlaybackStarted",
     "__bintvNativePlaybackFailed", "__bintvNativePlaybackClosed"].forEach(function (fn) {
        check("A", "app.js expose " + fn, typeof win[fn] === "function");
    });

    // PhimWebView.swift phải đăng ký message handler `playVideoNative`.
    const swiftSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    check("A", "Swift đăng ký handler playVideoNative",
          /add\(self, name: "playVideoNative"\)/.test(swiftSrc));
    check("A", "Swift xử lý message playVideoNative",
          /message\.name == "playVideoNative"/.test(swiftSrc));
    check("A", "Swift gọi PhimNativePlayerController",
          /PhimNativePlayerController\(\)/.test(swiftSrc) && /nativePlayer\.play\(request\)/.test(swiftSrc));
    check("A", "Player native nằm trong BinTV/Player/",
          fs.existsSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift")));
    check("A", "File player native có trong Compile Sources (pbxproj)",
          /PhimNativePlayerController\.swift in Sources/.test(
              fs.readFileSync(path.join(REPO, "BinTV.xcodeproj", "project.pbxproj"), "utf8")));
    const infoPlist = fs.readFileSync(path.join(REPO, "BinTV", "Info.plist"), "utf8");
    check("A", "Info.plist có NSAllowsArbitraryLoads", /NSAllowsArbitraryLoads/.test(infoPlist));

    // --- bắt sự kiện người dùng CLICK thẻ phim -------------------------
    const card = win.document.createElement("div");
    card.className = "movie-card";
    card.setAttribute("data-movie-id", "tt1234567");
    card.setAttribute("data-movie-name", "Phim Thử Nghiệm");
    card.setAttribute("data-movie-type", "movie");
    win.document.body.appendChild(card);
    card.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    check("A", "CLICK thẻ phim → __bintvLastPlayIntent (id + tên)",
          !!win.__bintvLastPlayIntent && win.__bintvLastPlayIntent.id === "tt1234567"
          && win.__bintvLastPlayIntent.name === "Phim Thử Nghiệm",
          JSON.stringify(win.__bintvLastPlayIntent));

    // --- postMessage đúng chữ ký {url, title} --------------------------
    win.__posted.length = 0;
    const sent = win.__bintvPlayVideoNative({ url: "https://cdn.example.com/a.mkv", title: "Phim A" });
    check("A", "__bintvPlayVideoNative trả true", sent === true);
    check("A", "postMessage đúng {url, title}",
          win.__posted.length === 1 && win.__posted[0].url === "https://cdn.example.com/a.mkv"
          && win.__posted[0].title === "Phim A", JSON.stringify(win.__posted));

    // --- app.js trích streamUrl từ src /proxy --------------------------
    win.__posted.length = 0;
    const original = "https://sc.k-20.xyz/stream/abc/playlist.m3u8?pkey=SECRET123";
    const video = win.document.getElementById("bintv-movie-html5-player");
    video.src = "http://127.0.0.1:3000/proxy?url=" + encodeURIComponent(original)
        + "&__ref=" + encodeURIComponent("https://phim.example/");
    check("A", "handoff từ app.js trả true", win.__bintvRequestNativePlayback("ios-fallback-error") === true);
    check("A", "gửi đúng 1 message", win.__posted.length === 1, String(win.__posted.length));
    const msg = win.__posted[0] || {};
    check("A", "url = URL GỐC (decode từ /proxy)", msg.url === original, msg.url);
    check("A", "proxyUrl kèm theo (127.0.0.1/proxy)",
          /^http:\/\/127\.0\.0\.1:3000\/proxy\?url=/.test(msg.proxyUrl || ""), msg.proxyUrl);
    check("A", "referer trích từ __ref", msg.referer === "https://phim.example/", msg.referer);
    check("A", "reason + session được gửi",
          msg.reason === "ios-fallback-error" && !!msg.session, JSON.stringify({ r: msg.reason, s: msg.session }));
    check("A", "title lấy từ ý định CLICK", msg.title === "Phim Thử Nghiệm", msg.title);

    // --- chống lặp ------------------------------------------------------
    win.__posted.length = 0;
    check("A", "handoff lần 2 cùng URL = false", win.__bintvRequestNativePlayback("ios-fallback-error") === false);
    check("A", "không gửi message trùng", win.__posted.length === 0, JSON.stringify(win.__posted));

    // --- native FAIL → không còn "trên TV" ------------------------------
    win.__bintvNativePlaybackFailed({ session: msg.session, title: msg.title, url: msg.url, message: "AVPlayerItem failed" });
    const st = (win.document.getElementById("bintv-movie-status") || {}).textContent || "";
    check("A", "thông báo KHÔNG chứa 'trên TV'", st.indexOf("trên TV") === -1, st);
    check("A", "thông báo nói đúng iPhone + trình phát gốc", /iPhone/.test(st), st);

    // --- callback cũ bị loại -------------------------------------------
    win.__bintvNativePlaybackFailed({ session: "999999", message: "stale" });
    check("A", "callback lệch session bị bỏ qua",
          ((win.document.getElementById("bintv-movie-status") || {}).textContent || "") === st);

    // --- native đóng (Done) → dọn UI web --------------------------------
    win.document.getElementById("bintv-movie-player").classList.add("show");
    win.document.getElementById("bintv-movie-browser").classList.add("player-active");
    win.__posted.length = 0;
    video.src = "http://127.0.0.1:3000/proxy?url=" + encodeURIComponent("https://cdn.example.com/movie2.mkv");
    win.__bintvRequestNativePlayback("unsupported-source");
    const msg2 = win.__posted[0] || {};
    win.__bintvNativePlaybackClosed({ session: msg2.session });
    check("A", "overlay player web bị gỡ .show",
          !win.document.getElementById("bintv-movie-player").classList.contains("show"));
    check("A", "browser bỏ class player-active (lưới phim hiện lại)",
          !win.document.getElementById("bintv-movie-browser").classList.contains("player-active"));

    // --- stop ------------------------------------------------------------
    win.__posted.length = 0;
    win.__bintvStopVideoNative();
    check("A", "__bintvStopVideoNative gửi action=stop",
          win.__posted.length === 1 && win.__posted[0].action === "stop", JSON.stringify(win.__posted));

    // --- KHÔNG có cầu nối (Android/Tizen/Windows) → hành vi cũ -----------
    console.log("\n=== SUITE A2: không có window.webkit (Android/Tizen/Windows) ===");
    const win2 = makeWindow("http://127.0.0.1:3000/?android=phone", false);
    bootWebApp(win2, scriptList(false));
    check("A2", "__bintvNativeBridgeAvailable() = false", win2.__bintvNativeBridgeAvailable() === false);
    check("A2", "__bintvPlayVideoNative = false (không gửi gì)",
          win2.__bintvPlayVideoNative({ url: "https://x/y.mkv" }) === false);
    check("A2", "__bintvRequestNativePlayback = false", win2.__bintvRequestNativePlayback("x") === false);
}

// =====================================================================
// SUITE B — PHÂN LOẠI NGUỒN (trích hàm THẬT từ app.js)
// =====================================================================
function extractFunction(source, name) {
    const marker = "function " + name + "(";
    const start = source.indexOf(marker);
    if (start < 0) { throw new Error("không tìm thấy hàm " + name + " trong app.js"); }
    let i = source.indexOf("{", start);
    let depth = 0;
    for (; i < source.length; i++) {
        if (source[i] === "{") { depth++; }
        else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    return source.slice(start, i);
}

function suiteB() {
    console.log("\n=== SUITE B: phân loại container/codec (hàm thật của app.js) ===");
    const appSrc = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");
    const names = ["isIosNativePlaybackBridge", "extractStreamReferer",
                   "buildProxiedStreamUrl", "iosNeedsNativePlayerFor"];
    const code = names.map(function (n) { return extractFunction(appSrc, n); }).join("\n\n")
        + "\n\nwindow.__T = { isIosNativePlaybackBridge: isIosNativePlaybackBridge,"
        + " extractStreamReferer: extractStreamReferer, buildProxiedStreamUrl: buildProxiedStreamUrl,"
        + " iosNeedsNativePlayerFor: iosNeedsNativePlayerFor };";

    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    win.AndroidBridge = undefined;    // không có shim → dùng nhánh tự ghép proxy
    win.eval(code);
    const T = win.__T;

    function need(url, info, expected, label) {
        const got = T.iosNeedsNativePlayerFor(url, info);
        check("B", label + " → " + expected, got === expected, "got=" + got);
    }

    // (1) Container WebKit không mở được → chuyển thẳng sang AVPlayer.
    need("https://cdn.vnstream.xyz/f/movie.mkv", null, true, "MKV");
    need("https://cdn.vnstream.xyz/f/movie.MKV?pkey=abc", null, true, "MKV hoa + query");
    need("http://85.237.89.160/f/x.avi", null, true, "AVI (http)");
    need("https://vimo.tv/f/x.flv", null, true, "FLV");
    need("https://vimo.tv/f/x.wmv", null, true, "WMV");
    need("https://vimo.tv/f/x.mpg", null, true, "MPG");
    need("https://vimo.tv/f/x.mpeg", null, true, "MPEG");
    need("https://vimo.tv/f/x.divx", null, true, "DIVX");
    need("https://vimo.tv/f/x.rmvb", null, true, "RMVB");
    need("https://example.com/player.php?file=movie.mkv", null, true, "path không đuôi media + query trỏ MKV");

    // (2) Progressive + audio AC3/EAC3/DTS/TrueHD/Atmos.
    const mp4 = "https://sc.k-20.xyz/stream/abc/movie.mp4";
    need(mp4, { name: "VipTorrent 1080p AC3" }, true, "MP4 + AC3");
    need(mp4, { name: "1080p E-AC-3" }, true, "MP4 + E-AC-3");
    need(mp4, { name: "1080p EAC3" }, true, "MP4 + EAC3");
    need(mp4, { title: "720p DTS" }, true, "MP4 + DTS (title)");
    need(mp4, { name: "1080p DTS-HD MA" }, true, "MP4 + DTS-HD MA");
    need(mp4, { name: "1080p DTSHD" }, true, "MP4 + DTSHD");
    need(mp4, { filename: "movie.2024.1080p.TrueHD.mkv" }, true, "TrueHD");
    need(mp4, { name: "1080p ATMOS" }, true, "ATMOS");
    need(mp4, { raw: { behaviorHints: { filename: "Show.S01E01.1080p.EAC3.WEB-DL" } } }, true,
         "behaviorHints.filename EAC3");

    // (3) KHÔNG handoff sớm — để web phát trước (HLS WebKit làm rất tốt).
    need(mp4, { name: "1080p AAC" }, false, "MP4 + AAC");
    need(mp4, null, false, "MP4 không metadata");
    need("https://sc.k-20.xyz/proxy-playlist.m3u8?referer=x", { name: "1080p AC3" }, false, "HLS + AC3");
    need("https://sc.k-20.xyz/proxy-playlist.m3u8", null, false, "HLS thường");
    need("https://vimo.tv/stream/abc123", null, false, "URL không có đuôi");
    need("https://vimo.tv/f/x.webm", { name: "opus" }, false, "WEBM/opus");
    need("", null, false, "URL rỗng");

    // (4) Chống false-positive.
    need("https://example.com/movie.mp4?next=https://x/y.mkv", null, false, "MKV nằm trong query");
    need("https://example.com/movie.mp4?referer=https%3A%2F%2Fx%2Fy.mkv", null, false, "MKV trong referer");
    need(mp4, { name: "1080p placebo3 dtsxtra" }, false, "chuỗi giống codec nằm trong từ khác");

    // (5) Referer + công thức proxy (giống hệt startMoviePlayback).
    check("B", "extractStreamReferer đọc referer= trong query",
          T.extractStreamReferer("https://a/x.m3u8?pkey=1&referer=" + encodeURIComponent("https://phim.vn/"))
          === "https://phim.vn/");
    check("B", "extractStreamReferer: không có → ''", T.extractStreamReferer("https://a/x.m3u8?pkey=1") === "");
    const p = T.buildProxiedStreamUrl("https://cdn.vn/a.m3u8?x=1", "https://phim.vn/");
    check("B", "buildProxiedStreamUrl bọc /proxy", p.indexOf("http://127.0.0.1:3000/proxy?url=") === 0, p);
    check("B", "buildProxiedStreamUrl encode URL gốc", p.indexOf(encodeURIComponent("https://cdn.vn/a.m3u8?x=1")) > 0, p);
    check("B", "buildProxiedStreamUrl kèm __ref", p.indexOf("&__ref=" + encodeURIComponent("https://phim.vn/")) > 0, p);
    check("B", "same-origin → '' (không bọc)", T.buildProxiedStreamUrl("http://127.0.0.1:3000/proxy?url=x", "") === "");
}

// =====================================================================
// SUITE C — PHỤ ĐỀ TRONG TRÌNH PHÁT NATIVE (build 232)
// =====================================================================
function suiteC() {
    console.log("\n=== SUITE C: phụ đề đẩy sang trình phát native ===");
    // [build 243] Suite này kiểm tra phụ đề trong trình phát iOS → người dùng đã chọn "native".
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "native");
    bootWebApp(win, scriptList(false));

    // Cầu nối Swift phải cung cấp __bintvSetNativeSubtitles.
    check("C", "nativeHandoffJS có __bintvSetNativeSubtitles",
          typeof win.__bintvSetNativeSubtitles === "function");
    check("C", "app.js expose __bintvPushNativeSubtitles",
          typeof win.__bintvPushNativeSubtitles === "function");

    // Chưa handoff → không đẩy (không gửi message).
    win.__posted.length = 0;
    check("C", "chưa handoff → push = false",
          win.__bintvPushNativeSubtitles([{ start: 0, end: 2, text: "x" }], "Vietsub") === false);
    check("C", "không gửi message khi chưa handoff", win.__posted.length === 0);

    // Handoff một nguồn → native active.
    win.__posted.length = 0;
    const video = win.document.getElementById("bintv-movie-html5-player");
    video.src = "http://127.0.0.1:3000/proxy?url=" + encodeURIComponent("https://cdn.example.com/a.mkv");
    check("C", "handoff thành công", win.__bintvRequestNativePlayback("unsupported-source") === true);
    const handoffMsg = win.__posted[0] || {};
    const session = handoffMsg.session;

    // Đẩy phụ đề sau khi native active.
    win.__posted.length = 0;
    const pushed = win.__bintvPushNativeSubtitles([
        { start: 0.5, end: 2.5, text: "Xin chào" },
        { start: 3, end: 5, text: "Tạm biệt" }
    ], "Vietsub · OpenSubtitles");
    check("C", "push phụ đề trả true", pushed === true);
    check("C", "gửi đúng 1 message", win.__posted.length === 1, String(win.__posted.length));
    const sub = win.__posted[0] || {};
    check("C", "message có action=subtitles", sub.action === "subtitles", JSON.stringify(sub));
    check("C", "label đúng", sub.label === "Vietsub · OpenSubtitles", sub.label);
    check("C", "session khớp phiên handoff", sub.session === session, sub.session);
    check("C", "cues compact {s,e,t} đúng", Array.isArray(sub.cues) && sub.cues.length === 2
          && sub.cues[0].s === 0.5 && sub.cues[0].e === 2.5 && sub.cues[0].t === "Xin chào"
          && sub.cues[1].t === "Tạm biệt", JSON.stringify(sub.cues));

    // Tắt phụ đề → gửi cues rỗng.
    win.__posted.length = 0;
    win.__bintvPushNativeSubtitles([], "");
    check("C", "tắt phụ đề → cues rỗng", win.__posted.length === 1
          && Array.isArray(win.__posted[0].cues) && win.__posted[0].cues.length === 0,
          JSON.stringify(win.__posted));

    // Native đóng → handoffActive=false → không đẩy nữa.
    win.__bintvNativePlaybackClosed({ session: session });
    win.__posted.length = 0;
    check("C", "sau khi đóng → push = false",
          win.__bintvPushNativeSubtitles([{ start: 0, end: 1, text: "z" }], "") === false);

    // Không có cầu nối → luôn false.
    const win2 = makeWindow("http://127.0.0.1:3000/?android=phone", false);
    bootWebApp(win2, scriptList(false));
    check("C", "không bridge → __bintvSetNativeSubtitles trả false",
          win2.__bintvSetNativeSubtitles({ label: "", cues: [], session: "" }) === false);

    // Wiring trong app.js: định nghĩa + hook + ≥2 điểm gọi (started/apply/disable).
    const appSrc = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");
    const count = (appSrc.match(/pushMovieSubtitlesToNative/g) || []).length;
    check("C", "app.js có định nghĩa + ≥2 điểm gọi pushMovieSubtitlesToNative",
          count >= 3, "count=" + count);

    // Wiring trong Swift.
    const swiftSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    check("C", "Swift xử lý action=subtitles", /action == "subtitles"/.test(swiftSrc));
    check("C", "Swift gọi updateSubtitles", /updateSubtitles\(/.test(swiftSrc));
    const playerSrc = fs.readFileSync(
        path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    check("C", "player native có NativeSubtitleCue + updateSubtitles",
          /struct NativeSubtitleCue/.test(playerSrc) && /func updateSubtitles/.test(playerSrc));
    check("C", "player native treo phụ đề trên contentOverlayView",
          /contentOverlayView/.test(playerSrc));
}

// =====================================================================
// SUITE D — lifecycle Safari/Home + state-aware PHIM recovery
// =====================================================================
function wait(win, ms) {
    return new Promise(function (resolve) { win.setTimeout(resolve, ms); });
}

async function suiteD() {
    console.log("\n=== SUITE D: lifecycle PHIM (Safari/Home/recovery) ===");
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    const boot = bootWebApp(win, scriptList(false));
    check("D", "bridge + app.js lifecycle scripts nạp không lỗi", boot.bad.length === 0, boot.bad.join(" | "));
    check("D", "app.js export state contract capture/restore",
          !!win.__bintvPhimLifecycle && typeof win.__bintvPhimLifecycle.capture === "function"
          && typeof win.__bintvPhimLifecycle.restore === "function");

    const saved = {
        version: 2,
        browserOpen: true,
        screen: "player",
        catalog: { index: 0, identity: "", filterMode: "all", filterIndex: 0, focusArea: "grid", itemIndex: 0 },
        selectedMovie: { id: "tt-life", type: "movie", name: "Phim Lifecycle", item: { id: "tt-life", type: "movie", name: "Phim Lifecycle" } },
        episode: { open: false, index: 0, currentIndex: -1, type: "movie", title: "" },
        player: { open: true, paused: true, positionMs: 12345, native: true },
        source: {
            url: "https://cdn.example.com/lifecycle.mkv?token=secret",
            proxyUrl: "http://127.0.0.1:3000/proxy?url=x",
            referer: "https://source.example/",
            title: "Phim Lifecycle",
            streamInfo: { name: "1080p" },
            subtitleContext: { id: "tt-life", type: "movie", name: "Phim Lifecycle" },
            nativeSession: "77"
        }
    };
    const restored = win.__bintvPhimLifecycle.restore(saved, { rebuilt: true });
    check("D", "fresh WKWebView nhận state restore thay vì reload mù", restored === "restored-rebuilt", restored);
    await wait(win, 10);
    const browser = win.document.getElementById("bintv-movie-browser");
    const player = win.document.getElementById("bintv-movie-player");
    check("D", "restore giữ browser + player shell", browser.classList.contains("show")
          && browser.classList.contains("player-active") && player.classList.contains("show"));
    const roundTrip = win.__bintvPhimLifecycle.capture();
    check("D", "snapshot giữ screen/phim/source/player", roundTrip.screen === "player"
          && roundTrip.selectedMovie.id === "tt-life" && roundTrip.source.url === saved.source.url
          && roundTrip.player.native === true && roundTrip.player.paused === true,
          JSON.stringify(roundTrip));

    // Safari return path: pagehide is captured and the host's capture-phase
    // guard prevents the legacy closeMovieBrowser() teardown.
    win.__lifecyclePosted.length = 0;
    win.dispatchEvent(new win.Event("pagehide", { bubbles: true }));
    check("D", "Safari pagehide gửi snapshot qua phimLifecycle",
          win.__lifecyclePosted.some(function (m) { return m.action === "snapshot" && m.reason === "pagehide"; }),
          JSON.stringify(win.__lifecyclePosted));
    check("D", "Safari pagehide không đóng PHIM thành màn đen",
          browser.classList.contains("show") && player.classList.contains("show"));

    // Home/background uses the same visibility capture. Simulate WebKit's
    // hidden document first, then the native UIApplication callback capture.
    Object.defineProperty(win.document, "hidden", { configurable: true, value: true });
    win.__lifecyclePosted.length = 0;
    win.document.dispatchEvent(new win.Event("visibilitychange", { bubbles: true }));
    check("D", "Home visibilitychange gửi snapshot qua phimLifecycle",
          win.__lifecyclePosted.some(function (m) { return m.action === "snapshot" && m.reason === "visibilitychange"; }),
          JSON.stringify(win.__lifecyclePosted));
    check("D", "Home visibilitychange không đóng browser/player",
          browser.classList.contains("show") && player.classList.contains("show"));
    Object.defineProperty(win.document, "hidden", { configurable: true, value: false });
    win.__lifecyclePosted.length = 0;
    win.__bintvPhimHostLifecycle.capture("willResignActive");
    check("D", "Home willResignActive snapshot giữ URL/source", win.__lifecyclePosted.length === 1
          && win.__lifecyclePosted[0].state.source.url === saved.source.url,
          JSON.stringify(win.__lifecyclePosted));
    check("D", "state được mirror trong sessionStorage",
          !!win.__bintvPhimHostLifecycle.readStored());

    // Standalone/non-iOS execution retains its original pagehide cleanup.
    const standalone = makeWindow("http://127.0.0.1:3000/?android=phone", false);
    bootWebApp(standalone, scriptList(false));
    standalone.__bintvPhimLifecycle.restore(saved, { rebuilt: true });
    await wait(standalone, 10);
    const standaloneBrowser = standalone.document.getElementById("bintv-movie-browser");
    const standalonePlayer = standalone.document.getElementById("bintv-movie-player");
    standalone.dispatchEvent(new standalone.Event("pagehide", { bubbles: true }));
    check("D", "Android/Windows path vẫn cleanup pagehide cũ",
          !standaloneBrowser.classList.contains("show") && !standalonePlayer.classList.contains("show"));

    // Native/Swift wiring checks: process death replaces a view; normal tab
    // changes are repaint-only and do not touch LIVE TV/TUBE/SETTING paths.
    const swiftSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const nativeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    const contentSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "ContentView.swift"), "utf8");
    check("D", "Swift đăng ký handler phimLifecycle + process-death recovery",
          /add\(self, name: "phimLifecycle"\)/.test(swiftSrc)
          && /webViewWebContentProcessDidTerminate/.test(swiftSrc)
          && /rebuildWebView\(reason:/.test(swiftSrc));
    check("D", "Swift replacement host reattach constraints", /final class PhimWebViewHost/.test(swiftSrc)
          && /webView\.leadingAnchor\.constraint/.test(swiftSrc)
          && /@Published private\(set\) var webView/.test(swiftSrc));
    check("D", "native player snapshot/resume/reconcile state", /applicationWillResignActive/.test(nativeSrc)
          && /applicationDidBecomeActive/.test(nativeSrc) && /reconcileWebAppState/.test(nativeSrc));
    check("D", "PHIM↔LIVE/TUBE/SETTING vẫn mount/layer độc lập", /liveTVPage/.test(contentSrc)
          && /tubePage/.test(contentSrc) && /phimPage/.test(contentSrc) && /settingsPage/.test(contentSrc)
          && /mountedTabs/.test(contentSrc));
}

// =====================================================================
// SUITE E — LUỒNG KẾT THÚC PHÁT, PHIM BỘ / PHIM LẺ (build 233)
//   • Phim BỘ: hết tập → TỰ chuyển tập tiếp theo (native: báo prepareNext
//     giữ player, khoá serial chống race); đóng/hết tập cuối → về CHỌN TẬP.
//   • Phim LẺ: hết phim hoặc đóng → về giao diện PHIM (lưới), KHÔNG treo.
// =====================================================================
function suiteE() {
    console.log("\n=== SUITE E: kết thúc phát — phim bộ / phim lẻ (build 233) ===");
    const EP3 = [
        { id: "tt-ep1", title: "Tập 1", episode: 1, season: 1 },
        { id: "tt-ep2", title: "Tập 2", episode: 2, season: 1 },
        { id: "tt-ep3", title: "Tập 3", episode: 3, season: 1 }
    ];
    function openPlayerDom(win) {
        win.document.getElementById("bintv-movie-player").classList.add("show");
        win.document.getElementById("bintv-movie-browser").classList.add("player-active");
    }
    function bootSeries(currentIndex) {
        const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
        bootWebApp(win, scriptList(false));
        const hooks = win.__bintvMoviePlaybackHooks;
        hooks.setBrowserOpen(true);
        hooks.setPlayerOpen(true);
        openPlayerDom(win);
        hooks.setEpisodes(EP3, "series", "Phim Bộ Thử", currentIndex);
        return win;
    }

    // --- E0: tồn tại API + wiring trong Swift ---------------------------
    const winE0 = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winE0, scriptList(false));
    check("E", "app.js expose __bintvNativePlaybackEnded", typeof winE0.__bintvNativePlaybackEnded === "function");
    check("E", "app.js expose __bintvMoviePlaybackHooks", typeof winE0.__bintvMoviePlaybackHooks === "object");
    check("E", "cầu nối có __bintvPrepareNextNativeEpisode", typeof winE0.__bintvPrepareNextNativeEpisode === "function");
    check("E", "app.js expose __bintvPhimReturn (Return trong web app)",
          typeof winE0.__bintvPhimReturn === "function");
    check("E", "app.js expose __bintvPlayerBeginSeek/SeekTo/EndSeek (tua bằng gesture)",
          typeof winE0.__bintvPlayerBeginSeek === "function"
          && typeof winE0.__bintvPlayerSeekTo === "function"
          && typeof winE0.__bintvPlayerEndSeek === "function");
    const swiftSrcE = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const nativeSrcE = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    check("E", "Swift nối onEnded → __bintvNativePlaybackEnded", /nativePlayer\.onEnded/.test(swiftSrcE) && /__bintvNativePlaybackEnded/.test(swiftSrcE));
    check("E", "Swift xử lý action=prepareNext", /action == "prepareNext"/.test(swiftSrcE));
    check("E", "native player quan sát DidPlayToEndTime + backstop", /AVPlayerItemDidPlayToEndTime/.test(nativeSrcE)
          && /endedGraceTimeout/.test(nativeSrcE) && /autoCloseAfterEnded/.test(nativeSrcE));
    check("E", "native player có prepareNextEpisode()", /func prepareNextEpisode\(\)/.test(nativeSrcE));

    // --- E1: phim BỘ hết tập (native) còn tập --------------------------
    // [build 236] KHÔNG tự phát tập kế: giữ player, mở danh sách tập.
    const win1 = bootSeries(0);
    win1.__bintvMoviePlaybackHooks.setHandoffActive(true);
    win1.__bintvMoviePlaybackHooks.setPreferNative(true);
    win1.__posted.length = 0;
    win1.__bintvNativePlaybackEnded({});
    const posted1 = win1.__posted.map(function (m) { return m.action || "play"; });
    check("E", "BỘ còn tập, native-ended → KHÔNG đóng player (không stop)",
          posted1.indexOf("stop") === -1, JSON.stringify(posted1));
    check("E", "→ báo prepareNext để native giữ player",
          posted1.indexOf("prepareNext") >= 0, JSON.stringify(posted1));
    const st1 = win1.__bintvMoviePlaybackHooks.getState();
    check("E", "→ KHÔNG tự chuyển tập (current vẫn 0, autoAdvance=false)",
          st1.current === 0 && st1.autoAdvance === false && st1.playerOpen === true,
          JSON.stringify(st1));
    check("E", "→ danh sách tập trong player mở",
          win1.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));
    check("E", "→ overlay chọn tập ngoài player KHÔNG mở",
          !win1.document.getElementById("bintv-movie-episodes").classList.contains("show"));

    // --- E2: phim BỘ hết tập CUỐI (native) → vẫn mở danh sách tập trong player
    const win2 = bootSeries(2);
    win2.__bintvMoviePlaybackHooks.setHandoffActive(true);
    win2.__bintvMoviePlaybackHooks.setPreferNative(true);
    win2.__posted.length = 0;
    win2.__bintvNativePlaybackEnded({});
    const posted2 = win2.__posted.map(function (m) { return m.action || "play"; });
    check("E", "BỘ hết tập cuối → KHÔNG tự đóng (không stop)",
          posted2.indexOf("stop") === -1, JSON.stringify(posted2));
    check("E", "→ danh sách tập trong player vẫn mở",
          win2.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));
    check("E", "→ player web còn mở",
          win2.document.getElementById("bintv-movie-player").classList.contains("show"));
    const st2 = win2.__bintvMoviePlaybackHooks.getState();
    check("E", "→ không auto-advance", st2.autoAdvance === false && st2.playerOpen === true, JSON.stringify(st2));

    // --- E3: phim LẺ hết phim (native) → stop, KHÔNG mở chọn tập ---------
    const win3 = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(win3, scriptList(false));
    const hooks3 = win3.__bintvMoviePlaybackHooks;
    hooks3.setBrowserOpen(true); hooks3.setPlayerOpen(true);
    openPlayerDom(win3);
    hooks3.setEpisodes([], "movie", "Phim Lẻ Thử", -1);
    hooks3.setHandoffActive(true); hooks3.setPreferNative(true);
    win3.__posted.length = 0;
    win3.__bintvNativePlaybackEnded({});
    const posted3 = win3.__posted.map(function (m) { return m.action || "play"; });
    check("E", "LẺ hết phim, native-ended → gửi stop đóng player",
          posted3.indexOf("stop") >= 0, JSON.stringify(posted3));
    check("E", "→ KHÔNG mở chọn tập (về lưới PHIM)",
          !win3.document.getElementById("bintv-movie-episodes").classList.contains("show"));
    check("E", "→ player web bị gỡ, lưới phim hiện lại",
          !win3.document.getElementById("bintv-movie-player").classList.contains("show")
          && !win3.document.getElementById("bintv-movie-browser").classList.contains("player-active"));

    // --- E4: phim BỘ, người dùng ĐÓNG player (native) → về CHỌN TẬP ----
    const win4 = bootSeries(1);
    win4.__bintvMoviePlaybackHooks.setHandoffActive(true);
    win4.__posted.length = 0;
    win4.__bintvNativePlaybackClosed({});
    check("E", "BỘ đóng player (Done) → overlay CHỌN TẬP mở lại",
          win4.document.getElementById("bintv-movie-episodes").classList.contains("show"));
    check("E", "→ player web bị gỡ", !win4.document.getElementById("bintv-movie-player").classList.contains("show"));

    // --- E5: đường WEB (<video>) — BỘ hết tập → mở danh sách tập --------
    const win5 = bootSeries(0);
    win5.__posted.length = 0;
    win5.__bintvMoviePlaybackHooks.completed("html5-ended");
    const st5 = win5.__bintvMoviePlaybackHooks.getState();
    check("E", "BỘ hết tập (web) → KHÔNG tự chuyển tập (current vẫn 0)",
          st5.current === 0 && st5.autoAdvance === false && st5.playerOpen === true, JSON.stringify(st5));
    check("E", "→ danh sách tập trong player mở",
          win5.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));

    // --- E6: đường WEB — LẺ hết phim → đóng, về lưới PHIM ----------------
    const win6 = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(win6, scriptList(false));
    const hooks6 = win6.__bintvMoviePlaybackHooks;
    hooks6.setBrowserOpen(true); hooks6.setPlayerOpen(true);
    openPlayerDom(win6);
    hooks6.setEpisodes([], "movie", "Phim Lẻ Thử", -1);
    win6.__bintvMoviePlaybackHooks.completed("html5-ended");
    check("E", "LẺ hết phim (web) → player đóng, KHÔNG mở chọn tập",
          !win6.document.getElementById("bintv-movie-player").classList.contains("show")
          && !win6.document.getElementById("bintv-movie-episodes").classList.contains("show"));
    const st6 = win6.__bintvMoviePlaybackHooks.getState();
    check("E", "→ cờ playerOpen đã hạ", st6.playerOpen === false, JSON.stringify(st6));

    // --- E7: RACE — callback đóng player trong lúc tự chuyển tập ---------
    // [build 234] startMovieAutoAdvance đã tự đóng trình phát (stop) → nếu
    // Swift vẫn bắn thêm onClosed (backstop/người dùng đóng đúng lúc) thì
    // KHÔNG được dập luồng tập kế cũng KHÔNG được mở lại màn hình chọn tập.
    const win7 = bootSeries(0);
    win7.__bintvMoviePlaybackHooks.setHandoffActive(true);
    win7.__bintvNativePlaybackEnded({});
    check("E", "hết tập: player còn mở + danh sách tập",
          win7.__bintvMoviePlaybackHooks.getState().playerOpen === true
          && win7.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));
    win7.__bintvNativePlaybackClosed({});
    const st7 = win7.__bintvMoviePlaybackHooks.getState();
    check("E", "đóng player sau khi hết tập → về overlay CHỌN TẬP",
          win7.document.getElementById("bintv-movie-episodes").classList.contains("show")
          && st7.playerOpen === false, JSON.stringify(st7));
    check("E", "autoAdvance vẫn tắt", st7.autoAdvance === false, JSON.stringify(st7));

    // --- E9: Return của người dùng khi ĐANG phát (trình phát tích hợp) ---
    const win9 = bootSeries(1);
    const handled9 = win9.__bintvPhimReturn();
    const st9 = win9.__bintvMoviePlaybackHooks.getState();
    check("E", "Return khi player mở → web app xử lý (trả true)", handled9 === true);
    check("E", "→ đóng player + về CHỌN TẬP (phim bộ)",
          st9.playerOpen === false
          && win9.document.getElementById("bintv-movie-episodes").classList.contains("show"),
          JSON.stringify(st9));
    win9.__bintvMoviePlaybackHooks.pushUiState();
    const mirror9 = win9.__bridgePosted[win9.__bridgePosted.length - 1];
    check("E", "→ mirror uiState báo playerOpen=false, canReturn=true (picker mở)",
          !!mirror9 && mirror9.playerOpen === false && mirror9.canReturn === true,
          JSON.stringify(mirror9));

    // --- E8: callback lệch session bị loại --------------------------------
    const win8 = bootSeries(0);
    win8.__bintvMoviePlaybackHooks.setHandoffActive(true);
    win8.__posted.length = 0;
    win8.__bintvNativePlaybackEnded({ session: "999999" });   // stale
    check("E", "ended lệch session → bỏ qua, KHÔNG chuyển tập/đóng",
          win8.__posted.length === 0 && win8.__bintvMoviePlaybackHooks.getState().current === 0,
          JSON.stringify(win8.__posted));
}

// =====================================================================
// SUITE F — [build 234] ƯU TIÊN TRÌNH PHÁT + CẦU NỐI GESTURE ĐIỀU HƯỚNG
// =====================================================================
function suiteF() {
    console.log("\n=== SUITE F: trình phát tích hợp trước + gesture điều hướng (build 234) ===");
    const appSrc = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");
    const contentSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "ContentView.swift"), "utf8");
    const webViewSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const nativeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");

    // --- F0: chính sách ưu tiên trình phát trong mã nguồn ---------------
    check("F", "app.js có chính sách MOVIE_INTEGRATED_PLAYER_FIRST",
          /MOVIE_INTEGRATED_PLAYER_FIRST\s*=\s*true/.test(appSrc));
    check("F", "KHÔNG còn pre-flight handoff (mở trình phát iOS ngay từ đầu)",
          appSrc.indexOf("moviePreferNativePlayer || needNativeNow") < 0);
    check("F", "fallback sau khi trình phát tích hợp lỗi vẫn còn",
          /requestNativeMoviePlayback\("web-streams-exhausted"/.test(appSrc));
    check("F", "phim_ios_fallback.js vẫn nối lỗi web → trình phát iOS",
          /__bintvRequestNativePlayback/.test(fs.readFileSync(path.join(ASSETS, "phim_ios_fallback.js"), "utf8")));

    // --- F1: runtime — nguồn MKV/AC3 vẫn do TRÌNH PHÁT TÍCH HỢP thử trước -
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(win, scriptList(false));
    const hooks = win.__bintvMoviePlaybackHooks;
    hooks.setBrowserOpen(true);
    win.__posted.length = 0;
    hooks.startPlayback("https://cdn.vnstream.xyz/f/movie.mkv", "Phim MKV AC3",
                        { name: "1080p AC3", stream: { name: "1080p AC3" } });
    const playPosts = win.__posted.filter(function (m) { return m.action !== "episodes" && m.action !== "hideEpisodes"; });
    check("F", "nguồn MKV/AC3 → KHÔNG mở trình phát iOS ngay từ đầu",
          playPosts.length === 0, JSON.stringify(win.__posted));
    const video = win.document.getElementById("bintv-movie-html5-player");
    check("F", "→ trình phát TÍCH HỢP (<video>) nhận nguồn",
          !!video && !!video.getAttribute("src"),
          video ? String(video.getAttribute("src")) : "không có thẻ video");
    check("F", "→ overlay trình phát tích hợp đang mở",
          win.document.getElementById("bintv-movie-player").classList.contains("show"));

    // --- F2: [build 243] người dùng ĐÃ CHỌN trình phát tích hợp → nguồn lỗi
    //         cũng KHÔNG được mở trình phát còn lại (một player duy nhất).
    //         (Hành vi cũ "leo thang sang trình phát iOS" đã bị gỡ: đó chính là
    //         nguyên nhân HAI player cùng tải một URL — xem SUITE I.)
    hooks.playbackError();
    const handoff = win.__posted.filter(function (m) {
        return m.action !== "stop" && m.action !== "episodes" && m.action !== "hideEpisodes";
    });
    check("F", "[243] đã chọn trình phát tích hợp + nguồn lỗi → KHÔNG mở trình phát iOS",
          handoff.length === 0, JSON.stringify(win.__posted));
    const statusF = (win.document.getElementById("bintv-movie-status") || {}).textContent || "";
    check("F", "→ hiện lỗi THẬT + chỉ chỗ đổi trình phát (SETTING → Trình phát PHIM)",
          statusF.indexOf("SETTING") !== -1 && statusF.indexOf("trên TV") === -1, statusF);
    check("F", "→ trình phát tích hợp đã được dọn nguồn (không để <video> tải tiếp)",
          !win.document.getElementById("bintv-movie-html5-player").getAttribute("src"),
          String(win.document.getElementById("bintv-movie-html5-player").getAttribute("src")));

    // --- F3: cầu nối Return của web app ---------------------------------
    const winG = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winG, scriptList(false));
    const hooksG = winG.__bintvMoviePlaybackHooks;
    hooksG.setBrowserOpen(true);
    check("F", "Return ở màn hình gốc PHIM → false (Swift lùi về tab trước)",
          winG.__bintvPhimReturn() === false);
    hooksG.setEpisodes([
        { id: "tt-ep1", title: "Tập 1", episode: 1, season: 1 },
        { id: "tt-ep2", title: "Tập 2", episode: 2, season: 1 }
    ], "series", "Phim Bộ Thử", 0);
    hooksG.reopenPicker();
    check("F", "mở CHỌN TẬP → Return xử lý NGAY trong web app (true)",
          winG.__bintvPhimReturn() === true);
    check("F", "→ overlay CHỌN TẬP đã đóng",
          !winG.document.getElementById("bintv-movie-episodes").classList.contains("show"));

    // --- F4: mirror uiState về Swift (gesture phải trả lời NGAY) --------
    hooksG.setPlayerOpen(true);
    winG.document.getElementById("bintv-movie-player").classList.add("show");
    hooksG.pushUiState();
    let mirror = winG.__bridgePosted[winG.__bridgePosted.length - 1];
    check("F", "phimBridge nhận uiState {action, canReturn, playerOpen}",
          !!mirror && mirror.action === "uiState"
          && mirror.canReturn === true && mirror.playerOpen === true,
          JSON.stringify(mirror));
    hooksG.setPlayerOpen(false);
    winG.document.getElementById("bintv-movie-player").classList.remove("show");
    hooksG.pushUiState();
    mirror = winG.__bridgePosted[winG.__bridgePosted.length - 1];
    check("F", "→ đóng player: mirror cập nhật playerOpen=false",
          !!mirror && mirror.playerOpen === false, JSON.stringify(mirror));

    // --- F5: tua bằng gesture trong trình phát tích hợp -----------------
    const winS = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winS, scriptList(false));
    winS.__bintvMoviePlaybackHooks.setBrowserOpen(true);
    winS.__bintvMoviePlaybackHooks.startPlayback("https://cdn.vn/x/movie.mp4", "Phim Lẻ",
                                                 { name: "1080p AAC" });
    const bounds = winS.__bintvPlayerBeginSeek();
    check("F", "__bintvPlayerBeginSeek trả vị trí/thời lượng của trình phát",
          !!bounds && typeof bounds.position === "number" && typeof bounds.duration === "number",
          JSON.stringify(bounds));
    check("F", "__bintvPlayerSeekTo(giây) thực hiện tua (không lỗi)",
          winS.__bintvPlayerSeekTo(120) === true);
    check("F", "__bintvPlayerSeekTo từ chối giá trị không hợp lệ",
          winS.__bintvPlayerSeekTo(NaN) === false && winS.__bintvPlayerSeekTo(-5) === false);
    check("F", "__bintvPlayerEndSeek kết thúc phiên tua", winS.__bintvPlayerEndSeek() === true);

    // --- F7: lỗi "ma" đến muộn SAU khi trình phát đã đóng → không handoff -
    const winL = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winL, scriptList(false));
    const hooksL = winL.__bintvMoviePlaybackHooks;
    hooksL.setBrowserOpen(true);
    hooksL.startPlayback("https://cdn.vn/x/movie.mp4", "Phim Lẻ", { name: "1080p AAC" });
    winL.__posted.length = 0;
    hooksL.setPlayerOpen(false);              // người dùng Return / tự chuyển tập
    winL.document.getElementById("bintv-movie-html5-player")
        .dispatchEvent(new winL.Event("error"));
    check("F", "lỗi đến muộn sau khi trình phát đóng → KHÔNG mở trình phát iOS",
          winL.__posted.length === 0, JSON.stringify(winL.__posted));

    // --- F6: wiring Swift của gesture (nguồn) ---------------------------
    check("F", "ContentView: BinTVPlayerGestureHub (ngữ cảnh trình phát)",
          /final class BinTVPlayerGestureHub/.test(contentSrc)
          && /struct BinTVPlayerGestureContext/.test(contentSrc));
    check("F", "ContentView: có trình phát → vuốt ngang cạnh = TUA (không Return)",
          /seekSession/.test(contentSrc) && /applySeek\(/.test(contentSrc));
    check("F", "ContentView: vuốt từ TRÊN xuống = đóng trình phát (Return)",
          /edge == \.top/.test(contentSrc) && /player\.close\(\)/.test(contentSrc));
    check("F", "ContentView: recognizer .top chỉ gắn 1 lần + nhận khi có player",
          /installEdgeSwipe\(\.top/.test(contentSrc));
    check("F", "PhimWebView.swift đăng ký ngữ cảnh trình phát web",
          /BinTVPlayerGestureHub\.shared\.register/.test(webViewSrc));
    check("F", "PhimNativePlayerController.swift đăng ký ngữ cảnh trình phát iOS",
          /BinTVPlayerGestureHub\.shared\.register/.test(nativeSrc));
    check("F", "Return của tab PHIM đi qua web app (__bintvPhimReturn)",
          /__bintvPhimReturn/.test(webViewSrc));
    check("F", "PhimWebView.swift xử lý message uiState từ web app",
          /"uiState"/.test(webViewSrc));
}

function suiteG() {
    console.log("\n=== SUITE G (build 241): mặc định mở PHIM + menu LONG-PRESS trong player ===");
    const contentSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "ContentView.swift"), "utf8");
    const menuSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "GestureOverlayMenuView.swift"), "utf8");
    const webViewSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const nativeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    const tubeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "MovieListView.swift"), "utf8");
    const liveSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "PlayerView.swift"), "utf8");

    // --- G1: module mặc định khi mở app = PHIM --------------------------
    check("G", "Mở app → selectedTab mặc định = PHIM",
          /@State private var selectedTab: Int = BinTVPage\.phim\.rawValue/.test(contentSrc));
    check("G", "mountedTabs mặc định mount sẵn PHIM",
          /mountedTabs: Set<Int> = \[BinTVPage\.phim\.rawValue\]/.test(contentSrc));
    check("G", "tabHistory khởi đầu từ PHIM",
          /tabHistory: \[Int\] = \[BinTVPage\.phim\.rawValue\]/.test(contentSrc));
    check("G", "KHÔNG còn mặc định vào LIVE TV",
          !/selectedTab: Int = BinTVPage\.liveTV\.rawValue/.test(contentSrc));

    // --- G2: trung tâm menu + overlay -----------------------------------
    check("G", "BinTVPlayerMenuCenter + BinTVPlayerMenuContext tồn tại",
          /final class BinTVPlayerMenuCenter/.test(menuSrc)
          && /struct BinTVPlayerMenuContext/.test(menuSrc));
    check("G", "Menu có icon TẬP (list.bullet.rectangle) và BACK (chevron.backward)",
          /list\.bullet\.rectangle/.test(menuSrc) && /chevron\.backward/.test(menuSrc));
    check("G", "Nút TẬP chỉ thêm cho PHIM có nhiều tập",
          /case \.phim\(let episodes\) = kind, episodes/.test(menuSrc));
    check("G", "Menu được thêm vào KEY WINDOW (phủ được modal/fullscreen)",
          /topWindow/.test(menuSrc));
    check("G", "Long-press không có player → chạy fallback (BACK 1 lớp)",
          /func handleLongPress\(fallback:/.test(menuSrc)
          && /fallback\(\)/.test(menuSrc));
    check("G", "Menu đang mở: giữ lần nữa bị bỏ qua (không back/chuyển trang chồng)",
          /guard !isPresented else \{ return \}/.test(menuSrc));
    check("G", "Chạm nút bị khoá sau 1 lần (không Back nhiều lớp)",
          /func freezeUserInteraction/.test(menuSrc));

    // --- G3: đăng ký ngữ cảnh của TỪNG trình phát -----------------------
    check("G", "Player iOS PHIM đăng ký 'phim-native' (ưu tiên 100, TẬP theo episodeItems)",
          /id: "phim-native"/.test(nativeSrc) && /priority: 100/.test(nativeSrc)
          && /episodeItems\.count \?\? 0\) >= 2/.test(nativeSrc)
          && /func requestEpisodePicker/.test(nativeSrc));
    check("G", "Player web PHIM đăng ký 'phim-web' (ưu tiên 50)",
          /id: "phim-web"/.test(webViewSrc) && /priority: 50/.test(webViewSrc)
          && /webEpisodeCount \?\? 0\) >= 2/.test(webViewSrc));
    check("G", "TẬP của player web gọi điểm vào __bintvOpenPlayerEpisodes (không click nút DOM)",
          /__bintvOpenPlayerEpisodes/.test(webViewSrc)
          && !/bintv-movie-player-episodes-btn/.test(webViewSrc));
    check("G", "TUBE đăng ký 'tube' (ưu tiên 60) — menu KHÔNG có TẬP",
          /id: "tube"/.test(tubeSrc) && /priority: 60/.test(tubeSrc)
          && /kind: \{ \.other \}/.test(tubeSrc));
    check("G", "BACK TUBE: fullscreen → thoát fullscreen trước (1 lớp)",
          /func backOneLayer/.test(tubeSrc) && /jsExitFullscreen/.test(tubeSrc));
    check("G", "LIVE TV đăng ký 'livetv' (ưu tiên 80) và gỡ khi đóng sheet",
          /id: "livetv"/.test(liveSrc) && /priority: 80/.test(liveSrc)
          && /unregister\(id: "livetv"\)/.test(liveSrc));
    check("G", "BACK LIVE TV: FULL cover → inline; inline → lưới kênh (đúng 1 lớp)",
          /FULL → inline/.test(liveSrc) && /inline → lưới kênh/.test(liveSrc));

    // --- G4: MỌI recognizer long-press đi qua menu center ---------------
    check("G", "ContentView: long-press cửa sổ đi qua menu center",
          /handlePlayerAwareLongPress/.test(contentSrc)
          && /installLongPressOnAllWindows/.test(contentSrc));
    check("G", "Long-press được gắn trên MỌI UIWindow (kể cả fullscreen WebKit)",
          /UIWindow\.didBecomeVisibleNotification/.test(contentSrc)
          && /UIWindow\.didBecomeKeyNotification/.test(contentSrc));
    check("G", "PHIM webview route long-press qua menu center",
          /BinTVPlayerMenuCenter\.shared\.handleLongPress/.test(webViewSrc));
    check("G", "TUBE webview route long-press qua menu center",
          /BinTVPlayerMenuCenter\.shared\.handleLongPress/.test(tubeSrc));
    check("G", "Player LIVE TV route long-press qua menu center",
          /BinTVPlayerMenuCenter\.shared\.handleLongPress/.test(liveSrc));
    check("G", "Chọn module từ menu: gỡ player phủ màn hình rồi đổi tab",
          /handlePlayerMenuSelectTab/.test(contentSrc)
          && /onLeaveToOtherTab/.test(contentSrc));
    check("G", "Menu player đang phủ → gesture nền tạm nhường (không xuyên qua)",
          /if BinTVPlayerMenuCenter\.shared\.isPresented \{ return false \}/.test(contentSrc));

    // --- G5: runtime app.js — nút TẬP chỉ mở với phim bộ nhiều tập ------
    const winS = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winS, scriptList(false));
    const hS = winS.__bintvMoviePlaybackHooks;
    hS.setBrowserOpen(true);
    hS.setEpisodes([
        { id: "e1", title: "Tập 1" },
        { id: "e2", title: "Tập 2" },
        { id: "e3", title: "Tập 3" }
    ], "series", "Phim Bộ", 0);
    hS.startPlayback("https://cdn.vn/f/ep1.mp4", "Phim Bộ T1", { name: "1080p AAC" });
    check("G", "PHIM BỘ 3 tập: hasEpisodeList = true", hS.hasEpisodeList() === true);
    // [build 242] Nút TẬP trên màn hình video đã bị GỠ — menu long-press gọi
    // thẳng điểm vào window.__bintvOpenPlayerEpisodes() của app.js.
    check("G", "PHIM BỘ: điểm vào TẬP cho menu long-press tồn tại",
          typeof winS.__bintvOpenPlayerEpisodes === "function");
    check("G", "PHIM BỘ: gọi TẬP (từ menu) trả true",
          winS.__bintvOpenPlayerEpisodes() === true);
    check("G", "PHIM BỘ: gọi TẬP → mở danh sách tập trong player",
          winS.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));
    const epPostsS = winS.__posted.filter(function (m) { return m.action === "episodes"; });
    const epShow = epPostsS[epPostsS.length - 1];
    check("G", "PHIM BỘ: mở TẬP → post episodes(show:true, đủ 3 mục) cho picker",
          !!epShow && epShow.show === true && epShow.items.length === 3,
          JSON.stringify(epShow));

    const winL = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winL, scriptList(false));
    const hL = winL.__bintvMoviePlaybackHooks;
    hL.setBrowserOpen(true);
    hL.setEpisodes([{ id: "m1", title: "Phim Lẻ" }], "movie", "Phim Lẻ", -1);
    hL.startPlayback("https://cdn.vn/f/movie.mp4", "Phim Lẻ", { name: "1080p AAC" });
    check("G", "PHIM LẺ (1 tập): hasEpisodeList = false → menu không có TẬP",
          hL.hasEpisodeList() === false);
    const epPostsL = winL.__posted.filter(function (m) { return m.action === "episodes"; });
    check("G", "PHIM LẺ: app.js post episodes items: [] (Swift ẩn nút TẬP)",
          epPostsL.some(function (m) { return Array.isArray(m.items) && m.items.length === 0; }),
          JSON.stringify(epPostsL));
    check("G", "PHIM LẺ: gọi TẬP trả false (không mở danh sách tập)",
          winL.__bintvOpenPlayerEpisodes() === false);
    check("G", "PHIM LẺ: danh sách tập KHÔNG mở",
          !winL.document.getElementById("bintv-movie-player-episodes").classList.contains("show"));
}

// =====================================================================
// SUITE H (build 242) — TRÌNH PHÁT KHÔNG CÒN NÚT "TẬP" / TÊN PHIM
// ---------------------------------------------------------------------
// Yêu cầu: gỡ HOÀN TOÀN nút TẬP + tên phim đang render trực tiếp trong
// trình phát video (cả player web của app.js lẫn player native iOS), giữ
// nguyên chức năng TẬP trong MENU LONG-PRESS.
// =====================================================================
function suiteH() {
    console.log("\n=== SUITE H (build 242): gỡ nút TẬP + tên phim khỏi trình phát ===");
    const indexHtml = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
    const appJs = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");
    const webViewSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const nativeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    const menuSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "GestureOverlayMenuView.swift"), "utf8");
    const cssFiles = ["style.css", "landscape.css", "phone.css", "phim_ui.css"].map(function (f) {
        return { name: f, src: fs.readFileSync(path.join(ASSETS, f), "utf8") };
    });

    // --- H1: HTML tĩnh -------------------------------------------------
    check("H", "index.html KHÔNG còn nút 'Tập' (#bintv-movie-player-episodes-btn)",
          indexHtml.indexOf("bintv-movie-player-episodes-btn") === -1);
    check("H", "index.html KHÔNG còn tên phim trong player (#bintv-movie-player-title)",
          indexHtml.indexOf("bintv-movie-player-title") === -1);
    check("H", "index.html KHÔNG còn class .movie-player-title / .movie-player-episodes-btn",
          !/class="[^"]*movie-player-title/.test(indexHtml)
          && !/class="[^"]*movie-player-episodes-btn/.test(indexHtml));
    check("H", "index.html VẪN còn danh sách tập #bintv-movie-player-episodes (menu TẬP mở)",
          /id="bintv-movie-player-episodes"/.test(indexHtml)
          && /id="bintv-movie-player-episodes-list"/.test(indexHtml));
    check("H", "index.html VẪN còn dòng trạng thái + timeline + phụ đề của player",
          /id="bintv-movie-player-status"/.test(indexHtml)
          && /id="bintv-movie-seek-timeline"/.test(indexHtml)
          && /id="bintv-movie-subtitle-text"/.test(indexHtml));

    // --- H2: app.js (template dựng player + hàm) -----------------------
    check("H", "app.js KHÔNG còn tạo nút 'Tập' khi dựng player",
          appJs.indexOf("bintv-movie-player-episodes-btn") === -1
          || appJs.split("bintv-movie-player-episodes-btn").length - 1
             === (appJs.match(/\/\/.*bintv-movie-player-episodes-btn/g) || []).length);
    check("H", "app.js KHÔNG còn phần tử tên phim #bintv-movie-player-title",
          appJs.indexOf("getElementById(\"bintv-movie-player-title\")") === -1);
    check("H", "app.js bỏ hẳn wireMoviePlayerEpisodeButton / refreshMoviePlayerEpisodeButton",
          appJs.indexOf("wireMoviePlayerEpisodeButton") === -1
          && appJs.indexOf("refreshMoviePlayerEpisodeButton") === -1);
    check("H", "app.js export điểm vào TẬP cho menu long-press",
          /window\.__bintvOpenPlayerEpisodes = function/.test(appJs));
    check("H", "app.js GIỮ NGUYÊN hàm mở danh sách tập + đồng bộ native",
          /function openMoviePlayerEpisodeMenu\(\)/.test(appJs)
          && /function syncNativeEpisodeList\(showPicker\)/.test(appJs)
          && /function renderMoviePlayerEpisodeMenu\(\)/.test(appJs));

    // --- H3: CSS không còn rule của nút/tên phim -----------------------
    cssFiles.forEach(function (css) {
        check("H", css.name + " không còn rule .movie-player-episodes-btn / .movie-player-title",
              !/\.movie-player-episodes-btn\s*[{:]/.test(css.src)
              && !/\.movie-player-title\s*[{:]/.test(css.src));
    });

    // --- H4: player NATIVE iOS không vẽ nút "Tập" lên overlay ----------
    check("H", "Swift native KHÔNG còn tạo UIButton \"Tập\" trên trình phát",
          nativeSrc.indexOf("setTitle(\"Tập\"") === -1
          && nativeSrc.indexOf("episodesButton") === -1);
    check("H", "Swift native bỏ refreshEpisodesButton / toggleEpisodePicker / removeEpisodesButton",
          !/func refreshEpisodesButton/.test(nativeSrc)
          && !/func toggleEpisodePicker/.test(nativeSrc)
          && !/func removeEpisodesButton/.test(nativeSrc));
    // [build 245] panel danh sách tập đã CHUYỂN LÊN view gốc của trình phát
    // (lớp trên cùng, trên cả progress/seek bar — xem SUITE J); contentOverlayView
    // từ build này CHỈ còn treo phụ đề.
    check("H", "Swift native KHÔNG thêm subview cố định nào khác vào contentOverlayView ngoài phụ đề",
          (nativeSrc.match(/overlay\.addSubview\(/g) || []).length === 1);
    check("H", "Swift native VẪN giữ panel danh sách tập + điểm vào từ menu",
          /func requestEpisodePicker\(\)/.test(nativeSrc)
          && /private func showEpisodePicker\(\)/.test(nativeSrc)
          && /private func hideEpisodePicker\(\)/.test(nativeSrc)
          && /func updateEpisodes\(/.test(nativeSrc));
    check("H", "Menu long-press VẪN có nút TẬP cho phim bộ (GestureOverlayMenuView)",
          /label: "TẬP"/.test(menuSrc) && /case \.phim\(let episodes\) = kind, episodes/.test(menuSrc));
    check("H", "Swift (web) KHÔNG còn tham chiếu nút DOM đã gỡ",
          webViewSrc.indexOf("bintv-movie-player-episodes-btn") === -1);

    // --- H5: RUNTIME (jsdom) — DOM player thật sau khi phát ------------
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(win, scriptList(false));
    const hooks = win.__bintvMoviePlaybackHooks;
    hooks.setBrowserOpen(true);
    hooks.setEpisodes([
        { id: "e1", title: "Tập 1" },
        { id: "e2", title: "Tập 2" },
        { id: "e3", title: "Tập 3" }
    ], "series", "Phim Bộ Nhiều Tập", 0);
    hooks.startPlayback("https://cdn.vn/f/ep1.mp4", "Phim Bộ Nhiều Tập · Tập 1", { name: "1080p AAC" });

    const doc = win.document;
    const player = doc.getElementById("bintv-movie-player");
    const overlay = player.querySelector(".movie-player-overlay");
    check("H", "RUNTIME: player không có phần tử #bintv-movie-player-episodes-btn",
          doc.getElementById("bintv-movie-player-episodes-btn") === null);
    check("H", "RUNTIME: player không có phần tử #bintv-movie-player-title",
          doc.getElementById("bintv-movie-player-title") === null);
    check("H", "RUNTIME: overlay trình phát KHÔNG chứa bất kỳ <button> nào",
          overlay.querySelectorAll("button").length === 0,
          String(overlay.querySelectorAll("button").length));
    check("H", "RUNTIME: overlay trình phát KHÔNG hiển thị tên phim",
          overlay.textContent.indexOf("Phim Bộ Nhiều Tập") === -1, overlay.textContent);
    check("H", "RUNTIME: TOÀN BỘ player không còn nút nào chữ 'Tập'",
          Array.prototype.slice.call(player.querySelectorAll("button"))
              .filter(function (b) { return (b.textContent || "").trim() === "Tập"; }).length === 0);
    check("H", "RUNTIME: trạng thái phát vẫn hiển thị (không phá HUD còn lại)",
          doc.getElementById("bintv-movie-player-status").textContent.length > 0);

    // Menu long-press (Swift) gọi điểm vào → danh sách tập mở + đủ 3 tập.
    check("H", "RUNTIME: điểm vào TẬP của menu mở danh sách tập",
          win.__bintvOpenPlayerEpisodes() === true
          && doc.getElementById("bintv-movie-player-episodes").classList.contains("show"));
    const rows = doc.querySelectorAll("#bintv-movie-player-episodes-list .movie-player-episode-option");
    check("H", "RUNTIME: danh sách tập render đủ 3 tập đúng tiêu đề",
          rows.length === 3 && rows[0].textContent === "Tập 1" && rows[2].textContent === "Tập 3",
          rows.length + " rows");
    check("H", "RUNTIME: tập đang phát được đánh dấu current",
          rows[0].classList.contains("current"));

    // Player bị gỡ khỏi DOM rồi dựng lại (nhánh ensureMovieExperienceUI tạo
    // innerHTML) cũng KHÔNG được sinh ra nút TẬP/tên phim mới.
    player.parentNode.removeChild(player);
    hooks.startPlayback("https://cdn.vn/f/ep2.mp4", "Phim Bộ Nhiều Tập · Tập 2", { name: "720p" });
    const rebuilt = doc.getElementById("bintv-movie-player");
    check("H", "RUNTIME: player dựng lại không sinh nút TẬP/tên phim",
          !!rebuilt
          && rebuilt.querySelector("#bintv-movie-player-episodes-btn") === null
          && rebuilt.querySelector("#bintv-movie-player-title") === null
          && rebuilt.querySelector(".movie-player-overlay button") === null);
    check("H", "RUNTIME: player dựng lại vẫn có danh sách tập (mở từ menu)",
          !!rebuilt.querySelector("#bintv-movie-player-episodes-list"));

    // Phim lẻ: điểm vào TẬP trả false, không sinh nút nào.
    const winL = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(winL, scriptList(false));
    const hL = winL.__bintvMoviePlaybackHooks;
    hL.setBrowserOpen(true);
    hL.setEpisodes([{ id: "m1", title: "Phim Lẻ" }], "movie", "Phim Lẻ", -1);
    hL.startPlayback("https://cdn.vn/f/movie.mp4", "Phim Lẻ 2026", { name: "1080p" });
    check("H", "RUNTIME phim lẻ: không có nút TẬP/tên phim trong player",
          winL.document.getElementById("bintv-movie-player-episodes-btn") === null
          && winL.document.getElementById("bintv-movie-player-title") === null);
    check("H", "RUNTIME phim lẻ: điểm vào TẬP trả false",
          winL.__bintvOpenPlayerEpisodes() === false);
}

// =====================================================================
// SUITE I — [build 243] MỘT TRÌNH PHÁT DUY NHẤT CHO MODULE PHIM
//
// Yêu cầu được kiểm tra:
//   I1. CHƯA chọn trình phát → KHÔNG player nào nạp video; chuyển sang
//       SETTING (message phimBridge action "needPlayerChoice"); nhớ đúng
//       phim/tập đang chờ.
//   I2. Chọn xong trong SETTING → Swift đẩy lựa chọn (resume=true) → phát
//       TIẾP ĐÚNG phim/tập vừa chọn, chỉ bằng trình phát đã chọn.
//   I3. Đã chọn "native" → CHỈ trình phát iOS nhận URL; thẻ <video> không
//       bao giờ có src (không preload, không tạo instance chờ sẵn).
//   I4. Đã chọn "integrated" → chỉ thẻ <video> nhận URL; nguồn lỗi cũng
//       KHÔNG mở trình phát iOS.
//   I5. Không có cầu nối iOS (Android/Tizen/Windows) → hành vi cũ giữ nguyên.
//   I6. Wiring Swift: UserDefaults + mục SETTING + điều hướng tab + user script.
// =====================================================================
function suiteI() {
    console.log("\n=== SUITE I (build 243): một trình phát duy nhất theo lựa chọn người dùng ===");
    const appSrc = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");
    const webViewSrc = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const prefsSrc = fs.readFileSync(path.join(REPO, "BinTV", "Storage", "Preferences.swift"), "utf8");
    const settingsSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "SettingsView.swift"), "utf8");
    const contentSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "ContentView.swift"), "utf8");
    const URL1 = "https://cdn.vnstream.xyz/f/movie-a-ep5.m3u8?pkey=SECRET";
    const TITLE1 = "Phim A · Tập 5";

    function playPosts(win) {
        return win.__posted.filter(function (m) {
            return m.action !== "stop" && m.action !== "episodes" && m.action !== "hideEpisodes";
        });
    }
    function videoSrc(win) {
        const video = win.document.getElementById("bintv-movie-html5-player");
        return video ? String(video.getAttribute("src") || "") : "";
    }

    // --- I1: CHƯA chọn trình phát → không nạp player nào, sang SETTING ----
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "");
    bootWebApp(win, scriptList(false));
    const hooks = win.__bintvMoviePlaybackHooks;
    hooks.setBrowserOpen(true);
    check("I", "cầu nối lựa chọn được tiêm từ Swift (playerChoiceJS)",
          typeof win.__bintvPhimPlayerChoice === "function"
          && typeof win.__bintvSetPhimPlayerChoice === "function");
    check("I", "chưa lưu lựa chọn → movieChosenPlayer() = '' ", hooks.chosenPlayer() === "");
    win.__posted.length = 0;
    win.__bridgePosted.length = 0;
    hooks.startPlayback(URL1, TITLE1, { name: "1080p", stream: { name: "1080p" } });
    check("I", "chưa chọn trình phát → KHÔNG gửi gì sang trình phát iOS",
          playPosts(win).length === 0, JSON.stringify(win.__posted));
    check("I", "chưa chọn trình phát → thẻ <video> KHÔNG nhận src (không preload)",
          videoSrc(win) === "", videoSrc(win));
    check("I", "chưa chọn trình phát → overlay trình phát KHÔNG mở",
          !win.document.getElementById("bintv-movie-player").classList.contains("show"));
    const needMsg = win.__bridgePosted.filter(function (m) { return m.action === "needPlayerChoice"; });
    check("I", "→ báo Swift chuyển sang SETTING (action=needPlayerChoice, kèm tên phim)",
          needMsg.length === 1 && needMsg[0].title === TITLE1, JSON.stringify(win.__bridgePosted));
    const pending = hooks.pendingPlayerChoice();
    check("I", "→ nhớ ĐÚNG phim/tập đang chờ để phát tiếp",
          !!pending && pending.title === TITLE1 && pending.url === URL1, JSON.stringify(pending));
    const statusI1 = (win.document.getElementById("bintv-movie-status") || {}).textContent || "";
    check("I", "→ hiện trạng thái rõ ràng cho người dùng",
          /SETTING/.test(statusI1), statusI1);

    // --- I2: chọn xong trong SETTING → phát tiếp đúng phim/tập ------------
    win.__posted.length = 0;
    const resumed = win.__bintvPhimPlayerChoiceSelected({ choice: "integrated", resume: true });
    check("I", "lưu lựa chọn (resume) → phát lại phim/tập đang chờ", resumed === true);
    check("I", "→ ĐÚNG trình phát đã chọn (tích hợp) nhận nguồn",
          videoSrc(win).indexOf("movie-a-ep5") !== -1, videoSrc(win));
    check("I", "→ vẫn KHÔNG mở trình phát iOS", playPosts(win).length === 0,
          JSON.stringify(win.__posted));
    check("I", "→ overlay trình phát mở", win.document.getElementById("bintv-movie-player")
          .classList.contains("show"));
    check("I", "→ yêu cầu chờ đã được giải toả", hooks.pendingPlayerChoice() === null);
    check("I", "lần phát thứ 2 (đã lưu lựa chọn) → KHÔNG hỏi lại SETTING",
          (function () {
              win.__bridgePosted.length = 0;
              hooks.startPlayback("https://cdn.vnstream.xyz/f/movie-b-ep1.mp4", "Phim B · Tập 1",
                                  { name: "720p" });
              const asked = win.__bridgePosted.filter(function (m) {
                  return m.action === "needPlayerChoice";
              });
              return asked.length === 0 && videoSrc(win).indexOf("movie-b-ep1") !== -1;
          })(), JSON.stringify(win.__bridgePosted));
    check("I", "đẩy lựa chọn KHÔNG kèm resume → chỉ cập nhật, không tự phát phim cũ",
          (function () {
              const win2 = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "");
              bootWebApp(win2, scriptList(false));
              win2.__bintvMoviePlaybackHooks.setBrowserOpen(true);
              win2.__bintvMoviePlaybackHooks.startPlayback(URL1, TITLE1, { name: "1080p" });
              const before = videoSrc(win2);
              win2.__bintvPhimPlayerChoiceSelected({ choice: "integrated", resume: false });
              return before === "" && videoSrc(win2) === ""
                  && win2.__bintvMoviePlaybackHooks.chosenPlayer() === "integrated";
          })());

    // --- I3: đã chọn TRÌNH PHÁT iOS → chỉ AVPlayer nhận URL ---------------
    const winN = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "native");
    bootWebApp(winN, scriptList(false));
    const hooksN = winN.__bintvMoviePlaybackHooks;
    hooksN.setBrowserOpen(true);
    winN.__posted.length = 0;
    hooksN.startPlayback(URL1, TITLE1, { name: "1080p AC3", stream: { name: "1080p AC3" } });
    const nativePosts = playPosts(winN);
    check("I", "đã chọn trình phát iOS → gửi ĐÚNG 1 yêu cầu phát cho AVPlayer",
          nativePosts.length === 1, JSON.stringify(winN.__posted));
    check("I", "→ lý do = user-chosen-native-player (không phải fallback do lỗi)",
          nativePosts.length === 1 && nativePosts[0].reason === "user-chosen-native-player",
          nativePosts.length ? nativePosts[0].reason : "không gửi gì");
    check("I", "→ đúng URL người dùng chọn tập", nativePosts.length === 1
          && nativePosts[0].url === URL1, nativePosts.length ? nativePosts[0].url : "");
    check("I", "→ thẻ <video> KHÔNG BAO GIỜ nhận src (không tạo/preload player thứ 2)",
          videoSrc(winN) === "", videoSrc(winN));
    // Native fail → nguồn dự phòng kế tiếp VẪN đi qua trình phát iOS (không
    // bao giờ kéo thẻ <video> vào).
    winN.__posted.length = 0;
    hooksN.setHandoffActive(true);
    winN.__bintvNativePlaybackFailed({ session: nativePosts[0].session, message: "AVPlayerItem failed" });
    check("I", "trình phát iOS lỗi → KHÔNG kéo trình phát tích hợp vào",
          videoSrc(winN) === "", videoSrc(winN));

    // --- I4: đã chọn TRÌNH PHÁT TÍCH HỢP → không preload sang iOS ---------
    const winW = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true, "integrated");
    bootWebApp(winW, scriptList(false));
    const hooksW = winW.__bintvMoviePlaybackHooks;
    hooksW.setBrowserOpen(true);
    winW.__posted.length = 0;
    hooksW.startPlayback("https://cdn.vnstream.xyz/f/movie.mkv", "Phim MKV AC3",
                         { name: "1080p AC3", stream: { name: "1080p AC3" } });
    check("I", "đã chọn trình phát tích hợp → chỉ thẻ <video> nhận nguồn",
          videoSrc(winW).indexOf("movie.mkv") !== -1 && playPosts(winW).length === 0,
          videoSrc(winW) + " | " + JSON.stringify(winW.__posted));
    winW.__posted.length = 0;
    hooksW.playbackError();
    check("I", "→ nguồn lỗi vẫn KHÔNG mở trình phát iOS (một player duy nhất)",
          playPosts(winW).length === 0, JSON.stringify(winW.__posted));
    // Handoff trực tiếp cũng bị chặn khi người dùng đã chọn trình phát tích hợp.
    check("I", "→ __bintvRequestNativePlayback bị chặn khi đã chọn trình phát tích hợp",
          winW.__bintvRequestNativePlayback("ios-fallback-error") === false);

    // --- I5: không có cầu nối iOS → hành vi cũ (phát bằng thẻ <video>) ----
    const winAndroid = makeWindow("http://127.0.0.1:3000/?android=phone", false, "");
    bootWebApp(winAndroid, scriptList(false));
    winAndroid.__bintvMoviePlaybackHooks.setBrowserOpen(true);
    winAndroid.__bintvMoviePlaybackHooks.startPlayback(URL1, TITLE1, { name: "1080p" });
    check("I", "Android/Tizen/Windows (không cầu nối) → phát như cũ, không hỏi SETTING",
          String(winAndroid.document.getElementById("bintv-movie-html5-player")
              .getAttribute("src") || "").indexOf("movie-a-ep5") !== -1);

    // --- I6: wiring Swift (nguồn) ----------------------------------------
    check("I", "Preferences: enum PhimPlayerChoice {integrated, native}",
          /enum PhimPlayerChoice: String/.test(prefsSrc)
          && /case integrated/.test(prefsSrc) && /case native/.test(prefsSrc));
    check("I", "Preferences: lưu UserDefaults (giữ qua các lần đóng/mở app)",
          /defaults\.set\(newValue\.rawValue, forKey: Self\.phimPlayerChoiceKey\)/.test(prefsSrc)
          && /phimPlayerChoiceKey = "phimPlayerChoice"/.test(prefsSrc));
    check("I", "Preferences: chưa chọn = nil (không mặc định thay người dùng)",
          /var phimPlayerChoice: PhimPlayerChoice\?/.test(prefsSrc));
    check("I", "SETTINGS có mục 'Trình phát PHIM' với đúng tên 2 trình phát",
          /return "Trình phát PHIM"/.test(settingsSrc)
          && /return "Trình phát tích hợp"/.test(prefsSrc)
          && /return "Trình phát iOS"/.test(prefsSrc));
    check("I", "SETTINGS lưu lựa chọn qua PhimPlayerChoiceCenter.save",
          /PhimPlayerChoiceCenter\.shared\.save\(choice\)/.test(settingsSrc));
    check("I", "SETTINGS luôn vào được (mục trong cột trái, không chỉ khi bị chuyển sang)",
          /case playback, phimPlayer, network, urls/.test(settingsSrc));
    check("I", "ContentView: needPlayerChoice → chuyển sang tab SETTING",
          /binTVPhimPlayerChoiceNeeded/.test(contentSrc)
          && /selectTab\(BinTVPage\.settings\.rawValue\)/.test(contentSrc));
    check("I", "ContentView: lưu lựa chọn (có phim chờ) → quay lại tab PHIM",
          /binTVPhimPlayerChoiceSaved/.test(contentSrc)
          && /selectTab\(BinTVPage\.phim\.rawValue\)/.test(contentSrc));
    check("I", "PhimWebView: user script playerChoiceJS tiêm ở document-start",
          /Self\.playerChoiceJS/.test(webViewSrc)
          && /__bintvPhimPlayerChoice = function/.test(webViewSrc));
    check("I", "PhimWebView: xử lý message needPlayerChoice",
          /case "needPlayerChoice"/.test(webViewSrc));
    check("I", "PhimWebView: đẩy lựa chọn đã lưu sang web app (didFinish + khi lưu)",
          /pushPhimPlayerChoice\(resume: false\)/.test(webViewSrc)
          && /forName: \.binTVPhimPlayerChoiceSaved/.test(webViewSrc));
    check("I", "app.js: không còn đường 'leo thang' khi người dùng đã chọn tích hợp",
          /movieUserChoseIntegratedPlayer\(\)/.test(appSrc));
}

// =====================================================================
// SUITE J (build 245) — DANH SÁCH TẬP NẰM LỚP TRÊN CÙNG, KHÔNG ĐỤNG SEEK BAR
// ---------------------------------------------------------------------
// Yêu cầu: trong trình phát PHIM, giữ màn hình → TẬP → danh sách tập phải
// ở LỚP TRÊN CÙNG (trên progress/seek bar + mọi control), nhận TOÀN BỘ cảm
// ứng trong vùng của nó: vuốt lên/xuống CHỈ cuộn danh sách, KHÔNG làm tua
// video; đóng/chọn tập xong → seek bar nhận lại thao tác như cũ (không để
// overlay vô hình chặn touch). Chỉ thay đổi lớp hiển thị + ưu tiên touch,
// KHÔNG đổi luồng mở/chọn tập (menu long-press → TẬP → pickEpisode → JS).
// =====================================================================
function suiteJ() {
    console.log("\n=== SUITE J (build 245): danh sách TẬP lớp trên cùng, ưu tiên cảm ứng ===");
    const nativeSrc = fs.readFileSync(path.join(REPO, "BinTV", "Player", "PhimNativePlayerController.swift"), "utf8");
    const contentSrc = fs.readFileSync(path.join(REPO, "BinTV", "Views", "ContentView.swift"), "utf8");

    // Cắt thân một hàm: từ startMarker tới endMarker (để assert ĐÚNG trong
    // hàm cần kiểm tra, không bắt nhầm chỗ khác của file).
    function body(src, startMarker, endMarker) {
        const s = src.indexOf(startMarker);
        if (s === -1) return "";
        const e = endMarker ? src.indexOf(endMarker, s + startMarker.length) : -1;
        return src.slice(s, e === -1 ? undefined : e);
    }
    const showBody = body(nativeSrc, "private func showEpisodePicker()", "@objc private func pickEpisode");
    const hideBody = body(nativeSrc, "private func hideEpisodePicker()", "private func removeSubtitleOverlay");
    const teardownBody = body(nativeSrc, "private func teardownCurrentItem()", "private func removeStallObserver");
    // Bản CHỈ-CODE (bỏ chú thích //…) để assert hành vi, không bắt chữ trong comment.
    const showCode = showBody.replace(/\/\/[^\n]*/g, "");

    // --- J1: panel ở LỚP TRÊN CÙNG của trình phát ----------------------
    check("J", "showEpisodePicker treo panel vào VIEW GỐC của trình phát (không phải contentOverlayView)",
          /playerController\?\.view/.test(showCode) && showCode.indexOf("contentOverlayView") === -1);
    check("J", "showEpisodePicker đưa panel lên ĐỈNH (bringSubviewToFront) + zPosition cao",
          /bringSubviewToFront\(panel\)/.test(showBody) && /panel\.layer\.zPosition\s*=\s*9\d\d/.test(showBody));
    check("J", "showEpisodePicker NÂNG CỜ ưu tiên cảm ứng cho gesture hub",
          /BinTVPlayerGestureHub\.shared\.setPlayerOverlayPresented\(true\)/.test(showBody));

    // --- J2: danh sách DỌC, vuốt LÊN/XUỐNG để cuộn ----------------------
    check("J", "danh sách tập dạng DỌC (UIStackView axis = .vertical)",
          /rowStack\.axis\s*=\s*\.vertical/.test(showBody));
    check("J", "scroll view cuộn DỌC (alwaysBounceVertical + content/frame layout guide)",
          /alwaysBounceVertical\s*=\s*true/.test(showBody)
          && /scroll\.contentLayoutGuide/.test(showBody)
          && /scroll\.frameLayoutGuide/.test(showBody));
    check("J", "KHÔNG còn danh sách ngang một dòng cao 56pt (rowStack .horizontal / heightAnchor 56)",
          showBody.indexOf("rowStack.axis = .horizontal") === -1
          && !/equalToConstant:\s*56\)/.test(showBody));

    // --- J3: gesture hub + delegate vuốt cạnh nhường danh sách tập ------
    check("J", "BinTVPlayerGestureHub có cờ overlay (set/isPlayerOverlayPresented)",
          /func setPlayerOverlayPresented\(_ presented: Bool\)/.test(contentSrc)
          && /var isPlayerOverlayPresented: Bool/.test(contentSrc));
    check("J", "delegate vuốt cạnh (BinTVEdgeSwipeRecognizer) NHƯỜNG khi danh sách tập mở",
          /if gestureRecognizer is BinTVEdgeSwipeRecognizer \{[\s\S]*?BinTVPlayerGestureHub\.shared\.isPlayerOverlayPresented \{ return false \}/.test(contentSrc));

    // --- J4: đóng/chọn tập → dọn SẠCH, seek bar hoạt động lại ----------
    check("J", "hideEpisodePicker gỡ panel khỏi hierarchy + HẠ CỜ ưu tiên cảm ứng",
          /removeFromSuperview\(\)/.test(hideBody)
          && /BinTVPlayerGestureHub\.shared\.setPlayerOverlayPresented\(false\)/.test(hideBody));
    check("J", "teardownCurrentItem cũng đóng danh sách tập (không sót overlay khi dừng/đổi nguồn/đóng player)",
          /hideEpisodePicker\(\)/.test(teardownBody));
    check("J", "pickEpisode vẫn đóng panel TRƯỚC khi báo JS chọn tập",
          /guard index >= 0[\s\S]*?hideEpisodePicker\(\)[\s\S]*?onSelectEpisode\?\(/.test(body(nativeSrc, "@objc private func pickEpisode", "private func hideEpisodePicker")));

    // --- J5: REGRESSION — luồng TẬP giữ nguyên, chỉ đổi lớp hiển thị ----
    check("J", "vẫn mở TẬP từ menu long-press (requestEpisodePicker, chỉ phim bộ ≥2 tập)",
          /func requestEpisodePicker\(\) \{[\s\S]*?guard isPresented, episodeItems\.count >= 2/.test(nativeSrc));
    check("J", "nút tập vẫn nối đúng action chọn tập cũ (#selector(pickEpisode(_:)))",
          /addTarget\(self, action: #selector\(pickEpisode\(_:\)\), for: \.touchUpInside\)/.test(showBody));
    check("J", "updateEpisodes/hideEpisodePickerOverlay (cầu nối JS) giữ nguyên",
          /func updateEpisodes\(_ items: \[\(id: String, title: String\)\], current: Int, showPicker: Bool\)/.test(nativeSrc)
          && /func hideEpisodePickerOverlay\(\)/.test(nativeSrc));
    check("J", "BACK trong player vẫn ưu tiên đóng danh sách tập trước (một lớp)",
          /if episodePickerView != nil \{[\s\S]*?hideEpisodePicker\(\)/.test(body(nativeSrc, "private func backOneLayerInPlayer()", "func closeByUserGesture()")));
    check("J", "phụ đề vẫn treo trên contentOverlayView (không bị dời chỗ oan)",
          /contentOverlayView/.test(body(nativeSrc, "private func installSubtitleOverlay()", "private func startSubtitleSync")));
    check("J", "mở danh sách tập vẫn TẠM DỪNG video như cũ (player?.pause())",
          /player\?\.pause\(\)/.test(showBody));
}

// These are DOM/event tests, not an iPhone/WebKit fullscreen simulation.
function suiteK() {
    console.log("\n=== SUITE K: retained PHIM player across Home events ===");
    for (const paused of [false, true]) {
        const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
        bootWebApp(win, scriptList(false));
        const video = win.document.getElementById("bintv-movie-html5-player");
        check("K", "HTML5 video exists", !!video);
        let mutations = 0;
        video.play = function () { mutations++; return Promise.resolve(); };
        video.pause = function () { mutations++; };
        video.load = function () { mutations++; };
        Object.defineProperty(video, "paused", { configurable: true, value: paused });
        video.currentTime = 123.5;
        video.controls = true;
        const parent = video.parentNode;
        const preference = win.__bintvInitialPlayerChoice;
        for (let i = 0; i < 10; i++) {
            win.__bintvPhimHostLifecycle.capture("native-willResignActive");
            Object.defineProperty(win.document, "hidden", { configurable: true, value: true });
            win.document.dispatchEvent(new win.Event("visibilitychange"));
            win.dispatchEvent(new win.Event("pagehide"));
            Object.defineProperty(win.document, "hidden", { configurable: true, value: false });
            win.dispatchEvent(new win.Event("pageshow"));
            win.document.dispatchEvent(new win.Event("visibilitychange"));
        }
        check("K", "Home events keep same video and parent: paused=" + paused,
              win.document.getElementById(video.id) === video && video.parentNode === parent);
        check("K", "Home events do not call play/pause/load", mutations === 0, mutations);
        check("K", "position, controls and pause remain owned by video",
              video.currentTime === 123.5 && video.controls && video.paused === paused);
        check("K", "Home events do not switch player or request native playback",
              preference === win.__bintvInitialPlayerChoice && win.__posted.length === 0);
        win.close();
    }
    const swift = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const probe = swift.slice(swift.indexOf("    private func probeLiveWebView("),
                              swift.indexOf("    private func safeProbeSummary("));
    check("K", "timeout/evaluator failure defer instead of rebuilding live fullscreen",
          probe.includes('deferForegroundProbe(reason: "evaluator unavailable"')
          && probe.includes('deferForegroundProbe(reason: "probe timeout')
          && !probe.includes('rebuildWebView(reason: "WKWebView did not answer'));
    check("K", "no forced recreation for missing presenting hierarchy",
          !swift.includes("waitForWebViewAttachment") && !swift.includes("hasUsableWebViewHierarchy"));
    const scene = swift.slice(swift.indexOf("    private func scenePhaseDidChange("),
                              swift.indexOf("    /// Save state before suspension"));
    check("K", "scene inactive/background/active use native-aware app lifecycle path",
          scene.includes("applicationWillResignActive()")
          && scene.includes("applicationDidEnterBackground()")
          && scene.includes("applicationDidBecomeActive()"));
}

function suiteL() {
    console.log("\n=== SUITE L (build 247): Giữ Landscape Fullscreen & Paused sau Home ===");
    const appSwift = fs.readFileSync(path.join(REPO, "BinTV/App/App.swift"), "utf8");
    const nativePlayerSwift = fs.readFileSync(path.join(REPO, "BinTV/Player/PhimNativePlayerController.swift"), "utf8");
    const webViewSwift = fs.readFileSync(SWIFT_WEBVIEW, "utf8");
    const appJs = fs.readFileSync(path.join(ASSETS, "app.js"), "utf8");

    // 1. App.swift: retry landscape orientation loop on foreground transition
    check("L", "App.swift có requestLandscapeOnForeground với retry loop",
          appSwift.includes("func requestLandscapeOnForeground(attempt: Int)")
          && appSwift.includes("DispatchQueue.main.asyncAfter(deadline: .now() + 0.15)"));
    check("L", "App.swift quan sát binTVScenePhaseDidChange để kích hoạt requestLandscapeOnForeground",
          appSwift.includes("binTVScenePhaseDidChange") && appSwift.includes("requestLandscapeOnForeground(attempt: 0)"));
    check("L", "App.swift khoá cứng landscapeLeft và landscapeRight",
          appSwift.includes("return .landscape")
          && appSwift.includes("interfaceOrientations: [.landscapeLeft, .landscapeRight]"));

    // 2. PhimNativePlayerController.swift: AVPlayerViewController subclass forcing landscape
    check("L", "PhimNativePlayerViewController tồn tại và ghi đè supportedInterfaceOrientations",
          nativePlayerSwift.includes("class PhimNativePlayerViewController: AVPlayerViewController")
          && nativePlayerSwift.includes("return [.landscapeLeft, .landscapeRight]"));
    check("L", "presentPlayerIfNeeded sử dụng PhimNativePlayerViewController",
          nativePlayerSwift.includes("let controller = PhimNativePlayerViewController()"));
    check("L", "PhimNativePlayerController có enforceLandscapeOrientation và reconcileWebAppState",
          nativePlayerSwift.includes("enforceLandscapeOrientation()")
          && nativePlayerSwift.includes("func reconcileWebAppState()"));

    // 3. PhimWebView.swift: fullscreen tracking & restore
    check("L", "PhimWebView.swift định nghĩa nativePlayerJS có __bintvRestoreFullscreenIfNeeded",
          webViewSwift.includes("__bintvRestoreFullscreenIfNeeded = function")
          && webViewSwift.includes("__binTVVideoFullscreen"));
    check("L", "webkitendfullscreen không reset fullscreen flag khi document.hidden = true",
          webViewSwift.includes("if (!document.hidden)")
          && webViewSwift.includes("window.__binTVVideoFullscreen = false;"));
    check("L", "PhimWebView.swift có restoreLivePlayerStateIfNeeded",
          webViewSwift.includes("private func restoreLivePlayerStateIfNeeded(probe: String)")
          && webViewSwift.includes("setPlayerLandscape(true)")
          && webViewSwift.includes("__bintvRestoreFullscreenIfNeeded"));
    check("L", "probeLiveWebView gọi restoreLivePlayerStateIfNeeded trên live page",
          webViewSwift.includes("self.restoreLivePlayerStateIfNeeded(probe: result)"));

    // 4. app.js: capture & restore fullscreen state
    check("L", "app.js captureMovieLifecycleState lưu player.fullscreen",
          appJs.includes("fullscreen: !!(window.__binTVVideoFullscreen")
          && appJs.includes("function isMovieHtmlVideoFullscreen()"));
    check("L", "app.js movieLifecycleResumeWebPlayer khôi phục fullscreen",
          appJs.includes("shouldFullscreen && typeof window.__bintvRestoreFullscreenIfNeeded"));

    // 5. DOM simulation: Paused + Fullscreen retain across Home
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
    bootWebApp(win, scriptList(false));
    const video = win.document.getElementById("bintv-movie-html5-player");
    check("L", "HTML5 video tồn tại trong test DOM", !!video);
    let reloadMutations = 0;
    video.load = function () { reloadMutations++; };
    video.play = function () { reloadMutations++; return Promise.resolve(); };
    video.webkitEnterFullscreen = function () {
        this.webkitDisplayingFullscreen = true;
        return true;
    };
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    Object.defineProperty(video, "webkitDisplayingFullscreen", { configurable: true, writable: true, value: true });
    video.currentTime = 345.6;

    win.__binTVVideoFullscreen = true;
    const captured = win.__bintvPhimLifecycle.capture();
    check("L", "State snapshot bắt đúng paused=true và fullscreen=true",
          captured.player.paused === true && captured.player.fullscreen === true && captured.player.positionMs === 345600);

    // Simulate iOS suspending app and closing WebKit fullscreen in background:
    Object.defineProperty(win.document, "hidden", { configurable: true, value: true });
    win.document.dispatchEvent(new win.Event("visibilitychange"));
    // webkitendfullscreen fires in background:
    video.dispatchEvent(new win.Event("webkitendfullscreen"));
    check("L", "Cờ __binTVVideoFullscreen KHÔNG bị xoá khi background",
          win.__binTVVideoFullscreen === true);

    // Foregrounding:
    Object.defineProperty(win.document, "hidden", { configurable: true, value: false });
    win.document.dispatchEvent(new win.Event("visibilitychange"));
    win.dispatchEvent(new win.Event("pageshow"));

    // Call restore helper:
    const fsRestored = win.__bintvRestoreFullscreenIfNeeded({ paused: true });
    check("L", "__bintvRestoreFullscreenIfNeeded trả kết quả phục hồi thành công",
          fsRestored === true);
    check("L", "Không có reload hoặc tự động play đột ngột khi trở lại app",
          reloadMutations === 0);
    win.close();
}

async function main() {
    suiteA();
    suiteB();
    suiteC();
    suiteE();
    suiteF();
    suiteG();
    suiteH();
    suiteI();
    suiteJ();
    suiteK();
    suiteL();
    await suiteD();
    console.log("\n=========================================");
    console.log("PASS: " + pass + "   FAIL: " + fail);
    if (fail) {
        console.log("\nChi tiết lỗi:");
        failures.forEach(function (f) { console.log("  - " + f); });
    }
    console.log("=========================================");
    process.exit(fail ? 1 : 0);
}

main().catch(function (error) {
    console.error(error && error.stack || error);
    process.exit(1);
});
