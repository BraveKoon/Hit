import Foundation

// 서버(/v1) 응답 모델. 키 이름은 server/src/naver.js 의 정규화 결과와 1:1 대응.

enum GameStatus: String, Codable, Hashable {
    case scheduled, live, final, canceled, suspended

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = GameStatus(rawValue: raw) ?? .scheduled
    }
}

struct GameSide: Codable, Hashable {
    let code: String
    let name: String
    let score: Int?
    let starter: String?
    let logo: String?
    let starterPhoto: String?
}

struct Game: Codable, Hashable, Identifiable {
    let id: String
    let date: String?
    let startsAt: String?
    let stadium: String?
    let status: GameStatus
    let statusText: String
    let inning: Int?
    let half: String?
    let away: GameSide
    let home: GameSide
    let winner: String?
    let broadcast: String?
}

struct GamesResponse: Codable {
    let date: String
    let games: [Game]
}

struct LineScore: Codable, Hashable {
    let away: [String]
    let home: [String]
}

struct Totals: Codable, Hashable {
    let r: Int
    let h: Int
    let e: Int
    let b: Int
}

struct TotalsPair: Codable, Hashable {
    let away: Totals?
    let home: Totals?
}

struct PlayerLine: Codable, Hashable {
    let name: String
    let line: String?
    let photo: String?
    var avg: String? = nil      // 타자: 시즌 타율 ".356"
    var pitches: Int? = nil     // 투수: 이 경기 투구 수
}

struct Situation: Codable, Hashable {
    let balls: Int
    let strikes: Int
    let outs: Int
    let bases: [Bool]
    let batter: PlayerLine?
    let pitcher: PlayerLine?
}

