import SwiftUI

/// 직관 탭: 내 승률 한 줄 → 이달 달력(눌러서 기록) → 티켓처럼 쌓이는 기록
@MainActor
struct DiaryView: View {
    @Environment(AppModel.self) private var model
    private var diary: DiaryModel { DiaryModel.shared }
    private var auth: AuthManager { AuthManager.shared }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.diaryPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader { model.diaryPath.append(.search) }
                    if !diary.canRecord {
                        GuestDiaryCard()
                    } else {
                        WinRateHero(stats: diary.stats, team: model.myTeam)
                            .appearIn(0)
                    }
                    MonthCalendar(team: model.myTeam, entries: diary.entries) { model.diaryPath.append(.game($0)) }
                        .appearIn(1)
                    if diary.canRecord {
                        if diary.entries.isEmpty {
                            Text("본 경기 날짜를 누르면 티켓으로 남아요")
                                .font(.footnote)
                                .foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity)
                        } else {
                            SectionHeader(title: "내 티켓", detail: "\(diary.entries.count)장")
                        }
                        ForEach(Array(diary.entries.enumerated()), id: \.element.id) { i, entry in
                            TicketCard(entry: entry, team: model.myTeam)
                                .appearIn(2 + i)
                                .onTapGesture { model.diaryPath.append(.game(entry.gameId)) }
                                .contextMenu {
                                    Button(role: .destructive) { Task { await diary.delete(gameId: entry.gameId) } } label: {
                                        Label("기록 지우기", systemImage: "trash")
                                    }
                                }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .tabBarSpace()
            .background(AppBackground())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { RouteView(route: $0) }
            .refreshable { await diary.load() }
            .task(id: auth.state) { await diary.load() }
            .alert("직관 기록", isPresented: Binding(get: { diary.error != nil }, set: { if !$0 { diary.error = nil } })) {
                Button("확인", role: .cancel) {}
            } message: { Text(diary.error ?? "") }
        }
    }
}

// MARK: - 승률

/// 내 팀 승률 한 줄: 큰 숫자, 승패, 연승 배지, 그 아래 직관·집관 승패
struct WinRateHero: View {
    let stats: DiaryStats?
    let team: String?

