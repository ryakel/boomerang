// capture.js — validation + rate limiting for the POST /api/capture endpoint
// (Siri voice capture, see wiki/Capture-Shortcut.md). Pure functions, no DB or
// Express dependency, so scripts/capture.test.mjs can unit-test them directly.
//
// Capture is deliberately dumb: no triage, no AI parsing, no due-date
// extraction. Text in, inbox task out. The one nuance is the title/notes
// split below — dictation can run long, and silently truncating a capture
// destroys trust, so overflow is preserved in notes instead of dropped.

// Dictation cap. Anything past this is genuinely a document, not a capture.
export const CAPTURE_TEXT_MAX = 2000

// Titles beyond this go unreadable on cards; matches /api/intake's title cap.
export const CAPTURE_TITLE_MAX = 500

// Validate + normalize a capture request body.
// Returns { error } (HTTP 400 material) or { title, notes, source }.
export function normalizeCapture(body) {
  const raw = (body?.text ?? '').toString()
  const text = raw.trim().slice(0, CAPTURE_TEXT_MAX)
  if (!text) return { error: 'text is required' }

  // Free-form provenance tag ('siri' | 'shortcut' | 'manual' | ...), kept
  // short and lowercase so the column stays queryable. Default 'api'.
  let source = (body?.source ?? '').toString().trim().toLowerCase().slice(0, 32)
  if (!/^[a-z0-9_-]+$/.test(source)) source = ''

  // Long dictation: first chunk becomes the title, the FULL text is kept in
  // notes so nothing is lost. Short captures stay title-only.
  const title = text.slice(0, CAPTURE_TITLE_MAX)
  const notes = text.length > CAPTURE_TITLE_MAX ? text : ''

  return { title, notes, source: source || 'api' }
}

// Minimal sliding-window rate limiter (single-user server — one global
// window, no per-key bookkeeping). allow() returns true and records the hit,
// or false when `limit` hits already landed inside the trailing `windowMs`.
export function createRateLimiter({ limit = 30, windowMs = 60_000 } = {}) {
  let hits = []
  return {
    allow(now = Date.now()) {
      const cutoff = now - windowMs
      hits = hits.filter(t => t > cutoff)
      if (hits.length >= limit) return false
      hits.push(now)
      return true
    },
  }
}
