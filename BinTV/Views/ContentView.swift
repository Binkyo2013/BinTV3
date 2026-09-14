import SwiftUI
import UIKit
import WebKit

// =====================================================================
// ContentView — FULLSCREEN THẬT SỰ + MENU ẨN MẶC ĐỊNH +
//               GESTURE ĐIỀU HƯỚNG (giữ màn hình / cạnh phải / cạnh trái)
// [FIX UI 2026-09-12, build 221]
//
// -------------------------------------------------------------------
// A. ROOT CAUSE "MENU BAR VẪN HIỆN" (vì sao bản 219/220 chưa xong)
// -------------------------------------------------------------------
// Bản 219/220 giữ SwiftUI `TabView` (sinh ra UITabBarController + thanh
// bar dưới có đúng 4 nhãn LIVE TV / TUBE / PHIM / SETTING) rồi nhờ
// `TabChromeController` tìm UITabBarController để ẩn. Nhưng
// `TabChromeController` được đặt ở `.background(...)` của
// GeometryReader, tức là NẰM NGOÀI `NavigationView` — VC của nó có
// parent chain đi NGƯỢC LÊN (→ root UIHostingController → nil), trong
// khi UITabBarController là HẬU DUỆ của root (nằm bên trong
// NavigationView). Vòng `while … r.parent` VĨNH VIỄN không gặp nó:
//   → `tbc.tabBar.isHidden = true` KHÔNG BAO GIỜ chạy  → menu bar hiện;
//   → long-press global + 2 edge-pan cũng KHÔNG BAO GIỜ được gắn
//     (cùng một nhánh `guard let tbc`) → 2 cách gọi menu và Back bằng
//     vuốt cạnh trái chưa hề tồn tại trong IPA đang chạy.
// Hơn nữa, với `TabView`, nội dung tab luôn bị inset phần dưới bằng
// chiều cao bar — kể cả khi ẩn được bar thì vùng đó vẫn bỏ trống.
//
// -------------------------------------------------------------------
// B. CÁCH SỬA TẬN GỐC (bỏ hẳn lớp sinh ra menu bar)
// -------------------------------------------------------------------
// 1. KHÔNG CÒN `TabView`: 4 trang được xếp trong `ZStack` do ContentView
//    tự điều khiển (`selectedTab`). KHÔNG có UITabBarController → KHÔNG
//    có menu bar nào để phải ẩn, và nội dung tự lấp TOÀN BỘ màn hình
//    (đúng yêu cầu "nội dung mở rộng tận dụng phần bị menu bar chiếm").
//    Menu điều hướng (4 icon LIVE TV/TUBE/PHIM/SETTING) chỉ tồn tại ở
//    dạng OVERLAY ẨN MẶC ĐỊNH (`@State showMenu = false` + `if showMenu`
//    → khi ẩn nó không hề có trong hierarchy, 0% chặn touch).
// 2. MỘT KHI TRANG ĐÃ MỞ THÌ GIỮ VĨNH VIỄN TRONG HIERARCHY
//    (`mountedTabs`): WKWebView của PHIM/TUBE KHÔNG BAO GIỜ bị gỡ khỏi
//    window → triệt tiêu tận gốc root cause màn hình đen (xem mục C).
// 3. GESTURE GẮN TRỰC TIẾP TRÊN UIWINDOW (không cần tìm UITabBar-
//    Controller nữa): giữ ≥0.35s = hiện menu; vuốt cạnh phải = hiện
//    menu; vuốt cạnh trái = Back 1 bước. Window là tổ tiên của MỌI view
//    (kể cả sheet player) → phủ toàn app. Delegate `shouldReceive`
//    chặn các vùng có gesture riêng (WKWebView, UIControl/ô nhập liệu,
//    menu đang mở, player sheet) → KHÔNG cướp/cản trở thao tác hiện có.
//
// -------------------------------------------------------------------
// C. ROOT CAUSE "TAB PHIM MÀN HÌNH ĐEN KHI QUAY LẠI"
// -------------------------------------------------------------------
// WKWebView khi rời khỏi window (tab bị gỡ khỏi hierarchy) có thể bị hệ
// thống kết thúc WebContent process → webview chỉ còn layer ĐEN, không
// tự hồi. Bản 220 đã thêm `webViewWebContentProcessDidTerminate` (cơ
// chế CHÍNH THỨC của Apple) — giữ nguyên. Build 221 xử lý NGUYÊN NHÂN
// SÂU HƠN: trang PHIM (và TUBE) giờ không bao giờ rời hierarchy
// (mục B.2) → process không bị kết thúc do rời tab. Thêm 2 lớp bổ trợ:
//   • `noteTabDidAppear()`: `setNeedsDisplay()` (repaint layer stale,
//     KHÔNG reload) mỗi lần tab hiện lại.
//   • `restoreIfEmpty()`: CHỈ khi webview thật sự trống (`url == nil`,
//     không đang load) mới nạp lại trang — tối đa 3 lần, không reload
//     bừa, không mất trạng thái khi cache còn dùng được.
//
// -------------------------------------------------------------------
// D. BẢO TỒN (giữ nguyên 100%)
// -------------------------------------------------------------------
// • 4 trang LiveTVView / MovieListView / PhimView / SettingsView: code
//   nội dung KHÔNG bị đụng (chỉ thêm tham số `isActive` để biết lúc nào
//   tab được chọn lại).
// • `BinTVPage` rawValue 0…3 = semantics điều hướng cũ; sheet PlayerView
//   (.id(channel.id)), loadChannels, \.uiProps scaling, 3 lớp khóa
//   landscape: GIỮ NGUYÊN VĂN.
// • Duy nhất một thứ bị thay thế: `TabView` → `ZStack` (mục B.1) — đúng
//   là đối tượng của yêu cầu "tự động ẩn menu bar".
// =====================================================================

