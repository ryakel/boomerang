import Foundation

// The device token pair (auth Phase A — wiki/Auth-Device-Tokens.md), mirrored
// into the Keychain by the WebView via BoomerangNative whenever it changes.
// Field names match the server's enroll/refresh payload verbatim so the JS
// side can hand the object straight through.
public struct DevicePair: Codable {
    public let device_id: String
    public let access_token: String
    public let refresh_token: String
    public let access_expires: Double // ms since epoch, matches Date.now()

    public init(device_id: String, access_token: String, refresh_token: String, access_expires: Double) {
        self.device_id = device_id
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.access_expires = access_expires
    }
}

// The ONE place native code reads Boomerang credentials.
//
// INVARIANT — native surfaces are READ-ONLY consumers of the device pair.
// The refresh token is single-use and the WebView owns rotation; if an
// extension refreshed it concurrently, the app's stored token would become
// "superseded" and the app's next refresh would trip the server's theft
// detection on ourselves (auto-revoke + security alert). Native code uses the
// mirrored access token while it's fresh and falls back to the legacy static
// token — it never calls /api/auth/device/refresh.
public enum SharedCredentials {
    static let legacyTokenAccount = "api_token"
    static let devicePairAccount = "device_pair"
    public static let attestKeyAccount = "attest_key_id"

    // Legacy static API token. Lives in the Keychain; pre-BoomerangKit builds
    // mirrored it into App Group UserDefaults (a plaintext plist), so first
    // read migrates it over and scrubs the old copy.
    public static var legacyToken: String {
        if let t = BoomKeychain.get(legacyTokenAccount), !t.isEmpty { return t }
        if let old = BoomerangShared.defaults?.string(forKey: "boom_api_token"), !old.isEmpty {
            if BoomKeychain.set(legacyTokenAccount, old) {
                BoomerangShared.defaults?.removeObject(forKey: "boom_api_token")
            }
            return old
        }
        return ""
    }

    public static func setLegacyToken(_ token: String) {
        if token.isEmpty {
            BoomKeychain.delete(legacyTokenAccount)
        } else {
            BoomKeychain.set(legacyTokenAccount, token)
        }
        // Scrub the plaintext-defaults copy in every case.
        BoomerangShared.defaults?.removeObject(forKey: "boom_api_token")
    }

    public static var devicePair: DevicePair? {
        guard let raw = BoomKeychain.get(devicePairAccount),
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(DevicePair.self, from: data)
    }

    public static func setDevicePair(_ pair: DevicePair) {
        guard !pair.access_token.isEmpty, !pair.refresh_token.isEmpty else { return }
        if let data = try? JSONEncoder().encode(pair),
           let raw = String(data: data, encoding: .utf8) {
            BoomKeychain.set(devicePairAccount, raw)
        }
    }

    public static func clearDevicePair() {
        BoomKeychain.delete(devicePairAccount)
    }

    // The credential native surfaces attach right now: an unexpired device
    // access token wins; the legacy token is the fallback. 60s of slack keeps
    // an about-to-expire token from dying mid-request.
    public static var bestToken: String {
        if let p = devicePair, !p.access_token.isEmpty,
           p.access_expires > (Date().timeIntervalSince1970 * 1000) + 60_000 {
            return p.access_token
        }
        return legacyToken
    }

    public static var isConfigured: Bool {
        !BoomerangShared.apiBase.isEmpty && !bestToken.isEmpty
    }
}
