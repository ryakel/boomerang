// App Attest verification (auth Phase B — wiki/Auth-Device-Tokens.md).
// Verifies the attestation object produced by DCAppAttestService.attestKey on
// a real device (BoomerangKit/AppAttestClient.swift is the producer). Zero new
// dependencies: a minimal CBOR decoder (RFC 8949 subset), a small DER walker
// for the nonce extension, and node:crypto X509Certificate for the chain.
//
// Verification steps (Apple's documented order):
//   1. CBOR-decode { fmt: "apple-appattest", attStmt: { x5c, receipt }, authData }.
//   2. Verify the certificate chain: credCert → intermediate(s) → the PINNED
//      Apple App Attestation Root CA (server/appleAppAttestRootCA.pem,
//      fetched from apple.com/certificateauthority, valid to 2045).
//   3. nonce = SHA256(authData ‖ clientDataHash) must equal the nonce baked
//      into credCert's 1.2.840.113635.100.8.2 extension.
//   4. SHA256(credCert's uncompressed P-256 public key point) == keyId.
//   5. authData: rpIdHash == SHA256(appId), counter == 0 (first attestation),
//      aaguid ∈ {appattest (production), appattestdevelop (sandbox)},
//      credentialId == keyId.
//
// Anything that fails returns { ok: false, reason } — the caller decides how
// loud to be. Never returns ok on a partial check.

import crypto from 'crypto'
import { X509Certificate } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const APPLE_ROOT_PEM = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'appleAppAttestRootCA.pem'),
  'utf8',
)

// ---- CBOR (decode-only subset: uint, bstr, tstr, array, map, tag, simple) ----

function cborDecode(buf) {
  const [value, off] = cborItem(buf, 0)
  if (off !== buf.length) throw new Error(`trailing bytes after CBOR item (${buf.length - off})`)
  return value
}

function cborItem(buf, off) {
  if (off >= buf.length) throw new Error('truncated CBOR')
  const initial = buf[off]
  const major = initial >> 5
  const addl = initial & 0x1f
  let len
  let p = off + 1
  if (addl < 24) { len = addl }
  else if (addl === 24) { len = buf[p]; p += 1 }
  else if (addl === 25) { len = buf.readUInt16BE(p); p += 2 }
  else if (addl === 26) { len = buf.readUInt32BE(p); p += 4 }
  else if (addl === 27) { len = Number(buf.readBigUInt64BE(p)); p += 8 }
  else { throw new Error(`unsupported CBOR additional info ${addl}`) }

  switch (major) {
    case 0: return [len, p] // unsigned int
    case 1: return [-1 - len, p] // negative int
    case 2: { // byte string
      if (p + len > buf.length) throw new Error('truncated CBOR byte string')
      return [buf.subarray(p, p + len), p + len]
    }
    case 3: { // text string
      if (p + len > buf.length) throw new Error('truncated CBOR text string')
      return [buf.subarray(p, p + len).toString('utf8'), p + len]
    }
    case 4: { // array
      const arr = []
      for (let i = 0; i < len; i++) { const [v, np] = cborItem(buf, p); arr.push(v); p = np }
      return [arr, p]
    }
    case 5: { // map
      const obj = {}
      for (let i = 0; i < len; i++) {
        const [k, kp] = cborItem(buf, p)
        const [v, vp] = cborItem(buf, kp)
        obj[typeof k === 'string' ? k : String(k)] = v
        p = vp
      }
      return [obj, p]
    }
    case 6: return cborItem(buf, p) // tag — decode the tagged item
    case 7: { // simple values only (no floats in attestation objects)
      if (addl === 20) return [false, p]
      if (addl === 21) return [true, p]
      if (addl === 22) return [null, p]
      throw new Error(`unsupported CBOR simple/float ${addl}`)
    }
    default: throw new Error(`unsupported CBOR major type ${major}`)
  }
}

// ---- WebAuthn-style authenticator data ----

