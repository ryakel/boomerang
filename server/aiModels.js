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

// ---------------------------------------------------------------------------
// Multi-provider model catalog (2026-07-17, OpenAI integration).
//
// The utility-AI surfaces route through two TIERS instead of hardcoded model
// ids: 'workhorse' (classification, inference, polish, scans) and 'quick'
// (one-liners, AI search). Each tier resolves to a provider+model — the
// defaults below, overridable via settings.ai_model_workhorse /
// settings.ai_model_quick (a catalog id, or 'openai:<id>' /
// 'anthropic:<id>' for models not in the catalog yet).
//
// Pricing is $ per MILLION tokens (input/output) and exists for the usage
// dashboard's COST ESTIMATES only — update opportunistically; unknown
// models simply show no cost. Quokka's agent loop and the vision surfaces
// (attachment OCR, research-with-attachments) stay pinned to Anthropic and
// do not consult the tiers.
export const MODEL_CATALOG = [
  { id: SONNET_MODEL, provider: 'anthropic', label: 'Claude Sonnet 5', in: 3, out: 15 },
  { id: HAIKU_MODEL, provider: 'anthropic', label: 'Claude Haiku 4.5', in: 1, out: 5 },
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8', in: 5, out: 25 },
  { id: 'gpt-5.1', provider: 'openai', label: 'GPT-5.1', in: 1.25, out: 10 },
  { id: 'gpt-5', provider: 'openai', label: 'GPT-5', in: 1.25, out: 10 },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', in: 0.25, out: 2 },
  { id: 'gpt-5-nano', provider: 'openai', label: 'GPT-5 nano', in: 0.05, out: 0.4 },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', in: 2, out: 8 },
  { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini', in: 0.4, out: 1.6 },
]

export const TIER_DEFAULTS = { workhorse: SONNET_MODEL, quick: HAIKU_MODEL }

// Resolve a settings value (or default) to { provider, model }. Accepts a
// bare catalog id, or an explicit 'provider:model-id' for anything newer
// than the catalog. Heuristic fallback so a bare unknown id still routes.
export function resolveModelRef(ref) {
  if (!ref) return null
  const colon = ref.indexOf(':')
  if (colon > 0) {
    const provider = ref.slice(0, colon)
    const model = ref.slice(colon + 1)
    if ((provider === 'openai' || provider === 'anthropic') && model) return { provider, model }
  }
  const hit = MODEL_CATALOG.find(m => m.id === ref)
  if (hit) return { provider: hit.provider, model: hit.id }
  return { provider: /^gpt-|^o[0-9]/.test(ref) ? 'openai' : 'anthropic', model: ref }
}

export function resolveTierModel(tier, settings = {}) {
  const key = tier === 'quick' ? 'ai_model_quick' : 'ai_model_workhorse'
  return resolveModelRef(settings[key]) || resolveModelRef(TIER_DEFAULTS[tier === 'quick' ? 'quick' : 'workhorse'])
}

// Estimated dollars for a call, or null when the model isn't in the catalog.
// Providers echo DATED ids back ('gpt-5-mini-2025-08-07' for 'gpt-5-mini'),
// so match exact first, then the LONGEST catalog id that prefixes the dated
// form — longest wins so 'gpt-5-mini-…' prices as gpt-5-mini, not gpt-5.
export function estimateAiCost(modelId, inputTokens = 0, outputTokens = 0) {
  if (!modelId) return null
  const m = MODEL_CATALOG.find(x => x.id === modelId)
    || MODEL_CATALOG
      .filter(x => modelId.startsWith(`${x.id}-`))
      .sort((a, b) => b.id.length - a.id.length)[0]
  if (!m) return null
  return (inputTokens * m.in + outputTokens * m.out) / 1_000_000
}
