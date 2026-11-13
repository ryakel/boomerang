# E1 — durable execution records

Scope: E1 only, authorized by the product owner's “Yeah let’s do it” after the
recommendation to implement the first reliability increment in
[proposal PR #1021](https://github.com/ryakel/boomerang/pull/1021).
Coordination: [issue #1018](https://github.com/ryakel/boomerang/issues/1018).
No merge, deployment, E2–E5, provider change or paid model call is included.

## Resulting behavior

- The server emits a hash revision of the exact staged plan. Apply submits that
  revision; a changed, missing or busy approval cannot execute a moving plan.
  Older saved plans without a revision require a fresh review.
- Migration 060 creates `adviser_executions`: one row per execution, indexed by
  chat, with immutable identity/revision, state and per-step receipt JSON. Raw
  inputs are frozen in memory for dispatch; only their revision hash, tool/step
  IDs and narrow result identifiers persist. No executable closures, task/note
  text, credentials, provider responses or raw error strings enter the journal.
- Before dispatch, the journal is synchronously persisted. Duplicate Apply
  returns the existing running/completed/uncertain receipt, even after session
  expiry or restart. It does not dispatch, refresh integration tokens, broadcast
  changes again or advance queued work a second time.
- Successful tool return is recorded as **reported applied**, not independently
  verified fulfillment. Errors are conservative: the failing step is unknown;
  earlier compensation is recorded as unverified restoration. Neither an HTTP
  error nor a compensation callback proves absence/reversal of side effects.
- Startup changes interrupted running executions to `needs_checking`, preserving
  prior step evidence and marking interrupted calls unknown. It never resumes
  them. A failed journal write blocks new dispatch until restart; records remain
  conservative rather than claiming an unpersisted result is final.
- Existing abort/expiry can clear the model session, but cannot erase the
  journal. E1 does **not** fix Stop/Continue/Modify/Undo semantics; those are E3.
- Quokka reads durable status by chat independently of SSE/model sessions. The
  status panel distinguishes running, partial and needs-checking outcomes and
  shows per-step evidence. Recovered receipts suppress stale Apply controls for
  that plan revision. It uses bounded polling with a chat-change guard; it is
  not the E3 event-cursor fix.

## Code and API

| Boundary | Implementation |
|---|---|
| Record persistence, restart classification and revision identity | `server/executionJournal.js`, `migrations/060_execution_journal.sql` |
| Exact approval snapshot, deduplication and per-step dispatch/result checkpoints | `server/adviserTools.js` |
| Authenticated execution routes and existing broadcast/queue integration | `server/adviserExecutionRoutes.js`, mounted behind existing `authGate` in `server/server.js` |
| Atomic database-file replacement | `server/atomicPersist.js`, used by `flushNow` and scheduled export in `server/db.js` |
| Revision submission, recovered message state and status panel | `src/api.js`, `src/hooks/useAdviser.js`, `src/components/ExecutionStatus.jsx`, `AdviserModal.jsx/.css` |

`POST /api/adviser/commit` requires `{sessionId, revision}`; invalid/missing
revision returns 409. Other unsuccessful outcomes return structured execution
state and evidence, not permission to retry. `GET /api/adviser/executions/:id`
retrieves a receipt. `GET /api/adviser/executions?chatId=...` returns up to 50
receipts, prioritizing unresolved executions over completed history. These
routes use the existing single-user auth policy and responses are not cached.

## Persistence and safety limits

The current sql.js architecture exports a whole database. Writes now go to a
same-volume temporary file, fsync that file and rename it over the DB, avoiding
in-place truncation. This adds synchronous IO per checkpoint and is not a
directory/power-loss durability guarantee. Disk capacity/large-plan performance
have not been validated against the owner's live DB. Storage-engine replacement
is outside E1.

No SQL transaction spans awaited tool calls: that could accidentally include
unrelated writes on the shared connection. Synchronous local mutations and their
result evidence are checkpointed together in the next exported snapshot. An
interrupted asynchronous tool can have effects without a final receipt; its
intent remains unknown and cannot be blindly retried. This deliberately favors
honest uncertainty over automatic replay. Narrow transactional local adapters
and conflict-aware inverses remain E2 work.

External readback/reconciliation, safe Undo, stale-target version checks and
verified compensation remain E2/E4. A failed execution blocks further staging
of mutations in that session while allowing read-only tools. Users must inspect
the affected task/service; no automatic repair or restart replay is offered.
Existing best-effort compensation remains capable of partial external effects
and stale restoration; the unchanged P1 reproductions continue to expose them.

There is no automatic receipt pruning in E1; retention policy was not approved.
History is bounded in the UI/API list, not silently deleted from storage. Exact
recent-Undo retention and privacy/delete/backup policy need review with E2.
No new capture/model call path was added; fast direct capture and Claude defaults
are unchanged.

## Verification

- 671 tests across 39 offline Node test files passed, excluding full-server
  capture/app-attest suites and the optional browser suite. This includes the
  new journal/storage tests and the revised P1 suite.
- Final targeted E1/P1/storage run: 28 passed. Tests cover duplicate Apply,
  original receipt replay, immutable approval, lost external response, storage
  failures before/after dispatch, a real SIGKILL child process after an effect,
  restart recovery, auth/revision enforcement and no repeated token/broadcast work.
- Storage tests inject fsync/rename failures and verify the prior complete file
  remains readable. Existing DB files/migrations are exercised through synthetic
  disposable databases; no user data is loaded.
- Browser fixture mounts the actual hook/modal and authenticated route module
  with synthetic streamed plans and fake integrations. Chromium checks mobile
  and desktop Apply, reload receipt recovery, stale-control suppression and
  unknown outcomes. Outbound browser requests are restricted to the local
  fixture; application fetch/socket/TLS/UDP are fenced. No full production
  server, background integration or paid call is started.
- Build and lint pass; lint retains 18 existing warnings. Dependencies/lockfile
  unchanged; required audit reports 32 existing vulnerabilities (2 critical,
  11 high, 16 moderate, 3 low).

Commands: `npm run test:quokka-p1`, `npm run test:execution`, `npm run build`,
`npm run lint`. Optional browser command:
`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run test:execution:browser`
requires a local Chromium at `/usr/bin/chromium`. Playwright was installed outside
the repository for this validation, not added to runtime dependencies.

The dev CI workflow runs P1 and E1 journal/storage tests. Updated R1/R2/R2b tests
are safety invariants; remaining `REPRO` cases continue to characterize unfixed
behavior. The new records do not constitute the full recovery experience or
make provider comparisons ready for execution scoring.
