import AuthenticationServices
import CryptoKit
import SwiftUI

enum AuthState: Equatable {
    case signedOut   // 로그인 화면
    case guest       // 로그인 없이 둘러보기
    case signedIn
}

/// 회원가입·로그인. Apple 과 카카오 둘 다 "처음이면 가입, 아니면 로그인"이라 화면은 하나.
@MainActor
@Observable
final class AuthManager {
    static let shared = AuthManager()

    private(set) var state: AuthState
    private(set) var account: Account?
    private(set) var busy = false
    var error: String?

    private init() {
        if let token = Keychain.load() {
            APIClient.sessionToken = token
            state = .signedIn // 토큰이 있으면 일단 들어가고, 뒤에서 확인
        } else {
            state = UserDefaults.standard.bool(forKey: "guest") ? .guest : .signedOut
        }
    }

    var displayName: String {
        if let name = account?.nickname, !name.isEmpty { return name }
        return state == .guest ? "손님" : "야구팬"
    }

    /// 앱 실행 때: 세션이 아직 유효한지, 서버에 저장된 팀·알림 설정 가져오기
    func refresh() async {
        guard state == .signedIn else { return }
        do {
            let me = try await APIClient().me()
            account = me
            AppModel.shared.adopt(account: me)
        } catch let e as APIError where e.status == 401 {
            clearLocal()
            error = "로그인이 만료됐어요. 다시 로그인해 주세요."
        } catch {
            // 오프라인 등: 그대로 둔다
        }
    }

    // MARK: Apple

    func configure(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = [.fullName, .email]
    }

    func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let err):
            if (err as? ASAuthorizationError)?.code != .canceled {
                error = "Apple 로그인에 실패했어요. \(err.localizedDescription)"
            }
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken,
                  let identityToken = String(data: data, encoding: .utf8) else {
                error = "Apple 로그인 정보를 읽지 못했어요."
                return
            }
            // Apple 은 이름을 처음 한 번만 준다. 한국식으로 성+이름.
            let name = [credential.fullName?.familyName, credential.fullName?.givenName]
                .compactMap { $0 }.joined()
            await run {
                let r = try await APIClient().signInWithApple(identityToken: identityToken, name: name.isEmpty ? nil : name)
                self.complete(token: r.token, account: r.user)
            }
        }
    }

    // MARK: 카카오 (서버가 OAuth 를 진행하고 hit://auth?token=… 으로 돌려준다)

    func signInWithKakao(using session: WebAuthenticationSession) async {
        await run {
            let callback: URL
            do {
                callback = try await session.authenticate(
                    using: APIClient().kakaoStartURL,
                    callbackURLScheme: "hit",
                    preferredBrowserSession: .shared
                )
            } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
                return
            }
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if let message = items.first(where: { $0.name == "error" })?.value {
                self.error = message
                return
            }
            guard let token = items.first(where: { $0.name == "token" })?.value else {
                self.error = "카카오 로그인 결과를 받지 못했어요."
                return
            }
            APIClient.sessionToken = token
            let me = try await APIClient().me()
            self.complete(token: token, account: me)
        }
    }

    // MARK: Google (PKCE — 앱이 code 를 받아 서버가 교환)

    private static let googleClientID = "259513225241-se1scmqbdftml01khktdedg2kfklalkh.apps.googleusercontent.com"
    private static let googleScheme = "com.googleusercontent.apps.259513225241-se1scmqbdftml01khktdedg2kfklalkh"

    func signInWithGoogle(using session: WebAuthenticationSession) async {
        await run {
            let verifier = Self.randomURLSafe(48)
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
            let redirect = "\(Self.googleScheme):/oauth2redirect"
            var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
            c.queryItems = [
                .init(name: "client_id", value: Self.googleClientID),
                .init(name: "redirect_uri", value: redirect),
                .init(name: "response_type", value: "code"),
                .init(name: "scope", value: "openid email profile"),
                .init(name: "code_challenge", value: challenge),
                .init(name: "code_challenge_method", value: "S256"),
            ]
            let callback: URL
            do {
                callback = try await session.authenticate(using: c.url!, callbackURLScheme: Self.googleScheme, preferredBrowserSession: .shared)
            } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
                return
            }
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard let code = items.first(where: { $0.name == "code" })?.value else {
                self.error = "Google 로그인 결과를 받지 못했어요."
                return
            }
            let r = try await APIClient().signInWithGoogle(code: code, verifier: verifier, redirectUri: redirect)
            APIClient.sessionToken = r.token
            self.complete(token: r.token, account: r.user)
        }
    }

    private static func randomURLSafe(_ n: Int) -> String {
        Data((0..<n).map { _ in UInt8.random(in: .min ... .max) }).base64URL
    }

    func continueAsGuest() {
        UserDefaults.standard.set(true, forKey: "guest")
        state = .guest
    }

    // MARK: 계정 관리

    func rename(_ nickname: String) async {
        await run {
            self.account = try await APIClient().updateMe(nickname: nickname)
        }
    }

    /// 응원 팀·알림 설정·관심 선수를 계정에 저장 (로그인했을 때만)
    func saveProfile(team: String?, prefs: NotificationPrefs, players: [FavoritePlayer]) async {
        guard state == .signedIn else { return }
        if let updated = try? await APIClient().updateMe(team: team, prefs: prefs, players: players) {
            account = updated
        }
    }

    func signOut() async {
        try? await APIClient().signOut()
        clearLocal()
    }

    func deleteAccount() async {
        await run {
            try await APIClient().deleteAccount()
            self.clearLocal()
            AppModel.shared.resetForNewUser()
        }
    }

    // MARK: -

    private func complete(token: String, account: Account) {
        Keychain.save(token)
        APIClient.sessionToken = token
        UserDefaults.standard.set(false, forKey: "guest")
        self.account = account
        error = nil
        state = .signedIn
        AppModel.shared.adopt(account: account)
        Task { await PushRegistrar.shared.sync() } // 이 기기를 계정에 묶는다
    }

    private func clearLocal() {
        Keychain.delete()
        APIClient.sessionToken = nil
        UserDefaults.standard.set(false, forKey: "guest")
        account = nil
        state = .signedOut
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
        } catch {
            self.error = (error as? APIError)?.message ?? "연결에 실패했어요. 잠시 후 다시 시도해 주세요."
        }
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