    var body: some View {
        let color = Team.color(for: team)
        let played = (stats?.games ?? 0) > 0
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(played ? stats?.pct.map { "\(Int(($0 * 100).rounded()))%" } ?? "-" : "-")
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .contentTransition(.numericText())
                VStack(alignment: .leading, spacing: 2) {
                    Text("나의 승요력").font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                    if let stats, played {
                        Text("\(stats.wins)승 \(stats.losses)패" + (stats.draws > 0 ? " \(stats.draws)무" : ""))
                            .font(.headline)
                    } else {
                        Text("아직 기록이 없어요").font(.headline)
                    }
                }
                Spacer(minLength: 0)
                if let streak = stats?.streak {
                    Text(streak)
                        .font(.caption.weight(.heavy))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .foregroundStyle(streak.hasSuffix("연승") ? Color.black : Palette.text)
                        .background(streak.hasSuffix("연승") ? Palette.accent : Palette.red.opacity(0.6), in: Capsule())
                }
            }
            if let stats, played {
                // 직관 3승 1패 · 집관 1승 0패
                Text(stats.modes.filter { $0.games > 0 }.map { "\($0.label) \($0.record)" }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(Palette.text.opacity(0.75))
            }
        }
        .padding(18)
        .background {
            LinearGradient(colors: [color.opacity(0.5), color.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .glassCard(22)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - 달력

/// 한 달 달력. 내 팀 경기 날에 승·패·무, 아직 안 한 경기는 상대 엠블럼, 기록한 날엔 티켓 표시.
struct MonthCalendar: View {
    let team: String?
    let entries: [DiaryEntry]
    let onOpen: (String) -> Void

    @State private var month = KST.calendar.dateInterval(of: .month, for: Date())?.start ?? Date()
    @State private var games: [Game] = []
    @State private var failed = false
    @State private var picked: Game?

    private let cal = KST.calendar
    private var monthKey: String { String(KST.dayString(month).prefix(7)) }
    private var today: String { KST.dayString(Date()) }

    private var days: [String?] {
        let first = cal.component(.weekday, from: month) - 1           // 일요일 0
        let count = cal.range(of: .day, in: .month, for: month)?.count ?? 30
        return Array(repeating: nil, count: first) + (1...count).map { String(format: "%@-%02d", monthKey, $0) }
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button { shift(-1) } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(KST.monthTitle(month)).font(.headline)
                Spacer()
                Button { shift(1) } label: { Image(systemName: "chevron.right") }
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Palette.text)
            .buttonStyle(.plain)

            let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
            LazyVGrid(columns: cols, spacing: 6) {
                ForEach(Array(["일", "월", "화", "수", "목", "금", "토"].enumerated()), id: \.offset) { i, w in
                    Text(w).font(.caption2.weight(.bold))
                        .foregroundStyle(i == 0 ? Palette.red.opacity(0.8) : Palette.muted)
                }
                ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                    if let day { cell(day) } else { Color.clear.frame(height: 50) }
                }
            }
            if failed {
                Text("일정을 불러오지 못했어요").font(.caption).foregroundStyle(Palette.muted)
            }
        }
        .padding(14)
        .glassCard(22)
        .task(id: "\(monthKey)-\(team ?? "")") { await load() }
        .sheet(item: $picked) { game in
            DiaryEditor(game: game) { onOpen(game.id) }
                .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder
    private func cell(_ day: String) -> some View {
        let game = games.first { $0.date == day }
        let entry = game.flatMap { g in entries.first { $0.gameId == g.id } }
        let result = game?.result(for: team)
        let isToday = day == today
        Button {
            if let game { picked = game }
        } label: {
            VStack(spacing: 3) {
                Text(String(Int(day.suffix(2)) ?? 0))
                    .font(.system(size: 12, weight: isToday ? .heavy : .medium))
                    .foregroundStyle(isToday ? Palette.accent : Palette.text.opacity(game == nil ? 0.35 : 0.9))
                ZStack {
                    if let result {
                        Text(result.title)
                            .font(.system(size: 12, weight: .heavy))
                            .frame(width: 26, height: 22)
                            .foregroundStyle(result == .win ? Color.black : Palette.text)
                            .background(result == .win ? Palette.accent : result == .lose ? Color.white.opacity(0.18) : Color.white.opacity(0.45),
                                        in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    } else if let game, game.status != .canceled {
                        TeamBadge(code: game.opponent(of: team).code, size: 20)
                            .opacity(game.status == .live ? 1 : 0.8)
                            .overlay(alignment: .topTrailing) {
                                if game.status == .live { Circle().fill(Palette.red).frame(width: 6, height: 6) }
                            }
                    } else if game?.status == .canceled {
                        Text("취소").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.muted)
                    }
                }
                .frame(height: 22)
                .overlay(alignment: .bottomTrailing) {
                    if entry != nil {
                        Image(systemName: "ticket.fill").font(.system(size: 8, weight: .bold))
                            .foregroundStyle(Palette.accent).offset(x: 6, y: 4)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .background {
                if entry != nil {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.accent.opacity(0.6), lineWidth: 1)
                } else if isToday {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.06))
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(game == nil)
        .accessibilityLabel(accessibility(day, game, result, entry))
    }

    private func accessibility(_ day: String, _ game: Game?, _ result: GameResult?, _ entry: DiaryEntry?) -> String {
        var s = "\(Int(day.suffix(2)) ?? 0)일"
        if let game { s += ", \(game.opponent(of: team).name)전" }
        if let result { s += ", \(result.title)" }
        if let entry { s += ", \(entry.mode.title) 기록함" }
        return s
    }

    private func shift(_ n: Int) {
        if let next = cal.date(byAdding: .month, value: n, to: month) { withAnimation(.snappy) { month = next } }
    }

    private func load() async {
        do {
            let r = try await APIClient().calendar(month: monthKey, team: team)
            withAnimation(.snappy) { games = r.games }
            failed = false
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }
}

// MARK: - 티켓

/// 양옆에 홈이 파인 입장권 모양
struct TicketShape: Shape {
    var notch: CGFloat        // 위에서 홈까지
    var radius: CGFloat = 11
    var corner: CGFloat = 22

    func path(in rect: CGRect) -> Path {
        let body = Path(roundedRect: rect, cornerRadius: corner, style: .continuous)
        var holes = Path()
        let y = rect.minY + notch
        holes.addEllipse(in: CGRect(x: rect.minX - radius, y: y - radius, width: radius * 2, height: radius * 2))
        holes.addEllipse(in: CGRect(x: rect.maxX - radius, y: y - radius, width: radius * 2, height: radius * 2))
        return body.subtracting(holes)
    }
}

struct TicketCard: View {
    let entry: DiaryEntry
    let team: String?
    private let top: CGFloat = 104

    var body: some View {
        let game = entry.game
        let mine = Team.color(for: team)
        let theirs = Team.color(for: game?.opponent(of: team).code)
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(KST.ticketDate(entry.date)).font(.system(size: 26, weight: .heavy, design: .rounded))
                    Text(KST.weekdayOf(entry.date) + (game?.stadium.map { " · \($0)" } ?? ""))
                        .font(.caption.weight(.semibold)).foregroundStyle(Palette.text.opacity(0.75))
                }
                Spacer(minLength: 0)
                if let game {
                    HStack(spacing: 8) {
                        TeamBadge(code: game.away.code, size: 34)
                        Text(score(game)).font(.system(size: 20, weight: .heavy, design: .rounded)).monospacedDigit()
                        TeamBadge(code: game.home.code, size: 34)
                    }
                }
                stamp
            }
            .padding(.horizontal, 20)
            .frame(height: top)

            Line()
                .stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                .foregroundStyle(.white.opacity(0.3))
                .frame(height: 1)
                .padding(.horizontal, 16)

            HStack(spacing: 8) {
                Label(entry.mode.title, systemImage: entry.mode.symbol)
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(entry.mode == .stadium ? Palette.accent : Palette.text)
                if let seat = entry.seat { Text(seat).font(.caption.weight(.semibold)) }
                if let memo = entry.memo {
                    Text(memo).font(.caption).foregroundStyle(Palette.text.opacity(0.75)).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .frame(height: 44)
        }
        .background {
            LinearGradient(colors: [mine.opacity(0.75), theirs.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .background(.ultraThinMaterial)
        .clipShape(TicketShape(notch: top))
        .overlay(TicketShape(notch: top).stroke(.white.opacity(0.14), lineWidth: 1))
        .contentShape(TicketShape(notch: top))
        .accessibilityElement(children: .combine)
    }

    private func score(_ g: Game) -> String {
        guard let a = g.away.score, let h = g.home.score else { return g.status == .canceled ? "취소" : "vs" }
        return "\(a) : \(h)"
    }

    @ViewBuilder
    private var stamp: some View {
        let r = entry.result
        Text(r?.title ?? "–")
            .font(.system(size: 17, weight: .black))
            .foregroundStyle(r == .win ? Palette.accent : Palette.text.opacity(0.7))
            .frame(width: 42, height: 42)
            .overlay(Circle().strokeBorder(r == .win ? Palette.accent : .white.opacity(0.35), lineWidth: 2))
            .rotationEffect(.degrees(-12))
    }
}

private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path(); p.move(to: CGPoint(x: rect.minX, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)); return p
    }
}

// MARK: - 기록하기

/// 경기 하나를 직관/집관으로 남기는 시트 (달력·경기 화면에서 연다)
struct DiaryEditor: View {
    let game: Game
    var onOpenGame: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    private var diary: DiaryModel { DiaryModel.shared }

    @State private var mode: WatchMode = .stadium
    @State private var seat = ""
    @State private var memo = ""
    @State private var saving = false

    var body: some View {
        let existing = diary.entry(for: game.id)
        ScrollView {
            VStack(spacing: 18) {
                HStack(spacing: 14) {
                    TeamBadge(code: game.away.code, size: 46)
                    VStack(spacing: 2) {
                        Text(game.away.score.map { "\($0) : \(game.home.score ?? 0)" } ?? "vs")
                            .font(.system(size: 26, weight: .heavy, design: .rounded))
                        Text((game.date.map { KST.ticketDate($0) } ?? "") + (game.stadium.map { " · \($0)" } ?? ""))
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                    TeamBadge(code: game.home.code, size: 46)
                }
                .padding(.top, 8)

                if let onOpenGame {
                    Button { dismiss(); onOpenGame() } label: {
                        Label(game.status == .final ? "경기 결과 보기" : "중계 보기", systemImage: "chevron.right")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16).frame(height: 36).glassCapsule()
                    }
                    .buttonStyle(.plain)
                }

                if !diary.canRecord {
                    GuestDiaryCard()
                } else {
                    Picker("어떻게 봤나요", selection: $mode.animation(.snappy)) {
                        ForEach(WatchMode.allCases) { m in
                            Label(m == .stadium ? "직관 · 경기장" : "집관 · 중계", systemImage: m.symbol).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    VStack(spacing: 0) {
                        TextField(mode == .stadium ? "좌석 (예: 1루 응원석 12열)" : "어디서 봤나요 (예: 집, 친구네)", text: $seat)
                            .padding(14)
                        Divider().overlay(.white.opacity(0.1))
                        TextField("한 줄 메모", text: $memo, axis: .vertical)
                            .lineLimit(2...5)
                            .padding(14)
                    }
                    .glassCard(16)

                    Button {
                        saving = true
                        Task {
                            if await diary.save(game: game, mode: mode, seat: seat, memo: memo) { dismiss() }
                            saving = false
                        }
                    } label: {
                        if saving { ProgressView().tint(.black) } else { Text(existing == nil ? "티켓 남기기" : "고쳐서 저장") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving)

                    if existing != nil {
                        Button("이 기록 지우기", role: .destructive) {
                            Task { await diary.delete(gameId: game.id); dismiss() }
                        }
                        .font(.subheadline)
                    }
                }
            }
            .padding(20)
        }
        .scrollIndicators(.hidden)
        .background(AppBackground())
        .onAppear {
            if let e = existing { mode = e.mode; seat = e.seat ?? ""; memo = e.memo ?? "" }
        }
    }
}

/// 둘러보기 중엔 기록을 남길 수 없다는 안내
struct GuestDiaryCard: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "ticket.fill").font(.system(size: 30)).foregroundStyle(Palette.accent)
            Text("로그인하면 직관 기록과 승률이 쌓여요").font(.headline)
            Text("어느 기기에서든 내 티켓을 다시 볼 수 있게 계정에 저장해요")
                .font(.footnote).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            Button("로그인 · 회원가입") { Task { await AuthManager.shared.signOut() } }
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .glassCard(22)
    }
}
