// Gmail Sync — fetches emails, uses AI to extract tasks and tracking numbers
import { getData, setData, isGmailProcessed, markGmailProcessed, upsertTask, upsertPackage, getAllPackages, bumpVersion } from './db.js'

const GMAIL_TOKENS_KEY = 'gmail_tokens'
const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me'

let envGoogleClientId = null
let envGoogleClientSecret = null
let envAnthropicKey = null
let broadcastFn = null

export function initGmailSync(opts) {
  envGoogleClientId = opts.clientId
  envGoogleClientSecret = opts.clientSecret
  envAnthropicKey = opts.anthropicKey
  broadcastFn = opts.broadcast
}

// --- Token management (mirrors GCal pattern) ---

export async function getGmailAccessToken() {
  const tokens = getData(GMAIL_TOKENS_KEY)
  if (!tokens?.refresh_token) return null

  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 300000) {
    return tokens.access_token
  }

  if (!envGoogleClientId || !envGoogleClientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: envGoogleClientId,
      client_secret: envGoogleClientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('[Gmail] Token refresh failed:', data.error_description || data.error)
    return null
  }

  tokens.access_token = data.access_token
  tokens.expiry_date = Date.now() + data.expires_in * 1000
  setData(GMAIL_TOKENS_KEY, tokens)
  return tokens.access_token
}

// --- Gmail API helpers ---

async function gmailFetch(path, accessToken) {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail API error ${res.status}: ${err}`)
  }
  return res.json()
}

async function listMessages(accessToken, query, maxResults = 20) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) })
  const data = await gmailFetch(`/messages?${params}`, accessToken)
  return data.messages || []
}

async function getMessage(accessToken, messageId) {
  return gmailFetch(`/messages/${messageId}?format=full`, accessToken)
}

// --- Email parsing ---

function decodeBase64Url(str) {
  if (!str) return ''
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return Buffer.from(base64, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function extractEmailContent(message) {
  const headers = message.payload?.headers || []
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)'
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || ''
  const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || ''

  // Extract body text — try plain text first, fall back to HTML
  let body = ''
  let rawHtml = ''
  const payload = message.payload

  function extractParts(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += decodeBase64Url(part.body.data)
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      rawHtml += decodeBase64Url(part.body.data)
    }
    if (part.parts) {
      for (const sub of part.parts) extractParts(sub)
    }
  }

  if (payload) extractParts(payload)

  // If no plain text, convert HTML to readable text
  if (!body && rawHtml) {
    // Extract tracking-related URLs before stripping (carriers often embed tracking numbers in links)
    const trackingUrls = []
    const hrefRegex = /href="([^"]*(?:track|shipment|ups\.com|fedex\.com|usps\.com|tools\.usps|narvar|aftership|17track|packagetrackr)[^"]*)"/gi
    let match
    while ((match = hrefRegex.exec(rawHtml)) !== null) {
      trackingUrls.push(match[1])
    }

    // Strip HTML but preserve structure with newlines
    body = rawHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()

    // Append extracted tracking URLs as hints for the AI
    if (trackingUrls.length > 0) {
      body += '\n\n[Tracking URLs found in email: ' + trackingUrls.join(', ') + ']'
    }
  }

  // Truncate body to avoid excessive AI token usage
  if (body.length > 6000) body = body.slice(0, 6000) + '...'

  return { subject, from, date, body, messageId: message.id, threadId: message.threadId }
}

// --- AI analysis ---

async function callClaude(systemPrompt, userMessage) {
  if (!envAnthropicKey) throw new Error('No Anthropic API key')

  // Load custom instructions from settings
  const settings = getData('settings')
  let system = systemPrompt
  if (settings?.custom_instructions) {
    system += `\n\nUser's custom instructions:\n${settings.custom_instructions}`
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': envAnthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Claude API error: ${data.error?.message || res.status}`)
  return data.content?.[0]?.text || ''
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) }
  catch { return null }
}

