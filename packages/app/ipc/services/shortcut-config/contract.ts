import type { IpcContract } from '@ipc/core'
import type { ShortcutBindings, ShortcutRecordEvent, ShortcutRuntimeCapabilities } from '@shared/shortcuts'

export type ShortcutConfigContract = IpcContract<{
  mainHandle: {
    getBindings: () => ShortcutBindings
    setBindings: (bindings: ShortcutBindings) => void
    getCapabilities: () => ShortcutRuntimeCapabilities
    /** 录制快捷键前调用，阻止主进程响应 fn 事件 */
    pauseForRecord: () => void
    /** 录制结束后调用，恢复主进程响应 */
    resumeAfterRecord: () => void
  }
  rendererOn: {
    /** 主进程检测到真实键盘 down/up，推送给录制中的渲染进程 */
    record: ShortcutRecordEvent
  }
}>

export {
  DEFAULT_BINDINGS,
  normalizeShortcutBinding,
  normalizeShortcutBindings,
  shortcutChordsEqual,
  shortcutModifiersEqual,
} from '@shared/shortcuts'

export type {
  FnComboKey,
  FnModifier,
  FnShortcutChord,
  FnShortcutKey,
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutChord,
  ShortcutGestureType,
  ShortcutModifier,
  ShortcutRecordEvent,
  ShortcutRecordPhase,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimeProviderDescriptor,
  ShortcutScope,
} from '@shared/shortcuts'
