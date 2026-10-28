import UIKit
import UserNotifications

/// 알림 권한 → APNs 기기 토큰 → 서버에 구독 등록.
@MainActor
@Observable
final class PushRegistrar {
    static let shared = PushRegistrar()

    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var deviceToken: String? = UserDefaults.standard.string(forKey: "deviceToken")
    private(set) var lastSyncedAt: Date?
    var lastError: String?

    /// 디버그 빌드(Xcode 실행)는 샌드박스, TestFlight·App Store 빌드는 프로덕션 APNs.
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    private init() {}

    var isAuthorized: Bool { authorization == .authorized || authorization == .provisional || authorization == .ephemeral }

    func refresh() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if isAuthorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refresh()
        return granted
    }

    func didRegister(deviceToken token: String) async {
        deviceToken = token
        UserDefaults.standard.set(token, forKey: "deviceToken")
        await sync()
        await LiveActivityController.shared.flushPendingTokens()
    }

    /// 응원 팀·알림 설정이 바뀌거나 토큰을 새로 받으면 서버에 다시 알린다.
    func sync() async {
        guard let deviceToken, let team = AppModel.shared.myTeam else { return }
        do {
            try await APIClient().registerDevice(token: deviceToken, environment: Self.environment, teams: [team],
                                                 prefs: AppModel.shared.prefs, players: AppModel.shared.favorites)
            lastSyncedAt = Date()
            lastError = nil
        } catch {
            lastError = "알림 서버 연결 실패: \(error.localizedDescription)"
        }
    }
}
