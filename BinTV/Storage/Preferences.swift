import Foundation

// =====================================================================
// [build 243 — 2026-09-17] LỰA CHỌN TRÌNH PHÁT CỦA MODULE PHIM
//
// VẤN ĐỀ: module PHIM có HAI trình phát (trình phát TÍCH HỢP = thẻ <video>
// trong web app app.js, và trình phát iOS = AVPlayerViewController của
// `PhimNativePlayerController`). Trước đây MỌI lần phát đều bắt đầu bằng
// trình phát tích hợp rồi "leo thang" sang trình phát iOS khi nguồn lỗi,
// và khi leo thang thẻ <video> VẪN GIỮ `src` → HAI player cùng tải MỘT URL
// (tốn băng thông, load lâu, dễ xung đột).
//
// CÁCH SỬA: người dùng CHỌN MỘT trình phát trong SETTING → lựa chọn được
// lưu ở UserDefaults (giữ qua các lần đóng/mở app) → module PHIM chỉ khởi
// tạo/nạp ĐÚNG trình phát đó. Lần phát ĐẦU TIÊN khi chưa có lựa chọn thì
// KHÔNG nạp player nào mà chuyển sang SETTING để chọn (xem
// `PhimPlayerChoiceCenter`), chọn xong tự quay lại PHIM và phát tiếp đúng
// phim/tập vừa chọn.
// =====================================================================

/// Hai trình phát hiện có của module PHIM. Tên hiển thị giữ ĐÚNG tên đang
/// dùng trong source ("trình phát tích hợp" / "trình phát iOS") — không đổi.
enum PhimPlayerChoice: String, CaseIterable, Identifiable {
    /// TRÌNH PHÁT TÍCH HỢP — thẻ `<video>` trong web app PHIM (app.js +
    /// hls.js), có HUD/phụ đề/chọn tập của app.
    case integrated
    /// TRÌNH PHÁT iOS — `AVPlayerViewController` (AVFoundation), engine giải
    /// mã rộng hơn HTML5 của WebKit.
    case native

    var id: String { rawValue }

    /// Nhãn hiển thị trong SETTING (dùng đúng chữ đang có trong source).
    var title: String {
        switch self {
        case .integrated: return "Trình phát tích hợp"
        case .native: return "Trình phát iOS"
        }
    }

    /// Mô tả ngắn cho người dùng (giải thích khác biệt, không đổi hành vi).
    var detail: String {
        switch self {
        case .integrated:
            return "Thẻ <video> trong module PHIM — HUD, phụ đề và chọn tập của app."
        case .native:
            return "AVPlayerViewController — giải mã rộng hơn (MKV, AC3/EAC3/DTS)."
        }
    }
}

extension Notification.Name {
    /// Web app PHIM báo "chưa có trình phát được chọn" → ContentView chuyển
    /// sang tab SETTING, SettingsView mở mục "Trình phát PHIM".
    static let binTVPhimPlayerChoiceNeeded =
        Notification.Name("com.bintv.phim.playerChoice.needed")
    /// Người dùng vừa LƯU lựa chọn trong SETTING → ContentView quay lại tab
    /// PHIM (nếu có phim đang chờ) và PhimWebView đẩy giá trị sang web app.
    static let binTVPhimPlayerChoiceSaved =
        Notification.Name("com.bintv.phim.playerChoice.saved")
}

/// Điều phối việc chọn trình phát PHIM giữa 3 nơi:
///   • `PhimController` (web app PHIM) — phát hiện "chưa có lựa chọn";
///   • `ContentView` — chuyển tab PHIM ↔ SETTING;
///   • `SettingsView` — hiển thị mục "Trình phát PHIM" và lưu lựa chọn.
/// Chỉ là cầu nối trạng thái: giá trị THẬT nằm ở `Preferences` (UserDefaults).
final class PhimPlayerChoiceCenter {
    static let shared = PhimPlayerChoiceCenter()

    private init() {}

