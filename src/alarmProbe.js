import { registerPlugin } from '@capacitor/core'
import { isNativeShell } from './apiConfig'
import { createAlarmProbeClient } from './alarmProbeClient'

export const alarmProbe = createAlarmProbeClient({
  native: isNativeShell(),
  plugin: registerPlugin('BoomerangAlarmProbe'),
})
