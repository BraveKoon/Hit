import Foundation
import JavaScriptCore

/// 서버의 "읽기 전용 경로"(경기·순위·선수·기록…)를 아이폰 안에서 직접 실행한다.
/// 서버와 같은 JavaScript(hit-core.js, server/src 에서 자동 생성)를 JavaScriptCore 로 돌리고,
/// 네이버 요청은 이 아이폰이 직접 보낸다. 서버가 해외에 있어 네이버에 접속하지 못해도 화면이 채워진다.
/// 실패하면 호출한 쪽(APIClient)이 서버로 돌아간다.
final class LocalCore: @unchecked Sendable {
    /// 번들에 hit-core.js 가 없으면(예: 알림 확장) nil
    static let shared: LocalCore? = LocalCore()

    private let queue = DispatchQueue(label: "hit.localcore")        // JavaScript 는 이 큐에서만 만진다
    private let session: URLSession
    private var context: JSContext?

    private init?() {
        guard let url = Bundle.main.url(forResource: "hit-core", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 15
        session = URLSession(configuration: config)
        queue.sync {
            guard let ctx = JSContext() else { return }
            ctx.exceptionHandler = { _, exception in NSLog("HIT core JS 오류: %@", exception?.toString() ?? "?") }
            let fetch: @convention(block) (String, String, JSValue) -> Void = { [weak self] url, options, callback in
                self?.nativeFetch(url, options, callback)
            }
            ctx.setObject(unsafeBitCast(fetch, to: AnyObject.self), forKeyedSubscript: "__nativeFetch" as NSString)
            ctx.evaluateScript(source)
            ctx.evaluateScript("__hit.start()")
            context = ctx
        }
        if context == nil { return nil }
    }

    /// 이 경로를 앱 안에서 처리할 수 있는지 (서버 db·로그인이 필요한 것은 제외)
    static func handles(_ path: String) -> Bool {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "v1" else { return false }
        switch parts.count {
        case 2: return ["games", "calendar", "postseason", "standings", "players", "leaders"].contains(parts[1])
        case 3: return parts[1] == "games" || parts[1] == "players"                  // games/:id · players/:id
        case 4: return parts[1] == "games" && ["relay", "winrate", "preview"].contains(parts[3])
        default: return false
        }
    }

    /// "/v1/games?date=2026-10-29" 형태로 요청해 (상태 코드, JSON) 을 받는다. 엔진을 못 쓰면 nil
    func get(_ target: String) async -> (status: Int, data: Data)? {
        await withCheckedContinuation { (continuation: CheckedContinuation<(status: Int, data: Data)?, Never>) in
            queue.async {
                guard let ctx = self.context, let hit = ctx.objectForKeyedSubscript("__hit") else {
                    continuation.resume(returning: nil)
                    return
                }
                let once = Once()
                let done: @convention(block) (Int32, String) -> Void = { status, body in
                    once.run { continuation.resume(returning: (Int(status), Data(body.utf8))) }
                }
                let callback = JSValue(object: unsafeBitCast(done, to: AnyObject.self), in: ctx)
                ctx.exception = nil
                hit.invokeMethod("handle", withArguments: [target, callback as Any])
                if ctx.exception != nil {
                    ctx.exception = nil
                    once.run { continuation.resume(returning: nil) }
                }
            }
        }
    }

    // MARK: JavaScript 가 부르는 네이티브 fetch

    private struct FetchOptions: Decodable {
        var headers: [String: String]?
        var timeoutMs: Double?
    }

    /// JavaScript 큐에서 불린다. 응답은 다시 같은 큐에서 callback(status, text, error) 로 돌려준다.
    private func nativeFetch(_ urlString: String, _ optionsJSON: String, _ callback: JSValue) {
        let options = (try? JSONDecoder().decode(FetchOptions.self, from: Data(optionsJSON.utf8))) ?? FetchOptions()
        guard let url = URL(string: urlString) else {
            callback.call(withArguments: [0, "", "bad url"])
            return
        }
        var request = URLRequest(url: url, timeoutInterval: (options.timeoutMs ?? 15000) / 1000)
        for (name, value) in options.headers ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        session.dataTask(with: request) { [weak self] data, response, error in
            self?.queue.async {
                if let error {
                    let timedOut = (error as? URLError)?.code == .timedOut
                    callback.call(withArguments: [0, "", timedOut ? "timeout" : error.localizedDescription])
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                callback.call(withArguments: [status, String(decoding: data ?? Data(), as: UTF8.self), NSNull()])
            }
        }.resume()
    }
}

/// continuation 을 한 번만 재개하게 하는 작은 도우미
private final class Once: @unchecked Sendable {
    private var done = false
    private let lock = NSLock()
    func run(_ body: () -> Void) {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { body() }
    }
}
