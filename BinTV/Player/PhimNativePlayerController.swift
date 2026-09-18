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
//
// [build 234 — 2026-09-15] ƯU TIÊN TRÌNH PHÁT (thay đổi quan trọng):
//   * Trình phát TÍCH HỢP của app (thẻ <video> trong web app PHIM) LUÔN
//     được thử TRƯỚC. Controller này chỉ được gọi khi trình phát tích hợp
//     KHÔNG THỂ phát (không nguồn tương thích / không mở được video / hết
//     nguồn dự phòng) — bỏ hẳn pre-flight handoff của build 231–233.
//   * Gesture điều hướng trong trình phát iOS: vuốt NGANG ở cạnh trái/phải
//     = TUA (như kéo thanh tiến trình, KHÔNG Return); vuốt từ TRÊN xuống =
//     RETURN (đóng trình phát, web app quay về màn hình trước khi phát) —
//     xem `registerGestureContext()` + `closeByUserGesture()`.
//
// [build 233 — 2026-09-14] LUỒNG KẾT THÚC PHÁT:
//   * Phim BỘ: tập phát hết → trình phát ĐÓNG rồi JS tự động nạp & phát tập
//     tiếp theo (build 234: tập kế phát bằng trình phát tích hợp); người
//     dùng đóng player → JS quay về giao diện CHỌN TẬP.
//   * Phim LẺ: phát hết hoặc đóng → JS quay về giao diện PHIM (lưới phim).
//   * CHỐNG TREO: observer DidPlayToEndTime bắn onEnded cho JS; JS có
//     endedGraceTimeout (10s, hoặc 45s khi đã báo prepareNext) để trả lời
//     — im lặng quá hạn → TỰ ĐÓNG player + bắn onClosed. Trình phát không
//     bao giờ đứng yên bắt buộc tắt cả app.
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
    /// Vị trí đã được state contract của PHIM lưu trước lifecycle recovery.
    /// Nil/0 nghĩa là bắt đầu như một yêu cầu phát mới.
    let resumePosition: TimeInterval?
    /// `true` khi người dùng đã tạm dừng trước lúc WebView bị thay thế.
    let resumePaused: Bool

    /// Tiêu đề rút gọn cho log (không bao giờ log full URL chưa sanitize).
    var logTitle: String { title.isEmpty ? "Phim" : title }
}

/// Một câu phụ đề (đã parse từ SRT/VTT phía app.js) — hiển thị ĐỒNG BỘ với
/// thời gian phát của AVPlayer trong trình phát native (build 232).
struct NativeSubtitleCue {
    /// Thời điểm bắt đầu hiển thị (giây).
    let start: TimeInterval
    /// Thời điểm kết thúc hiển thị (giây).
    let end: TimeInterval
    /// Nội dung câu phụ đề (đã strip tag HTML phía app.js).
    let text: String
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
    /// [build 233] Item phát HẾT (DidPlayToEndTime) — JS quyết định: phim bộ
    /// còn tập → tự nạp tập tiếp theo (gửi lại play()); hết tập / phim lẻ →
    /// gửi stop() để đóng player. Nếu JS im lặng, backstop tự ĐÓNG player
    /// (không bao giờ để trình phát treo bắt buộc tắt cả app BinTV).
    var onEnded: ((PhimNativePlaybackRequest) -> Void)?
    /// [build 236] Người dùng chọn tập từ overlay native (không thoát player).
    var onSelectEpisode: ((Int, String) -> Void)?
    /// WebView vừa được tái tạo nhưng player native vẫn sống. Host dùng callback
    /// này để đồng bộ lại lớp UI JS, không phát lại/khởi tạo nguồn thứ hai.
    var onStateReconciled: ((PhimNativePlaybackRequest, TimeInterval, Bool) -> Void)?

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
    /// [build 233] Observer DidPlayToEndTime của item hiện tại.
    private var endObserver: NSObjectProtocol?
    private var timeoutWork: DispatchWorkItem?
    /// [build 233] Backstop sau khi phát HẾT: JS im lặng quá lâu → tự đóng.
    private var endedGraceWork: DispatchWorkItem?
    /// [build 233] Đang chờ JS quyết định sau khi phát hết (next-tập/đóng).
    private var waitingForNextInstruction = false
    private var pendingInitialSeek: CMTime?
    private var shouldPlayWhenReady = true
    private var lifecycleIsSuspended = false
    private var lifecycleResumeRate: Float = 0
    private var lifecycleGeneration = 0

    /// Đã báo "bắt đầu phát" cho JS (chỉ 1 lần / phiên).
    private var startedReported = false
    /// Đã báo "thất bại" cho JS (chỉ 1 lần / phiên) — chặn double callback.
    private var failureReported = false
    /// Chủ động đóng (không phải người dùng đóng) → KHÔNG bắn onClosed.
    private var dismissingByFailure = false
    /// Giữ màn hình sáng trong lúc phát (như FLAG_KEEP_SCREEN_ON).
    private var idleTimerWasDisabled = false

