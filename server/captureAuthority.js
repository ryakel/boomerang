// Pure shared policy: browser preflight avoids an unnecessary HTTP call; the
// server always revalidates. No Node APIs, providers, secrets or DB imports.
import { CAPTURE_TEXT_MAX } from './capture.js'

const restriction = /\b(?:do not|don['’]?t|never|not (?:yet|now|actually)|hold off|no actions?|no changes|just discuss|draft only|suggest only|only suggest|without (?:saving|adding|creating|changing))\b/i
const additionalAction = /(?:[.!?;,&+\n]|\b(?:and|then)\b)\s*(?:(?:please|also|then)\s+)*(?:add|create|save|schedule|reschedule|delete|remove|update|send|email|cancel|book|move|change|pin|remind|set|assign|mark|make|turn|link|tag|label)\b/i
const destination = /\b(?:to|in|on)\s+(?:my\s+|the\s+)?(?:notion|trello|(?:google\s+)?calendar|gcal|gmail|outlook|dropbox|obsidian|shared (?:list|board))\b/i
const conditional = /\b(?:if|unless|maybe|perhaps|consider|might|could|would)\b|\b(?:and|then)\s+(?:(?:a|another|the)\s+)?(?:task|note|event)\b/i
const scheduling = /\b(?:due|deadline|priority|urgent|critical|pin|pinned|tag|label|reminder|later|tomorrow|today|tonight|yesterday|next|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|remind|recurring|every|schedule|reschedule|at\s+\d)\b|\d{4}-\d{2}-\d{2}|\d{1,2}[:/]\d{2}|\b(?:on|by)\s+(?:the\s+)?\d|\bin\s+\d+\s+(?:minutes?|hours?|days?|weeks?)|\d{1,2}\s*(?:am|pm)\b/i

export function classifyExplicitCapture(message) {
  if (typeof message !== 'string' || message.length > CAPTURE_TEXT_MAX + 80 || restriction.test(message)) return null
  const match = message.trim().match(/^(?:please\s+)?(?:(?:add|create)\s+(?:(?:a|this)\s+)?task|save\s+(?:(?:a|this)\s+)?note)\s*(?::\s*|\s+)([\s\S]+)$/i)
  if (!match) return null
  const content = match[1].trim()
  if (/^(?:to|in|on|into)\b/i.test(content)) return null
  if (!content || content.length > CAPTURE_TEXT_MAX || additionalAction.test(content) || destination.test(content) || conditional.test(content)) return null
  const kind = /^\s*(?:please\s+)?save\b/i.test(message) ? 'note' : 'task'
  if (kind === 'task' && scheduling.test(content)) return null
  return { kind, content }
}
