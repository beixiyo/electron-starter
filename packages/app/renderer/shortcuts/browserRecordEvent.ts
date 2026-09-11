import type { ShortcutRecordEvent } from '@shared/shortcuts'
import { createKeyboardInputTracker, toBrowserKeyboardInputEvent } from '@shared/shortcuts'

/**
 * 绑定浏览器环境下的快捷键录制事件。
 * Web 平台没有主进程 / uIOhook，只能在页面聚焦时用 DOM KeyboardEvent 生成同构录制事件
 *
 * DOM 事件先经 adapter 归一为原始输入，再交给共用的 tracker 合成 chord，
 * 与主进程系统级后端走同一条状态机
 */
export function bindBrowserShortcutRecordEvents(
  emit: (event: ShortcutRecordEvent) => void,
): () => void {
  const tracker = createKeyboardInputTracker()

  const handle = (event: KeyboardEvent, phase: 'down' | 'up') => {
    const input = toBrowserKeyboardInputEvent(event, phase)
    if (!input)
      return

    const recordEvents = tracker.handle(input)
    if (recordEvents.length === 0)
      return

    event.preventDefault()
    event.stopPropagation()
    recordEvents.forEach(emit)
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
