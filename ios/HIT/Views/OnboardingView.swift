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
                Capsule().fill(i <= step ? Palette.accent : Palette.surfaceHigh).frame(height: 4)
            }
        }
        .padding(.vertical, 16)
    }

    private var teamStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(auth.displayName)님,\n어느 팀을 응원하세요?")
                .font(.system(size: 26, weight: .heavy))
                .lineSpacing(3)
                .padding(.bottom, 20)
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
            .buttonStyle(PrimaryButtonStyle(fill: Team.find(picked)?.color ?? Palette.accent, text: picked == nil ? .black : .white))
            .disabled(picked == nil)
        }
    }

    private var notificationStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("중요한 순간을\n놓치지 않게")
                .font(.system(size: 26, weight: .heavy))
                .lineSpacing(3)
            Text("득점·홈런·경기 결과를 잠금화면으로 알려드려요.\n알림 종류는 MY에서 언제든 바꿀 수 있어요.")
                .font(.subheadline)
                .foregroundStyle(Palette.muted)
                .lineSpacing(2)
                .padding(.top, 8)

            Spacer()
            SampleNotification(title: "역전! KIA 1 : 2 삼성", subtitle: "삼성 득점", text: "3회말 · 구자욱 : 중견수 앞 1루타", ago: "지금")
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
                .fill(Palette.accent)
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
