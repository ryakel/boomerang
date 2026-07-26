import Foundation

// The App Group container shared by every Boomerang target. The identifier is
// NEVER hardcoded per flavor: it flows from the BOOMERANG_APP_GROUP build
// setting into each target's Info.plist (key `BoomerangAppGroup`), so the prod
// app resolves group.ryakel.boomerang and the Dev app group.ryakel.boomerang.dev
// from one source tree. `Bundle.main` is the *host* bundle at runtime — the app
// in the app, the extension in the extension — and both Info.plists carry the key.
public enum BoomerangShared {
    public static var appGroupId: String {
        (Bundle.main.object(forInfoDictionaryKey: "BoomerangAppGroup") as? String) ?? "group.ryakel.boomerang"
    }

    public static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupId) }

    // Server base URL. Not a secret — stays in App Group defaults where the
    // pre-BoomerangKit builds put it, so nothing migrates.
    public static var apiBase: String {
        var base = defaults?.string(forKey: "boom_api_base") ?? ""
        while base.hasSuffix("/") { base = String(base.dropLast()) }
        return base
    }

    public static func setApiBase(_ base: String) {
        defaults?.set(base, forKey: "boom_api_base")
    }
}
