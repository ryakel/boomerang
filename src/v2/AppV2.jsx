import { useEffect } from 'react'
import './AppV2.css'

const STORAGE_KEY = 'ui_version'

export default function AppV2() {
  useEffect(() => {
    document.documentElement.setAttribute('data-ui', 'v2')
    return () => {
      document.documentElement.removeAttribute('data-ui')
    }
  }, [])

  const switchToV1 = () => {
    localStorage.setItem(STORAGE_KEY, 'v1')
    window.location.reload()
  }

  return (
    <div className="v2-shell">
      <div className="v2-welcome">
        <div className="v2-welcome-icon">✨</div>
        <h1 className="v2-welcome-title">v2 is on the way</h1>
        <p className="v2-welcome-body">
          You're trying the new interface. The redesign is being built incrementally —
          this is the foundation. Each release adds another piece: header, task cards,
          modals, analytics. You can flip back to v1 any time.
        </p>
        <button className="v2-welcome-back" onClick={switchToV1}>
          Back to v1
        </button>
        <div className="v2-welcome-meta">
          Toggle in Settings → Beta · or use <code>?ui=v1</code> / <code>?ui=v2</code>
        </div>
      </div>
    </div>
  )
}
