import { useEffect, useMemo, useState } from 'react'
import {
  Bell, AlertCircle, Clock3, Layers, Package, CloudSun, Sparkles, CheckCheck,
} from 'lucide-react'
import { localYMD } from '../store'
import { getNotifLog, markNotificationTap } from '../api'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './ActivityLog.css'
import './NotificationsModal.css'

// Notifications center — the bell's real destination (K4: it used to borrow
// the Activity log). Reads the existing server notification_log; no new data.
// Rows reuse the Activity log's day-group + icon-chip language so the two
// header destinations read as siblings. Tapping a row marks it read and
// deep-links to its task when one exists.

function typeMeta(type = '') {
  if (type.includes('overdue') || type.includes('highpri')) return { Icon: AlertCircle, tone: 'var(--v2-alert-overdue)' }
  if (type.includes('stale')) return { Icon: Clock3, tone: 'var(--v2-alert-high-pri)' }
  if (type.includes('pileup')) return { Icon: Layers, tone: '#A78BFA' }
  if (type.includes('package')) return { Icon: Package, tone: '#6B8AFD' }
  if (type.includes('weather')) return { Icon: CloudSun, tone: '#6B8AFD' }
  if (type.includes('quokka') || type.includes('adviser')) return { Icon: Sparkles, tone: '#A78BFA' }
  return { Icon: Bell, tone: '#5DBC9B' }
}

function ago(iso) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function dayLabel(ymd) {
  const today = localYMD(new Date())
  if (ymd === today) return 'Today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (ymd === localYMD(y)) return 'Yesterday'
  const [yy, mm, dd] = ymd.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function NotificationsModal({ open, onClose, onOpenTask }) {
  const [entries, setEntries] = useState([])
  const [tab, setTab] = useState('all')

  useEffect(() => {
    if (!open) return
    setTab('all')
    getNotifLog(200).then(d => setEntries(d.entries || [])).catch(() => setEntries([]))
  }, [open])

  const unread = useMemo(() => entries.filter(e => !e.tapped_at).length, [entries])
  const shown = tab === 'unread' ? entries.filter(e => !e.tapped_at) : entries

  const groups = useMemo(() => {
    const out = []
    for (const e of shown) {
      const key = localYMD(new Date(e.sent_at))
      const g = out[out.length - 1]
      if (g && g.key === key) g.items.push(e)
      else out.push({ key, items: [e] })
    }
    return out
  }, [shown])

  const markAllRead = () => {
    const now = new Date().toISOString()
    setEntries(prev => prev.map(e => (e.tapped_at ? e : { ...e, tapped_at: now })))
  }

  const handleTap = (entry) => {
    if (!entry.tapped_at) {
      setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, tapped_at: new Date().toISOString() } : e)))
      if (entry.task_id) markNotificationTap(entry.task_id).catch(() => {})
    }
    if (entry.task_id && onOpenTask) {
      onClose()
      onOpenTask(entry.task_id)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : undefined}
      width="wide"
    >
      <div className="v2-notif-toolbar">
        <div className="v2-activity-filters">
          <button className={`v2-form-seg${tab === 'all' ? ' v2-form-seg-active' : ''}`} onClick={() => setTab('all')}>All</button>
          <button className={`v2-form-seg${tab === 'unread' ? ' v2-form-seg-active' : ''}`} onClick={() => setTab('unread')}>
            Unread{unread > 0 ? ` · ${unread}` : ''}
          </button>
        </div>
        {unread > 0 && (
          <button className="v2-notif-markall" onClick={markAllRead}>
            <CheckCheck size={14} strokeWidth={2} /> Mark all read
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={tab === 'unread' ? 'All caught up' : 'No notifications yet'}
          body={tab === 'unread'
            ? 'Nothing unread — nicely done.'
            : 'Nags, package updates, weather alerts, and Quokka plan pings land here as they go out.'}
        />
      ) : (
        <ul className="v2-activity-list">
          {groups.map(g => (
            <li key={g.key} className="v2-activity-group">
              <div className="v2-activity-day">{dayLabel(g.key)}</div>
              {g.items.map(e => {
                const { Icon, tone } = typeMeta(e.type)
                return (
                  <button
                    key={e.id}
                    className={`v2-activity-row v2-notif-row${e.tapped_at ? '' : ' is-unread'}`}
                    onClick={() => handleTap(e)}
                  >
                    <span className="v2-activity-icon" style={{ '--tone': tone }}>
                      <Icon size={13} strokeWidth={2.2} />
                    </span>
                    <div className="v2-activity-body">
                      <div className="v2-activity-title">{e.title}</div>
                      {e.body && <div className="v2-notif-body">{e.body}</div>}
                      <div className="v2-activity-meta-row">
                        <span className="v2-activity-action" style={{ color: tone }}>
                          {String(e.type || '').replace(/_/g, ' ')}
                        </span>
                        <span className="v2-activity-time">{ago(e.sent_at)} · {e.channel}</span>
                      </div>
                    </div>
                    {!e.tapped_at && <span className="v2-notif-dot" aria-label="Unread" />}
                  </button>
                )
              })}
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
