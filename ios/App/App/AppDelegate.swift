import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // flatratebuddy://quicklog?hours=..&ro=.. — the Siri/Shortcuts quick-log
        // intent (LogJobIntent.swift) opens this instead of a universal link
        // because the app has no server.url / Associated Domains configured:
        // it loads index.html from Capacitor's local bundle, not from
        // app.nellylabs.dev, so there's no https:// URL that routes back into
        // THIS app. A private custom scheme sidesteps that entirely — no
        // Associated Domains entitlement, no Apple Developer portal changes.
        if url.scheme?.lowercased() == "flatratebuddy" {
            handleQuickLogURL(url)
            return true
        }
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Hands the hours/RO straight to a JS function already loaded in the
    // webview rather than navigating it to a new URL with query params —
    // the app is a single-page app that keeps state in memory, and reloading
    // it to pick up `location.search` would blow that state away. Retried
    // inside handleQuickLogDeepLink on the JS side if the log form hasn't
    // mounted yet (cold launch racing boot).
    private func handleQuickLogURL(_ url: URL) {
        guard url.host == "quicklog",
              let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeVC.webView else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var payload: [String: String] = [:]
        if let hours = comps?.queryItems?.first(where: { $0.name == "hours" })?.value {
            payload["hours"] = hours
        }
        if let ro = comps?.queryItems?.first(where: { $0.name == "ro" })?.value {
            payload["ro"] = ro
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.__FR && window.__FR.handleQuickLogDeepLink && window.__FR.handleQuickLogDeepLink(\(json));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
