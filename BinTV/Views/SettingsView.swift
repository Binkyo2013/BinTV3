import SwiftUI
import Combine

// =====================================================================
// SETTINGS — bố cục 2 cột LANDSCAPE (chế độ TV):
//   Trái: danh sách mục (Playback / Trình phát PHIM / Network / Live TV —
//         URL kênh)
//   Phải: nội dung mục đã chọn (Form — giữ nguyên 100% logic hiện tại:
//         Preferences, ChannelURLEditorRow, xác nhận khôi phục mặc định).
// Chỉ thay đổi BỐ CỤC — không đổi logic Settings.
//
// [build 243 — 2026-09-17] THÊM MỤC "TRÌNH PHÁT PHIM":
//   Module PHIM có HAI trình phát (trình phát TÍCH HỢP = thẻ <video> trong
//   web app; trình phát iOS = AVPlayerViewController). Trước đây cả hai đều
//   được nạp cho một lần phát → tốn băng thông, load lâu, dễ xung đột.
//   Nay người dùng CHỌN MỘT; lựa chọn lưu UserDefaults (Preferences) nên giữ
//   qua các lần đóng/mở app. Lần phát phim ĐẦU TIÊN khi chưa có lựa chọn thì
//   module PHIM KHÔNG nạp player nào mà chuyển sang đây (`PhimPlayerChoiceCenter`
//   → notification .binTVPhimPlayerChoiceNeeded): chọn xong tự quay lại PHIM
//   và phát tiếp đúng phim/tập vừa chọn. Mục này LUÔN vào được từ SETTING để
//   đổi trình phát bất cứ lúc nào.
// =====================================================================

struct SettingsView: View {
    @EnvironmentObject var streamService: StreamService
    /// [FIX UI 2026-09-12] Tỷ lệ thích ứng: cột trái KHÔNG còn hard-code
    /// 230pt (SE landscape 568pt bị chiếm 40% bề rộng — Form phải chật,
    /// icon vỡ bố cục) → ~27.3% bề rộng window, kẹp [180, 300] đã scale.
    @Environment(\.uiProps) private var props
    @State private var subtitleOn = Preferences.shared.subtitleEnabled
    @State private var serverIdx = Preferences.shared.lastServerIndex
    @State private var showResetConfirm = false
    /// Mục đang chọn ở cột phải (mặc định: Playback).
    @State private var selectedSection: SettingsSection = .playback
    /// [build 243] Trình phát PHIM đã lưu (`nil` = người dùng chưa chọn).
    @State private var phimPlayerChoice: PhimPlayerChoice? = Preferences.shared.phimPlayerChoice
    /// [build 243] Phim/tập đang chờ chọn trình phát (hiện để người dùng biết
    /// mình sẽ quay lại phát cái gì) — `nil` khi vào SETTING bình thường.
    @State private var playerChoicePrompt: String? = nil

