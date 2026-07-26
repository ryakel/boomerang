import AppIntents
import Foundation
import BoomerangKit

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

    private static var defaults: UserDefaults? { BoomerangShared.defaults }

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

    // Connection credentials via BoomerangKit: base from the App Group, token
    // from the shared Keychain (device access token while fresh, legacy token
    // as fallback — native never refreshes the pair, see SharedCredentials).
    // Nil until the user completes the Connection screen.
    static func config() -> Config? {
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty else { return nil }
        return Config(base: base, token: token)
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

// MARK: - Task entity (App Intents expansion, 2026-07-26)
// The first DYNAMIC entity: Siri resolves "which task?" against the server's
// GET /api/intents/tasks (title substring search / exact ids / suggestions),
// authenticated via BoomerangKit. Actionable states only, committed-first —
// the ranking lives server-side in taskModel.intentTaskRows.

struct BoomerangTaskEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Boomerang Task"
    static var defaultQuery = BoomerangTaskQuery()

    let id: String
    let title: String
    let state: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(state)")
    }
}

struct BoomerangTaskQuery: EntityStringQuery {
    private func fetch(_ queryItems: String) async -> [BoomerangTaskEntity] {
        guard BoomerangAPI.isConfigured else { return [] }
        guard let (status, json) = try? await BoomerangAPI.getJSON("/api/intents/tasks" + queryItems),
              status == 200, let rows = json["tasks"] as? [[String: Any]] else { return [] }
        return rows.compactMap { row in
            guard let id = row["id"] as? String, let title = row["title"] as? String else { return nil }
            return BoomerangTaskEntity(id: id, title: title, state: (row["state"] as? String) ?? "open")
        }
    }

    private func encoded(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }

    func entities(for identifiers: [BoomerangTaskEntity.ID]) async throws -> [BoomerangTaskEntity] {
        await fetch("?ids=" + identifiers.map(encoded).joined(separator: ","))
    }

    func entities(matching string: String) async throws -> [BoomerangTaskEntity] {
        await fetch("?q=" + encoded(string))
    }

    func suggestedEntities() async throws -> [BoomerangTaskEntity] {
        await fetch("")
    }
}

// Shared dialog plumbing for the task-verb intents.
private func serverError(_ json: [String: Any], fallback: String) -> String {
    (json["error"] as? String) ?? fallback
}

private let notConnectedDialog = "Open Boomerang and connect to your server first."
private let unreachableDialog = "Can't reach your server right now — try again when you're back on the VPN."

// MARK: - Verb intents

struct CompleteBoomerangTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Boomerang task"
    static var description = IntentDescription("Marks a task done in Boomerang.")

    @Parameter(title: "Task", requestValueDialog: "Which task did you finish?")
    var task: BoomerangTaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Mark \(\.$task) done")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard BoomerangAPI.isConfigured else { return .result(dialog: "\(notConnectedDialog)") }
        do {
            let (status, json) = try await BoomerangAPI.postJSON("/api/tasks/\(task.id)/complete")
            switch status {
            case 200...299:
                if json["already_done"] as? Bool == true {
                    return .result(dialog: "\(task.title) was already done.")
                }
                return .result(dialog: "Done — \(task.title) is off your plate.")
            case 401, 403:
                return .result(dialog: "Boomerang rejected the credentials — open the app to reconnect.")
            default:
                return .result(dialog: "\(serverError(json, fallback: "Boomerang said no (\(status))."))")
            }
        } catch {
            return .result(dialog: "\(unreachableDialog)")
        }
    }
}

struct CommitToBoomerangTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Commit to Boomerang task"
    static var description = IntentDescription("Adds a task to today's three in Boomerang. The three-task ceiling applies — Siri relays the server's answer if the plate is full.")

    @Parameter(title: "Task", requestValueDialog: "Which task are you committing to?")
    var task: BoomerangTaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Commit to \(\.$task) today")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard BoomerangAPI.isConfigured else { return .result(dialog: "\(notConnectedDialog)") }
        do {
            let (status, json) = try await BoomerangAPI.postJSON("/api/tasks/\(task.id)/commit")
            switch status {
            case 200...299:
                if json["already_committed"] as? Bool == true {
                    return .result(dialog: "\(task.title) is already on today's plate.")
                }
                return .result(dialog: "Committed — \(task.title) is on today's plate.")
            case 401, 403:
                return .result(dialog: "Boomerang rejected the credentials — open the app to reconnect.")
            default:
                // The 409 plate-full message reads well aloud as-is.
                return .result(dialog: "\(serverError(json, fallback: "Boomerang said no (\(status))."))")
            }
        } catch {
            return .result(dialog: "\(unreachableDialog)")
        }
    }
}

