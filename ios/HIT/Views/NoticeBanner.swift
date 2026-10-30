import SwiftUI

/// 홈 위쪽 공지 배너: 옆으로 넘기고, 5초마다 자동으로 넘어가며, 오른쪽 아래에 "1/3" 쪽 표시.
/// 누르면 공지의 link 를 연다 (hit://game/<번호> 는 앱 안, https://… 는 브라우저).
struct NoticeBanner: View {
    let notices: [Notice]
    @State private var page = 0
    @Environment(\.openURL) private var openURL

    var body: some View {
        if !notices.isEmpty {
            ZStack(alignment: .bottomTrailing) {
                TabView(selection: $page) {
                    ForEach(Array(notices.enumerated()), id: \.element.id) { i, notice in
                        card(notice).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                if notices.count > 1 {
                    Text("\(min(page, notices.count - 1) + 1)/\(notices.count)")
                        .font(Typo.font(11, .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.text.opacity(0.8))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.35), in: Capsule())
                        .padding(.trailing, 12)
                        .padding(.bottom, 10)
                        .allowsHitTesting(false)
                }
            }
            .frame(height: 84)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .task(id: notices.count) {
                guard notices.count > 1 else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    if Task.isCancelled { break }
                    withAnimation(.snappy) { page = (page + 1) % notices.count }
                }
            }
        }
    }

    private func card(_ notice: Notice) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(notice.subtitle)
                    .font(Typo.style(.caption, .medium))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
                Text(notice.title)
                    .font(Typo.font(19, .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
            Image(systemName: notice.icon ?? "megaphone.fill")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.accent)
                .frame(width: 48, height: 48)
                .background(Palette.accent.opacity(0.16), in: Circle())
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Palette.accent.opacity(0.14), Palette.accent.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .glassCard(18)
        .contentShape(Rectangle())
        .onTapGesture {
            if let link = notice.link, let url = URL(string: link) { openURL(url) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notice.subtitle). \(notice.title)")
    }
}
