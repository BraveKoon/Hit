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
    var runners: [String?]? = nil      // 1·2·3루 주자 이름 (모르면 nil)
    var next: [LineupEntry]? = nil     // 대기 타석 두 명
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

struct EntryPlayer: Codable, Hashable, Identifiable {
    let name: String
    let pos: String
    let photo: String?
    var id: String { "\(pos)\(name)" }
}

struct TeamEntry: Codable, Hashable {
    let batters: [EntryPlayer]
    let pitchers: [EntryPlayer]
    var isEmpty: Bool { batters.isEmpty && pitchers.isEmpty }
}

struct Entries: Codable, Hashable {
    let away: TeamEntry
    let home: TeamEntry
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
    var entries: Entries? = nil      // 벤치·불펜 엔트리 (선발 라인업에 없는 선수). 없으면 nil
    let pitchers: Pitchers?
    let winRate: WinRate?
    let fetchedAt: String?   // 서버가 네이버에서 받은 시각. 오래됐으면 "데이터 지연"
}

extension GameDetail {
    var fetchedDate: Date? { fetchedAt.flatMap { ISO8601DateFormatter.fractional.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } }
}

extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// 타석별 홈팀 승리 확률 (%)
struct WinPoint: Codable, Hashable {
    let inning: Int
    let half: String?
    let home: Double
}

struct WinTrendResponse: Codable, Hashable {
    let gameId: String
    let points: [WinPoint]
}

// MARK: - 응원톡

struct ChatMessage: Codable, Hashable, Identifiable {
    let id: Int
    let team: String?
    let nickname: String
    let text: String
    let at: String
    let mine: Bool
}

struct ChatResponse: Codable {
    let messages: [ChatMessage]
}

// MARK: - 커뮤니티 (팀 게시판)

struct CommunityPost: Codable, Hashable, Identifiable {
    let id: Int
    let team: String
    let player: String?
    let title: String
    let preview: String?          // 목록에서만
    let body: String?             // 상세에서만
    let image: String?            // "/v1/uploads/…" (서버 기준 경로)
    let nickname: String
    let authorTeam: String?
    var likes: Int
    var comments: Int
    let at: String
    let mine: Bool
    var liked: Bool
    var replies: [PostComment]?   // 상세에서만

    var imageURL: URL? { image.map { SharedSettings.apiBaseURL.appendingPathComponent(String($0.dropFirst())) } }
}

struct PostComment: Codable, Hashable, Identifiable {
    let id: Int
    let nickname: String
    let team: String?
    let text: String
    let at: String
    let mine: Bool
}

struct PostsResponse: Codable {
    let posts: [CommunityPost]
    let next: Int?
}

struct LikeResponse: Codable {
    let likes: Int
    let liked: Bool
}

// MARK: - 구장 날씨

struct GameWeather: Codable, Hashable {
    let gameId: String
    let stadium: String
    let dome: Bool
    let temp: Int?
    let pop: Int?           // 강수 확률 %
    let sky: String         // clear · partly · cloudy · fog · rain · snow · storm
    let label: String       // "맑음"
    let wind: Double?       // m/s
    let risk: String        // high · medium · low · dome (우천 취소 가능성)
    let hours: [WeatherHour]
    let source: String

    static func symbol(_ sky: String) -> String {
        switch sky {
        case "clear": "sun.max.fill"
        case "partly": "cloud.sun.fill"
        case "fog": "cloud.fog.fill"
        case "rain": "cloud.rain.fill"
        case "snow": "cloud.snow.fill"
        case "storm": "cloud.bolt.rain.fill"
        default: "cloud.fill"
        }
    }
}

struct WeatherHour: Codable, Hashable {
    let time: String        // "18:00"
    let temp: Int?
    let pop: Int?
    let sky: String
    let label: String
}

// MARK: - 내 팀 소식

