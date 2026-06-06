import { useMemo, useState } from 'react'
import {
  ArrowLeft, Bell, AlertCircle, Clock, Layers, Package, CloudSun, Sparkles, CheckCheck,
} from 'lucide-react'
import { localYMD } from './heatmapUtils'
import './NotificationsView.css'

// Type → icon + accent. Reskin of Boomerang's existing notification_log; no
// gamification — just the real notifications the app already produces.
function meta(type = '') {
  if (type.includes('overdue') || type.includes('highpri')) return { Icon: AlertCircle, color: 'var(--wb-action-delete)' }
  if (type.includes('stale')) return { Icon: Clock, color: 'var(--wb-cat-orange)' }
  if (type.includes('pileup')) return { Icon: Layers, color: 'var(--wb-cat-purple)' }
  if (type.includes('package')) return { Icon: Package, color: 'var(--wb-cat-blue)' }
  if (type.includes('weather')) return { Icon: CloudSun, color: 'var(--wb-cat-blue)' }
  if (type.includes('quokka') || type.includes('adviser')) return { Icon: Sparkles, color: 'var(--wb-cat-purple)' }
  return { Icon: Bell, color: 'var(--wb-cat-green)' }
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

function bucket(iso) {
  const today = localYMD(new Date())
  const y = new Date(); y.setDate(y.getDate() - 1)
  const d = localYMD(iso)
  if (d === today) return 'Today'
  if (d === localYMD(y)) return 'Yesterday'
  return 'Earlier'
}

export default function NotificationsView({ entries = [], onMarkAllRead, onClose }) {
  const [tab, setTab] = useState('all')
  const unreadCount = useMemo(() => entries.filter(e => !e.tapped_at).length, [entries])

  const shown = tab === 'unread' ? entries.filter(e => !e.tapped_at) : entries
  const groups = useMemo(() => {
    const order = ['Today', 'Yesterday', 'Earlier']
    const map = {}
    for (const e of shown) (map[bucket(e.sent_at)] ||= []).push(e)
    return order.filter(k => map[k]).map(k => ({ label: k, items: map[k] }))
  }, [shown])

  return (
    <div className="wb-notifs">
      <header className="wb-habits-head">
        <div className="wb-habits-titlerow">
          <button className="wb-back" onClick={onClose} aria-label="Back"><ArrowLeft size={20} strokeWidth={2.25} /></button>
          <h1 className="wb-habits-title wb-notifs-title">Notifications</h1>
          {unreadCount > 0 && onMarkAllRead && (
            <button className="wb-notifs-markall" onClick={onMarkAllRead}><CheckCheck size={15} strokeWidth={2} /> Mark all read</button>
          )}
        </div>
        <div className="wb-seg wb-notifs-seg" role="tablist">
          {[{ id: 'all', label: 'All' }, { id: 'unread', label: `Unread${unreadCount ? ` (${unreadCount})` : ''}` }].map(t => (
            <button key={t.id} className={`wb-seg-btn${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </header>

      {groups.length === 0 && (
        <div className="wb-notifs-empty">
          <span className="wb-notifs-empty-icon"><Bell size={30} strokeWidth={1.75} /></span>
          <p>{tab === 'unread' ? "You're all caught up." : 'No notifications yet.'}</p>
        </div>
      )}

      {groups.map(g => (
        <section key={g.label} className="wb-notifs-group">
          <h2 className="wb-notifs-group-label">{g.label}</h2>
          {g.items.map(e => {
            const { Icon, color } = meta(e.type)
            return (
              <div key={e.id} className={`wb-notif${e.tapped_at ? '' : ' is-unread'}`}>
                <span className="wb-notif-icon" style={{ color }}><Icon size={18} strokeWidth={2} /></span>
                <div className="wb-notif-text">
                  {e.title && <span className="wb-notif-title">{e.title}</span>}
                  {e.body && <span className="wb-notif-body">{e.body}</span>}
                  <span className="wb-notif-meta">{e.channel ? `${e.channel} · ` : ''}{ago(e.sent_at)}</span>
                </div>
                {!e.tapped_at && <span className="wb-notif-dot" />}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
