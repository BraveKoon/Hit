import SwiftUI

/// 응원톡: 경기 당일 열리는 짧은 채팅. 3초마다 새 메시지만 받아 붙인다.
/// 둘러보기는 읽기만, 길게 누르면 신고·이 메시지 가리기.
@MainActor
struct ChatSheet: View {
    let game: Game
    @State private var messages: [ChatMessage] = []
    @State private var hidden: Set<Int> = []
    @State private var text = ""
    @State private var sending = false
    @State private var notice: String?
    @FocusState private var focused: Bool

    private var canWrite: Bool { AuthManager.shared.state == .signedIn }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if messages.isEmpty {
                            Text("첫 응원을 남겨 보세요").font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity).padding(.top, 60)
                        }
                        ForEach(messages.filter { !hidden.contains($0.id) }) { m in
                            bubble(m).id(m.id)
                        }
                    }
                    .padding(16)
                }
                .scrollIndicators(.hidden)
                .onChange(of: messages.last?.id) { _, id in
                    if let id { withAnimation(.snappy) { proxy.scrollTo(id, anchor: .bottom) } }
                }
            }
            if let notice {
                Text(notice).font(Typo.style(.caption)).foregroundStyle(Palette.red).padding(.horizontal, 16).padding(.bottom, 6)
            }
            composer
        }
        .background(AppBackground())
        .task(id: game.id) { await poll() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            TeamBadge(code: game.away.code, size: 26)
            Text("응원톡").font(Typo.style(.headline))
            TeamBadge(code: game.home.code, size: 26)
            Spacer()
            if game.hasScore {
                Text("\(game.away.score ?? 0) : \(game.home.score ?? 0)").font(Typo.score(17))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.08)).frame(height: 1) }
    }

    /// 내 메시지는 오른쪽 강조색, 다른 사람은 왼쪽에 응원 팀 엠블럼과 닉네임
    @ViewBuilder
    private func bubble(_ m: ChatMessage) -> some View {
        if m.mine {
            HStack {
                Spacer(minLength: 60)
                Text(m.text)
                    .font(Typo.style(.subheadline))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        } else {
            HStack(alignment: .top, spacing: 8) {
                if let team = m.team { TeamBadge(code: team, size: 24) } else { Circle().fill(Palette.surfaceHigh).frame(width: 24, height: 24) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.nickname).font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                    Text(m.text)
                        .font(Typo.style(.subheadline))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                Spacer(minLength: 40)
            }
            .contextMenu {
                if canWrite {
                    Button(role: .destructive) { report(m) } label: { Label("신고하기", systemImage: "exclamationmark.bubble") }
                }
                Button { hidden.insert(m.id) } label: { Label("이 메시지 가리기", systemImage: "eye.slash") }
            }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            if canWrite {
                TextField("응원 한마디 (200자)", text: $text, axis: .vertical)
                    .lineLimit(1...3)
                    .focused($focused)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 40, height: 40)
                        .background(Palette.accent.opacity(text.trimmingCharacters(in: .whitespaces).isEmpty ? 0.35 : 1), in: Circle())
                }
                .disabled(sending || text.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("보내기")
            } else {
                Text("로그인하면 응원톡에 참여할 수 있어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private func poll() async {
        while !Task.isCancelled {
            if let r = try? await APIClient().chat(gameId: game.id, after: messages.last?.id ?? 0), !r.messages.isEmpty {
                let known = Set(messages.map(\.id))
                messages.append(contentsOf: r.messages.filter { !known.contains($0.id) })
                if messages.count > 300 { messages.removeFirst(messages.count - 300) }
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sending = true
        Task {
            defer { sending = false }
            do {
                let m = try await APIClient().sendChat(gameId: game.id, text: body)
                if !messages.contains(where: { $0.id == m.id }) { messages.append(m) }
                text = ""
                notice = nil
            } catch {
                notice = error.localizedDescription
            }
        }
    }

    private func report(_ m: ChatMessage) {
        hidden.insert(m.id)
        Task { try? await APIClient().reportChat(id: m.id) }
    }
}
