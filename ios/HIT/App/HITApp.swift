import SwiftUI

@main
struct HITApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Palette.accent)
                .font(Typo.style(.body))   // .font 를 따로 주지 않은 글자도 Pretendard
                .onOpenURL { url in
                    // 위젯·라이브 액티비티 탭: hit://game/<gameId>
                    if url.scheme == "hit", url.host == "game", let id = url.pathComponents.dropFirst().first {
                        model.open(gameId: id)
                    }
                }
        }
    }
}
