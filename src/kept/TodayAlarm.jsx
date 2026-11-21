import { AlarmClock, Check } from 'lucide-react'
import { useAlarmRules } from './useAlarmRules'
import { acknowledgeAlarmRule, armedRevisions } from '../alarmRules'
import { alarmCardStatus, todayAlarms, shortDate, timeIn } from '../alarmRuleModel'
import './alarm.css'

// Today's alarms on this phone (BOOM-51): the time, the first warning and the
// done button ("Leaving now"), which stops that day's remaining alarms. It
// records the tap; it does not complete the loop. An acknowledged alarm stays
// as a quiet "done at" line so the morning after still makes sense.
// Also the one place a running-out arming is mentioned outside its loop page.
export default function TodayAlarm() {
  const { available, state, native, error, busy, run } = useAlarmRules()
  if (!available || !state || !native?.available) return null
  const now = Date.now()
  const items = todayAlarms({ state, native, now })
  const renew = (state.rules || []).filter(r => r.deviceId === native.deviceId).map(rule => ({
    rule, s: alarmCardStatus({ rule, state, native, armedRevision: armedRevisions()[rule.id] ?? null, now }),
  })).filter(x => x.s.renewSoon)
  if (!items.length && !renew.length) return null

  return (
    <section className="t2-card al-today" aria-label="Alarm today">
      <div className="t2-head">
        <AlarmClock size={15} strokeWidth={2} style={{ color: 'var(--bm-ember)' }} aria-hidden="true" />
        <h2 className="t2-head-title">{items.length ? 'Alarm today' : 'Alarms'}</h2>
      </div>
      {items.map((a, i) => {
        const zone = (state.rules.find(r => r.id === a.ruleId) || {}).timeZone
        return (
          <div key={a.key} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
            <div className="t2-row-body" style={{ cursor: 'default' }}>
              <span className={`t2-row-title${a.doneAt ? ' al-done' : ''}`}>{a.title}{a.target ? ` · ${timeIn(a.target, zone)}` : ''}</span>
              <span className="t2-row-meta">
                {a.doneAt
                  ? `${a.doneLabel || a.ackLabel} at ${timeIn(a.doneAt, zone)}`
                  : a.ringing ? 'Ringing now' : [a.early ? `First warning ${timeIn(a.early, zone)}` : null, 'armed on this phone'].filter(Boolean).join(' · ')}
              </span>
            </div>
            {a.doneAt
              ? <span className="al-check" aria-label="Done"><Check size={15} strokeWidth={2.6} /></span>
              : <button className="t2-chip" disabled={busy} onClick={() => run(() => acknowledgeAlarmRule(a.key))}>{a.ackLabel}</button>}
          </div>
        )
      })}
      {renew.map(({ rule, s }) => (
        <p key={rule.id} className="al-note al-left">{rule.title} alarms run out {shortDate(s.armedThrough)}. Re-arm on its loop page.</p>
      ))}
      {error && <p className="al-note al-error" role="alert">{error}</p>}
    </section>
  )
}
