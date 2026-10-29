import SwiftUI

@main
struct HITApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Palette.accent)
                .font(Typo.style(.body))   // .font 를 따로 주지 않은 글자도 Pretendard
                .onChange(of: scenePhase, initial: true) { _, phase in
                    switch phase {
                    case .active:
                        AutoLiveActivity.shared.run()                    // 내 팀 경기 30분 전부터 잠금화면 카드를 직접 켜고 갱신
                        Task { await PregameReminders.refresh() }       // 앞으로 8일 내 내 팀 경기의 30분 전 알림 예약
                    case .background:
                        // 경기를 따라가는 중(소리 없는 오디오 켜짐)이면 백그라운드에서도 계속 읽는다
                        if !AutoLiveActivity.shared.isFollowing { AutoLiveActivity.shared.stop() }
                    default: break
                    }
                }
                .onOpenURL { url in
                    // 위젯·라이브 액티비티 탭: hit://game/<gameId>
                    if url.scheme == "hit", url.host == "game", let id = url.pathComponents.dropFirst().first {
                        model.open(gameId: id)
                    }
                }
        }
    }
}
