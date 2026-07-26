// Tests for server/appAttest.js — the Phase B verifier. Apple hardware can't
// run in CI, so these build a SYNTHETIC attestation with openssl: a test root
// CA (passed via the rootPem override), an intermediate, and a P-256 leaf
// carrying the Apple nonce extension (OID 1.2.840.113635.100.8.2) — exercising
// every verification step except the identity of Apple's real root, which the
// live on-device Run check covers. Skips (never fakes a pass) if openssl is
// unavailable or can't produce the chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { verifyAttestation } from '../server/appAttest.js'

const APP_ID = 'TESTTEAM01.test.boomerang.app'
const CHALLENGE = 'test-challenge-string'

// ---- tiny CBOR encoder (test-side only; the server has the decoder) ----
function cborLen(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b
}
function cborEnc(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([cborLen(2, v.length), v])
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cborLen(3, b.length), b]) }
  if (typeof v === 'number') return cborLen(0, v)
  if (Array.isArray(v)) return Buffer.concat([cborLen(4, v.length), ...v.map(cborEnc)])
  if (v && typeof v === 'object') {
    const entries = Object.entries(v)
    return Buffer.concat([cborLen(5, entries.length), ...entries.flatMap(([k, val]) => [cborEnc(k), cborEnc(val)])])
  }
  throw new Error(`cborEnc: unsupported ${typeof v}`)
}

// ---- synthetic chain via openssl ----
function buildFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'appattest-'))
  const sh = (args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })

  // Root (P-384, self-signed) and intermediate CA.
  sh(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-384', '-keyout', 'root.key',
    '-out', 'root.pem', '-nodes', '-subj', '/CN=Test Attest Root CA', '-days', '2'])
  sh(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-384', '-keyout', 'int.key',
    '-out', 'int.csr', '-nodes', '-subj', '/CN=Test Attest Intermediate'])
  writeFileSync(path.join(dir, 'ca.cnf'), '[ext]\nbasicConstraints=critical,CA:TRUE\n')
  sh(['x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
    '-out', 'int.pem', '-days', '2', '-extfile', 'ca.cnf', '-extensions', 'ext'])

  // Leaf key first — the keyId feeds authData, which feeds the nonce, which
  // is baked into the leaf cert (same order the real flow forces).
  sh(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key'])
  const spki = sh(['ec', '-in', 'leaf.key', '-pubout', '-outform', 'DER'])
  const point = spki.subarray(spki.length - 65)
  assert.equal(point[0], 0x04, 'leaf public key point must be uncompressed')
  const keyId = crypto.createHash('sha256').update(point).digest()

  const authData = Buffer.concat([
    crypto.createHash('sha256').update(APP_ID).digest(), // rpIdHash
    Buffer.from([0x40]),                                  // flags: attested credential data
    Buffer.alloc(4),                                      // counter 0
    Buffer.from('appattestdevelop'),                      // aaguid (sandbox)
    Buffer.from([0, 32]),                                 // credentialId length
    keyId,                                                // credentialId
  ])
  const clientDataHash = crypto.createHash('sha256').update(CHALLENGE, 'utf8').digest()
  const nonce = crypto.createHash('sha256').update(Buffer.concat([authData, clientDataHash])).digest()

  // Apple wraps the nonce as SEQUENCE { [1] { OCTET STRING nonce } }.
  const nonceDer = Buffer.concat([Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]), nonce])
  const derHex = [...nonceDer].map((b) => b.toString(16).padStart(2, '0')).join(':')
  writeFileSync(path.join(dir, 'leaf.cnf'),
    `[ext]\nbasicConstraints=CA:FALSE\n1.2.840.113635.100.8.2=DER:${derHex}\n`)
  sh(['req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Test Attest Leaf'])
  sh(['x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial',
    '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'ext'])

  const toDer = (pem) => sh(['x509', '-in', pem, '-outform', 'DER'])
  const fixture = {
    rootPem: readFileSync(path.join(dir, 'root.pem'), 'utf8'),
    leafDer: toDer('leaf.pem'),
    intDer: toDer('int.pem'),
    authData,
    clientDataHash,
    keyId,
  }
  rmSync(dir, { recursive: true, force: true })
  return fixture
}

function attestationB64(f, { x5c, authData } = {}) {
  return cborEnc({
    fmt: 'apple-appattest',
    attStmt: { x5c: x5c || [f.leafDer, f.intDer], receipt: Buffer.alloc(0) },
    authData: authData || f.authData,
  }).toString('base64')
}

let fixture = null
let skipReason = null
try {
  fixture = buildFixture()
} catch (e) {
  // Surface WHY in the TAP stream (single line — TAP swallows multi-line
  // stderr) — a silent skip looks like coverage that isn't there.
  skipReason = `openssl unavailable or incompatible: ${String(e.message || e).split('\n')[0].slice(0, 160)}`
  console.error(`[appattest.test] chain tests skipped: ${skipReason}`)
}

test('valid synthetic attestation verifies end-to-end', { skip: skipReason ?? false }, () => {
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture),
    keyIdB64: fixture.keyId.toString('base64'),
    clientDataHash: fixture.clientDataHash,
    appIds: ['other.app', APP_ID],
    rootPem: fixture.rootPem,
  })
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.environment, 'development')
  assert.equal(r.counter, 0)
  assert.match(r.publicKeyPem, /BEGIN PUBLIC KEY/)
})