    // =================================================================
    // [build 232] PHỤ ĐỀ TRONG TRÌNH PHÁT NATIVE — app.js đã parse SRT/VTT
    // và gửi danh sách cue qua message `playVideoNative` (action=subtitles).
    // Hiển thị bằng UILabel đặt trên contentOverlayView của
    // AVPlayerViewController, đồng bộ theo currentTime (periodic observer).
    // =================================================================
    private var subtitleCues: [NativeSubtitleCue] = []
    private var subtitleLabel: UILabel?
    private var subtitleTimeObserver: Any?

    private struct NativeEpisodeItem {
        let id: String
        let title: String
    }
    private var episodeItems: [NativeEpisodeItem] = []
    private var currentEpisodeIndex: Int = -1
    // [build 242 — 2026-09-15] ĐÃ GỠ nút "Tập" (UIButton) treo trên
    // contentOverlayView của AVPlayerViewController: trình phát iOS phải giữ
    // NGUYÊN giao diện mặc định, KHÔNG có nút TẬP/tiêu đề nào vẽ đè lên video.
    // Danh sách tập CHỈ mở từ nút TẬP của menu long-press (`requestEpisodePicker`
    // → `showEpisodePicker`). `episodeItems`/`currentEpisodeIndex` vẫn được giữ
    // vì menu cần biết phim có ≥2 tập hay không và panel cần tô tập hiện tại.
    private var episodePickerView: UIView?

    /// Thời gian chờ tối đa cho MỘT ứng viên trước khi coi như fail.
    private static let candidateTimeout: TimeInterval = 20
    /// [build 233] Sau khi phát HẾT: chờ JS quyết định (next-tập/đóng) tối đa
    /// 10s; khi JS báo "đang nạp tập mới" (prepareNext) thì nới lên 45s — cả
    /// hai đều tự ĐÓNG player khi hết hạn để chống treo tuyệt đối.
    private static let endedGraceTimeout: TimeInterval = 10
    private static let prepareNextTimeout: TimeInterval = 45

    /// Player native đang hiện trên màn hình?
    var isPresented: Bool { playerController != nil }

    // =================================================================
    // [build 234 — 2026-09-15] GESTURE ĐIỀU HƯỚNG TRONG TRÌNH PHÁT iOS
    //
    // Gesture (vuốt ngang cạnh = TUA, vuốt từ trên xuống = RETURN/đóng) nằm
    // ở `BinTVWindowGestures` trên UIWindow (xem ContentView.swift) và đọc
    // "ngữ cảnh trình phát" đăng ký ở đây:
    //   • isActive → AVPlayerViewController đang được present;
    //   • position/duration → đọc TRỰC TIẾP từ AVPlayer (đồng bộ, không cần
    //     chờ callback);
    //   • seekTo → seek như kéo thanh tiến trình, GIỮ NGUYÊN trạng thái
    //     phát/tạm dừng;
    //   • close → RETURN: đóng player + báo JS (onClosed) để web app quay về
    //     màn hình trước khi phát (giống hệt bấm Done).
    // Không đụng gì tới LIVE TV (AVPlayerManager) — chỉ trình phát của PHIM.
    // =================================================================
    override init() {
        super.init()
        registerGestureContext()
        registerPlayerMenuContext()
    }

    private func registerGestureContext() {
        BinTVPlayerGestureHub.shared.register(BinTVPlayerGestureContext(
            name: "ios-native-player",
            isNative: true,
            isActive: { [weak self] in self?.isPresented ?? false },
            position: { [weak self] in
                guard let time = self?.player?.currentTime(), time.isNumeric else { return 0 }
                return max(0, time.seconds)
            },
            duration: { [weak self] in
                guard let duration = self?.player?.currentItem?.duration,
                      duration.isNumeric, duration.seconds > 0 else { return 0 }
                return duration.seconds
            },
            beginSeek: { [weak self] in
                // AVKit tự hiện thanh điều khiển khi chạm; chỉ cần log + rung
                // nhẹ để người dùng biết đã vào chế độ TUA (không Return).
                PhimDebugLog.step("GESTURE", "nativeSeek", "begin",
                                  "session=\(self?.request?.session ?? "-")")
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            },
            seekTo: { [weak self] seconds in
                guard let self = self,
                      let player = self.player,
                      player.currentItem != nil else { return }
                let target = max(0, seconds)
                let wasPlaying = player.rate > 0
                let time = CMTime(seconds: target, preferredTimescale: 600)
                let generation = self.lifecycleGeneration
                let item = player.currentItem
                player.seek(to: time,
                            toleranceBefore: CMTime(seconds: 0.25, preferredTimescale: 600),
                            toleranceAfter: CMTime(seconds: 0.25, preferredTimescale: 600)) { _ in
                    // Chỉ tự phát lại nếu TRƯỚC ĐÓ đang phát (người dùng đang
                    // tạm dừng thì tua xong vẫn tạm dừng).
                    guard wasPlaying, !self.waitingForNextInstruction,
                          !self.lifecycleIsSuspended,
                          self.lifecycleGeneration == generation,
                          UIApplication.shared.applicationState == .active,
                          self.player === player, player.currentItem === item else { return }
                    player.play()
                }
                PhimDebugLog.step("GESTURE", "nativeSeek", "go",
                                  "target=\(Int(target.rounded()))s wasPlaying=\(wasPlaying)")
            },
            endSeek: { [weak self] in
                PhimDebugLog.step("GESTURE", "nativeSeek", "end",
                                  "session=\(self?.request?.session ?? "-")")
            },
            close: { [weak self] in
                self?.closeByUserGesture()
            }))
    }

