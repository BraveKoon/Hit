import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // push-to-start 로 시작된 라이브 액티비티의 토큰을 받으려면 실행 직후부터 지켜봐야 한다.
        Task { @MainActor in
            LiveActivityController.shared.startObserving()
            await AuthManager.shared.refresh()
            await PushRegistrar.shared.refresh()
            await LogoStore.shared.prefetch()
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.hexString
        Task { @MainActor in await PushRegistrar.shared.didRegister(deviceToken: hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in PushRegistrar.shared.lastError = "푸시 등록 실패: \(error.localizedDescription)" }
    }

    // 앱을 보고 있을 때도 배너로 보여준다.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    // 알림을 누르면 그 경기 중계로, 이닝이 실려 있으면 그 이닝 문자중계까지.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if let id = info["gameId"] as? String {
            let inning = (info["inning"] as? NSNumber)?.intValue
            await MainActor.run { AppModel.shared.open(gameId: id, inning: inning) }
        }
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