function parseAuthData(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) throw new Error('authData too short')
  const rpIdHash = buf.subarray(0, 32)
  const flags = buf[32]
  const counter = buf.readUInt32BE(33)
  let aaguid = null
  let credentialId = null
  if (flags & 0x40) { // attested credential data present
    if (buf.length < 55) throw new Error('authData attested-credential section truncated')
    aaguid = buf.subarray(37, 53)
    const credIdLen = buf.readUInt16BE(53)
    if (buf.length < 55 + credIdLen) throw new Error('authData credentialId truncated')
    credentialId = buf.subarray(55, 55 + credIdLen)
  }
  return { rpIdHash, flags, counter, aaguid, credentialId }
}

// ---- DER helpers (just enough to pull the nonce out of the credCert) ----

function derRead(buf, off) {
  if (off + 2 > buf.length) throw new Error('truncated DER')
  const tag = buf[off]
  let len = buf[off + 1]
  let p = off + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n < 1 || n > 4 || p + n > buf.length) throw new Error('bad DER length')
    len = 0
    for (let i = 0; i < n; i++) { len = len * 256 + buf[p + i] }
    p += n
  }
  if (p + len > buf.length) throw new Error('truncated DER value')
  return { tag, len, valOff: p, end: p + len }
}

// Depth-first search for the first OCTET STRING of the wanted length inside a
// DER blob. Used on the extension value, whose exact tagging Apple wraps as
// SEQUENCE { [1] { OCTET STRING nonce } } — descending constructed nodes and
// matching on shape is robust to that nesting.
function findOctetString(buf, off, end, wantLen) {
  let p = off
  while (p < end) {
    const tlv = derRead(buf, p)
    if (tlv.tag === 0x04 && tlv.len === wantLen) return buf.subarray(tlv.valOff, tlv.end)
    if (tlv.tag & 0x20) { // constructed — descend
      const inner = findOctetString(buf, tlv.valOff, tlv.end, wantLen)
      if (inner) return inner
    } else if (tlv.tag === 0x04) { // primitive octet string wrapping DER (extnValue)
      try {
        const inner = findOctetString(buf, tlv.valOff, tlv.end, wantLen)
        if (inner) return inner
      } catch { /* not nested DER — keep scanning */ }
    }
    p = tlv.end
  }
  return null
}

// Extract the 32-byte nonce from credCert's Apple-specific extension
// (OID 1.2.840.113635.100.8.2). The cert's signature is verified against the
// pinned Apple chain BEFORE this runs, so locating the OID by byte pattern is
// safe — an attacker cannot place bytes inside a genuinely Apple-signed cert.
const APPLE_NONCE_OID = Buffer.from('06092a864886f763640802', 'hex')

function extractNonce(certRaw) {
  const idx = certRaw.indexOf(APPLE_NONCE_OID)
  if (idx < 0) return null
  // After the OID: optional BOOLEAN (critical), then the OCTET STRING extnValue.
  let p = idx + APPLE_NONCE_OID.length
  let tlv = derRead(certRaw, p)
  if (tlv.tag === 0x01) tlv = derRead(certRaw, tlv.end) // skip critical flag
  if (tlv.tag !== 0x04) return null
  return findOctetString(certRaw, tlv.valOff, tlv.end, 32)
}

// ---- The verifier ----

const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)])
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop')

/**
 * @param {object} opts
 * @param {string} opts.attestationB64  base64 CBOR attestation object from attestKey
 * @param {string} opts.keyIdB64       base64 key id from generateKey
 * @param {Buffer} opts.clientDataHash SHA256 of the challenge bytes (must match the native side)
 * @param {string[]} opts.appIds       allowed App IDs (teamId.bundleId)
 * @param {string} [opts.rootPem]      override root CA (tests only — defaults to the pinned Apple root)
 * @returns {{ok:true, publicKeyPem:string, counter:number, environment:string}|{ok:false, reason:string}}
 */
