import { loadSettings } from './store'

const PROXY_URL = '/api/messages'

function getApiHeaders() {
  const settings = loadSettings()
  const headers = { 'Content-Type': 'application/json' }
  if (settings.anthropic_api_key) headers['x-anthropic-key'] = settings.anthropic_api_key
  if (settings.notion_token) headers['x-notion-token'] = settings.notion_token
  if (settings.trello_api_key) headers['x-trello-key'] = settings.trello_api_key
  if (settings.trello_secret) headers['x-trello-token'] = settings.trello_secret
  if (settings.gcal_client_id) headers['x-google-client-id'] = settings.gcal_client_id
  if (settings.gcal_client_secret) headers['x-google-client-secret'] = settings.gcal_client_secret
  if (settings.tracking_api_key) headers['x-tracking-key'] = settings.tracking_api_key
  return headers
}

function withCustomInstructions(systemPrompt) {
  const { custom_instructions } = loadSettings()
  if (!custom_instructions?.trim()) return systemPrompt
  return `${systemPrompt}\n\nThe user has provided these custom instructions for how you should communicate and behave. Follow them closely:\n---\n${custom_instructions.trim()}\n---`
}

export async function callClaude(systemPrompt, userMessage) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: withCustomInstructions(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.content[0].text
}

// --- Date inference ---
export async function inferDate(title, notes = '') {
  const today = new Date().toISOString().split('T')[0]
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const system = `You extract dates from task descriptions. Today is ${today} (${dayOfWeek}). If the text mentions a date or time reference (tomorrow, next Friday, end of month, etc.), return the ISO date string (YYYY-MM-DD). If no date is mentioned, return null. Return JSON only: {"date": "YYYY-MM-DD" or null}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}\n\nExtract the due date. JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  const result = JSON.parse(match[0])
  return result.date || null
}

// --- T-shirt sizing + energy inference ---
// Returns { size, energy, energyLevel } in a single API call.
// energy = type of capacity (desk|people|errand|creative|physical)
// energyLevel = drain intensity (1=low, 2=medium, 3=high)
export async function inferSize(title, notes = '') {
  const system = `You estimate task effort and energy requirements for someone with ADHD.

For SIZE, use T-shirt sizes: XS (under 5 min, trivial), S (5-15 min, quick), M (15-60 min, moderate), L (1-4 hours, significant), XL (4+ hours or multi-day). Consider complexity, steps involved, and dependencies.

For ENERGY TYPE, determine what kind of capacity this task draws from:
- "desk" — focused computer/paperwork (writing, coding, paying bills, data entry)
- "people" — social interaction (meetings, lunch with someone, asking favors)
- "errand" — going somewhere physically (pickup, returns, shopping, appointments)
- "creative" — open-ended thinking/making (design, writing, planning, brainstorming)
- "physical" — bodily effort (cleaning, moving, exercise, yard work, assembly)

For ENERGY LEVEL, rate the drain intensity 1-3:
- 1 = low drain, easy/routine (quick text, simple order, light tidying)
- 2 = medium drain, requires focus/effort (presentation prep, store returns, moderate cleaning)
- 3 = high drain, significant willpower needed (difficult conversations, deep cleaning, complex social situations)

Return JSON only: {"size": "XS"|"S"|"M"|"L"|"XL", "energy": "<type>", "energyLevel": 1|2|3}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}\n\nEstimate size, energy type, and energy level. JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { size: null, energy: null, energyLevel: null }
    const result = JSON.parse(match[0])
    return {
      size: result.size || null,
      energy: result.energy || null,
      energyLevel: result.energyLevel || null,
    }
  } catch {
    return { size: null, energy: null, energyLevel: null }
  }
}

