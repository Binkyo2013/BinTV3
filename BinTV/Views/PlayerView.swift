import SwiftUI
import AVKit
import UIKit

/// Player kênh Live TV (presented như sheet từ ContentView).
///
/// HƯỚNG MÀN HÌNH (chế độ TV LANDSCAPE):
/// - Video NGANG (16:9/4:3): khi phát hiện (từ track của asset stream) →
///   BUỘC app xoay LANDSCAPE (requestGeometryUpdate iOS 16+, KVC iOS 15),
///   video fill cả màn hình, không còn thanh đen — DUYỆT cả khi iPhone đang
///   bật khóa xoay (không cần mở khóa, không cần tự nghiêng máy).
/// - Video DỌC: KHÔNG xoay, hiển thị letterbox (giữ app ở chế độ TV).
/// - Đóng player: GIỮ NGUYÊN hướng landscape (bản cũ xoay về portrait ở đây
///   — làm app "lọt" về layout dọc giữa chừng sử dụng; đã loại bỏ).
struct PlayerView: View {
    let channel: Channel
    @StateObject private var manager = AVPlayerManager()
    /// [build 235] Long-press trong sheet player = BACK 1 bước → đóng sheet
    /// (về lưới kênh LIVE TV). `dismiss()` của SwiftUI chỉ đóng sheet NÀY —
    /// không thể thoát app hay về Home.
    @Environment(\.dismiss) private var dismiss
    /// [build 224] Toàn màn hình player native — mức cao nhất của pinch
    /// PHÓNG TO (FIT → FILL → FULL). Dùng chung một AVPlayer nên
    /// chuyển chế độ KHÔNG tải lại stream, không gián đoạn.
    @State private var isNativeFullscreen = false
    @State private var deviceOrientation = UIDevice.current.orientation
    // iPhone: portrait → .compact; landscape → .regular (kích hoạt re-render khi xoay).
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isLandscapeUI: Bool { horizontalSizeClass == .regular }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                // PLAYER CHUẨN iOS DÙNG CHUNG (AVPlayerViewController +
                // containment đúng): điều khiển native, PiP, AirPlay và
                // PINCH 2 NGÓN (FIT → FILL → FULL). Thanh điều khiển tự
                // dựng đã bị LOẠI BỎ (trùng chức năng với điều khiển gốc).
                BinTVNativePlayer(player: manager.player,
                                  gravity: manager.videoGravity,
                                  isFullscreen: false,
                                  onGravityChanged: { manager.setGravity($0) },
                                  onRequestFullscreen: {
                                      isNativeFullscreen = true
                                      setInterfaceLandscape(true)
                                  },
                                  onRequestExitFullscreen: { },
                                  onLongPressBack: {
                                      // [build 235] Giữ màn hình trong player
                                      // inline (sheet) = BACK → đóng sheet.
                                      dismiss()
                                  })

