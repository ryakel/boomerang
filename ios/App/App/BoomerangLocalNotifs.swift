import Foundation
import Capacitor
import UserNotifications

// Local notifications for reminders (2026-08-01).
//
// LOCAL, not push. The app hands iOS a trigger ahead of time and the DEVICE
// fires it — no network, no VPN, no server, works in airplane mode. That is
// the whole point: a 7:30pm reminder has to ring on a phone abroad while the
// server sits at home behind a VPN. The server owns the schedule, the device
// caches it and rings from the cache.
//
// This plugin is a DUMB PIPE, like BoomerangReminders and the watch bridge.
// Every decision about WHAT to schedule — which loops repeat, what fills the
// remaining slots, what gets dropped — lives in src/reminderSchedule.js, which
// is pure and tested. Nothing here chooses anything.
//
// REPLACE, NEVER APPEND. `schedule()` cancels everything this plugin owns and
// re-adds the given set. Identifiers are stable (`loop:<id>` / `task:<id>`), so
// re-scheduling on every app open replaces in place instead of stacking a
// second copy of the same alarm — which would otherwise fire twice, then three
// times, then once per launch since install.

@objc(BoomerangLocalNotifs)
public class BoomerangLocalNotifs: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangLocalNotifs"
    public let jsName = "BoomerangLocalNotifs"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise)
    ]

    // Only requests carrying this prefix are ours to cancel. APNs banners and
    // anything a future feature schedules must not be swept away by a refresh.
    private static let prefix = "boomerang:"

    private var center: UNUserNotificationCenter { .current() }

    // MARK: - Permission

    @objc func requestPermission(_ call: CAPPluginCall) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            call.resolve([
                "granted": granted,
                "error": error?.localizedDescription ?? ""
            ])
        }
    }

    // MARK: - Schedule

    @objc func schedule(_ call: CAPPluginCall) {
        let items = call.getArray("items", JSObject.self) ?? []

        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            guard settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional else {
                // Refusing loudly rather than scheduling into the void: without
                // authorization every add silently no-ops, and the app would
                // report a schedule the device does not hold.
                call.reject("Notification permission has not been granted")
                return
            }

            self.cancelOwned {
                var scheduled: [String] = []
                var failures: [String] = []
                let group = DispatchGroup()

                for item in items {
                    guard let rawId = item["id"] as? String,
                          let title = item["title"] as? String,
                          let kind = item["kind"] as? String,
                          let hour = Self.intValue(item["hour"]),
                          let minute = Self.intValue(item["minute"]) else {
                        failures.append("malformed item")
                        continue
                    }

                    let content = UNMutableNotificationContent()
                    content.title = title
                    content.body = (item["body"] as? String) ?? ""
                    content.sound = .default
                    // The tap handler routes on this, the same '?task=<id>'
                    // shape web push and Pushover already use.
                    if let taskId = item["taskId"] as? String {
                        content.userInfo = ["url": "/?task=\(taskId)"]
                    }

                    let trigger: UNNotificationTrigger?
                    switch kind {
                    case "daily":
                        var c = DateComponents()
                        c.hour = hour
                        c.minute = minute
                        trigger = UNCalendarNotificationTrigger(dateMatching: c, repeats: true)
                    case "weekly":
                        var c = DateComponents()
                        c.hour = hour
                        c.minute = minute
                        c.weekday = Self.intValue(item["weekday"])
                        trigger = UNCalendarNotificationTrigger(dateMatching: c, repeats: true)
                    case "once":
                        guard let fireAt = item["fireAt"] as? String,
                              let date = Self.date(from: fireAt),
                              date.timeIntervalSinceNow > 0 else {
                            // A past one-off is dropped by iOS anyway; saying so
                            // keeps the reported count honest.
                            failures.append("\(rawId): fire time missing or already past")
                            continue
                        }
                        let c = Calendar.current.dateComponents(
                            [.year, .month, .day, .hour, .minute], from: date)
                        trigger = UNCalendarNotificationTrigger(dateMatching: c, repeats: false)
                    default:
                        failures.append("\(rawId): unknown kind \(kind)")
                        continue
                    }

                    guard let trigger else { continue }
                    let request = UNNotificationRequest(
                        identifier: Self.prefix + rawId, content: content, trigger: trigger)

                    group.enter()
                    self.center.add(request) { error in
                        if let error {
                            failures.append("\(rawId): \(error.localizedDescription)")
                        } else {
                            scheduled.append(rawId)
                        }
                        group.leave()
                    }
                }

                group.notify(queue: .main) {
                    // The count is read back from the SYSTEM rather than from
                    // what we think we added — the only number that matches
                    // what will actually ring.
                    self.center.getPendingNotificationRequests { pending in
                        let ours = pending.filter { $0.identifier.hasPrefix(Self.prefix) }
                        call.resolve([
                            "scheduled": scheduled.count,
                            "pending": ours.count,
                            "failures": failures
                        ])
                    }
                }
            }
        }
    }

    // MARK: - Inspect / clear

    @objc func pending(_ call: CAPPluginCall) {
        center.getPendingNotificationRequests { requests in
            let ours = requests.filter { $0.identifier.hasPrefix(Self.prefix) }
            call.resolve([
                "count": ours.count,
                "ids": ours.map { String($0.identifier.dropFirst(Self.prefix.count)) }
            ])
        }
    }

    @objc func cancelAll(_ call: CAPPluginCall) {
        cancelOwned { call.resolve(["ok": true]) }
    }

    // Remove only the requests this plugin owns, then continue.
    private func cancelOwned(_ done: @escaping () -> Void) {
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { done(); return }
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            if !ids.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: ids)
            }
            done()
        }
    }

    // MARK: - Coercion

    // JS numbers arrive as NSNumber, Int or Double depending on the bridge —
    // `as? Int` alone silently fails on a Double and the alarm loses its hour.
    private static func intValue(_ value: Any?) -> Int? {
        if let i = value as? Int { return i }
        if let n = value as? NSNumber { return n.intValue }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String { return Int(s) }
        return nil
    }

    private static func date(from iso: String) -> Date? {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let d = plain.date(from: iso) { return d }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso)
    }
}
