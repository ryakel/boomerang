/* global window, document */
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import {registerAlarmRuleRoutes} from '../server/alarmRuleRoutes.js'

// Arriving as done (BOOM-53) in a real browser: the alarm card's "Done when I
// arrive" row and sheet, the arming that hands the phone its places, an
// arrival the phone records, and the sync that turns it into a server record
// plus the app's mark-done call. The fake phone mirrors BoomerangAlarmRules.swift:
// an arrival counts within an hour of an armed target, cancels that occurrence
// and keeps the cancelled cue in the readback.
test('arriving at a saved place stops the day\'s alarm, marks the loop done and reads "Arrived at" on Today', {timeout:90000}, async t=>{
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const device='11111111-1111-1111-1111-111111111111'
  let data
  const src={id:'r-1',title:'School pickup',status:'active',remind:false}
  const api=express();api.use(express.json())
  registerAlarmRuleRoutes(api,{get:()=>data&&structuredClone(data),set:s=>{data=structuredClone(s)},flush:()=>{},source:(kind,id)=>kind==='routine'&&id==='r-1'?src:null,isDev:()=>true})
  const css=['/src/index.css','/src/AppV2.css','/src/components/SettingsModal.css','/src/kept/palette.css','/src/kept/shell.css','/src/kept/today2.css','/src/kept/loops2.css'].map(x=>`import '${x}';`).join('')
  const html=`<html data-ui="v2" data-theme="kept-light"><head><link rel="icon" href="data:,"></head><body><div id="root" class="v2-app"></div><script type="module">${css}import React from 'react';import{createRoot}from'react-dom/client';
    import AlarmCard from '/src/kept/AlarmCard.jsx';import TodayAlarm from '/src/kept/TodayAlarm.jsx';import {setArrivalHandler} from '/src/alarmRules.js';
    window.arrivalCalls=[];setArrivalHandler(a=>{window.arrivalCalls.push(a)});
    const h=React.createElement;
    createRoot(document.getElementById('root')).render(h('div',null,
      h('div',{className:'bm-t2 t2-tasks lp'},h(AlarmCard,{kind:'routine',sourceId:'r-1'})),
      h('div',{className:'bm-t2'},h(TodayAlarm))));</script></body></html>`
  const vite=await createServer({configFile:false,root:process.cwd(),plugins:[react(),{
    name:'arrival-native-fixture',enforce:'pre',
    resolveId(source,importer){
      if(importer?.endsWith('/alarmRules.js') && source==='@capacitor/core') return '\0arrival-proxy'
      if(importer?.endsWith('/alarmRules.js') && source.includes('apiConfig')) return '\0arrival-api'
    },
    load(id){
      if(id==='\0arrival-api') return `export const isNativeShell=()=>true;export async function readJson(r){const d=await r.json();if(!r.ok)throw Error(d.error);return d}`
      if(id==='\0arrival-proxy') return `import{registerPlugin as real}from'@capacitor/core';import{applyNativePlan}from'/scripts/alarmNativeFixture.mjs';
        const state=window.ruleNative={available:true,deviceId:'${device}',authorization:'authorized',cues:[],receipts:[],arrivals:[],places:[],arms:0,lastPlaces:null,dropped:[]};
        const loc=window.locationNative={available:true,authorization:'whenInUse',monitoring:true,precise:true,requests:[]};
        const snap=()=>({...state,placeRules:state.places.map(p=>p.ruleId)});
        // Mirrors AlarmRulesService.arrive: nearest armed target within an hour, once per occurrence.
        state.arrive=(ruleId)=>{const now=Date.now()/1000;const place=state.places.find(p=>p.ruleId===ruleId);if(!place)return false;
          const c=state.cues.filter(x=>x.ruleId===ruleId&&!x.earlyCue&&Math.abs(x.target-now)<=3600&&(x.state!=='cancelled'||state.receipts.some(r=>r.key===x.key))).sort((a,b)=>Math.abs(a.target-now)-Math.abs(b.target-now))[0];
          if(!c||state.arrivals.some(a=>a.key===c.key))return false;
          state.arrivals.push({key:c.key,ruleId,date:c.date,label:'Arrived at '+place.label,recordedAt:now,synced:false});
          state.cues=state.cues.map(x=>x.key===c.key?{...x,state:'cancelled'}:x);return true};
        export const registerPlugin=name=>real(name,{web:()=>({
          getStatus:async()=>snap(),
          applyPlan:async({items,places=[]})=>{applyNativePlan(state,items,{rules:window.__nativeRules});state.arms++;state.lastPlaces=places;state.places=places;return snap()},
          acknowledge:async({key})=>{const c=state.cues.find(x=>x.key===key);state.receipts.push({key,ruleId:c.ruleId,date:c.date,label:c.ackLabel,recordedAt:Date.now()/1000,synced:false});state.cues=state.cues.map(x=>x.key===key?{...x,state:'cancelled'}:x);return snap()},
          markSynced:async({key})=>{state.receipts.find(x=>x.key===key).synced=true;return snap()},
          arrivalSynced:async({key})=>{state.arrivals.find(x=>x.key===key).synced=true;return snap()},
          dropPlaces:async({ruleIds=[]})=>{state.dropped.push(...ruleIds);state.places=state.places.filter(p=>!ruleIds.includes(p.ruleId));return snap()},
          cancelRules:async({ruleIds=[],keys=[]})=>{state.cues=state.cues.map(x=>ruleIds.includes(x.ruleId)||keys.includes(x.key)?{...x,state:'cancelled'}:x);state.places=state.places.filter(p=>!ruleIds.includes(p.ruleId));return snap()},
          cancelAll:async()=>{state.cues=state.cues.map(x=>({...x,state:'cancelled'}));state.places=[];return snap()},
          locationStatus:async()=>({...loc}),
          // Like keeping "While Using" at iOS's Always prompt: the ask hangs a
          // while and changes nothing, so iOS never calls back.
          requestLocation:async({always})=>{loc.requests.push(!!always);if(always){await new Promise(r=>setTimeout(r,4000));return {...loc}}return {...loc}},
          currentLocation:async()=>({...loc,latitude:41.8781,longitude:-87.6298,accuracy:12}),
          geocode:async({address})=>({...loc,latitude:41.9,longitude:-87.65,name:'Lincoln Elementary, Chicago'}),
        })});`
    },
    configureServer(server){server.middlewares.use(api);server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__arrive')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__arrive',html))})}
  }],server:{host:'127.0.0.1',port:0}})
  t.after(()=>vite.close());await vite.listen()
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'America/Chicago'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{window.__BOOMERANG_ALARM_PROBE_BUILD__=true})
    // ALARM_NATIVE_RULES=before-boom-56 replays the phone's old skip of cancelled cues.
    await page.addInitScript(r=>{window.__nativeRules=r},process.env.ALARM_NATIVE_RULES||'current')
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__arrive`)
  const card=page.getByRole('region',{name:'Alarm',exact:true})
  const dialog=page.getByRole('dialog')
  const badge=text=>card.locator('.al-badge',{hasText:text}).waitFor()
  const native=fn=>page.evaluate(fn)

  // An alarm 20 minutes from now, today (a one-off), so an arrival is in the window.
  const fmt=(d,o)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',...o}).format(d)
  const soon=new Date(Date.now()+20*60000)
  const today=fmt(soon,{}), clock=fmt(soon,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  await card.getByRole('button',{name:'Set up an alarm'}).click()
  await dialog.getByLabel('One-off date').fill(today)
  await dialog.getByRole('radio',{name:'Ring at'}).click()
  await dialog.getByLabel('One-off time').fill(clock)
  await dialog.getByRole('button',{name:'Add',exact:true}).click()
  await dialog.getByRole('button',{name:'Save',exact:true}).click()
  await badge('Not armed yet')

  // The owner's order (2026-11-21): arm first, add the place, then re-arm.
  await card.getByRole('button',{name:'Arm on this phone'}).click()
  await badge('Armed on this phone')
  await card.getByRole('button',{name:/Done when I arrive\s*Off/}).click()
  await dialog.getByRole('button',{name:'Use where I am now'}).click()
  await dialog.getByText('Saved where you are now',{exact:false}).waitFor()
  await dialog.getByLabel('Place name').fill('Lincoln')
  const t0=Date.now()
  await dialog.getByRole('button',{name:'Save',exact:true}).click()
  // The place saves at once, even though the Always ask is still hanging, and
  // because the alarm is already armed the phone is updated right away (BOOM-55).
  await card.getByText('Updated on this phone.').waitFor()
  await badge('Armed on this phone')
  assert.ok(Date.now()-t0<3000,'saving never waits for the Always prompt')
  await card.getByRole('button',{name:/Done when I arrive\s*Lincoln/}).waitFor()
  assert.deepEqual(data.rules[0].arrival,{enabled:true,latitude:41.8781,longitude:-87.6298,radius:150,label:'Lincoln'})
  assert.deepEqual(await native(()=>window.locationNative.requests),[false,true],'While Using to read the spot, then Always because arrival was switched on')
  assert.equal(await native(()=>window.ruleNative.arms),2,'the save re-armed the already-armed alarm')

  // The card stays on Armed even after the hanging Always ask finally returns.
  const rev=data.rules[0].revision
  await page.waitForTimeout(4500)
  await native(()=>document.dispatchEvent(new Event('visibilitychange')))
  await badge('Armed on this phone')
  assert.equal(data.rules[0].revision,rev,'nothing saved the rule again after the re-arm')
  const places=await native(()=>window.ruleNative.lastPlaces)
  assert.equal(places.length,1)
  assert.equal(places[0].ruleId,data.rules[0].id)
  assert.equal(places[0].label,'Lincoln')
  await native(()=>{window.locationNative.authorization='always'})

  // Arrive. The phone cancels the day's cues and records it; the next sync
  // records it on the server and calls the app's mark-done handler.
  assert.equal(await native(()=>window.ruleNative.arrive(window.ruleNative.places[0].ruleId)),true)
  await native(async()=>{const m=await import('/src/alarmRules.js');await m.refreshAlarmRuleState();window.dispatchEvent(new Event('boom-alarms-changed'))})
  await page.getByText(/Arrived at Lincoln at \d/).waitFor()
  const calls=await native(()=>window.arrivalCalls)
  assert.equal(calls.length,1)
  assert.equal(calls[0].sourceKind,'routine')
  assert.equal(calls[0].sourceId,'r-1')
  assert.equal(calls[0].date,today)
  assert.equal(await native(()=>window.ruleNative.arrivals[0].synced),true,'marked synced only after the handler ran')
  assert.equal(Object.values(data.acknowledgments).length,1,'the server records the day')
  assert.equal(await native(()=>window.ruleNative.arrive(window.ruleNative.places[0].ruleId)),false,'one arrival per occurrence')

  // Missing Always shows up on the card, with the way to fix it.
  await native(()=>{window.locationNative.authorization='whenInUse';document.dispatchEvent(new Event('visibilitychange'))})
  await card.getByText('Arrival needs “Always” location',{exact:false}).waitFor()

  // The address path names the place from the lookup.
  await card.getByRole('button',{name:/Done when I arrive\s*Lincoln/}).click()
  await dialog.getByLabel('Place name').fill('')
  await dialog.getByLabel('Address').fill('123 School St')
  await dialog.getByRole('button',{name:'Find',exact:true}).click()
  await dialog.getByText('Found Lincoln Elementary, Chicago').waitFor()
  assert.equal(await dialog.getByLabel('Place name').inputValue(),'Lincoln Elementary, Chicago')

  // Turning arrival off. By now the day's only alarm is done (the arrival
  // completed it), so nothing is armed and the save doesn't re-arm; the next
  // sync's dropPlaces still stops the phone watching the place.
  await dialog.getByRole('radio',{name:'Off'}).click()
  await dialog.getByRole('button',{name:'Save',exact:true}).click()
  await card.getByRole('button',{name:/Done when I arrive\s*Off/}).waitFor()
  await native(async()=>{const m=await import('/src/alarmRules.js');await m.refreshAlarmRuleState()})
  assert.deepEqual(await native(()=>window.ruleNative.places),[],'the place is dropped')
  assert.equal(await native(()=>window.ruleNative.arms),2,'nothing armed, so no re-arm; dropPlaces did it')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no sideways scroll')
  await page.screenshot({path:'/tmp/boomerang-arrival-card.png',fullPage:true})
  assert.deepEqual(errors,[])
})
