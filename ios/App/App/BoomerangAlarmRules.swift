import Capacitor
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import CryptoKit
import SwiftUI
#endif

@objc(BoomerangAlarmRules)
public class BoomerangAlarmRules: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangAlarmRules"
    public let jsName = "BoomerangAlarmRules"
    public let pluginMethods: [CAPPluginMethod] = ["getStatus", "applyPlan", "acknowledge", "cancelAll", "cancelRules", "markSynced"].compactMap {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    @objc func getStatus(_ call: CAPPluginCall) { run(call, "status") }
    @objc func applyPlan(_ call: CAPPluginCall) { run(call, "apply") }
    @objc func acknowledge(_ call: CAPPluginCall) { run(call, "ack") }
    @objc func cancelAll(_ call: CAPPluginCall) { run(call, "cancel") }
    @objc func cancelRules(_ call: CAPPluginCall) { run(call, "cancelRules") }
    @objc func markSynced(_ call: CAPPluginCall) { run(call, "synced") }
    private func run(_ call: CAPPluginCall, _ action: String) {
        #if BOOMERANG_ALARM_PROBE && canImport(AlarmKit)
        if #available(iOS 26.1, *) {
            Task { @MainActor in
                do { call.resolve(try await AlarmRulesService.shared.perform(action, call)) }
                catch { call.reject(error.localizedDescription) }
            }
            return
        }
        #endif
        call.resolve(["available": false, "error": "Use the updated Boomerang Dev app on iOS 26.1+."])
    }
}