struct ContentView: View {
    @EnvironmentObject var streamService: StreamService
    @EnvironmentObject var networkService: NetworkService
    /// Scene-level confirmation of foreground/background state.  AppDelegate
    /// publishes UIApplication callbacks; this covers the UIWindowScene that
    /// owns the SwiftUI hierarchy as well.
    @Environment(\.scenePhase) private var scenePhase

    /// Trang đang hiển thị (0…3 — semantics BinTVPage, không đổi).
    @State private var selectedTab: Int = BinTVPage.liveTV.rawValue
    /// Overlay menu (LIVE TV/TUBE/PHIM/SETTING) — MẶC ĐỊNH ẨN KHI MỞ APP.
    @State private var showMenu = false

    @State private var showingPlayer = false
    @State private var selectedStream: Channel? = nil

    /// Trang đã từng mở: MỘT KHI ĐÃ MOUNT THÌ KHÔNG BAO GIỜ GỠ RA
    /// (mục B.2) → webview PHIM/TUBE luôn ở trong window, giữ nguyên
    /// trạng thái đang xem (không reload, không màn hình đen).
    @State private var mountedTabs: Set<Int> = [BinTVPage.liveTV.rawValue]

    /// Lịch sử chuyển trang — Back bằng vuốt cạnh trái dùng để lùi đúng
    /// 1 bước khi trang hiện tại không còn mức nào để lùi (mục 5).
    @State private var tabHistory: [Int] = [BinTVPage.liveTV.rawValue]

