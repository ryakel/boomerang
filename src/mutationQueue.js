// mutationQueue.js — the rules that decide what the offline mutation queue is
// allowed to replay. Pure: no React, no store, no localStorage, no clock of its
// own (every function that needs `now` takes it). Tested in
// scripts/mutationQueue.test.mjs.
//
// THE BUG THIS CLOSES (2026-09-21, "boomerang text on desktop is always yellow"
// + "tasks will re-appear")
//
// Both symptoms were one queue. The wordmark is a status light — useSyncBounce
// returns `degraded` on exactly one condition, `queueLength > 0` — so a
// permanently yellow wordmark meant a permanently undrainable queue. The
// desktop's held 124 ops, the oldest a week old.
//
// Three defects compounded:
//
//   1. `pushChanges` pushed through `Promise.all` and, on any single rejection,
//      queued the WHOLE batch — including every op that had just succeeded. The
//      same ~19-op batch was queued six times over.
//
//   2. That queue contained its own poison pill. At index 25 a `deleteTask` for
//      94b39e0b…; at 36, 54, 70 and 86, `updateTask` on that same id (the diff
//      engine reacting to hydrates that kept restoring the row, because the
//      delete had never landed). Replay ran in order and cleared the queue only
//      on TOTAL success, so it walked ops 0→35, took a 404 on the PATCH at 36,
//      and kept everything. No ordering satisfies both a delete and a later
//      update of the same row: the queue was unreplayable by construction.
//
//   3. Which meant ops 0–35 re-applied on EVERY replay — and replay fires on
//      every SSE reconnect. That prefix held eight `createTask` ops carrying
//      week-old snapshots, and `POST /api/tasks` upserts the whole row. A task
//      deleted since was re-inserted; a task completed since was reverted to
//      its old status. `findActiveSpawnTwin` only blocks while an ACTIVE twin
//      exists, so a loop task came back the moment its cycle was completed —
//      "Put away mop canisters", due 2026-09-16, resurrected daily.
//
// THE GENERAL RULE: a queued mutation is a SNAPSHOT, not an intent, and a
// snapshot rots. Everything here follows from that — fold a record's ops down
// to one, let a delete win, drop what can never succeed, and expire what is too
// old to still be true.

/** How long a queued op stays replayable. Past this its snapshot is a guess. */
export const QUEUE_TTL_MS = 60 * 60 * 1000

/** Hard ceiling on queue length, enforced after compaction. */
export const QUEUE_MAX = 200

const KINDS = {
  createTask: { verb: 'create', scope: 'task' },
  updateTask: { verb: 'update', scope: 'task' },
  deleteTask: { verb: 'delete', scope: 'task' },
  createRoutine: { verb: 'create', scope: 'routine' },
  updateRoutine: { verb: 'update', scope: 'routine' },
  deleteRoutine: { verb: 'delete', scope: 'routine' },
}

/** `{ verb, scope }` for a known op type, else null. */
export function opKind(op) {
  return KINDS[op?.type] || null
}

/**
 * The record an op acts on, as `"<scope>:<id>"`. A create carries its id inside
 * the payload (the diff builds it from the task itself); update and delete
 * carry it at the top level. Returns null when neither is resolvable — those
 * ops are passed through compaction untouched rather than silently dropped.
 */
export function opRecordKey(op) {
  const kind = opKind(op)
  if (!kind) return null
  const id = kind.verb === 'create' ? op?.data?.id : op?.id
  return id ? `${kind.scope}:${id}` : null
}

/**
 * Fold a queue down to at most one op per record.
 *
 * Three rules, in precedence order:
 *
 *   A DELETE ABSORBS EVERYTHING AFTER IT for the same record. This is the rule
 *   that closes the bug, and it is deliberately asymmetric — "last write wins"
 *   would keep the `updateTask` at index 86 and re-create the very row the user
 *   deleted at 25. Ids are uuids and nothing in the app reuses one, so a
 *   same-id delete→create is never a legitimate resurrection; it is always the
 *   diff engine reacting to a hydrate that restored a row whose delete hadn't
 *   landed yet. Quokka's rollback compensation restores through `upsertTask`
 *   SERVER-side and never rides this queue, so it isn't affected.
 *
 *   A CREATE STAYS A CREATE, carrying the newest payload. The record may not
 *   exist server-side, and `POST /api/tasks` upserts — so a create is the safe
 *   shape either way, where a PATCH would 404 and poison the queue again.
 *
 *   Otherwise the LAST WRITE WINS. Both createTask and updateTask store the
 *   whole record (`data: task`), so the newest op is a complete snapshot and
 *   the ones before it carry nothing extra.
 *
 * Order is preserved: each survivor is emitted at the position of the op that
 * last determined it.
 */
