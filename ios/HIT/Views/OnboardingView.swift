import SwiftUI

/// 가입 직후: 응원 팀 → 알림 허용
@MainActor
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var step = 0
    @State private var picked: String?
    private var auth: AuthManager { AuthManager.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            progress
            if step == 0 { teamStep } else { notificationStep }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AppBackground())
        .onAppear { picked = picked ?? model.myTeam }
    }

    private var progress: some View {
        HStack(spacing: 6) {
            ForEach(0..<2, id: \.self) { i in
                Capsule().fill(i <= step ? Palette.amber : Palette.surfaceHigh).frame(height: 4)
            }
        }
        .padding(.vertical, 16)
    }

    private var teamStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(auth.displayName)님,\n어느 팀을 응원하세요?")
                .font(.system(size: 26, weight: .heavy))
                .lineSpacing(3)
            Text("내 팀 경기를 중심으로 보여드리고 알림을 보내드려요.")
                .font(.subheadline)
                .foregroundStyle(Palette.muted)
                .padding(.top, 8)
                .padding(.bottom, 18)
            ScrollView {
                TeamPicker(selected: picked) { picked = $0 }
                    .padding(.bottom, 12)
            }
            .scrollIndicators(.hidden)
            Button {
                if let picked { model.setTeam(picked) }
                withAnimation { step = 1 }
            } label: {
                Text(picked.flatMap { Team.find($0)?.name }.map { "\($0) 응원하기" } ?? "팀을 골라 주세요")
            }
            .buttonStyle(PrimaryButtonStyle(fill: Team.find(picked)?.color ?? Palette.amber, text: picked == nil ? .black : .white))
            .disabled(picked == nil)
        }
    }

    private var notificationStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("중요한 순간을\n놓치지 않게")
                .font(.system(size: 26, weight: .heavy))
                .lineSpacing(3)
            Text("잠금화면에 이렇게 알려드려요.")
                .font(.subheadline)
                .foregroundStyle(Palette.muted)
                .padding(.top, 8)

            VStack(spacing: 10) {
                SampleNotification(title: "역전! KIA 1 : 2 삼성", subtitle: "삼성 득점", text: "3회말 · 구자욱 : 중견수 앞 1루타", ago: "지금")
                SampleNotification(title: "홈런! KIA 2 : 8 삼성", subtitle: "삼성 득점", text: "7회말 · 최형우 : 우측 담장 넘어가는 홈런", ago: "12분 전")
                    .opacity(0.75)
                    .scaleEffect(0.96)
            }
            .padding(.vertical, 26)

            Label("경기 중엔 잠금화면에 실시간 점수판이 떠요", systemImage: "lock.iphone")
                .font(.subheadline)
            Label("알림 종류는 MY에서 하나씩 끄고 켤 수 있어요", systemImage: "slider.horizontal.3")
                .font(.subheadline)
                .padding(.top, 10)
            Spacer()
            Button("알림 받기") {
                Task {
                    await PushRegistrar.shared.requestPermission()
                    model.finishOnboarding()
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("나중에") { model.finishOnboarding() }
                .font(.subheadline)
                .foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
        }
        .foregroundStyle(Palette.text)
    }
}

/// 온보딩에서 보여주는 알림 예시 (iOS 알림 모양)
struct SampleNotification: View {
    let title: String
    let subtitle: String
    let text: String
    let ago: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Palette.amber)
                .frame(width: 36, height: 36)
                .overlay(LogoMark(height: 10, color: .black))
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(title).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(ago).font(.caption2).foregroundStyle(Palette.muted)
                }
                Text(subtitle).font(.caption.weight(.semibold))
                Text(text).font(.caption).foregroundStyle(Palette.text.opacity(0.8))
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}
