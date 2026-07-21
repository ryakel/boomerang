import { useEffect, useState } from 'react'
import AppV2 from './AppV2.jsx'
import ConnectionSetup from './components/ConnectionSetup.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import Logo from './components/Logo.jsx'
import { consumeConnectionSetupRequest, getApiBase, isNativeShell } from './apiConfig'
import { logSystemError } from './store'

// How long the boot auth probe may block the first paint. A fetch to an
// unreachable tailnet host (native shell off-VPN, offline PWA) doesn't
// reject — iOS drops the packets silently and lets it hang 60+ seconds —
// so without this cap the gate below held the app on a blank screen for
// the whole hang. Same trap, same remedy as BoomerangIntents.swift's 10s
// URLSession timeout; shorter here because the app has a cached UI to show.
const AUTH_PROBE_TIMEOUT_MS = 4000

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

// Shown while the auth probe is in flight — even the bounded wait above must
// never be a blank screen. Backgrounds come from the themed body, so this is
// just the mark, centered, with a soft pulse.
function BootSplash() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'boot-splash-pulse 1.6s ease-in-out infinite',
      }}
    >
      <style>{'@keyframes boot-splash-pulse { 0%, 100% { opacity: 0.9 } 50% { opacity: 0.45 } }'}</style>
      <Logo size={56} />
    </div>
  )
}

export default function App() {
  // 'checking' until /api/auth/status resolves; 'ok' when auth is off OR we hold
  // a valid session; 'needed' when the server requires a login we don't have.
  const [authState, setAuthState] = useState('checking')

  // Native shell with no server configured → Connection screen before anything
  // else (the /api probes below would just fail against capacitor://localhost).
  // Also reachable on demand: Settings → Data → Change server / the login
  // screen's escape hatch (sessionStorage flag), or ?connect=1 on the web.
  const [showConnect, setShowConnect] = useState(() =>
    (isNativeShell() && !getApiBase())
    || consumeConnectionSetupRequest()
    || new URLSearchParams(window.location.search).has('connect'))

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', 'v2')
    if (!errorLoggingWired) {
      setupGlobalErrorLogging()
      errorLoggingWired = true
    }
  }, [])

  useEffect(() => {
    // Known-offline → nothing to probe; go straight to the cached UI. The
    // server is the real enforcement, this gate is only login-screen UX.
    if (navigator.onLine === false) {
      setAuthState('ok')
      return undefined
    }
    let cancelled = false
    fetch('/api/auth/status', { signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS) })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setAuthState(!d.authEnabled || d.authenticated ? 'ok' : 'needed')
      })
      .catch(() => { if (!cancelled) setAuthState('ok') }) // fail open — timeout or flaky probe must never lock out
    return () => { cancelled = true }
  }, [])

  if (showConnect) {
    return (
      <ConnectionSetup
        onDone={() => window.location.reload()} // reload re-installs the fetch/SSE interceptor with the new config
        onCancel={getApiBase() || !isNativeShell() ? () => setShowConnect(false) : null}
      />
    )
  }
  if (authState === 'checking') return <BootSplash />
  if (authState === 'needed') return <LoginScreen onAuthenticated={() => setAuthState('ok')} />

  return (
    <ErrorBoundary>
      <AppV2 />
    </ErrorBoundary>
  )
}
