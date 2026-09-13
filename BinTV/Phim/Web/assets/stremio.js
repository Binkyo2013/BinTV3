/*!
 * stremio.js — [BinTV build 229] LỚP CLIENT STREMIO ADDON CHUẨN
 * =====================================================================
 * Mục tiêu: module PHIM đọc ĐÚNG CHUẨN Stremio addon protocol
 * (manifest → catalog → meta → stream) thay vì đoán theo từng nguồn.
 *
 * Nguyên tắc:
 *  - KHÔNG hard-code bất kỳ URL addon nào. Mọi nguồn đến từ cấu hình
 *    (JSONBin) và được tự nhận diện: object/array/string, lồng nhau,
 *    `target_url`, `addons`, `urls`, `sources`, `manifests`, danh sách
 *    kiểu `plugins.json` (community list)...
 *  - Hỗ trợ NHIỀU addon cùng lúc (gộp catalog, gộp stream).
 *  - Phân loại stream theo chuẩn: `url`, `ytId`, `infoHash` (+`sources`,
 *    `fileIdx`), `externalUrl`, `behaviorHints.headers/notWebReady`...
 *  - Không phụ thuộc DOM → test được bằng Node (xem tests/stremio-e2e).
 *
 * Tham khảo: Stremio Addon SDK / protocol (manifest, /catalog/, /meta/,
 * /stream/), hành vi `idPrefixes` và `behaviorHints`.
 * =====================================================================
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) { module.exports = api; }
    else { root.Stremio = api; }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // ------------------------------------------------------------------
    // 1) TIỆN ÍCH
    // ------------------------------------------------------------------
    function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
    function trim(v) { return String(v == null ? "" : v).replace(/^\s+|\s+$/g, ""); }

    var NON_ADDON_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mp4|m3u8|torrent|apk|ipa|zip|json5|txt|md)(?:[?#]|$)/i;

    /// URL có "trông giống" URL addon/manifest không (lọc logo/background...).
    function looksLikeAddonUrl(url) {
        var u = trim(url);
        if (!/^https?:\/\//i.test(u)) return false;
        if (NON_ADDON_EXT.test(u)) {
            // plugins.json / manifest.json vẫn là JSON hợp lệ → giữ lại.
            if (!/\/(manifest|plugins|addons?|catalog|index)\.json(?:[?#]|$)/i.test(u)) return false;
        }
        return true;
    }

    /// Cắt "/manifest.json" để ra base URL (transportUrl của Stremio).
    function baseUrlFromManifestUrl(url) {
        var u = trim(url).replace(/\/+$/, "");
        var idx = u.toLowerCase().lastIndexOf("/manifest.json");
        if (idx > 0) return u.substring(0, idx);
        return u;
    }

    /// Chuẩn hoá về URL manifest: thiếu "/manifest.json" thì thêm vào.
    function normalizeManifestUrl(url) {
        var u = trim(url).replace(/\/+$/, "");
        if (!u) return "";
        if (/\/manifest\.json(?:[?#]|$)/i.test(u)) return u;
        // Đã có đuôi file khác (vd plugins.json) → giữ nguyên (danh sách).
        if (/\/[a-z0-9_\-]+\.json(?:[?#]|$)/i.test(u)) return u;
        return u + "/manifest.json";
    }

    // ------------------------------------------------------------------
    // 2) TRÍCH XUẤT DANH SÁCH URL TỪ MỌI DẠNG CẤU HÌNH (JSONBin...)
    //    Quét ĐỆ QUY: object/array/string/newline-separated text.
    // ------------------------------------------------------------------
    function collectStrings(value, out, depth) {
        if (depth > 8 || !out) return out;
        if (typeof value === "string") {
            var parts = value.split(/[\r\n,]+/);
            for (var i = 0; i < parts.length; i++) {
                var t = trim(parts[i]);
                if (t && looksLikeAddonUrl(t)) out.push(t);
            }
            return out;
        }
        if (Array.isArray(value)) {
            for (var j = 0; j < value.length; j++) collectStrings(value[j], out, depth + 1);
            return out;
        }
        if (isObject(value)) {
            var keys = Object.keys(value);
            for (var k = 0; k < keys.length; k++) collectStrings(value[keys[k]], out, depth + 1);
        }
        return out;
    }

    /// Trả về mảng URL (đã chuẩn hoá, khử trùng lặp).
    /// Ưu tiên `target_urls` (mảng) nếu có, rồi mới đến quét đệ quy toàn bộ
    /// cấu hình (gồm `target_url`, `addons`, `urls`, `sources`, chuỗi, …).
    function extractManifestUrls(config) {
        var found = [];
        if (isObject(config)) {
            var record = isObject(config.record) ? config.record : config;
            var preferred = record.target_urls || record.targetUrls ||
                            record.target_url || record.targetUrl;
            if (Array.isArray(preferred)) {
                for (var p = 0; p < preferred.length; p++) {
                    if (typeof preferred[p] === "string") found.push(preferred[p]);
                    else collectStrings(preferred[p], found, 1);
                }
            } else if (typeof preferred === "string") {
                found.push(preferred);
            }
        }
        collectStrings(config, found, 0);
        var seen = {};
        var out = [];
        for (var i = 0; i < found.length; i++) {
            var url = normalizeManifestUrl(found[i]);
            if (!url || seen[url]) continue;
            seen[url] = true;
            out.push(url);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // 3) MANIFEST HỢP LỆ THEO CHUẨN STREMIO?
    //    Tối thiểu phải có `catalogs` hoặc `resources` (mảng).
    // ------------------------------------------------------------------
    function isManifest(obj) {
        if (!isObject(obj)) return false;
        var hasCatalogs = Array.isArray(obj.catalogs);
        var hasResources = Array.isArray(obj.resources);
        return hasCatalogs || hasResources;
    }

    function resourceSupports(addonManifest, resource, type) {
        var resources = addonManifest && addonManifest.resources;
        if (!Array.isArray(resources) || resources.length === 0) {
            // Addon không khai báo resources → coi như hỗ trợ mặc định.
            return true;
        }
        for (var i = 0; i < resources.length; i++) {
            var r = resources[i];
            var name = typeof r === "string" ? r : (r && r.name);
            if (name !== resource) continue;
            if (!type) return true;
            var types = (typeof r === "object" && Array.isArray(r.types)) ? r.types : null;
            if (!types || types.length === 0) return true;
            return types.indexOf(type) !== -1;
        }
        return false;
    }

    /// idPrefixes: addon chỉ phục vụ các id bắt đầu bằng một trong các prefix.
    function matchesIdPrefixes(addonManifest, id) {
        var prefixes = addonManifest && addonManifest.idPrefixes;
        if (!Array.isArray(prefixes) || prefixes.length === 0) return true; // không khai báo = nhận tất cả
        var key = trim(id);
        if (!key) return true;
        for (var i = 0; i < prefixes.length; i++) {
            var p = trim(prefixes[i]);
            if (p && key.indexOf(p) === 0) return true;
        }
        return false;
    }

    function createAddon(baseUrl, manifest) {
        return {
            baseUrl: baseUrlUrl(baseUrl),
            manifest: manifest,
            name: (manifest && manifest.name) || baseUrl,
            id: (manifest && manifest.id) || ""
        };
    }
    function baseUrlUrl(u) { return trim(u).replace(/\/+$/, ""); }

    // ------------------------------------------------------------------
    // 4) URL TÀI NGUYÊN THEO CHUẨN: /<resource>/<type>/<id>.json
    //    (extra: {search: "...", skip: 20, genre: "..."} → query string)
    // ------------------------------------------------------------------
    function resourceUrl(baseUrl, resource, type, id, extra) {
        var url = baseUrlUrl(baseUrl) + "/" + resource + "/" +
            encodeURIComponent(type) + "/" + encodeURIComponent(id) + ".json";
        if (extra && typeof extra === "object") {
            var parts = [];
            var keys = Object.keys(extra);
            for (var i = 0; i < keys.length; i++) {
                var v = extra[keys[i]];
                if (v === null || v === undefined || v === "") continue;
                parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
            }
            if (parts.length) url += "?" + parts.join("&");
        }
        return url;
    }

    // ------------------------------------------------------------------
    // 5) PHÂN LOẠI STREAM THEO CHUẨN STREMIO
    //    Trả về: kind / playable / url / headers / magnet / youtubeId ...
    // ------------------------------------------------------------------
    var KIND = {
        HLS: "hls",               // .m3u8 → AVPlayer/HTMLVideo native
        DIRECT: "direct",         // mp4/mkv/webm/... phát trực tiếp
        YOUTUBE: "youtube",       // ytId
        TORRENT: "torrent",       // infoHash (+sources) → cần debrid/torrent engine
        EXTERNAL: "external",     // externalUrl → mở ngoài
        UNKNOWN: "unknown"
    };

    var DIRECT_EXT = /\.(mp4|m4v|mov|m3u8|webm|mkv|avi|ts|flv|mpg|mpeg|ogv)(?:[?#]|$)/i;
    var HLS_EXT = /\.m3u8(?:[?#]|$)/i;

    /// Chuyển các dạng "sources" (dht:/tracker:) hoặc infoHash thành magnet.
    function magnetFromStream(stream) {
        var hash = trim(stream && stream.infoHash);
        if (!hash) return "";
        var trackers = [];
        var sources = stream && stream.sources;
        if (Array.isArray(sources)) {
            for (var i = 0; i < sources.length; i++) {
                var s = trim(sources[i]);
                var t = s.replace(/^tracker:/i, "");
                if (t && /^(udp|http|https|ws|wss):\/\//i.test(t)) trackers.push(t);
            }
        }
        var magnet = "magnet:?xt=urn:btih:" + hash;
        if (stream && stream.fileIdx !== undefined && stream.fileIdx !== null) {
            // Stremio: `fileIdx` (stream) / `videos[].id` chọn file trong torrent.
            magnet += "&so=" + encodeURIComponent(String(stream.fileIdx));
        }
        for (var j = 0; j < trackers.length; j++) magnet += "&tr=" + encodeURIComponent(trackers[j]);
        return magnet;
    }

    /// Lấy headers từ behaviorHints.headers (chuẩn Stremio).
    function headersFromStream(stream) {
        var out = {};
        try {
            var bh = stream && stream.behaviorHints;
            var h = bh && bh.headers;
            if (isObject(h)) {
                var keys = Object.keys(h);
                for (var i = 0; i < keys.length; i++) {
                    var v = h[keys[i]];
                    if (typeof v === "string" && v) out[keys[i]] = v;
                }
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    function classifyStream(stream) {
        var result = {
            raw: stream || null,
            kind: KIND.UNKNOWN,
            playable: false,
            url: "",
            headers: {},
            magnet: "",
            youtubeId: "",
            externalUrl: "",
            title: "",
            name: "",
            filename: "",
            sizeBytes: 0,
            subtitles: [],
            reason: "",
            addonBase: ""
        };
        if (!stream || typeof stream !== "object") {
            result.reason = "stream không hợp lệ";
            return result;
        }
        result.name = trim(stream.name);
        result.title = trim(stream.title);
        result.headers = headersFromStream(stream);
        var bh = stream.behaviorHints || {};
        result.filename = trim(bh.filename);
        if (bh.videoSize) {
            var size = Number(bh.videoSize);
            if (isFinite(size) && size > 0) result.sizeBytes = size;
        }
        if (Array.isArray(stream.subtitles)) result.subtitles = stream.subtitles;

        // --- (a) URL trực tiếp (HLS/MP4/...) — ưu tiên cao nhất -----------
        var url = trim(stream.url);
        if (url && /^https?:\/\//i.test(url)) {
            result.url = url;
            if (HLS_EXT.test(url)) { result.kind = KIND.HLS; result.playable = true; }
            else if (DIRECT_EXT.test(url)) { result.kind = KIND.DIRECT; result.playable = true; }
            else {
                // Không rõ đuôi (vd: /stream/abc, CDN trả video/mp4) → vẫn thử
                // phát trực tiếp; AVPlayer tự nhận diện container.
                result.kind = KIND.DIRECT;
                result.playable = true;
            }
            return result;
        }

        // --- (b) YouTube (ytId) ------------------------------------------
        if (trim(stream.ytId)) {
            result.kind = KIND.YOUTUBE;
            result.youtubeId = trim(stream.ytId);
            // Phát được qua trình YouTube (TUBE) hoặc web player; không phải
            // URL phát trực tiếp cho AVPlayer.
            result.playable = true;
            result.reason = "YouTube";
            return result;
        }

        // --- (c) Torrent / P2P (infoHash + sources) -----------------------
        if (trim(stream.infoHash)) {
            result.kind = KIND.TORRENT;
            result.magnet = magnetFromStream(stream);
            result.playable = false;
            result.reason = "Nguồn torrent (P2P) — iOS không có sẵn engine BitTorrent; " +
                            "cần cấu hình debrid (vd. TorBox) trong addon để nhận link phát trực tiếp.";
            return result;
        }

        // --- (d) externalUrl ---------------------------------------------
        if (trim(stream.externalUrl)) {
            result.kind = KIND.EXTERNAL;
            result.externalUrl = trim(stream.externalUrl);
            result.playable = false;
            result.reason = "Nguồn mở bằng ứng dụng/trình duyệt ngoài";
            return result;
        }

        result.reason = "Không xác định được loại stream (thiếu url/ytId/infoHash/externalUrl)";
        return result;
    }

    /// Sắp xếp: phát được trước (HLS > direct > youtube), rồi theo dung lượng.
    function rankStreams(classified) {
        var weight = {};
        weight[KIND.HLS] = 0;
        weight[KIND.DIRECT] = 1;
        weight[KIND.YOUTUBE] = 2;
        weight[KIND.EXTERNAL] = 3;
        weight[KIND.TORRENT] = 4;
        weight[KIND.UNKNOWN] = 5;
        return classified.slice().sort(function (a, b) {
            var pa = a.playable ? 0 : 1;
            var pb = b.playable ? 0 : 1;
            if (pa !== pb) return pa - pb;
            var wa = weight[a.kind] === undefined ? 9 : weight[a.kind];
            var wb = weight[b.kind] === undefined ? 9 : weight[b.kind];
            if (wa !== wb) return wa - wb;
            return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        });
    }

    /// Stream đầu tiên có thể phát.
    function pickPlayable(classified) {
        for (var i = 0; i < classified.length; i++) if (classified[i].playable) return classified[i];
        return null;
    }

    // ------------------------------------------------------------------
    // 6) NẠP NHIỀU ADDON + GIẢI QUYẾT STREAM QUA TẤT CẢ ADDON
    // ------------------------------------------------------------------
    /**
     * Nạp danh sách addon.
     * @param {string[]} urls  URL manifest (hoặc URL danh sách kiểu plugins.json)
     * @param {function} fetchJson(url, ok, fail)
     * @param {function} done(addons[])
     * @param {object=} opts  { maxDepth, timeoutPerAddon }
     */
    function loadAddons(urls, fetchJson, done, opts) {
        opts = opts || {};
        var list = (Array.isArray(urls) ? urls : []).slice();
        var addons = [];
        var seenBase = {};
        var pending = 0;
        var finished = false;
        var started = false;   // tránh finish() sớm khi callback trả đồng bộ

        function finish() {
            if (finished || !started) return;
            finished = true;
            done(addons);
        }

        function acceptManifest(manifestUrl, manifest) {
            var base = baseUrlFromManifestUrl(manifestUrl);
            if (seenBase[base]) return;
            seenBase[base] = true;
            addons.push(createAddon(base, manifest));
        }

        function handle(url, depth) {
            if (!url) return;
            pending++;
            fetchJson(url, function (data) {
                pending--;
                if (isManifest(data)) { acceptManifest(url, data); }
                else if (depth > 0) {
                    // Có thể là DANH SÁCH addon (plugins.json / community list)
                    var nested = extractManifestUrls(data);
                    for (var i = 0; i < nested.length; i++) handle(nested[i], depth - 1);
                }
                if (pending === 0) finish();
            }, function () {
                pending--;
                if (pending === 0) finish();
            });
        }

        if (!list.length) { started = true; finish(); return; }
        for (var i = 0; i < list.length; i++) handle(list[i], opts.maxDepth === undefined ? 1 : opts.maxDepth);
        started = true;
        if (pending === 0) finish();
    }

    /**
     * Hỏi stream từ TẤT CẢ addon phù hợp (idPrefixes + resources) rồi gộp,
     * phân loại và sắp xếp.
     * @param {object[]} addons
     * @param {object}   query { type, id, extra? , types?: ['tv','movie'] }
     * @param {function} fetchJson
     * @param {function} done(classified[])
     */
    function resolveStreams(addons, query, fetchJson, done) {
        var list = Array.isArray(addons) ? addons : [];
        var id = trim(query && query.id);
        var types = (query && Array.isArray(query.types) && query.types.length)
            ? query.types.slice()
            : [trim((query && query.type) || "movie")];

        var targets = [];   // {addon, type}
        for (var a = 0; a < list.length; a++) {
            var addon = list[a];
            if (!resourceSupports(addon.manifest, "stream", null)) continue;
            if (!matchesIdPrefixes(addon.manifest, id)) continue;
            for (var t = 0; t < types.length; t++) {
                if (!resourceSupports(addon.manifest, "stream", types[t])) continue;
                targets.push({ addon: addon, type: types[t] });
            }
        }
        if (!targets.length) { done([]); return; }

        var results = [];
        var pending = targets.length;
        function settle() {
            pending--;
            if (pending <= 0) done(rankStreams(results));
        }
        for (var i = 0; i < targets.length; i++) {
            (function (target) {
                var url = resourceUrl(target.addon.baseUrl, "stream", target.type, id, query && query.extra);
                fetchJson(url, function (data) {
                    var streams = data && Array.isArray(data.streams) ? data.streams : [];
                    for (var s = 0; s < streams.length; s++) {
                        var c = classifyStream(streams[s]);
                        c.addonBase = target.addon.baseUrl;
                        c.requestType = target.type;
                        results.push(c);
                    }
                    settle();
                }, settle);
            })(targets[i]);
        }
    }

    // ------------------------------------------------------------------
    // 7) CẤU HÌNH ADDON (chuẩn Stremio: config nằm TRONG transport URL)
    //    Dạng tổng quát: <host>/<mã-hoá-JSON-của-config>/manifest.json
    //    với manifest.config = [{key:<tên khoá>, type:"password", ...}].
    //    → thêm/bớt khoá là app tự dựng lại URL, KHÔNG hard-code tên khoá nào.
    // ------------------------------------------------------------------

    /// Đọc object config đã nằm sẵn trong URL (nếu có).
    function parseTransportConfig(baseUrl) {
        try {
            var parts = trim(baseUrl).split("/");
            for (var i = parts.length - 1; i >= 0; i--) {
                var seg = parts[i];
                if (!seg) continue;
                var decoded = decodeURIComponent(seg);
                if (!decoded || decoded.charAt(0) !== "{") continue;
                var obj = JSON.parse(decoded);
                if (isObject(obj)) return { segment: seg, values: obj };
            }
        } catch (e) { /* không có config trong URL */ }
        return { segment: "", values: {} };
    }

    /// Gộp `config` vào transport URL → trả về URL manifest đã cấu hình.
    function buildConfiguredUrl(baseUrl, config) {
        var base = baseUrlUrl(baseUrl);
        var parsed = parseTransportConfig(base);
        var merged = {};
        var key;
        for (key in parsed.values) if (Object.prototype.hasOwnProperty.call(parsed.values, key)) merged[key] = parsed.values[key];
        for (key in config) {
            if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
            var value = config[key];
            if (value === null || value === undefined || trim(value) === "") delete merged[key];
            else merged[key] = value;
        }
        var encoded = encodeURIComponent(JSON.stringify(merged));
        if (parsed.segment) {
            var idx = base.lastIndexOf(parsed.segment);
            if (idx >= 0) base = base.substring(0, idx) + encoded + base.substring(idx + parsed.segment.length);
        } else {
            base = base + "/" + encoded;
        }
        return base + "/manifest.json";
    }

    /// Các trường cấu hình addon KHAI BÁO (manifest.config — chuẩn Stremio).
    function getConfigFields(manifest) {
        var cfg = manifest && manifest.config;
        if (!Array.isArray(cfg)) return [];
        var out = [];
        for (var i = 0; i < cfg.length; i++) {
            var f = cfg[i];
            if (f && f.key) out.push(f);
        }
        return out;
    }

    return {
        KIND: KIND,
        extractManifestUrls: extractManifestUrls,
        collectStrings: collectStrings,
        isManifest: isManifest,
        looksLikeAddonUrl: looksLikeAddonUrl,
        normalizeManifestUrl: normalizeManifestUrl,
        baseUrlFromManifestUrl: baseUrlFromManifestUrl,
        createAddon: createAddon,
        resourceSupports: resourceSupports,
        matchesIdPrefixes: matchesIdPrefixes,
        resourceUrl: resourceUrl,
        classifyStream: classifyStream,
        rankStreams: rankStreams,
        pickPlayable: pickPlayable,
        magnetFromStream: magnetFromStream,
        headersFromStream: headersFromStream,
        parseTransportConfig: parseTransportConfig,
        buildConfiguredUrl: buildConfiguredUrl,
        getConfigFields: getConfigFields,
        loadAddons: loadAddons,
        resolveStreams: resolveStreams
    };
});
