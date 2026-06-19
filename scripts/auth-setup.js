#!/usr/bin/env node
// scripts/auth-setup.js — generate the env vars for Boomerang auth.
//
// Usage:
//   node scripts/auth-setup.js [password]
//
// Prints:
//   AUTH_PASSWORD_HASH  — scrypt hash of your password (server-only, never plaintext)
//   API_TOKEN           — a fresh random token for the iOS Shortcut / native app
//
// Set both in your host's environment. If no password is given, one is
// generated for you and printed once.

import crypto from 'crypto'

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const arg = process.argv[2]
const generatedPw = !arg
const password = arg || crypto.randomBytes(9).toString('base64url')
const apiToken = crypto.randomBytes(32).toString('hex')

console.log('# --- Boomerang auth env vars ---')
console.log('# Add these to your host environment (PaaS dashboard, .env, etc.)')
console.log('')
if (generatedPw) {
  console.log(`# Generated password (save it — this is the only time it is shown):`)
  console.log(`#   ${password}`)
  console.log('')
}
console.log(`AUTH_PASSWORD_HASH='${hashPassword(password)}'`)
console.log(`API_TOKEN='${apiToken}'`)
console.log('')
console.log('# Optional: COOKIE_SECURE=1 to force Secure cookies behind a TLS proxy')
console.log('# (auto-detected from X-Forwarded-Proto when `trust proxy` is on).')
