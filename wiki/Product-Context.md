# Product context

Source: product-owner handoff, 2026-11-13. This page records product direction,
not a claim that every capability exists or permission to implement it.
Technical scope and approvals live in [Work Status](Work-Status.md), decisions
in [Decision Log](Decision-Log.md), mechanics in [Architecture](Architecture.md)
and the relevant subsystem notes. Inspect code when a document and behavior differ.

## Purpose and success

Boomerang is an execution-first personal assistant: turn intentions into
completed outcomes. Judge success by completed commitments, reduced effort,
fewer missed responsibilities and user trust. Conversation volume and task
counts are not success measures by themselves.

The existing implementation is a personal ADHD task manager with a single-user
architecture (see CLAUDE.md). The product owner confirmed on 2026-11-13:
**optimize for my daily use first; keep future expansion possible**. Validate
near-term UX against that daily use. Preserve sensible boundaries without
adding speculative multi-tenancy, onboarding or market-scale architecture.
Future expansion is an option, not an approved implementation project.

Quokka is the existing AI chat component, not the task engine or all of Boomerang.
AI intelligence should eventually help throughout the application. Voice, text,
direct entry and conversation are complementary modes of one experience. Users
should not have to classify an intention into a specialized workflow first.

Simple capture stays fast and dependable. Preserve what the user expressed;
interpretation/enrichment can add value afterward without becoming a fragile
prerequisite to capture. A unified experience does not require one model call
or the same confirmation flow for every mode. Those are implementation choices
to evaluate against latency, authority and correctness.

## Product principles

1. One intelligent entry point, multiple modes, minimal friction and reliable
   follow-through. This is a product goal, not an approved UI redesign.
2. Distinguish suggested, authorized, executing and verified-complete actions.
   Make failed, partial and uncertain outcomes visible. These are conceptual
   states; a detailed state machine still needs design and approval.
3. A successful model response is not evidence of a completed real-world action.
   Completion needs evidence appropriate to the user's intended outcome.
4. Ask necessary questions, avoid unnecessary clarification and invented facts.
5. Preserve user intent and explicit restrictions across actions and follow-ups.
6. Surface errors and recovery options without claiming a rollback or success
   that has not been verified.
7. AI may be probabilistic; the system of record must have deterministic,
   inspectable rules for identity, authorization, mutations and recorded outcomes.

Measures still need definitions before instrumentation: what counts as a
commitment, when it is verified, and how effort/trust are assessed. A stored
task being marked done may be useful evidence without proving an external
responsibility was fulfilled. Do not replace those distinctions with a task-count
dashboard or claim the desired measurement system is already implemented.

## UX evidence and reference products

The product owner evaluated Flourish and reported these observations. No
independent competitive study, product version or test recordings are recorded
here; treat them as supplied qualitative research rather than measured claims.

| Learn from | Avoid |
|---|---|
| Easy voice/text/conversational input feeding a unified experience | Scheduling suggestions without enough context |
| Conversational prioritization and correction | Responses stopping unexpectedly, broken scrolling and unclear recovery |
| Low friction when expressing intent | Asking users to trust day-to-day execution before reliability is demonstrated |

Existing local UX decisions remain relevant: [Today, Kept 2.0](Today-Kept2.md)
records why inferred impact and arbitrary urgency damaged the experience.
Changes should respect its explicit-signal, calm and one-obligation/one-place
direction unless a new decision deliberately supersedes it.

## Collaboration

Accepted recovery behavior is recorded in Decision Log D006/D007: Stop offers
Continue/Modify/Undo; explicit simple capture is immediate; recent Undo survives
reopening; uncertain external effects are checked before any retry. The
[execution proposal](Execution-Reliability-Proposal.md) sequences implementation;
it is not an implemented capability or authorization to start runtime changes.

This Codex workspace is the primary home for product, UX, architecture,
implementation and testing discussions. Challenge assumptions and explain
tradeoffs; inspect real code; turn agreed choices into scoped proposals; implement
approved work and verify it. No separate assistant review is inherently required.
Keep durable decisions and evidence in the repository/issues so continuity does
not depend on chat history. Recommendations do not silently become authorizations.