    /// Tiêu đề phim/tập đang chờ chọn trình phát (hiện trong SETTING để
    /// người dùng biết mình sẽ quay lại phát cái gì).
    private(set) var pendingTitle: String = ""
    /// Đang có yêu cầu chọn trình phát từ module PHIM?
    private(set) var hasPendingRequest = false

    /// Lựa chọn hiện tại (`nil` = chưa chọn lần nào).
    var current: PhimPlayerChoice? { Preferences.shared.phimPlayerChoice }

    /// Web app PHIM yêu cầu chọn trình phát (message `needPlayerChoice`).
    func requestSelection(title: String) {
        pendingTitle = title
        hasPendingRequest = true
        PhimDebugLog.step("PLAYER-CHOICE", "needPlayerChoice", "recv",
                          "chưa có trình phát được lưu → mở SETTING; title=\(title)")
        NotificationCenter.default.post(name: .binTVPhimPlayerChoiceNeeded,
                                        object: self,
                                        userInfo: ["title": title])
    }

    /// Người dùng chọn một trình phát trong SETTING: lưu + báo mọi nơi.
    /// - Parameter resume: `true` khi có phim/tập đang chờ → ContentView quay
    ///   lại tab PHIM và web app phát tiếp đúng phim/tập đó.
    @discardableResult
    func save(_ choice: PhimPlayerChoice) -> PhimPlayerChoice {
        Preferences.shared.phimPlayerChoice = choice
        let resume = hasPendingRequest
        let title = pendingTitle
        hasPendingRequest = false
        pendingTitle = ""
        PhimDebugLog.step("PLAYER-CHOICE", "save", "ok",
                          "choice=\(choice.rawValue) resume=\(resume) title=\(title)")
        NotificationCenter.default.post(name: .binTVPhimPlayerChoiceSaved,
                                        object: self,
                                        userInfo: ["choice": choice.rawValue,
                                                   "resume": resume,
                                                   "title": title])
        return choice
    }

    /// Người dùng rời SETTING mà KHÔNG chọn → bỏ yêu cầu đang chờ
    /// (lần bấm phim kế tiếp sẽ hỏi lại — không bao giờ tự ý chọn thay).
    func cancelPending() {
        guard hasPendingRequest else { return }
        hasPendingRequest = false
        pendingTitle = ""
        PhimDebugLog.step("PLAYER-CHOICE", "cancelPending", "ok", "người dùng chưa chọn")
    }
}

class Preferences {
    static let shared = Preferences()
    private let defaults = UserDefaults.standard
    private static let channelURLPrefix = "channelURL."
    /// Khoá lưu trình phát của module PHIM — UserDefaults nên giữ nguyên qua
    /// các lần đóng/mở app, chỉ đổi khi người dùng chủ động chọn lại.
    private static let phimPlayerChoiceKey = "phimPlayerChoice"

    var lastServerIndex: Int {
        get { defaults.integer(forKey: "lastServer") }
        set { defaults.set(newValue, forKey: "lastServer") }
    }

    var subtitleEnabled: Bool {
        get { defaults.bool(forKey: "subtitleEnabled") }
        set { defaults.set(newValue, forKey: "subtitleEnabled") }
    }

    // MARK: - TRÌNH PHÁT PHIM (persistent)

    /// Trình phát người dùng đã chọn cho module PHIM.
    /// `nil` = CHƯA chọn lần nào (lần phát phim đầu tiên sẽ chuyển sang
    /// SETTING để chọn). Gán `nil` để xoá lựa chọn (chỉ dùng cho test/reset).
    var phimPlayerChoice: PhimPlayerChoice? {
        get {
            guard let raw = defaults.string(forKey: Self.phimPlayerChoiceKey) else { return nil }
            return PhimPlayerChoice(rawValue: raw)
        }
        set {
            if let newValue = newValue {
                defaults.set(newValue.rawValue, forKey: Self.phimPlayerChoiceKey)
            } else {
                defaults.removeObject(forKey: Self.phimPlayerChoiceKey)
            }
        }
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
