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

This Codex workspace is the primary home for product, UX, architecture,
implementation and testing discussions. Challenge assumptions and explain
tradeoffs; inspect real code; turn agreed choices into scoped proposals; implement
approved work and verify it. No separate assistant review is inherently required.
Keep durable decisions and evidence in the repository/issues so continuity does
not depend on chat history. Recommendations do not silently become authorizations.

The owner clarified the working style on 2026-11-14: discuss the user outcome,
alternatives and recommendation before major work. Bring product experience
choices and consequential architecture tradeoffs into conversation; repository
comments preserve the discussion rather than replacing it. During implementation,
explain milestones in terms of user benefit and tradeoffs. Continue minor technical
work autonomously within agreed scope. Current focus is product assessment, with
no new runtime implementation or deployment requested.

## Daily-use evidence under discussion (2026-11-14)

- Hands-free weekend work: voice capture can produce tasks, but the owner could
  not create an embedded checklist and had to combine tasks or enter items later.
- Medication support for a recovering partner: ordinary reminders were the
  available workaround. Scheduling, confirmation and coordination needs remain
  to be explored; no medication regimen is inferred.
- School pickup: the owner maintains redundant alarms because an alert might be
  missed or snoozed and forgotten. The 1:30 PM calendar hold prevents meetings;
  it is not a declared departure time. The owner needs to be in line by 2:30 PM
  on other pickup days and 2:00 PM on Wednesdays, with an estimated 20-minute
  drive. The protected time helps make room for a difficult transition; spare
  time can also be consumed by distraction or repeated snoozing.
- Accepted product direction: one school-pickup responsibility should coordinate
  calendar protection, schedule variations and support for actually leaving,
  reducing the separate records maintained across Calendar, Clock and Reminders.
  The owner subsequently supplied leave-no-later-than targets of 2:00 PM on
  other pickup days and 1:30 PM on Wednesdays; notification/snooze policy remains
  to be designed. The phone normally uses Silent. Shortcuts/alarm coordination is
  an unresolved gap behind the redundant alarms, not an existing working bridge.
  The owner confirmed iOS 27; native AlarmKit is a feasible candidate by OS
  availability, with permission and on-device delivery still to validate.
- Saying "Leaving now" in a text to the owner's wife already acts as a forcing
  function for leaving work. The owner is willing to try that acknowledgment for
  pickup but is unsure whether a separate pickup confirmation is useful. Treat
  this as a trial hypothesis, not a settled requirement. Whether the benefit comes
  from the acknowledgment itself or interpersonal accountability remains open.

Use these situations to assess the full experience before choosing an interface
or architecture. Trial willingness does not authorize building a new feature or
automatically sending messages to anyone.

The owner authorized an experience walkthrough, including ordinary pickup days,
Wednesday, missed cues, repeated snoozing and departure acknowledgment. See
[School Pickup Experience](School-Pickup-Experience.md) for the reviewable draft,
known delivery constraints and pending logistics.
