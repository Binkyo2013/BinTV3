import Foundation
import Network

// =====================================================================
// PhimDebugLog — ghi log runtime ra Documents/phim_debug.log.
// Xem bằng: app Files (iPhone) > "On My iPhone" > BinTV > phim_debug.log
// (bật qua UIFileSharingEnabled trong Info.plist). Dùng chẩn đoán
// sự cố trên máy thật — nếu app crash, log giữ nguyên các bước
// đã hoàn thành trước khi crash.
// =====================================================================
enum PhimDebugLog {
    private static let fileURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return dir.appendingPathComponent("phim_debug.log")
    }()
    private static let lock = NSLock()

    static func log(_ message: String) {
        let line = "[\(Date())] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        if let handle = try? FileHandle(forWritingTo: fileURL) {
            _ = try? handle.seekToEnd()
            handle.write(data)
            _ = try? handle.close()
        } else {
            try? data.write(to: fileURL)
        }
    }

    // =================================================================
    // [PHIM_DEBUG 2026-09-12] Log CÓ CẤU TRÚC theo format bắt buộc:
    //   [PHIM_DEBUG] Step -> Action -> Status -> Payload/URL
    // Dùng cho toàn bộ luồng: SERVER (bind/accept) → STATIC → PROXY
    // (request/response/redirect/m3u8-rewrite/DoH/RawHttp) → WEBVIEW →
    // PLAYER (JS observer) → BRIDGE → ORIENTATION.
    // `payload` đi qua sanitizeURL khi là URL — token nhạy cảm bị che.
    // =================================================================
    static func step(_ step: String, _ action: String, _ status: String, _ payload: String = "") {
        let tail = payload.isEmpty ? "" : " -> \(payload)"
        log("[PHIM_DEBUG] \(step) -> \(action) -> \(status)\(tail)")
    }

    /// Tên query parameter nhạy cảm (khớp không phân biệt hoa thường) —
    /// giá trị bị thay bằng `***` khi log. Danh sách bám theo các tham số
    /// thật của nguồn phim/live: pkey (stripchat/doppiocdn), token, sig,
    /// hash, session... KHÔNG che toàn bộ query (giữ lại cấu trúc URL để
    /// debug) — chỉ che GIÁ TRỊ của khóa nhạy cảm.
    private static let sensitiveQueryKeys: Set<String> = [
        "pkey", "token", "tk", "sig", "signature", "auth", "authorization",
        "session", "sessionid", "sid", "hash", "h", "key", "apikey",
        "api_key", "secret", "pass", "password", "cred", "md5", "secure", "st"
    ]

    /// Che giá trị khóa nhạy cảm trong query string + giới hạn 300 ký tự.
    /// KHÔNG dùng URLComponents (nó decode/re-encode làm sai lệch URL gốc
    /// cần xem trong log) — xử lý chuỗi thuần như JS observer.
    static func sanitizeURL(_ value: String) -> String {
        guard !value.isEmpty else { return "" }
        var text = value
        if let queryStart = text.firstIndex(of: "?") {
            let base = String(text[..<queryStart])
            let query = String(text[text.index(after: queryStart)...])
            let pairs = query.split(separator: "&", omittingEmptySubsequences: false).map { pair -> String in
                let pairText = String(pair)
                guard let eq = pairText.firstIndex(of: "=") else { return pairText }
                let name = String(pairText[..<eq])
                if sensitiveQueryKeys.contains(name.lowercased()) {
                    return "\(name)=***"
                }
                return pairText
            }
            text = base + "?" + pairs.joined(separator: "&")
        }
        if text.count > 300 {
            text = String(text.prefix(300)) + "…"
        }
        return text
    }
}

// =====================================================================
// [BinTV PHIM 2026-09] PhimLocalServer — port NGUYÊN BẢN từ
// MediaProxyServer.java + DohResolver.java của project Phim Android
// (com.bin.phim). Chạy NGẦM trong app iOS trên 127.0.0.1, port 3000-3100
// (tự tìm port trống — giống findFreePort của server.js/MainActivity).
//
// Nhiệm vụ (giữ nguyên server.js/Android):
//  1. Serve file tĩnh web app từ bundle (BinTV/Phim/Web) — index.html,
//     assets/app.js, hls.min.js, css, ảnh (giống express.static).
//     Cache: no-cache cho .html/.js, max-age 1h cho ảnh.
//  2. /health — health check.
//  3. /proxy?url=<encoded>&__ref=<encoded-referer> — proxy HTTP/HTTPS:
//     - DoH resolve hostname (cloudflare/google/quad9, cache 5 phút) để
//       bypass DNS nhà mạng; kết nối qua IP DoH + header Host đúng.
//       (Khác biệt platform đã ghi trong báo cáo: URLSession iOS không
//       tách được DNS/SNI, nên HTTPS qua IP DoH chấp nhận server trust
//       cho đúng task proxy đó.)
//     - Headers: Chrome UA 126, Accept, Accept-Language, Accept-Encoding:
//       identity, Referer/Origin từ __ref, forward Range/If-Range.
//     - KHÔNG tự follow redirect (trả 3xx nguyên về cho web app tự xử lý).
//     - Nếu response là m3u8: rewrite MỌI URL (kể cả URI="..." trong
//       #EXT-X-KEY/#EXT-X-MAP) thành /proxy?url=... (chống proxy 2 tầng).
//     - Copy headers upstream (trừ ACAO/ACAC/transfer-encoding/
//       content-length) + thêm Access-Control-Allow-Origin: *.
//     - Timeout 20s → 504; lỗi kết nối → 500 JSON.
//
// Web app (app.js) tự wrap stream URL cross-origin thành
// window.location.origin + "/proxy?url=..." nên hls.js chỉ fetch same-origin
// 127.0.0.1 → không có vấn đề CORS từ phía WebView.
// =====================================================================

// =====================================================================
// PhimDohResolver — port DohResolver.java
// =====================================================================

/// Resolve hostname → IPv4 qua DNS-over-HTTPS (bypass DNS nhà mạng VN).
/// Cache 5 phút, timeout 4s/endpoint, chỉ record type=A (giống server.js).
/// Blocking call — chỉ gọi từ background queue (serverQueue của server).
final class PhimDohResolver {

    private struct CacheEntry {
        let ip: String
        let at: TimeInterval
    }

    private static let endpoints: [(prefix: String, accept: String)] = [
        ("https://cloudflare-dns.com/dns-query?name=", "application/dns-json"),
        ("https://dns.google/resolve?name=", "application/dns-json"),
        ("https://dns.quad9.net/dns-query?name=", "application/dns-json"),
    ]
    private static let userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    private static let cacheTTL: TimeInterval = 5 * 60
    private static let timeout: TimeInterval = 4

    private let lock = NSLock()
    private var cache: [String: CacheEntry] = [:]
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.timeout
        configuration.timeoutIntervalForResource = Self.timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    static func isIpLiteral(_ host: String?) -> Bool {
        guard let host = host, !host.isEmpty else { return false }
        let parts = host.components(separatedBy: ".")
        guard parts.count == 4 else { return false }
        for part in parts {
            guard let value = Int(part), value >= 0, value <= 255 else { return false }
            if part.count > 1 && part.hasPrefix("0") { return false }
        }
        return true
    }

    /// Trả về nil nếu: hostname là IP literal, hoặc mọi endpoint đều fail.
    /// Người gọi fallback về DNS hệ thống (kết nối bằng hostname thường).
    func resolve(_ hostname: String) -> String? {
        var host = hostname.trimmingCharacters(in: .whitespacesAndNewlines)
        if host.isEmpty { return nil }
        if Self.isIpLiteral(host) { return nil }
        host = host.lowercased()

        lock.lock()
        if let entry = cache[host], (Date().timeIntervalSince1970 - entry.at) < Self.cacheTTL {
            lock.unlock()
            return entry.ip
        }
        lock.unlock()

        for endpoint in Self.endpoints {
            if let ip = tryEndpoint(endpoint, host: host) {
                lock.lock()
                cache[host] = CacheEntry(ip: ip, at: Date().timeIntervalSince1970)
                lock.unlock()
                PhimDebugLog.step("DOH", "resolve", "ok", "host=\(host) ip=\(ip)")
                return ip
            }
        }
        PhimDebugLog.step("DOH", "resolve", "FAIL", "host=\(host) (mọi endpoint fail — fallback DNS hệ thống)")
        return nil
    }

    private func tryEndpoint(_ endpoint: (prefix: String, accept: String), host: String) -> String? {
        guard let encoded = host.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: endpoint.prefix + encoded + "&type=A") else { return nil }
        var request = URLRequest(url: url, timeoutInterval: Self.timeout)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(endpoint.accept, forHTTPHeaderField: "Accept")
        request.setValue("close", forHTTPHeaderField: "Connection")

        let semaphore = DispatchSemaphore(value: 0)
        var result: String?
        let task = session.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let data = data, data.count <= 64 * 1024,
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let json = object as? [String: Any],
                  let answers = json["Answer"] as? [[String: Any]] else { return }
            for answer in answers {
                if (answer["type"] as? Int) == 1,
                   let dataValue = answer["data"] as? String,
                   Self.isIpLiteral(dataValue) {
                    result = dataValue
                    break
                }
            }
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + Self.timeout + 1)
        return result
    }
}

