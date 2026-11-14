# Work status and authorization

## Current focus: native alarm delivery experiment (2026-11-14)

The owner authorized preparing the narrow disposable AlarmKit test: "Ok. We can
patch the apps when ready," followed by "Let's build what we can. I will get
codex on my Mac today." This supersedes design-only scope **only for this
experiment**. New feature branch `claude/alarmkit-probe` starts at current dev
`7354b6a` and includes the preceding pickup design notes for continuity.

Implemented: explicit Dev-app test controls, separate alarm permission, one test
in 60 seconds, system Stop/1-minute Snooze, countdown widget, owned-ID cancellation
and daemon readback. App configurations disable scheduling at compile time;
only App Dev enables it. No server/task/calendar/messaging/Clock changes.

**Mac recheck and physical-device tests pending.** Cloud checks cover synthetic
bridge behavior, frontend and project wiring, not native sound or reliability.
[Mac handoff and unrun device matrix](AlarmKit-Probe.md) are the next steps.
Mac evidence is now [posted in PR #1028](https://github.com/ryakel/boomerang/pull/1028#issuecomment-6881167198):
standard Xcode 27.2 (27B52), source b615637 plus preserved local Watch scheme and
Capacitor-generated package edits; 17 bridge/lifecycle tests, both simulator
builds/widget packaging and the signed Dev installation passed.
The existing Dev app was installed and launched after verifying bundle ID
ryakel.boomerang.app.dev; widget ID matches its Dev prefix. Watch installation
and behavior remain unverified.

Phone screenshots then showed App build and Server version both dev-347e0e2:
the older deployed UI was running inside the native shell, so the new alarm
controls were absent. OTA accepts any different manifest version; its older-UI
replacement path was reproduced synthetically. The narrow fix pins packaged
assets and disables server UI updates only behind the native experiment gate,
reconciling retained bundles through the supported updater reset API. It preserves
app data and ordinary App OTA behavior. b615637 compiled and installed, and the
owner's screenshot now shows the new controls, authorized alarm permission and
countdown state. **Owner confirmed audible alert → native Snooze → audible
re-alert → native X stops sound → no test alarm.** Exact Silent/lock/Focus/timing
conditions were not separately reconfirmed; separate cancellation and other
matrix checks remain pending. No departure/pickup completion is inferred.

The owner reported the Island stretching across the top bar with mostly blank
black space. The latest follow-up bounds its compact timer to 40 points and adds
a safe Xcode preview. **New widget/preview compilation and actual phone layout
remain pending.** The Mac also logged an updater readiness semaphore timeout.
Vendor source locates it in readiness-event waiting, not a blocking current()
call; no root cause is confirmed. Phase logs now distinguish loader, current,
reset and readiness boundaries. Builtin identity/reconciliation and cold-resume
persistence remain open until the Mac/phone recheck. No vendor change is made.
Shared-selector validation here: POSIX shell syntax and simulated command checks
passed for all three entry points (standard default, missing-install refusal,
explicit app path containing spaces, inherited beta override, and explicit app
opening). No native tool, installation or deployment was executed by those checks.
Verified here: 19/19 synthetic bridge/lifecycle boundary tests; 56/56 existing reminder
schedule/merge/routine regression tests; real React controls/client with a fake
daemon at 320px and 960px (denial, lost schedule/cancel reply, snooze status,
cleanup, failed daemon read; no browser errors/overflow). The browser harness also
exercises the real updater initializer with synthetic native modules, requiring
builtin readiness with no manifest/download or resume-update registration.
Frontend build; lint
0 errors / 13 existing warnings. Xcode project parses with a temporary external
parser; plugin/shared metadata membership, widget embedding/dependency, all four
bundle configurations, iOS minimums and Dev-only gate checked. Shell syntax and
diff whitespace pass. Audit: 31 existing findings (2 critical, 11 high, 15 moderate,
3 low), unchanged dependency versions. Native build/install of the earlier
revision is recorded above; the latest widget/diagnostic changes and remaining
device matrix still need validation.
Only the existing Dev device installation is authorized. No merge,
staging/production server deployment, production installation, real pickup scheduling, replacing
existing alarms or provider changes are authorized by this experiment.

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

Production `main` remains `e9563d08896f5897076c87ae4f302cec37b63100`.
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