// --- Routine due date suggestion ---
export async function suggestRoutineDueDate(title, notes, cadence, lastCompleted) {
  const today = new Date().toISOString().split('T')[0]
  const system = `You suggest optimal due dates for recurring tasks. Consider the task description, notes, cadence, and when it was last completed. Return JSON only: {"date": "YYYY-MM-DD", "reason": "one sentence"}`

  const user = `Recurring task: "${title}"
Cadence: ${cadence}
Last completed: ${lastCompleted || 'never'}
Today: ${today}
${notes ? `Notes: ${notes}` : ''}

When should this be due? JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// --- What Now ---
// capacity = optional energy type filter (desk|people|errand|creative|physical|null)
export async function getWhatNow(tasks, time, energy, capacity = null) {
  const ACTIVE = ['not_started', 'doing', 'waiting', 'open']
  const ENERGY_LABELS = { desk: 'Desk', people: 'People', errand: 'Errand', creative: 'Creative', physical: 'Physical' }
  const openTasks = tasks
    .filter(t => ACTIVE.includes(t.status))
    .map(t => {
      const drainLabel = t.energyLevel === 3 ? 'high' : t.energyLevel === 2 ? 'med' : 'low'
      const energyInfo = t.energy ? `, energy: ${ENERGY_LABELS[t.energy] || t.energy} (${drainLabel} drain)` : ''
      return `- "${t.title}" (${t.size || 'unsized'}${energyInfo}, ${t.tags.join(', ') || 'no tags'}, ${Math.floor((Date.now() - new Date(t.last_touched).getTime()) / 86400000)}d old, snoozed ${t.snooze_count}x)`
    })
    .join('\n')

  const capacityRule = capacity
    ? `\nCAPACITY FILTER: The user says they have "${capacity}" energy right now. STRONGLY prefer tasks matching this capacity type. Avoid suggesting tasks with a different energy type unless there are no matching tasks or the match is clearly the best option.`
    : ''

  const system = `You are a helpful assistant for someone with ADHD. You help them pick the right task to work on right now. Be warm, direct, and practical. No fluff. Never be preachy or condescending.

Tasks have t-shirt sizes: XS (~5 min), S (~15 min), M (~30-60 min), L (~half day), XL (~full day+).
Tasks also have energy types (desk, people, errand, creative, physical) and drain levels (low, med, high).
HARD RULE: Never suggest a task bigger than the available time allows. If they have 15 minutes, only suggest XS or S tasks. If they say "fumes" or "low" energy, only suggest XS or S AND prefer low-drain tasks. A medium task requires at least 30 minutes AND moderate energy. Ignore stale/old tasks if they are too big for the window.${capacityRule}

Respond with JSON only — an object with two fields:
- "picks": array of 1-3 objects with "task" (exact task title from the list) and "reason" (one sentence why this is a good pick right now).
- "stretch": if there are fewer than 3 picks, include ONE optional stretch suggestion — a task one size up from what the time/energy normally allows. Same shape: { "task", "reason" }. Omit this field if you already have 3 picks or there's nothing reasonable to stretch to.`

  const user = `Here are my open tasks:\n${openTasks}\n\nI have ${time} and my energy is "${energy}".${capacity ? ` I can do "${capacity}" type work right now.` : ''}\n\nWhat should I work on? Return JSON object only.`

  const text = await callClaude(system, user)
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    const parsed = JSON.parse(objMatch[0])
    if (parsed.picks) return parsed
  }
  // Fallback: old array format
  const arrMatch = text.match(/\[[\s\S]*\]/)
  if (arrMatch) return { picks: JSON.parse(arrMatch[0]) }
  throw new Error('Could not parse suggestions')
}

