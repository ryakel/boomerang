import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import './FormDisclosure.css'

// Hairline disclosure row — the Kept editor language (design doc §13b):
// the 2-3 decisions you actually make stay visible; everything else expands
// in place. Collapsed rows show a summary of what's set inside.
export default function FormDisclosure({ label, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`v2-form-disclosure${open ? ' is-open' : ''}`}>
      <button type="button" className="v2-form-disclosure-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="v2-form-disclosure-label">{label}</span>
        {summary && !open && <span className="v2-form-disclosure-sum">{summary}</span>}
        <ChevronDown size={15} strokeWidth={2} className="v2-form-disclosure-chev" />
      </button>
      {open && <div className="v2-form-disclosure-body">{children}</div>}
    </div>
  )
}
