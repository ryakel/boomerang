import Capacitor
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import CoreLocation
import CryptoKit
import SwiftUI
import UIKit
import UserNotifications
#endif

@objc(BoomerangAlarmRules)
public class BoomerangAlarmRules: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangAlarmRules"
    public let jsName = "BoomerangAlarmRules"
    public let pluginMethods: [CAPPluginMethod] = ["getStatus", "applyPlan", "acknowledge", "cancelAll", "cancelRules", "markSynced",
                                                   "arrivalSynced", "dropPlaces", "locationStatus", "requestLocation", "currentLocation", "geocode"].compactMap {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    @objc func getStatus(_ call: CAPPluginCall) { run(call, "status") }
    @objc func applyPlan(_ call: CAPPluginCall) { run(call, "apply") }
    @objc func acknowledge(_ call: CAPPluginCall) { run(call, "ack") }
    @objc func cancelAll(_ call: CAPPluginCall) { run(call, "cancel") }
    @objc func cancelRules(_ call: CAPPluginCall) { run(call, "cancelRules") }
    @objc func markSynced(_ call: CAPPluginCall) { run(call, "synced") }
    // Arriving as done (BOOM-53). Location calls don't take the alarm lock:
    // they read or ask for location and never touch owned cues.
    @objc func arrivalSynced(_ call: CAPPluginCall) { run(call, "arrivalSynced") }
    @objc func dropPlaces(_ call: CAPPluginCall) { run(call, "dropPlaces") }
    @objc func locationStatus(_ call: CAPPluginCall) { runLocation(call, "status") }
    @objc func requestLocation(_ call: CAPPluginCall) { runLocation(call, "request") }
    @objc func currentLocation(_ call: CAPPluginCall) { runLocation(call, "current") }
    @objc func geocode(_ call: CAPPluginCall) { runLocation(call, "geocode") }
    private func runLocation(_ call: CAPPluginCall, _ action: String) {
        #if BOOMERANG_ALARM_PROBE && canImport(AlarmKit)
        if #available(iOS 26.1, *) {
            Task { @MainActor in
                do { call.resolve(try await ArrivalMonitor.shared.perform(action, call)) }
                catch { call.reject(error.localizedDescription) }
            }
            return
        }
        #endif
        call.resolve(["available": false, "error": "Use the updated Boomerang Dev app on iOS 26.1+."])
    }
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
// A place whose arrival counts as done for a rule's day (BOOM-53). Sent with
// each arming; only the coordinates the owner saved, never a location history.
@available(iOS 26.1, *)
struct ArrivalPlace: Codable, Equatable {
    var ruleId: String
    var latitude: Double
    var longitude: Double
    var radius: Double
    var label: String
}
// "Arrived at School" for one occurrence. Durable before anything else
// happens, like an acknowledgment receipt; the web marks the loop done on sync.
@available(iOS 26.1, *)
struct ArrivalReceipt: Codable {
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
    // Optional on purpose: a file written before BOOM-53 has neither key, and a
    // required one would fail to decode and mark the whole store unreadable.
    var places: [String: ArrivalPlace]? = nil
    var arrivals: [String: ArrivalReceipt]? = nil
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
    // The disposable probe's one fixed alarm (BoomerangAlarmProbe.swift). The
    // only AlarmKit alarm this app makes outside the ledger; never reclaimed.
    private static let probeAlarmId = UUID(uuidString: "6C325A61-D308-4F9A-BE0F-4B5B741EE825")!
    // AlarmKit's one documented error, maximumLimitReached, reaches us as
    // "com.apple.AlarmKit.Alarm error 0". iOS sets the limit per device and
    // state and documents no number (BOOM-56).
    private func isLimit(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == "com.apple.AlarmKit.Alarm" && e.code == 0
    }
    // Schedule, retrying once on the limit: a slot a cancel just freed may not
    // be free yet, and a re-arm always cancels a cue right before replacing it.
    // A thrown schedule is a definite no, not a lost reply, so the cue is
    // marked cancelled (the next arming schedules it again) instead of being
    // left "uncertain", which refuses every later arming.
    private func scheduleOwned(_ cue: OwnedAlarmCue, key: String) async throws {
        do {
            do { try await schedule(cue) }
            catch let limited where isLimit(limited) {
                try await Task.sleep(nanoseconds: 1_000_000_000)
                try await schedule(cue)
            }
        } catch {
            if !((try? alarms())?.contains(where: { $0.id == cue.id }) ?? false) {
                disk.cues[key]?.cancelled = true; try? save()
            }
            guard isLimit(error) else { throw error }
            let held = (try? alarms().count) ?? 0
            throw self.error("iOS won’t take another alarm for Boomerang right now. It holds \(held) for this app. Try again in a minute; if it keeps refusing, fewer alarms fit on this phone.")
        }
    }
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
            let rawPlaces = call.getArray("places", JSObject.self) ?? []
            let places = try JSONDecoder().decode([ArrivalPlace].self, from: try JSONSerialization.data(withJSONObject: rawPlaces))
            for place in places {
                let ruleArmed = entries.contains(where: { entry in entry.ruleId == place.ruleId })
                guard ruleArmed, (-90.0...90.0).contains(place.latitude), (-180.0...180.0).contains(place.longitude),
                      (50.0...1000.0).contains(place.radius), !place.label.isEmpty, place.label.count <= 80 else {
                    throw error("Invalid arrival place. Refresh the preview.")
                }
            }
            let active = try alarms()
            guard !active.contains(where: { alarm in disk.cues.values.contains { $0.id == alarm.id } && alarm.state != .scheduled }) else {
                throw error("An owned alarm is ringing or snoozed. Acknowledge or cancel it before changing the plan.")
            }
            // Reclaim: an alarm iOS holds for this app that no live cue owns
            // still counts against iOS's alarm limit and nothing would ever
            // cancel it. Only the ledger and the probe make alarms here.
            let ownedLive = Set(disk.cues.values.filter { !$0.cancelled }.map(\.id))
            for alarm in active where alarm.id != Self.probeAlarmId && !ownedLive.contains(alarm.id) && alarm.state == .scheduled {
                try manager.cancel(id: alarm.id)
            }
            let incoming = Set(entries.map(\.key))
            try cancel(disk.cues.keys.filter { !incoming.contains(disk.cues[$0]!.entry.key) })
            // A day already done on this phone (the done button, or an arrival
            // not yet synced to the server) is never scheduled again.
            for entry in entries where disk.receipts[entry.key] == nil && disk.arrivals?[entry.key] == nil {
                for early in [false, true] {
                    if early && (!entry.earlyPending || entry.early <= now) { continue }
                    let key = entry.key + (early ? ":early" : ":target")
                    var fresh = false
                    if let old = disk.cues[key] {
                        let live = active.contains(where: { $0.id == old.id })
                        // An unconfirmed cue iOS does list did get scheduled.
                        // One it doesn't list is scheduled again below: the
                        // id was persisted first and iOS doesn't hold it, so
                        // this can't duplicate an alarm. It used to refuse
                        // every later arming until Turn off (BOOM-56).
                        if !old.cancelled && !old.accepted && live { disk.cues[key]?.accepted = true; try save() }
                        if !old.cancelled && live && old.entry == entry { continue }
                        // Anything else in the plan is scheduled again: a cue
                        // cancelled by Turn off, a day dropped and added back,
                        // a day the 16-slot window let go of, one iOS no longer
                        // lists. This used to `continue` on a cancelled cue, so
                        // arming after Turn off silently did nothing (BOOM-56).
                        // Only a deliberate arming gets here, and the plan holds
                        // only times still ahead (an early cue whose time passed
                        // is skipped above), so an alarm you stopped never returns.
                        if live { try cancel([key]) }
                        fresh = true
                    }
                    // A re-created cue gets a new id so it never collides with
                    // one iOS is still tearing down.
                    let cue = OwnedAlarmCue(id: fresh ? UUID() : cueId(key), entry: entry, earlyCue: early, accepted: false)
                    disk.cues[key] = cue; try save() // Own the ID even if scheduling reply is lost.
                    try await scheduleOwned(cue, key: key)
                    guard try alarms().contains(where: { $0.id == cue.id }) else { throw error("An alarm was not found after arming. Check status; do not retry blindly.") }
                    disk.cues[key]?.accepted = true; try save()
                }
            }
            disk.places = Dictionary(places.map { place in (place.ruleId, place) }, uniquingKeysWith: { first, _ in first })
            try save()
            syncRegions()
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
        case "cancel":
            try cancel(Array(disk.cues.keys))
            disk.places = [:]; try save(); syncRegions()
        case "cancelRules":
            let rules = Set(call.getArray("ruleIds", String.self) ?? [])
            let keys = Set(call.getArray("keys", String.self) ?? [])
            try cancel(disk.cues.keys.filter { rules.contains(disk.cues[$0]!.entry.ruleId) || keys.contains(disk.cues[$0]!.entry.key) })
            if !rules.isEmpty {
                disk.places = (disk.places ?? [:]).filter { item in !rules.contains(item.key) }
                try save()
            }
            syncRegions()
        case "dropPlaces":
            // Stop watching places whose arrival was switched off. Never cancels a cue.
            let rules = Set(call.getArray("ruleIds", String.self) ?? [])
            disk.places = (disk.places ?? [:]).filter { item in !rules.contains(item.key) }
            try save()
            syncRegions()
        case "arrivalSynced":
            if let key = call.getString("key"), disk.arrivals?[key] != nil { disk.arrivals?[key]?.synced = true; try save() }
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
        let arrivals = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Array((disk.arrivals ?? [:]).values)))
        return ["available": true, "authorization": auth, "deviceId": disk.deviceId, "cues": rows, "receipts": receipts,
                "systemAlarms": active.count,
                "arrivals": arrivals, "placeRules": Array((disk.places ?? [:]).keys), "lastError": disk.lastError ?? ""]
    }

    // ── Arriving as done (BOOM-53) ─────────────────────────────────────────
    // Monitor a place only while its rule has an alarm still to come (or one
    // within the hour after its target). Called after every plan change.
    private func syncRegions() {
        let now = Date().timeIntervalSince1970
        let live = (disk.places ?? [:]).values.filter { place in
            disk.cues.values.contains { cue in cue.entry.ruleId == place.ruleId && !cue.cancelled && cue.entry.target + 3600 > now }
        }
        ArrivalMonitor.shared.monitor(Array(live))
    }

    // iOS reports entering a saved place. It counts only within an hour either
    // side of that day's alarm target, and only once per occurrence. It stops
    // the occurrence's remaining cues (like the done button), records an
    // arrival the web turns into "marked done", and posts a quiet notice so a
    // false arrival is noticed before the pickup is missed.
    func arrive(ruleId: String) async {
        guard !corrupt, let place = disk.places?[ruleId] else { return }
        let now = Date().timeIntervalSince1970
        let candidates = disk.cues.values.filter { cue in
            !cue.earlyCue && cue.entry.ruleId == ruleId && abs(cue.entry.target - now) <= ArrivalMonitor.window
                && (!cue.cancelled || disk.receipts[cue.entry.key] != nil)
        }
        guard let cue = candidates.min(by: { a, b in abs(a.entry.target - now) < abs(b.entry.target - now) }) else { return }
        let key = cue.entry.key
        if disk.arrivals?[key] != nil { return }
        var arrivals = disk.arrivals ?? [:]
        arrivals[key] = ArrivalReceipt(key: key, ruleId: ruleId, date: cue.entry.date, label: "Arrived at \(place.label)", recordedAt: now)
        disk.arrivals = arrivals
        do { try save() } catch { disk.lastError = "An arrival could not be saved."; return }
        let openKeys = disk.cues.keys.filter { id in disk.cues[id]?.entry.key == key && disk.cues[id]?.cancelled == false }
        do { try cancel(openKeys) } catch { disk.lastError = "Arrived, but an alarm could not be cancelled. Check status."; try? save() }
        ArrivalMonitor.postArrivalNotice(title: cue.entry.title, label: place.label, at: now)
    }
}