// =====================================================================
// FdConnection — TCP socket (BSD) bọc bằng interface quen thuộc
// (send + onChunk/onClosed). THAY THẾ NWConnection/NWListener:
//  - Socket BSD bind GIỐNG Hệt findFreePort (đã verify hoạt động trên
//    máy thật) — không còn hiện tượng NWListener báo EADDRINUSE dù
//    port trống / không bao giờ đạt .ready trên iOS.
//  - 1 thread receive mỗi connection (đúng thiết kế MediaProxyServer.java
//    của Android) — request này chậm (vd DoH) không nghẽn request khác.
//  - MSG_NOSIGNAL + SO_NOSIGPIPE: client đóng sớm không SIGPIPE crash.
// =====================================================================
final class FdConnection: CustomStringConvertible {

    let fd: Int32
    var onChunk: ((Data) -> Void)?
    var onClosed: (() -> Void)?

    var description: String { "FdConnection(fd: \(fd))" }

    private var closed = false
    private let stateLock = NSLock()

    init(fd: Int32) {
        self.fd = fd
        // Phòng thủ kép chống SIGPIPE (SIGPIPE kill cả process nếu client
        // đóng connection giữa chừng).
        var noSigpipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigpipe, socklen_t(MemoryLayout<Int32>.size))
    }

    /// Loop receive blocking trên dedicated queue (chạy nền).
    func startReceiving() {
        let queue = DispatchQueue(label: "com.bintv.phim.conn.\(fd)")
        queue.async { [weak self] in
            self?.receiveLoop()
        }
    }

    private func receiveLoop() {
        var buffer = [UInt8](repeating: 0, count: 65536)
        while true {
            if isClosed { break }
            let n = recv(fd, &buffer, buffer.count, 0)
            if n > 0 {
                let data = Data(bytes: buffer, count: n)
                onChunk?(data)
            } else if n == 0 {
                break // WebView đã đóng connection (bình thường).
            } else {
                if errno == EINTR { continue }
                break // lỗi socket.
            }
        }
        markClosed()
    }

    /// Gửi HẾT data (loop viết phần) — loopback nên thường 1 lần là xong.
    func send(content: Data, completion: ((Error?) -> Void)? = nil) {
        guard !content.isEmpty else {
            completion?(nil)
            return
        }
        var offset = 0
        var failure: Error?
        content.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            while offset < content.count {
                let n = Darwin.send(fd, base + offset, content.count - offset, Int32(MSG_NOSIGNAL))
                if n > 0 {
                    offset += n
                } else if n < 0 && errno == EINTR {
                    continue
                } else {
                    failure = NSError(domain: NSPOSIXErrorDomain, code: Int(errno),
                                      userInfo: [NSLocalizedDescriptionKey: String(cString: strerror(errno))])
                    break
                }
            }
        }
        if let failure = failure {
            markClosed()
            completion?(failure)
        } else {
            completion?(nil)
        }
    }

    func close() {
        markClosed()
    }

    private var isClosed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return closed
    }

    /// Idempotent — đóng fd + gọi onClosed đúng 1 lần.
    private func markClosed() {
        stateLock.lock()
        let wasClosed = closed
        closed = true
        stateLock.unlock()
        guard !wasClosed else { return }
        if fd >= 0 {
            Darwin.close(fd)
        }
        onClosed?()
    }
}

// =====================================================================
// PhimLocalServer — port MediaProxyServer.java
// (transport: BSD socket — thay NWListener/NWConnection, xem FdConnection)
// =====================================================================

final class PhimLocalServer: NSObject, URLSessionTaskDelegate {

    // SINGLETON — server sống trọn đời app (giống MediaProxyServer.java của
    // Android: khởi động 1 lần duy nhất). Tạo/hủy server lặp lại chính là
    // nguồn gây EADDRINUSE và crash khi bấm Reload nhiều lần.
    static let shared = PhimLocalServer()

    private override init() {
        super.init()
    }

    private static let userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    private static let headerAccept =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    private static let headerAcceptLanguage = "vi,en-US;q=0.8,en;q=0.6"
    private static let readTimeout: TimeInterval = 20

    private static let m3u8ContentTypePattern = "mpegurl|x-mpegurl|application/vnd\\.apple\\.mpegurl"
    private static let uriAttrPattern = "URI=\"([^\"]+)\""

    private(set) var port: Int = 0
    private var listenFd: Int32 = -1
    private var listenActive = false
    private var acceptThread: Thread?
    private let doh = PhimDohResolver()
    private let serverQueue = DispatchQueue(label: "com.bintv.phim.localserver")
    private let proxyQueue = DispatchQueue(label: "com.bintv.phim.proxy")
    // RawHttp (http cleartext): CONCURRENT queue — hls.js tải song song
    // nhiều segment (2-4 lần lượt); nếu chạy trên proxyQueue (SERIAL) thì
    // các fetch bị serialize → thiếu buffer → video giật. Độ song song
    // thực tế bị giới hạn bởi chính browser (WebKit ~6 connections/host).
    private let rawHttpQueue = DispatchQueue(label: "com.bintv.phim.rawhttp", attributes: .concurrent)

    private var activeConnections: [FdConnection] = []
    private let connectionsLock = NSLock()

    private struct ProxyPending {
        let connection: FdConnection
        let isHead: Bool
        let originalTarget: URL
        let extraReferer: String?
    }
    private var proxyPending: [Int: ProxyPending] = [:]
    private var proxyFiles: [Int: URL] = [:]
    private let proxyLock = NSLock()

    private var dohRoutedTaskIds = Set<Int>()
    private let dohLock = NSLock()

    private lazy var proxySession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        // ATS: giữ CHẶT (không có API opt-out theo-session trên iOS).
        // Nguồn stream https hoạt động bình thường; nguồn chỉ có http (nếu có)
        // sẽ bị ATS chặn — web app có fallback nguồn nên tự chuyển nguồn khác.
        // (Bản Android dùng usesCleartextTraffic=true — khác biệt platform,
        //  ghi trong báo cáo.)
        configuration.timeoutIntervalForRequest = Self.readTimeout  // idle (readTimeout 20s của Java)
        configuration.timeoutIntervalForResource = 3600
        configuration.httpMaximumConnectionsPerHost = 6
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    // =====================================================================
    // Lifecycle
    // =====================================================================

    /// Tìm port trống trong 3000-3100 (port findFreePort của server.js).
    static func findFreePort(_ startPort: Int, _ maxPort: Int) -> Int {
        guard startPort <= maxPort else { return -1 }
        for candidate in startPort...maxPort {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            guard fd >= 0 else { return -1 }
            var yes: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
            var address = sockaddr_in()
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = in_port_t(UInt16(truncatingIfNeeded: candidate).bigEndian)
            address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
            let ok = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            close(fd)
            if ok == 0 { return candidate }
        }
        return -1
    }

    // Callbacks — LUÔN được gọi trên MAIN thread.
    var onPortReady: ((Int) -> Void)?
    var onPortFailed: ((String) -> Void)?
    private let startLock = NSLock()
    private var startRequested = false
    private static let maxPortAttempts = 5

    /// Khởi động server KHÔNG CHẶN main thread (chạy trên serverQueue).
    /// bind+listen ĐỒNG BỘ với errno thật — khi callback phát ra, port
    /// đã thực sự đang listen (không còn đoán state async của NWListener).
    /// Idempotent — gọi lại khi đã chạy là no-op.
    func start() {
        startLock.lock()
        guard !startRequested else {
            startLock.unlock()
            return
        }
        startRequested = true
        startLock.unlock()
        PhimDebugLog.step("SERVER", "start", "requested")
        serverQueue.async { [weak self] in
            self?.startListenerBsd()
        }
    }

    /// Cho phép start() chạy lại sau khi THẤT BẠI hoàn toàn (nút Thử lại).
    private func resetStartFlag() {
        startLock.lock()
        startRequested = false
        startLock.unlock()
    }

