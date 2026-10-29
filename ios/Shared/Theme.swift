import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

/// 검정 바탕 + 회색 카드 + 강조색 하나. 앱은 항상 다크로 그린다.
enum Palette {
    static let background = Color.black
    static let surface = Color(hex: 0x1C1C1E)
    static let surfaceHigh = Color(hex: 0x2C2C2E)
    static let line = Color(hex: 0x2C2C2E)
    static let text = Color.white
    static let muted = Color(hex: 0x8E8E93)
    /// 강조색 (탠저린). 바꾸고 싶으면 여기 한 줄과 Assets 의 AccentColor
    static let accent = Color(hex: 0xFF8A4C)
    static let live = Color(hex: 0x36D583)
    static let red = Color(hex: 0xE2544A)
    static let clay = Color(hex: 0xB4512F)    // 내야 흙
}

/// HIT! 로고. 템플릿 이미지라 foregroundStyle 로 색을 바꾼다.
struct LogoMark: View {
    var height: CGFloat = 24
    var color: Color = Palette.text

    var body: some View {
        Image("Logo")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .frame(height: height)
            .foregroundStyle(color)
            .accessibilityLabel("HIT")
    }
}

/// 글꼴: Pretendard (SIL OFL 1.1, Shared/Fonts). 자주 쓰는 한글 2,350자 + 라틴 묶음이라 없는 글자는 iOS 가 시스템 글꼴로 채운다.
/// 굵기마다 파일이 따로라 Font.weight 대신 여기서 파일을 고른다. 아주 굵은 heavy 는 Bold 로 한 단계 낮춰 단정하게.
enum Typo {
    /// 크기를 정해 쓰는 글자 (점수·배지). 예전 .system(size:) 처럼 글자 크기 설정에 따라 커지지 않는다.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle? = nil) -> Font {
        if let style { return .custom(name(weight), size: size, relativeTo: style) }
        return .custom(name(weight), fixedSize: size)
    }

    /// iOS 글자 크기 단계(본문·제목…)는 그대로 따르면서 글꼴만 Pretendard 로
    static func style(_ style: Font.TextStyle, _ weight: Font.Weight? = nil) -> Font {
        font(size(of: style), weight ?? (style == .headline ? .semibold : .regular), relativeTo: style)
    }

    /// 점수: 굵게, 숫자 폭 고정 (바뀌어도 흔들리지 않게)
    static func score(_ size: CGFloat) -> Font { font(size, .bold).monospacedDigit() }

    private static func name(_ w: Font.Weight) -> String {
        switch w {
        case .black: "Pretendard-ExtraBold"
        case .heavy, .bold: "Pretendard-Bold"
        case .semibold: "Pretendard-SemiBold"
        case .medium: "Pretendard-Medium"
        default: "Pretendard-Regular"
        }
    }

    private static func size(of style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        default: 17
        }
    }
}
