import SwiftUI
import WidgetKit

/// 홈 화면 위젯: 오늘 내 팀 경기 (작은/중간 크기).
struct MyTeamEntry: TimelineEntry {
    let date: Date
    let team: String?
    let game: Game?
    let note: String?
}

struct MyTeamProvider: TimelineProvider {
    func placeholder(in context: Context) -> MyTeamEntry {
        MyTeamEntry(date: Date(), team: "SS", game: nil, note: "오늘 경기")
    }

    func getSnapshot(in context: Context, completion: @escaping (MyTeamEntry) -> Void) {
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MyTeamEntry>) -> Void) {
        Task {
            let entry = await load()
            // 경기 중이면 자주, 아니면 드물게. (실시간은 라이브 액티비티가 맡는다)
            let minutes: Double = entry.game?.status == .live ? 10 : 60
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(minutes * 60))))
        }
    }

    private func load() async -> MyTeamEntry {
        let team = SharedSettings.myTeam
        guard let team else { return MyTeamEntry(date: Date(), team: nil, game: nil, note: "앱에서 응원 팀을 골라 주세요") }
        do {
            let games = try await APIClient().games(date: KST.dayString(Date())).games
            let game = games.first { $0.involves(team) }
            return MyTeamEntry(date: Date(), team: team, game: game, note: game == nil ? "오늘은 경기가 없어요" : nil)
        } catch {
            return MyTeamEntry(date: Date(), team: team, game: nil, note: "불러오지 못했어요")
        }
    }
}

struct MyTeamWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "MyTeamWidget", provider: MyTeamProvider()) { entry in
            MyTeamWidgetView(entry: entry)
                .containerBackground(for: .widget) { Palette.background }
        }
        .configurationDisplayName("내 팀 경기")
        .description("응원 팀의 오늘 경기와 점수")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct MyTeamWidgetView: View {
    let entry: MyTeamEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let game = entry.game {
                content(game)
                    .widgetURL(URL(string: "hit://game/\(game.id)"))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    if let team = entry.team { TeamBadge(code: team, size: 30) }
                    Spacer()
                    Text(entry.note ?? "")
                        .font(.footnote)
                        .foregroundStyle(Palette.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .foregroundStyle(Palette.text)
    }

    @ViewBuilder
    private func content(_ game: Game) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                if game.status == .live { Circle().fill(Palette.live).frame(width: 6, height: 6) }
                Text(game.statusLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(game.status == .live ? Palette.live : Palette.amber)
                if family == .systemMedium, let stadium = game.stadium {
                    Text(stadium).font(.caption2).foregroundStyle(Palette.muted)
                }
            }
            Spacer(minLength: 0)
            if family == .systemMedium {
                HStack {
                    side(game.away)
                    Spacer()
                    score(game, size: 34)
                    Spacer()
                    side(game.home)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    row(game.away, game: game)
                    row(game.home, game: game)
                }
            }
            if game.status == .scheduled, let a = game.away.starter, let h = game.home.starter {
                Text("\(a) 대 \(h)").font(.caption2).foregroundStyle(Palette.muted).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func side(_ s: GameSide) -> some View {
        VStack(spacing: 4) {
            TeamBadge(code: s.code, size: 34)
            Text(s.name).font(.caption2).foregroundStyle(Palette.muted)
        }
    }

    private func row(_ s: GameSide, game: Game) -> some View {
        HStack(spacing: 6) {
            TeamBadge(code: s.code, size: 22)
            Text(s.name).font(.caption)
            Spacer()
            if game.hasScore { Text("\(s.score ?? 0)").font(Typo.score(18)).foregroundStyle(Palette.amber) }
        }
    }

    @ViewBuilder
    private func score(_ game: Game, size: CGFloat) -> some View {
        if game.hasScore {
            Text("\(game.away.score ?? 0) : \(game.home.score ?? 0)").font(Typo.score(size)).foregroundStyle(Palette.amber)
        } else {
            Text(game.clockText).font(Typo.score(size * 0.7))
        }
    }
}
