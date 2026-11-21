import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, ChevronRight, MapPin, X } from 'lucide-react'
import SheetPortal from './SheetPortal'
import { useAlarmRules } from './useAlarmRules'
import { alarmLocation, alarmRuleApi, applyAlarmRulePlan, armedRevisions, refreshAlarmRuleState } from '../alarmRules'
import { alarmProbe } from '../alarmProbe'
import { alarmCardStatus, arrivalState, blankAlarmRule, STATUS_LABEL, ARRIVAL_WINDOW_MINUTES, clock12, ringsSummary, oneOffSummary, shortDate, dayDate, timeIn, DAY_LONG } from '../alarmRuleModel'
import { dateInZone } from '../../server/alarmSchedule.js'
import './alarm.css'

// The alarm on a loop's page (BOOM-51). It replaces the raw Settings form:
// what rings, when, and whether this phone has it armed. The rules that decide
// the state live in src/alarmRuleModel.js; this file only draws them.
//
// Two promises the card keeps, inherited from the dev trial (D014):
// - Saving never arms. Only "Arm" / "Re-arm" sends anything to the phone.
// - Nothing re-arms itself. When an arming runs low, the card asks.

const WEEK = [1, 2, 3, 4, 5, 6, 0]
const CHIP = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const LEADS = [2, 5, 10, 15, 30, 60]
const SNOOZES = [1, 3, 5, 10, 15]
const LABELS = ['Done', 'Leaving now', 'On my way', 'Taken']
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone


const BADGE_ON = new Set(['changes', 'armed'])

