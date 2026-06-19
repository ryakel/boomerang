import { useEffect, useState } from 'react'
import AppV2 from './AppV2.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LoginScreen from './components/LoginScreen.jsx'
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
  // 'checking' until /api/auth/status resolves; 'ok' when auth is off OR we hold
  // a valid session; 'needed' when the server requires a login we don't have.
  const [authState, setAuthState] = useState('checking')

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', 'v2')
    if (!errorLoggingWired) {
      setupGlobalErrorLogging()
      errorLoggingWired = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setAuthState(!d.authEnabled || d.authenticated ? 'ok' : 'needed')
      })
      .catch(() => { if (!cancelled) setAuthState('ok') }) // fail open — don't lock out on a flaky status probe
    return () => { cancelled = true }
  }, [])

  if (authState === 'checking') return null
  if (authState === 'needed') return <LoginScreen onAuthenticated={() => setAuthState('ok')} />

  return (
    <ErrorBoundary>
      <AppV2 />
    </ErrorBoundary>
  )
}
