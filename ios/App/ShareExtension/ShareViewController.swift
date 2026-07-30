import UIKit
import UniformTypeIdentifiers
import BoomerangKit

// "Add to Boomerang" Share Extension. Reads credentials via BoomerangKit —
// base URL from the App Group, token from the shared Keychain (device access
// token while fresh, legacy token as fallback; the extension never refreshes
// the pair — see SharedCredentials.swift). Extracts the shared text or URL and
// POSTs it to /api/intake as a task, OR appends it to one of the shared lists.
//
// The destination is ASKED every time (owner's call, 2026-07-28) — there is no
// default and no last-used memory. A share that silently files somewhere you
// didn't look is worse than one extra tap, especially when half the
// destinations are a list another person reads.
//
// ── Why this is a plain UIViewController and not SLComposeServiceViewController
//
// It used to subclass SLComposeServiceViewController, Apple's share template.
// That template has a FIXED layout — nav bar, then the text view, then the
// configuration-items table — and it focuses the text view on appear. So the
// keyboard came up immediately and pushed the "Add to" row below the fold, and
// you had to scroll the sheet to discover the destination existed at all.
//
// That cost an evening on 2026-07-29: the report "the share sheet didn't show
// my lists" was literally true (the row was invisible) but was read as "I
// tapped the row and only saw Task", which sent the investigation through
// signed entitlements, App Group parity, keychain access groups, ATS posture
// and the orphan filter — all healthy, none of them ever the problem.
//
// The template offers no ordering hook and no reposition API, so the row is
// below the fold for as long as we use it. An auto-scroll workaround was
// considered and rejected: it meant walking a private view hierarchy in
// viewDidAppear to find a scroll view Apple doesn't expose, fragile across iOS
// versions, to work around a constraint we were free to drop. Owning the layout
// is the smaller idea. The destination now sits directly under the header,
// above the text, where it cannot be missed.
//
// What we give up by leaving the template: `contentText`, `isContentValid()`,
// the automatic text view and the standard chrome. All rebuilt below, and all
// of it was thin.
class ShareViewController: UIViewController {

    // MARK: - State

    private var sharedURL: String?

    // nil = task (the /api/intake path). Non-nil = append to that list.
    private var destinationListID: String?
    private var destinationListName = "Task"
    private var lists: [(id: String, name: String)] = []
    // Why the list fetch failed, if it did. nil AND an empty `lists` genuinely
    // means "no lists yet" — the two must stay distinguishable.
    private var listsError: String?
    private var isPosting = false

    // MARK: - Views

    private let card = UIView()
    private let titleLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let addButton = UIButton(type: .system)
    private let destinationButton = UIButton(type: .system)
    private let destinationValue = UILabel()
    private let textView = UITextView()
    private let placeholderLabel = UILabel()
    private let urlLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var cardBottom: NSLayoutConstraint?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        buildUI()
        loadSharedItems()
        loadLists()
        observeKeyboard()
        // Tapping the dimmed area outside the card cancels, matching every other
        // sheet on the system.
        let tap = UITapGestureRecognizer(target: self, action: #selector(backgroundTapped(_:)))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Focus the text last, once layout has settled — the destination row is
        // already on screen above it, so the keyboard cannot hide it.
        textView.becomeFirstResponder()
    }

    // MARK: - UI construction

