import UIKit
import WebKit
import Capacitor

// Root view controller — CAPBridgeViewController plus an edge-to-edge fix for
// the iOS 26+ SDK. Measured on the first simulator runs (Xcode 27 / iOS 27):
// the page's layout viewport came up exactly safeAreaTop+safeAreaBottom
// (62+34pt) SHORTER than the screen (offset down by the top inset) while
// env(safe-area-inset-*) still reported full-screen values — the system now
// derives viewport-obscuring insets from the safe area for a root web view,
// so the app got double-shrunk (WebKit inset the layout AND the CSS padded
// with env()). The app's CSS owns safe-area spacing (same as the installed
// PWA), so force the insets to zero through BOTH APIs that can shrink the
// layout viewport, and log what the system had set so a regression is
// diagnosable from the Xcode console.
class BoomerangViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        applyFullBleedViewport(reason: "viewDidLoad")
    }

    // Safe-area recomputes (rotation, status-bar changes) land here.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyFullBleedViewport(reason: "layout")
    }

    // Late pass: catch anything the system applies after presentation.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        DispatchQueue.main.async { [weak self] in
            self?.applyFullBleedViewport(reason: "didAppear")
        }
    }

    private var lastLoggedReason = ""

    private func applyFullBleedViewport(reason: String) {
        guard let webView = webView else { return }
        if #available(iOS 26.0, *) {
            let current = webView.obscuredContentInsets
            if reason != lastLoggedReason || current != .zero {
                print("⚡️ [Boomerang] fullBleed(\(reason)): obscuredContentInsets was \(current), safeArea \(view.safeAreaInsets), frame \(view.frame.size)")
                lastLoggedReason = reason
            }
            if current != .zero {
                webView.obscuredContentInsets = .zero
            }
        }
        if #available(iOS 15.5, *) {
            webView.setMinimumViewportInset(.zero, maximumViewportInset: .zero)
        }
    }
}
