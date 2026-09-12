import type { PowerEventType } from '@ipc/services/power/contract'
import { emitPowerEvent } from '@ipc/services/power/service'
import { cancelVoiceImeSession } from '@ipc/services/voice-ime/service'
import { powerMonitor } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { requestShortcutRuntimeSync } from './shortcuts'
import { cancelPendingVoiceImeShortcut } from './shortcut-actions'

const log = createMainDiagnosticLogger('app.lifecycle')

let initialized = false

/**
 * 系统挂起前后回收 Voice IME，并在恢复后重建 Fn runtime
 */
export function initPowerEventCleanup(): void {
  if (initialized) return
  initialized = true

  powerMonitor.on('suspend', () => {
    handlePowerEvent('suspend')
  })
  powerMonitor.on('resume', () => {
    handlePowerEvent('resume')
  })
  powerMonitor.on('lock-screen', () => {
    handlePowerEvent('lock-screen')
  })
  powerMonitor.on('unlock-screen', () => {
    handlePowerEvent('unlock-screen')
  })
}

function handlePowerEvent(reason: PowerEventType): void {
  const at = new Date().toISOString()
  cancelPendingVoiceImeShortcut()
  cancelVoiceImeSession(reason)

  if (reason === 'resume' || reason === 'unlock-screen') requestShortcutRuntimeSync()

  log.info('voice-ime.cancelled', 'voice IME cancelled for power event', { reason })
  emitPowerEvent(reason, at)
}
