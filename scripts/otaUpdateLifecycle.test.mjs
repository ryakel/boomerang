import test from 'node:test'
import assert from 'node:assert/strict'
import { startOtaUpdateLifecycle } from '../src/otaUpdateLifecycle.js'

function fixture({ id = 'builtin', bundledOnly = true, currentError = false, resetError = false } = {}) {
  const calls = []
  let resume
  const updater = {
    current: async () => {
      calls.push('current')
      if (currentError) throw new Error('daemon unavailable')
      return id === null ? {} : { bundle: { id, version: 'dev-347e0e2' } }
    },
    reset: async args => {
      calls.push(['reset', args])
      if (resetError) throw new Error('reset failed')
    },
    notifyAppReady: async () => { calls.push('ready') },
  }
  return {
    calls,
    run: () => startOtaUpdateLifecycle({
      bundledOnly,
      loadUpdater: async () => updater,
      loadApp: async () => {
        calls.push('load-app')
        return { addListener: async (event, handler) => { calls.push(event); resume = handler } }
      },
      checkOnce: async actual => { assert.equal(actual, updater); calls.push('server-check') },
    }),
    resume: () => resume?.(),
  }
}

test('probe builtin UI is ready without checking, downloading, or registering resume updates', async () => {
  const f = fixture()
  assert.equal(await f.run(), 'bundled-only')
  f.resume()
  assert.deepEqual(f.calls, ['current', 'ready'])
})
test('probe with a retained server bundle selects builtin without acknowledging or fetching old UI', async () => {
  const f = fixture({ id: 'retained-older-dev' })
  assert.equal(await f.run(), 'reloading-builtin')
  assert.deepEqual(f.calls, ['current', ['reset', { toLastSuccessful: false }]])
  f.resume()
  assert.equal(f.calls.length, 2)
})
test('probe reloaded on builtin does not reset again', async () => {
  const retained = fixture({ id: 'retained-older-dev' })
  await retained.run()
  const reloaded = fixture()
  await reloaded.run()
  assert.deepEqual(reloaded.calls, ['current', 'ready'])
})
test('failed bundle inspection never falls through to server updates or a blind reset', async () => {
  for (const options of [{ currentError: true }, { id: null }]) {
    const f = fixture(options)
    await assert.rejects(f.run())
    assert.deepEqual(f.calls, ['current'])
  }
})
test('failed reset is surfaced and does not mark an older bundle ready or enable updates', async () => {
  const f = fixture({ id: 'retained-older-dev', resetError: true })
  await assert.rejects(f.run(), /reset failed/)
  assert.deepEqual(f.calls, ['current', ['reset', { toLastSuccessful: false }]])
})
test('ordinary native builds preserve server update checks on launch and resume', async () => {
  const f = fixture({ bundledOnly: false })
  assert.equal(await f.run(), 'server-updates')
  f.resume()
  assert.deepEqual(f.calls, ['ready', 'server-check', 'load-app', 'resume', 'server-check'])
})