    // =================================================================
    // [build 241] NGỮ CẢNH MENU LONG-PRESS TRONG PLAYER PHIM (native)
    //
    // Giữ màn hình khi AVPlayerViewController PHIM đang phủ toàn màn hình
    // → menu 5 nút (LIVE TV/TUBE/SETTING/TẬP/BACK) với phim bộ nhiều tập,
    // 4 nút (bỏ TẬP) với phim lẻ. TẬP dùng lại picker overlay sẵn có
    // (danh sách tập do app.js đẩy qua action "episodes"); BACK đóng player
    // đúng MỘT lớp (web app quay về chọn tập / lưới PHIM); chọn module khác
    // cũng đi đường đóng player này rồi ContentView mới đổi trang.
    // Ưu tiên 100: player native phủ trên MỌI thứ nên được chọn trước.
    // =================================================================
    private func registerPlayerMenuContext() {
        BinTVPlayerMenuCenter.shared.register(BinTVPlayerMenuContext(
            id: "phim-native",
            priority: 100,
            isActive: { [weak self] in self?.isPresented ?? false },
            kind: { [weak self] in
                .phim(episodes: (self?.episodeItems.count ?? 0) >= 2)
            },
            onBack: { [weak self] in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self?.backOneLayerInPlayer()
            },
            onOpenEpisodes: { [weak self] in
                self?.requestEpisodePicker()
            },
            onLeaveToOtherTab: { [weak self] in
                self?.closeByUserGesture()
            }))
    }

    /// [build 241] Mở danh sách tập từ nút TẬP của menu long-press — chỉ
    /// với phim bộ (≥2 tập); danh sách đã được app.js đẩy khi bắt đầu phát.
    func requestEpisodePicker() {
        guard isPresented, episodeItems.count >= 2 else { return }
        PhimDebugLog.step("MENU", "nativeEpisodes", "go",
                          "count=\(episodeItems.count) current=\(currentEpisodeIndex)")
        showEpisodePicker()
    }

    /// [build 241] BACK đúng MỘT lớp trong player iOS: đang mở panel danh
    /// sách tập → chỉ đóng panel; player đang phát → đóng player (web app
    /// quay về chọn tập / lưới PHIM).
    private func backOneLayerInPlayer() {
        if episodePickerView != nil {
            PhimDebugLog.step("MENU", "nativeBack", "go", "đóng panel danh sách tập")
            hideEpisodePicker()
            return
        }
        closeByUserGesture()
    }

    /// [build 234] RETURN bằng gesture: người dùng vuốt từ TRÊN xuống trong
    /// trình phát iOS → ĐÓNG player và báo JS (`onClosed`) để web app quay về
    /// màn hình trước khi phát. Tương đương bấm nút Done của AVKit (cùng một
    /// đường callback, không sinh 2 lần thông báo).
    func closeByUserGesture() {
        guard isPresented || player != nil else { return }
        PhimDebugLog.step("GESTURE", "nativeClose", "go",
                          "reason=swipe-down session=\(request?.session ?? "-")")
        let closed = request
        teardownCurrentItem()
        request = nil
        dismissingByFailure = true      // chặn delegate bắn onClosed lần thứ hai
        dismissPlayerController { [weak self] in
            guard let self = self else { return }
            self.dismissingByFailure = false
            if let closed = closed { self.onClosed?(closed) }
        }
    }

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
        let requestedPosition = request.resumePosition ?? 0
        pendingInitialSeek = requestedPosition > 0
            ? CMTime(seconds: requestedPosition, preferredTimescale: 600)
            : nil
        shouldPlayWhenReady = !request.resumePaused
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

    // MARK: - Application lifecycle / WebView state reconciliation

    /// Retain the existing AVPlayer, item and fullscreen controller. Snapshot
    /// once across app/scene notifications, before pausing for suspension.
    func applicationWillResignActive() {
        guard !lifecycleIsSuspended,
              let player = player, player.currentItem != nil else { return }
        lifecycleIsSuspended = true
        lifecycleGeneration += 1
        lifecycleResumeRate = player.rate > 0 ? player.rate
            : (player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? 1 : 0)
        shouldPlayWhenReady = lifecycleResumeRate > 0
        if lifecycleResumeRate > 0 { player.pause() }
        PhimDebugLog.step("NATIVE", "willResignActive", "retained",
                          "session=\(request?.session ?? "-") resumeRate=\(lifecycleResumeRate) fullscreen=\(isPresented)")
    }

