import { useState, useEffect, useMemo } from 'react'
import { Plus, Package as PackageIcon, RefreshCw, Trash2 } from 'lucide-react'
import CarrierLogo from '../../components/CarrierLogo'
import { detectCarrier } from '../../utils/carrierDetect'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './PackagesModal.css'

// Same status palette as v1 PackageCard, just consumed via v2 CSS classes.
const STATUS_META = {
  pending: { label: 'Pending', tone: 'pending' },
  in_transit: { label: 'In transit', tone: 'in-transit' },
  out_for_delivery: { label: 'Out for delivery', tone: 'out-for-delivery' },
  delivered: { label: 'Delivered', tone: 'delivered' },
  exception: { label: 'Exception', tone: 'exception' },
}

const STATUS_ORDER = ['out_for_delivery', 'in_transit', 'exception', 'pending', 'delivered']

function formatEta(eta) {
  if (!eta) return null
  const d = new Date(eta)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function PackageRow({ pkg, expanded, onToggleExpand, onRefresh, onDelete }) {
  const [refreshing, setRefreshing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (!expanded) setConfirmDelete(false) }, [expanded])

  const meta = STATUS_META[pkg.status] || STATUS_META.pending
  const events = pkg.events || []

  const handleRefresh = async (e) => {
    e.stopPropagation()
    setRefreshing(true)
    try {
      await onRefresh(pkg.id)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <li className={`v2-package-row${expanded ? ' v2-package-row-expanded' : ''}`}>
      <button className="v2-package-summary" onClick={onToggleExpand}>
        <span className="v2-package-carrier"><CarrierLogo carrier={pkg.carrier} size={22} /></span>
        <div className="v2-package-meta">
          <div className="v2-package-label">{pkg.label || pkg.tracking_number}</div>
          {pkg.label && (
            <div className="v2-package-tracking">{pkg.tracking_number}</div>
          )}
        </div>
        <span className={`v2-package-status v2-package-status-${meta.tone}`}>{meta.label}</span>
      </button>
      {expanded && (
        <div className="v2-package-detail">
          <div className="v2-package-detail-meta">
            {pkg.last_location && <span>{pkg.last_location}</span>}
            {pkg.eta && pkg.status !== 'delivered' && (
              <>
                <span className="v2-package-meta-sep">·</span>
                <span>ETA {formatEta(pkg.eta)}</span>
              </>
            )}
            {pkg.status === 'delivered' && pkg.delivered_at && (
              <>
                <span className="v2-package-meta-sep">·</span>
                <span>Delivered {timeAgo(pkg.delivered_at)}</span>
              </>
            )}
          </div>
          {events.length > 0 ? (
            <ol className="v2-package-events">
              {events.slice(0, 8).map((evt, i) => (
                <li key={i} className={`v2-package-event${i === 0 ? ' v2-package-event-latest' : ''}`}>
                  <span className="v2-package-event-dot" />
                  <div className="v2-package-event-body">
                    <div className="v2-package-event-desc">{evt.description}</div>
                    <div className="v2-package-event-meta">
                      {evt.location && <span>{evt.location}</span>}
                      {evt.timestamp && (
                        <>
                          {evt.location && <span className="v2-package-meta-sep">·</span>}
                          <span>{new Date(evt.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="v2-package-detail-empty">No tracking events yet. Check back soon.</div>
          )}
          <div className="v2-package-actions">
            <button
              className="v2-package-action"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw size={14} strokeWidth={1.75} className={refreshing ? 'v2-package-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {!confirmDelete ? (
              <button
                className="v2-package-action v2-package-action-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} strokeWidth={1.75} /> Delete
              </button>
            ) : (
              <>
                <span className="v2-package-confirm-label">Delete?</span>
                <button
                  className="v2-package-action v2-package-action-confirm-yes"
                  onClick={() => onDelete(pkg.id)}
                >
                  Yes
                </button>
                <button className="v2-package-action" onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function PackagesModal({
  open, packages, onAdd, onDelete, onRefresh, onRefreshAll, onClose,
}) {
  const [trackingInput, setTrackingInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  // Live carrier detection — same as v1.
  const detectedCarrier = useMemo(() => {
    const cleaned = trackingInput.trim().replace(/\s/g, '')
    return cleaned.length >= 8 ? detectCarrier(cleaned) : null
  }, [trackingInput])

  // Sort: out-for-delivery → in transit → exception → pending → delivered, then ETA.
  const sortedPackages = useMemo(() => {
    return [...packages].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status)
      const bi = STATUS_ORDER.indexOf(b.status)
      if (ai !== bi) return ai - bi
      if (a.eta && b.eta) return new Date(a.eta) - new Date(b.eta)
      return (a.label || a.tracking_number || '').localeCompare(b.label || b.tracking_number || '')
    })
  }, [packages])

  const handleAdd = async () => {
    const tracking = trackingInput.trim().replace(/\s/g, '')
    if (!tracking) return
    setAdding(true)
    try {
      await onAdd({
        tracking_number: tracking,
        label: labelInput.trim() || null,
        carrier: detectedCarrier?.carrier || 'other',
      })
      setTrackingInput('')
      setLabelInput('')
      setShowAddForm(false)
    } finally {
      setAdding(false)
    }
  }

  const handleRefreshAll = async () => {
    if (refreshingAll || !onRefreshAll) return
    setRefreshingAll(true)
    try { await onRefreshAll() } finally { setRefreshingAll(false) }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Packages" terminalTitle="$ packages" width="wide">
      <div className="v2-packages-toolbar">
        <button
          className="v2-package-toolbar-btn"
          onClick={handleRefreshAll}
          disabled={refreshingAll || packages.length === 0}
        >
          <RefreshCw size={14} strokeWidth={1.75} className={refreshingAll ? 'v2-package-spin' : ''} />
          {refreshingAll ? 'Refreshing…' : 'Refresh all'}
        </button>
        <button
          className="v2-package-toolbar-btn v2-package-toolbar-btn-primary"
          onClick={() => setShowAddForm(s => !s)}
        >
          <Plus size={14} strokeWidth={2} /> {showAddForm ? 'Hide form' : 'Track new'}
        </button>
      </div>

      {showAddForm && (
        <div className="v2-package-add-form">
          <input
            className="v2-form-input"
            placeholder="Tracking number"
            value={trackingInput}
            onChange={e => setTrackingInput(e.target.value)}
            autoFocus
          />
          <input
            className="v2-form-input"
            placeholder="Label (optional)"
            value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
          />
          {detectedCarrier && (
            <div className="v2-package-detected">
              <CarrierLogo carrier={detectedCarrier.carrier} size={18} />
              <span>Detected: <strong>{detectedCarrier.label}</strong></span>
            </div>
          )}
          <button
            className="v2-form-submit"
            onClick={handleAdd}
            disabled={!trackingInput.trim() || adding}
          >
            {adding ? 'Adding…' : 'Track package'}
          </button>
        </div>
      )}

      {packages.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title="No packages tracked"
          body="Add a tracking number above to start watching it. Carrier auto-detects from most major carriers."
          terminalCommand="// no packages tracked — paste a tracking number above"
        />
      ) : (
        <ul className="v2-package-list">
          {sortedPackages.map(pkg => (
            <PackageRow
              key={pkg.id}
              pkg={pkg}
              expanded={expandedId === pkg.id}
              onToggleExpand={() => setExpandedId(expandedId === pkg.id ? null : pkg.id)}
              onRefresh={onRefresh}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
