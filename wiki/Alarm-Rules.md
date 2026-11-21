# Configurable task/routine alarms — dev trial

Status: implementation for the next dev batch, following production v2.62.0.
No live alarm rules have been created or armed by the agent. Native behavior
beyond compilation still requires owner-led device evaluation.

## Product and authority

The owner requested production promotion and then the next batch in dev, chose
active alarms, and corrected the implementation direction to reusable alarm
support around tasks/routines rather than hard-coded pickup behavior. Controls:
editable snooze; Stop silences its cue; a separate configurable acknowledgment
cancels the date's remaining cues without completing the source. No messaging.

Pickup is configuration, not a code path: Wednesday at 13:30, other dates on
demand at 14:00, America/Chicago; early cue five minutes before, then target;
five-minute Snooze; “Leaving now” acknowledgment. The target wins if an early
Snooze would cross it. After target, native Snooze can re-alert after five minutes.
No unrequested automatic post-target escalation. These values are not seeded,
armed or compiled into application policy. They can be entered in the editor.

## Configuration and review

**Interface (BOOM-51, 2026-11-21).** An alarm is set on the loop it belongs to, not in Settings.
- **Loop page:** an **Alarm** card (`src/kept/AlarmCard.jsx`) has a row for each of these:
  - when it rings (a time per weekday);
  - the first warning;
  - snooze;
  - the done button's text;
  - one-off changes.
- **The card also shows:** a preview of the next three, and Arm / Re-arm / Turn off.
- **When-it-rings sheet:** day chips, a time per day, and one-off dates (skip, or ring at a time).
- **Today:** `src/kept/TodayAlarm.jsx` shows today's armed alarm with its done button, then a "done at" line. It also mentions an arming that's about to run out.
- **Settings → Notifications → Alarms:** now an overview of what this phone holds, plus Cancel all. The raw rule form is gone.
- **Where the rules live:** state, the arming window, renewal and summaries are pure, in `src/alarmRuleModel.js`, pinned by `scripts/alarmRuleModel.test.mjs`. `scripts/alarmRulesBrowser.test.mjs` drives the card, Today and the overview against the real routes and a fake native daemon that behaves like the Swift readback.
- **Not covered yet:** alarms on one-off tasks. The server still supports them, but the task editor doesn't have the card yet.

**One arming is the next 16 occurrences.** The phone holds at most 16, and arming sends it the whole plan, cancelling anything left out. So `applyAlarmRulePlan` sends the next 16 across every rule this phone owns, in time order, never the full 28-day plan. Before this, a five-day-a-week rule (20 in 28 days) was refused outright. The card says how far an arming reaches.

**Telling "armed" from "changes waiting".** The phone's readback has keys, targets and states, but no lead or snooze. So:
- the card compares the armed targets with the plan, only up to the last armed date, because a window that slides forward is a renewal, not a change;
- it also compares the revision this phone last armed (`boom_alarm_armed_revisions`). That's a UI hint only; losing it just falls back to comparing times.

**Renewal is offered, never done.** Within five days of the last armed date, with more of the plan left, the card and Today ask for a re-arm.

