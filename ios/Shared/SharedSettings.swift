import Foundation

/// 앱과 위젯이 함께 쓰는 설정 (App Group UserDefaults).
enum SharedSettings {
    static var groupID: String {
        Bundle.main.object(forInfoDictionaryKey: "HITAppGroup") as? String ?? ""
    }

    static var defaults: UserDefaults {
        UserDefaults(suiteName: groupID) ?? .standard
    }

    /// 빌드 설정 HIT_API_BASE_URL. 설정 화면에서 바꾸면 그 값이 우선한다.
    static var apiBaseURL: URL {
        if let override = defaults.string(forKey: "apiBaseURL"), let url = URL(string: override), url.scheme != nil {
            return url
        }
        let raw = Bundle.main.object(forInfoDictionaryKey: "HITAPIBaseURL") as? String ?? ""
        return URL(string: raw) ?? URL(string: "http://localhost:8787")!
    }

    static var apiBaseOverride: String? {
        get { defaults.string(forKey: "apiBaseURL") }
        set { defaults.set(newValue?.isEmpty == false ? newValue : nil, forKey: "apiBaseURL") }
    }

    static var myTeam: String? {
        get { defaults.string(forKey: "myTeam") }
        set { defaults.set(newValue, forKey: "myTeam") }
    }

    /// 잠금화면 실시간 현황 카드의 바탕 (MY에서 고른다. 위젯이 그릴 때 읽는다)
    static var liveTheme: LiveTheme {
        get { defaults.string(forKey: "liveTheme").flatMap(LiveTheme.init(rawValue:)) ?? .navy }
        set { defaults.set(newValue.rawValue, forKey: "liveTheme") }
    }
}

enum LiveTheme: String, CaseIterable, Identifiable {
    case navy, team, dark, clear
    var id: String { rawValue }

    var title: String {
        switch self {
        case .navy: "네이비"
        case .team: "팀 컬러"
        case .dark: "다크"
        case .clear: "투명"
        }
    }

    var detail: String {
        switch self {
        case .navy: "기본"
        case .team: "두 팀 색으로"
        case .dark: "검정"
        case .clear: "iOS 반투명"
        }
    }
}
