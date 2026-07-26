import Foundation
import Security

// Minimal Keychain wrapper for Boomerang's shared secrets. Generic-password
// items under one service; the account name distinguishes keys. The App Group
// identifier doubles as the keychain access group (iOS allows app-group IDs as
// access groups), so the Share Extension and future extensions read the same
// items with no entitlement beyond the App Groups capability every target
// already has. kSecAttrAccessibleAfterFirstUnlock because extensions and
// background pushes may need credentials while the device is locked.
public enum BoomKeychain {
    private static let service = "boomerang.shared"

    private static func baseQuery(account: String, accessGroup: Bool) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if accessGroup { q[kSecAttrAccessGroup as String] = BoomerangShared.appGroupId }
        return q
    }

    // Every operation tries the shared access group first and retries without
    // it on errSecMissingEntitlement — simulators and builds where the App
    // Group capability hasn't been provisioned yet keep working (items just
    // aren't shared across targets there).
    private static func withFallback(_ op: (_ accessGroup: Bool) -> OSStatus) -> OSStatus {
        let status = op(true)
        if status == errSecMissingEntitlement { return op(false) }
        return status
    }

    public static func get(_ account: String) -> String? {
        var result: CFTypeRef?
        let status = withFallback { shared in
            var query = baseQuery(account: account, accessGroup: shared)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            result = nil
            return SecItemCopyMatching(query as CFDictionary, &result)
        }
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func set(_ account: String, _ value: String) -> Bool {
        let data = Data(value.utf8)
        let status = withFallback { shared in
            let query = baseQuery(account: account, accessGroup: shared)
            let update: [String: Any] = [kSecValueData as String: data]
            let updated = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            if updated != errSecItemNotFound { return updated }
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            return SecItemAdd(add as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    @discardableResult
    public static func delete(_ account: String) -> Bool {
        let status = withFallback { shared in
            SecItemDelete(baseQuery(account: account, accessGroup: shared) as CFDictionary)
        }
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