struct Play: Codable, Hashable, Identifiable {
    let seq: Int
    let text: String
    let type: Int?
    let inning: Int?
    let half: String?
    let photo: String?   // 타석 결과 줄이면 그 타자 사진
    var id: String { "\(seq)-\(text)" }
    var isPitch: Bool { type == 1 || text.range(of: #"^\d+구\s"#, options: .regularExpression) != nil }
    var isHomeRun: Bool { text.contains("홈런") && !text.contains("홈런성") && text.contains(" : ") }

    /// "디아즈 : 우중간 … 홈런" → 디아즈. 투구·주자 이동·안내 문구는 nil (서버 batterOf 와 같은 규칙)
    var batterName: String? {
        guard !isPitch, !text.hasPrefix("1루주자"), !text.hasPrefix("2루주자"), !text.hasPrefix("3루주자"),
              let range = text.range(of: " : ") else { return nil }
        let name = text[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        return name.isEmpty || name.contains(" ") ? nil : name
    }
}

struct Pitch: Codable, Hashable, Identifiable {
    let n: Int
    let result: String
    let text: String
    let pitchType: String?
    let speed: Double?
    let x: Double?
    let z: Double?
    let top: Double
    let bottom: Double
    var id: Int { n }
}

struct LineupEntry: Codable, Hashable, Identifiable {
    let order: Int
    let pos: String
    let name: String
    let photo: String?
    var id: Int { order }
}

struct Lineups: Codable, Hashable {
    let away: [LineupEntry]
    let home: [LineupEntry]
}

struct Pitchers: Codable, Hashable {
    let win: String?
    let lose: String?
    let awayCurrent: String?
    let homeCurrent: String?
}

struct WinRate: Codable, Hashable {
    let home: Double
    let away: Double
}

struct GameDetail: Codable, Hashable {
    let game: Game
    let lineScore: LineScore?
    let totals: TotalsPair?
    let situation: Situation?
    let plays: [Play]
    let atBat: [Pitch]
    let lineups: Lineups?
    let pitchers: Pitchers?
    let winRate: WinRate?
}

struct Standing: Codable, Hashable, Identifiable {
    let rank: Int
    let code: String
    let logo: String?
    let name: String
    let games: Int
    let wins: Int
    let losses: Int
    let draws: Int
    let pct: Double?
    let gamesBehind: Double?
    let streak: String?
    let lastFive: String?
    var id: String { code }
}

struct StandingsResponse: Codable {
    let season: String
    let teams: [Standing]
}

/// 로그인한 계정 (GET /v1/me)
struct Account: Codable, Hashable {
    let id: Int
    let provider: String
    let nickname: String?
    let email: String?
    let avatar: String?
    let team: String?
    let prefs: NotificationPrefs?
    let players: [FavoritePlayer]?

    var providerLabel: String { provider == "kakao" ? "카카오" : provider == "apple" ? "Apple" : provider }
}

struct AuthResponse: Codable {
    let token: String
    let user: Account
}

/// 알림 종류별 켜고 끄기. 키는 서버 DEFAULT_PREFS 와 같다.
struct NotificationPrefs: Codable, Hashable {
    var pregame = true
    var starters = true
    var start = true
    var score = true
    var homerun = true
    var lead = true
    var extra = true
    var end = true
    var cancel = true
    var liveActivity = true
    var players = true   // 관심 선수 타석 결과·등판·강판
    var hit = false      // 내 팀 안타
    var walk = false     // 내 팀 볼넷·사구
}

extension NotificationPrefs {
    /// 예전 버전에서 저장한 설정엔 새 항목이 없다. 없는 키는 기본값으로 채워 설정이 날아가지 않게 한다.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = NotificationPrefs()
        func v(_ k: CodingKeys, _ fallback: Bool) throws -> Bool { try c.decodeIfPresent(Bool.self, forKey: k) ?? fallback }
        self.init(pregame: try v(.pregame, d.pregame), starters: try v(.starters, d.starters), start: try v(.start, d.start),
                  score: try v(.score, d.score), homerun: try v(.homerun, d.homerun), lead: try v(.lead, d.lead),
                  extra: try v(.extra, d.extra), end: try v(.end, d.end), cancel: try v(.cancel, d.cancel),
                  liveActivity: try v(.liveActivity, d.liveActivity), players: try v(.players, d.players),
                  hit: try v(.hit, d.hit), walk: try v(.walk, d.walk))
    }
}

// MARK: - 선수

/// 관심 선수. 서버는 "구단 + 이름"으로 문자중계와 맞춰 본다.
struct FavoritePlayer: Codable, Hashable {
    let id: String?
    let name: String
    let team: String
    var photo: String? = nil   // 이 기기에만 (서버는 id·name·team 만 저장)
    var key: String { "\(team):\(name)" }
}

struct PlayerStats: Codable, Hashable {
    let war: Double?
    // 타자
    let avg: Double?
    let hr: Int?
    let rbi: Int?
    let hits: Int?
    let runs: Int?
    let sb: Int?
    let ops: Double?
    let obp: Double?
    let slg: Double?
    // 투수
    let era: Double?
    let wins: Int?
    let losses: Int?
    let saves: Int?
    let holds: Int?
    let innings: String?
    let so: Int?
    let whip: Double?
}

struct Player: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let team: String
    let type: String      // "hitter" | "pitcher"
    let number: Int?
    let photo: String?
    let stats: PlayerStats

    var isPitcher: Bool { type == "pitcher" }
    var favorite: FavoritePlayer { FavoritePlayer(id: id, name: name, team: team, photo: photo) }
    var roleLabel: String { (isPitcher ? "투수" : "타자") + (number.map { " · No.\($0)" } ?? "") }
}

struct PlayersResponse: Codable {
    let query: String
    let players: [Player]
}

/// GET /v1/games/:id/relay?inning=N — 한 이닝의 문자중계 전체 (최신 줄이 먼저)
struct RelayResponse: Codable {
    let gameId: String
    let inning: Int
    let plays: [Play]
}

// MARK: - 직관 다이어리

/// 직관(경기장) / 집관(집에서)
enum WatchMode: String, Codable, CaseIterable, Identifiable {
    case stadium, home
    var id: String { rawValue }
    var title: String { self == .stadium ? "직관" : "집관" }
    var symbol: String { self == .stadium ? "ticket.fill" : "tv.fill" }
}

/// 내 팀 기준 결과
enum GameResult: String, Codable {
    case win, lose, draw
    var title: String { self == .win ? "승" : self == .lose ? "패" : "무" }
}

/// GET /v1/me/diary 의 한 줄. game 은 그날 일정에서 찾은 경기 (못 찾으면 nil)
struct DiaryEntry: Codable, Hashable, Identifiable {
    let gameId: String
    let date: String
    let mode: WatchMode
    let seat: String?
    let memo: String?
    let result: GameResult?
    let game: Game?
    var id: String { gameId }
}

/// 승·패·무와 승률 (승률은 무승부 빼고, 기록이 없으면 nil)
struct DiaryBucket: Codable, Hashable, Identifiable {
    let key: String
    let label: String
    let wins: Int
    let losses: Int
    let draws: Int
    let pct: Double?
    var id: String { key }
    var games: Int { wins + losses + draws }
    var record: String { "\(wins)승 \(losses)패" + (draws > 0 ? " \(draws)무" : "") }
}

struct DiaryStats: Codable, Hashable {
    let team: String?
    let key: String
    let label: String
    let wins: Int
    let losses: Int
    let draws: Int
    let pct: Double?
    let games: Int
    let streak: String?
    let modes: [DiaryBucket]
    let stadiums: [DiaryBucket]
    let opponents: [DiaryBucket]
    let weekdays: [DiaryBucket]
}

struct DiaryResponse: Codable {
    let entries: [DiaryEntry]
    let stats: DiaryStats
}

/// GET /v1/calendar?month=YYYY-MM&team=XX
struct CalendarResponse: Codable {
    let month: String
    let team: String?
    let games: [Game]
}

struct LeadersResponse: Codable {
    let type: String
    let players: [Player]
}

enum StatFormat {
    /// .347 / 1.067
    static func rate(_ v: Double?) -> String {
        guard let v else { return "-" }
        let s = String(format: "%.3f", v)
        return s.hasPrefix("0.") ? String(s.dropFirst()) : s
    }
    static func fixed(_ v: Double?, _ digits: Int = 2) -> String {
        v.map { String(format: "%.\(digits)f", $0) } ?? "-"
    }
    static func int(_ v: Int?) -> String { v.map(String.init) ?? "-" }
}

// MARK: - 표시용

enum KST {
    static let zone = TimeZone(identifier: "Asia/Seoul")!

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    private static func formatter(_ format: String, korean: Bool = false) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: korean ? "ko_KR" : "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = format
        return f
    }

