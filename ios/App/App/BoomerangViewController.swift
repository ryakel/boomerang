import UIKit
import WebKit
import Capacitor

// Root view controller — CAPBridgeViewController plus an edge-to-edge fix for
// the iOS 26+ SDK. Measured on the first simulator runs (Xcode 27 / iOS 27):
// the page's layout viewport came up exactly safeAreaTop+safeAreaBottom
// (62+34pt) SHORTER than the screen while env(safe-area-inset-*) still
// reported full-screen values — the system now auto-populates the WKWebView
// viewport-obscuring insets from the safe area, so the app got double-shrunk
// (WebKit inset the layout AND the CSS padded with env()). The app's CSS owns
// safe-area spacing (same as the installed PWA), so force the insets to zero.
// Referenced from Main.storyboard (customClass) instead of the stock
// CAPBridgeViewController.
class BoomerangViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        applyFullBleedViewport()
    }

    // Re-assert after every layout pass — safe-area changes (rotation, status
    // bar) are exactly when the system recomputes the obscured insets.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyFullBleedViewport()
    }

    private func applyFullBleedViewport() {
        guard let webView = webView else { return }
        if #available(iOS 26.0, *) {
            webView.obscuredContentInsets = .zero
        }
    }
}
