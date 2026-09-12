/** 录制期间的系统级捕获：把平台键盘捕获后端的原始输入合成为录制事件推给设置页 */

import type { ShortcutRecordEvent } from '@shared/shortcuts'
import { createKeyboardInputTracker } from '@shared/shortcuts'
import { keyboardInputBackend } from '../input'

let session: RecordSession | null = null

/**
 * 开始录制捕获
 *
 * 事件流只表达「捕获到了什么」，press / doublePress / hold 由渲染层按 action 能力判定
 * Fn 组合与普通键盘来自同一条输入流，渲染端不需要再做跨源去重
 *
 * @returns 主进程是否真的接管了系统级捕获；false 时渲染端应改用 DOM 产出录制事件
 */
export function startRecordShortcutDetection(options: StartRecordShortcutDetectionOptions): boolean {
  if (session)
    return session.nativeCapture

  const tracker = createKeyboardInputTracker()
  const unsubscribe = keyboardInputBackend.subscribe((input) => {
    if (input.phase === 'reset') {
      tracker.reset()
      options.onReset?.()
      return
    }

    for (const event of tracker.handle(input))
      options.emit(event)
  })
  session = { unsubscribe, nativeCapture: false }

  if (!keyboardInputBackend.isAvailable()) {
    stopRecordShortcutDetection()
    return false
  }

  try {
    keyboardInputBackend.acquire()
    session.nativeCapture = true
    return true
  }
  catch {
    /** renderer 的 DOM 录制仍可继续；这里只撤下不可用的系统级捕获 */
    stopRecordShortcutDetection()
    return false
  }
}

/** 录制结束，移除监听并归还捕获后端引用；可重复调用 */
export function stopRecordShortcutDetection(): void {
  if (!session)
    return

  session.unsubscribe()
  if (session.nativeCapture)
    keyboardInputBackend.release()
  session = null
}

export type StartRecordShortcutDetectionOptions = {
  emit: (event: ShortcutRecordEvent) => void
  /** 捕获后端丢失物理状态时通知，调用方据此清空本轮录制 */
  onReset?: () => void
}

type RecordSession = {
  unsubscribe: () => void
  nativeCapture: boolean
}
