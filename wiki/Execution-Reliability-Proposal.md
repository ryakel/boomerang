# Execution reliability — implementation proposal

Status: **proposed implementation; no runtime work authorized**. Source: issue
[#1018](https://github.com/ryakel/boomerang/issues/1018), its P1 evidence and the
accepted [Stop/recovery direction](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6853223055)
and [product defaults](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6856481691).
Code inspected at dev `2c969266b848f5ac9e2bed4a830ca9f562baeece`.

## Intended experience

Simple explicit capture stays immediate. Consequential changes have a plan to
review. One approval identifies one version of that plan. Repeated taps or a
lost response must not cause a second execution of the same approved work.

During execution, Stop leads to **Continue, Modify or Undo** with an account of
what completed, what remains and what is uncertain. Stop requests cancellation;
it does not claim an external request was cancelled or automatically undo prior
actions. Continue runs only remaining authorized work. Modify creates a new
reviewable revision for changed remaining actions. Undo reverses supported
completed changes, with preview and conflict checks. None repeats uncertain work.

Example: “2 tasks updated. Calendar result still being checked. 1 task not
started.” Continue/Modify cannot dispatch dependent work until the calendar
result is resolved. Undo can preview the two known task changes while clearly
separating the unknown calendar effect. If no safe next action exists, explain
why rather than presenting an enabled but unsafe choice.

Undo survives closing/reopening the app for recent actions. Proposed initial
coverage is local task/note creates and field updates; other actions explicitly
show limited/unavailable Undo until their adapter is supported. This is a
phased delivery recommendation, not a reduction of the accepted product goal.

## Actual boundaries to change

| Current implementation | Evidence and implication |
|---|---|
| `server/adviserTools.js`: session Map, staging, `commitPlan`, compensation closures | Session/plan/receipts are not durable; no commit lock/revision check. Closures cannot be persisted for recovery. |
| `server/server.js`: `/api/adviser/commit`, `/abort`, session reads, runner queue | Commit and Stop need a shared execution identity. Abort currently clears sessions while commit can continue; queued follow-ups must not bypass a recovery decision. |
| `server/db.js`: sql.js, delayed export, `flushNow`; `migrations/` | A receipt needs explicit persistence boundaries before/after dispatch, not the normal 1s debounce. `writeFileSync`/flush alone does not establish power-loss-safe persistence. |
| `server/adviserToolsTasks.js`, `adviserToolsMisc.js` | Local task/note tools already return compensations, but snapshot restoration can erase newer edits; need serializable inverse operations and preconditions. |
| `server/adviserToolsIntegrations.js` | Creates, irreversible deletes and ignored rollback HTTP errors need capability-specific reconciliation. A generic retry is unsafe. |
| `src/hooks/useAdviser.js`, `src/api.js`, `src/components/AdviserModal.jsx` | Current boolean `ok`/committed display and session-based Stop are insufficient for partial/unknown/recovery states; polling indexes a bounded array. |
| `server/capture.js`, `/api/capture`, direct entry | Preserve fast deterministic capture; do not make it depend on Quokka's journal/model availability. |

This plan changes the execution layer, not Claude/provider routing or the whole
task engine. It does not promise exactly-once remote execution across crashes.
An unavailable remote result must remain unknown until evidence resolves it.

## Proposed minimum architecture

Use a small server-side execution journal with typed plan/step records, not
chat messages, localStorage or an expanding app_data JSON blob. A new additive
migration would hold execution/plan revision, chat link, approval scope, step
order, operation/target, expected version, state, evidence, inverse descriptor,
timestamps and a monotonic event sequence. Exact schema/API is part of E1 review.

- Freeze approved inputs. Key Apply/Continue/Undo requests by execution and
  revision; server-side compare-and-set/locking admits only one dispatcher.
  A duplicate request returns that execution's current status/receipt, not a
  fresh run or misleading empty success. This must survive server restart.
- Persist a dispatch intent **before** side effects, and evidence afterward.
  On restart an interrupted dispatch is unknown; never automatically resume it.
  Local state and local receipt updates should share a DB transaction. External
  calls cannot share that transaction. Journal-write failure prevents dispatch;
  failure after remote dispatch leaves a reconciliation problem, not “failed
  with no effect.” Assess atomic file replacement/error handling in E1 without
  silently expanding into a storage-engine migration. Test process restart and
  failure injection; state power-loss durability limits explicitly.
- Step states: not started, executing, verified applied, verified no effect,
  unknown, undoing, verified undone, undo conflict/unavailable. Execution states
  summarize those facts: ready, running, stopping, awaiting choice, completed,
  partial, needs checking, undone. These are proposal semantics, not a fixed enum.
  Network/HTTP errors alone cannot prove a mutation had no effect.
- Reconciliation is operation-specific readback against stable identity and
  expected state. Matching a title/time alone is not sufficient proof of a
  remote create. Where safe identity/readback is unsupported, remain unknown
  with explicit manual guidance; do not infer success, absence or retry safety.
- Undo is a new journaled execution referencing the original, with its own
  deduplication and results. Use pre/post field values and revision/lineage checks;
  preserve unrelated edits and refuse to overwrite a later conflicting edit.
  Stage-time checks, Apply-time checks and undo-time checks are separate needs.
- Persist replay cursors and derive UI from journal snapshots/events. Reconnect
  uses sequence IDs; an event gap fetches authoritative state. Session/chat TTL
  must not destroy recovery records. Avoid storing credentials, raw provider
  responses or unnecessary sensitive content in receipts.

Proposed retention default: seven days of resolved, reversible history, visible
expiry and explicit handling of sensitive before-values. Keep unresolved cases
visible rather than silently pruning them. Exact retention, storage limits and
backup/delete behavior are **recommended details to approve**, not settled policy.

## Incremental delivery and approval boundaries

Each increment is a separate reviewable implementation PR, using synthetic
fixtures and the existing network fence. Approving E1 would not approve E2–E5,
a merge/deployment, provider work or paid model calls.

| Increment | Scope and deliverable | P1 risks / estimated engineering days |
|---|---|---|
| **E1 — One approval, one tracked execution** | Additive journal and fixed plan revisions; Apply deduplication; persisted step intent/results; status lookup; unknown-state classification and no blind retry after error/restart. Minimal UI for running/partial/needs-checking and retrievable receipt. Existing Stop must not erase journal evidence. No new Undo promise or automatic restart continuation. | R1, R2, R2b, R8; **3–5 days** |
| **E2 — Safe local Undo and stale-write protection** | Serializable inverse operations/readback for local task/note creates and explicitly supported field patches, conflict-aware Apply/Undo, recent-history access after reopening. Undo of a create checks subsequent edits, references and dependent changes before deletion. Ordinary local deletes, task completion, routines, merges and external effects initially show unsupported until their full side effects are covered. | R3/R3b and local recovery; **3–5 days** |
| **E3 — Stop → what now, with dependable state delivery** | Stop stops dispatch of new steps; reconcile in-flight work; preserve receipts and queued messages for explicit review. Continue remaining authorized work, Modify creates a reviewed revision, Undo invokes E2. Monotonic event cursors and gap recovery; reload retains stopped/unknown state. No automatic reversal on Stop. | R4, R9, R10; **3–5 days** |
| **E4 — External reconciliation and supported Undo** | Add one integration/operation family at a time, starting with Calendar create/update if stable identity/readback permits. Persist partial effects as they happen, check compensation responses and expose residuals. Trello checklist partial cleanup gets its own adapter tests. External deletion remains explicitly irreversible until separately designed. | R2b, R5–R7; **4–7 days** |
| **E5 — Capture authority across modes** | Keep current direct capture immediate; introduce the same explicit-capture authority through conversational input only after journal/Undo foundations exist. Classify mixed or ambiguous requests into reviewed plans. No universal entry-point redesign in this increment. | Product authority consistency; **1–3 days** |

Total directional estimate: **14–25 engineering days**, excluding review and
deployment. E1 alone is the recommended first authorization (**3–5 days**).
Its key tradeoff: it establishes honest recoverable execution records without
claiming the full Stop/Undo experience is already delivered. E2/E3 form the
first usable local recovery experience. Keep unsupported actions explicit.
If journal durability requires replacing the DB/storage architecture, return
with that finding and revise scope rather than expanding E1 silently.

## Observable acceptance tests

| Test / fixture | Required result | Increment |
|---|---|---|
| Two clients Apply same revision simultaneously | One dispatch/effect; both identify the same execution; verify disk and fake remote state. | E1 |
| Successful commit response lost, retry before/after restart | Original receipt returned; no duplicate effect. | E1 |
| Remote POST applies but response is lost | Unknown remains explicit; repeated Apply does not POST again; exact readback or manual resolution required. | E1, E4 |
| Journal persistence fails before dispatch | Zero side effects; actionable error. Failure after dispatch preserves unknown outcome rather than authorizing replay. | E1 |
| Process killed at dispatch/evidence boundaries | Restart preserves approved revision and step evidence; interrupted step is reconciled, never blindly re-run. | E1 |
| Staged target edited by another device | Affected action requires review; unrelated edits preserved. | E2 |
| Undo task/note patch after reload; duplicate Undo | Correct prior fields restored once, unrelated fields unchanged; conflicting later edit yields visible conflict. | E2 |
| Undo newly created task now edited/linked elsewhere | No destructive blind deletion; explain dependency/conflict and offer review. | E2 |
| Stop while external call is in flight | No next step starts after Stop is acknowledged; in-flight effect is reported or unknown; no false cancellation. | E3 |
| Continue, Modify and Undo race from multiple clients | Only one valid recovery transition; changed plan requires fresh approval; completed steps never repeated. | E3 |
| Reconnect after >500 events, then reopen stopped plan | Snapshot/sequence recovers correct state without missing completion or duplicating displayed effects. | E3 |
| Partial checklist create; failed reverse API; irreversible delete | Per-effect residuals verified and visible; no “everything undone” from an error response. | E4 |
| Explicit simple capture; no-action text; mixed scheduling request | Simple capture immediate and preserved, no-action causes zero mutation, consequential/mixed plan reviewed; no wrong-surface fallback. | E5 |

Extend P1 tests where gaps exist; deliberately convert relevant REPRO assertions
into safety invariants only as fixes land. Keep unresolved REPRO cases with
clear labels. Add authenticated route and browser recovery tests for E1–E3;
unit tests alone cannot establish review/cancellation semantics. No real user
data, network integrations or model calls are necessary for these checks.

## Scope to approve first

**Recommendation: authorize E1 implementation only**, including its additive
schema/journal, execution/receipt API, minimal honest outcome UI and isolated
tests, on a separate PR. The proposal itself authorizes none of those changes.
Confirm durable-history retention when E2 is scoped. No more competitive
research or additional product questions are blocking E1 design.

No provider abstraction, Claude default change, paid benchmark, task-engine
rewrite, full autonomous scheduling, multi-user architecture, merge or
deployment is included. Each deployment needs its own authorization with the
repository's staging side effects made explicit.
