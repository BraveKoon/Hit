import SwiftUI

/// 로그인 → (처음이면) 팀 고르기·알림 → 홈 · 직관 · 커뮤니티 · 기록 · MY (떠 있는 탭바)
@MainActor
struct RootView: View {
    @Environment(AppModel.self) private var model
    private var auth: AuthManager { AuthManager.shared }

    var body: some View {
        @Bindable var model = model
        Group {
            switch auth.state {
            case .signedOut:
                AuthView()
                    .transition(.opacity)
            case .guest, .signedIn:
                if model.onboarded, model.myTeam != nil {
                    TabView(selection: $model.tab) {
                        TodayView()
                            .toolbar(.hidden, for: .tabBar)
                            .tag(AppTab.today)
                        DiaryView()
                            .toolbar(.hidden, for: .tabBar)
                            .tag(AppTab.diary)
                        CommunityView()
                            .toolbar(.hidden, for: .tabBar)
                            .tag(AppTab.community)
                        RecordsView()
                            .toolbar(.hidden, for: .tabBar)
                            .tag(AppTab.records)
                        MyView()
                            .toolbar(.hidden, for: .tabBar)
                            .tag(AppTab.my)
                    }
                    .overlay(alignment: .bottom) {
                        FloatingTabBar(selection: $model.tab)
                            .padding(.bottom, 4)
                    }
                } else {
                    OnboardingView()
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.state)
        .background(AppBackground())
    }
}

/// 떠 있는 탭바에 내용이 가리지 않도록 스크롤 아래 여백
extension View {
    func tabBarSpace() -> some View { safeAreaPadding(.bottom, 84) }
}