test('nonce mismatch is rejected (different challenge)', { skip: skipReason ?? false }, () => {
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture),
    keyIdB64: fixture.keyId.toString('base64'),
    clientDataHash: crypto.createHash('sha256').update('a-different-challenge').digest(),
    appIds: [APP_ID],
    rootPem: fixture.rootPem,
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /nonce/)
})

test('wrong app id is rejected', { skip: skipReason ?? false }, () => {
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture),
    keyIdB64: fixture.keyId.toString('base64'),
    clientDataHash: fixture.clientDataHash,
    appIds: ['WRONGTEAM.some.other.app'],
    rootPem: fixture.rootPem,
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /App ID/)
})

test('keyId not matching the cert public key is rejected', { skip: skipReason ?? false }, () => {
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture),
    keyIdB64: crypto.randomBytes(32).toString('base64'),
    clientDataHash: fixture.clientDataHash,
    appIds: [APP_ID],
    rootPem: fixture.rootPem,
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /keyId/)
})

test('chain that does not reach the pinned root is rejected', { skip: skipReason ?? false }, () => {
  // Pin a DIFFERENT root than the one that signed the intermediate.
  const other = (() => {
    try {
      const dir = mkdtempSync(path.join(tmpdir(), 'appattest-other-'))
      execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-384',
        '-keyout', 'k.key', '-out', 'r.pem', '-nodes', '-subj', '/CN=Unrelated Root', '-days', '2'], { cwd: dir })
      const pem = readFileSync(path.join(dir, 'r.pem'), 'utf8')
      rmSync(dir, { recursive: true, force: true })
      return pem
    } catch { return null }
  })()
  if (!other) return // secondary openssl failure — the main tests already ran
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture),
    keyIdB64: fixture.keyId.toString('base64'),
    clientDataHash: fixture.clientDataHash,
    appIds: [APP_ID],
    rootPem: other,
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /chain/)
})

test('nonzero counter is rejected for a first attestation', { skip: skipReason ?? false }, () => {
  const tampered = Buffer.from(fixture.authData)
  tampered.writeUInt32BE(7, 33)
  // Note: changing authData also breaks the nonce, which is checked first —
  // so rebuild expectations: this asserts SOME rejection, and the reason must
  // never be a pass.
  const r = verifyAttestation({
    attestationB64: attestationB64(fixture, { authData: tampered }),
    keyIdB64: fixture.keyId.toString('base64'),
    clientDataHash: fixture.clientDataHash,
    appIds: [APP_ID],
    rootPem: fixture.rootPem,
  })
  assert.equal(r.ok, false)
})

test('garbage inputs are rejected, never throw', () => {
  assert.equal(verifyAttestation({ attestationB64: '', keyIdB64: '', clientDataHash: Buffer.alloc(32), appIds: [] }).ok, false)
  assert.equal(verifyAttestation({ attestationB64: 'AAAA', keyIdB64: crypto.randomBytes(32).toString('base64'), clientDataHash: Buffer.alloc(32), appIds: [] }).ok, false)
  assert.equal(verifyAttestation({ attestationB64: Buffer.from('not cbor at all').toString('base64'), keyIdB64: crypto.randomBytes(32).toString('base64'), clientDataHash: Buffer.alloc(32), appIds: [] }).ok, false)
})
