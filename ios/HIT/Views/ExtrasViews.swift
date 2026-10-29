import SwiftUI

// MARK: - 구장 날씨 (프리뷰 탭)

/// 경기 시간대 날씨: 지금 하늘·기온·강수 확률 + 우천 취소 가능성 + 시간별 다섯 칸.
/// 예보가 없거나(7일 넘게 남음·끝난 경기) 서버에 날씨가 꺼져 있으면 아무것도 안 그린다.
@MainActor
struct WeatherCard: View {
    let game: Game
    @State private var weather: GameWeather?

    var body: some View {
        Group {
            if let w = weather {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Text("구장 날씨").font(Typo.style(.headline, .bold))
                            Spacer()
                            Text(w.stadium).font(Typo.style(.caption)).foregroundStyle(Palette.muted).lineLimit(1)
                        }
                        HStack(spacing: 14) {
                            Image(systemName: GameWeather.symbol(w.sky))
                                .symbolRenderingMode(.multicolor)
                                .font(.system(size: 34))
                                .frame(width: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(w.temp.map { "\($0)°" } ?? "-").font(Typo.score(30))
                                Text([w.label, w.wind.map { "바람 \(String(format: "%.0f", $0))m/s" }].compactMap { $0 }.joined(separator: " · "))
                                    .font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            riskBadge(w)
                        }
                        HStack(spacing: 0) {
                            ForEach(w.hours, id: \.time) { h in
                                VStack(spacing: 6) {
                                    Text("\(h.time.prefix(2))시").font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                                    Image(systemName: GameWeather.symbol(h.sky)).symbolRenderingMode(.multicolor).font(.system(size: 17)).frame(height: 20)
                                    Text(h.temp.map { "\($0)°" } ?? "-").font(Typo.style(.footnote, .semibold)).monospacedDigit()
                                    Text(h.pop.map { "\($0)%" } ?? "-").font(Typo.style(.caption2, .semibold)).monospacedDigit()
                                        .foregroundStyle((h.pop ?? 0) >= 40 ? Color(hex: 0x6BB7FF) : Palette.muted)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        Text("\(w.source) 예보 · 경기 시작 1시간 전부터").font(Typo.style(.caption2)).foregroundStyle(Palette.muted.opacity(0.7))
                    }
                }
                .transition(.opacity)
            }
        }
        .task(id: game.id) {
            if let w = try? await APIClient().weather(gameId: game.id) { withAnimation(.snappy) { weather = w } }
        }
    }

    /// 우천 취소 가능성: 돔 · 낮음 · 보통 · 높음
    private func riskBadge(_ w: GameWeather) -> some View {
        let (text, color): (String, Color) = switch w.risk {
        case "dome": ("돔구장 · 비 걱정 없음", Palette.live)
        case "high": ("우천 취소 가능성 높음", Palette.red)
        case "medium": ("비 소식 · 취소 가능성 있음", Color(hex: 0xF5C542))
        default: ("우천 걱정 없음", Palette.live)
        }
        return VStack(alignment: .trailing, spacing: 3) {
            if let pop = w.pop, !w.dome {
                Text("강수 \(pop)%").font(Typo.style(.subheadline, .bold)).monospacedDigit()
            }
            Text(text).font(Typo.font(11, .bold)).foregroundStyle(color)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(color.opacity(0.14), in: Capsule())
        }
    }
}

// MARK: - 오늘의 키플레이어 (프리뷰 탭)

/// 팀마다 타자 한 명: 사진 · 이름 · 왜 키플레이어인지 · 시즌 기록 한 줄. 누르면 선수 화면.
struct KeyPlayersCard: View {
    let game: Game
    let players: KeyPlayers

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "오늘의 키플레이어", detail: "시즌 기록 기준")
            HStack(spacing: 10) {
                column(players.away, code: game.away.code)
                column(players.home, code: game.home.code)
            }
        }
    }

    @ViewBuilder
    private func column(_ p: KeyPlayer?, code: String) -> some View {
        if let p {
            NavigationLink(value: Route.player(p.id)) {
                VStack(spacing: 8) {
                    ZStack(alignment: .bottomTrailing) {
                        PlayerAvatar(url: p.photo, name: p.name, team: code, size: 72)
                        TeamBadge(code: code, size: 24)
                    }
                    Text(p.name).font(Typo.style(.headline, .bold))
                    Text(p.reason).font(Typo.font(11, .bold)).foregroundStyle(Team.color(for: code).opacity(0.95))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Team.color(for: code).opacity(0.16), in: Capsule())
                    Text(p.line.isEmpty ? (p.war.map { "WAR \(String(format: "%.1f", $0))" } ?? "-") : p.line)
                        .font(Typo.style(.caption, .semibold)).monospacedDigit()
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16).padding(.horizontal, 8)
                .glassCard(20)
            }
            .buttonStyle(.press)
        } else {
            VStack(spacing: 8) {
                TeamBadge(code: code, size: 40)
                Text("기록을 불러오는 중이에요").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, minHeight: 170)
            .glassCard(20)
        }
    }
}

