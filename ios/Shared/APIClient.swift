import Foundation

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

private struct Ack: Decodable {}
private struct ErrorBody: Decodable { let error: String }

/// HIT 서버 클라이언트. 앱과 위젯이 같이 쓴다.
struct APIClient {
    /// 로그인 세션 토큰 (앱이 키체인에서 꺼내 넣는다. 위젯은 쓰지 않음)
    static var sessionToken: String?

    var baseURL: URL = SharedSettings.apiBaseURL
    var session: URLSession = .shared

    var kakaoStartURL: URL { baseURL.appendingPathComponent("v1/auth/kakao/start") }

    // MARK: 계정

    func signInWithApple(identityToken: String, name: String?) async throws -> AuthResponse {
        struct Body: Encodable { let identityToken: String; let name: String? }
        return try await send("POST", "v1/auth/apple", body: Body(identityToken: identityToken, name: name))
    }

    func me() async throws -> Account {
        try await send("GET", "v1/me")
    }

    func updateMe(nickname: String? = nil, team: String? = nil, prefs: NotificationPrefs? = nil, players: [FavoritePlayer]? = nil) async throws -> Account {
        struct Body: Encodable { let nickname: String?; let team: String?; let prefs: NotificationPrefs?; let players: [FavoritePlayer]? }
        return try await send("PUT", "v1/me", body: Body(nickname: nickname, team: team, prefs: prefs, players: players))
    }

    // MARK: 선수

    func searchPlayers(_ query: String) async throws -> PlayersResponse {
        try await send("GET", "v1/players", query: [URLQueryItem(name: "q", value: query)])
    }

    func player(id: String) async throws -> Player {
        try await send("GET", "v1/players/\(id)")
    }

    func leaders(type: String) async throws -> LeadersResponse {
        try await send("GET", "v1/leaders", query: [URLQueryItem(name: "type", value: type)])
    }

    func signOut() async throws {
        let _: Ack = try await send("POST", "v1/auth/logout")
    }

    func deleteAccount() async throws {
        let _: Ack = try await send("DELETE", "v1/me")
    }

    // MARK: 경기

    func games(date: String) async throws -> GamesResponse {
        try await send("GET", "v1/games", query: [URLQueryItem(name: "date", value: date)])
    }

    func detail(id: String) async throws -> GameDetail {
        try await send("GET", "v1/games/\(id)")
    }

    func relay(id: String, inning: Int) async throws -> RelayResponse {
        try await send("GET", "v1/games/\(id)/relay", query: [URLQueryItem(name: "inning", value: String(inning))])
    }

    func winTrend(id: String) async throws -> WinTrendResponse {
        try await send("GET", "v1/games/\(id)/winrate")
    }

    func postseason(season: String) async throws -> PostseasonResponse {
        try await send("GET", "v1/postseason", query: [URLQueryItem(name: "season", value: season)])
    }

    func preview(id: String) async throws -> GamePreview {
        try await send("GET", "v1/games/\(id)/preview")
    }

    func mvp(id: String) async throws -> MvpResponse {
        try await send("GET", "v1/games/\(id)/mvp")
    }

    func voteMvp(id: String, team: String, name: String) async throws -> MvpResponse {
        try await send("PUT", "v1/games/\(id)/mvp", body: MvpVote(team: team, name: name))
    }

    func calendar(month: String, team: String?) async throws -> CalendarResponse {
        var q = [URLQueryItem(name: "month", value: month)]
        if let team { q.append(URLQueryItem(name: "team", value: team)) }
        return try await send("GET", "v1/calendar", query: q)
    }

    // MARK: 직관 다이어리 (로그인 필요)

    func diary() async throws -> DiaryResponse {
        try await send("GET", "v1/me/diary")
    }

    func saveDiary(gameId: String, date: String, mode: WatchMode, seat: String?, memo: String?) async throws -> DiaryEntry {
        struct Body: Encodable { let date: String; let mode: WatchMode; let seat: String?; let memo: String? }
        return try await send("PUT", "v1/me/diary/\(gameId)", body: Body(date: date, mode: mode, seat: seat, memo: memo))
    }

    /// 티켓 사진에서 읽은 예매번호·바코드로 직관 인증 (서버는 번호의 지문만 저장)
    func verifyTicket(gameId: String, ticket: String) async throws -> DiaryEntry {
        struct Body: Encodable { let ticket: String }
        return try await send("POST", "v1/me/diary/\(gameId)/verify", body: Body(ticket: ticket))
    }

    // MARK: 응원톡

    func chat(gameId: String, after: Int = 0) async throws -> ChatResponse {
        try await send("GET", "v1/games/\(gameId)/chat", query: after > 0 ? [URLQueryItem(name: "after", value: String(after))] : [])
    }

    func sendChat(gameId: String, text: String) async throws -> ChatMessage {
        struct Body: Encodable { let text: String }
        return try await send("POST", "v1/games/\(gameId)/chat", body: Body(text: text))
    }

    func reportChat(id: Int) async throws {
        struct Reported: Decodable { let reported: Bool }
        let _: Reported = try await send("POST", "v1/chat/\(id)/report")
    }

    func deleteDiary(gameId: String) async throws {
        struct Deleted: Decodable { let deleted: Bool }
        let _: Deleted = try await send("DELETE", "v1/me/diary/\(gameId)")
    }

    func standings(season: String) async throws -> StandingsResponse {
        try await send("GET", "v1/standings", query: [URLQueryItem(name: "season", value: season)])
    }

    func registerDevice(token: String, environment: String, teams: [String], prefs: NotificationPrefs, players: [FavoritePlayer]) async throws {
        struct Body: Encodable { let environment: String; let teams: [String]; let prefs: NotificationPrefs; let players: [FavoritePlayer] }
        let _: Ack = try await send("PUT", "v1/devices/\(token)", body: Body(environment: environment, teams: teams, prefs: prefs, players: players))
    }

    func setStartToken(deviceToken: String, token: String) async throws {
        struct Body: Encodable { let token: String }
        let _: Ack = try await send("PUT", "v1/devices/\(deviceToken)/start-token", body: Body(token: token))
    }

    func registerActivity(deviceToken: String, gameId: String, token: String, environment: String) async throws {
        struct Body: Encodable { let deviceToken: String; let gameId: String; let token: String; let environment: String }
        let _: Ack = try await send("POST", "v1/live-activities", body: Body(deviceToken: deviceToken, gameId: gameId, token: token, environment: environment))
    }

    func unregisterActivity(token: String) async throws {
        let _: Ack = try await send("DELETE", "v1/live-activities/\(token)")
    }

    private func send<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, timeoutInterval: 15)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = Self.sessionToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "서버 응답 \(status)"
            throw APIError(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
