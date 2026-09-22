// syncGuards.js — whether a write should be refused because the client making
// it is behind the data version. Pure: no db, no express, no clock. Tested in
// scripts/syncGuards.test.mjs.
//
// THE BUG THIS CLOSES (2026-09-22, "still a problem" — completions reverting)
//
// `guardStaleClient` in server.js has rejected behind-the-version pushes for a
// long time, and it was never removed. It is wired to PUT/POST /api/data — and
// task and routine sync LEFT that path for the per-record endpoints, so the
// guard sat on a road that now carries nothing but settings and labels while
// every task write in the app drove around it.
//
// What that cost: a client whose /api/data read lost a race with its own writes
// rewound its version, re-pushed changes it had already pushed, broadcast, and
// set the other client doing the same. ~50 version bumps in 19 seconds, and a
// completed task reverted four times in front of the user.
//
// The rule is one line of arithmetic. It lives in its own module because the
// interesting part is not the comparison, it is WHO IS EXEMPT — see below.

/**
 * Should this write be refused as stale?
 *
 * `claimed` is the data version the caller declares it is working from; `server`
 * is the authoritative current version. The server's counter only ever goes up,
 * so a caller claiming a lower number is working from a snapshot that has since
 * been superseded and must not write over it.
 *
 * ABSTAINING IS THE IMPORTANT CASE. A caller that declares nothing is allowed
 * through, because plenty of legitimate writers have no notion of a data
 * version at all: Quokka's staged tool executions, the iOS Share Extension,
 * App Intents, and the watch proxy. Requiring a claim would break every one of
 * them to fix a bug none of them can have — only the diffing web sync client
 * maintains a version, and only it can get out of step with one.
 *
 * The gap that opt-in leaves is a sync client that simply forgets to declare.
 * That is closed by a test pinning the client as declaring one, not by making
 * this stricter.
 */
export function isStaleWrite(claimed, server) {
  if (claimed == null || claimed === '') return false
  // Only a number or a numeric string is a claim. This is not pedantry:
  // `Number([])` is 0, which is finite and below every real version, so an
  // array — which Express hands you for `?_version[]=` — would have been read
  // as "version zero" and the write REFUSED. Caught by its own test.
  if (typeof claimed !== 'number' && typeof claimed !== 'string') return false
  const c = Number(claimed)
  const s = Number(server)
  // A non-numeric claim is a malformed one, not a stale one. Refusing it would
  // turn a client bug into data loss; ignoring it leaves the write unguarded,
  // which is exactly where every other unversioned caller already sits.
  if (!Number.isFinite(c) || !Number.isFinite(s)) return false
  return c < s
}

/**
 * The version a request declares, from the body (POST/PATCH) or the query
 * string (DELETE, which carries no body). Returns null when it declares none.
 */
export function claimedVersion(req) {
  const raw = req?.body?._version ?? req?.query?._version
  return raw == null || raw === '' ? null : raw
}
