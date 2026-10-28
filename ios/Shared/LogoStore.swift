import SwiftUI
import UIKit

/// 구단 엠블럼 저장소. 앱이 실행될 때 10개 구단 엠블럼을 내려받아 작게 줄여 App Group 폴더에 둔다.
/// 앱·위젯·라이브 액티비티가 모두 여기서 읽는다.
@MainActor
@Observable
final class LogoStore {
    static let shared = LogoStore()

    private(set) var version = 0
    @ObservationIgnored private var memory: [String: UIImage] = [:]

    private init() {}

    private var directory: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SharedSettings.groupID)?
            .appendingPathComponent("logos", isDirectory: true)
    }

    func image(for code: String) -> UIImage? {
        _ = version // 새로 받으면 다시 그리도록
        if let cached = memory[code] { return cached }
        guard let dir = directory,
              let image = UIImage(contentsOfFile: dir.appendingPathComponent("\(code).png").path) else { return nil }
        memory[code] = image
        return image
    }

    /// 일주일에 한 번만 새로 받는다.
    func prefetch() async {
        guard let dir = directory else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var changed = false
        for team in Team.all {
            let file = dir.appendingPathComponent("\(team.code).png")
            if let modified = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date,
               Date().timeIntervalSince(modified) < 7 * 86400 { continue }
            guard let url = team.logoURL,
                  let result = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: result.0),
                  let png = image.resized(maxSide: 96).pngData() else { continue }
            if (try? png.write(to: file, options: .atomic)) != nil { changed = true }
        }
        if changed {
            memory = [:]
            version += 1
        }
    }
}

extension UIImage {
    /// 라이브 액티비티 용량 제한 안에 들도록 작게
    func resized(maxSide: CGFloat) -> UIImage {
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
