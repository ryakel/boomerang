import { useState } from 'react'
import './LoginScreen.css'

// Shown only when server-side auth is enabled (AUTH_PASSWORD set) and the
// browser has no valid session cookie. On success the httpOnly cookie is set by
// the server and every same-origin /api fetch + the SSE stream authenticate
// automatically — so we just reload into the app.
export default function LoginScreen({ onAuthenticated }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        onAuthenticated?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Login failed')
    } catch {
      setError('Network error — is the server reachable?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">boomerang.</div>
        <p className="login-sub">Sign in to continue</p>
        <input
          type="password"
          className="login-input"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="login-btn" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