                if case .loading = manager.state {
                    overlay {
                        VStack(spacing: 12) {
                            ProgressView().tint(.white)
                            Text("Đang tải stream…")
                                .font(.footnote)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                } else if case .failed(let message) = manager.state {
                    overlay {
                        VStack(spacing: 10) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.largeTitle)
                                .foregroundColor(.orange)
                            Text("Không phát được stream")
                                .font(.headline)
                                .foregroundColor(.white)
                            Text(message)
                                .font(.footnote)
                                .foregroundColor(.gray)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                            Button("Thử lại") {
                                manager.retry()
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                }
            }
            // Dọc (layout mặc định — GIỮ NGUYÊN như trước): box 16:9.
            // Ngang: bỏ ràng buộc box + bỏ safe area → video fill cả màn hình.
            .aspectRatio(isLandscapeUI ? nil : 16 / 9, contentMode: .fit)
            .ignoresSafeArea(isLandscapeUI ? .all : [])

            if !isLandscapeUI {
                // Không còn thanh điều khiển tự dựng: phát/tạm dừng, tua,
                // AirPlay, fullscreen đều do ĐIỀU KHIỂN CHUẨN iOS đảm nhiệm.
                Spacer()
            }
        }
        // [build 224] MÀN HÌNH TOÀN PHẦN (mức FULL của pinch): cùng một
        // AVPlayer → KHÔNG tải lại, KHÔNG gián đoạn; pinch THU NHỎ để thoát.
        .fullScreenCover(isPresented: $isNativeFullscreen) {
            BinTVNativePlayer(player: manager.player,
                              gravity: manager.videoGravity,
                              isFullscreen: true,
                              onGravityChanged: { manager.setGravity($0) },
                              onRequestFullscreen: { },
                              onRequestExitFullscreen: { isNativeFullscreen = false },
                              onLongPressBack: {
                                  // [build 235] Giữ màn hình ở mức FULL
                                  // (fullScreenCover) = BACK 1 bước → thoát
                                  // về player inline (KHÔNG đóng sheet).
                                  isNativeFullscreen = false
                              })
                .ignoresSafeArea()
                .background(Color.black.ignoresSafeArea())
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear {
            manager.load(urlString: channel.currentURL)
            // Trong trường hợp hướng đã được phát hiện sẵn (stream load nhanh)
            // — xoay ngay.
            if manager.videoIsLandscape == true {
                setInterfaceLandscape(true)
            }
        }
        // Hướng video mới phát hiện: NGANG → buộc landscape fullscreen
        // (độc lập với khóa xoay thiết bị — giống tab MOVIE).
        // Dọc/không rõ → không làm gì, giữ hướng hiện tại.
        .onChange(of: manager.videoIsLandscape) { landscape in
            if landscape == true {
                setInterfaceLandscape(true)
            }
        }
        // Trong khi đang phát video NGANG: nếu người dùng tự xoay màn hình
        // về dọc → đưa về landscape lại (giữ chế độ xem ngang — hành vi
        // giống tab MOVIE). Video dọc: được xoay tự do, không ép lại.
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            deviceOrientation = UIDevice.current.orientation
            if manager.videoIsLandscape == true,
               !deviceOrientation.isLandscape,
               deviceOrientation != .faceUp,
               deviceOrientation != .faceDown {
                setInterfaceLandscape(true)
            }
        }
        .onDisappear {
            manager.stop()
            // App BinTV = chế độ TV LANDSCAPE: đóng player KHÔNG xoay về
            // portrait (giữ layout ngang cho các tab).
        }
    }

    // MARK: - Orientation (cùng cơ chế với tab MOVIE)

    /// Buộc hướng giao diện bằng cơ chế chính thức — DUYỆT cả khi người
    /// dùng đang bật khóa xoay (Rotation Lock):
    /// - iOS 16+: `scene.requestGeometryUpdate(.iOS(interfaceOrientations:))`.
    /// - iOS 15:  `UIDevice.orientation` (KVC — giá trị UIDeviceOrientation).
    ///
    /// [FIX 2026-09-12 — KHÓA CỨNG LANDSCAPE]: BinTV là app chế độ TV,
    /// không tồn tại trạng thái portrait. Bản cũ nhận `landscape: Bool`
    /// và khi `false` sẽ request `.portrait` — một "cửa sau" phá khóa
    /// ngang (dù call-site hiện tại chỉ truyền true, đây là landmine cho
    /// mọi sửa đổi sau này). Nay `false` = NO-OP (giữ nguyên landscape),
    /// KHÔNG BAO GIỜ request portrait. Không chạm vào video / player —
    /// stream tiếp tục phát nguyên vẹn.
    private func setInterfaceLandscape(_ landscape: Bool) {
        guard landscape else { return }
        let orientations: UIInterfaceOrientationMask = [.landscapeLeft, .landscapeRight]
        if #available(iOS 16.0, *) {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            scene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
        } else {
            // KVC trên UIDevice phải dùng UIDeviceOrientation (device
            // landscapeLeft ↔ interface landscapeRight — đều là ngang).
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
        }
    }

    private func overlay<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            Color.black.opacity(0.55)
            content()
        }
    }
}