    private func buildUI() {
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.layer.cornerCurve = .continuous
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let bottom = card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        cardBottom = bottom
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            bottom,
        ])

        // ── Header: Cancel · title · Add
        titleLabel.text = "Add to Boomerang"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        addButton.setTitle("Add", for: .normal)
        addButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        addButton.addTarget(self, action: #selector(addTapped), for: .touchUpInside)

        spinner.hidesWhenStopped = true

        let header = UIStackView(arrangedSubviews: [cancelButton, titleLabel, spinner, addButton])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 8
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        // ── Destination row, FIRST — the whole reason this class exists.
        destinationValue.font = .preferredFont(forTextStyle: .body)
        destinationValue.adjustsFontForContentSizeCategory = true
        destinationValue.textColor = .secondaryLabel
        destinationValue.textAlignment = .right

        let destLabel = UILabel()
        destLabel.text = "Add to"
        destLabel.font = .preferredFont(forTextStyle: .body)
        destLabel.adjustsFontForContentSizeCategory = true

        let chevron = UIImageView(image: UIImage(systemName: "chevron.right"))
        chevron.tintColor = .tertiaryLabel
        chevron.contentMode = .scaleAspectFit
        chevron.setContentHuggingPriority(.required, for: .horizontal)

        let destStack = UIStackView(arrangedSubviews: [destLabel, destinationValue, chevron])
        destStack.axis = .horizontal
        destStack.alignment = .center
        destStack.spacing = 8
        destStack.isUserInteractionEnabled = false
        destStack.translatesAutoresizingMaskIntoConstraints = false

        // A real button underneath the stack, so the WHOLE row is the tap target
        // rather than just the label — the mistake settings PR6 had to fix.
        destinationButton.backgroundColor = .tertiarySystemBackground
        destinationButton.layer.cornerRadius = 10
        destinationButton.layer.cornerCurve = .continuous
        destinationButton.addTarget(self, action: #selector(destinationTapped), for: .touchUpInside)
        destinationButton.addSubview(destStack)
        NSLayoutConstraint.activate([
            destStack.leadingAnchor.constraint(equalTo: destinationButton.leadingAnchor, constant: 12),
            destStack.trailingAnchor.constraint(equalTo: destinationButton.trailingAnchor, constant: -12),
            destStack.topAnchor.constraint(equalTo: destinationButton.topAnchor, constant: 11),
            destStack.bottomAnchor.constraint(equalTo: destinationButton.bottomAnchor, constant: -11),
        ])

        // ── Text
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.backgroundColor = .tertiarySystemBackground
        textView.layer.cornerRadius = 10
        textView.layer.cornerCurve = .continuous
        textView.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        textView.delegate = self
        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.heightAnchor.constraint(equalToConstant: 92).isActive = true

        placeholderLabel.text = "Task title…"
        placeholderLabel.font = .preferredFont(forTextStyle: .body)
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        textView.addSubview(placeholderLabel)
        NSLayoutConstraint.activate([
            placeholderLabel.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 13),
            placeholderLabel.topAnchor.constraint(equalTo: textView.topAnchor, constant: 10),
        ])

        urlLabel.font = .preferredFont(forTextStyle: .caption1)
        urlLabel.adjustsFontForContentSizeCategory = true
        urlLabel.textColor = .secondaryLabel
        urlLabel.numberOfLines = 2
        urlLabel.isHidden = true

        let stack = UIStackView(arrangedSubviews: [header, destinationButton, textView, urlLabel])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])

        refreshDestination()
        refreshValidity()
    }

    // MARK: - Keyboard

    private func observeKeyboard() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardChanged(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardHidden(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardChanged(_ note: Notification) {
        guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let overlap = max(0, view.bounds.maxY - view.convert(frame, from: nil).minY)
        // Lift the card clear of the keyboard. The safe-area inset is already in
        // the constraint, so subtract it to avoid double-counting.
        let inset = view.safeAreaInsets.bottom
        cardBottom?.constant = -12 - max(0, overlap - inset)
        view.layoutIfNeeded()
    }

    @objc private func keyboardHidden(_ note: Notification) {
        cardBottom?.constant = -12
        view.layoutIfNeeded()
    }

    // MARK: - Shared item extraction

    private func loadSharedItems() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                        guard let url = data as? URL else { return }
                        DispatchQueue.main.async {
                            self?.sharedURL = url.absoluteString
                            self?.urlLabel.text = url.absoluteString
                            self?.urlLabel.isHidden = false
                            self?.refreshValidity()
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                        guard let text = data as? String else { return }
                        DispatchQueue.main.async {
                            guard let self else { return }
                            if self.currentText.isEmpty { self.textView.text = text }
                            self.placeholderLabel.isHidden = !self.currentText.isEmpty
                            self.refreshValidity()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Lists

    // Fetched rather than cached: a list added on another device should be a
    // valid destination the first time you share, not after the next app open.
    //
    // Every failure here is REPORTED, never swallowed. This originally bailed
    // with a bare `return` on a missing base URL, a missing token, a malformed
    // URL, a non-200, or unparseable JSON — and all five rendered identically
    // to "you have no lists": a picker containing only Task. From inside the
    // app, unreachable is indistinguishable from empty, so it has to say which.
    //
    // Goes through BoomerangAPI rather than a hand-rolled URLSession call so it
    // inherits the 10s timeout — a share sheet that sits there for URLSession's
    // 60s default while the tailnet host is unreachable reads as a hang.
    private func loadLists() {
        guard BoomerangAPI.isConfigured else {
            listsError = "Open Boomerang and connect to your server first."
            refreshDestination()
            return
        }
        Task {
            var parsed: [(id: String, name: String)] = []
            var failure: String?
            do {
                let (status, json) = try await BoomerangAPI.getJSON("/api/lists")
                if status != 200 {
                    failure = "Boomerang returned \(status) when loading lists."
                } else if let rows = json["lists"] as? [[String: Any]] {
                    // Explicit signature: tuple-returning compactMap with
                    // several `return nil` guards is exactly where inference
                    // gets fragile, and this file compiles on a machine I
                    // cannot reach.
                    parsed = rows.compactMap { (row: [String: Any]) -> (id: String, name: String)? in
                        // An orphaned list has lost its Trello checklist —
                        // offering it as a destination would write into a
                        // container that is gone.
                        guard row["orphaned_at"] == nil || row["orphaned_at"] is NSNull else { return nil }
                        guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
                        return (id: id, name: name)
                    }
                } else {
                    failure = "Boomerang sent a response this build didn't understand."
                }
            } catch {
                failure = "Couldn't reach Boomerang: \(error.localizedDescription)"
            }
            let loaded = parsed
            let err = failure
            DispatchQueue.main.async { [weak self] in
                self?.lists = loaded
                self?.listsError = err
                self?.refreshDestination()
            }
        }
    }

    private func refreshDestination() {
        // The row always says where this is going, and when the fetch failed it
        // says that instead of quietly offering Task alone.
        if listsError != nil && destinationListID == nil {
            destinationValue.text = "\(destinationListName) · lists unavailable"
        } else {
            destinationValue.text = destinationListName
        }
    }

    @objc private func destinationTapped() {
        // Presented from the button so iPad has a real anchor; a nil anchor is a
        // hard trap there.
        let sheet = UIAlertController(title: "Add to", message: listsError, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Task", style: .default) { [weak self] _ in
            self?.destinationListID = nil
            self?.destinationListName = "Task"
            self?.refreshDestination()
        })
        for list in lists {
            sheet.addAction(UIAlertAction(title: list.name, style: .default) { [weak self] _ in
                self?.destinationListID = list.id
                self?.destinationListName = list.name
                self?.refreshDestination()
            })
        }
        if listsError != nil {
            sheet.addAction(UIAlertAction(title: "Try again", style: .default) { [weak self] _ in
                self?.listsError = nil
                self?.refreshDestination()
                self?.loadLists()
            })
        }
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        sheet.popoverPresentationController?.sourceView = destinationButton
        sheet.popoverPresentationController?.sourceRect = destinationButton.bounds
        present(sheet, animated: true)
    }

    // MARK: - Validity

    // UITextView.text is `String!`, so it is unwrapped explicitly everywhere
    // rather than trusted — an implicitly-unwrapped nil here would crash the
    // extension on a keystroke.
    private var currentText: String { textView.text ?? "" }

    private var trimmedTitle: String {
        currentText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func refreshValidity() {
        placeholderLabel.isHidden = !currentText.isEmpty
        addButton.isEnabled = !isPosting && (!trimmedTitle.isEmpty || sharedURL != nil)
    }

    // MARK: - Actions

    @objc private func backgroundTapped(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: view)
        guard !card.frame.contains(point) else { return }
        cancelTapped()
    }

    @objc private func cancelTapped() {
        // NSError has no two-argument initialiser in Swift — userInfo is required.
        extensionContext?.cancelRequest(withError: NSError(domain: "boomerang.share", code: 0, userInfo: nil))
    }

    @objc private func addTapped() {
        guard !isPosting else { return }
        let base = BoomerangShared.apiBase
        let token = SharedCredentials.bestToken
        guard !base.isEmpty, !token.isEmpty else {
            complete(error: "Open Boomerang and connect to your server first.")
            return
        }

        let typed = trimmedTitle
        let title = typed.isEmpty ? (sharedURL ?? "New task") : typed

        setPosting(true)
        if let listID = destinationListID {
            postToList(base: base, token: token, listID: listID, name: title)
            return
        }
        let notes = (sharedURL != nil && sharedURL != title) ? sharedURL! : ""
        post(base: base, token: token, title: title, notes: notes)
    }

    private func setPosting(_ posting: Bool) {
        isPosting = posting
        addButton.isEnabled = !posting
        cancelButton.isEnabled = !posting
        destinationButton.isEnabled = !posting
        if posting { spinner.startAnimating() } else { spinner.stopAnimating() }
    }

    // MARK: - Network

    private func post(base: String, token: String, title: String, notes: String) {
        send(path: "/api/intake", base: base, token: token, body: ["title": title, "notes": notes])
    }

    // Goes through the SAME endpoint a typed add uses, so the item gets the
    // same sync kick and the same Trello guarantees. No shortcut path.
    private func postToList(base: String, token: String, listID: String, name: String) {
        send(path: "/api/lists/\(listID)/items", base: base, token: token, body: ["names": [name]])
    }

    // One request path for both destinations — the previous two copies drifted
    // (only one trimmed a trailing slash) and there was nothing gained by it.
    // 10s timeout for the same reason loadLists uses BoomerangAPI: inside a
    // share sheet, URLSession's 60s default reads as a hang, not a failure.
    private func send(path: String, base: String, token: String, body: [String: Any]) {
        let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: trimmedBase + path) else {
            complete(error: "Bad server URL.")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-api-token")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

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
            self.setPosting(false)
            let alert = UIAlertController(title: "Couldn't add", message: error, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            self.present(alert, animated: true)
        }
    }
}

extension ShareViewController: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) {
        refreshValidity()
    }
}
