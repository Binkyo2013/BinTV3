import SwiftUI
import UIKit

// =====================================================================
// GestureOverlayMenuView — MENU ĐIỀU HƯỚNG LONG-PRESS DẠNG OVERLAY
// [FIX UI 2026-09-12, build 219]
//
// Thay thế HOÀN TOÀN thanh tab phía trên (BrowserTabBar) và mọi menu
// bar phía dưới: app chạy FULLSCREEN edge-to-edge; nhấn giữ ≥0.35s ở
// BẤT KỲ đâu (gesture UIKit có sẵn — TabChromeController global +
// recognizer riêng của 2 webview, giữ nguyên văn từ các bản trước) →
// lớp phủ MỜ (ultraThinMaterial + dim) hiện LÊN NGAY với 4 NÚT ICON
// THUẦN (KHÔNG nhãn văn bản):
//
//      📺 LIVE TV   🎬 TUBE   🍿 PHIM   ⚙ SETTINGS
//
// - Chạm icon → chuyển trang NGAY + ẩn overlay (cùng một action, không
//   chờ animation xong — binding đổi trực tiếp state của ContentView).
// - Chạm vùng nền mờ → chỉ ẩn overlay (hành vi context-menu chuẩn).
// - Khi overlay ẨN: KHÔNG tồn tại trong view hierarchy (`if isPresented`)
//   → 0% chặn touch của nội dung bên dưới (video/list/webview).
// - SAFE AREA (Rule 1): nền blur phủ TRÀN VIỀN (ignoresSafeArea) nhưng
//   hàng icon nằm TRONG safe area + đệm ngang → notch/Dynamic Island ở
//   cạnh landscape không bao giờ lẹm vào icon.
// - SCALING: kích thước icon/khoảng cách đọc từ \.uiProps (UIProportions)
//   → SE thu nhỏ, Pro Max/iPad phóng to theo cùng hệ tỷ lệ build 218.
// - Icon-only nhưng VẪN có accessibilityLabel cho VoiceOver (chuỗi a11y
//   không phải nhãn hiển thị — không vi phạm yêu cầu "không kèm chữ").
// =====================================================================

/// 4 trang chức năng — rawValue GIỮ ĐÚNG tag 0…3 của TabView từ các bản
/// trước (semantics điều hướng không đổi, chỉ đổi cơ chế kích hoạt).
enum BinTVPage: Int, CaseIterable, Identifiable {
    case liveTV = 0
    case tube = 1
    case phim = 2
    case settings = 3

    var id: Int { rawValue }

    /// SF Symbol — bộ icon nhất quán từ menu cũ (nhận diện chức năng quen
    /// thuộc, không đổi iconology).
    var icon: String {
        switch self {
        case .liveTV: return "tv"
        case .tube: return "film"
        case .phim: return "popcorn"
        case .settings: return "gear"
        }
    }

    /// Màu nhấn từng trang (viền + glyph khi đang active).
    var accent: Color {
        switch self {
        case .liveTV: return .cyan
        case .tube: return Color(red: 1.0, green: 0.27, blue: 0.23)   // đỏ YouTube
        case .phim: return Color(red: 1.0, green: 0.72, blue: 0.2)    // vàng popcorn
        case .settings: return Color(red: 0.62, green: 0.75, blue: 0.95)
        }
    }

    /// CHỈ dùng cho VoiceOver (accessibilityLabel) — KHÔNG hiển thị.
    var a11yTitle: String {
        switch self {
        case .liveTV: return "Live TV"
        case .tube: return "TUBE"
        case .phim: return "PHIM"
        case .settings: return "Settings"
        }
    }
}

