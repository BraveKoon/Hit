import SwiftUI

/// KBO 10개 구단. 코드는 네이버·KBO 구단 코드 (SK=SSG, OB=두산, HT=KIA, WO=키움, LT=롯데, HH=한화).
struct Team: Identifiable, Hashable {
    let code: String
    let short: String
    let name: String
    let colorHex: UInt32
    let home: String
    var id: String { code }
    var color: Color { Color(hex: colorHex) }
    /// 네이버 스포츠 구단 엠블럼
    var logoURL: URL? { URL(string: "https://sports-phinf.pstatic.net/team/kbo/default/\(code).png?type=f92_88") }

    static let all: [Team] = [
        Team(code: "LG", short: "LG", name: "LG 트윈스", colorHex: 0xC30452, home: "잠실"),
        Team(code: "HH", short: "한화", name: "한화 이글스", colorHex: 0xFC4E00, home: "대전"),
        Team(code: "SK", short: "SSG", name: "SSG 랜더스", colorHex: 0xCE0E2D, home: "인천"),
        Team(code: "SS", short: "삼성", name: "삼성 라이온즈", colorHex: 0x074CA1, home: "대구"),
        Team(code: "NC", short: "NC", name: "NC 다이노스", colorHex: 0x315288, home: "창원"),
        Team(code: "KT", short: "KT", name: "KT 위즈", colorHex: 0x2B2B2B, home: "수원"),
        Team(code: "LT", short: "롯데", name: "롯데 자이언츠", colorHex: 0x0A2F6B, home: "사직"),
        Team(code: "HT", short: "KIA", name: "KIA 타이거즈", colorHex: 0xEA0029, home: "광주"),
        Team(code: "OB", short: "두산", name: "두산 베어스", colorHex: 0x1A1A3C, home: "잠실"),
        Team(code: "WO", short: "키움", name: "키움 히어로즈", colorHex: 0x7A1028, home: "고척"),
    ]

    static func find(_ code: String?) -> Team? {
        guard let code else { return nil }
        return all.first { $0.code == code }
    }

    /// 모르는 코드면 강조색.
    static func color(for code: String?) -> Color { find(code)?.color ?? Palette.accent }
}

/// 구단 엠블럼. 앱이 받아 둔 엠블럼이 있으면 그대로, 없으면 구단 색 배지에 이름.
/// (위젯·잠금화면은 그리면서 이미지를 내려받을 수 없어서, 앱이 App Group 에 저장해 둔 것을 쓴다)
struct TeamBadge: View {
    let code: String
    var label: String? = nil
    var size: CGFloat = 30

    var body: some View {
        let team = Team.find(code)
        if label == nil, let logo = LogoStore.shared.image(for: code) {
            // 엠블럼은 배경이 투명해서 검정 바탕에 그대로 올린다
            Image(uiImage: logo)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .accessibilityLabel(team?.name ?? code)
        } else {
            fallback(team)
        }
    }

    private func fallback(_ team: Team?) -> some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(team?.color ?? Palette.surfaceHigh)
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                    .strokeBorder(.white.opacity(0.14), lineWidth: 1)
            )
            .overlay(
                Text(label ?? team?.short ?? "?")
                    .font(.system(size: size * 0.32, weight: .bold))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 2)
            )
            .frame(width: size, height: size)
            .accessibilityLabel(team?.name ?? code)
    }
}
