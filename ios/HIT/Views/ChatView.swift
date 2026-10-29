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
                if canWrite {
                    Button(role: .destructive) { block(m) } label: { Label("\(m.nickname) 차단", systemImage: "hand.raised") }
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

    /// 차단하면 그 사람 메시지를 지금 목록에서도 바로 지운다
    private func block(_ m: ChatMessage) {
        let name = m.nickname, team = m.team
        Task {
            if (try? await APIClient().block(.chat(m.id))) != nil {
                messages.removeAll { $0.nickname == name && $0.team == team && !$0.mine }
            }
        }
    }

    private func report(_ m: ChatMessage) {
        hidden.insert(m.id)
        Task { try? await APIClient().reportChat(id: m.id) }
    }
}

/// 중계 탭 안의 응원톡: 위에 팬 분위기(최근 메시지의 응원 팀 비율), 최근 몇 줄, 바로 쓰는 입력칸.
/// "전체 보기"를 누르면 응원톡 시트를 연다.
@MainActor
struct LiveChatPanel: View {
    let game: Game
    @State private var messages: [ChatMessage] = []
    @State private var text = ""
    @State private var sending = false
    @State private var notice: String?
    @State private var showAll = false

    private var canWrite: Bool { AuthManager.shared.state == .signedIn }

    /// 최근 100개 중 두 팀 팬이 쓴 비율 (아무도 없으면 반반)
    private var mood: (away: Double, home: Double) {
        let recent = messages.suffix(100)
        let a = Double(recent.filter { $0.team == game.away.code }.count)
        let h = Double(recent.filter { $0.team == game.home.code }.count)
        return a + h == 0 ? (0.5, 0.5) : (a / (a + h), h / (a + h))
    }

    var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Label("응원톡", systemImage: "bubble.left.and.bubble.right.fill").font(Typo.style(.subheadline, .bold))
                    Spacer()
                    Button("전체 보기") { showAll = true }
                        .font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                }
                .padding(.horizontal, 16).padding(.top, 14)

                moodBar.padding(.horizontal, 16).padding(.top, 12)

                VStack(alignment: .leading, spacing: 8) {
                    if messages.isEmpty {
                        Text("첫 응원을 남겨 보세요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                    }
                    ForEach(messages.suffix(4)) { m in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            if let t = m.team { TeamBadge(code: t, size: 16).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 } }
                            Text(m.nickname).font(Typo.style(.caption, .semibold)).foregroundStyle(m.mine ? Palette.accent : Palette.muted)
                            Text(m.text).font(Typo.style(.subheadline)).lineLimit(2)
                        }
                    }
                }
                .padding(16)
                .contentShape(Rectangle())
                .onTapGesture { showAll = true }

                if let notice {
                    Text(notice).font(Typo.style(.caption)).foregroundStyle(Palette.red).padding(.horizontal, 16).padding(.bottom, 6)
                }
                composer
            }
        }
        .task(id: game.id) { await poll() }
        .sheet(isPresented: $showAll) {
            ChatSheet(game: game).presentationDetents([.medium, .large])
        }
    }

    private var moodBar: some View {
        let m = mood
        return VStack(spacing: 6) {
            HStack {
                Text("팬 분위기").font(Typo.style(.caption2, .semibold)).foregroundStyle(Palette.muted)
                Spacer()
            }
            GeometryReader { geo in
                HStack(spacing: 2) {
                    Rectangle().fill(Team.color(for: game.away.code)).frame(width: max(4, geo.size.width * m.away - 1))
                    Rectangle().fill(Team.color(for: game.home.code))
                }
                .clipShape(Capsule())
            }
            .frame(height: 8)
            .animation(.snappy, value: m.away)
            HStack {
                Text("\(game.away.name) \(Int((m.away * 100).rounded()))%")
                Spacer()
                Text("\(Int((m.home * 100).rounded()))% \(game.home.name)")
            }
            .font(Typo.style(.caption, .bold)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var composer: some View {
        HStack(spacing: 8) {
            if canWrite {
                TextField("응원 한마디", text: $text)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(.white.opacity(0.08), in: Capsule())
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 40, height: 40)
                        .background(Palette.accent.opacity(text.trimmingCharacters(in: .whitespaces).isEmpty ? 0.35 : 1), in: Circle())
                }
                .disabled(sending || text.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("보내기")
            } else {
                Text("로그인하면 응원톡에 참여할 수 있어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
            }
        }
        .padding(.horizontal, 12).padding(.bottom, 12)
    }

    private func poll() async {
        while !Task.isCancelled {
            if let r = try? await APIClient().chat(gameId: game.id, after: messages.last?.id ?? 0), !r.messages.isEmpty {
                let known = Set(messages.map(\.id))
                messages.append(contentsOf: r.messages.filter { !known.contains($0.id) })
                if messages.count > 200 { messages.removeFirst(messages.count - 200) }
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return }
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
}
