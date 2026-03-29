import { useMemo } from 'react'

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

export default function DoneList({ tasks, onClose, onUncomplete }) {
  const doneTasks = useMemo(() =>
    tasks
      .filter(t => t.status === 'done' && t.completed_at)
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)),
    [tasks]
  )

  const todayStr = new Date().toDateString()
  const todayTasks = doneTasks.filter(t => new Date(t.completed_at).toDateString() === todayStr)
  const olderTasks = doneTasks.filter(t => new Date(t.completed_at).toDateString() !== todayStr)

  // Group older tasks by date
  const grouped = useMemo(() => {
    const groups = []
    let currentDate = null
    let currentGroup = null
    for (const t of olderTasks) {
      const dateStr = new Date(t.completed_at).toDateString()
      if (dateStr !== currentDate) {
        currentDate = dateStr
        currentGroup = { date: formatDate(t.completed_at), tasks: [] }
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
      <button className="reopen-btn" onClick={() => onUncomplete(t)}>Reopen</button>
    </div>
  )

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Done</div>
        <div style={{ width: 50 }} />
      </div>

      {doneTasks.length === 0 && (
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
    </div>
  )
}
