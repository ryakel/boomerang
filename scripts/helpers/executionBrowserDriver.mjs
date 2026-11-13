import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.argv[2]
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message) })
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue()
    return route.abort()
  })
  const unauth = await page.request.get(`${base}/api/adviser/executions?chatId=synthetic-chat`)
  assert.equal(unauth.status(), 401)
  const headers = { Authorization: 'Bearer synthetic-browser-token' }
  await page.setExtraHTTPHeaders(headers)
  await page.goto(`${base}/__e1`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Apply 1 change', exact: true }).click()
  await page.getByText('Actions reported applied ·', { exact: false }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Actions reported applied ·', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Apply 1 change', exact: true }).waitFor({ state: 'hidden' })
  const before = await page.request.get(`${base}/api/adviser/executions?chatId=synthetic-chat`, { headers })
  const records = (await before.json()).executions
  assert.equal(records.length, 1)
  assert.equal(records[0].state, 'completed')
  assert.equal((await page.request.post(`${base}/__simulate_unknown`, { headers })).status(), 200)
  await page.getByText('Outcome needs checking ·', { exact: false }).waitFor()
  await page.getByText('Outcome needs checking ·', { exact: false }).click()
  await page.getByText('These actions will not be retried automatically.', { exact: false }).waitFor()
  await page.screenshot({ path: '/tmp/boomerang-e1-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Outcome needs checking ·', { exact: false }).waitFor()
  await page.screenshot({ path: '/tmp/boomerang-e1-desktop.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: authenticated HTTP, actual hook Apply, reload receipts, unknown outcomes; mobile and desktop')
} finally { await browser.close() }
