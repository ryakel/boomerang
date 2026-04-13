import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask } from '../store'
import { notionGetChildPages, notionQueryDatabase, notionGetBlocks, analyzeNotionPage, aiDedupNotionPages } from '../api'
import { deduplicateImports, remoteLog } from '../syncDedup'

// Track last_edited_time per page to avoid re-analyzing unchanged pages
const NOTION_PAGE_CACHE_KEY = 'boom_notion_page_cache'

function loadPageCache() {
  try { return JSON.parse(localStorage.getItem(NOTION_PAGE_CACHE_KEY) || '{}') }
  catch { return {} }
}

function savePageCache(cache) {
  localStorage.setItem(NOTION_PAGE_CACHE_KEY, JSON.stringify(cache))
}

export function useNotionSync(tasks, setTasks) {
  const syncingRef = useRef(false)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(() => loadSettings().notion_last_sync || null)
  const [syncError, setSyncError] = useState(null)

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
    const newPages = unlinkedPages.filter(p => !matchMap.has(p.id))
    remoteLog(`[NotionDbSync] ${newPages.length} new rows to import`)

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
    const pageCache = loadPageCache()

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

    // 5. Analyze truly new pages — fetch content and create tasks
    const newPages = unlinkedPages.filter(p => !matchMap.has(p.id))
    remoteLog(`[NotionSync] ${newPages.length} new pages to analyze`)

    const newTasks = []
    for (const page of newPages) {
      // Skip if page hasn't changed since last analysis
      if (pageCache[page.id] && pageCache[page.id] === page.last_edited) {
        remoteLog(`[NotionSync] skipping unchanged page: "${page.title}"`)
        continue
      }

      try {
        // Rate limit: small delay between Notion API calls (3 req/sec limit)
        await new Promise(r => setTimeout(r, 400))

        const { plainText } = await notionGetBlocks(page.id)
        if (!plainText || plainText.trim().length === 0) {
          remoteLog(`[NotionSync] empty page, skipping: "${page.title}"`)
          pageCache[page.id] = page.last_edited
          continue
        }

        const analysis = await analyzeNotionPage(page.title, plainText)
        remoteLog(`[NotionSync] analyzed "${page.title}": ${analysis.tasks.length} tasks found`)

        for (const taskData of analysis.tasks) {
          const task = createTask(
            taskData.title,
            [],
            taskData.due_date || null,
            taskData.notes || ''
          )
          task.notion_page_id = page.id
          task.notion_url = page.url
          if (taskData.size) task.size = taskData.size
          if (taskData.energy) task.energy = taskData.energy
          if (taskData.energyLevel) task.energyLevel = taskData.energyLevel
          newTasks.push(task)
        }

        // Update cache so we don't re-analyze this page next sync
        pageCache[page.id] = page.last_edited
      } catch (err) {
        remoteLog(`[NotionSync] failed to analyze "${page.title}":`, err.message)
      }
    }

    savePageCache(pageCache)

    if (newTasks.length > 0) {
      setTasks(prev => [...newTasks, ...prev])
      remoteLog(`[NotionSync] created ${newTasks.length} new tasks from Notion pages`)
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

  return { syncing, lastSync, syncError, syncNotion, isNotionSyncConfigured }
}
