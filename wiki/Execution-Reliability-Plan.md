# Execution reliability delivery

Source: proposal PR #1021, issue #1018 and accepted owner decisions. The owner
now authorizes implementation and incremental merges to `dev`, including staging,
through this plan ([authority](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6869543997)).
Do not confuse E1–E5 with the original provider-evaluation P2–P5, which remain
unapproved. No production release or paid/live model benchmarks.

| Increment | Delivery and evidence |
|---|---|
| E1: approval identity and durable evidence | Merged #1022; [details](Execution-Records-E1.md) |
| E2: local Undo/stale edits | Merged #1023; [details](Local-Undo-E2.md) |
| E3: Stop → Continue / Modify / Undo, dependable state delivery | Implementation; [details](Stop-Recovery-E3.md) |
| E4: external reconciliation and supported Undo | Next: Calendar create/update stable identity/readback, per-effect Trello checklist evidence and checked cleanup. Unsupported deletes remain explicit. |
| E5: explicit capture authority across modes | Next: dependable direct capture stays immediate; narrowly explicit conversational task/note capture shares authority, mixed/consequential requests require review. No universal-entry redesign. |

Each increment gets isolated tests, relevant authenticated/browser coverage,
documentation, an audit, CI and a separate rebase-merged PR. Preserve Claude
defaults, unrelated data, completion evidence and storage failure boundaries.
Stop never automatically undoes. Unknown outcomes never authorize replay.
No unresolved history is pruned under an invented retention policy.
