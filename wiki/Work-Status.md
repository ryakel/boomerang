# Work status and authorization

## Alarm interface in dev (BOOM-51, 2026-11-21)

The owner approved the mockup ("Ok. Let's try it in dev").
- A loop's page gets an Alarm card. Today gets "Alarm today". Settings → Alarms becomes an overview, and the raw form is gone.
- Decisions: renewal is offered, never automatic; the done button doesn't complete the loop; the form leaves Settings.
- Still Dev-only: D015 holds, and enabling in production needs separate approval.
- Owner device evidence so far: the sound test rang with the phone locked. No alarm armed from the new card has been tested on the phone yet. That's next, and it's web-only, so no rebuild beyond the one BOOM-38 already needed.


Everything in the Kept 2.0 table below is in production. The owner asked for
it ("it's time to start moving this all to production"), and promoted the CI
fix separately ("yes, promote it once it's merged"). D019 has the detail.

- Release #1043 built v2.64.1, but the image never deployed. GitHub's new
  `ubuntu-latest` (Ubuntu 26) image broke the Tailscale step, so the runner
  never reached Portainer.
- #1045 pinned both build workflows to `ubuntu-24.04`. #1046 promoted that
  fix. A manual run on `main` (workflow 44911059431) joined the tailnet, sent
  the webhook, and the health check confirmed the server is on v2.64.2.
- #1044 and #1047 relinked `dev` with `main` after each release.
- Follow-up (BOOM-50): the build workflows went back to `ubuntu-latest` (Ubuntu 26) once `tailscale/github-action@v4.4.0` was proven to connect there. v2 needed `sudo -E`, which Ubuntu 26's sudo-rs ignores.
- The production iOS app needs no rebuild. The Dev app needs one rebuild for
  BOOM-38.

## Kept 2.0 beyond Today (2026-11-15)

Claude took over from Codex on 2026-11-15. The Kept 2.0 redesign had reached
only the Today screen; everything else still ran on points, rallies and red
overdue rows. Owner decisions are in D016. Tracked in It's a Plan:

