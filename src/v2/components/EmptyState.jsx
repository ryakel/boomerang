import { useTerminalMode } from '../hooks/useTerminalMode'
import './EmptyState.css'

// Calm empty/placeholder primitive. In terminal mode, optional
// `terminalCommand` short-circuits the icon + title + body + CTA tree
// and renders a single `// comment` line instead — same vibe as a CLI
// "no results" output. Callers pass both forms so light/dark stay
// canonical and terminal feels native.
export default function EmptyState({ icon: Icon, title, body, cta, ctaOnClick, terminalCommand }) {
  const terminal = useTerminalMode()
  if (terminal && terminalCommand) {
    return (
      <div className="v2-empty v2-empty-terminal">
        <p className="v2-empty-terminal-line">{terminalCommand}</p>
        {cta && (
          <button className="v2-empty-cta" onClick={ctaOnClick}>
            {cta}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="v2-empty">
      {Icon && (
        <div className="v2-empty-icon">
          <Icon size={28} strokeWidth={1.5} />
        </div>
      )}
      <h2 className="v2-empty-title">{title}</h2>
      {body && <p className="v2-empty-body">{body}</p>}
      {cta && (
        <button className="v2-empty-cta" onClick={ctaOnClick}>
          {cta}
        </button>
      )}
    </div>
  )
}
