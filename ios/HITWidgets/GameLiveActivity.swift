import ActivityKit
import SwiftUI
import WidgetKit

/// 잠금화면 배너 + 다이내믹 아일랜드.
struct GameLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameActivityAttributes.self) { context in
            LockScreenScoreboard(attributes: context.attributes, state: context.state, stale: context.isStale)
                .font(Typo.style(.body))
                .activityBackgroundTint(LockScreenScoreboard.tint(for: context.attributes).mix(.black, 0.4))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "hit://game/\(context.attributes.gameId)"))
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    IslandTeam(code: a.awayCode, name: a.awayName, score: s.awayScore,
                               ahead: s.awayScore > s.homeScore, final: s.isFinal, trailing: false)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandTeam(code: a.homeCode, name: a.homeName, score: s.homeScore,
                               ahead: s.homeScore > s.awayScore, final: s.isFinal, trailing: true)
                }
                DynamicIslandExpandedRegion(.center) {
                    IslandStatus(state: s, stale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    IslandPlayBar(attributes: a, state: s)
                }
            } compactLeading: {
                HStack(spacing: 5) {
                    TeamBadge(code: a.awayCode, size: 20)
                    IslandScore(score: s.awayScore, ahead: s.awayScore > s.homeScore, size: 15)
                }
            } compactTrailing: {
                HStack(spacing: 5) {
                    IslandScore(score: s.homeScore, ahead: s.homeScore > s.awayScore, size: 15)
                    TeamBadge(code: a.homeCode, size: 20)
                }
            } minimal: {
                // 다른 앱과 아일랜드를 나눠 쓸 때는 점수만
                Text("\(s.awayScore):\(s.homeScore)")
                    .font(Typo.font(12, .heavy))
                    .foregroundStyle(Palette.accent)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
            }
            .widgetURL(URL(string: "hit://game/\(a.gameId)"))
            .keylineTint(Team.color(for: s.homeScore >= s.awayScore ? a.homeCode : a.awayCode))
        }
    }
}

// MARK: - 다이나믹 아일랜드 조각

/// 점수 숫자. 이기고 있는 쪽만 강조색, 바뀔 때 숫자가 굴러간다.
private struct IslandScore: View {
    let score: Int
    let ahead: Bool
    var size: CGFloat = 34
    var final = false

    var body: some View {
        Text("\(score)")
            .font(Typo.font(size, .heavy))
            .monospacedDigit()
            .foregroundStyle(ahead ? Palette.accent : (final ? Palette.muted : Palette.text))
            .contentTransition(.numericText(value: Double(score)))
    }
}

/// 펼친 아일랜드 양옆: 큰 엠블럼 + 팀 이름, 바깥쪽 대신 안쪽에 큰 점수.
private struct IslandTeam: View {
    let code: String
    let name: String
    let score: Int
    let ahead: Bool
    let final: Bool
    let trailing: Bool

    var body: some View {
        HStack(spacing: 10) {
            if trailing { IslandScore(score: score, ahead: ahead, final: final) }
            VStack(spacing: 3) {
                TeamBadge(code: code, size: 40)
                    .background(Circle().fill(Team.color(for: code).opacity(0.35)).blur(radius: 10))
                Text(name)
                    .font(Typo.font(11, .semibold))
                    .foregroundStyle(Palette.text.opacity(0.85))
                    .lineLimit(1)
            }
            .frame(minWidth: 44)
            if !trailing { IslandScore(score: score, ahead: ahead, final: final) }
        }
        .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
        .padding(trailing ? .trailing : .leading, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) \(score)점")
    }
}

