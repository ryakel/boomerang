import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isStaleWrite, claimedVersion } from '../server/syncGuards.js'

// The guard that already existed rejected behind-the-version pushes on
// PUT/POST /api/data — and task sync had long since moved to the per-record
// endpoints, which never called it. A client whose read lost a race with its
// own writes could therefore re-push freely: ~50 version bumps in 19 seconds,
// and a completed task reverted four times in front of the user (2026-09-22).

test('a write from behind the server version is refused', () => {
  assert.equal(isStaleWrite(67651, 67655), true)
  assert.equal(isStaleWrite(0, 1), true)
})

test('a write at or ahead of the server version is allowed', () => {
  // Equal is the overwhelmingly common case — the client read v, then writes.
  assert.equal(isStaleWrite(67655, 67655), false)
  // Ahead shouldn't happen, but refusing it would strand a client after a
  // restore reset the counter; the client's own reconnect handles that.
  assert.equal(isStaleWrite(67656, 67655), false)
})

test('ABSTAIN: a caller that declares no version is never refused', () => {
  // Quokka's staged executions, the Share Extension, App Intents and the watch
  // proxy all create tasks with no notion of a data version. Requiring a claim
  // would break every one of them to fix a bug none of them can have.
  for (const nothing of [null, undefined, '']) {
    assert.equal(isStaleWrite(nothing, 67655), false, String(nothing))
  }
})

test('a malformed claim is ignored, not refused', () => {
  // Turning a client bug into a refused write would be data loss; ignoring it
  // leaves the write exactly where every unversioned caller already sits.
  for (const junk of ['abc', NaN, {}, []]) {
    assert.equal(isStaleWrite(junk, 67655), false, String(junk))
  }
  assert.equal(isStaleWrite(67651, 'nonsense'), false)
})

test('a numeric string claim still counts — the DELETE query string is a string', () => {
  assert.equal(isStaleWrite('67651', 67655), true)
  assert.equal(isStaleWrite('67655', 67655), false)
})

test('the claim is read from the body for POST/PATCH and the query for DELETE', () => {
  assert.equal(claimedVersion({ body: { _version: 42 } }), 42)
  assert.equal(claimedVersion({ query: { _version: '42' } }), '42')
  // DELETE has no body at all — that is why this guard is separate from
  // guardStaleClient, which requires a _clientId in one.
  assert.equal(claimedVersion({ query: { _version: '7' }, body: undefined }), '7')
  assert.equal(claimedVersion({ body: {} }), null)
  assert.equal(claimedVersion({}), null)
  assert.equal(claimedVersion(undefined), null)
})

// --- The regression pin -------------------------------------------------
//
// isStaleWrite is opt-in, so the guard is only worth anything if the sync
// client actually declares a version. That is the exact failure this whole
// ticket is about: a guard in perfect working order, protecting a path the
// traffic had already left. Asserting the client still declares one is what
// stops that happening a third time.

const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')

test('PIN: every per-record write declares a version', () => {
  const bodyWrites = [
    'serverCreateTask', 'serverUpdateTask',
    'serverCreateRoutine', 'serverUpdateRoutine',
  ]
  for (const fn of bodyWrites) {
    const start = api.indexOf(`export async function ${fn}(`)
    assert.notEqual(start, -1, `${fn} not found`)
    const body = api.slice(start, api.indexOf('\n}', start))
    assert.match(body, /versionClaim\(\)/, `${fn} must declare its data version`)
  }
  for (const fn of ['serverDeleteTask', 'serverDeleteRoutine']) {
    const start = api.indexOf(`export async function ${fn}(`)
    assert.notEqual(start, -1, `${fn} not found`)
    const body = api.slice(start, api.indexOf('\n}', start))
    // No body on a DELETE, so the claim rides the query string.
    assert.match(body, /versionQuery\(\)/, `${fn} must declare its data version`)
  }
})

test('PIN: the sync hook routes version writes through one choke point', () => {
  const hook = fs.readFileSync(new URL('../src/hooks/useServerSync.js', import.meta.url), 'utf8')
  // Nine bare assignments and zero comparisons is what let a stale read rewind
  // the client. Exactly one assignment may remain: the one inside noteVersion.
  const bare = hook.match(/serverVersion\.current\s*=/g) || []
  assert.equal(bare.length, 1, 'version must only be assigned inside noteVersion()')
  assert.match(hook, /setDataVersion\(n\)/, 'noteVersion must publish the version to api.js')
})
