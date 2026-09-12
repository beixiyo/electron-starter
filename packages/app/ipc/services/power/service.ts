import type { IpcMainInvokeEvent } from 'electron'
import { createIpcService } from '@ipc/core'
import { startActivityPowerSaveBlocker, stopActivityPowerSaveBlocker } from '@main/power-save-blocker'
import type { PowerContract, PowerEventType } from './contract'

export const powerService = createIpcService<PowerContract>('power', {
  mainHandle: {
    async startActivity(event) {
      return startActivityPowerSaveBlocker((event as IpcMainInvokeEvent).sender)
    },

    async stopActivity(_event, requestId) {
      stopActivityPowerSaveBlocker(requestId)
    },
  },
})

/** 向所有 renderer 广播一次系统电源状态变化。 */
export function emitPowerEvent(type: PowerEventType, at = new Date().toISOString()): void {
  powerService.emit('event', { type, at })
}
