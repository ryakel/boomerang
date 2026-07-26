import Foundation
import Capacitor
import BoomerangKit

// Bridges connection credentials from the WebView's JS into native shared
// storage, so Swift-side surfaces that run OUTSIDE the WebView process — the
// Share Extension, App Intents, native APNs — can use the same credentials
// without the user entering them twice.
//
// Storage split (BoomerangKit):
//   - base URL            → App Group UserDefaults (not a secret)
//   - legacy API token    → Keychain (migrated out of the plaintext defaults)
//   - device token pair   → Keychain (auth Phase A; WebView mirrors on change)
//
// The WebView owns the source of truth AND the refresh dance — see the
// invariant in SharedCredentials.swift: native code never rotates the pair.
// This class only stores what JS hands it; it never invents config.
//
// The App Group identifier resolves from Info.plist (BoomerangAppGroup <- the
// BOOMERANG_APP_GROUP build setting) inside BoomerangKit — never hardcoded.

@objc(BoomerangNative)
public class BoomerangNative: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangNative"
    public let jsName = "BoomerangNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSharedConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSharedConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDeviceTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDeviceTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "runAppAttest", returnType: CAPPluginReturnPromise)
    ]

    @objc func setSharedConfig(_ call: CAPPluginCall) {
        if let base = call.getString("base") {
            BoomerangShared.setApiBase(base)
        }
        if let token = call.getString("token") {
            SharedCredentials.setLegacyToken(token)
        }
        call.resolve(["stored": true])
    }

    @objc func getSharedConfig(_ call: CAPPluginCall) {
        call.resolve([
            "base": BoomerangShared.apiBase,
            "token": SharedCredentials.legacyToken
        ])
    }

    // Mirror of the WebView's device pair (auth Phase A). JS calls this on
    // every enroll/rotate so extensions always hold a live access token, and
    // so the pair survives WebView storage eviction (getDeviceTokens is the
    // recovery path on boot).
    @objc func setDeviceTokens(_ call: CAPPluginCall) {
        let pair = DevicePair(
            device_id: call.getString("device_id") ?? "",
            access_token: call.getString("access_token") ?? "",
            refresh_token: call.getString("refresh_token") ?? "",
            access_expires: call.getDouble("access_expires") ?? 0
        )
        guard !pair.access_token.isEmpty, !pair.refresh_token.isEmpty else {
            // An empty mirror must never clobber a stored pair — explicit
            // clears go through clearDeviceTokens.
            call.resolve(["stored": false])
            return
        }
        SharedCredentials.setDevicePair(pair)
        call.resolve(["stored": true])
    }

    @objc func getDeviceTokens(_ call: CAPPluginCall) {
        guard let pair = SharedCredentials.devicePair else {
            call.resolve(["present": false])
            return
        }
        call.resolve([
            "present": true,
            "device_id": pair.device_id,
            "access_token": pair.access_token,
            "refresh_token": pair.refresh_token,
            "access_expires": pair.access_expires
        ])
    }

    @objc func clearDeviceTokens(_ call: CAPPluginCall) {
        SharedCredentials.clearDevicePair()
        call.resolve(["cleared": true])
    }

    // Phase B native half: run the DCAppAttest flow against the server. With
    // the server's verifier still a 501 stub, outcome "server_pending" is the
    // success signal that the native side works end-to-end on this device.
    @objc func runAppAttest(_ call: CAPPluginCall) {
        Task {
            let outcome = await AppAttestClient.run()
            call.resolve([
                "outcome": outcome.label,
                "detail": outcome.detail
            ])
        }
    }
}
