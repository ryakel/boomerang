import SwiftUI

// Boomerang on the wrist. Single-target watchOS app (watchOS 7+ layout: no
// separate WatchKit extension), embedded in the iPhone app's bundle so it
// installs alongside it — no separate App Store presence, no separate signing
// dance beyond the bundle id.
//
// It holds no credentials and speaks no HTTP: every request goes through the
// paired phone (Shared/WatchProtocol.swift explains why — the server is
// tailnet-only and watchOS has no Tailscale client).
@main
struct BoomerangWatchApp: App {
    @StateObject private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView(store: store)
            }
        }
    }
}
