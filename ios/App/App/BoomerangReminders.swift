import Foundation
import Capacitor
import EventKit

// EventKit bridge for the two-way Apple Reminders sync (2026-08-01).
//
// This plugin is a DUMB PIPE on purpose. It lists what EventKit has, and it
// writes back exactly what it is told. Every rule about whose edit survives
// lives in server/reminderMerge.js, which is pure and tested — the same
// reasoning as the watch holding no credentials and making no HTTP calls. If
// the merge lived here, a second device could resolve a conflict differently
// from the first and there would be no way to test either.
//
// Apple owns the ALARM. An EKReminder with an absolute-date EKAlarm fires on
// the Lock Screen, CarPlay, HomePod and Watch with no Boomerang send path
// involved, which is what keeps the Great Alert Deletion's short surviving
// list intact.
//
// The list is resolved by NAME (BOOMERANG_LIST) rather than by identifier: a
// calendar identifier is per-device and per-account, so a hardcoded one breaks
// the moment the user signs into iCloud on a second device. Missing list is
// created once, in the default reminders source.

@objc(BoomerangReminders)
public class BoomerangReminders: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangReminders"
    public let jsName = "BoomerangReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    private static let listName = "Boomerang"
    private let store = EKEventStore()

    // MARK: - Access

    @objc func requestAccess(_ call: CAPPluginCall) {
        // iOS 17 split reminders access into full/write-only. Write-only cannot
        // READ, so it cannot support a two-way sync at all — asking for it and
        // then silently syncing one way would be worse than failing here.
        if #available(iOS 17.0, *) {
            store.requestFullAccessToReminders { granted, error in
                call.resolve([
                    "granted": granted,
                    "error": error?.localizedDescription ?? ""
                ])
            }
        } else {
            store.requestAccess(to: .reminder) { granted, error in
                call.resolve([
                    "granted": granted,
                    "error": error?.localizedDescription ?? ""
                ])
            }
        }
    }

    private func authorized() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        if #available(iOS 17.0, *) {
            return status == .fullAccess
        }
        return status == .authorized
    }

    // MARK: - The Boomerang list

    private func boomerangList() -> EKCalendar? {
        let existing = store.calendars(for: .reminder)
            .first { $0.title == Self.listName && $0.allowsContentModifications }
        if let existing { return existing }

        guard let source = store.defaultCalendarForNewReminders()?.source
            ?? store.sources.first(where: { $0.sourceType == .calDAV })
            ?? store.sources.first(where: { $0.sourceType == .local })
        else { return nil }

        let created = EKCalendar(for: .reminder, eventStore: store)
        created.title = Self.listName
        created.source = source
        try? store.saveCalendar(created, commit: true)
        return created
    }

    // MARK: - Read

    @objc func list(_ call: CAPPluginCall) {
        guard authorized() else {
            call.reject("Reminders access has not been granted")
            return
        }
        guard let calendar = boomerangList() else {
            call.reject("Could not find or create the Boomerang reminders list")
            return
        }

        let predicate = store.predicateForReminders(in: [calendar])
        store.fetchReminders(matching: predicate) { reminders in
            // nil means the fetch FAILED. Resolving it as an empty list would
            // tell the server every reminder had been deleted, and the merge
            // would start unlinking — so failure has to be distinguishable
            // from "the list is empty", which it genuinely can be.
            guard let reminders else {
                call.reject("Could not read reminders")
                return
            }
            let items: [[String: Any]] = reminders.map { r in
                [
                    "id": r.calendarItemIdentifier,
                    "title": r.title ?? "",
                    "notes": r.notes ?? "",
                    "remindAt": Self.iso(from: r.dueDateComponents) ?? NSNull(),
                    "completed": r.isCompleted
                ]
            }
            call.resolve(["items": items])
        }
    }

    // MARK: - Write

    @objc func write(_ call: CAPPluginCall) {
        guard authorized() else {
            call.reject("Reminders access has not been granted")
            return
        }
        guard let calendar = boomerangList() else {
            call.reject("Could not find or create the Boomerang reminders list")
            return
        }
        let items = call.getArray("items", JSObject.self) ?? []

        // taskId → the id EventKit assigned, reported back so the server can
        // establish the link. Without this round trip a created reminder is
        // orphaned and the next sync creates a duplicate.
        var links: [[String: String]] = []
        var failures: [String] = []

        for item in items {
            let existingId = item["remindersId"] as? String
            let reminder: EKReminder
            if let existingId, let found = store.calendarItem(withIdentifier: existingId) as? EKReminder {
                reminder = found
            } else {
                reminder = EKReminder(eventStore: store)
                reminder.calendar = calendar
            }

            if let title = item["title"] as? String { reminder.title = title }
            if let notes = item["notes"] as? String { reminder.notes = notes.isEmpty ? nil : notes }

            // Rebuild the alarm from scratch each write. Appending would stack
            // duplicate alarms on every edit and the reminder would fire once
            // per past sync.
            reminder.alarms?.forEach { reminder.removeAlarm($0) }
            if let remindAt = item["remindAt"] as? String, let date = Self.date(from: remindAt) {
                reminder.dueDateComponents = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute], from: date)
                reminder.addAlarm(EKAlarm(absoluteDate: date))
            } else {
                reminder.dueDateComponents = nil
            }

            if let completed = item["completed"] as? Bool {
                reminder.isCompleted = completed
            }

            do {
                try store.save(reminder, commit: false)
                if existingId == nil, let taskId = item["taskId"] as? String {
                    links.append(["taskId": taskId, "remindersId": reminder.calendarItemIdentifier])
                }
            } catch {
                failures.append(error.localizedDescription)
            }
        }

        do {
            try store.commit()
        } catch {
            call.reject("Could not save reminders: \(error.localizedDescription)")
            return
        }
        // Partial failures are REPORTED rather than swallowed — a sync that
        // quietly drops writes is indistinguishable from one that worked.
        call.resolve(["links": links, "failures": failures])
    }

    // MARK: - Dates

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func date(from iso: String) -> Date? {
        if let d = isoFormatter.date(from: iso) { return d }
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFractional.date(from: iso)
    }

    private static func iso(from components: DateComponents?) -> String? {
        guard let components, let date = Calendar.current.date(from: components) else { return nil }
        return isoFormatter.string(from: date)
    }
}
