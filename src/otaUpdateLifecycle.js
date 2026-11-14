// Keep the disposable native experiment on the UI that Xcode installed.
// Native code chooses the packaged assets before any retained OTA JS can run;
// this then reconciles the updater's bundle identity using its supported API.
export async function startOtaUpdateLifecycle({ bundledOnly, loadUpdater, loadApp, checkOnce, onProbeStage = () => {} }) {
  if (bundledOnly) onProbeStage('loading-updater')
  const updater = await loadUpdater()
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
  const app = await loadApp()
  await app.addListener('resume', () => { checkOnce(updater) })
  return 'server-updates'
}