// --- Polish notes ---
export async function polishNotes(title, rawNotes) {
  const system = `You are a task assistant for someone with ADHD. You take messy, raw notes about a task and turn them into clear, actionable bullet points. Keep the person's voice — don't make it corporate. Be specific and concrete. If there are implicit next steps, surface them. Return JSON with two fields: "title" (a cleaned-up task title if the original is vague, or the same title if it's already good) and "notes" (the polished notes as a string with line breaks between bullets, each starting with "- ").`

  const user = `Task: "${title}"\n\nRaw notes:\n${rawNotes}\n\nPolish these into clear, actionable notes. Return JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse polished notes')
  return JSON.parse(match[0])
}

// --- Research ---
export async function researchTask(title, existingNotes, prompt, attachments = []) {
  const system = `You are a research assistant for someone with ADHD. Given a task and a research question, provide practical, actionable research notes. Be specific and concrete — links, steps, options, pros/cons. Format as bullet points starting with "- ". Keep it concise but thorough. Don't repeat what's already in the existing notes. If images or documents are attached, incorporate relevant details from them into your research. Return JSON only: {"notes": "the research notes as a string with line breaks between bullets"}`

  const context = existingNotes ? `\nExisting notes:\n${existingNotes}` : ''
  const textContent = `Task: "${title}"${context}\n\nResearch question: "${prompt}"\n\nProvide research notes. JSON only.`

  // Build content blocks — text + any image/document attachments
  const content = []

  for (const att of attachments) {
    if (att.type.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: att.type, data: att.data },
      })
    } else if (att.type === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: att.type, data: att.data },
      })
    }
  }

  content.push({ type: 'text', text: textContent })

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: withCustomInstructions(system),
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  const text = data.content[0].text
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse research results')
  return JSON.parse(match[0])
}

// --- Reframe ---
export async function reframeTask(taskTitle, snoozeCount, blocker) {
  const system = `You are a task coach for someone with ADHD. When a task keeps getting snoozed, help break it down or reframe it into actionable steps. Be practical and specific. Respond with JSON only — an array of 1-3 strings, each a new task title that replaces the original stuck task.`

  const user = `The task "${taskTitle}" has been snoozed ${snoozeCount} times.\n\nWhat's blocking them: "${blocker}"\n\nReframe this into 1-3 actionable tasks. Return JSON array of strings only.`

  const text = await callClaude(system, user)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('Could not parse reframed tasks')
  return JSON.parse(match[0])
}

