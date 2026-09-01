import type { ActiveKeyboardShortcutEntry, ShortcutRecordEvent } from '@shared/shortcuts'
import { toBrowserShortcutRecordEvents } from '@shared/shortcuts'

/**
 * 绑定浏览器环境下的快捷键录制事件。
 * Web 平台没有主进程 / uIOhook，只能在页面聚焦时用 DOM KeyboardEvent 生成同构录制事件
 */
export function bindBrowserShortcutRecordEvents(
  emit: (event: ShortcutRecordEvent) => void,
): () => void {
  const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()

  const handleKeyDown = (event: KeyboardEvent) => {
    const recordEvents = toBrowserShortcutRecordEvents(event, 'down', activeEntries)
    if (recordEvents.length === 0)
      return

    event.preventDefault()
    event.stopPropagation()
    recordEvents.forEach(emit)
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    const recordEvents = toBrowserShortcutRecordEvents(event, 'up', activeEntries)
    if (recordEvents.length === 0)
      return

    event.preventDefault()
    event.stopPropagation()
    recordEvents.forEach(emit)
  }

  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('keyup', handleKeyUp, true)
    activeEntries.clear()
  }
}
