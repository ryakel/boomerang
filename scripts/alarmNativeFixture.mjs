// The browser tests' stand-in for case "apply" in
// ios/App/App/BoomerangAlarmRules.swift (target cues only; the fixture has no
// early cues). Keep it in step with the Swift. Until BOOM-56 the fixture
// re-scheduled cancelled cues and the Swift skipped them, so the harness passed
// Turn off → Turn on → Arm while on the phone that arming did nothing.
//
// rules: 'current' (BOOM-56) or 'before-boom-56', to show the old skip.
export function applyNativePlan(state, items, { rules = 'current' } = {}) {
  if (items.length > 16) throw Error('At most 16 occurrences fit in this trial.')
  const keep = new Set(items.map(x => x.key))
  // A plan cancels whatever it leaves out. Cancelled cues stay in the readback.
  state.cues = state.cues.map(c => keep.has(c.key) || c.state === 'cancelled' ? c : { ...c, state: 'cancelled' })
  for (const item of items) {
    if (state.receipts.some(r => r.key === item.key) || (state.arrivals || []).some(r => r.key === item.key)) continue
    const entry = JSON.stringify(item)
    const old = state.cues.find(c => c.key === item.key)
    if (old) {
      const live = old.state === 'scheduled'
      if (rules === 'before-boom-56') {
        if (old.state === 'cancelled') continue
        if (old.entry === entry) continue
        if (!live) continue
      } else if (live && old.entry === entry) continue
    }
    state.cues = state.cues.filter(c => c.key !== item.key).concat({ ...item, entry, earlyCue: false, state: 'scheduled' })
  }
}
