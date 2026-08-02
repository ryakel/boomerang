#!/usr/bin/env node
/**
 * Captures every screenshot referenced by the README and the wiki, against a
 * server seeded with scripts/demo-data.json.
 *
 * WHY THE DATASET MATTERS: these images are published, indexed and permanent.
 * `scripts/seed-data.json` (the dev seed) is modelled on the real user's life —
 * the first set of wiki images was captured from it and carried real task
 * titles. Everything here runs against the fictional demo dataset instead. If
 * you re-run this, do not point BASE at a server holding real data.
 *
 *   node scripts/make-demo-data.mjs
 *   SEED_DB=1 SEED_FILE=scripts/demo-data.json PORT=3060 npm start
 *   BASE=http://localhost:3060 node scripts/capture-screenshots.mjs
 *
 * Mobile is 390×844 @3x (iPhone 14 logical size), desktop 1440×900 @2x — the
 * viewports wiki/Screenshot-Shot-List.md specifies, so re-shot files drop in
 * beside older ones without a visible change of scale.
 *
 * Filenames are the ones the docs already reference (`kept-*`, `settings-*`),
 * so pages update by replacement rather than by editing every embed.
 */
import { mkdirSync } from 'fs'

// Playwright is not a project dependency (it would land in the Docker image for
// no runtime reason), so it is resolved at call time — from node_modules if it
// happens to be there, otherwise from a path given in PLAYWRIGHT.
const pw = await import(process.env.PLAYWRIGHT || 'playwright')
const chromium = pw.chromium || pw.default?.chromium

const BASE = process.env.BASE || 'http://localhost:3060'
const OUT = new URL('../wiki/images/', import.meta.url).pathname
const EXEC = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
mkdirSync(OUT, { recursive: true })

