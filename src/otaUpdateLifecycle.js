// Keep the disposable native experiment on the UI that Xcode installed.
// Native code chooses the packaged assets before any retained OTA JS can run;
// this then reconciles the updater's bundle identity using its supported API.
export async function startOtaUpdateLifecycle({ bundledOnly, loadUpdater, loadApp, checkOnce }) {
  const updater = await loadUpdater()
  if (bundledOnly) {
    const current = await updater.current()
    if (!current?.bundle?.id) throw new Error('Could not inspect the alarm test UI bundle.')
    if (current.bundle.id !== 'builtin') {
      // Reset only the updater's selected web assets, never app data. Do not
      // acknowledge the retained server bundle as the UI under evaluation.
      await updater.reset({ toLastSuccessful: false })
      return 'reloading-builtin'
    }
    await updater.notifyAppReady()
    return 'bundled-only'
  }
  // Ordinary App builds retain the existing boot and resume update behavior.
  await updater.notifyAppReady()
  await checkOnce(updater)
  const app = await loadApp()
  await app.addListener('resume', () => { checkOnce(updater) })
  return 'server-updates'
}
