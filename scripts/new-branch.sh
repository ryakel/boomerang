#!/bin/sh
# Cut a feature branch from the CURRENT origin/dev.
#
# Exists because `dev` merges are rebase merges: merging rewrites your commits'
# SHAs, so a branch cut from the branch you just finished carries the old ones,
# replays already-merged work, and the PR opens "dirty" with no CI. That looks
# like a conflict and isn't one. Always start from origin/dev.
#
#   sh scripts/new-branch.sh reminders-scheduler
#     -> fetches, then checks out claude/reminders-scheduler at origin/dev
set -e
if [ -z "$1" ]; then
  echo "usage: sh scripts/new-branch.sh <thing>   # -> claude/<thing>" >&2
  exit 1
fi
BRANCH="claude/$1"
git fetch origin --prune
git checkout -B "$BRANCH" origin/dev
echo "==> $BRANCH cut from origin/dev ($(git rev-parse --short origin/dev))"
