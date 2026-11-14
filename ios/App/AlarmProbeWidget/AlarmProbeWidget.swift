import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

@main
struct AlarmProbeWidgetBundle: WidgetBundle {
    var body: some Widget { AlarmProbeActivity() }
}

struct AlarmProbeActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<AlarmProbeMetadata>.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Label("Boomerang sound test", systemImage: "alarm")
                ProbeCountdown(state: context.state)
                Text("Test only • not a pickup reminder").font(.caption)
            }
            .padding()
            .activityBackgroundTint(.black)
            .activitySystemActionForegroundColor(.white)
            .foregroundStyle(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "alarm") }
                DynamicIslandExpandedRegion(.bottom) {
                    ProbeCountdown(state: context.state)
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
                Image(systemName: "pause.fill").accessibilityLabel("Test paused")
            case .alert:
                Image(systemName: "alarm").accessibilityLabel("Sound test")
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
    var body: some View {
        switch state.mode {
        case .countdown(let countdown):
            Text(countdown.fireDate, style: .timer).monospacedDigit()
        case .paused:
            Text("Test paused")
        case .alert:
            Text("Sound test")
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