export function verifyAttestation({ attestationB64, keyIdB64, clientDataHash, appIds, rootPem }) {
  try {
    const attBuf = Buffer.from(String(attestationB64 || ''), 'base64')
    if (!attBuf.length) return { ok: false, reason: 'empty attestation' }
    const keyId = Buffer.from(String(keyIdB64 || ''), 'base64')
    if (keyId.length !== 32) return { ok: false, reason: 'keyId must be 32 bytes' }

    let att
    try { att = cborDecode(attBuf) } catch (e) { return { ok: false, reason: `CBOR: ${e.message}` } }
    if (att?.fmt !== 'apple-appattest') return { ok: false, reason: `unexpected fmt "${att?.fmt}"` }
    const x5c = att?.attStmt?.x5c
    const authDataBuf = att?.authData
    if (!Array.isArray(x5c) || x5c.length < 2) return { ok: false, reason: 'x5c chain missing or too short' }
    if (!Buffer.isBuffer(authDataBuf)) return { ok: false, reason: 'authData missing' }

    // 2. Chain to the pinned root. Apple sends [credCert, intermediateCA].
    const root = new X509Certificate(rootPem || APPLE_ROOT_PEM)
    let certs
    try { certs = x5c.map((der) => new X509Certificate(der)) } catch (e) {
      return { ok: false, reason: `bad certificate in x5c: ${e.message}` }
    }
    const now = Date.now()
    for (const cert of certs) {
      if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
        return { ok: false, reason: 'certificate outside validity window' }
      }
    }
    for (let i = 0; i < certs.length; i++) {
      const issuer = i + 1 < certs.length ? certs[i + 1] : root
      if (!certs[i].verify(issuer.publicKey)) {
        return { ok: false, reason: i + 1 < certs.length ? 'chain link signature invalid' : 'chain does not terminate at the pinned Apple root' }
      }
    }
    const credCert = certs[0]

    // 3. Nonce over authData + clientDataHash.
    if (!Buffer.isBuffer(clientDataHash) || clientDataHash.length !== 32) {
      return { ok: false, reason: 'clientDataHash must be a 32-byte buffer' }
    }
    const expectedNonce = crypto.createHash('sha256')
      .update(Buffer.concat([authDataBuf, clientDataHash])).digest()
    const certNonce = extractNonce(credCert.raw)
    if (!certNonce) return { ok: false, reason: 'nonce extension not found in credCert' }
    if (!certNonce.equals(expectedNonce)) return { ok: false, reason: 'nonce mismatch' }

    // 4. keyId == SHA256(uncompressed public key point).
    const keyObj = credCert.publicKey
    const details = keyObj.asymmetricKeyDetails || {}
    if (keyObj.asymmetricKeyType !== 'ec' || details.namedCurve !== 'prime256v1') {
      return { ok: false, reason: `credCert key is ${keyObj.asymmetricKeyType}/${details.namedCurve}, expected ec/prime256v1` }
    }
    const spki = keyObj.export({ type: 'spki', format: 'der' })
    const point = spki.subarray(spki.length - 65) // uncompressed P-256 point is the SPKI tail
    if (point[0] !== 0x04) return { ok: false, reason: 'public key point is not uncompressed' }
    const pointHash = crypto.createHash('sha256').update(point).digest()
    if (!pointHash.equals(keyId)) return { ok: false, reason: 'keyId does not match credCert public key' }

    // 5. authData fields.
    const auth = parseAuthData(authDataBuf)
    const appIdOk = (appIds || []).some((id) =>
      crypto.createHash('sha256').update(String(id)).digest().equals(auth.rpIdHash))
    if (!appIdOk) return { ok: false, reason: 'rpIdHash does not match any allowed App ID' }
    if (auth.counter !== 0) return { ok: false, reason: `counter is ${auth.counter}, expected 0 for a first attestation` }
    let environment
    if (auth.aaguid?.equals(AAGUID_PRODUCTION)) environment = 'production'
    else if (auth.aaguid?.equals(AAGUID_DEVELOPMENT)) environment = 'development'
    else return { ok: false, reason: 'unknown aaguid' }
    if (!auth.credentialId?.equals(keyId)) return { ok: false, reason: 'credentialId does not match keyId' }

    return {
      ok: true,
      publicKeyPem: keyObj.export({ type: 'spki', format: 'pem' }),
      counter: auth.counter,
      environment,
    }
  } catch (e) {
    return { ok: false, reason: `verification error: ${e.message}` }
  }
}
