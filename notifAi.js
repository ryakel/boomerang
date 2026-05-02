/**
 * Tone-aware notification body rewriter.
 *
 * One rewrite per dispatcher tick (60s) — costs ~$0.001/day at typical
 * volume. Uses the user's `ai_custom_instructions` setting to adjust the
 * tone of notifications. For example, a user who said "phone calls are
 * confrontation-level for me" gets call-related overdue notifications
 * framed more gently.
 *
 * Skipped when:
 * - No Anthropic API key configured
 * - No `ai_custom_instructions` set (nothing to tone-adjust against)
 * - The notification is Pushover priority 2 (Emergency) — those need
 *   urgency, not softening
 *
 * Returns the original body string on any failure (network, timeout,
 * malformed response). Never throws — caller can always use the result.
 */

import { getData } from './db.js'

const REWRITE_TIMEOUT_MS = 2500

let lastRewriteTickKey = null

function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || getData('settings')?.anthropic_api_key || null
}

function getCustomInstructions() {
  const s = getData('settings') || {}
  const v = (s.ai_custom_instructions || '').trim()
  return v.length > 0 ? v : null
}

/**
 * Rewrite a notification body in the user's preferred tone.
 * Returns either the rewritten string or the original on any failure.
 *
 * @param {object} task   The task the notification is about (title/energy/etc.)
 * @param {string} body   The static notification body to potentially rewrite
 * @returns {Promise<string>} Rewritten body, or original on failure
 */
export async function rewriteNotifBody(task, body) {
  const key = getApiKey()
  const instructions = getCustomInstructions()
  if (!key || !instructions || !body) return body

  const taskCtx = `Title: "${task?.title || ''}"${task?.energy ? ` · Energy: ${task.energy}` : ''}${task?.due_date ? ` · Due: ${task.due_date}` : ''}`
  const system = `You rewrite ADHD task-manager notifications to match the user's preferred tone.

The user's tone preferences (apply these to the rewrite):
${instructions}

Rules:
- Output ONLY the rewritten notification body. No quotes, no preamble.
- Stay under 140 characters.
- Plain text — no Markdown, no exclamation marks, no emoji unless the original used them.
- Preserve the underlying meaning (what the task is, that it needs attention).
- Match the energy of the original — don't soften urgency on overdue items, don't manufacture urgency on quiet nudges.
- Never invent details about the task that aren't in the input.`

  const user = `Original notification body:
${body}

Task context:
${taskCtx}

Rewrite the notification body in the user's preferred tone.`

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REWRITE_TIMEOUT_MS)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.error('[NotifAI] rewrite failed:', res.status)
      return body
    }
    const data = await res.json()
    const rewritten = data.content?.[0]?.text?.trim() || ''
    if (!rewritten || rewritten.length < 5) return body
    // Strip surrounding quotes if the model added any
    const clean = rewritten.replace(/^["'`]|["'`]$/g, '').slice(0, 200)
    return clean
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[NotifAI] rewrite error:', err.message)
    return body
  }
}

/**
 * Cost-bounded gate. Returns true at most once per dispatcher tick (60s)
 * for a given channel. Used by transport modules to limit AI calls.
 *
 * @param {string} channel  'pushover' | 'push' | 'email'
 * @returns {boolean} true if it's OK to spend an AI rewrite this tick
 */
export function canRewriteThisTick(channel) {
  const tickKey = `${channel}:${Math.floor(Date.now() / 60000)}`
  if (lastRewriteTickKey === tickKey) return false
  lastRewriteTickKey = tickKey
  return true
}

/**
 * Should a given notification be rewritten? Skips Pushover Emergency
 * (priority 2) — urgency matters more than tone there.
 */
export function shouldRewrite({ priority }) {
  if (priority === 2) return false
  return true
}