export default function AlarmCard({ kind = 'routine', sourceId, reminderOn = false, onTurnOffReminder }) {
  const { available, state, native, error, busy, load, run } = useAlarmRules()
  const [sheet, setSheet] = useState(null) // 'when' | 'lead' | 'snooze' | 'label' | 'arrive'
  // The phone's location permission, for arriving as done (BOOM-53). Re-read
  // on return from iOS Settings, where Always is granted.
  const [location, setLocation] = useState(null)
  const loadLocation = useCallback(() => {
    if (!available) return
    alarmLocation.status().then(setLocation).catch(() => setLocation({ available: false }))
  }, [available])
  useEffect(() => {
    loadLocation()
    const onVis = () => { if (document.visibilityState === 'visible') loadLocation() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadLocation])

  // Turning the loop's own reminder off goes through the normal sync; give it
  // a moment to land before asking the server whether the rule is still held.
  const firstRemind = useRef(true)
  useEffect(() => {
    if (firstRemind.current) { firstRemind.current = false; return }
    const t = setTimeout(() => load(), 1500)
    return () => clearTimeout(t)
  }, [reminderOn, load])

  if (!available) return null

  const rule = state?.rules.find(r => r.sourceKind === kind && r.sourceId === sourceId) || null
  const now = Date.now()
  const s = state ? alarmCardStatus({ rule, state, native, armedRevision: rule ? (armedRevisions()[rule.id] ?? null) : null, now }) : { status: 'loading' }
  const zone = rule?.timeZone || deviceZone()
  const todayKey = dateInZone(now, zone)
  const authorized = native?.authorization === 'authorized'
  const mine = !!native?.deviceId && (!rule || rule.deviceId === native.deviceId)

  const save = (patch) => run(async () => {
    if (!native?.deviceId) throw Error('Open Boomerang Dev on this phone to set alarms.')
    const base = rule || blankAlarmRule(kind, sourceId, deviceZone())
    await alarmRuleApi.save(rule?.id || crypto.randomUUID(), { ...base, ...patch }, rule?.revision || 0, native.deviceId)
    // Cancels this rule's cues if it is now off or held. Never arms.
    await refreshAlarmRuleState()
  }).then(ok => { if (ok) setSheet(null); return ok })

  const arm = () => run(async () => {
    const fresh = await alarmRuleApi.load()
    await applyAlarmRulePlan(fresh, native)
  })
  const allow = () => run(async () => {
    const r = await alarmProbe.requestPermission()
    if (!r.ok) throw Error(r.error || 'Could not ask for alarm permission.')
  })

  const badge = STATUS_LABEL[s.status] || ''
  const badgeClass = BADGE_ON.has(s.status) ? 'is-on' : ''
  const rings = rule ? ringsSummary(rule) : []
  const oneOff = rule ? oneOffSummary(rule, todayKey) : { skips: [], extras: [] }
  const next = (s.next || []).map(o => {
    const target = Date.parse(o.target)
    return { key: o.key, date: o.date, warn: timeIn(target - rule.leadMinutes * 60000, zone), at: timeIn(target, zone) }
  })

  // Arriving as done: what, if anything, stops it from working on this phone.
  const arrival = rule ? arrivalState(rule, location) : null
  const arrivalNote = {
    'needs-always': 'Arrival needs “Always” location to work while Boomerang is closed. The alarm works either way.',
    denied: 'Location is off for Boomerang, so arriving can’t be detected. The alarm still works.',
    unavailable: location?.needsRebuild ? 'Arriving as done needs the updated Dev app (one rebuild). The alarm still works.' : 'This phone can’t watch places right now. The alarm still works.',
  }[arrival] || null

  let note = null, primary = null, secondary = null
  const turnOff = { label: 'Turn off', fn: () => save({ enabled: false }) }
  switch (s.status) {
    case 'none':
      note = 'A real alarm on this phone. It rings through Silent and on the Lock Screen.'
      primary = { label: 'Set up an alarm', fn: () => setSheet('when') }
      break
    case 'not-armed':
      note = !s.armsThrough
        ? 'Your other alarms fill the phone’s 16 slots first. This one fits once some of theirs have passed.'
        : s.capped
        ? `The phone holds 16 alarms at a time, so arming covers through ${shortDate(s.armsThrough)}. You’ll be asked to re-arm before then.`
        : `Arming covers through ${shortDate(s.armsThrough)}. Saving a change never arms it.`
      primary = { label: 'Arm on this phone', fn: arm, needsAuth: true }
      secondary = turnOff
      break
    case 'changes':
      note = 'You changed this after arming. The phone keeps the old times until you re-arm.'
      primary = { label: 'Re-arm changes', fn: arm, needsAuth: true }
      secondary = turnOff
      break
    case 'armed':
      note = s.renewSoon
        ? `Armed through ${shortDate(s.armedThrough)}. Re-arm to add the next weeks.`
        : `Armed through ${shortDate(s.armedThrough)}. Changes you save wait here until you re-arm.`
      if (s.renewSoon) primary = { label: 'Re-arm to keep going', fn: arm, needsAuth: true }
      secondary = turnOff
      break
    case 'off':
      note = 'Nothing rings. Turning it on doesn’t arm it; you’ll review first.'
      primary = { label: 'Turn on', fn: () => save({ enabled: true }) }
      break
    case 'held-reminder':
      note = kind === 'routine'
        ? 'This loop’s phone reminder is on too. Turn it off so you don’t get both.'
        : 'This task’s reminder is on too. Turn it off so you don’t get both.'
      if (onTurnOffReminder) primary = { label: 'Turn off the reminder', fn: onTurnOffReminder }
      secondary = turnOff
      break
    case 'held-inactive':
      note = 'This loop is paused, ended or on autopilot, so the alarm won’t ring.'
      secondary = turnOff
      break
    case 'nothing-upcoming':
      note = 'Pick the days it rings.'
      primary = { label: 'Pick days', fn: () => setSheet('when') }
      secondary = turnOff
      break
    case 'other-phone':
      note = 'This alarm was set up on another phone. Change it there.'
      break
    default:
      break
  }

  const editable = !!rule && mine
  const row = (label, value, onOpen) => (
    <button key={label} className="al-kv" onClick={onOpen} disabled={!editable || busy}>
      <span>{label}</span><b>{value}</b>{editable && <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
    </button>
  )

  return (
    <section className="t2-card al-card" aria-label="Alarm">
      <div className="t2-head">
        <AlarmClock size={15} strokeWidth={2} style={{ color: 'var(--bm-ember)' }} aria-hidden="true" />
        <h2 className="t2-head-title">Alarm</h2>
        {badge && <span className={`al-badge ${badgeClass}`}>{badge}</span>}
      </div>

      {s.status === 'loading' && !error && <p className="al-note al-left">Checking this phone…</p>}

      {rule && s.status !== 'other-phone' && (
        <>
          {row('Rings', rings.length ? rings.map(l => <span key={l} className="al-line">{l}</span>) : 'Pick days', () => setSheet('when'))}
          {row('First warning', `${rule.leadMinutes} min before`, () => setSheet('lead'))}
          {row('Snooze', `${rule.snoozeMinutes} min`, () => setSheet('snooze'))}
          {row('Done button says', rule.ackLabel, () => setSheet('label'))}
          {(oneOff.skips.length > 0 || oneOff.extras.length > 0) &&
            row('One-off changes', [...oneOff.skips.map(x => `Skip ${x}`), ...oneOff.extras].map(l => <span key={l} className="al-line">{l}</span>), () => setSheet('when'))}
          {row('Done when I arrive', rule.arrival?.enabled ? rule.arrival.label : 'Off', () => setSheet('arrive'))}
          {rule.arrival?.enabled && arrival !== 'ready' && arrivalNote && (
            <p className="al-note al-left al-arrive-note" role="status">
              <MapPin size={13} strokeWidth={2.2} aria-hidden="true" /> {arrivalNote}
              {arrival === 'needs-always' && location?.authorization !== 'denied' && (
                <button className="t2-chip al-inline" disabled={busy} onClick={() => run(async () => { await alarmLocation.request(true) }).then(loadLocation)}>Allow</button>
              )}
            </p>
          )}
        </>
      )}

      {next.length > 0 && ['not-armed', 'changes', 'armed'].includes(s.status) && (
        <>
          <p className="al-sec">Next up</p>
          <p className="al-next">{next.map(n => <span key={n.key}><b>{dayDate(n.date)}</b> · warning {n.warn}, alarm {n.at}</span>)}</p>
        </>
      )}

      {primary?.needsAuth && native?.authorization === 'notDetermined' && (
        <p className="al-note al-left">Boomerang needs permission to set alarms on this phone.
          <button className="t2-chip al-inline" onClick={allow} disabled={busy}>Allow alarms</button></p>
      )}
      {primary?.needsAuth && native?.authorization === 'denied' && (
        <p className="al-note al-left" role="alert">Alarm permission is off. Turn it on in iOS Settings, Boomerang Dev, then come back.</p>
      )}

      {(primary || secondary) && (
        <div className="al-actions">
          {secondary && <button className="t2-btn t2-btn-ghost" onClick={secondary.fn} disabled={busy}>{secondary.label}</button>}
          {primary && <button className="t2-btn t2-btn-primary" onClick={primary.fn} disabled={busy || (primary.needsAuth && !authorized)}>{busy ? 'Working…' : primary.label}</button>}
        </div>
      )}
      {note && <p className="al-note">{note}</p>}
      {error && <p className="al-note al-error" role="alert">{error}</p>}
      {native?.lastError && <p className="al-note al-error" role="alert">{native.lastError}</p>}

      {sheet === 'when' && (
        <WhenSheet rule={rule || blankAlarmRule(kind, sourceId, deviceZone())} todayKey={todayKey} busy={busy}
          onClose={() => setSheet(null)} onSave={(patch) => save(patch)} />
      )}
      {sheet === 'lead' && (
        <ChoiceSheet title="First warning" sub="A gentler cue before the alarm itself. Snoozing it never pushes the alarm later."
          options={LEADS} value={rule.leadMinutes} format={n => `${n} min before`} busy={busy}
          onClose={() => setSheet(null)} onPick={(n) => save({ leadMinutes: n })} />
      )}
      {sheet === 'snooze' && (
        <ChoiceSheet title="Snooze" sub="How long Snooze waits after the alarm goes off."
          options={SNOOZES} value={rule.snoozeMinutes} format={n => `${n} min`} busy={busy}
          onClose={() => setSheet(null)} onPick={(n) => save({ snoozeMinutes: n })} />
      )}
      {sheet === 'label' && (
        <LabelSheet value={rule.ackLabel} busy={busy} onClose={() => setSheet(null)} onSave={(label) => save({ ackLabel: label })} />
      )}
      {sheet === 'arrive' && (
        <ArrivalSheet arrival={rule.arrival} location={location} busy={busy} onClose={() => setSheet(null)}
          onLocationChanged={loadLocation} onSave={(arrival) => save({ arrival })} />
      )}
    </section>
  )
}

function Sheet({ title, sub, onClose, children }) {
  return (
    <SheetPortal>
      <div className="bm-sheet-backdrop" onClick={onClose}>
        <div className="bm-sheet bm-t2 t2-sheet al-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
          <div className="bm-grabber" />
          <h2 className="bm-sheet-title">{title}</h2>
          {sub && <p className="t2-sheet-sub">{sub}</p>}
          {children}
        </div>
      </div>
    </SheetPortal>
  )
}

function WhenSheet({ rule, todayKey, busy, onClose, onSave }) {
  const [weekly, setWeekly] = useState(() => rule.weekly.map(x => ({ ...x })))
  const [dates, setDates] = useState(() => rule.dates.map(x => ({ ...x })))
  const [addDate, setAddDate] = useState('')
  const [addSkip, setAddSkip] = useState(true)
  const [addTime, setAddTime] = useState('')

  const lastTime = () => weekly.length ? weekly[weekly.length - 1].time : '09:00'
  const toggle = (day) => setWeekly(w => w.some(x => x.weekday === day)
    ? w.filter(x => x.weekday !== day)
    : [...w, { weekday: day, time: lastTime() }])
  const setTime = (day, time) => setWeekly(w => w.map(x => x.weekday === day ? { ...x, time } : x))
  const upcoming = dates.filter(d => d.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date))
  const add = () => {
    if (!addDate || (!addSkip && !addTime)) return
    setDates(d => d.filter(x => x.date !== addDate).concat({ date: addDate, time: addSkip ? null : addTime }))
    setAddDate(''); setAddTime('')
  }
  const valid = weekly.every(x => x.time) && (weekly.length > 0 || upcoming.some(d => d.time))

  return (
    <Sheet title="When it rings" sub="Tap the days. Each day can have its own time." onClose={onClose}>
      <div className="al-days" role="group" aria-label="Days">
        {WEEK.map(day => (
          <button key={day} className={weekly.some(x => x.weekday === day) ? 'is-on' : ''} aria-pressed={weekly.some(x => x.weekday === day)}
            aria-label={DAY_LONG[day]} onClick={() => toggle(day)}>{CHIP[day]}</button>
        ))}
      </div>
      {WEEK.filter(day => weekly.some(x => x.weekday === day)).map(day => (
        <label key={day} className="al-time">
          <span>{DAY_LONG[day]}</span>
          <input type="time" value={weekly.find(x => x.weekday === day).time} onChange={e => setTime(day, e.target.value)} aria-label={`${DAY_LONG[day]} time`} />
        </label>
      ))}

      <p className="al-sec">One-off changes</p>
      {upcoming.length === 0 && <p className="al-note al-left">Skip a day off, or add a day it should ring.</p>}
      {upcoming.map(d => (
        <div key={d.date} className="al-time">
          <span>{dayDate(d.date)}</span>
          <span className="al-oneoff">
            <i>{d.time ? clock12(d.time) : 'Skip'}</i>
            <button className="al-x" onClick={() => setDates(x => x.filter(y => y.date !== d.date))} aria-label={`Remove ${dayDate(d.date)}`}><X size={14} strokeWidth={2.2} /></button>
          </span>
        </div>
      ))}
      <div className="al-add">
        <input type="date" min={todayKey} value={addDate} onChange={e => setAddDate(e.target.value)} aria-label="One-off date" />
        <div className="al-add-row">
          <div className="al-toggle" role="radiogroup" aria-label="On that day">
            <button role="radio" aria-checked={addSkip} className={addSkip ? 'is-on' : ''} onClick={() => setAddSkip(true)}>Skip it</button>
            <button role="radio" aria-checked={!addSkip} className={!addSkip ? 'is-on' : ''} onClick={() => setAddSkip(false)}>Ring at</button>
          </div>
          {!addSkip && <input type="time" value={addTime} onChange={e => setAddTime(e.target.value)} aria-label="One-off time" />}
          <button className="t2-chip" onClick={add} disabled={!addDate || (!addSkip && !addTime)}>Add</button>
        </div>
      </div>

      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="t2-btn t2-btn-primary" disabled={busy || !valid} onClick={() => onSave({ weekly, dates })}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="al-note">Saved changes wait on the loop page until you arm them.</p>
    </Sheet>
  )
}

function ChoiceSheet({ title, sub, options, value, format, busy, onClose, onPick }) {
  return (
    <Sheet title={title} sub={sub} onClose={onClose}>
      <div className="al-choices" role="radiogroup" aria-label={title}>
        {options.map(n => (
          <button key={n} role="radio" aria-checked={n === value} className={n === value ? 'is-on' : ''} disabled={busy} onClick={() => onPick(n)}>{format(n)}</button>
        ))}
      </div>
    </Sheet>
  )
}

function LabelSheet({ value, busy, onClose, onSave }) {
  const [text, setText] = useState(value)
  const clean = text.trim()
  return (
    <Sheet title="Done button" sub="What you tap on Today to stop the rest of that day’s alarms. It doesn’t mark the loop done." onClose={onClose}>
      <input className="v2-form-input al-input" maxLength={60} value={text} onChange={e => setText(e.target.value)} aria-label="Done button text" />
      <div className="t2-picks al-picks">
        {LABELS.map(l => <button key={l} className="t2-pick" onClick={() => setText(l)}>{l}</button>)}
      </div>
      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="t2-btn t2-btn-primary" disabled={busy || !clean} onClick={() => onSave(clean)}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  )
}

// Arriving as done (BOOM-53): where the place is, what it's called, and
// whether arriving there counts. Saving it, like every other change here,
// waits on the card until you re-arm, which is what sends the place to the
// phone. Turning it off takes effect at the next sync without re-arming.
function ArrivalSheet({ arrival, location, busy, onClose, onSave, onLocationChanged }) {
  const [place, setPlace] = useState(() => arrival ? { latitude: arrival.latitude, longitude: arrival.longitude, radius: arrival.radius } : null)
  const [name, setName] = useState(arrival?.label || '')
  const [on, setOn] = useState(arrival ? arrival.enabled : true)
  const [address, setAddress] = useState('')
  const [working, setWorking] = useState(null)
  const [msg, setMsg] = useState(null)
  const blocked = location?.needsRebuild

  const act = async (kind, fn) => {
    setWorking(kind); setMsg(null)
    try { await fn() } catch (e) { setMsg({ error: true, text: e?.message || 'That didn’t work. Try again.' }) }
    finally { setWorking(null); onLocationChanged?.() }
  }
  const useHere = () => act('here', async () => {
    await alarmLocation.request(false)
    const r = await alarmLocation.current()
    setPlace({ latitude: r.latitude, longitude: r.longitude, radius: 150 })
    setName(n => n.trim() ? n : 'This place')
    setMsg({ text: `Saved where you are now${Number.isFinite(r.accuracy) ? ` (within about ${Math.round(r.accuracy)} m)` : ''}.` })
  })
  const find = () => act('find', async () => {
    const r = await alarmLocation.geocode(address)
    setPlace({ latitude: r.latitude, longitude: r.longitude, radius: 150 })
    setName(n => n.trim() ? n : (r.name || address.trim()))
    setMsg({ text: `Found ${r.name || address.trim()}.` })
  })
  const save = () => act('save', async () => {
    // Always is asked for only when arrival is being switched on.
    if (on && location?.authorization !== 'always') await alarmLocation.request(true)
    await onSave({ enabled: on, latitude: place.latitude, longitude: place.longitude, radius: place.radius ?? 150, label: name.trim() })
  })

  return (
    <Sheet title="Done when I arrive"
      sub={`Arriving here stops the rest of that day’s alarms, marks the loop done and sends a quiet notification. It only counts from ${ARRIVAL_WINDOW_MINUTES} minutes before to ${ARRIVAL_WINDOW_MINUTES} minutes after the alarm.`}
      onClose={onClose}>
      {blocked && <p className="al-note al-left" role="alert">This needs the updated Dev app (one rebuild).</p>}
      <p className="al-sec">The place</p>
      {place
        ? <p className="al-place"><MapPin size={14} strokeWidth={2.2} aria-hidden="true" /> {name.trim() || 'Saved place'}</p>
        : <p className="al-note al-left">No place yet. Save where you are, or look up an address.</p>}
      <div className="al-place-acts">
        <button className="t2-chip" disabled={!!working || blocked} onClick={useHere}>
          {working === 'here' ? 'Finding you…' : 'Use where I am now'}
        </button>
      </div>
      <div className="al-add-row al-address">
        <input className="v2-form-input al-input" placeholder="Or type an address" value={address} maxLength={300}
          onChange={e => setAddress(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && address.trim()) find() }} aria-label="Address" />
        <button className="t2-chip" disabled={!!working || blocked || !address.trim()} onClick={find}>{working === 'find' ? 'Looking…' : 'Find'}</button>
      </div>
      {msg && <p className={`al-note al-left${msg.error ? ' al-error' : ''}`} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}

      <p className="al-sec">Name</p>
      <input className="v2-form-input al-input" value={name} maxLength={80} placeholder="School" onChange={e => setName(e.target.value)} aria-label="Place name" />

      <div className="al-time">
        <span>Count arriving here</span>
        <div className="al-toggle" role="radiogroup" aria-label="Count arriving here">
          <button role="radio" aria-checked={on} className={on ? 'is-on' : ''} onClick={() => setOn(true)}>On</button>
          <button role="radio" aria-checked={!on} className={!on ? 'is-on' : ''} onClick={() => setOn(false)}>Off</button>
        </div>
      </div>
      {on && location?.authorization !== 'always' && !blocked && (
        <p className="al-note al-left">Saving asks iOS for “Always” location, so arriving counts even when Boomerang is closed. Only the arrival time is recorded.</p>
      )}

      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="t2-btn t2-btn-primary" disabled={busy || !!working || blocked || !place || !name.trim()} onClick={save}>
          {working === 'save' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="al-note">Like any change here, re-arm the alarm to send the place to the phone.</p>
    </Sheet>
  )
}

