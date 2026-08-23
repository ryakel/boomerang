import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask, safeSetItem } from '../store'
import { fetchTombstones, knowledgeListStrict, notionPageLedger, notionMarkPagesAnalyzed } from '../api'
import { notionGetChildPages, notionQueryDatabase, notionGetBlocks, analyzeNotionPage, aiDedupNotionPages } from '../api'
import { deduplicateImports, remoteLog } from '../syncDedup'
import { partitionPagesForAnalysis, summarizeSkips } from '../notionMining'

// Marks that this install has drawn its baseline (see baselineLedger below).
// Local on purpose — it only guards the one-time upgrade pass, and the thing
// it writes (the analyzed set) is server-side and durable.
const NOTION_LEDGER_BASELINE_KEY = 'boom_notion_ledger_baselined'

// Page ids that are knowledge-base items. Backfill only: `create_knowledge`
// now stamps its pages as Boomerang-authored, so this set exists to cover
// knowledge pages created before that stamp shipped. It is NOT the primary
// guard, and deliberately so — keying protection off knowledge_index
// membership would only ever protect formal knowledge-database rows, which
// quietly demands that every piece of reference material be filed as one.
// Reference that is too big for a single row and needs a whole page has to be
// just as safe, and provenance is what makes it so.
//
// Strict: an unreachable index must not read as an empty exclusion set.
async function knowledgePageIds() {
  const items = await knowledgeListStrict({ limit: 500 })
  return new Set(items.map(k => k.notion_page_id).filter(Boolean))
}

// Track dismissed routine suggestions to avoid re-suggesting
const DISMISSED_PATTERNS_KEY = 'boom_notion_dismissed_patterns'

function loadDismissedPatterns() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_PATTERNS_KEY) || '[]') }
  catch { return [] }
}

function saveDismissedPattern(patternKey) {
  const dismissed = loadDismissedPatterns()
  if (!dismissed.includes(patternKey)) {
    dismissed.push(patternKey)
    safeSetItem(DISMISSED_PATTERNS_KEY, JSON.stringify(dismissed))
  }
}

