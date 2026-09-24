import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, saveSettings, saveLabels, loadSettings, uuid, safeSetItem } from '../store'
import { serverCreateTask, serverUpdateTask, serverDeleteTask,
  serverCreateRoutine, serverUpdateRoutine, serverDeleteRoutine, setDataVersion } from '../api'
import { isNativeShell } from '../apiConfig'
import { prepareQueue, compactQueue, isTerminalFailure, QUEUE_MAX } from '../mutationQueue'
import { runPushOps, holdBaseline, keyId } from '../pushOps'

const DEBOUNCE_MS = 300

// Version-mismatch handling reloads the page to pick up the server's new
// bundle. That is only meaningful on the web, where the server serves the
// assets. In the native (Capacitor) shell the bundle is baked into the app
// binary — its version string ("v2.16.1-15-g<sha>" from git describe on the
// build Mac) NEVER equals the server's Docker APP_VERSION ("dev-<sha>"), and a
// reload can't change it, so the reload-on-mismatch path becomes an infinite
// boot loop that also skips hydration. Native updates ship via app rebuilds;
// skip version checks there entirely.
const VERSION_CHECKS_ENABLED = !isNativeShell()
const MUTATION_QUEUE_KEY = 'boom_mutation_queue'

// --- Mutation queue helpers ---
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(MUTATION_QUEUE_KEY) || '[]')
  } catch { return [] }
}

function saveQueue(queue) {
  safeSetItem(MUTATION_QUEUE_KEY, JSON.stringify(queue))
}

// Stamp and fold on the way IN, so the queue can never grow into the state
// that caused this: 124 ops that were the same ~19-op batch six times over,
// holding a delete and four later updates of one row. Compacting here means a
// record contributes one op no matter how many rounds fail.
function enqueueMutations(ops) {
  const now = Date.now()
  const stamped = ops.map(op => ({ ...op, queued_at: now }))
  const queue = compactQueue([...loadQueue(), ...stamped])
  if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX)
  saveQueue(queue)
  return queue.length
}

// Buffer log lines and send to server in batches
const _logBuffer = []
let _logTimer = null
function remoteLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  console.log('[SYNC]', line)
  _logBuffer.push(`[SYNC] ${line}`)
  if (!_logTimer) {
    _logTimer = setTimeout(flushLogs, 200)
  }
}
function flushLogs() {
  _logTimer = null
  if (_logBuffer.length === 0) return
  const lines = _logBuffer.splice(0)
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  }).catch(() => {})
}

function taskSummary(tasks) {
  if (!Array.isArray(tasks)) return 'n/a'
  const done = tasks.filter(t => t.status === 'done').length
  const open = tasks.filter(t => t.status === 'open').length
  return `${tasks.length} total (${open} open, ${done} done)`
}

