/** 录制期间的 DOM 键盘适配与默认行为拦截 */
import type { ShortcutRecordEvent } from '@shared/shortcuts'
import { createKeyboardInputTracker, normalizeBrowserShortcutKey, toBrowserKeyboardInputEvent } from '@shared/shortcuts'

/**
 * 录制期间的 DOM 键盘层
 *
 * 两种角色：主进程无法接管系统级捕获时（Web、未授权），DOM 是唯一的录制事件来源；
 * 主进程已接管时 DOM 只负责吞掉按键默认行为——Space / Enter 会点到录制框自己的按钮，
 * 字母会打进页面，Esc 会关掉外层弹窗。录入中没有取消键，Esc 与其他键一样进录制校验
 */
export function bindBrowserShortcutRecordEvents(
  options: BindBrowserShortcutRecordEventsOptions = {},
): () => void {
  const { emit } = options
  const tracker = createKeyboardInputTracker()

  const handle = (event: KeyboardEvent, phase: 'down' | 'up') => {
    if (!normalizeBrowserShortcutKey(event))
      return

    event.preventDefault()
    event.stopPropagation()
    if (!emit)
      return

    const input = toBrowserKeyboardInputEvent(event, phase)
    if (!input)
      return

    for (const recordEvent of tracker.handle(input))
      emit(recordEvent)
  }

  const handleKeyDown = (event: KeyboardEvent) => handle(event, 'down')
  const handleKeyUp = (event: KeyboardEvent) => handle(event, 'up')

  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('keyup', handleKeyUp, true)
    tracker.reset()
  }
}

export type BindBrowserShortcutRecordEventsOptions = {
  /** 产出录制事件；缺省时 DOM 层只吞按键、不产出事件。@default undefined */
  emit?: (event: ShortcutRecordEvent) => void
}
