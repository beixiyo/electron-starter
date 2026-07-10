import type { KeyboardShortcutChord, ShortcutRecordEvent } from '@shared/shortcuts'
import { toBrowserShortcutRecordEvent } from '@shared/shortcuts'

/**
 * 绑定浏览器环境下的快捷键录制事件。
 * Web 平台没有主进程 / uIOhook，只能在页面聚焦时用 DOM KeyboardEvent 生成同构录制事件
 */
export function bindBrowserShortcutRecordEvents(
  emit: (event: ShortcutRecordEvent) => void,
): () => void {
  const activeChords = new Map<string, KeyboardShortcutChord>()

  const handleKeyDown = (event: KeyboardEvent) => {
    const recordEvent = toBrowserShortcutRecordEvent(event, 'down', activeChords)
    if (!recordEvent)
      return

    event.preventDefault()
    event.stopPropagation()
    emit(recordEvent)
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    const recordEvent = toBrowserShortcutRecordEvent(event, 'up', activeChords)
    if (!recordEvent)
      return

    event.preventDefault()
    event.stopPropagation()
    emit(recordEvent)
  }

  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('keyup', handleKeyUp, true)
    activeChords.clear()
  }
}
