import AVFoundation
import AVKit
import UIKit

// =====================================================================
// [BinTV build 231 — 2026-09-13] NATIVE PLAYER CHO TAB PHIM (iOS)
//
// VẤN ĐỀ (đúng triệu chứng trên máy thật):
//   Tab PHIM chạy web app (app.js) trong WKWebView. Khi bấm thẻ phim,
//   app.js phát bằng thẻ <video> HTML5. Nhiều nguồn Stremio addon
//   (vnstream, viptorrent, vimo, sc.k-20…) trả về container MKV hoặc
//   audio AC3/EAC3/DTS — WebKit KHÔNG giải mã được → video.onerror →
//   app.js hết nguồn dự phòng → hiện "Không thể phát nguồn phim này
//   trên TV" (nhánh fallback dành cho TV/player ngoài của bản Android/
//   Tizen) và KHÔNG phát gì cả. Trên Android/Windows/Tizen cùng nguồn
//   đó phát bình thường vì engine media của các nền tảng kia rộng hơn.
//
// CÁCH SỬA (không né nguồn, không đổi URL gốc, không phá bản Android):
//   JS bắt đúng lúc phát (và lúc lỗi) → gửi `streamUrl` sang Swift qua
//   WKScriptMessageHandler `playVideoNative` → controller NÀY mở
//   AVPlayerViewController (trình phát GỐC của iOS — cùng loại với tab
//   LIVE TV/TUBE) và phát bằng AVFoundation, engine giải mã rộng hơn
//   HTML5 của WebKit (HLS/MP4/MOV + AC3/EAC3 passthrough…).
//
// ĐIỂM KỸ THUẬT ĐÁNG CHÚ Ý:
//   1. HAI ỨNG VIÊN CHO MỘT NGUỒN, THỬ LẦN LƯỢT — không bỏ cuộc sau 1 lần:
//        • `direct` : URL GỐC của addon. AVPlayer tự gửi Range, phát
//          progressive ngay từ byte đầu (seek được).
//        • `proxy`  : URL bọc qua /proxy của PhimLocalServer (127.0.0.1) —
//          forward Referer/User-Agent, resolve DoH, và đi đường RawHttp
//          cho http:// (không bị ATS chặn). Proxy REWRITE playlist m3u8
//          nên HLS bắt buộc nên thử đường này.
//      Thứ tự chọn theo loại nguồn: HLS → proxy trước (playlist đã được
//      rewrite con trỏ segment); progressive (mp4/mkv/…) → direct trước
//      (proxy tải TOÀN BỘ file rồi mới trả lời nên file lớn sẽ chờ lâu).
//      Ứng viên 1 fail (item.status == .failed hoặc hết 20s) → swap sang
//      ứng viên 2 NGAY TRÊN CÙNG MỘT AVPlayerViewController: không nhấp
//      nháy, không present lại.
//   2. KHÔNG LOOP VÔ HẠN: hết ứng viên → báo JS (`onFailure`) + tự đóng
//      player, để app.js thử nguồn stream kế tiếp của addon hoặc hiện
//      thông báo THẬT (không bao giờ giả vờ đang phát).
//   3. SESSION TOKEN: mọi callback trả về JS kèm `session` của yêu cầu —
//      JS bỏ qua callback cũ (người dùng đã bấm phim khác trong lúc chờ).
//   4. Toàn bộ log đi qua PhimDebugLog theo format chuẩn của repo
//      `[PHIM_DEBUG] Step -> Action -> Status -> Payload` (URL đã che
//      token) → xem trong Files > On My iPhone > BinTV > phim_debug.log.
//
// KHÔNG DÙNG LẠI AVPlayerManager (cùng thư mục) vì manager đó phục vụ
// LIVE TV (1 URL, trạng thái @Published cho SwiftUI, không có cơ chế thử
// nhiều ứng viên / không tự present). Giữ 2 file độc lập để KHÔNG đụng
// vào hành vi LIVE TV đang chạy tốt.
// =====================================================================

