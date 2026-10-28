import ActivityKit
import Foundation

/// 라이브 액티비티 시작·종료와 푸시 토큰 관리.
/// - 앱에서 직접 시작: start(detail:) → 액티비티별 토큰을 서버에 등록 → 서버가 점수 바뀔 때마다 갱신
/// - 서버가 시작(push-to-start, iOS 17.2+): 미리 등록한 start 토큰으로 경기 시작 때 자동으로 뜸
@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()

    private var observing = false
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var pendingStartToken: String?
    private var pendingActivityTokens: [(gameId: String, token: String)] = []

    private init() {}

    var isEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func startObserving() {
        guard !observing else { return }
        observing = true

        Task {
            for await data in Activity<GameActivityAttributes>.pushToStartTokenUpdates {
                pendingStartToken = data.hexString
                await flushPendingTokens()
            }
        }
        Task {
            for await activity in Activity<GameActivityAttributes>.activityUpdates {
                observe(activity)
            }
        }
        Activity<GameActivityAttributes>.activities.forEach(observe)
    }

    private func observe(_ activity: Activity<GameActivityAttributes>) {
        guard tokenTasks[activity.id] == nil else { return }
        let gameId = activity.attributes.gameId
        tokenTasks[activity.id] = Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                self?.pendingActivityTokens.append((gameId, data.hexString))
                await self?.flushPendingTokens()
            }
        }
    }

    /// 기기 토큰이 아직 없으면 모아 뒀다가 받는 즉시 보낸다.
    func flushPendingTokens() async {
        guard let device = PushRegistrar.shared.deviceToken else { return }
        let api = APIClient()
        let env = PushRegistrar.environment
        if let start = pendingStartToken {
            if (try? await api.setStartToken(deviceToken: device, token: start)) != nil { pendingStartToken = nil }
        }
        var failed: [(gameId: String, token: String)] = []
        for item in pendingActivityTokens {
            do {
                try await api.registerActivity(deviceToken: device, gameId: item.gameId, token: item.token, environment: env)
            } catch {
                failed.append(item)
            }
        }
        pendingActivityTokens = failed
    }

    func activity(for gameId: String) -> Activity<GameActivityAttributes>? {
        Activity<GameActivityAttributes>.activities.first { $0.attributes.gameId == gameId && $0.activityState == .active }
    }

    func start(detail: GameDetail) throws {
        guard activity(for: detail.game.id) == nil else { return }
        let content = ActivityContent(
            state: GameActivityAttributes.ContentState(detail: detail),
            staleDate: Date().addingTimeInterval(15 * 60)
        )
        let activity = try Activity.request(attributes: GameActivityAttributes(game: detail.game), content: content, pushType: .token)
        observe(activity)
    }

    func end(gameId: String) async {
        for activity in Activity<GameActivityAttributes>.activities where activity.attributes.gameId == gameId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
