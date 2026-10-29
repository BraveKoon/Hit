import Foundation
import UserNotifications

/// 내 팀 경기 30분 전 알림을 아이폰에 직접 예약한다 (서버·네이버 없이도 동작).
/// 앱을 열 때마다 앞으로 8일 안의 경기를 다시 예약하고, 알림을 끄거나 팀을 바꾸면 지운다.
/// 누르면 그 경기 화면이 열린다 (userInfo 의 gameId).
enum PregameReminders {
    static let prefix = "pregame-"
    static let leadMinutes = 30

    @MainActor
    static func refresh() async {
        let center = UNUserNotificationCenter.current()
        let model = AppModel.shared
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }

        guard model.prefs.pregame, let team = model.myTeam,
              await center.notificationSettings().authorizationStatus == .authorized else {
            center.removePendingNotificationRequests(withIdentifiers: pending)
            return
        }

        let now = Date()
        var games: [Game] = []
        for offset in 0...1 {   // 이번 달과 다음 달이면 앞으로 8일을 다 덮는다
            guard let day = KST.calendar.date(byAdding: .month, value: offset, to: now) else { continue }
            let month = String(KST.dayString(day).prefix(7))
            if let r = try? await APIClient().calendar(month: month, team: team) { games += r.games.filter { $0.status == .scheduled } }
        }

        var wanted: Set<String> = []
        for game in games {
            guard let start = game.startDate else { continue }
            let fire = start.addingTimeInterval(-Double(leadMinutes) * 60)
            guard fire > now, fire < now.addingTimeInterval(8 * 86_400) else { continue }

            let content = UNMutableNotificationContent()
            content.title = "\(game.away.name) 대 \(game.home.name) · \(leadMinutes)분 뒤 시작"
            let starters = (game.away.starter != nil && game.home.starter != nil) ? "선발 \(game.away.starter!) vs \(game.home.starter!)" : nil
            content.body = [game.clockText, game.stadium, starters, game.broadcast].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            content.sound = .default
            content.threadIdentifier = game.id
            content.userInfo = ["gameId": game.id, "type": "pregame"]
            content.interruptionLevel = .timeSensitive

            let id = prefix + game.id
            wanted.insert(id)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: fire.timeIntervalSince(now), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { !wanted.contains($0) })
    }
}
