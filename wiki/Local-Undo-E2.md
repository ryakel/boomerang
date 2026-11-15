# E2 — safe local Undo and stale-edit protection

Scope authorized by the owner's “Merge it and move on” after E1 was complete
and E2 identified as the next increment. E1 [#1022](https://github.com/ryakel/boomerang/pull/1022)
is integrated at dev `e7246dad41740fa3845af7468e009042e12ea7ea`.
This E2 implementation is prepared for a separate review; no E2 merge or
deployment, E3–E5, provider change or paid call is included.

## User behavior

Quokka execution history now offers **Review Undo**, not an immediate reverse
action. The preview identifies records, original field values to restore,
conflicts, and operations that will remain unchanged. **Cancel Undo** changes
nothing. **Undo local changes** requires the preview revision; later edits or
dependencies invalidate it. Repeating the same request returns the same Undo
receipt without reversing anything twice.

The inverse data survives closing the app, session expiry and process restart.
Undo itself is a journaled execution. The source record becomes `undone`, or
`partial` with an explicit notice if unsupported actions remain. Unknown or
running executions cannot be undone before their outcomes are resolved.

| Covered | Limits |
|---|---|
| Local task field patches: title, notes, due date | Excludes connected/critical tasks; completion, ordinary delete, routine/sequence/project operations and other fields are not reversible adapters. Unsupported operations retain their existing execution behavior. |
| Local note body and pinned state | Field edits made afterward cause conflicts; unrelated fields remain unchanged. |
| Simple local task/note creates | Only unedited, unconnected records without later dependencies. Task creates with dates/reminders, project/parent semantics, critical tags or nag opt-in are not covered. Ordinary tags are allowed. |
| Supported create/update chains in one approved plan | Inverses execute in reverse order and preserve the chain. Unsupported project/child chains still execute as before but do not promise Undo. |
| Local field Undo in a completed mixed external plan | Preview lists unsupported effects that remain. Created records in mixed unsupported plans cannot be deleted because other effects might refer to them. |

Task creation Undo checks subsequent row writes, child/blocked-by references,
external/knowledge/routine links and notification history. Any later row write,
including background enrichment, can conservatively make creation Undo
unavailable. It does not guess whether an edit is disposable. Field Undo is
less restrictive: it restores only the originally affected fields, preserving
unrelated edits and activity timestamps. It does not unsend notifications.

## Data and execution boundaries

- Migration 061 adds `adviser_entity_versions` and `adviser_local_undo`. Task/note
  INSERT/UPDATE/DELETE triggers cover all writers, not only Quokka. Field
  counters advance on actual value changes; create guards also use an overall
  row counter. Changing a field away and back still invalidates its old inverse.
- `server/localRecovery.js` captures stage-time preconditions and serializable
  before/after values for supported fields. Guards are included in the approved
  plan hash. Apply preflights local targets before dispatching any plan step and
  rechecks at each step. A stale plan requires fresh review, never an inferred
  overwrite. Created IDs and owned writes within the same plan are tracked.
- Four task/note create/update tool implementations are synchronous. Supported
  local adapters share one SQL transaction for the action, inverse and receipt,
  followed by an atomic database-file checkpoint. No SQL transaction spans an
  await or external request. Unsupported operations preserve existing behavior.
- The journal now exposes a synchronous transaction helper with rollback for
  operation failure and fail-closed handling if the subsequent export fails.
  Undo restores and reads back the supported fields inside that transaction,
  updates both original and Undo receipts, and checkpoints them together.
- Supported local failure compensation uses field-scoped inverse operations
  with version checks and readback; it refuses to erase a newer same-field edit.
  Unsupported/external compensation is still best effort and unverified.
  A created record is kept when uncertain unsupported effects may refer to it;
  automatic compensation does not bypass that safety rule.
  Earned completion/streak data is not reconstructed from task deletion; creation
  Undo is restricted to untouched simple tasks with no completion evidence.
- `GET /api/adviser/executions/:id/undo` is a read-only, no-cache preview.
  `POST` at the same path requires `{revision}` and the existing auth policy.
  Duplicate confirmation returns a durable receipt, including after restart,
  without another broadcast. Conflict returns 409 with no Undo mutation.
- `LocalUndo.jsx` plugs into the execution status history. This applies to
  recorded Quokka executions; direct capture/entry is unchanged. A full Stop →
  Continue/Modify/Undo flow and event cursors remain E3 work.

## Privacy, retention and recovery limits

Unlike the E1 receipt table, the inverse table necessarily retains prior values
of the selected local task/note fields. These values remain in the existing
plaintext database/backups and are returned only by authenticated Undo preview;
they are not copied into general execution receipts, model context or logs.
No auto-pruning policy is introduced: exact recent-Undo retention was not yet
approved, and history must not disappear silently. Retention, backup/delete
handling and any storage ceiling still need a product decision.

On checkpoint failure, the engine does not acknowledge a verified Undo or retry
it. The prior complete file remains authoritative; interrupted records are
unknown after restart. This is not a power-loss guarantee. Reconciliation of an
unknown record still requires inspection; there is no automatic replay.
Version triggers and full-DB checkpoints add work per mutation and have not
been measured against live user data.

All supported changes are undone as a reviewed local group. A conflict in one
supported action blocks that group rather than silently undoing only part of
it. Users can review again after resolving the conflict. External changes,
irreversible deletes and unsupported completion/merge side effects are never
described as reversed.

## Validation

- Full offline Node regression set: **692 passed across 40 test files**, including
  E1/P1/storage and new local recovery cases; excludes full-server capture/
  app-attest and optional browser suites.
- Local recovery tests cover persistent Undo, field conflicts including edits
  away/back, preview races, multi-step chains, later dependencies/connections,
  shared critical-tag policy, unsupported execution compatibility, explicit
  partial coverage and preservation of later edits during failure compensation.
- Fresh-process Undo uses only persisted inverses, without model sessions or
  closures. Injected Undo export failure verifies prior persisted forward state
  and an unknown receipt; retry does not repeat the operation.
- Authenticated route tests check preview/confirmation and duplicate broadcast
  suppression. Browser checks use the actual modal/hook with synthetic local
  HTTP, fake integrations and fenced outbound requests: preview, Cancel, reopen,
  confirm, deduplication and mobile/desktop status recovery.
- Build and lint pass (0 errors, 18 existing warnings); diff/link checks clean.
  Required audit: 32 existing vulnerabilities (2 critical, 11 high, 16 moderate,
  3 low), dependencies unchanged. No user data, live integration, paid call or
  E2 deployment is used.

Commands: `npm run test:execution`, `npm run test:quokka-p1`, `npm run build`,
`npm run lint`. For browser checks use the E1 documented optional Playwright
driver with `npm run test:execution:browser`.
