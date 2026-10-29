import SwiftUI
import UIKit

/// MY: 프로필 · 응원 팀 · 관심 선수 · 알림 설정 · 계정
@MainActor
struct MyView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Route] = []
    @State private var showTeams = false
    @State private var showSettings = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false
    @State private var showTheme = false
    @State private var record: PredictionRecord?
    private var auth: AuthManager { AuthManager.shared }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "MY") { path.append(.search) }
                    profile

                    SectionHeader(title: "응원 팀")
                    Button { showTeams = true } label: {
                        HStack(spacing: 14) {
                            if let team = model.team {
                                TeamBadge(code: team.code, size: 48)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(team.name).font(Typo.font(17, .bold))
                                    Text("홈구장 \(team.home)").font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                                }
                            }
                            Spacer()
                            Text("변경").font(Typo.style(.subheadline, .semibold)).foregroundStyle(Palette.accent)
                        }
                        .padding(16)
                        .glassCard(20)
                    }
                    .buttonStyle(.press)

                    if auth.state == .signedIn {
                        SectionHeader(title: "승부예측")
                        PredictionRecordCard(record: record)
                    }

                    SectionHeader(title: "관심 선수", detail: model.favorites.isEmpty ? nil : "\(model.favorites.count)명")
                    ForEach(model.favorites, id: \.key) { FavoriteRow(favorite: $0) }
                    Button { path.append(.search) } label: {
                        Label("선수 찾아서 추가", systemImage: "plus")
                            .font(Typo.style(.subheadline, .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .glassCapsule()
                    }
                    .buttonStyle(.press)

                    SectionHeader(title: "설정")
                    VStack(spacing: 0) {
                        row("bell.badge.fill", "알림 설정") { showSettings = true }
                        Divider().overlay(Palette.surfaceHigh)
                        row("lock.iphone", "잠금화면 테마") { showTheme = true }
                        Divider().overlay(Palette.surfaceHigh)
                        if auth.state == .signedIn {
                            row("rectangle.portrait.and.arrow.right", "로그아웃") { Task { await auth.signOut() } }
                            Divider().overlay(Palette.surfaceHigh)
                            row("person.crop.circle.badge.xmark", "회원 탈퇴", tint: Palette.red) { confirmDelete = true }
                        } else {
                            row("person.crop.circle.badge.plus", "로그인 · 회원가입", tint: Palette.accent) { Task { await auth.signOut() } }
                        }
                    }
                    .glassCard(20)

                    Text("경기 기록·구단 엠블럼·선수 사진은 네이버 스포츠의 KBO 데이터를 가져와 보여줍니다.")
                        .font(Typo.style(.caption))
                        .foregroundStyle(Palette.muted)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .tabBarSpace()
            .background(AppBackground())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { RouteView(route: $0) }
            .sheet(isPresented: $showTeams) { teamSheet }
            .sheet(isPresented: $showSettings) { NavigationStack { NotificationSettingsView() } }
            .sheet(isPresented: $showTheme) { LiveThemeSheet().presentationDetents([.large]) }
            .task(id: auth.state) {
                if auth.state == .signedIn {
                    record = try? await APIClient().myPredictions()
                } else {
                    record = nil
                }
            }
            .alert("닉네임 바꾸기", isPresented: $renaming) {
                TextField("닉네임", text: $newName)
                Button("저장") { Task { await auth.rename(newName) } }
                Button("취소", role: .cancel) {}
            }
            .confirmationDialog("정말 탈퇴할까요?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("탈퇴하기", role: .destructive) { Task { await auth.deleteAccount() } }
            } message: {
                Text("계정과 응원 팀·관심 선수·알림 설정이 모두 지워지고 알림도 더 이상 오지 않아요.")
            }
        }
    }

    private var profile: some View {
        HStack(spacing: 14) {
            AccountAvatar(size: 64)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(auth.displayName).font(Typo.font(21, .heavy))
                    if auth.state == .signedIn {
                        Button {
                            newName = auth.account?.nickname ?? ""
                            renaming = true
                        } label: { Image(systemName: "pencil").font(.subheadline) }
                        .foregroundStyle(Palette.muted)
                        .accessibilityLabel("닉네임 바꾸기")
                    }
                }
                Text(auth.state == .signedIn ? "\(auth.account?.providerLabel ?? "")로 로그인" : "로그인하지 않음")
                    .font(Typo.style(.caption))
                    .foregroundStyle(Palette.muted)
            }
            Spacer()
        }
        .padding(18)
        .background(TeamGlow(colors: [model.team?.color ?? Palette.accent]))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func row(_ icon: String, _ title: String, tint: Color = Palette.text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).frame(width: 24)
                Text(title)
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Palette.muted)
            }
            .font(Typo.font(16, .medium))
            .foregroundStyle(tint)
            .padding(.horizontal, 16)
            .frame(height: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.press)
    }

    private var teamSheet: some View {
        NavigationStack {
            ScrollView {
                TeamPicker(selected: model.myTeam) { code in
                    model.setTeam(code)
                    showTeams = false
                }
                .padding(16)
            }
            .background(AppBackground())
            .navigationTitle("응원 팀")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { showTeams = false } } }
        }
    }
}

