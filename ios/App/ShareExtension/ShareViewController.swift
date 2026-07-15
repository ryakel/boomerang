import UIKit
import Social
import UniformTypeIdentifiers

// "Add to Boomerang" Share Extension. Reads the API base + token from the App
// Group container (written by the main app via BoomerangNative — see
// BoomerangNative.swift / src/apiConfig.js), extracts the shared text or URL,
// and POSTs it to /api/intake as a task. The compose sheet lets the user edit
// the title before sending.
class ShareViewController: SLComposeServiceViewController {

    private let appGroup = (Bundle.main.object(forInfoDictionaryKey: "BoomerangAppGroup") as? String) ?? "group.ryakel.boomerang"
    private var sharedURL: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Add to Boomerang"
        placeholder = "Task title…"
        loadSharedItems()
    }

    override func isContentValid() -> Bool {
        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !typed.isEmpty || sharedURL != nil
    }

    override func didSelectPost() {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let base = defaults.string(forKey: "boom_api_base"), !base.isEmpty,
              let token = defaults.string(forKey: "boom_api_token"), !token.isEmpty else {
            complete(error: "Open Boomerang and connect to your server first.")
            return
        }

        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = typed.isEmpty ? (sharedURL ?? "New task") : typed
        let notes = (sharedURL != nil && sharedURL != title) ? sharedURL! : ""
        post(base: base, token: token, title: title, notes: notes)
    }

    override func configurationItems() -> [Any]! {
        return []
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

    private func complete(error: String?) {
        DispatchQueue.main.async {
            guard let error = error else {
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                return
            }
            let alert = UIAlertController(title: "Couldn't add task", message: error, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            })
            self.present(alert, animated: true)
        }
    }
}
