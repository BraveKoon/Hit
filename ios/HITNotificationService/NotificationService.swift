import UniformTypeIdentifiers
import UserNotifications

/// 알림 서비스 확장: 서버가 보낸 "image"(선수 사진) 주소를 받아 알림에 붙인다.
/// 홈런 알림엔 친 선수, 관심 선수 알림엔 그 선수 사진이 잠금화면 알림 오른쪽에 뜬다.
/// 사진을 못 받거나 시간이 모자라면 사진 없이 그대로 보여준다.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?
    private var delivered = false

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        self.content = content

        guard let address = request.content.userInfo["image"] as? String, let url = URL(string: address) else {
            deliver()
            return
        }
        let task = URLSession.shared.downloadTask(with: url) { [weak self] location, response, _ in
            if let location {
                let type = response?.mimeType.flatMap { UTType(mimeType: $0) } ?? .jpeg
                let file = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(type.preferredFilenameExtension ?? "jpg")
                if (try? FileManager.default.moveItem(at: location, to: file)) != nil,
                   let attachment = try? UNNotificationAttachment(
                       identifier: "player", url: file,
                       options: [UNNotificationAttachmentOptionsTypeHintKey: type.identifier]) {
                    self?.content?.attachments = [attachment]
                }
            }
            self?.deliver()
        }
        task.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        deliver() // 시간이 다 되면 사진 없이라도
    }

    private func deliver() {
        guard !delivered, let contentHandler, let content else { return }
        delivered = true
        contentHandler(content)
    }
}
