import SwiftUI

// =====================================================================
// LIVE TV — bố cục LANDSCAPE (chế độ TV):
//
// - Lưới card kênh ADAPTIVE: số cột tự tính theo chiều rộng màn hình
//   (GridItem.adaptive ~140-260pt → 14 Pro Max landscape ~932pt cho
//   ~6 cột; màn hẹp hơn tự giảm cột) — tận dụng TOÀN BỘ chiều ngang,
//   không hard-code kích thước cho 1 model máy, không khoảng trống đen.
// - Tap card = mở player (PlayerView sheet từ ContentView — flow + logic
//   stream GIỮ NGUYÊN 100%, không đổi URL/logic LIVE TV).
// - Player mở bằng sheet fullscreen → "player đủ lớn" theo yêu cầu,
//   không phải chạy 1 stream preview liên tục trong nền (không đổi kiến
//   trúc streaming đang hoạt động).
// =====================================================================

struct LiveTVView: View {
    let channels: [Channel]
    let onSelect: (Channel) -> Void

    /// [FIX UI 2026-09-12] Hệ tỷ lệ thích ứng (UIProportions) inject từ
    /// ContentView — kích thước card/icon/padding scale theo màn hình
    /// (SE 0.82 → Pro Max 1.10 → iPad 1.15), hết cảnh "icon vỡ bố cục".
    @Environment(\.uiProps) private var props

    /// Cột adaptive nhân scale: SE landscape ~3 cột; 14 ~5 cột;
    /// 14 Pro Max ~6 cột; iPad/màn rộng → nhiều cột hơn — tận dụng
    /// TOÀN BỘ chiều ngang, không hard-code kích thước cho 1 model máy.
    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: props.gridItemMin, maximum: props.gridItemMax),
                  spacing: props.gridSpacing)]
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: props.gridSpacing) {
                ForEach(channels) { ch in
                    channelCard(ch)
                }
            }
            .padding(props.contentPadding)
        }
        .navigationTitle("Live TV")
    }

    private func channelCard(_ ch: Channel) -> some View {
        Button(action: { onSelect(ch) }) {
            VStack(alignment: .leading, spacing: props.s(8)) {
                Image(systemName: ch.isLive ? "antenna.radiowaves.left.and.right" : "film")
                    .font(.system(size: props.cardIconFont, weight: .semibold))
                    .foregroundColor(ch.isLive ? .cyan : .white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, props.s(4))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ch.name)
                        .font(.system(size: props.s(16), weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Text(ch.category)
                        .font(.system(size: props.s(12)))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(props.cardPadding)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: props.cardCornerRadius, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: props.cardCornerRadius, style: .continuous)
                    .stroke(ch.isLive ? Color.cyan.opacity(0.55) : Color.white.opacity(0.14),
                            lineWidth: 1.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: props.cardCornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
