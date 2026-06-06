import { useEffect } from 'react'
import { useTerminalMode } from '../hooks/useTerminalMode'
import './ConfirmDialog.css'

// Generic confirm-dialog primitive for v2. Two-button modal — destructive
// confirm + cancel. Used wherever an action needs to pause for a "are you
// sure?" gate that benefits from full focus (something modal would dismiss
// like a tooltip can't carry).
//
// The state-owner passes `open=true` + `onConfirm` + `onCancel`. Title,
// body text, and confirm-button label are owned by the caller so each site
// can frame the question in its own voice (e.g. "Stop the follow-up chain?"
// vs "Clear all data?"). `tone="danger"` flips the confirm button into the
// red treatment used by Settings' destructive ops.
export default function ConfirmDialog({
  open,
  title,
  terminalTitle,
  body,
  confirmLabel = 'Confirm',
  terminalConfirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const terminal = useTerminalMode()
  // Escape closes; Enter doesn't auto-confirm because the destructive action
  // shouldn't be one keystroke away.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="v2-confirm-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="v2-confirm-title">
      <div className="v2-confirm" onClick={e => e.stopPropagation()}>
        <h3 id="v2-confirm-title" className="v2-confirm-title">{terminal && terminalTitle ? terminalTitle : title}</h3>
        {body && <p className="v2-confirm-body">{body}</p>}
        <div className="v2-confirm-actions">
          <button type="button" className="v2-confirm-btn v2-confirm-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`v2-confirm-btn v2-confirm-btn-${tone}`}
            onClick={onConfirm}
            autoFocus
          >
            {terminal && terminalConfirmLabel ? terminalConfirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