    var body: some View {
        GeometryReader { geo in
            // Hệ tỷ lệ thích ứng (build 218) — tính một lần, phát xuống
            // toàn cây: overlay menu + lưới Live TV + cột Settings + nút
            // nổi TUBE scale theo SE…Pro Max…iPad.
            let props = UIProportions(size: geo.size)

            NavigationView {
                pageStack
                    // FULLSCREEN: không nav bar hệ thống, không menu bar —
                    // nội dung chạm mép trên/dưới màn hình.
                    .navigationBarHidden(true)
            }
            // iPad/landscape: buộc style stack — layout đơn trị toàn màn.
            .navigationViewStyle(.stack)
            // ----- OVERLAY MENU — MẶC ĐỊNH KHÔNG TỒN TẠI (`if showMenu`)
            // ----- → 0% chặn touch nội dung khi đang xem.
            .overlay {
                if showMenu {
                    GestureOverlayMenuView(selectedTab: $selectedTab,
                                           isPresented: $showMenu,
                                           onSelect: { selectTab($0) })
                        .transition(.opacity)
                }
            }
            .environment(\.uiProps, props)
            // Phản hồi tức thì: fade ngắn 0.15s cho ẩn/hiện.
            .animation(.easeInOut(duration: 0.15), value: showMenu)
        }
        // Player Live TV — sheet + logic GIỮ NGUYÊN 100% từ bản gốc
        // (.id(channel.id): mỗi kênh một AVPlayerManager mới).
        .sheet(isPresented: $showingPlayer) {
            if let stream = selectedStream {
                PlayerView(channel: stream)
                    .id(stream.id)
            }
        }
        // ----- GESTURE TOÀN APP, GẮN TRÊN UIWINDOW (mục B.3) -----
        // • giữ ≥0.35s            → toggleOverlayMenu()  (hiện menu)
        // • vuốt cạnh PHẢI vào    → toggleOverlayMenu()  (hiện menu)
        // • vuốt cạnh TRÁI sang   → handleBackGesture()  (Back 1 bước)
        // Delegate chặn vùng có gesture riêng (webview / UIControl / ô
        // nhập liệu / menu đang mở / player sheet) → không xung đột.
        .background(
            BinTVWindowGestures(onLongPress: { toggleOverlayMenu() },
                                onEdgeRight: { toggleOverlayMenu() },
                                onEdgeLeft: { handleBackGesture() },
                                longPressAllowed: { !showMenu && !showingPlayer })
                .frame(width: 0, height: 0)
        )
        .onAppear {
            Task { await streamService.loadChannels() }
            BinTVLifecycleCenter.shared.scenePhaseDidChange(scenePhase)
        }
        .onChange(of: scenePhase) { phase in
            BinTVLifecycleCenter.shared.scenePhaseDidChange(phase)
        }
        .onChange(of: selectedTab) { tab in
            // Trang vừa được chọn: GIỮ VĨNH VIỄN trong hierarchy từ đây
            // (chuyển qua lại nhiều lần không bao giờ mount lại).
            mountedTabs.insert(tab)
        }
    }

