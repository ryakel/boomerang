/* global window, document */
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import {registerAlarmRuleRoutes} from '../server/alarmRuleRoutes.js'

// The alarm interface (BOOM-51) driven in a real browser: the loop page's
// Alarm card, Today's alarm card and the Settings overview, against the real
// server routes and a fake native daemon. Guarantees carried over from the dev
// trial's form test: saving never arms an alarm that isn't armed yet (once
// armed, saving re-arms: BOOM-55), a stale plan is refused, the done
// button syncs, a stopped source cancels its alarms, and loading never arms.
// New here: one arming never sends the phone more than 16 occurrences, and a
// loop whose own reminder is on holds its alarm and offers to turn it off.
test('alarm card sets up, arms and acknowledges a loop alarm; saving never arms', {timeout:90000}, async t=>{
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const device='11111111-1111-1111-1111-111111111111'
  let data, src
  const api=express();api.use(express.json())
  registerAlarmRuleRoutes(api,{get:()=>data&&structuredClone(data),set:s=>{data=structuredClone(s)},flush:()=>{},source:(kind,id)=>kind==='routine'&&id==='r-1'?src:null,isDev:()=>true})
  const css=['/src/index.css','/src/AppV2.css','/src/components/SettingsModal.css','/src/kept/palette.css','/src/kept/shell.css','/src/kept/today2.css','/src/kept/loops2.css'].map(x=>`import '${x}';`).join('')
  const html=`<html data-ui="v2" data-theme="kept-light"><head><link rel="icon" href="data:,"></head><body><div id="root" class="v2-app"></div><script type="module">${css}import React from 'react';import{createRoot}from'react-dom/client';
    import AlarmCard from '/src/kept/AlarmCard.jsx';import TodayAlarm from '/src/kept/TodayAlarm.jsx';import Panel from '/src/components/AlarmRulesPanel.jsx';
    const h=React.createElement;
    createRoot(document.getElementById('root')).render(h('div',null,
      h('div',{className:'bm-t2 t2-tasks lp'},h(AlarmCard,{kind:'routine',sourceId:'r-1',reminderOn:!!window.__remind,onTurnOffReminder:()=>{window.turnedOff=(window.turnedOff||0)+1}})),
      h('div',{className:'bm-t2'},h(TodayAlarm)),
      h(Panel)));</script></body></html>`
  const vite=await createServer({configFile:false,root:process.cwd(),plugins:[react(),{
    name:'rules-native-fixture',enforce:'pre',
    resolveId(source,importer){
      if(importer?.endsWith('/alarmRules.js') && source==='@capacitor/core') return '\0rules-proxy'
      if(importer?.endsWith('/alarmRules.js') && source.includes('apiConfig')) return '\0rules-api'
    },
    load(id){
      if(id==='\0rules-api') return `export const isNativeShell=()=>true;export async function readJson(r){const d=await r.json();if(!r.ok)throw Error(d.error);return d}`
      if(id==='\0rules-proxy') return `import{registerPlugin as real}from'@capacitor/core';
        const state=window.ruleNative={available:true,deviceId:'${device}',authorization:'authorized',cues:[],receipts:[],arms:0,lastItems:0};
        export const registerPlugin=name=>real(name,{web:()=>({
          getStatus:async()=>({...state}),
          // Like BoomerangAlarmRules.swift: cancelled cues stay in the readback
          // with state 'cancelled'; a plan cancels whatever it leaves out.
          applyPlan:async({items})=>{if(items.length>16)throw Error('At most 16 occurrences fit in this trial.');state.arms++;state.lastItems=items.length;const keep=new Set(items.map(x=>x.key));state.cues=state.cues.filter(x=>!keep.has(x.key)).map(x=>({...x,state:'cancelled'})).concat(items.map(x=>({...x,earlyCue:false,state:'scheduled'})));return {...state}},
          acknowledge:async({key})=>{const c=state.cues.find(x=>x.key===key);state.receipts.push({key,ruleId:c.ruleId,date:c.date,label:c.ackLabel,recordedAt:Date.now()/1000,synced:false});state.cues=state.cues.map(x=>x.key===key?{...x,state:'cancelled'}:x);return{...state}},
          markSynced:async({key})=>{state.receipts.find(x=>x.key===key).synced=true;return{...state}},
          cancelRules:async({ruleIds=[],keys=[]})=>{state.cues=state.cues.map(x=>ruleIds.includes(x.ruleId)||keys.includes(x.key)?{...x,state:'cancelled'}:x);return {...state}},cancelAll:async()=>{state.cues=state.cues.map(x=>({...x,state:'cancelled'}));return{...state}}
        })});`
    },
    configureServer(server){server.middlewares.use(api);server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__rules')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__rules',html))})}
  }],server:{host:'127.0.0.1',port:0}})
  t.after(()=>vite.close());await vite.listen()
  const url=`http://127.0.0.1:${vite.httpServer.address().port}/__rules`
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});t.after(()=>browser.close())
  const arms=page=>page.evaluate(()=>window.ruleNative.arms)
  const live=page=>page.evaluate(()=>window.ruleNative.cues.filter(x=>x.state!=='cancelled').length)
  for(const width of [320,960]){
    data=undefined
    src={id:'r-1',title:'School pickup',status:'active',remind:false}
    const page=await browser.newPage({viewport:{width,height:900},timezoneId:'America/Chicago'})
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(()=>{window.__BOOMERANG_ALARM_PROBE_BUILD__=true})
    await page.goto(url)
    const card=page.getByRole('region',{name:'Alarm',exact:true})
    const badge=text=>card.locator('.al-badge',{hasText:text}).waitFor()
    const dialog=page.getByRole('dialog')

    // Set up: Wednesday at 1:30, plus a one-off tonight at 11:59 so Today has something.
    await card.getByRole('button',{name:'Set up an alarm'}).click()
    await dialog.getByRole('button',{name:'Wednesday'}).click()
    await dialog.getByLabel('Wednesday time').fill('13:30')
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())
    await dialog.getByLabel('One-off date').fill(today)
    await dialog.getByRole('radio',{name:'Ring at'}).click()
    await dialog.getByLabel('One-off time').fill('23:59')
    await dialog.getByRole('button',{name:'Add',exact:true}).click()
    await dialog.getByRole('button',{name:'Save',exact:true}).click()
    await badge('Not armed yet')
    assert.equal(await arms(page),0,'saving never arms')
    assert.deepEqual(data.rules[0].weekly,[{weekday:3,time:'13:30'}])
    assert.equal(data.rules[0].dates.find(x=>x.date===today).time,'23:59')
    assert.equal(data.rules[0].timeZone,'America/Chicago')

    // The done button's words.
    await card.getByRole('button',{name:/Done button says/}).click()
    await dialog.getByLabel('Done button text').fill('Leaving now')
    await dialog.getByRole('button',{name:'Save',exact:true}).click()
    await card.getByRole('button',{name:/Done button says\s*Leaving now/}).waitFor()
    assert.equal(await arms(page),0,'still not armed after another save')

    // Arm, then acknowledge from Today.
    await card.getByRole('button',{name:'Arm on this phone'}).click()
    await badge('Armed on this phone')
    assert.equal(await arms(page),1)
    await page.getByRole('button',{name:'Leaving now',exact:true}).click()
    await page.getByText(/Leaving now at \d/).waitFor()
    assert.equal(Object.keys(data.acknowledgments).length,1,'the tap synced to the server')

    // Every day: more than the phone holds. One arming sends the next 16.
    await card.getByRole('button',{name:/^Rings/}).click()
    for(const day of ['Monday','Tuesday','Thursday','Friday','Saturday','Sunday']) await dialog.getByRole('button',{name:day}).click()
    await dialog.getByRole('button',{name:'Save',exact:true}).click()
    // Already armed, so saving updates the phone right away (BOOM-55).
    await card.getByText('Updated on this phone.').waitFor()
    await badge('Armed on this phone')
    assert.equal(await arms(page),2)
    assert.equal(await page.evaluate(()=>window.ruleNative.lastItems),16,'never more than the phone accepts')

    // A plan reviewed before the rule changed elsewhere is refused.
    await page.evaluate(async()=>{const m=await import('/src/alarmRules.js');window.__stale=await m.alarmRuleApi.load()})
    data.rules[0].revision++
    const refused=await page.evaluate(async()=>{const m=await import('/src/alarmRules.js');try{await m.applyAlarmRulePlan(window.__stale,await m.alarmRuleStatus());return null}catch(e){return e.message}})
    assert.match(refused||'',/changed/)
    assert.equal(await arms(page),2)
    data.rules[0].revision--

    // Settings lists it.
    await page.locator('.alarm-overview-row',{hasText:'School pickup'}).filter({hasText:'Every day 1:30 PM'}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no sideways scroll')
    await page.screenshot({path:`/tmp/boomerang-alarm-card-${width}.png`,fullPage:true})

    // Turn off cancels this rule's alarms on the phone without arming anything.
    await card.getByRole('button',{name:'Turn off',exact:true}).click()
    await badge('Off')
    assert.equal(await live(page),0)
    assert.equal(await arms(page),2)

    // Back on and armed, then the loop is paused: its alarms are cancelled.
    await card.getByRole('button',{name:'Turn on'}).click()
    await badge('Not armed yet')
    await card.getByRole('button',{name:'Arm on this phone'}).click()
    await badge('Armed on this phone')
    await page.evaluate(async()=>{const m=await import('/src/alarmRules.js');await m.reconcileAlarmRuleSources([],[{id:'r-1',paused:true}])})
    assert.equal(await live(page),0)

    // The loop's own reminder turned on: the alarm is held and offers the fix.
    // Reloading never arms.
    const before=await arms(page)
    src={...src,remind:true}
    await page.reload()
    await badge('On hold')
    await card.getByRole('button',{name:'Turn off the reminder'}).click()
    assert.equal(await page.evaluate(()=>window.turnedOff),1)
    assert.equal(await arms(page),0,'a fresh page load arms nothing')
    assert.ok(before>=3)
    assert.deepEqual(errors,[])
    await page.close()
  }
})
