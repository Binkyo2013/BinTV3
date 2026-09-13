import Foundation

/// Một kênh LIVE TV.
/// - defaultURL: URL mặc định (không bao giờ bị ghi đè bởi chỉnh sửa của người dùng).
/// - currentURL: URL đang dùng — người dùng có thể sửa trong Settings, được lưu
///   persistent qua Preferences (UserDefaults).
struct Channel: Identifiable, Codable {
    let id: String
    let name: String
    var category: String
    let defaultURL: String
    var currentURL: String
    var isLive: Bool
}
