import { registerPlugin } from '@capacitor/core'
import { isNativeShell } from './apiConfig'
import { loadSettings, isCrisisTask } from './store'
import { widgetSnapshot } from './widgetSnapshot'

// Writes the Today widget's snapshot into the App Group (BOOM-61) whenever
// tasks change, debounced, and straight away when the app goes to the
// background, so the widget holds the latest picture of Today while the app
// sits unopened. A build without the method (an older app) just doesn't
// update its widget; nothing here ever throws into the app.
const Native = registerPlugin('BoomerangNative')
const DEBOUNCE_MS = 1500
let timer = null
let pending = null
let lastBody = null

async function write() {
  timer = null
  const input = pending
  pending = null
  if (!input) return
  try {
    const settings = loadSettings()
    const snap = widgetSnapshot({ ...input, now: new Date(), isCrisis: t => isCrisisTask(t, settings) })
    // Skip a write that changes nothing but the timestamp: each write asks
    // iOS to redraw the widget.
    const { generatedAt, ...body } = snap
    const key = JSON.stringify(body)
    if (key === lastBody) return
    await Native.setWidgetSnapshot({ json: JSON.stringify({ ...body, generatedAt }) })
    lastBody = key
  } catch { /* an app without the widget method: nothing to update */ }
}

export function scheduleWidgetSnapshot({ tasks, routines }) {
  if (!isNativeShell() || !Array.isArray(tasks)) return
  pending = { tasks, routines: routines || [] }
  clearTimeout(timer)
  timer = setTimeout(write, DEBOUNCE_MS)
}

export function flushWidgetSnapshot() {
  if (!pending) return
  clearTimeout(timer)
  return write()
}
