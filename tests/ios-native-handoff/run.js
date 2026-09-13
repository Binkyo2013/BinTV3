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
        win.webkit = {
            messageHandlers: {
                playVideoNative: {
                    postMessage: function (payload) {
                        win.__posted.push(JSON.parse(JSON.stringify(payload)));
                    }
                },
                phimBridge: { postMessage: function () {} },
                phimConsole: { postMessage: function () {} }
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
        { label: "swift:consoleCaptureJS", code: swiftScripts.consoleCaptureJS },
        { label: "swift:nativeHandoffJS", code: swiftScripts.nativeHandoffJS }
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

// ---------------------------------------------------------------------
suiteA();
suiteB();
suiteC();
console.log("\n=========================================");
console.log("PASS: " + pass + "   FAIL: " + fail);
if (fail) {
    console.log("\nChi tiết lỗi:");
    failures.forEach(function (f) { console.log("  - " + f); });
}
console.log("=========================================");
process.exit(fail ? 1 : 0);