// --- Toast messages ---
export async function generateToastMessages(taskTitle, context = {}) {
  const { energy, energyLevel } = context
  const energyNote = energy === 'confrontation' ? ' This is a dreaded confrontation task.' : energy === 'errand' ? ' This is an errand.' : ''
  const drainNote = energyLevel >= 3 ? ' High-drain task requiring serious willpower.' : ''

  const system = `You write short, punchy reactions for a task management app built for someone with ADHD. Be funny, irreverent, slightly sarcastic but always encouraging. Think "friend who roasts you lovingly." No emoji.

Return JSON with 4 scenarios, each having a "message" (headline, under 8 words, no ending period) and "subtitle" (color commentary, under 12 words, no ending period):

{
  "complete_quick": { "message": "...", "subtitle": "..." },
  "complete_normal": { "message": "...", "subtitle": "..." },
  "complete_long": { "message": "...", "subtitle": "..." },
  "reopen": { "message": "...", "subtitle": "..." }
}

- complete_quick: They knocked it out same-day. Be impressed or playfully suspicious.
- complete_normal: Completed after a few days. Casual encouragement.
- complete_long: Completed after 7+ days of procrastinating. Celebrate the victory over avoidance, roast the delay.
- reopen: They marked it done but it's back. Tease them.

Make each one specific to the task title — generic motivational fluff is boring.`

  const user = `Task: "${taskTitle}"${energyNote}${drainNote}\n\nGenerate all 4 toast message variants. JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Bad response')
  return JSON.parse(match[0])
}

// --- Notion ---
export async function notionSearch(query) {
  const res = await fetch('/api/notion/search', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ query, limit: 5 }),
  })
  if (!res.ok) throw new Error('Notion search failed')
  return res.json()
}

export async function notionCreatePage(title, content, parentPageId) {
  const res = await fetch('/api/notion/pages', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ title, content, parentPageId }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to create Notion page')
  }
  return res.json()
}

export async function notionUpdatePage(pageId, { title, content } = {}) {
  const res = await fetch(`/api/notion/pages/${pageId}`, {
    method: 'PATCH',
    headers: getApiHeaders(),
    body: JSON.stringify({ title, content }),
  })
  if (!res.ok) throw new Error('Failed to update Notion page')
  return res.json()
}

export async function notionUploadFile(pageId, filename, contentType, base64Data) {
  // Step 1: Create file upload
  const createRes = await fetch('/api/notion/file-uploads', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ filename, content_type: contentType }),
  })
  if (!createRes.ok) throw new Error('Failed to create Notion file upload')
  const upload = await createRes.json()

  // Step 2: Send the file
  const sendRes = await fetch(`/api/notion/file-uploads/${upload.id}/send`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ data: base64Data, filename, content_type: contentType }),
  })
  if (!sendRes.ok) throw new Error('Failed to send file to Notion')

  // Step 3: Append file block to the page
  const isImage = contentType.startsWith('image/')
  const blockType = isImage ? 'image' : 'file'
  const block = {
    object: 'block',
    type: blockType,
    [blockType]: {
      type: 'file_upload',
      file_upload: { id: upload.id },
    },
  }
  if (!isImage) {
    block[blockType].name = filename
  }

  const appendRes = await fetch(`/api/notion/blocks/${pageId}/children`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ children: [block] }),
  })
  if (!appendRes.ok) throw new Error('Failed to attach file to Notion page')
  return appendRes.json()
}

// Fetch all blocks (content) from a Notion page
export async function notionGetBlocks(pageId) {
  const res = await fetch(`/api/notion/blocks/${pageId}`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch page blocks')
  return res.json() // { blocks: [...], plainText: "..." }
}

// Get child pages under a parent page (for sync discovery)
export async function notionGetChildPages(parentId) {
  const res = await fetch(`/api/notion/children/${parentId}`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch child pages')
  return res.json() // { pages: [{ id, title, url, last_edited }] }
}

// AI analysis: read a Notion page's content and extract actionable tasks
// One page can produce multiple tasks (e.g., "furnace filter" → "buy filters" + "change filter")
export async function analyzeNotionPage(title, plainTextContent) {
  const system = `You analyze Notion pages and extract actionable tasks for someone with ADHD. Given a page title and content, identify concrete tasks that need to be done.

For each task, determine:
- title: clear, actionable task title (imperative mood)
- size: T-shirt size (XS/S/M/L/XL)
- energy: type of capacity needed (desk/people/errand/creative/physical)
- energyLevel: drain intensity (1=low, 2=medium, 3=high)
- due_date: ISO date (YYYY-MM-DD) if mentioned or inferable, null otherwise
- notes: brief context from the page content
- is_recurring: true if this seems like a recurring task (e.g., "change filter every 3 months")
- recurrence: if recurring, the cadence (daily/weekly/monthly/quarterly/annually)

One page might produce 0-5 tasks. If the page is purely informational with no actionable items, return an empty array.
Return JSON only: {"tasks": [...]}`

  const user = `Notion page: "${title}"\n\nContent:\n${plainTextContent.slice(0, 4000)}\n\nExtract actionable tasks. JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { tasks: [] }
    return JSON.parse(match[0])
  } catch {
    return { tasks: [] }
  }
}

// AI dedup: match Notion pages to existing Boomerang tasks to avoid duplicates
export async function aiDedupNotionPages(pages, tasks) {
  const userPrompt = `Match these Notion pages to existing tasks if they refer to the same thing (even if worded differently).

Notion pages (unlinked):
${JSON.stringify(pages.map(p => ({ id: p.id, title: p.title })))}

Existing tasks (unlinked):
${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, notes: (t.notes || '').slice(0, 100) })))}

Return ONLY JSON: {"matches":[{"page_id":"...","task_id":"..." or null,"confidence":0.0-1.0}]}
- confidence >= 0.85 means auto-link
- null task_id means create new task(s)
JSON only.`
  const result = await callClaude('You match Notion pages to existing tasks. Only match when clearly the same work item. Return only valid JSON.', userPrompt)
  return extractJSON(result)
}

