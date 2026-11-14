import { useCallback, useEffect, useRef, useState } from 'react'
import { alarmProbe } from '../alarmProbe'
import { SettingsGroup } from './settings'

export default function AlarmProbePanel() {
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('Checking this device…')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const running = useRef(false)
  const run = useCallback(async (action) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const result = await alarmProbe[action]()
      if (!alive.current) return
      if (!result.ok) {
        // Drop stale scheduling claims after any failed read or lost response.
        setStatus(null)
        setMessage(result.error || 'This native build does not support the alarm test.')
        return
      }
      setStatus(result)
      setMessage(result.authorization === 'denied'
        ? 'Alarm permission is off. You can change it in iOS Settings.'
        : result.authorization !== 'authorized'
          ? 'Allow alarm permission to inspect and start the test. No alarm was scheduled by this check.'
        : result.alarm
          ? `iOS reports the test alarm: ${result.alarm.state}. Sound has not been verified.`
          : action === 'cancel'
            ? 'iOS no longer lists the test alarm.'
            : 'iOS lists no test alarm. This does not tell us whether an earlier alarm was heard or stopped.')
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    run('status')
    // Re-read when returning from system UI; never arm an alarm on resume.
    const refresh = () => { if (document.visibilityState === 'visible') run('status') }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [run])

  return (
    <SettingsGroup caption="Alarm sound test">
      <div className="v2-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <p className="v2-settings-row-hint">
          One disposable alarm in 60 seconds, with a 1-minute snooze. It can sound through
          Silent and Focus. Stop ends the sound; it does not record departure or pickup.
          Keep your existing alarms while we test this.
        </p>
        <p role="status" aria-live="polite">{message}</p>
        {status && <p className="v2-settings-row-hint">Alarm permission: {status.authorization}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="v2-settings-btn" disabled={busy} onClick={() => run('status')}>Check alarm status</button>
          {status?.authorization === 'notDetermined' && (
            <button className="v2-settings-btn" disabled={busy} onClick={() => run('requestPermission')}>Allow test alarms</button>
          )}
          <button className="v2-settings-btn"
            disabled={busy || status?.authorization !== 'authorized' || !!status?.alarm}
            onClick={() => run('schedule')}>Sound test in 60 seconds</button>
          {/* Available even after a lost reply, so recovery does not require a known local ID. */}
          <button className="v2-settings-btn" disabled={busy} onClick={() => run('cancel')}>Cancel test alarm</button>
        </div>
      </div>
    </SettingsGroup>
  )
}
