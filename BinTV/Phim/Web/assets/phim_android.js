/* [Phim ANDROID 2026-09] phim_android.js - thay the preload.js cua Electron.
 *
 * Tren Windows, preload.js dung contextBridge de expose window.__phimDebug:
 *   - log/warn/error -> gui console sang main process (IPC phim-debug-log)
 *   - exit()          -> IPC phim-app-exit -> app.quit() -> before-quit kill server
 *
 * Tren Android, app.js van goi dung cac doan do (closeBinTVApplication goi
 * window.__phimDebug.exit()), nen file nay expose __phimDebug voi cung interface:
 *   - log/warn/error -> console (WebChromeClient logcat cua app)
 *   - exit()         -> AndroidBridge.exitApp() -> MainActivity dong ung dong
 *                       (dong WebView + dung MediaProxyServer)
 *
 * File nay phai chay TRUOC app.js (da dat trong index.html ngay sau tizen_shim.js).
 * Neu khong co AndroidBridge (vd mo bang trinh duyet thuong), exit() fallback
 * window.close() va app.js tu tao fallback console-only nhu cu.
 */
(function () {
    "use strict";
    var bridge = null;
    try { bridge = window.AndroidBridge || null; } catch (bridgeError) { bridge = null; }

    function formatArg(value) {
        if (typeof value === "string") return value;
        try { return JSON.stringify(value); } catch (e) { return String(value); }
    }

    function makeLogger(level) {
        return function () {
            try {
                var message = "[Phim][" + level + "] " + Array.prototype.slice.call(arguments).map(formatArg).join(" ");
                // Console cua WebView duoc forward sang Logcat boi WebChromeClient
                if (level === "ERROR") console.error(message);
                else if (level === "WARN") console.warn(message);
                else console.log(message);
            } catch (e) {}
        };
    }

    window.__phimDebug = {
        log: makeLogger("LOG"),
        warn: makeLogger("WARN"),
        error: makeLogger("ERROR"),
        exit: function () {
            try {
                if (bridge && typeof bridge.exitApp === "function") {
                    bridge.exitApp();
                    return;
                }
            } catch (bridgeExitError) {}
            try { window.close(); } catch (closeError) {}
        }
    };

    // [Phim ANDROID 2026-09] Expose bo tro cho MainActivity: kiem tra trang thai
    // co the hien tai (dung cho phan co Play/Pause tren remote TV box).
    try {
        window.__phimAndroidBridgeAvailable = !!bridge;
    } catch (e) {}
})();
