import test from 'node:test'
import assert from 'node:assert/strict'
import { createAlarmProbeClient } from '../src/alarmProbeClient.js'

const empty = { available: true, authorization: 'authorized', alarm: null }
const scheduled = { ...empty, alarm: { id: 'boomerang-alarm-probe', state: 'scheduled' } }
function fixture(overrides = {}) {
  const calls = []
  const plugin = Object.fromEntries(['getStatus', 'requestPermission', 'scheduleTest', 'cancelTest'].map(name => [
    name, async () => { calls.push(name); return (overrides[name] || (() => name === 'scheduleTest' ? scheduled : empty))() },
  ]))
  return { calls, client: createAlarmProbeClient({ native: true, plugin }) }
}

test('web use makes no native call', async () => {
  const client = createAlarmProbeClient({ native: false, plugin: new Proxy({}, { get() { throw new Error('native call') } }) })
  for (const action of ['status', 'requestPermission', 'schedule', 'cancel']) {
    assert.equal((await client[action]()).ok, false)
  }
})
test('inspection and permission cannot implicitly schedule', async () => {
  const { calls, client } = fixture({ requestPermission: () => ({ ...empty, authorization: 'denied' }) })
  assert.equal((await client.status()).ok, true)
  assert.equal((await client.requestPermission()).authorization, 'denied')
  assert.deepEqual(calls, ['getStatus', 'requestPermission'])
})
test('old native installs explain that a web update is insufficient', async () => {
  const { client } = fixture({ getStatus: () => { throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }) } })
  const result = await client.status()
  assert.equal(result.ok, false)
  assert.match(result.error, /native alarm test build/)
})
test('disabled production build and unsupported OS stay unavailable', async () => {
  const { client } = fixture({ getStatus: () => ({ available: false, error: 'Install Boomerang Dev' }) })
  assert.deepEqual(await client.status(), { available: false, ok: false, error: 'Install Boomerang Dev' })
})
test('accepted schedule requires a readback alarm', async () => {
  const { client } = fixture({ scheduleTest: () => empty })
  const result = await client.schedule()
  assert.equal(result.ok, false)
  assert.equal(result.uncertain, true)
  assert.match(result.error, /not found/)
})
test('cancellation cannot claim success while a test remains', async () => {
  const { client } = fixture({ cancelTest: () => scheduled })
  const result = await client.cancel()
  assert.equal(result.ok, false)
  assert.match(result.error, /still reports/)
})
test('lost schedule reply is uncertain, never automatically retried; cleanup needs no cached ID', async () => {
  const { client, calls } = fixture({ scheduleTest: () => { throw new Error('lost reply') } })
  const result = await client.schedule()
  assert.equal(result.uncertain, true)
  assert.equal((await client.cancel()).ok, true)
  assert.deepEqual(calls, ['scheduleTest', 'cancelTest'])
})
test('concurrent schedule and cancel are refused until first operation finishes', async () => {
  let release
  const { client, calls } = fixture({ scheduleTest: () => new Promise(resolve => { release = resolve }) })
  const first = client.schedule()
  assert.equal((await client.schedule()).ok, false)
  assert.equal((await client.cancel()).ok, false)
  assert.deepEqual(calls, ['scheduleTest'])
  release(scheduled)
  assert.equal((await first).ok, true)
  assert.equal((await client.cancel()).ok, true)
})
test('a daemon read failure is not an empty schedule and releases the operation lock', async () => {
  let attempts = 0
  const { client } = fixture({ getStatus: () => { if (!attempts++) throw new Error('daemon unavailable'); return empty } })
  assert.equal((await client.status()).ok, false)
  assert.equal((await client.status()).ok, true)
})
test('unknown and foreign native data cannot become a scheduling claim', async () => {
  for (const invalid of [null, {}, { ...empty, authorization: 'yes' }, { ...empty, alarm: undefined },
    { ...scheduled, alarm: { id: 'another-alarm', state: 'scheduled' } },
    { ...scheduled, alarm: { id: 'boomerang-alarm-probe', state: 'completed' } }]) {
    const { client } = fixture({ getStatus: () => invalid })
    assert.equal((await client.status()).ok, false)
  }
})
test('scheduled, snoozed, stopped and absent status never manufacture completion', async () => {
  for (const state of ['scheduled', 'countdown', 'paused', 'alerting', 'unknown', null]) {
    const { client } = fixture({ getStatus: () => ({ ...empty, alarm: state ? { id: 'boomerang-alarm-probe', state } : null }) })
    const result = await client.status()
    assert.equal(result.ok, true)
    assert.equal(result.completed, undefined)
    assert.equal(result.heard, undefined)
  }
})