/// 가운데: 빨간 점 + 이닝 알약, 그 아래 주자 다이아몬드와 B·S·O.
private struct IslandStatus: View {
    let state: GameActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 5) {
                if !state.isFinal && !stale {
                    Circle().fill(Palette.red).frame(width: 6, height: 6)
                }
                Text(stale ? "지연" : state.inningText)
                    .font(Typo.font(12, .bold))
                    .foregroundStyle(state.isFinal || stale ? Palette.muted : Palette.text)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(.white.opacity(0.12)))
            .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 0.5))

            if !state.isFinal && state.status != "scheduled" {
                HStack(spacing: 8) {
                    DiamondView(bases: state.bases, outs: state.outs, showOuts: false)
                        .frame(width: 26, height: 26)
                    CountDots(balls: state.balls, strikes: state.strikes, outs: state.outs)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// B 초록 4칸 중 3, S 강조색 2, O 빨강 2.
struct CountDots: View {
    let balls: Int
    let strikes: Int
    let outs: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            row("B", balls, 3, Palette.live)
            row("S", strikes, 2, Palette.accent)
            row("O", outs, 2, Palette.red)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("볼 \(balls), 스트라이크 \(strikes), 아웃 \(outs)")
    }

    private func row(_ label: String, _ n: Int, _ max: Int, _ color: Color) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(Typo.font(8, .bold))
                .foregroundStyle(Palette.muted)
                .frame(width: 8)
            ForEach(0..<max, id: \.self) { i in
                Circle()
                    .fill(i < n ? color : .white.opacity(0.18))
                    .frame(width: 6, height: 6)
            }
        }
    }
}

/// 아래 줄: 방금 나온 장면 한 줄과 HIT 로고, 홈팀→원정팀 색 띠.
private struct IslandPlayBar: View {
    let attributes: GameActivityAttributes
    let state: GameActivityAttributes.ContentState

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: state.isFinal ? "flag.checkered" : "baseball.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text(state.headline.isEmpty ? attributes.stadium : state.headline)
                    .font(Typo.font(13, .medium))
                    .foregroundStyle(Palette.text.opacity(0.9))
                    .lineLimit(1)
                Spacer(minLength: 4)
                LogoMark(height: 10, color: Palette.accent)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.1), lineWidth: 0.5))

            LinearGradient(colors: [Team.color(for: attributes.awayCode), Team.color(for: attributes.homeCode)],
                           startPoint: .leading, endPoint: .trailing)
                .frame(height: 3)
                .clipShape(Capsule())
                .opacity(0.9)
        }
        .padding(.top, 4)
    }
}

/// 잠금화면 카드: 구단 색 바탕에 팀·점수·주자, 그 아래 투수(투구 수)·이닝·타자(타율), B·S·OUT, 방금 나온 장면.
struct LockScreenScoreboard: View {
    let attributes: GameActivityAttributes
    let state: GameActivityAttributes.ContentState
    var stale = false

    /// 카드 바탕색: 내 팀이 뛰는 경기면 내 팀 색, 아니면 홈 팀 색
    static func tint(for attributes: GameActivityAttributes) -> Color {
        let mine = SharedSettings.myTeam
        let code = mine == attributes.awayCode || mine == attributes.homeCode ? mine : attributes.homeCode
        return Team.color(for: code)
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 0) {
                teamName(attributes.awayName, alignment: .leading)
                score(state.awayScore)
                BasesView(bases: state.bases, dimmed: !state.isLive)
                    .frame(width: 58, height: 30)
                    .padding(.horizontal, 10)
                score(state.homeScore)
                teamName(attributes.homeName, alignment: .trailing)
            }

            HStack(alignment: .top, spacing: 6) {
                player(away: true)
                VStack(spacing: 6) {
                    Text(stale ? "업데이트 지연" : state.inningText)
                        .font(Typo.font(11, .bold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(.white.opacity(0.18)))
                    if state.isLive {
                        CountRow(balls: state.balls, strikes: state.strikes, outs: state.outs)
                    }
                }
                .layoutPriority(1)
                player(away: false)
            }

            Text(state.headline.isEmpty ? attributes.stadium : state.headline)
                .font(Typo.font(11.5, .medium))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(Capsule().fill(.black.opacity(0.22)))
                .overlay(Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .foregroundStyle(.white)
        .background(
            LinearGradient(colors: [Self.tint(for: attributes).mix(.black, 0.25), Self.tint(for: attributes).mix(.black, 0.55)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        )
    }

    private func teamName(_ name: String, alignment: Alignment) -> some View {
        Text(name)
            .font(Typo.font(17, .heavy))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, alignment: alignment)
    }

    private func score(_ value: Int) -> some View {
        Text("\(value)")
            .font(Typo.font(28, .heavy))
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(value)))
    }

