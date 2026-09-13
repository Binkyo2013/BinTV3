import Foundation
import Combine

class StreamService: ObservableObject {
    @Published var channels: [Channel] = []

    /// Danh sách LIVE TV MẶC ĐỊNH (8 kênh). Đây là defaultURL — không bao giờ
    /// bị ghi đè khi người dùng sửa currentURL trong Settings.
    static let defaultChannels: [Channel] = [
        Channel(id: "vtv1",
                name: "VTV1",
                category: "Quốc gia",
                defaultURL: "https://live-a.fptplay53.net/live/media/vtv1/live247-hls-avc/index.m3u8",
                currentURL: "https://live-a.fptplay53.net/live/media/vtv1/live247-hls-avc/index.m3u8",
                isLive: true),
        Channel(id: "vtv2",
                name: "VTV2",
                category: "Quốc gia",
                defaultURL: "https://live-a.fptplay53.net/live/media/vtv2/live247-hls-avc/index.m3u8",
                currentURL: "https://live-a.fptplay53.net/live/media/vtv2/live247-hls-avc/index.m3u8",
                isLive: true),
        Channel(id: "vtv3",
                name: "VTV3",
                category: "Quốc gia",
                defaultURL: "https://live-a.fptplay53.net/live/media/vtv3/live247-hls-avc/index.m3u8",
                currentURL: "https://live-a.fptplay53.net/live/media/vtv3/live247-hls-avc/index.m3u8",
                isLive: true),
        Channel(id: "vtv6",
                name: "VTV6",
                category: "Quốc gia",
                defaultURL: "https://live-a.fptplay53.net/live/media/vtv6/live247-hls-avc/index.m3u8",
                currentURL: "https://live-a.fptplay53.net/live/media/vtv6/live247-hls-avc/index.m3u8",
                isLive: true),
        Channel(id: "fifaplus",
                name: "FIFA+",
                category: "Thể thao",
                defaultURL: "https://d2w9q46ikgrcwx.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-of5cbk3sav3w5/v1/sysdata_s_p_a_fifa_7/samsungheadend_us/latest/main/hls/playlist.m3u8",
                currentURL: "https://d2w9q46ikgrcwx.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-of5cbk3sav3w5/v1/sysdata_s_p_a_fifa_7/samsungheadend_us/latest/main/hls/playlist.m3u8",
                isLive: true),
        Channel(id: "foxsport1",
                name: "Foxsport1",
                category: "Thể thao",
                defaultURL: "http://85.237.89.160:9590/usa-s/FOX-SPORTS-1/index.m3u8",
                currentURL: "http://85.237.89.160:9590/usa-s/FOX-SPORTS-1/index.m3u8",
                isLive: true),
        Channel(id: "foxsport2",
                name: "Foxsport2",
                category: "Thể thao",
                defaultURL: "https://tvsen7.aynascope.net/foxsports2/index.m3u8",
                currentURL: "https://tvsen7.aynascope.net/foxsports2/index.m3u8",
                isLive: true),
        Channel(id: "sport3",
                name: "Sport3",
                category: "Thể thao",
                defaultURL: "http://stream.mcquack.net/393/index.m3u8",
                currentURL: "http://stream.mcquack.net/393/index.m3u8",
                isLive: true)
    ]

    /// Load danh sách kênh: bắt đầu từ 8 kênh mặc định, áp dụng URL mà người
    /// dùng đã chỉnh sửa trước đó (lưu trong Preferences) lên currentURL.
    func loadChannels() async {
        await MainActor.run {
            channels = Self.defaultChannels.map { ch in
                if let saved = Preferences.shared.channelURL(id: ch.id), !saved.isEmpty {
                    var customized = ch
                    customized.currentURL = saved
                    return customized
                }
                return ch
            }
        }
    }

    /// Người dùng lưu URL mới cho 1 kênh (gọi từ Settings, main thread).
    func updateURL(id: String, url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Preferences.shared.setChannelURL(id: id, url: trimmed)
        if let index = channels.firstIndex(where: { $0.id == id }) {
            channels[index].currentURL = trimmed
        }
    }

    /// "Khôi phục mặc định": currentURL → defaultURL cho TẤT CẢ kênh,
    /// xóa các URL đã chỉnh trong Preferences. Không động vào cài đặt khác.
    func resetURLs() {
        Preferences.shared.removeAllChannelURLs()
        channels = Self.defaultChannels
    }
}
