// pushOps.js — how a batch of per-record writes is sent to the server, and what
// the push baseline may claim afterwards. Pure: no React, no fetch, no store.
// The ops it runs are closures handed in by useServerSync; this module only
// decides ORDER, RETRY and OUTCOME. Tested in scripts/pushOps.test.mjs.
//
// THE BUG THIS CLOSES (2026-09-24, "getting really fucking tired of this thing
// you supposedly fixed") — a regression introduced by the BOOM-17 fix.
//
// guardStaleWrite refuses a per-record write whose declared version is behind
// the server's. pushChanges fired every op in a batch IN PARALLEL, all carrying
// the SAME version claim — the one the client knew when the batch was built.
// The first op the server accepted bumped the version; every other op in that
// batch then declared a version one behind and was refused as stale. Then the
// baseline advanced as if the refused write had landed, and a rehydrate
// overwrote the local edit with the server's copy. The completion vanished
// from the screen; the user tapped again; a one-op batch stuck. Four
// COMPLETED entries for one task. Deterministic for every batch of two or
// more, on a single client, with no race required — worse than the bug it
// replaced.
//
// The prior verification sent single PATCHes one at a time and tested the
// guard as a pure function of (claimed, server). Neither exercised a batch,
// and the batch is how the client pushes. This module exists so the loop that
// actually broke can be driven by a test with fake ops that 409 and then
// succeed — not pinned by grepping the hook's source.

/**
 * Run a batch of write ops SEQUENTIALLY, threading the server's version from
 * each response into the next op's claim via `onVersion`.
 *
 * Each op is `{ key, run, desc }`: `key` identifies the record ("task:<id>" /
 * "routine:<id>"), `run()` performs the request and resolves with the server's
 * response (which carries `version`, and `deduped` for a refused spawn), and
 * `desc` is the serialisable form the offline queue stores.
 *
 * Outcomes, per op:
 *   applied   — landed (first try, or on the one retry after a 409). The
 *               baseline may advance for this record.
 *   held      — refused with 409 twice. The server moved again between the
 *               refusal and the retry. The baseline must NOT advance for this
 *               record, so the next diff regenerates the write; the caller
 *               schedules that re-push. The user's local edit is kept.
 *   dropped   — a terminal status (404, 422…) that would fail identically
 *               forever. The baseline advances so it is not re-diffed.
 *   queued    — a retryable failure (network, 5xx). Its `desc` goes to the
 *               offline queue, which owns it from here; the baseline advances
 *               because the queue is now the record of the pending write.
 *
 * Why sequential and not parallel-with-a-shared-claim: the claim is "the
 * version I last saw", and after the first op lands that is no longer true
 * for the rest. N short round-trips on a tailnet, for N almost always 1–3.
 */
export async function runPushOps(ops, { onVersion, isTerminal }) {
  const out = { applied: [], held: [], dropped: [], queued: [], deduped: false, lastError: null }

  for (const op of ops) {
    let result = null
    let err = null
    try {
      result = await op.run()
    } catch (e) {
      err = e
    }

    // Behind the server. The 409 body carries the current version; take it
    // and try ONCE more with a fresh claim. On a client that cannot rewind
    // (noteVersion is monotonic, stale snapshots are dropped) a 409 is always
    // a genuine "I fell behind", never a stale replay — so re-applying the
    // user's edit on top of the newer version is exactly right.
    if (err && err.status === 409) {
      if (Number.isFinite(err.version)) onVersion(err.version)
      err = null
      try {
        result = await op.run()
      } catch (e) {
        err = e
      }
    }

    if (!err) {
      if (result && Number.isFinite(result.version)) onVersion(result.version)
      if (result?.deduped) out.deduped = true
      out.applied.push(op.key)
      continue
    }

    out.lastError = err
    if (err.status === 409) {
      out.held.push(op.key)
    } else if (isTerminal(err)) {
      out.dropped.push(op.key)
    } else {
      out.queued.push(op.desc)
    }
  }

  return out
}

/**
 * The push baseline after a batch, given which records were HELD.
 *
 * `prevList` is what the server was last known to hold, `currList` is local
 * state now. For every record the batch landed, the baseline becomes the local
 * copy. For a held record it must stay at the server's last-known copy, so the
 * next diff sees the local change again and re-pushes it:
 *
 *   held update  → keep the old copy (local differs → re-pushed as an update)
 *   held create  → leave it out      (local has it, baseline doesn't → re-created)
 *   held delete  → restore the old copy (baseline has it, local doesn't → re-deleted)
 *
 * Returns `currList` itself when nothing was held, so a no-op batch keeps the
 * same reference and re-runs nothing downstream.
 */
export function holdBaseline(prevList, currList, heldIds) {
  if (!heldIds || heldIds.size === 0) return currList
  const prevById = new Map((prevList || []).map(r => [r.id, r]))
  const currIds = new Set((currList || []).map(r => r.id))
  const out = []
  for (const r of currList || []) {
    if (!heldIds.has(r.id)) { out.push(r); continue }
    const old = prevById.get(r.id)
    if (old) out.push(old) // held update: baseline stays at the confirmed copy
    // held create: omitted, so the next diff creates it again
  }
  for (const [id, old] of prevById) {
    if (heldIds.has(id) && !currIds.has(id)) out.push(old) // held delete: restore
  }
  return out
}

/** The record id behind an op key ("task:<id>" → "<id>"). */
export function keyId(key) {
  const i = String(key).indexOf(':')
  return i === -1 ? String(key) : String(key).slice(i + 1)
}
