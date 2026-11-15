# E3 — Stop and recovery

Implements the accepted Stop → “what now?” direction within the standing E1–E5
approval. Stop records intent before acknowledging it, lets the current request
settle, and starts no subsequent action. Known applied changes remain applied;
a failed in-flight acknowledgement remains unknown. Stop never automatically
reverses changes or claims cancellation of a remote HTTP request.

## Choices

- **Continue** admits one recovery transition using the receipt sequence. It
  dispatches only `not_started` commands from the approved immutable plan,
  preserving owned field versions and checking for later edits. Repeated
  requests return recorded state. Uncertain/interrupted effects block it.
- **Modify** claims the remaining work into a new conversation session. Completed
  evidence stays in the original execution. The user describes changes; the
  model receives remaining-command/completed-effect context and stages a new
  revision for fresh review. No changed action executes on Modify itself.
- **Undo** uses E2's preview/confirmation and conflict guards for supported local
  changes, including known changes in stopped/modified executions. It blocks
  Continue on that original execution. Unsupported external effects remain
  visible. Unknown outcomes require reconciliation before Undo.
- Stopping thinking before Apply preserves the draft and offers review or a new
  request. Continue here reviews staged changes; it does not approve them.

Queued messages survive Stop and restart in private storage and remain held for
explicit review, even after Continue finishes. They are shown as text; sending
one again is the explicit request to act. No queued instruction silently runs.

## Persistence and delivery

Migration 062 stores private approved command inputs, owned-version guards,
queued message/history text and session snapshots. Dependencies, credentials,
HTTP requests and executable closures are never serialized. This extends E2's
existing plaintext-database/backups privacy boundary: approved content and recent
response text now persist privately, separately from safe public receipts.
No new retention/deletion policy or live-data migration was assumed in testing.

Execution receipts increment a monotonic sequence at each checkpoint. Recovery
claims check it before dispatch. Session events use monotonic cursors independent
of the 500-event buffer; missing ranges return an authoritative current-turn
snapshot. Poll and SSE clients deduplicate by cursor. A snapshot replaces the
current assistant view, rather than appending an old turn again. Persisted
snapshots retain stopped/unknown states across reload/restart; restart never
resumes execution automatically. In-flight remote uncertainty awaits E4 adapters.

Local command/inverse transactions and atomic file replacement retain E1/E2's
limits: this is not a power-loss or exactly-once remote guarantee. Staged draft
approval still expires after 30 minutes; durable approved executions remain
reviewable and guarded rather than silently disappearing with a session TTL.

## Validation

Synthetic suites cover Stop during an awaited request, no automatic reversal,
remaining-only Continue, duplicate/racing recovery, modified revision review,
Undo exclusion, held queues, database reopen, a real fresh-process Continue,
unknown blocking, cursor rollover/snapshot/reopen, and authenticated routes.
P1 R4/R8/R9/R10 become safety invariants; external partial-effect risks stay
characterized until E4. Chromium covers authenticated Stop/reload/Continue,
Modify/new review and supported Undo through the real hook/modal, on mobile
and desktop, with strict synthetic integration/network fences. See the PR and
issue #1018 for final run counts and CI/deployment evidence.