/// Một yêu cầu phát phim từ web app (JS → Swift, message `playVideoNative`).
struct PhimNativePlaybackRequest {
    /// URL GỐC của stream do addon trả về (chưa bọc proxy) — `streamUrl`.
    let url: String
    /// URL đã bọc qua `/proxy` của server nội bộ (Referer/UA/DoH/ATS-safe).
    let proxyURL: String
    /// Tên phim / tập — dùng cho tiêu đề + log.
    let title: String
    /// Referer gốc (behaviorHints.headers.Referer) nếu addon khai báo.
    let referer: String
    /// Lý do web app chuyển sang native (`unsupported-container`,
    /// `playback-error`, `ios-fallback-error`…) — chỉ dùng để log/chẩn đoán.
    let reason: String
    /// Id phiên phát của web app — echo NGUYÊN VẸN về JS để JS loại bỏ
    /// callback cũ (chống race khi người dùng đã chuyển phim/tập khác).
    let session: String

    /// Tiêu đề rút gọn cho log (không bao giờ log full URL chưa sanitize).
    var logTitle: String { title.isEmpty ? "Phim" : title }
}

/// Trình phát GỐC của iOS cho tab PHIM: nhận `streamUrl` từ `PhimWebView`
/// (WKScriptMessageHandler) rồi mở `AVPlayerViewController` và phát.
final class PhimNativePlayerController: NSObject, AVPlayerViewControllerDelegate {

    // -----------------------------------------------------------------
    // Callback về PhimWebView (được nối vào webView.evaluateJavaScript).
    // -----------------------------------------------------------------
    /// Native đã bắt đầu phát thành công.
    var onStarted: ((PhimNativePlaybackRequest) -> Void)?
    /// Native KHÔNG phát được (đã thử hết mọi ứng viên) — JS thử nguồn khác.
    var onFailure: ((PhimNativePlaybackRequest, String) -> Void)?
    /// Người dùng ĐÓNG player (nút Done / vuốt xuống) — JS dọn UI web.
    var onClosed: ((PhimNativePlaybackRequest) -> Void)?

    /// Một ứng viên URL (direct hoặc proxy).
    private struct Candidate {
        let url: URL
        let label: String
    }

    private var request: PhimNativePlaybackRequest?
    private var candidates: [Candidate] = []
    private var candidateIndex = 0
    private var player: AVPlayer?
    private var playerController: AVPlayerViewController?

    private var statusObservation: NSKeyValueObservation?
    private var stallObserver: NSObjectProtocol?
    private var timeoutWork: DispatchWorkItem?

    /// Đã báo "bắt đầu phát" cho JS (chỉ 1 lần / phiên).
    private var startedReported = false
    /// Đã báo "thất bại" cho JS (chỉ 1 lần / phiên) — chặn double callback.
    private var failureReported = false
    /// Chủ động đóng (không phải người dùng đóng) → KHÔNG bắn onClosed.
    private var dismissingByFailure = false
    /// Giữ màn hình sáng trong lúc phát (như FLAG_KEEP_SCREEN_ON).
    private var idleTimerWasDisabled = false

    /// Thời gian chờ tối đa cho MỘT ứng viên trước khi coi như fail.
    private static let candidateTimeout: TimeInterval = 20

    /// Player native đang hiện trên màn hình?
    var isPresented: Bool { playerController != nil }

    // =================================================================
    // PUBLIC API — PhimWebView gọi từ userContentController(_:didReceive:)
    // =================================================================

    /// Mở trình phát native cho một yêu cầu từ JS. Gọi trên main thread
    /// (message handler của WKWebView luôn chạy trên main).
    func play(_ request: PhimNativePlaybackRequest) {
        let isSameSession = (self.request?.session == request.session)
            && (self.request?.url == request.url)
        // Cùng một nguồn, đang phát → KHÔNG restart (JS có thể gửi lại khi
        // người dùng bấm lần nữa). Khác nguồn/tập → nạp nguồn mới.
        if isSameSession, isPresented, startedReported {
            PhimDebugLog.step("NATIVE", "play", "ignored",
                               "đang phát đúng nguồn này rồi — session=\(request.session)")
            return
        }

        PhimDebugLog.step("NATIVE", "play", "begin",
                          "title=\(request.logTitle) reason=\(request.reason) session=\(request.session) "
                          + "url=\(PhimDebugLog.sanitizeURL(request.url)) "
                          + "proxy=\(PhimDebugLog.sanitizeURL(request.proxyURL))")

        teardownCurrentItem()
        failureReported = false
        startedReported = false
        dismissingByFailure = false
        self.request = request
        candidates = Self.makeCandidates(for: request)
        candidateIndex = 0

        guard !candidates.isEmpty else {
            PhimDebugLog.step("NATIVE", "play", "FAIL", "không có URL http/https hợp lệ để phát")
            failureReported = true
            onFailure?(request, "URL nguồn không hợp lệ (không phải http/https)")
            return
        }

        configureAudioSession()
        // Tạo AVPlayer TRƯỚC khi present để AVPlayerViewController không bao
        // giờ ở trạng thái player == nil (màn hình đen không điều khiển).
        if player == nil { player = AVPlayer() }
        presentPlayerIfNeeded()
        loadCandidate(0)
    }

