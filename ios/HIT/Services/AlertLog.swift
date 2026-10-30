import Foundation

/// 앱이 띄운 알림의 기록 (알림센터 화면용. 최근 100개)
struct AlertItem: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let body: String
    let date: Date
    let gameId: String?
}

enum AlertLog {
    private static let key = "hit.alertLog"

    static func load() -> [AlertItem] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([AlertItem].self, from: data)) ?? []
    }

    static func add(id: String, title: String, body: String, gameId: String?) {
        var items = load().filter { $0.id != id }
        items.insert(AlertItem(id: id, title: title, body: body, date: Date(), gameId: gameId), at: 0)
        save(Array(items.prefix(100)))
    }

    static func save(_ items: [AlertItem]) {
        if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: key) }
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}
