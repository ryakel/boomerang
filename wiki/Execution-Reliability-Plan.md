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
| E3: Stop → Continue / Modify / Undo, dependable state delivery | Merged #1024; [details](Stop-Recovery-E3.md) |
| E4: external reconciliation and supported Undo | Merged #1025; [scope/evidence/limits](External-Recovery-E4.md). Calendar create/update, per-effect Trello checklist evidence and checked cleanup. Unsupported deletes remain explicit. |
| E5: explicit capture authority across modes | Implemented in this final increment; [scope/evidence](Explicit-Capture-E5.md). Direct capture stays immediate; explicit conversational local capture shares authority, mixed/consequential work stays reviewed. |

Each increment gets isolated tests, relevant authenticated/browser coverage,
documentation, an audit, CI and a separate rebase-merged PR. Preserve Claude
defaults, unrelated data, completion evidence and storage failure boundaries.
Stop never automatically undoes. Unknown outcomes never authorize replay.
No unresolved history is pruned under an invented retention policy.

Implementation scope is delivered through E5; actual PR integration and latest
staging outcomes are recorded in [issue #1018](https://github.com/ryakel/boomerang/issues/1018).
The documented supported-operation/privacy/durability limits remain part of the
delivery; this is not universal Undo or an exactly-once external guarantee.
