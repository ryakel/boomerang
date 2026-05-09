import { Component } from 'react'
import './ErrorBoundary.css'

// Defense in depth — catches render-time errors so a thrown exception in any
// v2 surface doesn't black-screen the app the way the TDZ bug did on
// 2026-05-09. React doesn't surface render errors to the console as hard
// failures; they propagate to the nearest error boundary, which by default
// at the root just unmounts the tree (leaving the dark fallback bg from
// :root tokens with no React content). Without a boundary, the user sees
// nothing.
//
// On catch: store error info in state, render a recoverable fallback, and
// fire a fetch to /api/logs so the server captures the stack for triage.
// Reload button forces a fresh mount; if the bug is in user-state (corrupt
// localStorage), Clear local state offers a recovery path.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    // Best-effort log to server. Doesn't await; offline-safe.
    try {
      fetch('/api/logs/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || String(error),
          stack: error?.stack || null,
          componentStack: errorInfo?.componentStack || null,
          url: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
        }),
      }).catch(() => { /* offline / endpoint missing — fallback UI still works */ })
    } catch { /* swallow */ }
  }

  handleReload = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister())
      }).catch(() => {})
    }
    window.location.reload()
  }

  handleClearLocal = () => {
    if (!confirm('Clear local state? This wipes localStorage (settings, labels, sync queue) on this device. Server-side tasks/routines are not affected.')) return
    try {
      localStorage.clear()
    } catch { /* swallow */ }
    this.handleReload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const message = this.state.error?.message || String(this.state.error)
    const stack = this.state.error?.stack
    const componentStack = this.state.errorInfo?.componentStack

    return (
      <div className="v2-error-boundary">
        <div className="v2-error-boundary-card">
          <div className="v2-error-boundary-emoji" aria-hidden="true">🪃</div>
          <h1 className="v2-error-boundary-title">Boomerang hit a snag</h1>
          <p className="v2-error-boundary-body">
            Something broke while rendering. The error has been logged. Reloading usually fixes transient issues; if it keeps happening, clearing local state is a safe escape hatch.
          </p>
          <details className="v2-error-boundary-details">
            <summary>Show details</summary>
            <div className="v2-error-boundary-detail-block">
              <div className="v2-error-boundary-detail-label">Message</div>
              <pre>{message}</pre>
            </div>
            {stack && (
              <div className="v2-error-boundary-detail-block">
                <div className="v2-error-boundary-detail-label">Stack</div>
                <pre>{stack}</pre>
              </div>
            )}
            {componentStack && (
              <div className="v2-error-boundary-detail-block">
                <div className="v2-error-boundary-detail-label">Component stack</div>
                <pre>{componentStack}</pre>
              </div>
            )}
          </details>
          <div className="v2-error-boundary-actions">
            <button type="button" className="v2-error-boundary-primary" onClick={this.handleReload}>
              Reload
            </button>
            <button type="button" className="v2-error-boundary-secondary" onClick={this.handleClearLocal}>
              Clear local state &amp; reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
