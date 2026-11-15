/* global window, document */
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import {registerAlarmRuleRoutes} from '../server/alarmRuleRoutes.js'

test('real rule editor previews configurable source-linked alarms and requires explicit arming', {timeout:60000}, async t=>{
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const device='11111111-1111-1111-1111-111111111111'
  let data
  const api=express();api.use(express.json())
  registerAlarmRuleRoutes(api,{get:()=>data&&structuredClone(data),set:s=>{data=structuredClone(s)},flush:()=>{},source:()=>({title:'Warehouse visit',status:'doing'}),isDev:()=>true})
  api.get('/api/data',(req,res)=>res.json({tasks:[{id:'task-1',title:'Warehouse visit'}],routines:[]}))
  const html=`<html data-ui="v2" data-theme="kept-light"><head><link rel="icon" href="data:,"></head><body><div id="root" class="v2-app"></div><script type="module">import '/src/index.css';import '/src/AppV2.css';import '/src/components/SettingsModal.css';import React from 'react';import{createRoot}from'react-dom/client';import Panel from '/src/components/AlarmRulesPanel.jsx';createRoot(document.getElementById('root')).render(React.createElement(Panel));</script></body></html>`
  const vite=await createServer({configFile:false,root:process.cwd(),plugins:[react(),{
    name:'rules-native-fixture',enforce:'pre',
    resolveId(source,importer){
      if(importer?.endsWith('/alarmRules.js') && source==='@capacitor/core') return '\0rules-proxy'
      if((importer?.endsWith('/alarmRules.js') || importer?.endsWith('/AlarmRulesPanel.jsx')) && source.includes('apiConfig')) return '\0rules-api'
    },
    load(id){
      if(id==='\0rules-api') return `export const isNativeShell=()=>true;export async function readJson(r){const d=await r.json();if(!r.ok)throw Error(d.error);return d}`
      if(id==='\0rules-proxy') return `import{registerPlugin as real}from'@capacitor/core';
        const state=window.ruleNative={available:true,deviceId:'${device}',authorization:'authorized',cues:[],receipts:[],arms:0};
        export const registerPlugin=name=>real(name,{web:()=>({
          getStatus:async()=>({...state}),
          applyPlan:async({items})=>{state.arms++;state.cues=items.map(x=>({...x,state:'scheduled'}));return {...state}},
          acknowledge:async({key})=>{const c=state.cues.find(x=>x.key===key);state.receipts.push({key,ruleId:c.ruleId,date:c.date,label:c.ackLabel,recordedAt:Date.now()/1000,synced:false});state.cues=state.cues.filter(x=>x.key!==key);return{...state}},
          markSynced:async({key})=>{state.receipts.find(x=>x.key===key).synced=true;return{...state}},
          cancelRules:async({ruleIds=[],keys=[]})=>{state.cues=state.cues.filter(x=>!ruleIds.includes(x.ruleId)&&!keys.includes(x.key));return {...state}},cancelAll:async()=>{state.cues=[];return{...state}}
        })});`
    },
    configureServer(server){server.middlewares.use(api);server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__rules')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__rules',html))})}
  }],server:{host:'127.0.0.1',port:0}})
  t.after(()=>vite.close());await vite.listen()
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});t.after(()=>browser.close())
  for(const width of [320,960]){
    data=undefined
    const page=await browser.newPage({viewport:{width,height:900}})
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(()=>{window.__BOOMERANG_ALARM_PROBE_BUILD__=true})
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__rules`)
    await page.getByText('Saving a rule does not arm alarms.',{exact:false}).waitFor()
    await page.getByLabel('Task or routine').selectOption('task:task-1')
    await page.getByLabel('Timezone',{exact:true}).fill('America/Chicago')
    await page.getByLabel('Include this rule').check()
    await page.getByLabel('Wed',{exact:true}).check()
    await page.getByLabel('Wed target time').fill('13:30')
    await page.getByLabel('Acknowledgment button text').fill('Leaving now')
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())
    await page.getByLabel('Date',{exact:true}).fill(today)
    await page.getByLabel('Target time',{exact:true}).fill('23:59')
    await page.getByRole('button',{name:'Add date override'}).click()
    await page.getByRole('button',{name:'Save rule without arming'}).click()
    await page.getByRole('status').filter({hasText:'Rule saved'}).waitFor()
    assert.equal(await page.evaluate(()=>window.ruleNative.arms),0)
    assert.equal(data.rules[0].weekly[0].time,'13:30')
    data.rules[0].revision++
    await page.getByRole('button',{name:'Arm this reviewed plan on this phone'}).click()
    await page.getByRole('status').filter({hasText:'schedule or source changed'}).waitFor()
    assert.equal(await page.evaluate(()=>window.ruleNative.arms),0)
    await page.getByRole('button',{name:'Refresh status',exact:true}).click()
    await page.getByRole('status').filter({hasText:'Status refreshed'}).waitFor()
    await page.getByRole('button',{name:'Arm this reviewed plan on this phone'}).click()
    await page.getByRole('status').filter({hasText:'Plan applied'}).waitFor()
    assert.equal(await page.evaluate(()=>window.ruleNative.arms),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
    await page.evaluate(()=>{const root=document.getElementById('root');root.style.height='auto';root.style.overflow='visible'})
    await page.screenshot({path:`/tmp/boomerang-alarm-rules-${width}.png`,fullPage:true})
    await page.getByRole('button',{name:'Leaving now',exact:true}).first().click()
    await page.getByText('Leaving now — synced',{exact:false}).first().waitFor()
    assert.equal(Object.keys(data.acknowledgments).length,1)
    await page.evaluate(async()=>{const m=await import('/src/alarmRules.js');await m.reconcileAlarmRuleSources([{id:'task-1',status:'done'}],[])})
    assert.equal(await page.evaluate(()=>window.ruleNative.cues.length),0)
    await page.reload()
    await page.getByText('Saving a rule does not arm alarms.',{exact:false}).waitFor()
    assert.equal(await page.evaluate(()=>window.ruleNative.arms),0)
    assert.deepEqual(errors,[])
    await page.close()
  }
})
