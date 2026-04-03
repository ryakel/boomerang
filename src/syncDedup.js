// Shared dedup logic for Notion and Trello sync.
// Two-pass matching: exact title match, then AI-based fuzzy match.

function remoteLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  console.log(line)
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [line] }),
  }).catch(() => {})
}

// Deduplicate external items against local tasks.
//
// Params:
//   items       — array of external items (Notion pages or Trello cards)
//   localTasks  — array of local Boomerang tasks (already filtered to unlinked + not done)
//   getTitle    — fn(item) → string title of external item
//   getId       — fn(item) → string ID of external item
//   aiDedupFn   — async fn(unmatchedItems, localTasks) → { matches: [{ item_id, task_id, confidence }] }
//                 The item_id field name varies by integration (page_id, card_id) — use itemIdField
//   itemIdField — string key name for item ID in AI result (e.g., 'page_id' or 'card_id')
//   logPrefix   — string prefix for log messages (e.g., '[NotionSync]' or '[TrelloSync]')
//
// Returns: Map<externalId, taskId> of matched items
export async function deduplicateImports({
  items,
  localTasks,
  getTitle,
  getId,
  aiDedupFn = null,
  itemIdField = 'page_id',
  logPrefix = '[Sync]',
}) {
  const matchMap = new Map()

  // Pass 1: exact title match (case-insensitive)
  const titleIndex = new Map()
  for (const t of localTasks) {
    const key = t.title.toLowerCase().trim()
    if (!titleIndex.has(key)) titleIndex.set(key, t.id)
  }

  const unmatched = []
  for (const item of items) {
    const title = getTitle(item).toLowerCase().trim()
    const matchedTaskId = titleIndex.get(title)
    if (matchedTaskId) {
      matchMap.set(getId(item), matchedTaskId)
      titleIndex.delete(title) // prevent double-match
      remoteLog(`${logPrefix} exact match: "${getTitle(item)}" → task ${matchedTaskId.slice(0, 8)}`)
    } else {
      unmatched.push(item)
    }
  }

  // Pass 2: AI dedup for remaining unmatched
  if (unmatched.length > 0 && localTasks.length > 0 && aiDedupFn) {
    try {
      const aiResult = await aiDedupFn(unmatched, localTasks)
      for (const m of (aiResult.matches || [])) {
        const itemId = m[itemIdField]
        if (m.task_id && m.confidence >= 0.85 && itemId && !matchMap.has(itemId)) {
          matchMap.set(itemId, m.task_id)
          remoteLog(`${logPrefix} AI match: ${itemId.slice(0, 8)} → task ${m.task_id.slice(0, 8)} (${m.confidence})`)
        }
      }
    } catch (err) {
      remoteLog(`${logPrefix} AI dedup failed:`, err.message)
    }
  }

  return matchMap
}

export { remoteLog }
