import { useEffect } from 'react'
import AppV2 from './AppV2.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { logSystemError } from './store'

// The legacy v1 UI was removed (2026-06-10) — v2 is the only interface.
// The old `ui_version` localStorage flag and `?ui=` escape hatch are ignored.

function setupGlobalErrorLogging() {
  window.addEventListener('error', (event) => {
    const msg = event.message || 'Unknown error'
    const detail = [
      event.filename && `${event.filename}:${event.lineno}:${event.colno}`,
      event.error?.stack,
    ].filter(Boolean).join('\n')
    logSystemError(msg, detail)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = reason?.message || String(reason || 'Unhandled promise rejection')
    logSystemError(msg, reason?.stack || null)
  })
}

let errorLoggingWired = false

export default function App() {
  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', 'v2')
    if (!errorLoggingWired) {
      setupGlobalErrorLogging()
      errorLoggingWired = true
    }
  }, [])

  return (
    <ErrorBoundary>
      <AppV2 />
    </ErrorBoundary>
  )
}
