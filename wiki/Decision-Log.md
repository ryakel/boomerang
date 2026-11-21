# Decision log

This log separates product decisions from implementation authority and evidence.
An accepted direction can still be unimplemented. Merging a test or design PR
does not approve every proposed next step. Current status: [Work Status](Work-Status.md).

## Recording a decision

Use a stable ID, date, status, owner/source, decision, rationale/tradeoffs,
implementation scope/approval, evidence and next review trigger. Statuses:
**proposed**, **accepted**, **superseded**, **rejected**. Preserve old entries and
link their replacements. Record explicit approval with an issue/comment/PR link
where available; do not infer it from a roadmap or a status label. Large designs
can live in their own linked document; keep their decision summary here.

## D001 — Execution-first assistant and complementary input modes

- Date/status: 2026-11-13, **accepted product direction**.
- Owner/source: product owner, 2026-11-13 handoff in Codex; issue #1018 product context.
- Decision: optimize for fulfilled commitments, effort reduction and trust;
  keep capture dependable and make voice/text/direct entry/conversation work
  together. Quokka is one component; AI should eventually serve other surfaces.
- Tradeoff: richer interpretation must earn added latency/complexity. A single
  experience need not route every capture through chat or an LLM.
- Authority: direction only. No new UI, model routing or runtime changes approved.
- Evidence/review: [Product Context](Product-Context.md); revisit with explicit
  outcome definitions, audience and proposed UX changes.

## D002 — Isolate execution reliability before provider comparison

