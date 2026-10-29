import AVFoundation

/// 경기를 따라가는 동안 앱이 백그라운드에서도 폰이 직접 네이버를 읽도록 소리 없는 오디오를 반복 재생한다.
/// (UIBackgroundModes audio. 다른 앱의 음악은 끊지 않는다)
@MainActor
final class BackgroundKeeper {
    static let shared = BackgroundKeeper()
    private var player: AVAudioPlayer?
    private var observers: [NSObjectProtocol] = []
    private init() {}

    var isRunning: Bool { player != nil }

    func start() {
        guard player == nil, let player = try? AVAudioPlayer(data: Self.silentWAV()) else { return }
        player.numberOfLoops = -1
        player.volume = 0
        self.player = player
        ensurePlaying()

        // 전화·다른 앱 등으로 끊기면 다시 튼다 (멈춘 채로 두면 앱이 잠들어 잠금화면이 멈춘다)
        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            AVAudioSession.interruptionNotification,
            AVAudioSession.mediaServicesWereResetNotification,
            AVAudioSession.routeChangeNotification,
        ]
        observers = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                if name == AVAudioSession.interruptionNotification,
                   let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                   AVAudioSession.InterruptionType(rawValue: raw) == .began {
                    return
                }
                Task { @MainActor in self?.ensurePlaying() }
            }
        }
    }

    /// 멈춰 있으면 세션을 다시 켜고 재생한다 (확인할 때마다 불러도 된다)
    func ensurePlaying() {
        guard let player, !player.isPlaying else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
        player.play()
    }

    func stop() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        player?.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// 1초짜리 무음 WAV (8kHz, 16bit, mono)
    private static func silentWAV() -> Data {
        let sampleRate: UInt32 = 8000
        let samples = Data(count: Int(sampleRate) * 2)
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + samples.count))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(sampleRate)
        append(sampleRate * 2)
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(samples.count))
        data.append(samples)
        return data
    }
}
