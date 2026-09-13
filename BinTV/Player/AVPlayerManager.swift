import AVFoundation
import Foundation
import Combine
import SwiftUI

/// Quản lý AVPlayer cho stream HLS live.
///
/// Thiết kế chống các lỗi lifecycle thường gặp với SwiftUI:
/// - Chỉ MỘT instance AVPlayer duy nhất; chuyển kênh = `replaceCurrentItem`
///   (item cũ tự stop, không phát song song).
/// - Observer KVO được gắn lại đúng item mới và tự invalidate khi thay item.
/// - Mọi cập nhật `@Published` đều chạy trên main thread.
/// - Timeout 25s: nếu stream không ready → UI báo lỗi thật, không treo
///   "Đang tải..." vĩnh viễn.
/// - `load` idempotent: gọi lại với cùng URL khi đang phát sẽ bỏ qua
///   (chống onAppear gọi nhiều lần làm restart player).
final class AVPlayerManager: ObservableObject {
    enum PlayState: Equatable {
        case idle
        case loading
        case playing
        case paused
        case failed(String)
    }

    let player = AVPlayer()
    @Published private(set) var state: PlayState = .idle
    @Published private(set) var currentURL: String?
    /// true/false = video của stream đang tải/đang phát là NGANG/DỌC
    /// (đọc từ track video của asset); nil = chưa biết.
    /// PlayerView dùng giá trị này để tự xoay landscape fullscreen cho
    /// video ngang (cùng cơ chế với tab MOVIE), không xoay cho video dọc.
    @Published private(set) var videoIsLandscape: Bool?

    /// FIT/FILL:
    /// - `.resizeAspect`  (FIT)  = letterbox — giữ nguyên 100% khung hình,
    ///   có thể có thanh đen, KHÔNG cắt, KHÔNG stretch.
    /// - `.resizeAspectFill` (FILL) = video lấp đầy màn hình, CẮT các cạnh
    ///   thừa, KHÔNG stretch (không bao giờ méo 16:9↔9:16).
    @Published var videoGravity: AVLayerVideoGravity = .resizeAspect

    var isPlaying: Bool { state == .playing }

    /// Chỉnh chu FIT ⇄ FILL.
    func toggleFitFill() {
        videoGravity = (videoGravity == .resizeAspect) ? .resizeAspectFill : .resizeAspect
    }

    /// Đặt TRỰC TIẾP chế độ xem — dùng cho pinch 2 ngón (FIT → FILL → FULL).
    /// Cùng một nơi lưu trạng thái với `toggleFitFill` nên nút và cử chỉ
    /// pinch KHÔNG BAO GIỜ lệch nhau.
    func setGravity(_ newValue: AVLayerVideoGravity) {
        videoGravity = newValue
    }

    private var currentItem: AVPlayerItem?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var loadTimeoutTask: Task<Void, Never>?

    init() {
        // Âm thanh tiếp tục khi khóa màn hình (kết hợp UIBackgroundModes: audio
        // trong Info.plist) cho player native.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setActive(true)

        // Theo dõi trạng thái phát (playing/paused) để cập nhật nút Play/Pause.
        timeControlObservation = player.observe(\.timeControlStatus, options: [.initial]) { [weak self] p, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch p.timeControlStatus {
                case .playing:
                    if self.state == .paused || self.state == .loading {
                        self.state = .playing
                    }
                case .paused:
                    if self.state == .playing {
                        self.state = .paused
                    }
                case .waitingToPlayAtSpecifiedRate:
                    break // đang buffer — giữ trạng thái hiện tại
                @unknown default:
                    break
                }
            }
        }
    }

    /// Tải và phát stream HLS. Gọi từ main thread.
    /// - force: true = buộc tải lại (dùng cho nút "Thử lại").
    func load(urlString: String, force: Bool = false) {
        let urlText = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: urlText) else {
            fail("URL không hợp lệ")
            return
        }

        // Idempotent: cùng URL đang tải/đang phát → không restart lại.
        if !force, currentURL == urlText {
            if case .failed = state {
                // đang lỗi → cho phép reload
            } else {
                return
            }
        }

        loadTimeoutTask?.cancel()
        player.pause()

        let newItem = AVPlayerItem(url: url)
        currentItem = newItem
        currentURL = urlText
        state = .loading

        // Gắn observer status cho item MỚI (observer cũ tự invalidate khi
        // biến `itemStatusObservation` được gán lại / release).
        itemStatusObservation = newItem.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self = self, self.currentItem === item else { return }
                switch item.status {
                case .readyToPlay:
                    self.loadTimeoutTask?.cancel()
                    self.player.play()
                    self.state = .playing
                case .failed:
                    self.fail(item.error?.localizedDescription ?? "Không tải được stream (lỗi AVPlayerItem)")
                case .unknown:
                    break // vẫn đang load
                @unknown default:
                    break
                }
            }
        }

        // Phát hiện hướng video (ngang/dọc) từ track của asset MỚI, để
        // PlayerView tự xoay landscape fullscreen cho video ngang (giống
        // tab MOVIE). Load fail/không có track → nil = không biết →
        // KHÔNG xoay (không ảnh hưởng việc phát).
        videoIsLandscape = nil
        newItem.asset.loadTracks(withMediaType: .video) { [weak self] tracks, _ in
            DispatchQueue.main.async {
                guard let self = self, self.currentItem === newItem else { return }
                // tracks là [AVAssetTrack]? (optional) — phải unwrap trước.
                guard let track = tracks?.first else {
                    self.videoIsLandscape = nil
                    return
                }
                // naturalSize + preferredTransform = kích thước hiển thị thật
                // (một số stream xoay 90° — tính đúng thay vì so width/height thô).
                let natural = track.naturalSize
                let t = track.preferredTransform
                let w = t.a == 0 ? natural.height : natural.width * abs(t.a)
                let h = t.d == 0 ? natural.width : natural.height * abs(t.d)
                self.videoIsLandscape = w > h
            }
        }

        // replaceCurrentItem: stop item cũ, phát item mới — không song song.
        player.replaceCurrentItem(with: newItem)

        // Guard: nếu 25s chưa ready → báo lỗi thật thay vì treo Loading.
        loadTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 25_000_000_000)
            guard !Task.isCancelled else { return }
            DispatchQueue.main.async {
                guard let self = self else { return }
                if case .loading = self.state {
                    self.fail("Hết thời gian chờ stream (25 giây). Kiểm tra mạng hoặc URL kênh trong Settings.")
                }
            }
        }
    }

    /// Nút "Thử lại" khi có lỗi.
    func retry() {
        if let url = currentURL {
            load(urlString: url, force: true)
        }
    }

    func togglePlayPause() {
        switch state {
        case .playing:
            player.pause()
            state = .paused
        case .paused:
            player.play()
            state = .playing
        case .loading, .idle:
            break
        case .failed:
            retry()
        }
    }

    /// Dừng hẳn (gọi khi view biến mất) — hủy task, stop player, dọn observer.
    func stop() {
        loadTimeoutTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        itemStatusObservation = nil
        currentItem = nil
        currentURL = nil
        videoIsLandscape = nil
        state = .idle
    }

    private func fail(_ message: String) {
        loadTimeoutTask?.cancel()
        player.pause()
        state = .failed(message)
    }

    deinit {
        loadTimeoutTask?.cancel()
        itemStatusObservation = nil
        timeControlObservation = nil
    }
}
