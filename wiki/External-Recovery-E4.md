# E4 — External evidence and supported Undo

Authorized within [E1–E5](Execution-Reliability-Plan.md); follows merged E3 #1024
(`5249d01`, staging workflow 43543683763 succeeded). No live-service/provider
benchmarks, default-model change, production main or universal Undo.

## Calendar create/update

- A create receives a Google-compatible random event ID before approval. The
  event carries a private ownership marker derived from execution/step identity.
  ID and dispatch intent persist before POST. A lost response is checked by GET
  on that exact calendar/event and marker, never by title/date matching or another
  POST. An absent event after an uncertain write does not prove it cannot land
  later, so it remains unknown rather than authorizing a retry. A lost provider
  acknowledgement may establish the effect by marker readback without proving its
  initial revision. In that case Undo stays unavailable to protect possible later
  edits; it never adopts a later ETag as if it were the original write revision.
- Updates capture the event ETag during staging (part of approved revision),
  compare it at execution, PATCH only requested supported fields with `If-Match`,
  and use an operation marker plus readback to verify the result. A stale or
  unavailable revision produces a no-effect/review outcome before mutation.
  Same-plan create/update chains resolve the creator's persisted event revision.
- Preview/Cancel/confirm Undo is per Calendar operation, with a separate durable
  deduplicated receipt. Create Undo deletes only the unchanged owned event.
  Update Undo restores only selected before-fields, with `If-Match` against the
  acknowledged write ETag (readback must match it); any later revision conservatively disables it, including
  unrelated edits. Readback verifies deletion or an inverse operation marker.
  HTTP success alone is insufficient; lost acknowledgements can be reconciled.
- Recovery claims exclude concurrent Continue/Modify/local Undo. Inverse intent
  survives restart, and Check outcome can close both source and inverse receipts.
  Readback failure keeps uncertainty explicit. No unknown mutation is replayed.

Calendar ETags are required for supported updates/Undo. Multi-step external Undo
is deliberately reviewed one operation at a time; own later operations may
conservatively invalidate an earlier inverse ETag. This does not promise automatic
chain reversal, restoration of deletions, shared-calendar side-effect reversal,
or retraction of notifications/copies already delivered. Readback is evidence
from the provider, not an exactly-once/power-loss guarantee.

## Trello checklist partial effects

Persist checklist identity immediately after acknowledgement and each item ID
as returned. Intent precedes each subrequest; Stop prevents subsequent item
requests and avoids automatic cleanup. Lost create identity or unacknowledged
items remain uncertain; retrying Apply never creates another checklist.

Immediate failure compensation checks the just-created checklist's name and
acknowledged item identities/content before cleanup, checks DELETE's HTTP status,
and requires absent readback. Unexpected changes/unacknowledged items preserve
the checklist. Rejected or ineffective cleanup exposes exact residual identity,
acknowledged item IDs/count, uncertain item index and cleanup state in receipts/UI.
Check outcome only reads; it never resends item/create/delete operations.

**Limit:** Trello offers no conditional DELETE. The final read/delete race cannot
be made atomic here. This narrow immediate compensation is best effort; durable
Trello Undo is explicitly unavailable. A user edit after the last cleanup check
can still race cleanup. Other Trello/Notion operation families remain unsupported
for durable Undo and require their own adapters; no blanket guarantee is implied.
External deletion is labelled irreversible before approval and in receipts, with
no no-op “compensation” treated as restoration.

## Storage and tests

Descriptors reuse E3's private recovery table: target identity, selected before/
after content, markers, ETags and acknowledged sub-effects. Existing plaintext
DB/backups privacy/retention limits apply; no credentials, dependency bags or raw
provider response bodies persist. General receipts retain only safe IDs/states.
Integration requests have a 15-second timeout; timeouts remain uncertain.

Synthetic tests cover stable identity, absent/mismatched markers, stale/ABA
revisions, conditional races, lost create/update/inverse responses, deduplication,
checkpoint loss after inverse, reopening, cleanup rejection/false success,
partial/unacknowledged checklist items and Stop between subrequests. Chromium
covers authenticated Check outcome, Calendar preview/Cancel/confirm through the
real hook/modal alongside existing mobile/desktop recovery. Auth gate covers the
new routes; network fences prevent live integrations/models. PR/issue #1018 hold
final counts and CI/deployment evidence.
