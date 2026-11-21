import crypto from 'node:crypto'
import { validateAlarmRule, validDate, planAlarmRule, sourceHeldDates } from './alarmSchedule.js'

// Dedicated collection; never rides the whole settings blob. All writes are CAS.
export function createAlarmRuleStore({get, set, flush, source, now=()=>Date.now()}) {
  const read=()=>get() || {rules:[],acknowledgments:{}}
  const persist=s=>{set(s);flush()}
  return {
    snapshot() {
      const state=read()
      const rules=state.rules.map(rule=>{
        const parent=source(rule.sourceKind,rule.sourceId)
        const available=!!parent && !['done','completed','cancelled','archived'].includes(parent.status) && parent.active!==false && !parent.paused && parent.spawn_mode!=='autopilot'
        const conflict=!!(parent && (rule.sourceKind==='task' ? parent.remind_at : parent.remind))
        return {...rule,title:parent?.title || 'Missing source',available,conflict,heldDates:rule.sourceKind==='routine' ? sourceHeldDates(parent,rule.timeZone) : []}
      })
      const plans=rules.map(rule=>({ruleId:rule.id,...planAlarmRule({...rule,enabled:rule.enabled && rule.available && !rule.conflict},{now:now(),acknowledgments:state.acknowledgments})}))
      return {...state,rules,plans}
    },
    save(id,input,revision,deviceId) {
      const rule=validateAlarmRule(input)
      if(!/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(deviceId || '')) throw Error('A native device identity is required.')
      const state=read(), old=state.rules.find(x=>x.id===id)
      if((old?.revision || 0)!==revision) throw Error('Rule changed elsewhere. Reload before saving.')
      if(old && old.deviceId!==deviceId) throw Error('This rule belongs to another phone. Manage it there.')
      if(!source(rule.sourceKind,rule.sourceId)) throw Error('Source no longer exists.')
      if(old && (old.sourceKind!==rule.sourceKind || old.sourceId!==rule.sourceId)) throw Error('Create a new rule to change its source.')
      if(state.rules.some(x=>x.id!==id && x.sourceKind===rule.sourceKind && x.sourceId===rule.sourceId)) throw Error('This source already has an alarm rule.')
      if(!old && state.rules.length>=16) throw Error('The dev trial supports at most 16 alarm rules.')
      const next={...rule,id,deviceId,revision:(old?.revision || 0)+1}
      // Validate dates/DST before persistence. No schedule side effect here.
      planAlarmRule({...next,title:'Preview'},{now:now()})
      state.rules=state.rules.filter(x=>x.id!==id).concat(next);persist(state)
      return next
    },
    acknowledge(id,date,deviceId,label,recordedAt) {
      const state=read(),rule=state.rules.find(x=>x.id===id)
      if(!rule || rule.deviceId!==deviceId || !validDate(date)) throw Error('Unknown rule, date or device.')
      if(typeof label!=='string' || !label.trim() || label.length>60 || !Number.isFinite(recordedAt) || recordedAt<=0 || recordedAt*1000>now()+60000) throw Error('Invalid local acknowledgment.')
      const key=`${id}:${date}`
      state.acknowledgments[key] ||= {id:crypto.randomUUID(),ruleId:id,date,label,recordedAt:new Date(recordedAt*1000).toISOString(),syncedAt:new Date(now()).toISOString()}
      persist(state);return state.acknowledgments[key]
    },
  }
}
export function registerAlarmRuleRoutes(app, deps) {
  const store=createAlarmRuleStore(deps)
  // Explicit dev trial. Promotion alone must not activate a production alarm API.
  app.use('/api/alarm-rules', (req,res,next)=>deps.isDev() ? next() : res.status(403).json({error:'Alarm rules are available on dev only.'}))
  app.get('/api/alarm-rules',(req,res)=>{try{res.set('Cache-Control','no-store').json(store.snapshot())}catch(e){res.status(409).json({error:e.message})}})
  app.put('/api/alarm-rules/:id',(req,res)=>{try{res.json(store.save(req.params.id,req.body.rule,req.body.revision,req.body.deviceId))}catch(e){res.status(409).json({error:e.message})}})
  app.post('/api/alarm-rules/:id/ack',(req,res)=>{try{res.json(store.acknowledge(req.params.id,req.body.date,req.body.deviceId,req.body.label,req.body.recordedAt))}catch(e){res.status(409).json({error:e.message})}})
}
