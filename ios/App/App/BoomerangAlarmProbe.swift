import Capacitor
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

/// A user-triggered local experiment, separate from all existing reminder ownership.
@objc(BoomerangAlarmProbe)
public class BoomerangAlarmProbe: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomerangAlarmProbe"
    public let jsName = "BoomerangAlarmProbe"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleTest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelTest", returnType: CAPPluginReturnPromise)
    ]

    @objc func getStatus(_ call: CAPPluginCall) { perform(call, action: "status") }
    @objc func requestPermission(_ call: CAPPluginCall) { perform(call, action: "permission") }
    @objc func scheduleTest(_ call: CAPPluginCall) { perform(call, action: "schedule") }
    @objc func cancelTest(_ call: CAPPluginCall) { perform(call, action: "cancel") }

    private func perform(_ call: CAPPluginCall, action: String) {
        #if BOOMERANG_ALARM_PROBE && canImport(AlarmKit)
        if #available(iOS 26.1, *) {
            Task { @MainActor in
                do { call.resolve(try await AlarmProbeService.shared.perform(action)) }
                catch { call.reject(error.localizedDescription) }
            }
            return
        }
        call.resolve(["available": false, "error": "The alarm test needs iOS 26.1 or newer."])
        #else
        call.resolve(["available": false, "error": "Update Boomerang on this iPhone (iOS 26.1+) to use alarms."])
        #endif
    }
}

#if BOOMERANG_ALARM_PROBE && canImport(AlarmKit)
@available(iOS 26.1, *)
@MainActor
private final class AlarmProbeService {
    static let shared = AlarmProbeService()
    // A fixed, dedicated ID survives WebView/process restarts. AlarmManager scopes
    // IDs to the app; Dev and production remain separate clients. Never cancel all.
    private let id = UUID(uuidString: "6C325A61-D308-4F9A-BE0F-4B5B741EE825")!
    private let manager = AlarmManager.shared
    private var busy = false

    func perform(_ action: String) async throws -> [String: Any] {
        guard !busy else { throw failure("An alarm test operation is already running.") }
        busy = true
        defer { busy = false }
        switch action {
        case "permission":
            _ = try await manager.requestAuthorization()
        case "schedule":
            guard manager.authorizationState == .authorized else {
                throw failure("Allow alarm permission before scheduling the test.")
            }
            guard try ownAlarm() == nil else {
                throw failure("A test alarm already exists. Cancel it before starting another.")
            }
            let alert = AlarmPresentation.Alert(
                title: "Boomerang sound test",
                secondaryButton: AlarmButton(text: "Snooze 1 min", textColor: .white, systemImageName: "zzz"),
                secondaryButtonBehavior: .countdown)
            let presentation = AlarmPresentation(
                alert: alert,
                countdown: AlarmPresentation.Countdown(title: "Sound test snoozed"))
            let attributes = AlarmAttributes(
                presentation: presentation, metadata: AlarmProbeMetadata(), tintColor: Color.orange)
            let configuration = AlarmManager.AlarmConfiguration(
                countdownDuration: Alarm.CountdownDuration(preAlert: nil, postAlert: 60),
                schedule: .fixed(Date().addingTimeInterval(60)),
                attributes: attributes)
            _ = try await manager.schedule(id: id, configuration: configuration)
            guard try ownAlarm() != nil else {
                throw failure("iOS did not list the test alarm after scheduling. Check status before retrying.")
            }
        case "cancel":
            // Do not require a WebView snapshot or a newly granted permission to
            // attempt cleanup. A failed daemon read is an error, never empty success.
            if try ownAlarm() != nil { try manager.cancel(id: id) }
            guard try ownAlarm() == nil else { throw failure("iOS still lists the test alarm.") }
        default: break
        }
        return try snapshot()
    }

    private func ownAlarm() throws -> Alarm? {
        try manager.alarms.first { $0.id == id }
    }

    private func snapshot() throws -> [String: Any] {
        let authorization: String
        switch manager.authorizationState {
        case .authorized: authorization = "authorized"
        case .denied: authorization = "denied"
        case .notDetermined: authorization = "notDetermined"
        @unknown default: authorization = "unknown"
        }
        // Permission checks must not force a daemon read before authorization.
        // A denial is visible, not a claim that a previous alarm was cancelled.
        let alarm: Alarm?
        if authorization == "authorized" { alarm = try ownAlarm() }
        else { alarm = nil }
        var result: [String: Any] = ["available": true, "authorization": authorization]
        if let alarm {
            let state: String
            switch alarm.state {
            case .scheduled: state = "scheduled"
            case .countdown: state = "countdown"
            case .paused: state = "paused"
            case .alerting: state = "alerting"
            @unknown default: state = "unknown"
            }
            result["alarm"] = ["id": "boomerang-alarm-probe", "state": state]
        } else { result["alarm"] = NSNull() }
        return result
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "BoomerangAlarmProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
#endif
