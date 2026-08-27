import type { VoiceImeCancelPayload } from '@ipc/services/voice-ime/contract'
import { voiceImeToRenderer } from '@ipc/services/voice-ime/toRenderer'
import { WindowType } from '@shared'
import { powerMonitor } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { holdStateManager, requestShortcutRuntimeSync } from './shortcuts'
import { windowManager } from './window-manager'

const log = createMainDiagnosticLogger('app.lifecycle')

let initialized = false

/**
 * 系统挂起前后回收 Voice IME，并在恢复后重建 Fn runtime
 */
export function initPowerEventCleanup(): void {
  if (initialized) return
  initialized = true

  powerMonitor.on('suspend', () => {
    cancelVoiceImeSession('suspend')
  })
  powerMonitor.on('resume', () => {
    cancelVoiceImeSession('resume')
  })
  powerMonitor.on('lock-screen', () => {
    cancelVoiceImeSession('lock-screen')
  })
  powerMonitor.on('unlock-screen', () => {
    cancelVoiceImeSession('unlock-screen')
  })
}

function cancelVoiceImeSession(reason: VoiceImeCancelPayload['reason']): void {
  const win = windowManager.get(WindowType.VOICE_IME)

  holdStateManager.discardHold(WindowType.VOICE_IME)

  if (win && !win.isDestroyed()) {
    voiceImeToRenderer.emit('cancel', { reason }, win)
    windowManager.hide(WindowType.VOICE_IME)
  }

  if (reason === 'resume' || reason === 'unlock-screen') requestShortcutRuntimeSync()

  log.info('voice-ime.cancelled', 'voice IME cancelled for power event', { reason })
}
