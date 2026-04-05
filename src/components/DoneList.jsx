import { useState, useEffect, useMemo, useCallback } from 'react'
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

export default function DoneList({ onClose, onUncomplete }) {
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

  useEffect(() => {
    fetchPage(0)
      .then(tasks => {
        setDoneTasks(tasks)
        setOffset(tasks.length)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [fetchPage])

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

  const renderCard = (t) => (
    <div key={t.id} className="done-card">
      <span className="done-title">{t.title}</span>
      <span className="done-meta">
        {daysOnList(t) === 0 ? 'same day' : `${daysOnList(t)}d on list`}
      </span>
      <button className="reopen-btn" onClick={() => handleUncomplete(t)}>Reopen</button>
    </div>
  )

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Done</div>
        <div style={{ width: 50 }} />
      </div>

      {loading && (
        <div className="empty-state">Loading...</div>
      )}

      {!loading && doneTasks.length === 0 && (
        <div className="empty-state">
          Nothing completed yet.<br />You'll see your wins here.
        </div>
      )}

      {todayTasks.length > 0 && (
        <>
          <div className="section-label" style={{ color: '#52C97F' }}>
            Today — {todayTasks.length} done
          </div>
          {todayTasks.map(renderCard)}
        </>
      )}

      {grouped.map(group => (
        <div key={group.date}>
          <div className="section-label">{group.date} — {group.tasks.length} done</div>
          {group.tasks.map(renderCard)}
        </div>
      ))}

      {hasMore && !loading && (
        <button className="load-more-btn" onClick={loadMore} style={{
          display: 'block', margin: '16px auto', padding: '8px 20px',
          background: 'var(--card-bg)', color: 'var(--text-main)',
          border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
        }}>
          Load more
        </button>
      )}
    </div>
  )
}