export async function notionStatus() {
  try {
    const res = await fetch('/api/notion/status', { headers: getApiHeaders() })
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function getKeyStatus() {
  try {
    const res = await fetch('/api/keys/status')
    if (!res.ok) return { anthropic: false, notion: false, trello: false, tracking: false }
    const data = await res.json()
    return {
      anthropic: !!data.anthropic,
      notion: !!data.notion,
      trello: !!data.trello,
      gcal: !!data.gcal,
      tracking: !!data.tracking,
    }
  } catch {
    return { anthropic: false, notion: false, trello: false, tracking: false }
  }
}

// --- AI-powered Notion suggestion ---
export async function suggestNotionLink(taskTitle, taskNotes) {
  // Search Notion for related pages
  const searchResults = await notionSearch(taskTitle)
  const pages = searchResults.pages || []

  if (pages.length === 0) {
    return { action: 'create', pages: [], reason: 'No related pages found in Notion.' }
  }

  // Ask Claude to evaluate matches
  const pageList = pages.map(p => `- "${p.title}" (${p.id})`).join('\n')
  const system = `You help link tasks to Notion pages. Given a task and a list of Notion pages, determine if any page is a good match. Return JSON: {"action": "link" or "create", "page_id": "id if linking, null if creating", "reason": "one sentence"}`
  const user = `Task: "${taskTitle}"${taskNotes ? `\nNotes: ${taskNotes}` : ''}\n\nNotion pages found:\n${pageList}\n\nShould we link to an existing page or create a new one? JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { action: 'create', pages, reason: 'Could not determine match.' }

  const result = JSON.parse(match[0])
  return { ...result, pages }
}

// --- AI-generated Notion page content ---
export async function generateNotionContent(taskTitle, taskNotes, isRecurring = false, metadata = {}) {
  const settings = loadSettings()
  let template = settings.notion_page_template || ''
  const recurring = isRecurring ? '\nThis is a recurring task — include a reusable checklist in the Action Items section.' : ''

  // Pre-fill metadata placeholders with actual values
  const now = new Date().toLocaleDateString()
  template = template
    .replace(/\{last_updated\}/g, metadata.lastUpdated || now)
    .replace(/\{frequency\}/g, metadata.frequency || 'One-time')
    .replace(/\{last_performed\}/g, metadata.lastPerformed || 'N/A')
    .replace(/- \{tags\}/g, metadata.tags?.length ? metadata.tags.map(t => `- ${t}`).join('\n') : '- None')

  // Build task details from metadata
  const details = []
  if (metadata.dueDate) details.push(`Due Date: ${metadata.dueDate}`)
  if (metadata.size) details.push(`Size: ${metadata.size}`)
  if (metadata.energy) details.push(`Energy Type: ${metadata.energy}`)
  if (metadata.energyLevel) details.push(`Energy Level: ${'⚡'.repeat(metadata.energyLevel)}`)
  if (metadata.priority) details.push(`Priority: ${metadata.priority}`)
  if (metadata.status) details.push(`Status: ${metadata.status}`)
  const detailsStr = details.length ? `\nTask details: ${details.join(', ')}` : ''

  const system = `You create structured Notion page content for tasks. You MUST follow the template structure below, filling each section with relevant content for the given task. Preserve all markdown formatting exactly: ## for headings, - [ ] for to-do items, > for callouts, --- for dividers, - for bullet points. Do not add or remove sections — only populate the existing ones. Lines that already have concrete values (dates, tags, frequency) must be kept exactly as-is. For the Tags section, keep all existing tags and you may add a few more if clearly relevant. Include any checklists and attachment references from the notes as-is — do not summarize or remove them.${recurring}

Template:
${template}`
  const user = `Create Notion page content for:\nTask: "${taskTitle}"${detailsStr}${taskNotes ? `\nNotes: ${taskNotes}` : ''}`

  return callClaude(system, user)
}

// --- Trello ---
export async function trelloStatus() {
  try {
    const res = await fetch('/api/trello/status', { headers: getApiHeaders() })
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function trelloBoards() {
  const res = await fetch('/api/trello/boards', { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch boards')
  return res.json()
}

export async function trelloBoardLists(boardId) {
  const res = await fetch(`/api/trello/boards/${boardId}/lists`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch lists')
  return res.json()
}

export async function trelloCreateCard(name, desc, idList) {
  const res = await fetch('/api/trello/cards', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ name, desc, idList }),
  })
  if (!res.ok) throw new Error('Failed to create card')
  return res.json()
}

export async function trelloUpdateCard(cardId, updates) {
  const res = await fetch(`/api/trello/cards/${cardId}`, {
    method: 'PATCH',
    headers: getApiHeaders(),
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update card')
  return res.json()
}

export async function trelloCreateChecklist(cardId, name) {
  const res = await fetch(`/api/trello/cards/${cardId}/checklists`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create checklist')
  return res.json()
}

export async function trelloAddCheckItem(checklistId, name, checked) {
  const res = await fetch(`/api/trello/checklists/${checklistId}/checkItems`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ name, checked }),
  })
  if (!res.ok) throw new Error('Failed to add check item')
  return res.json()
}

export async function trelloGetChecklists(cardId) {
  const res = await fetch(`/api/trello/cards/${cardId}/checklists`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch checklists')
  return res.json()
}

export async function trelloUpdateCheckItem(cardId, checkItemId, updates) {
  const res = await fetch(`/api/trello/cards/${cardId}/checkItem/${checkItemId}`, {
    method: 'PUT',
    headers: getApiHeaders(),
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update check item')
  return res.json()
}

export async function trelloDeleteChecklist(checklistId) {
  const res = await fetch(`/api/trello/checklists/${checklistId}`, {
    method: 'DELETE',
    headers: getApiHeaders(),
  })
  if (!res.ok) throw new Error('Failed to delete checklist')
  return res.json()
}

export async function trelloUploadAttachment(cardId, name, mimeType, data) {
  const res = await fetch(`/api/trello/cards/${cardId}/attachments`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ name, mimeType, data }),
  })
  if (!res.ok) throw new Error('Failed to upload attachment')
  return res.json()
}

export async function trelloSyncCards(idList) {
  const res = await fetch('/api/trello/sync', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ idList }),
  })
  if (!res.ok) throw new Error('Failed to sync cards')
  return res.json()
}

export async function trelloSyncAllLists(listIds) {
  const res = await fetch('/api/trello/sync-all-lists', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ listIds }),
  })
  if (!res.ok) throw new Error('Failed to sync lists')
  return res.json()
}

function extractJSON(text) {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return JSON.parse(fenced[1].trim())
  // Try parsing directly
  return JSON.parse(text.trim())
}

export async function inferTrelloListMapping(lists) {
  const userPrompt = `Here are the Trello lists for a board:\n${JSON.stringify(lists.map(l => ({ id: l.id, name: l.name })))}\n\nMap each list to one of these task statuses based on the list name:\n- not_started (for "to do", "backlog", "new", "todo" type lists)\n- doing (for "in progress", "working", "active" type lists)\n- waiting (for "on hold", "blocked", "waiting", "review" type lists)\n- done (for "done", "complete", "finished", "archived" type lists)\n\nReturn ONLY a JSON object like: {"not_started":"listId","doing":"listId","waiting":"listId","done":"listId"}\nOmit any status that has no matching list. JSON only, no explanation.`
  const result = await callClaude('You map Trello list names to task statuses. Return only valid JSON, nothing else.', userPrompt)
  return extractJSON(result)
}

export async function aiDedupTrelloCards(cards, tasks) {
  const userPrompt = `Match these Trello cards to existing tasks if they refer to the same thing (even if worded differently).\n\nTrello cards (unlinked):\n${JSON.stringify(cards.map(c => ({ id: c.id, name: c.name, desc: (c.desc || '').slice(0, 100) })))}\n\nExisting tasks (unlinked):\n${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, notes: (t.notes || '').slice(0, 100) })))}\n\nReturn ONLY JSON: {"matches":[{"card_id":"...","task_id":"..." or null,"confidence":0.0-1.0}]}\n- confidence >= 0.85 means auto-link\n- null task_id means create a new task\nJSON only.`
  const result = await callClaude('You match Trello cards to existing tasks. Only match when clearly the same work item. Return only valid JSON.', userPrompt)
  return extractJSON(result)
}

// ============================================================
// Google Calendar
// ============================================================

export async function gcalGetAuthUrl() {
  const res = await fetch('/api/gcal/auth-url', { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to get auth URL')
  return res.json()
}

export async function gcalStatus() {
  try {
    const res = await fetch('/api/gcal/status', { headers: getApiHeaders() })
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function gcalDisconnect() {
  const res = await fetch('/api/gcal/disconnect', { method: 'POST', headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to disconnect')
  return res.json()
}

export async function gcalListCalendars() {
  const res = await fetch('/api/gcal/calendars', { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch calendars')
  return res.json()
}

export async function gcalCreateEvent(calendarId, event) {
  const res = await fetch('/api/gcal/events', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ calendarId, event }),
  })
  if (!res.ok) throw new Error('Failed to create event')
  return res.json()
}

export async function gcalUpdateEvent(eventId, calendarId, event) {
  const res = await fetch(`/api/gcal/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: getApiHeaders(),
    body: JSON.stringify({ calendarId, event }),
  })
  if (!res.ok) throw new Error('Failed to update event')
  return res.json()
}

