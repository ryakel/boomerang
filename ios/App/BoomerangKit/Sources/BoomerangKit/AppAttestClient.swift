import Foundation
import DeviceCheck
import CryptoKit

// Phase B native half (wiki/Auth-Device-Tokens.md). Runs the real App Attest
// flow against the server: fetch a challenge → generate (or reuse) a hardware
// key → attest it → POST the attestation object. The server's verification
// side is deliberately an honest 501 stub until it can be validated against an
// attestation produced by THIS code on a real device — so `.serverPending` is
// the expected outcome today and proves the entire native side works
// end-to-end. Never claim `.verified` unless the server actually returned 2xx.
public enum AppAttestOutcome {
    case unsupported          // simulator / no Secure Enclave
    case notConfigured        // no server base or credential yet
    case verified             // server accepted (Phase B verification live)
    case serverPending(String) // 501 — native side proven, server side stubbed
    case rejected(String)     // server said no (4xx/5xx)
    case failed(String)       // local DeviceCheck / network error

    public var label: String {
        switch self {
        case .unsupported: return "unsupported"
        case .notConfigured: return "not_configured"
        case .verified: return "verified"
        case .serverPending: return "server_pending"
        case .rejected: return "rejected"
        case .failed: return "failed"
        }
    }

    public var detail: String {
        switch self {
        case .unsupported: return "App Attest needs a real device (Secure Enclave)."
        case .notConfigured: return "Connect to your server first."
        case .verified: return "Attestation accepted by the server."
        case .serverPending(let body): return "Native attestation succeeded; server verification not implemented yet (\(body))."
        case .rejected(let why): return why
        case .failed(let why): return why
        }
    }
}

public enum AppAttestClient {
    public static func run() async -> AppAttestOutcome {
        guard DCAppAttestService.shared.isSupported else { return .unsupported }
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty else { return .notConfigured }

        do {
            let challenge = try await fetchChallenge(base: base, token: token)

            // One hardware key per install, persisted so a future verified
            // enrollment stays bound to it. Attestation failure clears it —
            // Apple can permanently poison a key mid-attest, and a fresh key
            // next run beats being wedged forever.
            let keyId: String
            if let existing = BoomKeychain.get(SharedCredentials.attestKeyAccount), !existing.isEmpty {
                keyId = existing
            } else {
                keyId = try await DCAppAttestService.shared.generateKey()
                BoomKeychain.set(SharedCredentials.attestKeyAccount, keyId)
            }

            let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
            let attestation: Data
            do {
                attestation = try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
            } catch {
                BoomKeychain.delete(SharedCredentials.attestKeyAccount)
                throw error
            }

            let (status, body) = try await postAttestation(
                base: base, token: token, keyId: keyId,
                challenge: challenge, attestation: attestation)
            switch status {
            case 200...299: return .verified
            case 501: return .serverPending(body.isEmpty ? "HTTP 501" : body)
            default: return .rejected("Server returned \(status)\(body.isEmpty ? "" : ": \(body)")")
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    // POST /api/auth/device/challenge → { challenge } (single-use, 5-min TTL).
    private static func fetchChallenge(base: String, token: String) async throws -> String {
        var req = URLRequest(url: try apiURL(base, "/api/auth/device/challenge"))
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challenge = json["challenge"] as? String, !challenge.isEmpty else {
            throw URLError(.cannotParseResponse)
        }
        return challenge
    }

    // POST /api/auth/device/attest. Returns (status, body-snippet) — the
    // caller maps 501 to `.serverPending` rather than treating it as failure.
    private static func postAttestation(
        base: String, token: String, keyId: String,
        challenge: String, attestation: Data
    ) async throws -> (Int, String) {
        var req = URLRequest(url: try apiURL(base, "/api/auth/device/attest"))
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        var payload: [String: Any] = [
            "key_id": keyId,
            "challenge": challenge,
            "attestation": attestation.base64EncodedString(),
        ]
        if let deviceId = SharedCredentials.devicePair?.device_id, !deviceId.isEmpty {
            payload["device_id"] = deviceId
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
        return (status, body)
    }

    private static func apiURL(_ base: String, _ path: String) throws -> URL {
        guard let url = URL(string: base + path) else { throw URLError(.badURL) }
        return url
    }
}
