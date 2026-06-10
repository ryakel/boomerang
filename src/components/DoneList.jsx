import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { CheckCircle2, Search, Sparkles, X } from 'lucide-react'
import { aiSearchDone } from '../api'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import SectionLabel from './SectionLabel'
import './DoneList.css'

const PAGE_SIZE = 50

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function daysOnList(task) {
  if (!task.completed_at || !task.created_at) return 0
  return Math.max(0, Math.floor(
    (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) / 86400000
  ))
}

export default function DoneList({ open, onClose, onUncomplete, title = 'Done' }) {
  const [doneTasks, setDoneTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isAI, setIsAI] = useState(false)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  const fetchPage = useCallback((pageOffset) => {
    return fetch(`/api/tasks?status=done&sort=completed_at&limit=${PAGE_SIZE}&offset=${pageOffset}`)
      .then(res => res.ok ? res.json() : [])
      .then(tasks => {
        if (tasks.length < PAGE_SIZE) setHasMore(false)
        return tasks
      })
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setHasMore(true)
    setOffset(0)
    setSearchQuery('')
    setSearchResults(null)
    setIsAI(false)
    fetchPage(0).then(tasks => {
      setDoneTasks(tasks)
      setOffset(tasks.length)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [open, fetchPage])

  const loadMore = () => {
    fetchPage(offset).then(tasks => {
      setDoneTasks(prev => [...prev, ...tasks])
      setOffset(prev => prev + tasks.length)
    })
  }

  const handleUncomplete = (task) => {
    onUncomplete(task)
    setDoneTasks(prev => prev.filter(t => t.id !== task.id))
    if (searchResults) {
      setSearchResults(prev => prev.filter(t => t.id !== task.id))
    }
  }

  // Local filter (instant)
  const localFiltered = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return doneTasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    )
  }, [searchQuery, doneTasks])

  // AI/server search (debounced)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      setIsAI(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const data = await aiSearchDone(searchQuery)
        setSearchResults(data.results || [])
        setIsAI(data.ai || false)
      } catch {
        // local fallback is already showing
      } finally {
        setIsSearching(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const displayTasks = searchResults || localFiltered || doneTasks
  const isFiltering = searchQuery.trim().length > 0

  const todayStr = new Date().toDateString()
  const todayTasks = isFiltering ? [] : displayTasks.filter(t => t.completed_at && new Date(t.completed_at).toDateString() === todayStr)
  const olderTasks = isFiltering ? displayTasks : displayTasks.filter(t => !t.completed_at || new Date(t.completed_at).toDateString() !== todayStr)

  const grouped = useMemo(() => {
    const groups = []
    let currentDate = null
    let currentGroup = null
    for (const t of olderTasks) {
      const dateStr = t.completed_at ? new Date(t.completed_at).toDateString() : 'Unknown'
      if (dateStr !== currentDate) {
        currentDate = dateStr
        currentGroup = { date: t.completed_at ? formatDate(t.completed_at) : 'Unknown', tasks: [] }
        groups.push(currentGroup)
      }
      currentGroup.tasks.push(t)
    }
    return groups
  }, [olderTasks])

  const renderRow = (t) => (
    <li key={t.id} className="v2-done-row">
      <div className="v2-done-row-content">
        <div className="v2-done-row-title">{t.title}</div>
        <div className="v2-done-row-meta">
          {daysOnList(t) === 0 ? 'same day' : `${daysOnList(t)}d on list`}
        </div>
      </div>
      <button className="v2-done-reopen" onClick={() => handleUncomplete(t)}>
        Reopen
      </button>
    </li>
  )

  return (
    <ModalShell open={open} onClose={onClose} title={title} width="wide">
      {/* Search bar */}
      <div className="v2-smart-search">
        <Search size={15} className="v2-smart-search-icon" />
        <input
          ref={searchRef}
          type="text"
          className="v2-smart-search-input"
          placeholder="Search completed tasks…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
          spellCheck="false"
        />
        {isSearching && <span className="v2-smart-search-spinner" />}
        {isAI && !isSearching && <Sparkles size={13} className="v2-smart-search-ai" />}
        {searchQuery && (
          <button className="v2-smart-search-clear" onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}>
            <X size={13} />
          </button>
        )}
      </div>

      {loading && <div className="v2-done-loading">Loading…</div>}

      {!loading && displayTasks.length === 0 && !isFiltering && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing completed yet"
          body="You'll see your wins here as you finish tasks."
        />
      )}

      {!loading && isFiltering && displayTasks.length === 0 && (
        <div className="v2-smart-search-empty">
          No matches for "{searchQuery}"
        </div>
      )}

      {isFiltering && displayTasks.length > 0 && (
        <div className="v2-smart-search-count">
          {displayTasks.length} result{displayTasks.length !== 1 ? 's' : ''}
          {isAI && ' · AI-assisted'}
        </div>
      )}

      {todayTasks.length > 0 && (
        <>
          <SectionLabel count={todayTasks.length}>Today</SectionLabel>
          <ul className="v2-done-list">{todayTasks.map(renderRow)}</ul>
        </>
      )}

      {isFiltering ? (
        <ul className="v2-done-list">{olderTasks.map(renderRow)}</ul>
      ) : (
        grouped.map(group => (
          <div key={group.date}>
            <SectionLabel count={group.tasks.length}>{group.date}</SectionLabel>
            <ul className="v2-done-list">{group.tasks.map(renderRow)}</ul>
          </div>
        ))
      )}

      {hasMore && !loading && !isFiltering && doneTasks.length > 0 && (
        <button className="v2-done-load-more" onClick={loadMore}>
          Load more
        </button>
      )}
    </ModalShell>
  )
}
