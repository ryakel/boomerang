import { useState, useEffect, useMemo, useCallback } from 'react'
import { CheckCircle2 } from 'lucide-react'
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

export default function DoneList({ open, onClose, onUncomplete }) {
  const [doneTasks, setDoneTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const fetchPage = useCallback((pageOffset) => {
    return fetch(`/api/tasks?status=done&sort=completed_at&limit=${PAGE_SIZE}&offset=${pageOffset}`)
      .then(res => res.ok ? res.json() : [])
      .then(tasks => {
        if (tasks.length < PAGE_SIZE) setHasMore(false)
        return tasks
      })
  }, [])

  // Refetch when the modal reopens (so the user always sees fresh data after
  // completing tasks elsewhere in the app).
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setHasMore(true)
    setOffset(0)
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
  }

  const todayStr = new Date().toDateString()
  const todayTasks = doneTasks.filter(t => t.completed_at && new Date(t.completed_at).toDateString() === todayStr)
  const olderTasks = doneTasks.filter(t => !t.completed_at || new Date(t.completed_at).toDateString() !== todayStr)

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
    <ModalShell open={open} onClose={onClose} title="Done" terminalTitle="> done --list" width="wide">
      {loading && <div className="v2-done-loading">Loading…</div>}

      {!loading && doneTasks.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing completed yet"
          body="You'll see your wins here as you finish tasks."
          terminalCommand="// no completions yet — they show up here as you finish tasks"
        />
      )}

      {todayTasks.length > 0 && (
        <>
          <SectionLabel count={todayTasks.length}>Today</SectionLabel>
          <ul className="v2-done-list">{todayTasks.map(renderRow)}</ul>
        </>
      )}

      {grouped.map(group => (
        <div key={group.date}>
          <SectionLabel count={group.tasks.length}>{group.date}</SectionLabel>
          <ul className="v2-done-list">{group.tasks.map(renderRow)}</ul>
        </div>
      ))}

      {hasMore && !loading && doneTasks.length > 0 && (
        <button className="v2-done-load-more" onClick={loadMore}>
          Load more
        </button>
      )}
    </ModalShell>
  )
}
