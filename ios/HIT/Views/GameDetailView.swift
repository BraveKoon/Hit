import Charts
import SwiftUI

/// 경기 화면 탭. 다른 야구 앱처럼 경기 전엔 프리뷰, 경기 중엔 중계, 끝나면 요약부터 연다.
enum DetailTab: String, CaseIterable, Identifiable {
    case preview = "프리뷰", lineup = "라인업", summary = "요약", live = "중계", record = "기록"
    var id: String { rawValue }

    /// 경기 전에는 요약·중계·기록을 흐리게 막는다
    func isAvailable(_ status: GameStatus) -> Bool {
        switch self {
        case .preview, .lineup: true
        default: status != .scheduled
        }
    }

    static func initial(for status: GameStatus) -> DetailTab {
        switch status {
        case .scheduled, .canceled: .preview
        case .live, .suspended: .live
        case .final: .summary
        }
    }
}

/// 경기 중계: 점수판 → [중계 | 라인업 | 기록]
@MainActor
struct GameDetailView: View {
    let gameId: String
    @State private var detail: GameDetail?
    @State private var error: String?
    @State private var tab: DetailTab = .live
    @State private var tabChosen = false                   // 처음 받은 경기 상태로 첫 탭을 고른 뒤엔 그대로
    @State private var activityOn = false
    @State private var activityError: String?
    @State private var lastSeq: Int?                       // 지난번까지 본 문자중계
    @State private var burst: (id: Int, name: String, team: String)?   // 홈런 연출
    @State private var showDiary = false
    @State private var lastLoaded: Date?                   // 마지막으로 서버 응답을 받은 시각
    @State private var focusInning: Int?                   // 알림을 눌러 왔을 때 보여 줄 이닝
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
                    if let detail {
                        if let note = staleNote(detail) {
                            StaleBanner(text: note)
                        }
                        ScoreHero(game: detail.game)
                        activityButton(detail)
                        DetailTabs(selection: $tab, status: detail.game.status)
                        switch tab {
                        case .preview: PreviewTab(game: detail.game)
                        case .lineup: LineupTab(detail: detail)
                        case .summary: SummaryTab(detail: detail)
                        case .live: LiveTab(detail: detail, focusInning: focusInning)
                        case .record: RecordTab(detail: detail)
                        }
                    } else if let error {
                        MessageView(title: "중계를 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                            .padding(.top, 60)
                    } else {
                        ProgressView().padding(.top, 80)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
            // 알림을 눌러 왔으면 중계 탭의 그 이닝 문자중계까지 내려 준다
            .task(id: AppModel.shared.focus) {
                guard let f = AppModel.shared.focus, f.gameId == gameId else { return }
                tab = .live
                tabChosen = true
                focusInning = f.inning
                // focus 를 지우면 이 task 가 다시 시작되므로 다 쓰고 나서 지운다
                defer { AppModel.shared.focus = nil }
                var waited = 0
                while detail == nil && waited < 50 {
                    try? await Task.sleep(for: .milliseconds(200))
                    waited += 1
                }
                guard detail != nil, f.inning != nil, !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(.snappy) { proxy.scrollTo(RelaySection.anchor, anchor: .top) }
            }
        }
        .tabBarSpace()
        .background(AppBackground())
        .overlay {
            if let burst {
                HomeRunBurst(name: burst.name, colors: [Team.find(burst.team)?.color ?? Palette.accent])
                    .id(burst.id)
                    .transition(.opacity)
            }
        }
        .navigationTitle(detail.map { "\($0.game.away.name) 대 \($0.game.home.name)" } ?? "중계")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.background, for: .navigationBar)
        .toolbar {
            // 직관 기록: 이미 남긴 경기면 채워진 티켓
            if detail != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    let recorded = DiaryModel.shared.entry(for: gameId) != nil
                    Button { showDiary = true } label: {
                        Label(recorded ? "직관 기록됨" : "직관 기록", systemImage: recorded ? "ticket.fill" : "ticket")
                            .labelStyle(.titleAndIcon)
                            .font(Typo.style(.footnote, .bold))
                            .foregroundStyle(Palette.accent)
                    }
                    .symbolEffect(.bounce, value: recorded)
                }
            }
        }
        .sheet(isPresented: $showDiary) {
            if let game = detail?.game {
                DiaryEditor(game: game).presentationDetents([.medium, .large])
            }
        }
        .refreshable { await load() }
        .task(id: gameId) {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(detail?.game.status == .live ? 8 : 60))
                if Task.isCancelled { break }
                await load()
            }
        }
    }

    private func load() async {
        do {
            let next = try await APIClient().detail(id: gameId)
            celebrate(next)
            if !tabChosen {
                tab = .initial(for: next.game.status)
                tabChosen = true
            }
            withAnimation(.snappy) { detail = next }   // 점수·상황이 부드럽게 바뀐다
            error = nil
            lastLoaded = Date()
            activityOn = LiveActivityController.shared.activity(for: gameId) != nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// 화면은 지난 값을 보여 주고 있지만 새 정보가 안 올 때 한 줄로 알린다.
    /// - 서버에 못 닿음: 마지막으로 받은 시각
    /// - 서버는 답하지만 네이버 데이터가 멈춤 (경기 중 1분 넘게): 몇 분 전 기준인지
    private func staleNote(_ detail: GameDetail) -> String? {
        if error != nil {
            return "연결이 불안정해요" + (lastLoaded.map { " · \(KST.clock.string(from: $0)) 기준" } ?? "")
        }
        guard detail.game.status == .live, let at = detail.fetchedDate else { return nil }
        let age = Date().timeIntervalSince(at)
        guard age > 60 else { return nil }
        let mins = Int(age / 60)
        return "경기 데이터가 늦어지고 있어요 · \(mins)분 전 기준"
    }

    /// 처음 연 뒤 새로 들어온 홈런이 있으면 연출 (처음 열 때는 지난 홈런으로 터뜨리지 않는다)
    private func celebrate(_ next: GameDetail) {
        let newest = next.plays.map(\.seq).max() ?? 0
        defer { lastSeq = max(lastSeq ?? 0, newest) }
        guard let seen = lastSeq, !reduceMotion, next.game.status == .live,
              let hr = next.plays.filter({ $0.seq > seen && $0.isHomeRun }).max(by: { $0.seq < $1.seq }),
              let name = hr.batterName else { return }
        let team = hr.half == "top" ? next.game.away.code : next.game.home.code
        withAnimation { burst = (hr.seq, name, team) }
        Task {
            try? await Task.sleep(for: .seconds(2.1))
            withAnimation { if burst?.id == hr.seq { burst = nil } }
        }
    }

    @ViewBuilder
    private func activityButton(_ detail: GameDetail) -> some View {
        if detail.game.status == .live || detail.game.status == .scheduled {
            VStack(spacing: 6) {
                Button {
                    Task {
                        if activityOn {
                            await LiveActivityController.shared.end(gameId: gameId)
                            activityOn = false
                        } else {
                            do {
                                try LiveActivityController.shared.start(detail: detail)
                                activityOn = true
                                activityError = nil
                            } catch {
                                activityError = LiveActivityController.shared.isEnabled
                                    ? "잠금화면에 띄우지 못했어요: \(error.localizedDescription)"
                                    : "설정 > HIT > 실시간 현황을 켜 주세요."
                            }
                        }
                    }
                } label: {
                    Label(activityOn ? "잠금화면에서 내리기" : "잠금화면에 실시간 점수 띄우기",
                          systemImage: activityOn ? "lock.open.fill" : "lock.iphone")
                        .font(Typo.style(.subheadline, .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .foregroundStyle(activityOn ? Palette.text : Palette.accent)
                        .background(activityOn ? Palette.surfaceHigh : Palette.accent.opacity(0.14), in: Capsule())
                }
                if let activityError {
                    Text(activityError).font(Typo.style(.caption)).foregroundStyle(Palette.red)
                }
            }
        }
    }
}

// MARK: - 점수판

struct ScoreHero: View {
    let game: Game

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                StatusPill(game: game)
                Spacer()
                Text([game.startDate.map { KST.display.string(from: $0) }, game.stadium].compactMap { $0 }.joined(separator: " · "))
                    .font(Typo.style(.caption))
                    .foregroundStyle(Palette.text.opacity(0.7))
            }
            HStack {
                team(game.away, won: game.winner == "away")
                Spacer()
                if game.hasScore {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        scoreText(game.away.score, dim: game.winner == "home")
                        Text(":").font(Typo.font(28, .medium)).foregroundStyle(Palette.muted).offset(y: -5)
                        scoreText(game.home.score, dim: game.winner == "away")
                    }
                        // 점수가 바뀌면 한 번 튀고 강조색 빛이 번진다
                        .keyframeAnimator(initialValue: 0.0, trigger: (game.away.score ?? 0) + (game.home.score ?? 0)) { view, k in
                            view
                                .scaleEffect(1 + k * 0.18)
                                .shadow(color: Palette.accent.opacity(k * 0.9), radius: 22 * k)
                        } keyframes: { _ in
                            KeyframeTrack(\.self) {
                                SpringKeyframe(1, duration: 0.18)
                                SpringKeyframe(0, duration: 0.45)
                            }
                        }
                } else {
                    // 경기 전: 시작 시각을 크게, 그 아래 구장
                    VStack(spacing: 4) {
                        Text(game.clockText).font(Typo.score(34))
                        Text(game.stadium ?? "").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                    }
                }
                Spacer()
                team(game.home, won: game.winner == "home")
            }
        }
        .padding(18)
        .background(
            LinearGradient(colors: [
                (Team.find(game.away.code)?.color ?? Palette.surface).opacity(0.5),
                Palette.surface,
                (Team.find(game.home.code)?.color ?? Palette.surface).opacity(0.5),
            ], startPoint: .leading, endPoint: .trailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 1))
    }

    /// 끝난 경기는 진 팀 점수를 흐리게 (이긴 팀은 그대로)
    private func scoreText(_ value: Int?, dim: Bool) -> some View {
        Text("\(value ?? 0)")
            .font(Typo.score(48))
            .foregroundStyle(Palette.text.opacity(dim ? 0.35 : 1))
            .contentTransition(.numericText(value: Double(value ?? 0)))
    }

    private func team(_ s: GameSide, won: Bool) -> some View {
        VStack(spacing: 7) {
            TeamBadge(code: s.code, size: 56)
            Text(s.name).font(Typo.style(.subheadline, .bold))
            // 경기 전엔 선발 투수, 끝나면 이긴 쪽에 "승리"
            Group {
                if game.status == .scheduled {
                    Text(s.starter ?? "선발 미정").foregroundStyle(Palette.muted)
                } else {
                    Text(won ? "승리" : " ").foregroundStyle(Palette.accent)
                }
            }
            .font(Typo.style(.caption, .semibold))
            .lineLimit(1)
        }
        .frame(width: 86)
    }
}

