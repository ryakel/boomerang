import Foundation
import WatchConnectivity
import BoomerangKit

// Phone side of the watch companion (see Shared/WatchProtocol.swift for why the
// phone proxies every request instead of letting the watch talk to the server).
//
// Two directions:
//   - REPLY: the watch sends {op: …} and waits; we call the API through
//     BoomerangKit and reply. Mutations reply with a FRESH /api/today payload
//     so the watch redraws from server truth rather than guessing locally.
//   - PUSH: after the app foregrounds we push the current payload as the
//     application context, so a wrist-raise has something real to show
//     immediately even before its own request lands.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    // Called from AppDelegate.didFinishLaunchingWithOptions so it also runs on
    // the background launch iOS performs to answer a watch message. Idempotent:
    // launch paths can overlap and re-activating an active session is pointless.
    private var activated = false

    func activate() {
        guard let session else { return } // iPad / simulator without a paired watch
        guard !activated else { return }
        activated = true
        session.delegate = self
        session.activate()
    }

    // Best-effort snapshot push. Failures are LOGGED now, not silent — the old
    // `try?` here hid the same defect plistSafe() exists to fix, so the
    // wrist-raise path could be broken for weeks with no trace anywhere.
    func pushTodaySnapshot() {
        guard let session, session.activationState == .activated, session.isPaired,
              session.isWatchAppInstalled, BoomerangAPI.isConfigured else { return }
        Task {
            guard let payload = try? await fetchToday() else { return }
            do {
                try session.updateApplicationContext([
                    WatchMsg.payload: payload,
                    WatchMsg.stamp: Date().timeIntervalSince1970,
                ])
            } catch {
                NSLog("[WatchBridge] context push failed: %@", error.localizedDescription)
            }
        }
    }

    // WatchConnectivity dictionaries may contain ONLY property-list types.
    // JSON `null` deserializes to NSNull, which is NOT one — and /api/today
    // emits `timer: null` unconditionally (taskModel.js `todayPayload`), plus
    // per-task nulls for first_step / intention_* / due_date / size / energy /
    // impact. So every data-bearing reply this bridge ever sent contained
    // NSNull, and WC rejects the whole dictionary: on the wrist that reads
    // "Payload could not be delivered" — indistinguishable from the phone not
    // listening, which is why the 2026-07-26 investigation went to launch,
    // pairing and signing and found them all healthy (they were).
    //
    // Dropping null-valued keys is behavior-preserving: the watch reads every
    // one of these fields with `as?` optionals, and an absent key decodes the
    // same as a null one.
    private func plistSafe(_ any: Any) -> Any? {
        switch any {
        case is NSNull:
            return nil
        case let dict as [String: Any]:
            return dict.compactMapValues { plistSafe($0) }
        case let array as [Any]:
            return array.compactMap { plistSafe($0) }
        default:
            return any // String / NSNumber / Bool / Date / Data
        }
    }

    private func fetchToday() async throws -> [String: Any] {
        let (status, json) = try await BoomerangAPI.getJSON("/api/today")
        guard (200...299).contains(status) else { throw URLError(.badServerResponse) }
        return (plistSafe(json) as? [String: Any]) ?? [:]
    }

    private func handle(_ message: [String: Any]) async -> [String: Any] {
        guard BoomerangAPI.isConfigured else {
            return [WatchMsg.ok: false, WatchMsg.error: "Open Boomerang on your phone and connect to your server."]
        }
        let op = message[WatchMsg.op] as? String ?? ""
        do {
            switch op {
            case WatchMsg.opToday:
                return [WatchMsg.ok: true, WatchMsg.payload: try await fetchToday(),
                        WatchMsg.stamp: Date().timeIntervalSince1970]

            case WatchMsg.opComplete, WatchMsg.opCommit:
                guard let id = message[WatchMsg.taskId] as? String, !id.isEmpty else {
                    return [WatchMsg.ok: false, WatchMsg.error: "No task given."]
                }
                let verb = op == WatchMsg.opComplete ? "complete" : "commit"
                let (status, json) = try await BoomerangAPI.postJSON("/api/tasks/\(id)/\(verb)")
                guard (200...299).contains(status) else {
                    // Server refusals are already written for humans (e.g. the
                    // three-task ceiling) — pass them through untouched.
                    return [WatchMsg.ok: false,
                            WatchMsg.error: (json["error"] as? String) ?? "Server said no (\(status))."]
                }
                var reply: [String: Any] = [WatchMsg.ok: true, WatchMsg.stamp: Date().timeIntervalSince1970]
                if let fresh = try? await fetchToday() { reply[WatchMsg.payload] = fresh }
                return reply

            default:
                return [WatchMsg.ok: false, WatchMsg.error: "Unknown request."]
            }
        } catch {
            return [WatchMsg.ok: false, WatchMsg.error: "Can't reach the server — check the VPN on your phone."]
        }
    }

    // MARK: - WCSessionDelegate

    // Breadcrumbs, deliberately chatty: the 2026-07-26 investigation stalled
    // partly because a background launch left NO trace — the only log line in
    // this file was the activation-error case, so "is iOS even starting us?"
    // was unanswerable from the console. These make the whole handshake
    // visible in Console.app filtered on [WatchBridge].
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error { NSLog("[WatchBridge] activation failed: %@", error.localizedDescription) }
        NSLog("[WatchBridge] activated state=%ld paired=%d watchAppInstalled=%d",
              activationState.rawValue, session.isPaired ? 1 : 0, session.isWatchAppInstalled ? 1 : 0)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        NSLog("[WatchBridge] received op=%@", (message[WatchMsg.op] as? String) ?? "?")
        // replyHandler must fire exactly once, reasonably fast — every path in
        // handle() returns a dictionary, and BoomerangAPI carries a 10s timeout.
        Task { replyHandler(await handle(message)) }
    }

    // Required on iOS (watch switching). Re-activate so a newly paired watch
    // keeps working without relaunching the app.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        activated = false
        activate()
    }
}
