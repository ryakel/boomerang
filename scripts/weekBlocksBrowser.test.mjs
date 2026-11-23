/* global window, document */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// The week on Today (BOOM-59) and a task's block (BOOM-57) in a real browser,
// against a fake Google Calendar. Guarantees:
// - The Friday offer runs the review: Keep/Dismiss the inbox, pick up to three,
//   save writes week_priority on exactly the picked tasks.
// - A fourth pick is refused with a message, not silently dropped.
// - Blocking a priority creates ONE event marked as Boomerang's at the slot
//   chosen; moving it PATCHes that same event; removing deletes only it.
// - Nothing calls the calendar until a tap.
// - No sideways scroll at phone width.
test('weekly review picks priorities; a priority gets, moves and loses one block', { timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const html = `<html data-ui="v2" data-theme="kept-light"><head><link rel="icon" href="data:,"></head><body><div id="root" class="v2-app"></div><script type="module">
    import '/src/index.css'; import '/src/AppV2.css'; import '/src/kept/palette.css'; import '/src/kept/shell.css'; import '/src/kept/today2.css'
    import React from 'react'; import { createRoot } from 'react-dom/client'
    import WeekPlan from '/src/kept/WeekPlan.jsx'
    const h = React.createElement
    function App() {
      const [tasks, setTasks] = React.useState(window.__tasks)
      window.__getTasks = () => tasks
      const update = (id, patch) => setTasks(list => list.map(x => x.id === id ? { ...x, ...patch } : x))
      return h('div', { className: 'bm-t2', style: { padding: 16 } }, h(WeekPlan, {
        tasks, todayKey: window.__today, onUpdateTask: update,
        onCompleteTask: t => update(t.id, { status: 'done' }), onOpenTask: () => {},
        onGmailKeep: t => update(t.id, { gmail_pending: false }), onGmailDismiss: t => update(t.id, { status: 'cancelled' }),
      }))
    }
    createRoot(document.getElementById('root')).render(h(App))
  </script></body></html>`
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'fake-calendar', enforce: 'pre',
    resolveId(source, importer) {
      if (importer && /\/src\//.test(importer) && /(^|\/)api(\.js)?$/.test(source) && !source.includes('apiConfig')) return '\0fake-api'
    },
    load(id) {
      if (id !== '\0fake-api') return
      return `const cal = window.__cal = window.__cal || { calls: [], events: [], seq: 0 }
        export const gcalStatus = async () => ({ connected: true })
        export const gcalListCalendars = async () => [{ id: 'primary', summary: 'Me', primary: true }]
        export const gcalListEvents = async () => cal.events.map(e => ({ ...e }))
        export const notNowGet = async () => ({}); export const notNowPost = async () => ({})
        export async function gcalCreateEvent(calendarId, event) { cal.calls.push(['POST', calendarId, event]); const id = 'ev' + (++cal.seq); cal.events.push({ id, ...event }); return { eventId: id } }
        export async function gcalBlockRequest(method, eventId, calendarId, event) {
          cal.calls.push([method, eventId, event])
          const i = cal.events.findIndex(e => e.id === eventId)
          if (i < 0) return { gone: true }
          if (method === 'DELETE') cal.events.splice(i, 1); else cal.events[i] = { ...cal.events[i], ...event }
          return { ok: true }
        }`
    },
    configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url !== '/__week') return next(); res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__week', html)) }) },
  }], server: { host: '127.0.0.1', port: 0 } })
  t.after(() => vite.close()); await vite.listen()
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/__week`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
  t.after(() => browser.close())

  // Friday 2026-11-27, 10:00 in Chicago.
  const page = await browser.newPage({ viewport: { width: 375, height: 860 }, timezoneId: 'America/Chicago' })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.clock.setFixedTime(new Date('2026-11-27T16:00:00Z'))
  await page.addInitScript(() => {
    window.__today = '2026-11-27'
    window.__tasks = [
      { id: 'r1', title: 'Write the report', status: 'not_started', high_priority: true, size: 'M' },
      { id: 'r2', title: 'Book the dentist', status: 'not_started', due_date: '2026-12-01' },
      { id: 'r3', title: 'Fix the gate', status: 'not_started', pinned_to_today: true },
      { id: 'r4', title: 'Call the bank', status: 'not_started', due_date: '2026-11-20' },
      { id: 'g1', title: 'Reply to school email', status: 'not_started', gmail_pending: true, gmail_message_id: 'm1' },
      { id: 'g2', title: 'Newsletter promo', status: 'not_started', gmail_pending: true, gmail_message_id: 'm2' },
    ]
  })
  await page.goto(url)
  const offer = page.getByRole('region', { name: 'Weekly review' })
  await offer.getByRole('button', { name: 'Start' }).click()
  const sheet = page.getByRole('dialog', { name: 'Weekly review' })
  await sheet.getByRole('heading', { name: 'Week of Nov 30' }).waitFor()
  await sheet.getByText('Book the dentist').first().waitFor()

  // Inbox: keep one, dismiss one.
  await sheet.getByRole('button', { name: 'Keep' }).first().click()
  await sheet.getByRole('button', { name: 'Dismiss Newsletter promo' }).click()
  await sheet.getByText('Inbox is clear.').waitFor()

  // Pick three; a fourth is refused with a message.
  for (const name of ['Write the report', 'Book the dentist', 'Fix the gate']) await sheet.getByRole('button', { name: new RegExp(name) }).click()
  await sheet.getByRole('button', { name: /Call the bank/ }).click()
  await sheet.getByRole('alert').filter({ hasText: 'Unpick one first' }).waitFor()
  assert.equal(await sheet.getByRole('button', { name: /Call the bank/ }).getAttribute('aria-pressed'), 'false')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll')
  await page.screenshot({ path: '/tmp/boomerang-week-review-375.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Save 3' }).click()
  const picked = await page.evaluate(() => window.__getTasks().filter(t => t.week_priority).map(t => [t.id, t.week_priority]))
  assert.deepEqual(picked.sort(), [['r1', '2026-11-30'], ['r2', '2026-11-30'], ['r3', '2026-11-30']])
  await page.getByRole('button', { name: /Week of Nov 30/ }).waitFor()
  assert.equal(await offer.count(), 0, 'the offer goes quiet once planned')
  assert.equal(await page.evaluate(() => window.__cal.calls.length), 0, 'nothing touched the calendar')

  // Monday, with the tasks as the review left them: the week's priorities are
  // on top, each blockable.
  const after = await page.evaluate(() => window.__getTasks())
  await page.close()
  const mon = await browser.newPage({ viewport: { width: 375, height: 860 }, timezoneId: 'America/Chicago' })
  mon.on('pageerror', e => errors.push(e.message))
  await mon.clock.setFixedTime(new Date('2026-11-30T14:50:00Z')) // 8:50 in Chicago
  await mon.addInitScript(list => { window.__today = '2026-11-30'; window.__tasks = list }, after)
  await mon.goto(url)
  const week = mon.getByRole('region', { name: 'This week' })
  await week.getByText('Write the report').waitFor()
  await week.locator('[data-task-id="r1"]').getByRole('button', { name: 'Block', exact: true }).click()
  const block = mon.getByRole('dialog', { name: 'Block' })
  await block.getByRole('radio', { name: '60 min' }).click()
  await block.getByRole('button', { name: /Today 9:00–10:00 AM/ }).click()
  await mon.screenshot({ path: '/tmp/boomerang-block-375.png', fullPage: true })
  await block.getByRole('button', { name: 'Block it' }).click()
  await week.getByText('Blocked Today 9:00–10:00 AM').waitFor()
  const made = await mon.evaluate(() => window.__cal.calls)
  assert.equal(made.length, 1)
  assert.equal(made[0][0], 'POST')
  assert.match(made[0][2].description, /Managed by Boomerang/)
  assert.equal(made[0][2].summary, 'Write the report')

  // Move: same event, PATCHed, not a second one.
  await week.locator('[data-task-id="r1"]').getByRole('button', { name: 'Move', exact: true }).click()
  await block.getByLabel('Block date').fill('2026-12-01')
  await block.getByLabel('Block time').fill('14:00')
  await block.getByRole('button', { name: 'Move block', exact: true }).click()
  await week.getByText(/Blocked Tomorrow 2:00–3:00 PM/).waitFor()
  const moved = await mon.evaluate(() => window.__cal.calls.map(c => c[0]))
  assert.deepEqual(moved, ['POST', 'PATCH'])
  assert.equal(await mon.evaluate(() => window.__cal.events.length), 1)

  // Remove: deletes only that event and clears the task.
  await week.locator('[data-task-id="r1"]').getByRole('button', { name: 'Move', exact: true }).click()
  await block.getByRole('button', { name: 'Remove block' }).click()
  await week.locator('[data-task-id="r1"]').getByText('No block yet').waitFor()
  assert.deepEqual(await mon.evaluate(() => window.__cal.calls.map(c => c[0])), ['POST', 'PATCH', 'DELETE'])
  assert.equal(await mon.evaluate(() => window.__getTasks().find(t => t.id === 'r1').block_event_id), null)
  assert.deepEqual(errors, [])
})