export async function gcalDeleteEvent(eventId, calendarId) {
  const params = calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : ''
  const res = await fetch(`/api/gcal/events/${encodeURIComponent(eventId)}${params}`, {
    method: 'DELETE',
    headers: getApiHeaders(),
  })
  if (!res.ok) throw new Error('Failed to delete event')
  return res.json()
}

export async function gcalBulkDeleteEvents(calendarId) {
  const res = await fetch('/api/gcal/events/bulk-delete', {
    method: 'POST',
    headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendarId }),
  })
  if (!res.ok) throw new Error('Failed to bulk delete events')
  return res.json()
}

export async function gcalListEvents(timeMin, timeMax, calendarId) {
  const params = new URLSearchParams()
  if (timeMin) params.set('timeMin', timeMin)
  if (timeMax) params.set('timeMax', timeMax)
  if (calendarId) params.set('calendarId', calendarId)
  const res = await fetch(`/api/gcal/events?${params}`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

const SIZE_TO_MINUTES = { XS: 15, S: 30, M: 60, L: 120, XL: 240 }

export async function inferEventTime(title, notes, size, energy) {
  const today = new Date().toISOString().split('T')[0]
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const system = `You suggest a time of day and duration for calendar events based on task context. Today is ${today} (${dayOfWeek}).

Guidelines:
- desk/creative tasks → morning (09:00-11:00)
- errands → midday (11:00-14:00)
- people/confrontation → afternoon (13:00-16:00)
- physical → flexible, often morning or evening
- Size baseline: XS=15min, S=30min, M=60min, L=120min, XL=240min (adjust based on context)

Return JSON only: {"time": "HH:MM", "duration": minutes_number}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}${size ? `\nSize: ${size}` : ''}${energy ? `\nEnergy type: ${energy}` : ''}\n\nSuggest a time and duration. JSON only.`

  try {
    const result = await callClaude(system, user)
    return extractJSON(result)
  } catch {
    return {
      time: loadSettings().gcal_default_time || '09:00',
      duration: SIZE_TO_MINUTES[size] || loadSettings().gcal_event_duration || 60,
    }
  }
}

export async function aiDedupGCalEvents(events, tasks) {
  const userPrompt = `Match these Google Calendar events to existing tasks if they refer to the same thing (even if worded differently).\n\nCalendar events (unlinked):\n${JSON.stringify(events.map(e => ({ id: e.id, summary: e.summary, description: (e.description || '').slice(0, 100) })))}\n\nExisting tasks (unlinked):\n${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, notes: (t.notes || '').slice(0, 100) })))}\n\nReturn ONLY JSON: {"matches":[{"event_id":"...","task_id":"..." or null,"confidence":0.0-1.0}]}\n- confidence >= 0.85 means auto-link\n- null task_id means create a new task\nJSON only.`
  const result = await callClaude('You match Google Calendar events to existing tasks. Only match when clearly the same work item. Return only valid JSON.', userPrompt)
  return extractJSON(result)
}

// ============================================================
// Per-record Task & Routine API
// ============================================================

export async function serverCreateTask(task, clientId) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...task, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`create task failed: ${res.status}`)
  return res.json()
}

