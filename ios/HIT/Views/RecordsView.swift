import SwiftUI

enum RecordKind: Hashable { case team, pitcher, hitter }

/// 기록: 팀 순위 · 투수 부문별 1등 · 타자 부문별 1등 (부문을 누르면 TOP20)
@MainActor
struct RecordsView: View {
    @Environment(AppModel.self) private var model
    @State private var kind: RecordKind = .team
    @State private var standings: [Standing] = []
    @State private var pitchers: [LeaderCategory] = []
    @State private var hitters: [LeaderCategory] = []
    @State private var board: LeaderBoard?      // 눌러서 연 부문 TOP20
    @State private var error: String?
    private let season = String(KST.dayString(Date()).prefix(4))

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.recordsPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader(title: "기록")
                    PillChips(items: [(RecordKind.team, "팀"), (.pitcher, "투수"), (.hitter, "타자")], selection: $kind)
                    if let error, standings.isEmpty && pitchers.isEmpty {
                        MessageView(title: "기록을 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                            .padding(.top, 40)
                    } else {
                        switch kind {
                        case .team: StandingsTable(standings: standings, myTeam: model.myTeam)
                        case .pitcher: LeaderGrid(categories: pitchers, title: "투수") { board = LeaderBoard(kind: "투수", category: $0) }
                        case .hitter: LeaderGrid(categories: hitters, title: "타자") { board = LeaderBoard(kind: "타자", category: $0) }
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
            .refreshable { await load() }
            .task { await load() }
            .sheet(item: $board) { b in
                LeaderBoardView(board: b) { id in
                    board = nil
                    model.recordsPath.append(.player(id))
                }
                .presentationDetents([.large])
            }
        }
    }

    private func load() async {
        let api = APIClient()
        do {
            standings = try await api.standings(season: season).teams
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        pitchers = (try? await api.leaderCategories(type: "pitcher").categories) ?? pitchers
        hitters = (try? await api.leaderCategories(type: "hitter").categories) ?? hitters
    }
}

/// 팀 순위표: 순위·엠블럼·팀 / 승 패 무 / 승률 / 게임차
struct StandingsTable: View {
    let standings: [Standing]
    let myTeam: String?

    private let cols: [(String, CGFloat)] = [("승", 34), ("패", 34), ("무", 28), ("승률", 52), ("게임차", 48)]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text("팀").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 40)
                ForEach(cols.indices, id: \.self) { i in Text(cols[i].0).frame(width: cols[i].1) }
            }
            .font(Typo.font(12, .medium))
            .foregroundStyle(Palette.muted)
            .padding(.vertical, 10)
            Rectangle().fill(Palette.surfaceHigh).frame(height: 1)
            ForEach(standings) { t in
                row(t)
                    .appearIn(t.rank)
                Rectangle().fill(Color.black.opacity(0.55)).frame(height: 1)
            }
        }
        .padding(.horizontal, -16)   // 루타처럼 화면 끝까지
        .monospacedDigit()
    }

    private func row(_ t: Standing) -> some View {
        let mine = t.code == myTeam
        let gb = t.gamesBehind.map { String(format: "%.1f", $0) } ?? "-"
        return HStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("\(t.rank)").font(Typo.font(14, .medium)).frame(width: 20)
                TeamBadge(code: t.code, size: 28)
                Text(Team.find(t.code)?.short ?? t.name).font(Typo.font(15, mine ? .heavy : .semibold)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            Group {
                Text("\(t.wins)").frame(width: 34)
                Text("\(t.losses)").frame(width: 34)
                Text("\(t.draws)").frame(width: 28)
                Text(t.pct.map { String(format: "%.3f", $0) } ?? "-").frame(width: 52)
                Text(gb).frame(width: 48)
            }
            .font(Typo.font(14, .regular))
        }
        .foregroundStyle(Palette.text)
        .frame(height: 48)
        .background(mine ? Palette.accent.opacity(0.14) : (t.rank == 1 ? Color(hex: 0x141416) : Palette.surface))
        .overlay(alignment: .leading) { if mine { Rectangle().fill(Palette.accent).frame(width: 4) } }
        .overlay(alignment: .trailing) {
            // 팀 칸과 숫자 칸 사이 은은한 세로선
            Rectangle().fill(.white.opacity(0.06)).frame(width: 1).padding(.trailing, 196)
        }
    }
}

/// 눌러서 연 부문 (시트 항목)
struct LeaderBoard: Identifiable {
    let kind: String            // "투수" · "타자"
    let category: LeaderCategory
    var id: String { "\(kind)-\(category.stat)" }
}

/// 부문 카드 격자: 다승·탈삼진·이닝·평균자책… 각각 1등을 보여 주고, 누르면 TOP20
struct LeaderGrid: View {
    let categories: [LeaderCategory]
    let title: String
    let open: (LeaderCategory) -> Void

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        if categories.isEmpty {
            SkeletonList(hero: 0, rows: 6).padding(.top, 8)
        } else {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Array(categories.enumerated()), id: \.element.id) { i, c in
                    Button { open(c) } label: { card(c) }
                        .buttonStyle(.press)
                        .appearIn(i)
                }
            }
        }
    }

    private func card(_ c: LeaderCategory) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(c.label).font(Typo.style(.footnote, .bold)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.muted)
            }
            if let top = c.players.first {
                HStack(spacing: 8) {
                    PlayerAvatar(url: top.photo, name: top.name, team: top.team, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(top.name).font(Typo.font(14, .bold)).lineLimit(1)
                        Text(Team.find(top.team)?.short ?? top.team).font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                    }
                    Spacer(minLength: 0)
                }
                Text(StatFormat.value(c.stat, top))
                    .font(Typo.font(22, .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Palette.accent)
            } else {
                Text("기록 없음").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(16)
        .accessibilityElement(children: .combine)
    }
}

/// 한 부문의 TOP20 (시트)
struct LeaderBoardView: View {
    let board: LeaderBoard
    let open: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(board.category.players.enumerated()), id: \.element.id) { i, p in
                        Button { open(p.id) } label: { row(i + 1, p) }
                            .buttonStyle(.press)
                        Divider().overlay(.white.opacity(0.06))
                    }
                }
                .padding(.horizontal, 16)
            }
            .background(AppBackground())
            .navigationTitle("\(board.kind) \(board.category.label) TOP \(board.category.players.count)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
        }
    }

    private func row(_ rank: Int, _ p: Player) -> some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(Typo.font(15, rank <= 3 ? .heavy : .medium))
                .foregroundStyle(rank <= 3 ? Palette.accent : Palette.text.opacity(0.7))
                .frame(width: 24)
            PlayerAvatar(url: p.photo, name: p.name, team: p.team, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(Typo.font(15, .bold)).lineLimit(1)
                HStack(spacing: 4) {
                    TeamBadge(code: p.team, size: 14)
                    Text(Team.find(p.team)?.short ?? p.team).font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                }
            }
            Spacer(minLength: 0)
            Text(StatFormat.value(board.category.stat, p))
                .font(Typo.font(18, .heavy))
                .monospacedDigit()
                .foregroundStyle(rank == 1 ? Palette.accent : Palette.text)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
