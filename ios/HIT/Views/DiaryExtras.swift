import SwiftUI

/// 직관 등급: 직관 횟수에 따라 오른다
enum DiaryGrade: Int, CaseIterable {
    case rookie, lover, maniac, player, coach, manager

    var title: String { ["야린이", "야구러버", "야구 매니아", "선수", "코치", "감독"][rawValue] }
    var symbol: String { ["leaf.fill", "heart.fill", "flame.fill", "figure.baseball", "clipboard.fill", "trophy.fill"][rawValue] }
    var need: Int { [0, 3, 10, 20, 35, 50][rawValue] }
    var next: DiaryGrade? { DiaryGrade(rawValue: rawValue + 1) }

    static func of(_ count: Int) -> DiaryGrade { allCases.last { count >= $0.need } ?? .rookie }
}

/// 직관 탭 위쪽 등급 카드: 지금 등급, 다음 등급까지 진행바, 통계 버튼
struct GradeCard: View {
    let count: Int
    let team: String?
    let onStats: () -> Void

    var body: some View {
        let grade = DiaryGrade.of(count)
        let color = Team.color(for: team)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: grade.symbol)
                    .font(.system(size: 20, weight: .bold))
                    .frame(width: 46, height: 46)
                    .background(color.opacity(0.4), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("직관 등급").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                    Text(grade.title).font(Typo.font(22, .heavy))
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(count)번").font(Typo.font(22, .heavy)).monospacedDigit()
                    Text("직관").font(Typo.style(.caption, .semibold)).foregroundStyle(Palette.muted)
                }
            }
            if let next = grade.next {
                ProgressView(value: Double(count - grade.need), total: Double(next.need - grade.need))
                    .tint(Palette.accent)
                Text("\(next.title)까지 \(next.need - count)번 남았어요")
                    .font(Typo.style(.footnote))
                    .foregroundStyle(Palette.text.opacity(0.75))
            } else {
                Text("가장 높은 등급이에요")
                    .font(Typo.style(.footnote))
                    .foregroundStyle(Palette.text.opacity(0.75))
            }
            Button(action: onStats) {
                Label("구장·상대팀·요일별 통계", systemImage: "chart.bar.fill")
                    .font(Typo.style(.footnote, .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(.white.opacity(0.1), in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .glassCard(22)
        .accessibilityElement(children: .contain)
    }
}

/// 구장별·상대 팀별·요일별 승률과 공유 카드
struct DiaryStatsView: View {
    let stats: DiaryStats?
    let count: Int
    let team: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let stats {
                        shareSection(stats)
                        BucketSection(title: "구장별", buckets: stats.stadiums)
                        BucketSection(title: "상대 팀별", buckets: stats.opponents)
                        BucketSection(title: "요일별", buckets: stats.weekdays.filter { $0.games > 0 })
                    } else {
                        Text("아직 기록이 없어요").foregroundStyle(Palette.muted).frame(maxWidth: .infinity).padding(.top, 60)
                    }
                }
                .padding(16)
            }
            .background(AppBackground())
            .navigationTitle("직관 통계")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    @MainActor
    private func shareSection(_ stats: DiaryStats) -> some View {
        let card = DiaryShareCard(stats: stats, count: count, team: team)
        let renderer = ImageRenderer(content: card)
        renderer.scale = 3
        return VStack(spacing: 12) {
            card.clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .frame(maxWidth: .infinity)
            if let ui = renderer.uiImage {
                let image = Image(uiImage: ui)
                ShareLink(item: image, preview: SharePreview("나의 직관 기록", image: image)) {
                    Label("이미지로 공유", systemImage: "square.and.arrow.up")
                        .font(Typo.style(.headline))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Palette.accent, in: Capsule())
                        .foregroundStyle(.black)
                }
            }
        }
    }
}

/// 승·패 막대가 있는 한 줄 목록
private struct BucketSection: View {
    let title: String
    let buckets: [DiaryBucket]

    var body: some View {
        if !buckets.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: title)
                VStack(spacing: 0) {
                    ForEach(Array(buckets.prefix(8).enumerated()), id: \.element.id) { i, b in
                        HStack(spacing: 10) {
                            Text(b.label).font(Typo.style(.subheadline, .semibold)).frame(width: 78, alignment: .leading).lineLimit(1)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.white.opacity(0.1))
                                    Capsule().fill(Palette.accent).frame(width: geo.size.width * (b.pct ?? 0))
                                }
                            }
                            .frame(height: 8)
                            Text(b.record).font(Typo.style(.caption)).foregroundStyle(Palette.text.opacity(0.8)).frame(width: 74, alignment: .trailing)
                            Text(b.pct.map { "\(Int(($0 * 100).rounded()))%" } ?? "-")
                                .font(Typo.style(.caption, .bold)).monospacedDigit().frame(width: 38, alignment: .trailing)
                        }
                        .padding(.vertical, 10)
                        if i < min(buckets.count, 8) - 1 { Divider().overlay(.white.opacity(0.08)) }
                    }
                }
                .padding(.horizontal, 14)
                .glassCard(18)
            }
        }
    }
}

/// 공유용 카드. 이미지로 저장되므로 재질 없이 색과 글자만 쓴다.
struct DiaryShareCard: View {
    let stats: DiaryStats
    let count: Int
    let team: String?

    var body: some View {
        let color = Team.color(for: team)
        let grade = DiaryGrade.of(count)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                if let team { TeamBadge(code: team, size: 34) }
                Text("HIT 직관 기록").font(Typo.font(15, .heavy))
                Spacer()
                Text(grade.title).font(Typo.font(13, .heavy))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(.white.opacity(0.2), in: Capsule())
            }
            Spacer(minLength: 0)
            Text(stats.pct.map { "\(Int(($0 * 100).rounded()))%" } ?? "-")
                .font(Typo.font(64, .black))
            Text("나의 승요력 · \(stats.wins)승 \(stats.losses)패" + (stats.draws > 0 ? " \(stats.draws)무" : ""))
                .font(Typo.font(16, .bold))
            HStack(spacing: 18) {
                stat("직관", "\(count)번")
                stat("연속", stats.streak ?? "-")
                if let best = stats.stadiums.filter({ $0.games > 0 }).max(by: { $0.games < $1.games }) {
                    stat("자주 간 구장", best.label)
                }
            }
        }
        .foregroundStyle(.white)
        .padding(22)
        .frame(width: 340, height: 360)
        .background(LinearGradient(colors: [color, Color.black.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Typo.font(11, .semibold)).foregroundStyle(.white.opacity(0.7))
            Text(value).font(Typo.font(16, .heavy))
        }
    }
}

/// 티켓 아래쪽 바코드 장식
struct BarcodeMark: View {
    var body: some View {
        HStack(spacing: 1.5) {
            ForEach(0..<24, id: \.self) { i in
                Rectangle().frame(width: [2.6, 1.2, 1.8, 1.2, 2.2][i % 5])
            }
        }
        .frame(height: 16)
        .foregroundStyle(.white.opacity(0.5))
        .accessibilityHidden(true)
    }
}