struct DetailTabs: View {
    @Binding var selection: DetailTab
    var status: GameStatus = .live
    @Namespace private var underline

    var body: some View {
        HStack(spacing: 0) {
            ForEach(DetailTab.allCases) { t in
                let open = t.isAvailable(status)
                Button { withAnimation(.snappy) { selection = t } } label: {
                    VStack(spacing: 8) {
                        Text(t.rawValue)
                            .font(Typo.style(.subheadline, selection == t ? .bold : .medium))
                            .foregroundStyle(selection == t ? Palette.text : Palette.muted.opacity(open ? 1 : 0.4))
                        ZStack {
                            Capsule().fill(.clear).frame(height: 3)
                            if selection == t {
                                Capsule().fill(Palette.accent).frame(height: 3).matchedGeometryEffect(id: "u", in: underline)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .disabled(!open)
            }
        }
        .padding(.top, 4)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
    }
}

// MARK: - 중계 탭

struct LiveTab: View {
    let detail: GameDetail
    var focusInning: Int? = nil

    var body: some View {
        VStack(spacing: 14) {
            switch detail.game.status {
            case .live:
                if let s = detail.situation {
                    GamedayCard(game: detail.game, situation: s, pitches: detail.atBat)
                }
            default:
                EmptyView()
            }
            if detail.plays.isEmpty && detail.game.status == .scheduled {
                Card { Label("경기가 시작하면 문자중계가 여기에 나와요", systemImage: "text.bubble").foregroundStyle(Palette.muted) }
            } else if !detail.plays.isEmpty || detail.lineScore != nil {
                RelaySection(detail: detail, focusInning: focusInning)
                    .id(RelaySection.anchor)
            }
        }
    }
}

/// 문자중계를 이닝별로: 1회·2회… 알약을 눌러 그 이닝만 본다.
/// 아무것도 안 고르면 지금 이닝을 따라가고, 지난 이닝은 서버에서 그 이닝 전체를 받아 온다.
struct RelaySection: View {
    static let anchor = "relay"
    let detail: GameDetail
    var focusInning: Int? = nil
    @State private var picked: Int?            // nil = 지금 이닝 따라가기
    @State private var cache: [Int: [Play]] = [:]
    @State private var loading = false
    @State private var failed = false
    @State private var showPitches = false

    private var game: Game { detail.game }

    /// 지금까지 열린 이닝 수 (진행 이닝, 이닝별 점수, 받은 문자중계 중 가장 큰 값)
    private var innings: Int {
        let played = detail.lineScore.map { line in
            max(line.away.lastIndex { !$0.isEmpty } ?? -1, line.home.lastIndex { !$0.isEmpty } ?? -1) + 1
        } ?? 0
        return max(1, game.inning ?? 0, played, detail.plays.compactMap(\.inning).max() ?? 0)
    }

    private var current: Int? { game.status == .live ? game.inning : nil }
    private var selected: Int { min(picked ?? current ?? innings, innings) }

    /// 진행 중인 이닝은 최신 줄이 위로, 끝난 이닝은 초→말 순서대로 읽히게.
    private var plays: [Play] {
        let all = cache[selected] ?? detail.plays.filter { $0.inning == selected }
        return selected == current ? all : all.sorted { $0.seq < $1.seq }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeader(title: "문자중계")
                Toggle("투구 보기", isOn: $showPitches)
                    .toggleStyle(.button)
                    .font(Typo.style(.caption, .semibold))
                    .tint(Palette.accent)
                    .padding(.top, 10)
            }
            InningChips(count: innings, selected: selected, live: current) { n in
                withAnimation(.snappy) { picked = n == current ? nil : n }
            }
            Group {
                if plays.isEmpty {
                    Card {
                        if loading {
                            HStack(spacing: 8) { ProgressView(); Text("\(selected)회 문자중계를 불러오는 중") }
                                .foregroundStyle(Palette.muted)
                        } else {
                            Label(failed ? "불러오지 못했어요. 잠시 뒤 다시 눌러 주세요" : "\(selected)회 문자중계가 없어요",
                                  systemImage: failed ? "wifi.exclamationmark" : "text.bubble")
                                .foregroundStyle(Palette.muted)
                        }
                    }
                } else {
                    PlayTimeline(game: game, plays: plays, showPitches: showPitches)
                }
            }
            .id(selected)
            .transition(.opacity.combined(with: .offset(y: 8)))
        }
        // 알림을 눌러 왔으면 그 이닝을 고른다 (지금 이닝이면 따라가기)
        .onChange(of: focusInning, initial: true) { _, f in
            if let f { picked = f == current ? nil : f }
        }
        // 고른 이닝이 바뀌거나, 진행 중인 이닝에 새 줄이 들어오면 다시 받는다.
        .task(id: "\(selected)-\(selected == current ? detail.plays.first?.seq ?? 0 : 0)") {
            await load(selected)
        }
    }

    private func load(_ n: Int) async {
        if cache[n] != nil && n != current { return } // 끝난 이닝은 한 번만
        loading = true
        failed = false
        defer { loading = false }
        do {
            let r = try await APIClient().relay(id: game.id, inning: n)
            withAnimation(.snappy) { cache[n] = r.plays }
        } catch is CancellationError {
        } catch {
            failed = cache[n] == nil
        }
    }
}

/// 1회 2회 3회… 가로로 넘기는 알약. 진행 중인 이닝엔 빨간 점.
struct InningChips: View {
    let count: Int
    let selected: Int
    let live: Int?
    let onPick: (Int) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(1...max(count, 1), id: \.self) { n in
                        let on = n == selected
                        Button { onPick(n) } label: {
                            HStack(spacing: 5) {
                                if n == live {
                                    Circle().fill(Palette.red).frame(width: 6, height: 6)
                                }
                                Text("\(n)회")
                                    .font(Typo.font(14, on ? .bold : .medium))
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .foregroundStyle(on ? Color.black : Palette.text.opacity(0.75))
                            .background {
                                if on { Capsule().fill(Palette.accent) } else { Color.clear.glassCapsule() }
                            }
                        }
                        .buttonStyle(.plain)
                        .id(n)
                        .accessibilityLabel("\(n)회" + (n == live ? ", 진행 중" : ""))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 2)
            }
            .scrollIndicators(.hidden)
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
            .onChange(of: selected) { _, n in withAnimation(.snappy) { proxy.scrollTo(n, anchor: .center) } }
        }
    }
}

