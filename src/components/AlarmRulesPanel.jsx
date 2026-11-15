import { useCallback, useEffect, useState } from 'react'
import { alarmRuleApi, alarmRuleStatus, applyAlarmRulePlan, acknowledgeAlarmRule, cancelAlarmRules, refreshAlarmRuleState } from '../alarmRules'
import { readJson } from '../apiConfig'
import { SettingsGroup } from './settings'
import { dateInZone } from '../../server/alarmSchedule.js'
import './AlarmRulesPanel.css'

const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const blank=()=>({sourceKind:'task',sourceId:'',enabled:false,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,weekly:[],dates:[],leadMinutes:5,snoozeMinutes:5,ackLabel:'Acknowledged'})
export default function AlarmRulesPanel() {
  const [state,setState]=useState(null),[native,setNative]=useState(null),[sources,setSources]=useState([])
  const [draft,setDraft]=useState(blank),[selected,setSelected]=useState(null)
  const [message,setMessage]=useState('Loading alarm rules…'),[busy,setBusy]=useState(false)
  const [date,setDate]=useState(''),[time,setTime]=useState(''),[skip,setSkip]=useState(false)
  const load=useCallback(async()=>{
    const n=await alarmRuleStatus();setNative(n)
    // Local status stays usable when the server is offline.
    const s=await alarmRuleApi.load();setState(s)
    const res=await fetch('/api/data');const data=await readJson(res,'Sources')
    setSources([...(data.tasks||[]).map(x=>({...x,kind:'task'})),...(data.routines||[]).map(x=>({...x,kind:'routine'}))])
  },[])
  useEffect(()=>{load().then(()=>setMessage('Saving a rule does not arm alarms. Review the preview, then arm on this phone.')).catch(e=>setMessage(e.message))},[load])
  const run=async fn=>{if(busy)return;setBusy(true);try{await fn()}catch(e){setMessage(e.message);try{setNative(await alarmRuleStatus())}catch{/* retain last read */}}finally{setBusy(false)}}
  const update=(key,value)=>setDraft(d=>({...d,[key]:value}))
  const choose=rule=>{setSelected(rule);setDraft(rule ? {...rule} : blank())}
  const owned=state?.rules.filter(x=>x.deviceId===native?.deviceId) || []
  const cues=[...new Map((native?.cues||[]).filter(x=>x.target>Date.now()/1000-86400).map(x=>[x.key,x])).values()]
  const upcoming=cues.filter(x=>x.target>Date.now()/1000).sort((a,b)=>a.target-b.target)[0]?.key
  const visibleCues=cues.filter(x=>x.date===dateInZone(Date.now(),x.timeZone || draft.timeZone) || x.key===upcoming)
  const inputStyle={width:'100%',padding:10,marginTop:5,border:'1px solid var(--v2-border, #ddd)',borderRadius:8}
  return <SettingsGroup caption="Alarm rules · Dev trial">
    <div className="v2-settings-row alarm-rules">
      <p>Configure alarm cues for a task or routine. Save, review the upcoming times, then arm on this phone.</p>
      <details><summary>How these alarms behave</summary><p>Ordinary reminders for the source must be off before arming, to avoid duplicate alerts.</p>
      <p>Two cues: before the target, then at the target if unacknowledged. Early Snooze cannot postpone the target; after the target, Snooze uses the chosen interval. Stop silences that cue only. Acknowledgment cancels the remaining cues for that date and does not complete the task.</p></details>
      <p role="status">{message}</p>
      <button className="v2-settings-btn" disabled={busy} onClick={()=>run(async()=>{await refreshAlarmRuleState();await load();setMessage('Status refreshed. No alarms armed.')} )}>Refresh status</button>
      <button className="v2-settings-btn" disabled={busy || !native?.available} onClick={()=>run(async()=>{setNative(await cancelAlarmRules());setMessage('Owned rule alarms cancelled. Already armed dates are not recreated automatically.')} )}>Cancel rule alarms on this phone</button>
      {!native?.available && <p>Rule arming needs the updated Dev iOS app. Alarm permission is requested separately in Test channels.</p>}
      <p>Alarm permission: {native?.authorization || 'unavailable'}</p>{native?.lastError && <p role="alert">{native.lastError}</p>}
      {visibleCues.map(c=><div key={c.key} style={{padding:'12px 0',borderBottom:'1px solid #ddd'}}>
        <strong>{c.title}</strong> · {c.date}<p>iOS: {(native.cues||[]).filter(x=>x.key===c.key).map(x=>(x.earlyCue?'Early':'Target')+': '+x.state).join(' · ')}</p>
        <button className="v2-settings-btn" disabled={busy || dateInZone(Date.now(),c.timeZone || draft.timeZone)!==c.date} onClick={()=>run(async()=>{setNative(await acknowledgeAlarmRule(c.key));setMessage('Acknowledgment recorded locally. Any pending server sync is shown below.');await load()})}>{c.ackLabel}</button>
      </div>)}
      {(native?.receipts||[]).slice(-12).map(x=><p key={x.key}>{x.date}: {x.label} — {x.synced?'synced':'saved on this phone; server sync pending'}</p>)}
      <hr/><h3>Configure a rule</h3>
      <label>Rule<select style={inputStyle} value={selected?.id || ''} onChange={e=>choose(state?.rules.find(x=>x.id===e.target.value))}>
        <option value="">New rule</option>{state?.rules.map(x=><option key={x.id} value={x.id}>{x.title}{x.deviceId!==native?.deviceId?' (another phone)':''}</option>)}
      </select></label>
      <label>Task or routine<select style={inputStyle} disabled={!!selected} value={draft.sourceId ? draft.sourceKind+':'+draft.sourceId : ''} onChange={e=>{const index=e.target.selectedIndex-1;const x=sources[index];if(x)setDraft(d=>({...d,sourceKind:x.kind,sourceId:x.id}))}}>
        <option value="">Choose a source</option>{sources.map(x=><option key={x.kind+':'+x.id} value={x.kind+':'+x.id}>{x.kind}: {x.title}</option>)}
      </select></label>
      <label><input type="checkbox" checked={draft.enabled} onChange={e=>update('enabled',e.target.checked)}/> Include this rule in the reviewed plan</label>
      <label>Timezone<input style={inputStyle} value={draft.timeZone} onChange={e=>update('timeZone',e.target.value)}/></label>
      <fieldset className="alarm-rule-week"><legend>Weekly target times</legend>{days.map((day,weekday)=>{const row=draft.weekly.find(x=>x.weekday===weekday);return <div key={day}><label><input type="checkbox" checked={!!row} onChange={e=>update('weekly',e.target.checked?[...draft.weekly,{weekday,time:'12:00'}]:draft.weekly.filter(x=>x.weekday!==weekday))}/>{day}</label>{row&&<input aria-label={day+' target time'} type="time" value={row.time} onChange={e=>update('weekly',draft.weekly.map(x=>x.weekday===weekday?{...x,time:e.target.value}:x))}/>}</div>})}</fieldset>
      <fieldset><legend>On-demand dates and exceptions</legend>
        <label>Date<input style={inputStyle} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label><input type="checkbox" checked={skip} onChange={e=>setSkip(e.target.checked)}/> Skip this date</label>
        {!skip&&<label>Target time<input style={inputStyle} type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>}
        <button className="v2-settings-btn" disabled={!date || (!skip&&!time)} onClick={()=>update('dates',draft.dates.filter(x=>x.date!==date).concat({date,time:skip?null:time}))}>Add date override</button>
        {draft.dates.map(x=><p key={x.date}>{x.date}: {x.time || 'Skipped'} <button onClick={()=>update('dates',draft.dates.filter(y=>y.date!==x.date))}>Remove</button></p>)}
      </fieldset>
      <label>Early cue (minutes before target)<input style={inputStyle} type="number" min="1" max="120" value={draft.leadMinutes} onChange={e=>update('leadMinutes',Number(e.target.value))}/></label>
      <label>Snooze minutes<input style={inputStyle} type="number" min="1" max="30" value={draft.snoozeMinutes} onChange={e=>update('snoozeMinutes',Number(e.target.value))}/></label>
      <label>Acknowledgment button text<input style={inputStyle} maxLength="60" value={draft.ackLabel} onChange={e=>update('ackLabel',e.target.value)}/></label>
      <button className="v2-settings-btn" disabled={busy || !native?.deviceId || !draft.sourceId} onClick={()=>run(async()=>{
        const id=selected?.id || crypto.randomUUID();const saved=await alarmRuleApi.save(id,draft,selected?.revision || 0,native.deviceId);choose(saved);await refreshAlarmRuleState();await load();setMessage('Rule saved. Review the schedule below before arming. Disabled or inactive sources are cancelled; saving never adds alarms.');
      })}>Save rule without arming</button>
      <hr/><h3>Review upcoming alarms</h3>
      <p>Plans cover up to 28 days, at most 16 occurrences. They do not renew themselves. Return here to review and explicitly apply a later schedule. Already accepted cues that disappeared from iOS are not recreated.</p>
      {state?.rules.filter(x=>!x.available || x.conflict).map(x=><p key={x.id}>{x.title}: {x.conflict?'ordinary reminder still enabled; rule held':'source missing or inactive; rule held'}</p>)}
      {state?.plans.filter(x=>owned.some(r=>r.id===x.ruleId)).map(plan=><div key={plan.ruleId}>
        <p>{state.rules.find(x=>x.id===plan.ruleId)?.title} — through {plan.through}</p>
        {plan.occurrences.map(x=><p key={x.key}>{x.date}: {x.earlyPending?new Date(x.early).toLocaleTimeString([], {timeZone:state.rules.find(r=>r.id===x.ruleId).timeZone,hour:'2-digit',minute:'2-digit'})+' → ':''}{new Date(x.target).toLocaleTimeString([], {timeZone:state.rules.find(r=>r.id===x.ruleId).timeZone,hour:'2-digit',minute:'2-digit'})} ({state.rules.find(r=>r.id===x.ruleId).timeZone})</p>)}
      </div>)}
      <button className="v2-settings-btn" disabled={busy || !state || native?.authorization!=='authorized'} onClick={()=>run(async()=>{setNative(await applyAlarmRulePlan(state,native));setMessage('Plan applied. Readback below shows what iOS accepted, not proof of sound. No automatic renewal.');})}>Arm this reviewed plan on this phone</button>
    </div>
  </SettingsGroup>
}
