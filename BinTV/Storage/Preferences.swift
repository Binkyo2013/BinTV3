import Foundation

class Preferences {
    static let shared = Preferences()
    private let defaults = UserDefaults.standard
    private static let channelURLPrefix = "channelURL."

    var lastServerIndex: Int {
        get { defaults.integer(forKey: "lastServer") }
        set { defaults.set(newValue, forKey: "lastServer") }
    }

    var subtitleEnabled: Bool {
        get { defaults.bool(forKey: "subtitleEnabled") }
        set { defaults.set(newValue, forKey: "subtitleEnabled") }
    }

    // MARK: - URL LIVE TV do người dùng chỉnh sửa (persistent)

    func channelURL(id: String) -> String? {
        defaults.string(forKey: Self.channelURLPrefix + id)
    }

    func setChannelURL(id: String, url: String) {
        defaults.set(url, forKey: Self.channelURLPrefix + id)
    }

    /// Xóa toàn bộ URL đã chỉnh sửa (chỉ các key "channelURL.*",
    /// không động vào bất kỳ cài đặt khác).
    func removeAllChannelURLs() {
        let keys = defaults.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(Self.channelURLPrefix) }
        for key in keys {
            defaults.removeObject(forKey: key)
        }
    }
}
