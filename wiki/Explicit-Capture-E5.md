# E5 — Explicit capture across input modes

Implements the accepted immediate-capture default within standing E1–E5 scope.
Existing direct entry and Siri/voice `POST /api/capture` retain their deterministic
behavior. Quokka now gives narrowly explicit local capture the same immediate
authority, before a model call. No universal entry-point redesign or provider
change is included.

## Product behavior

- `add task: buy milk`, `add this task buy milk and bread`, and
  `save note: the pool key is in the drawer` capture immediately. A task remains
  not started, undated and untagged; a note stays a note, unpinned. No inferred
  schedule, priority, external destination or fallback surface is invented.
- Text and dictation reaching Quokka use the same pure deterministic authority
  classifier. It recognizes a small imperative grammar, not general intent.
  Questions, quoted examples, conditions, no-action restrictions, additional
  actions, scheduling/metadata requests and external destinations stay in the
  existing model/review flow. Conservative refusals are intentional. A date
  inside literal note text is preserved without scheduling anything.
- Payload text is preserved. Tasks use the existing 500-character title/full
  overflow-in-notes normalization, up to 2,000 characters; longer or ambiguous
  requests stay in review. Simple capture does not require a provider key/call.
- Success says **captured**, not that the real-world task is complete. Durable
  recent-action receipts distinguish explicit-capture authority from a reviewed
  plan and offer E2 preview/Cancel/Undo where still safe.

## Execution boundary

`server/captureAuthority.js` is deliberately pure and browser-importable: no
Node APIs, database, provider or credential imports. The client uses it to avoid
an unnecessary preflight request for ordinary conversation. The authenticated
`POST /api/adviser/capture` always revalidates on the server; no client/model
classification can grant extra authority. It returns `handled:false` for requests
that require the normal reviewed conversation. Integration dependencies are never
resolved on the immediate path.

One chat/request ID identifies one normalized capture. Private request pointers
name the original immutable plan/execution; concurrent calls and later retries,
including fresh-process replay, return its receipt. The local effect, inverse
and receipt use E2's transaction/checkpoint. A failed journal checkpoint prevents
new dispatch. There is no automatic retry of an unknown outcome and no fallthrough
to a model after an uncertain capture response. The UI serializes sends and
reuses a persisted uncertain message's request ID when the user retries the same
text; a confirmed later separate capture can use a new ID. Requests are bounded
and rate-limited. A supplied busy/stopped session and recorded uncertain execution cannot bypass
recovery this way.

Successful Undo retires only the original matching stopped draft, enabling new
capture without silently continuing it. A newer staged revision in the same
session is preserved. Existing direct capture storage/availability is not coupled
to Quokka's journal or provider, and direct capture has not been given a new
universal journal/Undo promise in this increment.

Existing plaintext DB/backups and unpruned private-history limits apply. Prior
field values and approved capture content stay out of general receipts/model
calls; normal chat persistence still contains the user's own messages.

## Validation and integration

Isolated tests cover accepted grammar, no-action/mixed/scheduled/external cases,
content overflow, wrong-surface prevention, duplicate identity and collisions,
reopen/fresh-process replay, auth/broadcast behavior, unavailable storage and
post-Undo/new-draft isolation. Chromium covers actual immediate task/note capture,
local Undo, no chat/model calls for capture, lost response with no model fallback,
and product-UI retry using the original request ID, alongside E1–E4 recovery.
All data/integrations are synthetic and outbound transport fenced.

The E4 post-merge workflow (43545954819) stopped before deployment when the
500-event fsync/snapshot characterization test exceeded its old five-second
budget (5.4s). Its assertions passed in PR/local runs. This increment gives that
disk-heavy rollover test 30 seconds, with identical assertions and no skips.
Current CI/staging evidence is linked from issue #1018; production main and
Claude defaults remain unchanged. Dependency audit is reported per PR.

E5 is merged in [#1026](https://github.com/ryakel/boomerang/pull/1026). Final
combined validation and staging evidence live in [Work Status](Work-Status.md).
