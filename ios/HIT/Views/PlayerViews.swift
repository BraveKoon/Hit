import SwiftUI

/// 선수 검색: 이름 일부, 초성(ㄱㄷㅇ), 구단 이름(KIA)
@MainActor
struct PlayerSearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results: [Player] = []
    @State private var searching = false
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted)
                    TextField("선수 이름, 초성(ㄱㄷㅇ), 구단", text: $query)
                        .focused($focused)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted) }
                            .accessibilityLabel("지우기")
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .glassCapsule()

                if query.isEmpty {
                    if !model.favorites.isEmpty {
                        SectionHeader(title: "관심 선수")
                        ForEach(model.favorites, id: \.key) { fav in
                            FavoriteRow(favorite: fav)
                        }
                    } else {
                        Text("응원하는 선수를 찾아 ★ 를 누르면 타석 결과와 등판·강판을 알려드려요.")
                            .font(.subheadline)
                            .foregroundStyle(Palette.muted)
                            .padding(.top, 8)
                    }
                } else if results.isEmpty && !searching {
                    MessageView(title: "찾는 선수가 없어요", detail: "이름 일부나 초성으로도 찾을 수 있어요.", systemImage: "person.fill.questionmark")
                        .padding(.top, 30)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.element.id) { i, p in
                            PlayerRow(player: p)
                                .appearIn(i)
                            Divider().overlay(Palette.surfaceHigh)
                        }
                    }
                    .glassCard(20)
                }
            }
            .padding(16)
        }
        .scrollIndicators(.hidden)
        .tabBarSpace()
        .background(AppBackground())
        .navigationTitle("선수 검색")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { results = []; return }
            searching = true
            try? await Task.sleep(for: .milliseconds(250)) // 입력이 멈추면 검색
            if Task.isCancelled { return }
            results = (try? await APIClient().searchPlayers(q).players) ?? []
            searching = false
        }
    }
}

struct PlayerRow: View {
    let player: Player

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.player(player.id)) {
                HStack(spacing: 12) {
                    PlayerAvatar(url: player.photo, name: player.name, team: player.team, size: 46)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(player.name).font(.system(size: 16, weight: .bold))
                        HStack(spacing: 5) {
                            TeamBadge(code: player.team, size: 16)
                            Text("\(Team.find(player.team)?.short ?? player.team) · \(player.roleLabel)")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            FavoriteStar(favorite: player.favorite)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

struct FavoriteRow: View {
    let favorite: FavoritePlayer
    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(url: favorite.photo, name: favorite.name, team: favorite.team, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(favorite.name).font(.system(size: 16, weight: .bold))
                HStack(spacing: 5) {
                    TeamBadge(code: favorite.team, size: 16)
                    Text(Team.find(favorite.team)?.name ?? favorite.team).font(.caption).foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            FavoriteStar(favorite: favorite)
        }
        .padding(12)
        .glassCard(18)
    }
}

/// ★ 관심 선수 켜고 끄기
struct FavoriteStar: View {
    @Environment(AppModel.self) private var model
    let favorite: FavoritePlayer

    var body: some View {
        let on = model.isFavorite(team: favorite.team, name: favorite.name)
        Button {
            withAnimation(.snappy) { model.toggleFavorite(favorite) }
        } label: {
            Image(systemName: on ? "star.fill" : "star")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(on ? Palette.accent : Palette.muted)
                .frame(width: 44, height: 44)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: on)   // 누르면 별이 통 튄다
        }
        .buttonStyle(.plain)
        .accessibilityLabel(on ? "관심 선수에서 빼기" : "관심 선수로 추가")
    }
}

/// 선수 상세: 사진·구단·번호, 관심 선수 버튼, 시즌 기록
@MainActor
struct PlayerDetailView: View {
    @Environment(AppModel.self) private var model
    let playerId: String
    @State private var player: Player?
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let p = player {
                VStack(spacing: 16) {
                    header(p)
                        .appearIn(0)
                    statsGrid(p)
                        .appearIn(2)
                    Text("\(String(KST.dayString(Date()).prefix(4))) 정규시즌 기록 · 네이버 스포츠")
                        .font(.caption)
                        .foregroundStyle(Palette.muted)
                }
                .padding(16)
            } else if let error {
                MessageView(title: "선수 정보를 불러오지 못했어요", detail: error, systemImage: "wifi.exclamationmark")
                    .padding(.top, 60)
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .scrollIndicators(.hidden)
        .tabBarSpace()
        .background(AppBackground())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { player = try await APIClient().player(id: playerId) } catch { self.error = error.localizedDescription }
        }
    }

    private func header(_ p: Player) -> some View {
        let team = Team.find(p.team)
        let on = model.isFavorite(team: p.team, name: p.name)
        return VStack(spacing: 12) {
            PlayerAvatar(url: p.photo, name: p.name, team: p.team, size: 112)
            Text(p.name).font(.system(size: 28, weight: .heavy))
            HStack(spacing: 6) {
                TeamBadge(code: p.team, size: 22)
                Text("\(team?.name ?? p.team) · \(p.roleLabel)").font(.subheadline).foregroundStyle(Palette.text.opacity(0.8))
            }
            Button { withAnimation(.snappy) { model.toggleFavorite(p.favorite) } } label: {
                Label(on ? "관심 선수" : "관심 선수로 추가", systemImage: on ? "star.fill" : "star")
                    .font(.system(size: 15, weight: .bold))
                    .padding(.horizontal, 20)
                    .frame(height: 44)
                    .foregroundStyle(on ? Color.black : Palette.text)
                    .background(on ? Palette.accent : Palette.surfaceHigh, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(TeamGlow(colors: [team?.color ?? Palette.accent]))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private func statsGrid(_ p: Player) -> some View {
        let s = p.stats
        let items: [(String, String)] = p.isPitcher
            ? [("WAR", StatFormat.fixed(s.war)), ("평균자책", StatFormat.fixed(s.era)), ("승", StatFormat.int(s.wins)),
               ("패", StatFormat.int(s.losses)), ("세이브", StatFormat.int(s.saves)), ("홀드", StatFormat.int(s.holds)),
               ("이닝", s.innings ?? "-"), ("탈삼진", StatFormat.int(s.so)), ("WHIP", StatFormat.fixed(s.whip))]
            : [("WAR", StatFormat.fixed(s.war)), ("타율", StatFormat.rate(s.avg)), ("홈런", StatFormat.int(s.hr)),
               ("타점", StatFormat.int(s.rbi)), ("안타", StatFormat.int(s.hits)), ("득점", StatFormat.int(s.runs)),
               ("도루", StatFormat.int(s.sb)), ("출루율", StatFormat.rate(s.obp)), ("OPS", StatFormat.rate(s.ops))]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
            ForEach(items.indices, id: \.self) { i in
                VStack(spacing: 6) {
                    Text(items[i].0).font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                    Text(items[i].1)
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                        .foregroundStyle(i == 0 ? Palette.accent : Palette.text)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity)
                .frame(height: 78)
                .glassCard(18)
            }
        }
    }
}
