# Disposable AlarmKit test — Mac handoff

Status: **unsigned simulator compilation/packaging passed; physical-device
installation passed for the earlier revision; UI-isolation fix needs Mac rebuild;
audible evaluation pending**. Branch `claude/alarmkit-probe`, based on dev `7354b6a`.
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
Both configurations embed the extension to keep the existing scheme structure.
The owner subsequently authorized the Dev-only phone installation recorded below. No real schedule is armed by opening
Settings, launch, resume, refresh, build, or tests.

## Missing controls: deployed UI replaced the feature UI

The owner's phone showed App build **dev-347e0e2** and Server version
**dev-347e0e2**, with native-only notification controls present but no Alarm sound
test. The running UI was the old deployed dev UI, not the tested feature UI.
The existing OTA check accepts any different manifest version, so a feature
binary can load an older server bundle at launch/resume; this path was reproduced
with the actual updater code and synthetic inputs, without network or device
actions. The screenshot does not identify whether the old bundle was retained
or newly downloaded on that particular launch.

For this experiment only, the native `BOOMERANG_ALARM_PROBE` gate selects the
shipped `public` assets after updater plugin initialization and before loading
the WebView. A document-start marker tells the shipped JS to reconcile any
retained updater bundle with the supported `reset({toLastSuccessful:false})`
API. Once builtin is selected, it acknowledges readiness and skips server OTA
checks/listeners entirely, including on resume. That reset selects web assets;
it does not clear tasks, credentials, settings or app data. No updater private
storage keys are edited. Ordinary App builds retain their existing OTA policy.

**Mac recheck required:** pull the latest feature branch preserving local edits,
run `sh scripts/ios-alarm-probe-check.sh` (now 17 boundary/lifecycle tests), then
use the existing `npm run ios:dev` to update the existing Dev installation.
Before starting an alarm, verify that Alarm sound test is visible, App build
identifies the feature revision instead of dev-347e0e2, and the updater reports
`bundle.id == builtin`. Server version can remain dev-347e0e2; no server rollout
is needed. Check foreground/resume and a cold relaunch without losing controls
or triggering manifest/download requests, including recovery from a retained
OTA bundle. Observe native/update logs without credentials. No uninstall or
storage clear is needed. The native pin/reset path is unverified until this
device recheck; earlier build/install passes do not validate the later fix.

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

The script pins `DEVELOPER_DIR` to `/Applications/Xcode.app/Contents/Developer`
(the standard Xcode app, regardless of `xcode-select` or an inherited beta
toolchain). It checks the SDK, runs bridge tests, rebuilds/syncs bundled web assets,
then performs unsigned simulator builds for **App Dev and App**, checking widget
packaging. It does not install, launch, schedule or deploy. It may download the
normal Swift packages. Review any files rewritten by `cap sync`; don't use
`npx cap add ios`. A successful script proves compilation/packaging only.

All three iOS entry points (`ios-alarm-probe-check.sh`, `ios-rebuild.sh`, and
`ios-deploy.sh`) source `ios-xcode-env.sh`: standard `/Applications/Xcode.app`
is selected for that process, overriding inherited `DEVELOPER_DIR` and global
beta selections. The selected path and version are printed before build work.
Rebuild opens that same application explicitly instead of using the project-file
association. The scripts never run `sudo xcode-select` or change the Mac's global
selection, and fail if the requested installation is missing rather than falling
back to beta. An intentional alternative can be selected with
`BOOMERANG_XCODE_APP=/path/to/Xcode.app`. This changes no SDK version requirement.

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

For this experiment, select and verify standard Xcode for the existing workflow:

```sh
export BOOMERANG_XCODE_APP=/Applications/Xcode.app
export DEVELOPER_DIR="$BOOMERANG_XCODE_APP/Contents/Developer"
xcrun --find xcodebuild
xcodebuild -version
npm run ios:dev
```

The expected compiler path starts with `/Applications/Xcode.app/`; the Mac
validation used Xcode 27.2 (`27B52`). This process-local selection overrides a
beta `xcode-select` setting without changing the machine globally. The existing
install script checks `CFBundleIdentifier == ryakel.boomerang.app.dev` before
installation and refuses a mismatch. It also checks/updates the existing watch
companion. Do not use `ios:prod` or uninstall the Dev app.

The owner authorized the Mac commit/push and existing Dev-app installation in
Codex on 2026-11-14, plus reporting evidence in PR #1028. The owner initiates all
audible tests; no server deployment, production change or merge is authorized.

## Mac compilation evidence (2026-11-14)

On branch tip `7710921ab3a8b13eecd7579780f393eb6d4a6902` with local
standard-Xcode script edits and generated package/Watch scheme edits, `sh scripts/ios-alarm-probe-check.sh` passed with
standard `/Applications/Xcode.app`, Xcode 27.2 (`27B52`): 11/11 bridge tests,
web build/Capacitor sync, unsigned App Dev and App simulator builds, embedded
`AlarmProbeWidget.appex`, alarm usage description and Live Activity plist checks.
The first attempt stopped at a missing installed font dependency; `npm ci`
resolved that prerequisite without changing the lockfile. Existing local Watch
scheme and generated Swift package edits were preserved. No native source fix
was needed. No install, launch, alarm scheduling, merge or deployment occurred.
Physical-device checks below remain unrun; compilation does not prove audibility
or delivery reliability.

## Tested revision and Dev installation (2026-11-14)

Tested source commit: `ae1dcb44e92accbfacc1f855fee2487bdb525c83` (includes the
shared standard-Xcode setup from `d3f9cc5`). Standard developer directory verified
before build: `/Applications/Xcode.app/Contents/Developer`; resolved compiler:
`/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild`; Xcode **27.2**,
build **27B52**. `BOOMERANG_XCODE_APP=/Applications/Xcode.app` was explicitly set.

Observed on the Mac:

- `sh scripts/ios-alarm-probe-check.sh`: 11/11 synthetic bridge tests, frontend
  build/Capacitor sync, unsigned App Dev and App simulator builds and widget/
  usage-description/Live-Activity packaging checks passed.
- Repository pre-push lint, regression suite and local smoke checks passed.
- `npm run ios:dev`: signed App Dev build passed. Before installation the script
  verified `CFBundleIdentifier = ryakel.boomerang.app.dev` (Boomerang Dev).
  The packaged extension ID is `ryakel.boomerang.app.dev.AlarmProbeWidget`.
- `devicectl` reported Dev app installation and launch succeeded on the paired
  iPhone 17 Pro. The existing app was updated; no uninstall was performed.
- Existing Watch scheme edits and the generated `CapApp-SPM/Package.swift`
  remained local and uncommitted. Tests used that working tree plus the tested
  commit; this is not a claim that the untouched committed package manifest
  builds without the normal Capacitor sync. Untracked local files were preserved.
- The watch doctor passed its signature/icon checks, but reported no watch
  available for device coverage. No Watch installation or routing result is claimed.

Remaining: alarm permission/UI, first audible alert with locked/Silent/background,
snooze re-alert, Stop and separate cancellation have **not yet been observed**.
No audible test was initiated by the agent. The owner will start each test and
report observations; the matrix below stays unrun until then. No merge,
production app change or server deployment occurred.

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
delivery or Watch behavior has been established in this Linux workspace.** The
owner separately reported 11 bridge tests, both simulator builds and widget
packaging passed on standard Xcode 27.2 with local edits preserved. Record the
tested diff/revision on the PR before attributing that result to an upstream
commit. The shared script-selection change is validated in the Mac evidence above;
physical-device results remain pending.

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
