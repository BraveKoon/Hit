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
    @State private var showDates = false   // 내 팀이 쉬는 날: 앞으로 7일 안의 다음 경기

    private var dayString: String { KST.dayString(date) }
    private var isToday: Bool { KST.calendar.isDate(date, inSameDayAs: Date()) }
    private var myGames: [Game] { games.filter { $0.involves(model.myTeam) } }
    private var otherGames: [Game] { games.filter { !$0.involves(model.myTeam) } }
    private var anyLive: Bool { games.contains { $0.status == .live } }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.todayPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader { model.todayPath.append(.search) }
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(KST.short.string(from: date)).font(.subheadline).foregroundStyle(Palette.muted)
                            Text(isToday ? "오늘의 경기" : "이날의 경기").font(.system(size: 22, weight: .heavy))
                        }
                        Spacer()
                        Button { withAnimation(.snappy) { showDates.toggle() } } label: {
                            HStack(spacing: 3) { Text(showDates ? "접기" : "더보기"); Image(systemName: showDates ? "chevron.up" : "chevron.right") }
                                .font(.subheadline).foregroundStyle(Palette.muted)
                        }
                        .buttonStyle(.plain)
                    }
                    if showDates { DateStrip(selection: $date).transition(.move(edge: .top).combined(with: .opacity)) }
                    Text(greeting).font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
                    content
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
        let name = AuthManager.shared.displayName
        guard let team = model.team else { return "\(name)님, 반가워요" }
        if !isToday { return KST.display.string(from: date) }
        if myGames.isEmpty, let next = upcoming {
            if let start = next.startDate, KST.calendar.isDateInTomorrow(start) {
                return "\(name)님, 다음 경기는 내일 \(next.clockText)"
            }
            return "\(name)님, 다음 경기는 \(next.startDate.map { KST.display.string(from: $0) } ?? "곧")"
        }
        if let g = myGames.first {
            switch g.status {
            case .live: return "\(team.short), 지금 경기 중!"
            case .final: return "\(name)님, 오늘 경기 끝"
            default: return "\(name)님, 오늘 \(g.clockText) \(team.short) 경기"
            }
        }
        return "\(name)님, 오늘은 쉬는 날"
    }

    @ViewBuilder
    private var content: some View {
        if let error, games.isEmpty {
            MessageView(title: "경기 정보를 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                .padding(.top, 40)
        } else if !loaded {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
        } else if games.isEmpty && upcoming == nil {
            MessageView(title: "경기가 없는 날이에요", detail: "날짜를 넘겨 다른 날 경기를 확인해 보세요.")
                .padding(.top, 40)
        } else {
            if let team = model.team {
                if myGames.isEmpty, let next = upcoming {
                    SectionHeader(title: "다음 경기", detail: next.startDate.map { KST.display.string(from: $0) })
                    NavigationLink(value: Route.game(next.id)) { MyTeamHero(game: next, myTeam: team.code) }
                        .buttonStyle(.plain)
                        .appearIn(0)
                } else if myGames.isEmpty {
                    Card {
                        HStack(spacing: 12) {
                            TeamBadge(code: team.code, size: 40)
                            Text("\(team.name)는 이날 경기가 없어요")
                                .font(.subheadline)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                }
                ForEach(myGames) { game in
                    NavigationLink(value: Route.game(game.id)) { MyTeamHero(game: game, myTeam: team.code) }
                        .buttonStyle(.plain)
                        .appearIn(0)
                }
            }
            if !otherGames.isEmpty {
                SectionHeader(title: "전체 경기", detail: "\(games.count)경기")
                VStack(spacing: 10) {
                    ForEach(Array(otherGames.enumerated()), id: \.element.id) { i, game in
                        NavigationLink(value: Route.game(game.id)) { GameCard(game: game) }
                            .buttonStyle(.plain)
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
                                    .font(.caption2.weight(.semibold))
                                Text("\(KST.calendar.component(.day, from: day))")
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                            }
                            .frame(width: 46, height: 58)
                            .foregroundStyle(on ? Color.black : today ? Palette.amber : Palette.text)
                            .background(on ? Palette.amber : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
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

    private var color: Color { Team.find(myTeam)?.color ?? Palette.amber }

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                LivePill(game: game)
                Spacer()
                Text([game.clockText, game.stadium].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "  "))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.8))
            }
            HStack(alignment: .center) {
                side(game.away)
                Spacer(minLength: 0)
                VStack(spacing: 10) {
                    Text(game.status == .live ? game.inningText : game.status == .final ? "경기 종료" : "경기 전")
                        .font(.footnote.weight(.bold))
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .glassCapsule()
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        score(game.away.score)
                        Text("VS").font(.system(size: 15, weight: .heavy)).foregroundStyle(.white.opacity(0.45))
                        score(game.home.score)
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
            .font(.subheadline.weight(.semibold))
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

    private func score(_ v: Int?) -> some View {
        Text(game.hasScore ? "\(v ?? 0)" : "-")
            .font(.system(size: 44, weight: .heavy, design: .rounded))
            .monospacedDigit()
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
            Text(Team.find(s.code)?.name ?? s.name).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
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
        .font(.subheadline.weight(.bold))
        .foregroundStyle(game.status == .live ? Color.white : .white.opacity(0.8))
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(game.status == .live ? Palette.red.opacity(0.28) : .white.opacity(0.12), in: Capsule())
    }
}

/// 다른 경기 한 줄: [Live · 시각 구장] 원정 엠블럼 · 점수 · 이닝 · 점수 · 홈 엠블럼
struct GameCard: View {
    let game: Game

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                if game.status == .live {
                    LivePill(game: game).scaleEffect(0.85, anchor: .leading)
                } else {
                    Text(game.status == .final ? "종료" : "예정").font(.caption.weight(.bold)).foregroundStyle(Palette.muted)
                }
                Text("\(game.clockText) \(game.stadium ?? "")").font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
            }
            .frame(width: 78, alignment: .leading)
            team(game.away)
            Text(game.hasScore ? "\(game.away.score ?? 0)" : "")
                .font(.system(size: 26, weight: .heavy, design: .rounded)).monospacedDigit().frame(width: 30)
            Text(game.status == .live ? game.inningText : game.status == .final ? "종료" : game.clockText)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 9).padding(.vertical, 4)
                .glassCapsule()
            Text(game.hasScore ? "\(game.home.score ?? 0)" : "")
                .font(.system(size: 26, weight: .heavy, design: .rounded)).monospacedDigit().frame(width: 30)
            team(game.home)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .glassCard(22)
    }

    private func team(_ s: GameSide) -> some View {
        VStack(spacing: 6) {
            TeamBadge(code: s.code, size: 40)
            Text(s.name).font(.caption.weight(.semibold)).lineLimit(1)
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
                        Image(systemName: "star.fill").foregroundStyle(Palette.amber)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("관심 선수를 추가해 보세요").font(.subheadline.weight(.bold))
                            Text("타석 결과, 등판·강판을 바로 알려드려요").font(.caption).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Palette.amber)
                    }
                    .padding(16)
                    .glassCard(20)
                }
                .buttonStyle(.plain)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(model.favorites, id: \.key) { fav in
                            Button { open(fav.id.map { .player($0) } ?? .search) } label: {
                                VStack(spacing: 6) {
                                    PlayerAvatar(url: fav.photo, name: fav.name, team: fav.team, size: 58)
                                        .overlay(alignment: .bottomTrailing) { TeamBadge(code: fav.team, size: 20) }
                                    Text(fav.name).font(.caption.weight(.semibold)).lineLimit(1)
                                }
                                .frame(width: 70)
                            }
                            .buttonStyle(.plain)
                        }
                        Button { open(.search) } label: {
                            VStack(spacing: 6) {
                                Image(systemName: "plus").font(.title3.weight(.bold))
                                    .frame(width: 58, height: 58)
                                    .glassCircle()
                                Text("추가").font(.caption).foregroundStyle(Palette.muted)
                            }
                            .frame(width: 70)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }
}