**Rule fields, unchanged since the trial:** weekly clocks; dated overrides, including skip dates; IANA timezone (defaults to the phone's); early-cue minutes; snooze minutes; acknowledgment label. Dates override weekly entries. There is no calendar write, new task creation, automatic message or provider call.

Saving persists configuration but never adds an alarm. Disabling a rule or
holding an inactive/conflicting source can cancel existing owned alarms. Arming
requires a separate explicit button and a fresh, unchanged server preview.
The trial plans 28 calendar days and accepts at most 16 occurrences (32 cues).
Schedules do not automatically renew: the preview says through which date the
phone is covered. Existing accepted cues that disappear from iOS are not recreated.
Cancelled dates also stay retired on this phone; automatic rearming is excluded.

A source with an ordinary reminder remains held to avoid duplicate local or
Reminders-mirror bells. Clear its ordinary reminder deliberately before arming.
Known task completion/routine pause or enabling an ordinary reminder cancels
owned rule alarms during the existing task/routine refresh. Confirmed server-side
source deletion/inactivity and disabled rules are reconciled on launch/resume.
Routine completion/skips suppress only their dates, preserving future weeks.
Offline phones cannot learn changes made on another device; cached alarms remain
until they reconnect or the owner cancels them locally.

## Persistence and ownership

Migration 063 stores rules/receipts in `alarm_rule_state`, outside whole-blob
settings sync and dev reseeding. Dedicated authenticated dev-only endpoints
validate the model, enforce revision checks and bind each rule to one native
phone identity. Another phone cannot edit/arm it. There is no takeover operation.

The phone keeps an atomic JSON ledger in Application Support, protected until
first unlock. Namespace-derived UUIDs belong only to this subsystem, separate
from the disposable probe and external Clock alarms. Owned IDs are persisted
before scheduling, and every schedule/cancel reads daemon state back. Lost
responses/interrupted writes remain uncertain and are never blindly replayed.
Native operations serialize across awaits. Alarm changes while owned alarms are
ringing/snoozed are refused until the owner acknowledges or cancels them.

An acknowledgment is saved locally before cancellation, with an outbox that
survives reopening/offline use. Server sync is idempotent and preserves the
original label/time. Local success and pending server sync remain distinct in
UI. It records the owner's declaration, not evidence of real-world departure,
arrival or pickup. Only today's occurrence can be acknowledged in its timezone.
No automatic retention pruning was introduced.

Early Snooze uses an owned App Intent. It stops the early cue and reschedules it
only if the requested snooze ends before the independently scheduled target.
Otherwise it leaves the target in place. Target Snooze uses AlarmKit countdown.
The widget uses the configured title without giving Stop completion semantics.

## Verification and limits

Pure calendar tests cover configurable clocks, weekly/on-demand/skip precedence,
fixed timezone/DST and expired/acknowledged occurrences. Store/API tests cover CAS,
phone binding, source uniqueness/holding, idempotent acknowledgment, production
rejection, migration, reseed survival and database reopening. Browser checks drive
the real editor/client with real Capacitor proxies and a fake native daemon at
320/960px: save without arm, explicit arm, acknowledgment sync and no rearm on load.
Native App Dev/App simulator builds and widget packaging are checked separately.

These tests do not prove native App Intent execution, offline file durability
through device restart, countdown delivery, source-cancellation timing or physical
sound. Focus-on/offline/restart and detailed Watch routing from the probe matrix
remain unverified. The Xcode bridge opened after owner approval, but its GUI build reported stale
package products. Normal CLI builds passed. CLI simulator cold launches verified
actual getStatus registration, stable persisted identity across two launches,
notDetermined permission, empty cue/receipt ledgers and builtin-ready, without
calling permission or scheduling methods. This is a native status-only pass. Owner initiates audible tests. Existing Clock alarms
remain the comparison until the real trial is evaluated.

### Verification checkpoint

29/29 alarm policy/bridge/lifecycle tests pass, including migration/reseed/reopen
persistence and routine completion/skip dates. Both browser suites pass at
320/960px with source completion cancellation and stale preview rejection.
Lint: 0 errors/13 existing warnings. Audit: 31 existing findings (2 critical,
11 high, 15 moderate, 3 low), unchanged dependency versions. App Dev and App
CLI builds and widget packaging pass. Native status-only cold launches preserve
identity without prompting or creating cues. Physical arming/snooze/acknowledgment
remains unrun; no new production deployment is part of this batch.

### Owner device check, 2026-11-21

Before BOOM-51, the owner ran the Settings sound test on the Dev phone: "The alarm went off with sound while the phone was locked."

Not reported this time: Snooze re-alert, Stop, Cancel-before-fire, and Silent switch position. The 2026-11-14 probe results in [AlarmKit Probe](AlarmKit-Probe.md) still cover those.

No rule alarm, meaning one armed from the new card, has been tested on the phone yet.
