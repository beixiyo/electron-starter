/** 快捷键运行时编排；动作实现归各自服务，模板演示动作保持原有测试窗口行为。 */
import type { ShortcutActionDefinition, ShortcutRuntimeEvent } from '@shared/shortcuts'
import type { ShortcutRuntimeHandlers } from './shortcuts'
import type { VoiceImeShortcutStartOptions } from './voice-ime-shortcut/types'
import { notifyShortcutRuntimeChanged } from '@ipc/services/shortcut-config/service'
import { requestVoiceImeStart, requestVoiceImeStop } from '@ipc/services/voice-ime/service'
import { SHORTCUT_ACTIONS, WindowType } from '@shared'
import { BrowserWindow } from 'electron'
import { prewarmExternalFocusCheck } from './focus-check'
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
  prewarmExternalFocusIfForeign()

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

/**
 * 端外发起时把前台 App 的 AX 树提前捂热，不等结果
 *
 * 投递完成时 `dispatchTranscription` 要靠 focus-check 判落点，而 Chromium 系 App 首次被查后约 2 s 内
 * 焦点一律拿不到（详见 `focus-check.ts`）。按下这一刻先查一次，输入准备阶段的时间正好把这个窗口耗掉
 * 与投递同一个门：自身应用聚焦时不查（不给自己的窗口写 AX 开关，也没有端外落点可判）
 * 结果落一条 `shortcut.prewarm-focus` 诊断日志：与投递时的焦点判定对照能看出焦点在按下与完成之间有没有漂移
 */
function prewarmExternalFocusIfForeign(): void {
  if (BrowserWindow.getFocusedWindow()) return

  void prewarmExternalFocusCheck().then((focus) => {
    log.info('shortcut.prewarm-focus', 'external focus prewarmed at shortcut press', {
      app: focus.app,
      bundleId: focus.bundleId,
      tier: focus.tier,
      role: focus.role,
      webContent: focus.webContent,
      focusWaitMs: focus.focusWaitMs,
    })
  })
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
