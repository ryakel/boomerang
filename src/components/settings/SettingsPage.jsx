import { ChevronLeft } from 'lucide-react'
import './settings.css'

// One page in the settings stack (§6).
//
// The root index passes no `onBack` and renders no title block — the modal's
// own "Settings" header already names it. Sub-pages get a back affordance
// with a 44px target and their own title in the display face, one step down
// from the modal title.
export default function SettingsPage({ title, onBack, backLabel = 'Settings', children }) {
  return (
    <div className="v2-set-page">
      {onBack && (
        <div className="v2-set-page-head">
          <button type="button" className="v2-set-back" onClick={onBack}>
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
            <span>{backLabel}</span>
          </button>
          {title && <h2 className="v2-set-page-title">{title}</h2>}
        </div>
      )}
      {children}
    </div>
  )
}