export function useNotionSync(tasks, setTasks) {
  const syncingRef = useRef(false)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(() => loadSettings().notion_last_sync || null)
  const [syncError, setSyncError] = useState(null)
  const [routineSuggestions, setRoutineSuggestions] = useState([])

  const isNotionSyncConfigured = useCallback(() => {
    const s = loadSettings()
    return !!(s.notion_sync_parent_id || s.notion_db_id)
  }, [])

  // Pull from Notion Database → Boomerang
  // Database rows are pages — we create tasks from their titles directly
  const pullFromDatabase = useCallback(async () => {
    const s = loadSettings()
    if (!s.notion_db_id) return

    remoteLog('[NotionSync] starting database pull from:', s.notion_db_id)

    // Query all pages from the database (paginated)
    let allPages = []
    let cursor = null
    do {
      const result = await notionQueryDatabase(s.notion_db_id, cursor)
      allPages = allPages.concat(result.pages || [])
      cursor = result.has_more ? result.next_cursor : null
      if (cursor) await new Promise(r => setTimeout(r, 400)) // rate limit
    } while (cursor)

    remoteLog(`[NotionSync] found ${allPages.length} database rows`)

    const currentTasks = tasksRef.current
    const linkedPageIds = new Set(currentTasks.filter(t => t.notion_page_id).map(t => t.notion_page_id))

    // Filter to unlinked rows
    const unlinkedPages = allPages.filter(p => !linkedPageIds.has(p.id))
    remoteLog(`[NotionSync] ${linkedPageIds.size} already linked, ${unlinkedPages.length} unlinked`)

    if (unlinkedPages.length === 0) {
      remoteLog('[NotionSync] no new database rows to import')
      return
    }

    // Dedup: exact title match, then AI
    const unlinkedTasks = currentTasks.filter(t => !t.notion_page_id && t.status !== 'done')
    const matchMap = await deduplicateImports({
      items: unlinkedPages,
      localTasks: unlinkedTasks,
      getTitle: p => p.title,
      getId: p => p.id,
      aiDedupFn: aiDedupNotionPages,
      itemIdField: 'page_id',
      logPrefix: '[NotionDbSync]',
    })

    // Link matched rows to existing tasks
    const linkUpdates = []
    for (const [pageId, taskId] of matchMap) {
      const page = allPages.find(p => p.id === pageId)
      linkUpdates.push({ taskId, pageId, url: page?.url })
    }

    if (linkUpdates.length > 0) {
      setTasks(prev => prev.map(t => {
        const link = linkUpdates.find(l => l.taskId === t.id)
        if (!link) return t
        return { ...t, notion_page_id: link.pageId, notion_url: link.url }
      }))
      remoteLog(`[NotionDbSync] linked ${linkUpdates.length} existing tasks`)
    }

    // Create tasks for truly new rows (using title directly, no AI analysis needed)
    // Rows the user deleted on purpose. This pull has no last_edited guard, so
    // without the tombstone check a deleted task is re-created on EVERY sync —
    // the "why do these keep coming back" bug.
    const buried = new Set((await fetchTombstones('notion').catch(() => [])).map(t => t.remote_id))
    const newPages = unlinkedPages.filter(p => !matchMap.has(p.id) && !buried.has(p.id))
    remoteLog(`[NotionDbSync] ${newPages.length} new rows to import (${buried.size} tombstoned)`)

    const newTasks = []
    for (const page of newPages) {
      if (!page.title || !page.title.trim()) continue
      const task = createTask(page.title, [], null, '')
      task.notion_page_id = page.id
      task.notion_url = page.url
      newTasks.push(task)
    }

    if (newTasks.length > 0) {
      setTasks(prev => [...newTasks, ...prev])
      remoteLog(`[NotionDbSync] created ${newTasks.length} new tasks from database rows`)
    }
  }, [setTasks])

  // Pull: Notion → Boomerang (page-based)
  // Flow: get child pages → match to existing tasks → analyze new/changed pages → create tasks
  const pullFromNotion = useCallback(async () => {
    const s = loadSettings()
    if (!s.notion_sync_parent_id) return

    remoteLog('[NotionSync] starting pull from parent:', s.notion_sync_parent_id)

    // 1. Get child pages of configured parent
    const { pages } = await notionGetChildPages(s.notion_sync_parent_id)
    remoteLog(`[NotionSync] found ${pages.length} child pages`)

    const currentTasks = tasksRef.current
    const linkedPageIds = new Set(currentTasks.filter(t => t.notion_page_id).map(t => t.notion_page_id))
    const buriedPages = new Set((await fetchTombstones('notion').catch(() => [])).map(t => t.remote_id))

    // 2. Separate linked vs unlinked pages
    const unlinkedPages = pages.filter(p => !linkedPageIds.has(p.id))
    remoteLog(`[NotionSync] ${linkedPageIds.size} already linked, ${unlinkedPages.length} unlinked`)

    if (unlinkedPages.length === 0) {
      remoteLog('[NotionSync] no new pages to import')
      return
    }

    // 3. Dedup: exact title match, then AI (shared logic)
    const unlinkedTasks = currentTasks.filter(t => !t.notion_page_id && t.status !== 'done')
    const matchMap = await deduplicateImports({
      items: unlinkedPages,
      localTasks: unlinkedTasks,
      getTitle: p => p.title,
      getId: p => p.id,
      aiDedupFn: aiDedupNotionPages,
      itemIdField: 'page_id',
      logPrefix: '[NotionSync]',
    })

    // 4. Link matched pages to existing tasks
    const linkUpdates = []
    for (const [pageId, taskId] of matchMap) {
      const page = pages.find(p => p.id === pageId)
      linkUpdates.push({ taskId, pageId, url: page?.url })
    }

    if (linkUpdates.length > 0) {
      setTasks(prev => prev.map(t => {
        const link = linkUpdates.find(l => l.taskId === t.id)
        if (!link) return t
        return { ...t, notion_page_id: link.pageId, notion_url: link.url }
      }))
      remoteLog(`[NotionSync] linked ${linkUpdates.length} existing tasks to Notion pages`)
    }

    // 5. Analyze pages the extractor is allowed to read.
    const newPages = unlinkedPages.filter(p => !matchMap.has(p.id))

    // Both exclusion sets are STRICT: an unreachable ledger or index must not
    // read as "nothing is protected". A guard that silently switches itself
    // off is worse than no guard, because it looks like it is working.
    let ledger, knowledgeIds
    try {
      ;[ledger, knowledgeIds] = await Promise.all([notionPageLedger(), knowledgePageIds()])
    } catch (err) {
      remoteLog('[NotionSync] page ledger unavailable, skipping analysis entirely:', err.message)
      return
    }
    const authored = new Set(ledger.authored)
    const analyzed = new Set(ledger.analyzed)

    // One-time baseline. Shipping an empty ledger would make every page that
    // already exists look brand new, and the first sync after the upgrade
    // would mine the entire sync parent — the exact flood this is here to
    // stop. So the first run records what is already there as "seen" without
    // reading a word of it. Pages created after this point still import.
    if (analyzed.size === 0 && !localStorage.getItem(NOTION_LEDGER_BASELINE_KEY)) {
      const ids = pages.map(p => p.id)
      const titles = Object.fromEntries(pages.map(p => [p.id, p.title || '']))
      try {
        await notionMarkPagesAnalyzed(ids, titles)
        safeSetItem(NOTION_LEDGER_BASELINE_KEY, new Date().toISOString())
        remoteLog(`[NotionSync] baselined ${ids.length} existing page(s) as already-seen; analyzing none this pass`)
      } catch (err) {
        remoteLog('[NotionSync] baseline failed, skipping analysis:', err.message)
      }
      return
    }

    const { analyze, skipped } = partitionPagesForAnalysis(newPages, {
      authored, analyzed, knowledge: knowledgeIds, buried: buriedPages,
    })
    remoteLog(`[NotionSync] ${analyze.length} page(s) to analyze; skipped ${skipped.length}`, JSON.stringify(summarizeSkips(skipped)))

    const newTasks = []
    const newRoutineSuggestions = []
    // Recorded whether or not extraction succeeds: a page gets ONE look. If it
    // errored, retrying it on every app-open is a request loop, not a repair.
    const consideredIds = []
    const consideredTitles = {}

    for (const page of analyze) {
      consideredIds.push(page.id)
      consideredTitles[page.id] = page.title || ''
      try {
        // Rate limit: small delay between Notion API calls (3 req/sec limit)
        await new Promise(r => setTimeout(r, 400))

        const { plainText } = await notionGetBlocks(page.id)
        if (!plainText || plainText.trim().length === 0) {
          remoteLog(`[NotionSync] empty page, skipping: "${page.title}"`)
          continue
        }

        const analysis = await analyzeNotionPage(page.title, plainText)
        remoteLog(`[NotionSync] analyzed "${page.title}": ${analysis.tasks.length} task(s) proposed`)

        for (const taskData of analysis.tasks) {
          // If AI detected a recurring pattern, suggest a routine instead
          if (taskData.is_recurring && taskData.recurrence) {
            const dismissed = loadDismissedPatterns()
            const patternKey = `${taskData.title}:${taskData.recurrence}`
            if (!dismissed.includes(patternKey)) {
              newRoutineSuggestions.push({
                title: taskData.title,
                cadence: taskData.recurrence,
                notes: taskData.notes || '',
                notionPageId: page.id,
                notionUrl: page.url,
                patternKey,
              })
              remoteLog(`[NotionSync] routine suggestion: "${taskData.title}" (${taskData.recurrence})`)
            }
            continue
          }

          const task = createTask(
            taskData.title,
            [],
            taskData.due_date || null,
            taskData.notes || ''
          )
          task.notion_page_id = page.id
          task.notion_url = page.url
          // What comes out of the extractor is a GUESS about a page someone
          // wrote in prose, so it lands in Review (Keep / Dismiss) rather than
          // in Today — out of Today/Anytime, the digest, notifications, What
          // Now and the auto-sizer until the user says Keep. Pages Boomerang
          // itself wrote never reach this loop at all; they are excluded above
          // by provenance, and produce no tasks and no proposals.
          task.gmail_pending = true
          if (taskData.size) task.size = taskData.size
          if (taskData.energy) task.energy = taskData.energy
          if (taskData.energyLevel) task.energyLevel = taskData.energyLevel
          newTasks.push(task)
        }
      } catch (err) {
        remoteLog(`[NotionSync] failed to analyze "${page.title}":`, err.message)
      }
    }

    if (consideredIds.length > 0) {
      // Record BEFORE surfacing the proposals. If this write fails the pages
      // stay unrecorded and get re-analyzed later, which is the safe direction
      // only because the tasks below are proposals rather than live rows.
      try { await notionMarkPagesAnalyzed(consideredIds, consideredTitles) }
      catch (err) { remoteLog('[NotionSync] could not record analyzed pages:', err.message) }
    }

    if (newRoutineSuggestions.length > 0) {
      setRoutineSuggestions(prev => [...prev, ...newRoutineSuggestions])
    }

    if (newTasks.length > 0) {
      setTasks(prev => [...newTasks, ...prev])
      remoteLog(`[NotionSync] ${newTasks.length} task(s) proposed from Notion pages (pending review)`)
    }
  }, [setTasks])

  // Main sync orchestrator
  const syncNotion = useCallback(async () => {
    if (syncingRef.current) return
    if (!isNotionSyncConfigured()) return

    syncingRef.current = true
    setSyncing(true)
    setSyncError(null)

    try {
      const s = loadSettings()
      if (s.notion_sync_parent_id) await pullFromNotion()
      if (s.notion_db_id) await pullFromDatabase()
      const now = new Date().toISOString()
      setLastSync(now)
      saveSettings({ ...s, notion_last_sync: now })
      remoteLog('[NotionSync] sync complete')
    } catch (err) {
      remoteLog('[NotionSync] sync error:', err.message)
      setSyncError(err.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [isNotionSyncConfigured, pullFromNotion, pullFromDatabase])

  // Sync on mount and when returning to the app (visibility change)
  useEffect(() => {
    if (!isNotionSyncConfigured()) return

    // Sync on mount
    syncNotion()

    // Sync when app becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncNotion()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isNotionSyncConfigured, syncNotion])

  const dismissSuggestion = useCallback((patternKey) => {
    saveDismissedPattern(patternKey)
    setRoutineSuggestions(prev => prev.filter(s => s.patternKey !== patternKey))
  }, [])

  const acceptSuggestion = useCallback((patternKey) => {
    setRoutineSuggestions(prev => prev.filter(s => s.patternKey !== patternKey))
  }, [])

  return { syncing, lastSync, syncError, syncNotion, isNotionSyncConfigured, routineSuggestions, dismissSuggestion, acceptSuggestion }
}
