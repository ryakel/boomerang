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
                ProbeCountdown(state: context.state)
            } minimal: {
                Image(systemName: "alarm")
            }
            .keylineTint(.orange)
        }
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