async function analyzeEmails(emails) {
  if (emails.length === 0) return []

  const emailSummaries = emails.map((e, i) => (
    `--- EMAIL ${i + 1} ---\nMessage ID: ${e.messageId}\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\nBody:\n${e.body}\n`
  )).join('\n')

  const systemPrompt = `You analyze emails to extract actionable items. For each email, determine if it contains:
1. An actionable task (appointment, deadline, action required, bill due, document to submit, etc.)
2. A package tracking number (from order confirmations, shipping notifications, etc.)
3. Neither (newsletters, marketing, social notifications, receipts with no action needed)

For tracking numbers, look for patterns like:
- USPS: starts with 92, 93, 94, 95 (20+ digits), or prefixed with 420+ZIP (e.g., 420501499300...), or two letters + 9 digits + US
- UPS: starts with 1Z (18 chars)
- FedEx: 12, 15, 20, or 22 digits
- Amazon: starts with TBA (15+ chars)
- DHL: 10-11 digits or 3 letters + 7+ digits

Return ONLY valid JSON with this structure:
{
  "results": [
    {
      "message_id": "the gmail message id",
      "type": "task" | "package" | "skip",
      "task": { "title": "...", "notes": "...", "due_date": "YYYY-MM-DD or null" },
      "package": { "tracking_number": "...", "carrier": "usps|ups|fedex|amazon|dhl|other", "label": "item description" }
    }
  ]
}

Rules:
- Be conservative — only create tasks for genuinely actionable items that require the user to DO something
- Do NOT create tasks for: order confirmations with no action needed, password reset emails, social media notifications, newsletters, marketing
- DO create tasks for: appointment confirmations (with date), bills due, documents to sign/submit, items to return, reservations to confirm
- For packages: extract the tracking number and identify the carrier. Include a short item description as the label.
- Keep task titles short and actionable (imperative mood). Include relevant details in notes.
- If an email contains BOTH a task and a tracking number, return both as separate results with the same message_id.`

  const response = await callClaude(systemPrompt, emailSummaries)
  const parsed = extractJSON(response)
  return parsed?.results || []
}

// --- Task/package creation ---