    func applicationDidEnterBackground() {
        applicationWillResignActive() // idempotent, including scene-only delivery
        guard player?.currentItem != nil else { return }
        PhimDebugLog.step("NATIVE", "didEnterBackground", "held",
                          "session=\(request?.session ?? "-")")
    }

    /// No seek, delayed play, re-presentation, gravity or controls assignment.
    /// The retained item is already at the paused position. A paused snapshot
    /// requires NO player mutation; a playing snapshot resumes at its old rate.
    func applicationDidBecomeActive() {
        guard lifecycleIsSuspended,
              UIApplication.shared.applicationState == .active else { return }
        let resumeRate = lifecycleResumeRate
        lifecycleIsSuspended = false
        lifecycleResumeRate = 0
        guard resumeRate > 0, let player = player,
              player.currentItem != nil else { return }
        player.rate = resumeRate
        PhimDebugLog.step("NATIVE", "didBecomeActive", "retained",
                          "session=\(request?.session ?? "-") resumeRate=\(resumeRate) fullscreen=\(isPresented)")
    }

    /// A recreated WKWebView has no memory of the AVPlayer overlay. Re-emit a
    /// state-only callback rather than calling `play` again, so there is one
    /// source, one AVPlayer, and one presentation controller.
    func reconcileWebAppState() {
        guard let current = request, isPresented, let player = player else { return }
        let seconds = player.currentTime().isNumeric ? max(0, player.currentTime().seconds) : 0
        let paused = player.rate <= 0 && player.timeControlStatus == .paused
        PhimDebugLog.step("NATIVE", "reconcileWebState", "ok",
                          "session=\(current.session) positionMs=\(Int(seconds * 1000)) paused=\(paused)")
        onStateReconciled?(current, seconds, paused)
    }

    /// Cập nhật phụ đề cho phiên phát ĐANG CHẠY (app.js gửi khi bật/tắt
    /// Vietsub, hoặc ngay khi native bắt đầu phát). `cues` rỗng = tắt phụ đề.
    /// Gọi trên main thread.
    func updateSubtitles(_ cues: [NativeSubtitleCue], label: String, session: String) {
        // Chống race: app.js tải phụ đề bất đồng bộ — nếu người dùng đã
        // chuyển phim/tập khác (session đổi) thì bỏ qua, không đè phụ đề
        // của phim mới bằng phụ đề cũ.
        guard let current = request, session.isEmpty || current.session == session else {
            PhimDebugLog.step("NATIVE", "subtitles", "ignored",
                              "session lệch — bỏ qua (session=\(session.isEmpty ? "-" : session))")
            return
        }
        PhimDebugLog.step("NATIVE", "subtitles", "begin",
                          "label=\(label) count=\(cues.count) session=\(session.isEmpty ? "-" : session)")
        subtitleCues = cues
        refreshSubtitleOverlay()
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

        // [build 233] Phát HẾT (hết tập / hết phim) → báo JS quyết định:
        // phim bộ còn tập → JS nạp tập kế và gửi play() mới; hết tập / phim
        // lẻ → JS gửi stop(). Kèm backstop tự đóng nếu JS im lặng (chống treo).
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            guard let self = self, self.currentItemIs(item) else { return }
            self.handleItemDidPlayToEnd()
        }