- Date/status: 2026-11-13, **accepted investigation/testing scope**.
- Source: [#1018 P1 approval](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842559084).
- Decision: synthetic fixtures, fake side effects and reproducible execution/
  recovery tests before trusting Claude/OpenAI comparisons. Preserve Claude defaults.
- Tradeoff: delays model experiments but avoids attributing orchestration defects
  to the model. Green characterization tests are evidence, not a safety certificate.
- Authority: P1 only, including narrowly necessary behavior-preserving test seams.
  Runtime fixes, migration and paid calls are excluded; P2–P5 remain unapproved.
- Evidence: merged [#1019](https://github.com/ryakel/boomerang/pull/1019),
  [risk register](Quokka-P1-Risk-Register.md), 19 P1 and 131 adjacent tests passed.
- Next review: prioritize a separately scoped reliability proposal; do not begin
  runtime fixes merely because tests now reproduce them.

## D003 — One-time P1 merge and staging deployment

- Date/status: 2026-11-13, **accepted and executed for PR #1019 only**.
- Source: explicit merge approval and subsequent explicit staging-deployment
  approval in Codex, recorded in [#1018](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6843294678).
- Decision: rebase-merge P1 into dev, including its existing automatic staging
  workflow. Result: `fbae46df6f528c3cf5504326746debdf66b47e37`.
- Evidence: [dev workflow](https://github.com/ryakel/boomerang/actions/runs/43361763071)
  succeeded, including redeploy and verification steps. This is CI evidence,
  not an independent live-data inspection. Production main was unchanged.
- Authority limit: this completed exception is not permission for another merge,
  deployment, provider change or runtime fix. The current handoff authorizes none.

## D004 — Primary collaboration and durable context structure

- Date/status: 2026-11-13; workspace collaboration **accepted**, file organization
  **proposed for review**.
- Source: product-owner handoff in Codex.
- Decision: keep strategy, UX, architecture and engineering discussion together;
  repository documentation/issues preserve continuity. No mandatory external
  ChatGPT review loop. Product discussion does not imply an implementation task.
- Proposed organization: root AGENTS.md routes collaborators; CLAUDE.md retains
  engineering invariants; Product Context holds goals; this log records choices;
  Work Status records scope/evidence; existing subsystem docs retain mechanics.
- Tradeoff: a few short documents provide clear ownership; avoid duplicating
  evolving status across every file or replacing existing subsystem guidance.
- Authority: documentation proposal only. No runtime work or deployment approved.

## D005 — Owner's daily use first

- Date/status: 2026-11-13, **accepted product direction**.
- Source: explicit product-owner reply in this Codex handoff: “My daily use
  first; keep future expansion possible.”
- Decision: optimize and validate near-term improvements against the owner's
  daily workflow. Keep future expansion possible without implementing it now.
- Tradeoff: prioritize concrete personal value and reliability over speculative
  market features; avoid coupling that needlessly prevents later expansion.
- Authority: product audience clarified; no multi-user architecture, runtime
  change or extra implementation scope authorized by this answer.
- Next review: reconsider audience when broader use becomes a concrete goal.

## Historical questions before behavior changes (now see D008/D009 and E1–E5)

### E2 implementation authority — 2026-11-13

After E1 was completed, the owner requested “Merge it and move on.” E1 #1022
was merged into dev; the next identified increment, E2 safe local Undo and
stale-edit protection, is authorized and prepared for review. See
[Local Undo](Local-Undo-E2.md) for actual coverage and limits. No E2 merge or
deployment, E3–E5, provider change or paid benchmark is approved by this work.
The following E1/handoff notes are historical context.

### E1 implementation authority — 2026-11-13

The product owner approved the recommended **E1 only** increment in Codex
(“Yeah let’s do it”), following proposal [#1021](https://github.com/ryakel/boomerang/pull/1021).
This authorizes its additive execution journal/schema, revision/deduplication,
receipt/status API, minimal honest outcome UI and isolated tests. Implementation
is prepared for review; see [Execution Records](Execution-Records-E1.md).
Merge/deployment, E2–E5, provider changes and paid calls remain unapproved.
Accepted Stop/capture/Undo defaults are recorded in issue #1018; the open items
below predate those decisions and are historical recommendations, not authority.

| Question | Recommendation for discussion; not accepted | Why it matters |
|---|---|---|
| What may input authorize immediately? | Direct explicit capture can stay immediate; enrichment/external side effects need an explicit authority policy. | A shared entry point must preserve fast capture without accidental actions. |
| What does Stop mean during commit? | Stop future steps, attempt cancellation where supported, report completed/in-flight/unknown effects; do not promise automatic reversal. | P1 R4 shows current abort semantics are insufficient. |
| How should irreversible and partial actions behave? | Show risk before approval and reconcile actual effects after failure; reserve “rolled back” for verified rollback. | P1 R5–R7 establish non-atomic external effects. |
| What counts as verified completion? | Define evidence by outcome; distinguish task persistence, external API acknowledgment and real-world fulfillment. | Success measures and honest UI state. |
| What must survive restart, and for how long? | Design durable intent/receipts and recovery policy separately from in-memory sessions. | P1 R8 is not solved by transcript persistence. |
| What is the next authorized increment? | Review duplicate/uncertain commits, stale writes, cancellation, residual status and event cursors before provider work. | Prioritization is still a product/engineering decision, not P1 authority. |

## D006 — Standing E1–E5 implementation and integration authority

- Date/status: 2026-11-14, **accepted implementation and merge authority**.
- Source: owner: “keep on building and merging as you go until the whole plan is
  implemented”; [issue record](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6869543997).
- Scope: E2 merge, E3 recovery, E4 supported external adapters, E5 capture;
  separate tested PRs, rebase merges into dev and its automatic staging workflow.
  Supersedes earlier per-increment merge restrictions within this plan only.
- Limits: no production main, model/provider migration or paid evaluation.
- E3 tradeoff: private command/queue/snapshot content persists in the existing
  plaintext DB/backups to support recovery; dependency credentials never do.
  No automatic retention pruning. Queued messages stay held after Stop.
- Evidence/review: [plan](Execution-Reliability-Plan.md), [E3](Stop-Recovery-E3.md).
  Revisit unsupported action families individually, never imply universal Undo.

## D007 — Operation-specific external recovery

- Date/status: 2026-11-14, **accepted implementation within D006**.
- Calendar create/update recovery uses stable identities, operation markers,
  provider revision checks and readback; review Undo per operation. Preserve
  uncertain outcomes and later changes rather than infer absence or replay.
- Trello checklist sub-effects persist as they occur; immediate compensation
  checks status/readback and exposes residuals. No durable Trello Undo promise:
  its nonconditional delete retains a final read/delete race.
- External deletes remain explicitly irreversible. Retention/provider/production
  scope remains unchanged. [Evidence/limits](External-Recovery-E4.md).

## D008 — Immediate explicit local capture with reviewed consequential work

- Date/status: 2026-11-14, **implemented within D006**.
- Product source: [accepted defaults](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6856481691).
- A pure, narrow imperative grammar permits only literal task/note capture before
  any model call. Conditions, restrictions, scheduling/metadata, mixed actions
  and external destinations retain review; unknown cases do not grant authority.
- Server revalidation, immutable request identity, local journal/inverse and
  actual saved-state evidence protect capture. UI retry preserves uncertain
  request identity and never asks a model to repeat an uncertain write.
- Direct capture remains immediate. Capturing a task is not completing its
  real-world commitment. Limits/evidence: [E5](Explicit-Capture-E5.md).

## D009 — Accepted Stop/capture/Undo and uncertainty defaults

- Date/status: accepted in Codex on 2026-11-13; **implemented within supported
  E1–E5 scope**, integrated 2026-11-14. This records product semantics separately
  from D006's now-completed implementation authority.
- Sources: [Stop decision](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6853223055),
  [accepted defaults](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6856481691).
- Stop requests no further dispatch and opens Continue/Modify/Undo. It preserves
  known work and never claims cancellation or reverses it automatically.
  Continue excludes completed/uncertain work; changed remaining work is reviewed.
- Explicit local capture stays immediate; consequential/mixed work stays reviewed.
  Undo survives reopening for supported recent actions and protects later edits.
  Unknown outcomes need evidence before further action, never blind replay.
- Supported families, private plaintext storage and conservative refusal limits
  are explicit in [Work Status](Work-Status.md). A seven-day retention duration
  was proposed, not approved; no automatic pruning was introduced.
- Final evidence: merged #1022–#1026, 754 offline tests and authenticated browser
  recovery/capture. Latest CI/staging outcomes: Work Status and issue #1018.

## D010 — One school-pickup responsibility; trial departure acknowledgment

- Date/status: 2026-11-14, **accepted product direction; acknowledgment is a trial**.
- Source: product discussion in Codex following the owner's daily-use examples.
  "Leaving now" texts to the owner's wife already help force departure from work.
- Decision: coordinate calendar protection, the pickup schedule and departure
  support as one responsibility. The owner explicitly agreed to that direction.
- Supplied facts: the 1:30 PM hold blocks meetings, rather than specifying when
  to leave. Be in line by 2:30 PM on other pickup days, 2:00 PM on Wednesdays;
  estimated drive 20 minutes. Subsequently supplied departure targets: 2:00 PM
  on other pickup days and 1:30 PM on Wednesdays, preserving a nominal ten-minute
  travel buffer. These are user configuration, not code constants.
- Hypothesis: a low-effort departure acknowledgment could help initiate pickup
  rather than merely record that an alert was noticed. Its value should be judged
  by timely departure and reduced worry, not acknowledgment counts.
- Known needs: protection against missed/snoozed alerts and a separate Wednesday
  schedule. Whether a private acknowledgment provides sufficient accountability,
  what follow-ups should do, and whether "Picked up" needs confirmation remain
  open. Alert times, escalation and snooze behavior have not been adopted.
- Authority: product exploration only. No feature implementation, automatic
  messaging, retirement of existing alarms or deployment is approved here.
- Next review: [walkthrough draft](School-Pickup-Experience.md), authorized by
  the owner's "go do that and let me know if you have logistical questions."
  Departure targets and normal Silent-mode use are now supplied. The owner
  clarified that Shortcuts/alarm coordination is not working; redundant alarms
  compensate for that gap. AlarmKit on supported iOS is a researched candidate,
  not an adopted architecture. The owner confirmed iOS 27, satisfying AlarmKit's documented iOS 26+
  availability. Native build, permission and audible delivery remain unverified
  and come before relying on a live trial. Proposed alert/snooze policy remains for review.

## D011 — Bounded native alarm delivery experiment

- Date/status: 2026-11-14, **implementation authorized; native validation pending**.
- Source: after discussing a disposable alarm under Silent/locked/backgrounded
  conditions, the owner said "Ok. We can patch the apps when ready" and then
  "Let's build what we can. I will get codex on my Mac today."
- Build a user-triggered test in Boomerang Dev: separate AlarmKit authorization,
  one alarm after 60 seconds, system Stop/one-minute Snooze, readback and owned-ID
  cancellation. Include the required countdown Live Activity widget. Use the
  iOS 26.1 system Stop API; the owner's iOS 27 meets availability.
- Keep Stop separate from departure/pickup. No custom departure/completion
  action, real weekly schedule, calendar write, messaging, global Silent toggle,
  existing-alarm replacement, provider change or deployment is included.
- Alternative: ordinary UserNotifications do not supply the required Silent
  interruption; a separate Shortcut bridge is unresolved. AlarmKit is a delivery
  candidate, not proof the eventual pickup architecture is selected.
- Compile-time scheduling gate enables App Dev only. This isolates evaluation
  while preserving the ordinary App configuration and current reminder ownership.
- Cloud tests establish synthetic boundary/UI behavior; Mac compilation and the
  [physical-device matrix](AlarmKit-Probe.md) are still required. Keep a draft PR
  and document unrun tests; do not merge/deploy under the completed E1–E5 approval.
- Evaluation update: the owner heard the initial alarm and native-snooze
  re-alert, then confirmed native Stop ended sound and readback showed no test
  alarm. Native Snooze remains intentional; it does not acknowledge departure.
  The reported oversized Island is presentation feedback. These results support
  continuing this bounded experiment, not replacing real alarms or implementing
  pickup scheduling before the remaining conditions and product policy are reviewed.

## D012 — Integrate the disposable alarm experiment into dev

- Date/status: 2026-11-14, **accepted merge and staging deployment authority**.
- Source: owner “Deploy it to dev and we will keep building,” after discussion
  of final isolation/documentation checks and automatic staging effects;
  [record](https://github.com/ryakel/boomerang/pull/1028#issuecomment-6884037809).
- Scope: finish PR #1028 verification/docs, rebase-merge into dev and verify staging.
  Production main, real pickup schedules and new feature semantics are excluded.
- Evidence/limits: [AlarmKit Probe](AlarmKit-Probe.md); delivery under Focus-on,
  offline/restart and detailed Watch routing remain follow-up before a real trial.
- Review trigger: actual deployment result in PR #1028, then agree next product increment.

## D013 — Production promotion of the accumulated dev batch

- Date/status: 2026-11-14, **approved and deployed**.
- Source: owner “Get the changes from dev into prod and then build the next batch into dev.”
- Evidence: release [#1029](https://github.com/ryakel/boomerang/pull/1029),
  [production workflow](https://github.com/ryakel/boomerang/actions/runs/43658383877)
  confirmed v2.62.0; content-neutral [#1030](https://github.com/ryakel/boomerang/pull/1030)
  restored main ancestry in dev. This production approval is consumed by that release.

## D014 — Configurable alarm support for tasks/routines

- Date/status: 2026-11-15, **next dev batch implementation approved**.
- Sources: owner's next-batch instruction; chose active alarms and approved
  editable Snooze/Stop/separate acknowledgment, no automatic messages; clarified
  Wednesday recurring and other dates on demand, America/Chicago. Departure
  target wins over an overlapping early Snooze. Corrected hard-coded pickup
  framing; reusable task/routine alarm configuration is the implementation scope.
- Pickup values are user configuration. No pickup schedule is compiled in or armed
  by the agent. No calendar write, provider change, location inference or new
  production rollout is included. The owner continues to initiate audible tests.
- Implementation mechanics, bounded scheduling/ownership, checks and device-test
  limits: [Alarm Rules](Alarm-Rules.md). Build/review the next batch in dev; do not
  infer approval for later production releases or automatic activation.

## D015 — Production code release of alarm rules, feature kept Dev-only

- Date/status: 2026-11-15, **accepted and deployed**.
- Source: owner chose Codex's recommended option for PR #1032: deploy the code
  to production, keep alarm-rule arming Dev-only.
- Evidence: [#1032](https://github.com/ryakel/boomerang/pull/1032) merged to
  `main`; production workflow
  [43725385116](https://github.com/ryakel/boomerang/actions/runs/43725385116)
  passed its image push, Portainer redeploy and deploy verification. Gates
  checked in code: `/api/alarm-rules` returns 403 off dev
  (`server/alarmRuleRoutes.js`) and the client requires the Dev native build
  flag (`src/alarmRules.js`). Relink [#1033](https://github.com/ryakel/boomerang/pull/1033).
- Not authorized: enabling alarm rules in production, a new production native
  build, arming physical alarms, real pickup/medication workflows. Enabling
  needs an agreed physical-device test matrix and separate approval.

## D016 — Kept 2.0 beyond Today: points and rally removed

- Date/status: 2026-11-15, **accepted**; implementation in BOOM-33 (PR to `dev`).
- Source: owner, after reviewing the app against the Kept 2.0 brief: Kept 2.0
  had reached only the Today screen. "No points, but still want to track the
  tasks getting done in analytics. Points need to die. I think rally is
  probably just points without a score."
- Decision: points and rally (day streak, loop rallies) are removed as product
  concepts on every surface, Quokka and notifications included. Analytics keeps
  completion counts. Provenance data stays stored.
- Related, same conversation: the classic Today screen is gated off but not
  deleted ("not ready to fully kill" it); desktop is deferred ("get the app
  running the way I like it and we can rethink desktop"); the theme is settled
  as Kept with the warmer Kept 2.0 type carried to every mobile surface
  (BOOM-34); Loops gets its own redesign around routine modes (BOOM-35,
  needs a spec and owner decisions before code).
- Merge authority: not included. PRs to `dev` wait for explicit approval.

## D017 — Standing authority to merge into `dev`

- Date/status: 2026-11-15, **accepted (standing)**.
- Source: owner, in conversation: "you are always permitted to run the runs to
  push the app in dev. Let me know if/when we need to rebuild the iOS app or
  push to prod."
- Covers: merging PRs into `dev` and the automatic `boomerang-dev` deploy.
- Excludes: `dev → main` promotion (production) and iOS rebuilds/installs.
  For those, say when one is needed and wait for explicit approval.

## D018 — Loops: modes, not tracking

- Date/status: 2026-11-15, **accepted**; implementation in BOOM-35.
- Source: owner, reviewing a Loops mockup and screenshots of their real loops,
  answering five open questions: "1. Silent 2 quiet row 3. Not sure what this
  is 4. Example? 5. Screenshot incoming they are all over the place", then "Go"
  on the proposed defaults.
- Decisions:
  1. Autopilot is completely silent: no task, no reminder, nothing counted as
     missed.
  2. Missed reminder cycles get one quiet row on Loops, never a badge or banner.
  3. The habit behind-pace push stays gone (deleted 2026-07-24); only copy that
     still promised it changes.
  4. Marking a day done on a loop's page also closes that cycle's open task.
  5. Modes are derived from what a loop already is (stack → Checklist, habit →
     Practice, otherwise Reminder); Autopilot is the owner's choice per loop,
     made on the loop's page. No production loop is changed by the release.
- Merge authority: D017 (standing, `dev` only).

## D019 — Production release of Kept 2.0 beyond Today

- Date/status: 2026-11-21, **approved and deployed**.
- Source: owner, "Ok it's time to start moving this all to production and get
  building. I need to reengage with this app on sabbatical", then "yes, promote
  it once it's merged" for the CI fix.
- Evidence:
  - Release [#1043](https://github.com/ryakel/boomerang/pull/1043) built
    v2.64.1 but did not deploy. Tailscale failed on the Ubuntu 26 runner.
  - [#1045](https://github.com/ryakel/boomerang/pull/1045) pinned the
    runners to `ubuntu-24.04`. Release
    [#1046](https://github.com/ryakel/boomerang/pull/1046) promoted it.
  - [Production workflow 44911059431](https://github.com/ryakel/boomerang/actions/runs/44911059431)
    confirmed appVersion v2.64.2.
  - Content-neutral [#1044](https://github.com/ryakel/boomerang/pull/1044) and
    [#1047](https://github.com/ryakel/boomerang/pull/1047) restored main
    ancestry in dev.
- Both production approvals are used up by these releases. The next promotion
  needs a new one.

## D020 — Keep on Today, and arriving at a place as done

- Date/status: 2026-11-21. Keep on Today is **accepted and built** (BOOM-52). The location trigger is **accepted direction, not yet built**.
- **Keep on Today.**
  - Source: "I want a capability that allows me to put a task that is not due today on the today screen… a conscious choice on my part… from a quick add or from the edit menu", and "it should stay there until it's done or until I uncheck the box or the due date is due or overdue."
  - Decision: it's sticky, not daily. It reuses `pinned_to_today`, already the sticky pin for projects. `committed_on`, the watch/Siri pick that clears nightly, is unchanged.
- **Location as completion.**
  - Source: "can you use geolocation to complete the task for that day. If I am at the school, I made it and we are done", then "Stop alarms + mark done", and "Today pick first".
  - Decision: arriving at a saved place, within a window around that day's alarm, cancels the day's remaining alarms and marks that day's loop done. Building it means native region monitoring, an "Always" location permission and an iOS rebuild.
  - This reverses D014's "no location inference" for this one, owner-requested use. The place stays on the phone; only the arrival time is recorded.
  - Still to settle before building: how the place is saved (for example "I'm here now"), the window's width, and what happens without Always permission.
- Merge authority: D017 (standing, `dev` only). Production is unchanged.

