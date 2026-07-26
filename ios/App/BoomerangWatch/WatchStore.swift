import Foundation
import SwiftUI
import WatchConnectivity

// Watch-side state. Talks ONLY to the paired phone (see WatchProtocol.swift) —
// no HTTP, no credentials on this device.
//
// Delegate callbacks arrive off the main thread, so every published mutation
// hops through `apply` on the main queue.

struct WatchTask: Identifiable, Equatable {
    let id: String
    let title: String
    let firstStep: String?
    let done: Bool

    init?(_ row: [String: Any]) {
        guard let id = row["id"] as? String, let title = row["title"] as? String else { return nil }
        self.id = id
        self.title = title
        let step = row["first_step"] as? String
        self.firstStep = (step?.isEmpty == false) ? step : nil
        self.done = (row["done"] as? Bool) ?? false
    }
}

final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published var committed: [WatchTask] = []
    @Published var openCount = 0
    @Published var returnedCount = 0
    @Published var loading = false
    @Published var errorText: String?
    @Published var busyTaskId: String?
    @Published var lastUpdated: Date?

    // Cached last payload so a wrist-raise shows real content instantly
    // instead of a spinner. Task titles only — nothing secret (credentials
    // never leave the phone), same posture as any companion-watch cache.
    private let cacheKey = "boom_last_today"

    override init() {
        super.init()
        loadCache()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Requests

    func refresh() {
        send([WatchMsg.op: WatchMsg.opToday])
    }

    func complete(_ task: WatchTask) {
        apply { self.busyTaskId = task.id }
        send([WatchMsg.op: WatchMsg.opComplete, WatchMsg.taskId: task.id])
    }

    func commit(_ task: WatchTask) {
        apply { self.busyTaskId = task.id }
        send([WatchMsg.op: WatchMsg.opCommit, WatchMsg.taskId: task.id])
    }

    private func send(_ message: [String: Any]) {
        guard WCSession.isSupported() else {
            apply { self.errorText = "This watch can't pair with Boomerang." }
            return
        }
        let session = WCSession.default
        guard session.isReachable else {
            apply {
                self.busyTaskId = nil
                self.loading = false
                self.errorText = "Phone not reachable — bring it in range."
            }
            return
        }
        apply { self.loading = true; self.errorText = nil }
        session.sendMessage(message, replyHandler: { [weak self] reply in
            self?.handle(reply)
        }, errorHandler: { [weak self] error in
            self?.apply {
                self?.loading = false
                self?.busyTaskId = nil
                self?.errorText = error.localizedDescription
            }
        })
    }

    // MARK: - Payload handling

    private func handle(_ reply: [String: Any]) {
        let ok = (reply[WatchMsg.ok] as? Bool) ?? false
        // A payload may ride along even on failure paths we care about; apply it
        // whenever present so the UI never shows stale state after a mutation.
        if let payload = reply[WatchMsg.payload] as? [String: Any] {
            ingest(payload, stamp: reply[WatchMsg.stamp] as? Double)
        }
        apply {
            self.loading = false
            self.busyTaskId = nil
            self.errorText = ok ? nil : ((reply[WatchMsg.error] as? String) ?? "Something went wrong.")
        }
    }

    private func ingest(_ payload: [String: Any], stamp: Double?) {
        let rows = (payload["committed"] as? [[String: Any]]) ?? []
        let tasks = rows.compactMap(WatchTask.init)
        let open = (payload["open_count"] as? Int) ?? 0
        let returned = (payload["returned_count"] as? Int) ?? 0
        apply {
            self.committed = tasks
            self.openCount = open
            self.returnedCount = returned
            self.lastUpdated = stamp.map { Date(timeIntervalSince1970: $0) } ?? Date()
        }
        saveCache(payload)
    }

    private func apply(_ block: @escaping () -> Void) {
        if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }

    // MARK: - Cache

    private func saveCache(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        ingest(payload, stamp: nil)
        apply { self.lastUpdated = nil } // cached, not freshly fetched
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        refresh()
    }

    // Snapshot pushed by the phone when its app foregrounds.
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let payload = applicationContext[WatchMsg.payload] as? [String: Any] else { return }
        ingest(payload, stamp: applicationContext[WatchMsg.stamp] as? Double)
    }
}
