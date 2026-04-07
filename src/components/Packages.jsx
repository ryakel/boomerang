import { useState, useEffect, useMemo } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import PackageCard from './PackageCard'
import PackageDetailModal from './PackageDetailModal'
import { detectCarrier } from '../utils/carrierDetect'
import { getPackageApiStatus } from '../api'
import './Packages.css'

export default function Packages({ packages, onAdd, onEdit, onDelete, onRefresh, onClose }) {
  const [trackingInput, setTrackingInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [detectedCarrier, setDetectedCarrier] = useState(null)
  const [selectedPkg, setSelectedPkg] = useState(null)
  const [adding, setAdding] = useState(false)
  const [apiStatus, setApiStatus] = useState({ available: true, configured: false })
  const [showAddForm, setShowAddForm] = useState(false)

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

  const handleAdd = async () => {
    const cleaned = trackingInput.trim()
    if (!cleaned) return
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

  // Group packages by status
  const { active, delivered, issues } = useMemo(() => {
    const active = []
    const delivered = []
    const issues = []
    for (const pkg of packages) {
      if (pkg.status === 'delivered') delivered.push(pkg)
      else if (pkg.status === 'exception') issues.push(pkg)
      else active.push(pkg)
    }
    // Sort active by ETA (soonest first), then by created_at
    active.sort((a, b) => {
      if (a.eta && b.eta) return a.eta.localeCompare(b.eta)
      if (a.eta) return -1
      if (b.eta) return 1
      return new Date(b.created_at) - new Date(a.created_at)
    })
    delivered.sort((a, b) => new Date(b.delivered_at || b.updated_at) - new Date(a.delivered_at || a.updated_at))
    issues.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    return { active, delivered, issues }
  }, [packages])

  // Keep selected package in sync with latest data
  const selectedPkgData = selectedPkg ? packages.find(p => p.id === selectedPkg.id) || selectedPkg : null

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Packages</div>
        <button className="package-add-toggle" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus size={20} />
        </button>
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
          <div className="package-add-row">
            {detectedCarrier && (
              <span className="package-detected-carrier">
                {detectedCarrier.icon} {detectedCarrier.name}
              </span>
            )}
            {!detectedCarrier && trackingInput.trim().length >= 8 && (
              <span className="package-detected-carrier unknown">Unknown carrier</span>
            )}
            <button
              className="package-add-btn"
              onClick={handleAdd}
              disabled={!trackingInput.trim() || adding}
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

        {issues.length > 0 && (
          <div className="package-section">
            <h3 className="package-section-title">{'⚠️'} Issues ({issues.length})</h3>
            {issues.map(pkg => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onRefresh={onRefresh}
                onDelete={onDelete}
                onSelect={setSelectedPkg}
                apiAvailable={apiStatus.available}
              />
            ))}
          </div>
        )}

        {active.length > 0 && (
          <div className="package-section">
            <h3 className="package-section-title">{'🚚'} Active ({active.length})</h3>
            {active.map(pkg => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onRefresh={onRefresh}
                onDelete={onDelete}
                onSelect={setSelectedPkg}
                apiAvailable={apiStatus.available}
              />
            ))}
          </div>
        )}

        {delivered.length > 0 && (
          <div className="package-section">
            <h3 className="package-section-title">{'✅'} Delivered ({delivered.length})</h3>
            {delivered.map(pkg => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onRefresh={onRefresh}
                onDelete={onDelete}
                onSelect={setSelectedPkg}
                apiAvailable={apiStatus.available}
              />
            ))}
          </div>
        )}
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
