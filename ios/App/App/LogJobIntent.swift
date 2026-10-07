import AppIntents
import UIKit

// Siri / Shortcuts quick-log entry point. "Hey Siri, log a job in Flatrate
// Buddy" (or running the shortcut from the Shortcuts app / Action Button)
// asks for hours and, optionally, an RO number by voice, then hands off to
// the app instead of writing anything itself.
//
// Deliberately NOT a silent write: a misheard RO number or hours value
// going straight into a paycheck record with no visual confirmation would
// be worse than the problem this is solving. Instead this just opens the
// app to the Log tab with the fields pre-filled — same trust level as the
// existing "repeat last entry" and "flag this job" prefill patterns
// already in main-page.js — and the tech reviews and taps Save themselves.
//
// AppIntents/AppShortcutsProvider need iOS 16+; the app's deployment target
// is 15.0, so this is gated with @available rather than bumping that for
// everyone just for this.
@available(iOS 16.0, *)
struct LogJobIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a Job"
    static var description = IntentDescription("Quickly log flat-rate hours in Flatrate Buddy.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Hours")
    var hours: Double

    @Parameter(title: "RO Number")
    var roNumber: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$hours) hours on RO \(\.$roNumber)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        var components = URLComponents()
        components.scheme = "flatratebuddy"
        components.host = "quicklog"
        var items = [URLQueryItem(name: "hours", value: String(hours))]
        if let ro = roNumber, !ro.isEmpty {
            items.append(URLQueryItem(name: "ro", value: ro))
        }
        components.queryItems = items
        if let url = components.url {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct FlatrateBuddyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogJobIntent(),
            phrases: [
                "Log a job in \(.applicationName)",
                "Log hours in \(.applicationName)",
                "Quick log in \(.applicationName)",
            ],
            shortTitle: "Log a Job",
            systemImageName: "wrench.and.screwdriver"
        )
    }
}