// MARK: - 게임데이 (그라운드 · 볼카운트 · 투수 대 타자 · 투구 · 대기 타석)
// 다음 스포츠 그래픽 중계, MLB Gameday 처럼 지금 상황을 카드 한 장에 모은다.

struct GamedayCard: View {
    let game: Game
    let situation: Situation
    let pitches: [Pitch]

    private var battingTeam: String { game.half == "top" ? game.away.code : game.home.code }
    private var pitchingTeam: String { game.half == "top" ? game.home.code : game.away.code }

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // 이닝 · 아웃 | B S O
                HStack(spacing: 8) {
                    LiveDot()
                    Text(game.inningText).font(Typo.style(.subheadline, .bold))
                    Text("\(situation.outs)아웃").font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
                    Spacer(minLength: 0)
                    CountLights(balls: situation.balls, strikes: situation.strikes, outs: situation.outs)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                FieldGraphic(bases: situation.bases, runners: situation.runners ?? [],
                             batter: situation.batter?.name, pitcher: situation.pitcher?.name)
                    .frame(height: 196)
                    .padding(.horizontal, 12)

                divider
                HStack(alignment: .center, spacing: 10) {
                    player(situation.pitcher, role: "투수", team: pitchingTeam, trailing: false)
                    Text("VS").font(Typo.style(.caption2, .bold)).foregroundStyle(Palette.muted)
                    player(situation.batter, role: "타자", team: battingTeam, trailing: true)
                }
                .padding(16)

                if !pitches.isEmpty {
                    divider
                    HStack(alignment: .top, spacing: 14) {
                        StrikeZoneView(pitches: pitches).frame(width: 104, height: 128)
                        VStack(alignment: .leading, spacing: 7) {
                            Text("이번 타석").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                            ForEach(pitches.reversed()) { p in
                                HStack(spacing: 8) {
                                    Text("\(p.n)")
                                        .font(Typo.font(10, .bold))
                                        .frame(width: 18, height: 18)
                                        .background(StrikeZoneView.color(for: p.result), in: Circle())
                                        .foregroundStyle(.black)
                                    Text(p.text).font(Typo.style(.caption, .semibold)).lineLimit(1)
                                    Spacer(minLength: 0)
                                    Text([p.pitchType, p.speed.map { "\(Int($0))" }].compactMap { $0 }.joined(separator: " "))
                                        .font(Typo.style(.caption2)).monospacedDigit()
                                        .foregroundStyle(Palette.muted)
                                }
                            }
                        }
                    }
                    .padding(16)
                }

                if let next = situation.next, !next.isEmpty {
                    divider
                    HStack(spacing: 12) {
                        Text("대기 타석").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                        ForEach(next) { p in
                            HStack(spacing: 6) {
                                PlayerAvatar(url: p.photo, name: p.name, team: battingTeam, size: 24)
                                Text("\(p.order)번 \(p.name)").font(Typo.style(.caption, .semibold)).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
    }

    private var divider: some View { Rectangle().fill(.white.opacity(0.07)).frame(height: 1) }

    /// 사진 + 이름 + 오늘 기록. 투수는 왼쪽, 타자는 오른쪽 정렬
    private func player(_ p: PlayerLine?, role: String, team: String, trailing: Bool) -> some View {
        HStack(spacing: 10) {
            if trailing { Spacer(minLength: 0) }
            if !trailing { PlayerAvatar(url: p?.photo, name: p?.name ?? role, team: team, size: 44) }
            VStack(alignment: trailing ? .trailing : .leading, spacing: 2) {
                Text(role).font(Typo.style(.caption2, .semibold)).foregroundStyle(Palette.muted)
                Text(p?.name ?? "-").font(Typo.style(.subheadline, .bold)).lineLimit(1)
                if let line = p?.line {
                    Text(line).font(Typo.style(.caption2)).foregroundStyle(Palette.muted).lineLimit(2)
                        .multilineTextAlignment(trailing ? .trailing : .leading)
                }
            }
            if trailing { PlayerAvatar(url: p?.photo, name: p?.name ?? role, team: team, size: 44) }
            if !trailing { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// B ●●○ S ●○ O ●○
struct CountLights: View {
    let balls: Int
    let strikes: Int
    let outs: Int

    var body: some View {
        HStack(spacing: 10) {
            group("B", balls, 3, Palette.live)
            group("S", strikes, 2, Color(hex: 0xF5C542))
            group("O", outs, 2, Palette.red)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("볼 \(balls), 스트라이크 \(strikes), 아웃 \(outs)")
    }

    private func group(_ label: String, _ n: Int, _ max: Int, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Text(label).font(Typo.font(12, .bold)).foregroundStyle(Palette.muted)
            ForEach(0..<max, id: \.self) { i in
                Circle().fill(i < n ? color : Color.white.opacity(0.12)).frame(width: 9, height: 9)
                    .shadow(color: i < n ? color.opacity(0.5) : .clear, radius: 3)
            }
        }
    }
}

/// 위에서 본 그라운드. 주자가 있는 베이스는 강조색, 이름을 알면 그 위에 이름표.
/// 타석에는 타자, 마운드에는 투수 이름.
struct FieldGraphic: View {
    let bases: [Bool]
    var runners: [String?] = []
    var batter: String? = nil
    var pitcher: String? = nil

    private func on(_ i: Int) -> Bool { bases.indices.contains(i) && bases[i] }
    private func runner(_ i: Int) -> String? { runners.indices.contains(i) ? runners[i] : nil }

    // 비율 좌표 (가로 0~1, 세로 0~1)
    private static let home = CGPoint(x: 0.5, y: 0.88), first = CGPoint(x: 0.74, y: 0.58)
    private static let second = CGPoint(x: 0.5, y: 0.3), third = CGPoint(x: 0.26, y: 0.58), mound = CGPoint(x: 0.5, y: 0.6)

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let at = { (p: CGPoint) in CGPoint(x: p.x * w, y: p.y * h) }
            ZStack {
                Canvas { ctx, _ in
                    // 외야 잔디 부채꼴
                    let plate = at(Self.home)
                    var grass = Path()
                    grass.move(to: plate)
                    grass.addArc(center: plate, radius: h * 0.86, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
                    grass.closeSubpath()
                    ctx.fill(grass, with: .linearGradient(Gradient(colors: [Color(hex: 0x23774A), Color(hex: 0x15502F)]), startPoint: CGPoint(x: 0, y: 0), endPoint: CGPoint(x: 0, y: h)))
                    // 내야 흙과 라인
                    var dirt = Path()
                    dirt.addLines([at(Self.home), at(Self.first), at(Self.second), at(Self.third)])
                    dirt.closeSubpath()
                    ctx.fill(dirt, with: .color(Palette.clay.opacity(0.8)))
                    ctx.stroke(dirt, with: .color(.white.opacity(0.65)), lineWidth: 1.5)
                    let m = at(Self.mound)
                    ctx.fill(Path(ellipseIn: CGRect(x: m.x - 7, y: m.y - 5, width: 14, height: 10)), with: .color(Color(hex: 0xC8714C)))
                    // 베이스
                    for (i, p) in [Self.first, Self.second, Self.third].enumerated() {
                        let c = at(p)
                        let r = CGRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16)
                        let base = Path(roundedRect: r, cornerRadius: 2).applying(CGAffineTransform(translationX: -c.x, y: -c.y).concatenating(CGAffineTransform(rotationAngle: .pi / 4)).concatenating(CGAffineTransform(translationX: c.x, y: c.y)))
                        ctx.fill(base, with: .color(on(i) ? Palette.accent : .white))
                    }
                    ctx.fill(Path(ellipseIn: CGRect(x: plate.x - 5, y: plate.y - 5, width: 10, height: 10)), with: .color(.white))
                }
                ForEach(0..<3, id: \.self) { i in
                    if on(i), let name = runner(i) {
                        tag(name, accent: true).position(x: at([Self.first, Self.second, Self.third][i]).x, y: at([Self.first, Self.second, Self.third][i]).y - 20)
                    }
                }
                if let pitcher { tag(pitcher, accent: false).position(x: at(Self.mound).x, y: at(Self.mound).y + 16) }
                if let batter { tag(batter, accent: false).position(x: at(Self.home).x, y: min(h - 10, at(Self.home).y + 16)) }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(bases.contains(true)
            ? "주자 " + [0, 1, 2].filter(on).map { "\($0 + 1)루" + (runner($0).map { " \($0)" } ?? "") }.joined(separator: ", ")
            : "주자 없음")
    }

    private func tag(_ name: String, accent: Bool) -> some View {
        Text(name)
            .font(Typo.font(11, .semibold))
            .foregroundStyle(accent ? Color.black : Palette.text)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(accent ? Palette.accent : Color.black.opacity(0.55), in: Capsule())
            .fixedSize()
    }
}

/// 투구 위치 (포수 시점). 가로 ±1.4ft, 세로 0.5~4.5ft.
struct StrikeZoneView: View {
    let pitches: [Pitch]

    static func color(for result: String) -> Color {
        switch result {
        case "B": return Palette.live
        case "H": return Color(hex: 0x6BB7FF)
        default: return Palette.accent
        }
    }

    var body: some View {
        Canvas { ctx, size in
            func pt(_ x: Double, _ z: Double) -> CGPoint {
                CGPoint(x: size.width * (x + 1.4) / 2.8, y: size.height * (1 - (z - 0.5) / 4.0))
            }
            let top = pitches.first?.top ?? 3.4, bottom = pitches.first?.bottom ?? 1.6
            let zone = CGRect(origin: pt(-0.708, top), size: .zero).union(CGRect(origin: pt(0.708, bottom), size: .zero))
            ctx.fill(Path(zone), with: .color(.white.opacity(0.04)))
            ctx.stroke(Path(zone), with: .color(.white.opacity(0.5)), lineWidth: 1)
            for i in 1...2 {
                let x = zone.minX + zone.width * CGFloat(i) / 3, y = zone.minY + zone.height * CGFloat(i) / 3
                ctx.stroke(Path { $0.move(to: CGPoint(x: x, y: zone.minY)); $0.addLine(to: CGPoint(x: x, y: zone.maxY)) }, with: .color(.white.opacity(0.12)), lineWidth: 0.5)
                ctx.stroke(Path { $0.move(to: CGPoint(x: zone.minX, y: y)); $0.addLine(to: CGPoint(x: zone.maxX, y: y)) }, with: .color(.white.opacity(0.12)), lineWidth: 0.5)
            }
            for p in pitches {
                guard let x = p.x, let z = p.z else { continue }
                let c = pt(x, z), r: CGFloat = 9
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(Self.color(for: p.result)))
                ctx.draw(Text("\(p.n)").font(Typo.font(10, .heavy)).foregroundColor(.black), at: c)
            }
        }
        .background(Palette.surfaceHigh.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("투구 위치 \(pitches.count)개")
    }
}


/// 경기 후: 승리·패전 투수
struct DecisionCard: View {
    let game: Game
    let pitchers: Pitchers
    var body: some View {
        Card {
            // 기록이 없는 쪽(패전 투수가 비어 있는 날 등)은 칸째 뺀다
            HStack {
                if pitchers.win != nil { decision("승리 투수", pitchers.win, color: Palette.accent) }
                if pitchers.win != nil && pitchers.lose != nil {
                    Rectangle().fill(.white.opacity(0.07)).frame(width: 1, height: 40)
                }
                if pitchers.lose != nil { decision("패전 투수", pitchers.lose, color: Palette.muted) }
            }
        }
    }
    private func decision(_ label: String, _ name: String?, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).font(Typo.style(.caption, .semibold)).foregroundStyle(color)
            Text(name ?? "-").font(Typo.style(.headline))
        }
        .frame(maxWidth: .infinity)
    }
}

/// 문자중계: 반 이닝마다 묶고, 득점·홈런은 눈에 띄게
struct PlayTimeline: View {
    let game: Game
    let plays: [Play]
    let showPitches: Bool

    private struct Half: Identifiable {
        let id: String
        let title: String
        var plays: [Play]
    }

    private var halves: [Half] {
        var out: [Half] = []
        for p in plays where showPitches || !p.isPitch {
            let key = "\(p.inning ?? 0)-\(p.half ?? "")"
            if out.last?.id == key {
                out[out.count - 1].plays.append(p)
            } else {
                let team = p.half == "top" ? game.away.name : p.half == "bottom" ? game.home.name : ""
                let title = p.inning.map { "\($0)회\(p.half == "top" ? "초" : p.half == "bottom" ? "말" : "") \(team) 공격" } ?? "경기"
                out.append(Half(id: key, title: title, plays: [p]))
            }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(halves) { half in
                VStack(alignment: .leading, spacing: 0) {
                    Text(half.title)
                        .font(Typo.style(.caption, .bold))
                        .foregroundStyle(Palette.muted)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    ForEach(half.plays) { play in
                        row(play)
                    }
                }
                .glassCard(18)
            }
        }
    }

    @ViewBuilder
    private func row(_ play: Play) -> some View {
        let hr = play.text.contains("홈런") && !play.text.contains("홈런성")
        let scored = play.text.contains("홈인")
        HStack(alignment: .top, spacing: 10) {
            Capsule()
                .fill(hr ? Palette.red : scored ? Palette.accent : .clear)
                .frame(width: 3)
            if let batter = play.batterName {
                PlayerAvatar(url: play.photo, name: batter,
                             team: play.half == "top" ? game.away.code : game.home.code, size: 26)
            }
            Text(play.text)
                .font(play.isPitch ? Typo.style(.caption) : Typo.style(.subheadline, hr || scored ? .semibold : .regular))
                .foregroundStyle(play.isPitch ? Palette.muted : Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if hr {
                Text("홈런").font(Typo.style(.caption2, .heavy)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Palette.red.opacity(0.2), in: Capsule()).foregroundStyle(Palette.red)
            } else if scored {
                Text("득점").font(Typo.style(.caption2, .heavy)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Palette.accent.opacity(0.2), in: Capsule()).foregroundStyle(Palette.accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(hr ? Palette.red.opacity(0.06) : scored ? Palette.accent.opacity(0.05) : .clear)
    }
}

// MARK: - 라인업 탭

struct LineupTab: View {
    let detail: GameDetail

    var body: some View {
        if let lineups = detail.lineups {
            HStack(alignment: .top, spacing: 10) {
                column(detail.game.away, lineups.away)
                column(detail.game.home, lineups.home)
            }
        } else {
            Card {
                Label(detail.game.status == .scheduled ? "라인업은 경기가 시작하면 나와요" : "라인업 정보가 없어요", systemImage: "person.3")
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private func column(_ side: GameSide, _ players: [LineupEntry]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                TeamBadge(code: side.code, size: 24)
                Text(side.name).font(Typo.style(.subheadline, .bold))
            }
            .padding(12)
            ForEach(players) { p in
                HStack(spacing: 8) {
                    Text("\(p.order)").font(Typo.style(.caption, .heavy)).foregroundStyle(Palette.accent).frame(width: 14)
                    PlayerAvatar(url: p.photo, name: p.name, team: side.code, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).font(Typo.style(.subheadline, .semibold)).lineLimit(1)
                        Text(p.pos).font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
            }
        }
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(18)
    }
}

// MARK: - 기록 탭

struct RecordTab: View {
    let detail: GameDetail

    var body: some View {
        VStack(spacing: 14) {
            if let line = detail.lineScore {
                LineScoreView(game: detail.game, line: line, totals: detail.totals)
            } else {
                Card { Label("경기가 시작하면 이닝별 점수가 나와요", systemImage: "tablecells").foregroundStyle(Palette.muted) }
            }
            if let t = detail.totals, let a = t.away, let h = t.home {
                TeamTotalsCard(game: detail.game, away: a, home: h)
            }
        }
    }
}

/// 팀 기록 비교: 득점·안타·실책·볼넷을 가운데 이름, 양옆 숫자로
struct TeamTotalsCard: View {
    let game: Game
    let away: Totals
    let home: Totals

    var body: some View {
        Card {
            VStack(spacing: 12) {
                HStack {
                    TeamBadge(code: game.away.code, size: 22)
                    Spacer()
                    Text("팀 기록").font(Typo.style(.subheadline, .bold))
                    Spacer()
                    TeamBadge(code: game.home.code, size: 22)
                }
                row("득점", away.r, home.r)
                row("안타", away.h, home.h)
                row("실책", away.e, home.e, lowerIsBetter: true)
                row("볼넷", away.b, home.b)
            }
        }
    }

    private func row(_ label: String, _ a: Int, _ h: Int, lowerIsBetter: Bool = false) -> some View {
        let aWins = lowerIsBetter ? a < h : a > h, hWins = lowerIsBetter ? h < a : h > a
        return HStack {
            Text("\(a)").font(Typo.score(17)).foregroundStyle(aWins ? Palette.accent : Palette.text)
            Spacer()
            Text(label).font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
            Spacer()
            Text("\(h)").font(Typo.score(17)).foregroundStyle(hWins ? Palette.accent : Palette.text)
        }
    }
}

struct LineScoreView: View {
    let game: Game
    let line: LineScore
    let totals: TotalsPair?

    var body: some View {
        let innings = max(line.away.count, line.home.count)
        let current = game.status == .live ? (game.inning ?? 0) - 1 : -1
        Card(padding: 0) {
            ScrollView(.horizontal) {
                Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        Text("").frame(width: 70)
                        ForEach(0..<innings, id: \.self) { i in cell("\(i + 1)", header: true) }
                        cell("R", header: true, total: true)
                        cell("H", header: true)
                        cell("E", header: true)
                        cell("B", header: true)
                    }
                    Divider().overlay(.white.opacity(0.06))
                    row(game.away, line.away, totals?.away, current: game.half == "top" ? current : -1, innings: innings)
                    Divider().overlay(.white.opacity(0.06))
                    row(game.home, line.home, totals?.home, current: game.half == "bottom" ? current : -1, innings: innings)
                }
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private func row(_ side: GameSide, _ cells: [String], _ t: Totals?, current: Int, innings: Int) -> some View {
        GridRow {
            HStack(spacing: 6) {
                TeamBadge(code: side.code, size: 22)
                Text(side.name).font(Typo.style(.caption, .bold))
            }
            .frame(width: 70, alignment: .leading)
            .padding(.leading, 10)
            ForEach(0..<innings, id: \.self) { i in
                let v = i < cells.count ? cells[i] : ""
                cell(v.isEmpty ? "·" : v, live: i == current, scored: (Int(v) ?? 0) > 0)
            }
            cell("\(t?.r ?? side.score ?? 0)", total: true)
            cell(t.map { "\($0.h)" } ?? "-")
            cell(t.map { "\($0.e)" } ?? "-")
            cell(t.map { "\($0.b)" } ?? "-")
        }
    }

    private func cell(_ text: String, header: Bool = false, total: Bool = false, live: Bool = false, scored: Bool = false) -> some View {
        Text(text)
            .font(header ? Typo.style(.caption2, .bold) : Typo.style(.footnote, total || scored ? .heavy : .medium))
            .foregroundStyle(header ? Palette.muted : total ? Palette.accent : scored ? Palette.text : Palette.muted)
            .frame(width: 28, height: 34)
            .background(live ? Palette.accent.opacity(0.16) : .clear)
            .monospacedDigit()
    }
}

struct WinRateBar: View {
    let game: Game
    let rate: WinRate

    var body: some View {
        Card {
            VStack(spacing: 10) {
                HStack {
                    Text("\(Int(rate.away.rounded()))%").font(Typo.style(.headline).monospacedDigit())
                    Spacer()
                    Text("승리 확률").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                    Spacer()
                    Text("\(Int(rate.home.rounded()))%").font(Typo.style(.headline).monospacedDigit())
                }
                GeometryReader { geo in
                    let total = max(rate.away + rate.home, 1)
                    HStack(spacing: 3) {
                        Capsule().fill(Team.find(game.away.code)?.color ?? Palette.muted).frame(width: geo.size.width * rate.away / total)
                        Capsule().fill(Team.find(game.home.code)?.color ?? Palette.muted)
                    }
                }
                .frame(height: 10)
                HStack {
                    Text(game.away.name)
                    Spacer()
                    Text(game.home.name)
                }
                .font(Typo.style(.caption))
                .foregroundStyle(Palette.muted)
            }
        }
    }
}

/// 승리 확률: 타석별 흐름 그래프. 점이 모자라면 (경기 초반, 재생 모드) 지금 확률 막대만.
struct WinTrendSection: View {
    let detail: GameDetail
    @State private var points: [WinPoint] = []

    private var game: Game { detail.game }

    var body: some View {
        Group {
            if points.count >= 2 {
                WinTrendChart(game: game, points: points)
            } else if let w = detail.winRate, game.status == .live {
                WinRateBar(game: game, rate: w)
            }
        }
        // 경기 중에는 새 타석이 들어올 때마다, 끝난 경기는 한 번
        .task(id: "\(game.id)-\(game.status == .live ? detail.plays.first?.seq ?? 0 : -1)") {
            guard game.status == .live || game.status == .final || game.status == .suspended else { return }
            if let r = try? await APIClient().winTrend(id: game.id) {
                withAnimation(.snappy) { points = r.points }
            }
        }
    }
}

struct WinTrendChart: View {
    let game: Game
    let points: [WinPoint]

    private var awayColor: Color { Team.find(game.away.code)?.color ?? Palette.muted }
    private var homeColor: Color { Team.find(game.home.code)?.color ?? Palette.muted }
    private var last: Double { points.last?.home ?? 50 }

    /// 이닝이 바뀌는 타석 (가로축 눈금)
    private var inningStarts: [Int] {
        points.indices.filter { $0 == 0 || points[$0].inning != points[$0 - 1].inning }
    }

    var body: some View {
        Card {
            VStack(spacing: 10) {
                HStack {
                    Text("\(Int((100 - last).rounded()))%").font(Typo.style(.headline).monospacedDigit())
                    Spacer()
                    Text("승리 확률 흐름").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                    Spacer()
                    Text("\(Int(last.rounded()))%").font(Typo.style(.headline).monospacedDigit())
                }
                Chart {
                    RuleMark(y: .value("반반", 50))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(.white.opacity(0.25))
                    ForEach(Array(points.enumerated()), id: \.offset) { i, p in
                        AreaMark(x: .value("타석", i), yStart: .value("기준", 50), yEnd: .value("홈팀", p.home))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [homeColor.opacity(0.55), awayColor.opacity(0.55)],
                                                            startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("타석", i), y: .value("홈팀", p.home))
                            .interpolationMethod(.monotone)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    PointMark(x: .value("타석", points.count - 1), y: .value("홈팀", last))
                        .symbolSize(50)
                        .foregroundStyle(Palette.accent)
                }
                .chartYScale(domain: 0...100)
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks(values: inningStarts) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.08))
                        AxisValueLabel {
                            if let i = value.as(Int.self), points.indices.contains(i) {
                                Text("\(points[i].inning)회").font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                            }
                        }
                    }
                }
                // 위로 갈수록 홈팀, 아래로 갈수록 원정팀이 유리
                .overlay(alignment: .topLeading) { sideLabel(game.home.name, homeColor) }
                .overlay(alignment: .bottomLeading) { sideLabel(game.away.name, awayColor).padding(.bottom, 22) }
                .frame(height: 160)
                HStack {
                    Text(game.away.name)
                    Spacer()
                    Text(game.home.name)
                }
                .font(Typo.style(.caption))
                .foregroundStyle(Palette.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("승리 확률 흐름")
        .accessibilityValue("지금 \(game.home.name) \(Int(last.rounded()))%, \(game.away.name) \(Int((100 - last).rounded()))%")
    }

    private func sideLabel(_ name: String, _ color: Color) -> some View {
        Text("\(name) 유리")
            .font(Typo.style(.caption2, .semibold))
            .foregroundStyle(color.opacity(0.9))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.black.opacity(0.35), in: Capsule())
    }
}

/// 오늘의 MVP: 끝난 경기에서 수훈 선수를 한 명 고른다 (로그인한 사람 한 표, 다시 고를 수 있음).
/// 고르기 전엔 후보, 고른 뒤엔 집계 막대.
struct MvpCard: View {
    let game: Game
    @State private var ballot: MvpResponse?
    @State private var choosing = false
    @State private var sending = false
    @State private var failed: String?
    @Environment(AppModel.self) private var model

    private var canVote: Bool { AuthManager.shared.state == .signedIn }

    var body: some View {
        Group {
            if let ballot, ballot.open {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("오늘의 MVP").font(Typo.style(.headline))
                            Spacer()
                            Text(ballot.total > 0 ? "\(ballot.total)명 참여" : "첫 표를 던져 보세요")
                                .font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                        }
                        if canVote && (choosing || ballot.myVote == nil) {
                            candidates(ballot)
                        } else {
                            results(ballot)
                        }
                        if let failed {
                            Text(failed).font(Typo.style(.caption)).foregroundStyle(Palette.red)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .task(id: game.id) {
            if let r = try? await APIClient().mvp(id: game.id) { withAnimation(.snappy) { ballot = r } }
        }
    }

    /// 팀별 가로 목록. 내 팀이 먼저.
    @ViewBuilder
    private func candidates(_ b: MvpResponse) -> some View {
        let teams = b.candidates.map(\.team).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let ordered = teams.filter { $0 == model.myTeam } + teams.filter { $0 != model.myTeam }
        VStack(alignment: .leading, spacing: 12) {
            ForEach(ordered, id: \.self) { team in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        TeamBadge(code: team, size: 18)
                        Text(Team.find(team)?.name ?? team).font(Typo.style(.caption, .bold)).foregroundStyle(Palette.muted)
                    }
                    ScrollView(.horizontal) {
                        HStack(spacing: 12) {
                            ForEach(b.candidates.filter { $0.team == team }) { c in
                                Button { vote(c) } label: {
                                    VStack(spacing: 5) {
                                        PlayerAvatar(url: c.photo, name: c.name, team: c.team, size: 52)
                                            .overlay(Circle().strokeBorder(b.myVote?.name == c.name && b.myVote?.team == c.team ? Palette.accent : .clear, lineWidth: 2))
                                        Text(c.name).font(Typo.style(.caption, .semibold)).lineLimit(1)
                                        Text(c.role).font(Typo.style(.caption2)).foregroundStyle(Palette.muted).lineLimit(1)
                                    }
                                    .frame(width: 66)
                                }
                                .buttonStyle(.plain)
                                .disabled(sending)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
    }

    /// 상위 5명 막대. 내가 고른 선수는 강조색.
    @ViewBuilder
    private func results(_ b: MvpResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if b.tally.isEmpty {
                Text("아직 투표가 없어요").font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
            }
            ForEach(b.tally.prefix(5), id: \.self) { t in
                let mine = b.myVote?.team == t.team && b.myVote?.name == t.name
                let share = b.total > 0 ? Double(t.votes) / Double(b.total) : 0
                let photo = b.candidates.first { $0.team == t.team && $0.name == t.name }?.photo
                HStack(spacing: 10) {
                    PlayerAvatar(url: photo, name: t.name, team: t.team, size: 32)
                    Text(t.name).font(Typo.style(.subheadline, mine ? .heavy : .semibold)).frame(width: 64, alignment: .leading).lineLimit(1)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.08))
                            Capsule().fill(mine ? Palette.accent : (Team.find(t.team)?.color ?? Palette.muted).opacity(0.8))
                                .frame(width: max(6, geo.size.width * share))
                        }
                    }
                    .frame(height: 8)
                    Text("\(Int((share * 100).rounded()))%")
                        .font(Typo.style(.footnote, .bold)).monospacedDigit().frame(width: 40, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(t.name) \(t.votes)표" + (mine ? ", 내가 고른 선수" : ""))
            }
            if canVote {
                Button("다시 고르기") { withAnimation(.snappy) { choosing = true } }
                    .font(Typo.style(.footnote, .semibold))
                    .foregroundStyle(Palette.accent)
            } else {
                Text("로그인하면 투표할 수 있어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
            }
        }
    }

    private func vote(_ c: MvpCandidate) {
        sending = true
        Task {
            defer { sending = false }
            do {
                let r = try await APIClient().voteMvp(id: game.id, team: c.team, name: c.name)
                withAnimation(.snappy) { ballot = r; choosing = false; failed = nil }
            } catch {
                failed = error.localizedDescription
            }
        }
    }
}

// MARK: - 프리뷰 탭 (경기정보 · 선발 비교 · 팀 비교 · 맞대결)

struct PreviewTab: View {
    let game: Game
    enum Section: Hashable { case starters, teams, h2h }
    @State private var section: Section = .starters
    @State private var preview: GamePreview?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            infoCard
            if let p = preview {
                PillChips(items: [(Section.starters, "선발 비교"), (.teams, "팀 비교"), (.h2h, "맞대결")], selection: $section)
                switch section {
                case .starters: StarterCompare(game: game, starters: p.starters)
                case .teams: TeamCompare(game: game, teams: p.teams)
                case .h2h: HeadToHeadCard(game: game, h2h: p.headToHead)
                }
            } else if failed {
                Card { Label("프리뷰를 불러오지 못했어요", systemImage: "wifi.exclamationmark").foregroundStyle(Palette.muted) }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 20)
            }
        }
        .task(id: game.id) {
            do { let p = try await APIClient().preview(id: game.id); withAnimation(.snappy) { preview = p } }
            catch is CancellationError {}
            catch { failed = true }
        }
    }

    /// 날짜 · 경기장 · 방송사
    private var infoCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text("경기정보").font(Typo.style(.headline))
                info("날짜", game.startDate.map { "\(KST.fullDate.string(from: $0)) \(KST.clock.string(from: $0))" })
                info("경기장", game.stadium)
                info("방송사", game.broadcast)
            }
        }
    }

    @ViewBuilder
    private func info(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(spacing: 0) {
                Text(label).font(Typo.style(.subheadline)).foregroundStyle(Palette.muted).frame(width: 72, alignment: .leading)
                Text(value).font(Typo.style(.subheadline, .medium))
            }
        }
    }
}

/// 비교표 한 줄: 왼쪽 값 · 가운데 항목 · 오른쪽 값, 나은 쪽은 강조색
struct CompareRow: View {
    let label: String
    let left: String
    let right: String
    var better: Int = 0   // -1 왼쪽, 1 오른쪽, 0 없음

    var body: some View {
        HStack {
            Text(left).font(Typo.style(.subheadline, better < 0 ? .bold : .regular))
                .foregroundStyle(better < 0 ? Palette.accent : Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(label).font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
            Text(right).font(Typo.style(.subheadline, better > 0 ? .bold : .regular))
                .foregroundStyle(better > 0 ? Palette.accent : Palette.text)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .monospacedDigit()
    }

    /// 숫자 둘을 비교해 나은 쪽 (낮을수록 좋은 기록이면 lower)
    static func pick(_ a: Double?, _ b: Double?, lower: Bool = false) -> Int {
        guard let a, let b, a != b else { return 0 }
        return (a < b) == lower ? -1 : 1
    }
}

/// 선발투수 비교 (정규시즌 기록)
struct StarterCompare: View {
    let game: Game
    let starters: PreviewStarters

    var body: some View {
        let a = starters.away.stats, h = starters.home.stats
        Card {
            VStack(spacing: 16) {
                HStack(alignment: .top) {
                    face(starters.away)
                    Spacer()
                    Text("정규시즌").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted).padding(.top, 40)
                    Spacer()
                    face(starters.home)
                }
                if a == nil && h == nil {
                    Text(starters.away.name == nil && starters.home.name == nil ? "선발 투수가 아직 발표되지 않았어요" : "시즌 기록이 없어요")
                        .font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                } else {
                    VStack(spacing: 12) {
                        row("경기", a?.games.map { "\($0)" }, h?.games.map { "\($0)" }, CompareRow.pick(a?.games.map { Double($0) }, h?.games.map { Double($0) }))
                        row("승-패", record(a), record(h), CompareRow.pick(a?.wins.map { Double($0) }, h?.wins.map { Double($0) }))
                        row("평균자책", a?.era.map { String(format: "%.2f", $0) }, h?.era.map { String(format: "%.2f", $0) }, CompareRow.pick(a?.era, h?.era, lower: true))
                        row("이닝", a?.innings, h?.innings, 0)
                        row("탈삼진", a?.so.map { "\($0)" }, h?.so.map { "\($0)" }, CompareRow.pick(a?.so.map { Double($0) }, h?.so.map { Double($0) }))
                        row("WHIP", a?.whip.map { String(format: "%.2f", $0) }, h?.whip.map { String(format: "%.2f", $0) }, CompareRow.pick(a?.whip, h?.whip, lower: true))
                        row("WAR", a?.war.map { String(format: "%.2f", $0) }, h?.war.map { String(format: "%.2f", $0) }, CompareRow.pick(a?.war, h?.war))
                    }
                }
            }
        }
    }

    private func record(_ s: PlayerStats?) -> String? {
        guard let s, let w = s.wins, let l = s.losses else { return nil }
        return "\(w)승 \(l)패"
    }

    @ViewBuilder
    private func row(_ label: String, _ l: String?, _ r: String?, _ better: Int) -> some View {
        if l != nil || r != nil { CompareRow(label: label, left: l ?? "-", right: r ?? "-", better: better) }
    }

    /// 사진은 다른 앱처럼 둥근 사각 카드에
    private func face(_ s: PreviewStarter) -> some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surfaceHigh)
                if let url = s.photo.flatMap(URL.init(string:)) {
                    AsyncImage(url: url) { phase in
                        if case .success(let img) = phase { img.resizable().scaledToFill() } else { Color.clear }
                    }
                } else {
                    TeamBadge(code: s.team, size: 44).opacity(0.6)
                }
            }
            .frame(width: 84, height: 100)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            Text(s.name ?? "미정").font(Typo.style(.headline))
            Text(Team.find(s.team)?.name ?? s.team).font(Typo.style(.caption)).foregroundStyle(Palette.muted)
        }
        .frame(width: 110)
    }
}

/// 팀 비교 (순위표 기준)
struct TeamCompare: View {
    let game: Game
    let teams: PreviewTeams

    var body: some View {
        let a = teams.away, h = teams.home
        Card {
            VStack(spacing: 12) {
                HStack {
                    HStack(spacing: 6) { TeamBadge(code: game.away.code, size: 24); Text(game.away.name).font(Typo.style(.subheadline, .bold)) }
                    Spacer()
                    HStack(spacing: 6) { Text(game.home.name).font(Typo.style(.subheadline, .bold)); TeamBadge(code: game.home.code, size: 24) }
                }
                if a == nil && h == nil {
                    Text("순위 정보가 없어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                } else {
                    CompareRow(label: "순위", left: a.map { "\($0.rank)위" } ?? "-", right: h.map { "\($0.rank)위" } ?? "-",
                               better: CompareRow.pick(a.map { Double($0.rank) }, h.map { Double($0.rank) }, lower: true))
                    CompareRow(label: "승-패-무", left: a.map { "\($0.wins)-\($0.losses)-\($0.draws)" } ?? "-", right: h.map { "\($0.wins)-\($0.losses)-\($0.draws)" } ?? "-")
                    CompareRow(label: "승률", left: a?.pct.map { String(format: "%.3f", $0) } ?? "-", right: h?.pct.map { String(format: "%.3f", $0) } ?? "-",
                               better: CompareRow.pick(a?.pct, h?.pct))
                    CompareRow(label: "게임차", left: a?.gamesBehind.map { $0 == 0 ? "-" : String(format: "%g", $0) } ?? "-",
                               right: h?.gamesBehind.map { $0 == 0 ? "-" : String(format: "%g", $0) } ?? "-")
                    if a?.lastFive != nil || h?.lastFive != nil {
                        HStack {
                            form(a?.lastFive).frame(maxWidth: .infinity, alignment: .leading)
                            Text("최근 5경기").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                            form(h?.lastFive).frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                    CompareRow(label: "연속", left: a?.streak ?? "-", right: h?.streak ?? "-")
                }
            }
        }
    }

    /// "WWLWD" → 승 강조색, 패 회색, 무 흰색 점
    private func form(_ s: String?) -> some View {
        HStack(spacing: 4) {
            ForEach(Array((s ?? "").enumerated()), id: \.offset) { _, c in
                Circle().fill(c == "W" ? Palette.accent : c == "L" ? Color.white.opacity(0.2) : Color.white.opacity(0.6))
                    .frame(width: 9, height: 9)
            }
        }
    }
}

/// 올 시즌 맞대결
struct HeadToHeadCard: View {
    let game: Game
    let h2h: HeadToHead

    var body: some View {
        Card {
            VStack(spacing: 14) {
                Text("올 시즌 맞대결").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                HStack(spacing: 14) {
                    TeamBadge(code: game.away.code, size: 36)
                    Text("\(h2h.wins)").font(Typo.score(34)).foregroundStyle(Palette.text.opacity(h2h.wins < h2h.losses ? 0.35 : 1))
                    Text(":").font(Typo.font(24, .medium)).foregroundStyle(Palette.muted)
                    Text("\(h2h.losses)").font(Typo.score(34)).foregroundStyle(Palette.text.opacity(h2h.losses < h2h.wins ? 0.35 : 1))
                    TeamBadge(code: game.home.code, size: 36)
                }
                if h2h.draws > 0 { Text("무승부 \(h2h.draws)").font(Typo.style(.caption)).foregroundStyle(Palette.muted) }
                if h2h.recent.isEmpty {
                    Text("올 시즌 맞대결이 아직 없어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                } else {
                    VStack(spacing: 0) {
                        ForEach(h2h.recent) { g in
                            HStack {
                                Text(g.date.map { KST.ticketDate($0) } ?? "").font(Typo.style(.footnote)).foregroundStyle(Palette.muted).frame(width: 48, alignment: .leading)
                                Spacer()
                                TeamBadge(code: g.away, size: 20)
                                Text("\(g.awayScore) : \(g.homeScore)").font(Typo.score(15)).frame(width: 64)
                                TeamBadge(code: g.home, size: 20)
                                Spacer()
                                Color.clear.frame(width: 48, height: 1)
                            }
                            .padding(.vertical, 8)
                            .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - 요약 탭 (이닝별 점수 · 승패 투수 · 승리 확률 · MVP)

struct SummaryTab: View {
    let detail: GameDetail

    var body: some View {
        VStack(spacing: 14) {
            if let line = detail.lineScore {
                LineScoreView(game: detail.game, line: line, totals: detail.totals)
            }
            if let p = detail.pitchers, p.win != nil || p.lose != nil {
                DecisionCard(game: detail.game, pitchers: p)
            }
            WinTrendSection(detail: detail)
            if detail.game.status == .final { MvpCard(game: detail.game) }
        }
    }
}
