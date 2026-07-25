---
name: promote-release
description: Promote accumulated work on dev to main (a prod release). Use whenever asked to release, ship to prod, promote dev to main, or cut a release. Also covers repairing a forked trunk (drift alarm).
---

# Promote `dev → main` (lump-sum prod release)

A push to `main` builds `:latest` and deploys prod via Portainer, so every promotion needs its own explicit user approval.

**Why the mechanics are strict (2026-05-30 history):** `dev` and `main` once drifted into a 56-commit phantom "split brain" because promotions ran through cherry-pick branches that minted same-content/different-SHA commits. The rules below make that impossible to recreate: promote only via merge commits, never commit to `main` directly, never cherry-pick/rebase across the two branches.

## Pre-flight

1. **Delete the Wallaby reference assets first.** `wiki/wallaby-reference/` holds external loggd.life images/PDFs that must NOT ship to prod. `git rm -r wiki/wallaby-reference`, commit to `dev` via the normal fresh-ref PR, BEFORE cutting the release branch. (Per user, 2026-06-06.)
2. Run `npm audit`; flag new vulnerabilities.

## Steps

Use a fresh release branch as the PR head — **NEVER `dev` itself** (GitHub auto-deletes the PR head branch on merge; `head=dev` once deleted `dev` from the remote, verified on PR #179).

1. `git fetch origin && git checkout dev && git reset --hard origin/dev`
2. `git push origin dev:refs/heads/claude/release-<thing>` — pushes `dev`'s tip to a short-lived ref.
3. `mcp__github__create_pull_request` with `head: "claude/release-<thing>"`, `base: "main"`. Title `release: <summary>`.
4. Wait for user approval — every promotion is its own approval; previous approvals don't carry forward.
5. `mcp__github__merge_pull_request` with **`merge_method: "merge"`**. NEVER `rebase` or `squash` here, and never cherry-pick — those rewrite SHAs and fork the trunk. The merge commit keeps `main` an exact ancestor-subset of `dev`.
6. `git fetch origin && git checkout main && git reset --hard origin/main` to resync.

After step 5, `git rev-list --count origin/dev..origin/main` stays `0`. `dev` keeps moving forward with the next batch — do NOT reset `dev` back; it legitimately stays ahead of `main`.

## Drift alarm

If `git rev-list --count origin/dev..origin/main` is ever > 0, the trunk has forked (a direct commit to `main`, or a promotion via rebase/cherry-pick). Stop everything and relink with a content-neutral merge of `main` into `dev`: `git checkout dev && git merge origin/main`, push via fresh-ref PR, merge with `merge_method: "merge"`.

## Stranded refs

Fresh refs that never had a PR can't be deleted via the proxy or MCP (ref deletions 403). Ask the user to delete them in the GitHub UI when convenient.
