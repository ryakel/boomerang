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

    func activate() {
        guard let session else { return } // iPad / simulator without a paired watch
        session.delegate = self
        session.activate()
    }

    // Best-effort snapshot push. Silent on every failure: this is a nicety, the
    // watch's own request is the real path.
    func pushTodaySnapshot() {
        guard let session, session.activationState == .activated, session.isPaired,
              session.isWatchAppInstalled, BoomerangAPI.isConfigured else { return }
        Task {
            guard let payload = try? await fetchToday() else { return }
            try? session.updateApplicationContext([
                WatchMsg.payload: payload,
                WatchMsg.stamp: Date().timeIntervalSince1970,
            ])
        }
    }

    private func fetchToday() async throws -> [String: Any] {
        let (status, json) = try await BoomerangAPI.getJSON("/api/today")
        guard (200...299).contains(status) else { throw URLError(.badServerResponse) }
        return json
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

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error { NSLog("[WatchBridge] activation failed: %@", error.localizedDescription) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        // replyHandler must fire exactly once, reasonably fast — every path in
        // handle() returns a dictionary, and BoomerangAPI carries a 10s timeout.
        Task { replyHandler(await handle(message)) }
    }

    // Required on iOS (watch switching). Re-activate so a newly paired watch
    // keeps working without relaunching the app.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
