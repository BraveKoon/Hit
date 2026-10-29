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

enum Typo {
    static func score(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .monospaced) }
    static let mono = Font.system(.caption, design: .monospaced)
}
