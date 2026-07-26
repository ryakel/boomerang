// swift-tools-version: 5.9
import PackageDescription

// BoomerangKit — code shared by every native target (App, ShareExtension,
// future App Intents extension / watch app). Holds the App Group + Keychain
// credential store and the App Attest client. Must NOT depend on Capacitor:
// extension targets link this package without the Capacitor runtime; the
// plugin glue that bridges it into the WebView lives in App/BoomerangNative.swift.
let package = Package(
    name: "BoomerangKit",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "BoomerangKit",
            targets: ["BoomerangKit"])
    ],
    targets: [
        .target(
            name: "BoomerangKit")
    ]
)
