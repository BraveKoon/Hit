import Charts
import SwiftUI

enum DetailTab: String, CaseIterable, Identifiable {
    case live = "중계", lineup = "라인업", record = "기록"
    var id: String { rawValue }
}

/// 경기 중계: 점수판 → [중계 | 라인업 | 기록]
@MainActor
struct GameDetailView: View {
    let gameId: String
    @State private var detail: GameDetail?
    @State private var error: String?
    @State private var tab: DetailTab = .live
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
                        DetailTabs(selection: $tab)
                        switch tab {
                        case .live: LiveTab(detail: detail, focusInning: focusInning)
                        case .lineup: LineupTab(detail: detail)
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
                HomeRunBurst(name: burst.name, colors: [Team.find(burst.team)?.color ?? Palette.amber])
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
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(Palette.amber)
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
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .foregroundStyle(activityOn ? Palette.text : Palette.amber)
                        .background(activityOn ? Palette.surfaceHigh : Palette.amber.opacity(0.14), in: Capsule())
                }
                if let activityError {
                    Text(activityError).font(.caption).foregroundStyle(Palette.red)
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
                    .font(.caption)
                    .foregroundStyle(Palette.text.opacity(0.7))
            }
            HStack {
                team(game.away, won: game.winner == "away")
                Spacer()
                if game.hasScore {
                    Text("\(game.away.score ?? 0)  :  \(game.home.score ?? 0)")
                        .font(.system(size: 44, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        // 점수가 바뀌면 한 번 튀고 앰버 빛이 번진다
                        .keyframeAnimator(initialValue: 0.0, trigger: (game.away.score ?? 0) + (game.home.score ?? 0)) { view, k in
                            view
                                .scaleEffect(1 + k * 0.18)
                                .shadow(color: Palette.amber.opacity(k * 0.9), radius: 22 * k)
                        } keyframes: { _ in
                            KeyframeTrack(\.self) {
                                SpringKeyframe(1, duration: 0.18)
                                SpringKeyframe(0, duration: 0.45)
                            }
                        }
                } else {
                    VStack(spacing: 2) {
                        Text(game.clockText).font(.system(size: 34, weight: .heavy, design: .rounded))
                        Text(game.broadcast ?? "경기 시작").font(.caption2).foregroundStyle(Palette.muted)
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

    private func team(_ s: GameSide, won: Bool) -> some View {
        VStack(spacing: 7) {
            TeamBadge(code: s.code, size: 56)
            Text(s.name).font(.subheadline.weight(.bold))
            Text(won ? "승리" : " ")
                .font(.caption2.weight(.heavy))
                .foregroundStyle(Palette.amber)
        }
        .frame(width: 86)
    }
}

struct DetailTabs: View {
    @Binding var selection: DetailTab
    @Namespace private var underline

    var body: some View {
        HStack(spacing: 0) {
            ForEach(DetailTab.allCases) { t in
                Button { withAnimation(.snappy) { selection = t } } label: {
                    VStack(spacing: 8) {
                        Text(t.rawValue)
                            .font(.subheadline.weight(selection == t ? .bold : .medium))
                            .foregroundStyle(selection == t ? Palette.text : Palette.muted)
                        ZStack {
                            Capsule().fill(.clear).frame(height: 3)
                            if selection == t {
                                Capsule().fill(Palette.amber).frame(height: 3).matchedGeometryEffect(id: "u", in: underline)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
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
                    FieldCard(situation: s)
                    MatchupCard(game: detail.game, situation: s)
                }
                if !detail.atBat.isEmpty { PitchCard(pitches: detail.atBat) }
            case .scheduled:
                StartersCard(game: detail.game)
            default:
                if let p = detail.pitchers, p.win != nil { DecisionCard(game: detail.game, pitchers: p) }
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
                    .font(.caption.weight(.semibold))
                    .tint(Palette.amber)
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
                                    .font(.system(size: 14, weight: on ? .bold : .medium))
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .foregroundStyle(on ? Color.black : Palette.text.opacity(0.75))
                            .background {
                                if on { Capsule().fill(Palette.amber) } else { Color.clear.glassCapsule() }
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

// MARK: - 그라운드

struct FieldCard: View {
    let situation: Situation

    var body: some View {
        Card {
            HStack(spacing: 18) {
                FieldGraphic(bases: situation.bases)
                    .frame(width: 128, height: 112)
                VStack(alignment: .leading, spacing: 10) {
                    count("B", situation.balls, of: 3, color: Palette.live)
                    count("S", situation.strikes, of: 2, color: Palette.amber)
                    count("O", situation.outs, of: 2, color: Palette.red)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func count(_ label: String, _ n: Int, of max: Int, color: Color) -> some View {
        HStack(spacing: 7) {
            Text(label).font(.system(.callout, design: .rounded).weight(.heavy)).foregroundStyle(Palette.muted).frame(width: 16)
            ForEach(0..<max, id: \.self) { i in
                Circle().fill(i < n ? color : Color.white.opacity(0.1)).frame(width: 14, height: 14)
                    .shadow(color: i < n ? color.opacity(0.6) : .clear, radius: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(label == "B" ? "볼" : label == "S" ? "스트라이크" : "아웃") \(n)")
    }
}

struct FieldGraphic: View {
    let bases: [Bool]
    private func on(_ i: Int) -> Bool { bases.indices.contains(i) && bases[i] }

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            // 외야 잔디 부채꼴
            var grass = Path()
            grass.move(to: CGPoint(x: w / 2, y: h))
            grass.addArc(center: CGPoint(x: w / 2, y: h), radius: h * 0.98, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
            grass.closeSubpath()
            ctx.fill(grass, with: .linearGradient(Gradient(colors: [Color(hex: 0x1F6B3E), Color(hex: 0x154D2D)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
            // 내야 흙
            let home = CGPoint(x: w / 2, y: h * 0.9), first = CGPoint(x: w * 0.78, y: h * 0.58)
            let second = CGPoint(x: w / 2, y: h * 0.26), third = CGPoint(x: w * 0.22, y: h * 0.58)
            var dirt = Path()
            dirt.addLines([home, first, second, third])
            dirt.closeSubpath()
            ctx.fill(dirt, with: .color(Palette.clay.opacity(0.85)))
            ctx.stroke(dirt, with: .color(.white.opacity(0.7)), lineWidth: 1.5)
            // 베이스
            for (i, p) in [first, second, third].enumerated() {
                let r = CGRect(x: p.x - 8, y: p.y - 8, width: 16, height: 16)
                let base = Path(roundedRect: r, cornerRadius: 2).applying(CGAffineTransform(translationX: -p.x, y: -p.y).concatenating(CGAffineTransform(rotationAngle: .pi / 4)).concatenating(CGAffineTransform(translationX: p.x, y: p.y)))
                ctx.fill(base, with: .color(on(i) ? Palette.amber : .white))
            }
            var plate = Path()
            plate.addEllipse(in: CGRect(x: home.x - 5, y: home.y - 5, width: 10, height: 10))
            ctx.fill(plate, with: .color(.white))
        }
        .accessibilityLabel(bases.contains(true) ? "주자 " + [0, 1, 2].filter(on).map { "\($0 + 1)루" }.joined(separator: " ") : "주자 없음")
    }
}

/// 투수 대 타자
struct MatchupCard: View {
    let game: Game
    let situation: Situation

    var body: some View {
        let battingTeam = game.half == "top" ? game.away.code : game.home.code
        let pitchingTeam = game.half == "top" ? game.home.code : game.away.code
        Card {
            HStack(alignment: .top, spacing: 12) {
                person("투수", situation.pitcher, team: pitchingTeam)
                Text("VS").font(.caption.weight(.heavy)).foregroundStyle(Palette.muted).padding(.top, 24)
                person("타자", situation.batter, team: battingTeam)
            }
        }
    }

    private func person(_ role: String, _ p: PlayerLine?, team: String) -> some View {
        VStack(spacing: 6) {
            PlayerAvatar(url: p?.photo, name: p?.name ?? role, team: team, size: 58)
            Text(role).font(.caption2.weight(.bold)).foregroundStyle(Palette.muted)
            Text(p?.name ?? "-").font(.subheadline.weight(.bold))
            if let line = p?.line {
                Text(line).font(.caption2).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// 현재 타석 투구
struct PitchCard: View {
    let pitches: [Pitch]

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text("이번 타석 투구").font(.subheadline.weight(.bold))
                HStack(alignment: .top, spacing: 14) {
                    StrikeZoneView(pitches: pitches).frame(width: 112, height: 136)
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(pitches) { p in
                            HStack(spacing: 8) {
                                Text("\(p.n)")
                                    .font(.caption2.weight(.heavy))
                                    .frame(width: 18, height: 18)
                                    .background(StrikeZoneView.color(for: p.result), in: Circle())
                                    .foregroundStyle(.black)
                                Text(p.text).font(.caption.weight(.semibold))
                                Spacer(minLength: 0)
                                Text([p.pitchType, p.speed.map { "\(Int($0))km" }].compactMap { $0 }.joined(separator: " "))
                                    .font(.caption2)
                                    .foregroundStyle(Palette.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 투구 위치 (포수 시점). 가로 ±1.4ft, 세로 0.5~4.5ft.
struct StrikeZoneView: View {
    let pitches: [Pitch]

    static func color(for result: String) -> Color {
        switch result {
        case "B": return Palette.live
        case "H": return Color(hex: 0x6BB7FF)
        default: return Palette.amber
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
                ctx.draw(Text("\(p.n)").font(.system(size: 10, weight: .heavy)).foregroundColor(.black), at: c)
            }
        }
        .background(Palette.surfaceHigh.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("투구 위치 \(pitches.count)개")
    }
}

/// 경기 전: 선발 맞대결
struct StartersCard: View {
    let game: Game
    var body: some View {
        Card {
            VStack(spacing: 14) {
                Text("선발 투수").font(.subheadline.weight(.bold)).frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    starter(game.away)
                    Text("VS").font(.caption.weight(.heavy)).foregroundStyle(Palette.muted)
                    starter(game.home)
                }
            }
        }
    }
    private func starter(_ s: GameSide) -> some View {
        VStack(spacing: 8) {
            PlayerAvatar(url: s.starterPhoto, name: s.starter ?? s.name, team: s.code, size: 72)
            Text(s.starter ?? "미정").font(.headline)
            Text(s.name).font(.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 경기 후: 승리·패전 투수
struct DecisionCard: View {
    let game: Game
    let pitchers: Pitchers
    var body: some View {
        Card {
            HStack {
                decision("승리 투수", pitchers.win, color: Palette.amber)
                Rectangle().fill(.white.opacity(0.07)).frame(width: 1, height: 40)
                decision("패전 투수", pitchers.lose, color: Palette.muted)
            }
        }
    }
    private func decision(_ label: String, _ name: String?, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(color)
            Text(name ?? "-").font(.headline)
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
                        .font(.caption.weight(.bold))
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
                .fill(hr ? Palette.red : scored ? Palette.amber : .clear)
                .frame(width: 3)
            if let batter = play.batterName {
                PlayerAvatar(url: play.photo, name: batter,
                             team: play.half == "top" ? game.away.code : game.home.code, size: 26)
            }
            Text(play.text)
                .font(play.isPitch ? .caption : .subheadline.weight(hr || scored ? .semibold : .regular))
                .foregroundStyle(play.isPitch ? Palette.muted : Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if hr {
                Text("홈런").font(.caption2.weight(.heavy)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Palette.red.opacity(0.2), in: Capsule()).foregroundStyle(Palette.red)
            } else if scored {
                Text("득점").font(.caption2.weight(.heavy)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Palette.amber.opacity(0.2), in: Capsule()).foregroundStyle(Palette.amber)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(hr ? Palette.red.opacity(0.06) : scored ? Palette.amber.opacity(0.05) : .clear)
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
                Text(side.name).font(.subheadline.weight(.bold))
            }
            .padding(12)
            ForEach(players) { p in
                HStack(spacing: 8) {
                    Text("\(p.order)").font(.caption.weight(.heavy)).foregroundStyle(Palette.amber).frame(width: 14)
                    PlayerAvatar(url: p.photo, name: p.name, team: side.code, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text(p.pos).font(.caption2).foregroundStyle(Palette.muted)
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
            WinTrendSection(detail: detail)
            if let p = detail.pitchers, p.win != nil {
                DecisionCard(game: detail.game, pitchers: p)
            }
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
                Text(side.name).font(.caption.weight(.bold))
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
            .font(header ? .caption2.weight(.bold) : .system(.footnote, design: .rounded).weight(total || scored ? .heavy : .medium))
            .foregroundStyle(header ? Palette.muted : total ? Palette.amber : scored ? Palette.text : Palette.muted)
            .frame(width: 28, height: 34)
            .background(live ? Palette.amber.opacity(0.16) : .clear)
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
                    Text("\(Int(rate.away.rounded()))%").font(.headline.monospacedDigit())
                    Spacer()
                    Text("승리 확률").font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                    Spacer()
                    Text("\(Int(rate.home.rounded()))%").font(.headline.monospacedDigit())
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
                .font(.caption)
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
                    Text("\(Int((100 - last).rounded()))%").font(.headline.monospacedDigit())
                    Spacer()
                    Text("승리 확률 흐름").font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                    Spacer()
                    Text("\(Int(last.rounded()))%").font(.headline.monospacedDigit())
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
                        .foregroundStyle(Palette.amber)
                }
                .chartYScale(domain: 0...100)
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks(values: inningStarts) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.08))
                        AxisValueLabel {
                            if let i = value.as(Int.self), points.indices.contains(i) {
                                Text("\(points[i].inning)회").font(.caption2).foregroundStyle(Palette.muted)
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
                .font(.caption)
                .foregroundStyle(Palette.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("승리 확률 흐름")
        .accessibilityValue("지금 \(game.home.name) \(Int(last.rounded()))%, \(game.away.name) \(Int((100 - last).rounded()))%")
    }

    private func sideLabel(_ name: String, _ color: Color) -> some View {
        Text("\(name) 유리")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color.opacity(0.9))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.black.opacity(0.35), in: Capsule())
    }
}