// MARK: - 내 팀 소식 (홈)

/// 홈의 "내 팀 소식": 최신 기사 3개 + 더보기. 오프시즌엔 홈 위쪽에 크게.
/// 서버에 뉴스 키가 없으면(503) 섹션 자체를 숨긴다.
@MainActor
struct TeamNewsSection: View {
    let team: Team
    var offseason = false
    var onMore: () -> Void
    @State private var items: [NewsItem] = []

    var body: some View {
        Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: offseason ? "오프시즌 · \(team.short) 소식" : "\(team.short) 소식", detail: "더보기", action: onMore)
                    VStack(spacing: 0) {
                        ForEach(Array(items.prefix(offseason ? 5 : 3).enumerated()), id: \.element.id) { i, item in
                            if i > 0 { Divider().overlay(.white.opacity(0.06)) }
                            NewsRow(item: item)
                        }
                    }
                    .padding(.horizontal, 16)
                    .glassCard(20)
                }
            }
        }
        .task(id: team.code) {
            if let r = try? await APIClient().news(team: team.code) { withAnimation(.snappy) { items = r.items } }
        }
    }
}

struct NewsRow: View {
    let item: NewsItem
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button { if let url = URL(string: item.url) { openURL(url) } } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if item.tags.contains("move") { tag("이적·계약", Palette.accent) }
                    if item.tags.contains("injury") { tag("부상", Palette.red) }
                    Text(item.title).font(Typo.style(.subheadline, .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                }
                if !item.summary.isEmpty {
                    Text(item.summary).font(Typo.style(.caption)).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.leading)
                }
                Text([item.source, item.at.map { TimeAgo.string($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(Typo.style(.caption2)).foregroundStyle(Palette.muted.opacity(0.8))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.press)
        .accessibilityHint("기사 원문 열기")
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text).font(Typo.font(10.5, .bold)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .fixedSize()
    }
}

/// 소식 전체: 전체 · 이적·계약 · 부상
@MainActor
struct NewsListView: View {
    @Environment(AppModel.self) private var model
    @State private var tag = ""
    @State private var response: NewsResponse?
    @State private var failed: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                PillChips(items: [("", "전체")] + (response?.tags ?? []).map { ($0.key, $0.label) }, selection: $tag)
                if let r = response {
                    if r.items.isEmpty {
                        MessageView(title: "소식이 없어요", detail: nil, systemImage: "newspaper").padding(.top, 40)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(r.items.enumerated()), id: \.element.id) { i, item in
                                if i > 0 { Divider().overlay(.white.opacity(0.06)) }
                                NewsRow(item: item)
                            }
                        }
                        .padding(.horizontal, 16)
                        .glassCard(20)
                    }
                    Text("네이버 뉴스 검색 결과예요. 기사를 누르면 언론사 원문이 열려요.")
                        .font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                } else if let failed {
                    MessageView(title: "소식을 불러오지 못했어요", detail: failed, systemImage: "wifi.exclamationmark").padding(.top, 40)
                } else {
                    SkeletonList(hero: 0, rows: 5)
                }
            }
            .padding(16)
        }
        .scrollIndicators(.hidden)
        .tabBarSpace()
        .background(AppBackground())
        .navigationTitle("\(model.team?.short ?? "") 소식")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: tag) {
            guard let team = model.myTeam else { return }
            do {
                let r = try await APIClient().news(team: team, tag: tag.isEmpty ? nil : tag)
                withAnimation(.snappy) { response = r }
                failed = nil
            } catch {
                failed = error.localizedDescription
            }
        }
    }
}

// MARK: - 차단한 사용자 (MY)

@MainActor
struct BlockedUsersView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var blocks: [BlockedUser]?

    var body: some View {
        NavigationStack {
            List {
                if let blocks {
                    if blocks.isEmpty {
                        Text("차단한 사용자가 없어요").foregroundStyle(Palette.muted)
                    }
                    ForEach(blocks) { b in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(b.nickname).font(Typo.style(.body, .semibold))
                                Text(TimeAgo.string(b.at) + " 차단").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            Button("차단 해제") { unblock(b) }
                                .font(Typo.style(.subheadline, .semibold))
                                .foregroundStyle(Palette.accent)
                                .buttonStyle(.borderless)
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppBackground())
            .navigationTitle("차단한 사용자")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } } }
            .task { blocks = (try? await APIClient().blocks().blocks) ?? [] }
        }
        .environment(\.colorScheme, .dark)
    }

    private func unblock(_ b: BlockedUser) {
        withAnimation { blocks?.removeAll { $0.id == b.id } }
        Task { try? await APIClient().unblock(userId: b.id) }
    }
}

