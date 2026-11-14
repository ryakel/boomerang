# Disposable AlarmKit test — Mac handoff

Status: **implemented for native compilation and phone evaluation; not verified
on Xcode or a phone yet**. Branch `claude/alarmkit-probe`, based on dev `7354b6a`.
This is a delivery experiment before deciding how to implement school pickup.
See [the product walkthrough](School-Pickup-Experience.md) and
[D011](Decision-Log.md#d011--bounded-native-alarm-delivery-experiment).

## Scope and user experience

In the rebuilt **Boomerang Dev** app, open Settings → Notifications → Test.
The **Alarm sound test** section can inspect permission/status, explicitly ask
for alarm permission, start one alarm in 60 seconds, and cancel the test. The
alert offers system Stop and **Snooze 1 min**. Snooze uses AlarmKit's post-alert
countdown; the widget extension provides its required Live Activity. These
intervals are disposable-test constants, not the owner's pickup schedule.

Status reports the daemon's current test alarm, not an inferred outcome. No
alarm listed could mean stopped, cancelled, expired or not scheduled; it never
establishes that sound was heard. Stop does not mean left or picked up. No
departure/completion action, recurring pickup schedule, calendar change,
medication feature, message, location inference, Shortcut or Silent-mode toggle
is included. Existing Clock/Reminders alarms and notification ownership remain
unchanged. No server endpoint, credentials or model call is added.

Only App Dev configurations define `BOOMERANG_ALARM_PROBE`. Production App
configurations return unavailable without requesting permission or scheduling.
Both configurations embed the extension to keep the existing scheme structure;
no app is installed or deployed by this PR. No real schedule is armed by opening
Settings, launch, resume, refresh, build, or tests.

## Implementation boundaries

- `BoomerangAlarmProbe` is explicitly registered with Capacitor. A main-actor
  service serializes operations, requires separate alarm authorization, refuses
  a second active test and reads back schedule/cancellation from AlarmManager.
- A dedicated fixed UUID is the only alarm inspected/cancelled; native API takes
  no arbitrary IDs, dates or task data. The identifier survives process/WebView
  restarts without localStorage. App bundle identity scopes Dev versus App.
- Missing plugin/unsupported build, permission denial, daemon errors, malformed
  replies, and lost write responses stay visible. No automatic retry. Check
  status before another schedule attempt; Cancel works without a cached ID.
- `AlarmProbeMetadata` is compiled into phone and widget, with no personal data.
  The extension displays the system countdown on Lock Screen/Dynamic Island.
  System AlarmKit handles Stop/Snooze; no custom completion App Intent is used.
- Uses the system Stop initializer introduced in iOS 26.1. The experiment and
  widget require iOS/SDK 26.1+, while the main app's iOS 16 minimum remains.
  Prefer **Xcode 27** for the owner's iOS 27 physical device. Do not downgrade
  deployment targets or replace AlarmKit with ordinary notifications to get a
  green build.
- The test is direct and opt-in, like existing notification test controls; it
  does not follow background reminder/away suppression and runs only when the
  owner explicitly starts it. It changes no channel or global alert settings.

Primary sources: Apple's [scheduling sample](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)
and [AlarmKit introduction](https://developer.apple.com/videos/play/wwdc2025/230/),
plus the [system Stop initializer](https://developer.apple.com/documentation/alarmkit/alarmpresentation/alert-swift.struct/init(title:secondarybutton:secondarybuttonbehavior:)).
Apple requires a countdown widget extension; omitting it can cause missed alerts.
No undocumented AlarmKit entitlement is added. The usage description and Live
Activity support key are in the phone Info.plist.

## Start here on the Mac

Use this feature branch, **not main or dev**, until reviewed and merged. Preserve
any existing Mac changes before switching. Fetch and check out the branch:

```sh
git fetch origin
git switch --track origin/claude/alarmkit-probe
npm ci
sh scripts/ios-alarm-probe-check.sh
```

The script checks the SDK, runs bridge tests, rebuilds/syncs bundled web assets,
then performs unsigned simulator builds for **App Dev and App**, checking widget
packaging. It does not install, launch, schedule or deploy. It may download the
normal Swift packages. Review any files rewritten by `cap sync`; don't use
`npx cap add ios`. A successful script proves compilation/packaging only.

To let local Codex use Xcode, enable external Xcode tools under Xcode Settings →
Intelligence, run `codex mcp add xcode -- xcrun mcpbridge`, and open
`ios/App/App.xcodeproj`. [Apple setup](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode).
This local bridge does not connect the cloud conversation to the Mac.

After compilation succeeds, choose **App Dev**, confirm the Dev bundle ID and
signing for the new `AlarmProbeWidget` target, and run the Dev build on the phone
when ready. First installation of a new extension may need interactive Xcode
signing. Reuse the existing `scripts/ios-rebuild.sh` (`npm run ios`) to open
Xcode, or `scripts/ios-deploy.sh` via `npm run ios:dev` for build/install/launch
after signing is established. The latter really installs, unlike the unsigned
check. Do not use `npm run ios:prod`. Existing Dev app data and connection
settings should be preserved; do not uninstall as a troubleshooting first step.
Keep Dev connected to the dev server; the alarm test itself needs no server.

## Physical-device evaluation

Use a convenient time and place for a loud disposable alarm, away from a real
pickup or medication deadline. Keep existing alarms. Record observations here
or in the PR; never turn an unrun row into a pass.

| Check | Expected observation | Result |
|---|---|---|
| Fresh permission denied | Clear denied state; schedule disabled, no alarm | Not run |
| Grant alarm permission | Separate AlarmKit authorization, no alarm created by granting | Not run |
| Start once; rapid taps | One test alarm in readback, duplicate start disabled/refused | Not run |
| Locked + Silent + backgrounded | Audible system alarm near 60s; note actual volume/settings | Not run |
| Snooze 1 min | Sound stops, visible countdown, audible re-alert near 60s | Not run |
| Stop | Sound ends; readback no longer lists it; no task/pickup completion | Not run |
| Cancel before firing | Readback absent; no later sound or countdown | Not run |
| Cancel while snoozed | Countdown ends; no re-alert | Not run |
| Close/reopen app | Existing test readable/cancellable; no second test created | Not run |
| Airplane/offline after arming | Alarm and snooze remain system-owned; observe actual behavior | Not run |
| Restart phone after arming | Record behavior after unlock; do not infer reliability from API | Not run |
| Focus and paired Watch, if used | Record which device sounds and any unexpected routing | Not run |
| Existing reminders/Clock alarms | Remain intact; test cancel affects only Boomerang's test UUID | Not run |
| Ordinary App scheme | Test unavailable; no alarm permission prompt or scheduling | Not run |

Also record iOS/Xcode versions, app commit/configuration, permission/Live Activity
settings, actual sound/snooze times, network/lock/Silent/Focus/Watch conditions.
Do not record secrets or a private school/medication schedule. If a test fails,
leave real alarms in place and fix/retest the narrow experiment before expanding.

## Cloud verification and next decision

Bridge tests use synthetic native replies. Browser tests drive the actual React
controls/client with a fake daemon; they do not exercise AlarmKit. Local Xcode
project parsing checks source membership, extension embedding/dependency, bundle
configurations and the Dev-only gate. Build/lint are frontend checks.
**No native compilation, physical audibility, snooze delivery, offline/restart
delivery or Watch behavior has been established in this Linux workspace.**

Commands: `npm run test:alarm-probe`; optional browser run with
`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run test:alarm-probe:browser`.
The browser runner uses `CHROMIUM_PATH` (default `/usr/bin/chromium`). No new
dependency is required for ordinary CI; browser dependencies are optional.
Current results are in Work Status / PR. Merge and staging/production deployment
are separate from the owner's authorization to prepare this experiment.

After the Mac/device matrix, discuss whether delivery is dependable enough to
design the pickup trial and its configurable weekly schedule/exception policy.
Do not treat a successful alarm test as authority for a generic obligation engine
or replacing the owner's Clock alarms.
