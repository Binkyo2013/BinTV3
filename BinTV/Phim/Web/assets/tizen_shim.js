/* BinTV Android - Tizen Compatibility Shim */
(function () {
    "use strict";
    function bridge() { return (typeof window.AndroidBridge !== "undefined") ? window.AndroidBridge : null; }
    function hasBridge() { return !!bridge(); }
    function callString(method, fallback) {
        try { var b = bridge(); if (b && typeof b[method] === "function") return b[method](); } catch (e) {}
        return fallback == null ? "" : fallback;
    }
    function makeKeyEvent(type, keyCode, keyName) {
        try {
            var ev = new KeyboardEvent(type, { key: keyName || "", code: keyName || "", bubbles: true, cancelable: true });
            try { Object.defineProperty(ev, "keyCode", { get: function () { return keyCode; } }); } catch (e) {}
            try { Object.defineProperty(ev, "which", { get: function () { return keyCode; } }); } catch (e) {}
            try { Object.defineProperty(ev, "charCode", { get: function () { return keyCode; } }); } catch (e) {}
            return ev;
        } catch (e) { return null; }
    }
    var tizen = {};
    tizen.application = {
        getAppsInfo: function (success, error) {
            var json = "[]";
            if (hasBridge()) { try { json = bridge().getInstalledApps() || "[]"; } catch (e) { json = "[]"; } }
            setTimeout(function () { try { var list = JSON.parse(json); if (success) success(Array.isArray(list) ? list : []); } catch (e) { if (error) error(e); } }, 0);
        },
        launch: function (appId, success, error) {
            var ok = false;
            if (hasBridge()) { try { ok = bridge().launchApp(appId) === "1"; } catch (e) { ok = false; } }
            setTimeout(function () { if (ok) { if (success) success(); } else { if (error) error({ message: "Không thể mở ứng dụng" }); } }, 0);
        },
        getCurrentApplication: function () {
            return {
                appInfo: { id: hasBridge() ? callString("getMyAppId", "com.bintv.launcher") : "com.bintv.launcher" },
                exit: function () { if (hasBridge()) { try { bridge().exitApp(); } catch (e) {} } }
            };
        },
        getAppsContext: function (success, error) { setTimeout(function () { if (success) success([]); }, 0); },
        kill: function (contextId, success, error) { setTimeout(function () { if (success) success(); }, 0); }
    };
    tizen.tvinputdevice = { registerKey: function (name) {}, unregisterKey: function (name) {} };
    tizen.websetting = { removeAllCookies: function (success, error) { if (hasBridge()) { try { bridge().clearCookies(); } catch (e) {} } setTimeout(function () { if (success) success(true); }, 0); } };
    tizen.systeminfo = { getCapability: function (capability) { return false; }, getCapabilities: function () { return {}; }, addPropertyValueChangeListener: function () { return 0; }, removePropertyValueChangeListener: function () {} };
    window.tizen = tizen;
    window.webapis = {};
    window.__binTVHandleBack = function () {
        try { var ev = makeKeyEvent("keydown", 27, "Escape"); if (ev) { window.dispatchEvent(ev); return ev.defaultPrevented === true; } } catch (e) {}
        return false;
    };
    window.__binTVAndroid = true;
})();
