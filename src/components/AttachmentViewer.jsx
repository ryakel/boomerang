import { useEffect, useMemo, useState } from 'react'
import { X as XIcon, Download, Share2 } from 'lucide-react'
import './AttachmentViewer.css'

// Full-screen viewer for task attachments. Attachments are stored as base64
// in the task row ({ id, name, type, size, data }) and until this component
// existed there was NO way to open one — the edit-modal list showed only
// name + size + remove (prod report 2026-07-17: "uploaded an image and I
// cannot do anything with that image, at least on mobile").
//
// Rendering is all local (data: / blob: URLs) — nothing is fetched. New-tab
// blob URLs are unreliable inside the iOS shell (capacitor:// origin), so
// preview happens in an in-app overlay; Share uses the native share sheet
// (navigator.share with a File — on iOS that includes "Save Image"/"Save to
// Files"), with a plain <a download> fallback for desktop browsers.

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default function AttachmentViewer({ attachment, onClose }) {
  const [shareError, setShareError] = useState(null)
  const { name, type, data } = attachment || {}

  const kind = useMemo(() => {
    if (!type) return 'other'
    if (type.startsWith('image/')) return 'image'
    if (type === 'application/pdf') return 'pdf'
    if (type.startsWith('text/')) return 'text'
    return 'other'
  }, [type])

  // Blob URL for pdf preview + downloads; data: URL is fine for <img>.
  const blobUrl = useMemo(() => {
    if (!data) return null
    try {
      return URL.createObjectURL(new Blob([base64ToBytes(data)], { type: type || 'application/octet-stream' }))
    } catch { return null }
  }, [data, type])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  const textContent = useMemo(() => {
    if (kind !== 'text' || !data) return null
    try {
      return decodeURIComponent(escape(atob(data)))
    } catch { return '(could not decode text)' }
  }, [kind, data])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  if (!attachment) return null

  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && (() => {
    try {
      const f = new File([base64ToBytes(data)], name || 'attachment', { type: type || 'application/octet-stream' })
      return navigator.canShare({ files: [f] })
    } catch { return false }
  })()

  const handleShare = async () => {
    setShareError(null)
    try {
      const file = new File([base64ToBytes(data)], name || 'attachment', { type: type || 'application/octet-stream' })
      await navigator.share({ files: [file] })
    } catch (e) {
      // AbortError = user dismissed the sheet; anything else is worth surfacing.
      if (e?.name !== 'AbortError') setShareError('Could not open the share sheet')
    }
  }

  return (
    <div className="attach-viewer-overlay" onClick={onClose} role="dialog" aria-label={`Attachment: ${name}`}>
      <div className="attach-viewer" onClick={e => e.stopPropagation()}>
        <div className="attach-viewer-head">
          <span className="attach-viewer-name" title={name}>{name}</span>
          <div className="attach-viewer-actions">
            {canShare && (
              <button type="button" className="attach-viewer-btn" onClick={handleShare} aria-label="Share">
                <Share2 size={17} strokeWidth={2} />
              </button>
            )}
            {blobUrl && (
              <a className="attach-viewer-btn" href={blobUrl} download={name || 'attachment'} aria-label="Download">
                <Download size={17} strokeWidth={2} />
              </a>
            )}
            <button type="button" className="attach-viewer-btn attach-viewer-close" onClick={onClose} aria-label="Close">
              <XIcon size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
        {shareError && <div className="attach-viewer-error">{shareError}</div>}
        <div className="attach-viewer-body">
          {kind === 'image' && (
            <img className="attach-viewer-img" src={`data:${type};base64,${data}`} alt={name} />
          )}
          {kind === 'pdf' && blobUrl && (
            <iframe className="attach-viewer-pdf" src={blobUrl} title={name} />
          )}
          {kind === 'text' && (
            <pre className="attach-viewer-text">{textContent}</pre>
          )}
          {(kind === 'other' || (kind === 'pdf' && !blobUrl)) && (
            <div className="attach-viewer-none">
              No preview for this file type — use {canShare ? 'Share or ' : ''}Download above.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