/// Overlay mờ + 4 nút icon thuần. ContentView sở hữu state
/// (`selectedTab`, `showMenu`) và truyền binding vào — view này KHÔNG
/// giữ state riêng, KHÔNG đụng logic 4 trang (Rule 2: bảo tồn).
struct GestureOverlayMenuView: View {
    /// Trang đang chọn (0…3 — BinTVPage) — dùng để tô sáng icon active.
    @Binding var selectedTab: Int
    /// Ẩn/hiện overlay — icon tap và nền tap đều set false NGAY LẬP TỨC.
    @Binding var isPresented: Bool
    /// [2026-09-12, build 221] Chọn trang: truyền về ContentView
    /// (`selectTab`) để nơi đó ghi lịch sử Back + mount trang — view này
    /// KHÔNG tự ghi state điều hướng (vẫn không giữ state riêng).
    var onSelect: (Int) -> Void = { _ in }

    @Environment(\.uiProps) private var props

    var body: some View {
        ZStack {
            // ----- Nền: blur vật liệu hệ thống + lớp dim tăng tương phản -----
            // Phủ TRÀN VIỀN (kể cả safe area) — hiệu ứng mờ edge-to-edge đúng
            // chất fullscreen; Material của hệ thống render GPU, hiện tức thì.
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()
            Rectangle()
                .fill(Color.black.opacity(0.35))
                .ignoresSafeArea()
                // Chạm vùng nền (ngoài icon) = đóng menu, KHÔNG chuyển trang
                // (hành vi chuẩn của context menu trên browser/TV).
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            // ----- Hàng 4 icon thuần (KHÔNG chữ) — giữa màn hình ngang -----
            // Nằm TRONG safe area: landscape notch/Dynamic Island ăn vào 2
            // cạnh bên → hàng icon không bao giờ bị lẹm mép (Rule 1).
            HStack(spacing: props.menuSpacing) {
                ForEach(BinTVPage.allCases) { page in
                    iconButton(page)
                }
            }
            .padding(.horizontal, props.contentPadding)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // -----------------------------------------------------------------
    // Một nút icon: nền tròn Circle + glyph SF Symbol + viền nhấn khi
    // active. KHÔNG có nhãn văn bản hiển thị; a11yLabel chỉ cho VoiceOver.
    // -----------------------------------------------------------------
    private func iconButton(_ page: BinTVPage) -> some View {
        let isSelected = (selectedTab == page.rawValue)
        return Button {
            // Chuyển trang + ẩn overlay TRONG CÙNG MỘT ACTION → trang mới
            // hiện ngay ở lần render kế tiếp (phản hồi tức thì, Rule 3).
            // `onSelect` đi qua ContentView.selectTab (ghi lịch sử Back).
            onSelect(page.rawValue)
            dismiss()
        } label: {
            Image(systemName: page.icon)
                .font(.system(size: props.menuGlyphFont, weight: .semibold))
                .foregroundColor(isSelected ? page.accent : .white.opacity(0.92))
                .frame(width: props.menuIconSide, height: props.menuIconSide)
                .background(
                    Circle().fill(Color.white.opacity(isSelected ? 0.18 : 0.08))
                )
                .overlay(
                    Circle().stroke(isSelected ? page.accent.opacity(0.85)
                                               : Color.white.opacity(0.28),
                                    lineWidth: isSelected ? 2 : 1)
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(page.a11yTitle)
    }

    private func dismiss() {
        isPresented = false
    }
}

// =====================================================================
// [build 241 — 2026-09-15] MENU LONG-PRESS TRONG VIDEO PLAYER
// ---------------------------------------------------------------------
// Yêu cầu:
//   • GIỮ màn hình (long press) KHI ĐANG PHÁT VIDEO → KHÔNG tự back/thoát,
//     thay bằng MENU NGỮ CẢNH phủ trên player:
//       - Module PHIM (phim bộ nhiều tập): LIVE TV · TUBE · SETTING ·
//         TẬP · BACK (5 nút).
//       - Module PHIM phim lẻ (1 tập) / LIVE TV / TUBE: LIVE TV · TUBE ·
//         SETTING · BACK (không có TẬP).
//   • TẬP mở danh sách tập của đúng phim đang phát; BACK chỉ lùi ĐÚNG MỘT
//     lớp/màn hình, không thoát app, không về Home.
//
// Vì player có thể là: AVPlayerViewController modal (PHIM native / LIVE TV
// sheet) nằm trong window chính, hoặc video fullscreen của WebKit (TUBE)
// nằm ở WINDOW RIÊNG, nên menu được vẽ thẳng bằng UIKit thêm vào KEY WINDOW
// đang hiển thị (không dùng SwiftUI overlay — không phủ được window của
// fullscreen video). Mọi trình phát ĐĂNG KÝ "ngữ cảnh" với
// BinTVPlayerMenuCenter; mọi recognizer long-press (window + webview + view
// của AVPlayerViewController) đều gọi DUY NHẤT một đường
// `handleLongPress(fallback:)`:
//   - có trình phát đang mở  → hiện menu (idempotent, nhiều recognizer có
//     cùng kích hoạt cũng chỉ hiện đúng 1 lần);
//   - không có trình phát     → chạy fallback = BACK 1 lớp cũ (build 235),
//     giữ NGUYÊN hành vi ngoài player.
// =====================================================================

/// Loại menu hiển thị khi giữ màn hình trong video player.
enum BinTVPlayerMenuKind: Equatable {
    /// Player thuộc module PHIM. `episodes == true` (phim bộ, >1 tập) thì
    /// menu có thêm nút TẬP; phim lẻ 1 tập → giống `.other` (không TẬP).
    case phim(episodes: Bool)
    /// Player thuộc module khác (LIVE TV / TUBE) — menu 4 nút, không TẬP.
    case other
}

/// Ngữ cảnh một video player đang (có thể) mở, do chính trình phát đăng ký.
struct BinTVPlayerMenuContext {
    /// Định danh thay thế được khi đăng ký lại (idempotent).
    let id: String
    /// Ưu tiên khi nhiều context báo active cùng lúc — CAO HƠN xét trước
    /// (player iOS PHIM phủ trên web → được chọn).
    let priority: Int
    /// Trình phát này có ĐANG mở và nhận thao tác không?
    let isActive: () -> Bool
    /// Loại menu (quyết định có nút TẬP hay không) tại thời điểm hiện menu.
    let kind: () -> BinTVPlayerMenuKind
    /// BACK: lùi đúng MỘT lớp (đóng player / thoát fullscreen / goBack 1
    /// bước webview — do từng trình phát tự định nghĩa).
    let onBack: () -> Void
    /// TẬP: mở danh sách tập của phim đang phát (chỉ dùng khi kind có tập).
    let onOpenEpisodes: (() -> Void)?
    /// Rời player để CHUYỂN SANG MODULE KHÁC từ menu: gỡ các lớp player
    /// PHỦ TOÀN MÀN HÌNH (modal/sheet/fullscreen). Player inline nằm trong
    /// trang sẽ tự ẩn theo lớp trang → để nil.
    let onLeaveToOtherTab: (() -> Void)?

    init(id: String,
         priority: Int,
         isActive: @escaping () -> Bool,
         kind: @escaping () -> BinTVPlayerMenuKind,
         onBack: @escaping () -> Void,
         onOpenEpisodes: (() -> Void)? = nil,
         onLeaveToOtherTab: (() -> Void)? = nil) {
        self.id = id
        self.priority = priority
        self.isActive = isActive
        self.kind = kind
        self.onBack = onBack
        self.onOpenEpisodes = onOpenEpisodes
        self.onLeaveToOtherTab = onLeaveToOtherTab
    }
}

/// Sổ đăng ký ngữ cảnh player + trình bày menu long-press (singleton).
final class BinTVPlayerMenuCenter: NSObject {
    static let shared = BinTVPlayerMenuCenter()
    private override init() { super.init() }

    private var contexts: [BinTVPlayerMenuContext] = []
    private let lock = NSLock()
    /// Overlay menu đang hiện (giữ mạnh để không bị huỷ giữa chừng).
    private var overlay: BinTVPlayerMenuOverlay?
    /// Menu đang hiện? Recognizer nền đọc trạng thái này để tạm nhường touch.
    private(set) var isPresented = false
    /// ContentView gắn: chọn LIVE TV/TUBE/SETTING từ menu (đóng player phù
    /// hợp rồi chuyển trang — xem `handlePlayerMenuSelectTab`).
    var onSelectTab: ((Int) -> Void)?

    // MARK: Đăng ký ngữ cảnh

    /// Đăng ký (ghi đè theo id — an toàn khi controller/view tạo lại).
    func register(_ context: BinTVPlayerMenuContext) {
        lock.lock(); defer { lock.unlock() }
        contexts.removeAll { $0.id == context.id }
        contexts.append(context)
        contexts.sort { $0.priority > $1.priority }
    }

    func unregister(id: String) {
        lock.lock(); defer { lock.unlock() }
        contexts.removeAll { $0.id == id }
    }

    /// Ngữ cảnh player đang hoạt động (ưu tiên cao nhất), nil nếu KHÔNG có
    /// trình phát nào đang mở.
    var activeContext: BinTVPlayerMenuContext? {
        lock.lock(); let list = contexts; lock.unlock()
        return list.first { $0.isActive() }
    }

    // MARK: Đầu vào long-press (gọi từ MỌI recognizer)

    /// Giữ màn hình ≥0.35s:
    /// - có player active → HIỆN MENU NGỮ CẢNH (không back, không thoát);
    /// - không có          → `fallback` (BACK 1 lớp như build 235).
    /// Idempotent: menu đang mở thì mọi lần giữ tiếp theo bị BỎ QUA (không
    /// back/chuyển trang chồng).
    func handleLongPress(fallback: @escaping () -> Void) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.handleLongPress(fallback: fallback) }
            return
        }
        guard !isPresented else { return }
        if let context = activeContext, present(context) { return }
        fallback()
    }

    // MARK: Trình bày / gỡ overlay

    private func present(_ context: BinTVPlayerMenuContext) -> Bool {
        guard let window = Self.topWindow() else { return false }
        let kind = context.kind()
        let menu = BinTVPlayerMenuOverlay(
            kind: kind,
            onTab: { [weak self] tab in
                guard let self = self else { return }
                self.dismiss(animated: true)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self.onSelectTab?(tab)
            },
            onEpisodes: { [weak self] in
                guard let self = self else { return }
                self.dismiss(animated: true)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                context.onOpenEpisodes?()
            },
            onBack: { [weak self] in
                guard let self = self else { return }
                self.dismiss(animated: true)
                context.onBack()
            },
            onBackgroundDismiss: { [weak self] in
                self?.dismiss(animated: true)
            },
            onRemoved: { [weak self] in
                // Window bị gỡ (vd. thoát fullscreen TUBE) cũng phải reset.
                self?.isPresented = false
                self?.overlay = nil
            })
        menu.frame = window.bounds
        menu.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(menu)
        menu.alpha = 0
        menu.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
        UIView.animate(withDuration: 0.16, delay: 0,
                       options: [.curveEaseOut, .beginFromCurrentState]) {
            menu.alpha = 1
            menu.transform = .identity
        }
        overlay = menu
        isPresented = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        return true
    }

    func dismiss(animated: Bool) {
        guard let menu = overlay else { return }
        overlay = nil
        isPresented = false
        menu.freezeUserInteraction()
        guard animated else {
            menu.removeFromSuperview()
            return
        }
        UIView.animate(withDuration: 0.14, delay: 0,
                       options: [.curveEaseIn, .beginFromCurrentState],
                       animations: {
            menu.alpha = 0
            menu.transform = CGAffineTransform(scaleX: 0.96, y: 0.96)
        }, completion: { _ in
            menu.removeFromSuperview()
        })
    }

    /// Key window của scene đang active (phủ được cả sheet/modal; video
    /// fullscreen WebKit đẩy window riêng thành key → overlay nằm trên video).
    private static func topWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
        var window: UIWindow?
        for scene in scenes where scene.activationState == .foregroundActive {
            if let key = scene.windows.first(where: { $0.isKeyWindow }) {
                window = key
                break
            }
            if window == nil { window = scene.windows.first }
        }
        if window == nil {
            for scene in scenes {
                if let key = scene.windows.first(where: { $0.isKeyWindow }) {
                    window = key
                    break
                }
            }
        }
        return window ?? scenes.first?.windows.first
    }
}

