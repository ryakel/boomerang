// OTA bundle updates for the native (Capacitor) shell — the bundled-assets
// model's answer to "every web change needs an Xcode rebuild". On boot and on
// every app foreground, the shell asks its configured server for the current
// bundle version (`GET /api/bundle/manifest`); when it differs from the
// running bundle, the new dist zip is downloaded and swapped in via
// @capgo/capacitor-updater, which reloads the WebView into it. Runtime
// server config (ConnectionSetup) is preserved — the update source is
// whatever server this install points at, so one binary works for any
// self-hosted instance. The web build never runs any of this (isNativeShell
// gate + dynamic import, so the plugin doesn't even load).
//
// Rollback safety: notifyAppReady() is called on every boot — the updater
// auto-reverts to the previous bundle when a swapped-in bundle never reports
// ready, so a broken download can't brick the shell.
import { getApiBase, isNativeShell } from './apiConfig'

const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

let updating = false

async function checkOnce(CapacitorUpdater) {
  if (updating || !getApiBase()) return
  try {
    const res = await fetch('/api/bundle/manifest', { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return
    const manifest = await res.json()
    if (!manifest?.available || !manifest.version) return
    if (manifest.version === CURRENT_VERSION) return
    // Already running a downloaded bundle of this version (CURRENT_VERSION is
    // baked at build; the plugin knows what it actually swapped in).
    const current = await CapacitorUpdater.current().catch(() => null)
    if (current?.bundle?.version === manifest.version) return
    updating = true
    console.log(`[OTA] bundle ${CURRENT_VERSION} → ${manifest.version}: downloading`)
    // Absolute URL: the download runs natively (URLSession), outside the JS
    // fetch interceptor that prefixes relative /api paths.
    const bundle = await CapacitorUpdater.download({
      url: new URL('/api/bundle/download', getApiBase()).href,
      version: manifest.version,
    })
    await CapacitorUpdater.set(bundle) // reloads into the new bundle
  } catch (e) {
    console.warn('[OTA] update check failed:', e?.message || e)
  } finally {
    updating = false
  }
}

// Called once from main.jsx. No-op outside the native shell or before a
// server is configured.
export function initOtaUpdates() {
  if (!isNativeShell()) return
  ;(async () => {
    try {
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
      await CapacitorUpdater.notifyAppReady()
      await checkOnce(CapacitorUpdater)
      const { App } = await import('@capacitor/app')
      App.addListener('resume', () => { checkOnce(CapacitorUpdater) })
    } catch (e) {
      console.warn('[OTA] updater unavailable:', e?.message || e)
    }
  })()
}
