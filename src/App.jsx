import { useState, useEffect } from 'react'
import AppV1 from './AppV1.jsx'
import AppV2 from './v2/AppV2.jsx'

const STORAGE_KEY = 'ui_version'

function readVersion() {
  // URL escape hatch wins and is sticky: ?ui=v2 sets the flag, then strips
  // itself from the URL so deep-link params (e.g. ?task=X from notifications)
  // don't keep re-flipping it on subsequent loads.
  const params = new URLSearchParams(window.location.search)
  const urlFlag = params.get('ui')
  if (urlFlag === 'v1' || urlFlag === 'v2') {
    localStorage.setItem(STORAGE_KEY, urlFlag)
    params.delete('ui')
    const search = params.toString()
    window.history.replaceState({}, '', `/${search ? `?${search}` : ''}${window.location.hash}`)
    return urlFlag
  }
  return localStorage.getItem(STORAGE_KEY) === 'v2' ? 'v2' : 'v1'
}

export default function App() {
  const [version] = useState(readVersion)

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-version', version)
  }, [version])

  return version === 'v2' ? <AppV2 /> : <AppV1 />
}
