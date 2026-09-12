/** 快捷键运行时编排；动作实现归各自服务，模板演示动作保持原有测试窗口行为。 */
import type { ShortcutActionDefinition, ShortcutRuntimeEvent } from '@shared/shortcuts'
import type { ShortcutRuntimeHandlers } from './shortcuts'
import type { VoiceImeShortcutStartOptions } from './voice-ime-shortcut/types'
import { notifyShortcutRuntimeChanged } from '@ipc/services/shortcut-config/service'
import { requestVoiceImeStart, requestVoiceImeStop } from '@ipc/services/voice-ime/service'
import { SHORTCUT_ACTIONS, WindowType } from '@shared'
import { createMainDiagnosticLogger } from './logging'
import { reapplyShortcutRuntime } from './shortcuts'
import { readShortcutBindings } from './store/shortcut-bindings'
import { createVoiceImeShortcutController } from './voice-ime-shortcut'
import { voiceImeState } from './voice-ime-state'
import { getShortcutTestWindowBounds, logicalWindowManager } from './window-manager'

const log = createMainDiagnosticLogger('voice-ime')

/**
 * 快捷键 runtime
 */

export function reapplyAppShortcutRuntime(): void {
  reapplyShortcutRuntime(readShortcutBindings(), SHORTCUT_ACTION_HANDLERS)
  notifyShortcutRuntimeChanged()
}

function showShortcutTestWindow(
  label: string,
  triggerType: 'combo' | 'doublePress' | 'hold' | 'hotkey',
): void {
  logicalWindowManager.show(WindowType.SHORTCUT_TEST, {
    payload: { triggerType, label },
    bounds: getShortcutTestWindowBounds(),
  })
}

/** hotkey 绑定的触发处理器，按 action id 索引 */
const SHORTCUT_ACTION_HANDLERS: ShortcutRuntimeHandlers = {
  recording: handleShortcutAction,
  assistant: handleShortcutAction,
  voiceDictation: handleShortcutAction,
  bookmark: handleShortcutAction,
}

export function handleShortcutAction(event: ShortcutRuntimeEvent): void {
  switch (event.id) {
    case 'recording':
      showShortcutActionTestWindow('Recording', event)
      return
    case 'assistant':
      showShortcutActionTestWindow('Assistant', event)
      return
    case 'voiceDictation':
      handleVoiceDictationShortcut(event)
      return
    case 'bookmark':
      showShortcutActionTestWindow('Bookmark', event)
      return
  }
}

function showShortcutActionTestWindow(label: string, event: ShortcutRuntimeEvent): void {
  if (event.phase !== 'trigger') return

  const { gesture } = event
  showShortcutTestWindow(
    `${label} (${formatKeyboardGestureLabel(gesture)})`,
    getShortcutTestTriggerType(event),
  )
}

function formatKeyboardGestureLabel(gesture: ShortcutRuntimeEvent['gesture']): string {
  switch (gesture) {
    case 'press':
      return 'hotkey'
    case 'doublePress':
      return 'double hotkey'
    case 'hold':
      return 'hold hotkey'
  }
}

function getShortcutTestTriggerType(event: ShortcutRuntimeEvent): 'combo' | 'doublePress' | 'hold' | 'hotkey' {
  if (event.gesture === 'doublePress') return 'doublePress'
  if (event.gesture === 'hold') return 'hold'
  if (event.binding.chord.source === 'fn' && event.binding.chord.key !== 'Fn') return 'combo'
  return 'hotkey'
}

function handleVoiceDictationShortcut(event: ShortcutRuntimeEvent): void {
  const action: ShortcutActionDefinition | undefined = SHORTCUT_ACTIONS.find((item) => item.id === 'voiceDictation')
  if (action?.activation === 'hold' || action?.activation === 'toggle') voiceImeShortcutController.handle(event, action.activation)
}

async function startVoiceImeFromShortcut(options: VoiceImeShortcutStartOptions): Promise<string | null> {
  try {
    const result = await requestVoiceImeStart(options)
    return result.started
      ? result.sessionId
      : null
  }
  catch (error) {
    log.error('start.failed', 'voice input could not start', error)
    return null
  }
}

const voiceImeShortcutController = createVoiceImeShortcutController({
  start: startVoiceImeFromShortcut,
  stop: (sessionId) => {
    /** 旧按压的 release 不能结束从另一入口新建的会话。 */
    if (sessionId && voiceImeState.currentSessionId !== sessionId) return
    requestVoiceImeStop()
  },
  isRecording: () => voiceImeState.currentPhase === 'recording',
})

/** 电源切换和退出时取消尚未完成门禁检查的物理按压。 */
export function cancelPendingVoiceImeShortcut(): void {
  voiceImeShortcutController.cancelPendingStart()
}
