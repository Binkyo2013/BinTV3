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
 *   SUITE F (build 234) — ƯU TIÊN TRÌNH PHÁT + GESTURE ĐIỀU HƯỚNG:
 *     Ưu tiên 1 = trình phát TÍCH HỢP của app (thẻ <video>): nguồn MKV/AC3
 *     cũng KHÔNG được handoff sớm sang trình phát iOS; chỉ khi trình phát
 *     tích hợp THẤT BẠI mới fallback (reason "web-streams-exhausted").
 *     Kèm cầu nối gesture: __bintvPhimReturn (Return trong web app) + tua
 *     __bintvPlayerBeginSeek/SeekTo/EndSeek + mirror uiState về Swift.
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

function makeWindow(url, withBridge) {
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
    return { ok: ok, bad: bad };
}

function scriptList(withHls) {
    // ĐÚNG thứ tự WKWebView thật: user script document-start (Swift tiêm)
    // → assets trong index.html → user script document-end.
    const list = [
        { label: "swift:viewportFixJS", code: swiftScripts.viewportFixJS },
        { label: "swift:bridgeShimJS", code: swiftScripts.bridgeShimJS },
        { label: "swift:nativeHandoffJS", code: swiftScripts.nativeHandoffJS },
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
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
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
    const win = makeWindow("http://127.0.0.1:3000/?android=phone&ios=landscape", true);
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

    // --- F2: trình phát tích hợp THẤT BẠI → lúc này mới fallback sang iOS -
    hooks.playbackError();
    const handoff = win.__posted.filter(function (m) {
        return m.action !== "stop" && m.action !== "episodes" && m.action !== "hideEpisodes";
    });
    check("F", "tích hợp lỗi (hết nguồn web) → handoff sang trình phát iOS",
          handoff.length === 1, JSON.stringify(win.__posted));
    check("F", "→ reason = web-streams-exhausted",
          handoff.length === 1 && handoff[0].reason === "web-streams-exhausted",
          handoff.length ? JSON.stringify(handoff[0]) : "không gửi gì");

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

async function main() {
    suiteA();
    suiteB();
    suiteC();
    suiteE();
    suiteF();
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
