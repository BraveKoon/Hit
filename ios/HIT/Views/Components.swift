import SwiftUI

// 화면 곳곳에서 쓰는 조각들

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(22)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.06), lineWidth: 1))
    }
}

struct SectionHeader: View {
    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(Typo.style(.title3, .bold))
            Spacer()
            if let detail { Text(detail).font(Typo.style(.footnote)).foregroundStyle(Palette.muted) }
        }
        .padding(.top, 10)
    }
}

/// 진행 중 표시 (숨 쉬는 점)
struct LiveDot: View {
    @State private var on = false
    var body: some View {
        Circle()
            .fill(Palette.live)
            .frame(width: 7, height: 7)
            .opacity(on ? 1 : 0.35)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: on)
            .onAppear { on = true }
    }
}

/// 경기 상태 알약: LIVE 3회말 / 18:30 / 종료 / 취소
struct StatusPill: View {
    let game: Game

    var body: some View {
        HStack(spacing: 5) {
            if game.status == .live { Circle().fill(Palette.red).frame(width: 7, height: 7) }
            Text(game.status == .live ? "Live \(game.inningText)" : game.statusLabel)
        }
        .font(Typo.style(.caption, .bold))
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .foregroundStyle(foreground)
        .background(background, in: Capsule())
    }

    private var foreground: Color {
        switch game.status {
        case .live: return .white
        case .scheduled: return Palette.text
        default: return Palette.muted
        }
    }

    private var background: Color {
        switch game.status {
        case .live: return Palette.red.opacity(0.28)
        default: return Color.white.opacity(0.08)
        }
    }
}

/// 선수 사진. 사진이 없거나 못 받으면 구단 색 원에 이름 첫 글자.
struct PlayerAvatar: View {
    let url: String?
    let name: String
    var team: String? = nil
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [(Team.find(team)?.color ?? Palette.surfaceHigh), Palette.surfaceHigh],
                startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(String(name.prefix(1)))
                .font(Typo.font(size * 0.4, .bold))
                .foregroundStyle(.white.opacity(0.9))
            if let url, let u = URL(string: url) {
                AsyncImage(url: u, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill().frame(width: size, height: size, alignment: .top)
                    } else {
                        Color.clear
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.14), lineWidth: 1))
        .accessibilityLabel(name)
    }
}

/// 계정 사진 (카카오 프로필) 또는 닉네임 첫 글자
struct AccountAvatar: View {
    var size: CGFloat = 34
    var body: some View {
        let auth = AuthManager.shared
        PlayerAvatar(url: auth.account?.avatar, name: auth.displayName, team: AppModel.shared.myTeam, size: size)
    }
}

