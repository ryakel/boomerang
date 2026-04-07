import { useState } from 'react'
import { X, RefreshCw, Copy, Trash2, ExternalLink, Check, Edit3 } from 'lucide-react'
import { getTrackingUrl } from '../utils/carrierDetect'
import CarrierLogo from './CarrierLogo'

const STATUS_COLORS = {
  pending: { bg: 'var(--bg-secondary)', text: 'var(--text-dim)', label: 'Pending' },
  in_transit: { bg: '#2563eb33', text: '#3b82f6', label: 'In Transit' },
  out_for_delivery: { bg: '#0d948833', text: '#14b8a6', label: 'Out for Delivery' },
  delivered: { bg: '#16a34a33', text: '#22c55e', label: 'Delivered' },
  exception: { bg: '#dc262633', text: '#ef4444', label: 'Exception' },
  expired: { bg: 'var(--bg-secondary)', text: 'var(--text-dim)', label: 'Expired' },
}

function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatEtaShort(eta) {
  if (!eta) return null
  const etaDate = eta.includes('T') ? eta.split('T')[0] : eta
  const d = new Date(etaDate + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatEtaLong(eta) {
  if (!eta) return null
  const etaDate = eta.includes('T') ? eta.split('T')[0] : eta
  const d = new Date(etaDate + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d - today) / 86400000)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  if (diff === 0) return `Today (${dateStr})`
  if (diff === 1) return `Tomorrow (${dateStr})`
  if (diff < 0) return `${Math.abs(diff)} days overdue (${dateStr})`
  return `In ${diff} days (${dateStr})`
}

export default function PackageDetailModal({ pkg, onClose, onRefresh, onDelete, onUpdate, apiAvailable }) {
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(pkg.label || '')

  const statusStyle = STATUS_COLORS[pkg.status] || STATUS_COLORS.pending
  const trackUrl = getTrackingUrl(pkg.carrier, pkg.tracking_number)

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await onRefresh(pkg.id) } finally { setRefreshing(false) }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(pkg.tracking_number).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveLabel = () => {
    onUpdate(pkg.id, { label: editLabel })
    setEditing(false)
  }

  const events = pkg.events || []

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet package-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>

        {/* Status banner */}
        <div className="package-detail-banner" style={{ background: statusStyle.bg, color: statusStyle.text }}>
          <span className="package-detail-banner-icon"><CarrierLogo carrier={pkg.carrier} size={28} /></span>
          <span className="package-detail-banner-status">{statusStyle.label}</span>
          {pkg.signature_required && <span className="package-detail-sig-badge">{'✍️'} Signature Required</span>}
          {pkg.eta && pkg.status !== 'delivered' && (
            <span className="package-detail-banner-eta">{formatEtaShort(pkg.eta)}</span>
          )}
          {pkg.status === 'delivered' && pkg.delivered_at && (
            <span className="package-detail-banner-eta">{formatDateTime(pkg.delivered_at)}</span>
          )}
        </div>

        {/* Header */}
        <div className="package-detail-header">
          {editing ? (
            <div className="package-detail-edit-label">
              <input
                type="text"
                value={editLabel}
                onChange={e => setEditLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveLabel()}
                autoFocus
                className="package-label-input"
              />
              <button onClick={handleSaveLabel} className="package-label-save"><Check size={16} /></button>
            </div>
          ) : (
            <h2 className="package-detail-title" onClick={() => setEditing(true)}>
              {pkg.label || 'Untitled Package'} <Edit3 size={14} className="package-edit-icon" />
            </h2>
          )}

          <div className="package-detail-tracking" onClick={handleCopy}>
            <span className="package-detail-number">{pkg.tracking_number}</span>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </div>

          <div className="package-detail-carrier">
            <CarrierLogo carrier={pkg.carrier} size={18} /> {pkg.carrier_name || pkg.carrier || 'Unknown carrier'}
          </div>
        </div>

        {/* ETA */}
        {pkg.eta && pkg.status !== 'delivered' && (
          <div className="package-detail-eta">
            Estimated delivery: <strong>{formatEtaLong(pkg.eta)}</strong>
          </div>
        )}
        {pkg.status === 'delivered' && pkg.delivered_at && (
          <div className="package-detail-eta delivered">
            Delivered: <strong>{formatDateTime(pkg.delivered_at)}</strong>
          </div>
        )}

        {/* Timeline */}
        <div className="package-detail-timeline">
          <h3 className="package-timeline-heading">Tracking History</h3>
          {events.length === 0 && (
            <div className="package-timeline-empty">No tracking events yet. Check back soon.</div>
          )}
          {events.map((evt, i) => (
            <div key={i} className={`package-timeline-event ${i === 0 ? 'latest' : ''}`}>
              <div className="package-timeline-dot" style={i === 0 ? { background: statusStyle.text } : {}} />
              <div className="package-timeline-content">
                <div className="package-timeline-desc">{evt.description}</div>
                <div className="package-timeline-meta">
                  {evt.location && <span>{evt.location}</span>}
                  {evt.timestamp && <span>{formatDateTime(evt.timestamp)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="package-detail-actions">
          <button
            className="package-detail-action-btn"
            onClick={handleRefresh}
            disabled={refreshing || !apiAvailable}
          >
            <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          {trackUrl && (
            <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="package-detail-action-btn">
              <ExternalLink size={16} /> Track on {pkg.carrier_name || pkg.carrier}
            </a>
          )}

          <button className="package-detail-action-btn danger" onClick={() => { onDelete(pkg.id); onClose() }}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}
