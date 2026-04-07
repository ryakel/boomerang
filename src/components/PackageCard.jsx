import { useState, useRef } from 'react'
import { RefreshCw, Trash2, ExternalLink } from 'lucide-react'
import { getTrackingUrl } from '../utils/carrierDetect'
import CarrierLogo from './CarrierLogo'

const STATUS_COLORS = {
  pending: { bg: 'var(--bg-secondary)', text: 'var(--text-dim)', label: 'Pending' },
  in_transit: { bg: '#2563eb22', text: '#3b82f6', label: 'In Transit' },
  out_for_delivery: { bg: '#0d948822', text: '#14b8a6', label: 'Out for Delivery' },
  delivered: { bg: '#16a34a22', text: '#22c55e', label: 'Delivered' },
  exception: { bg: '#dc262622', text: '#ef4444', label: 'Exception' },
  expired: { bg: 'var(--bg-secondary)', text: 'var(--text-dim)', label: 'Expired' },
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatEta(eta) {
  if (!eta) return null
  // Handle both YYYY-MM-DD and full ISO datetime
  const dateStr = eta.includes('T') ? eta.split('T')[0] : eta
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff <= 7) return `In ${diff} days`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysUntilCleanup(autoCleanupAt) {
  if (!autoCleanupAt) return null
  const diff = Math.ceil((new Date(autoCleanupAt) - new Date()) / 86400000)
  return diff > 0 ? diff : 0
}

const SWIPE_THRESHOLD = 60
const SWIPE_OPEN_OFFSET = -120

export default function PackageCard({ pkg, isDuplicate, onRefresh, onDelete, onSelect, apiAvailable }) {
  const [refreshing, setRefreshing] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const touchStartRef = useRef(null)

  const statusStyle = STATUS_COLORS[pkg.status] || STATUS_COLORS.pending
  const trackUrl = getTrackingUrl(pkg.carrier, pkg.tracking_number)

  const closeSwipe = () => { setSwipeOpen(false); setSwipeX(0) }

  const handleRefresh = async (e) => {
    e.stopPropagation()
    setRefreshing(true)
    try {
      await onRefresh(pkg.id)
    } finally {
      setRefreshing(false)
    }
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete(pkg.id)
    closeSwipe()
  }

  const onTouchStart = (e) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, startSwipeX: swipeX }
  }

  const onTouchMove = (e) => {
    if (!touchStartRef.current) return
    const touch = e.touches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y

    if (!swiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      touchStartRef.current = null
      return
    }

    if (Math.abs(dx) > 10) {
      setSwiping(true)
      const base = touchStartRef.current.startSwipeX || 0
      setSwipeX(Math.max(-160, Math.min(0, base + dx)))
    }
  }

  const onTouchEnd = () => {
    if (!touchStartRef.current) { setSwiping(false); return }

    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeOpen(true)
      setSwipeX(SWIPE_OPEN_OFFSET)
    } else {
      if (swipeOpen && swipeX > SWIPE_OPEN_OFFSET + 30) {
        closeSwipe()
      } else if (swipeOpen) {
        setSwipeX(SWIPE_OPEN_OFFSET)
      } else {
        setSwipeX(0)
      }
    }

    touchStartRef.current = null
    setTimeout(() => setSwiping(false), 250)
  }

  const cleanupDays = daysUntilCleanup(pkg.auto_cleanup_at)

  return (
    <div className="package-card-wrapper">
      <div
        className="package-card"
        style={{
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: swiping ? 'none' : 'transform 0.25s ease',
        }}
        onClick={() => { if (!swiping && !swipeOpen) onSelect(pkg); else if (swipeOpen) closeSwipe() }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="package-card-top">
          <span className="package-carrier-icon"><CarrierLogo carrier={pkg.carrier} size={24} /></span>
          <div className="package-card-info">
            <div className="package-card-label">{pkg.label || pkg.tracking_number}</div>
            {pkg.label && <div className="package-card-tracking">{pkg.tracking_number}</div>}
          </div>
          <div className="package-status-badge" style={{ background: statusStyle.bg, color: statusStyle.text }}>
            {statusStyle.label}
          </div>
        </div>

        <div className="package-card-details">
          {pkg.last_location && (
            <span className="package-location">{pkg.last_location}</span>
          )}
          {pkg.status_detail && (
            <span className="package-status-detail">{pkg.status_detail}</span>
          )}
        </div>

        <div className="package-card-footer">
          {pkg.eta && pkg.status !== 'delivered' && (
            <span className="package-eta">ETA: {formatEta(pkg.eta)}</span>
          )}
          {pkg.status === 'delivered' && pkg.delivered_at && (
            <span className="package-delivered-date">Delivered {timeAgo(pkg.delivered_at)}</span>
          )}
          {pkg.status === 'delivered' && cleanupDays !== null && (
            <span className="package-cleanup-notice">Removes in {cleanupDays}d</span>
          )}
          {pkg.last_polled && (
            <span className="package-polled">Updated {timeAgo(pkg.last_polled)}</span>
          )}
        </div>

        {isDuplicate && (
          <div className="package-duplicate-badge">Duplicate</div>
        )}

        {pkg.signature_required && (
          <div className="package-signature-badge">{'✍️'} Signature Required</div>
        )}

        {trackUrl && (
          <a
            href={trackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="package-track-link"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={12} /> Track on {pkg.carrier_name || pkg.carrier}
          </a>
        )}
      </div>

      {/* Swipe actions */}
      <div className="package-card-actions">
        <button
          className="package-action-btn refresh"
          onClick={handleRefresh}
          disabled={refreshing || !apiAvailable}
          title={!apiAvailable ? 'API limit reached' : 'Refresh'}
        >
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
        </button>
        <button className="package-action-btn delete" onClick={handleDelete}>
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  )
}