    /// socket + bind(127.0.0.1:port) + listen — trả (fd, errno).
    private func tryBindListen(port: Int) -> (fd: Int32, errno: Int32) {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return (-1, errno) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port).bigEndian)
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bindResult = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if bindResult != 0 {
            let e = errno
            close(fd)
            return (-1, e)
        }
        guard listen(fd, 16) == 0 else {
            let e = errno
            close(fd)
            return (-1, e)
        }
        return (fd, 0)
    }

    /// Tìm port trống (findFreePort) rồi bind THẬT; bind fail → bỏ qua
    /// port đó, thử port kế tiếp (tối đa maxPortAttempts vòng).
    private func startListenerBsd() {
        var scanFrom = 3000
        var lastErrno: Int32 = 0
        var boundFd: Int32 = -1
        var boundPort = 0
        for attempt in 1...Self.maxPortAttempts {
            let candidate = Self.findFreePort(scanFrom, 3100)
            PhimDebugLog.step("SERVER", "findFreePort", candidate > 0 ? "ok" : "FAIL",
                              "attempt=\(attempt) scanFrom=\(scanFrom) port=\(candidate)")
            guard candidate > 0 else {
                PhimDebugLog.step("SERVER", "bindListen", "FAIL", "không có port trống từ \(scanFrom)")
                break
            }
            let result = tryBindListen(port: candidate)
            if result.errno == 0 {
                boundFd = result.fd
                boundPort = candidate
                break
            }
            // findFreePort báo trống nhưng bind thật thất bại (có process
            // vừa chiếm, hoặc hạn chế hệ thống) → bỏ qua, thử port kế.
            lastErrno = result.errno
            PhimDebugLog.step("SERVER", "bindListen", "FAIL",
                              "attempt=\(attempt) 127.0.0.1:\(candidate) errno=\(lastErrno) (\(String(cString: strerror(lastErrno))))")
            scanFrom = candidate + 1
        }
        guard boundFd >= 0 else {
            let message = lastErrno == 0
                ? "Không tìm được port trống 3000-3100"
                : "Không bind được port 3000-3100 (errno \(lastErrno): \(String(cString: strerror(lastErrno))))"
            PhimDebugLog.step("SERVER", "listen", "FAIL", message)
            resetStartFlag()
            DispatchQueue.main.async { [weak self] in
                self?.onPortFailed?(message)
            }
            return
        }
        listenFd = boundFd
        port = boundPort
        listenActive = true
        PhimDebugLog.step("SERVER", "listen", "ok", "127.0.0.1:\(boundPort) fd=\(boundFd)")
        startAcceptThread()
        DispatchQueue.main.async { [weak self] in
            self?.onPortReady?(boundPort)
        }
    }

    private func startAcceptThread() {
        let thread = Thread { [weak self] in
            self?.acceptLoop()
        }
        thread.name = "com.bintv.phim.accept"
        thread.qualityOfService = .userInitiated
        thread.start()
        acceptThread = thread
    }

    /// Accept loop — 1 connection = 1 FdConnection (1 thread receive).
    private func acceptLoop() {
        while listenActive {
            var addr = sockaddr()
            var len = socklen_t(MemoryLayout<sockaddr>.size)
            let clientFd = accept(listenFd, &addr, &len)
            if clientFd < 0 {
                if errno == EINTR || errno == EAGAIN { continue }
                break // listen socket đã đóng (stop()).
            }
            PhimDebugLog.step("SERVER", "accept", "ok", "client fd=\(clientFd)")
            handleConnection(FdConnection(fd: clientFd))
        }
        PhimDebugLog.step("SERVER", "acceptLoop", "ended")
    }


    func stop() {
        PhimDebugLog.step("SERVER", "stop", "requested")
        listenActive = false
        if listenFd >= 0 {
            close(listenFd)
            listenFd = -1
        }
        connectionsLock.lock()
        let connections = activeConnections
        activeConnections.removeAll()
        connectionsLock.unlock()
        for connection in connections { connection.close() }
        proxySession.invalidateAndCancel()
    }

    /// [build 227] NỐI LẠI socket nghe khi health check thất bại (socket có
    /// thể bị hệ thống đóng khi app ở nền → mọi lần nạp lại sau đó đều đen).
    ///
    /// Chỉ đụng listener + các cờ; **KHÔNG** đụng `proxySession` (đang phục vụ
    /// stream — `invalidateAndCancel()` trên lazy var là mất vĩnh viễn) và
    /// KHÔNG gọi `stop()`. Nếu listener còn sống → không làm gì.
    func relaunchListenerIfDead() {
        serverQueue.async { [weak self] in
            guard let self = self else { return }
            guard !self.listenActive else {
                PhimDebugLog.step("SERVER", "relaunchListener", "skip", "listener còn sống")
                return
            }
            if self.listenFd >= 0 {
                close(self.listenFd)
                self.listenFd = -1
            }
            PhimDebugLog.step("SERVER", "relaunchListener", "begin",
                              "listener đã chết — bind lại (port cũ=\(self.port))")
            self.startListenerBsd()
        }
    }

    deinit {
        stop()
    }

    // =====================================================================
    // HTTP connection handling (HTTP/1.1, 1 request mỗi connection, close)
    // =====================================================================

    private final class ConnectionState {
        var buffer = Data()
        var handled = false
        var done = false
    }

    private func handleConnection(_ connection: FdConnection) {
        connectionsLock.lock()
        activeConnections.append(connection)
        connectionsLock.unlock()
        let state = ConnectionState()
        connection.onClosed = { [weak self] in
            self?.removeConnection(connection)
        }
        connection.onChunk = { [weak self] data in
            self?.processChunk(data, connection: connection, state: state)
        }
        connection.startReceiving()
    }

    private func removeConnection(_ connection: FdConnection?) {
        connectionsLock.lock()
        if let connection = connection {
            activeConnections.removeAll { $0 === connection }
        }
        connectionsLock.unlock()
    }

    /// Mỗi lần socket có data mới — tích lũy cho tới khi thấy \r\n\r\n
    /// (hết HTTP head). 1 request mỗi connection (đúng thiết kế Java gốc).
    private func processChunk(_ data: Data, connection: FdConnection, state: ConnectionState) {
        state.buffer.append(data)
        if state.buffer.count > 65536 {
            PhimDebugLog.step("HTTP", "request", "FAIL", "head quá lớn (>64KB) — 400")
            sendJsonError(connection, code: 400, message: "Request too large")
            connection.close()
            return
        }
        guard !state.handled else { return }
        if let headRange = state.buffer.range(of: Data([13, 10, 13, 10])) {
            state.handled = true
            let head = state.buffer.subdata(in: 0..<headRange.lowerBound)
            processRequest(connection, head: head)
        }
    }

    private func processRequest(_ connection: FdConnection, head: Data) {
        guard let headText = String(data: head, encoding: .utf8) else {
            sendJsonError(connection, code: 400, message: "Bad request")
            return
        }
        let lines = headText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            sendJsonError(connection, code: 400, message: "Bad request")
            return
        }
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else {
            sendJsonError(connection, code: 400, message: "Bad request")
            return
        }
        let method = parts[0].uppercased()
        let target = parts[1]
        let requestHeaders: [(String, String)] = lines.dropFirst().compactMap { line -> (String, String)? in
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let name = String(line[..<separator]).trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { return nil }
            return (name.lowercased(), value)
        }
        let headerValue: (String) -> String? = { name in
            requestHeaders.first(where: { $0.0 == name })?.1
        }

        let queryStart = target.firstIndex(of: "?")
        let pathPart: String
        let queryPart: String
        if let queryStart = queryStart {
            pathPart = String(target[..<queryStart])
            queryPart = String(target[target.index(after: queryStart)...])
        } else {
            pathPart = target
            queryPart = ""
        }
        let path = pathPart.removingPercentEncoding ?? pathPart
        PhimDebugLog.step("HTTP", "request", "recv", "\(method) \(String(path.prefix(200)))")

        if path == "/health" {
            let body = "{\"status\":\"ok\",\"port\":\(self.port)}"
            sendFixed(connection, code: 200,
                       headers: [("Content-Type", "application/json"),
                                 ("Cache-Control", "no-store")],
                       body: Data(body.utf8))
            return
        }
        if path == "/proxy" {
            if method != "GET" && method != "HEAD" {
                sendJsonError(connection, code: 405, message: "GET only")
                return
            }
            handleProxy(connection, method: method, query: queryPart, clientHeaders: headerValue)
            return
        }
        if method == "OPTIONS" {
            sendHeadOnly(connection, code: 204, headers: [
                ("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
                ("Access-Control-Allow-Headers", "*"),
                ("Access-Control-Allow-Origin", "*"),
            ])
            return
        }
        if method != "GET" && method != "HEAD" {
            sendJsonError(connection, code: 405, message: "GET only")
            return
        }
        serveStatic(connection, path: path)
    }

    // =====================================================================
    // STATIC FILES (thay express.static / AndroidAssetLoader)
    // =====================================================================

    private func webRoot() -> URL? {
        Bundle.main.url(forResource: "Web", withExtension: nil)
    }

    /// Viewport CHUẨN cho iPhone (app BinTV chạy chế độ TV ngang).
    /// - `width=device-width`: layout theo đúng bề rộng thiết bị (932pt trên
    ///   14 Pro Max ngang) → nội dung phủ kín, KHÔNG còn viền đen 2 bên.
    /// - `viewport-fit=cover`: phủ cả vùng Dynamic Island (dùng kèm
    ///   `env(safe-area-inset-*)` trong CSS để né).
    /// - `maximum-scale=1 / user-scalable=no`: webview không tự phóng/thu.
    private static let iOSViewport =
        "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"

    /// Thay (hoặc chèn) thẻ `<meta name="viewport">` trong HTML bằng viewport
    /// chuẩn iPhone. Chạy TRÊN SERVER khi trả index.html → chắc chắn 100%,
    /// không phụ thuộc thứ tự script hay cache của WKWebView.
    private static func applyIOSViewport(_ html: String) -> String {
        let replacement = "<meta name=\"viewport\" content=\"\(iOSViewport)\">"
        // Tìm thẻ meta viewport hiện có (mọi biến thể thứ tự thuộc tính/khoảng trắng).
        if let regex = try? NSRegularExpression(
            pattern: "<meta\\s+[^>]*name\\s*=\\s*[\"']viewport[\"'][^>]*>",
            options: [.caseInsensitive]) {
            let range = NSRange(html.startIndex..., in: html)
            if let match = regex.firstMatch(in: html, options: [], range: range),
               let swiftRange = Range(match.range, in: html) {
                let out = html.replacingCharacters(in: swiftRange, with: replacement)
                PhimDebugLog.step("STATIC", "viewport", "ok", "đã thay meta viewport 1920 → device-width")
                return out
            }
        }
        // Không có sẵn thẻ → chèn ngay sau <head>.
        if let headRange = html.range(of: "<head>", options: .caseInsensitive) {
            var out = html
            out.insert(contentsOf: replacement, at: headRange.upperBound)
            PhimDebugLog.step("STATIC", "viewport", "ok", "đã chèn meta viewport device-width")
            return out
        }
        return html
    }

    private func serveStatic(_ connection: FdConnection, path: String) {
        var assetPath: String
        if path == "/" || path.isEmpty {
            assetPath = "index.html"
        } else if path == "/Phim.png" {
            // Fallback poster mà app.js dùng ở gốc trang (giữ mapping Android).
            assetPath = "assets/Phim.png"
        } else {
            assetPath = String(path.drop(while: { $0 == "/" }))
        }
        guard !assetPath.isEmpty, !assetPath.contains("..") else {
            PhimDebugLog.step("STATIC", "serve", "FAIL", "path không hợp lệ: \(String(path.prefix(120)))")
            sendJsonError(connection, code: 404, message: "Not found: \(path)")
            return
        }
        guard let root = webRoot() else {
            PhimDebugLog.step("STATIC", "serve", "FAIL", "Web bundle missing (folder reference 'Web' không nằm trong app bundle)")
            sendJsonError(connection, code: 500, message: "Web bundle missing")
            return
        }
        let fileURL = root.appendingPathComponent(assetPath)
        var data = try? Data(contentsOf: fileURL)
        // [build 228 — ROOT CAUSE "PHIM không toàn màn hình / còn viền đen 2 bên"]
        // index.html của web app khai báo viewport 1920x1080 (bố cục TV
        // Electron/Android TV). Sửa bằng script trong <head> KHÔNG đủ (WebKit
        // đã chốt layout theo 1920 trước khi script chạy) → trang bị thu nhỏ
        // vừa màn hình iPhone (932x430 → nội dung ~764 rộng) và lộ ~84px đen
        // mỗi bên. Cách dứt điểm: VIẾT LẠI meta viewport NGAY TRONG HTML mà
        // server trả về — không phụ thuộc JS, không phụ thuộc cache.
        if assetPath == "index.html", let raw = data,
           let html = String(data: raw, encoding: .utf8) {
            let patched = Self.applyIOSViewport(html)
            data = Data(patched.utf8)
        }
        guard var data = data, data.count <= 15_000_000 else {
            PhimDebugLog.step("STATIC", "serve", "404", assetPath)
            sendJsonError(connection, code: 404, message: "Not found: \(path)")
            return
        }
        PhimDebugLog.step("STATIC", "serve", "ok", "\(assetPath) (\(data.count) bytes)")
        let mime = Self.contentType(for: assetPath)
        var headers: [(String, String)] = [("Content-Type", mime)]
        if assetPath.hasSuffix(".html") || assetPath.hasSuffix(".js") {
            headers.append(("Cache-Control", "no-cache, no-store, must-revalidate"))
            headers.append(("Pragma", "no-cache"))
            headers.append(("Expires", "0"))
        } else {
            headers.append(("Cache-Control", "max-age=3600"))
        }
        sendFixed(connection, code: 200, headers: headers, body: data)
    }

    private static func contentType(for path: String) -> String {
        let lower = path.lowercased()
        if lower.hasSuffix(".html") { return "text/html; charset=utf-8" }
        if lower.hasSuffix(".js") { return "text/javascript; charset=utf-8" }
        if lower.hasSuffix(".css") { return "text/css; charset=utf-8" }
        if lower.hasSuffix(".png") { return "image/png" }
        if lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") { return "image/jpeg" }
        if lower.hasSuffix(".webp") { return "image/webp" }
        if lower.hasSuffix(".gif") { return "image/gif" }
        if lower.hasSuffix(".svg") { return "image/svg+xml" }
        if lower.hasSuffix(".ico") { return "image/x-icon" }
        if lower.hasSuffix(".json") { return "application/json" }
        if lower.hasSuffix(".m3u8") { return "application/vnd.apple.mpegurl" }
        if lower.hasSuffix(".ts") { return "video/mp2t" }
        if lower.hasSuffix(".mp4") { return "video/mp4" }
        if lower.hasSuffix(".vtt") || lower.hasSuffix(".srt") { return "text/plain; charset=utf-8" }
        if lower.hasSuffix(".txt") { return "text/plain; charset=utf-8" }
        return "application/octet-stream"
    }

    // =====================================================================
    // /PROXY (port doProxyRequest + rewriteM3u8Urls)
    // =====================================================================

    private func parseQuery(_ query: String) -> [(String, String)] {
        var items: [(String, String)] = []
        for pair in query.components(separatedBy: "&") where !pair.isEmpty {
            let separatorIndex = pair.firstIndex(of: "=")
            if let separatorIndex = separatorIndex {
                let name = String(pair[..<separatorIndex]).removingPercentEncoding ?? String(pair[..<separatorIndex])
                let value = String(pair[pair.index(after: separatorIndex)...]).removingPercentEncoding
                    ?? String(pair[pair.index(after: separatorIndex)...])
                items.append((name, value))
            } else {
                let name = pair.removingPercentEncoding ?? pair
                items.append((name, ""))
            }
        }
        return items
    }

    private func handleProxy(_ connection: FdConnection, method: String, query: String,
                             clientHeaders: (String) -> String?) {
        let items = parseQuery(query)
        guard let targetParam = items.first(where: { $0.0 == "url" })?.1, !targetParam.isEmpty else {
            sendJsonError(connection, code: 400, message: "Missing url parameter")
            return
        }
        guard let originalTarget = URL(string: targetParam) else {
            sendJsonError(connection, code: 400, message: "Bad url")
            return
        }
        let extraReferer = items.first(where: { $0.0 == "__ref" })?.1
        let isHead = (method == "HEAD")

        var request = URLRequest(url: originalTarget, timeoutInterval: Self.readTimeout)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(Self.headerAccept, forHTTPHeaderField: "Accept")
        request.setValue(Self.headerAcceptLanguage, forHTTPHeaderField: "Accept-Language")
        // identity: KHÔNG nén — proxy trả byte nguyên (giống server.js).
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        var hasReferer = false
        if let referer = extraReferer, !referer.isEmpty {
            request.setValue(referer, forHTTPHeaderField: "Referer")
            if let refererURL = URL(string: referer), let host = refererURL.host {
                let portPart = refererURL.port.map { ":\($0)" } ?? ""
                request.setValue("\(refererURL.scheme ?? "http")://\(host)\(portPart)", forHTTPHeaderField: "Origin")
            }
            hasReferer = true
        }
        if !hasReferer, let referer = clientHeaders("referer") {
            request.setValue(referer, forHTTPHeaderField: "Referer")
        }
        if let origin = clientHeaders("origin") {
            request.setValue(origin, forHTTPHeaderField: "Origin")
        }
        // Range/If-Range (hls.js tải segment theo Range) — forward nguyên.
        if let range = clientHeaders("range") {
            request.setValue(range, forHTTPHeaderField: "Range")
        }
        if let ifRange = clientHeaders("if-range") {
            request.setValue(ifRange, forHTTPHeaderField: "If-Range")
        }

        // DoH: resolve host → kết nối qua IP + Header Host thật.
        var routedViaDoh = false
        if let host = originalTarget.host,
           !host.contains(":"),
           !PhimDohResolver.isIpLiteral(host),
           let ip = doh.resolve(host) {
            let portPart: String
            if let targetPort = originalTarget.port { portPart = ":\(targetPort)" } else { portPart = "" }
            let scheme = (originalTarget.scheme ?? "https").lowercased()
            let pathAndQuery = originalTarget.path
                + (originalTarget.query.map { "?\($0)" } ?? "")
            if let proxiedURL = URL(string: "\(scheme)://\(ip)\(portPart)\(pathAndQuery)") {
                request.setValue(host + portPart, forHTTPHeaderField: "Host")
                request.url = proxiedURL
                routedViaDoh = (scheme == "https")
            }
        }

        let pending = ProxyPending(
            connection: connection,
            isHead: isHead,
            originalTarget: originalTarget,
            extraReferer: extraReferer
        )

        // [PHIM_DEBUG] URL + Referer đã SANITIZE (che pkey/token/sig/...) —
        // log không bao giờ chứa giá trị khóa nguồn.
        PhimDebugLog.step("PROXY", isHead ? "HEAD-upstream" : "GET-upstream", "dispatch",
                          "url=\(PhimDebugLog.sanitizeURL(originalTarget.absoluteString)) ref=\(extraReferer.map { PhimDebugLog.sanitizeURL($0) } ?? "-") doh=\(routedViaDoh ? "Y" : "N")")

        // =================================================================
        // ROUTING CLEARTEXT — root-cause fix cho lỗi "không thể phát" trên
        // iPhone (Android phát được cùng nguồn):
        //
        // ATS (App Transport Security) CHỈ áp dụng cho các framework
        // URL-loading của Apple (URLSession, AVAsset, AVPlayer...). Một
        // source phim chỉ có http:// (thường gặp ở CDN VN/Asia) sẽ bị
        // URLSession iOS từ chối ngay lập tức, trong khi bản Android phát
        // được bình thường vì WebView + OkHttp chạy với
        // usesCleartextTraffic=true.
        //
        // Sửa đúng (không phải workaround): http:// → RawHttp — client
        // HTTP/1.1 viết TRỰC TIẾP trên BSD socket, không đi qua hệ thống
        // URL loading → không có ATS → parity với Android, VÀ không cần
        // NSAllowsArbitraryLoads (giữ ATS chặt cho phần còn lại của app).
        // https:// vẫn dùng URLSession như trước (TLS + ATS bình thường).
        // =================================================================
        if (request.url?.scheme ?? originalTarget.scheme)?.lowercased() == "http" {
            let reqURL = request.url ?? originalTarget
            let rawHeaders = (request.allHTTPHeaderFields ?? [:])
                .sorted { $0.key < $1.key }
                .map { ($0.key, $0.value) }
            let connectHost = reqURL.host ?? ""
            let connectPort = reqURL.port ?? 80
            rawHttpQueue.async { [weak self] in
                guard let self = self else { return }
                let started = Date()
                let raw = RawHttp.fetch(
                    url: originalTarget,
                    method: isHead ? "HEAD" : "GET",
                    connectHost: connectHost,
                    connectPort: connectPort,
                    hostHeader: request.value(forHTTPHeaderField: "Host"),
                    headers: rawHeaders,
                    timeout: 60
                )
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                if let response = raw.response,
                   let httpResponse = Self.makeHTTPResponse(url: originalTarget, code: response.statusCode, headers: response.headers) {
                    let rawBytes = response.fileURL.map { (try? FileManager.default.attributesOfItem(atPath: $0.path)[.size] as? Int) ?? 0 } ?? 0
                    PhimDebugLog.step("PROXY", "rawhttp-response", response.statusCode < 400 ? "ok" : "upstream-\(response.statusCode)",
                                      "code=\(response.statusCode) \(ms)ms bytes=\(rawBytes)")
                    let fileURL = response.fileURL ?? FileManager.default.temporaryDirectory
                        .appendingPathComponent("rawhttp_empty_\(UUID().uuidString)")
                    self.handleProxyResult(pending: pending, fileURL: fileURL, response: httpResponse)
                } else {
                    PhimDebugLog.step("PROXY", "rawhttp", "FAIL",
                                      "\(raw.error ?? "unknown") url=\(PhimDebugLog.sanitizeURL(originalTarget.absoluteString)) fallback=URLSession")
                    self.startUrlSessionProxy(request: request, pending: pending, routedViaDoh: routedViaDoh)
                }
            }
            return
        }

        startUrlSessionProxy(request: request, pending: pending, routedViaDoh: routedViaDoh)
    }

    /// Đường HTTPS (và fallback của http khi RawHttp lỗi): URLSession.
    /// Behavior giữ NGUYÊN như trước (KHÔNG follow redirect — trả 3xx
    /// nguyên cho browser; challenge TLS cho task DoH; file qua delegate).
    private func startUrlSessionProxy(request: URLRequest, pending: ProxyPending, routedViaDoh: Bool) {
        let task = proxySession.downloadTask(with: request)
        if routedViaDoh {
            dohLock.lock()
            dohRoutedTaskIds.insert(task.taskIdentifier)
            dohLock.unlock()
        }
        proxyLock.lock()
        proxyPending[task.taskIdentifier] = pending
        proxyLock.unlock()
        task.resume()
    }

    // =====================================================================
    // URLSession delegate — KHÔNG follow redirect + chấp nhận TLS cho đúng
    // task proxy đi qua IP DoH (trên iOS SNI=IP vì URLSession không tách DNS).
    // =====================================================================

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest requestedRequest: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Node http.request / OkHttp followRedirects(false): trả 3xx nguyên.
        completionHandler(nil)
    }

    // Challenge TASK-LEVEL (URLSessionTaskDelegate): task được truyền sẵn —
    // phiên bản session-level không truy cập được task.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let isProxyDohTask: Bool
        dohLock.lock()
        isProxyDohTask = dohRoutedTaskIds.contains(task.taskIdentifier)
        dohLock.unlock()
        // Challenge TLS của DoH có serverTrust — chỉ accept cho task DoH đang theo dõi.
        if isProxyDohTask, let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        proxyLock.lock()
        proxyFiles[downloadTask.taskIdentifier] = location
        proxyLock.unlock()
        // HTTP response + lỗi được xử lý trong didCompleteWithError.
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        let taskId = task.taskIdentifier
        let httpResponse = task.response as? HTTPURLResponse
        proxyQueue.async { [weak self] in
            guard let self = self else { return }
            self.proxyLock.lock()
            let pending = self.proxyPending.removeValue(forKey: taskId)
            let fileURL = self.proxyFiles.removeValue(forKey: taskId)
            self.proxyLock.unlock()
            self.dohLock.lock()
            self.dohRoutedTaskIds.remove(taskId)
            self.dohLock.unlock()
            guard let pending = pending else { return }
            if let error = error {
                let isTimeout = (error as? URLError)?.code == .timedOut
                PhimDebugLog.step("PROXY", "urlsession", "FAIL",
                                  "\(isTimeout ? "timeout(504)" : "error(500)"): \(error.localizedDescription) url=\(PhimDebugLog.sanitizeURL(pending.originalTarget.absoluteString))")
                self.sendJsonError(pending.connection,
                                   code: isTimeout ? 504 : 500,
                                   message: isTimeout ? "Proxy timeout" : error.localizedDescription)
                if let fileURL = fileURL { try? FileManager.default.removeItem(at: fileURL) }
                return
            }
            guard let fileURL = fileURL else {
                PhimDebugLog.step("PROXY", "urlsession", "FAIL",
                                  "empty response(502) url=\(PhimDebugLog.sanitizeURL(pending.originalTarget.absoluteString))")
                self.sendJsonError(pending.connection, code: 502, message: "Proxy empty response")
                return
            }
            self.handleProxyResult(pending: pending, fileURL: fileURL, response: httpResponse)
        }
    }

    private func handleProxyResult(pending: ProxyPending, fileURL: URL, response: HTTPURLResponse?) {
        let code = response?.statusCode ?? 502
        let contentType = response?.value(forHTTPHeaderField: "Content-Type") ?? ""
        var headers = Self.upstreamHeaderList(response)
        let isM3u8 = Self.isM3u8ContentType(contentType)
            || Self.urlLooksLikeM3u8(pending.originalTarget.absoluteString)

        // =================================================================
        // 3xx + Location TUYỆT ĐỐI → bọc lại qua /proxy.
        // Browser (WKWebView) khi nhận 3xx sẽ tự follow Location. Nếu
        // Location là URL upstream tuyệt đối, browser sẽ fetch TRỰC TIẾP
        // upstream: trên iOS http:// bị ATS chặn, https thì mất hết header
        // proxy (Referer/UA) — nguồn bị 403. Bản Android không có vấn đề
        // này (WebView fetch thẳng được, cleartext mở). Bọc qua /proxy →
        // mọi hop đều đi qua proxy (đúng headers + DoH + không ATS).
        // Location tương đối giữ nguyên (parity với server.js).
        // =================================================================
        if (300..<400).contains(code),
           let locIdx = headers.firstIndex(where: { $0.0.lowercased() == "location" }) {
            let locValue = headers[locIdx].1
            if let locURL = URL(string: locValue),
               let locScheme = locURL.scheme?.lowercased(),
               locScheme == "http" || locScheme == "https",
               locURL.host != nil {
                let refPart: String
                if let ref = pending.extraReferer, !ref.isEmpty {
                    refPart = "&__ref=" + Self.encodeQueryValue(ref)
                } else {
                    refPart = ""
                }
                PhimDebugLog.step("PROXY", "redirect-rewrite", "ok",
                                  "loc=\(PhimDebugLog.sanitizeURL(locValue))")
                headers[locIdx] = ("Location", "/proxy?url=" + Self.encodeQueryValue(locValue) + refPart)
            }
        }

        PhimDebugLog.step("PROXY", "upstream-response", (200..<400).contains(code) ? "ok" : "upstream-\(code)",
                          "code=\(code) ct=\(String(contentType.prefix(80))) m3u8=\(isM3u8 ? "Y" : "N") head=\(pending.isHead ? "Y" : "N")")

        var rewritten: Data?
        if isM3u8,
           let raw = try? Data(contentsOf: fileURL), raw.count <= 2_000_000,
           var text = String(data: raw, encoding: .utf8) {
            let base = Self.baseUrlOf(pending.originalTarget.absoluteString)
            let lineCount = text.components(separatedBy: "\n").count
            text = Self.rewriteM3u8Urls(text, baseUrl: base, extraReferer: pending.extraReferer)
            rewritten = Data(text.utf8)
            // Body đã đổi → bỏ Content-Length/Encoding cũ (nếu giữ lại, iOS
            // cắt ngang playlist → không phát được).
            headers = Self.stripStaleBodyHeaders(headers)
            let proxiedCount = text.components(separatedBy: "/proxy?url=").count - 1
            PhimDebugLog.step("M3U8", "rewrite", "ok",
                              "lines=\(lineCount) proxiedChildren=\(proxiedCount) base=\(PhimDebugLog.sanitizeURL(base))")
        } else if isM3u8 {
            // Không rewrite được (body >2MB hoặc không phải UTF-8, ví dụ
            // upstream nén gzip dù đã gửi Accept-Encoding: identity) —
            // ghi rõ để phân loại trên máy thật.
            PhimDebugLog.step("M3U8", "rewrite", "SKIP",
                              "body không parse được UTF-8 hoặc >2MB url=\(PhimDebugLog.sanitizeURL(pending.originalTarget.absoluteString))")
        }
        if headers.firstIndex(where: { $0.0.lowercased() == "content-type" }) == nil {
            let defaultType: String
            if !contentType.isEmpty { defaultType = contentType }
            else if rewritten != nil { defaultType = "application/vnd.apple.mpegurl" }
            else { defaultType = "application/octet-stream" }
            headers.append(("Content-Type", defaultType))
        }
        if pending.isHead {
            let length: Int
            if let data = rewritten { length = data.count }
            else { length = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0 }
            headers = Self.stripStaleBodyHeaders(headers)
            headers.append(("Content-Length", String(length)))
            sendHeadOnly(pending.connection, code: code, headers: headers)
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        if let data = rewritten {
            sendFixed(pending.connection, code: code, headers: headers, body: data)
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        // Stream trực tiếp từ file — file được xóa trong streamFile
        // SAU khi stream xong (không được xóa trước, stream sẽ mất nguồn).
        let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
        sendFixed(pending.connection, code: code, headers: headers, fileURL: fileURL, size: size)
    }

    /// Tổng hợp HTTPURLResponse từ kết quả RawHttp (để handleProxyResult
    /// xử lý đồng nhất cho cả 2 đường http (raw) / https (URLSession)).
    private static func makeHTTPResponse(url: URL, code: Int, headers: [(String, String)]) -> HTTPURLResponse? {
        // headerFields của HTTPURLResponse có type [String : String]? (KHÔNG
        // phải [String : Any]?) — giữ nguyên chuỗi header, value String.
        var fields: [String: String] = [:]
        for (key, value) in headers where fields[key] == nil {
            fields[key] = value
        }
        if fields.isEmpty {
            return HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)
        }
        return HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: fields)
    }

    private static func isM3u8ContentType(_ contentType: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: m3u8ContentTypePattern, options: .caseInsensitive) else { return false }
        return regex.firstMatch(in: contentType, options: [],
                                range: NSRange(location: 0, length: (contentType as NSString).length)) != nil
    }

    private static func urlLooksLikeM3u8(_ url: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: "\\.m3u8(\\?|$)", options: .caseInsensitive) else { return false }
        return regex.firstMatch(in: url, options: [],
                                range: NSRange(location: 0, length: (url as NSString).length)) != nil
    }

    private static func upstreamHeaderList(_ response: HTTPURLResponse?) -> [(String, String)] {
        guard let response = response else { return [] }
        var result: [(String, String)] = []
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            let lower = name.lowercased()
            if lower == "access-control-allow-origin"
                || lower == "access-control-allow-credentials"
                || lower == "transfer-encoding"
                || lower == "content-length" { continue }
            if let stringValue = value as? String {
                result.append((name, stringValue))
            } else if let array = value as? [String] {
                for item in array { result.append((name, item)) }
            }
        }
        return result
    }

    // =====================================================================
    // rewriteM3u8Urls — port NGUYÊN VĂN từ server.js (qua MediaProxyServer.java)
    // =====================================================================

    private static func originOf(_ url: String) -> String {
        guard let parsed = URL(string: url), let host = parsed.host else { return "" }
        let portPart: String
        if let port = parsed.port { portPart = ":\(port)" } else { portPart = "" }
        return "\(parsed.scheme ?? "http")://\(host)\(portPart)"
    }

    private static func baseUrlOf(_ urlString: String) -> String {
        guard let slashIndex = urlString.lastIndex(of: "/") else { return "" }
        return String(urlString[...urlString.index(after: slashIndex)])
    }

    private static func encodeQueryValue(_ value: String) -> String {
        // Khớp Java URLEncoder.encode(...).replace("+","%20").replace("*","%2A")
        // .replace("%7E","~"): giữ alphanumerics + - _ . ~ ; space → %20 ;
        // * → %2A ; còn lại %XX (UTF-8).
        let allowed = CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func proxifyM3u8Value(_ value: String, baseUrl: String,
                                         selfOrigin: String, refSuffix: String) -> String {
        var trimmed = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        trimmed = trimmed.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return value }
        var absolute: String
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            absolute = trimmed
        } else {
            guard !baseUrl.isEmpty,
                  let base = URL(string: baseUrl),
                  let resolved = URL(string: trimmed, relativeTo: base) else { return value }
            absolute = resolved.absoluteString
        }
        // Chống proxy 2 tầng (khi upstream đã là URL proxy cùng origin).
        if !selfOrigin.isEmpty, absolute.hasPrefix(selfOrigin), absolute.contains("/proxy?url=") {
            if !refSuffix.isEmpty && !absolute.contains("__ref=") {
                return absolute + refSuffix
            }
            return absolute
        }
        return "/proxy?url=" + encodeQueryValue(absolute) + refSuffix
    }

    private static func rewriteUriAttrs(_ line: String, transform: (String) -> String) -> (String, Bool) {
        guard let regex = try? NSRegularExpression(pattern: uriAttrPattern, options: []) else {
            return (line, false)
        }
        var result = ""
        var lastOffset = 0
        var found = false
        for match in regex.matches(in: line, options: [],
                                    range: NSRange(location: 0, length: (line as NSString).length)) {
            guard let fullRange = Range(match.range, in: line),
                  let groupRange = Range(match.range(at: 1), in: line) else { continue }
            found = true
            result += String(line[line.index(line.startIndex, offsetBy: lastOffset)..<fullRange.lowerBound])
            result += "URI=\"" + transform(String(line[groupRange])) + "\""
            lastOffset = line.distance(from: line.startIndex, to: fullRange.upperBound)
        }
        if found {
            result += String(line[line.index(line.startIndex, offsetBy: lastOffset)...])
        }
        return (result, found)
    }

    static func rewriteM3u8Urls(_ manifestText: String, baseUrl: String, extraReferer: String?) -> String {
        let selfOrigin = originOf(baseUrl)
        let refSuffix: String
        if let referer = extraReferer, !referer.isEmpty {
            refSuffix = "&__ref=" + encodeQueryValue(referer)
        } else {
            refSuffix = ""
        }
        // Java split("\\r?\\n") — hỗ trợ cả \r\n và \n.
        let normalized = manifestText.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var outLines: [String] = []
        outLines.reserveCapacity(lines.count)
        for line in lines {
            if line.isEmpty {
                outLines.append(line)
                continue
            }
            if line.hasPrefix("#") {
                let (replaced, found) = rewriteUriAttrs(line) { value in
                    proxifyM3u8Value(value, baseUrl: baseUrl, selfOrigin: selfOrigin, refSuffix: refSuffix)
                }
                outLines.append(found ? replaced : line)
            } else {
                outLines.append(proxifyM3u8Value(line, baseUrl: baseUrl, selfOrigin: selfOrigin, refSuffix: refSuffix))
            }
        }
        return outLines.joined(separator: "\n")
    }

    // =====================================================================
    // HTTP response writing
    // =====================================================================

    private static func reasonPhrase(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 204: return "No Content"
        case 206: return "Partial Content"
        case 301: return "Moved Permanently"
        case 302: return "Found"
        case 304: return "Not Modified"
        case 307: return "Temporary Redirect"
        case 308: return "Permanent Redirect"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 416: return "Range Not Satisfiable"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 504: return "Gateway Timeout"
        default: return "Status \(code)"
        }
    }

    private func buildHead(_ code: Int, headers: [(String, String)], includeLength: Bool) -> String {
        var head = "HTTP/1.1 \(code) \(Self.reasonPhrase(code))\r\n"
        var hasOrigin = false
        for (name, value) in headers {
            if name.lowercased() == "access-control-allow-origin" { hasOrigin = true; continue }
            head += "\(name): \(value)\r\n"
        }
        if !hasOrigin {
            head += "Access-Control-Allow-Origin: *\r\n"
        }
        head += "Connection: close\r\n\r\n"
        return head
    }

    /// [build 230 — ROOT CAUSE "iPhone KHÔNG phát được nguồn, Windows thì được"]
    ///
    /// Khi proxy REWRITE nội dung (m3u8), các header mô tả BODY CŨ trở nên SAI:
    ///   • `Content-Length` của upstream NHỎ HƠN độ dài sau rewrite
    ///     (`playlist_720p.m3u8` → `/proxy?url=https%3A%2F%2F…` dài hơn nhiều)
    ///     → WebKit/AVFoundation trên iOS đọc đúng N byte rồi kết thúc =
    ///     **playlist bị CẮT giữa chừng** → HLS parse lỗi → video.onerror →
    ///     app báo "Không thể phát nguồn phim này trên TV".
    ///     Chromium + hls.js trên Windows dễ tính hơn (bỏ qua sai lệch) nên
    ///     bản Windows vẫn phát được — ĐÓ LÀ ĐÚNG KHÁC BIỆT HAI NỀN TẢNG.
    ///   • `Content-Encoding` / `Transfer-Encoding` / `ETag` / `Content-MD5`
    ///     cũng không còn mô tả body mới.
    /// → Bỏ các header này để `sendFixed` tự gắn `Content-Length` ĐÚNG.
    private static let staleBodyHeaders: Set<String> = [
        "content-length", "content-encoding", "transfer-encoding", "etag", "content-md5"
    ]

    private static func stripStaleBodyHeaders(_ headers: [(String, String)]) -> [(String, String)] {
        return headers.filter { !staleBodyHeaders.contains($0.0.lowercased()) }
    }

    /// Chỉ giữ 1 header cùng tên (tránh gửi 2 `Content-Length` — iOS coi là
    /// response không hợp lệ và huỷ phiên phát).
    private static func dedupeHeader(_ headers: [(String, String)], name: String) -> [(String, String)] {
        let lowered = name.lowercased()
        var out: [(String, String)] = []
        var seen = false
        for header in headers {
            if header.0.lowercased() == lowered {
                if seen { continue }
                seen = true
            }
            out.append(header)
        }
        return out
    }

    private func sendHeadOnly(_ connection: FdConnection, code: Int, headers: [(String, String)]) {
        let head = buildHead(code, headers: headers, includeLength: false)
        connection.send(content: Data(head.utf8), completion: { [weak self] _ in
            self?.closeConnection(connection)
        })
    }

    private func sendFixed(_ connection: FdConnection, code: Int, headers: [(String, String)], body: Data) {
        var allHeaders = Self.dedupeHeader(headers, name: "Content-Length")
        if allHeaders.firstIndex(where: { $0.0.lowercased() == "content-length" }) == nil {
            allHeaders.append(("Content-Length", String(body.count)))
        }
        let head = buildHead(code, headers: allHeaders, includeLength: true)
        var payload = Data(head.utf8)
        payload.append(body)
        connection.send(content: payload, completion: { [weak self] _ in
            self?.closeConnection(connection)
        })
    }

    private func sendFixed(_ connection: FdConnection, code: Int, headers: [(String, String)],
                           fileURL: URL, size: Int) {
        var allHeaders = Self.dedupeHeader(headers, name: "Content-Length")
        if allHeaders.firstIndex(where: { $0.0.lowercased() == "content-length" }) == nil {
            allHeaders.append(("Content-Length", String(size)))
        }
        let head = buildHead(code, headers: allHeaders, includeLength: true)
        connection.send(content: Data(head.utf8), completion: { [weak self] sendError in
            guard let self = self else { return }
            if sendError == nil {
                self.streamFile(connection, fileURL: fileURL)
            } else {
                // Gửi head thất bại (client disconnect/lỗi) → dọn file + đóng.
                try? FileManager.default.removeItem(at: fileURL)
                self.closeConnection(connection)
            }
        })
    }

    private func streamFile(_ connection: FdConnection, fileURL: URL) {
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
            try? FileManager.default.removeItem(at: fileURL)
            closeConnection(connection)
            return
        }
        var stopped = false
        handle.readabilityHandler = { [weak self, weak connection] fileHandle in
            guard let self = self, let connection = connection, !stopped else { return }
            let chunk = fileHandle.availableData
            if chunk.isEmpty {
                stopped = true
                fileHandle.readabilityHandler = nil
                try? fileHandle.close()
                try? FileManager.default.removeItem(at: fileURL)
                self.closeConnection(connection)
            } else {
                connection.send(content: chunk, completion: { [weak self] sendError in
                    if sendError != nil {
                        stopped = true
                        fileHandle.readabilityHandler = nil
                        try? fileHandle.close()
                        try? FileManager.default.removeItem(at: fileURL)
                        self?.closeConnection(connection)
                    }
                })
            }
        }
    }

    private func closeConnection(_ connection: FdConnection) {
        removeConnection(connection)
        connection.close()
    }

    private func sendJsonError(_ connection: FdConnection, code: Int, message: String) {
        let escaped = Self.jsonString(message)
        let body = "{\"error\":\(escaped)}"
        sendFixed(connection, code: code,
                  headers: [("Content-Type", "application/json")],
                  body: Data(body.utf8))
    }

    private static func jsonString(_ value: String) -> String {
        var result = "\""
        for character in value.unicodeScalars {
            switch character {
            case "\"": result += "\\\""
            case "\\": result += "\\\\"
            case "\n": result += "\\n"
            case "\r": result += "\\r"
            case "\t": result += "\\t"
            default:
                if character.value < 0x20 {
                    result += String(format: "\\u%04x", character.value)
                } else {
                    result.unicodeScalars.append(character)
                }
            }
        }
        result += "\""
        return result
    }
}