// =====================================================================
// PLAYER CHUẨN iOS — DÙNG CHUNG CHO TOÀN BỘ APP (build 224)
// =====================================================================
/// `AVPlayerViewController` — ĐÚNG LÀ view controller nằm sau SwiftUI
/// `VideoPlayer`, nhúng bằng `UIViewControllerRepresentable` (containment
/// đầy đủ) nên có TRỌN VẸN hành vi chuẩn của iOS: điều khiển gốc (tap để
/// hiện/ẩn, tua, AirPlay, PiP), fullscreen presentation và PINCH 2 NGÓN.
///
/// PINCH 2 NGÓN — đổi chế độ xem (yêu cầu đồng bộ hoá player):
///   • PHÓNG TO (zoom in) : FIT (vừa khung, còn viền đen)
///                          → FILL (lấp đầy, cắt mép thừa)
///                          → FULL (toàn màn hình player native)
///   • THU NHỎ (zoom out) : FULL → FILL → FIT
///   • Mỗi bước = 18% tỉ lệ pinch; `scale` được reset sau mỗi bước nên một
///     cái pinch liên tục đi lần lượt FIT → FILL → FULL (không vọt mức).
///   • Gesture chạy ĐỒNG THỜI với gesture của AVKit
///     (`shouldRecognizeSimultaneouslyWith = true`) → không cướp thao tác.
///
/// [FIX build 223 — giữ nguyên] Hai phần bắt buộc để fullscreen KHÔNG đen
/// và KHÔNG dừng phát:
///   1. `UIViewControllerRepresentable` (thay `UIViewRepresentable` trả
///      `coordinator.view`): thiếu containment → fullscreen presentation
///      không có VC cha để present → màn hình đen.
///   2. `AVPlayerViewControllerDelegate`: AVKit **PAUSE** player trong lúc
///      chuyển chế độ trình bày → gọi lại `play()` SAU khi transition kết
///      thúc (bỏ qua khi người dùng huỷ giữa chừng: `isCancelled`).
private struct BinTVNativePlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    let gravity: AVLayerVideoGravity
    /// Đang là màn hình FULL (toàn màn hình) → pinch THU NHỎ sẽ thoát FULL.
    let isFullscreen: Bool
    let onGravityChanged: (AVLayerVideoGravity) -> Void
    let onRequestFullscreen: () -> Void
    let onRequestExitFullscreen: () -> Void
    /// [build 235] Giữ màn hình ≥0.35s trong player = BACK 1 bước
    /// (đóng sheet / thoát fullscreen cover — tuỳ vị trí của caller).
    let onLongPressBack: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(gravity: gravity,
                    isFullscreen: isFullscreen,
                    onGravityChanged: onGravityChanged,
                    onRequestFullscreen: onRequestFullscreen,
                    onRequestExitFullscreen: onRequestExitFullscreen,
                    onLongPressBack: onLongPressBack)
    }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = gravity
        // Theo dõi chuyển chế độ trình bày để GIỮ PHÁT (bù pause của AVKit).
        controller.delegate = context.coordinator
        // PINCH 2 NGÓN → FIT / FILL / FULL.
        let pinch = UIPinchGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePinch(_:)))
        pinch.cancelsTouchesInView = false
        pinch.delegate = context.coordinator
        controller.view.addGestureRecognizer(pinch)
        // [build 235] GIỮ MÀN HÌNH = BACK 1 BƯỚC (giống nút Back Android TV):
        // • player inline trong sheet LIVE TV  → đóng sheet (về lưới kênh);
        // • player trong fullScreenCover (FULL) → thoát cover (về inline).
        // Gắn TRÊN view của AVPlayerViewController → nhận touch vùng video;
        // delegate NHƯỜNG UIControls (nút Done/AirPlay/seek...) để điều
        // khiển gốc của AVKit GIỮ NGUYÊN 100%.
        let backPress = UILongPressGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleBackLongPress(_:)))
        backPress.minimumPressDuration = 0.35
        backPress.delaysTouchesBegan = false
        backPress.delegate = context.coordinator
        controller.view.addGestureRecognizer(backPress)
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController,
                                context: Context) {
        // Chỉ gán lại khi THẬT SỰ khác — gán lại vô điều kiện có thể làm
        // gián đoạn phát mỗi lần SwiftUI render lại.
        if controller.player !== player {
            controller.player = player
        }
        // So bằng rawValue (String) — chắc chắn hợp lệ với mọi SDK, không
        // phụ thuộc Equatable của AVLayerVideoGravity.
        if controller.videoGravity.rawValue != gravity.rawValue {
            controller.videoGravity = gravity
        }
        controller.delegate = context.coordinator
        // Coordinator là class sống lâu hơn struct → cập nhật giá trị mới
        // nhất (gravity/trạng thái fullscreen/closure) mỗi lần render.
        context.coordinator.update(gravity: gravity,
                                   isFullscreen: isFullscreen,
                                   onGravityChanged: onGravityChanged,
                                   onRequestFullscreen: onRequestFullscreen,
                                   onRequestExitFullscreen: onRequestExitFullscreen,
                                   onLongPressBack: onLongPressBack)
    }

    /// Giữ player sống sót qua các lần render/fullscreen: KHÔNG tháo
    /// `player` ở đây (tháo = dừng phát ngay lập tức).
    static func dismantleUIViewController(_ controller: AVPlayerViewController,
                                          coordinator: Coordinator) {
        // Cố tình không gán controller.player = nil.
    }

    /// Xử lý PINCH (FIT/FILL/FULL) + giữ phát khi AVKit đổi chế độ trình bày.
    final class Coordinator: NSObject, AVPlayerViewControllerDelegate,
                             UIGestureRecognizerDelegate {
        private var gravity: AVLayerVideoGravity
        private var isFullscreen: Bool
        private var onGravityChanged: (AVLayerVideoGravity) -> Void
        private var onRequestFullscreen: () -> Void
        private var onRequestExitFullscreen: () -> Void
        /// [build 235] Back 1 bước khi giữ màn hình (đóng sheet / thoát FULL).
        private var onLongPressBack: () -> Void

        /// Đang phát trước khi bắt đầu chuyển? (AVKit sẽ pause trong lúc
        /// chuyển → dùng để khôi phục đúng trạng thái sau transition).
        private var wasPlayingBeforeTransition = false

        /// Ngưỡng pinch cho MỘT bước (18%).
        private static let stepThreshold: CGFloat = 0.18

        init(gravity: AVLayerVideoGravity,
             isFullscreen: Bool,
             onGravityChanged: @escaping (AVLayerVideoGravity) -> Void,
             onRequestFullscreen: @escaping () -> Void,
             onRequestExitFullscreen: @escaping () -> Void,
             onLongPressBack: @escaping () -> Void) {
            self.gravity = gravity
            self.isFullscreen = isFullscreen
            self.onGravityChanged = onGravityChanged
            self.onRequestFullscreen = onRequestFullscreen
            self.onRequestExitFullscreen = onRequestExitFullscreen
            self.onLongPressBack = onLongPressBack
            super.init()
        }

        func update(gravity: AVLayerVideoGravity,
                    isFullscreen: Bool,
                    onGravityChanged: @escaping (AVLayerVideoGravity) -> Void,
                    onRequestFullscreen: @escaping () -> Void,
                    onRequestExitFullscreen: @escaping () -> Void,
                    onLongPressBack: @escaping () -> Void) {
            self.gravity = gravity
            self.isFullscreen = isFullscreen
            self.onGravityChanged = onGravityChanged
            self.onRequestFullscreen = onRequestFullscreen
            self.onRequestExitFullscreen = onRequestExitFullscreen
            self.onLongPressBack = onLongPressBack
        }

        // MARK: - Pinch 2 ngón: FIT → FILL → FULL (và ngược lại)

        @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
            guard gesture.state == .changed || gesture.state == .ended else { return }
            let scale = gesture.scale
            if scale > 1 + Coordinator.stepThreshold {
                // Reset ngay: mỗi bước pinch là MỘT lần đổi mức, pinch tiếp
                // tục thì đi mức kế tiếp (không vọt thẳng lên FULL).
                gesture.scale = 1
                zoomIn()
            } else if scale < 1 - Coordinator.stepThreshold {
                gesture.scale = 1
                zoomOut()
            }
        }

        /// PHÓNG TO: FIT → FILL → FULL.
        private func zoomIn() {
            if gravity == .resizeAspect {
                onGravityChanged(.resizeAspectFill)      // FIT → FILL
            } else if !isFullscreen {
                onRequestFullscreen()                    // FILL → FULL
            }
            // Đang FULL + FILL: mức cao nhất — không làm gì thêm.
        }

        /// THU NHỎ: FULL → FILL → FIT.
        private func zoomOut() {
            if isFullscreen {
                onRequestExitFullscreen()                // FULL → FILL (inline)
            } else if gravity == .resizeAspectFill {
                onGravityChanged(.resizeAspect)          // FILL → FIT
            }
        }

        /// [build 235] Giữ màn hình ≥0.35s trong player = BACK 1 bước:
        /// đóng sheet (inline) hoặc thoát fullscreen cover (FULL) — KHÔNG
        /// thoát app, KHÔNG về Home. Giống nút Back trên Android TV.
        @objc func handleBackLongPress(_ gesture: UILongPressGestureRecognizer) {
            guard gesture.state == .began else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onLongPressBack()
        }

        /// Long-press BACK: NHƯỜNG UIControl / ô nhập liệu (điều khiển gốc
        /// của AVKit: nút Done, AirPlay, seek, PiP...) → chỉ nhận ở vùng
        /// video/nền, không cướp thao tác player hiện có.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldReceive touch: UITouch) -> Bool {
            if gestureRecognizer is UILongPressGestureRecognizer,
               Self.isControlOrTextInput(touch.view) {
                return false
            }
            return true
        }

        /// Touch có nằm trong UIControl hoặc ô nhập liệu không (chained
        /// qua superview — điều khiển AVKit là nút overlay trong view của
        /// AVPlayerViewController).
        private static func isControlOrTextInput(_ view: UIView?) -> Bool {
            var current = view
            while let candidate = current {
                if candidate is UIControl || candidate is UITextInput { return true }
                current = candidate.superview
            }
            return false
        }

        /// KHÔNG cướp gesture của AVKit / của SwiftUI (pinch vẫn thuộc về
        /// player khi cần, và ngược lại).
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith
                               other: UIGestureRecognizer) -> Bool {
            return true
        }

        // MARK: - Giữ phát khi AVKit đổi chế độ trình bày (fix build 223)

        /// VÀO fullscreen.
        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willBeginFullScreenPresentationWithAnimationCoordinator
                coordinator: UIViewControllerTransitionCoordinator) {
            wasPlayingBeforeTransition = (playerViewController.player?.rate ?? 0) > 0
            coordinator.animate(alongsideTransition: nil) { [weak self] context in
                guard let self = self, !context.isCancelled else { return }
                // Transition xong: AVKit đã pause → PHÁT LẠI nếu trước đó
                // đang phát.
                if self.wasPlayingBeforeTransition {
                    playerViewController.player?.play()
                }
            }
        }

        /// THOÁT fullscreen (về lại inline).
        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willEndFullScreenPresentationWithAnimationCoordinator
                coordinator: UIViewControllerTransitionCoordinator) {
            let wasPlaying = (playerViewController.player?.rate ?? 0) > 0
            coordinator.animate(alongsideTransition: nil) { context in
                guard !context.isCancelled else { return }
                if wasPlaying {
                    playerViewController.player?.play()
                }
            }
        }

        /// Bắt đầu PiP: KHÔNG tự đóng player inline (đóng = mất hình/đen
        /// trong khi âm thanh vẫn chạy).
        func playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(
            _ playerViewController: AVPlayerViewController) -> Bool {
            return false
        }
    }
}