    /// Dừng + đóng player (JS gọi khi người dùng đóng player web, đổi tab…).
    func stop() {
        guard isPresented || player != nil else { return }
        PhimDebugLog.step("NATIVE", "stop", "ok",
                          "session=\(request?.session ?? "-") title=\(request?.logTitle ?? "-")")
        teardownCurrentItem()
        request = nil
        dismissingByFailure = true      // stop chủ động → không bắn onClosed
        dismissPlayerController { [weak self] in
            self?.dismissingByFailure = false
        }
    }

    // =================================================================
    // ỨNG VIÊN URL — direct (URL gốc) + proxy (server nội bộ 127.0.0.1)
    // =================================================================

    private static func makeCandidates(for request: PhimNativePlaybackRequest) -> [Candidate] {
        var out: [Candidate] = []
        var seen: [String] = []

        func add(_ raw: String, _ label: String) {
            let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            guard !seen.contains(text) else { return }
            guard let url = URL(string: text) else {
                PhimDebugLog.step("NATIVE", "candidate-\(label)", "SKIP", "URL không parse được")
                return
            }
            let scheme = (url.scheme ?? "").lowercased()
            guard scheme == "http" || scheme == "https" else {
                PhimDebugLog.step("NATIVE", "candidate-\(label)", "SKIP",
                                  "scheme không hỗ trợ: \(scheme.isEmpty ? "-" : scheme)")
                return
            }
            seen.append(text)
            out.append(Candidate(url: url, label: label))
        }

        let isHLS = looksLikeHLS(request.url) || looksLikeHLS(request.proxyURL)
        if isHLS {
            // HLS: proxy TRƯỚC — PhimLocalServer rewrite URI con trong playlist
            // (kể cả segment/key) và forward Referer/UA + DoH + RawHttp(http).
            add(request.proxyURL, "proxy")
            add(request.url, "direct")
        } else {
            // Progressive (mp4/mkv/m4v/ts…): DIRECT TRƯỚC — AVPlayer gửi Range
            // và phát ngay từ byte đầu; proxy phải tải hết file mới trả lời.
            add(request.url, "direct")
            add(request.proxyURL, "proxy")
        }
        PhimDebugLog.step("NATIVE", "candidates", "ok",
                          "hls=\(isHLS ? "Y" : "N") order=" + out.map { $0.label }.joined(separator: ","))
        return out
    }

    /// Nguồn HLS? (đuôi .m3u8, kể cả khi đã percent-encode bên trong /proxy).
    private static func looksLikeHLS(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        return text.range(of: "m3u8", options: .caseInsensitive) != nil
    }

    // =================================================================
    // NẠP / THỬ TỪNG ỨNG VIÊN
    // =================================================================

