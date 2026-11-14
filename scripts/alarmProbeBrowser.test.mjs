// Optional: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/alarmProbeBrowser.test.mjs
// Real React controls + real bridge client; only the native daemon is synthetic.
/* global window, document */ // References inside Playwright's browser callbacks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('alarm test UI handles denial, lost replies, snooze, cleanup and daemon failure', { timeout: 60000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const html = `<!doctype html><html data-ui="v2" data-theme="kept-light"><head><link rel="icon" href="data:,"></head><body>
    <div id="root" class="v2-app"></div><script type="module">
    import '/src/index.css'; import '/src/AppV2.css'; import '/src/components/SettingsModal.css';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import AlarmProbePanel from '/src/components/AlarmProbePanel.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(AlarmProbePanel));
    </script></body></html>`
  const fake = `import {createAlarmProbeClient} from '/src/alarmProbeClient.js';
    const state = window.probeFixture = {authorization:'notDetermined', alarm:null, calls:[], mode:'normal'};
    const snapshot=()=>({available:true,authorization:state.authorization,alarm:state.alarm});
    export const alarmProbe=createAlarmProbeClient({native:true,plugin:{
      async getStatus(){state.calls.push('status');if(state.mode==='read-failure')throw Error('daemon unavailable');return snapshot()},
      async requestPermission(){state.calls.push('permission');state.authorization='denied';return snapshot()},
      async scheduleTest(){state.calls.push('schedule');state.alarm={id:'boomerang-alarm-probe',state:'scheduled'};
        if(state.mode==='lost-schedule')throw Error('lost native reply');return snapshot()},
      async cancelTest(){state.calls.push('cancel');state.alarm=null;
        if(state.mode==='lost-cancel')throw Error('lost cancellation reply');return snapshot()}
    }});`
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'alarm-native-fixture',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../alarmProbe' && importer?.endsWith('/AlarmProbePanel.jsx')) return '\0alarm-fixture'
    },
    load(id) { if (id === '\0alarm-fixture') return fake },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__alarm') return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__alarm', html))
      })
    },
  }], server: { host: '127.0.0.1', port: 0 } })
  t.after(() => vite.close())
  await vite.listen()
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
  t.after(() => browser.close())
  for (const width of [320, 960]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__alarm`)
    const check = page.getByRole('button', { name: 'Check alarm status' })
    const schedule = page.getByRole('button', { name: 'Sound test in 60 seconds' })
    const cancel = page.getByRole('button', { name: 'Cancel test alarm' })
    await page.getByRole('button', { name: 'Allow test alarms' }).waitFor({ timeout: 10000 }).catch(async error => {
      throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}\nBody: ${await page.locator('body').innerText()}`)
    })
    await page.getByRole('button', { name: 'Allow test alarms' }).click()
    await page.getByRole('status').filter({ hasText: 'Alarm permission is off' }).waitFor()
    assert.equal(await schedule.isDisabled(), true)
    assert.equal(await page.evaluate(() => window.probeFixture.calls.includes('schedule')), false)
    await page.evaluate(() => { window.probeFixture.authorization = 'authorized'; window.probeFixture.mode = 'lost-schedule' })
    await check.click()
    await page.getByRole('status').filter({ hasText: 'iOS lists no test alarm' }).waitFor()
    await schedule.click()
    await page.getByRole('status').filter({ hasText: 'lost native reply' }).waitFor()
    assert.equal(await schedule.isDisabled(), true)
    await check.click()
    await page.getByRole('status').filter({ hasText: 'test alarm: scheduled' }).waitFor()
    assert.equal(await page.evaluate(() => window.probeFixture.calls.filter(c => c === 'schedule').length), 1)
    assert.equal(await schedule.isDisabled(), true)
    await page.evaluate(() => { window.probeFixture.alarm.state = 'countdown'; window.probeFixture.mode = 'normal' })
    await check.click()
    await page.getByRole('status').filter({ hasText: 'test alarm: countdown' }).waitFor()
    await page.evaluate(() => { window.probeFixture.mode = 'lost-cancel' })
    await cancel.click()
    await page.getByRole('status').filter({ hasText: 'lost cancellation reply' }).waitFor()
    assert.equal(await schedule.isDisabled(), true)
    await page.evaluate(() => { window.probeFixture.mode = 'normal' })
    await check.click()
    await page.getByRole('status').filter({ hasText: 'iOS lists no test alarm' }).waitFor()
    assert.equal(await schedule.isEnabled(), true)
    await page.evaluate(() => { window.probeFixture.mode = 'read-failure' })
    await check.click()
    await page.getByRole('status').filter({ hasText: 'daemon unavailable' }).waitFor()
    assert.equal(await schedule.isDisabled(), true)
    assert.equal(await cancel.isEnabled(), true)
    assert.deepEqual(errors, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.close()
  }
})
