import AppIntents
import Foundation

// Phase 3 — App Intents. In-app intents (iOS 16+) live inside the app binary:
// no extension target needed. This exposes "Add Boomerang task" to Siri, the
// Shortcuts app, Spotlight, the Action button, and Back Tap.
//
// The intent reads the server base + API token from the App Group container
// (written by BoomerangNative / the Connection screen) and POSTs to
// /api/capture — the dedicated voice-capture endpoint (2026-07-19): stamps
// capture_source='siri', splits long dictation into title + full-text notes
// server-side, and is rate-limited. It runs entirely in the background: no
// app launch, Siri just confirms.
//
// OFFLINE QUEUE (Phase 2): a capture must never be lost. When the server is
// unreachable (tailnet down, no signal in the car), the capture is queued in
// the App Group container and replayed on the next successful contact — the
// next intent run drains the queue before sending the new capture, and
// SceneDelegate flushes it whenever the app comes to the foreground. Requests
// carry a 10s timeout so Siri answers fast instead of hanging for the 60s
// URLSession default when the host is unreachable.

// A capture waiting for the server to come back. Stored as JSON in the App
// Group under `boom_capture_queue` so the intent process and the app process
// see the same queue.
private struct QueuedCapture: Codable {
    let text: String
    let source: String
    let at: Date
}

enum CaptureQueue {
    private static let key = "boom_capture_queue"
    // Bound the queue so UserDefaults can't bloat — 50 pending thoughts is
    // already a very bad day; drop the OLDEST beyond that (newest survive).
    private static let maxEntries = 50

    private static var defaults: UserDefaults? { UserDefaults(suiteName: boomerangAppGroup) }

    private static func load() -> [QueuedCapture] {
        guard let data = defaults?.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([QueuedCapture].self, from: data)) ?? []
    }

    private static func save(_ queue: [QueuedCapture]) {
        guard let defaults else { return }
        if queue.isEmpty {
            defaults.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(queue) {
            defaults.set(data, forKey: key)
        }
    }

    static var count: Int { load().count }

    static func enqueue(text: String, source: String) {
        var queue = load()
        queue.append(QueuedCapture(text: text, source: source, at: Date()))
        if queue.count > maxEntries { queue.removeFirst(queue.count - maxEntries) }
        save(queue)
    }

    // Replay queued captures oldest-first. Removal happens AFTER a successful
    // send — a crash mid-flush re-sends (duplicate task, annoying) rather than
    // losing the capture (trust-destroying). Stops on the first network error
    // or auth/rate-limit response; a 400 means the item itself is bad, so it
    // is dropped instead of wedging the queue forever. Returns the number of
    // captures delivered.
    @discardableResult
    static func flush() async -> Int {
        guard let config = CaptureAPI.config() else { return 0 }
        var delivered = 0
        var queue = load()
        while !queue.isEmpty {
            let item = queue[0]
            guard let status = try? await CaptureAPI.send(text: item.text, source: item.source, config: config) else {
                break // network error — server still unreachable, keep everything
            }
            if (200...299).contains(status) || status == 400 {
                queue.removeFirst()
                save(queue)
                if status != 400 { delivered += 1 }
            } else {
                break // 401/403 (config broken) or 429/5xx (back off) — retry later
            }
        }
        return delivered
    }
}

enum CaptureAPI {
    struct Config {
        let base: String
        let token: String
    }

    // Connection config mirrored into the App Group by BoomerangNative /
    // src/apiConfig.js. Nil until the user completes the Connection screen.
    static func config() -> Config? {
        guard let defaults = UserDefaults(suiteName: boomerangAppGroup),
              let base = defaults.string(forKey: "boom_api_base"), !base.isEmpty,
              let token = defaults.string(forKey: "boom_api_token"), !token.isEmpty else {
            return nil
        }
        return Config(base: base.hasSuffix("/") ? String(base.dropLast()) : base, token: token)
    }

    // POST /api/capture. Throws on network failure (queue material); returns
    // the HTTP status otherwise. 10s timeout — Siri must answer fast, and an
    // unreachable tailnet host would otherwise hang for the 60s default.
    static func send(text: String, source: String, config: Config) async throws -> Int {
        guard let url = URL(string: config.base + "/api/capture") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(config.token, forHTTPHeaderField: "x-api-token")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "source": source])
        let (_, response) = try await URLSession.shared.data(for: req)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}

struct AddBoomerangTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Boomerang task"
    static var description = IntentDescription("Creates a task in Boomerang. Captures are queued on-device when the server is unreachable.")

    @Parameter(title: "Task", requestValueDialog: "What's the task?")
    var taskTitle: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$taskTitle) to Boomerang")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = taskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return .result(dialog: "I didn't catch that — try again.")
        }
        guard let config = CaptureAPI.config() else {
            return .result(dialog: "Open Boomerang and connect to your server first.")
        }

        // Drain anything captured offline before sending the new one, so
        // captures land in the order they were spoken.
        let replayed = await CaptureQueue.flush()

        do {
            let status = try await CaptureAPI.send(text: text, source: "siri", config: config)
            switch status {
            case 200...299:
                let suffix = replayed > 0 ? " Also synced \(replayed) saved earlier." : ""
                return .result(dialog: "Caught it — \(text) is on your list.\(suffix)")
            case 401, 403:
                return .result(dialog: "Boomerang rejected the API token — check the connection settings in the app.")
            case 429:
                CaptureQueue.enqueue(text: text, source: "siri")
                return .result(dialog: "Boomerang is rate-limiting — saved on this device; it'll sync shortly.")
            default:
                return .result(dialog: "Boomerang said no (\(status)).")
            }
        } catch {
            // Server unreachable — the whole reason the queue exists.
            CaptureQueue.enqueue(text: text, source: "siri")
            return .result(dialog: "Can't reach your server — saved on this device; it'll sync next time.")
        }
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
                "New task in \(.applicationName)",
                "Capture a thought in \(.applicationName)",
                "\(.applicationName) capture"
            ],
            shortTitle: "Add task",
            systemImageName: "plus.circle.fill"
        )
    }
}
