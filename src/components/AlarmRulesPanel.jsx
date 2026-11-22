import { useState } from 'react'
import { useAlarmRules } from '../kept/useAlarmRules'
import { armedRevisions, cancelAlarmRules, refreshAlarmRuleState } from '../alarmRules'
import { alarmCardStatus, ringsSummary, shortDate, STATUS_LABEL } from '../alarmRuleModel'
import { SettingsGroup } from './settings'
import './AlarmRulesPanel.css'

// Settings → Notifications → Alarms (BOOM-51). An overview of the alarms this
// phone knows about, plus the one action that belongs to the phone rather than
// to a loop: cancel everything. Changing an alarm happens on its loop's page;
// the raw rule form that used to live here is gone. Permission and the sound
// test stay in Test channels.
export default function AlarmRulesPanel() {
  const { available, state, native, error, busy, run } = useAlarmRules()
  const [confirm, setConfirm] = useState(false)

  if (!available) {
    return (
      <SettingsGroup caption="Alarms">
        <div className="v2-settings-row alarm-overview"><p>Alarms need the Boomerang Dev app on your phone.</p></div>
      </SettingsGroup>
    )
  }
  const now = Date.now()
  const rules = state?.rules || []
  const receipts = [...(native?.receipts || [])].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 5)

  return (
    <SettingsGroup caption="Alarms">
      <div className="v2-settings-row alarm-overview">
        <p>Set an alarm on a loop’s page: open the loop, then Alarm. This list shows what this phone holds.</p>
        {!state && !error && <p>Checking this phone…</p>}
        {state && rules.length === 0 && <p>No alarms yet.</p>}
        {rules.map(rule => {
          const s = alarmCardStatus({ rule, state, native, armedRevision: armedRevisions()[rule.id] ?? null, now })
          const through = s.status === 'armed' || s.status === 'changes' ? ` · through ${shortDate(s.armedThrough)}` : ''
          return (
            <div key={rule.id} className="alarm-overview-row">
              <div>
                <strong>{rule.title}</strong>
                <span>{ringsSummary(rule).join(' · ') || 'No days set'}</span>
              </div>
              <em>{STATUS_LABEL[s.status] || ''}{through}</em>
            </div>
          )
        })}
        {receipts.length > 0 && <p className="alarm-overview-sub">Recent</p>}
        {receipts.map(r => (
          <p key={r.key} className="alarm-overview-receipt">{shortDate(r.date)}: {r.label}, {r.synced ? 'synced' : 'saved on this phone, waiting to sync'}</p>
        ))}
        <p>Alarm permission: {native?.authorization || 'unavailable'}</p>
        {typeof native?.systemAlarms === 'number' && (
          // What iOS holds for this app, counted by iOS. It sets an alarm limit
          // per device and refuses past it (BOOM-56), so this is the number to read.
          <p>iOS holds {native.systemAlarms} alarm{native.systemAlarms === 1 ? '' : 's'} for this app, including warnings.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {native?.lastError && <p role="alert">{native.lastError}</p>}
        <div className="alarm-overview-actions">
          <button className="v2-settings-btn" disabled={busy} onClick={() => run(() => refreshAlarmRuleState())}>Check again</button>
          {!confirm
            ? <button className="v2-settings-btn" disabled={busy || !native?.available} onClick={() => setConfirm(true)}>Cancel all alarms on this phone</button>
            : <>
                <button className="v2-settings-btn alarm-overview-danger" disabled={busy} onClick={() => { setConfirm(false); run(() => cancelAlarmRules()) }}>Yes, cancel them all</button>
                <button className="v2-settings-btn" onClick={() => setConfirm(false)}>Keep them</button>
              </>}
        </div>
        {confirm && <p>Every armed alarm on this phone stops. Nothing re-arms until you arm it again on the loop’s page.</p>}
      </div>
    </SettingsGroup>
  )
}
