import Foundation
import UserNotifications

/// 내 팀 경기의 잠금화면·다이내믹 아일랜드 카드를 앱이 직접 켜고 갱신한다 (수동 버튼 없음).
/// - 경기 시작 30분 전부터 켜고, 경기 중엔 2초마다, 경기 전엔 30초마다 갱신, 끝나면 마지막 점수로 바꾼 뒤 30분 뒤 내린다.
/// - 경기 30분 전부터 끝날 때까지는 소리 없는 오디오로 백그라운드에서도 계속 돌고(BackgroundKeeper), 득점·종료는 아이폰 알림으로 직접 알린다.
/// - 앱을 완전히 종료(위로 밀어 닫기)하면 멈춘다. 그 상태에서도 뜨게 하는 건 서버의 push-to-start(알림 키·한국 서버 필요).
@MainActor
final class AutoLiveActivity {
    static let shared = AutoLiveActivity()
    private var task: Task<Void, Never>?
    private var finished: Set<String> = []
    private let defaults = UserDefaults.standard

    /// 이미 띄운 알림 (앱을 껐다 켜도 같은 알림을 또 띄우지 않게 저장한다. 최근 300개만 남긴다)
    private func markSent(_ key: String) -> Bool {
        var sent = defaults.stringArray(forKey: "hit.sentAlerts") ?? []
        guard !sent.contains(key) else { return false }
        sent.append(key)
        defaults.set(Array(sent.suffix(300)), forKey: "hit.sentAlerts")
        return true
    }

    /// 경기마다 마지막으로 본 점수 (득점이 났는지 비교하는 기준. 앱을 껐다 켜도 이어 간다)
    private func lastScore(_ id: String) -> [Int]? {
        (defaults.dictionary(forKey: "hit.lastScores") as? [String: [Int]])?[id]
    }

    private func saveLastScore(_ id: String, _ score: [Int]) {
        var all = (defaults.dictionary(forKey: "hit.lastScores") as? [String: [Int]]) ?? [:]
        all[id] = score
        if all.count > 40 { all = Dictionary(uniqueKeysWithValues: all.sorted { $0.key > $1.key }.prefix(20).map { ($0.key, $0.value) }) }
        defaults.set(all, forKey: "hit.lastScores")
    }
    private init() {}

    func run() {
        task?.cancel()
        task = Task { [weak self] in
            while !Task.isCancelled {
                let wait = await self?.tick() ?? 120
                try? await Task.sleep(for: .seconds(wait))
            }
        }
    }

    /// 앱이 백그라운드로 가도 경기를 따라가는 중이면 계속 돈다
    var isFollowing: Bool { BackgroundKeeper.shared.isRunning }

    func stop() {
        task?.cancel()
        task = nil
        BackgroundKeeper.shared.stop()
    }

    /// 오늘 내 팀 경기. 경기 중엔 목록을 60초에 한 번만 다시 받는다(매번 받으면 갱신이 그만큼 늦어진다)
    private var cachedGame: (game: Game, at: Date)?

    private func todayGame(team: String) async -> Game? {
        if let c = cachedGame, c.game.status == .live, c.game.involves(team), Date().timeIntervalSince(c.at) < 60 { return c.game }
        guard let today = try? await APIClient().games(date: KST.dayString(Date())),
              let game = today.games.first(where: { $0.involves(team) && $0.status != .canceled }) else {
            cachedGame = nil
            return nil
        }
        cachedGame = (game, Date())
        return game
    }

    /// 한 번 확인하고, 다음 확인까지 기다릴 초를 돌려준다
    private func tick() async -> Double {
        let model = AppModel.shared
        let controller = LiveActivityController.shared
        guard model.prefs.liveActivity, controller.isEnabled, let team = model.myTeam else {
            BackgroundKeeper.shared.stop()
            return 120
        }
        guard let game = await todayGame(team: team) else {
            BackgroundKeeper.shared.stop()
            return 300
        }
        if BackgroundKeeper.shared.isRunning { BackgroundKeeper.shared.ensurePlaying() }

        switch game.status {
        case .scheduled:
            guard let start = game.startDate else { return 300 }
            let untilWindow = start.timeIntervalSinceNow - 30 * 60
            if untilWindow > 0 {
                // 창이 열리기 전에 앱이 깨어 있도록 마지막 5분은 미리 오디오를 켠다
                if untilWindow < 300 { BackgroundKeeper.shared.start() } else { BackgroundKeeper.shared.stop() }
                return min(untilWindow, 60)
            }
            BackgroundKeeper.shared.start()
            if let detail = try? await APIClient().detail(id: game.id) { controller.startOrUpdate(detail: detail) }
            return 30
        case .live, .suspended:
            BackgroundKeeper.shared.start()
            if let detail = try? await APIClient().detail(id: game.id) {
                controller.startOrUpdate(detail: detail)
                await notifyChanges(detail.game, team: team)
                // 경기 상태(끝났는지)는 상세에서 바로 알 수 있어서, 목록을 다시 받지 않고 이걸로 갱신한다
                cachedGame = (detail.game, cachedGame?.at ?? Date())
            }
            return 2
        case .final:
            if !finished.contains(game.id), controller.activity(for: game.id) != nil,
               let detail = try? await APIClient().detail(id: game.id) {
                await controller.finish(detail: detail)
                await notifyChanges(detail.game, team: team)
                finished.insert(game.id)
            }
            BackgroundKeeper.shared.stop()
            return 600
        default:
            return 300
        }
    }

    /// 앱이 직접 읽은 점수로 득점·시작·종료 알림을 띄운다 (서버 푸시와 별개). 같은 알림은 한 번만.
    private func notifyChanges(_ game: Game, team: String) async {
        let prefs = AppModel.shared.prefs
        let a = game.away.score ?? 0, h = game.home.score ?? 0
        let previous = lastScore(game.id)
        defer { saveLastScore(game.id, [a, h]) }

        // 경기 시작: 1회 0:0 일 때만 (경기 중간에 앱을 켰을 땐 "시작"이라 하지 않는다)
        if game.status == .live, prefs.start, (game.inning ?? 1) <= 1, a + h == 0, markSent("start-\(game.id)") {
            await post(game, id: "local-start-\(game.id)", title: "\(game.away.name) VS \(game.home.name) 경기 시작", body: game.stadium ?? "")
        }
        if game.status == .final {
            guard prefs.end, markSent("end-\(game.id)") else { return }
            let result = game.winner == nil ? "무승부" : (game.winner == team ? "승리" : "패배")
            await post(game, id: "local-end-\(game.id)", title: "경기 종료 · \(result)", body: "\(game.away.name) \(a) : \(h) \(game.home.name)")
            return
        }
        // 득점: 지난번 본 점수가 있을 때만 비교한다 (처음 본 점수는 기준만 잡는다)
        guard prefs.score, let last = previous, last != [a, h], markSent("score-\(game.id)-\(a)-\(h)") else { return }
        let scorer = (a > last[0]) ? game.away.name : game.home.name
        await post(game, id: "local-score-\(game.id)-\(a)-\(h)", title: "\(scorer) 득점", body: "\(game.away.name) \(a) : \(h) \(game.home.name) · \(game.statusText)")
    }

    private func post(_ game: Game, id: String, title: String, body: String) async {
        let center = UNUserNotificationCenter.current()
        guard await center.notificationSettings().authorizationStatus == .authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = game.id
        content.userInfo = ["gameId": game.id, "type": "local"]
        try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}