    static let day = formatter("yyyy-MM-dd")
    static let clock = formatter("HH:mm")
    static let display = formatter("M월 d일 (E)", korean: true)
    static let short = formatter("MM.dd (E)", korean: true)

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func dayString(_ date: Date) -> String { day.string(from: date) }

    private static let month = formatter("yyyy년 M월", korean: true)
    private static let weekday = formatter("EEEE", korean: true)
    static func monthTitle(_ date: Date) -> String { month.string(from: date) }

    /// "2026-10-27" → "10.27"
    static func ticketDate(_ day: String) -> String {
        let p = day.split(separator: "-")
        guard p.count == 3, let m = Int(p[1]), let d = Int(p[2]) else { return day }
        return "\(m).\(String(format: "%02d", d))"
    }

    /// "2026-10-27" → "화요일"
    static func weekdayOf(_ day: String) -> String {
        self.day.date(from: day).map { weekday.string(from: $0) } ?? ""
    }
}

extension Standing {
    /// "WWLDW" / "승승패무승" 어느 쪽이든 최근 경기 결과로
    var recent: [Character] {
        (lastFive ?? "").compactMap { c in
            switch c {
            case "W", "승": return "W"
            case "L", "패": return "L"
            case "D", "T", "무": return "D"
            default: return nil
            }
        }
    }
}

extension Game {
    var startDate: Date? { startsAt.flatMap { KST.iso.date(from: $0) } }
    var clockText: String { startDate.map { KST.clock.string(from: $0) } ?? "" }

    var inningText: String {
        guard let inning else { return statusText }
        return "\(inning)회" + (half == "top" ? "초" : half == "bottom" ? "말" : "")
    }

    var statusLabel: String {
        switch status {
        case .scheduled: return clockText.isEmpty ? "경기 전" : clockText
        case .live: return inningText
        case .final: return "경기 종료"
        case .canceled: return "취소"
        case .suspended: return "중단"
        }
    }

    var hasScore: Bool { status == .live || status == .final || status == .suspended }

    func involves(_ code: String?) -> Bool {
        guard let code else { return false }
        return away.code == code || home.code == code
    }
}