/// 알림 설정 (헤더의 종 버튼, MY → 알림 설정)
@MainActor
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var push = PushRegistrar.shared
    @State private var serverURL = SharedSettings.apiBaseOverride ?? ""

    var body: some View {
        Form {
            Section {
                permissionRow
            } footer: {
                if let err = push.lastError { Text(err).foregroundStyle(Palette.red) }
            }
            Section("내 팀 경기") {
                toggle("경기 시작 10분 전", "선발 투수와 중계 채널", \.pregame)
                toggle("선발 투수 발표", "경기 당일 선발이 정해지면", \.starters)
                toggle("라인업 발표", "경기 전에 타순이 나오면 (늦게 나오는 날은 생략)", \.lineup)
                toggle("경기 시작", nil, \.start)
                toggle("득점", "점수가 날 때마다 (실점 포함)", \.score)
                toggle("홈런", "득점을 꺼도 홈런은 받기", \.homerun)
                toggle("안타", "내 팀 타자가 안타를 칠 때마다", \.hit)
                toggle("볼넷·사구", "내 팀 타자가 걸어 나갈 때", \.walk)
                toggle("역전·동점", "득점을 꺼도 역전·동점은 받기", \.lead)
                toggle("연장 돌입", nil, \.extra)
                toggle("경기 종료", "결과와 승리·패전 투수", \.end)
                toggle("취소·중단", "우천 취소, 서스펜디드", \.cancel)
            }
            Section("관심 선수") {
                toggle("관심 선수 알림", "타자는 타석 결과마다, 투수는 등판·강판 때", \.players)
            }
            Section("실시간 현황") {
                toggle("경기 시작 때 잠금화면에 자동으로", "경기 중 실시간 점수판이 잠금화면과 다이내믹 아일랜드에 떠요", \.liveActivity)
            }
            Section {
                DisclosureGroup("개발자 설정") {
                    TextField(SharedSettings.apiBaseURL.absoluteString, text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            SharedSettings.apiBaseOverride = serverURL.trimmingCharacters(in: .whitespaces)
                            Task { await push.sync() }
                        }
                    if let synced = push.lastSyncedAt {
                        LabeledContent("알림 서버 동기화", value: synced.formatted(date: .omitted, time: .shortened))
                    }
                    LabeledContent("버전", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppBackground())
        .navigationTitle("알림 설정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } } }
        .task { await push.refresh() }
    }

    @ViewBuilder
    private var permissionRow: some View {
        switch push.authorization {
        case .authorized, .provisional, .ephemeral:
            Label(push.deviceToken == nil ? "알림 허용됨 · 기기 등록 중" : "알림 허용됨", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Palette.live)
        case .denied:
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            } label: {
                Label("알림이 꺼져 있어요 · 설정에서 켜기", systemImage: "bell.slash")
            }
        default:
            Button {
                Task { await push.requestPermission() }
            } label: {
                Label("알림 허용하기", systemImage: "bell")
            }
        }
    }

    private func toggle(_ title: String, _ detail: String?, _ key: WritableKeyPath<NotificationPrefs, Bool>) -> some View {
        Toggle(isOn: Binding(
            get: { model.prefs[keyPath: key] },
            set: { value in model.updatePrefs { $0[keyPath: key] = value } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(Typo.style(.caption)).foregroundStyle(Palette.muted) }
            }
        }
        .tint(Palette.live)
    }
}

/// 승부예측 적중률: 큰 숫자 + 맞힘/예측 + 연속 적중
struct PredictionRecordCard: View {
    let record: PredictionRecord?

    var body: some View {
        HStack(spacing: 0) {
            stat(record?.rate.map { "\(Int(($0 * 100).rounded()))%" } ?? "-", "적중률", accent: true)
            stat(record.map { "\($0.correct)/\($0.decided)" } ?? "-", "맞힘")
            stat(record.map { "\($0.streak)" } ?? "-", "연속 적중")
        }
        .padding(.vertical, 16)
        .glassCard(20)
        .overlay(alignment: .bottom) {
            if record?.total == 0 {
                Text("경기 프리뷰에서 이길 팀을 골라 보세요").font(Typo.style(.caption2)).foregroundStyle(Palette.muted).padding(.bottom, 4)
            }
        }
    }

    private func stat(_ value: String, _ label: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(value).font(Typo.score(24)).foregroundStyle(accent ? Palette.accent : Palette.text)
            Text(label).font(Typo.style(.caption)).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 잠금화면 테마 고르기: 네 가지 카드를 실제 모양으로 미리 보여 준다.
struct LiveThemeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var theme = SharedSettings.liveTheme
    private let away = "HT", home = "SS"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Text("잠금화면에 띄운 경기 카드의 바탕을 골라요. 다음 점수 업데이트부터 바뀝니다.")
                        .font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(LiveTheme.allCases) { t in
                        Button {
                            theme = t
                            SharedSettings.liveTheme = t
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(t.title).font(Typo.style(.subheadline, .bold))
                                    Text(t.detail).font(Typo.style(.caption)).foregroundStyle(Palette.muted)
                                    Spacer()
                                    Image(systemName: theme == t ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(theme == t ? Palette.accent : Palette.muted)
                                }
                                sample(t)
                            }
                        }
                        .buttonStyle(.press)
                    }
                }
                .padding(16)
            }
            .background(AppBackground())
            .navigationTitle("잠금화면 테마")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } } }
        }
        .environment(\.colorScheme, .dark)
    }

    /// 잠금화면 카드 미리보기 (배경화면 위에 올린 모습)
    private func sample(_ t: LiveTheme) -> some View {
        HStack {
            TeamBadge(code: away, size: 30)
            Text("KIA").font(Typo.font(15, .heavy))
            Spacer()
            Text("3").font(Typo.score(26))
            VStack(spacing: 2) {
                Text("7회말").font(Typo.font(11, .bold))
                Text("1아웃").font(Typo.font(10)).foregroundStyle(.white.opacity(0.7))
            }
            .frame(width: 54)
            Text("5").font(Typo.score(26))
            Spacer()
            Text("삼성").font(Typo.font(15, .heavy))
            TeamBadge(code: home, size: 30)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background { background(t) }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(theme == t ? Palette.accent : .clear, lineWidth: 2))
        .padding(10)
        .background(
            LinearGradient(colors: [Color(hex: 0x3D5A80), Color(hex: 0x98C1D9)], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    @ViewBuilder
    private func background(_ t: LiveTheme) -> some View {
        switch t {
        case .navy:
            LinearGradient(colors: [Color(hex: 0x1C2E55), Color(hex: 0x0B1530)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .team:
            LinearGradient(colors: [Team.color(for: away).opacity(0.75), Team.color(for: home).opacity(0.75)], startPoint: .leading, endPoint: .trailing)
                .background(Color.black)
        case .dark:
            Color.black
        case .clear:
            Rectangle().fill(.ultraThinMaterial)
        }
    }
}
