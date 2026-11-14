# School pickup — experience walkthrough

Status: **draft for product review**, 2026-11-14. The owner agreed to one pickup
responsibility and asked for ordinary-day/Wednesday walkthroughs covering missed
alerts, repeated snoozing and departure acknowledgment. This authorizes design
work, not app implementation, calendar changes, messaging or deployment.
[Product context](Product-Context.md), [D010](Decision-Log.md#d010--one-school-pickup-responsibility-trial-departure-acknowledgment).

## What we are trying to improve

The owner currently coordinates Calendar, Clock and Reminders. Redundant alarms
address fear of missing an alert or snoozing and losing track. Even with meetings
blocked, distraction can consume the buffer intended to help departure.

Success means leaving and reaching the pickup line on time with less worry and
less schedule maintenance. Counted alerts, acknowledgments and conversation turns
are not outcomes. "Leaving now" is a trial forcing function, inspired by the
owner's texts to his wife; whether a private acknowledgment has the same effect
remains open. A separate "Picked up" confirmation is also provisional.

## Confirmed constraints and open logistics

| Fact | Other pickup days | Wednesday |
|---|---|---|
| Meetings blocked from | 1:30 PM | 1:30 PM |
| Must be in the pickup line | 2:30 PM | 2:00 PM |
| Usual drive estimate | 20 minutes | 20 minutes |
| Desired departure | Not yet supplied | Not yet supplied |

The 1:30 hold protects availability; it is not a departure instruction. Calendar
protection, planned departure and arrival deadline are separate facts belonging
to one responsibility. The drive estimate is user-supplied, not live traffic.
A fixed arrival deadline must not silently move with a snooze.

Two questions have been put to the owner, and remain unanswered at this draft:

1. What are the desired departure times on ordinary pickup days and Wednesdays?
2. Which devices need to get attention at work, and how are Silent/Focus used?

Before real setup, confirm the actual pickup days, local timezone, existing
calendar/event and hold end, and how the user wants one-off exceptions handled.
These are setup details, not reasons to delay reviewing the experience.

## Recommendation and alternatives

Recommend one responsibility that keeps the weekly variations, existing meeting
protection and departure support together. AI can help capture/explain the intent;
fixed schedule calculations and recorded outcomes need inspectable rules. We are
not yet choosing a new data model or notification transport.

Alternatives considered:

- A single generic reminder asks the owner to supply the reliability and recovery
  themselves; it misses the explicitly reported failure cases.
- More independent alarms improve redundancy but preserve duplicate maintenance
  and cannot explain how a snooze affects the real commitment.
- A conversational coaching session at departure time adds interaction during an
  already difficult transition. Use a direct action cue; optional planning can
  happen earlier.

Persistent follow-up may help this explicitly important responsibility, but it
also adds interruption. Keep any policy opt-in and specific to pickup. Do not
bring back a general alert flood or silently apply critical/global bypass rules.
Exact cadence, delivery strength and maximum follow-up behavior need review.

## Proposed experience

### Before the day

One summary states the calendar protection and next pickup deadline, using the
Wednesday variant automatically when applicable. The owner reviews changes to
external calendar events. An existing hold should be linked/updated deliberately
rather than duplicated. Missing information is preserved as missing; 1:30 is not
substituted as a departure target.

Show concrete readiness facts where available: the device has accepted the
next scheduled cue, permissions need attention, or the schedule has not synced.
A request being queued is not proof it will be heard. Do not label an ordinary
notification as an alarm with stronger behavior than the platform supports.

### A day that goes smoothly

1. **Meeting protection begins at 1:30.** It frees the window; no extra alarm at
   the hold boundary is assumed merely because an event starts.
2. **At the agreed departure target:** "Time to leave for school pickup. Be in
   line by 2:30" (Wednesday: "by 2:00"). Primary action: **Leaving now**.
   Alternative: **Remind me at [specific next time]**. Exact target is pending.
3. **After a successfully recorded departure acknowledgment:** "Leaving now.
   Pickup is still open." Departure prompts stop. A failed save remains visible;
   neither a tap nor an error message is treated as successful persistence.
4. **Pickup completion:** if the owner chooses the second step, **Picked up**
   records today's outcome and ends today's prompts. This does not complete all
   future occurrences. Without that step, the system records departure only;
   no time, location or notification acknowledgment proves pickup happened.

### First cue receives no response

Keep the occurrence unresolved. Follow-up wording: "Pickup still needs your
attention — be in line by [time]." A sent or displayed notification does not
prove the owner noticed it. The remaining planned cues retain their own times;
they must not depend on opening the app or responding to the first cue.

Recommend a small, deliberate follow-up sequence that survives a missed cue.
Its intervals and how strongly it should interrupt remain open pending device
logistics and departure targets. After the arrival deadline, say that pickup
status is unconfirmed; do not infer failure or completion and do not assume an
unbounded ringing loop is acceptable.

### A short snooze, followed by another

The action confirms an exact next cue time, retains the departure target and
arrival deadline, and makes the time consequence visible when relevant. The
next prompt is owned by this occurrence, so a snooze should replace the relevant
cue rather than stack a parallel reminder. Material deadline-risk cues should
not be erased silently; the owner needs to understand any override.

Worked illustration only — these are not chosen departure or alarm times:

| Interaction | Other pickup day | Wednesday |
|---|---|---|
| At 1:35, request five minutes | Next cue 1:40; leaving then estimates 2:00 arrival, 30 minutes before deadline | Next cue 1:40; usual drive uses the entire window to the 2:00 deadline |
| At 1:40, request five more minutes | Next cue 1:45; leaving then estimates 2:05 arrival, 25 minutes before deadline | Next cue 1:45; estimated 2:05 arrival is five minutes after deadline |

Suggested Wednesday copy for the second action: "A 1:45 reminder leaves an
estimated arrival of 2:05. Your line deadline is 2:00." Offer **Leaving now** and
an explicit confirmation of the requested reminder. This explains the consequence
without inventing traffic, changing the deadline or preventing a necessary delay.

Lead ordinary prompts with the intended action. Avoid continually advertising
unused buffer, which could reinforce postponement. Snooze feedback should help
make the particular decision rather than become a countdown dashboard.

### "Leaving now" is recorded

Treat it as evidence of the owner's declared departure, not GPS proof of moving
or evidence that the child was picked up. End departure-focused prompting after
successful acknowledgment. Do not ask for more departure interactions while the
owner is driving. Whether and how to ask about pickup afterward is a trial choice.

No automatic text to the owner's wife is included. Interpersonal accountability
may be valuable, but communication would need a separate explicit design choice
and authorization. No location tracking is assumed.

### "Picked up" is uncertain or omitted

Display the truth: departure declared; pickup not confirmed. Avoid turning a
missing check mark into evidence of a missed real-world responsibility. Keep the
second acknowledgment optional during the experience trial, and observe whether
it reduces worry or adds the routine-tracking burden already reported in Today.

## Exceptions to cover before implementation

- Today's pickup is cancelled or someone else handles it: an explicit one-day
  exception should stop that day's cues without changing the weekly pattern or
  claiming the owner completed pickup. No automatic handoff messages.
- Wednesday hours change for one date: show that exception plainly, preserve
  other Wednesdays, and make affected calendar changes reviewable.
- A cue is not scheduled, sound is disabled, or the phone has an old schedule:
  surface the specific uncertainty. Existing alarms remain the comparison while
  delivery is validated; the draft does not retire them.
- Offline acknowledgment, app suspension, multiple devices, duplicate taps,
  clock/timezone changes and reopening after snooze: the implementation must
  establish durable state and consistent cancellation before claiming reliability.
  We have not selected an offline protocol or channel coordination architecture.

## What the inspected code establishes today

Read-only inspection on dev `7354b6a`:

- [reminderSchedule.js](../src/reminderSchedule.js) makes a pure plan of task and
  routine notifications with stable IDs, a 64-pending-request budget, recurring
  shapes and away handling. It does not implement this pickup experience.
- [localReminders.js](../src/localReminders.js) is native-iOS-only and refreshes
  schedules on the app side. Current plans cache what was last synced; an offline
  phone cannot learn a later server-side schedule edit automatically.
- [BoomerangLocalNotifs.swift](../ios/App/App/BoomerangLocalNotifs.swift) requests
  alert/sound/badge authorization, uses `UNCalendarNotificationTrigger` and the
  default notification sound, and reads pending request IDs back. Its exposed
  methods schedule/inspect/cancel requests; this plugin does not implement pickup
  acknowledgment actions or alarm-grade interruption. Pending readback establishes
  queued requests, not delivery, audibility or user acknowledgment.
- [BoomerangReminders.swift](../ios/App/App/BoomerangReminders.swift) writes an Apple
  Reminders mirror and can attach alarms. [localRemindersOwnAlarms](../src/localReminders.js)
  prevents an extra mirror alarm when this device rings itself. A new pickup flow
  must coordinate delivery ownership rather than add another independent bell.

The gap between a normal notification and the reliability the owner expects from
Clock alarms is a consequential platform/product decision. Device/Focus questions
and on-device evaluation come before promising replacement. No push/AlarmKit/
critical-alert entitlement capability has been selected or claimed here.

## How to judge a trial

Walk through both schedules and ask whether the next action is understandable,
snooze makes the consequence clear, and "Leaving now" helps initiate departure.
Then evaluate delivery on the owner's actual devices before relying on it.

Useful observations: left and arrived on time; prompts missed; snoozes followed
by action versus drift; whether manual alarm/calendar maintenance fell; confidence
before pickup; and whether the optional second check-in became a chore. Capture
only the evidence needed for that evaluation. No new instrumentation is proposed.

Keep medication-support and hands-free checklist capture as separate daily-use
cases in Product Context. This walkthrough is a product draft; it is not approval
for a generic obligations engine, medication scheduling or external actions.
