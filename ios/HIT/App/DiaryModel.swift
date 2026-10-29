import Foundation

/// 직관 다이어리: 서버(GET /v1/me/diary)에 저장된 내 직관·집관 기록과 승률.
/// 로그인한 사람만 쓸 수 있다 (둘러보기는 기록이 남지 않는다).
@MainActor
@Observable
final class DiaryModel {
    static let shared = DiaryModel()

    private(set) var entries: [DiaryEntry] = []
    private(set) var stats: DiaryStats?
    private(set) var loading = false
    var error: String?

    private init() {}

    var canRecord: Bool { AuthManager.shared.state == .signedIn }

    func entry(for gameId: String) -> DiaryEntry? { entries.first { $0.gameId == gameId } }

    func load() async {
        guard canRecord else { entries = []; stats = nil; return }
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient().diary()
            entries = r.entries
            stats = r.stats
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// 저장하고 통계까지 다시 받는다 (승률은 서버가 계산한다)
    func save(game: Game, mode: WatchMode, seat: String, memo: String) async -> Bool {
        guard let date = game.date else { return false }
        do {
            let saved = try await APIClient().saveDiary(gameId: game.id, date: date, mode: mode,
                                                         seat: seat.isEmpty ? nil : seat, memo: memo.isEmpty ? nil : memo)
            entries.removeAll { $0.gameId == saved.gameId }
            entries.insert(saved, at: 0)
            await load()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// 티켓 사진 인증: 기록이 없으면 직관으로 먼저 남기고, 읽은 번호로 서버에 인증
    func verify(game: Game, ticket: String, seat: String, memo: String) async -> Bool {
        if entry(for: game.id)?.mode != .stadium {
            guard await save(game: game, mode: .stadium, seat: seat, memo: memo) else { return false }
        }
        do {
            let verified = try await APIClient().verifyTicket(gameId: game.id, ticket: ticket)
            entries.removeAll { $0.gameId == verified.gameId }
            entries.insert(verified, at: 0)
            await load()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func delete(gameId: String) async {
        let before = entries
        entries.removeAll { $0.gameId == gameId }
        do {
            try await APIClient().deleteDiary(gameId: gameId)
            await load()
        } catch {
            entries = before
            self.error = error.localizedDescription
        }
    }

    func reset() {
        entries = []
        stats = nil
    }
}

extension Game {
    /// 내 팀 기준 승패 (서버 diary.js resultFor 와 같은 규칙)
    func result(for team: String?) -> GameResult? {
        guard status == .final, let team else { return nil }
        let mine: GameSide, theirs: GameSide, side: String
        if away.code == team { mine = away; theirs = home; side = "away" }
        else if home.code == team { mine = home; theirs = away; side = "home" }
        else { return nil }
        if winner == "draw" || (mine.score != nil && mine.score == theirs.score) { return .draw }
        if let winner { return winner == side ? .win : .lose }
        guard let a = mine.score, let b = theirs.score else { return nil }
        return a > b ? .win : .lose
    }

    func opponent(of team: String?) -> GameSide { away.code == team ? home : away }
    func involves(_ team: String?) -> Bool { away.code == team || home.code == team }
}
