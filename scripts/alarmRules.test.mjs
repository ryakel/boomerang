import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import express from 'express'
import { validateAlarmRule, planAlarmRule, zonedInstant } from '../server/alarmSchedule.js'
import { createAlarmRuleStore, registerAlarmRuleRoutes } from '../server/alarmRuleRoutes.js'
const now=Date.parse('2026-11-18T18:00:00Z')
function rule(extra={}) { return {id:crypto.randomUUID(),sourceKind:'routine',sourceId:'r1',enabled:true,timeZone:'America/Chicago',weekly:[{weekday:3,time:'13:30'}],dates:[],leadMinutes:5,snoozeMinutes:5,ackLabel:'Leaving now',title:'School pickup',...extra} }
test('weekly and on-demand clocks are configuration, with date exceptions and fixed timezone',()=>{
  const r=rule({dates:[{date:'2026-11-19',time:'14:00'},{date:'2026-11-25',time:null}]})
  const p=planAlarmRule(r,{now})
  assert.equal(p.occurrences.length,4)
  assert.equal(p.occurrences[0].target,'2026-11-18T19:30:00.000Z')
  assert.equal(p.occurrences[0].early,'2026-11-18T19:25:00.000Z')
  assert.equal(p.occurrences[1].target,'2026-11-19T20:00:00.000Z')
  assert.ok(!p.occurrences.some(x=>x.date==='2026-11-25'))
  const alternative=planAlarmRule(rule({weekly:[{weekday:4,time:'09:10'}],leadMinutes:20,snoozeMinutes:3,ackLabel:'Started'}),{now})
  assert.equal(alternative.occurrences[0].target,'2026-11-19T15:10:00.000Z')
  assert.equal(alternative.occurrences[0].early,'2026-11-19T14:50:00.000Z')
})
test('acknowledgment suppresses one occurrence only; expired targets never rearm',()=>{
  const r=rule();const key=`${r.id}:2026-11-18`
  assert.ok(!planAlarmRule(r,{now,acknowledgments:{[key]:{}}}).occurrences.some(x=>x.date==='2026-11-18'))
  const p=planAlarmRule(r,{now:Date.parse('2026-11-18T19:27Z')})
  assert.equal(p.occurrences[0].earlyPending,false)
  assert.equal(planAlarmRule(r,{now:Date.parse('2026-11-18T19:31Z')}).occurrences[0].date,'2026-11-25')
})
test('DST conversion follows configured zone and rejects ambiguous/nonexistent clocks',()=>{
  assert.equal(new Date(zonedInstant('2027-03-17','13:30','America/Chicago')).toISOString(),'2027-03-17T18:30:00.000Z')
  assert.throws(()=>zonedInstant('2027-03-14','02:30','America/Chicago'),/does not exist/)
  assert.throws(()=>zonedInstant('2027-11-07','01:30','America/Chicago'),/Ambiguous/)
})
test('malformed policies do not silently become scheduling defaults',()=>{
  for(const invalid of [{weekly:[{weekday:8,time:'13:30'}]},{dates:[{date:'2026-02-30',time:'14:00'}]},{timeZone:'elsewhere'},{snoozeMinutes:0},{leadMinutes:NaN},{enabled:'true'}]) assert.throws(()=>validateAlarmRule(rule(invalid)))
})
function fixture() {
  let state;let flushes=0;let parent={title:'Source',status:'doing'}
  const deps={get:()=>state&&structuredClone(state),set:s=>{state=structuredClone(s)},flush:()=>{flushes++},source:()=>parent,now:()=>now,enabled:()=>true}
  return {store:createAlarmRuleStore(deps),deps,setParent:p=>{parent=p},flushes:()=>flushes}
}
test('CAS writes, phone binding and source uniqueness protect saved rules',()=>{
  const f=fixture(),r=rule(),device=crypto.randomUUID();const a=f.store.save(r.id,r,0,device)
  assert.equal(a.revision,1);assert.equal(f.flushes(),1)
  assert.throws(()=>f.store.save(r.id,r,0,device),/changed elsewhere/)
  assert.throws(()=>f.store.save(r.id,r,1,crypto.randomUUID()),/another phone/)
  assert.throws(()=>f.store.save(crypto.randomUUID(),r,0,device),/already has/)
})
test('local acknowledgment sync is idempotent and never completes the source',()=>{
  const f=fixture(),r=rule(),device=crypto.randomUUID();f.store.save(r.id,r,0,device)
  const a=f.store.acknowledge(r.id,'2026-11-18',device,'Leaving now',now/1000)
  const b=f.store.acknowledge(r.id,'2026-11-18',device,'Leaving now',now/1000)
  assert.equal(a.id,b.id);assert.equal(f.store.snapshot().rules[0].available,true)
  assert.equal(f.store.snapshot().plans[0].occurrences[0].date,'2026-11-25')
})
test('missing, completed and ordinary-reminder sources are held, not duplicated',()=>{
  const f=fixture(),r=rule();f.store.save(r.id,r,0,crypto.randomUUID())
  for(const parent of [null,{status:'done'},{status:'doing',remind:true},{paused:true},{spawn_mode:'autopilot'}]){f.setParent(parent);assert.equal(f.store.snapshot().plans[0].occurrences.length,0)}
})
test('a switched-off server refuses the API, and the API persists through the dedicated store',async t=>{
  const f=fixture(),app=express();let dev=false
  app.use(express.json());registerAlarmRuleRoutes(app,{...f.deps,enabled:()=>dev})
  const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());await new Promise(r=>server.once('listening',r))
  const base=`http://127.0.0.1:${server.address().port}/api/alarm-rules`
  assert.equal((await fetch(base)).status,403);dev=true
  const r=rule(),deviceId=crypto.randomUUID()
  const response=await fetch(`${base}/${r.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule:r,revision:0,deviceId})})
  assert.equal(response.status,200)
  const data=await(await fetch(base)).json();assert.equal(data.rules[0].id,r.id)
})

test('rule state survives dev reseeding and process-style database reopening',async t=>{
  const {mkdtempSync,rmSync}=await import('node:fs')
  const os=await import('node:os');const path=await import('node:path')
  const {initDb,setAlarmRuleState,getAlarmRuleState,clearAllData,flushNow}=await import('../server/db.js')
  const dir=mkdtempSync(path.join(os.tmpdir(),'alarm-rules-db-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'test.db');await initDb(file)
  const stored={rules:[rule()],acknowledgments:{example:{label:'Started'}}}
  setAlarmRuleState(stored);flushNow();clearAllData();flushNow()
  assert.deepEqual(getAlarmRuleState(),stored)
  await initDb(file);assert.deepEqual(getAlarmRuleState(),stored)
})

test('routine completion and skipped days suppress only their dates, preserving future weeks',()=>{
  const f=fixture(),r=rule();f.store.save(r.id,r,0,crypto.randomUUID())
  f.setParent({title:'Routine',completed_history:['2026-11-18'],skipped_days:['2026-11-25']})
  const s=f.store.snapshot()
  assert.equal(s.rules[0].available,true)
  assert.deepEqual(s.rules[0].heldDates,['2026-11-18','2026-11-25'])
  assert.equal(s.plans[0].occurrences[0].date,'2026-12-02')
})

// Arriving as done (BOOM-53): an optional place on the rule, validated as
// strictly as the clocks. Missing means off; it never invents coordinates.
test('an arrival place is optional, defaults its radius, and rejects bad coordinates', () => {
  assert.equal(validateAlarmRule(rule()).arrival, null)
  const ok = validateAlarmRule(rule({ arrival: { enabled: true, latitude: 41.88, longitude: -87.63, label: '  Lincoln Elementary  ' } }))
  assert.deepEqual(ok.arrival, { enabled: true, latitude: 41.88, longitude: -87.63, radius: 150, label: 'Lincoln Elementary' })
  for (const bad of [
    { enabled: 'yes', latitude: 1, longitude: 1, label: 'x' },
    { enabled: true, latitude: 91, longitude: 1, label: 'x' },
    { enabled: true, latitude: 1, longitude: -181, label: 'x' },
    { enabled: true, latitude: NaN, longitude: 1, label: 'x' },
    { enabled: true, latitude: 1, longitude: 1, label: '' },
    { enabled: true, latitude: 1, longitude: 1, radius: 20, label: 'x' },
  ]) assert.throws(() => validateAlarmRule(rule({ arrival: bad })))
  const store = createAlarmRuleStore({ get: () => s, set: (x) => { s = x }, flush: () => {}, source: () => ({ title: 'School pickup', status: 'active' }), now: () => now })
  let s
  const device = crypto.randomUUID(), id = crypto.randomUUID()
  store.save(id, rule({ arrival: { enabled: true, latitude: 41.88, longitude: -87.63, label: 'School' } }), 0, device)
  assert.equal(store.snapshot().rules[0].arrival.label, 'School', 'the place survives a save and a snapshot')
})
