import SwiftUI

/// 홈: 인사 → 날짜 → 내 팀 경기(크게) → 전체 경기
@MainActor
struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var date = Date()
    @State private var games: [Game] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var upcoming: Game?
    @State private var postseason: PostseasonResponse?   // 포스트시즌 기간에만 대진표
    @State private var showDates = false   // 내 팀이 쉬는 날: 앞으로 7일 안의 다음 경기
    @State private var notices: [Notice] = [.welcome]   // 공지 배너 (서버에 못 닿으면 기본 하나)

    private var dayString: String { KST.dayString(date) }
    private var isToday: Bool { KST.calendar.isDate(date, inSameDayAs: Date()) }
    private var myGames: [Game] { games.filter { $0.involves(model.myTeam) } }
    private var otherGames: [Game] { games.filter { !$0.involves(model.myTeam) } }
    private var anyLive: Bool { games.contains { $0.status == .live } }
    private var offseason: Bool { loaded && isToday && myGames.isEmpty && upcoming == nil }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.todayPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader { model.todayPath.append(.search) }
                    NoticeBanner(notices: notices)
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(KST.short.string(from: date)).font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
                            Text(isToday ? "오늘의 경기" : "이날의 경기").font(Typo.font(26, .heavy, relativeTo: .title))
                        }
                        Spacer()
                        Button { withAnimation(.snappy) { showDates.toggle() } } label: {
                            HStack(spacing: 3) { Text(showDates ? "접기" : "더보기"); Image(systemName: showDates ? "chevron.up" : "chevron.right") }
                                .font(.subheadline).foregroundStyle(Palette.muted)
                        }
                        .buttonStyle(.press)
                    }
                    if showDates { DateStrip(selection: $date).transition(.move(edge: .top).combined(with: .opacity)) }
                    Text(greeting).font(Typo.style(.subheadline, .medium)).foregroundStyle(Palette.muted)
                    // 오프시즌(오늘도 앞으로 7일도 내 팀 경기가 없음): 내 팀 소식을 경기 목록보다 먼저
                    if offseason, let team = model.team {
                        TeamNewsSection(team: team, offseason: true) { model.todayPath.append(.news) }
                    }
                    content
                    if !offseason, let team = model.team {
                        TeamNewsSection(team: team) { model.todayPath.append(.news) }
                    }
                    // 대진표는 오늘 경기 아래 (가장 궁금한 내 팀 경기가 첫 화면에 오도록)
                    if let postseason, postseason.active, isToday {
                        SectionHeader(title: "\(postseason.season) 포스트시즌", detail: postseason.champion.flatMap { Team.find($0)?.short }.map { "\($0) 우승" } ?? postseason.current?.name)
                        PostseasonBracket(data: postseason)
                            .appearIn(3)
                    }
                    FavoritesStrip { model.todayPath.append($0) }
                        .appearIn(4)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
            .tabBarSpace()
            .background(AppBackground())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { RouteView(route: $0) }
            .refreshable { await load() }
            .task {
                // 공지는 앱을 켤 때 한 번 받는다 (실패하면 기본 공지 그대로)
                if let r = try? await APIClient().notices(), !r.notices.isEmpty { notices = r.notices }
            }
            .task(id: dayString) {
                loaded = false
                await load()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(anyLive ? 15 : 120))
                    if Task.isCancelled { break }
                    await load()
                }
            }
        }
    }

    private var greeting: String {
        // 손님은 이미 호칭이라 "님"을 또 붙이지 않는다
        let raw = AuthManager.shared.displayName
        let name = raw == "손님" ? raw : "\(raw)님"
        guard let team = model.team else { return "\(name), 반가워요" }
        if !isToday { return KST.display.string(from: date) }
        if myGames.isEmpty, let next = upcoming {
            if let start = next.startDate, KST.calendar.isDateInTomorrow(start) {
                return "\(name), 다음 경기는 내일 \(next.clockText)"
            }
            return "\(name), 다음 경기는 \(next.startDate.map { KST.display.string(from: $0) } ?? "곧")"
        }
        if let g = myGames.first {
            switch g.status {
            case .live: return "\(team.short), 지금 경기 중!"
            case .final: return "\(name), 오늘 경기 끝"
            default: return "\(name), 오늘 \(g.clockText) \(team.short) 경기"
            }
        }
        return "\(name), 오늘은 쉬는 날"
    }

    @ViewBuilder
    private var content: some View {
        if let error, games.isEmpty {
            MessageView(title: "경기 정보를 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                .padding(.top, 40)
        } else if !loaded {
            SkeletonList(hero: 230, rows: 3)
        } else if games.isEmpty && upcoming == nil {
            MessageView(title: "경기가 없는 날이에요", detail: "날짜를 넘겨 다른 날 경기를 확인해 보세요.")
                .padding(.top, 40)
        } else {
            if error != nil {
                StaleBanner(text: "연결이 불안정해요. 마지막으로 받은 경기 정보예요")
            }
            if let team = model.team {
                if myGames.isEmpty, let next = upcoming {
                    SectionHeader(title: "다음 경기", detail: next.startDate.map { KST.display.string(from: $0) })
                    NavigationLink(value: Route.game(next.id)) { MyTeamHero(game: next, myTeam: team.code, series: postseason?.series(for: next)) }
                        .buttonStyle(.press)
                        .appearIn(0)
                } else if myGames.isEmpty {
                    Card {
                        HStack(spacing: 12) {
                            TeamBadge(code: team.code, size: 40)
                            Text("\(team.name)는 이날 경기가 없어요")
                                .font(Typo.style(.subheadline))
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
                ForEach(myGames) { game in
                    NavigationLink(value: Route.game(game.id)) { MyTeamHero(game: game, myTeam: team.code, series: postseason?.series(for: game)) }
                        .buttonStyle(.press)
                        .appearIn(0)
                }
            }
            if !otherGames.isEmpty {
                SectionHeader(title: "전체 경기", detail: "\(games.count)경기")
                VStack(spacing: 10) {
                    ForEach(Array(otherGames.enumerated()), id: \.element.id) { i, game in
                        NavigationLink(value: Route.game(game.id)) { GameCard(game: game, series: postseason?.series(for: game)) }
                            .buttonStyle(.press)
                            .appearIn(i + 1)
                    }
                }
            }
        }
    }

    /// 오늘 내 팀 경기가 없으면 내일부터 7일 동안 찾아본다 (서버가 캐시하므로 부담 적음)
    private func nextGame() async -> Game? {
        guard let team = model.myTeam else { return nil }
        for offset in 1...7 {
            guard let day = KST.calendar.date(byAdding: .day, value: offset, to: Date()),
                  let r = try? await APIClient().games(date: KST.dayString(day)) else { continue }
            if let g = r.games.first(where: { $0.involves(team) && $0.status != .canceled }) { return g }
        }
        return nil
    }

    private func load() async {
        // 대진표는 실패해도 화면에 영향 없이 조용히 넘어간다
        if let p = try? await APIClient().postseason(season: String(dayString.prefix(4))) {
            withAnimation(.snappy) { postseason = p }
        }
        do {
            let r = try await APIClient().games(date: dayString)
            if r.date == dayString { games = r.games }
            error = nil
            upcoming = isToday && !games.contains(where: { $0.involves(model.myTeam) }) ? await nextGame() : nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

/// 가로로 넘기는 날짜 (오늘 기준 -7 ~ +7일)
struct DateStrip: View {
    @Binding var selection: Date
    private let days: [Date] = (-7...7).compactMap { KST.calendar.date(byAdding: .day, value: $0, to: Date()) }
    private static let weekday: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.timeZone = KST.zone
        f.dateFormat = "E"
        return f
    }()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(days, id: \.self) { day in
                        let on = KST.calendar.isDate(day, inSameDayAs: selection)
                        let today = KST.calendar.isDate(day, inSameDayAs: Date())
                        Button { withAnimation(.snappy) { selection = day } } label: {
                            VStack(spacing: 4) {
                                Text(today ? "오늘" : Self.weekday.string(from: day))
                                    .font(Typo.style(.caption2, .semibold))
                                Text("\(KST.calendar.component(.day, from: day))")
                                    .font(Typo.font(17, .bold))
                            }
                            .frame(width: 46, height: 58)
                            .foregroundStyle(on ? Color.black : today ? Palette.accent : Palette.text)
                            .background(on ? Palette.accent : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.press)
                        .id(day)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .onAppear { proxy.scrollTo(days[7], anchor: .center) }
        }
    }
}

/// 내 팀 경기: 구단 색 그라데이션 유리 카드 (Live · 시각·구장 · 큰 엠블럼 · 이닝 · 점수 · 버튼)
struct MyTeamHero: View {
    let game: Game
    let myTeam: String
    var series: (title: String, status: String)? = nil

    private var color: Color { Team.find(myTeam)?.color ?? Palette.accent }

    var body: some View {
        VStack(spacing: 18) {
            // 포스트시즌: "플레이오프 3차전 · 1승 1패 동률"
            if let series {
                HStack {
                    Text(series.title).font(Typo.style(.subheadline, .bold))
                    Spacer()
                    Text(series.status).font(Typo.style(.subheadline, .bold))
                }
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            HStack {
                LivePill(game: game)
                Spacer()
                // 경기 전엔 왼쪽 알약이 이미 시각이라 구장만
                Text((game.hasScore ? [game.clockText, game.stadium] : [game.stadium]).compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "  "))
                    .font(Typo.style(.subheadline, .medium))
                    .foregroundStyle(.white.opacity(0.8))
            }
            HStack(alignment: .center) {
                side(game.away)
                Spacer(minLength: 0)
                VStack(spacing: 10) {
                    if game.hasScore {
                        Text(game.status == .live ? game.inningText : game.status == .final ? "경기 종료" : game.statusLabel)
                            .font(Typo.style(.footnote, .bold))
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .glassCapsule()
                        HStack(alignment: .firstTextBaseline, spacing: 14) {
                            score(game.away.score, dim: game.winner == "home")
                            Text(":").font(Typo.font(24, .medium)).foregroundStyle(.white.opacity(0.45))
                            score(game.home.score, dim: game.winner == "away")
                        }
                    } else {
                        // 경기 전: 점수 자리에 "-" 두 개 대신 VS 하나
                        Text("VS").font(Typo.font(26, .semibold)).foregroundStyle(.white.opacity(0.55))
                    }
                }
                Spacer(minLength: 0)
                side(game.home)
            }
            Rectangle().fill(.white.opacity(0.1)).frame(height: 1)
            HStack(spacing: 8) {
                if game.status == .live { Circle().fill(Palette.red).frame(width: 9, height: 9) }
                Text(buttonTitle)
            }
            .font(Typo.style(.subheadline, .semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .glassCard(14)
        }
        .padding(18)
        .background(
            LinearGradient(colors: [color.opacity(0.85), color.opacity(0.35), Color.black.opacity(0.2)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .glassCard(26)
        .shadow(color: color.opacity(0.35), radius: 24, y: 10)
    }

    private var buttonTitle: String {
        switch game.status {
        case .live: return "실시간 중계 보기"
        case .final: return "경기 결과 보기"
        default:
            if let a = game.away.starter, let h = game.home.starter { return "선발 \(a) vs \(h)" }
            return "경기 정보 보기"
        }
    }

    /// 끝난 경기는 진 팀 점수를 흐리게
    private func score(_ v: Int?, dim: Bool) -> some View {
        Text(game.hasScore ? "\(v ?? 0)" : "-")
            .font(Typo.score(44))
            .foregroundStyle(Palette.text.opacity(dim ? 0.35 : 1))
            .contentTransition(.numericText(value: Double(v ?? 0)))
            .animation(.snappy, value: v)
            .keyframeAnimator(initialValue: 1.0, trigger: v) { view, scale in
                view.scaleEffect(scale)
            } keyframes: { _ in
                KeyframeTrack(\.self) {
                    SpringKeyframe(1.22, duration: 0.18)
                    SpringKeyframe(1.0, duration: 0.4)
                }
            }
    }

    private func side(_ s: GameSide) -> some View {
        VStack(spacing: 10) {
            TeamBadge(code: s.code, size: 76)
            Text(Team.find(s.code)?.name ?? s.name).font(Typo.style(.subheadline, .semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(width: 100)
    }
}

/// Live 빨간 알약 / 시작 시각 / 종료
struct LivePill: View {
    let game: Game
    var body: some View {
        HStack(spacing: 6) {
            if game.status == .live { Circle().fill(Palette.red).frame(width: 8, height: 8) }
            Text(game.status == .live ? "Live" : game.status == .final ? "종료" : game.statusLabel)
        }
        .font(Typo.style(.subheadline, .bold))
        .foregroundStyle(game.status == .live ? Color.white : .white.opacity(0.8))
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(game.status == .live ? Palette.red.opacity(0.28) : .white.opacity(0.12), in: Capsule())
    }
}

/// 다른 경기 한 줄: [Live · 시각 구장] 원정 엠블럼 · 점수 · 이닝 · 점수 · 홈 엠블럼
struct GameCard: View {
    let game: Game
    var series: (title: String, status: String)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let series {
                Text("\(series.title) · \(series.status)").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
            }
            row
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .glassCard(22)
    }

    private var row: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                if game.status == .live {
                    LivePill(game: game).scaleEffect(0.85, anchor: .leading)
                } else {
                    Text(game.status == .final ? "종료" : "예정").font(Typo.style(.caption, .bold)).foregroundStyle(Palette.muted)
                }
                Text("\(game.clockText) \(game.stadium ?? "")").font(Typo.style(.caption)).foregroundStyle(Palette.muted).lineLimit(1)
            }
            .frame(width: 78, alignment: .leading)
            team(game.away)
            Text(game.hasScore ? "\(game.away.score ?? 0)" : "")
                .font(Typo.score(26)).frame(width: 30)
                .foregroundStyle(Palette.text.opacity(game.winner == "home" ? 0.35 : 1))
            Text(game.status == .live ? game.inningText : game.status == .final ? "종료" : game.clockText)
                .font(Typo.style(.caption, .bold))
                .padding(.horizontal, 9).padding(.vertical, 4)
                .glassCapsule()
            Text(game.hasScore ? "\(game.home.score ?? 0)" : "")
                .font(Typo.score(26)).frame(width: 30)
                .foregroundStyle(Palette.text.opacity(game.winner == "away" ? 0.35 : 1))
            team(game.home)
        }
    }

    private func team(_ s: GameSide) -> some View {
        VStack(spacing: 6) {
            TeamBadge(code: s.code, size: 40)
            Text(s.name).font(Typo.style(.caption, .semibold)).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 홈 아래: 관심 선수 (가로로 넘김). 없으면 추가 안내.
struct FavoritesStrip: View {
    @Environment(AppModel.self) private var model
    var open: (Route) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "관심 선수", detail: model.favorites.isEmpty ? nil : "\(model.favorites.count)명")
            if model.favorites.isEmpty {
                Button { open(.search) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "star.fill").foregroundStyle(Palette.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("관심 선수를 추가해 보세요").font(Typo.style(.subheadline, .bold))
                            Text("타석 결과, 등판·강판을 바로 알려드려요").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Palette.accent)
                    }
                    .padding(16)
                    .glassCard(20)
                }
                .buttonStyle(.press)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(model.favorites, id: \.key) { fav in
                            Button { open(fav.id.map { .player($0) } ?? .search) } label: {
                                VStack(spacing: 6) {
                                    PlayerAvatar(url: fav.photo, name: fav.name, team: fav.team, size: 58)
                                        .overlay(alignment: .bottomTrailing) { TeamBadge(code: fav.team, size: 20) }
                                    Text(fav.name).font(Typo.style(.caption, .semibold)).lineLimit(1)
                                }
                                .frame(width: 70)
                            }
                            .buttonStyle(.press)
                        }
                        Button { open(.search) } label: {
                            VStack(spacing: 6) {
                                Image(systemName: "plus").font(.title3.weight(.bold))
                                    .frame(width: 58, height: 58)
                                    .glassCircle()
                                Text("추가").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                            }
                            .frame(width: 70)
                        }
                        .buttonStyle(.press)
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }
}

// MARK: - 포스트시즌 대진표

/// 아래에 5위→1위 팀, 위로 WC·준PO·PO·KS 연결선. 라운드 이름표 아래에 차전별 점수(이긴 쪽 강조색).
/// 지금 치르는 라운드 이름표는 강조색 테두리, 끝난 라운드는 회색, 아직 안 한 라운드는 흰색.
struct PostseasonBracket: View {
    let data: PostseasonResponse

    private let step: CGFloat = 86        // 라운드 사이 높이 (차전 점수 세 줄이 아래 이름표에 닿지 않게)
    private let top: CGFloat = 26

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geo in
                let w = geo.size.width
                let xs = (0..<5).map { w * (0.1 + 0.2 * CGFloat($0)) }
                let base = top + step * 4 + 8
                let levels = (0..<4).map { base - step * CGFloat($0 + 1) + 12 }
                // 라운드 k 연결선: 왼쪽 끝 = 이전 라운드 가운데(첫 라운드는 0번 팀), 오른쪽 끝 = k+1번 팀
                let lefts: [CGFloat] = {
                    var out: [CGFloat] = [], left = xs[0]
                    for k in 0..<4 { out.append(left); left = (left + xs[k + 1]) / 2 }
                    return out
                }()
                ZStack(alignment: .topLeading) {
                    Canvas { ctx, _ in
                        for k in 0..<4 {
                            let l = lefts[k], r = xs[k + 1], y = levels[k]
                            let startY = k == 0 ? base : levels[k - 1]
                            var path = Path()
                            path.move(to: CGPoint(x: l, y: startY))
                            path.addLine(to: CGPoint(x: l, y: y + 12))
                            path.addQuadCurve(to: CGPoint(x: l + 12, y: y), control: CGPoint(x: l, y: y))
                            path.addLine(to: CGPoint(x: r - 12, y: y))
                            path.addQuadCurve(to: CGPoint(x: r, y: y + 12), control: CGPoint(x: r, y: y))
                            path.addLine(to: CGPoint(x: r, y: base))
                            ctx.stroke(path, with: .color(.white.opacity(0.45)), lineWidth: 1.5)
                        }
                    }
                    ForEach(Array(data.rounds.enumerated()), id: \.element.id) { k, r in
                        let mid = (lefts[k] + xs[k + 1]) / 2
                        badge(r).position(x: mid, y: levels[k])
                        scores(r)
                            .frame(width: max(110, xs[k + 1] - lefts[k] + 20))
                            .position(x: mid, y: levels[k] + 20 + CGFloat(min(r.games.count, 3)) * 10)
                    }
                    ForEach(Array(data.teams.enumerated()), id: \.element.id) { i, t in
                        team(t).position(x: xs[i], y: base + 34)
                    }
                }
            }
            .frame(height: top + step * 4 + 8 + 74)
        }
        .padding(18)
        .glassCard(26)
    }

    private func state(_ r: PostseasonRound) -> Int {   // 0 끝남, 1 지금, 2 아직
        r.winner != nil ? 0 : r.id == data.current?.id ? 1 : 2
    }

    private func badge(_ r: PostseasonRound) -> some View {
        let s = state(r)
        return Text(r.name)
            .font(Typo.style(.subheadline, .semibold))
            .foregroundStyle(s == 2 ? Color.black : Palette.text)
            .padding(.horizontal, 18)
            .frame(height: 30)
            .background(s == 0 ? Color.white.opacity(0.35) : s == 1 ? Color.black : Color.white, in: Capsule())
            .overlay(Capsule().strokeBorder(s == 1 ? Palette.accent : .clear, lineWidth: 2))
    }

    /// 차전별 점수. 네 경기 넘으면 시리즈 전적 한 줄로
    @ViewBuilder
    private func scores(_ r: PostseasonRound) -> some View {
        VStack(alignment: .center, spacing: 2) {
            let done = r.games.filter { $0.status == .final }
            if done.isEmpty {
                Text(r.format).font(Typo.style(.footnote)).foregroundStyle(Palette.text.opacity(0.8))
            } else if done.count > 3 {
                Text("\(r.wins.low)승 \(r.wins.high)패").font(Typo.style(.footnote, .semibold))
            } else {
                ForEach(done) { g in
                    HStack(spacing: 4) {
                        Text("\(g.no)차전").foregroundStyle(Palette.text)
                        Text("\(g.low ?? 0)").foregroundStyle((g.low ?? 0) > (g.high ?? 0) ? Palette.accent : Palette.text)
                        Text(":").foregroundStyle(Palette.muted)
                        Text("\(g.high ?? 0)").foregroundStyle((g.high ?? 0) > (g.low ?? 0) ? Palette.accent : Palette.text)
                    }
                    .font(Typo.style(.footnote, .medium))
                    .monospacedDigit()
                }
            }
        }
    }

    /// 탈락 팀은 흐리게, 지금 경기 중인 두 팀은 아래 점
    private func team(_ t: PostseasonTeam) -> some View {
        let playing = data.current.map { $0.low == t.code || $0.high == t.code } ?? false
        return VStack(spacing: 4) {
            TeamBadge(code: t.code, size: 34)
            Text(t.name).font(Typo.style(.footnote, .medium))
            Circle().fill(playing ? Palette.accent : .clear).frame(width: 6, height: 6)
        }
        .opacity(t.alive ? 1 : 0.35)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(t.seed)위 \(t.name)" + (t.alive ? "" : ", 탈락"))
    }
}
