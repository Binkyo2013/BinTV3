import SwiftUI
import UIKit

// MARK: - App / Scene lifecycle relay
//
// SwiftUI creates the UIWindowScene for this application, but the PHIM host
// needs an ordered, observable lifecycle signal that is independent of a
// particular SwiftUI view redraw.  Keeping this relay at the app boundary
// means Safari hand-offs and Home/background transitions use the same path.
extension Notification.Name {
    static let binTVApplicationWillResignActive = Notification.Name("com.bintv.lifecycle.willResignActive")
    static let binTVApplicationDidEnterBackground = Notification.Name("com.bintv.lifecycle.didEnterBackground")
    static let binTVApplicationWillEnterForeground = Notification.Name("com.bintv.lifecycle.willEnterForeground")
    static let binTVApplicationDidBecomeActive = Notification.Name("com.bintv.lifecycle.didBecomeActive")
    static let binTVScenePhaseDidChange = Notification.Name("com.bintv.lifecycle.scenePhaseDidChange")
}

final class BinTVLifecycleCenter {
    static let shared = BinTVLifecycleCenter()

    private init() {}

    func applicationWillResignActive() {
        publish(.binTVApplicationWillResignActive, label: "applicationWillResignActive")
    }

    func applicationDidEnterBackground() {
        publish(.binTVApplicationDidEnterBackground, label: "applicationDidEnterBackground")
    }

    func applicationWillEnterForeground() {
        publish(.binTVApplicationWillEnterForeground, label: "applicationWillEnterForeground")
    }

    func applicationDidBecomeActive() {
        publish(.binTVApplicationDidBecomeActive, label: "applicationDidBecomeActive")
    }

    /// ScenePhase is emitted by the root SwiftUI view as an additional scene
    /// level confirmation.  The app currently disables multiple scenes, but
    /// this keeps the restoration path correct if that setting changes later.
    func scenePhaseDidChange(_ phase: ScenePhase) {
        let phaseName: String
        switch phase {
        case .active: phaseName = "active"
        case .inactive: phaseName = "inactive"
        case .background: phaseName = "background"
        @unknown default: phaseName = "unknown"
        }
        PhimDebugLog.step("LIFECYCLE", "scenePhase", "event", phaseName)
        NotificationCenter.default.post(name: .binTVScenePhaseDidChange,
                                        object: self,
                                        userInfo: ["phase": phaseName])
    }

    private func publish(_ name: Notification.Name, label: String) {
        // UIApplicationDelegate callbacks are delivered on main.  Preserve
        // that contract if this helper is ever called by a future background
        // integration.
        let publishOnMain: () -> Void = {
            PhimDebugLog.step("LIFECYCLE", label, "event")
            NotificationCenter.default.post(name: name, object: self)
        }
        if Thread.isMainThread {
            publishOnMain()
        } else {
            DispatchQueue.main.async(execute: publishOnMain)
        }
    }
}

@main
struct BinTVApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var streamService = StreamService()
    @StateObject private var networkService = NetworkService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(streamService)
                .environmentObject(networkService)
        }
    }
}

class AppDelegate: UIResponder, UIApplicationDelegate {

    // =====================================================================
    // ORIENTATION = LANDSCAPE LUÔN (chế độ TV) — CẤU TRÚC 3 LỚP
    // [FIX 2026-09-12: thêm lớp (2) — khóa cứng MỌI WINDOW]:
    //
    // (1) Info.plist: `UISupportedInterfaceOrientations` (+ biến thể
    //     `~ipad`) chỉ còn 2 hướng LANDSCAPE. Đây là cơ chế chuẩn của
    //     iOS cho app "landscape-only" (đúng như game/app TV):
    //     - Hệ thống tạo scene LAUNCH THẲNG Ở LANDSCAPE kể cả khi thiết
    //       bị vật lý đang cầm portrait — không cần request, không có
    //       trạng thái "nửa xoay" (root-cause của lỗi R18).
    //     - Người dùng KHÔNG THỂ xoay app về portrait (rotation lock
    //       hay tự xoay — app chỉ có 2 hướng landscape hợp lệ).
    //     - Không phụ thuộc rotation lock của hệ thống: rotation lock
    //       chỉ giới hạn việc xoay TƯƠNG TÁC; orientation set của app
    //       quyết định app tồn tại ở hướng nào.
    //
    // (2) APP DELEGATE (MỚI — lớp quyết định theo WINDOW):
    //     `application(_:supportedInterfaceOrientationsFor:)` trả
    //     `.landscape` cho MỌI window. Đây là API CHÍNH THỨC mà UIKit
    //     hỏi TRƯỚC TIÊN khi quyết định hướng của từng window — ghi đè
    //     cả orientation set của view controller đang present:
    //     - WebKit native video fullscreen (tab TUBE gọi
    //       webkitEnterFullscreen; PHIM trước khi sửa
    //       allowsInlineMediaPlayback bị WebKit tự bắt cóc fullscreen)
    //       chạy ở WINDOW RIÊNG với mask `.all` của player VC → trước
    //       đây không bị plist chặn theo window → xoay dọc được → thoát
    //       fullscreen để lại app "kẹt" portrait. Lớp (2) kẹp mask của
    //       MỌI window về landscape — hết cửa xoay dọc.
    //     - AVPlayerViewController fullscreen (Live TV), sheet, alert,
    //       UIActivityViewController... đều đi qua API này.
    //
    // (3) AN TOÀN (code dưới đây): requestGeometryUpdate (iOS 16+) /
    //     UIDevice KVC (iOS 15) như safety net:
    //     - Launch retry loop: nếu scene (vì lý do edge-case nào đó)
    //       chưa ở landscape sau khi foregroundActive → request lại
    //       (max ~2.4s). Với (1)+(2) thì đây gần như là no-op.
    //     - didBecomeActive: app trở lại foreground mà không landscape
    //       → request landscape lại.
    //     - Tất cả request đều trùng orientation set của app (2 hướng
    //       landscape) → luôn hợp lệ, không bao giờ request portrait.
    //
    // PLATFORM NOTE (ghi rõ, không giả vờ): không có API chính thức
    // nào "ép" app vượt orientation set; vì app đã khai báo
    // landscape-only ở CẢ plist lẫn app delegate nên mọi tình huống
    // (launch, xoay máy, rotation lock, fullscreen video, sheet) đều
    // dẫn về landscape — đúng cơ chế iOS hỗ trợ, không dùng
    // CGAffineTransform hay hack nào.
    // =====================================================================

