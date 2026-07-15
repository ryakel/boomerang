import UIKit
import Capacitor

// UIScene lifecycle adoption (TN3187). The iOS 27 SDK refuses to launch apps
// that only implement the legacy UIApplicationDelegate lifecycle — Capacitor's
// stock template still does, so it traps with EXC_BREAKPOINT at startup when
// built with Xcode 27. The scene manifest in Info.plist points UIKit at this
// class + the Main storyboard; UIKit creates the window and the storyboard's
// CAPBridgeViewController automatically.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard (scene as? UIWindowScene) != nil else { return }
        // Cold-start deep links / universal links arrive here under the scene
        // lifecycle (AppDelegate's open-url methods are no longer called).
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    // Warm-start custom-scheme URLs.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    // Warm-start universal links.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
