import SwiftUI
import WidgetKit

// The Today widget (BOOM-61). The owner kept forgetting to open the app and
// the 7 AM ping wasn't enough, so this sits where he already looks: the Lock
// Screen and the Home Screen. It says what's on Today and opens Today on tap.
//
// Data: a snapshot the app writes into the App Group (widget-today.json, built
// by src/widgetSnapshot.js) every time Today changes and when it goes to the
// background. The widget reads that file and nothing else: no network, no
// credentials (native code never refreshes the WebView's tokens). When days
// pass without the app being opened, `lines(for:)` recomputes Today from the
// dates in the snapshot, mirroring widgetView() in src/widgetSnapshot.js
// (tested there), and says when the picture is from.
//
// No score, streak or "you missed" copy: it says what's there.

struct TodaySnapshot: Decodable {
    struct Item: Decodable { let title: String; let due: String?; let loop: Bool?; let kept: Bool? }
    struct Title: Decodable { let title: String }
    let v: Int
    let generatedAt: String
    let day: String
    let todayCount: Int
    let today: [Item]
    let priorities: [Title]
    let upcoming: [Item]

    static func load() -> TodaySnapshot? {
        let group = (Bundle.main.object(forInfoDictionaryKey: "BoomerangAppGroup") as? String) ?? "group.ryakel.boomerang"
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let data = try? Data(contentsOf: dir.appendingPathComponent("widget-today.json")),
              let snap = try? JSONDecoder().decode(TodaySnapshot.self, from: data), snap.v == 1 else { return nil }
        return snap
    }

    // Keep in step with widgetView() in src/widgetSnapshot.js.
    func lines(for dayKey: String) -> (count: Int, titles: [String], stale: Bool) {
        if day == dayKey { return (todayCount, today.map(\.title), false) }
        let carried = today.filter { $0.due == nil || $0.loop == true || ($0.kept == true && ($0.due ?? "") >= dayKey) }
        let arrived = upcoming.filter { $0.due == dayKey || ($0.loop == true && ($0.due ?? "9999") <= dayKey) }
        let titles = (carried + arrived).map(\.title)
        return (titles.count, titles, true)
    }

    var generated: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: generatedAt) ?? ISO8601DateFormatter().date(from: generatedAt)
    }
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
}

private func dayKey(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { TodayEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: Date(), snapshot: TodaySnapshot.load()))
    }
    // One entry now and one at each of the next three midnights, so the list
    // moves to the new day even if the app stays closed. The app reloads the
    // timeline whenever it writes a new snapshot.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let snap = TodaySnapshot.load()
        let now = Date()
        var entries = [TodayEntry(date: now, snapshot: snap)]
        var midnight = Calendar.current.startOfDay(for: now)
        for _ in 0..<3 {
            midnight = Calendar.current.date(byAdding: .day, value: 1, to: midnight) ?? midnight
            entries.append(TodayEntry(date: midnight, snapshot: snap))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

private let ember = Color(red: 0.86, green: 0.36, blue: 0.20)

private func openURL() -> URL? {
    let scheme = (Bundle.main.object(forInfoDictionaryKey: "BoomerangURLScheme") as? String) ?? "boomerang"
    return URL(string: "\(scheme)://?open=today")
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    private var lines: (count: Int, titles: [String], stale: Bool) {
        entry.snapshot?.lines(for: dayKey(entry.date)) ?? (0, [], true)
    }
    private var priorities: [String] { entry.snapshot?.priorities.map(\.title) ?? [] }
    private var headline: String {
        guard entry.snapshot != nil else { return "Open Boomerang" }
        return lines.count == 0 ? "Today is clear" : "\(lines.count) on Today"
    }
    // Honest about age: when the picture is from an earlier day, say so.
    private var footnote: String? {
        guard let snap = entry.snapshot else { return "Tap to see Today" }
        guard lines.stale, let when = snap.generated else { return nil }
        return "Updated " + when.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryRectangular: rectangular
            case .accessoryInline: Text(lines.titles.first.map { "\(headline) · \($0)" } ?? headline)
            case .systemMedium: medium
            default: small
            }
        }
        .widgetURL(openURL())
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(lines.count)").font(.system(size: 22, weight: .semibold, design: .rounded))
                Text("today").font(.system(size: 9, weight: .medium))
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(headline).font(.headline).widgetAccentable()
            ForEach(Array(lines.titles.prefix(2).enumerated()), id: \.offset) { _, t in
                Text(t).font(.caption).lineLimit(1)
            }
            if lines.titles.isEmpty, let p = priorities.first {
                Text("This week: \(p)").font(.caption).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(entry.snapshot == nil ? "–" : "\(lines.count)").font(.system(size: 34, weight: .semibold, design: .serif)).foregroundStyle(ember)
                Text("on Today").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(lines.titles.prefix(3).enumerated()), id: \.offset) { _, t in
                Text(t).font(.footnote).lineLimit(1)
            }
            if lines.titles.isEmpty, let p = priorities.first {
                Text("This week: \(p)").font(.footnote).lineLimit(2)
            }
            Spacer(minLength: 0)
            if let note = footnote { Text(note).font(.caption2).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.snapshot == nil ? "–" : "\(lines.count)").font(.system(size: 40, weight: .semibold, design: .serif)).foregroundStyle(ember)
                Text("on Today").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if let note = footnote { Text(note).font(.caption2).foregroundStyle(.secondary) }
            }
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(lines.titles.prefix(4).enumerated()), id: \.offset) { _, t in
                    Text(t).font(.subheadline).lineLimit(1)
                }
                if lines.titles.isEmpty { Text("Nothing due. Tap to plan today.").font(.subheadline).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
                if !priorities.isEmpty {
                    Text("This week: " + priorities.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BoomerangToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("Today")
        .description("What's on Today. Tap to open it.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}
