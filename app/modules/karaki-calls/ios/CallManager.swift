import AVFoundation
import CallKit
import PushKit
import UIKit
import WebRTC

// CallKit (the iPhone's own call screen, lock screen included) and PushKit (VoIP pushes that wake
// the app). Everything that must happen before JavaScript is running happens here:
//
//  * Apple's rule: every VoIP push must be reported to CallKit at once, or iOS stops delivering
//    them and may end the app. So a push is reported the moment it arrives, even for a call that
//    has already stopped ringing; that one is reported and then ended straight away.
//  * WebRTC runs on "manual audio": it may only play and record once CallKit has activated the
//    audio session, which is what makes answering from the lock screen work.
//
// Events for JavaScript wait in a queue until it says it is listening (the app may have been
// launched in the background by a push, with JavaScript still starting).
final class CallManager: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
  static let shared = CallManager()

  private var provider: CXProvider?
  private let controller = CXCallController()
  private var registry: PKPushRegistry?
  private var started = false
  private var pending: [(String, [String: Any])] = []
  private var known: [UUID: [String: Any]] = [:]  // calls CallKit is showing, with what the push said
  private(set) var voipToken: String?

  var emitter: ((String, [String: Any]) -> Void)? {
    didSet { flush() }
  }

  // MARK: setup

  func start() {
    if started { return }
    started = true

    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false  // family calls stay out of the Phone app's list
    if let icon = UIImage(named: "CallKitIcon") {
      config.iconTemplateImageData = icon.pngData()
    }
    let p = CXProvider(configuration: config)
    p.setDelegate(self, queue: nil)
    provider = p

    let audio = RTCAudioSession.sharedInstance()
    audio.useManualAudio = true
    audio.isAudioEnabled = false

    let r = PKPushRegistry(queue: DispatchQueue.main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
  }

  // MARK: events to JavaScript

  private func emit(_ name: String, _ body: [String: Any]) {
    let send = {
      if let e = self.emitter { e(name, body) } else { self.pending.append((name, body)) }
    }
    if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
  }

  private func flush() {
    guard let e = emitter else { return }
    let waiting = pending
    pending.removeAll()
    for (name, body) in waiting { e(name, body) }
  }

  private func idString(_ uuid: UUID) -> String { uuid.uuidString.lowercased() }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    emit("voipToken", ["token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
    emit("voipToken", ["token": ""])
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    var info: [String: Any] = [:]
    for (k, v) in payload.dictionaryPayload {
      if let key = k as? String { info[key] = v }
    }
    let uuid = (info["callId"] as? String).flatMap { UUID(uuidString: $0) } ?? UUID()
    let title = (info["title"] as? String) ?? "Karaki"
    let video = (info["kind"] as? String) == "video"
    let ringUntil = (info["ringUntil"] as? NSNumber)?.doubleValue ?? 0

    reportIncoming(uuid: uuid, title: title, video: video, info: info) {
      // too late (the push was slow): it was reported as the rule demands, now it ends at once
      if ringUntil > 0 && Date().timeIntervalSince1970 * 1000 > ringUntil {
        self.provider?.reportCall(with: uuid, endedAt: Date(), reason: .unanswered)
        self.known.removeValue(forKey: uuid)
        self.emit("end", ["callId": self.idString(uuid), "reason": "late"])
      }
      completion()
    }
  }

  // MARK: calls, called from JavaScript (and from the push above)

  func reportIncoming(uuid: UUID, title: String, video: Bool, info: [String: Any], done: (() -> Void)? = nil) {
    start()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: title)
    update.localizedCallerName = title
    update.hasVideo = video
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    provider?.reportNewIncomingCall(with: uuid, update: update) { error in
      DispatchQueue.main.async {
        if let error = error {
          // already on screen (the live socket rang first) is fine; anything else iOS refused
          // (Do Not Disturb, Focus, another call) is told to JavaScript so it can say busy
          if (error as? CXErrorCodeIncomingCallError)?.code != .callUUIDAlreadyExists {
            self.emit("incomingFailed", ["callId": self.idString(uuid), "reason": error.localizedDescription])
          }
        } else {
          self.known[uuid] = info
          var body = info
          body["callId"] = self.idString(uuid)
          self.emit("incoming", body)
        }
        done?()
      }
    }
  }

  func startOutgoing(uuid: UUID, title: String, video: Bool) {
    start()
    let handle = CXHandle(type: .generic, value: title)
    let action = CXStartCallAction(call: uuid, handle: handle)
    action.isVideo = video
    known[uuid] = ["title": title, "kind": video ? "video" : "voice"]
    controller.request(CXTransaction(action: action)) { error in
      DispatchQueue.main.async {
        if let error = error {
          self.known.removeValue(forKey: uuid)
          self.emit("startFailed", ["callId": self.idString(uuid), "reason": error.localizedDescription])
          return
        }
        let update = CXCallUpdate()
        update.remoteHandle = handle
        update.localizedCallerName = title
        update.hasVideo = video
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        self.provider?.reportCall(with: uuid, updated: update)
      }
    }
  }

  func answer(uuid: UUID) {
    controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { _ in }
  }

  func reportConnected(uuid: UUID) {
    provider?.reportOutgoingCall(with: uuid, connectedAt: Date())
  }

  // the person hung up inside the app: ask CallKit to end it (CallKit then calls perform end)
  func endCall(uuid: UUID) {
    guard known[uuid] != nil else { return }
    controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { error in
      if error != nil {
        DispatchQueue.main.async {
          self.provider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
          self.known.removeValue(forKey: uuid)
        }
      }
    }
  }

  // the call ended somewhere else (the other side, the server, another of my phones)
  func reportEnded(uuid: UUID, reason: String) {
    guard known[uuid] != nil else { return }
    let r: CXCallEndedReason
    switch reason {
    case "unanswered": r = .unanswered
    case "answeredElsewhere": r = .answeredElsewhere
    case "declinedElsewhere": r = .declinedElsewhere
    case "failed": r = .failed
    default: r = .remoteEnded
    }
    provider?.reportCall(with: uuid, endedAt: Date(), reason: r)
    known.removeValue(forKey: uuid)
  }

  func setMuted(uuid: UUID, muted: Bool) {
    guard known[uuid] != nil else { return }
    controller.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: muted))) { _ in }
  }

  func setVideo(uuid: UUID, video: Bool) {
    guard known[uuid] != nil else { return }
    let update = CXCallUpdate()
    update.hasVideo = video
    provider?.reportCall(with: uuid, updated: update)
  }

  func setSpeaker(_ on: Bool) {
    let session = RTCAudioSession.sharedInstance()
    session.lockForConfiguration()
    defer { session.unlockForConfiguration() }
    do {
      try session.overrideOutputAudioPort(on ? .speaker : .none)
    } catch {
      emit("audioError", ["reason": error.localizedDescription])
    }
  }

  private func configureAudio(video: Bool) {
    let session = RTCAudioSession.sharedInstance()
    session.lockForConfiguration()
    defer { session.unlockForConfiguration() }
    var options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP]
    options.insert(.allowBluetooth)
    if video { options.insert(.defaultToSpeaker) }
    do {
      try session.setCategory(AVAudioSession.Category.playAndRecord, with: options)
      try session.setMode(video ? AVAudioSession.Mode.videoChat : AVAudioSession.Mode.voiceChat)
    } catch {
      emit("audioError", ["reason": error.localizedDescription])
    }
  }

  // MARK: CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    known.removeAll()
    emit("reset", [:])
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    configureAudio(video: action.isVideo)
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let info = known[action.callUUID] ?? [:]
    configureAudio(video: (info["kind"] as? String) == "video")
    var body = info
    body["callId"] = idString(action.callUUID)
    emit("answer", body)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    known.removeValue(forKey: action.callUUID)
    emit("end", ["callId": idString(action.callUUID), "reason": "local"])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    emit("mute", ["callId": idString(action.callUUID), "muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    action.fail()  // holding is not offered
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    let session = RTCAudioSession.sharedInstance()
    session.audioSessionDidActivate(audioSession)
    session.isAudioEnabled = true
    emit("audioActivated", [:])
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    let session = RTCAudioSession.sharedInstance()
    session.audioSessionDidDeactivate(audioSession)
    session.isAudioEnabled = false
  }
}
