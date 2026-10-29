import PhotosUI
import SwiftUI

/// 커뮤니티: 카페처럼 팀 게시판. 목록은 제목 · 팀/선수 칩 · 몇 분 전 · 댓글·좋아요, 사진이 있으면 오른쪽 썸네일.
/// 읽기는 누구나, 쓰기·댓글·좋아요는 로그인. 욕설·광고는 서버가 막고, 신고 3번이면 숨겨진다.
@MainActor
struct CommunityView: View {
    @Environment(AppModel.self) private var model
    @State private var board = ""            // "" = 전체, 아니면 팀 코드
    @State private var posts: [CommunityPost] = []
    @State private var next: Int?
    @State private var loading = false
    @State private var failed = false
    @State private var writing = false
    private var auth: AuthManager { AuthManager.shared }

    private var boards: [(String, String)] {
        let mine = model.myTeam.flatMap(Team.find)
        let others = Team.all.filter { $0.code != mine?.code }
        return [("", "전체")] + (mine.map { [($0.code, $0.short)] } ?? []) + others.map { ($0.code, $0.short) }
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.communityPath) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    AppHeader(title: "커뮤니티") { model.communityPath.append(.search) }
                        .padding(.bottom, 14)
                    PillChips(items: boards, selection: $board)
                        .padding(.bottom, 12)
                    if posts.isEmpty {
                        emptyState
                    }
                    ForEach(posts) { p in
                        NavigationLink(value: Route.post(p.id)) { PostRow(post: p) }
                            .buttonStyle(.press)
                            .onAppear { if p.id == posts.last?.id { Task { await load(more: true) } } }
                        Divider().overlay(.white.opacity(0.06))
                    }
                    if loading && !posts.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding()
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .tabBarSpace()
            .background(AppBackground())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { RouteView(route: $0) }
            .overlay(alignment: .bottomTrailing) { writeButton }
            .refreshable { await load() }
            .task(id: board) { await load() }
            .sheet(isPresented: $writing) {
                PostEditor(team: board.isEmpty ? (model.myTeam ?? "LG") : board) { new in
                    posts.insert(new, at: 0)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            if loading {
                SkeletonList(hero: 0, rows: 4)
            } else {
                Image(systemName: failed ? "wifi.exclamationmark" : "text.bubble").font(.system(size: 30)).foregroundStyle(Palette.muted)
                Text(failed ? "글을 불러오지 못했어요" : "아직 글이 없어요. 첫 글을 남겨 보세요")
                    .font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
            }
        }
        .frame(maxWidth: .infinity).padding(.top, loading ? 4 : 80)
    }

