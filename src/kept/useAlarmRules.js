import { useCallback, useEffect, useRef, useState } from 'react'
import { alarmRuleApi, alarmRuleStatus, alarmRulesAvailable, refreshAlarmRuleState } from '../alarmRules'

// The server's alarm state (rules + 28-day plans) and the phone's readback
// (what iOS holds), loaded together for the alarm card, Today and the Settings
// overview (BOOM-51). Renders nothing off the Dev native build.
//
// Reading never arms: refreshAlarmRuleState only syncs acknowledgments and
// cancels cues for rules that are off or held, the same as app launch.
// Any alarm action (arm, save, acknowledge) announces itself so every other
// view showing alarms re-reads: Today and a loop page can both be mounted
// (desktop, or a sheet over Today), and a stale "armed" is the worst lie here.
const CHANGED = 'boom-alarms-changed'

export function useAlarmRules() {
  const available = alarmRulesAvailable()
  const [state, setState] = useState(null)
  const [native, setNative] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const running = useRef(false)

  const load = useCallback(async ({ sync = false } = {}) => {
    if (!available) return
    try {
      if (sync) await refreshAlarmRuleState()
      const n = await alarmRuleStatus()
      const s = await alarmRuleApi.load()
      if (!alive.current) return
      setNative(n); setState(s); setError(null)
    } catch (e) {
      if (alive.current) setError(e.message)
    }
  }, [available])

  useEffect(() => {
    alive.current = true
    load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    const onChanged = () => { if (!running.current) load() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener(CHANGED, onChanged)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener(CHANGED, onChanged)
    }
  }, [load])

  // One operation at a time; always re-read afterwards so the card shows what
  // the server and the phone actually hold, not what we hoped they hold.
  const run = useCallback(async (fn) => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    let failure = null
    try { await fn() } catch (e) { failure = e.message || 'Something went wrong.' }
    // The re-read clears a stale error, so the operation's own error goes last.
    await load()
    running.current = false
    if (alive.current) { setBusy(false); setError(failure) }
    window.dispatchEvent(new Event(CHANGED))
    return !failure
  }, [load])

  return { available, state, native, error, busy, load, run }
}