    // =================================================================
    // 4 TRANG TRONG ZSTACK — KHÔNG CÒN TabView → KHÔNG CÒN MENU BAR.
    // Trang không được chọn: `opacity(0)` + `allowsHitTesting(false)`
    // (vô hình, không nhận touch) nhưng VẪN Ở TRONG HIERARCHY → webview
    // không bao giờ rời window (root cause màn hình đen PHIM).
    // =================================================================
    private var pageStack: some View {
        ZStack {
            if mountedTabs.contains(BinTVPage.liveTV.rawValue) { liveTVPage }
            if mountedTabs.contains(BinTVPage.tube.rawValue) { tubePage }
            if mountedTabs.contains(BinTVPage.phim.rawValue) { phimPage }
            if mountedTabs.contains(BinTVPage.settings.rawValue) { settingsPage }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var liveTVPage: some View {
        pageLayer(.liveTV) {
            LiveTVView(channels: streamService.channels, onSelect: { ch in
                // Đóng menu (nếu đang mở) trước khi mở player — không để
                // menu kẹt lại phía dưới sheet.
                showMenu = false
                selectedStream = ch
                showingPlayer = true
            })
        }
    }

    private var tubePage: some View {
        pageLayer(.tube) {
            MovieListView(onLongPress: { toggleOverlayMenu() },
                          isActive: selectedTab == BinTVPage.tube.rawValue)
        }
    }

    private var phimPage: some View {
        pageLayer(.phim) {
            PhimView(onLongPress: { toggleOverlayMenu() },
                     isActive: selectedTab == BinTVPage.phim.rawValue)
        }
    }

    private var settingsPage: some View {
        pageLayer(.settings) {
            SettingsView()
        }
    }

    /// Lớp hiển thị cho 1 trang: full-bleed + chỉ trang được chọn mới
    /// hiện & nhận touch. Các trang còn lại GIỮ NGUYÊN trong hierarchy.
    @ViewBuilder
    private func pageLayer<Content: View>(_ page: BinTVPage,
                                          @ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .opacity(selectedTab == page.rawValue ? 1 : 0)
            .allowsHitTesting(selectedTab == page.rawValue)
    }

    // =================================================================
    // CHUYỂN TRANG (từ overlay menu): mount (1 lần) + ghi lịch sử Back.
    // =================================================================
    private func selectTab(_ tab: Int) {
        showMenu = false
        guard tab != selectedTab else { return }
        selectedTab = tab
        mountedTabs.insert(tab)
        if tabHistory.last != tab { tabHistory.append(tab) }
    }

    // =================================================================
    // HIỆN MENU (long-press hoặc vuốt cạnh phải). IDEMPOTENT + có guard:
    // • đang mở rồi        → giữ nguyên (không chớp 2 lần);
    // • player sheet đang mở → không mở menu vô hình bên dưới sheet.
    // Mặc định `showMenu = false` → menu KHÔNG TỰ HIỆN khi mở app hay
    // trong lúc đang xem nội dung.
    // =================================================================
    private func toggleOverlayMenu() {
        guard !showMenu else { return }
        guard !showingPlayer else { return }
        showMenu = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    // =================================================================
    // BACK BẰNG VUỐT CẠNH TRÁI — đúng 1 bước, theo đúng thứ tự điều
    // hướng, KHÔNG BAO GIỜ thoát app:
    //   1) overlay menu đang hiện      → ẩn menu (back khỏi menu);
    //   2) sheet PlayerView đang mở    → đóng sheet (back khỏi player);
    //   3) webview tab hiện tại (TUBE/PHIM) còn lịch sử → goBack() 1 bước
    //      (BinTVBackRegistry — chính webview tự báo canGoBack);
    //   4) còn trang đã xem trước đó   → lùi về trang đó (lịch sử tab);
    //   5) màn hình gốc, không còn gì  → NO-OP tuyệt đối (không thoát
    //      app, không dismiss, không suspend).
    // Mỗi lần vuốt = tối đa 1 bước (recognizer .began fired 1 lần/swipe).
    // =================================================================
    private func handleBackGesture() {
        if showMenu {
            showMenu = false
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        if showingPlayer {
            showingPlayer = false
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        if BinTVBackRegistry.shared.perform(tab: selectedTab) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        if tabHistory.count > 1 {
            tabHistory.removeLast()
            let previous = tabHistory.last ?? BinTVPage.liveTV.rawValue
            selectedTab = previous
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return
        }
        // Root: không còn mức nào phía trước — KHÔNG thoát app, KHÔNG đóng
        // tab, KHÔNG đổi giao diện; chỉ rung nhẹ để xác nhận thao tác đã
        // được nhận (giúp phân biệt "vuốt chưa tới" và "hết chỗ để Back").
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

// MARK: - Back registry: webview tự đăng ký khả năng goBack theo tab

/// Kênh liên lạc tối giản giữa ContentView (sở hữu chuỗi Back) và các
/// WKWebView nằm trong tab (TUBE/PHIM). Mỗi controller webview đăng ký
/// MỘT closure trả về "tôi đã xử lý Back chưa" — chỉ goBack khi
/// `canGoBack` thật, nên không bao giờ Back hụt hay lỗi oan.
final class BinTVBackRegistry {
    static let shared = BinTVBackRegistry()
    private var handlers: [Int: () -> Bool] = [:]
    private let lock = NSLock()

    func register(tab: Int, _ handler: @escaping () -> Bool) {
        lock.lock(); defer { lock.unlock() }
        handlers[tab] = handler
    }

    /// Trả về true nếu tab đó còn mức để back và đã back 1 bước.
    func perform(tab: Int) -> Bool {
        lock.lock(); let h = handlers[tab]; lock.unlock()
        return h?() ?? false
    }
}

// MARK: - Recognizers (nhận diện để gắn đúng 1 lần, không trùng lặp)

/// Long-press gọi menu — 0.35s, touch KHÔNG bị trễ (delaysTouchesBegan
/// = false) nên tap/scroll/video-controls vẫn nhận touch ngay lập tức;
/// `cancelsTouchesInView = true` (mặc định) chỉ huỷ touch KHI long-press
/// thật sự thành công → không "click oan" mở kênh/video khi rời ngón.
final class BinTVMenuLongPressRecognizer: UILongPressGestureRecognizer {
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        delaysTouchesBegan = false
        minimumPressDuration = 0.35
    }
}

/// Vuốt từ mép màn hình — `UIPanGestureRecognizer` thường + **TỰ PHÁT HIỆN**
/// vùng mép (thay cho `UIScreenEdgePanGestureRecognizer`).
///
/// [2026-09-12, build 222 — VÌ SAO PHẢI ĐỔI] `UIScreenEdgePanGestureRecognizer`
/// gắn trên `UIWindow` thường **KHÔNG BAO GIỜ được nhận diện** trên iOS 16:
/// hệ thống đã gắn sẵn các recognizer "gate" vùng mép ngay trên window và
/// chúng được ưu tiên, nên mọi vuốt sát mép bị hệ thống giữ lại — khớp chính
/// xác triệu chứng thực tế trên máy: **long-press (không phải edge) hoạt
/// động, còn "vuốt cạnh trái = Back" thì không**. Cơ chế dưới đây không phụ
/// thuộc recognizer nội bộ: chỉ cần điểm chạm BẮT ĐẦU nằm trong dải
/// `edgeZone` sát mép và vuốt NGANG vượt `minTranslation` → kích hoạt
/// **đúng 1 lần** cho mỗi lần vuốt (`hasFired`).
final class BinTVEdgeSwipeRecognizer: UIPanGestureRecognizer {
    enum Edge: Equatable { case left, right }

    /// Cạnh mà recognizer này phụ trách.
    var edge: Edge = .left
    /// Bề rộng dải bắt đầu tính từ mép màn hình (pt) — tự co theo màn hình.
    var edgeZone: CGFloat = 40
    /// Quãng vuốt NGANG tối thiểu để kích hoạt (pt).
    var minTranslation: CGFloat = 45
    /// Toạ độ X lúc chạm xuống (ghi ở trạng thái .began).
    var startX: CGFloat = 0
    /// Đã kích hoạt cho lần vuốt hiện tại chưa (1 lần vuốt = tối đa 1 lần).
    var hasFired = false
}

// MARK: - Gắn gesture lên UIWindow (phủ cả tab lẫn sheet)

/// Gắn 3 recognizer lên **UIWindow** của app. Window là TỔ TIÊN của mọi
/// view (kể cả sheet PlayerView do SwiftUI present) nên phủ toàn app mà
/// không cần đi tìm UITabBarController (lỗi của bản 219/220 — xem mục A).
///
/// AN TOÀN VỚI GESTURE HIỆN CÓ (delegate `shouldReceive`):
/// • WKWebView (TUBE/PHIM): chính webview đã có recognizer long-press
///   riêng (0.35s/0.4s, cancelsTouchesInView=false) → window long-press
///   KHÔNG nhận touch trong webview (tránh huỷ thao tác trong trang).
/// • UIControl / ô nhập liệu (TextField trong Settings): long-press của
///   hệ thống dùng để chọn/paste → không nhận (tránh cướp mất).
/// • Menu đang mở / player sheet đang mở → không nhận (nút menu và điều
///   khiển video phải nhận touch bình thường).
/// • Edge-swipe: nhường webview có `allowsBackForwardNavigationGestures`
///   (TUBE) để không bị Back/Next 2 lần cho một cái vuốt.
/// Các recognizer vuốt dùng `cancelsTouchesInView = false` +
/// `delaysTouchesBegan = false` → vuốt, scroll, điều khiển video, pinch…
/// hoàn toàn không bị ảnh hưởng.
private struct BinTVWindowGestures: UIViewControllerRepresentable {
    /// Giữ màn hình ≥0.35s → gọi.
    var onLongPress: () -> Void
    /// Vuốt từ cạnh phải vào trong → gọi.
    var onEdgeRight: () -> Void
    /// Vuốt từ cạnh trái sang phải → gọi.
    var onEdgeLeft: () -> Void
    /// long-press có được phép nhận touch lúc này?
    /// (false khi menu đang mở hoặc player sheet đang phủ).
    var longPressAllowed: () -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(onLongPress: onLongPress,
                    onEdgeRight: onEdgeRight,
                    onEdgeLeft: onEdgeLeft,
                    longPressAllowed: longPressAllowed)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        UIViewController()
    }

    func updateUIViewController(_ vc: UIViewController, context: Context) {
        let coordinator = context.coordinator
        // Closure được làm mới sau mỗi lần render → luôn đọc đúng state
        // mới nhất của ContentView (selectedTab/showMenu/showingPlayer).
        coordinator.onLongPress = onLongPress
        coordinator.onEdgeRight = onEdgeRight
        coordinator.onEdgeLeft = onEdgeLeft
        coordinator.longPressAllowed = longPressAllowed
        coordinator.install()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onLongPress: () -> Void
        var onEdgeRight: () -> Void
        var onEdgeLeft: () -> Void
        var longPressAllowed: () -> Bool
        private var retries = 0
        /// Window đang mang recognizer (giữ để không gắn nhầm window tạm thời).
        private weak var installedWindow: UIWindow?

        init(onLongPress: @escaping () -> Void,
             onEdgeRight: @escaping () -> Void,
             onEdgeLeft: @escaping () -> Void,
             longPressAllowed: @escaping () -> Bool) {
            self.onLongPress = onLongPress
            self.onEdgeRight = onEdgeRight
            self.onEdgeLeft = onEdgeLeft
            self.longPressAllowed = longPressAllowed
            super.init()
            // Mỗi lần app trở lại foreground: đảm bảo recognizer vẫn còn
            // (window có thể đã đổi sau khi phát video fullscreen).
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(appDidBecomeActive),
                name: UIApplication.didBecomeActiveNotification,
                object: nil)
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        /// Gắn 3 recognizer lên window — IDEMPOTENT (mỗi loại đúng 1 lần).
        func install() {
            guard let window = resolveWindow() else {
                // Window chưa sẵn sàng lúc mới render (scene chưa active)
                // → thử lại ngắn (tối đa ~6s).
                scheduleRetry()
                return
            }
            installedWindow = window

            if !(window.gestureRecognizers?.contains { $0 is BinTVMenuLongPressRecognizer } ?? false) {
                let press = BinTVMenuLongPressRecognizer(
                    target: self, action: #selector(handleLongPress(_:)))
                press.delegate = self
                window.addGestureRecognizer(press)
            }

            installEdgeSwipe(.right, on: window)
            installEdgeSwipe(.left, on: window)
        }

        private func installEdgeSwipe(_ edge: BinTVEdgeSwipeRecognizer.Edge,
                                      on window: UIWindow) {
            let already = window.gestureRecognizers?.contains {
                guard let existing = $0 as? BinTVEdgeSwipeRecognizer else { return false }
                return existing.edge == edge
            } ?? false
            guard !already else { return }
            let pan = BinTVEdgeSwipeRecognizer(target: self,
                                               action: #selector(handleEdgeSwipe(_:)))
            pan.edge = edge
            pan.edgeZone = Self.edgeZone(for: window)
            pan.maximumNumberOfTouches = 1
            // Touch vẫn được giao NGAY cho webview/video/scroll — recognizer
            // này chỉ "ra quyết định" khi ngón BẮT ĐẦU sát mép màn hình và
            // vuốt ngang đủ xa (cùng triết lý interactive-pop của hệ thống)
            // → không cướp thao tác nội dung.
            pan.cancelsTouchesInView = false
            pan.delaysTouchesBegan = false
            pan.delegate = self
            window.addGestureRecognizer(pan)
        }

        /// Dải mép (pt): ~9% bề rộng màn hình, kẹp [30, 70] — đủ rộng để dễ
        /// vuốt ở landscape (cạnh dài), không lấn vào vùng nội dung.
        private static func edgeZone(for window: UIWindow) -> CGFloat {
            let width = window.bounds.width
            return min(max(width * 0.09, 30), 70)
        }

        /// Window của app — ƯU TIÊN giữ window đã gắn lần đầu để KHÔNG gắn
        /// nhầm vào window tạm thời do WebKit/AVKit tạo khi phát video
        /// fullscreen (window đó cũng có thể trở thành key window).
        private func resolveWindow() -> UIWindow? {
            if let existing = installedWindow { return existing }
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .filter { $0.rootViewController != nil }
            return windows.first { $0.isKeyWindow } ?? windows.first
        }

        private func scheduleRetry() {
            guard retries < 40 else { return }
            retries += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.install()
            }
        }

        // MARK: Actions (mỗi lần vuốt/giữ chỉ fire 1 lần — state .began)

        @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
            guard recognizer.state == .began else { return }
            onLongPress()
        }

        /// Vuốt từ mép — TỰ PHÁT HIỆN (không dùng `UIScreenEdgePanGestureRecognizer`
        /// vì bị hệ thống gate mất quyền ưu tiên trên window, xem chú thích ở
        /// `BinTVEdgeSwipeRecognizer`). Mỗi lần vuốt kích hoạt TỐI ĐA 1 LẦN:
        ///   • .began  : ghi toạ độ X bắt đầu, cập nhật dải mép theo màn hình;
        ///   • .changed: vuốt NGANG (|x| > |y|·1.5) đủ `minTranslation`, điểm
        ///               bắt đầu nằm trong dải mép và đúng hướng → kích hoạt;
        ///   • kết thúc: reset cờ để lần vuốt sau hoạt động tiếp.
        @objc private func handleEdgeSwipe(_ recognizer: BinTVEdgeSwipeRecognizer) {
            guard let window = recognizer.view as? UIWindow else { return }

            if recognizer.state == .began {
                recognizer.startX = recognizer.location(in: window).x
                recognizer.edgeZone = Self.edgeZone(for: window)   // xoay màn hình
                recognizer.hasFired = false
                return
            }
            if recognizer.state == .ended || recognizer.state == .cancelled
                || recognizer.state == .failed {
                recognizer.hasFired = false
                return
            }
            guard recognizer.state == .changed, !recognizer.hasFired else { return }

            let translate = recognizer.translation(in: window)
            // Chỉ nhận vuốt NGANG — vuốt dọc vẫn là cuộn nội dung bình thường.
            guard abs(translate.x) >= recognizer.minTranslation,
                  abs(translate.x) > abs(translate.y) * 1.5 else { return }

            let width = window.bounds.width
            if recognizer.edge == .left
                && recognizer.startX <= recognizer.edgeZone
                && translate.x > 0 {
                recognizer.hasFired = true
                onEdgeLeft()                      // Back 1 bước
                return
            }
            if recognizer.edge == .right
                && recognizer.startX >= width - recognizer.edgeZone
                && translate.x < 0 {
                recognizer.hasFired = true
                onEdgeRight()                     // Hiện menu
            }
        }

        /// App quay lại foreground: gắn lại recognizer nếu window đã đổi
        /// (sau khi phát video fullscreen, window tạm thời biến mất…).
        @objc private func appDidBecomeActive() {
            install()
        }

        // MARK: UIGestureRecognizerDelegate — tránh xung đột gesture

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldReceive touch: UITouch) -> Bool {
            if gestureRecognizer is BinTVMenuLongPressRecognizer {
                // Menu đang mở / player sheet đang phủ → KHÔNG nhận (nút
                // menu và điều khiển video phải nhận touch bình thường,
                // và tránh long-press huỷ touch lên chúng).
                guard longPressAllowed() else { return false }
                // Trong WKWebView: webview đã có recognizer riêng.
                if Self.enclosingWebView(touch.view) != nil { return false }
                // UIControl / TextField (chọn-paste của hệ thống).
                if Self.isControlOrTextInput(touch.view) { return false }
                return true
            }
            if gestureRecognizer is BinTVEdgeSwipeRecognizer {
                // Webview có swipe back/forward nội bộ (TUBE:
                // allowsBackForwardNavigationGestures = true) → nhường để
                // KHÔNG bị Back/Next 2 lần cho cùng một cái vuốt.
                if let webView = Self.enclosingWebView(touch.view),
                   webView.allowsBackForwardNavigationGestures {
                    return false
                }
                return true
            }
            return true
        }

        /// Không chặn bất kỳ recognizer nào khác (scroll, pinch, điều
        /// khiển video, gesture hệ thống… luôn được hoạt động song song).
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            return true
        }

        // MARK: Helpers

        /// Key window hiện tại (iOS 16: lấy qua connectedScenes).
        private static func keyWindow() -> UIWindow? {
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
            return windows.first { $0.isKeyWindow } ?? windows.first
        }

        /// WKWebView chứa view (WKContentView nằm trong WKWebView).
        private static func enclosingWebView(_ view: UIView?) -> WKWebView? {
            var current = view
            while let candidate = current {
                if let webView = candidate as? WKWebView { return webView }
                current = candidate.superview
            }
            return nil
        }

        /// Nằm trong UIControl hoặc ô nhập liệu (UITextField/UITextView) —
        /// nơi long-press thuộc về hệ thống (chọn/paste/menu sửa).
        private static func isControlOrTextInput(_ view: UIView?) -> Bool {
            var current = view
            while let candidate = current {
                if candidate is UIControl || candidate is UITextInput { return true }
                current = candidate.superview
            }
            return false
        }
    }
}