/// 홈 위쪽 공지 배너 (서버 server/src/notices.js). 서버에 못 닿으면 `welcome` 하나만 보인다.
struct Notice: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let subtitle: String
    var icon: String? = nil
    var link: String? = nil   // hit://game/<번호> 또는 https://…

    static let welcome = Notice(id: "open", title: "HIT 앱 오픈!", subtitle: "내 팀 경기와 문자중계를 한눈에", icon: "baseball.fill", link: nil)
}

struct NoticesResponse: Codable {
    let notices: [Notice]
}

struct NewsResponse: Codable {
    let team: String
    let tags: [NewsTag]
    let items: [NewsItem]
}

struct NewsTag: Codable, Hashable {
    let key: String
    let label: String
}

struct NewsItem: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let summary: String
    let url: String
    let source: String?
    let at: String?
    let tags: [String]
}

// MARK: - 차단

struct BlockedUser: Codable, Hashable, Identifiable {
    let id: Int
    let nickname: String
    let at: String
}

struct BlocksResponse: Codable {
    let blocks: [BlockedUser]
}

struct BlockResult: Codable {
    let blocked: Bool
    let nickname: String
}

// MARK: - 승부예측

struct Prediction: Codable, Hashable {
    let gameId: String
    let open: Bool
    let away: Int
    let home: Int
    let total: Int
    let myPick: String?      // "away" | "home"
    let outcome: String?     // 끝난 경기의 승리 팀 쪽
    let correct: Bool?

    func share(_ side: String) -> Double {
        guard total > 0 else { return 0.5 }
        return Double(side == "away" ? away : home) / Double(total)
    }
}

struct PredictionRecord: Codable, Hashable {
    let total: Int
    let decided: Int
    let correct: Int
    let rate: Double?
    let streak: Int
}

// MARK: - 포스트시즌 대진표

struct PostseasonResponse: Codable, Hashable {
    let season: String
    let active: Bool
    let champion: String?
    let teams: [PostseasonTeam]      // 5위부터 1위 순서 (그림 왼쪽부터)
    let rounds: [PostseasonRound]    // WC · 준PO · PO · KS
}

struct PostseasonTeam: Codable, Hashable, Identifiable {
    let code: String
    let name: String
    let seed: Int
    let alive: Bool
    var id: String { code }
}

/// low = 아래 시드(도전자), high = 위 시드. 점수도 이 순서
struct PostseasonRound: Codable, Hashable, Identifiable {
    let key: String
    let name: String
    let label: String
    let format: String
    let low: String?
    let high: String
    let games: [SeriesGame]
    let wins: SeriesWins
    let winner: String?
    var id: String { key }
}

struct SeriesGame: Codable, Hashable, Identifiable {
    let id: String
    let no: Int
    let date: String?
    let status: GameStatus
    let low: Int?
    let high: Int?
}

struct SeriesWins: Codable, Hashable {
    let low: Int
    let high: Int
}

extension PostseasonResponse {
    /// 지금 치르는 라운드: 도전자가 정해졌고 승자가 아직 없는 첫 라운드
    var current: PostseasonRound? { rounds.first { $0.low != nil && $0.winner == nil } }

    /// 경기 카드 머리말: ("플레이오프 3차전", "1승 1패 동률" 또는 "삼성 2승 1패 우세")
    func series(for game: Game) -> (title: String, status: String)? {
        for r in rounds {
            guard let g = r.games.first(where: { $0.id == game.id }), let low = r.low else { continue }
            let status: String
            if r.wins.low == r.wins.high {
                status = "\(r.wins.low)승 \(r.wins.high)패 동률"
            } else {
                let lead = r.wins.low > r.wins.high ? low : r.high
                let (w, l) = r.wins.low > r.wins.high ? (r.wins.low, r.wins.high) : (r.wins.high, r.wins.low)
                status = "\(Team.find(lead)?.short ?? lead) \(w)승 \(l)패" + (r.winner == nil ? " 우세" : " 통과")
            }
            return ("\(r.label) \(g.no)차전", status)
        }
        return nil
    }
}

