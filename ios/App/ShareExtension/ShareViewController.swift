import UIKit
import Social
import UniformTypeIdentifiers
import BoomerangKit

// "Add to Boomerang" Share Extension. Reads credentials via BoomerangKit —
// base URL from the App Group, token from the shared Keychain (device access
// token while fresh, legacy token as fallback; the extension never refreshes
// the pair — see SharedCredentials.swift). Extracts the shared text or URL and
// POSTs it to /api/intake as a task, OR appends it to one of the shared lists.
// The compose sheet lets the user edit the title before sending.
//
// The destination is ASKED every time (owner's call, 2026-07-28) — there is no
// default and no last-used memory. A share that silently files somewhere you
// didn't look is worse than one extra tap, especially when half the
// destinations are a list another person reads.
class ShareViewController: SLComposeServiceViewController {

    private var sharedURL: String?

    // nil = task (the /api/intake path). Non-nil = append to that list.
    private var destinationListID: String?
    private var destinationListName: String = "Task"
    private var lists: [(id: String, name: String)] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Add to Boomerang"
        placeholder = "Task title…"
        loadSharedItems()
        loadLists()
    }

    // Fetched rather than cached: a list added on another device should be a
    // valid destination the first time you share, not after the next app open.
    private func loadLists() {
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty else { return }
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmed + "/api/lists") else { return }
        var req = URLRequest(url: url)
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rows = json["lists"] as? [[String: Any]] else { return }
            let parsed: [(id: String, name: String)] = rows.compactMap { row in
                // An orphaned list has lost its Trello checklist — offering it
                // as a destination would write into a container that is gone.
                guard row["orphaned_at"] == nil || row["orphaned_at"] is NSNull else { return nil }
                guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
                return (id: id, name: name)
            }
            DispatchQueue.main.async {
                self?.lists = parsed
                self?.reloadConfigurationItems()
            }
        }.resume()
    }

    override func isContentValid() -> Bool {
        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !typed.isEmpty || sharedURL != nil
    }

    override func didSelectPost() {
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty else {
            complete(error: "Open Boomerang and connect to your server first.")
            return
        }

        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = typed.isEmpty ? (sharedURL ?? "New task") : typed

        if let listID = destinationListID {
            postToList(base: base, token: token, listID: listID, name: title)
            return
        }
        let notes = (sharedURL != nil && sharedURL != title) ? sharedURL! : ""
        post(base: base, token: token, title: title, notes: notes)
    }

    // The destination row. Always shown, always says where this is going —
    // there is no hidden default to be surprised by.
    override func configurationItems() -> [Any]! {
        guard let item = SLComposeSheetConfigurationItem() else { return [] }
        item.title = "Add to"
        item.value = destinationListName
        item.tapHandler = { [weak self] in self?.presentDestinationPicker() }
        return [item]
    }

    private func presentDestinationPicker() {
        let sheet = UIAlertController(title: "Add to", message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Task", style: .default) { [weak self] _ in
            self?.destinationListID = nil
            self?.destinationListName = "Task"
            self?.reloadConfigurationItems()
        })
        for list in lists {
            sheet.addAction(UIAlertAction(title: list.name, style: .default) { [weak self] _ in
                self?.destinationListID = list.id
                self?.destinationListName = list.name
                self?.reloadConfigurationItems()
            })
        }
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        // iPad needs an anchor or this traps.
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }

    private func loadSharedItems() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                        guard let url = data as? URL else { return }
                        DispatchQueue.main.async {
                            self?.sharedURL = url.absoluteString
                            self?.validateContent()
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                        guard let text = data as? String else { return }
                        DispatchQueue.main.async {
                            if self?.contentText?.isEmpty ?? true { self?.textView.text = text }
                            self?.validateContent()
                        }
                    }
                }
            }
        }
    }

    private func post(base: String, token: String, title: String, notes: String) {
        let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmedBase + "/api/intake") else {
            complete(error: "Bad server URL.")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["title": title, "notes": notes])

        URLSession.shared.dataTask(with: req) { [weak self] _, response, error in
            if let error = error {
                self?.complete(error: "Couldn't reach Boomerang: \(error.localizedDescription)")
                return
            }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                self?.complete(error: "Boomerang returned \(http.statusCode).")
                return
            }
            self?.complete(error: nil)
        }.resume()
    }

    // Goes through the SAME endpoint a typed add uses, so the item gets the
    // same sync kick and the same Trello guarantees. No shortcut path.
    private func postToList(base: String, token: String, listID: String, name: String) {
        let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmedBase + "/api/lists/\(listID)/items") else {
            complete(error: "Bad server URL.")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["names": [name]])

        URLSession.shared.dataTask(with: req) { [weak self] _, response, error in
            if let error = error {
                self?.complete(error: "Couldn't reach Boomerang: \(error.localizedDescription)")
                return
            }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                self?.complete(error: "Boomerang returned \(http.statusCode).")
                return
            }
            self?.complete(error: nil)
        }.resume()
    }

    private func complete(error: String?) {
        DispatchQueue.main.async {
            guard let error = error else {
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                return
            }
            let alert = UIAlertController(title: "Couldn't add", message: error, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            })
            self.present(alert, animated: true)
        }
    }
}
