import SwiftUI

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