function createTaskFromGmail(item, messageId) {
  const now = new Date().toISOString()
  const id = `gmail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const task = {
    id,
    title: item.task.title,
    status: 'not_started',
    notes: item.task.notes || '',
    due_date: item.task.due_date || null,
    snoozed_until: null,
    snooze_count: 0,
    staleness_days: 2,
    last_touched: now,
    created_at: now,
    completed_at: null,
    reframe_notes: null,
    notion_page_id: null,
    notion_url: null,
    trello_card_id: null,
    trello_card_url: null,
    trello_sync_enabled: null,
    routine_id: null,
    high_priority: 0,
    size: null,
    energy: null,
    energy_level: null,
    tags_json: '[]',
    attachments_json: '[]',
    checklist_json: '[]',
    checklists_json: '[]',
    comments_json: '[]',
    toast_messages_json: null,
    gcal_event_id: null,
    gcal_duration: null,
    gmail_message_id: messageId,
    gmail_pending: 1,
  }

  upsertTask(task)
  return id
}

function createPackageFromGmail(item, messageId) {
  const now = new Date().toISOString()
  const id = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const pkg = {
    id,
    tracking_number: item.package.tracking_number,
    carrier: item.package.carrier || null,
    carrier_name: '',
    label: item.package.label || '',
    status: 'pending',
    status_detail: '',
    eta: null,
    delivered_at: null,
    signature_required: 0,
    signature_task_id: null,
    last_location: '',
    events_json: '[]',
    last_polled: null,
    poll_interval_minutes: 120,
    auto_cleanup_at: null,
    created_at: now,
    updated_at: now,
    gmail_message_id: messageId,
    gmail_pending: 1,
  }

  upsertPackage(pkg)
  return id
}

// --- Regex-based tracking number extraction (no AI needed) ---

const TRACKING_PATTERNS = [
  // USPS — with optional 420+ZIP prefix
  { carrier: 'usps', regex: /\b(420\d{5,9})?(9[2345]\d{20,26})\b/g },
  { carrier: 'usps', regex: /\b([A-Z]{2}\d{9}US)\b/g },
  // UPS
  { carrier: 'ups', regex: /\b(1Z[A-Z0-9]{16})\b/gi },
  // FedEx — 12, 15, 20, or 22 digits (require shipping context to avoid false positives)
  { carrier: 'fedex', regex: /\b(\d{12})\b/g, requiresContext: true },
  { carrier: 'fedex', regex: /\b(\d{15})\b/g, requiresContext: true },
  { carrier: 'fedex', regex: /\b(\d{20})\b/g },
  { carrier: 'fedex', regex: /\b(\d{22})\b/g },
  // Amazon
  { carrier: 'amazon', regex: /\b(TBA\d{12,})\b/gi },
  // DHL
  { carrier: 'dhl', regex: /\b([A-Z]{3}\d{7,})\b/g, requiresContext: true },
]

const SHIPPING_KEYWORDS = /(?:shipped|tracking|shipment|on its way|on the way|out for delivery|in transit|carrier|delivered|track your|track package|order.*shipped)/i

function extractTrackingNumbers(subject, body) {
  const text = subject + ' ' + body
  const hasShippingContext = SHIPPING_KEYWORDS.test(text)
  const found = []
  const seen = new Set()

  for (const { carrier, regex, requiresContext } of TRACKING_PATTERNS) {
    if (requiresContext && !hasShippingContext) continue
    // Reset regex state
    const re = new RegExp(regex.source, regex.flags)
    let match
    while ((match = re.exec(text)) !== null) {
      // Use the last captured group (the actual tracking number)
      const num = match[match.length - 1] || match[0]
      const cleaned = num.trim()
      if (!seen.has(cleaned)) {
        seen.add(cleaned)
        found.push({ tracking_number: cleaned, carrier })
      }
    }
  }

  return found
}

function guessPackageLabel(subject, from) {
  // Try to extract a useful label from the subject/sender
  const fromName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
  // Remove common shipping prefixes from subject
  const cleanSubject = subject
    .replace(/^(re|fwd|fw):\s*/i, '')
    .replace(/your (order|shipment|package)\s*(#?\w+\s*)?/i, '')
    .replace(/has (shipped|been shipped)/i, '')
    .replace(/is on (its|the) way/i, '')
    .replace(/tracking (number|info|update)/i, '')
    .replace(/shipment (from|notification|update|confirmation)/i, '')
    .trim()

  if (cleanSubject && cleanSubject.length > 3 && cleanSubject.length < 80) {
    return cleanSubject
  }
  return fromName || 'Package'
}

// --- Main sync function ---

export async function syncGmail(daysBack = 7) {
  const accessToken = await getGmailAccessToken()
  if (!accessToken) {
    return { error: 'Not connected to Gmail', tasks: 0, packages: 0, skipped: 0 }
  }

  console.log(`[Gmail] Starting sync (last ${daysBack} days)...`)

  try {
    // Build query: inbox only, recent, skip categories
    const query = `in:inbox newer_than:${daysBack}d -category:promotions -category:social -category:updates -category:forums`
    const messageList = await listMessages(accessToken, query, 50)

    if (messageList.length === 0) {
      console.log('[Gmail] No new messages found')
      return { tasks: 0, packages: 0, skipped: 0, total: 0 }
    }

    // Filter out already-processed messages
    const unprocessed = messageList.filter(m => !isGmailProcessed(m.id))
    if (unprocessed.length === 0) {
      console.log('[Gmail] All messages already processed')
      return { tasks: 0, packages: 0, skipped: 0, total: 0 }
    }

    console.log(`[Gmail] ${unprocessed.length} unprocessed message(s) to analyze`)

    // Fetch full message content (batch in groups of 10)
    const emails = []
    for (let i = 0; i < unprocessed.length; i += 10) {
      const batch = unprocessed.slice(i, i + 10)
      const fetched = await Promise.all(
        batch.map(m => getMessage(accessToken, m.id).catch(err => {
          console.error(`[Gmail] Failed to fetch message ${m.id}:`, err.message)
          return null
        }))
      )
      for (const msg of fetched) {
        if (msg) emails.push(extractEmailContent(msg))
      }
    }

    if (emails.length === 0) {
      return { tasks: 0, packages: 0, skipped: 0, total: 0 }
    }

    let tasksCreated = 0
    let packagesCreated = 0
    let skipped = 0

    // --- Phase 1: Regex-based tracking number extraction (free, instant) ---
    const existingPackages = getAllPackages()
    const existingTrackingNums = new Set(existingPackages.map(p => p.tracking_number.toLowerCase()))
    const emailsForAI = []
    for (const email of emails) {
      const trackingNumbers = extractTrackingNumbers(email.subject, email.body)
      if (trackingNumbers.length > 0) {
        const label = guessPackageLabel(email.subject, email.from)
        let createdAny = false
        for (const tn of trackingNumbers) {
          // Skip duplicates — but fix pending flag on existing gmail-sourced packages
          if (existingTrackingNums.has(tn.tracking_number.toLowerCase())) {
            const existing = existingPackages.find(p => p.tracking_number.toLowerCase() === tn.tracking_number.toLowerCase())
            if (existing && existing.gmail_message_id && !existing.gmail_pending) {
              // Package was created by a broken earlier version — fix pending flag
              upsertPackage({ ...existing, gmail_pending: 1 })
              console.log(`[Gmail] Regex: fixed pending flag on existing package ${tn.tracking_number}`)
            } else {
              console.log(`[Gmail] Regex: skipping duplicate tracking ${tn.tracking_number}`)
            }
            continue
          }
          const item = { package: { tracking_number: tn.tracking_number, carrier: tn.carrier, label } }
          const pkgId = createPackageFromGmail(item, email.messageId)
          existingTrackingNums.add(tn.tracking_number.toLowerCase())
          packagesCreated++
          createdAny = true
          console.log(`[Gmail] Regex: found tracking ${tn.tracking_number} (${tn.carrier}) in "${email.subject}"`)
        }
        markGmailProcessed(email.messageId, email.threadId, email.subject, email.from, createdAny ? 'package' : 'skipped', null)
      } else {
        emailsForAI.push(email)
      }
    }

    // --- Phase 2: AI analysis for remaining emails (tasks + non-obvious packages) ---
    if (!envAnthropicKey && emailsForAI.length > 0) {
      // No AI key — mark remaining as skipped
      for (const email of emailsForAI) {
        markGmailProcessed(email.messageId, email.threadId, email.subject, email.from, 'skipped', null)
        skipped++
      }
    }

    for (let i = 0; i < emailsForAI.length && envAnthropicKey; i += 10) {
      const batch = emailsForAI.slice(i, i + 10)
      let results
      try {
        results = await analyzeEmails(batch)
      } catch (err) {
        console.error('[Gmail] AI analysis failed:', err.message)
        // Mark all as error so we don't retry endlessly
        for (const email of batch) {
          markGmailProcessed(email.messageId, email.threadId, email.subject, email.from, 'error', null)
        }
        continue
      }

      // Process results
      const processedIds = new Set()
      for (const result of results) {
        const email = batch.find(e => e.messageId === result.message_id)
        if (!email) continue

        if (result.type === 'task' && result.task?.title) {
          const taskId = createTaskFromGmail(result, result.message_id)
          markGmailProcessed(result.message_id, email.threadId, email.subject, email.from, 'task', taskId)
          processedIds.add(result.message_id)
          tasksCreated++
          console.log(`[Gmail] Created task: "${result.task.title}" from "${email.subject}"`)
        } else if (result.type === 'package' && result.package?.tracking_number) {
          if (existingTrackingNums.has(result.package.tracking_number.toLowerCase())) {
            console.log(`[Gmail] AI: skipping duplicate tracking ${result.package.tracking_number}`)
          } else {
            const pkgId = createPackageFromGmail(result, result.message_id)
            existingTrackingNums.add(result.package.tracking_number.toLowerCase())
            packagesCreated++
            console.log(`[Gmail] Created package: ${result.package.tracking_number} from "${email.subject}"`)
          }
          markGmailProcessed(result.message_id, email.threadId, email.subject, email.from, 'package', null)
          processedIds.add(result.message_id)
        } else {
          if (!processedIds.has(result.message_id)) {
            markGmailProcessed(result.message_id, email.threadId, email.subject, email.from, 'skipped', null)
            processedIds.add(result.message_id)
          }
          skipped++
        }
      }

      // Mark any un-mentioned emails as skipped
      for (const email of batch) {
        if (!processedIds.has(email.messageId)) {
          markGmailProcessed(email.messageId, email.threadId, email.subject, email.from, 'skipped', null)
          skipped++
        }
      }
    }

    // Broadcast update if we created anything
    if ((tasksCreated > 0 || packagesCreated > 0) && broadcastFn) {
      const newVersion = bumpVersion()
      broadcastFn(newVersion, null)
    }

    const summary = { tasks: tasksCreated, packages: packagesCreated, skipped, total: emails.length }
    console.log(`[Gmail] Sync complete:`, summary)

    // Update last sync timestamp
    setData('gmail_last_sync', new Date().toISOString())

    return summary
  } catch (err) {
    console.error('[Gmail] Sync error:', err.message)
    return { error: err.message, tasks: 0, packages: 0, skipped: 0 }
  }
}

// --- Polling loop ---
let pollInterval = null

export function startGmailPolling(intervalMs = 5 * 60 * 1000) {
  if (pollInterval) clearInterval(pollInterval)

  pollInterval = setInterval(async () => {
    const tokens = getData(GMAIL_TOKENS_KEY)
    const settings = getData('settings')
    if (!tokens?.refresh_token || !settings?.gmail_sync_enabled) return

    try {
      // Ongoing polling uses 1 day window to catch recent emails
      await syncGmail(1)
    } catch (err) {
      console.error('[Gmail] Polling error:', err.message)
    }
  }, intervalMs)

  console.log(`[Gmail] Polling started (every ${intervalMs / 60000} minutes)`)
}

export function stopGmailPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
