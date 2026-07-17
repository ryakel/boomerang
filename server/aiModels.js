// Single source of truth for which Claude model each AI feature uses.
// Previously the model id was a literal string repeated at every call site
// (server AND client) — a model upgrade meant grep-and-replace across a
// dozen files instead of one edit. No Node-specific dependencies here, so
// this file is safe to import from both server modules and the Vite client
// bundle (src/api.js, src/hooks/useNotifications.js).
//
// SONNET_MODEL — the workhorse tier: Quokka's adviser chat, Gmail
// classification, Growth Areas inference/rephrasing, routine pattern
// detection, weekly tag suggestions, AI-generated nudge/toast messages,
// task research, escalation-ladder generation, size/energy inference.
// HAIKU_MODEL — cheap/fast tier: AI-assisted search (Activity Log, Done
// list), short push-notification message generation.
export const SONNET_MODEL = 'claude-sonnet-5'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// Extract the response text from a Messages API response. Claude Sonnet 5
// runs adaptive thinking by default, so `content[0]` can be a `thinking`
// block (with EMPTY text under the default display) — `content[0].text` is
// then undefined and any .match()/.trim() on it crashes, or a `?.` chain
// silently returns '' and the feature degrades (the 2026-07-17 Polish-button
// incident). Always collect the text blocks, wherever they sit.
export function claudeText(data) {
  return (data?.content || [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim()
}

// Explicitly disable thinking on cheap utility calls (inference, one-line
// rewrites, classification). Sonnet 5 runs adaptive thinking when the field
// is omitted — for these calls that only adds latency + cost and can eat a
// small max_tokens budget from the inside. Spread into the request body:
// `...NO_THINKING`. (Sonnet 5 accepts an explicit disabled; do not send
// this to models where thinking is always-on.)
export const NO_THINKING = { thinking: { type: 'disabled' } }
