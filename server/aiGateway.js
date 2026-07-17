// AI gateway (2026-07-17) — the single door for utility-AI calls, in both
// senses: it routes a TIER ('workhorse' | 'quick') to whichever provider +
// model the user picked in Settings (Anthropic or OpenAI), and it logs every
// call into the ai_usage table for the usage dashboard. Server modules call
// aiComplete() directly; the client reaches it through POST /api/ai/complete.
//
// Deliberately NOT routed through here: Quokka's agent loop (Anthropic
// tool-use shaped) and the vision surfaces (/api/messages — attachment OCR,
// research with images/PDFs). Those stay pinned to Anthropic; their usage is
// logged at their own call sites.
import { getData, logAiUsage } from './db.js'
import { resolveTierModel, claudeText, NO_THINKING } from './aiModels.js'

function settingsBlob() {
  try { return getData('settings') || {} } catch { return {} }
}

export function getOpenAIKeyFromEnvOrSettings() {
  return settingsBlob().openai_api_key || process.env.OPENAI_API_KEY || null
}

function getAnthropicKeyFromEnvOrSettings() {
  return settingsBlob().anthropic_api_key || process.env.ANTHROPIC_API_KEY || null
}

// aiComplete({ tier, system, user, maxTokens, feature, anthropicKey?, openaiKey?, signal? })
// → { text, provider, model } — text is '' only if the model truly returned
// nothing. Throws on missing key / HTTP errors (message names the provider).
export async function aiComplete({
  tier = 'workhorse', system, user, maxTokens = 2048, feature,
  anthropicKey, openaiKey, signal,
} = {}) {
  const { provider, model } = resolveTierModel(tier, settingsBlob())
  if (provider === 'openai') {
    return openaiComplete({ model, system, user, maxTokens, feature, key: openaiKey, signal })
  }
  return anthropicComplete({ model, system, user, maxTokens, feature, key: anthropicKey, signal })
}

async function anthropicComplete({ model, system, user, maxTokens, feature, key, signal }) {
  const apiKey = key || getAnthropicKeyFromEnvOrSettings()
  if (!apiKey) throw new Error('No Anthropic API key configured')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: maxTokens, ...NO_THINKING,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Anthropic error: ${data.error?.message || res.status}`)
  logAiUsage({
    provider: 'anthropic', model: data.model || model, feature,
    input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0,
  })
  return { text: claudeText(data), provider: 'anthropic', model: data.model || model }
}

async function openaiComplete({ model, system, user, maxTokens, feature, key, signal }) {
  const apiKey = key || getOpenAIKeyFromEnvOrSettings()
  if (!apiKey) throw new Error('No OpenAI API key configured — add one in Settings → Integrations → OpenAI')
  const body = {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user },
    ],
  }
  // GPT-5-family models are reasoning models — reasoning tokens spend from
  // max_completion_tokens (the same trap as Sonnet 5's adaptive thinking).
  // 'low' is the effort level accepted across the family; keeps utility
  // calls fast and leaves the budget for the actual answer.
  if (/^gpt-5/.test(model)) body.reasoning_effort = 'low'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`OpenAI error: ${data.error?.message || res.status}`)
  logAiUsage({
    provider: 'openai', model: data.model || model, feature,
    input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0,
  })
  const text = (data.choices?.[0]?.message?.content || '').trim()
  return { text, provider: 'openai', model: data.model || model }
}

// Is the resolved provider for a tier actually usable? Modules gate their
// AI features on this instead of checking for an Anthropic key directly —
// otherwise an OpenAI-only setup would silently skip every feature.
export function aiConfigured(tier = 'workhorse') {
  const { provider } = resolveTierModel(tier, settingsBlob())
  return provider === 'openai'
    ? !!getOpenAIKeyFromEnvOrSettings()
    : !!getAnthropicKeyFromEnvOrSettings()
}

// Cheap live probe for the integrations health check / Settings test button.
// GET /v1/models is free and validates the key.
export async function probeOpenAI(key) {
  const apiKey = key || getOpenAIKeyFromEnvOrSettings()
  if (!apiKey) return { configured: false, status: 'not_configured', detail: 'No API key set' }
  const res = await fetch('https://api.openai.com/v1/models?limit=1', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (res.ok) return { configured: true, status: 'connected', detail: 'Key valid' }
  const data = await res.json().catch(() => ({}))
  return { configured: true, status: 'error', detail: data.error?.message || `HTTP ${res.status}` }
}