| Ticket | Work | State |
|---|---|---|
| BOOM-33 | Remove points and rally app-wide; Analytics counts completions; classic Today gated off | Merged to `dev` (#1034); in production (v2.64.2) |
| BOOM-34 | Carry the Kept 2.0 type (Fraunces/DM Sans variable) to every mobile surface | Merged to `dev` (#1035); in production |
| BOOM-37 | Tasks list on Kept 2.0 rules: Worth doing next, quiet Slipped card, grouped cards | Merged to `dev` (#1036); in production |
| BOOM-38 | Dev iPhone build takes web updates again (only native changes need a rebuild) | Merged to `dev`; in production. The Dev app needs one rebuild to pick it up |
| BOOM-35 | Loops grouped by mode (Reminder / Checklist / Practice / Autopilot); no trails or counts; marking a day closes the cycle's task | Merged to `dev` (#1038, audit fixes #1039); in production |
| BOOM-36 | Today shows every chosen Google calendar (picker in Settings; timed in Coming up, all-day at the top, a week ahead) | Merged to `dev` (#1041); in production |
| BOOM-41–45 | Analytics Loops tab last-done only; delete a loop; Not now synced across devices; desktop rail Due today; loop GCal series persisted and owned by the loop | Merged to `dev` (#1040); in production |
| BOOM-46 | Remove the daily goal, catch counter and achievements ("game dressed up") | Merged to `dev`; in production |
| BOOM-40 | Loop editor uses the loop page's mode names; Autopilot can be made there. Plus fixes from a full audit of everything shipped 2026-11-15/16 (loops, Tasks list, points leftovers, iOS type, Dev OTA) | Merged to `dev` (#1039); in production |

Desktop is deferred by the owner. BOOM-32 (Kept 2.0 Today) is closed; its
open Loops question moved to BOOM-35.

**Standing authority (owner, 2026-11-15):** "you are always permitted to run
the runs to push the app in dev." Merging PRs into `dev`, and the automatic
`boomerang-dev` deploy that follows, need no per-PR approval. Not covered:
promoting to `main`/production and rebuilding or installing the iOS app; for
those, tell the owner when one is needed and wait for their go-ahead (D017).

**iOS note:** both apps take web changes over the air from their server. The
Dev build pinned its packaged UI during the alarm experiment; BOOM-38 removed
that, which itself needs one rebuild. After that, only native changes need a
rebuild, and the owner is told to rebuild only then.

## Alarm rules: code in production, feature Dev-only (2026-11-15)

Release #1032 put the alarm-rule code on `main`, and production workflow
43725385116 deployed and verified it. Arming stays Dev-only by the owner's
choice (D015): the API returns 403 off dev and the client requires the Dev
native build. Enabling it in production needs a physical-device test matrix
and separate approval. The section below is the pre-release snapshot.

### Pre-release snapshot: configurable task/routine alarm rules

The owner requested accumulated dev changes promoted to production, then the next
batch built in dev. Release #1029 deployed v2.62.0 and #1030 reconciled ancestry.
The active batch adds reusable source-linked alarm configuration, not a hard-coded
pickup feature. Owner-approved controls and pickup configuration are in D014 and
[Alarm Rules](Alarm-Rules.md). No schedule has been created/armed by the agent.

Implementation is in isolated branch claude/pickup-alarm-trial. The native
status-only simulator check, 29 alarm tests, browser suites, lint and both CLI
native builds pass; physical alarm-rule flows remain unrun. Original local
Watch/SPM edits and untracked files remain in the original checkout. Dev-only UI,
API and native gate protect the trial; no next-batch production deployment is
included. Native physical-device behavior still requires owner-led evaluation.

Previous batch: #1028 merged/staging passed at dev-5175d22. Phone source 5138c77
was installed as v2.61.1-20-g5138c77; readiness, resumed controls and probe device
results are recorded in [AlarmKit Probe](AlarmKit-Probe.md). Current PR/evidence
will supersede that installation only when a newer native build is actually installed.

## Product experience context

The owner requested conversation/recommendations before new implementation,
then authorized a walkthrough of ordinary-day and Wednesday pickup, missed alerts,
repeated snoozing and "Leaving now." [Draft](School-Pickup-Experience.md).
One coordinated pickup responsibility is accepted direction. The owner supplied
2:00 PM departure on other pickup days, 1:30 PM on Wednesdays, normally Silent,
and iOS 27. Alert delivery/persistence, any Watch specifics and a separate pickup
confirmation remain open. AlarmKit is the recommended candidate to evaluate; its
OS requirement is met. The subsequent authorization above permits the isolated
native experiment; the full pickup feature is still a design draft. No external
calendar/messaging action or deployment is authorized by that product discussion.


## Delivered: execution reliability E1–E5 (2026-11-14)

The owner's [standing authorization](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6869543997)
covered implementation, tested incremental dev merges and automatic staging.
All five implementation increments are merged into `dev`:

| Increment | Integrated PR | Scope/evidence |
|---|---|---|
| E1 | [#1022](https://github.com/ryakel/boomerang/pull/1022) | [Approval identity and durable evidence](Execution-Records-E1.md) |
| E2 | [#1023](https://github.com/ryakel/boomerang/pull/1023) | [Supported local Undo and stale edits](Local-Undo-E2.md) |
| E3 | [#1024](https://github.com/ryakel/boomerang/pull/1024) | [Stop/recovery, held queues, cursors](Stop-Recovery-E3.md) |
| E4 | [#1025](https://github.com/ryakel/boomerang/pull/1025) | [External evidence and supported Undo](External-Recovery-E4.md) |
| E5 | [#1026](https://github.com/ryakel/boomerang/pull/1026) | [Explicit capture authority](Explicit-Capture-E5.md) |

Final implementation tip: `347e0e23062cb90cb66c2062e6745531d7f2be3d`.
[PR CI 43547693062](https://github.com/ryakel/boomerang/actions/runs/43547693062)
succeeded, including Node 22 tests, build, smoke and PR Docker image.
[Combined dev/staging run 43547847983](https://github.com/ryakel/boomerang/actions/runs/43547847983):
**succeeded**. Image publish and Portainer redeploy succeeded (HTTP 204);
the health/version check confirmed `dev-347e0e2` on its first attempt. This is
workflow evidence, not an independent live-user-data exercise.

Final local evidence: **754/754 across 43 offline test files**, **92/92 targeted
execution tests**, authenticated Chromium mobile/desktop recovery and capture,
including lost responses, UI retry identity, Undo and unsafe-Undo refusal. Build
passes; lint 0 errors / 13 existing warnings. Required audit: 31 existing findings
(2 critical, 11 high, 15 moderate, 3 low); dependencies unchanged. No user data,
live integration or paid model was used in this evaluation.

At that historical delivery checkpoint, production main remained e9563d0;
subsequent approved production release #1029 deployed v2.62.0.
Claude defaults, provider migration and original P2–P5/paid benchmarks remain
outside this delivery. The bounded E1–E5 implementation authority is consumed;
new implementation scope requires a new user direction. Product discussion and
read-only investigation can continue normally.

Supported-operation/privacy/durability limits are part of delivery: this is not
universal Undo or exactly-once remote execution. Initial revisions lost with a
provider acknowledgement may prevent Undo; Trello cleanup has no conditional
DELETE; inverse/history content remains in existing plaintext DB/backups with no
invented pruning policy. See the [plan tracker](Execution-Reliability-Plan.md).

Earlier workflow history is preserved in issue #1018: E2/E3 staging succeeded;
E4 post-merge run 43545954819 timed out in a 500-event disk test before deployment.
E5 increased only that test's budget, retaining its assertions. Latest evidence
above supersedes earlier implementation/review-pending labels below.

## Historical handoff snapshot

As of 2026-11-13; checked against dev `fbae46df6f528c3cf5504326746debdf66b47e37`
and issue [#1018](https://github.com/ryakel/boomerang/issues/1018). Refresh from
current code, user instructions and issue comments before continuing. This
snapshot complements the [decision log](Decision-Log.md), not a standing approval.

| Work | State | Authority / evidence |
|---|---|---|
| Architecture audit and evaluation design | Completed | [Investigation report](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842489957). Findings distinguish implementation from plans. |
| P1 synthetic fixtures, isolation and reproducibility | Completed and merged into dev | [Approval](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842559084), [PR #1019](https://github.com/ryakel/boomerang/pull/1019), [test evidence](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842854543). No runtime files/seams changed. |
| P1 merge's staging deployment | Previously approved for this merge only; workflow succeeded | [Recorded approval/merge](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6843294678), [run 43361763071](https://github.com/ryakel/boomerang/actions/runs/43361763071). Production main unchanged. |
| Workspace product/decision documentation | Current documentation-only proposal | Product-owner handoff; file organization remains proposed. No merge or deployment included. |
| Additional isolated tests/reproduction | Within P1's authorized boundary if needed | Current 19 cases cover the requested baseline; do not invent more work merely to “resume” a completed phase. Record a concrete gap before extending tests. |
| Execution reliability E1 | Merged into dev | Owner requested merge/move on; #1022 integrated at e7246da, staging workflow 43476293571 succeeded. [Evidence](Execution-Records-E1.md). |
| Execution reliability E2 | Authorized; implementation prepared for review | Next increment under the owner's “Merge it and move on.” [Scope/evidence](Local-Undo-E2.md). No E2 merge or deployment authority. |
| P2–P5 / agent extraction, new provider adapter, paid benchmark, rollout | Not authorized | P1 review limits; preserve current Claude defaults. Existing utility OpenAI support is not authorization to switch models or migrate Quokka. |

## Engineering evidence and limits

- P1: 19 characterization cases; adjacent suites: 131 tests. PR CI passed on
  Node 22; local P1 runs passed on Node 24. Green `REPRO` checks mean current
  risky behavior was reproduced, not repaired.
- Handoff recheck on merged dev: all 19 P1 cases passed again on Node 24.22.1;
  no tests or runtime code were changed in the documentation proposal.
- Reproduced: concurrent duplicate commit, uncertain external retry, stale
  staged writes/rollback, abort during commit, partial/failed compensation,
  irreversible delete, restart/session loss and event rollover. Sequential
  retry after a completed commit did not duplicate its event.
- Harness uses disposable synthetic DBs, fake integrations/notification sinks
  and verified network fences. It is component-level evidence, not a full
  browser/HTTP/model-loop or live-service evaluation. Disk checks follow an
  explicit flush; they do not establish crash-window durability.
- Existing docs can overstate behavior: Quokka notes describe “atomic” execution,
  while P1 proves partial external effects; Architecture.md includes legacy
  data-flow/test descriptions. Inspect actual tools, `commitPlan`,
  `useAdviser.js` and package scripts before making current technical claims.
- P1 audit recorded 31 existing dependency vulnerabilities, including two
  critical; dependencies/lockfile were unchanged. Counts are dated evidence,
  not a current audit or authorization to update dependencies.
- The handoff's fresh audit reports 32 (2 critical, 11 high, 16 moderate,
  3 low) against the same unchanged lockfile. Advisory counts can change
  independently of repository changes; no remediation is included here.

## Next action

Review the E2 implementation PR. It adds supported local Undo and stale-edit
guards; full Stop recovery and external Undo are still separate. The text below
is the historical handoff snapshot; current authority is E2 as recorded above.

Review this handoff's documentation proposal; the merged P1 suite was rechecked.
There is no remaining P1 implementation to restart. Review the risk register
and discuss a bounded reliability increment next; obtain authority for runtime
changes before implementing it. Audience is settled: owner's daily use first,
with future expansion possible (D005). Capture authority, Stop, irreversible
actions, completion evidence and restart guarantees are open product questions
in the decision log. They do not block isolated testing or product discussion.