struct MessageView: View {
    let title: String
    var detail: String? = nil
    var systemImage = "calendar"
    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let detail { Text(detail) }
        }
        .foregroundStyle(Palette.muted)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = Palette.accent
    var text: Color = .black
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typo.style(.headline))
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .foregroundStyle(text)
            .background(fill.opacity(isEnabled ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// 구단 색이 은은하게 번지는 배경
struct TeamGlow: View {
    let colors: [Color]
    var body: some View {
        LinearGradient(colors: colors.map { $0.opacity(0.55) } + [Palette.surface], startPoint: .topLeading, endPoint: .bottom)
            .overlay(
                LinearGradient(colors: [.white.opacity(0.06), .clear], startPoint: .top, endPoint: .center)
            )
    }
}

/// 응원 팀 고르기 (온보딩, MY)
struct TeamPicker: View {
    var selected: String?
    var onPick: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(Team.all) { team in
                let on = selected == team.code
                Button { onPick(team.code) } label: {
                    HStack(spacing: 10) {
                        TeamBadge(code: team.code, size: 36)
                        Text(team.name).font(Typo.style(.subheadline, .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 58)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(on ? AnyShapeStyle(LinearGradient(colors: [team.color.opacity(0.45), Palette.surfaceHigh], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(Palette.surface))
                    )
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? team.color : .white.opacity(0.06), lineWidth: on ? 2 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

// MARK: - 루타 느낌의 조각들 (검정 바탕, 원형 버튼, 알약 칩, 떠 있는 탭바)

/// 맨 위: 내 팀 엠블럼 + 로고, 오른쪽에 검색·알림 원형 버튼
struct AppHeader: View {
    @Environment(AppModel.self) private var model
    var onSearch: () -> Void
    @State private var showSettings = false

    var body: some View {
        HStack(spacing: 10) {
            if let team = model.myTeam { TeamBadge(code: team, size: 34) }
            LogoMark(height: 22, color: Palette.text)
            Spacer()
            CircleIconButton(systemImage: "magnifyingglass", label: "선수 검색", action: onSearch)
            CircleIconButton(systemImage: "bell.fill", label: "알림 설정") { showSettings = true }
        }
        .padding(.top, 6)
        .sheet(isPresented: $showSettings) {
            NavigationStack { NotificationSettingsView() }
                .presentationDetents([.large])
        }
    }
}

struct CircleIconButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Palette.text)
                .frame(width: 46, height: 46)
                .glassCircle()
                .overlay(Circle().strokeBorder(.white.opacity(0.08), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// 알약 칩: 선택되면 강조색으로 채워진다
struct PillChips<Item: Hashable>: View {
    let items: [(Item, String)]
    @Binding var selection: Item

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(items.indices, id: \.self) { i in
                    let item = items[i].0, title = items[i].1
                    let on = item == selection
                    Button { withAnimation(.snappy) { selection = item } } label: {
                        Text(title)
                            .font(Typo.font(16, on ? .bold : .medium))
                            .padding(.horizontal, 18)
                            .frame(height: 42)
                            .foregroundStyle(on ? Color.black : Palette.muted)
                            .background(on ? Palette.accent : Color.clear, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? .clear : Palette.surfaceHigh, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

/// 화면 아래에 떠 있는 탭바: 고른 탭만 아이콘+이름으로 길게, 나머지는 동그라미
struct FloatingTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var pill

    private let tabs: [(AppTab, String, String)] = [
        (.today, "heart.fill", "HOME"),
        (.diary, "ticket.fill", "직관"),
        (.records, "chart.bar.fill", "기록"),
        (.my, "person.fill", "MY"),
    ]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(tabs.indices, id: \.self) { i in
                let tab = tabs[i].0, icon = tabs[i].1, title = tabs[i].2
                let on = selection == tab
                Button { withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { selection = tab } } label: {
                    HStack(spacing: 8) {
                        Image(systemName: icon).font(.system(size: 19, weight: .bold))
                        if on { Text(title).font(Typo.font(16, .heavy)).fixedSize() }
                    }
                    .foregroundStyle(on ? Color.black : Palette.text)
                    .frame(minWidth: 52, minHeight: 52)
                    .padding(.horizontal, on ? 22 : 0)
                    .background {
                        if on {
                            Capsule().fill(Palette.accent).matchedGeometryEffect(id: "pill", in: pill)
                        } else {
                            Circle().fill(.white.opacity(0.12))
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(8)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.1), lineWidth: 1))
        .environment(\.colorScheme, .dark)
        .shadow(color: .black.opacity(0.5), radius: 18, y: 8)
    }
}

/// 내비게이션 목적지 (홈·직관·기록 탭 공용)
struct RouteView: View {
    let route: Route
    var body: some View {
        switch route {
        case .game(let id): GameDetailView(gameId: id)
        case .player(let id): PlayerDetailView(playerId: id)
        case .search: PlayerSearchView()
        }
    }
}

// MARK: - 애니메이션

/// 화면에 들어올 때 아래에서 살짝 떠오르며 나타난다. index 마다 조금씩 늦게 (최대 8칸).
/// 아이폰의 "동작 줄이기"가 켜져 있으면 바로 보인다.
struct AppearIn: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 16)
            .onAppear {
                guard !shown else { return }
                withAnimation(.spring(response: 0.5, dampingFraction: 0.86).delay(Double(min(index, 8)) * 0.05)) { shown = true }
            }
    }
}

extension View {
    func appearIn(_ index: Int = 0) -> some View { modifier(AppearIn(index: index)) }
}

/// 홈런 연출: "HOME RUN!" 글자가 튀어나오고 구단 색 꽃가루가 터진다 (약 2초)
struct HomeRunBurst: View {
    let name: String
    let colors: [Color]
    @State private var start = Date()

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSince(start)
            ZStack {
                Canvas { ctx, size in
                    let palette = colors + [Palette.accent, .white]
                    for i in 0..<70 {
                        // 조각마다 정해진 방향·속도로 퍼졌다가 떨어진다
                        let angle = Double(i) * 2.399963          // 황금각으로 고르게
                        let speed = 170 + Double((i * 53) % 140)
                        let x = size.width / 2 + cos(angle) * speed * t
                        let y = size.height * 0.4 + sin(angle) * speed * t + 330 * t * t
                        let w: CGFloat = i % 3 == 0 ? 6 : 9
                        ctx.opacity = max(0, 1 - t / 1.9)
                        ctx.fill(Path(roundedRect: CGRect(x: x, y: y, width: w, height: w * 1.6), cornerRadius: 1.5),
                                 with: .color(palette[i % palette.count]))
                    }
                }
                VStack(spacing: 6) {
                    Text("HOME RUN!")
                        .font(Typo.font(46, .black))
                        .foregroundStyle(Palette.accent)
                        .shadow(color: Palette.accent.opacity(0.6), radius: 18)
                    Text(name).font(Typo.style(.title3, .heavy)).foregroundStyle(.white)
                }
                .scaleEffect(t < 0.22 ? 0.4 + t / 0.22 * 0.8 : max(1, 1.2 - (t - 0.22) * 0.9))
                .opacity(t > 1.6 ? max(0, 1 - (t - 1.6) / 0.4) : 1)
            }
        }
        .allowsHitTesting(false)
        .accessibilityLabel("\(name) 홈런")
    }
}

// MARK: - 글라스

/// 앱 바탕: 검정 위에 강조색·내 팀 색이 은은하게 번진다 (그 위 유리 카드가 비쳐 보이도록)
struct AppBackground: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ZStack {
            Color.black
            RadialGradient(colors: [Palette.accent.opacity(0.22), .clear], center: .init(x: 0.95, y: -0.05), startRadius: 10, endRadius: 420)
            RadialGradient(colors: [(model.team?.color ?? Palette.accent).opacity(0.28), .clear], center: .init(x: 0, y: 0.75), startRadius: 10, endRadius: 460)
        }
        .ignoresSafeArea()
    }
}

/// 유리 카드: 반투명 재질 + 위쪽이 밝은 테두리. iOS 26 에서는 시스템 Liquid Glass.
struct GlassBackground<S: InsettableShape>: ViewModifier {
    let shape: S
    var tint: Color? = nil

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content.glassEffect(tint.map { Glass.regular.tint($0.opacity(0.35)) } ?? .regular, in: shape)
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content
            .background((tint ?? .clear).opacity(0.18), in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.05)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
            )
            .environment(\.colorScheme, .dark)
    }
}

extension View {
    func glassCard(_ radius: CGFloat = 22, tint: Color? = nil) -> some View {
        modifier(GlassBackground(shape: RoundedRectangle(cornerRadius: radius, style: .continuous), tint: tint))
    }
    func glassCapsule(tint: Color? = nil) -> some View { modifier(GlassBackground(shape: Capsule(), tint: tint)) }
    func glassCircle() -> some View { modifier(GlassBackground(shape: Circle())) }
}

/// 연결이 끊겼거나 경기 데이터가 늦을 때 화면 위에 띄우는 한 줄
struct StaleBanner: View {
    let text: String
    var systemImage = "exclamationmark.arrow.triangle.2.circlepath"

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(Typo.style(.footnote, .semibold))
            .foregroundStyle(Palette.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Palette.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.accent.opacity(0.25), lineWidth: 0.5))
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine)
    }
}