export function useServerSync(tasks, routines, onHydrate, onVersionMismatch) {
  const clientId = useRef(uuid()).current
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipPushUntil = useRef(0)
  const latestState = useRef({ tasks, routines })
  const serverVersion = useRef(0)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved' | 'offline'
  // Reactive, because it drives the wordmark's `degraded` (yellow) state. Read
  // straight from localStorage during render, it only changed when something
  // ELSE re-rendered the header — so a drained queue could stay yellow.
  const [queueLength, setQueueLength] = useState(() => loadQueue().length)
  const savedTimer = useRef(null)
  const versionMismatchFired = useRef(false)

  // Track previous state for diffing
  const prevTasks = useRef(null)
  const prevRoutines = useRef(null)

  // Single-flight hydration. SSE-update, visibility-change, pull-refresh and
  // the spawn-dedupe rehydrate all call fetchAndHydrate, and with two clients
  // awake they overlap constantly. Un-serialized, an OLDER response can land
  // last and overwrite both local state and the prevTasks push baseline with
  // stale server data — which the next diff then pushes back as real changes,
  // bumping the version, broadcasting, and making the other client hydrate.
  // That is the "double syncing" loop. inFlight holds the running hydrate;
  // queuedHydrate collapses everything asked for while it runs into exactly
  // one follow-up, so the last write always reflects the newest read.
  const inFlight = useRef(null)
  const queuedHydrate = useRef(null)

  // Late-bound ref to fetchAndHydrate so pushChanges (defined earlier) can
  // trigger a rehydrate when the server dedupes a routine spawn — the local
  // phantom copy has to be replaced by server truth. Direct use would be a
  // circular dependency (fetchAndHydrate depends on pushChanges).
  const hydrateRef = useRef(null)

  // If we just reloaded for a version update, skip all version checks this page load
  if (!versionMismatchFired.current && sessionStorage.getItem('boom_reloading_for_update')) {
    sessionStorage.removeItem('boom_reloading_for_update')
    versionMismatchFired.current = true
  }

  const onVersionMismatchRef = useRef(onVersionMismatch)
  onVersionMismatchRef.current = onVersionMismatch

  const fireVersionMismatch = useCallback((newVersion) => {
    if (versionMismatchFired.current) return
    versionMismatchFired.current = true
    if (onVersionMismatchRef.current) onVersionMismatchRef.current(newVersion)
  }, [])

  // Keep latest state ref updated
  useEffect(() => {
    latestState.current = { tasks, routines }
  }, [tasks, routines])

  // THE ONE PLACE the client's idea of the server's data version moves.
  //
  // It used to be assigned in nine places and compared in none — tracked, never
  // used as a guard — so a /api/data response that resolved AFTER this client's
  // own later writes rewound it, and `prevTasks` with it. The next diff then
  // re-detected changes already pushed and pushed them again: two clients
  // ping-ponged ~50 version bumps in 19 seconds and reverted a completed task
  // four times (2026-09-22).
  //
  // The server's version only ever counts UP, so a lower number is always a
  // stale read and is ignored. The one exception is a reconnect: `authoritative`
  // lets the SSE hello move it DOWN, because a restore-from-backup or a fresh
  // database legitimately resets the counter, and without that escape every
  // client would sit permanently ahead of the server and have every write
  // rejected by guardStaleWrite until it was reloaded by hand.
  const noteVersion = useCallback((v, { authoritative = false } = {}) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return serverVersion.current
    if (n > serverVersion.current || authoritative) {
      serverVersion.current = n
      setDataVersion(n) // declared on every per-record write (api.js)
    }
    return serverVersion.current
  }, [])

  // Every queue write goes through one of these two, so the badge and the
  // wordmark can never disagree with what is actually stored.
  const commitQueue = useCallback((next) => {
    saveQueue(next)
    setQueueLength(next.length)
  }, [])

  const enqueue = useCallback((ops) => {
    setQueueLength(enqueueMutations(ops))
  }, [])

  // Operator escape hatch for a queue that is stuck or simply unwanted. Wired
  // to the pending-sync banner in the activity log — from inside the app a
  // held queue is otherwise invisible and uncorrectable.
  const clearQueue = useCallback(() => {
    const dropped = loadQueue().length
    commitQueue([])
    if (dropped) remoteLog(`queue: cleared ${dropped} pending mutation(s) by hand`)
    return dropped
  }, [commitQueue])

  // Bulk push helper — settings/labels only. Tasks and routines never travel
  // through this path (per-record APIs handle them).
  const pushBulkState = useCallback(function pushBulkState() {
    const payload = buildPayload()
    if (!payload) {
      remoteLog('push: no payload, skipping')
      return
    }
    payload._clientId = clientId
    payload._appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    // The native shell's bundle version is stamped by the Mac build and can
    // NEVER equal the server's Docker APP_VERSION — the server's stale-client
    // guard must not treat that mismatch as staleness (same class as the
    // version-mismatch reload loop, sync edition).
    payload._platform = isNativeShell() ? 'native' : 'web'

    remoteLog('push: PUT /api/data (settings/labels) keys=' + Object.keys(payload).filter(k => !k.startsWith('_')).join(','))
    setSyncStatus('saving')

    fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (!res.ok) {
          remoteLog('push: server responded', res.status)
          setSyncStatus('offline')
        } else return res.json().then(r => {
          noteVersion(r.version)
          // Bulk push carries settings/labels ONLY — it must never claim
          // tasks/routines as pushed. Overwriting the per-record snapshots
          // here swallowed any task added in the last ~300ms (the debounced
          // per-record push diffs against these and would see "no change").
          // The snapshots are only bootstrapped when they're still null —
          // the fresh-empty-server path, where local state is the accepted
          // baseline and there's nothing on the server to lose.
          if (!prevTasks.current) prevTasks.current = latestState.current.tasks
          if (!prevRoutines.current) prevRoutines.current = latestState.current.routines
          remoteLog('push: success v' + r.version)
          setSyncStatus('saved')
          if (savedTimer.current) clearTimeout(savedTimer.current)
          savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
        })
        flushLogs()
      })
      .catch(err => {
        remoteLog('push: FAILED:', err.message)
        setSyncStatus('offline')
        flushLogs()
      })
  }, [clientId, noteVersion])

  // Per-record change detection and push
  const pushChanges = useCallback(function pushChanges(currentTasks, currentRoutines) {
    const prev = prevTasks.current
    const prevR = prevRoutines.current

    // No prior snapshot means hydrate hasn't completed (or failed). Refuse to
    // push — local state isn't authoritative until we've successfully read the
    // server's view at least once. Settings/labels changes will still flush
    // via the manual `flush()` path; tasks/routines will sync once a hydrate
    // lands and prev gets set.
    if (!prev || !prevR) {
      remoteLog('push: skipped — not yet hydrated, refusing to push unverified state')
      return
    }

    // Each op carries BOTH how to run it and how to describe it for the queue.
    // These were two parallel loops building two arrays that had to stay in
    // lockstep by index — and the queue-fallback path indexed into the wrong
    // one the moment either loop changed.
    const ops = []

    // Diff tasks
    const prevMap = new Map(prev.map(t => [t.id, t]))
    const currMap = new Map((currentTasks || []).map(t => [t.id, t]))

    // New or updated tasks
    for (const [id, task] of currMap) {
      const old = prevMap.get(id)
      if (!old) {
        ops.push({ key: `task:${id}`, run: () => serverCreateTask(task, clientId), desc: { type: 'createTask', data: task } })
      } else if (JSON.stringify(old) !== JSON.stringify(task)) {
        ops.push({ key: `task:${id}`, run: () => serverUpdateTask(id, task, clientId), desc: { type: 'updateTask', id, data: task } })
      }
    }
    // Deleted tasks
    for (const id of prevMap.keys()) {
      if (!currMap.has(id)) {
        ops.push({ key: `task:${id}`, run: () => serverDeleteTask(id), desc: { type: 'deleteTask', id } })
      }
    }

    // Diff routines
    const prevRMap = new Map(prevR.map(r => [r.id, r]))
    const currRMap = new Map((currentRoutines || []).map(r => [r.id, r]))

    for (const [id, routine] of currRMap) {
      const old = prevRMap.get(id)
      if (!old) {
        ops.push({ key: `routine:${id}`, run: () => serverCreateRoutine(routine, clientId), desc: { type: 'createRoutine', data: routine } })
      } else if (JSON.stringify(old) !== JSON.stringify(routine)) {
        ops.push({ key: `routine:${id}`, run: () => serverUpdateRoutine(id, routine, clientId), desc: { type: 'updateRoutine', id, data: routine } })
      }
    }
    for (const id of prevRMap.keys()) {
      if (!currRMap.has(id)) {
        ops.push({ key: `routine:${id}`, run: () => serverDeleteRoutine(id), desc: { type: 'deleteRoutine', id } })
      }
    }

    if (ops.length === 0) {
      remoteLog('push: no changes detected')
      prevTasks.current = currentTasks
      prevRoutines.current = currentRoutines
      return
    }

    remoteLog(`push: ${ops.length} per-record operation(s)`)
    setSyncStatus('saving')

    // Returned so callers (fetchAndHydrate) can AWAIT a flush of pending local
    // mutations before pulling server state — otherwise a refetch can clobber a
    // change the user just made but that hasn't been pushed yet.
    //
    // SEQUENTIAL, threading the version. This used to be Promise.allSettled
    // over every op at once, each carrying the same version claim — and once
    // the first op landed and bumped the server, every other op in the batch
    // was one behind and refused by guardStaleWrite as stale. Then the
    // baseline advanced as if it had landed and a rehydrate overwrote the
    // local edit. The completion vanished; the user tapped again. Four
    // COMPLETED entries for one task, on one client (2026-09-24). The
    // sequencing, the one retry on 409 and the outcome classes live in
    // src/pushOps.js so a test can drive them with ops that refuse.
    return runPushOps(ops, { onVersion: noteVersion, isTerminal: isTerminalFailure })
      .then(r => {
        // The baseline advances for what landed (and for what is now the
        // queue's problem, or will never succeed). A HELD record — refused
        // twice — keeps its server-side copy in the baseline so the next diff
        // regenerates the write. The local edit is untouched: nothing here
        // rehydrates, because a hydrate would overwrite exactly the change we
        // are trying to land.
        const heldTasks = new Set(r.held.filter(k => k.startsWith('task:')).map(keyId))
        const heldRoutines = new Set(r.held.filter(k => k.startsWith('routine:')).map(keyId))
        prevTasks.current = holdBaseline(prev, currentTasks, heldTasks)
        prevRoutines.current = holdBaseline(prevR, currentRoutines, heldRoutines)

        if (r.queued.length) enqueue(r.queued)

        if (r.lastError) {
          remoteLog(
            `push: per-record FAILED: ${r.lastError.message} —`,
            `${r.applied.length} applied, ${r.held.length} held, ${r.queued.length} queued,`,
            `${r.dropped.length} dropped (terminal)`,
          )
          // Only genuinely pending work reads as offline. A batch that failed
          // only on terminal errors has nothing pending.
          setSyncStatus(r.queued.length || r.held.length ? 'offline' : 'saved')
        } else {
          remoteLog(`push: success, ${ops.length} ops, v${serverVersion.current}`)
          setSyncStatus('saved')
        }

        // A held write is re-pushed on the normal debounce. The version it
        // will claim is whatever the last response taught us, which is the
        // freshest we have; if the server keeps moving faster than we can
        // write, each round costs one retry and one debounce, never a loop.
        if (r.held.length && !debounceTimer.current) {
          debounceTimer.current = setTimeout(() => {
            debounceTimer.current = null
            pushChanges(latestState.current.tasks, latestState.current.routines)
          }, DEBOUNCE_MS * 4)
        }

        // Server refused a create as a duplicate routine spawn (another
        // client won the race). Local state still holds our phantom copy —
        // rehydrate so it's replaced by the surviving twin before anything
        // (auto-sizer, the user) touches the dead id.
        if (r.deduped) {
          remoteLog('push: spawn deduped by server — rehydrating')
          setTimeout(() => hydrateRef.current?.('spawn-dedupe'), 50)
        }
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
        flushLogs()
      })
  }, [clientId, pushBulkState, enqueue, noteVersion])

  // Replay queued mutations.
  //
  // This used to be one promise chain that cleared the queue only on TOTAL
  // success, which made a single unsatisfiable op permanent: the desktop's
  // queue held a deleteTask and four later updateTasks for one row, so every
  // replay 404'd partway through and kept everything — re-running the creates
  // ahead of the 404 on every SSE reconnect. Now the queue is prepared before
  // a single request goes out (expire, then fold, so a delete beats the writes
  // that follow it), each op is judged on its own, and whatever is left is
  // persisted after every step. The queue can only shrink.
  const replayQueue = useCallback(async () => {
    const raw = loadQueue()
    if (raw.length === 0) return

    const { ops, expired, folded, overflowed } = prepareQueue(raw)
    if (expired || folded || overflowed) {
      remoteLog(
        `replay: prepared ${raw.length} → ${ops.length}`,
        `(${expired} expired, ${folded} folded, ${overflowed} over cap)`,
      )
    }
    if (ops.length === 0) {
      commitQueue([])
      remoteLog('replay: nothing replayable left, queue cleared')
      flushLogs()
      return
    }

    remoteLog(`replay: ${ops.length} queued mutation(s)`)
    setSyncStatus('saving')

    const executors = {
      createTask: (op) => serverCreateTask(op.data, clientId),
      updateTask: (op) => serverUpdateTask(op.id, op.data, clientId),
      deleteTask: (op) => serverDeleteTask(op.id),
      createRoutine: (op) => serverCreateRoutine(op.data, clientId),
      updateRoutine: (op) => serverUpdateRoutine(op.id, op.data, clientId),
      deleteRoutine: (op) => serverDeleteRoutine(op.id),
    }

    // Sequential, to preserve order. `remaining` always holds the ops still
    // owed; its head is the one being tried, so resolving or terminally
    // failing it is a shift.
    const remaining = ops.slice()
    let replayed = 0
    let dropped = 0
    let heldBy = null

    for (const op of ops) {
      const exec = executors[op.type]
      if (!exec) {
        remaining.shift()
        dropped++
        continue
      }
      try {
        let r
        try {
          r = await exec(op)
        } catch (first) {
          // Behind the server: take the version the 409 carries and try once
          // more with a fresh claim — same rule as the live push (pushOps.js).
          // A second refusal falls through to the terminal branch below and
          // drops the op: replayed ops are older snapshots, and the queue's
          // TTL is the backstop, so dropping is the safe default here.
          if (first?.status !== 409) throw first
          if (Number.isFinite(first.version)) noteVersion(first.version)
          r = await exec(op)
        }
        if (r?.version) noteVersion(r.version)
        remaining.shift()
        replayed++
      } catch (err) {
        if (isTerminalFailure(err)) {
          // Will fail identically forever. Drop it and keep going rather than
          // letting it hold the whole queue hostage.
          remoteLog(`replay: dropping ${op.type} — ${err.message}`)
          remaining.shift()
          dropped++
          continue
        }
        // Retryable (network, 5xx, auth mid-rotation). Stop here: the rest
        // would almost certainly fail the same way, and order still matters.
        heldBy = err
        break
      } finally {
        // Persist after every step, so a tab closed mid-replay resumes from
        // where it got to instead of re-running what already landed. The
        // React state is left alone until the loop ends — setting it here
        // would re-render the whole app once per op.
        saveQueue(remaining)
      }
    }

    commitQueue(remaining)
    if (heldBy) {
      remoteLog(`replay: held at ${remaining.length} op(s) — ${heldBy.message}`)
      setSyncStatus('offline')
    } else {
      remoteLog(`replay: done, ${replayed} replayed, ${dropped} dropped`)
      setSyncStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
    }
    flushLogs()
  }, [clientId, commitQueue, noteVersion])

  // Fetch server data and hydrate local state
  const runHydrate = useCallback((reason) => {
    // CRITICAL: flush any pending local mutations BEFORE pulling server state.
    // A debounced completion/edit lives only in local state until it pushes; if
    // a refetch (another device's SSE update, or this app simply regaining
    // focus) lands first and we overwrite local state with the server's copy,
    // the unpushed change is lost — the classic "I checked it off and it came
    // back" bug. We push first, then fetch the merged result.
    let flush = Promise.resolve()
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
      if (hydrated.current) {
        remoteLog(`${reason}: flushing pending local changes before hydrate`)
        flush = Promise.resolve(
          pushChanges(latestState.current.tasks, latestState.current.routines)
        ).catch(() => {})
      }
    }
    return flush.then(() => {
    remoteLog(`${reason}: fetching /api/data`)
    return fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          // A snapshot OLDER than what we already know is a read that lost a
          // race with our own writes. Applying it rewinds local state (the
          // completion you just made disappears) and rewinds `prevTasks`, so
          // the next diff re-pushes what was already pushed — which broadcasts,
          // which makes the other client hydrate, which does the same. Drop it.
          //
          // Nothing is lost by dropping: the snapshot being behind us is
          // exactly what makes our own state the newer of the two. No re-fetch
          // either — SSE delivers the next version on its own, and retrying
          // here would spin against a server that kept serving stale reads.
          const incoming = Number(data._version) || 0
          if (incoming < serverVersion.current) {
            remoteLog(`${reason}: DROPPED stale snapshot v${incoming} — already at v${serverVersion.current}`)
            flushLogs()
            return
          }
          noteVersion(incoming)
          remoteLog(`${reason}: got v${serverVersion.current}, tasks=${taskSummary(data.tasks)}`)
          skipPushUntil.current = Date.now() + 2000
          onHydrate(data)
          if (data.tasks) saveTasks(data.tasks)
          if (data.routines) saveRoutines(data.routines)
          if (data.settings) {
            // Preserve local theme. Theme is device-local (laptop vs phone vs
            // tablet have different ergonomics; user might prefer terminal on
            // one device and light on another). Without this guard, a
            // hydration that lands within ~300ms of a theme pick can overwrite
            // the just-saved local theme with stale server data and the
            // preference appears to revert on refresh.
            const localSettings = loadSettings() || {}
            const merged = { ...data.settings }
            if (localSettings.theme) merged.theme = localSettings.theme
            // streak_anchor is backward-only: if the local copy is EARLIER
            // than the server's (e.g. the server blob was clobbered by a
            // whole-blob settings flush from another device), keep the
            // earlier one — it represents real provenance.
            if (localSettings.streak_anchor &&
                (!merged.streak_anchor || localSettings.streak_anchor < merged.streak_anchor)) {
              merged.streak_anchor = localSettings.streak_anchor
            }
            saveSettings(merged)
          }
          if (data.labels) saveLabels(data.labels)
          prevTasks.current = data.tasks || []
          prevRoutines.current = data.routines || []
        } else {
          remoteLog(`${reason}: server empty, pushing local settings/labels`)
          pushBulkState()
        }
      })
      .catch(err => {
        remoteLog(`${reason}: fetch failed: ${err.message}`)
      })
    })
  }, [onHydrate, pushBulkState, pushChanges, noteVersion])

  // Public entry point — serializes runHydrate (see inFlight above). A hydrate
  // requested while one is running does NOT start a second fetch; it reserves
  // the single follow-up slot, so N overlapping triggers cost at most two
  // round-trips and can never apply out of order.
  const fetchAndHydrate = useCallback((reason) => {
    function start(r) {
      const run = runHydrate(r).finally(() => {
        inFlight.current = null
        const next = queuedHydrate.current
        if (next) {
          queuedHydrate.current = null
          start(next)
        }
      })
      inFlight.current = run
      return run
    }
    if (inFlight.current) {
      remoteLog(`${reason}: hydrate already in flight — coalescing`)
      queuedHydrate.current = reason
      return inFlight.current
    }
    return start(reason)
  }, [runHydrate])

  // Keep the late-bound ref current (see declaration above).
  useEffect(() => { hydrateRef.current = fetchAndHydrate }, [fetchAndHydrate])

  // SSE connection
  useEffect(() => {
    remoteLog(`SSE: connecting (clientId=${clientId.slice(0, 8)})`)
    let es = null
    let reconnectTimer = null

    function connect() {
      es = new EventSource('/api/events')

      es.onmessage = (event) => {
        if (event.data.startsWith(':')) return
        let msg
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.type === 'connected') {
          // Authoritative: a reconnect is a resync point, and the server may
          // legitimately be BEHIND us after a restore or a fresh database.
          noteVersion(msg.version, { authoritative: true })
          remoteLog(`SSE: connected, server v${msg.version}, appVersion=${msg.appVersion}`)

          const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
          if (VERSION_CHECKS_ENABLED && msg.appVersion && clientVersion !== 'dev' && msg.appVersion !== clientVersion) {
            remoteLog(`SSE: VERSION MISMATCH — client=${clientVersion} server=${msg.appVersion}`)
            flushLogs()
            fireVersionMismatch(msg.appVersion)
            return
          }

          fetchAndHydrate('initial').then(() => {
            return replayQueue()
          }).catch(err => {
            remoteLog(`replay: aborted unexpectedly: ${err.message}`)
          }).finally(() => {
            hydrated.current = true
            remoteLog('SSE: hydrated, ready for sync')
            flushLogs()
          })
        } else if (msg.type === 'update') {
          if (msg.sourceClientId === clientId) {
            noteVersion(msg.version)
            remoteLog(`SSE: own write confirmed v${msg.version}`)
            return
          }
          remoteLog(`SSE: update from another client v${msg.version}`)
          noteVersion(msg.version)
          fetchAndHydrate('sse-update')
        }
      }

      es.onerror = () => {
        remoteLog('SSE: connection error, will auto-reconnect')
        if (es.readyState === EventSource.CLOSED) {
          remoteLog('SSE: closed, manual reconnect in 3s')
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      if (es) es.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [clientId, fetchAndHydrate, fireVersionMismatch, replayQueue, noteVersion])

  // Re-sync when app becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hydrated.current) {
        remoteLog('visibility: app became visible, checking for updates')
        fetchAndHydrate('visibility')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [fetchAndHydrate])

  // Detect online/offline and replay queue on reconnect
  useEffect(() => {
    const handleOnline = () => {
      remoteLog('network: back online, replaying queue')
      setSyncStatus(null)
      replayQueue().catch(err => remoteLog(`replay: aborted unexpectedly: ${err.message}`))
    }
    const handleOffline = () => {
      remoteLog('network: went offline')
      setSyncStatus('offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    // Set initial offline status if already offline
    if (!navigator.onLine) setSyncStatus('offline')
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [replayQueue])

  // Debounced per-record push whenever tasks or routines change
  useEffect(() => {
    if (!hydrated.current) return

    // The post-hydrate window suppresses the hydrate's own state-write from
    // echoing back as a push. A genuine user edit can land in that window too,
    // so DON'T drop it (the old `return` lost the change) — schedule the push
    // for just after the window. The per-record diff makes the echo a no-op
    // anyway, and a scheduled timer means fetchAndHydrate will flush it first.
    const skipFor = skipPushUntil.current - Date.now()
    const delay = skipFor > 0 ? skipFor + DEBOUNCE_MS : DEBOUNCE_MS

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      // Clear BEFORE pushing: a spent timer id left in place makes the next
      // hydrate's `if (debounceTimer.current)` believe a push is still pending,
      // so it runs a redundant flush — which is why every sse-update in the
      // 2026-09-22 logs read "flushing pending local changes before hydrate".
      debounceTimer.current = null
      pushChanges(latestState.current.tasks, latestState.current.routines)
    }, delay)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines, pushChanges])

  // Flush pending sync on page unload — uses bulk endpoint (sendBeacon limitation)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      const payload = buildPayload()
      if (payload) {
        payload._clientId = clientId
        payload._appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    // The native shell's bundle version is stamped by the Mac build and can
    // NEVER equal the server's Docker APP_VERSION — the server's stale-client
    // guard must not treat that mismatch as staleness (same class as the
    // version-mismatch reload loop, sync edition).
    payload._platform = isNativeShell() ? 'native' : 'web'
        navigator.sendBeacon(
          '/api/data',
          new Blob([JSON.stringify(payload)], { type: 'application/json' })
        )
        remoteLog('beforeunload: sendBeacon')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [clientId])

  // Manual flush for settings/labels changes (still bulk since those live in app_data)
  const flush = useCallback(() => {
    remoteLog('flush: manual (settings/labels changed)')
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
      // A per-record push was pending — run it now instead of dropping it.
      // Cancelling without pushing lost any task/routine change made in the
      // last DEBOUNCE_MS whenever a settings write followed it (prod shape:
      // first-ever task add → streak-anchor effect saves settings → flush
      // raced the 300ms task debounce and the task never synced).
      if (hydrated.current) {
        pushChanges(latestState.current.tasks, latestState.current.routines)
      }
    }
    pushBulkState()
  }, [pushBulkState, pushChanges])

  // Check app version against server on demand
  const checkVersion = useCallback(() => {
    if (!VERSION_CHECKS_ENABLED || versionMismatchFired.current) return
    fetch('/api/health')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.appVersion) return
        const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
        if (clientVersion !== 'dev' && data.appVersion !== clientVersion) {
          remoteLog(`version check: mismatch client=${clientVersion} server=${data.appVersion}`)
          fireVersionMismatch(data.appVersion)
        }
      })
      .catch(() => {})
  }, [fireVersionMismatch])

  return { flush, checkVersion, syncStatus, queueLength, clearQueue, refetch: () => fetchAndHydrate('pull-refresh') }
}

// Bulk PUT carries settings + labels only. Tasks and routines have their own
// per-record /api/tasks and /api/routines APIs; including them here was the
// wipe vector that destroyed 153 tasks on 2026-05-07 (a client whose initial
// GET failed sent tasks: [] via manual flush). Server has a 409 guard now,
// but the cleanest fix is to never give the server a chance to misinterpret
// an empty client state as a delete-all command.
function buildPayload() {
  let settings = null
  let labels = null
  try { settings = JSON.parse(localStorage.getItem('boom_settings_v1')) } catch { /* */ }
  try { labels = JSON.parse(localStorage.getItem('boom_labels_v1')) } catch { /* */ }

  const data = {}
  if (settings) data.settings = settings
  if (labels) data.labels = labels

  if (Object.keys(data).length === 0) return null
  return data
}