struct SnoozeBoomerangTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Snooze Boomerang task"
    static var description = IntentDescription("Parks a task until later. Without a date it comes back tomorrow morning.")

    @Parameter(title: "Task", requestValueDialog: "Which task should I snooze?")
    var task: BoomerangTaskEntity

    @Parameter(title: "Until")
    var until: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Snooze \(\.$task)") {
            \.$until
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard BoomerangAPI.isConfigured else { return .result(dialog: "\(notConnectedDialog)") }
        // Default: tomorrow at 05:00 local — lands before the morning digest
        // and rollover, so the task is simply back in tomorrow's pool.
        let target = until ?? {
            let cal = Calendar.current
            let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            return cal.date(bySettingHour: 5, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        }()
        let iso = ISO8601DateFormatter().string(from: target)
        do {
            let (status, json) = try await BoomerangAPI.postJSON("/api/tasks/\(task.id)/shelve", body: ["snooze_until": iso])
            switch status {
            case 200...299:
                let day = target.formatted(date: .abbreviated, time: .omitted)
                return .result(dialog: "Parked \(task.title) — it comes back \(day).")
            case 401, 403:
                return .result(dialog: "Boomerang rejected the credentials — open the app to reconnect.")
            default:
                return .result(dialog: "\(serverError(json, fallback: "Boomerang said no (\(status))."))")
            }
        } catch {
            return .result(dialog: "\(unreachableDialog)")
        }
    }
}

struct BoomerangTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Today in Boomerang"
    static var description = IntentDescription("Reads today's committed tasks and what's waiting in the pool. Read-only — great for CarPlay and HomePod.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard BoomerangAPI.isConfigured else { return .result(dialog: "\(notConnectedDialog)") }
        do {
            let (status, json) = try await BoomerangAPI.getJSON("/api/today")
            guard (200...299).contains(status) else {
                return .result(dialog: "Boomerang said no (\(status)).")
            }
            let committed = (json["committed"] as? [[String: Any]]) ?? []
            let openCount = (json["open_count"] as? Int) ?? 0
            let returnedCount = (json["returned_count"] as? Int) ?? 0

            var parts: [String] = []
            if committed.isEmpty {
                parts.append("Nothing committed yet today.")
            } else {
                let lines = committed.map { row -> String in
                    let title = (row["title"] as? String) ?? "a task"
                    if (row["done"] as? Bool) == true { return "\(title), done" }
                    if let step = row["first_step"] as? String, !step.isEmpty { return "\(title) — next: \(step)" }
                    return title
                }
                parts.append("\(committed.count) of 3 committed: \(lines.joined(separator: ". ")).")
            }
            if returnedCount > 0 {
                parts.append("\(returnedCount) task\(returnedCount == 1 ? "" : "s") came back around today.")
            }
            parts.append("\(openCount) in the pool.")
            return .result(dialog: "\(parts.joined(separator: " "))")
        } catch {
            return .result(dialog: "\(unreachableDialog)")
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
        AppShortcut(
            intent: CompleteBoomerangTaskIntent(),
            phrases: [
                "Mark \(\.$task) done in \(.applicationName)",
                "Complete a task in \(.applicationName)",
                "Mark a task done in \(.applicationName)"
            ],
            shortTitle: "Complete task",
            systemImageName: "checkmark.circle.fill"
        )
        AppShortcut(
            intent: CommitToBoomerangTaskIntent(),
            phrases: [
                "Commit to \(\.$task) in \(.applicationName)",
                "Commit to a task in \(.applicationName)"
            ],
            shortTitle: "Commit",
            systemImageName: "target"
        )
        AppShortcut(
            intent: SnoozeBoomerangTaskIntent(),
            phrases: [
                "Snooze \(\.$task) in \(.applicationName)",
                "Snooze a task in \(.applicationName)"
            ],
            shortTitle: "Snooze",
            systemImageName: "moon.zzz.fill"
        )
        AppShortcut(
            intent: BoomerangTodayIntent(),
            phrases: [
                "What's on \(.applicationName) today",
                "What's on my plate in \(.applicationName)",
                "\(.applicationName) today"
            ],
            shortTitle: "Today",
            systemImageName: "sun.max.fill"
        )
    }
}
