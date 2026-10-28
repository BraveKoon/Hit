import AuthenticationServices
import SwiftUI

/// 첫 화면: 가입과 로그인이 한 화면 (처음이면 가입, 아니면 로그인)
@MainActor
struct AuthView: View {
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false   // 로고 → 문구 → 버튼 순서로 떠오른다
    private var auth: AuthManager { AuthManager.shared }

    private func rise(_ step: Double) -> some ViewModifier { Rise(on: appeared || reduceMotion, delay: step * 0.12) }

    var body: some View {
        ZStack {
            background
            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                LogoMark(height: 58, color: Palette.text)
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.8, anchor: .leading)
                    .modifier(rise(0))
                    .padding(.bottom, 26)
                Text("내 팀의 모든 순간,\n잠금화면에서.")
                    .font(.system(size: 32, weight: .heavy))
                    .lineSpacing(4)
                    .foregroundStyle(Palette.text)
                    .modifier(rise(1))
                Text("경기 시작부터 득점, 역전, 끝내기까지.\nKBO 10개 구단 실시간 알림.")
                    .font(.callout)
                    .foregroundStyle(Palette.muted)
                    .padding(.top, 12)
                    .modifier(rise(2))
                Spacer()
                Spacer()

                VStack(spacing: 10) {
                    SignInWithAppleButton(.continue) { request in
                        auth.configure(request)
                    } onCompletion: { result in
                        Task { await auth.handleApple(result) }
                    }
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 54)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                    Button {
                        Task { await auth.signInWithKakao(using: webAuthenticationSession) }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "message.fill")
                            Text("카카오로 계속하기")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(fill: Color(hex: 0xFEE500), text: .black.opacity(0.85)))

                    Button("로그인 없이 둘러보기") { auth.continueAsGuest() }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Palette.muted)
                        .padding(.top, 6)
                }
                .modifier(rise(3))
                .disabled(auth.busy)
                .overlay { if auth.busy { ProgressView().tint(Palette.amber) } }

                if let error = auth.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Palette.red)
                        .padding(.top, 10)
                        .frame(maxWidth: .infinity)
                }

                Text("계속하면 HIT 이용약관과 개인정보 처리방침에 동의하게 됩니다.\n로그인하면 응원 팀과 알림 설정이 모든 기기에 저장돼요.")
                    .font(.caption2)
                    .foregroundStyle(Palette.muted.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 18)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
        }
        .onAppear { appeared = true }
    }

    /// 야간 경기 조명이 위에서 번지는 느낌
    private var background: some View {
        ZStack {
            Palette.background
            RadialGradient(colors: [Palette.amber.opacity(0.28), .clear], center: .init(x: 0.85, y: -0.05), startRadius: 10, endRadius: 420)
            RadialGradient(colors: [Palette.live.opacity(0.10), .clear], center: .init(x: 0.1, y: 1.1), startRadius: 10, endRadius: 380)
        }
        .ignoresSafeArea()
    }
}

private struct Rise: ViewModifier {
    let on: Bool
    let delay: Double
    func body(content: Content) -> some View {
        content
            .opacity(on ? 1 : 0)
            .offset(y: on ? 0 : 22)
            .animation(.spring(response: 0.7, dampingFraction: 0.82).delay(delay), value: on)
    }
}
