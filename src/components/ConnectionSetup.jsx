import { useState } from 'react'
import { getApiBase, getApiToken, setApiConfig } from '../apiConfig'
import './ConnectionSetup.css'

// Phase 1.5 of the native app: the in-app replacement for the old
// "set localStorage from Safari Web Inspector" step. Shown automatically in the
// Capacitor shell when no server is configured; reachable later from
// Settings → Data → Change server (and the login screen's escape hatch).
// Tests the connection before saving: /api/health proves the base URL is
// right, /api/auth/status with the token proves the credential is right.
function normalizeBase(input) {
  let base = String(input || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  return base
}

export default function ConnectionSetup({ onDone, onCancel }) {
  const [base, setBase] = useState(getApiBase())
  const [token, setToken] = useState(getApiToken())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function testAndSave(e) {
    e.preventDefault()
    if (busy) return
    const url = normalizeBase(base)
    if (!url) { setError('Enter the server URL.') ; return }
    setBusy(true)
    setError('')
    const tok = token.trim()
    try {
      const health = await fetch(`${url}/api/health`)
      if (!health.ok) throw new Error(`server responded ${health.status}`)

      const status = await fetch(`${url}/api/auth/status`, {
        headers: tok ? { 'x-api-token': tok } : {},
      }).then((r) => r.json())

      if (status.authEnabled && !status.authenticated) {
        setError(tok
          ? 'Reached the server, but it rejected this API token. Check the API_TOKEN value in the server environment.'
          : 'Reached the server, but it requires an API token.')
        return
      }

      setApiConfig({ base: url, token: tok })
      onDone?.()
    } catch (err) {
      setError(`Can't reach ${url} — ${err?.message || 'network error'}. Check the URL (and that this device can see the server).`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="conn-screen">
      <form className="conn-card" onSubmit={testAndSave}>
        <div className="conn-mark">boomerang.</div>
        <p className="conn-sub">Connect to your server</p>

        <label className="conn-label" htmlFor="conn-base">Server URL</label>
        <input
          id="conn-base"
          type="text"
          className="conn-input"
          placeholder="https://tasks.example.com"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          autoFocus={!base}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />

        <label className="conn-label" htmlFor="conn-token">API token</label>
        <input
          id="conn-token"
          type="text"
          className="conn-input conn-input-token"
          placeholder="Paste the server's API_TOKEN"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
        />

        {error && <div className="conn-error">{error}</div>}

        <button type="submit" className="conn-btn" disabled={busy || !base.trim()}>
          {busy ? 'Testing…' : 'Test & save'}
        </button>
        {onCancel && (
          <button type="button" className="conn-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </form>
    </div>
  )
}
