import SwiftUI

// =====================================================================
// SETTINGS — bố cục 2 cột LANDSCAPE (chế độ TV):
//   Trái: danh sách mục (Playback / Network / Live TV — URL kênh)
//   Phải: nội dung mục đã chọn (Form — giữ nguyên 100% logic hiện tại:
//         Preferences, ChannelURLEditorRow, xác nhận khôi phục mặc định).
// Chỉ thay đổi BỐ CỤC — không đổi logic Settings.
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

    private enum SettingsSection: Int, CaseIterable, Identifiable {
        case playback, network, urls
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .playback: return "Playback"
            case .network: return "Network"
            case .urls: return "Live TV — URL kênh"
            }
        }
        var icon: String {
            switch self {
            case .playback: return "play.rectangle"
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
