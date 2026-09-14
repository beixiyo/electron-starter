/** 文本投递决策：按当前焦点和已登记宿主选择唯一投递路径 */

import {
  getVoiceImeFocusedEditableWindow,
  getVoiceImeFocusedEmbeddedTarget,
  getVoiceImeForegroundEmbeddedTarget,
  getVoiceImeForegroundWindowHost,
} from '@ipc/services/voice-ime/state'
import { voiceImeToRenderer } from '@ipc/services/voice-ime/toRenderer'
import type { VoiceImeDeliverPayload, VoiceImeSessionHost } from '@shared'
import { WindowType } from '@shared'
import { BrowserWindow } from 'electron'
import { injectTextToExternalInput } from './external-text-inject'
import { checkFocusedTextInput } from './focus-check'
import { insertTextAtFocusedInput } from './insert-text'
import { voiceImeState } from './voice-ime-state'
import { windowManager } from './window-manager'

/**
 * 把文本按当前焦点投递到一个确定目标
 *
 * 端内优先使用当前窗口的可写输入或已登记宿主；端外只在辅助功能检查确认有目标时
 * 注入。`pasteable` 档位必须显式走原生粘贴路径，不能让 auto 模式再次尝试 AX 直插
 * `sessionId` 用于异步完成前后的过期检查；补投场景省略它，不会占用会话槽位
 */
export async function dispatchTranscription(
  text: string,
  options: DispatchTranscriptionOptions = {},
): Promise<void> {
  if (!isDeliveryCurrent(options.sessionId)) return

  const focusedWindow = BrowserWindow.getFocusedWindow()
  const focusedEditableWindow = getVoiceImeFocusedEditableWindow()

  if (focusedWindow && !focusedWindow.isDestroyed()) {
    const focusedEmbeddedHost = getVoiceImeFocusedEmbeddedTarget()

    if (!focusedEmbeddedHost && focusedEditableWindow === focusedWindow) {
      try {
        await focusedWindow.webContents.insertText(text)
        return
      }
      catch {
        if (!isDeliveryCurrent(options.sessionId)) return
      }
    }

    if (!isDeliveryCurrent(options.sessionId)) return

    const embeddedTarget = getVoiceImeForegroundEmbeddedTarget({
      sourceHost: options.sourceHost,
    })
    if (embeddedTarget) {
      emitEmbeddedTranscription(embeddedTarget.window, embeddedTarget.host, text, options.sessionId)
      return
    }

    const windowHost = getVoiceImeForegroundWindowHost()
    if (windowHost && windowHost === focusedWindow) {
      emitEmbeddedTranscription(windowHost, 'window', text, options.sessionId)
      return
    }

    await showVoiceImeResult(text, options.sessionId)
    return
  }

  let externalFocus: Awaited<ReturnType<typeof checkFocusedTextInput>>
  try {
    externalFocus = await checkFocusedTextInput()
  }
  catch {
    await showVoiceImeResult(text, options.sessionId)
    return
  }

  if (!isDeliveryCurrent(options.sessionId)) return

  if (externalFocus.tier === 'editable') {
    try {
      const outcome = await injectTextToExternalInput(text)
      if (!isDeliveryCurrent(options.sessionId)) return
      if (outcome.delivered) return

      /**
       * 粘贴发出去了但预算内没人读剪贴板：一定没粘，文本没丢（helper 已还原剪贴板），交回结果窗口
       *
       * 这只是 AX 闸门之后的第二道保险，不是闸门本身：实测 Chrome body、Safari 空白页、系统设置侧栏
       * 在 Cmd+V 后都会读剪贴板却不落字，「有人读」证明不了送达，能不能投仍由 focus-check 决定
       */
    }
    catch {
      if (!isDeliveryCurrent(options.sessionId)) return
    }

    await showVoiceImeResult(text, options.sessionId)
    return
  }

  if (externalFocus.tier === 'pasteable') {
    try {
      /** 强制 paste：AX 已经判过拿不到可写焦点元素，`result.ok=false` 时 reason 多半是 `paste-not-consumed` */
      const result = await insertTextAtFocusedInput(text, { method: 'paste' })
      if (result.ok) {
        if (!isDeliveryCurrent(options.sessionId)) return
        return
      }
    }
    catch {
      if (!isDeliveryCurrent(options.sessionId)) return
    }

    await showVoiceImeResult(text, options.sessionId)
    return
  }

  await showVoiceImeResult(text, options.sessionId)
}

/** 补投文本沿用相同决策，但不打开或释放会话槽位。 */
export async function deliverVoiceImeTranscription(payload: VoiceImeDeliverPayload): Promise<void> {
  if (!payload.text.trim()) return

  await dispatchTranscription(payload.text, {
    sourceHost: payload.sourceHost,
  })
}

function emitEmbeddedTranscription(
  window: BrowserWindow,
  host: VoiceImeSessionHost,
  text: string,
  sessionId?: string,
): void {
  if (window.isDestroyed()) return

  voiceImeToRenderer.emit('embeddedTranscription', {
    host,
    text,
    ...(sessionId
      ? { sessionId }
      : {}),
  }, window)
}

async function showVoiceImeResult(text: string, sessionId?: string): Promise<void> {
  if (!isDeliveryCurrent(sessionId)) return

  const window = windowManager.get(WindowType.VOICE_IME)
    ?? windowManager.create(WindowType.VOICE_IME)
  if (!window || window.isDestroyed()) {
    throw new Error('Voice IME result window is unavailable')
  }

  const ready = await windowManager.whenReady(WindowType.VOICE_IME)
  if (!isDeliveryCurrent(sessionId)) return
  if (!ready) {
    throw new Error('Voice IME result window failed to load')
  }
  if (window.isDestroyed()) {
    throw new Error('Voice IME result window was destroyed before delivery')
  }

  voiceImeToRenderer.emit('transcription', {
    text,
    ...(sessionId
      ? { sessionId }
      : {}),
  }, window)
  windowManager.showInactive(WindowType.VOICE_IME)
}

function isDeliveryCurrent(sessionId?: string): boolean {
  return sessionId === undefined || voiceImeState.currentSessionId === sessionId
}

export type DispatchTranscriptionOptions = {
  /** 补投时的来源宿主；只在该宿主仍登记时作为兜底 */
  sourceHost?: VoiceImeSessionHost
  /** 当前 release 会话的身份；异步结束后仍会复核该身份 */
  sessionId?: string
}
