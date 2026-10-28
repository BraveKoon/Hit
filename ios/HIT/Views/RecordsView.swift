import SwiftUI

enum RecordKind: Hashable { case team, pitcher, hitter }

/// 기록: 팀 순위 · 투수 TOP20 · 타자 TOP20
@MainActor
struct RecordsView: View {
    @Environment(AppModel.self) private var model
    @State private var kind: RecordKind = .team
    @State private var standings: [Standing] = []
    @State private var pitchers: [Player] = []
    @State private var hitters: [Player] = []
    @State private var error: String?
    private let season = String(KST.dayString(Date()).prefix(4))

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.recordsPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader { model.recordsPath.append(.search) }
                    PillChips(items: [(RecordKind.team, "팀"), (.pitcher, "투수 TOP20"), (.hitter, "타자 TOP20")], selection: $kind)
                    if let error, standings.isEmpty && pitchers.isEmpty {
                        MessageView(title: "기록을 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                            .padding(.top, 40)
                    } else {
                        switch kind {
                        case .team: StandingsTable(standings: standings, myTeam: model.myTeam)
                        case .pitcher: LeadersTable(players: pitchers, pitcher: true) { model.recordsPath.append(.player($0)) }
                        case .hitter: LeadersTable(players: hitters, pitcher: false) { model.recordsPath.append(.player($0)) }
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
        pitchers = (try? await api.leaders(type: "pitcher").players) ?? pitchers
        hitters = (try? await api.leaders(type: "hitter").players) ?? hitters
    }
}

/// 팀 순위표: 순위·엠블럼·팀 / 승 패 무 / 승률 / 게임차
struct StandingsTable: View {
    let standings: [Standing]
    let myTeam: String?

    private let cols: [(String, CGFloat)] = [("승", 40), ("패", 40), ("무", 32), ("승률", 58), ("게임차", 52)]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text("팀").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 46)
                ForEach(cols.indices, id: \.self) { i in Text(cols[i].0).frame(width: cols[i].1) }
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Palette.text.opacity(0.85))
            .padding(.vertical, 14)
            Rectangle().fill(Palette.surfaceHigh).frame(height: 2)
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
                Text("\(t.rank)").font(.system(size: 16, weight: .medium)).frame(width: 22)
                TeamBadge(code: t.code, size: 38)
                Text(Team.find(t.code)?.short ?? t.name).font(.system(size: 17, weight: mine ? .heavy : .semibold)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            Group {
                Text("\(t.wins)").frame(width: 40)
                Text("\(t.losses)").frame(width: 40)
                Text("\(t.draws)").frame(width: 32)
                Text(t.pct.map { String(format: "%.3f", $0) } ?? "-").frame(width: 58)
                Text(gb).frame(width: 52)
            }
            .font(.system(size: 17, weight: .regular))
        }
        .foregroundStyle(Palette.text)
        .frame(height: 64)
        .background(mine ? Palette.amber.opacity(0.14) : (t.rank == 1 ? Color(hex: 0x141416) : Palette.surface))
        .overlay(alignment: .leading) { if mine { Rectangle().fill(Palette.amber).frame(width: 4) } }
        .overlay(alignment: .trailing) {
            // 팀 칸과 숫자 칸 사이 은은한 세로선
            Rectangle().fill(.white.opacity(0.06)).frame(width: 1).padding(.trailing, 222)
        }
    }
}

/// 투수·타자 TOP20 (WAR 순)
struct LeadersTable: View {
    let players: [Player]
    let pitcher: Bool
    let open: (String) -> Void

    private var heads: [String] { pitcher ? ["ERA", "승", "이닝", "탈삼진", "WAR"] : ["타율", "홈런", "타점", "OPS", "WAR"] }

    var body: some View {
        if players.isEmpty {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Text("선수").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 46)
                    ForEach(heads, id: \.self) { Text($0).frame(width: 46) }
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.text.opacity(0.85))
                .padding(.vertical, 12)
                Rectangle().fill(Palette.surfaceHigh).frame(height: 2)
                ForEach(Array(players.enumerated()), id: \.element.id) { i, p in
                    Button { open(p.id) } label: { row(i + 1, p) }
                        .buttonStyle(.plain)
                        .appearIn(i)
                    Rectangle().fill(Color.black.opacity(0.55)).frame(height: 1)
                }
            }
            .padding(.horizontal, -16)
            .monospacedDigit()
        }
    }

    private func row(_ rank: Int, _ p: Player) -> some View {
        let s = p.stats
        let values: [String] = pitcher
            ? [StatFormat.fixed(s.era), StatFormat.int(s.wins), s.innings ?? "-", StatFormat.int(s.so), StatFormat.fixed(s.war)]
            : [StatFormat.rate(s.avg), StatFormat.int(s.hr), StatFormat.int(s.rbi), StatFormat.rate(s.ops), StatFormat.fixed(s.war)]
        return HStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("\(rank)").font(.system(size: 15, weight: .medium)).frame(width: 22)
                PlayerAvatar(url: p.photo, name: p.name, team: p.team, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.system(size: 15, weight: .bold)).lineLimit(1)
                    HStack(spacing: 4) {
                        TeamBadge(code: p.team, size: 14)
                        Text(Team.find(p.team)?.short ?? p.team).font(.caption2).foregroundStyle(Palette.muted)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            ForEach(values.indices, id: \.self) { i in
                Text(values[i])
                    .font(.system(size: 14, weight: i == values.count - 1 ? .heavy : .regular))
                    .foregroundStyle(i == values.count - 1 ? Palette.amber : Palette.text)
                    .minimumScaleFactor(0.7)
                    .frame(width: 46)
            }
        }
        .frame(height: 62)
        .background(.white.opacity(0.06))
    }
}
