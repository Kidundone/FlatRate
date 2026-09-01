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
        disableNativeWebViewZoom()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Re-assert after Capacitor plugins (e.g. Keyboard, StatusBar) finish
        // configuring the scroll view on first appearance — some plugins touch
        // scrollView properties during their own viewDidAppear-timed setup.
        webView?.scrollView.alwaysBounceHorizontal = false
        disableNativeWebViewZoom()
    }

    // The photo viewer (index.html / utils.js initPhotoZoom) implements its
    // own pinch-to-zoom on a single image so it can constrain panning to that
    // image's frame instead of the whole page. WKWebView's own pinch-zoom
    // gesture scales the ENTIRE page, and it was winning the fight against
    // the JS handler — a JS-only fix (toggling the viewport meta tag's
    // user-scalable) turned out to be unreliable, since WKWebView computes
    // its zoom limits from the viewport meta at initial page load and
    // doesn't reliably re-read it on a later DOM mutation. Disabling the
    // scroll view's own pinch/double-tap zoom recognizers here removes the
    // conflict at its source instead of racing it.
    private func disableNativeWebViewZoom() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.pinchGestureRecognizer?.isEnabled = false
        for recognizer in scrollView.gestureRecognizers ?? [] {
            if let tap = recognizer as? UITapGestureRecognizer, tap.numberOfTapsRequired == 2 {
                tap.isEnabled = false
            }
        }
    }
}
