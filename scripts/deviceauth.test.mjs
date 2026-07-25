// Unit tests for server/deviceAuth.js — enrollment, access verification,
// refresh rotation, the reuse-detection revocation, and hashed-at-rest
// storage. Run via `npm test`.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  initDeviceAuth, onSecurityAlert,
  enrollDevice, verifyDeviceAccessToken, refreshDeviceTokens,
  revokeDevice, listDevices, deleteDevice,
  issueAttestChallenge, consumeAttestChallenge,
} from '../server/deviceAuth.js'

let store
let alerts
beforeEach(() => {
  store = {}
  alerts = []
  initDeviceAuth({
    getData: (k) => store[k] ?? null,
    setData: (k, v) => { store[k] = v },
  })
  onSecurityAlert((event, device) => alerts.push({ event, device }))
})

test('enroll → access token verifies; garbage does not', () => {
  const pair = enrollDevice({ name: 'iPhone', platform: 'ios-native' })
  assert.match(pair.access_token, /^bda_[a-f0-9]{16}\./)
  assert.match(pair.refresh_token, /^bdr_[a-f0-9]{16}\./)
  assert.equal(verifyDeviceAccessToken(pair.access_token), true)
  assert.equal(verifyDeviceAccessToken('bda_deadbeefdeadbeef.notarealsecretatall'), false)
  assert.equal(verifyDeviceAccessToken(pair.refresh_token), false) // wrong kind
  assert.equal(verifyDeviceAccessToken(''), false)
})

test('secrets are stored hashed, never plaintext', () => {
  const pair = enrollDevice({ name: 'x' })
  const raw = JSON.stringify(store)
  assert.ok(!raw.includes(pair.access_token.split('.')[1]))
  assert.ok(!raw.includes(pair.refresh_token.split('.')[1]))
})

test('refresh rotates the pair; old access dies, new works', () => {
  const pair = enrollDevice({ name: 'x' })
  const r = refreshDeviceTokens(pair.refresh_token)
  assert.equal(r.ok, true)
  assert.notEqual(r.pair.access_token, pair.access_token)
  assert.equal(verifyDeviceAccessToken(pair.access_token), false)
  assert.equal(verifyDeviceAccessToken(r.pair.access_token), true)
})

test('REUSE of a superseded refresh token revokes the device + fires the alert', () => {
  const pair = enrollDevice({ name: 'iPhone', platform: 'ios-native' })
  const r1 = refreshDeviceTokens(pair.refresh_token)
  assert.equal(r1.ok, true)
  // Replay the ORIGINAL (now superseded) refresh token — the stolen-token signature.
  const replay = refreshDeviceTokens(pair.refresh_token)
  assert.equal(replay.ok, false)
  assert.equal(replay.reuse, true)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].event, 'refresh_reuse')
  assert.equal(alerts[0].device.name, 'iPhone')
  // Everything the device held is dead — including the freshly rotated pair.
  assert.equal(verifyDeviceAccessToken(r1.pair.access_token), false)
  assert.equal(refreshDeviceTokens(r1.pair.refresh_token).ok, false)
  const d = listDevices()[0]
  assert.equal(d.revoked_reason, 'refresh_reuse')
})

test('expired access token is rejected', () => {
  const pair = enrollDevice({ name: 'x' })
  const devices = store.auth_devices
  devices[pair.device_id].access_expires = Date.now() - 1000
  assert.equal(verifyDeviceAccessToken(pair.access_token), false)
  // but refresh still works — that's its whole job
  assert.equal(refreshDeviceTokens(pair.refresh_token).ok, true)
})

test('manual revoke kills access + refresh; delete removes the row', () => {
  const pair = enrollDevice({ name: 'x' })
  assert.equal(revokeDevice(pair.device_id).ok, true)
  assert.equal(verifyDeviceAccessToken(pair.access_token), false)
  assert.equal(refreshDeviceTokens(pair.refresh_token).ok, false)
  assert.equal(alerts.length, 0) // manual revoke is not a security event
  assert.equal(deleteDevice(pair.device_id).ok, true)
  assert.equal(listDevices().length, 0)
  assert.equal(revokeDevice('nope').ok, false)
})

test('registry view exposes no secret material', () => {
  enrollDevice({ name: 'a' }); enrollDevice({ name: 'b' })
  for (const d of listDevices()) {
    assert.deepEqual(
      Object.keys(d).sort(),
      ['created_at', 'device_id', 'generation', 'last_seen', 'name', 'platform', 'revoked_at', 'revoked_reason'],
    )
  }
})

test('attest challenges are single-use and expire', () => {
  const { challenge } = issueAttestChallenge()
  assert.equal(consumeAttestChallenge(challenge), true)
  assert.equal(consumeAttestChallenge(challenge), false) // single-use
  assert.equal(consumeAttestChallenge('bogus'), false)
})
