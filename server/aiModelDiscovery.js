// Live model discovery for the tier pickers (2026-08-01).
//
// MODEL_CATALOG in aiModels.js is hand-maintained, so the picker could only
// ever offer models that existed when the bundle was built — a new Claude or
// GPT release is invisible until someone edits the array and ships. Reported
// as "I can't see fable or opus 5 or any of the new ChatGPT option".
//
// This module asks each CONFIGURED provider what it actually serves and merges
// that over the catalog. The split of responsibilities matters:
//
//   - The catalog stays the source of truth for LABELS and PRICING. A
//     discovered id we've never seen has no price, and estimateAiCost already
//     returns null for those, so the usage dashboard shows no cost rather than
//     a wrong one.
//   - Routing is NOT touched. resolveModelRef/resolveTierModel in aiModels.js
//     remain the only thing that decides where a call goes (a CLAUDE.md
//     invariant). This only decides what the picker can OFFER.
//
// Everything except fetchProviderModels() is pure and clock-injected, so the
// merge rules are testable without a network.

import { MODEL_CATALOG } from './aiModels.js'
import { getAnthropicKeyFromEnvOrSettings, getOpenAIKeyFromEnvOrSettings } from './aiGateway.js'

// OpenAI's /v1/models is a kitchen sink — embeddings, TTS, transcription,
// image and moderation models all sit alongside the chat ones. Offering those
// in a picker whose only job is text completion would be actively misleading,
// so they're filtered by name. Anthropic's list needs no filtering: every
// entry is a chat model.
const OPENAI_NON_CHAT = [
  'embedding', 'tts', 'whisper', 'audio', 'realtime', 'transcribe',
  'image', 'dall-e', 'moderation', 'sora', 'search-preview', 'computer-use',
]

export function isChatModel(id, provider) {
  if (!id) return false
  if (provider === 'anthropic') return id.startsWith('claude')
  const lower = id.toLowerCase()
  if (OPENAI_NON_CHAT.some(bad => lower.includes(bad))) return false
  return /^(gpt|o[1-9]|chatgpt)/.test(lower)
}

// Price/label lookup uses the same exact-then-longest-prefix rule as
// estimateAiCost: providers echo DATED ids ('gpt-5-mini-2025-08-07'), and the
// longest matching catalog id must win so a dated mini doesn't inherit the
// full model's label or price.
export function catalogMatch(id, catalog = MODEL_CATALOG) {
  if (!id) return null
  return catalog.find(x => x.id === id)
    || catalog
      .filter(x => id.startsWith(`${x.id}-`))
      .sort((a, b) => b.id.length - a.id.length)[0]
    || null
}

// Merge discovered models over the static catalog.
//
// Catalog entries are KEPT even when a provider didn't return them — a
// provider outage, a filtered response or a key without access to one model
// must not silently delete a model the user has already selected. The
// alternative (discovered-only) means one bad response empties the picker,
// which is the same "failed renders as empty" trap the Share Extension hit.
export function mergeCatalog(discovered = [], catalog = MODEL_CATALOG) {
  const out = new Map()

  for (const m of catalog) {
    out.set(m.id, { ...m, source: 'catalog' })
  }

  for (const d of discovered) {
    if (!d?.id || !d.provider) continue
    const known = catalogMatch(d.id, catalog)
    const existing = out.get(d.id)
    out.set(d.id, {
      id: d.id,
      provider: d.provider,
      // A catalog label is hand-written and better than a raw id; a provider
      // display_name beats a bare id when we have nothing.
      label: (existing?.id === d.id ? existing.label : null)
        || (known?.id === d.id ? known.label : null)
        || d.label
        || d.id,
      // Pricing only ever comes from the catalog. An unpriced model is
      // offered, it just doesn't contribute a cost estimate.
      ...(known ? { in: known.in, out: known.out } : {}),
      created: d.created ?? existing?.created ?? null,
      source: existing ? 'both' : 'live',
    })
  }

  // Providers list both 'gpt-5.5-pro' and 'gpt-5.5-pro-2026-04-23', where the
  // undated id is a moving alias for the latest snapshot. Offering both doubles
  // the picker with entries that mostly resolve to the same model, so a dated
  // variant is dropped WHEN ITS BASE IS ALSO PRESENT — pinning to a snapshot
  // stays possible through the existing Custom… field. A dated id whose base
  // is absent is kept, because then it's the only way to reach that model.
  // Anthropic's ids date differently ('claude-haiku-4-5-20251001') and never
  // match this shape, so they're untouched.
  const ids = new Set(out.keys())
  for (const id of ids) {
    const base = id.replace(/-\d{4}-\d{2}-\d{2}$/, '')
    if (base !== id && ids.has(base)) out.delete(id)
  }

  // Newest first within a provider, so a just-released model is at the top
  // where the complaint says it should be. Undated entries (catalog-only)
  // sort last rather than jumping the queue with a 0.
  return [...out.values()].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1
    if (a.created && b.created) return b.created - a.created
    if (a.created) return -1
    if (b.created) return 1
    return a.label.localeCompare(b.label)
  })
}