    private enum SettingsSection: Int, CaseIterable, Identifiable {
        case playback, phimPlayer, network, urls
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .playback: return "Playback"
            case .phimPlayer: return "Trình phát PHIM"
            case .network: return "Network"
            case .urls: return "Live TV — URL kênh"
            }
        }
        var icon: String {
            switch self {
            case .playback: return "play.rectangle"
            case .phimPlayer: return "film"
            case .network: return "network"
            case .urls: return "tv"
            }
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            // ===== Cột trái: danh sách mục (TV style — scale theo máy) =====
            VStack(alignment: .leading, spacing: props.s(8)) {
                ForEach(SettingsSection.allCases) { section in
                    Button {
                        selectedSection = section
                    } label: {
                        HStack(spacing: props.s(10)) {
                            Image(systemName: section.icon)
                                .font(.system(size: props.s(15), weight: .medium))
                                .frame(width: props.settingsIconFrame)
                            Text(section.title)
                                .font(.system(size: props.s(14.5)))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Spacer(minLength: 0)
                        }
                        .foregroundColor(selectedSection == section ? .black : .white)
                        .padding(.horizontal, props.s(12))
                        .padding(.vertical, props.s(10))
                        .background(
                            RoundedRectangle(cornerRadius: props.s(10), style: .continuous)
                                .fill(selectedSection == section
                                      ? Color.white
                                      : Color.white.opacity(0.07))
                        )
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
            .padding(props.s(10))
            .frame(width: props.settingsColumnWidth)
            .frame(maxHeight: .infinity)
            .background(Color.black.opacity(0.25))

            // ===== Cột phải: nội dung mục đã chọn (giữ nguyên logic) =====
            Form {
                if selectedSection == .playback {
                    Section(header: Text("Playback")) {
                        Toggle("Subtitles", isOn: $subtitleOn)
                            .onChange(of: subtitleOn) { Preferences.shared.subtitleEnabled = $0 }
                    }
                }
                if selectedSection == .phimPlayer {
                    phimPlayerSection
                }
                if selectedSection == .network {
                    Section(header: Text("Network")) {
                        Stepper("Default Server: \(serverIdx+1)", value: $serverIdx, in: 0...3)
                            .onChange(of: serverIdx) { Preferences.shared.lastServerIndex = $0 }
                    }
                }
                if selectedSection == .urls {
                    Section(header: Text("Live TV — URL kênh")) {
                        ForEach(streamService.channels) { ch in
                            // .id(currentURL): khi URL đổi (sau khi Lưu hoặc sau khi
                            // Khôi phục mặc định) → row tạo lại với draft mới nhất.
                            ChannelURLEditorRow(channel: ch)
                                .id(ch.currentURL)
                        }
                        Button("Khôi phục mặc định", role: .destructive) {
                            showResetConfirm = true
                        }
                    }
                }
            }
        }
        .navigationTitle("Settings")
        // [build 243] Mục PHIM yêu cầu chọn trình phát → mở đúng mục + hiện
        // phim/tập đang chờ. (Trang SETTING có thể chưa mount khi notification
        // bắn ra → `onAppear`/`syncPhimPlayerChoiceState` bắt lại trường hợp đó.)
        .onReceive(NotificationCenter.default.publisher(for: .binTVPhimPlayerChoiceNeeded)) { note in
            let title = (note.userInfo?["title"] as? String) ?? ""
            selectedSection = .phimPlayer
            phimPlayerChoice = Preferences.shared.phimPlayerChoice
            playerChoicePrompt = title.isEmpty ? "phim vừa chọn" : title
        }
        .onAppear { syncPhimPlayerChoiceState() }
        .confirmationDialog(
            "Khôi phục URL mặc định cho tất cả kênh?",
            isPresented: $showResetConfirm,
            titleVisibility: .visible
        ) {
            Button("Khôi phục tất cả", role: .destructive) {
                streamService.resetURLs()
            }
            Button("Hủy", role: .cancel) {}
        } message: {
            Text("URL đã chỉnh sửa sẽ trở về mặc định cho tất cả kênh. Các cài đặt khác không bị ảnh hưởng.")
        }
    }

    // =====================================================================
    // [build 243] MỤC "TRÌNH PHÁT PHIM"
    // Hai lựa chọn dùng ĐÚNG tên đang có trong source ("Trình phát tích hợp"
    // / "Trình phát iOS"). Bấm là LƯU NGAY (UserDefaults) — không có nút Lưu
    // riêng nên không thể rơi vào trạng thái "đã bấm mà chưa lưu".
    // =====================================================================
    private var phimPlayerSection: some View {
        Section(header: Text("Trình phát PHIM")) {
            if let prompt = playerChoicePrompt {
                Text("Chọn trình phát để tiếp tục phát: \(prompt)")
                    .font(.footnote)
                    .foregroundColor(.orange)
            }
            if phimPlayerChoice == nil {
                Text("Chưa chọn trình phát — module PHIM chưa tải video nào cho tới khi bạn chọn.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            ForEach(PhimPlayerChoice.allCases) { choice in
                Button {
                    selectPhimPlayer(choice)
                } label: {
                    HStack(alignment: .center, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.title)
                                .font(.body)
                                .foregroundColor(.primary)
                            Text(choice.detail)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer(minLength: 0)
                        if phimPlayerChoice == choice {
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentColor)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            Text("Chỉ trình phát được chọn mới tải video; trình phát còn lại không được khởi tạo.")
                .font(.footnote)
                .foregroundColor(.secondary)
        }
    }

    /// Đọc lại trạng thái từ nơi lưu THẬT (UserDefaults + trung tâm điều phối)
    /// — cần khi trang SETTING vừa được mount bởi chính yêu cầu chọn trình phát.
    private func syncPhimPlayerChoiceState() {
        phimPlayerChoice = Preferences.shared.phimPlayerChoice
        let center = PhimPlayerChoiceCenter.shared
        guard center.hasPendingRequest else { return }
        selectedSection = .phimPlayer
        let title = center.pendingTitle
        playerChoicePrompt = title.isEmpty ? "phim vừa chọn" : title
    }

    /// Lưu lựa chọn (UserDefaults) + báo quay lại PHIM để phát tiếp phim/tập
    /// đang chờ. Đổi trình phát lúc KHÔNG có phim chờ thì chỉ lưu + ở lại đây.
    private func selectPhimPlayer(_ choice: PhimPlayerChoice) {
        phimPlayerChoice = choice
        playerChoicePrompt = nil
        PhimPlayerChoiceCenter.shared.save(choice)
    }
}

/// 1 dòng trong Settings: xem/sửa URL của 1 kênh + nút Lưu (KHÔNG ĐỔI).
private struct ChannelURLEditorRow: View {
    let channel: Channel
    @EnvironmentObject var streamService: StreamService
    @State private var draft = ""

    private var isCustomized: Bool { channel.currentURL != channel.defaultURL }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(channel.name)
                    .font(.headline)
                if isCustomized {
                    Text("• đã chỉnh")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
                Spacer()
                Button("Lưu") {
                    streamService.updateURL(id: channel.id, url: draft)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines) == channel.currentURL)
            }
            TextField("https://...index.m3u8", text: $draft)
                .font(.footnote)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit {
                    streamService.updateURL(id: channel.id, url: draft)
                }
        }
        .padding(.vertical, 2)
        .onAppear { draft = channel.currentURL }
    }
}