    private let maxLaunchAttempts = 12

    /// LỚP (2) — khóa cứng hướng theo WINDOW (API chính thức của UIKit).
    /// UIKit hỏi hàm này cho TỪNG window trước khi xét đến
    /// supportedInterfaceOrientations của view controller → trả
    /// `.landscape` (= landscapeLeft | landscapeRight) để:
    /// - window chính, sheet, alert: chỉ landscape;
    /// - window fullscreen video của WebKit/AVKit (mask riêng `.all`):
    ///   bị kẹp về landscape → video dọc letterbox trong khung ngang,
    ///   KHÔNG BAO GIỜ xoay app về portrait (kể cả khi thoát fullscreen).
    /// Vẫn cho phép lật landscapeLeft ↔ landscapeRight (không cứng một
    /// chiều gây ngược màn hình khi cầm máy tay trái/phải).
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .landscape
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // (2a) Safety net launch — thường là no-op (scene đã landscape
        //      do Info.plist landscape-only).
        requestLandscapeAtLaunch(attempt: 0)
        PhimDebugLog.step("LIFECYCLE", "didFinishLaunching", "ok")
        return true
    }

    // MARK: UIApplication lifecycle
    //
    // Do not ask WKWebView to reload from these callbacks.  They only publish
    // ordered lifecycle transitions; the PHIM controller snapshots while the
    // page is still alive and restores only after the scene is active again.
    func applicationWillResignActive(_ application: UIApplication) {
        BinTVLifecycleCenter.shared.applicationWillResignActive()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        BinTVLifecycleCenter.shared.applicationDidEnterBackground()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        BinTVLifecycleCenter.shared.applicationWillEnterForeground()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        BinTVLifecycleCenter.shared.applicationDidBecomeActive()
        requestLandscapeIfNotActive()
    }

    /// Request landscape MỘT lần nếu scene active đang không landscape.
    /// Scene đã landscape → không làm gì (request trùng = no-op, nhưng
    /// tránh gọi thừa).
    private func requestLandscapeIfNotActive() {
        guard let scene = currentActiveScene(), !scene.interfaceOrientation.isLandscape else { return }
        requestLandscape(on: scene)
    }

    /// Retry loop: chờ scene `foregroundActive` rồi request landscape
    /// (chỉ khi chưa landscape). Thử lại sau 0.2s (tối đa 12 lần ≈
    /// 2.4s) + 2 xác nhận cách 0.45s.
    private func requestLandscapeAtLaunch(attempt: Int) {
        guard attempt < maxLaunchAttempts else { return }
        guard let scene = currentActiveScene() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.requestLandscapeAtLaunch(attempt: attempt + 1)
            }
            return
        }
        if !scene.interfaceOrientation.isLandscape {
            requestLandscape(on: scene)
        }
        if attempt < 2 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.requestLandscapeAtLaunch(attempt: attempt + 1)
            }
        }
    }

    private func currentActiveScene() -> UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }

    /// Cơ chế request orientation CHÍNH THỨC (không KVC cho UI):
    /// - iOS 16+: `UIWindowScene.requestGeometryUpdate` (API hệ thống).
    /// - iOS 15:  `UIDevice.orientation` KVC (cơ chế khả dụng duy nhất
    ///   trên 15.x). LƯU Ý [FIX 2026-09-12]: KVC key "orientation" nhận
    ///   giá trị UIDeviceOrientation — bản cũ truyền
    ///   `UIInterfaceOrientation.landscapeRight.rawValue` (=3) tức là
    ///   sai enum domain (3 = UIDeviceOrientation.landscapeLeft; kết quả
    ///   vẫn landscape nhưng ngược chiều định xoay). Sửa về đúng
    ///   `UIDeviceOrientation.landscapeLeft.rawValue` (device ngang trái
    ///   → interface landscapeRight).
    private func requestLandscape(on scene: UIWindowScene) {
        if #available(iOS 16.0, *) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: [.landscapeLeft, .landscapeRight])) { error in
                // [BUILD FIX 2026-09-12] errorHandler của requestGeometryUpdate
                // có type `(any Error) -> Void` — tham số KHÔNG Optional và
                // handler CHỈ được gọi khi có lỗi. Bản trước dùng
                // `if let error = error` → lỗi biên dịch Xcode 16.4:
                // "initializer for conditional binding must have Optional
                //  type, not 'any Error'" (App.swift:150, log CI 2026-09-12).
                // Dùng trực tiếp `error` — hành vi log giữ nguyên.
                PhimDebugLog.step("ORIENTATION", "launchGeometryUpdate", "FAIL", error.localizedDescription)
            }
        } else {
            UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
        }
    }
}
