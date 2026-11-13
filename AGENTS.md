# Working on Boomerang

Be a product-thinking engineering partner. Discuss strategy, UX and tradeoffs;
inspect the relevant code before technical claims. A product conversation can
end in a recommendation or an open question; it need not become implementation.

## Start here

1. Read [CLAUDE.md](CLAUDE.md) for engineering invariants and branch/release rules.
2. Read [Product Context](wiki/Product-Context.md) for goals and product principles.
3. Read [Work Status](wiki/Work-Status.md) and the current issue's latest comments
   for scope, approvals, evidence and outstanding work.
4. Read [Decision Log](wiki/Decision-Log.md) and the relevant subsystem docs.

These are complementary documents. Current explicit user instructions govern
authorization. Verify dated status against GitHub and code; do not treat an old
roadmap, accepted product direction or merged test PR as approval to implement.

## Collaborate and preserve continuity

- Distinguish product direction, proposed implementation, approved work and
  completed/verified work. Record material decisions and approval sources in
  the decision log; link code evidence and outcomes from issues/PRs.
- Keep enduring goals in Product Context, choices/tradeoffs in Decision Log,
  current authorization/evidence in Work Status, and implementation mechanics in
  existing subsystem docs. Avoid copying whole discussions into every file.
- Follow through on authorized work without repeatedly asking for the same
  approval. Surface only decisions that affect scope or unresolved product
  semantics; do not invent assumptions to fill them.
- Inspect changes and run appropriate tests. Preserve unrelated local work;
  start new branches from current `origin/dev`. Follow CLAUDE.md's documentation
  and commit conventions. Never merge a PR without explicit approval for it.
- Check deployment side effects before merging. `dev` normally auto-deploys
  staging; `main` is production. A one-time deployment approval is not standing
  permission for subsequent deployments.

## Current AI work

Issue [#1018](https://github.com/ryakel/boomerang/issues/1018) is the coordination
record. P1 testing was completed in merged PR #1019; see Work Status for evidence.
Green `REPRO` tests characterize known risks, not fixes. Preserve Claude defaults.
P1 does not authorize runtime fixes, provider migrations, paid benchmarks or new
deployments. Confirm any later authorization in current instructions/issue
comments rather than assuming P2–P5 or proposed reliability fixes are approved.

The owner subsequently authorized E1 execution records only, after proposal
#1021. See [E1 evidence](wiki/Execution-Records-E1.md) for implementation scope
and limits. Merge/deployment, E2–E5 and provider/paid evaluation work still need
their own authority.

The owner then requested merging E1 and moving on to E2. E1 is merged; E2
local Undo/stale-edit implementation is prepared for review. See
[E2 scope and evidence](wiki/Local-Undo-E2.md). E2 merge/deployment and E3–E5
still require explicit authority.
