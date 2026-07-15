import AppIntents
import Foundation

// Phase 3 — App Intents. In-app intents (iOS 16+) live inside the app binary:
// no extension target needed. This exposes "Add Boomerang task" to Siri, the
// Shortcuts app, Spotlight, the Action button, and Back Tap.
//
// The intent reads the server base + API token from the App Group container
// (written by BoomerangNative / the Connection screen) and POSTs to
// /api/intake — the same endpoint the Share Extension uses. It runs entirely
// in the background: no app launch, Siri just confirms.

struct AddBoomerangTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Boomerang task"
    static var description = IntentDescription("Creates a task in Boomerang.")

    @Parameter(title: "Task", requestValueDialog: "What's the task?")
    var taskTitle: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$taskTitle) to Boomerang")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let group = (Bundle.main.object(forInfoDictionaryKey: "BoomerangAppGroup") as? String) ?? "group.ryakel.boomerang"
        guard let defaults = UserDefaults(suiteName: group),
              let base = defaults.string(forKey: "boom_api_base"), !base.isEmpty,
              let token = defaults.string(forKey: "boom_api_token"), !token.isEmpty else {
            return .result(dialog: "Open Boomerang and connect to your server first.")
        }
        let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmedBase + "/api/intake") else {
            return .result(dialog: "Boomerang's server URL looks wrong.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["title": taskTitle])

        let (_, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            return .result(dialog: "Boomerang said no (\(http.statusCode)).")
        }
        return .result(dialog: "Caught it — \(taskTitle) is on your list.")
    }
}

struct BoomerangShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddBoomerangTaskIntent(),
            // Phrases may only embed AppEnum/AppEntity parameters — a free-form
            // String can't appear in the spoken trigger, so Siri collects the
            // title via the parameter's requestValueDialog instead.
            phrases: [
                "Add a task to \(.applicationName)",
                "Add a task in \(.applicationName)",
                "Throw a task to \(.applicationName)",
                "New task in \(.applicationName)"
            ],
            shortTitle: "Add task",
            systemImageName: "plus.circle.fill"
        )
    }
}