    /// 원정 쪽(왼쪽) 또는 홈 쪽(오른쪽) 선수. 공격 팀에는 타자와 타율, 수비 팀에는 투수와 투구 수.
    @ViewBuilder
    private func player(away: Bool) -> some View {
        let batting = away == state.awayBatting
        let name = batting ? state.batterName : state.pitcherName
        let sub = batting ? state.batterAvg : state.pitchCount.map { "\($0)구" }
        VStack(alignment: away ? .leading : .trailing, spacing: 2) {
            if state.isLive, let name {
                Text(name)
                    .font(Typo.font(12.5, .semibold))
                    .lineLimit(1)
                Text(sub ?? " ")
                    .font(Typo.font(10.5, .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity, alignment: away ? .leading : .trailing)
    }
}

/// 2루를 위로 한 다이아몬드 세 개. 주자가 있으면 흰색으로 채운다.
struct BasesView: View {
    let bases: [Bool]
    var dimmed = false

    private func on(_ i: Int) -> Bool { !dimmed && bases.indices.contains(i) && bases[i] }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let side = min(w / 3.1, h / 1.55)
            ZStack {
                base(on(2), side).position(x: w / 2 - side * 0.78, y: h - side * 0.72)   // 3루
                base(on(1), side).position(x: w / 2, y: side * 0.72)                    // 2루
                base(on(0), side).position(x: w / 2 + side * 0.78, y: h - side * 0.72)   // 1루
            }
        }
        .accessibilityElement()
        .accessibilityLabel(bases.contains(true) && !dimmed
            ? "주자 " + [0, 1, 2].filter(on).map { "\($0 + 1)루" }.joined(separator: " ") : "주자 없음")
    }

    private func base(_ filled: Bool, _ side: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: side * 0.12, style: .continuous)
            .fill(filled ? Color.white : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: side * 0.12, style: .continuous)
                .strokeBorder(.white.opacity(filled ? 1 : 0.75), lineWidth: 1.4))
            .frame(width: side, height: side)
            .rotationEffect(.degrees(45))
    }
}

/// 한 줄 B ●●● S ●● OUT ●●
struct CountRow: View {
    let balls: Int
    let strikes: Int
    let outs: Int

    var body: some View {
        HStack(spacing: 8) {
            group("B", balls, 3, Palette.live)
            group("S", strikes, 2, Color(hex: 0xF5C542))
            group("OUT", outs, 2, Palette.red)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("볼 \(balls), 스트라이크 \(strikes), 아웃 \(outs)")
    }

    private func group(_ label: String, _ n: Int, _ max: Int, _ color: Color) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(Typo.font(9.5, .heavy))
            ForEach(0..<max, id: \.self) { i in
                Circle()
                    .fill(i < n ? color : .white.opacity(0.25))
                    .frame(width: 5.5, height: 5.5)
            }
        }
    }
}

extension Color {
    /// 다른 색과 섞기 (카드 바탕을 구단 색보다 어둡게)
    func mix(_ other: Color, _ amount: Double) -> Color {
        let a = UIColor(self), b = UIColor(other)
        var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        let t = CGFloat(amount)
        return Color(red: Double(r1 + (r2 - r1) * t), green: Double(g1 + (g2 - g1) * t),
                     blue: Double(b1 + (b2 - b1) * t), opacity: Double(a1 + (a2 - a1) * t))
    }
}
