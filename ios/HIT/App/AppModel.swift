import SwiftUI
import WidgetKit

enum AppTab: Hashable { case today, diary, records, my }

/// 화면 이동 (홈·직관·기록 탭의 내비게이션 스택에서 같이 쓴다)
enum Route: Hashable {
    case game(String)
    case player(String)
    case search
}

/// 앱 전체 상태: 응원 팀, 알림 설정, 탭·내비게이션.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    private(set) var myTeam: String?
    private(set) var prefs: NotificationPrefs
    private(set) var onboarded: Bool
    var tab: AppTab = .today
    private(set) var favorites: [FavoritePlayer] = []
    var todayPath: [Route] = []
    var recordsPath: [Route] = []
    var diaryPath: [Route] = []

    private let defaults = UserDefaults.standard

    private init() {
        myTeam = SharedSettings.myTeam
        onboarded = defaults.bool(forKey: "onboarded")
        if let data = defaults.data(forKey: "prefs"), let saved = try? JSONDecoder().decode(NotificationPrefs.self, from: data) {
            prefs = saved
        } else {
            prefs = NotificationPrefs()
        }
        if let data = defaults.data(forKey: "favorites"), let saved = try? JSONDecoder().decode([FavoritePlayer].self, from: data) {
            favorites = saved
        }
    }

    func isFavorite(team: String, name: String) -> Bool {
        favorites.contains { $0.team == team && $0.name == name }
    }

    func toggleFavorite(_ player: FavoritePlayer) {
        if let i = favorites.firstIndex(where: { $0.key == player.key }) {
            favorites.remove(at: i)
        } else {
            favorites.insert(player, at: 0)
            if favorites.count > 30 { favorites.removeLast() }
        }
        saveFavorites()
        saveRemote()
    }

    private func saveFavorites() {
        if let data = try? JSONEncoder().encode(favorites) { defaults.set(data, forKey: "favorites") }
    }

    var team: Team? { Team.find(myTeam) }

    func setTeam(_ code: String) {
        guard code != myTeam else { return }
        applyTeam(code)
        saveRemote()
    }

    func updatePrefs(_ change: (inout NotificationPrefs) -> Void) {
        var next = prefs
        change(&next)
        guard next != prefs else { return }
        applyPrefs(next)
        saveRemote()
    }

    /// 로그인하면 계정에 저장된 팀·알림 설정을 따른다. 계정에 아직 없으면 이 기기 설정을 계정에 올린다.
    func adopt(account: Account) {
        if let team = account.team {
            applyTeam(team)
            if let p = account.prefs { applyPrefs(p) }
            if let players = account.players {
                favorites = players
                saveFavorites()
            }
            finishOnboarding() // 다른 기기에서 이미 설정한 사람은 온보딩 생략
        } else if myTeam != nil {
            saveRemote()
        }
    }

    /// 탈퇴 후: 처음 설치한 상태로
    func resetForNewUser() {
        myTeam = nil
        SharedSettings.myTeam = nil
        onboarded = false
        defaults.set(false, forKey: "onboarded")
        applyPrefs(NotificationPrefs())
        favorites = []
        saveFavorites()
        todayPath = []
        recordsPath = []
        diaryPath = []
        DiaryModel.shared.reset()
        tab = .today
    }

    private func applyTeam(_ code: String) {
        myTeam = code
        SharedSettings.myTeam = code
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func applyPrefs(_ next: NotificationPrefs) {
        prefs = next
        if let data = try? JSONEncoder().encode(next) { defaults.set(data, forKey: "prefs") }
    }

    private func saveRemote() {
        let team = myTeam, prefs = prefs, players = favorites
        Task {
            await AuthManager.shared.saveProfile(team: team, prefs: prefs, players: players)
            await PushRegistrar.shared.sync()
        }
    }

    func finishOnboarding() {
        onboarded = true
        defaults.set(true, forKey: "onboarded")
    }

    func open(gameId: String) {
        tab = .today
        todayPath = [.game(gameId)]
    }
}
