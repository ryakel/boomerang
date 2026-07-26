import Foundation

// The phone↔watch message contract. This ONE file is compiled into both the
// App and BoomerangWatch targets (two build-file entries, one file reference)
// so the two sides can never drift.
//
// WHY THE PHONE PROXIES EVERY REQUEST (2026-07-26):
// The server is tailnet-only and there is no Tailscale client for watchOS, so a
// watch app making its own HTTPS calls to tasks.kfam.in cannot route to the
// 100.x address — traffic the watch tunnels through the paired iPhone does not
// carry the phone's VPN routes. So the watch never speaks HTTP at all: it asks
// the phone, the phone calls the API via BoomerangKit, and the phone replies.
//
// Two consequences worth keeping in mind:
//   - NO CREDENTIALS ON THE WATCH, ever. App Groups and Keychains are per
//     device, so a direct-HTTP watch app would have needed its own copy of a
//     token shipped over the air. This design has nothing to steal.
//   - The watch is useful only with the phone in range (Bluetooth/WiFi). That
//     is the normal companion-watch tradeoff, and the UI says so plainly
//     instead of spinning.
enum WatchMsg {
    static let op = "op"

    // Watch → phone operations.
    static let opToday = "today"       // fetch GET /api/today
    static let opComplete = "complete" // POST /api/tasks/:id/complete
    static let opCommit = "commit"     // POST /api/tasks/:id/commit

    static let taskId = "task_id"

    // Reply / application-context keys.
    static let ok = "ok"               // Bool
    static let error = "error"         // String — shown verbatim on the watch
    static let payload = "payload"     // [String: Any] — the /api/today body
    static let stamp = "stamp"         // Double — epoch seconds the payload was fetched
}
