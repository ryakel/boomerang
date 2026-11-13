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

## Open decisions before future behavior changes

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
