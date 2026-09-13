import SwiftUI
import CoreGraphics

// =====================================================================
// UIProportions — HỆ TỶ LỆ THÍCH ỨNG (Adaptive Scaling) cho chế độ TV
// LANDSCAPE [FIX UI 2026-09-12].
//
// VẤN ĐỀ CŨ: kích thước chrome (nút, cột, padding, font icon) hard-code
// point cố định (vd cột Settings 230pt, nút nổi 40×40, icon 22pt) → trên
// iPhone SE landscape (568×320pt) chúng chiếm tỷ lệ màn hình LỚN HƠN hẳn
// so với 14 Pro Max (932×430pt) → "icon vỡ bố cục / khó thao tác", giao
// diện không tự thu phóng theo máy.
//
// GIẢI PHÁP: MỌI kích thước chrome đi qua `UIProportions` — tính MỘT lần
// từ GeometryReader của window (ContentView), phát xuống toàn cây view qua
// EnvironmentKey `\.uiProps`. Hệ số scale neo theo CHIỀU CAO landscape
// (chiều khan hiếm của màn ngang) với mốc thiết kế 844×390 (iPhone 14
// landscape):
//   - iPhone SE (2/3):      568×320 → scale 0.82 (chrome thu gọn ~18%)
//   - iPhone 13/14:         844×390 → scale 1.00 (chuẩn thiết kế)
//   - iPhone 14/15 Pro Max: 932×430 → scale 1.10
//   - iPad 11" landscape:  1180×820 → scale 1.15 (kẹp trần, không phóng vô hạn)
// Lưới nội dung dùng GridItem(.adaptive) nhân cùng scale → số cột tự tính
// theo bề rộng thật (SE ~3 cột, Pro Max ~6 cột) — không hard-code số cột.
//
// NGUYÊN TẮC:
// - Chỉ scale CHROME do app tự vẽ (tab bar, card icon, nút nổi, cột
//   Settings). KHÔNG scale nội dung hệ thống (Form, sheet, webview,
//   AVPlayer) — chúng đã tự thích ứng.
// - Không chạm orientation: file này thuần layout metrics, không request
//   xoay màn hình (cơ chế landscape 3 lớp giữ nguyên 100%).
// - API iOS 15 an toàn (EnvironmentKey cổ điển, không Observation/17+).
// =====================================================================

struct UIProportions: Equatable {
    /// Kích thước window thật (điểm) tại thời điểm layout.
    let size: CGSize
    /// Hệ số scale chrome, kẹp [0.82, 1.15] — neo theo chiều cạn của
    /// landscape (chiều cao), mốc 390pt (iPhone 14 landscape).
    let scale: CGFloat

    init(size: CGSize) {
        let w = max(size.width, 1)
        let h = max(size.height, 1)
        self.size = CGSize(width: w, height: h)
        // Landscape (w ≥ h): neo theo chiều cao / 390.
        // Portrait transient (w < h — khoảnh khắc hệ thống chưa xoay xong,
        // hoặc iPad Stage Manager cửa sổ dọc): neo theo chiều rộng / 844 để
        // scale không nhảy cực đoan; layout vẫn an toàn vì mọi thứ là
        // relative.
        let raw: CGFloat
        if w >= h {
            raw = h / 390.0
        } else {
            raw = w / 844.0
        }
        self.scale = min(max(raw, 0.82), 1.15)
    }

    /// Scale một giá trị thiết kế (pt @844×390) và làm tròn 0.5pt để nét
    /// vẽ không bị mờ do fractional pixel.
    func s(_ value: CGFloat) -> CGFloat {
        return (value * scale * 2.0).rounded() / 2.0
    }

    // MARK: Tab strip (browser-style)

