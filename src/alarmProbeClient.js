// Explicit, disposable native experiment. No tasks, settings, timers, or retry loop.
// Inject the bridge so lost replies and old native installs can be tested offline.
export function createAlarmProbeClient({ native, plugin }) {
  let busy = false
  const invoke = async (method) => {
    if (!native) return { ok: false, error: 'Open the rebuilt Boomerang Dev iOS app to test alarms.' }
    if (busy) return { ok: false, error: 'Another alarm test operation is still running.' }
    busy = true
    try {
      const result = await plugin[method]()
      if (typeof result?.available !== 'boolean') throw new Error('Invalid native alarm status.')
      if (!result.available) return { ...result, ok: false }
      if (!['authorized', 'denied', 'notDetermined', 'unknown'].includes(result.authorization)
          || !(result.alarm === null || (result.alarm?.id === 'boomerang-alarm-probe'
            && ['scheduled', 'countdown', 'paused', 'alerting', 'unknown'].includes(result.alarm.state)))) {
        throw new Error('Invalid native alarm status.')
      }
      // Readback is scheduling evidence, never evidence of sound or completion.
      if (method === 'scheduleTest' && !result.alarm) throw new Error('The test alarm was not found in iOS readback.')
      if (method === 'cancelTest' && result.alarm) throw new Error('iOS still reports the test alarm.')
      return { ...result, ok: true }
    } catch (error) {
      const oldInstall = error?.code === 'UNIMPLEMENTED' || error?.code === 'UNAVAILABLE'
      return {
        ok: false,
        // A lost write response must not invite a blind schedule retry.
        uncertain: method === 'scheduleTest' || method === 'cancelTest',
        error: oldInstall
          ? 'This app needs the native alarm test build. A web update cannot add it.'
          : `${error?.message || 'Could not read the native alarm status.'} Check status before trying again.`,
      }
    } finally {
      busy = false
    }
  }
  return {
    status: () => invoke('getStatus'),
    requestPermission: () => invoke('requestPermission'),
    schedule: () => invoke('scheduleTest'),
    cancel: () => invoke('cancelTest'),
  }
}
