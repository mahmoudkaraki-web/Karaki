import ExpoModulesCore
import UIKit

// Runs at app launch, before any JavaScript: PushKit has to be listening from the very start so a
// VoIP push that launched the app (closed, locked phone) is reported to CallKit straight away.
public class KarakiCallsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallManager.shared.start()
    return true
  }
}