#if BOOMERANG_ALARM_PROBE && canImport(AlarmKit)
@available(iOS 26.1, *)
struct AlarmRuleEntry: Codable, Equatable {
    var key: String
    var ruleId: String
    var date: String
    var target: Double
    var early: Double
    var title: String
    var ackLabel: String
    var snoozeMinutes: Int
    var timeZone: String
    var sourceKind: String
    var sourceId: String
    var earlyPending: Bool
    var occurrence: String { key }
}
@available(iOS 26.1, *)
struct OwnedAlarmCue: Codable {
    var id: UUID
    var entry: AlarmRuleEntry
    var earlyCue: Bool
    var accepted: Bool
    var cancelled: Bool = false
}
@available(iOS 26.1, *)
struct AlarmRuleReceipt: Codable {
    var key: String
    var ruleId: String
    var date: String
    var label: String
    var recordedAt: Double
    var synced: Bool = false
}
@available(iOS 26.1, *)
struct AlarmRulesDisk: Codable {
    var deviceId = UUID().uuidString
    var cues: [String: OwnedAlarmCue] = [:]
    var receipts: [String: AlarmRuleReceipt] = [:]
    var lastError: String? = nil
}
@available(iOS 26.1, *)
@MainActor
final class AlarmRulesService {
    static let shared = AlarmRulesService()
    private let manager = AlarmManager.shared
    private static var fileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("alarm-rules-v1.json")
    }
    private var busy = false
    private var disk: AlarmRulesDisk
    private var corrupt = false
    private init() {
        if FileManager.default.fileExists(atPath: Self.fileURL.path) {
            let data = (try? Data(contentsOf: Self.fileURL)) ?? Data()
            do { disk = try JSONDecoder().decode(AlarmRulesDisk.self, from: data) }
            catch { disk = AlarmRulesDisk(); corrupt = true }
        } else { disk = AlarmRulesDisk() }
    }
    private func save() throws {
        guard !corrupt else { throw error("Alarm ownership storage could not be read. Do not arm more alarms.") }
        try FileManager.default.createDirectory(at: Self.fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(disk).write(to: Self.fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func error(_ message: String) -> NSError { NSError(domain: "BoomerangAlarmRules", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func cueId(_ key: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(("boomerang.rules:" + key).utf8)).prefix(16))
        return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
    }
    private func alarms() throws -> [Alarm] { try manager.alarms }
    private func cancel(_ keys: [String]) throws {
        let active = Set(try alarms().map(\.id))
        // Persist cancellation intent before daemon mutation. Resume never re-adds these.
        for key in keys { if var cue = disk.cues[key] { cue.cancelled = true; disk.cues[key] = cue } }
        try save()
        for key in keys { if let cue = disk.cues[key], active.contains(cue.id) { try manager.cancel(id: cue.id) } }
        let remaining = Set(try alarms().map(\.id))
        if keys.contains(where: { key in disk.cues[key].map { remaining.contains($0.id) } ?? false }) {
            throw error("Some alarms remain scheduled. Check status and retry cancellation.")
        }
    }
    func perform(_ action: String, _ call: CAPPluginCall) async throws -> [String: Any] {
        guard !busy else { throw error("An alarm operation is still running.") }
        busy = true; defer { busy = false }
        guard !corrupt else { throw error("Alarm ownership storage is unreadable. Existing alarms require native review.") }
        switch action {
        case "apply":
            guard manager.authorizationState == .authorized else { throw error("Allow alarm permission in Test channels before arming.") }
            guard call.getString("deviceId") == disk.deviceId else { throw error("This plan belongs to another phone.") }
            let raw = call.getArray("items", JSObject.self) ?? []
            guard raw.count <= 16 else { throw error("At most 16 occurrences fit in this trial. Narrow the schedule.") }
            let data = try JSONSerialization.data(withJSONObject: raw)
            // JS ISO dates are converted to epoch seconds before crossing the bridge.
            let entries = try JSONDecoder().decode([AlarmRuleEntry].self, from: data)
            let now = Date().timeIntervalSince1970
            guard Set(entries.map(\.key)).count == entries.count else { throw error("Duplicate occurrences.") }
            for entry in entries {
                guard UUID(uuidString: entry.ruleId) != nil, entry.key == "\(entry.ruleId):\(entry.date)",
                      entry.date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                      entry.target > now, entry.target < now + 35*86400,
                      entry.early < entry.target, entry.early >= entry.target - 120*60,
                      entry.title.count <= 200, !entry.title.isEmpty, entry.ackLabel.count <= 60,
                      TimeZone(identifier: entry.timeZone) != nil,
                      (1...30).contains(entry.snoozeMinutes), ["task", "routine"].contains(entry.sourceKind) else { throw error("Invalid alarm plan. Refresh the preview.") }
            }
            let active = try alarms()
            guard !active.contains(where: { alarm in disk.cues.values.contains { $0.id == alarm.id } && alarm.state != .scheduled }) else {
                throw error("An owned alarm is ringing or snoozed. Acknowledge or cancel it before changing the plan.")
            }
            let incoming = Set(entries.map(\.key))
            try cancel(disk.cues.keys.filter { !incoming.contains(disk.cues[$0]!.entry.key) })
            for entry in entries where disk.receipts[entry.key] == nil {
                for early in [false, true] {
                    if early && (!entry.earlyPending || entry.early <= now) { continue }
                    let key = entry.key + (early ? ":early" : ":target")
                    if let old = disk.cues[key] {
                        // Missing accepted cues may have been stopped/expired; never recreate them.
                        if old.cancelled { continue }
                        if !old.accepted {
                            guard active.contains(where: { $0.id == old.id }) else { throw error("A previous scheduling outcome is uncertain. Cancel rule alarms and review native status before continuing.") }
                            disk.cues[key]?.accepted = true; try save()
                            continue
                        }
                        if old.entry == entry { continue }
                        guard active.contains(where: { $0.id == old.id }) else { continue }
                        try cancel([key])
                    }
                    let cue = OwnedAlarmCue(id: cueId(key), entry: entry, earlyCue: early, accepted: false)
                    disk.cues[key] = cue; try save() // Own the ID even if scheduling reply is lost.
                    try await schedule(cue)
                    guard try alarms().contains(where: { $0.id == cue.id }) else { throw error("An alarm was not found after arming. Check status; do not retry blindly.") }
                    disk.cues[key]?.accepted = true; try save()
                }
            }
        case "ack":
            guard let key = call.getString("key"), let cue = disk.cues.values.first(where: { $0.entry.key == key }) else { throw error("Unknown occurrence.") }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: cue.entry.timeZone)
            formatter.dateFormat = "yyyy-MM-dd"
            guard formatter.string(from: Date()) == cue.entry.date else { throw error("Only today's occurrence can be acknowledged.") }
            // Durable local declaration first. It is not task completion or proof of departure.
            if disk.receipts[key] == nil {
                disk.receipts[key] = AlarmRuleReceipt(key: key, ruleId: cue.entry.ruleId, date: cue.entry.date, label: cue.entry.ackLabel, recordedAt: Date().timeIntervalSince1970)
                try save()
            }
            try cancel(disk.cues.keys.filter { disk.cues[$0]?.entry.key == key })
        case "cancel": try cancel(Array(disk.cues.keys))
        case "cancelRules":
            let rules = Set(call.getArray("ruleIds", String.self) ?? [])
            let keys = Set(call.getArray("keys", String.self) ?? [])
            try cancel(disk.cues.keys.filter { rules.contains(disk.cues[$0]!.entry.ruleId) || keys.contains(disk.cues[$0]!.entry.key) })
        case "synced":
            if let key = call.getString("key"), disk.receipts[key] != nil { disk.receipts[key]?.synced = true; try save() }
        default: try save()
        }
        return try snapshot()
    }
    private func schedule(_ cue: OwnedAlarmCue, fireAt: Double? = nil) async throws {
        let e = cue.entry
        let text: LocalizedStringResource = "\(e.title)"
        let button: LocalizedStringResource = cue.earlyCue ? "Snooze until next cue" : "Snooze \(e.snoozeMinutes) min"
        let alert = AlarmPresentation.Alert(title: text, secondaryButton: AlarmButton(text: button, textColor: .white, systemImageName: "zzz"), secondaryButtonBehavior: cue.earlyCue ? .custom : .countdown)
        let presentation = AlarmPresentation(alert: alert, countdown: AlarmPresentation.Countdown(title: text))
        let attributes = AlarmAttributes(presentation: presentation, metadata: AlarmProbeMetadata(title: e.title, detail: "Stop silences sound; acknowledgment is in Boomerang."), tintColor: Color.orange)
        let intent: (any LiveActivityIntent)? = cue.earlyCue ? AlarmEarlySnoozeIntent(cueID: cue.id.uuidString) : nil
        let config = AlarmManager.AlarmConfiguration(countdownDuration: cue.earlyCue ? nil : Alarm.CountdownDuration(preAlert: nil, postAlert: Double(e.snoozeMinutes*60)), schedule: .fixed(Date(timeIntervalSince1970: fireAt ?? (cue.earlyCue ? e.early : e.target))), attributes: attributes, secondaryIntent: intent)
        _ = try await manager.schedule(id: cue.id, configuration: config)
        guard try alarms().contains(where: { $0.id == cue.id }) else { throw error("The scheduled cue was not found in iOS. Check status before retrying.") }
    }
    func snoozeEarly(_ id: String) async throws {
        guard !busy, let key = disk.cues.first(where: { $0.value.id.uuidString == id && $0.value.earlyCue })?.key, let cue = disk.cues[key], !cue.cancelled, disk.receipts[cue.entry.key] == nil else { throw error("This cue is no longer active.") }
        busy = true; defer { busy = false }
        let next = Date().timeIntervalSince1970 + Double(cue.entry.snoozeMinutes*60)
        try manager.stop(id: cue.id)
        // The independently scheduled target wins over a snooze crossing it.
        if next < cue.entry.target - 1 {
            do { try await schedule(cue, fireAt: next); disk.lastError = nil; try save() }
            catch { disk.lastError = "Early snooze could not be confirmed. The independently scheduled target remains unchanged."; try? save(); throw error }
        }
    }
    private func snapshot() throws -> [String: Any] {
        let auth: String
        switch manager.authorizationState {
        case .authorized: auth = "authorized"
        case .denied: auth = "denied"
        case .notDetermined: auth = "notDetermined"
        @unknown default: auth = "unknown"
        }
        let active = auth == "authorized" ? try alarms() : []
        let rows: [[String: Any]] = disk.cues.values.map { cue in
            let alarm = active.first { $0.id == cue.id }
            let state: String
            if let alarm {
                switch alarm.state {
                case .scheduled: state = "scheduled"
                case .countdown: state = "countdown"
                case .paused: state = "paused"
                case .alerting: state = "alerting"
                @unknown default: state = "unknown"
                }
            } else { state = cue.cancelled ? "cancelled" : (cue.accepted ? "not-listed" : "uncertain") }
            return ["key": cue.entry.key, "ruleId": cue.entry.ruleId, "date": cue.entry.date, "title": cue.entry.title, "ackLabel": cue.entry.ackLabel, "target": cue.entry.target, "timeZone": cue.entry.timeZone, "sourceKind": cue.entry.sourceKind, "sourceId": cue.entry.sourceId, "earlyCue": cue.earlyCue, "state": state]
        }
        let receipts = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Array(disk.receipts.values)))
        return ["available": true, "authorization": auth, "deviceId": disk.deviceId, "cues": rows, "receipts": receipts, "lastError": disk.lastError ?? ""]
    }
}
@available(iOS 26.1, *)
struct AlarmEarlySnoozeIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Snooze an early cue"
    @Parameter(title: "Owned cue") var cueID: String
    init() {}
    init(cueID: String) { self.cueID = cueID }
    @MainActor func perform() async throws -> some IntentResult {
        try await AlarmRulesService.shared.snoozeEarly(cueID)
        return .result()
    }
}
#endif
