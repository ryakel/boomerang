import { useState, useEffect, useMemo } from 'react'
import { Plus, Package as PackageIcon, RefreshCw, Trash2, ExternalLink } from 'lucide-react'
import CarrierLogo from './CarrierLogo'
import { detectCarrier, getTrackingUrl } from '../utils/carrierDetect'
import { loadSettings } from '../store'
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

  // USPS blocks third-party tracking (Mailer-ID lockdown, April 2026 — 17track
  // only serves it on a paid "Special Carriers" plan). With a Shippo token
  // configured, USPS tracks normally via Shippo; without one, USPS rows are
  // link-out cards: no polling, no refresh, just the carrier-site link.
  // Mirrors the server's SHIPPO_CARRIERS + isUntrackable() gates.
  // (events check: a server-side SHIPPO_API_TOKEN env var tracks USPS without
  // the setting existing client-side — populated events always win)
  const untrackable = pkg.carrier === 'usps' && !loadSettings()?.shippo_api_token && !(pkg.events?.length)
  const meta = untrackable
    ? { label: 'Link only', tone: 'pending' }
    : (STATUS_META[pkg.status] || STATUS_META.pending)
  const events = pkg.events || []
  const trackUrl = getTrackingUrl(pkg.carrier, pkg.tracking_number)
  const summaryEta = pkg.status === 'delivered'
    ? (pkg.delivered_at ? `Delivered ${timeAgo(pkg.delivered_at)}` : null)
    : (pkg.eta ? `ETA ${formatEta(pkg.eta)}` : null)

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
          {summaryEta && (
            <div className="v2-package-summary-eta">{summaryEta}</div>
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
          {untrackable ? (
            <div className="v2-package-detail-empty">
              USPS stopped allowing third-party tracking (April 2026), so live status
              isn&apos;t available here — use the USPS site below, or add a Shippo token
              in Settings → Integrations to track USPS in-app.
            </div>
          ) : events.length > 0 ? (
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
            {!untrackable && (
              <button
                className="v2-package-action"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw size={14} strokeWidth={1.75} className={refreshing ? 'v2-package-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            {trackUrl && (
              <a
                className="v2-package-action"
                href={trackUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(trackUrl, '_blank', 'noopener,noreferrer') }}
              >
                <ExternalLink size={14} strokeWidth={1.75} /> {untrackable ? 'Track on USPS.com' : 'Carrier site'}
              </a>
            )}
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
  const [addError, setAddError] = useState(null)
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
    setAddError(null)
    try {
      // addPackage takes positional args (trackingNumber, label, carrier) — same as v1.
      await onAdd(tracking, labelInput.trim() || null, detectedCarrier?.code || 'other')
      setTrackingInput('')
      setLabelInput('')
      setShowAddForm(false)
    } catch (err) {
      // Silent failure destroys trust in the button — say what went wrong.
      // 409 = already tracked server-side (possibly a pending Gmail import
      // this device hasn't fetched yet).
      if (err?.status === 409) {
        setAddError(`Already tracking this number${err.existingLabel ? ` as "${err.existingLabel}"` : ''}. Pull to refresh if you don't see it.`)
      } else {
        setAddError(err?.message || 'Could not add package — check the server connection.')
      }
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
    <ModalShell open={open} onClose={onClose} title="Packages" width="wide">
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
              <CarrierLogo carrier={detectedCarrier.code} size={18} />
              <span>Detected: <strong>{detectedCarrier.name}</strong></span>
            </div>
          )}
          {addError && <div className="v2-package-add-error">{addError}</div>}
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
