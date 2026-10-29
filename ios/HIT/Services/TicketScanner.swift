import UIKit
import Vision

/// 티켓 사진(종이 티켓, 예매 앱 캡처)에서 글자와 바코드를 읽어 이 경기 티켓인지 본다.
/// 사진은 휴대폰 안에서만 읽고, 서버에는 예매번호(또는 바코드 값)만 보낸다. 서버는 그 지문만 저장한다.
enum TicketScanner {
    struct Scan {
        var lines: [String]
        var codes: [String]
    }

    enum Verdict: Equatable {
        case ok(ticket: String)
        case mismatch(String)   // 사람에게 보여 줄 이유
    }

    static func scan(_ image: UIImage) async throws -> Scan {
        guard let cg = image.cgImage else { return Scan(lines: [], codes: []) }
        return try await Task.detached(priority: .userInitiated) {
            let text = VNRecognizeTextRequest()
            text.recognitionLevel = .accurate
            text.recognitionLanguages = ["ko-KR", "en-US"]
            text.usesLanguageCorrection = false
            let codes = VNDetectBarcodesRequest()
            try VNImageRequestHandler(cgImage: cg, orientation: .init(image.imageOrientation)).perform([text, codes])
            let lines = (text.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            let payloads = (codes.results ?? []).compactMap(\.payloadStringValue)
            return Scan(lines: lines, codes: payloads)
        }.value
    }

    /// 날짜가 맞고, 구장 이름이나 두 팀 이름이 보이고, 예매번호·바코드를 읽었으면 통과
    static func check(_ scan: Scan, game: Game) -> Verdict {
        let compact = scan.lines.joined(separator: " ").replacingOccurrences(of: " ", with: "")
        guard matchesDate(compact, game.date) else {
            return .mismatch("티켓에서 경기 날짜(\(game.date.map { KST.ticketDate($0) } ?? ""))를 찾지 못했어요")
        }
        let upper = compact.uppercased()
        let stadium = stadiumWords(game.stadium).contains { upper.contains($0.uppercased()) }
        let teams = [game.away.code, game.home.code].allSatisfy { code in teamWords(code).contains { upper.contains($0.uppercased()) } }
        guard stadium || teams else { return .mismatch("티켓의 구장이나 팀이 이 경기와 달라요") }
        guard let ticket = ticketNumber(scan) else { return .mismatch("예매번호나 바코드가 보이게 찍어 주세요") }
        return .ok(ticket: ticket)
    }

    // "2026-10-29" → 2026.10.29 / 10.29 / 10/29 / 10월 29일 (앞자리 0은 있어도 없어도)
    static func matchesDate(_ text: String, _ date: String?) -> Bool {
        guard let date else { return false }
        let p = date.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return false }
        let m = "0?\(p[1])", d = "0?\(p[2])"
        let patterns = ["(?<!\\d)\(m)[./-]\(d)(?!\\d)", "\(m)월\(d)일"]
        return patterns.contains { text.range(of: $0, options: .regularExpression) != nil }
    }

    static func stadiumWords(_ stadium: String?) -> [String] {
        let map: [String: [String]] = [
            "광주": ["광주", "챔피언스필드"], "대구": ["대구", "라이온즈파크"], "잠실": ["잠실"], "고척": ["고척", "스카이돔"],
            "문학": ["문학", "랜더스필드"], "인천": ["인천", "랜더스필드"], "수원": ["수원", "위즈파크"],
            "대전": ["대전", "이글스파크", "볼파크"], "사직": ["사직"], "창원": ["창원", "NC파크"],
        ]
        guard let stadium else { return [] }
        return map.first { stadium.contains($0.key) }?.value ?? [stadium]
    }

    static func teamWords(_ code: String) -> [String] {
        guard let t = Team.find(code) else { return [code] }
        var words = [t.short] + t.name.split(separator: " ").map(String.init)
        if code == "HT" { words.append("기아") }
        if code == "SK" { words.append("SSG") }
        return words
    }

    /// 바코드 값이 있으면 그것, 없으면 "예매번호/예약번호/티켓번호" 옆의 번호, 그것도 없으면 긴 숫자·영문 덩어리
    static func ticketNumber(_ scan: Scan) -> String? {
        if let code = scan.codes.first(where: { $0.filter { $0.isLetter || $0.isNumber }.count >= 6 }) { return code }
        let token = "[A-Z0-9][A-Z0-9-]{5,}"
        for (i, line) in scan.lines.enumerated() where line.range(of: "예매번호|예약번호|티켓번호|주문번호|RESERVATION", options: [.regularExpression, .caseInsensitive]) != nil {
            for candidate in [line] + Array(scan.lines.dropFirst(i + 1).prefix(1)) {
                if let r = candidate.uppercased().range(of: token, options: .regularExpression) { return String(candidate.uppercased()[r]) }
            }
        }
        return scan.lines.lazy.compactMap { line -> String? in
            let up = line.uppercased().replacingOccurrences(of: " ", with: "")
            guard let r = up.range(of: "[A-Z0-9-]{10,}", options: .regularExpression) else { return nil }
            let s = String(up[r])
            return s.contains(where: \.isNumber) ? s : nil
        }.first
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
