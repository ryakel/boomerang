# Work status and authorization

As of 2026-11-13; checked against dev `fbae46df6f528c3cf5504326746debdf66b47e37`
and issue [#1018](https://github.com/ryakel/boomerang/issues/1018). Refresh from
current code, user instructions and issue comments before continuing. This
snapshot complements the [decision log](Decision-Log.md), not a standing approval.

| Work | State | Authority / evidence |
|---|---|---|
| Architecture audit and evaluation design | Completed | [Investigation report](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842489957). Findings distinguish implementation from plans. |
| P1 synthetic fixtures, isolation and reproducibility | Completed and merged into dev | [Approval](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842559084), [PR #1019](https://github.com/ryakel/boomerang/pull/1019), [test evidence](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6842854543). No runtime files/seams changed. |
| P1 merge's staging deployment | Previously approved for this merge only; workflow succeeded | [Recorded approval/merge](https://github.com/ryakel/boomerang/issues/1018#issuecomment-6843294678), [run 43361763071](https://github.com/ryakel/boomerang/actions/runs/43361763071). Production main unchanged. |
| Workspace product/decision documentation | Current documentation-only proposal | Product-owner handoff; file organization remains proposed. No merge or deployment included. |
| Additional isolated tests/reproduction | Within P1's authorized boundary if needed | Current 19 cases cover the requested baseline; do not invent more work merely to “resume” a completed phase. Record a concrete gap before extending tests. |
| Execution reliability fixes | Proposed, not authorized | [Risk register](Quokka-P1-Risk-Register.md) recommends a separate bounded fix plan. |
| P2–P5 / agent extraction, new provider adapter, paid benchmark, rollout | Not authorized | P1 review limits; preserve current Claude defaults. Existing utility OpenAI support is not authorization to switch models or migrate Quokka. |

## Engineering evidence and limits

- P1: 19 characterization cases; adjacent suites: 131 tests. PR CI passed on
  Node 22; local P1 runs passed on Node 24. Green `REPRO` checks mean current
  risky behavior was reproduced, not repaired.
- Handoff recheck on merged dev: all 19 P1 cases passed again on Node 24.22.1;
  no tests or runtime code were changed in the documentation proposal.
- Reproduced: concurrent duplicate commit, uncertain external retry, stale
  staged writes/rollback, abort during commit, partial/failed compensation,
  irreversible delete, restart/session loss and event rollover. Sequential
  retry after a completed commit did not duplicate its event.
- Harness uses disposable synthetic DBs, fake integrations/notification sinks
  and verified network fences. It is component-level evidence, not a full
  browser/HTTP/model-loop or live-service evaluation. Disk checks follow an
  explicit flush; they do not establish crash-window durability.
- Existing docs can overstate behavior: Quokka notes describe “atomic” execution,
  while P1 proves partial external effects; Architecture.md includes legacy
  data-flow/test descriptions. Inspect actual tools, `commitPlan`,
  `useAdviser.js` and package scripts before making current technical claims.
- P1 audit recorded 31 existing dependency vulnerabilities, including two
  critical; dependencies/lockfile were unchanged. Counts are dated evidence,
  not a current audit or authorization to update dependencies.
- The handoff's fresh audit reports 32 (2 critical, 11 high, 16 moderate,
  3 low) against the same unchanged lockfile. Advisory counts can change
  independently of repository changes; no remediation is included here.

## Next action

Review this handoff's documentation proposal; the merged P1 suite was rechecked.
There is no remaining P1 implementation to restart. Review the risk register
and discuss a bounded reliability increment next; obtain authority for runtime
changes before implementing it. Audience is settled: owner's daily use first,
with future expansion possible (D005). Capture authority, Stop, irreversible
actions, completion evidence and restart guarantees are open product questions
in the decision log. They do not block isolated testing or product discussion.