// MARK: - 경기 프리뷰

struct GamePreview: Codable, Hashable {
    let gameId: String
    let info: PreviewInfo
    let starters: PreviewStarters
    let teams: PreviewTeams
    let headToHead: HeadToHead
    var keyPlayers: KeyPlayers? = nil
}

/// 오늘의 키플레이어 (팀마다 타자 한 명)
struct KeyPlayers: Codable, Hashable {
    let away: KeyPlayer?
    let home: KeyPlayer?
}

struct KeyPlayer: Codable, Hashable {
    let id: String
    let team: String
    let name: String
    let photo: String?
    let reason: String      // "오늘 라인업 OPS 1위" · "팀 타자 WAR 1위"
    let line: String        // ".312 · 25홈런 · OPS .950"
    let war: Double?
    let avg: Double?
    let hr: Int?
    let ops: Double?
}

struct PreviewInfo: Codable, Hashable {
    let date: String?
    let startsAt: String?
    let stadium: String?
    let broadcast: String?
}

struct PreviewStarter: Codable, Hashable {
    let team: String
    let name: String?
    let photo: String?
    let stats: PlayerStats?
}

struct PreviewStarters: Codable, Hashable {
    let away: PreviewStarter
    let home: PreviewStarter
}

struct PreviewTeams: Codable, Hashable {
    let away: Standing?
    let home: Standing?
}

/// 올 시즌 맞대결 (원정 팀 기준 승·패)
struct HeadToHead: Codable, Hashable {
    let wins: Int
    let losses: Int
    let draws: Int
    let recent: [HeadToHeadGame]
}

struct HeadToHeadGame: Codable, Hashable, Identifiable {
    let id: String
    let date: String?
    let away: String
    let home: String
    let awayScore: Int
    let homeScore: Int
}

// MARK: - 오늘의 MVP

struct MvpCandidate: Codable, Hashable, Identifiable {
    let name: String
    let team: String
    let role: String
    let photo: String?
    var id: String { "\(team):\(name)" }
}

struct MvpVote: Codable, Hashable {
    let team: String
    let name: String
}

struct MvpTally: Codable, Hashable {
    let team: String
    let name: String
    let votes: Int
}

struct MvpResponse: Codable, Hashable {
    let gameId: String
    let open: Bool
    let candidates: [MvpCandidate]
    let tally: [MvpTally]
    let total: Int
    let myVote: MvpVote?
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
    var lineup = true    // 경기 전 선발 라인업 발표
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
    var comments = true  // 커뮤니티: 내 글에 댓글
}

extension NotificationPrefs {
    /// 예전 버전에서 저장한 설정엔 새 항목이 없다. 없는 키는 기본값으로 채워 설정이 날아가지 않게 한다.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = NotificationPrefs()
        func v(_ k: CodingKeys, _ fallback: Bool) throws -> Bool { try c.decodeIfPresent(Bool.self, forKey: k) ?? fallback }
        self.init(pregame: try v(.pregame, d.pregame), starters: try v(.starters, d.starters), lineup: try v(.lineup, d.lineup),
                  start: try v(.start, d.start),
                  score: try v(.score, d.score), homerun: try v(.homerun, d.homerun), lead: try v(.lead, d.lead),
                  extra: try v(.extra, d.extra), end: try v(.end, d.end), cancel: try v(.cancel, d.cancel),
                  liveActivity: try v(.liveActivity, d.liveActivity), players: try v(.players, d.players),
                  hit: try v(.hit, d.hit), walk: try v(.walk, d.walk), comments: try v(.comments, d.comments))
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
    var games: Int? = nil
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
    var verified: Bool? = nil   // 직관 티켓 인증 (인증한 직관만 승률에 센다)
    var id: String { gameId }
    var isVerified: Bool { verified == true }
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
    var unverified: Int? = nil       // 티켓 인증 안 해서 승률에서 빠진 직관 수
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
    static let fullDate = formatter("yyyy.MM.dd (E)", korean: true)

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
