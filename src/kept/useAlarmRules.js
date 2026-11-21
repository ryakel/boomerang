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
  // Two errors, kept apart: a failed re-read clears itself on the next good
  // read, but an operation's own failure stays until you act again. They used
  // to share one slot, and the "alarms changed" event every operation sends
  // made this same card re-read and wipe its own error a moment after showing
  // it: Re-arm failed with a message that flashed and vanished (BOOM-56).
  const [loadError, setLoadError] = useState(null)
  const [opError, setOpError] = useState(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const running = useRef(false)

  const load = useCallback(async ({ sync = false } = {}) => {
    if (!available) return null
    try {
      if (sync) await refreshAlarmRuleState()
      const n = await alarmRuleStatus()
      const s = await alarmRuleApi.load()
      if (!alive.current) return null
      setNative(n); setState(s); setLoadError(null)
      return null
    } catch (e) {
      if (alive.current) setLoadError(e.message)
      return e.message || 'Could not read the alarm state.'
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
    setOpError(null)
    let failure = null
    try { await fn() } catch (e) { failure = e.message || 'Something went wrong.' }
    await load()
    running.current = false
    if (alive.current) { setBusy(false); setOpError(failure) }
    window.dispatchEvent(new Event(CHANGED))
    return !failure
  }, [load])

  return { available, state, native, error: opError || loadError, busy, load, run }
}