// One CLLocationManager for the app's life, created at launch (AppDelegate),
// because iOS relaunches the app in the background to deliver a region entry
// and the delegate has to exist by then. Delegate callbacks arrive on the main
// thread, where this manager was made.
@available(iOS 26.1, *)
final class ArrivalMonitor: NSObject, CLLocationManagerDelegate {
    static let shared = ArrivalMonitor()
    // An arrival counts from 1 hour before to 1 hour after the alarm (owner,
    // 2026-11-21). Mirrored by ARRIVAL_WINDOW_MINUTES in src/alarmRuleModel.js.
    static let window: Double = 3600
    private static let prefix = "boomerang.arrive:"
    private let manager = CLLocationManager()
    private var authWaiters: [CheckedContinuation<Void, Never>] = []
    private var locationWaiters: [CheckedContinuation<CLLocation, Error>] = []
    private var lastMonitorError: String? = nil

    override init() {
        super.init()
        manager.delegate = self
    }

    func start() { _ = manager.monitoredRegions }

    func monitor(_ places: [ArrivalPlace]) {
        let wanted = Dictionary(places.map { place in (Self.prefix + place.ruleId, place) }, uniquingKeysWith: { first, _ in first })
        for region in manager.monitoredRegions where region.identifier.hasPrefix(Self.prefix) && wanted[region.identifier] == nil {
            manager.stopMonitoring(for: region)
        }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        for (identifier, place) in wanted {
            let center = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
            let region = CLCircularRegion(center: center, radius: min(place.radius, manager.maximumRegionMonitoringDistance), identifier: identifier)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            manager.startMonitoring(for: region)
        }
    }