    private var writeButton: some View {
        Button {
            writing = true
        } label: {
            Label("글쓰기", systemImage: "square.and.pencil")
                .font(Typo.font(16, .bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 18).frame(height: 50)
                .background(Palette.accent, in: Capsule())
                .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
        }
        .disabled(auth.state != .signedIn)
        .opacity(auth.state == .signedIn ? 1 : 0)
        .padding(.trailing, 18)
        .padding(.bottom, 92)
    }

    private func load(more: Bool = false) async {
        if more && (next == nil || loading) { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient().posts(team: board.isEmpty ? nil : board, before: more ? next : nil)
            posts = more ? posts + r.posts : r.posts
            next = r.next
            failed = false
        } catch {
            if !more { failed = true }
        }
    }
}

/// 목록 한 줄: 제목(2줄) → 칩 · 닉네임 · 시간 · 댓글 · 좋아요, 오른쪽에 사진
struct PostRow: View {
    let post: CommunityPost

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 7) {
                Text(post.title)
                    .font(Typo.style(.body, .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let preview = post.preview, !preview.isEmpty {
                    Text(preview).font(Typo.style(.footnote)).foregroundStyle(Palette.muted).lineLimit(1)
                }
                HStack(spacing: 6) {
                    BoardChip(team: post.team, player: post.player)
                    Text(post.nickname).lineLimit(1)
                    Text("·")
                    Text(TimeAgo.string(post.at))
                    Spacer(minLength: 0)
                    Label("\(post.comments)", systemImage: "bubble.right").labelStyle(CompactLabel())
                    Label("\(post.likes)", systemImage: post.liked ? "heart.fill" : "heart").labelStyle(CompactLabel())
                        .foregroundStyle(post.liked ? Palette.accent : Palette.muted)
                }
                .font(Typo.style(.caption))
                .foregroundStyle(Palette.muted)
            }
            if let url = post.imageURL {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Palette.surfaceHigh
                }
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

/// 팀 칩 (선수 태그가 있으면 "삼성 · 디아즈")
struct BoardChip: View {
    let team: String
    var player: String? = nil

    var body: some View {
        let t = Team.find(team)
        Text([t?.short ?? team, player].compactMap { $0 }.joined(separator: " · "))
            .font(Typo.font(11, .bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Team.color(for: team).opacity(0.9), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .fixedSize()
    }
}

private struct CompactLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) { configuration.icon.imageScale(.small); configuration.title }
    }
}

/// "방금", "5분 전", "3시간 전", "어제", "10.27"
enum TimeAgo {
    static func string(_ iso: String, now: Date = .now) -> String {
        guard let d = ISO8601DateFormatter.fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let s = Int(now.timeIntervalSince(d))
        if s < 60 { return "방금" }
        if s < 3600 { return "\(s / 60)분 전" }
        if s < 86_400 { return "\(s / 3600)시간 전" }
        if s < 2 * 86_400 { return "어제" }
        let f = DateFormatter()
        f.timeZone = KST.zone
        f.dateFormat = "M.d"
        return f.string(from: d)
    }
}

// MARK: - 글 보기

@MainActor
struct PostDetailView: View {
    let postId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var post: CommunityPost?
    @State private var missing = false
    @State private var text = ""
    @State private var sending = false
    @State private var notice: String?
    @State private var hidden: Set<Int> = []
    @State private var confirmDelete = false
    private var canWrite: Bool { AuthManager.shared.state == .signedIn }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let post {
                    content(post)
                } else if missing {
                    MessageView(title: "볼 수 없는 글이에요", detail: "지워졌거나 신고로 가려졌어요", systemImage: "eye.slash").padding(.top, 80)
                } else {
                    ProgressView().padding(.top, 80)
                }
            }
            .scrollIndicators(.hidden)
            if post != nil { composer }
        }
        .background(AppBackground())
        .navigationTitle(Team.find(post?.team)?.short ?? "커뮤니티")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let post, canWrite {
                Menu {
                    if post.mine {
                        Button(role: .destructive) { confirmDelete = true } label: { Label("글 지우기", systemImage: "trash") }
                    } else {
                        Button(role: .destructive) { reportPost(post) } label: { Label("신고하기", systemImage: "exclamationmark.bubble") }
                    }
                } label: { Image(systemName: "ellipsis") }
            }
        }
        .confirmationDialog("이 글을 지울까요?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("지우기", role: .destructive) { deletePost() }
        }
        .task(id: postId) { await load() }
    }

    private func content(_ p: CommunityPost) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            BoardChip(team: p.team, player: p.player)
            Text(p.title).font(Typo.style(.title2, .bold))
            HStack(spacing: 8) {
                if let t = p.authorTeam { TeamBadge(code: t, size: 22) } else { Circle().fill(Palette.surfaceHigh).frame(width: 22, height: 22) }
                Text(p.nickname).font(Typo.style(.subheadline, .semibold))
                Text(TimeAgo.string(p.at)).font(Typo.style(.caption)).foregroundStyle(Palette.muted)
            }
            Divider().overlay(.white.opacity(0.08))
            if let body = p.body, !body.isEmpty {
                Text(body).font(Typo.style(.body)).lineSpacing(4).textSelection(.enabled)
            }
            if let url = p.imageURL {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    Palette.surfaceHigh.frame(height: 220)
                }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            HStack(spacing: 10) {
                Button { toggleLike(p) } label: {
                    Label("\(p.likes)", systemImage: p.liked ? "heart.fill" : "heart")
                        .font(Typo.style(.subheadline, .semibold))
                        .foregroundStyle(p.liked ? Palette.accent : Palette.text)
                        .padding(.horizontal, 16).frame(height: 38)
                        .overlay(Capsule().strokeBorder(p.liked ? Palette.accent : Palette.surfaceHigh, lineWidth: 1.5))
                }
                .buttonStyle(.press)
                .disabled(!canWrite)
                .sensoryFeedback(.impact(weight: .light), trigger: p.liked)
                Label("\(p.comments)", systemImage: "bubble.right").font(Typo.style(.subheadline)).foregroundStyle(Palette.muted)
            }
            .padding(.top, 4)
            SectionHeader(title: "댓글", detail: "\(p.comments)")
            ForEach((p.replies ?? []).filter { !hidden.contains($0.id) }) { c in
                commentRow(c)
            }
            if (p.replies ?? []).isEmpty {
                Text("첫 댓글을 남겨 보세요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
            }
        }
        .padding(16)
    }

    private func commentRow(_ c: PostComment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if let t = c.team { TeamBadge(code: t, size: 26) } else { Circle().fill(Palette.surfaceHigh).frame(width: 26, height: 26) }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(c.nickname).font(Typo.style(.caption, .semibold))
                    Text(TimeAgo.string(c.at)).font(Typo.style(.caption2)).foregroundStyle(Palette.muted)
                }
                Text(c.text).font(Typo.style(.subheadline))
            }
            Spacer(minLength: 0)
        }
        .contextMenu {
            if canWrite && !c.mine {
                Button(role: .destructive) {
                    hidden.insert(c.id)
                    Task { try? await APIClient().reportComment(id: c.id) }
                } label: { Label("신고하기", systemImage: "exclamationmark.bubble") }
            }
            Button { hidden.insert(c.id) } label: { Label("이 댓글 가리기", systemImage: "eye.slash") }
        }
    }

    private var composer: some View {
        VStack(spacing: 4) {
            if let notice {
                Text(notice).font(Typo.style(.caption)).foregroundStyle(Palette.red).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 10) {
                if canWrite {
                    TextField("댓글 (300자)", text: $text, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    Button(action: sendComment) {
                        Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.black)
                            .frame(width: 40, height: 40)
                            .background(Palette.accent.opacity(text.trimmingCharacters(in: .whitespaces).isEmpty ? 0.35 : 1), in: Circle())
                    }
                    .disabled(sending || text.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel("댓글 달기")
                } else {
                    Text("로그인하면 댓글을 달 수 있어요").font(Typo.style(.footnote)).foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private func load() async {
        do {
            post = try await APIClient().post(id: postId)
        } catch let e as APIError where e.status == 404 {
            missing = true
        } catch {
            notice = error.localizedDescription
        }
    }

    private func toggleLike(_ p: CommunityPost) {
        let on = !p.liked
        post?.liked = on
        post?.likes += on ? 1 : -1
        Task {
            if let r = try? await APIClient().likePost(id: p.id, on: on) {
                post?.likes = r.likes
                post?.liked = r.liked
            }
        }
    }

    private func sendComment() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sending = true
        Task {
            defer { sending = false }
            do {
                let c = try await APIClient().comment(postId: postId, text: body)
                post?.replies = (post?.replies ?? []) + [c]
                post?.comments += 1
                text = ""
                notice = nil
            } catch {
                notice = error.localizedDescription
            }
        }
    }

    private func reportPost(_ p: CommunityPost) {
        Task {
            try? await APIClient().reportPost(id: p.id)
            dismiss()
        }
    }

    private func deletePost() {
        Task {
            do {
                try await APIClient().deletePost(id: postId)
                dismiss()
            } catch {
                notice = error.localizedDescription
            }
        }
    }
}

// MARK: - 글쓰기

@MainActor
struct PostEditor: View {
    @State var team: String
    var onPosted: (CommunityPost) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var player = ""
    @State private var pick: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var sending = false
    @State private var notice: String?

    private var ready: Bool { title.trimmingCharacters(in: .whitespaces).count >= 2 && !sending }

    var body: some View {
        NavigationStack {
            Form {
                Section("게시판") {
                    Picker("팀", selection: $team) {
                        ForEach(Team.all) { t in Text(t.short).tag(t.code) }
                    }
                    TextField("선수 태그 (선택)", text: $player)
                }
                Section {
                    TextField("제목", text: $title)
                        .font(Typo.style(.headline))
                    TextField("내용 (2000자)", text: $text, axis: .vertical)
                        .lineLimit(6...14)
                }
                Section {
                    PhotosPicker(selection: $pick, matching: .images) {
                        Label(photo == nil ? "사진 추가" : "사진 바꾸기", systemImage: "photo")
                    }
                    if let photo {
                        Image(uiImage: photo).resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(alignment: .topTrailing) {
                                Button { self.photo = nil; pick = nil } label: {
                                    Image(systemName: "xmark.circle.fill").font(.title2).foregroundStyle(.white, .black.opacity(0.6))
                                }
                                .padding(6)
                            }
                    }
                } footer: {
                    Text("욕설·비하·광고는 자동으로 막히고, 신고가 3번 쌓이면 글이 가려져요.")
                }
                if let notice {
                    Text(notice).foregroundStyle(Palette.red).font(Typo.style(.footnote))
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppBackground())
            .navigationTitle("글쓰기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "올리는 중" : "올리기", action: submit).disabled(!ready)
                }
            }
            .onChange(of: pick) { _, item in
                Task {
                    if let data = try? await item?.loadTransferable(type: Data.self) { photo = UIImage(data: data) }
                }
            }
        }
        .environment(\.colorScheme, .dark)
    }

    private func submit() {
        sending = true
        Task {
            defer { sending = false }
            do {
                let p = try await APIClient().writePost(
                    team: team, title: title, body: text,
                    player: player.trimmingCharacters(in: .whitespaces).isEmpty ? nil : player,
                    image: photo.flatMap(Self.compress))
                onPosted(p)
                dismiss()
            } catch {
                notice = error.localizedDescription
            }
        }
    }

    /// 긴 변 1080px, JPEG 0.7 (2MB 넘으면 더 낮춘다)
    static func compress(_ image: UIImage) -> Data? {
        let scale = min(1, 1080 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for q in [0.7, 0.5, 0.3] {
            if let d = resized.jpegData(compressionQuality: q), d.count < 2 * 1024 * 1024 { return d }
        }
        return nil
    }
}
