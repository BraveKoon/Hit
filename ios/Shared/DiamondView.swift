import SwiftUI

/// 내야 다이아몬드: 주자(1·2·3루)와 아웃카운트.
struct DiamondView: View {
    var bases: [Bool]
    var outs: Int
    var showOuts = true

    private func on(_ i: Int) -> Bool { bases.indices.contains(i) && bases[i] }

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { geo in
                let s = min(geo.size.width, geo.size.height)
                let b = s * 0.26
                ZStack {
                    base(on: on(1), size: b).position(x: s / 2, y: b * 0.75)          // 2루
                    base(on: on(2), size: b).position(x: b * 0.75, y: s / 2)          // 3루
                    base(on: on(0), size: b).position(x: s - b * 0.75, y: s / 2)      // 1루
                }
                .frame(width: s, height: s)
            }
            .aspectRatio(1, contentMode: .fit)
            if showOuts {
                HStack(spacing: 3) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle()
                            .fill(i < outs ? Palette.red : Color.clear)
                            .overlay(Circle().strokeBorder(i < outs ? Palette.red : Palette.line, lineWidth: 1))
                            .frame(width: 6, height: 6)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(outs)아웃, " + (bases.contains(true) ? "주자 " + [0, 1, 2].filter(on).map { "\($0 + 1)루" }.joined(separator: " ") : "주자 없음"))
    }

    private func base(on: Bool, size: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(on ? Palette.amber : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(on ? Palette.amber : Palette.muted.opacity(0.6), lineWidth: 1.4))
            .frame(width: size, height: size)
            .rotationEffect(.degrees(45))
    }
}