    private func loadCandidate(_ index: Int) {
        guard let current = request else { return }
        guard index < candidates.count else {
            reportFailure("đã thử hết \(candidates.count) đường (direct/proxy) mà AVPlayer vẫn không phát được")
            return
        }
        candidateIndex = index
        let candidate = candidates[index]
        PhimDebugLog.step("NATIVE", "load-\(candidate.label)", "begin",
                          "(\(index + 1)/\(candidates.count)) title=\(current.logTitle) "
                          + "url=\(PhimDebugLog.sanitizeURL(candidate.url.absoluteString))")

        let item = AVPlayerItem(url: candidate.url)
        let activePlayer = player ?? AVPlayer()
        player = activePlayer
        activePlayer.pause()

        // Gắn observer cho item MỚI (observer cũ tự invalidate khi bị gán lại).
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] observed, _ in
            DispatchQueue.main.async {
                guard let self = self, self.currentItemIs(observed) else { return }
                switch observed.status {
                case .readyToPlay:
                    self.handleReadyToPlay(candidate: candidate)
                case .failed:
                    let message = observed.error?.localizedDescription ?? "AVPlayerItem failed"
                    let code = (observed.error as? NSError)?.code ?? 0
                    PhimDebugLog.step("NATIVE", "item-\(candidate.label)", "FAIL",
                                      "code=\(code) \(message)")
                    self.advanceToNextCandidate()
                case .unknown:
                    break                                   // vẫn đang mở
                @unknown default:
                    break
                }
            }
        }

        // Buffer dài bất thường (nguồn chậm / proxy đang tải) → log để chẩn đoán.
        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main
        ) { [weak self] _ in
            guard let self = self, let req = self.request else { return }
            PhimDebugLog.step("NATIVE", "stalled", "warn",
                              "session=\(req.session) candidate=\(candidate.label) — đang buffer, chờ tiếp")
        }

        activePlayer.replaceCurrentItem(with: item)
        // play() trước khi ready là HỢP LỆ: AVPlayer tự phát khi item sẵn sàng.
        activePlayer.play()
        armCandidateTimeout(candidate)
    }

    private func currentItemIs(_ item: AVPlayerItem) -> Bool {
        return player?.currentItem === item
    }

    private func handleReadyToPlay(candidate: Candidate) {
        timeoutWork?.cancel()
        timeoutWork = nil
        player?.play()
        PhimDebugLog.step("NATIVE", "playing-\(candidate.label)", "ok",
                          "title=\(request?.logTitle ?? "-") session=\(request?.session ?? "-")")
        playerController?.player = player
        if !startedReported {
            startedReported = true
            if let current = request { onStarted?(current) }
        }
    }

    /// Ứng viên hiện tại fail → thử ứng viên kế tiếp (swap item, giữ nguyên
    /// AVPlayerViewController đang present → không nhấp nháy màn hình).
    private func advanceToNextCandidate() {
        timeoutWork?.cancel()
        timeoutWork = nil
        statusObservation = nil
        removeStallObserver()
        loadCandidate(candidateIndex + 1)
    }

    private func armCandidateTimeout(_ candidate: Candidate) {
        timeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            guard let item = self.player?.currentItem else { return }
            // Đã phát được rồi → không phải timeout.
            if item.status == .readyToPlay && (self.player?.rate ?? 0) > 0 { return }
            PhimDebugLog.step("NATIVE", "timeout-\(candidate.label)", "FAIL",
                              "\(Int(Self.candidateTimeout))s không readyToPlay")
            self.advanceToNextCandidate()
        }
        timeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.candidateTimeout, execute: work)
    }

    // =================================================================
    // THẤT BẠI CUỐI CÙNG → báo JS (để app.js thử nguồn addon kế tiếp /
    // hiện thông báo THẬT) + tự đóng player (không để người dùng nhìn màn đen).
    // =================================================================

    private func reportFailure(_ message: String) {
        guard !failureReported else { return }
        failureReported = true
        timeoutWork?.cancel()
        timeoutWork = nil
        PhimDebugLog.step("NATIVE", "play", "FAIL", message)
        let current = request
        teardownCurrentItem()
        dismissingByFailure = true      // đóng do lỗi → KHÔNG bắn onClosed
        dismissPlayerController { [weak self] in
            guard let self = self else { return }
            self.dismissingByFailure = false
            self.request = nil
            if let current = current { self.onFailure?(current, message) }
        }
    }

    // =================================================================
    // PRESENT / DISMISS (UIKit — tìm VC trên cùng để present)
    // =================================================================

    private func presentPlayerIfNeeded() {
        if playerController != nil { return }
        guard let host = Self.topViewController() else {
            PhimDebugLog.step("NATIVE", "present", "FAIL", "không tìm được UIViewController để present")
            return
        }
        let controller = AVPlayerViewController()
        controller.player = player
        controller.delegate = self
        controller.videoGravity = .resizeAspect
        controller.allowsPictureInPicturePlayback = true
        controller.modalPresentationStyle = .fullScreen
        controller.view.backgroundColor = .black
        playerController = controller

        // Giữ màn hình sáng khi xem phim (phục hồi trạng thái cũ khi đóng).
        idleTimerWasDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true

        host.present(controller, animated: true) {
            PhimDebugLog.step("NATIVE", "present", "ok",
                              "AVPlayerViewController trên \(type(of: host))")
        }
    }

    private func dismissPlayerController(completion: (() -> Void)? = nil) {
        guard let controller = playerController else {
            playerController = nil
            completion?()
            return
        }
        playerController = nil
        UIApplication.shared.isIdleTimerDisabled = idleTimerWasDisabled
        controller.delegate = nil
        controller.player = nil
        // Đang present → dismiss đúng cách; chưa present xong (race) → vẫn gọi
        // dismiss trên VC cha nếu có, rồi chạy completion.
        if controller.presentingViewController != nil {
            controller.dismiss(animated: true) { completion?() }
        } else {
            completion?()
        }
    }

    /// VC trên cùng của window đang active — nơi present player native.
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var window: UIWindow?
        for scene in scenes where scene.activationState == .foregroundActive {
            if let key = scene.windows.first(where: { $0.isKeyWindow }) { window = key; break }
        }
        if window == nil {
            for scene in scenes {
                if let key = scene.windows.first(where: { $0.isKeyWindow }) { window = key; break }
            }
        }
        if window == nil { window = scenes.first?.windows.first }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    // MARK: - AVPlayerViewControllerDelegate

    /// Người dùng bấm Done / vuốt đóng player → dọn + báo JS.
    func playerViewControllerDidDismissViewController(_ playerViewController: AVPlayerViewController) {
        PhimDebugLog.step("NATIVE", "dismissed", "ok",
                          "session=\(request?.session ?? "-") title=\(request?.logTitle ?? "-")")
        let current = request
        teardownCurrentItem()
        playerController = nil
        UIApplication.shared.isIdleTimerDisabled = idleTimerWasDisabled
        // Đóng do lỗi (reportFailure tự dismiss) → JS ĐÃ được báo failure,
        // KHÔNG bắn thêm onClosed (JS vừa thử nguồn kế tiếp sẽ bị dọn oan).
        guard !dismissingByFailure else { return }
        request = nil
        if let current = current { onClosed?(current) }
    }

    /// AVKit pause player khi đổi chế độ trình bày (fullscreen) → phát lại.
    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willBeginFullScreenPresentationWithAnimationCoordinator
                              coordinator: UIViewControllerTransitionCoordinator) {
        let wasPlaying = (playerViewController.player?.rate ?? 0) > 0
        coordinator.animate(alongsideTransition: nil) { context in
            guard !context.isCancelled, wasPlaying else { return }
            playerViewController.player?.play()
        }
    }

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator
                              coordinator: UIViewControllerTransitionCoordinator) {
        let wasPlaying = (playerViewController.player?.rate ?? 0) > 0
        coordinator.animate(alongsideTransition: nil) { context in
            guard !context.isCancelled, wasPlaying else { return }
            playerViewController.player?.play()
        }
    }

    func playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(
        _ playerViewController: AVPlayerViewController) -> Bool {
        return false        // PiP: giữ player inline (đóng = đen hình còn tiếng)
    }

    // =================================================================
    // DỌN
    // =================================================================

    private func teardownCurrentItem() {
        timeoutWork?.cancel()
        timeoutWork = nil
        statusObservation = nil
        removeStallObserver()
        if let player = player {
            player.pause()
            player.replaceCurrentItem(with: nil)
        }
    }

    private func removeStallObserver() {
        if let observer = stallObserver {
            NotificationCenter.default.removeObserver(observer)
            stallObserver = nil
        }
    }

    /// AVAudioSession .playback — phim có tiếng kể cả khi công tắc chuông
    /// đang ở chế độ im lặng (cùng category với LIVE TV/PHIM webview).
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setActive(true)
    }

    deinit {
        timeoutWork?.cancel()
        statusObservation = nil
        if let observer = stallObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
