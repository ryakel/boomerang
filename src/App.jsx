import { useState, useEffect } from 'react'
import AppV1 from './AppV1.jsx'
import AppV2 from './v2/AppV2.jsx'
import ErrorBoundary from './v2/components/ErrorBoundary.jsx'

const STORAGE_KEY = 'ui_version'

function readVersion() {
  // URL escape hatch wins and is sticky: ?ui=v1 / ?ui=v2 sets the flag, then
  // strips itself from the URL so deep-link params (e.g. ?task=X from
  // notifications) don't keep re-flipping it on subsequent loads.
  const params = new URLSearchParams(window.location.search)
  const urlFlag = params.get('ui')
  if (urlFlag === 'v1' || urlFlag === 'v2') {
    localStorage.setItem(STORAGE_KEY, urlFlag)
    params.delete('ui')
    const search = params.toString()
    window.history.replaceState({}, '', `/${search ? `?${search}` : ''}${window.location.hash}`)
    return urlFlag
  }
  // Default is v2 since the cutover. Only an explicit 'v1' opts out.
  // Existing users who chose v1 keep their preference; everyone else gets v2.
  return localStorage.getItem(STORAGE_KEY) === 'v1' ? 'v1' : 'v2'
}

export default function App() {
  const [version] = useState(readVersion)

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', version)
  }, [version])

  // Error boundary wraps v2 so a render-time exception (TDZ, undefined
  // hook return, broken third-party module) shows a recoverable fallback
  // with the actual error instead of a black screen. v1 stays unwrapped to
  // keep the legacy escape hatch identical to its historical behavior.
  if (version === 'v2') {
    return (
      <ErrorBoundary>
        <AppV2 />
      </ErrorBoundary>
    )
  }
  return <AppV1 />
}
