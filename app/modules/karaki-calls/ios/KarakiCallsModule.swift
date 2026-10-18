import ExpoModulesCore

// The JavaScript side of CallManager: functions to show, answer and end calls in CallKit, and
// events back (incoming, answer, end, mute, the VoIP token, audio ready).
public class KarakiCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KarakiCalls")

    Events("voipToken", "incoming", "incomingFailed", "startFailed", "answer", "end", "mute", "audioActivated", "audioError", "reset")

    // JavaScript calls this once its listeners are in place; queued events then flow
    Function("ready") { () -> String? in
      DispatchQueue.main.async {
        CallManager.shared.start()
        CallManager.shared.emitter = { [weak self] name, body in
          self?.sendEvent(name, body.mapValues { Optional($0) })
        }
      }
      return CallManager.shared.voipToken
    }

    Function("voipToken") { () -> String? in
      return CallManager.shared.voipToken
    }

    Function("reportIncoming") { (callId: String, title: String, video: Bool, info: [String: Any]) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.reportIncoming(uuid: uuid, title: title, video: video, info: info) }
    }

    Function("startOutgoing") { (callId: String, title: String, video: Bool) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.startOutgoing(uuid: uuid, title: title, video: video) }
    }

    Function("answer") { (callId: String) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.answer(uuid: uuid) }
    }

    Function("reportConnected") { (callId: String) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.reportConnected(uuid: uuid) }
    }

    Function("endCall") { (callId: String) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.endCall(uuid: uuid) }
    }

    Function("reportEnded") { (callId: String, reason: String) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.reportEnded(uuid: uuid, reason: reason) }
    }

    Function("setMuted") { (callId: String, muted: Bool) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.setMuted(uuid: uuid, muted: muted) }
    }

    Function("setVideo") { (callId: String, video: Bool) in
      guard let uuid = UUID(uuidString: callId) else { return }
      DispatchQueue.main.async { CallManager.shared.setVideo(uuid: uuid, video: video) }
    }

    Function("setSpeaker") { (on: Bool) in
      DispatchQueue.main.async { CallManager.shared.setSpeaker(on) }
    }
  }
}
