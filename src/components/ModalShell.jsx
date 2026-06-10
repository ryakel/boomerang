import { useEffect } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import { useWallabyMode } from '../hooks/useWallabyMode'
import { useIsDesktop } from '../hooks/useIsDesktop'
import './ModalShell.css'

export default function ModalShell({ open, onClose, title, subtitle, headerSlot, children, width = 'narrow', flexBody = false }) {
  // In Wallaby on mobile, modals are full-screen pages, so the dismiss control
  // is a back arrow (top-left) — consistent with the drill-down views — not a
  // dismiss X. Desktop/other themes keep the X. (Call both hooks unconditionally
  // — never short-circuit a hook call.)
  const wallaby = useWallabyMode()
  const isDesktop = useIsDesktop()
  const backNav = wallaby && !isDesktop
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="v2-modal-overlay" onClick={onClose}>
      <div
        className={`v2-modal v2-modal-${width}${flexBody ? ' v2-modal-flex' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <button className={`v2-modal-close${backNav ? ' v2-modal-back' : ''}`} onClick={onClose} aria-label={backNav ? 'Back' : 'Close'}>
          {backNav ? <ArrowLeft size={20} strokeWidth={2.25} /> : <X size={18} strokeWidth={1.75} />}
        </button>
        {headerSlot && <div className="v2-modal-header-slot">{headerSlot}</div>}
        <header className="v2-modal-header">
          <h1 className="v2-modal-title">{title}</h1>
          {subtitle && <p className="v2-modal-subtitle">{subtitle}</p>}
        </header>
        <div className={`v2-modal-body${flexBody ? ' v2-modal-body-flex' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
