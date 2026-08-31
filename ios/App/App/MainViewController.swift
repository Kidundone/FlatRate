import UIKit
import Capacitor
import WebKit

// The JS-level touch handler in boot.js (killHorizontalBounce) tries to
// preventDefault() on sideways drags, but it's racing WKWebView's own pan
// gesture recognizer — on a fast flick the native rubber-band wobble can
// still win before the JS decides which axis the gesture is on. Fixing it
// here, at the scroll view itself, removes the race entirely: horizontal
// bounce is disabled at the source, so there's nothing left to out-run.
//
// Vertical bounce stays on — the Log page's root view relies on it for
// normal vertical scrolling (see the comment above killHorizontalBounce).
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.alwaysBounceHorizontal = false
        webView?.scrollView.bounces = true
        webView?.scrollView.showsHorizontalScrollIndicator = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Re-assert after Capacitor plugins (e.g. Keyboard, StatusBar) finish
        // configuring the scroll view on first appearance — some plugins touch
        // scrollView properties during their own viewDidAppear-timed setup.
        webView?.scrollView.alwaysBounceHorizontal = false
    }
}