        activePlayer.replaceCurrentItem(with: item)
        // play() trước khi ready là HỢP LỆ: AVPlayer tự phát khi item sẵn sàng.
        // A restored user-paused player deliberately remains paused.
        if shouldPlayWhenReady && !lifecycleIsSuspended { activePlayer.play() } else { activePlayer.pause() }
        armCandidateTimeout(candidate)
    }

    private func currentItemIs(_ item: AVPlayerItem) -> Bool {
        return player?.currentItem === item
    }

    private func handleReadyToPlay(candidate: Candidate) {
        timeoutWork?.cancel()
        timeoutWork = nil
        guard let item = player?.currentItem else { return }
        let seek = pendingInitialSeek
        pendingInitialSeek = nil
        let finish: () -> Void = { [weak self] in
            guard let self = self,
                  self.player?.currentItem === item else { return }
            if self.shouldPlayWhenReady && !self.lifecycleIsSuspended { self.player?.play() } else { self.player?.pause() }
            PhimDebugLog.step("NATIVE", "playing-\(candidate.label)", "ok",
                              "title=\(self.request?.logTitle ?? "-") session=\(self.request?.session ?? "-") "
                              + "resume=\(seek == nil ? "new" : "saved") paused=\(!self.shouldPlayWhenReady)")
            self.playerController?.player = self.player
            // [build 232] Phụ đề có thể đã được đẩy tới TRƯỚC khi player
            // present/ready xong — lúc này mới chắc chắn có contentOverlayView
            // để treo UILabel phụ đề lên.
            self.refreshSubtitleOverlay()
            if !self.startedReported {
                self.startedReported = true
                if let current = self.request { self.onStarted?(current) }
            }
        }
        if let seek = seek, seek.isNumeric, seek.seconds > 0 {
            player?.seek(to: seek, toleranceBefore: .zero, toleranceAfter: .zero) { _ in finish() }
        } else {
            finish()
        }
    }

    /// Ứng viên hiện tại fail → thử ứng viên kế tiếp (swap item, giữ nguyên
    /// AVPlayerViewController đang present → không nhấp nháy màn hình).
    private func advanceToNextCandidate() {
        timeoutWork?.cancel()
        timeoutWork = nil
        statusObservation = nil
        removeStallObserver()
        removeEndObserver()
        loadCandidate(candidateIndex + 1)
    }

    // =================================================================
    // [build 233] PHÁT HẾT TẬP/PHIM — tự chuyển tập (phim bộ) / tự đóng
    // (phim lẻ), kèm backstop chống treo trình phát tuyệt đối.
    //
    // Giao thức với app.js:
    //   1. Item phát hết → bắn onEnded → JS nhận __bintvNativePlaybackEnded.
    //   2. JS quyết định trong endedGraceTimeout (10s):
    //        • Phim bộ còn tập (build 234): JS gọi stop() để ĐÓNG trình phát
    //          rồi tự động nạp & phát tập kế tiếp — không dừng ở màn hình
    //          chọn tập (action "prepareNext" + prepareNextTimeout 45s vẫn
    //          được giữ như API dự phòng cho luồng "giữ player mở").
    //        • Hết tập / phim lẻ: JS gọi stop() → player đóng ngay, UI quay
    //          về giao diện chọn tập (phim bộ) hoặc lưới PHIM (phim lẻ).
    //   3. JS im lặng (WebView chết / kẹt mạng) → backstop TỰ ĐÓNG player và
    //      bắn onClosed như thể người dùng đóng → KHÔNG BAO GIỜ treo đến mức
    //      phải tắt cả app BinTV.
    // =================================================================

    private func handleItemDidPlayToEnd() {
        guard let current = request, !waitingForNextInstruction, !dismissingByFailure else { return }
        waitingForNextInstruction = true
        PhimDebugLog.step("NATIVE", "playToEnd", "ok",
                          "session=\(current.session) title=\(current.logTitle) — chờ JS quyết định (tập tiếp theo / đóng)")
        onEnded?(current)
        armEndedGraceTimer(Self.endedGraceTimeout, stage: "grace")
    }

    /// JS báo "đang nạp tập tiếp theo — GIỮ player mở" (message action
    /// "prepareNext"): huỷ grace ngắn, đặt backstop DÀI hơn trong lúc app.js
    /// hỏi addon lấy stream tập mới. Gọi trên main thread.
    /// [build 236] Đồng bộ danh sách tập + (tuỳ chọn) mở picker trên overlay native.
    /// [build 242] KHÔNG còn vẽ nút "Tập" cố định lên trình phát: hàm này chỉ
    /// cập nhật dữ liệu (menu long-press đọc `episodeItems` để quyết định có
    /// nút TẬP hay không) và đóng/mở PANEL danh sách tập khi được yêu cầu.
    func updateEpisodes(_ items: [(id: String, title: String)], current: Int, showPicker: Bool) {
        episodeItems = items.map { NativeEpisodeItem(id: $0.id, title: $0.title) }
        currentEpisodeIndex = current
        // Phim lẻ / hết danh sách tập → không bao giờ để panel mở sót lại.
        if episodeItems.count < 2 {
            hideEpisodePicker()
            return
        }
        if showPicker { showEpisodePicker() } else { hideEpisodePicker() }
    }

    func hideEpisodePickerOverlay() {
        hideEpisodePicker()
    }

    func prepareNextEpisode() {
        guard waitingForNextInstruction, let current = request else { return }
        PhimDebugLog.step("NATIVE", "prepareNext", "ok",
                          "session=\(current.session) — JS đang nạp tập tiếp theo, giữ player mở")
        armEndedGraceTimer(Self.prepareNextTimeout, stage: "prepareNext")
    }

    private func armEndedGraceTimer(_ timeout: TimeInterval, stage: String) {
        endedGraceWork?.cancel()
        let session = request?.session ?? ""
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.endedGraceWork = nil
            guard self.waitingForNextInstruction,
                  self.request?.session == session else { return }
            // Ngườii dùng tự phát lại (replay) qua điều khiển hệ thống →
            // thoát chế độ chờ, KHÔNG tự đóng.
            if (self.player?.rate ?? 0) > 0 {
                PhimDebugLog.step("NATIVE", "endedWait-\(stage)", "cancel",
                                  "người dùng tự phát lại tập hiện tại")
                self.waitingForNextInstruction = false
                return
            }
            PhimDebugLog.step("NATIVE", "endedWait-\(stage)", "timeout",
                              "\(Int(timeout))s không nhận được lệnh từ JS → tự đóng (chống treo)")
            self.autoCloseAfterEnded()
        }
        endedGraceWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: work)
    }

    /// JS im lặng sau khi phát hết → TỰ ĐÓNG player và bắn onClosed (giống
    /// hệt người dùng bấm Done) để JS dọn UI — bảo đảm không bao giờ treo.
    /// dismissingByFailure = true trong lúc dismiss: nếu hệ thống vẫn gọi
    /// delegate DidDismiss cho dismissal chủ động thì delegate return sớm —
    /// onClosed chỉ bắn ĐÚNG MỘT LẦN (ở completion dưới).
    private func autoCloseAfterEnded() {
        waitingForNextInstruction = false
        endedGraceWork?.cancel()
        endedGraceWork = nil
        let current = request
        teardownCurrentItem()
        request = nil
        dismissingByFailure = true
        dismissPlayerController { [weak self] in
            guard let self = self else { return }
            self.dismissingByFailure = false
            if let current = current { self.onClosed?(current) }
        }
    }

    private func removeEndObserver() {
        if let observer = endObserver {
            NotificationCenter.default.removeObserver(observer)
            endObserver = nil
        }
    }

    private func armCandidateTimeout(_ candidate: Candidate) {
        timeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            guard let item = self.player?.currentItem else { return }
            // Đã phát được rồi → không phải timeout.
            if item.status == .readyToPlay
                && ((self.player?.rate ?? 0) > 0 || !self.shouldPlayWhenReady) { return }
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
        let item = playerViewController.player?.currentItem
        let generation = lifecycleGeneration
        coordinator.animate(alongsideTransition: nil) { [weak self] context in
            guard let self = self, !context.isCancelled, wasPlaying,
                  !self.lifecycleIsSuspended,
                  self.lifecycleGeneration == generation,
                  UIApplication.shared.applicationState == .active,
                  self.playerController === playerViewController,
                  playerViewController.player?.currentItem === item else { return }
            playerViewController.player?.play()
        }
    }

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator
                              coordinator: UIViewControllerTransitionCoordinator) {
        let wasPlaying = (playerViewController.player?.rate ?? 0) > 0
        let item = playerViewController.player?.currentItem
        let generation = lifecycleGeneration
        coordinator.animate(alongsideTransition: nil) { [weak self] context in
            guard let self = self, !context.isCancelled, wasPlaying,
                  !self.lifecycleIsSuspended,
                  self.lifecycleGeneration == generation,
                  UIApplication.shared.applicationState == .active,
                  self.playerController === playerViewController,
                  playerViewController.player?.currentItem === item else { return }
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
        lifecycleIsSuspended = false
        lifecycleResumeRate = 0
        lifecycleGeneration += 1
        pendingInitialSeek = nil
        statusObservation = nil
        removeStallObserver()
        removeEndObserver()
        // [build 233] hạ trạng thái chờ-quyết-định-sau-khi-hết (nếu có)
        endedGraceWork?.cancel()
        endedGraceWork = nil
        waitingForNextInstruction = false
        removeSubtitleOverlay()     // [build 232] dọn phụ đề khi đổi/đóng nguồn
        // [build 245] KHÔNG BAO GIỜ để panel danh sách tập sót lại khi dừng /
        // đổi nguồn / đóng player (panel giờ treo trên view gốc của trình phát
        // nên phải gỡ chủ động — kèm hạ cờ ưu tiên gesture).
        hideEpisodePicker()
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

    // =================================================================
    // [build 232] PHỤ ĐỀ — overlay UILabel + đồng bộ theo thời gian phát
    // =================================================================

    /// Dựng/xoá overlay + observer cho đúng trạng thái phụ đề hiện tại.
    private func refreshSubtitleOverlay() {
        if subtitleCues.isEmpty {
            removeSubtitleOverlay()
            return
        }
        installSubtitleOverlay()
        startSubtitleSync()
        renderSubtitle(at: player?.currentTime().seconds ?? 0)
    }

    /// Treo UILabel phụ đề lên contentOverlayView của AVPlayerViewController
    /// (lớp phủ của HỆ THỐNG → phụ đề hiển thị trên cả khi player fullscreen).
    private func installSubtitleOverlay() {
        guard subtitleLabel == nil else { return }
        guard let controller = playerController,
              let overlay = controller.contentOverlayView else { return }
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = UIFont.systemFont(ofSize: 18, weight: .medium)
        label.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        label.layer.cornerRadius = 4
        label.layer.masksToBounds = true
        label.text = ""
        overlay.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -24),
            label.bottomAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.bottomAnchor, constant: -24)
        ])
        subtitleLabel = label
    }

    /// Quan sát currentTime mỗi 250ms (cùng nhịp app.js dùng cho phụ đề DOM)
    /// để cập nhật câu phụ đề đang chiếu.
    private func startSubtitleSync() {
        guard subtitleTimeObserver == nil, let player = player else { return }
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        subtitleTimeObserver = player.addPeriodicTimeObserver(forInterval: interval,
                                                               queue: .main) { [weak self] time in
            self?.renderSubtitle(at: time.seconds)
        }
    }

    /// Tìm câu phụ đề đang chiếu bằng binary search (mảng cues đã được app.js
    /// sắp theo `start`) — giống renderCurrentMovieSubtitle của app.js.
    private func renderSubtitle(at time: TimeInterval) {
        guard let label = subtitleLabel else { return }
        let cues = subtitleCues
        guard !cues.isEmpty else {
            if label.text != "" { label.text = "" }
            return
        }
        var low = 0
        var high = cues.count - 1
        var candidate = -1
        while low <= high {
            let mid = (low + high) / 2
            if cues[mid].start <= time { candidate = mid; low = mid + 1 }
            else { high = mid - 1 }
        }
        let text: String
        if candidate >= 0 && time <= cues[candidate].end { text = cues[candidate].text }
        else { text = "" }
        if label.text != text { label.text = text }
    }

    // =================================================================
    // [build 242 — 2026-09-15] ĐÃ XOÁ `refreshEpisodesButton()` /
    // `toggleEpisodePicker()` / `removeEpisodesButton()`.
    //
    // Trước đây controller tự vẽ một UIButton "Tập" (nền hồng, góc phải trên)
    // lên `contentOverlayView` của AVPlayerViewController → nút TẬP hiện CỐ
    // ĐỊNH đè lên giao diện trình phát mặc định của iOS. Theo yêu cầu mới,
    // trình phát KHÔNG được có bất kỳ nút TẬP/tiêu đề nào vẽ đè:
    //   • giao diện AVPlayerViewController giữ nguyên 100% mặc định;
    //   • TẬP chỉ còn trong MENU LONG-PRESS (GestureOverlayMenuView →
    //     BinTVPlayerMenuCenter → `requestEpisodePicker()`);
    //   • panel danh sách tập (`showEpisodePicker`) GIỮ NGUYÊN — nó chỉ hiện
    //     khi người dùng chủ động mở từ menu, không phải nút luôn hiển thị.
    // =================================================================

    // =================================================================
    // [build 245 — 2026-09-17] DANH SÁCH TẬP = LỚP TRÊN CÙNG CỦA TRÌNH PHÁT
    //
    // VẤN ĐỀ (đúng triệu chứng trên máy thật): panel danh sách tập treo vào
    // `contentOverlayView` — lớp mà AVPlayerViewController đặt NẰM DƯỚI thanh
    // điều khiển tích hợp (transport bar chứa progress/seek bar). Panel neo
    // ở đáy màn hình → nằm ĐÚNG vùng của thanh trượt tua:
    //   • về HIỂN THỊ: seek bar vẽ đè lên danh sách tập;
    //   • về HIT-TESTING: chạm/vuốt trong vùng chồng được giao cho scrubber
    //     TRƯỚC → vuốt cuộn danh sách bị hiểu nhầm thành tua video.
    // CÁCH SỬA (tối thiểu, đúng nguyên nhân): treo panel vào VIEW GỐC của
    // AVPlayerViewController (`playerController.view`) + bringSubviewToFront
    // → panel nằm TRÊN MỌI thành phần của trình phát (video + controls) về
    // cả hiển thị, z-order lẫn hit-testing; UIScrollView trong panel bắt toàn
    // bộ vuốt dọc trong vùng của nó — progress bar KHÔNG còn nhận được touch.
    // Danh sách chuyển sang dạng DỌC (Tập 1…Tập N xếp chồng, vuốt LÊN/XUỐNG
    // để cuộn) đúng giao diện yêu cầu; LOGIC CHỌN TẬP giữ nguyên 100%
    // (chạm nút → pickEpisode → onSelectEpisode về JS).
    // ĐÓNG: hideEpisodePicker() gỡ panel KHỎI hierarchy hoàn toàn (không để
    // overlay vô hình chặn touch) + hạ cờ ưu tiên gesture — seek bar nhận lại
    // thao tác tua như cũ. teardownCurrentItem() cũng gọi hide để không bao
    // giờ sót panel khi dừng/đổi nguồn/đóng player.
    // =================================================================
    private func showEpisodePicker() {
        // VIEW GỐC của trình phát — KHÔNG dùng contentOverlayView (lớp đó nằm
        // DƯỚI thanh progress/seek bar của AVKit, xem khối chú thích build 245).
        guard let hostView = playerController?.view else { return }
        hideEpisodePicker()
        let panel = UIView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.backgroundColor = UIColor(white: 0.08, alpha: 0.94)
        panel.layer.cornerRadius = 14
        // LỚP TRÊN CÙNG: subview thêm SAU CÙNG của view gốc + đưa lên đỉnh +
        // zPosition cao → panel đè mọi control của AVKit về hiển thị và là view
        // ĐẦU TIÊN được hit-test trong vùng của nó (touch không lọt xuống
        // scrubber/progress bar bên dưới).
        hostView.addSubview(panel)
        hostView.bringSubviewToFront(panel)
        panel.layer.zPosition = 999
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: hostView.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(equalTo: hostView.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            panel.bottomAnchor.constraint(equalTo: hostView.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            panel.topAnchor.constraint(greaterThanOrEqualTo: hostView.safeAreaLayoutGuide.topAnchor, constant: 16),
            panel.heightAnchor.constraint(lessThanOrEqualTo: hostView.heightAnchor, multiplier: 0.5)
        ])
        let title = UILabel()
        title.text = "Danh sách tập"
        title.textColor = .white
        title.font = UIFont.systemFont(ofSize: 18, weight: .bold)
        title.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(title)
        // SCROLL DỌC: vuốt LÊN/XUỐNG = cuộn danh sách tập. Panel đang ở lớp
        // trên cùng nên pan-gesture của scroll view luôn nhận touch TRƯỚC
        // thanh progress — không còn cảnh vuốt danh sách bị biến thành tua.
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        panel.addSubview(scroll)
        let rowStack = UIStackView()
        rowStack.axis = .vertical           // danh sách DỌC: Tập 1, Tập 2, …
        rowStack.spacing = 8
        rowStack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(rowStack)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: panel.topAnchor, constant: 12),
            title.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12),
            title.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 10),
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            scroll.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -12),
            rowStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            rowStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            rowStack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            rowStack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            rowStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])
        for (index, item) in episodeItems.enumerated() {
            let button = UIButton(type: .system)
            button.tag = index
            button.setTitle(item.title, for: .normal)
            button.contentHorizontalAlignment = .left
            button.titleLabel?.lineBreakMode = .byTruncatingTail
            button.setTitleColor(index == currentEpisodeIndex ? .black : .white, for: .normal)
            button.backgroundColor = index == currentEpisodeIndex
                ? UIColor.white
                : UIColor.white.withAlphaComponent(0.14)
            button.layer.cornerRadius = 8
            button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
            button.addTarget(self, action: #selector(pickEpisode(_:)), for: .touchUpInside)
            rowStack.addArrangedSubview(button)
        }
        // Viewport cao ĐÚNG bằng nội dung khi danh sách ngắn; danh sách dài
        // vượt trần 50% màn hình → ràng buộc trần thắng, scroll view thu nhỏ
        // lại và cuộn (độ cao ước lượng từ số tập, mỗi dòng ≥44pt + spacing 8).
        let estimatedContent = CGFloat(episodeItems.count) * 44
            + CGFloat(max(0, episodeItems.count - 1)) * 8
        let fitContent = scroll.heightAnchor.constraint(equalToConstant: estimatedContent)
        fitContent.priority = UILayoutPriority(999)
        fitContent.isActive = true
        episodePickerView = panel
        // [build 245] Cờ ưu tiên gesture: vuốt cạnh (tua/Return/menu) tạm nhường
        // panel cho tới khi hideEpisodePicker() hạ cờ.
        BinTVPlayerGestureHub.shared.setPlayerOverlayPresented(true)
        player?.pause()
    }

    @objc private func pickEpisode(_ sender: UIButton) {
        let index = sender.tag
        guard index >= 0, index < episodeItems.count else { return }
        currentEpisodeIndex = index
        hideEpisodePicker()
        onSelectEpisode?(index, episodeItems[index].id)
    }

    /// [build 245] ĐÓNG danh sách tập: gỡ panel KHỎI view hierarchy HOÀN TOÀN
    /// (không để overlay vô hình tiếp tục chặn touch của trình phát — thanh
    /// progress/seek bar nhận lại thao tác tua như cũ) + hạ cờ ưu tiên gesture
    /// để vuốt cạnh (tua/Return/menu) hoạt động lại bình thường.
    private func hideEpisodePicker() {
        episodePickerView?.removeFromSuperview()
        episodePickerView = nil
        BinTVPlayerGestureHub.shared.setPlayerOverlayPresented(false)
    }

    /// Gỡ label + observer (tắt phụ đề / đổi nguồn / đóng player).
    private func removeSubtitleOverlay() {
        if let observer = subtitleTimeObserver {
            player?.removeTimeObserver(observer)
            subtitleTimeObserver = nil
        }
        subtitleLabel?.removeFromSuperview()
        subtitleLabel = nil
        subtitleCues = []
    }

    deinit {
        timeoutWork?.cancel()
        endedGraceWork?.cancel()
        statusObservation = nil
        // [build 245] chống kẹt cờ ưu tiên gesture nếu controller bị huỷ khi
        // panel danh sách tập còn đang mở.
        BinTVPlayerGestureHub.shared.setPlayerOverlayPresented(false)
        if let observer = subtitleTimeObserver {
            player?.removeTimeObserver(observer)
        }
        if let observer = stallObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = endObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
