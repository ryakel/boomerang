# Quokka P1 — execution and recovery evidence

Issue [#1018](https://github.com/ryakel/boomerang/issues/1018), authorized by the
[P1 testing-only review](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842559084).
Baseline: `dev` at `b14a45c291fff304000ee74752fb67c7a9e66c6d`, 2026-11-13.

**E1 review update:** R1/R2/R2b are now safety invariants in the implementation
branch: one concurrent dispatch, original receipt replay, and no blind retry of
unknown external creates. Durable receipts survive restart, while model sessions
still do not. The table below remains the historical P1 baseline. See
[E1 results/limits](Execution-Records-E1.md); other REPRO cases remain unfixed.

**E2 review update:** R3/R3b now assert stale supported-field protection and
field-scoped restoration preserving later edits. Supported local compensation
uses readback; unsupported/external risks remain. The table is historical P1
evidence, not current universal behavior. See [E2 coverage](Local-Undo-E2.md).

**E3/E4 update:** R4/R8/R9/R10 now cover stopped dispatch, durable drafts/queues
and cursor recovery. R5/R6 assert per-effect checklist evidence, checked cleanup
and unverified residuals; R7 explicitly bounds irreversible external deletion.
[External recovery limits](External-Recovery-E4.md) include missing identities,
Trello's nonconditional cleanup race and unsupported operation families. The
baseline below remains historical, not a universal safety guarantee.

**P1 reproduces execution risks; it does not repair them or compare models.**
Green `REPRO` tests mean the documented unsafe behavior still exists. They do
not certify execution safety. Change these assertions deliberately when a
separately approved fix changes the observed behavior.

## Run and interpret

```sh
npm ci --ignore-scripts
npm run test:quokka-p1
# Example: simultaneous-commit reproduction, still verifying isolation first
node --test --test-name-pattern='R1 REPRO' scripts/quokkaP1.test.mjs
```

Requires Node 22+ (the existing CI version), Date mock timers and permission to
spawn a local Node child for restart. No API keys, environment file, server,
device, Docker or network access is required. An EPERM from a sandbox that
forbids child processes is an infrastructure failure, not a skipped test.

### Isolation and fidelity

- `scripts/fixtures/quokka-p1.json` holds only synthetic tasks/calendar/card
  state. Every case creates a fresh temporary sql.js DB with actual migrations
  and DB helpers. No existing DB or user settings are loaded.
- `scripts/helpers/quokkaNetworkFence.mjs` blocks real fetch, socket, TLS and
  UDP creation before dynamically importing app modules. Provider/transport
  canaries are verified before **every** sandbox and restart worker is used,
  including filtered runs. Simulated routes never fall back to real fetch.
  Unexpected routes/hidden transport attempts fail teardown even if app code
  catches errors. Fake integration tokens cannot authenticate to real services.
- `scripts/helpers/quokkaSandbox.mjs` imports real `adviserTools.js`, task
  tools and Calendar/Trello tools. It never imports `server.js` or starts jobs,
  OAuth, listeners or notification transports. Stateful Calendar/Trello fakes
  inject errors, lost responses and concurrency barriers. All other endpoints,
  including nested AI calls, fail closed. `onPlanReady` uses a fake sink.
- No runtime files, provider settings, prompts or defaults changed. There is
  **no production extraction/injection seam**. Scripted calls enter the real
  staging/commit APIs directly; this is not the full model agent loop.
- Date is fixed; concurrency uses explicit barriers, not sleeps. Production
  random IDs are checked relationally. Tests execute sequentially within their
  own Node process because the DB/registry are module singletons.
- Every stateful case checks the persisted unrelated task and simulated
  unrelated calendar/card invariants. Specific cases check whole snapshots or
  intended changes. Disk assertions explicitly flush and independently read
  the file using a fresh SQL connection. This proves persistence **after
  flushing**, not crash durability during the normal 1s persistence window.
- Restart uses a fresh Node process opening the synthetic DB/engine. It proves
  session loss across a process restart, not Express boot, signals or HTTP auth.
- SSE checks use real subscriptions/events with response sinks. Polling tests
  evaluate the **actual `pollSessionForResult` source** from `useAdviser.js` in
  a VM, supplying only hook binding, clock/timer, fetch and UI setters. Source
  boundary assertions fail if it moves. There is no copied polling algorithm
  or React mount. Rendering/visibility/HTTP-reader behavior remains untested.

The fakes model only endpoints needed here, not vendor eventual consistency,
billing or transactional guarantees. These are synthetic reproductions, not
claims that the same failures happened to a real user.

## Results

On Node 24.22.1, **19 P1 cases pass** against unchanged runtime code, including
successful staging/commit, no-action, verified LIFO rollback, reconnect recovery
and the reproductions below. An error acknowledgment alone never proves rollback.

Adjacent unchanged suites: `chatArchive`, `mutationQueue`, `pushOps`,
`scheduleScan`, `aiModelDiscovery`, `taskmodel`, `syncGuards`, `lists`:
**131 tests passed**. Full-project lint: **0 errors, 18 existing warnings**;
new tests have no lint findings. Dependency audit: **31 existing vulnerabilities
(2 critical, 11 high, 15 moderate, 3 low)**; dependencies and lockfile unchanged.
No full server smoke run, live integration, paid model call or deployment ran.

The existing `npm test` command is preserved. The new explicit npm script also
runs in the dev PR workflow. Existing PR-event guards prevent publishing and
deployment; do not merge this PR without review.

## Risk register

Severity is proposed: **High** = duplicate/lost changes or misleading execution
state; **Medium** = recovery/transport ambiguity. “Block” is a recommendation
for the next approval gate, not authorization to implement fixes.

| ID / test prefix | Deterministic reproduction | Verified outcome | Severity / proposed fix | Future provider work |
|---|---|---|---|---|
| R1 | Stage one `gcal_create_event`; start two commits; hold both POSTs at a barrier, release. | Both report success; **two** remote events, DB unchanged. | High. Per-plan lock, stable step idempotency and receipt. | Block integrated execution comparison/rollout. |
| R2 | Complete commit but discard response; retry sequentially. | **One** event; retry gives `ok:true, results:[]`; prior committed event survives only in memory. **Sequential duplication hypothesis falsified** for this path. | Medium. Durable original receipt replay; empty success is not a completion receipt. | Block durable-recovery claims; offline adapter tests may be considered separately. |
| R2b | Fake Calendar applies POST, loses response; retry failed plan. | First error already has an event; retry creates a **second**. | High. Reconcile uncertain writes using stable IDs/receipts before retry. | Block automatic fallback/retry and integrated evaluation. |
| R3 | Stage due-date patch; another writer changes same field; Apply. | Newer date is silently overwritten; concurrent edit on a different field survives. | High. Revision preconditions and stale-plan re-review. | Block integrated execution comparison/rollout. |
| R3b | Apply task patch; pause external create; write concurrent note; release; fail later calendar GET. | Remote create compensates; whole-row rollback **erases intervening note**. DB equals initial state, but that state is now stale. | High. Field-scoped, conflict-aware compensation with revisions. | Block integrated execution comparison/rollout. |
| R4 | Stage event then task patch; pause create; abort/clear session like abort route; release. | Session gone, but commit succeeds and **both effects occur**, including later task step. | High. Product must define Stop semantics, then enforce cancellation/checkpoints and honest status. | Block execution UX/fallback claims. |
| R5 | Patch task; Trello checklist creates; first item POST fails. | Task restores; **empty remote checklist remains**. Failed tool never returned compensation. | High. Tool-local partial cleanup/receipts and residual-effect reporting. | Block atomic-plan claims and integrated execution evaluation. |
| R6 | Patch task; create event; fail later missing-event GET; compensation DELETE returns 503. | DB restores; **created event remains**; no compensation-error detail in response. | High. Check rollback HTTP status; return structured residual/rollback status. | Block rollback-success claims and integrated evaluation. |
| R7 | Delete calendar event; fail later missing-event GET. | Commit fails, **deleted event stays absent**; warning says cannot restore. | High, known limitation reproduced. Separate irreversible operations, clear preview/consent and partial-outcome reporting. | Block atomicity claims; product decision required. |
| R8 | Commit note, stage title, queue follow-up; persist chat/session reference; flush; reopen fresh process. | Note/chat survive; **session/plan/queue vanish**; pending title absent; old-session commit fails. Actual poll callback reports missing session. | High for pending-work recovery. Serializable commands/receipts and visible expired/unknown state; never persist closures. | Block restart-recovery claims; separate design approval. |
| R9 | Deliver message; disconnect; resubscribe without cursor. | Same retained payload delivered again, **no event ID**; stores unchanged. | Medium. Monotonic IDs/cursor and client deduplication. This proves transport repetition, **not** duplicate React bubbles. | Require end-to-end replay evidence before rollout. |
| R10 | Actual poll callback consumes 500 real buffered events; append answer/idle before next read. | Buffer length stays 500; index starts at 500, **misses new answer/idle**, silently stops. Stores unchanged. | High. Monotonic cursor with explicit gap/snapshot recovery. | Block reliability scoring based on current UI completion delivery. |

Run the full suite or match the table's prefix using `--test-name-pattern`.
No production interaction is necessary. Normal rollback applies two real task
updates then fails an external create; exact initial disk/external state proves
LIFO restoration. Normal reconnect verifies buffered/live ordering without writes.

### Outcome vocabulary

- **Successful:** required persisted and simulated external state is verified.
- **Failed, compensated:** both stores verify the expected rollback.
- **Partial:** residual effects or lost concurrent edits remain despite an error.
- **Unknown to caller:** response/session missing; fixture observer can know
  actual state while the caller cannot. Blind retry can duplicate it (R2b).

## Recommended next gate

Review this test-only PR and approve a **separate bounded reliability-fix plan**
for R1/R2b, R3/R3b, R4, R5–R7 and R10 before treating integrated provider results
as trustworthy. First settle Stop, irreversible-delete and restart promises
with the product owner. Durable restart support may need its own design.
Offline adapter/schema work could later receive separate approval, but P2–P5
remain unapproved. These failures occur without a model; switching providers
cannot repair them. No runtime fixes, paid calls, deployment or merge included.
