import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

@main
struct AlarmProbeWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        AlarmProbeActivity()
    }
}

struct AlarmProbeActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<AlarmProbeMetadata>.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Label(context.attributes.metadata?.title ?? "Boomerang sound test", systemImage: "alarm")
                ProbeCountdown(state: context.state, title: context.attributes.metadata?.title ?? "Sound test")
                Text(context.attributes.metadata?.detail ?? "Test only • not a pickup reminder").font(.caption)
            }
            .padding()
            .activityBackgroundTint(.black)
            .activitySystemActionForegroundColor(.white)
            .foregroundStyle(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "alarm") }
                DynamicIslandExpandedRegion(.bottom) {
                    ProbeCountdown(state: context.state, title: context.attributes.metadata?.title ?? "Sound test")
                }
            } compactLeading: {
                Image(systemName: "alarm")
            } compactTrailing: {
                CompactProbeCountdown(state: context.state)
            } minimal: {
                Image(systemName: "alarm")
            }
            .keylineTint(.orange)
        }
    }
}

// Timer Text accepts all proposed width. Bound only the compact region so it
// cannot stretch the Island across the status bar; expanded/Lock Screen remain
// flexible. Apple uses the same 40-point compact timer pattern in Food Truck.
private struct CompactProbeCountdown: View {
    let state: AlarmPresentationState
    var body: some View {
        Group {
            switch state.mode {
            case .countdown(let countdown):
                Text(countdown.fireDate, style: .timer).monospacedDigit()
            case .paused:
                Image(systemName: "pause.fill").accessibilityLabel("Alarm paused")
            case .alert:
                Image(systemName: "alarm").accessibilityLabel("Alarm")
            @unknown default:
                Image(systemName: "exclamationmark").accessibilityLabel("Check test status")
            }
        }
        .font(.caption)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(width: 40, alignment: .trailing)
    }
}

private struct ProbeCountdown: View {
    let state: AlarmPresentationState
    let title: String
    var body: some View {
        switch state.mode {
        case .countdown(let countdown):
            Text(countdown.fireDate, style: .timer).monospacedDigit()
        case .paused:
            Text("Alarm paused")
        case .alert:
            Text(title)
        @unknown default:
            Text("Check alarm status in Boomerang")
        }
    }
}

#if DEBUG
// Safe presentation fixture: no AlarmManager call and no audible alarm.
private enum AlarmProbePreview {
    static var attributes: AlarmAttributes<AlarmProbeMetadata> {
        AlarmAttributes(
            presentation: AlarmPresentation(alert: AlarmPresentation.Alert(title: "Boomerang sound test")),
            metadata: AlarmProbeMetadata(), tintColor: .orange)
    }
    static var snoozed: AlarmPresentationState {
        let now = Date()
        return AlarmPresentationState(alarmID: UUID(), mode: .countdown(.init(
            totalCountdownDuration: 60, previouslyElapsedDuration: 0,
            startDate: now, fireDate: now.addingTimeInterval(60))))
    }
}

#Preview("Snooze compact", as: .dynamicIsland(.compact), using: AlarmProbePreview.attributes) {
    AlarmProbeActivity()
} contentStates: {
    AlarmProbePreview.snoozed
}
#endif
