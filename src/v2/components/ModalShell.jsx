import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTerminalMode } from '../hooks/useTerminalMode'
import './ModalShell.css'

export default function ModalShell({ open, onClose, title, terminalTitle, subtitle, headerSlot, onTitleTap, children, width = 'narrow' }) {
  const terminal = useTerminalMode()
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
      <div className={`v2-modal v2-modal-${width}`} onClick={e => e.stopPropagation()}>
        <button className="v2-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.75} />
        </button>
        {headerSlot && <div className="v2-modal-header-slot">{headerSlot}</div>}
        <header className="v2-modal-header">
          <h1 className="v2-modal-title" onClick={onTitleTap}>{terminal && terminalTitle ? terminalTitle : title}</h1>
          {subtitle && <p className="v2-modal-subtitle">{subtitle}</p>}
        </header>
        <div className="v2-modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