// MARK: - 경기 정보 한눈에 (경기 화면 맨 위, 모든 탭에서 보인다)

/// 일시 · 구장 · 중계 · (포스트시즌이면) 시리즈 · 선발 투수를 한 장에.
struct GameInfoCard: View {
    let game: Game
    var series: (title: String, status: String)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let series {
                HStack(spacing: 8) {
                    Image(systemName: "trophy.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.accent)
                    Text(series.title).font(Typo.style(.subheadline, .bold))
                    Spacer(minLength: 8)
                    Text(series.status).font(Typo.style(.footnote, .semibold)).foregroundStyle(Palette.accent)
                }
            }
            HStack(spacing: 8) {
                if let d = game.startDate { chip("calendar", "\(KST.short.string(from: d)) \(KST.clock.string(from: d))") }
                if let s = game.stadium { chip("mappin.and.ellipse", s) }
                if let b = game.broadcast { chip("tv", b) }
            }
            if game.away.starter != nil || game.home.starter != nil {
                Divider().overlay(.white.opacity(0.08))
                HStack(spacing: 10) {
                    starter(game.away, trailing: false)
                    Text("선발").font(Typo.font(11, .bold)).foregroundStyle(Palette.muted)
                    starter(game.home, trailing: true)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(18)
        .accessibilityElement(children: .combine)
    }

    private func chip(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.accent)
            Text(text).font(Typo.style(.footnote, .semibold)).lineLimit(1)
        }
        .padding(.horizontal, 10).frame(height: 30)
        .background(.white.opacity(0.07), in: Capsule())
    }

    private func starter(_ side: GameSide, trailing: Bool) -> some View {
        HStack(spacing: 8) {
            if trailing { Spacer(minLength: 0) }
            if !trailing { PlayerAvatar(url: side.starterPhoto, name: side.starter ?? "?", team: side.code, size: 30) }
            Text(side.starter ?? "미정").font(Typo.style(.subheadline, .semibold)).lineLimit(1)
            if trailing { PlayerAvatar(url: side.starterPhoto, name: side.starter ?? "?", team: side.code, size: 30) }
            if !trailing { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 포스트시즌 시리즈 현황 + 대진표 (프리뷰 탭)

/// 이 경기가 속한 시리즈: 승패 · 차전별 결과. 포스트시즌 경기가 아니면 아무것도 그리지 않는다.
struct SeriesCard: View {
    let data: PostseasonResponse
    let game: Game

    private var round: PostseasonRound? { data.rounds.first { $0.games.contains { $0.id == game.id } } }

    var body: some View {
        if let r = round, let low = r.low {
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("\(r.label) 시리즈").font(Typo.style(.headline, .bold))
                        Spacer()
                        Text(r.format).font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                    }
                    HStack(spacing: 18) {
                        side(low, wins: r.wins.low, win: r.winner == low)
                        Text(":").font(Typo.score(22)).foregroundStyle(Palette.muted)
                        side(r.high, wins: r.wins.high, win: r.winner == r.high)
                    }
                    .frame(maxWidth: .infinity)
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(r.games) { g in gameChip(g, low: low, high: r.high, current: g.id == game.id) }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
    }

    private func side(_ code: String, wins: Int, win: Bool) -> some View {
        HStack(spacing: 10) {
            TeamBadge(code: code, size: 34)
            Text("\(wins)").font(Typo.score(34)).foregroundStyle(win ? Palette.accent : Palette.text)
            Text("승").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
        }
    }

    private func gameChip(_ g: SeriesGame, low: String, high: String, current: Bool) -> some View {
        let done = g.status == .final
        let winner: String? = done ? ((g.low ?? 0) > (g.high ?? 0) ? low : (g.low ?? 0) < (g.high ?? 0) ? high : nil) : nil
        return VStack(spacing: 5) {
            Text("\(g.no)차전").font(Typo.font(11, .bold)).foregroundStyle(current ? Palette.accent : Palette.muted)
            if let winner { TeamBadge(code: winner, size: 24) } else { Image(systemName: g.status == .live ? "circle.fill" : "clock").font(.system(size: 13)).foregroundStyle(g.status == .live ? Palette.live : Palette.muted).frame(height: 24) }
            Text(done ? "\(g.low ?? 0):\(g.high ?? 0)" : g.status == .live ? "경기 중" : "예정")
                .font(Typo.style(.caption, .semibold)).monospacedDigit()
        }
        .frame(width: 64).padding(.vertical, 10)
        .background(current ? Palette.accent.opacity(0.14) : .white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(current ? Palette.accent : .clear, lineWidth: 1.2))
    }
}
