import ActivityKit
import Foundation

/// 잠금화면·다이내믹 아일랜드 라이브 액티비티.
/// 서버가 push-to-start / update 로 보내는 JSON 키와 프로퍼티 이름이 정확히 같아야 한다
/// (server/src/apns.js activityStartPayload, server/src/events.js activityState).
struct GameActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var awayScore: Int
        var homeScore: Int
        var inning: Int
        var half: String
        var outs: Int
        var balls: Int
        var strikes: Int
        var bases: [Bool]
        var status: String
        var headline: String
    }

    var gameId: String
    var awayCode: String
    var homeCode: String
    var awayName: String
    var homeName: String
    var stadium: String
    var startsAt: String
}

extension GameActivityAttributes {
    init(game: Game) {
        self.init(
            gameId: game.id, awayCode: game.away.code, homeCode: game.home.code,
            awayName: game.away.name, homeName: game.home.name,
            stadium: game.stadium ?? "", startsAt: game.startsAt ?? ""
        )
    }

    var startClock: String {
        KST.iso.date(from: startsAt).map { KST.clock.string(from: $0) } ?? ""
    }
}

extension GameActivityAttributes.ContentState {
    init(detail: GameDetail) {
        let g = detail.game
        let s = detail.situation
        let headline = detail.plays.first(where: { !$0.isPitch && $0.text.contains(" : ") })?.text ?? g.statusText
        self.init(
            awayScore: g.away.score ?? 0, homeScore: g.home.score ?? 0,
            inning: g.inning ?? 0, half: g.half ?? "",
            outs: s?.outs ?? 0, balls: s?.balls ?? 0, strikes: s?.strikes ?? 0,
            bases: s?.bases ?? [false, false, false],
            status: g.status.rawValue, headline: headline
        )
    }

    var isFinal: Bool { status == "final" || status == "canceled" }

    var inningText: String {
        switch status {
        case "final": return "경기 종료"
        case "canceled": return "취소"
        case "scheduled": return "경기 전"
        default:
            guard inning > 0 else { return "경기 중" }
            return "\(inning)회" + (half == "top" ? "초" : half == "bottom" ? "말" : "")
        }
    }

    func base(_ i: Int) -> Bool { bases.indices.contains(i) && bases[i] }
}
