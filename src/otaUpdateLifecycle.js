// Starts the over-the-air updater. With `bundledOnly` (unused since BOOM-38,
// kept for a future native-only experiment) it instead keeps the app on the
// UI Xcode installed and reconciles the updater's bundle identity to it.
// The commit a version label names, or null: `v2.63.0-7-g4f728b6` (a Mac
// build's git describe) and `dev-4f728b6` (the dev server image) both name
// 4f728b6. Plain labels ("dev", "v2.63.0") name no commit.
const commitOf = (v) => (/(?:^dev-|-g)([0-9a-f]{7,40})$/i.exec(String(v || '')) || [])[1]?.slice(0, 7).toLowerCase() || null
export const sameCommit = (a, b) => { const x = commitOf(a); return !!x && x === commitOf(b) }

export async function startOtaUpdateLifecycle({ bundledOnly, loadUpdater, loadApp, checkOnce, onProbeStage = () => {} }) {
  if (bundledOnly) onProbeStage('loading-updater')
  // Await the module, never the plugin proxy: Capacitor synthesizes a `then`
  // method, so returning the proxy from an async loader hangs promise resolution.
  const { CapacitorUpdater: updater } = await loadUpdater()
  if (bundledOnly) {
    onProbeStage('reading-bundle')
    const current = await updater.current()
    if (!current?.bundle?.id) throw new Error('Could not inspect the alarm test UI bundle.')
    if (current.bundle.id !== 'builtin') {
      // Reset only the updater's selected web assets, never app data. Do not
      // acknowledge the retained server bundle as the UI under evaluation.
      onProbeStage('resetting-to-builtin')
      await updater.reset({ toLastSuccessful: false })
      onProbeStage('reset-returned')
      return 'reloading-builtin'
    }
    onProbeStage('marking-builtin-ready')
    await updater.notifyAppReady()
    onProbeStage('builtin-ready')
    return 'bundled-only'
  }
  // Ordinary App builds retain the existing boot and resume update behavior.
  await updater.notifyAppReady()
  await checkOnce(updater)
  const { App: app } = await loadApp()
  await app.addListener('resume', () => { checkOnce(updater) })
  return 'server-updates'
}