export async function serverUpdateTask(id, updates, clientId) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`update task failed: ${res.status}`)
  return res.json()
}

export async function serverDeleteTask(id) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete task failed: ${res.status}`)
  return res.json()
}

export async function serverFetchTasks(filters = {}) {
  const params = new URLSearchParams(filters)
  const res = await fetch(`/api/tasks?${params}`)
  if (!res.ok) throw new Error(`fetch tasks failed: ${res.status}`)
  return res.json()
}

export async function serverCreateRoutine(routine, clientId) {
  const res = await fetch('/api/routines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...routine, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`create routine failed: ${res.status}`)
  return res.json()
}

export async function serverUpdateRoutine(id, updates, clientId) {
  const res = await fetch(`/api/routines/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`update routine failed: ${res.status}`)
  return res.json()
}

export async function serverDeleteRoutine(id) {
  const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete routine failed: ${res.status}`)
  return res.json()
}

// --- Package Tracking ---

export async function fetchPackages(status) {
  const params = status ? `?status=${status}` : ''
  const res = await fetch(`/api/packages${params}`)
  if (!res.ok) throw new Error(`fetch packages failed: ${res.status}`)
  return res.json()
}

export async function fetchPackage(id) {
  const res = await fetch(`/api/packages/${id}`)
  if (!res.ok) throw new Error(`fetch package failed: ${res.status}`)
  return res.json()
}

export async function createPackage(trackingNumber, label, carrier) {
  const headers = getApiHeaders()
  const res = await fetch('/api/packages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tracking_number: trackingNumber, label, carrier }),
  })
  if (!res.ok) throw new Error(`create package failed: ${res.status}`)
  return res.json()
}

export async function updatePackage(id, updates) {
  const res = await fetch(`/api/packages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`update package failed: ${res.status}`)
  return res.json()
}

export async function deletePackageApi(id) {
  const res = await fetch(`/api/packages/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete package failed: ${res.status}`)
  return res.json()
}

export async function refreshPackage(id) {
  const headers = getApiHeaders()
  const res = await fetch(`/api/packages/${id}/refresh`, {
    method: 'POST',
    headers,
  })
  if (!res.ok) throw new Error(`refresh package failed: ${res.status}`)
  return res.json()
}

export async function testTrackingConnection() {
  const headers = getApiHeaders()
  const res = await fetch('/api/packages/test-connection', { method: 'POST', headers })
  if (!res.ok) throw new Error(`test connection failed: ${res.status}`)
  return res.json()
}

export async function refreshAllPackages() {
  const headers = getApiHeaders()
  const res = await fetch('/api/packages/refresh-all', { method: 'POST', headers })
  if (!res.ok) throw new Error(`refresh all failed: ${res.status}`)
  return res.json()
}

export async function getPackageApiStatus() {
  const headers = getApiHeaders()
  const res = await fetch('/api/packages/api-status', { headers })
  if (!res.ok) throw new Error(`package api status failed: ${res.status}`)
  return res.json()
}