// =====================================================================
// RawHttp — client HTTP/1.1 TRỰC TIẾP trên BSD socket (không URLSession,
// không hệ thống URL loading) → KHÔNG BỊ ATS CHẶN. Dùng cho nguồn
// CLEARTEXT http:// để có parity với Android (usesCleartextTraffic=true)
// mà KHÔNG cần NSAllowsArbitraryLoads trong plist.
//
// Thiết kế tối giản, semantics giống Node server.js / OkHttp
// followRedirects(false):
// - 1 request / 1 connection (Connection: close), không keep-alive.
// - KHÔNG follow redirect phía server — trả 3xx nguyên (handleProxyResult
//   bọc Location tuyệt đối qua /proxy).
// - Body ghi STRIM vào file tạm (không giữ trong RAM): Content-Length |
//   chunked | đọc đến EOF. HEAD/204/205/304: không body.
// - Chạy ĐỒNG BỘ — chỉ được gọi trên proxyQueue (background queue).
// =====================================================================

private enum RawHttp {

    struct Response {
        let statusCode: Int
        let headers: [(String, String)]
        let fileURL: URL?
    }

    /// Fetch 1 request. Trả (response, error) — response nil ⇔ có error.
    static func fetch(url: URL, method: String, connectHost: String, connectPort: Int,
                      hostHeader: String?, headers: [(String, String)],
                      timeout: TimeInterval) -> (response: Response?, error: String?) {
        guard !connectHost.isEmpty, (1...65535).contains(connectPort) else {
            return (nil, "no host/port: \(url.absoluteString)")
        }

        // Request-target NGUYÊN VĂN (giữ percent-encoding) — cắt scheme://host:port
        // khỏi absoluteString. KHÔNG dùng url.path (Foundation decode %XX).
        var requestTarget = url.absoluteString
        if let schemeRange = requestTarget.range(of: "://") {
            requestTarget = String(requestTarget[schemeRange.upperBound...])
            if let slash = requestTarget.firstIndex(of: "/") {
                requestTarget = String(requestTarget[slash...])
            } else {
                requestTarget = "/"
            }
        }

        // --- DNS: connectHost có thể là IP (đã resolve qua DoH ở trên)
        // hoặc hostname → getaddrinfo.
        let addrs: [sockaddr_in]
        if PhimDohResolver.isIpLiteral(connectHost) {
            guard let one = makeSockAddr(ip: connectHost) else {
                return (nil, "bad ip literal: \(connectHost)")
            }
            addrs = [one]
        } else {
            addrs = resolveHost(connectHost)
            guard !addrs.isEmpty else {
                return (nil, "dns failed: \(connectHost)")
            }
        }

        guard let fd = connectSocket(addrs: addrs, port: connectPort, timeout: timeout) else {
            return (nil, "connect failed: \(connectHost):\(connectPort)")
        }
        defer { Darwin.close(fd) }

        // Timeout cho MỖI lần recv (chống treo vĩnh viễn nếu CDN im lặng).
        var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        // --- Request line + headers (Host do bên ngoài quyết định —
        // khớp request mà URLSession sẽ gửi, bao gồm route DoH).
        var req = "\(method) \(requestTarget) HTTP/1.1\r\nHost: \(hostHeader ?? connectHost)\r\n"
        for (name, value) in headers where name.lowercased() != "host" {
            req += "\(name): \(value)\r\n"
        }
        req += "Connection: close\r\n\r\n"

        let reqData = Data(req.utf8)
        var sent = 0
        while sent < reqData.count {
            let n = reqData.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.baseAddress else { return 0 }
                return Darwin.send(fd, base.advanced(by: sent), reqData.count - sent, Int32(MSG_NOSIGNAL))
            }
            if n <= 0 { return (nil, "send failed") }
            sent += n
        }

