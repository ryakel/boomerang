import Foundation

// Thin authenticated HTTP helper for native surfaces (App Intents, Share
// Extension, future watch). Credentials come from SharedCredentials per call —
// device access token while fresh, legacy token fallback, never a refresh
// (see the invariant in SharedCredentials.swift). 10s timeout: Siri must
// answer fast when the tailnet host is unreachable, not hang for URLSession's
// 60s default.
public enum BoomerangAPI {
    public static var isConfigured: Bool { SharedCredentials.isConfigured }

    public static func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> (status: Int, data: Data) {
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty, let url = URL(string: base + path) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 10
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    // JSON conveniences — a non-JSON body decodes to [:] rather than throwing,
    // so callers branch on status first and read fields opportunistically.
    public static func getJSON(_ path: String) async throws -> (status: Int, json: [String: Any]) {
        let (status, data) = try await request("GET", path)
        return (status, ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:])
    }

    public static func postJSON(_ path: String, body: [String: Any] = [:]) async throws -> (status: Int, json: [String: Any]) {
        let (status, data) = try await request("POST", path, body: body)
        return (status, ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:])
    }
}