const done = []
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}${name}.png` })
  done.push(name)
}
const pause = (page, ms = 500) => page.waitForTimeout(ms)
// A step allowed to fail without taking the run down: some surfaces depend on
// an integration or an API key a capture box will not have. Better to skip one
// shot loudly than to lose the other twenty.
const softly = async (label, fn) => {
  try { await fn() } catch (e) { console.warn(`  skipped ${label}: ${e.message.split('\n')[0]}`) }
}

async function prepare(page, { mode = 'light' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((m) => {
    const s = JSON.parse(localStorage.getItem('boomerang_settings') || '{}')
    s.theme = 'kept'
    s.theme_mode = m
    localStorage.setItem('boomerang_settings', JSON.stringify(s))
  }, mode)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await pause(page, 3200)
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-proxy-server'] })

// ── Mobile: the PWA / installed-app shape ─────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  })
  const page = await ctx.newPage()
  await prepare(page)

  await shot(page, 'kept-mobile-today')

  await page.click('.bm-nav-tab:has-text("Tasks")'); await pause(page, 900)
  await shot(page, 'kept-mobile-tasks')

  // The row action sheet opens on LONG PRESS — the rows have no kebab; their
  // only other affordance is a swipe, which does not hold still for a shot.
  await softly('tasks action sheet', async () => {
    const target = page.locator('.bm-row-body').first()
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await pause(page, 900)
    await page.mouse.up()
    await pause(page, 800)
    await shot(page, 'kept-mobile-tasks-sheet')
    await page.keyboard.press('Escape'); await pause(page, 500)
  })

  await page.click('.bm-nav-tab:has-text("Loops")'); await pause(page, 900)
  await shot(page, 'kept-mobile-loops')

  await softly('loop detail', async () => {
    await page.locator('.bm-loop-card-viz, .bm-card').first().click({ timeout: 4000 })
    await pause(page, 900)
    await shot(page, 'kept-mobile-loop-detail')
    await page.keyboard.press('Escape'); await pause(page, 500)
  })

  await page.click('.bm-nav-tab:has-text("More")'); await pause(page, 700)
  await shot(page, 'kept-mobile-more')

  await page.click('.bm-more-row:has-text("Reminders")'); await pause(page, 900)
  await shot(page, 'kept-mobile-reminders')
  await page.keyboard.press('Escape'); await pause(page, 600)

  await page.click('button[aria-label="Throw a task"]'); await pause(page, 700)
  await shot(page, 'kept-mobile-throw')
  await page.click('.bm-throw-mode .bm-pick:has-text("Reminder")'); await pause(page, 450)
  await shot(page, 'kept-mobile-throw-reminder')
  await page.keyboard.press('Escape'); await pause(page, 600)

  // Quick editor: the task with a checklist, tags, size and energy set.
  await page.click('.bm-nav-tab:has-text("Today")'); await pause(page, 900)
  const row = page.locator('.bm-row-title', { hasText: 'Draft the Q3 summary' }).first()
  await row.scrollIntoViewIfNeeded()
  await row.click({ force: true })
  await pause(page, 1400)
  await shot(page, 'kept-mobile-edit-task')
  await page.keyboard.press('Escape'); await pause(page, 600)

  await softly('what now', async () => {
    await page.click('button:has-text("What now?")', { timeout: 4000 })
    await pause(page, 2500)
    await shot(page, 'kept-mobile-whatnow')
    await page.keyboard.press('Escape'); await pause(page, 500)
  })

  await ctx.close()
}

// ── Mobile dark ────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, colorScheme: 'dark',
  })
  const page = await ctx.newPage()
  await prepare(page, { mode: 'dark' })
  await shot(page, 'kept-mobile-today-dark')
  await page.click('.bm-nav-tab:has-text("Loops")'); await pause(page, 900)
  await shot(page, 'kept-mobile-loops-dark')
  await ctx.close()
}

// ── Desktop: the web app ───────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await prepare(page)

  await shot(page, 'kept-desktop-today')

  await page.click('.bm-side-item:has-text("Tasks")'); await pause(page, 1000)
  await shot(page, 'kept-desktop-tasks-list')

  await softly('board view', async () => {
    await page.click('.bm-fl-toggle-btn:has-text("Board")', { timeout: 4000 }); await pause(page, 1400)
    await shot(page, 'kept-desktop-tasks-board')
    await page.click('.bm-fl-toggle-btn:has-text("List")'); await pause(page, 800)
  })

  await page.click('.bm-side-item:has-text("Loops")'); await pause(page, 1000)
  await shot(page, 'kept-desktop-loops')

  await softly('quokka', async () => {
    await page.click('.bm-side-quokka', { timeout: 4000 })
    await pause(page, 1800)
    await shot(page, 'kept-desktop-quokka')
    await page.keyboard.press('Escape'); await pause(page, 600)
  })

  await softly('desktop throw', async () => {
    await page.click('button:has-text("Throw a task")', { timeout: 4000 }); await pause(page, 800)
    await shot(page, 'kept-desktop-throw')
    await page.keyboard.press('Escape'); await pause(page, 600)
  })

  await ctx.close()
}

// ── Settings, one section per page ─────────────────────────────────────────
// A fresh page per section rather than navigating between them: the modal's
// back/close behaviour differs by depth, and five bespoke escape sequences is
// more code and more breakage than five page loads in a script that runs
// roughly never.
for (const [section, file] of [
  ['General', 'settings-general'],
  ['Tasks', 'settings-tasks'],
  ['Labels', 'settings-labels'],
  ['Notifications', 'settings-notifications'],
  ['Integrations', 'settings-integrations'],
]) {
  await softly(file, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await prepare(page)
    await page.click('.bm-side-item:has-text("Settings")', { timeout: 6000 })
    await pause(page, 1400)
    await page.click(`.v2-set-row-pressable:has-text("${section}")`, { timeout: 5000 })
    await pause(page, 1200)
    await shot(page, file)
    await ctx.close()
  })
}

await browser.close()
console.log(`\n${done.length} screenshots written to ${OUT}`)
console.log(done.join('\n'))