    /// Chiều cao thanh tab: 44pt chuẩn → 36.1 (SE) … 50.6 (Pro Max/kẹp).
    var tabBarHeight: CGFloat { s(44) }
    /// Bề rộng tối thiểu một tab (đủ cho icon + tiêu đề ngắn + nút ×).
    var tabMinWidth: CGFloat { s(112) }
    /// Bề rộng tối đa — tiêu đề dài bị cắt ellipsis, không đẩy strip tràn.
    var tabMaxWidth: CGFloat { s(184) }
    var tabIconFont: CGFloat { s(14) }
    var tabTitleFont: CGFloat { s(13) }
    var closeHitSide: CGFloat { max(s(26), 26) }   // touch target ≥ 26pt (không thu nhỏ dưới ngưỡng thao tác)
    var newTabButtonSide: CGFloat { s(34) }

    // MARK: Lưới icon (Live TV cards + New Tab Page speed-dial)

    /// Cột adaptive của lưới card: SE ~3 cột, 14 ~5 cột, Pro Max ~6 cột.
    var gridItemMin: CGFloat { s(140) }
    var gridItemMax: CGFloat { s(260) }
    var gridSpacing: CGFloat { s(10) }
    var cardIconFont: CGFloat { s(22) }
    var cardCornerRadius: CGFloat { s(12) }
    var cardPadding: CGFloat { s(10) }
    var contentPadding: CGFloat { s(12) }
    /// Speed-dial của New Tab Page: ô lớn hơn lưới kênh một chút.
    var ntpItemMin: CGFloat { s(158) }
    var ntpItemMax: CGFloat { s(280) }
    var ntpIconFont: CGFloat { s(40) }
    var ntpCardHeight: CGFloat { s(116) }

    // MARK: Chrome nội dung tab

    /// Nút nổi TUBE (loop/next/fullscreen): 40pt chuẩn → 32.8 (SE) … 46.
    var controlButtonSide: CGFloat { s(40) }
    var controlIconFont: CGFloat { s(17) }
    var controlPadding: CGFloat { s(14) }

    /// Cột trái Settings: tỷ lệ ~27.3% bề rộng landscape (230/844 — đúng
    /// giá trị thiết kế cũ tại mốc iPhone 14), kẹp [180, 300] đã scale để
    /// Form bên phải luôn còn ≥ ~60% bề rộng trên SE.
    var settingsColumnWidth: CGFloat {
        let proportional = size.width * (230.0 / 844.0)
        return min(max(proportional, s(180)), s(300))
    }
    var settingsIconFrame: CGFloat { s(24) }

    // MARK: Overlay menu long-press (build 219 — icon-only, fullscreen)

    /// Cạnh nút tròn của overlay menu: 68pt chuẩn → SE 55.8 (4 nút +
    /// spacing ≈ 287pt < 568pt bề ngang — luôn một hàng, không lẹm
    /// notch) → Pro Max 75 → iPad 78.2 (kẹp trần scale).
    var menuIconSide: CGFloat { s(68) }
    /// Cỡ glyph SF Symbol trong nút tròn (~41% cạnh nút — tỷ lệ chuẩn
    /// icon-in-circle của HIG).
    var menuGlyphFont: CGFloat { s(28) }
    /// Khoảng cách giữa 4 nút — landscape màn rộng thì thoáng, SE thì gọn.
    var menuSpacing: CGFloat { s(26) }
}

// MARK: - Environment injection

private struct UIProportionsKey: EnvironmentKey {
    /// Mặc định = mốc thiết kế iPhone 14 landscape (host chưa cung cấp
    /// GeometryReader — vd preview — vẫn render đúng tỷ lệ chuẩn).
    static let defaultValue = UIProportions(size: CGSize(width: 844, height: 390))
}

extension EnvironmentValues {
    /// Hệ tỷ lệ thích ứng của app (xem UIProportions). ContentView tính từ
    /// GeometryReader và inject một lần cho toàn cây view.
    var uiProps: UIProportions {
        get { self[UIProportionsKey.self] }
        set { self[UIProportionsKey.self] = newValue }
    }
}
