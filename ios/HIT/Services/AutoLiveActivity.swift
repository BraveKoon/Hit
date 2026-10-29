import Foundation

/// 내 팀 경기의 잠금화면·다이내믹 아일랜드 카드를 앱이 직접 켜고 갱신한다 (수동 버튼 없음).
/// - 경기 시작 30분 전부터 켜고, 경기 중엔 10초마다, 경기 전엔 30초마다 갱신, 끝나면 마지막 점수로 바꾼 뒤 30분 뒤 내린다.
/// - 앱이 열려 있는 동안만 동작한다. 앱이 닫혀 있어도 뜨게 하는 건 서버의 push-to-start(알림 키·서버 필요).
@MainActor
final class AutoLiveActivity {
    static let shared = AutoLiveActivity()
    private var task: Task<Void, Never>?
    private var finished: Set<String> = []
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

    func stop() {
        task?.cancel()
        task = nil
    }

    /// 한 번 확인하고, 다음 확인까지 기다릴 초를 돌려준다
    private func tick() async -> Double {
        let model = AppModel.shared
        let controller = LiveActivityController.shared
        guard model.prefs.liveActivity, controller.isEnabled, let team = model.myTeam else { return 120 }
        guard let today = try? await APIClient().games(date: KST.dayString(Date())),
              let game = today.games.first(where: { $0.involves(team) && $0.status != .canceled }) else { return 300 }

        switch game.status {
        case .scheduled:
            guard let start = game.startDate else { return 300 }
            let untilWindow = start.timeIntervalSinceNow - 30 * 60
            if untilWindow > 0 { return min(untilWindow, 300) }
            if let detail = try? await APIClient().detail(id: game.id) { controller.startOrUpdate(detail: detail) }
            return 30
        case .live, .suspended:
            if let detail = try? await APIClient().detail(id: game.id) { controller.startOrUpdate(detail: detail) }
            return 10
        case .final:
            if !finished.contains(game.id), controller.activity(for: game.id) != nil,
               let detail = try? await APIClient().detail(id: game.id) {
                await controller.finish(detail: detail)
                finished.insert(game.id)
            }
            return 600
        default:
            return 300
        }
    }
}