    func status() -> [String: Any] {
        let auth: String
        switch manager.authorizationStatus {
        case .authorizedAlways: auth = "always"
        case .authorizedWhenInUse: auth = "whenInUse"
        case .denied: auth = "denied"
        case .restricted: auth = "restricted"
        case .notDetermined: auth = "notDetermined"
        @unknown default: auth = "unknown"
        }
        let monitored = manager.monitoredRegions.filter { region in region.identifier.hasPrefix(Self.prefix) }.count
        return ["available": true, "authorization": auth, "precise": manager.accuracyAuthorization == .fullAccuracy,
                "monitoring": CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
                "monitored": monitored, "lastError": lastMonitorError ?? ""]
    }

    // Main actor: the manager, its waiters and its delegate callbacks all live
    // on the main thread (an unmarked async func would hop off it).
    @MainActor func perform(_ action: String, _ call: CAPPluginCall) async throws -> [String: Any] {
        switch action {
        case "request":
            // iOS asks for "While Using" first; "Always" is a second, separate ask.
            if manager.authorizationStatus == .notDetermined {
                await waitForAuthorization { self.manager.requestWhenInUseAuthorization() }
            }
            if call.getBool("always") == true && manager.authorizationStatus == .authorizedWhenInUse {
                await waitForAuthorization { self.manager.requestAlwaysAuthorization() }
            }
            return status()
        case "current":
            let location = try await currentLocation()
            var out = status()
            out["latitude"] = location.coordinate.latitude
            out["longitude"] = location.coordinate.longitude
            out["accuracy"] = location.horizontalAccuracy
            return out
        case "geocode":
            let address = (call.getString("address") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !address.isEmpty, address.count <= 300 else { throw failure("Enter an address.") }
            let marks = try await CLGeocoder().geocodeAddressString(address)
            guard let mark = marks.first, let location = mark.location else { throw failure("No match for that address.") }
            var out = status()
            out["latitude"] = location.coordinate.latitude
            out["longitude"] = location.coordinate.longitude
            out["name"] = [mark.name, mark.locality].compactMap { $0 }.joined(separator: ", ")
            return out
        default:
            return status()
        }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "BoomerangArrival", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    // The permission sheet may be answered late, or (for Always) not change
    // anything; resolve on the next change or after 30 seconds, whichever is
    // first, and let the caller read the status again.
    @MainActor private func waitForAuthorization(_ ask: () -> Void) async {
        await withCheckedContinuation { (waiter: CheckedContinuation<Void, Never>) in
            authWaiters.append(waiter)
            ask()
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.flushAuthorization() }
        }
    }
    private func flushAuthorization() {
        let waiters = authWaiters
        authWaiters = []
        for waiter in waiters { waiter.resume() }
    }

    @MainActor private func currentLocation() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { (waiter: CheckedContinuation<CLLocation, Error>) in
            locationWaiters.append(waiter)
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { flushAuthorization() }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let waiters = locationWaiters
        locationWaiters = []
        for waiter in waiters { waiter.resume(returning: location) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let waiters = locationWaiters
        locationWaiters = []
        for waiter in waiters { waiter.resume(throwing: error) }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(Self.prefix) else { return }
        let ruleId = String(region.identifier.dropFirst(Self.prefix.count))
        Task { @MainActor in
            // A region entry may relaunch the app in the background; ask for a
            // little time so the arrival, cancellation and notice all finish.
            let task = UIApplication.shared.beginBackgroundTask(withName: "boomerang.arrival")
            await AlarmRulesService.shared.arrive(ruleId: ruleId)
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        lastMonitorError = error.localizedDescription
    }

    // Quiet: a banner with no sound. The owner wants a false arrival noticed
    // before a pickup is missed, so it isn't silent in the notification list.
    static func postArrivalNotice(title: String, label: String, at: Double) {
        let content = UNMutableNotificationContent()
        let time = DateFormatter.localizedString(from: Date(timeIntervalSince1970: at), dateStyle: .none, timeStyle: .short)
        content.title = "Arrived at \(label), \(time)"
        content.body = "\(title) is done for today. The rest of today's alarms are off."
        content.sound = nil
        content.interruptionLevel = .active
        let request = UNNotificationRequest(identifier: "boomerang.arrival.\(Int(at))", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
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