export function compactQueue(ops) {
  const list = Array.isArray(ops) ? ops : []
  const survivors = new Map() // recordKey → { op, verb, index }
  const loose = [] // ops with no resolvable record, kept where they sit

  list.forEach((op, index) => {
    const key = opRecordKey(op)
    const kind = opKind(op)
    if (!key || !kind) {
      loose.push({ op, index })
      return
    }
    const prev = survivors.get(key)

    if (kind.verb === 'delete') {
      survivors.set(key, { op, verb: 'delete', index })
      return
    }
    // A queued delete outranks anything that follows it.
    if (prev?.verb === 'delete') return

    if (prev?.verb === 'create') {
      // Keep the create shape, take the newer snapshot.
      survivors.set(key, {
        op: { ...prev.op, data: op.data ?? prev.op.data },
        verb: 'create',
        index,
      })
      return
    }
    survivors.set(key, { op, verb: kind.verb, index })
  })

  return [...survivors.values(), ...loose]
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.op)
}

/**
 * Split a queue into ops still young enough to replay and ops that have rotted.
 *
 * An op with no `queued_at` is treated as EXPIRED. Those predate this module,
 * so their age is unknowable — and the queue that prompted all this was made
 * entirely of them, a week old and actively resurrecting completed work.
 * "Unknown age" is not a safe thing to replay a whole-row snapshot from.
 */
export function expireOps(ops, { now = Date.now(), ttlMs = QUEUE_TTL_MS } = {}) {
  const kept = []
  const expired = []
  for (const op of Array.isArray(ops) ? ops : []) {
    const at = Number(op?.queued_at)
    if (!Number.isFinite(at) || now - at > ttlMs) expired.push(op)
    else kept.push(op)
  }
  return { kept, expired }
}

/**
 * HTTP status behind a rejection, or null. `status` is read first (the api.js
 * helpers attach it); the message is parsed as a fallback so an error thrown
 * anywhere else, or queued before that change shipped, still classifies.
 */
export function failureStatus(err) {
  if (err == null) return null
  if (typeof err.status === 'number') return err.status
  const match = /\b([45]\d{2})\b/.exec(String(err.message || err))
  return match ? Number(match[1]) : null
}

/**
 * Statuses that will fail identically forever. Retrying these is what pinned
 * the queue — a 404 for a row that is gone stays a 404.
 *
 * 401/403 are deliberately NOT here: a device token rotates hourly, so an
 * expired one is a retry, not a verdict. The TTL is what eventually clears an
 * op that keeps failing for any reason at all.
 */
export const TERMINAL_STATUSES = new Set([400, 404, 405, 409, 410, 413, 422])

export function isTerminalFailure(err) {
  const status = failureStatus(err)
  return status != null && TERMINAL_STATUSES.has(status)
}

/**
 * Everything a replay should do to a raw queue before executing any of it:
 * expire, then compact, then cap. Returns the ops to run plus what was dropped,
 * so the caller can log why a queue shrank.
 */
export function prepareQueue(ops, { now = Date.now(), ttlMs = QUEUE_TTL_MS, max = QUEUE_MAX } = {}) {
  const raw = Array.isArray(ops) ? ops : []
  const { kept, expired } = expireOps(raw, { now, ttlMs })
  const compacted = compactQueue(kept)
  // Cap AFTER compaction: folding is what should reclaim room, so the ceiling
  // only ever bites on genuinely distinct records. It drops the OLDEST, which
  // is a real (if bounded) loss — hence the log at the call site.
  const capped = compacted.length > max ? compacted.slice(compacted.length - max) : compacted
  return {
    ops: capped,
    expired: expired.length,
    folded: kept.length - compacted.length,
    overflowed: compacted.length - capped.length,
  }
}
