import { useState, useEffect, useMemo, useRef } from 'react'
import { Plus, AlertTriangle, ArrowUpDown, RefreshCw } from 'lucide-react'
import CarrierLogo from './CarrierLogo'
import PackageCard from './PackageCard'
import PackageDetailModal from './PackageDetailModal'
import { detectCarrier } from '../utils/carrierDetect'
import { getPackageApiStatus } from '../api'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import './Packages.css'

export default function Packages({ packages, onAdd, onEdit, onDelete, onRefresh, onRefreshAll, onClose }) {
  const [trackingInput, setTrackingInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [detectedCarrier, setDetectedCarrier] = useState(null)
  const [selectedPkg, setSelectedPkg] = useState(null)
  const [adding, setAdding] = useState(false)
  const [apiStatus, setApiStatus] = useState({ available: true, configured: false })
  const [showAddForm, setShowAddForm] = useState(false)
  const [sortBy, setSortBy] = useState('status') // status | eta | carrier
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [cooldownSecs, setCooldownSecs] = useState(0)
  const cooldownRef = useRef(null)
  const sortRef = useRef(null)

  // Restore cooldown from localStorage on mount
  useEffect(() => {
    const until = parseInt(localStorage.getItem('boom_pkg_refresh_cooldown') || '0', 10)
    const remaining = Math.ceil((until - Date.now()) / 1000)
    if (remaining > 0) setCooldownSecs(remaining)
  }, [])

  // Tick down the cooldown every second
  useEffect(() => {
    if (cooldownSecs <= 0) return
    cooldownRef.current = setInterval(() => {
      setCooldownSecs(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(cooldownRef.current)
  }, [cooldownSecs > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshAll = async () => {
    if (refreshingAll || cooldownSecs > 0 || !onRefreshAll) return
    setRefreshingAll(true)
    try {
      await onRefreshAll()
      // Start 5-minute cooldown
      const cooldownMs = 5 * 60 * 1000
      localStorage.setItem('boom_pkg_refresh_cooldown', String(Date.now() + cooldownMs))
      setCooldownSecs(300)
    } finally {
      setRefreshingAll(false)
    }
  }

  const { onTouchStart, onTouchEnd } = usePullToRefresh(handleRefreshAll)

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!showSortDropdown) return
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setShowSortDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSortDropdown])

  useEffect(() => {
    getPackageApiStatus().then(setApiStatus).catch(() => {})
  }, [])

  // Live carrier detection
  useEffect(() => {
    const cleaned = trackingInput.trim().replace(/\s/g, '')
    if (cleaned.length >= 8) {
      setDetectedCarrier(detectCarrier(cleaned))
    } else {
      setDetectedCarrier(null)
    }
  }, [trackingInput])

  const duplicateMatch = useMemo(() => {
    const cleaned = trackingInput.trim().replace(/\s/g, '').toLowerCase()
    if (cleaned.length < 8) return null
    return packages.find(p => p.tracking_number.toLowerCase() === cleaned) || null
  }, [trackingInput, packages])

  const handleAdd = async () => {
    const cleaned = trackingInput.trim()
    if (!cleaned || duplicateMatch) return
    setAdding(true)
    try {
      await onAdd(cleaned, labelInput.trim(), detectedCarrier?.code)
      setTrackingInput('')
      setLabelInput('')
      setDetectedCarrier(null)
      setShowAddForm(false)
    } catch (err) {
      console.error('Add package failed:', err)
    } finally {
      setAdding(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && trackingInput.trim()) handleAdd()
  }

  // Sort and group packages
  const STATUS_ORDER = { exception: 0, out_for_delivery: 1, in_transit: 2, pending: 3, delivered: 4, expired: 5 }

  const sortedGroups = useMemo(() => {
    const all = [...packages]

    if (sortBy === 'carrier') {
      all.sort((a, b) => {
        const ca = (a.carrier_name || a.carrier || 'zzz').toLowerCase()
        const cb = (b.carrier_name || b.carrier || 'zzz').toLowerCase()
        if (ca !== cb) return ca.localeCompare(cb)
        return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      })
      const groups = []
      let current = null
      for (const pkg of all) {
        const key = pkg.carrier_name || pkg.carrier || 'Unknown'
        if (key !== current) {
          current = key
          groups.push({ title: key, packages: [] })
        }
        groups[groups.length - 1].packages.push(pkg)
      }
      return groups
    }

    if (sortBy === 'eta') {
      all.sort((a, b) => {
        if (a.eta && b.eta) return a.eta.localeCompare(b.eta)
        if (a.eta) return -1
        if (b.eta) return 1
        return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      })
      return [{ title: null, packages: all }]
    }

    // Default: group by status
    const issues = []
    const active = []
    const delivered = []
    for (const pkg of all) {
      if (pkg.status === 'exception') issues.push(pkg)
      else if (pkg.status === 'delivered') delivered.push(pkg)
      else active.push(pkg)
    }
    active.sort((a, b) => {
      if (a.eta && b.eta) return a.eta.localeCompare(b.eta)
      if (a.eta) return -1
      if (b.eta) return 1
      return new Date(b.created_at) - new Date(a.created_at)
    })
    delivered.sort((a, b) => new Date(b.delivered_at || b.updated_at) - new Date(a.delivered_at || a.updated_at))
    issues.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    const groups = []
    if (issues.length > 0) groups.push({ title: '\u26A0\uFE0F Issues (' + issues.length + ')', packages: issues })
    if (active.length > 0) groups.push({ title: '\u{1F69A} Active (' + active.length + ')', packages: active })
    if (delivered.length > 0) groups.push({ title: '\u2705 Delivered (' + delivered.length + ')', packages: delivered })
    return groups
  }, [packages, sortBy])

  // Detect duplicate tracking numbers
  const duplicateNumbers = useMemo(() => {
    const counts = {}
    for (const pkg of packages) {
      const num = pkg.tracking_number.toLowerCase()
      counts[num] = (counts[num] || 0) + 1
    }
    return new Set(Object.keys(counts).filter(k => counts[k] > 1))
  }, [packages])

  // Keep selected package in sync with latest data
  const selectedPkgData = selectedPkg ? packages.find(p => p.id === selectedPkg.id) || selectedPkg : null

  return (
    <div className="settings-overlay" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Packages</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="package-sort-btn"
            onClick={handleRefreshAll}
            disabled={refreshingAll || cooldownSecs > 0}
            title={cooldownSecs > 0 ? `Refresh available in ${Math.ceil(cooldownSecs / 60)}m ${cooldownSecs % 60}s` : 'Refresh all packages'}
            style={cooldownSecs > 0 ? { position: 'relative', minWidth: 44 } : {}}
          >
            <RefreshCw size={16} className={refreshingAll ? 'spinning' : ''} />
            {cooldownSecs > 0 && (
              <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 2 }}>
                {Math.floor(cooldownSecs / 60)}:{String(cooldownSecs % 60).padStart(2, '0')}
              </span>
            )}
          </button>
          <div className="package-sort-wrapper" ref={sortRef}>
            <button className="package-sort-btn" onClick={() => setShowSortDropdown(!showSortDropdown)}>
              <ArrowUpDown size={16} />
            </button>
            {showSortDropdown && (
              <div className="package-sort-dropdown">
                {[
                  { value: 'status', label: 'Status' },
                  { value: 'eta', label: 'Delivery date' },
                  { value: 'carrier', label: 'Carrier' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    className={`package-sort-option ${sortBy === opt.value ? 'active' : ''}`}
                    onClick={() => { setSortBy(opt.value); setShowSortDropdown(false) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="package-add-toggle" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* API quota banner */}
      {apiStatus.exhausted && (
        <div className="package-api-banner">
          <AlertTriangle size={16} />
          <span>
            Tracking API limit reached. Updates resume at{' '}
            {apiStatus.reset_at ? new Date(apiStatus.reset_at).toLocaleTimeString() : 'midnight UTC'}.
            Track manually via carrier links below.
          </span>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="package-add-form">
          <input
            type="text"
            className="package-input"
            placeholder="Tracking number"
            value={trackingInput}
            onChange={e => setTrackingInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <input
            type="text"
            className="package-input"
            placeholder='Label (optional, e.g. "New keyboard")'
            value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {duplicateMatch && (
            <div className="package-duplicate-warning">
              Already tracking this number{duplicateMatch.label ? ` ("${duplicateMatch.label}")` : ''}
            </div>
          )}
          <div className="package-add-row">
            {detectedCarrier && !duplicateMatch && (
              <span className="package-detected-carrier">
                <CarrierLogo carrier={detectedCarrier.code} size={18} /> {detectedCarrier.name}
              </span>
            )}
            {!detectedCarrier && !duplicateMatch && trackingInput.trim().length >= 8 && (
              <span className="package-detected-carrier unknown">Unknown carrier</span>
            )}
            <button
              className="package-add-btn"
              onClick={handleAdd}
              disabled={!trackingInput.trim() || adding || !!duplicateMatch}
            >
              {adding ? 'Adding...' : 'Add Package'}
            </button>
          </div>
        </div>
      )}

      {/* Package list */}
      <div className="package-list">
        {packages.length === 0 && !showAddForm && (
          <div className="empty-state">
            No packages being tracked.<br />
            Tap <strong>+</strong> to add a tracking number.
          </div>
        )}

        {sortedGroups.map((group, i) => (
          <div key={group.title || i} className="package-section">
            {group.title && <h3 className="package-section-title">{group.title}</h3>}
            {group.packages.map(pkg => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                isDuplicate={duplicateNumbers.has(pkg.tracking_number.toLowerCase())}
                onRefresh={onRefresh}
                onDelete={onDelete}
                onSelect={setSelectedPkg}
                apiAvailable={apiStatus.available}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Detail modal */}
      {selectedPkgData && (
        <PackageDetailModal
          pkg={selectedPkgData}
          onClose={() => setSelectedPkg(null)}
          onRefresh={onRefresh}
          onDelete={(id) => { onDelete(id); setSelectedPkg(null) }}
          onUpdate={onEdit}
          apiAvailable={apiStatus.available}
        />
      )}
    </div>
  )
}
