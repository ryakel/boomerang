import './AutosaveIndicator.css'

// Top-of-modal pill that reassures the user that field-level changes
// are being persisted automatically. Two states:
//
//   idle  → "Autosave" — quiet meta-color text
//   saved → "✓ Saved"  — flashes accent (light/dark) or terminal-accent
//                       for ~2s after each successful autosave
//
// Theme-aware via CSS gated on [data-theme^="terminal"].
//
// Caller drives the `saved` boolean via a setTimeout-cleared local flag,
// e.g. flip true when the autosave effect fires, back to false 2s later.
export default function AutosaveIndicator({ saved = false }) {
  return (
    <span className={`v2-autosave-pill${saved ? ' v2-autosave-pill-saved' : ''}`} aria-live="polite">
      {saved ? '✓ Saved' : 'Autosave'}
    </span>
  )
}