// MARK: - Overlay UIKit (hàng nút icon + nhãn)

private final class BinTVPlayerMenuOverlay: UIView {

    private struct Item {
        let symbol: String
        let label: String
        let color: UIColor
        let accessibility: String
        let action: () -> Void
    }

    private let onBackgroundDismiss: () -> Void
    private let onRemoved: () -> Void
    private var hasActed = false

    init(kind: BinTVPlayerMenuKind,
         onTab: @escaping (Int) -> Void,
         onEpisodes: @escaping () -> Void,
         onBack: @escaping () -> Void,
         onBackgroundDismiss: @escaping () -> Void,
         onRemoved: @escaping () -> Void) {
        self.onBackgroundDismiss = onBackgroundDismiss
        self.onRemoved = onRemoved
        super.init(frame: .zero)

        accessibilityIdentifier = "BinTV.PlayerMenu.Overlay"

        // Blur vật liệu + dim (phủ tràn, edge-to-edge).
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        blur.translatesAutoresizingMaskIntoConstraints = false
        blur.contentView.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        addSubview(blur)
        NSLayoutConstraint.activate([
            blur.leadingAnchor.constraint(equalTo: leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: trailingAnchor),
            blur.topAnchor.constraint(equalTo: topAnchor),
            blur.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        // Chạm nền mờ (ngoài nút) = đóng menu, KHÔNG điều hướng.
        let dimTap = UITapGestureRecognizer(target: self, action: #selector(backgroundTapped))
        blur.contentView.addGestureRecognizer(dimTap)

        // LIVE TV / TUBE / SETTING (icon + màu đồng bộ với GestureOverlayMenuView)
        var items: [Item] = [
            Item(symbol: "tv", label: "LIVE TV",
                 color: .cyan, accessibility: "LIVE TV") { onTab(BinTVPage.liveTV.rawValue) },
            Item(symbol: "film", label: "TUBE",
                 color: UIColor(red: 1.0, green: 0.27, blue: 0.23, alpha: 1),
                 accessibility: "TUBE") { onTab(BinTVPage.tube.rawValue) },
            Item(symbol: "gear", label: "SETTING",
                 color: UIColor(red: 0.62, green: 0.75, blue: 0.95, alpha: 1),
                 accessibility: "Cài đặt") { onTab(BinTVPage.settings.rawValue) }
        ]
        // TẬP CHỈ khi đang phát PHIM và phim có NHIỀU TẬP (phim bộ). Phim
        // lẻ 1 tập / module khác → không có nút này.
        if case .phim(let episodes) = kind, episodes {
            items.append(Item(symbol: "list.bullet.rectangle",
                              label: "TẬP",
                              color: UIColor(red: 1.0, green: 0.1, blue: 0.72, alpha: 1),
                              accessibility: "Danh sách tập",
                              action: onEpisodes))
        }
        items.append(Item(symbol: "chevron.backward",
                          label: "BACK",
                          color: .white,
                          accessibility: "Quay lại",
                          action: onBack))

        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .center
        row.distribution = .equalSpacing
        row.spacing = 26
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        for item in items {
            row.addArrangedSubview(makeItemView(item))
        }
        NSLayoutConstraint.activate([
            row.centerXAnchor.constraint(equalTo: centerXAnchor),
            row.centerYAnchor.constraint(equalTo: centerYAnchor),
            row.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 18),
            row.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -18),
            row.topAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.topAnchor, constant: 12),
            row.bottomAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
    }

    required init?(coder: NSCoder) { nil }

    /// Một nút: vòng tròn 64pt chứa SF Symbol + nhãn nhỏ bên dưới (icon là
    /// chính, nhãn phụ giúp phân biệt TẬP/BACK trên màn hình TV).
    private func makeItemView(_ item: Item) -> UIView {
        let circle = UIView()
        circle.translatesAutoresizingMaskIntoConstraints = false
        circle.backgroundColor = UIColor.white.withAlphaComponent(0.10)
        circle.layer.cornerRadius = 32
        circle.layer.borderWidth = 1.5
        circle.layer.borderColor = item.color.withAlphaComponent(0.75).cgColor
        circle.isUserInteractionEnabled = false

        let glyph = UIImageView()
        glyph.translatesAutoresizingMaskIntoConstraints = false
        glyph.contentMode = .scaleAspectFit
        glyph.tintColor = item.color
        let config = UIImage.SymbolConfiguration(pointSize: 27, weight: .semibold)
        glyph.image = UIImage(systemName: item.symbol, withConfiguration: config)?
            .withRenderingMode(.alwaysTemplate)
        circle.addSubview(glyph)
        NSLayoutConstraint.activate([
            circle.widthAnchor.constraint(equalToConstant: 64),
            circle.heightAnchor.constraint(equalToConstant: 64),
            glyph.centerXAnchor.constraint(equalTo: circle.centerXAnchor),
            glyph.centerYAnchor.constraint(equalTo: circle.centerYAnchor),
            glyph.widthAnchor.constraint(equalToConstant: 34),
            glyph.heightAnchor.constraint(equalToConstant: 34)
        ])

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = item.label
        label.textColor = .white
        label.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        label.textAlignment = .center
        label.isUserInteractionEnabled = false

        let stack = UIStackView(arrangedSubviews: [circle, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isAccessibilityElement = true
        stack.accessibilityLabel = item.accessibility
        stack.accessibilityTraits = .button

        let tap = UITapGestureRecognizer(target: self, action: #selector(itemTapped(_:)))
        stack.addGestureRecognizer(tap)
        stack.isUserInteractionEnabled = true
        objc_setAssociatedObject(stack, &BinTVPlayerMenuOverlay.actionKey, ItemAction(item.action),
                                 objc_AssociationPolicy.OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        return stack
    }

    /// Wrapper để gắn closure vào view (thay cho subclass từng nút).
    private final class ItemAction: NSObject {
        let block: () -> Void
        init(_ block: @escaping () -> Void) { self.block = block }
    }
    private static var actionKey: UInt8 = 0

    @objc private func itemTapped(_ recognizer: UITapGestureRecognizer) {
        guard !hasActed, let view = recognizer.view,
              let action = objc_getAssociatedObject(view, &BinTVPlayerMenuOverlay.actionKey) as? ItemAction else { return }
        hasActed = true
        action.block()
    }

    @objc private func backgroundTapped() {
        guard !hasActed else { return }
        hasActed = true
        onBackgroundDismiss()
    }

    /// Khoá tương tác sau khi đã chọn (chống chạm lặp sinh back/đổi tab 2 lần).
    func freezeUserInteraction() {
        hasActed = true
        isUserInteractionEnabled = false
    }

    override func willMove(toSuperview newSuperview: UIView?) {
        super.willMove(toSuperview: newSuperview)
        // Window chứa overlay bị tháo (thoát fullscreen TUBE…) → reset center.
        if newSuperview == nil { onRemoved() }
    }
}