        // --- Đọc response head (đến \r\n\r\n, giới hạn 64KB).
        // LƯU Ý: phải tìm \r\n\r\n TRONG TOÀN BỘ buffer — KHÔNG được chỉ
        // check 4 bytes cuối: server hay gộp head + phần đầu body vào CÙNG
        // 1 gói TCP, khi đó buffer kết thúc bằng byte body (loop sẽ nuốt
        // hết body vào "head" → lỗi "header too large").
        var head = Data()
        var headBuf = [UInt8](repeating: 0, count: 8192)
        var sepRange: Range<Data.Index>?
        while sepRange == nil {
            if head.count > 65536 { return (nil, "response header too large") }
            let n = recv(fd, &headBuf, headBuf.count, 0)
            if n < 0 { return (nil, "recv header error") }
            if n == 0 { return (nil, "recv header EOF (server đóng kết nối)") }
            head.append(contentsOf: headBuf[0..<n])
            sepRange = head.range(of: Data([13, 10, 13, 10]))
        }
        let sep = sepRange!
        let headBytes = head.subdata(in: head.startIndex..<sep.lowerBound)
        // Bytes body đọc THỪA cùng gói với head (rất hay gặp) — dùng trước.
        let bodyExtra = head.subdata(in: sep.upperBound..<head.endIndex)
        let headText = String(data: headBytes, encoding: .isoLatin1)
            ?? String(data: headBytes, encoding: .utf8) ?? ""

