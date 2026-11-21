import { registerPlugin } from '@capacitor/core'
import { isNativeShell, readJson } from './apiConfig'
import { sourceHeldDates } from '../server/alarmSchedule.js'
import { armWindow, ruleFields } from './alarmRuleModel'
import { safeSetItem } from './store'
const Native = registerPlugin('BoomerangAlarmRules')
const enabled=()=>isNativeShell() && window.__BOOMERANG_ALARM_PROBE_BUILD__===true
// The alarm interface renders only where arming can work: the Dev native build.
export const alarmRulesAvailable=enabled
// Which revision of each rule this phone last armed. The phone's readback has
// no lead/snooze, so this is how a settings-only edit shows as "changes
// waiting". A UI hint only: losing it just falls back to comparing times.
const ARMED_KEY='boom_alarm_armed_revisions'
export function armedRevisions() {
  try { return JSON.parse(localStorage.getItem(ARMED_KEY) || '{}') } catch { return {} }
}
let refreshTail=Promise.resolve()
async function api(path='',body,method='POST') {
  const res=await fetch(`/api/alarm-rules${path}`,body ? {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
  return readJson(res,'Alarm rules')
}
export const alarmRuleApi={
  load:()=>api(),
  save:(id,rule,revision,deviceId)=>api(`/${id}`,{rule:ruleFields(rule),revision,deviceId},'PUT'),
}
export async function alarmRuleStatus() {
  if(!enabled()) return {available:false,cues:[],receipts:[]}
  return Native.getStatus()
}
export async function applyAlarmRulePlan(state,status) {
  if(!enabled()) throw Error('Use the updated Boomerang Dev app.')
  const latest=await alarmRuleApi.load()
  if(JSON.stringify(latest)!==JSON.stringify(state)) throw Error('The schedule or source changed. Refresh and review before arming.')
  // The phone holds at most 16 occurrences and cancels anything a plan leaves
  // out, so one arming is the next 16 across every rule this phone owns.
  const items=armWindow(state,status.deviceId).items.map(e=>({...e,target:Date.parse(e.target)/1000,early:Date.parse(e.early)/1000}))
  const result=await Native.applyPlan({deviceId:status.deviceId,items})
  const revisions=Object.fromEntries(state.rules.filter(x=>x.deviceId===status.deviceId).map(x=>[x.id,x.revision]))
  safeSetItem(ARMED_KEY,JSON.stringify(revisions))
  return result
}
export async function acknowledgeAlarmRule(key) {
  // Native persists the declaration and cancels both owned cues even offline.
  const result=await Native.acknowledge({key})
  try { await refreshAlarmRuleState() } catch { /* native outbox survives; UI displays pending sync */ }
  return result
}
export const cancelAlarmRules=()=>Native.cancelAll()
async function syncAlarmRuleState() {
    const failures=[]
    const status=await Native.getStatus()
    if(!status.available) return
    for(const receipt of status.receipts || []) {
      if(receipt.synced) continue
      try {
        await api(`/${receipt.ruleId}/ack`,{date:receipt.date,deviceId:status.deviceId,label:receipt.label,recordedAt:receipt.recordedAt})
        await Native.markSynced({key:receipt.key})
      } catch(error) { failures.push(error.message) }
    }
    const state=await api()
    const own=state.rules.filter(x=>x.deviceId===status.deviceId)
    await Native.cancelRules({ruleIds:own.filter(x=>!x.enabled || !x.available || x.conflict).map(x=>x.id),keys:[...Object.keys(state.acknowledgments),...own.flatMap(rule=>(rule.heldDates || []).map(date=>rule.id+':'+date))]})
    // Read/cancel only: launch/resume never arms, extends or recreates alarms.
    if(failures.length) throw Error(`${failures.length} acknowledgment(s) remain pending server sync: ${failures[0]}`)
}
export function refreshAlarmRuleState() {
  if(!enabled()) return Promise.resolve()
  const next=refreshTail.catch(()=>{}).then(syncAlarmRuleState)
  refreshTail=next
  return next
}
export async function reconcileAlarmRuleSources(tasks, routines) {
  if(!enabled()) return
  let status
  try { status=await Native.getStatus() } catch(e) {
    if(['UNIMPLEMENTED','UNAVAILABLE'].includes(e.code)) return
    throw e
  }
  if(!status.available) return
  const records=new Map([...tasks.map(x=>['task:'+x.id,x]),...routines.map(x=>['routine:'+x.id,x])])
  const ruleIds=new Set(),keys=new Set()
  for(const cue of status.cues || []) {
    const parent=records.get(cue.sourceKind+':'+cue.sourceId)
    // Missing local rows may be an incomplete hydration; server refresh handles
    // confirmed deletion. Only cancel from positively known local state here.
    if(parent && cue.sourceKind==='routine' && sourceHeldDates(parent,cue.timeZone).includes(cue.date)) keys.add(cue.key)
    if(parent && (['done','completed','cancelled','archived'].includes(parent.status) || parent.paused || parent.spawn_mode==='autopilot' || (cue.sourceKind==='task' ? parent.remind_at : parent.remind))) ruleIds.add(cue.ruleId)
  }
  if(ruleIds.size || keys.size) await Native.cancelRules({ruleIds:[...ruleIds],keys:[...keys]})
}
export function initAlarmRuleLifecycle() {
  if(!enabled()) return
  const refresh=()=>{if(document.visibilityState==='visible')refreshAlarmRuleState().catch(e=>console.warn('[Alarm rules] refresh failed:',e.message))}
  refresh()
  document.addEventListener('visibilitychange',refresh)
  window.addEventListener('focus',refresh)
}
