import Foundation
import Capacitor

// Bridges the connection config (server base URL + API token) from the WebView's
// JS/localStorage into a native App Group container, so Swift-side surfaces that
// run OUTSIDE the WebView process — the Share Extension (Phase 2), App Intents
// (Phase 3), native APNs registration (Phase 4) — can read the same credentials
// without the user entering them twice.
//
// The WebView owns the source of truth (localStorage, set on the Connection
// screen); src/apiConfig.js calls setSharedConfig() whenever it changes and once
// on boot. This class only WRITES what JS hands it — it never invents config.
//
// APP GROUP: the single shared identifier used by every native target. It must
// match (1) the App Groups capability on the App target, (2) the same capability
// on each extension target, and (3) the resolved value below. Created once in the Apple
// Developer portal / Xcode "Signing & Capabilities → App Groups".
// Resolved from Info.plist (BoomerangAppGroup <- the BOOMERANG_APP_GROUP build
// setting), so the prod app uses group.ryakel.boomerang and the Dev app uses
// group.ryakel.boomerang.dev without code changes.
let boomerangAppGroup = (Bundle.main.object(forInfoDictionaryKey: "BoomerangAppGroup") as? String) ?? "group.ryakel.boomerang"

@objc(BoomerangNative)
public class BoomerangNative: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangNative"
    public let jsName = "BoomerangNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSharedConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSharedConfig", returnType: CAPPluginReturnPromise)
    ]

    @objc func setSharedConfig(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: boomerangAppGroup) else {
            // App Group not provisioned yet (capability not added / free account):
            // resolve quietly so the JS mirror is a harmless no-op, not an error.
            call.resolve(["stored": false])
            return
        }
        if let base = call.getString("base") {
            defaults.set(base, forKey: "boom_api_base")
        }
        if let token = call.getString("token") {
            defaults.set(token, forKey: "boom_api_token")
        }
        call.resolve(["stored": true])
    }

    @objc func getSharedConfig(_ call: CAPPluginCall) {
        let defaults = UserDefaults(suiteName: boomerangAppGroup)
        call.resolve([
            "base": defaults?.string(forKey: "boom_api_base") ?? "",
            "token": defaults?.string(forKey: "boom_api_token") ?? ""
        ])
    }
}