        let lines = headText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first else { return (nil, "empty status line") }
        let statusParts = statusLine.split(separator: " ")
        guard statusParts.count >= 2, let code = Int(statusParts[1]) else {
            return (nil, "bad status line: \(statusLine)")
        }

        var parsedHeaders: [(String, String)] = []
        var lowerHeaders: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if !name.isEmpty {
                parsedHeaders.append((name, value))
                lowerHeaders[name.lowercased()] = value
            }
        }

        // HEAD / 204 / 205 / 304 → không có body.
        if method == "HEAD" || code == 204 || code == 205 || code == 304 {
            return (Response(statusCode: code, headers: parsedHeaders, fileURL: nil), nil)
        }

        // --- Body → file tạm (stream từng chunk, không giữ cả file trong RAM).
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("rawhttp_\(UUID().uuidString).tmp")
        // createFile(atPath:contents:) KHÔNG throw (convenience method).
        FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        guard let fileHandle = try? FileHandle(forWritingTo: fileURL) else {
            try? FileManager.default.removeItem(at: fileURL)
            return (nil, "temp file open failed")
        }
        defer { try? fileHandle.close() }

        var written: Int64 = 0
        let maxBytes: Int64 = 2 * 1024 * 1024 * 1024  // 2GB — an toàn, file nằm trên đĩa

        func writeChunk(_ data: Data) -> Bool {
            guard !data.isEmpty else { return true }
            guard written + Int64(data.count) <= maxBytes else { return false }
            do {
                try fileHandle.write(contentsOf: data)
            } catch {
                return false
            }
            written += Int64(data.count)
            return true
        }

        enum RecvResult { case data(Data), eof, error }
        func recvOnce() -> RecvResult {
            var buffer = [UInt8](repeating: 0, count: 65536)
            let n = recv(fd, &buffer, buffer.count, 0)
            if n < 0 { return .error }
            if n == 0 { return .eof }
            return .data(Data(buffer[0..<n]))
        }

        var bodyOk = true
        if let lenText = lowerHeaders["content-length"],
           let length = Int64(lenText.trimmingCharacters(in: .whitespaces)),
           length >= 0 {
            // (1) Body theo Content-Length.
            var toRead = length
            if !bodyExtra.isEmpty {
                let take = min(bodyExtra.count, Int(toRead))
                // if (KHÔNG dùng guard — guard else buộc phải return/throw/
                // break/continue, không được fall-through vào lệnh kế tiếp).
                if !writeChunk(bodyExtra.prefix(take)) { bodyOk = false }
                toRead -= Int64(take)
            }
            while toRead > 0 && bodyOk {
                switch recvOnce() {
                case .data(let data):
                    let take = min(data.count, Int(toRead))
                    if !writeChunk(data.prefix(take)) { bodyOk = false }
                    toRead -= Int64(take)
                case .eof:
                    bodyOk = false
                case .error:
                    bodyOk = false
                }
            }
        } else if lowerHeaders["transfer-encoding"]?.lowercased().contains("chunked") == true {
            // (2) Body chunked (RFC 7230) — giải mã chunked, ghi raw bytes.
            var parser = ChunkedDecoder()
            bodyOk = parser.feed(bodyExtra) { writeChunk($0) }
            while bodyOk && !parser.finished {
                switch recvOnce() {
                case .data(let data):
                    bodyOk = parser.feed(data) { writeChunk($0) }
                case .eof:
                    bodyOk = false  // chunked chưa nhận chunk 0 → lỗi
                case .error:
                    bodyOk = false
                }
            }
        } else {
            // (3) Không có Content-Length, không chunked → đọc đến EOF
            // (Connection: close).
            if !bodyExtra.isEmpty {
                bodyOk = writeChunk(bodyExtra)
            }
            while bodyOk {
                switch recvOnce() {
                case .data(let data):
                    bodyOk = writeChunk(data)
                case .eof:
                    break
                case .error:
                    bodyOk = false
                }
            }
        }

        guard bodyOk else {
            try? fileHandle.close()
            try? FileManager.default.removeItem(at: fileURL)
            return (nil, "body read failed (received \(written) bytes)")
        }
        return (Response(statusCode: code, headers: parsedHeaders, fileURL: fileURL), nil)
    }

    // MARK: - TCP connect (timeout, non-blocking + poll)

    private static func connectSocket(addrs: [sockaddr_in], port: Int, timeout: TimeInterval) -> Int32? {
        for candidate in addrs {
            var addr = candidate
            addr.sin_port = UInt16(port).bigEndian
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { continue }
            let flags = fcntl(fd, F_GETFL, 0)
            if flags >= 0 { _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK) }
            let rc: Int32 = withUnsafePointer(to: &addr) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                    Darwin.connect(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if rc == 0 {
                if flags >= 0 { _ = fcntl(fd, F_SETFL, flags) }
                return fd
            }
            if errno != EINPROGRESS {
                Darwin.close(fd)
                continue
            }
            var pollFd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            let pollResult = poll(&pollFd, 1, Int32(timeout * 1000))
            if pollResult <= 0 {
                Darwin.close(fd)
                continue
            }
            var socketErr: Int32 = 0
            var errLen = socklen_t(MemoryLayout<Int32>.size)
            let getErr = getsockopt(fd, SOL_SOCKET, SO_ERROR, &socketErr, &errLen)
            if getErr != 0 || socketErr != 0 {
                Darwin.close(fd)
                continue
            }
            if flags >= 0 { _ = fcntl(fd, F_SETFL, flags) }
            return fd
        }
        return nil
    }

    // MARK: - DNS

    private static func resolveHost(_ host: String) -> [sockaddr_in] {
        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else {
            return []
        }
        defer { freeaddrinfo(first) }
        var addrs: [sockaddr_in] = []
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let current = cursor {
            let info = current.pointee
            if info.ai_family == AF_INET, let raw = info.ai_addr {
                addrs.append(raw.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee })
            }
            cursor = info.ai_next
        }
        return addrs
    }

    private static func makeSockAddr(ip: String) -> sockaddr_in? {
        var value: UInt32 = 0
        ip.withCString { pointer in
            // inet_addr trả in_addr_t (UInt32) — đã ở network byte order,
            // đúng thứ cần gán vào sin_addr.
            value = inet_addr(pointer)
        }
        guard value != UInt32.max else { return nil }  // inet_addr lỗi → INADDR_NONE
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr = in_addr(s_addr: value)
        return addr
    }

    // MARK: - Chunked decoder (RFC 7230 §4.1.2)

    /// Giải mã body chunked:
    ///   <chunk-size>[;ext]\r\n <chunk-data>\r\n ... 0\r\n [trailers]\r\n
    /// State machine byte-by-byte — an toàn với mọi cách chia gói recv.
    private struct ChunkedDecoder {
        private enum State { case size, body, cr, lf }
        private var state: State = .size
        private var sizeBuf: [UInt8] = []
        private var outBuf: [UInt8] = []
        private var remaining: Int = 0
        private(set) var finished = false

        /// Ghi data đã giải mã qua output. false → dừng (lỗi/không đủ chỗ).
        mutating func feed(_ input: Data, output: (Data) -> Bool) -> Bool {
            for byte in input {
                guard !finished else { continue }  // trailers sau chunk 0: bỏ qua
                if !step(byte, output: output) { return false }
            }
            if !outBuf.isEmpty {
                guard output(Data(outBuf)) else { return false }
                outBuf.removeAll(keepingCapacity: true)
            }
            return true
        }

        @discardableResult
        private mutating func step(_ byte: UInt8, output: (Data) -> Bool) -> Bool {
            switch state {
            case .size:
                if byte == 13 { return true }  // \r trước \n của dòng size
                if byte == 10 {
                    let text = String(bytes: sizeBuf, encoding: .ascii) ?? ""
                    sizeBuf.removeAll(keepingCapacity: true)
                    let hexPart = text.split(separator: ";").first.map(String.init) ?? ""
                    guard let size = UInt64(hexPart, radix: 16) else { return false }
                    guard size <= UInt64(Int.max) else { return false }
                    if size == 0 {
                        finished = true
                        return true
                    }
                    remaining = Int(size)
                    state = .body
                    return true
                }
                sizeBuf.append(byte)
                return true
            case .body:
                outBuf.append(byte)
                remaining -= 1
                if remaining == 0 {
                    state = .cr
                    if !output(Data(outBuf)) { return false }
                    outBuf.removeAll(keepingCapacity: true)
                }
                return true
            case .cr:
                if byte == 13 {
                    state = .lf
                    return true
                }
                return false
            case .lf:
                if byte == 10 {
                    state = .size
                    return true
                }
                return false
            }
        }
    }
}
