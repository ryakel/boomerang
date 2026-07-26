import SwiftUI

// The watch's only screen: today's commitments, their first steps, and what's
// waiting. Deliberately NOT a task manager on the wrist — the phone owns
// browsing and editing. This answers one question ("what did I say I'd do
// today?") and offers the two actions worth taking mid-motion.
//
// Language rule (task-model spec): no punishment framing anywhere. A task that
// came back around is "back around", never late/missed/failed.
struct TodayView: View {
    @ObservedObject var store: WatchStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let error = store.errorText {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if store.committed.isEmpty {
                    emptyState
                } else {
                    ForEach(store.committed) { task in
                        TaskCard(task: task, busy: store.busyTaskId == task.id) {
                            store.complete(task)
                        }
                    }
                }

                poolLine

                Button {
                    store.refresh()
                } label: {
                    Label(store.loading ? "Refreshing…" : "Refresh", systemImage: "arrow.clockwise")
                        .font(.footnote)
                }
                .buttonStyle(.bordered)
                .disabled(store.loading)
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("Today")
        .onAppear { store.refresh() }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Nothing committed yet")
                .font(.headline)
            Text("Pick up to three on your phone.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }

    private var poolLine: some View {
        VStack(alignment: .leading, spacing: 2) {
            if store.returnedCount > 0 {
                Text("\(store.returnedCount) came back around")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text("\(store.openCount) in the pool")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if store.lastUpdated == nil && !store.committed.isEmpty {
                Text("showing last synced")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.top, 2)
    }
}

private struct TaskCard: View {
    let task: WatchTask
    let busy: Bool
    let onComplete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title)
                .font(.headline)
                .strikethrough(task.done)
                .foregroundStyle(task.done ? .secondary : .primary)
                .fixedSize(horizontal: false, vertical: true)

            if let step = task.firstStep, !task.done {
                Text(step)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if task.done {
                Label("Done", systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            } else {
                Button(action: onComplete) {
                    if busy {
                        ProgressView()
                    } else {
                        Label("Done", systemImage: "checkmark")
                            .font(.footnote)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
    }
}