// Normalize the two provider response shapes into one.
// `data` is checked with isArray rather than `|| []`: a provider that answers
// with an unexpected shape (a string, an error object) would otherwise throw
// inside .filter and take the whole discovery down, when the honest result is
// "this provider contributed nothing".
export function normalizeAnthropic(body) {
  return (Array.isArray(body?.data) ? body.data : [])
    .filter(m => m?.id && isChatModel(m.id, 'anthropic'))
    .map(m => ({
      id: m.id,
      provider: 'anthropic',
      label: m.display_name || m.id,
      created: m.created_at ? Date.parse(m.created_at) || null : null,
    }))
}

export function normalizeOpenAI(body) {
  return (Array.isArray(body?.data) ? body.data : [])
    .filter(m => m?.id && isChatModel(m.id, 'openai'))
    .map(m => ({
      id: m.id,
      provider: 'openai',
      label: m.id,
      // OpenAI's `created` is epoch SECONDS.
      created: typeof m.created === 'number' ? m.created * 1000 : null,
    }))
}

// ---------------------------------------------------------------------------
// The network half.
// ---------------------------------------------------------------------------

// Per-provider status is reported to the client rather than folded away: a
// provider that failed must not look like a provider with nothing new, or the
// picker quietly goes stale again in a way nobody can see. Timeouts are short
// because this runs while a settings page is open.
const DISCOVERY_TIMEOUT_MS = 8000

async function fetchOne({ url, headers, normalize }) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return normalize(await res.json())
}

// Ask every CONFIGURED provider what it serves. A provider with no key is
// 'not_configured', not an error — an Anthropic-only setup is supported and
// must not surface an OpenAI failure it can do nothing about.
export async function fetchLiveModels() {
  const sources = {}
  const models = []

  const anthropicKey = getAnthropicKeyFromEnvOrSettings()
  const openaiKey = getOpenAIKeyFromEnvOrSettings()

  const jobs = [
    anthropicKey && ['anthropic', {
      url: 'https://api.anthropic.com/v1/models?limit=100',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      normalize: normalizeAnthropic,
    }],
    openaiKey && ['openai', {
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${openaiKey}` },
      normalize: normalizeOpenAI,
    }],
  ].filter(Boolean)

  if (!anthropicKey) sources.anthropic = { status: 'not_configured' }
  if (!openaiKey) sources.openai = { status: 'not_configured' }

  const results = await Promise.allSettled(jobs.map(([, spec]) => fetchOne(spec)))
  results.forEach((r, i) => {
    const name = jobs[i][0]
    if (r.status === 'fulfilled') {
      models.push(...r.value)
      sources[name] = { status: 'ok', count: r.value.length }
    } else {
      console.warn(`[aiModels] ${name} discovery failed: ${r.reason?.message || r.reason}`)
      sources[name] = { status: 'error', detail: r.reason?.message || 'failed' }
    }
  })

  return { models: mergeCatalog(models), sources }
}
