import ActivityKit
import SwiftUI
import WidgetKit

/// 잠금화면 배너 + 다이내믹 아일랜드.
struct GameLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameActivityAttributes.self) { context in
            LockScreenScoreboard(attributes: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Palette.surface.opacity(0.92))
                .activitySystemActionForegroundColor(Palette.amber)
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
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(Palette.amber)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
            }
            .widgetURL(URL(string: "hit://game/\(a.gameId)"))
            .keylineTint(Team.color(for: s.homeScore >= s.awayScore ? a.homeCode : a.awayCode))
        }
    }
}

// MARK: - 다이나믹 아일랜드 조각

/// 점수 숫자. 이기고 있는 쪽만 앰버, 바뀔 때 숫자가 굴러간다.
private struct IslandScore: View {
    let score: Int
    let ahead: Bool
    var size: CGFloat = 34
    var final = false

    var body: some View {
        Text("\(score)")
            .font(.system(size: size, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(ahead ? Palette.amber : (final ? Palette.muted : Palette.text))
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
                    .font(.system(size: 11, weight: .semibold))
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
                    .font(.system(size: 12, weight: .bold))
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

/// B 초록 4칸 중 3, S 앰버 2, O 빨강 2.
struct CountDots: View {
    let balls: Int
    let strikes: Int
    let outs: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            row("B", balls, 3, Palette.live)
            row("S", strikes, 2, Palette.amber)
            row("O", outs, 2, Palette.red)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("볼 \(balls), 스트라이크 \(strikes), 아웃 \(outs)")
    }

    private func row(_ label: String, _ n: Int, _ max: Int, _ color: Color) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 8, weight: .bold, design: .rounded))
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
                    .foregroundStyle(Palette.amber)
                Text(state.headline.isEmpty ? attributes.stadium : state.headline)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Palette.text.opacity(0.9))
                    .lineLimit(1)
                Spacer(minLength: 4)
                LogoMark(height: 10, color: Palette.amber)
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

struct LockScreenScoreboard: View {
    let attributes: GameActivityAttributes
    let state: GameActivityAttributes.ContentState
    var stale = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                LogoMark(height: 11, color: Palette.amber)
                Text(attributes.stadium).font(.caption2).foregroundStyle(Palette.muted)
                Spacer()
                if !state.isFinal && !stale {
                    Circle().fill(Palette.live).frame(width: 6, height: 6)
                }
                Text(stale ? "업데이트 지연" : state.inningText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(state.isFinal || stale ? Palette.muted : Palette.live)
            }
            HStack {
                side(code: attributes.awayCode, name: attributes.awayName)
                Spacer()
                Text("\(state.awayScore) : \(state.homeScore)")
                    .font(Typo.score(34))
                    .foregroundStyle(Palette.amber)
                    .contentTransition(.numericText())
                Spacer()
                side(code: attributes.homeCode, name: attributes.homeName)
            }
            HStack(spacing: 10) {
                if !state.isFinal {
                    DiamondView(bases: state.bases, outs: state.outs)
                        .frame(width: 30, height: 38)
                }
                Text(state.headline.isEmpty ? " " : state.headline)
                    .font(.caption)
                    .foregroundStyle(Palette.text.opacity(0.8))
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .foregroundStyle(Palette.text)
    }

    private func side(code: String, name: String) -> some View {
        VStack(spacing: 4) {
            TeamBadge(code: code, size: 32)
            Text(name).font(.caption2).foregroundStyle(Palette.muted)
        }
        .frame(width: 64)
    }
}
