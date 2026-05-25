import { useState, useEffect } from 'react'
import AppV1 from './AppV1.jsx'
import AppV2 from './v2/AppV2.jsx'
import ErrorBoundary from './v2/components/ErrorBoundary.jsx'
import { loadSettings, logSystemError } from './store'

const STORAGE_KEY = 'ui_version'

function readVersion() {
  const params = new URLSearchParams(window.location.search)
  const urlFlag = params.get('ui')
  if (urlFlag === 'v1' || urlFlag === 'v2') {
    localStorage.setItem(STORAGE_KEY, urlFlag)
    params.delete('ui')
    const search = params.toString()
    window.history.replaceState({}, '', `/${search ? `?${search}` : ''}${window.location.hash}`)
    return urlFlag
  }
  return localStorage.getItem(STORAGE_KEY) === 'v1' ? 'v1' : 'v2'
}

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
  const [version] = useState(() => {
    const requested = readVersion()
    const settings = loadSettings()
    if (settings.v1_disabled && requested === 'v1') {
      logSystemError('v1 load blocked by Legacy toggle', 'Requested v1 but v1_disabled=true. Falling back to v2.')
      return 'v2'
    }
    return requested
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', version)
    if (!errorLoggingWired) {
      setupGlobalErrorLogging()
      errorLoggingWired = true
    }
  }, [version])

  if (version === 'v2') {
    return (
      <ErrorBoundary>
        <AppV2 />
      </ErrorBoundary>
    )
  }
  return <AppV1 />
}
