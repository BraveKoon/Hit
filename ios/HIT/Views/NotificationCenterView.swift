import SwiftUI
import UserNotifications

/// 우측 상단 벨: 받은 알림 목록 (앱이 띄운 알림 기록 + 알림 센터에 남아 있는 서버 푸시)
struct NotificationCenterView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var items: [AlertItem] = []
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if items.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "bell.slash").font(.system(size: 34)).foregroundStyle(Palette.muted)
                        Text("받은 알림이 아직 없어요").font(Typo.style(.subheadline, .semibold))
                        Text("득점·경기 시작·종료 알림이 여기에 쌓여요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(item.title).font(Typo.style(.subheadline, .bold))
                                Spacer()
                                Text(item.date, format: .relative(presentation: .named))
                                    .font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                            }
                            if !item.body.isEmpty {
                                Text(item.body).font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                            }
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(Palette.surface)
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("알림")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("알림 설정")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack {
                        if !items.isEmpty {
                            Button("모두 지우기") {
                                AlertLog.clear()
                                UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                                items = []
                            }
                        }
                        Button("닫기") { dismiss() }
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                NavigationStack { NotificationSettingsView() }
            }
        }
        .task { await load() }
    }

    private func load() async {
        var all = AlertLog.load()
        // 서버 푸시는 앱이 못 봤을 수 있어서, 알림 센터에 남아 있는 것도 합친다
        let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
        for n in delivered where !all.contains(where: { $0.id == n.request.identifier }) {
            all.append(AlertItem(id: n.request.identifier, title: n.request.content.title, body: n.request.content.body,
                                 date: n.date, gameId: n.request.content.userInfo["gameId"] as? String))
        }
        items = all.sorted { $0.date > $1.date }
    }
}
